/* ============================================================================
   COIN PUSHER - entry point

   Milestone 2: the shelf moves. One mechanism drives both decks in phase, at
   a constant rhythm, and nothing tells the coins what to do - friction either
   carries the pile or it does not. The metrics below exist to answer that
   with numbers rather than an impression:

     creep    how far the pile's centre of mass advances per complete stroke
     split    how much of that happens on the return vs the out-stroke
     fallen   how many items actually make it off the bottom lip

   Still to come: the drop chute, scoring, and the ported game layer.
   ========================================================================= */

import * as THREE from 'three';
import * as RAPIER from 'rapier';
import { DIMS, TIERS } from '@app/dims';
import { buildMachine, driveShelves, liftTrapped, setTubeColour,
         setZoneColour } from '@app/machine';
import { buildStartingPile, createItem, quatOnEdge,
         itemFaceImage } from '@app/items';
import { initAudio, auditionAll, play, audioReady, setMasterVolume,
         coinReady, hasSample, playMusic, stopMusic, sampleDuration,
         playCue, stopCue, VOICE_KINDS } from '@app/audio';

const CFG = window.COIN_PUSHER_CONFIG;
const PHY = CFG.physics;

let ctx = null;
let renderer, scene, camera, hud, backdrop = null;
let titleBackdrop = null;

/* Loaded once, used twice: the title screen's standalone canvas and, later,
   the quad inside the game's own scene.

   Resolved by RELATIVE url rather than through index.html's import map, and
   stamped from this module's own url. The stamp protects every file the map
   names but cannot protect index.html, because index.html is what CARRIES the
   map - so adding a name to it is a change that does not land until the
   browser lets go of its cached copy of the page, which looks exactly like
   the module being missing. Resolving it here needs no map entry at all. */
const backdropModule = import('./backdrop.js' + new URL(import.meta.url).search);
let acc = 0, last = 0, fps = 0;
let stepCount = 0, presettleSteps = 0;
let phase = 0, running = CFG.shelf.startRunning;
let autoStep = true;   // render loop drives physics; the harness takes this off it

const M = {
  strokes: 0,
  fallen: 0,
  fallenByType: {},
  dropped: 0,
  pegHits: 0,          // peg sounds actually played, for the HUD
  unjammed: 0,         // coins slid off a peg they were impaled on
  surfaceHits: 0,      // surface / coin-on-coin sounds played
  coinOnCoin: 0,       // contacts where BOTH sides were items
  coinOnSurface: 0,    // and where only one was
  runUps: [],          // approach speed of every hit that passed the impact test
  hushed: 0,           // hits the run-up gate silenced
  awarded: 0,          // points credited to a team
  prizes: 0,           // prize items won
  doublers: 0,         // x2 tokens that went over the edge
  dividerHits: 0,      // of those, ones that hit the chute chrome
  soundedThisStep: [], // body handles that made a surface sound this step
  lifted: 0,
  landed: 0,
  jammed: 0,
  fallSteps: [],        // how long a coin takes to come down the chute
  landX: [],            // where it landed, relative to the chute it went in
  creep: [],            // net advance of the pile per complete stroke
  retract: [],          // of that, how much happened while the deck withdrew
  extend: [],           // and how much while it advanced
  atForward: null,
  atBack: null
};

function buildScene() {
  const host = document.getElementById('game');

  scene = new THREE.Scene();
  scene.background = new THREE.Color(CFG.palette.background);

  camera = new THREE.PerspectiveCamera(
    CFG.camera.fovDeg, host.clientWidth / host.clientHeight, 0.05, 100
  );
  aimCamera();

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(host.clientWidth, host.clientHeight);

  /* ---------------------------------------------------------------------
     An environment for the metals to reflect.

     A metallic surface has NO diffuse response - all it can show is what it
     reflects. With nothing to reflect, metalness 0.95 renders almost black,
     which is why the chrome bezel and the peg studs came out as dark marks
     rather than polished metal. This builds a cheap studio: bright overhead
     falling to a dark floor, drawn to a canvas and prefiltered. Nothing is
     loaded from disk, and every metal in the scene picks it up.
     --------------------------------------------------------------------- */
  {
    const c = document.createElement('canvas');
    c.width = 16; c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0.00, '#ffffff');   // ceiling light
    grad.addColorStop(0.30, '#cfd8e4');
    grad.addColorStop(0.55, '#7d879a');   // horizon
    grad.addColorStop(1.00, '#1a1626');   // floor
    g.fillStyle = grad;
    g.fillRect(0, 0, 16, 64);

    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromEquirectangular(tex).texture;
    scene.environmentIntensity = CFG.render.envIntensity;
    pmrem.dispose();
    tex.dispose();
  }

  /* Shadows are what stop items looking like stickers floating above the
     deck. A contact shadow is the only cue that tells you an object is
     RESTING on a surface rather than hovering in front of it. */
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  /* Filmic tone mapping rolls off the highlights instead of clipping them
     to flat white, so a lit surface reads as lit rather than as a swatch. */
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = CFG.render.exposure;

  host.appendChild(renderer.domElement);

  /* ---------------------------------------------------------------------
     The stage photograph behind the machine. It adds itself to the scene
     once the image has decoded, and draws first every frame - backdrop.js.

     Loaded by RELATIVE url rather than through index.html's import map, and
     stamped from this module's own url. The reason is worth writing down:
     the stamp protects every file the map names, but it cannot protect
     index.html, because index.html is what CARRIES the map. So adding a name
     to the map is a change that does not land until the browser lets go of
     its cached copy of the page - which looks exactly like the module being
     missing. Resolving it here instead needs no map entry, so a new module
     never depends on a fresh index.html again.
     --------------------------------------------------------------------- */
  backdropModule
    .then(function (mod) {
      backdrop = mod.createBackdrop(scene, CFG.backdrop);
      /* The title screen's own canvas has done its job. Both run the same
         shader off the same clock, so the frame this draws first is the frame
         that one would have drawn next - the handover is invisible. */
      if (titleBackdrop) { titleBackdrop.dispose(); titleBackdrop = null; }
    })
    .catch(function (err) { console.warn('[backdrop] not loaded:', err); });

  /* Ambient is deliberately low. A strong hemisphere light fills every
     crevice evenly, which is precisely what makes a scene look flat - it
     erases the shading gradient that tells you a surface has a direction. */
  scene.add(new THREE.HemisphereLight(0xffffff, 0x3a2a4a, 0.55));

  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(1.6, 3.6, 2.6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.015;

  /* Aim the light at the PLAYFIELD, not the world origin, and size its shadow
     camera to just that. The bounds are in the light's own space, so guessing
     them from world dimensions misses - and spending the map on the full
     height of the chute wastes almost all of it on a backdrop that never
     shows a shadow anyway. Concentrating it here is what makes the contact
     shadows under the coins sharp enough to read. */
  key.target.position.set(0, DIMS.tierTop.y + DIMS.deckStep, DIMS.playDepth * 0.5);
  scene.add(key.target);
  {
    const c = key.shadow.camera;
    const r = DIMS.width / 2 + DIMS.D * 2;
    c.left = -r; c.right = r; c.bottom = -r; c.top = r;
    c.near = 0.5; c.far = 14;
    c.updateProjectionMatrix();
  }
  scene.add(key);

  /* Cool fill from the opposite side, no shadow - it exists to keep the
     shadowed faces from going dead, not to light the scene twice. */
  const fill = new THREE.DirectionalLight(0xbfd4ff, 0.45);
  fill.position.set(-2.2, 1.4, 1.2);
  scene.add(fill);

  /* A dim light from below and in front lifts the underside of the shelf lip
     and the fascia, which the key light cannot reach at all. */
  const bounce = new THREE.DirectionalLight(0xffd9c0, 0.3);
  bounce.position.set(0, -1.5, 3.0);
  scene.add(bounce);
}

/* The one static camera transform. Frontal and symmetric, so all four drop
   panes are equally clickable, and elevated enough to read how far forward
   the pile has crept. */
function fitPoints() {
  const hx = DIMS.width / 2 + DIMS.wallThick;
  const y0 = DIMS.tierLast.y - DIMS.D * 0.3, y1 = DIMS.chuteTop;
  const z0 = 0, z1 = DIMS.tierLast.lipZ;
  const pts = [];
  [-hx, hx].forEach(function (x) {
    [y0, y1].forEach(function (y) {
      [z0, z1].forEach(function (z) { pts.push(new THREE.Vector3(x, y, z)); });
    });
  });
  return pts;
}

/* An off-centre projection, so the machine can sit left of centre without the
   camera turning to look at it. The view offset renders a window taken from a
   virtual image of the same size, displaced sideways - the machine keeps its
   square-on perspective and simply moves across the frame. */
function applyLensShift() {
  const host = document.getElementById('game');
  const w = host.clientWidth, h = host.clientHeight;
  const p = CFG.camera.centreAtScreenX;

  if (p === undefined || Math.abs(p - 0.5) < 0.001) {
    camera.clearViewOffset();
    return;
  }
  camera.setViewOffset(w, h, w * (0.5 - p), 0, w, h);
}

/* Points spanning the machine's TRUE width, taken from the built geometry.

   Neither derived box gets this right. The cabinet box leaves out the light
   tubes, which stand outside the walls - framing to it ran the outer tube off
   the left of the screen. A box drawn to the tubes' outer corners is wrong the
   other way: it has corners at the top FRONT that no tube occupies, and to a
   camera looking down from above those are the nearest points of all, so they
   project widest and the machine comes out too small.

   Measuring the geometry itself avoids both. Each mesh's own bounding box is
   tight - the tubes are built as short straight segments - so the union of
   their corners is an honest outline rather than one big box full of corners
   that are not really there.

   Width only. Vertical framing still uses fitPoints, which deliberately lets
   the tube tops and the skirt run off frame. */
let widthProbe = null;

function captureWidthProbe() {
  const pts = [];
  const bb = new THREE.Box3();
  scene.updateMatrixWorld(true);

  scene.traverse(function (o) {
    if (!o.isMesh || !o.geometry) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    bb.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
    for (let i = 0; i < 8; i++) {
      pts.push(new THREE.Vector3(
        i & 1 ? bb.max.x : bb.min.x,
        i & 2 ? bb.max.y : bb.min.y,
        i & 4 ? bb.max.z : bb.min.z
      ));
    }
  });

  widthProbe = pts.length ? pts : null;
}

function aimCamera() {
  const c = CFG.camera;

  /* Size the machine with NO shift applied, then shift it afterwards.

     Fitting through a shifted projection makes the fit see the machine's left
     edge pushed out towards the frame margin, so it pulls the camera back and
     the machine shrinks - moving it sideways should not change how big it is.
     Clearing the offset first keeps the scale identical to the centred
     framing, and the shift then only translates. */
  camera.clearViewOffset();
  const el = (c.elevationDeg * Math.PI) / 180;
  const target = new THREE.Vector3(0, c.lookAt.y, DIMS.playDepth * c.lookAt.zFraction);

  function place(d) {
    camera.position.set(
      0,
      target.y + Math.sin(el) * d,
      target.z + Math.cos(el) * d
    );
    camera.lookAt(target);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
  }

  let d = c.distance;
  place(d);
  if (!c.autoFit) return;

  /* Frame the machine: pull back until it fits, AND raise or lower the aim so
     it sits centred in the frame.

     Scaling alone is not enough. The machine is much taller than it is deep,
     so its extremes are the top of the chute and the front lip - and a fit
     that only pushes the worst corner to the margin leaves everything hanging
     off the top with dead screen underneath. Centring is what uses the space.

     Both passes run together because they interact: recentring changes which
     corner is worst, and rescaling changes where the centre falls. */
  const pts = fitPoints();
  const worldSpan = DIMS.chuteTop - (DIMS.tierLast.y - DIMS.D * 0.3);

  for (let pass = 0; pass < 8; pass++) {
    let minY = Infinity, maxY = -Infinity, worstX = 0;
    let minX = Infinity, maxX = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      const v = pts[i].clone().project(camera);
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
      worstX = Math.max(worstX, Math.abs(v.x));
    }

    /* Nudge the aim so the content's vertical mid-point sits on the centreline. */
    const midY = (maxY + minY) / 2;
    const spanY = Math.max(maxY - minY, 1e-3);
    target.y += midY * (worldSpan / spanY);

    /* Two sizing rules, and we obey whichever asks the camera to pull back
       further: the machine must fit inside the frame margin, AND - if a width
       has been asked for - it must not be wider than that share of the screen.
       Taking the larger of the two ratios means neither can be violated. */
    const worst = Math.max(worstX, Math.abs(maxY - midY), Math.abs(minY - midY));
    let ratio = worst / c.fitMargin;

    if (c.widthFraction) {
      let wLo = minX, wHi = maxX;
      if (widthProbe) {
        wLo = Infinity; wHi = -Infinity;
        for (let k = 0; k < widthProbe.length; k++) {
          const x = widthProbe[k].clone().project(camera).x;
          if (x < wLo) wLo = x;
          if (x > wHi) wHi = x;
        }
      }
      /* NDC spans 2 units across, so a span of s covers s/2 of the screen. */
      ratio = Math.max(ratio, (wHi - wLo) / 2 / c.widthFraction);
    }

    if (Math.abs(ratio - 1) < 0.004 && Math.abs(midY) < 0.01) {
      place(d);
      break;
    }
    d = Math.max(0.3, d * ratio);
    place(d);
  }

  applyLensShift();
}

function buildWorld() {
  const world = new RAPIER.World({ x: 0, y: PHY.gravity, z: 0 });
  world.timestep = PHY.timestep;
  try { world.numSolverIterations = PHY.solverIterations; } catch (e) { /* older Rapier */ }
  try {
    world.integrationParameters.lengthUnit = PHY.lengthUnit;
    world.integrationParameters.numInternalPgsIterations = PHY.pgsIterations;
    /* Write-only in this build - there is no getter to read it back. */
    world.integrationParameters.contact_natural_frequency = PHY.contactHz;
  } catch (e) { /* older Rapier */ }
  return world;
}

function clearItems() {
  ctx.items.forEach(function (it) {
    scene.remove(it.mesh);
    ctx.world.removeRigidBody(it.body);
  });
  ctx.items.length = 0;
}

function resetPile() {
  clearItems();
  buildStartingPile(ctx);
  seedPresents();
  stepCount = 0;
  phase = 0;
  M.strokes = 0; M.fallen = 0; M.fallenByType = {};
  M.dropped = 0; M.lifted = 0; M.landed = 0; M.jammed = 0; M.fallSteps = []; M.landX = [];
  M.creep = []; M.retract = []; M.extend = [];
  M.atForward = null; M.atBack = null;
  driveShelves(ctx, 0);
  presettle();
}

/* Step the pile to rest before anyone looks at it, so the machine is already
   settled when the host sees it rather than shivering for twenty seconds.

   Damping is cranked up for the duration and put back afterwards. That is an
   initial condition, not a physics rule: it only decides how the pile arrives,
   and the pile stays asleep once normal damping returns. */
function presettle() {
  ctx.items.forEach(function (it) {
    it.body.setAngularDamping(PHY.presettleAngularDamping);
    it.body.setLinearDamping(PHY.presettleLinearDamping);

    /* Lock tipping while the starting pile settles, so items can only spin
       about the vertical axis. They still stack on each other freely - they
       just cannot come to rest standing on edge, which looks wrong on a
       machine nobody has played yet. Rotation is handed back below, and an
       item already lying flat has no reason to stand itself up.

       Only the starting pile passes through here. Items dropped later are
       free to tip from the moment they enter the chute, which is what the
       glass release depends on. */
    if (PHY.flatStartingPile) {
      it.body.setEnabledRotations(false, true, false, true);
    }
  });

  let used = 0;
  for (let s = 0; s < PHY.presettleMaxSteps; s++) {
    ctx.world.step();
    stepCount++;
    used++;
    let anyAwake = false;
    for (let i = 0; i < ctx.items.length; i++) {
      if (!ctx.items[i].body.isSleeping()) { anyAwake = true; break; }
    }
    if (!anyAwake) break;
  }

  ctx.items.forEach(function (it) {
    it.body.setAngularDamping(PHY.angularDamping);
    it.body.setLinearDamping(PHY.linearDamping);
    if (PHY.flatStartingPile) {
      it.body.setEnabledRotations(true, true, true, true);
    }
  });

  presettleSteps = used;
  acc = 0;
}

/* -------------------------------------------------------------------------
   Which tier an item is on, by height. The creep metric would be meaningless
   averaged across both tiers at once.
   ------------------------------------------------------------------------- */
function tierOf(y) {
  for (let k = 0; k < TIERS.length; k++) {
    if (y > TIERS[k].y - DIMS.D * 0.5) return k;
  }
  return TIERS.length - 1;
}

/* Mean depth of the pile on the scoring tier - the lowest one. */
function centroidZ() {
  const last = TIERS.length - 1;
  let sum = 0, n = 0;
  for (let i = 0; i < ctx.items.length; i++) {
    const t = ctx.items[i].body.translation();
    if (t.y < DIMS.tierLast.y - DIMS.D) continue;   // in the tray, not on a tier
    if (tierOf(t.y) !== last) continue;
    sum += t.z; n++;
  }
  return n ? sum / n : null;
}

function push(arr, v) { arr.push(v); if (arr.length > 40) arr.shift(); }

function spread(arr) {
  const m = mean(arr);
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += (arr[i] - m) * (arr[i] - m);
  return Math.sqrt(s / arr.length);
}
function mean(arr) {
  if (!arr.length) return null;
  let s = 0; for (let i = 0; i < arr.length; i++) s += arr[i];
  return s / arr.length;
}

/* Items that have left the bottom lip. Counted and removed - scoring will
   hook in exactly here, but this pass only needs the rate. */
/* The earliest step at which the next scoring sound may start. Coins rarely
   come off the lip on the SAME step - they come off one step apart, which is
   17ms, and two sounds 17ms apart is not two sounds. Queuing them against a
   running cursor rather than counting per step is what turns a burst into the
   run of separate hits it should be. */
let nextScoringStep = 0;

function collectFallen() {
  for (let i = ctx.items.length - 1; i >= 0; i--) {
    const it = ctx.items[i];
    const t = it.body.translation();
    if (t.y < DIMS.tierLast.y - DIMS.D) {
      M.fallen++;
      award(it);
      /* One sound per coin, fanned out so a burst reads as several coins
         rather than one loud thump. Counted per step, not per coin, so the
         first of a batch is always immediate. */
      const doubler = isDoubler(it.typeId);
      const present = !!(CFG.presents && CFG.presents.enabled && it.wrap);
      const jackpot = !!(CFG.jackpot && CFG.jackpot.enabled &&
                         it.typeId === CFG.jackpot.typeId);
      if (CFG.audio && CFG.audio.enabled && audioReady()) {
        const stagger = CFG.audio.scoringStaggerSeconds / PHY.timestep;
        const at = Math.max(stepCount, nextScoringStep);
        /* The x2 and a present each get their own sound INSTEAD of the
           ordinary one, and take their turn in the same queue, so several
           things coming off together read as separate events rather than a
           pile-up. A present plays it once. */
        const pan = DIMS.width > 0 ? t.x / (DIMS.width * 0.5) : 0;
        const wait = (at - stepCount) * PHY.timestep;
        let kind = 'scoring';
        if (jackpot && hasSample(CFG.jackpot.sound)) kind = CFG.jackpot.sound;
        else if (doubler && hasSample('bonus')) kind = 'bonus';
        else if (present && hasSample(CFG.presents.sound)) kind = CFG.presents.sound;
        play(kind, 1, pan, wait, true);

        /* And the win sting straight after the jackpot clip, not over it.
           Delayed by the first clip's MEASURED duration and scheduled on the
           audio clock, so the join is exact - a timer would drift by however
           long the frame took. */
        if (jackpot && CFG.jackpot.thenPlay && hasSample(CFG.jackpot.thenPlay)) {
          play(CFG.jackpot.thenPlay, 1, pan,
               wait + sampleDuration(kind), true);
        }
        nextScoringStep = at + stagger;
      }
      /* And the tubes, whether or not it scored for anyone. A token that goes
         over while it is nobody's turn is wasted, but it still went over, and
         a machine that stays silent for it looks broken rather than strict.
         A present is a prize and is nobody's turn by definition. */
      if (jackpot) startJackpotFlash();
      else if (doubler) startDoublerFlash();
      else if (present) startPresentFlash(it);
      noteDelivery();
      M.fallenByType[it.typeId] = (M.fallenByType[it.typeId] || 0) + 1;
      scene.remove(it.mesh);
      ctx.world.removeRigidBody(it.body);
      ctx.items.splice(i, 1);
    }
  }
}

/* -------------------------------------------------------------------------
   A drop. The item goes in at the top of one of the four chutes, ON EDGE and
   behind glass, and rattles down through the pegs before it reaches the deck.

   The zone biases where it ends up. It does not choose it - the entry point
   is jittered and every peg it clips changes the answer. And because the fall
   takes a real fraction of a shelf stroke, WHEN the host drops matters as
   much as where.
   ------------------------------------------------------------------------- */
let dropTurn = 0;

/* config.dropItem may be one type id or a list. A list cycles - see the note
   there on why this is not a random pick. */
/* The plain coin rotation - light, dark, light, dark - with no doubler roll.

   Split out because PLACE COIN needs it too, and needs it to share the SAME
   counter: two counters would let the pile drift towards one colour, since
   the hand-placed coins and the dropped ones would each start again from
   light. */
function nextCoinType() {
  const d = CFG.dropItem;
  if (typeof d === 'string') return d;
  return d[dropTurn++ % d.length];
}

function nextDropType() {
  /* One in ten, by default, is a doubler rather than a coin - see
     multiplier.dropChance. Rolled per drop, so ten drops is the average
     rather than a promise; a run of three in a row is possible and is the
     kind of thing a room enjoys. This is the only way another token enters
     play once the two on the shelf have gone.

     Deliberately not shared with PLACE COIN: a token the host put there by
     hand would be one they chose, which is not the same thing at all. */
  const D = CFG.multiplier;
  if (D && D.enabled && D.dropChance > 0 && Math.random() < D.dropChance) {
    return D.typeId;
  }
  return nextCoinType();
}

/* -------------------------------------------------------------------------
   ARMING

   A drop is two acts, not one: arm a zone, then release it. See the arming
   block in config for why.

   Three states, and the machine is only ever in one of them:

     idle       nothing selected, every zone lit, no music
     armed      one zone lit, the other three dark red, music running
     resolving  the coin is on its way down; music still running, waiting for
                something to go over the front edge

   Resolving deliberately outlives the drop. The tension is not in the release,
   it is in watching what the coin does afterwards, so the music carries
   through the fall and stops on the payoff.
   ------------------------------------------------------------------------- */
/* LIT and ARMED are different things, and separating them is what lets the
   lights hold through the fall.

   armedZone is the zone that will release a coin on the next click. litZone is
   the zone showing white. They are the same while a player is deciding, and
   they come apart the moment the coin is released: nothing is armed any more,
   but the lights stay exactly as they were until the music ends. Holding them
   together in one variable is why the zones used to snap back to white the
   instant you let go. */
let armedZone = -1;          // -1 when nothing is armed
let litZone   = -1;          // -1 when every zone is lit
let musicResumeAt = 0;       // stepCount at which the ducked music comes back
let droppedItem = null;      // the coin just released, watched out of the chute
let resolving = false;
/* Both are STEP COUNTS, not wall-clock times.

   Wall clock was tried and is wrong here. The countdown has to run on the same
   clock as the machine: tie it to real time and a paused or backgrounded game
   keeps counting down while nothing moves, so the music expires against a
   frozen playfield and, on resume, a drop that never happened is already over.
   Counting steps means the timer only advances when the coin does. */
let resolveDeadline = 0;     // stepCount at which to give up; 0 when not resolving
let landedStep      = 0;     // stepCount at which the dropped coin hit the shelf

/* The red does not snap back, it eases back, starting a beat after the coin
   lands. 0 = fully red, 1 = fully normal; -1 = not fading. */
let fadeFrom = -1;           // stepCount at which the red is let go

/* Which team's box has been clicked, or -1 for none. Lights the machine's
   three tubes in that team's colour - whose turn it is, without a word of
   text on screen. */
let teamHighlight = -1;

/* THE TURN'S DOUBLING.

   turnMultiplier  what the NEXT item over the edge is worth, as a multiple
   turnSubtotal    what this turn has scored so far, after multipliers

   The subtotal is the whole trick. When a doubler lands it is added a second
   time, which retroactively doubles every coin that already went over in this
   turn - so the order the token comes out in cannot change the final number.
   Both reset when the light moves to another team, which is what stops a
   doubling reaching back past the start of a turn. */
let turnMultiplier = 1;
let turnSubtotal = 0;

/* Blend two 0xRRGGBB colours. Done per channel on the raw integers rather
   than through THREE.Color so this can be called for every zone and tube on
   every frame of the fade without allocating anything. */
function mixHex(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (((ar + (br - ar) * t) | 0) << 16) |
         (((ag + (bg - ag) * t) | 0) << 8) |
         (((ab + (bb - ab) * t) | 0));
}

/* mix runs 0 (full red) to 1 (back to normal). */
/* -------------------------------------------------------------------------
   LIGHT TRANSITIONS

   Nothing switches instantly. Every light - the four zone panels and the three
   tubes - eases from where it is to where it should be, so arming a zone,
   picking a team, and the machine returning to normal all read as a light
   changing rather than a value being replaced.

   Each light is a CHANNEL holding where it came from, where it is going, when
   it started and how long it has. Setting a target mid-transition starts the
   new one from wherever the light actually IS, so a change part way through
   another does not jump.

   This replaced a one-off fade that existed only for the post-landing return
   to normal. Keeping both would have meant the machine easing twice, once
   through that ramp and again through this one, and the two fighting over how
   long it took.
   ------------------------------------------------------------------------- */
function chan(hex) { return { from: hex, to: hex, at: 0, dur: 0, cur: hex }; }

function aim(ch, value, durSteps) {
  if (ch.to === value) return;
  ch.from = ch.cur;
  ch.to   = value;
  ch.at   = stepCount;
  ch.dur  = durSteps;
}

/* Smoothstep rather than linear: a light that starts and stops abruptly reads
   as a cut with a delay in the middle, not as a fade. */
function ease(t) { return t * t * (3 - 2 * t); }

function tick(ch, lerp) {
  if (ch.dur <= 0) { ch.cur = ch.to; return; }
  const t = Math.min(1, (stepCount - ch.at) / ch.dur);
  ch.cur = lerp(ch.from, ch.to, ease(t));
  if (t >= 1) { ch.cur = ch.to; ch.dur = 0; }
}

const lerpNum = function (a, b, t) { return a + (b - a) * t; };

let lights = null;

function initLights() {
  const A = CFG.arming, lit = CFG.palette.panelGlow;
  lights = { zoneC: [], zoneG: [], zoneE: [], tubes: [] };
  for (let i = 0; i < DIMS.zoneCount; i++) {
    lights.zoneC.push(chan(lit));
    lights.zoneG.push(chan(lit));
    lights.zoneE.push(chan(A.litEmissive));
  }
  for (let i = 0; i < CFG.lightTubes.colours.length; i++) {
    lights.tubes.push(chan(CFG.lightTubes.colours[i]));
  }
}

/* Point every light at where the current state says it should be. seconds is
   how long to take getting there - short for arming or picking a team, long
   for the machine easing back to normal after a drop. */
/* ---------------------------------------------------------------------------
   THE x2 FLASH

   Three pulses of purple across the tubes, then back to whatever the lights
   should be. Held as a phase and a countdown rather than a queue of timers,
   because it is stepped on the physics clock like everything else here - a
   setTimeout would drift against the machine and would keep firing while the
   tab is in the background.

   flashLeft counts HALF-cycles: on, off, on, off, on, off. That is why it is
   count * 2 rather than count.
   ------------------------------------------------------------------------- */
let flashSeq = [];        // the colour of each lit pulse, in order
let flashIndex = 0;       // which pulse we are on
let flashOn = false;      // is the current half-cycle a lit one
let flashUntil = 0;       // step at which the current half-cycle ends
let flashOnSteps = 1, flashOffSteps = 1;
/* GAPLESS flashes have no dark half-cycle: each frame is held and then
   replaced by the next, so the machine alternates between two lit states
   rather than blinking on and off against its resting colour. That is the
   difference between "flash, back to normal, flash" and "yellow, white,
   yellow" - the jackpot wants the second. */
let flashGapless = false;

/* Start a flash. colours is one entry per PULSE, so a x2 passes one colour
   repeated three times and a present passes its box and ribbon alternating
   six times. Restarts rather than stacks: two things landing together is
   worth two sounds and is not worth two sequences fighting each other. */
function startFlash(colours, onSeconds, offSeconds, gapless) {
  if (!colours || !colours.length) return;
  flashSeq = colours.slice();
  flashIndex = 0;
  flashOn = false;          // tickFlash flips it, so the first half-cycle is lit
  flashUntil = stepCount;   // ... and starts immediately
  flashOnSteps  = Math.max(1, Math.round(onSeconds  / PHY.timestep));
  flashOffSteps = Math.max(1, Math.round(offSeconds / PHY.timestep));
  flashGapless  = !!gapless;
  tickFlash();
}

/* A colour lifted towards white. The tubes are emissive - they are lit, not
   painted - so a dark colour set on one reads as the tube going OUT rather
   than flashing. A present's ribbon is often dark, so its own colours have to
   be raised before they reach the light. */
function lift(hex, t) {
  const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  const up = (c) => Math.round(c + (255 - c) * t);
  return (up(r) << 16) | (up(g) << 8) | up(b);
}

/* The current pulse, or null between pulses and when nothing is flashing.

   A frame is { tubes, panels }:
     tubes    one colour for all three, or an array of three
     panels   a colour for the backlight, or null to leave it alone

   Most flashes only touch the tubes. The jackpot is the one that takes the
   backlight too, which is why this is a frame rather than a colour. */
function flashFrame() {
  return flashOn && flashIndex < flashSeq.length ? flashSeq[flashIndex] : null;
}

function tubesOf(frame, i) {
  if (!frame || frame.tubes == null) return null;
  return Array.isArray(frame.tubes)
    ? frame.tubes[i % frame.tubes.length]
    : frame.tubes;
}

function tickFlash() {
  if (flashIndex >= flashSeq.length || stepCount < flashUntil) return;
  let steps;
  if (flashGapless) {
    if (flashOn) flashIndex++;        // that state is done; the next replaces it
    flashOn = flashIndex < flashSeq.length;
    steps = flashOnSteps;
  } else {
    flashOn = !flashOn;
    if (!flashOn) flashIndex++;       // a dark half-cycle ends that pulse
    steps = flashOn ? flashOnSteps : flashOffSteps;
    if (flashIndex >= flashSeq.length) flashOn = false;   // finish at rest
  }
  flashUntil = stepCount + steps;
  /* Repaint at the pulse's own speed, not the machine's usual fade. */
  paintZones(steps * PHY.timestep);
}

/* The x2's flash: one colour, three pulses. */
function startDoublerFlash() {
  const F = CFG.multiplier && CFG.multiplier.flash;
  if (!F || !F.enabled || !(F.count > 0)) return;
  const seq = [];
  for (let i = 0; i < F.count; i++) seq.push({ tubes: F.colour, panels: null });
  startFlash(seq, F.onSeconds, F.offSeconds);
}

/* The jackpot's: ten flashes, everything on one beat.

   The panels take all four together, alternating white and yellow. The tubes
   take a checkerboard - outer two yellow with the middle white, then the
   reverse - so on every beat the whole machine flips and the tubes are always
   the opposite of each other. */
function startJackpotFlash() {
  const J = CFG.jackpot;
  if (!J || !J.enabled) return;

  /* How many states to hold. With matchSound on this is derived from the two
     clips actually loaded, so the lights run exactly as long as the fanfare -
     and keep doing so if a clip is swapped, rather than needing a number here
     edited to match. Rounded UP, so the lights outlast the audio by at most
     one state rather than stopping just short of the end. */
  let count = J.flashes;
  if (J.matchSound) {
    const secs = (hasSample(J.sound) ? sampleDuration(J.sound) : 0) +
                 (J.thenPlay && hasSample(J.thenPlay) ? sampleDuration(J.thenPlay) : 0);
    if (secs > 0) count = Math.ceil(secs / J.onSeconds);
  }
  if (!(count > 0)) return;

  const seq = [];
  for (let i = 0; i < count; i++) {
    const even = (i % 2) === 0;
    const outer = even ? J.yellow : J.white;
    const mid   = even ? J.white  : J.yellow;
    seq.push({ tubes: [outer, mid, outer], panels: even ? J.yellow : J.white });
  }
  /* gapless: the alternation IS the flash. There is no beat where the
     machine goes back to its resting colours. */
  startFlash(seq, J.onSeconds, J.offSeconds, true);
}

/* A present's: its own two colours, alternating, three times through. */
function startPresentFlash(item) {
  const P = CFG.presents;
  if (!P || !P.enabled || !item.wrap) return;
  const seq = [];
  for (let i = 0; i < P.flashPairs; i++) {
    seq.push({ tubes: lift(item.wrap.box,    P.flashLift), panels: null });
    seq.push({ tubes: lift(item.wrap.ribbon, P.flashLift), panels: null });
  }
  startFlash(seq, P.onSeconds, P.offSeconds);
}

function paintZones(seconds) {
  if (!lights) initLights();
  const A = CFG.arming, lit = CFG.palette.panelGlow;
  const dur = (seconds != null ? seconds : CFG.arming.lightFadeSeconds) / PHY.timestep;

  const frame = flashFrame();
  for (let i = 0; i < DIMS.zoneCount; i++) {
    const on = litZone < 0 || i === litZone;
    /* A flash that names a panel colour takes ALL four together and outranks
       the armed red, because a jackpot outranks a drop in progress. */
    if (frame && frame.panels != null) {
      aim(lights.zoneC[i], frame.panels, dur);
      aim(lights.zoneG[i], frame.panels, dur);
      aim(lights.zoneE[i], A.litEmissive, dur);
      continue;
    }
    aim(lights.zoneC[i], on ? lit : A.dimmedColour, dur);
    aim(lights.zoneG[i], on ? lit : A.dimmedGlow,   dur);
    aim(lights.zoneE[i], on ? A.litEmissive : A.dimmedEmissive, dur);
  }

  /* ARMING WINS over a team highlight while it is running: the drop is the
     thing happening, and the machine going red for it is the whole point. When
     it clears, the tubes fall back to the selected team's colour rather than
     to neutral, so whose turn it is survives the drop. */
  const tubes = CFG.lightTubes.colours;
  const team = teamHighlight >= 0 ? CFG.scoreboard.teamColours[teamHighlight] : null;
  /* The x2 flash sits ON TOP of all of it, arming included: a token going
     over is the biggest thing that can happen and it should not be outvoted
     by a drop still resolving. When it ends this function runs again with
     flashColour() back to null and the lights land wherever the state says
     they belong - nothing is remembered across the flash. */
  for (let i = 0; i < tubes.length; i++) {
    const rest = team != null ? team : tubes[i];
    const fl = tubesOf(frame, i);
    aim(lights.tubes[i],
        fl != null ? fl : (litZone < 0 ? rest : A.dimmedGlow), dur);
  }
}

/* Advance every light and push it to the materials. Called each frame. */
function tickLights() {
  if (!lights || !ctx || !ctx.machine) return;
  for (let i = 0; i < lights.zoneC.length; i++) {
    tick(lights.zoneC[i], mixHex);
    tick(lights.zoneG[i], mixHex);
    tick(lights.zoneE[i], lerpNum);
    setZoneColour(ctx, i, lights.zoneC[i].cur, lights.zoneG[i].cur, lights.zoneE[i].cur);
  }
  for (let i = 0; i < lights.tubes.length; i++) {
    tick(lights.tubes[i], mixHex);
    setTubeColour(ctx, i, lights.tubes[i].cur);
  }
  /* The volume slider is the fourth light. Same value, same step, so it
     cannot lag or disagree with the cabinet. */
  if (lights.tubes.length) setVolumeTint(lights.tubes[0].cur);
}

/* The host pointed at a zone. Whether that arms it or releases it depends on
   what is already armed. */
export function selectZone(zone) {
  const A = CFG.arming;
  if (!A || !A.enabled) { dropInto(zone); return; }
  if (zone < 0 || zone >= DIMS.zoneCount) return;

  if (armedZone === zone) {                 // release
    armedZone = -1;
    /* litZone is deliberately NOT cleared - the lights hold through the fall
       and go out with the music. */

    /* A drop sting, if one is configured, plays alone: the bed steps out of
       its way and comes back when the coin clears the chute. There is no
       sting at the moment - see audio.samples in config for why it was taken
       out - so the bed simply runs straight through the release. */
    if (hasSample('drop')) {
      stopMusic(A.duckFadeOut);
      playCue('drop', 0);
      const gap = sampleDuration('drop');
      musicResumeAt = gap > 0 ? stepCount + gap / PHY.timestep : 0;
    }

    droppedItem = dropInto(zone);

    resolving = true;
    /* Both the timeout and the fade are anchored to the LANDING, which has not
       happened yet - see tickArming. Anchoring them here instead would let a
       player who deliberates for twenty seconds eat the whole window before
       the coin is even in the air. */
    landedStep = 0;
    resolveDeadline = 0;
    return;
  }

  if (armedZone >= 0 && !A.reArmOnOtherZone) return;

  armedZone = zone;                          // arm, or move the selection
  litZone   = zone;
  resolving = false;
  resolveDeadline = 0;
  /* A new selection supersedes a pending un-duck: start the bed now rather
     than letting the old timer bring it in again a moment later. */
  musicResumeAt = 0;
  droppedItem = null;
  landedStep = 0;
  resolveDeadline = 0;
  fadeFrom = -1;
  stopCue(CFG.arming.stingFadeOut);
  paintZones();
  playMusic('tense', { loop: true });
}

/* Called when a coin goes over the front edge - the payoff the music has been
   waiting for - and from the timeout, so a drop that delivers nothing does not
   leave the bed running for ever. */
function endResolve() {
  if (!resolving) return;
  resolving = false;
  resolveDeadline = 0;
  landedStep = 0;
  musicResumeAt = 0;
  droppedItem = null;
  if (armedZone < 0) {
    stopMusic(0.35);
    /* The lights are NOT cleared here when a fade is already coming. They run
       their own clock, which usually outlasts the music: a coin often scores
       about two seconds after the landing while the red does not finish easing
       back until three, and clearing them here would cut that short.

       Only when no fade was ever scheduled - a drop that resolved before the
       coin even landed - does this have to let the red go itself, or the
       machine would stay lit for good. */
    if (fadeFrom < 0 && litZone >= 0) {
      litZone = -1;
      paintZones(CFG.arming.fadeBackSeconds);
    }
  }
}

/* The released coin has cleared the bottom of the chute: cut the sting and
   bring the bed back under the rest of the fall. */
function unduck() {
  musicResumeAt = 0;
  droppedItem = null;
  stopCue(CFG.arming.stingFadeOut);
  if (resolving || armedZone >= 0) {
    playMusic('tense', { loop: true, fadeIn: CFG.arming.duckFadeIn });
  }
}

function tickArming() {
  const A = CFG.arming;

  if (droppedItem) {
    /* The coin is down. Everything is timed from here: the sting stops, the
       bed comes back, the clock on the music starts, and the red begins to
       clear a beat later. Gone from the world counts as landed too -
       collected, or cleared away - since it will never report arriving. */
    const gone = ctx.items.indexOf(droppedItem) < 0;
    if (gone || droppedItem.body.translation().y <= DIMS.chuteBottom) {
      landedStep = stepCount;
      resolveDeadline = stepCount + A.resolveTimeoutSeconds / PHY.timestep;
      fadeFrom = stepCount + A.fadeBackDelaySeconds / PHY.timestep;
      unduck();
    }
  }

  /* A beat after the coin lands, let the red go. One target change over a long
     duration - the transition machinery does the easing, and it runs on its own
     clock regardless of when the music happens to stop. */
  if (fadeFrom >= 0 && stepCount >= fadeFrom) {
    fadeFrom = -1;
    if (armedZone < 0) { litZone = -1; paintZones(A.fadeBackSeconds); }
  }

  /* Bring the bed back once the drop sting has run its course - but only if
     the drop has not already resolved in the meantime, which would mean the
     music was about to stop anyway. */
  if (musicResumeAt && stepCount >= musicResumeAt) unduck();
  if (!resolving) return;

  /* Nothing scored within the window. Only armed once the coin has landed, so
     a long deliberation cannot eat into it. */
  if (resolveDeadline && stepCount >= resolveDeadline) endResolve();
}

/* Credit a coin that has just gone over the edge to whoever's turn it is.

   The turn IS the team highlight - the thing that lights the machine green or
   red - so there is no separate notion of an active team to get out of step
   with what is on screen. Nobody highlighted means nobody scores: the coin
   still falls, still makes its noise, still counts in the machine's own tally,
   it simply credits no one. Points scored with the lights neutral are gone,
   not held aside.

   What a coin is worth comes from its TYPE, not from a number here, so the
   50 and 100 tokens already in config score their own value the day they are
   put into play, and a prize type goes to that team's log instead of their
   score. */
function award(it) {
  if (teamHighlight < 0) return;
  const team = ctx.teams[teamHighlight];
  const type = CFG.itemTypes[it.typeId];
  if (!team || !type || !type.value) return;

  if (type.value.type === 'prize') {
    team.log.push(type.value.label);
    M.prizes++;
    return;
  }

  /* Scored at whatever the turn is currently worth. */
  const gain = type.value.amount * turnMultiplier;
  team.score  += gain;
  M.awarded   += gain;
  turnSubtotal += gain;

  /* And if that was a doubler, settle up. It has already scored as an item,
     so adding the turn's subtotal a second time doubles the whole turn -
     the coins that went over before this one included. Then everything after
     it scores at the new multiplier.

     Worth checking the two orders by hand, because "order does not matter" is
     easy to claim and easy to get wrong. Points at 10, a token and two coins:

       token last   10 + 10 = 20, token +10 = 30, retro +30 = 60
       token first  token +10 = 10, retro +10 = 20, x2; two coins at 20 = 60

     and two tokens plus one coin comes to 120 either way, which is three
     items at 10 multiplied by 4. */
  if (isDoubler(it.typeId)) {
    team.score += turnSubtotal;
    M.awarded  += turnSubtotal;
    turnSubtotal *= CFG.multiplier.factor;
    turnMultiplier *= CFG.multiplier.factor;
    M.doublers++;
  }
}

/* One place that answers "is this the token", so the rule cannot drift apart
   from the type it is about. */
function isDoubler(typeId) {
  const D = CFG.multiplier;
  return !!(D && D.enabled && typeId === D.typeId);
}

/* A coin went over the front lip of the platform - the scoring drop - which
   is what the music has been waiting for.

   Only counts AFTER the coin has landed. Before that the coin is still in the
   chute and anything going over is the pusher finishing what it was already
   doing, with nothing to do with this drop at all. */
function noteDelivery() {
  if (!resolving || !landedStep) return;
  /* Not if the pusher had this one queued up before the coin even arrived -
     see arming.deliveryIgnoreStrokes. */
  const settle = CFG.arming.deliveryIgnoreStrokes *
                 (CFG.shelf.periodMs / 1000) / PHY.timestep;
  if (stepCount - landedStep < settle) return;
  endResolve();
}

export function armedZoneIndex() { return armedZone; }

export function dropInto(zone) {
  const z = Math.max(0, Math.min(DIMS.zoneCount - 1, zone | 0));
  const jitter = (Math.random() * 2 - 1) * DIMS.D * CFG.chute.entryJitterInCoins;

  const item = createItem(
    ctx, nextDropType(),
    DIMS.zoneCentresX[z] + jitter,
    DIMS.chuteTop - DIMS.D * CFG.chute.entryHeightInCoins,
    DIMS.panelZ,
    0,
    { quat: quatOnEdge(Math.random() * Math.PI * 2), ccd: true }
  );

  /* Sideways kick on entry: see chute.entrySpeedInCoins. Without it the coin
     falls dead vertical and balances on the first peg it meets. */
  const kick = DIMS.D * CFG.chute.entrySpeedInCoins;
  item.body.setLinvel({
    x: (Math.random() * 2 - 1) * kick,
    y: -kick * 0.15,
    z: 0
  }, true);
  item.body.setAngvel({
    x: 0, y: 0,
    z: (Math.random() * 2 - 1) * DIMS.D * CFG.chute.entrySpinInCoins
  }, true);

  item.dropStep = stepCount;
  item.dropZone = z;
  M.dropped++;
  return item;
}

/* Time each dropped item from entering the chute to clearing it, and note
   where it came out. A coin still in there after ten seconds is jammed, which
   is a fact about the peg spacing and wants knowing about. */
function trackChute() {
  for (let i = 0; i < ctx.items.length; i++) {
    const it = ctx.items[i];
    if (it.dropStep === undefined) continue;
    const t = it.body.translation();
    if (t.y < DIMS.chuteBottom) {                 // clear of the chute
      /* Count on a counter, never on the length of a rolling window - push()
         caps its arrays, so array length silently stops growing and every
         later success reads as a failure. That cost an hour of chasing a
         50%% jam rate that did not exist. */
      M.landed++;
      push(M.fallSteps, stepCount - it.dropStep);
      push(M.landX, t.x - DIMS.zoneCentresX[it.dropZone]);
      it.dropStep = undefined;
    } else if (stepCount - it.dropStep > 600) {
      M.jammed++;
      it.dropStep = undefined;
    }
  }
}

/* -------------------------------------------------------------------------
   UNJAM THE CHUTE

   Slide a coin off a peg it has become impaled on. See chute.unjam in config
   for the mechanism and for the list of physics settings that were measured
   NOT to fix it - it is geometry, not friction and not sleep, so no amount of
   tuning will ever undo it and it has to be undone by hand.

   Horizontally, because horizontal is the one direction that is not blocked:
   the shortest way out of the overlap is sideways along z, and the chute
   glass and back panel are exactly there.
   ------------------------------------------------------------------------- */
function unjamChute() {
  const U = CFG.chute.unjam;
  if (!U || !U.enabled || !ctx.pegPositions) return;

  const slop = DIMS.D * U.slopInCoins;

  for (let i = 0; i < ctx.items.length; i++) {
    const it = ctx.items[i];

    const b = it.body;
    const t = b.translation();
    /* Position, NOT dropStep. trackChute clears dropStep once a coin has been
       up here for 600 steps, to stop it counting the same jam forever - so
       keying off dropStep meant this pass gave up on exactly the coins that
       most needed it, the moment they were declared jammed. */
    if (t.y <= DIMS.chuteBottom) { it.stuckSteps = 0; it.unjamTries = 0; continue; }

    const v = b.linvel();
    if (Math.hypot(v.x, v.y, v.z) > U.stuckSpeed) { it.stuckSteps = 0; continue; }

    it.stuckSteps = (it.stuckSteps || 0) + 1;
    if (it.stuckSteps < U.stuckSteps) continue;

    /* Which peg is inside it? The coin falls face-on, so the test is a flat
       circle-in-circle one in the x-y plane; the peg spans the whole depth so
       z never enters into it. */
    const d = DIMS.itemDims(it.typeId);
    const need = d.radius + DIMS.pegRadius;

    let freed = false;
    for (let p = 0; p < ctx.pegPositions.length; p++) {
      const peg = ctx.pegPositions[p];
      const dx = t.x - peg.x, dy = t.y - peg.y;
      if (Math.abs(dx) > need || Math.abs(dy) > need) continue;
      if (dx * dx + dy * dy >= need * need) continue;

      /* Horizontal distance that clears the peg at this height. If the peg
         sits above or below the coin's centre by more than the clearance
         needed, any sideways move at all frees it. */
      const span = need * need - dy * dy;
      const outX = span > 0 ? Math.sqrt(span) : 0;
      const dir  = dx >= 0 ? 1 : -1;

      b.setTranslation({ x: peg.x + dir * (outX + slop), y: t.y, z: t.z }, true);
      /* A touch of downward speed so it resumes falling rather than hanging
         where it was put. */
      b.setLinvel({ x: dir * 0.15, y: -0.3, z: 0 }, true);
      b.setAngvel({ x: 0, y: 0, z: 0 }, true);
      b.wakeUp();
      it.stuckSteps = 0;
      M.unjammed++;
      freed = true;
      break;
    }

    /* Nothing impaling it, and it is still not moving. Coins can also ARCH -
       two or three of them bridging a gap, each holding the others up, which
       is how grain bridges in a silo and how this jams in a corner. The peg
       spacing rule should have removed the places that can happen, but an
       arch needs no peg at all, so this is the catch-all: shove it and let
       the pile fall in on itself.

       Deliberately weak and sideways-biased. It only has to break the
       symmetry an arch depends on; anything stronger would fling coins around
       the chute and be far more obvious than the jam it is fixing. */
    if (!freed && it.stuckSteps >= U.stuckSteps + U.archExtraSteps) {
      /* MOVE it, do not push it. This is the same lesson as the impalement
         above and it was learned twice: a wedged coin does not respond to
         velocity at all. Measured on real survivors, the earlier version set
         a velocity and escalated the strength, and coins sat through 28, 33
         and 34 attempts without shifting by so much as a millimetre. Geometry
         does not care how hard you push at it.

         So displace it bodily: mostly downward, since an arch is broken by
         dropping one of its stones below the line, with a sideways component
         that alternates each attempt so a coin that needs to go the other way
         gets a turn. Escalating, because the first move is deliberately small
         - almost every arch gives at the first touch, and a big jump is far
         more visible than the jam it fixes. */
      it.unjamTries = (it.unjamTries || 0) + 1;
      const scale = Math.min(U.nudgeMaxScale, 1 + (it.unjamTries - 1) * 0.6);
      const side  = (it.unjamTries % 2 ? 1 : -1) * (t.x >= 0 ? -1 : 1);
      const step  = DIMS.D * U.archStepInCoins * scale;

      b.setTranslation({ x: t.x + side * step * 0.8,
                         y: t.y - step,
                         z: t.z }, true);
      b.setLinvel({ x: side * 0.1, y: -0.3, z: 0 }, true);
      b.setAngvel({ x: 0, y: 0, z: 0 }, true);
      b.wakeUp();
      it.stuckSteps = 0;
      M.unjammed++;
    }
  }
}

/* Hold resting coins still. See physics.rest in config for why this exists
   and why it is a game rule rather than a physics tweak.

   Runs immediately after world.step, so it corrects that step's result before
   anything else looks at it. */
function holdAtRest() {
  const R = PHY.rest;
  if (!R || !R.enabled) return;

  const deadzone = DIMS.D * R.deadzoneInCoins;
  const pinBelow = DIMS.D * R.pinBelowInCoins;
  M.parked = 0;

  for (let i = 0; i < ctx.items.length; i++) {
    const it = ctx.items[i];
    const b = it.body;
    const t = b.translation();

    /* Never touch a coin still in the chute. dropStep is set when it enters
       and cleared when it clears the bottom, so this is exact rather than a
       guess at a region.

       Pinning these was a disaster: a coin slowing at the top of a bounce, or
       glancing a peg, fell under the deadzone, got pinned with its velocity
       zeroed, and had to build the whole fall up again. It jammed 16 drops in
       18. Falling is the one time a coin is SUPPOSED to move on its own. */
    if (it.dropStep !== undefined || b.linvel().y < -R.fallSpeed) {
      it.restRef = null;
      it.restQuiet = 0;
      it.restLast = { x: t.x, y: t.y, z: t.z };
      continue;
    }

    if (it.restRef) {
      /* Accumulate what the solver WANTED, measured from the same pinned pose
         every step. A push adds up in one direction; jitter cancels. */
      it.restWant.x += t.x - it.restRef.x;
      it.restWant.y += t.y - it.restRef.y;
      it.restWant.z += t.z - it.restRef.z;

      if (Math.hypot(it.restWant.x, it.restWant.y, it.restWant.z) > deadzone) {
        it.restRef = null;          // a real push - hand the coin back and
        it.restQuiet = 0;           // keep the motion it just made
        it.restLast = { x: t.x, y: t.y, z: t.z };
        continue;
      }

      b.setTranslation(it.restRef, false);
      b.setRotation(it.restRot, false);
      b.setLinvel(ZERO, false);
      b.setAngvel(ZERO, false);
      M.parked++;
      continue;
    }

    /* Only pin a coin that has been moving too little to be pushed.

       This gate is set from measurement, not taste. Per step, jitter at rest
       is under 0.0082 of a coin at the 99th percentile, while a coin riding
       the deck moves 0.0153 - the deck's own speed. Anything between the two
       separates them cleanly.

       Without it the clamp pins coins that ARE being pushed. They then cannot
       ride the deck, the pile stops advancing, and the machine runs BACKWARDS:
       measured, creep went to -0.022 a stroke against +0.009, and delivery
       fell from 6.5 coins a stroke to 0.8. */
    const last = it.restLast;
    const step = last
      ? Math.hypot(t.x - last.x, t.y - last.y, t.z - last.z)
      : Infinity;
    it.restLast = { x: t.x, y: t.y, z: t.z };
    it.restQuiet = step < pinBelow ? (it.restQuiet || 0) + 1 : 0;

    if (it.restQuiet >= R.pinSteps) {
      const q = b.rotation();
      it.restRef = { x: t.x, y: t.y, z: t.z };
      it.restRot = { x: q.x, y: q.y, z: q.z, w: q.w };
      it.restWant = { x: 0, y: 0, z: 0 };
    }
  }
}

const ZERO = { x: 0, y: 0, z: 0 };

/* The static friction Rapier's contact model does not have.

   A contact resists SLIDING but not SPINNING. A disc lying flat can therefore
   rotate about its own axis with nothing to stop it, and any stray torque from
   the contact solve spins it up and stays there. Measured on a settled pile
   with the machine switched off, over ten seconds: the median coin walked a
   third of a diameter while ending up where it started, and turned 53 degrees;
   the worst turned 1188 degrees - over three full revolutions - while moving
   almost nowhere. Not one coin in sixty-one was still. That is the fidgeting.

   Real coins do not do this: the friction that stops a spun coin on a table is
   exactly the torsional friction the solver is missing.

   Coulomb, not damping. Damping scales with speed, so it decays a spin towards
   zero without ever arriving and cannot beat a torque that is re-applied every
   step. This removes a FIXED amount of angular speed per step, so a spin
   actually stops - which is how dry friction behaves.

   Coins still in the chute are exempt: they are meant to tumble off the pegs,
   and that is what makes a drop unpredictable. */
/* Hard separation: coins are solid and may not occupy the same space.

   The solver permits overlap - it is a soft-contact engine, it resolves
   penetration over time rather than forbidding it, and under a pile being
   pushed it never catches up. Measured, a settled pile still had a pair
   overlapping by 65% of a diameter and one pushed pile reached 96%: two coins
   very nearly in the same place.

   So this is a constraint rather than a force. After the solver has run, any
   two coins that are closer vertically than their combined half-thickness AND
   overlapping in plan are pushed apart in the horizontal plane until their
   rims touch. Horizontally, not along the shortest escape: the shortest escape
   is usually vertical, which would lift a coin into the air to fall back next
   step, whereas sliding apart is stable under gravity.

   Position only - velocities are left alone for the solver to sort out, so
   this adds no energy.

   Restricted to coins lying flat: for a tilted coin the disc-versus-disc test
   below is not its shape, and correcting it would be guesswork. Coins in the
   chute are exempt, being held on edge between the glass and the panel. */
/* Put settled coins to sleep.

   This is what every other physics game does and what this one was missing.
   Rapier sleeps bodies by ISLAND: every coin touching every other forms one
   island, so a single lively coin anywhere keeps the whole pile awake, and the
   pile is never completely still - the solver's own residual sees to that. So
   the pile buzzed forever.

   Sleeping each coin on its own merits fixes that. A sleeping body is skipped
   by the solver entirely: it cannot drift, buzz or creep. It is not frozen -
   Rapier wakes it the moment something touches it, which was the thing worth
   checking before building this: with the shelf running, 51 of 62 slept coins
   woke inside three quarters of a second, and the rest as the shelf reached
   them.

   A coin is only allowed to sleep once it is genuinely still AND not
   overlapping anything, so a sleeping coin can never lock in a penetration. */
const RAY = { origin: { x: 0, y: 0, z: 0 }, dir: { x: 0, y: -1, z: 0 } };

/* Zero the residual of already-resting coins BEFORE the step, not after.

   This is the piece that lets a pile actually fall asleep. Rapier decides
   whether a body may sleep from the velocities it sees DURING its own step, so
   tidying up afterwards - which is what everything else here does - never
   reaches the decision. The body starts each step carrying a hair of solver
   noise, that noise is what the sleep test measures, and the timer resets
   forever. Sleeping is island-wide, so one such coin keeps sixty awake.

   Zeroing first costs nothing real: the thresholds are Rapier's own, so this
   is motion the engine already counts as rest. Anything falling, in the chute,
   or being pushed apart is left alone. */
function quietenBeforeStep() {
  const S = PHY.staticFriction;
  if (!S || !S.enabled || !S.quietenBeforeStep) return;

  for (let i = 0; i < ctx.items.length; i++) {
    const it = ctx.items[i];
    if (it.dropStep !== undefined) continue;
    if (it.sepMoved === stepCount - 1) continue;

    const b = it.body;
    if (b.isSleeping()) continue;

    const v = b.linvel();
    if (v.y < -S.fallSpeed) continue;

    const w = b.angvel();
    if (Math.hypot(v.x, v.y, v.z) < S.restLinear &&
        Math.hypot(w.x, w.y, w.z) < S.restAngular) {
      b.setLinvel(ZERO, false);
      b.setAngvel(ZERO, false);
    }
  }
}

function sleepSettled() {
  const S = PHY.sleep;
  if (!S || !S.enabled) return;

  M.asleep = 0;

  for (let i = 0; i < ctx.items.length; i++) {
    const it = ctx.items[i];
    const b = it.body;

    if (b.isSleeping()) { M.asleep++; it.quiet = 0; continue; }
    if (it.dropStep !== undefined) { it.quiet = 0; continue; }   // in the chute
    /* Some types are never put to sleep - see itemTypes.present.neverSleeps.
       Rapier's own island sleeping is turned off for them at creation; this
       is the other half, so nothing here forces one down either. */
    const ty = CFG.itemTypes[it.typeId];
    if (ty && ty.neverSleeps) { it.quiet = 0; continue; }

    const v = b.linvel();
    const w = b.angvel();
    const still = Math.hypot(v.x, v.y, v.z) < S.linear &&
                  Math.hypot(w.x, w.y, w.z) < S.angular;

    /* Still being separated from a neighbour? Then it is not settled. */
    if (it.sepMoved === stepCount) { it.quiet = 0; continue; }

    it.quiet = still ? (it.quiet || 0) + 1 : 0;
    if (it.quiet < S.steps) continue;

    /* It must be RESTING ON SOMETHING. A sleeping body is skipped by the
       solver, so one put to sleep in mid-air hangs there - and that is exactly
       what happened: coins on their way over the lip were slept as they tipped
       and stopped dead below the floor, five of them in one run, while the
       pile lost sixteen coins and buzzed nine times worse.

       A short ray straight down settles it. Cheap, because it is only cast for
       a coin that has already been still for a third of a second. */
    const d = DIMS.itemDims(it.typeId);
    const t = b.translation();
    RAY.origin.x = t.x; RAY.origin.y = t.y; RAY.origin.z = t.z;
    const hit = ctx.world.castRay(RAY, d.halfHeight * S.supportReach, true,
                                  undefined, undefined, b.collider(0), b);
    if (!hit) { it.quiet = 0; continue; }

    b.sleep();
    M.asleep++;
  }
}

function separateCoins() {
  const S = PHY.separate;
  if (!S || !S.enabled) return;

  const cand = sepScratch;
  cand.length = 0;

  for (let i = 0; i < ctx.items.length; i++) {
    const it = ctx.items[i];
    if (it.dropStep !== undefined) continue;
    const q = it.body.rotation();
    if (Math.abs(1 - 2 * (q.x * q.x + q.z * q.z)) < S.flatAbove) continue;
    const d = DIMS.itemDims(it.typeId);
    const t = it.body.translation();
    cand.push({ it: it, x: t.x, y: t.y, z: t.z, r: d.radius, h: d.halfHeight,
                fixed: it.body.isSleeping() });
  }

  const maxPush = DIMS.D * S.maxPerStepInCoins;

  /* Slop: penetration this small is left alone.

     Without it the pass fights the solver every step. A resting contact always
     carries a little penetration - that is how a soft-contact engine holds
     things up - so correcting to EXACTLY touching means gravity puts it back
     next step and the pass lifts it again, sixty times a second. Measured on a
     stacked pair: the gap sat at a perfect 1.000 thickness while the coin
     travelled 0.18 of a diameter up and down every second. That is the
     shaking.

     Set above the solver's own resting penetration and nothing fights. */
  /* The slop is in DIAMETERS, and it is large on purpose.

     This pass nudges coins, and a nudged coin cannot fall asleep. Rapier's own
     sleeping is what actually stills the pile - measured, with this pass off
     30.8 coins were asleep and 54 of 62 perfectly still; with it firing on
     every marginal overlap only 10.5 slept and 44.7 were still. Correcting
     overlaps too small to see was buying nothing and costing the sleep that
     matters.

     So it only fires on overlaps big enough to look wrong, resolves those, and
     gets out of the way. */
  const slop = DIMS.D * S.slopInDiameters;

  for (let pass = 0; pass < S.iterations; pass++) {
    let moved = false;

    for (let i = 0; i < cand.length; i++) {
      const a = cand[i];
      for (let j = i + 1; j < cand.length; j++) {
        const b = cand[j];

        /* Only pairs at ROUGHLY THE SAME HEIGHT.

           Height is the discriminator, not distance in plan. Two coins side by
           side with their discs crossing is the fault that looks wrong - the
           bite out of a coin. Two coins one on top of the other also overlap
           in plan, but that is simply what a stack IS.

           Stacked pairs are left to the solver, which handles a face-to-face
           contact well. Correcting them is what made stacks shake: the pass
           lifts the top coin to exactly touching, gravity restores the resting
           penetration the engine needs to hold it up, and the pass lifts it
           again, sixty times a second. Measured on a stacked pair, up-and-down
           travel went from 0.12 of a diameter a second with the pass off to
           0.15 correcting vertically, and 0.20 with a slop added - the wrong
           direction every time. Skipping them entirely gives 0. */
        if (Math.abs(a.y - b.y) >= (a.h + b.h) * S.sameHeightBelow) continue;

        let dx = a.x - b.x, dz = a.z - b.z;
        let dh = Math.hypot(dx, dz);
        const minH = a.r + b.r;
        const overlapH = minH - dh - slop;
        if (overlapH <= 0) continue;                       // rims already clear

        /* Dead centre on each other: no direction to separate along, so pick
           one from the index. Deterministic, so a replay stays a replay. */
        if (dh < 1e-6) { dx = Math.cos(i * 2.399); dz = Math.sin(i * 2.399); dh = 1; }

        /* A sleeping coin has settled and must not be shoved; it acts as an
           obstacle and the awake one takes the whole correction. Two sleeping
           coins are left entirely alone - they were separated before they were
           allowed to sleep. */
        if (a.fixed && b.fixed) continue;

        const share = (a.fixed || b.fixed) ? 1.0 : 0.5;
        const push = Math.min(overlapH * share * S.strength, maxPush);
        const ux = dx / dh, uz = dz / dh;
        if (!a.fixed) { a.x += ux * push; a.z += uz * push; }
        if (!b.fixed) { b.x -= ux * push; b.z -= uz * push; }
        moved = true;
      }
    }
    if (!moved) break;
  }

  for (let i = 0; i < cand.length; i++) {
    const c = cand[i];
    if (c.fixed) continue;
    const t = c.it.body.translation();
    if (Math.abs(t.x - c.x) > 1e-9 ||
        Math.abs(t.y - c.y) > 1e-9 ||
        Math.abs(t.z - c.z) > 1e-9) {
      c.it.body.setTranslation({ x: c.x, y: c.y, z: c.z }, false);
      /* Still being pushed out of something, so not allowed to sleep yet - a
         coin that slept here would lock its overlap in permanently. */
      c.it.sepMoved = stepCount;
    }
  }
}

const sepScratch = [];

function settleContacts() {
  const S = PHY.staticFriction;
  if (!S || !S.enabled) return;

  const spinDrop   = S.spinRate   * PHY.timestep;  // rad/s shed per step
  const slideDrop  = S.slideRate  * PHY.timestep;  // units/s shed per step
  const bounceDrop = (S.bounceRate || 0) * PHY.timestep;  // vertical only

  for (let i = 0; i < ctx.items.length; i++) {
    const it = ctx.items[i];
    const b = it.body;

    /* Exempt anything that is meant to be moving under its own weight: coins
       in the chute, which have to tumble off the pegs, and anything in free
       fall. Only downward speed counts - buzzing is random in direction and
       never sustains a fall. */
    if (it.dropStep !== undefined) continue;
    const v = b.linvel();
    if (v.y < -S.fallSpeed) continue;

    /* Only the spin about the coin's OWN AXIS - the record-player motion.

       Torsional friction acts about the contact normal, and for a coin lying
       on a face that is the coin's own normal. Rotation about any other axis
       is TUMBLING, which real friction barely touches.

       The first version damped all three axes, and that was wrong twice over:
       unphysical, and it stopped coins tipping as they went over the shelf
       edge, so they landed on their rims instead of falling flat. */
    const w = b.angvel();
    const q = b.rotation();
    const nx = 2 * (q.x * q.y + q.w * q.z);
    const ny = 1 - 2 * (q.x * q.x + q.z * q.z);
    const nz = 2 * (q.y * q.z - q.w * q.x);

    /* Only while the coin is lying FACE DOWN. Torsional friction belongs to a
       face contact; a coin on its rim contacts along its edge, and its own
       axis is then horizontal, so damping about it would stop the coin ROLLING
       - which is precisely how an edge-landed coin topples flat. Measured, not
       reasoned after the fact: without this gate 4.5% of the field ended up on
       edge against 1.7% with no spin friction at all. */
    /* ROCKING. A coin tilting back and forth on an uneven support - the rim
       of another coin, or two coins with a dip between them - is the last
       thing left moving in a settled pile. Measured: of 51 coins only 4 still
       moved, and 88% of their motion was vertical while they turned between
       120 and 580 degrees in ten seconds. That is a rock, not a spin and not a
       slide.

       Spin friction above only damps rotation about the coin's OWN axis, so
       tumbling stays free and coins can still tip off the shelf. But rocking
       is rotation about a HORIZONTAL axis, so nothing touched it. Real
       friction stops a rocking coin quickly.

       Damped only while the coin is resting on something, so a coin in the air
       still tumbles freely. The ray is cheap: it is only cast for a coin that
       is already moving slowly. */
    const speedNow = Math.hypot(v.x, v.y, v.z);
    if (S.rockRate > 0 && speedNow < S.restLinear * S.rockSpeedFactor) {
      const t = b.translation();
      RAY.origin.x = t.x; RAY.origin.y = t.y; RAY.origin.z = t.z;
      const d2 = DIMS.itemDims(it.typeId);
      if (ctx.world.castRay(RAY, d2.halfHeight * 1.6, true,
                            undefined, undefined, b.collider(0), b)) {
        const rockDrop = S.rockRate * PHY.timestep;
        const spinAll = Math.hypot(w.x, w.y, w.z);
        if (spinAll > 1e-9) {
          if (spinAll <= rockDrop) {
            b.setAngvel(ZERO, false);
          } else {
            const k = (spinAll - rockDrop) / spinAll;
            b.setAngvel({ x: w.x * k, y: w.y * k, z: w.z * k }, false);
          }
        }
      }
    }

    const along = w.x * nx + w.y * ny + w.z * nz;
    const mag = Math.abs(along);
    if (mag > 1e-9 && Math.abs(ny) > S.faceDownAbove) {
      const shed = Math.min(mag, spinDrop) * (along > 0 ? -1 : 1);
      b.setAngvel({
        x: w.x + shed * nx,
        y: w.y + shed * ny,
        z: w.z + shed * nz
      }, false);
    }

    /* Anti-bounce, on the VERTICAL only.

       The coins that still buzz are the ones stacked on other coins, and 80%
       of their motion is up and down: a coin resting on another coin is a
       dynamic-against-dynamic contact that can hold a limit cycle, where a
       coin on the fixed floor cannot. Rapier's soft contacts expose their
       natural frequency but not their damping ratio, so the springiness
       cannot be taken out through the engine.

       Vertical only, and that is the point: the pusher moves coins along z,
       so bleeding y costs the machine nothing. */
    let vy = v.y;
    if (bounceDrop > 0 && vy > -S.fallSpeed) {
      if (Math.abs(vy) <= bounceDrop) vy = 0;
      else vy -= Math.sign(vy) * bounceDrop;
      b.setLinvel({ x: v.x, y: vy, z: v.z }, false);
    }

    /* Deadband: a coin already slower than the engine would call "at rest"
       is stopped dead.

       This is the piece that lets the pile SLEEP. Rapier sleeps by island, and
       an island only sleeps once every body in it has stayed under the
       threshold continuously - so a single coin carrying a hair of residual
       velocity keeps sixty others awake, forever. The residual is solver noise
       that never quite decays, so the pile hovers just under the bar and never
       crosses it.

       Below the engine's own threshold there is nothing to lose: it already
       considers this motion to be rest. Zeroing it is what turns "nearly
       asleep" into asleep. A coin being separated from a neighbour, falling,
       or in the chute is excluded above, so nothing that should be moving is
       stopped. */
    if (it.sepMoved !== stepCount) {
      const speed = Math.hypot(v.x, vy, v.z);
      const spinAll = Math.hypot(w.x, w.y, w.z);
      if (speed < S.restLinear && spinAll < S.restAngular) {
        b.setLinvel(ZERO, false);
        b.setAngvel(ZERO, false);
        continue;
      }
    }

    const slide = Math.hypot(v.x, vy, v.z);
    if (slideDrop > 0 && slide > 1e-9) {
      if (slide <= slideDrop) {
        b.setLinvel(ZERO, false);
      } else {
        const k = (slide - slideDrop) / slide;
        b.setLinvel({ x: v.x * k, y: vy * k, z: v.z * k }, false);
      }
    }
  }
}

function physicsStep() {
  if (running) {
    const prev = phase;
    phase = (phase + (PHY.timestep * 1000) / CFG.shelf.periodMs) % 1;
    driveShelves(ctx, phase);

    /* A kinematic deck cannot move a sleeping body. */
    if (PHY.wakeAllWhileRunning) {
      for (let i = 0; i < ctx.items.length; i++) ctx.items[i].body.wakeUp();
    }

    if (M.atForward === null) M.atForward = centroidZ();

    /* Sample the pile at each end of the stroke. 0 -> 0.5 is the deck
       withdrawing, 0.5 -> 1 is it advancing. */
    if (prev < 0.5 && phase >= 0.5) {
      const c = centroidZ();
      if (M.atForward !== null && c !== null) push(M.retract, c - M.atForward);
      M.atBack = c;
    }
    if (phase < prev) {                              // wrapped past 0
      const c = centroidZ();
      if (M.atBack !== null && c !== null) push(M.extend, c - M.atBack);
      if (M.atForward !== null && c !== null) push(M.creep, c - M.atForward);
      M.atForward = c;
      M.strokes++;
    }
  }

  M.soundedThisStep.length = 0;
  quietenBeforeStep();
  captureImpactSpeeds();
  ctx.world.step(ctx.eventQueue);
  stepCount++;
  soundContacts();
  soundCollisions();
  settleContacts();
  M.lifted += liftTrapped(ctx);
  separateCoins();
  sleepSettled();
  /* AFTER the guard, not before. The guard teleports items, and a coin pinned
     by the clamp would otherwise be dragged straight back to where the guard
     just moved it from. Run last and a guard move reads as a large jump, which
     releases the coin, which is what should happen. */
  holdAtRest();
  trackChute();
  unjamChute();
  collectFallen();
  tickArming();
  tickFlash();
  /* Driven from the step, not the render loop, because the transitions are
     timed in stepCount like everything else here. Keeping them on the render
     loop would have them advancing on a different clock to the state that
     triggers them, and would leave them frozen in any situation where physics
     runs without painting. */
  tickLights();
}

/* -------------------------------------------------------------------------
   CONTACT SOUNDS

   Rapier reports a force magnitude per contact, which is what decides how
   hard a hit sounds. Three limits sit between that and the speaker, because
   a coin bouncing through the peg field registers several contacts inside a
   single visible hop and playing them all machine-guns:

     1. the engine's own threshold, set on the peg colliders - the cheapest,
        because it never crosses into JavaScript
     2. a per-coin cooldown, so one coin cannot sound twice in quick
        succession however many contacts it generates
     3. a per-step budget, loudest first, so one busy moment cannot drown
        everything else

   Pan follows the coin across the machine, which costs nothing and makes the
   drop field feel wide.
   ------------------------------------------------------------------------- */
/* How fast every coin is travelling going INTO the step.

   A collision event says two things touched, not how hard. By the time the
   event is drained the solver has already absorbed the impact and the coin's
   velocity reads near zero - so the speed has to be taken before the step or
   every landing sounds identically feeble. */
function captureImpactSpeeds() {
  if (!CFG.audio || !CFG.audio.enabled) return;
  for (let i = 0; i < ctx.items.length; i++) {
    const it = ctx.items[i];
    const v = it.body.linvel(), w = it.body.angvel();
    if (!it.preVel) it.preVel = { x: 0, y: 0, z: 0, wx: 0, wy: 0, wz: 0 };
    it.preVel.x = v.x; it.preVel.y = v.y; it.preVel.z = v.z;
    it.preVel.wx = w.x; it.preVel.wy = w.y; it.preVel.wz = w.z;

    /* THE RUN-UP: a decaying peak of how fast this coin has actually been
       going. Not the same thing as impactOf, which measures the CHANGE at the
       moment of contact, and that difference is the whole point.

       A coin at rest in the pile still gets nudged by the solver, the shapes
       separate and re-touch by microns, and the velocity change spikes enough
       to look like a hit. What it never has is speed sustained over the steps
       leading up to it. A coin that fell down the chute does.

       Absolute speed is deliberately NOT used on its own - see impactOf for
       why that was wrong. This is an extra condition alongside the impact
       test, not a replacement for it, so a coin being carried along by the
       deck still stays silent: it is moving, but nothing is happening to it. */
    const speed = Math.hypot(v.x, v.y, v.z);
    const rim = Math.hypot(w.x, w.y, w.z) *
                (it.dims && it.dims.radius ? it.dims.radius : DIMS.D * 0.5);
    it.runUp = Math.max(Math.max(speed, rim),
                        (it.runUp || 0) * CFG.audio.runUpDecay);
  }
}

/* How much speed the step took away from a coin - the size of the impact,
   not how fast the coin happens to be going.

   Absolute speed was the obvious measure and it was wrong. A coin riding the
   moving deck travels faster than any sensible landing threshold, so every
   contact it started while being shoved along fired a sound: measured, eight
   seconds of the pusher running with nothing dropped produced 38 of them,
   about five a second of pure noise.

   A coin sliding along with the deck has its velocity unchanged by the step,
   so this reads near zero. A coin that lands has its fall stopped dead, so it
   reads large. That is the difference between being carried and being hit. */
function impactOf(it) {
  if (!it.preVel) return 0;
  const v = it.body.linvel();
  const lin = Math.hypot(v.x - it.preVel.x, v.y - it.preVel.y, v.z - it.preVel.z);

  /* ROTATION COUNTS TOO, and leaving it out is why a coin toppling flat under
     the pusher was silent.

     A coin falling flat barely moves its centre - it pivots on its rim and
     slaps its face down. The centre's velocity hardly changes, so a purely
     linear measure reads it as nothing at all, while the part that actually
     hits the surface is travelling fast. Scale the change in spin by the
     radius and it becomes what the rim is doing, in the same units, and the
     slap reads as the hit it is. */
  const w = it.body.angvel();
  const spin = Math.hypot(w.x - it.preVel.wx, w.y - it.preVel.wy, w.z - it.preVel.wz);
  const rim = spin * (it.dims && it.dims.radius ? it.dims.radius : DIMS.D * 0.5);

  return Math.max(lin, rim);
}

function soundContacts() {
  const A = CFG.audio;
  if (!A || !A.enabled || !audioReady()) { ctx.eventQueue.clear(); return; }

  const hits = [];
  ctx.eventQueue.drainContactForceEvents(function (e) {
    const h1 = e.collider1(), h2 = e.collider2();
    const pegIsFirst = ctx.pegColliders.has(h1);
    if (!pegIsFirst && !ctx.pegColliders.has(h2)) return;
    const other = ctx.world.getCollider(pegIsFirst ? h2 : h1);
    if (!other) return;
    const body = other.parent();
    if (!body) return;
    hits.push({ handle: body.handle, force: e.totalForceMagnitude(),
                x: body.translation().x });
  });
  if (!hits.length) return;

  hits.sort(function (a, b) { return b.force - a.force; });

  const now = performance.now();
  const half = DIMS.width * 0.5;
  let played = 0;
  for (let i = 0; i < hits.length && played < A.perFrameBudget; i++) {
    const h = hits[i];
    if (!coinReady(h.handle, now)) continue;
    const energy = Math.min(1, h.force / A.pegForceForFullHit);
    if (play('peg', energy, half > 0 ? h.x / half : 0)) played++;
  }
  M.pegHits += played;
}

/* -------------------------------------------------------------------------
   SURFACE AND COIN-ON-COIN SOUNDS

   Everything a coin can strike except a peg: the moving deck, the fixed
   floor, the side walls, the chute glass, and other coins. One sound for all
   of them.

   Driven by collision-STARTED events, so a coin that is merely resting on the
   pile is silent - see the note in items.js on why force events are wrong
   here. Loudness comes from the speed captured before the step.
   ------------------------------------------------------------------------- */
function soundCollisions() {
  const A = CFG.audio;
  if (!A || !A.enabled || !audioReady()) return;

  const byCollider = new Map();
  for (let i = 0; i < ctx.items.length; i++) {
    byCollider.set(ctx.items[i].body.collider(0).handle, ctx.items[i]);
  }

  /* 1. A contact start OPENS a window; it does not decide anything.

     Scoring the hit on the step the contact starts was wrong, and it is why a
     coin toppling flat under the pusher made no sound. Contact starts the
     instant the rim first grazes, and at that instant almost nothing has
     happened yet - measured over 83 real impacts, the median velocity change
     on the starting step was 0.163, under the threshold, while the actual
     slap peaked at 1.85 a median of one step later. Only 30 of the 83 were
     already loud when their contact began; 53 arrived afterwards. */
  ctx.eventQueue.drainCollisionEvents(function (h1, h2, started) {
    if (!started) return;
    /* Pegs have their own, louder voice and their own event stream. Without
       this a coin striking one plays both sounds on the same frame. */
    if (ctx.pegColliders.has(h1) || ctx.pegColliders.has(h2)) return;

    const a = byCollider.get(h1), b = byCollider.get(h2);

    /* Struck the chute's chrome - a divider between the entry slots, or one
       of the outer walls, which is the same part. That is polished metal, the
       same as a peg, so it takes the peg's voice. Scored the same way as any
       other surface hit; only the sample differs. */
    const metal = A.dividerUsesPegSound && ctx.metalColliders &&
                  (ctx.metalColliders.has(h1) || ctx.metalColliders.has(h2));

    /* BOTH sides being items means coin on coin; one side means coin on a
       surface - the deck, the floor, a wall. Recorded on the window so the
       two can be counted, and told apart, when the sound is finally played. */
    const coinOnCoin = !!(a && b);
    if (coinOnCoin) M.coinOnCoin++; else M.coinOnSurface++;

    if (a) {
      if (!a.hitWindow) {
        a.hitWindow = { at: stepCount, peak: 0, voice: 'surface', pair: coinOnCoin };
      }
      if (metal) a.hitWindow.voice = 'peg';
    }
    if (b) {
      if (!b.hitWindow) {
        b.hitWindow = { at: stepCount, peak: 0, voice: 'surface', pair: coinOnCoin };
      }
      if (metal) b.hitWindow.voice = 'peg';
    }
  });

  /* 2. Follow each open window, and take the loudest moment in it. */
  const ready = [];
  for (let i = 0; i < ctx.items.length; i++) {
    const it = ctx.items[i];
    const win = it.hitWindow;
    if (!win) continue;

    const impact = impactOf(it);
    if (impact > win.peak) win.peak = impact;

    /* The fastest this coin has been through the window, so the test sees the
       approach rather than whatever it is doing after the bounce. */
    if ((it.runUp || 0) > (win.runUp || 0)) win.runUp = it.runUp || 0;

    /* A hard hit does not wait - it would be audibly late. Only the ones that
       start softly and bloom are held for the window to close. */
    const done = win.peak >= A.surfaceImmediateImpact ||
                 stepCount - win.at >= A.surfaceWindowSteps;
    if (!done) continue;

    it.hitWindow = null;
    if (win.peak < A.surfaceMinImpact) continue;
    /* Recorded whether or not it passes, so the two populations can be
       compared when this is tuned. */
    if (M.runUps.length < 4000) {
      M.runUps.push({ r: +(win.runUp || 0).toFixed(4), pair: !!win.pair });
    }
    if ((win.runUp || 0) < A.surfaceMinRunUp) { M.hushed++; continue; }

    /* COIN ON COIN ONLY WHILE SOMEBODY IS PLAYING.

       A resting pile is never quite still, and the contacts that survive
       every other filter are almost all coin against coin - measured, 96 per
       cent of them while the machine idles. Rather than hunt a threshold that
       tells a nudge from a landing, this asks whether anyone is listening
       for it: between turns, with no team lit, two coins touching is not an
       event and does not sound. Coin against a surface is unaffected, and so
       is everything during a turn. */
    if (win.pair && A.coinOnCoinNeedsTurn && teamHighlight < 0) {
      M.hushed++;
      continue;
    }
    ready.push({ handle: it.body.handle, speed: win.peak,
                 voice: win.voice || 'surface',
                 x: it.body.translation().x });
  }
  if (!ready.length) return;

  ready.sort(function (a, b) { return b.speed - a.speed; });

  const now = performance.now();
  const half = DIMS.width * 0.5;
  let played = 0, metalPlayed = 0;
  for (let i = 0; i < ready.length && played < A.surfacePerFrameBudget; i++) {
    const h = ready[i];
    if (!coinReady(h.handle, now)) continue;
    const energy = Math.min(1, h.speed / A.surfaceImpactForFullHit);
    if (play(h.voice, energy, half > 0 ? h.x / half : 0)) {
      played++;
      if (h.voice === 'peg') metalPlayed++;
      /* Which coin made the noise, for one step. Costs nothing and is the
         only way to answer "why did THAT not make a sound" without guessing -
         a question that already cost an hour of measuring the wrong thing. */
      M.soundedThisStep.push(h.handle);
    }
  }
  /* Counted under the voice that actually sounded, so the HUD does not claim
     a chrome divider was a surface hit. */
  M.surfaceHits  += played - metalPlayed;
  M.pegHits      += metalPlayed;
  M.dividerHits  += metalPlayed;
}

/* -------------------------------------------------------------------------
   Fixed 1/60 timestep. Tying physics to the render delta would make the
   machine behave differently on a 60Hz TV and a 144Hz laptop, and the shelf
   rhythm is something the host learns to time drops against.
   ------------------------------------------------------------------------- */
function frame(now) {
  requestAnimationFrame(frame);

  let dt = (now - last) / 1000;
  last = now;
  if (!isFinite(dt) || dt < 0) dt = 0;
  if (dt > 0.25) dt = 0.25;            // tab was backgrounded; do not catch up
  fps = fps * 0.9 + (1 / Math.max(dt, 1e-4)) * 0.1;

  acc += dt;
  let steps = 0;
  /* The measurement harness turns this off so it can own the step count.
     Without it a panel's own stepping is interleaved with the render loop's
     and every number it produces is measuring some other number of steps. */
  if (!autoStep) acc = 0;
  while (autoStep && acc >= PHY.timestep && steps < 5) {
    physicsStep();
    acc -= PHY.timestep;
    steps++;
  }

  syncMeshes();
  updateScoreboards();
  updateHud();
  /* Wall-clock, not the physics clock: the backdrop is decoration and should
     keep breathing while the machine is paused. */
  if (backdrop) backdrop.update(now / 1000, renderer.domElement.clientWidth,
                                             renderer.domElement.clientHeight);
  renderer.render(scene, camera);
}

/* -------------------------------------------------------------------------
   A resting pile in any rigid-body engine never goes perfectly still: the
   solver regenerates a little contact noise every step, and items sit awake
   creeping and rocking by amounts far too small to be real motion but easily
   big enough to see. Physics tuning got this down a long way and no further -
   damping made it worse, not better.

   So the last step is drawn, not simulated: an item's mesh only moves when
   the body has drifted a visible distance from where the mesh was LAST DRAWN.
   Comparing against the last drawn pose rather than the last frame matters -
   a slow genuine creep still accumulates past the threshold and updates, so
   nothing can drift away invisibly and then jump.

   This changes nothing about the simulation. It only declines to redraw
   movement too small to be movement.
   ------------------------------------------------------------------------- */
function syncMeshes() {
  const eps = PHY.renderDeadzone;
  const epsRot = PHY.renderDeadzoneAngle;

  for (let i = 0; i < ctx.items.length; i++) {
    const it = ctx.items[i];
    const t = it.body.translation();
    const r = it.body.rotation();

    const d = it.mesh.position;
    const moved = Math.abs(t.x - d.x) > eps ||
                  Math.abs(t.y - d.y) > eps ||
                  Math.abs(t.z - d.z) > eps;

    /* Dot product of the two orientations: 1 means identical. */
    const q = it.mesh.quaternion;
    const dot = Math.abs(q.x * r.x + q.y * r.y + q.z * r.z + q.w * r.w);
    const turned = dot < 1 - epsRot;

    if (!moved && !turned) continue;

    it.mesh.position.set(t.x, t.y, t.z);
    it.mesh.quaternion.set(r.x, r.y, r.z, r.w);
  }
  for (let i = 0; i < ctx.machine.shelves.length; i++) {
    const sh = ctx.machine.shelves[i];
    const t = sh.body.translation();
    sh.mesh.position.set(t.x, t.y, t.z);
  }
}

function fmt(v, dp) { return v === null ? '-' : v.toFixed(dp === undefined ? 4 : dp); }

function updateHud() {
  let awake = 0;
  for (let i = 0; i < ctx.items.length; i++) {
    if (!ctx.items[i].body.isSleeping()) awake++;
  }

  const creep = mean(M.creep), ret = mean(M.retract), ext = mean(M.extend);
  const per20 = M.strokes ? (M.fallen / M.strokes) * 20 : 0;

  hud.innerHTML =
    '<b>fps</b> ' + fps.toFixed(0) +
    ' &nbsp; <b>on shelf</b> ' + ctx.items.length +
    ' &nbsp; <b>awake</b> ' + awake +
    ' &nbsp; <b>stroke</b> ' + M.strokes +
    ' &nbsp; <b>' + (running ? 'RUNNING' : 'PAUSED') + '</b>' +
    '<br><b>creep/stroke</b> ' + fmt(creep) +
    ' &nbsp; <b>on return</b> ' + fmt(ret) +
    ' &nbsp; <b>on out-stroke</b> ' + fmt(ext) +
    ' &nbsp; (coin = ' + DIMS.D + ')' +
    '<br><b>fallen off</b> ' + M.fallen +
    ' &nbsp; <b>per 20 strokes</b> ' + per20.toFixed(1) +
    '<br><b>dropped</b> ' + M.dropped +
    /* So a silent machine can be told apart from a machine that is not
       detecting hits at all. */
    ' &nbsp; <b>peg snd</b> ' + M.pegHits +
    ' &nbsp; <b>surf snd</b> ' + M.surfaceHits +
    (M.unjammed ? ' &nbsp; <b>unjammed</b> ' + M.unjammed : '') +
    ' &nbsp; <b>through</b> ' + M.landed + '/' + M.dropped +
    ' &nbsp; <b>chute fall</b> ' + (mean(M.fallSteps) === null ? '-' :
        (mean(M.fallSteps) / 60).toFixed(2) + 's (' +
        ((mean(M.fallSteps) / 60) / (CFG.shelf.periodMs / 1000) * 100).toFixed(0) + '% of a stroke)') +
    ' &nbsp; <b>spread</b> ' + (M.landX.length < 2 ? '-' :
        (spread(M.landX) / DIMS.D).toFixed(2) + ' coins') +
    (M.jammed ? ' &nbsp; <b style="color:#ff6b6b">JAMMED ' + M.jammed + '</b>' : '') +
    '<br><span style="opacity:.55">SPACE run/pause &middot; S single step &middot; R reset &middot; ' +
    'presettle ' + presettleSteps + ' &middot; stroke ' + DIMS.stroke.toFixed(3) + '</span>';
}

/* The logo, as a plain image over the canvas.

   Deliberately NOT a textured plane in the scene. In the scene it would sit
   in the machine's world, so it would shift with the camera fit, take
   lighting it should not take, and cost a draw call with a transparent
   material. Over the canvas it is one image element the compositor handles.

   Placed entirely in CSS percentages, so it holds its position through every
   resize without any JavaScript running on resize. */
/* -------------------------------------------------------------------------
   THE RIGHT-HAND COLUMN: logo above, two score panels below.

   Built as ONE flex column so the panels are under the logo by construction at
   any shape of window. See rightColumn in config for the bug that made this
   necessary - the two were positioned independently, one off the window's
   width and one off its height, and slid into each other past an aspect ratio
   of about 1.37. Full screen is 2.05.

   Nothing here measures anything or runs on resize. The column's width is
   bounded on both axes with min(), so a short window narrows the whole stack
   instead of pushing it off the bottom, and every size inside is a percentage
   of the column.
   ------------------------------------------------------------------------- */
let boards = [];

function makeRightColumn() {
  const C = CFG.rightColumn, L = CFG.logo, S = CFG.scoreboard;
  if (!C) return;

  /* The column's own width, written once and reused. Everything sized against
     the column has to repeat this expression rather than use a container query
     unit, because an element is NOT its own query container: cqw inside the
     column resolves against the nearest ANCESTOR container, and with none it
     silently falls back to the viewport. Measured, gap:5cqw came out as 5vw -
     96px where 34 was intended. */
  const COLW = 'min(' + (C.widthFraction * 100).toFixed(2) + 'vw,' +
                        (C.maxHeightFraction * 100).toFixed(2) + 'vh)';

  const col = document.createElement('div');
  col.style.cssText =
    'position:fixed;z-index:10;pointer-events:none;' +
    'display:flex;flex-direction:column;align-items:center;' +
    /* Not a percentage: a row-gap given as a percentage in a COLUMN flexbox
       resolves against the container's HEIGHT, and this container's height
       comes from its content, so it resolves against nothing and collapses.
       Measured: 0px. This is a fraction of the column's width, spelled out. */
    'gap:calc(' + C.gapFraction + ' * ' + COLW + ');' +
    /* Bounded by width AND height. The vh half is what stops a wide, short
       window - which is what full screen is - running the stack off the
       bottom. */
    'width:' + COLW + ';' +
    'left:' + (C.centreAtScreenX * 100).toFixed(3) + '%;' +
    'top:'  + (C.topFraction * 100).toFixed(3) + '%;' +
    'transform:translateX(-50%);';
  document.body.appendChild(col);

  /* Anything else clicked puts the machine back to neutral. On the document so
     it catches the canvas, the background and the panels' own surround alike -
     the panels stop the event before it gets here. */
  document.addEventListener('pointerdown', function () { setTeamHighlight(-1); });

  if (L && L.enabled) {
    const img = document.createElement('img');
    img.src = L.src;
    img.alt = '';
    img.style.cssText = 'display:block;height:auto;' +
      'width:' + (L.widthFraction * 100).toFixed(2) + '%;' +
      'opacity:' + L.opacity + ';';
    col.appendChild(img);
  }

  if (!S || !S.enabled) return;

  const row = document.createElement('div');
  row.style.cssText =
    'display:flex;justify-content:center;' +
    'width:' + (S.rowWidthFraction * 100).toFixed(2) + '%;' +
    'gap:' + (S.gapFraction * 100).toFixed(2) + '%;';
  col.appendChild(row);

  for (let i = 0; i < 2; i++) {
    const box = document.createElement('div');
    /* flex:1 with a zero basis makes the two share the row exactly, whatever
       the gap is, so the panel width never has to be worked out by hand. */
    box.style.cssText =
      'flex:1 1 0;aspect-ratio:' + S.aspect + ';position:relative;' +
      /* The column is pointer-events:none so clicks fall through to the
         machine; the panels opt back IN, because they are the one part of the
         overlay that is meant to be clicked. */
      'pointer-events:auto;cursor:pointer;' +
      'background:url(' + S.srcs[i] + ') center/100% 100% no-repeat;';
    /* Text is sized in cqh - a percentage of this box's own height - so it
       scales with the chrome around it rather than with the window. */
    box.style.containerType = 'size';

    /* The two lines are CENTRED AS A BLOCK inside the screen, not placed at
       fixed heights. Fixed heights were what made them read as two separate
       things stuck on one panel. A flex column keeps that true whatever the
       text is - a long name, a four-digit score - where arithmetic on a
       baseline would not. line-height 1 because the default leaves descender
       space under each line that nothing is drawn in, pushing the block high. */
    const inner = document.createElement('div');
    inner.style.cssText =
      'position:absolute;display:flex;flex-direction:column;' +
      'align-items:center;' +
      'left:'   + (S.screenInsetX * 100).toFixed(3) + '%;' +
      'right:'  + (S.screenInsetX * 100).toFixed(3) + '%;' +
      'top:'    + (S.screenInsetY * 100).toFixed(3) + '%;' +
      'bottom:' + (S.screenInsetY * 100).toFixed(3) + '%;' +
      /* THREE EQUAL GAPS, not a centred block with a fixed gap between the two
         lines. space-evenly puts the same distance above the name, between the
         name and the score, and below the score, so the panel balances itself
         whatever the text is - one line or two, short name or long - instead
         of the middle gap being a number that happened to suit one case.

         Line boxes, not ink. Each line carries invisible space above its
         capitals and below its baseline, so these gaps are equal as the
         browser lays them out rather than equal to the eye. That was the
         choice made deliberately; measuring to cap height and baseline is the
         other option if it ever looks off. */
      'justify-content:space-evenly;' +
      'font-family:' + S.font + ';font-weight:bold;color:#fff;line-height:1;';

    /* Shadow first, then glow. text-shadow paints back to front, so the glow
       has to come second or the shadow sits on top of it and reads as a dirty
       edge rather than depth. */
    const shadow =
      '0 ' + (S.shadowDy * 100).toFixed(2) + 'cqh ' +
      (S.shadowBlur * 100).toFixed(2) + 'cqh rgba(4,7,14,.72), ' +
      '0 0 4cqh rgba(190,220,255,.5)';

    /* The name has to stay inside the screen whatever anyone types.

       width:100% so it is bounded by the screen rather than taking its natural
       width, which is what let a long name run out through the bezel.
       overflow-wrap:anywhere so a single long word breaks instead of refusing
       to wrap. line-clamp is the hard backstop: at most two lines, and
       anything past that is cut with an ellipsis rather than hidden. */
    /* NO -webkit-line-clamp. It was tried and it does nothing here: measured
       on a bare div appended to the body, display:-webkit-box computes back as
       flow-root, so the clamp never applies and a long name simply runs on and
       is cut off by the bezel with no ellipsis. The truncation is done in
       JavaScript instead - see fitName - where it can be measured and proved
       rather than trusted.

       overflow:hidden stays as a belt-and-braces guard: if a name somehow got
       past the fitting, it would be clipped rather than escape the panel. */
    /* THE CLIP LIVES HERE, not on the name.

       It is the guard that stops a name escaping through the bezel if the
       fitting ever fails. But a clip tight to the text also cut the shadow
       off in a straight line under the descenders, so the box is padded top
       and bottom and the padding taken straight back off as a negative
       margin: the clip grows, the space occupied does not.

       Padding the WRAPPER rather than the name matters. fitName measures the
       name's scrollHeight, and scrollHeight includes padding - padding the
       name would inflate every measurement the fitting makes and shrink text
       that did not need shrinking. */
    const pad = ((S.nameShadowPad || 0.06) * 100).toFixed(2);
    const nameWrap = document.createElement('div');
    nameWrap.style.cssText =
      'width:100%;overflow:hidden;' +
      'padding:' + pad + 'cqh 0;margin:-' + pad + 'cqh 0;';

    const name = document.createElement('div');
    name.style.cssText =
      'letter-spacing:0.06em;text-align:center;text-shadow:' + shadow + ';' +
      'width:100%;overflow-wrap:anywhere;' +
      /* Its own line height, tall enough to contain the descenders that the
         block's line-height:1 was cutting off. See scoreboard.nameLineHeight. */
      'line-height:' + (S.nameLineHeight || 1.18) + ';' +
      'font-size:' + (S.nameSize * 100).toFixed(2) + 'cqh;';
    nameWrap.appendChild(name);

    const score = document.createElement('div');
    score.style.cssText =
      'text-align:center;text-shadow:' + shadow + ';' +
      'font-size:' + (S.scoreSize * 100).toFixed(2) + 'cqh;';

    inner.appendChild(nameWrap);
    inner.appendChild(score);
    box.appendChild(inner);

    /* The doubling chip: the token itself, tilted, in the screen's top-right
       corner while the turn is doubled.

       A sibling of the centred text block rather than a part of it. Inside
       'inner' it would join the space-evenly column and shove the name and
       score off centre every time a token landed, which is the opposite of
       what a status light should do. Out here it appears and disappears
       without moving anything.

       The image comes from itemFaceImage, which is the same drawing routine
       that paints the coin's 3D face - so this is the coin, not a picture of
       one, and it follows the config.

       The tilt cannot push the disc into the bezel however steep it is set:
       the rotation is about the element's centre and the artwork is a circle,
       so the visible disc does not move at all. The element's own bounding
       box DOES grow - a square rotated 55 degrees measures about 1.39 times
       its side - but it is absolutely positioned, so nothing is laid out
       against it and the extra is empty corner. */
    const D = CFG.multiplier;
    const mult = document.createElement('div');
    const coin = D && D.enabled ? itemFaceImage(D.typeId, 192) : null;
    mult.style.cssText =
      'position:absolute;pointer-events:none;border-radius:50%;' +
      'right:' + (S.screenInsetX * 100 + 1.6).toFixed(3) + '%;' +
      'top:'   + (S.screenInsetY * 100 + 1.4).toFixed(3) + '%;' +
      'width:'  + ((D ? D.indicatorSize : 0.2) * 100).toFixed(2) + 'cqh;' +
      'height:' + ((D ? D.indicatorSize : 0.2) * 100).toFixed(2) + 'cqh;' +
      'background:center/100% 100% no-repeat' + (coin ? ' url(' + coin + ')' : '') + ';' +
      'transform:rotate(' + (D ? D.indicatorAngle : 0) + 'deg);' +
      'filter:drop-shadow(0 ' + (S.shadowDy * 100).toFixed(2) + 'cqh ' +
        (S.shadowBlur * 140).toFixed(2) + 'cqh rgba(4,7,14,.75));';
    mult.hidden = true;
    box.appendChild(mult);

    row.appendChild(box);
    /* A colour chosen on the title screen was picked before this panel
       existed, so it is applied here rather than only when it is chosen. */
    if (teamPanelUrl[i]) box.style.backgroundImage = 'url("' + teamPanelUrl[i] + '")';

    const board = { box: box, name: name, score: score, mult: mult,
                    shownName: null, shownScore: null, shownMult: false };
    boards.push(board);

    /* Clicking a panel lights the machine in that team's colour. The event is
       stopped here so the document-level handler below does not immediately
       clear what this just set. */
    (function (index) {
      box.addEventListener('pointerdown', function (e) {
        e.stopPropagation();
        setTeamHighlight(index);
      });
    })(i);

    /* Re-fit when the panel changes size. The size itself is in cqh so it
       already follows the panel; this is for the one-line DECISION, which is
       a measurement and can land differently at a very different scale.
       Cannot loop: the panel's size comes from the row and its aspect ratio,
       and is not affected by the text inside it. */
    if (window.ResizeObserver) {
      new ResizeObserver(function () {
        if (board.shownName != null) fitName(board);
      }).observe(box);
    }
  }
  updateScoreboards();
}

/* -------------------------------------------------------------------------
   POINTS PER COIN

   A box in the same style as the scoreboards, in the bottom right, holding a
   number the host can retype mid-quiz. See pointsBox in config.

   It writes straight to the coin TYPES rather than keeping a value of its own,
   so a coin's worth still lives in exactly one place and the change lands on
   the very next coin.
   ------------------------------------------------------------------------- */
function coinPoints() {
  const P = CFG.pointsBox;
  const t = CFG.itemTypes[P.types[0]];
  return t && t.value ? t.value.amount : 0;
}

function setCoinPoints(n) {
  const P = CFG.pointsBox;
  if (!isFinite(n)) return;
  n = Math.max(P.min, Math.min(P.max, Math.round(n)));
  for (let i = 0; i < P.types.length; i++) {
    const t = CFG.itemTypes[P.types[i]];
    if (t && t.value && t.value.type === 'points') t.value.amount = n;
  }
  return n;
}

function makePointsBox() {
  const P = CFG.pointsBox, S = CFG.scoreboard;
  if (!P || !P.enabled) return;

  const box = document.createElement('div');
  box.style.cssText =
    'position:fixed;z-index:10;' +
    'width:min(' + (P.widthFraction * 100).toFixed(2) + 'vw,' +
                   (P.maxHeightFraction * 100).toFixed(2) + 'vh);' +
    'aspect-ratio:' + P.aspect + ';' +
    'right:' + (P.rightFraction * 100).toFixed(3) + '%;' +
    'bottom:' + (P.bottomFraction * 100).toFixed(3) + '%;' +
    'pointer-events:auto;' +
    'background:url(' + P.src + ') center/100% 100% no-repeat;';
  box.style.containerType = 'size';

  const inner = document.createElement('div');
  inner.style.cssText =
    'position:absolute;display:flex;flex-direction:column;' +
    'align-items:center;justify-content:space-evenly;' +
    'left:'   + (P.screenInsetX * 100).toFixed(3) + '%;' +
    'right:'  + (P.screenInsetX * 100).toFixed(3) + '%;' +
    'top:'    + (P.screenInsetY * 100).toFixed(3) + '%;' +
    'bottom:' + (P.screenInsetY * 100).toFixed(3) + '%;' +
    'font-family:' + S.font + ';font-weight:bold;color:#fff;line-height:1;';

  const shadow =
    '0 ' + (S.shadowDy * 100).toFixed(2) + 'cqh ' +
    (S.shadowBlur * 100).toFixed(2) + 'cqh rgba(4,7,14,.72), ' +
    '0 0 4cqh rgba(190,220,255,.5)';

  /* The label is smaller than a team name - it is three words, not one, and
     has to sit on one line at this size. */
  const label = document.createElement('div');
  label.textContent = P.label;
  label.style.cssText =
    'width:100%;text-align:center;letter-spacing:0.05em;' +
    'text-shadow:' + shadow + ';white-space:nowrap;' +
    'font-size:' + (P.labelSize * 100).toFixed(2) + 'cqh;';

  /* A real input, styled to look like the score. type=text with a numeric
     inputmode rather than type=number: the spinner arrows are ugly at this
     size and there is nothing to step through. */
  const input = document.createElement('input');
  input.type = 'text';
  input.inputMode = 'numeric';
  input.value = String(coinPoints());
  input.style.cssText =
    'width:100%;text-align:center;background:transparent;border:0;outline:0;' +
    'font-family:inherit;font-weight:bold;color:#fff;padding:0;' +
    'text-shadow:' + shadow + ';' +
    'font-size:' + (P.valueSize * 100).toFixed(2) + 'cqh;';

  function commit() {
    const n = setCoinPoints(parseInt(input.value, 10));
    /* Snap the field back to what was actually taken - typing nonsense or
       something out of range should show the value in force, not the typing
       that failed to change it. */
    input.value = String(n != null ? n : coinPoints());
  }
  input.addEventListener('change', commit);
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { commit(); input.blur(); }
  });

  /* Clicking in here is not "somewhere else": adjusting the points mid-turn
     must not end that team's turn. */
  box.addEventListener('pointerdown', function (e) { e.stopPropagation(); });

  inner.appendChild(label);
  inner.appendChild(input);
  box.appendChild(inner);
  document.body.appendChild(box);
}

/* Light the machine in a team's colour, or -1 to put it back to neutral. */
function setTeamHighlight(i) {
  if (teamHighlight === i) return;
  teamHighlight = i;
  /* A new turn starts un-doubled, and the turn that just ended keeps whatever
     it scored. Clicking off and back on to the SAME team is a new turn too -
     it has to be, or a doubler would carry over a break in play. */
  turnMultiplier = 1;
  turnSubtotal = 0;
  paintZones();
}

export function teamHighlightIndex() { return teamHighlight; }

/* Size the name to fit, shrinking it ONLY if it wraps.

   A second line does not fit at the full size: measured on the current panel,
   the block goes to 283.8 against 263 of screen and shoves the score out
   through the bezel. But shrinking every name to the two-line size would make
   ordinary short ones needlessly small, so the size depends on whether this
   particular name actually wraps.

   Returns false if the panel has not been laid out yet, so the caller can
   leave the name unrecorded and try again on the next frame.  */
function fitName(b) {
  const S = CFG.scoreboard, el = b.name;
  const panelH = b.box.getBoundingClientRect().height;
  /* Nothing to measure against until the panel has been laid out. The caller
     leaves the name unrecorded so it is tried again next frame. */
  if (!panelH || !el.clientWidth) return false;

  const full = b.fullName == null ? '' : String(b.fullName);
  el.textContent = full;

  /* Always re-fit from the ORIGINAL text, never from what is on screen -
     otherwise a truncated name gets truncated again on the next pass and
     erodes a few characters every time the window changes. */

  /* One line at full size? Asked with wrapping off, because with wrapping on a
     name that is about to wrap still reports a width that fits. */
  el.style.whiteSpace = 'nowrap';
  el.style.fontSize = (S.nameSize * 100).toFixed(3) + 'cqh';
  const oneLine = el.scrollWidth <= el.clientWidth;
  el.style.whiteSpace = 'normal';
  if (oneLine) return true;

  /* It wraps, and two lines do not fit at the full size - measured, the block
     goes to 283.8 against 263 of screen and shoves the score out through the
     bezel. Give the name whatever is left after the score and the gap, split
     across two lines, never below the floor. */
  const inner = el.parentElement.parentElement;
  /* The score's height is CALCULATED, not measured.

     Measuring it was a real bug: the name is fitted before the score's text has
     been written, so on the first pass the score element is empty and measures
     ZERO. The budget came out as 146 instead of 56, three lines appeared to
     fit, and the name ran straight out of the panel. Every later pass looked
     correct, because by then the score had content - which is exactly the kind
     of fault that survives being tested.

     The score is one line at a known size, so this needs no measurement and no
     ordering between the two.

     The three even gaps come off too. space-evenly has already spoken for that
     space, so sizing the name against it would let the name grow into room the
     layout is going to take back, and push the score out of the panel. */
  const budget = inner.clientHeight - S.scoreSize * panelH
                 - S.evenGapFraction * panelH * 3;
  const lines = S.nameMaxLines || 2;
  let frac = Math.max(S.nameMinSize, Math.min(S.nameSize, (budget / panelH) / lines));
  el.style.fontSize = (frac * 100).toFixed(3) + 'cqh';

  /* Correct against the REAL line height rather than trusting the arithmetic.
     budget/lines lands exactly on the boundary, and line boxes round: measured,
     two lines came to 56.6 against a budget of 56, so the second line was
     rejected and a name that should have wrapped was truncated on one line
     instead. Scaling by the measured overshoot fixes it in one step and needs
     no guess about how the font rounds. */
  /* HEADROOM, or two lines never actually happen.

     budget/lines makes the two lines exactly fill the budget, so the smallest
     rounding tips them over and the text gets truncated onto one line instead.
     Measured: a line box came back as 35px for a 34.7px font, and every long
     name was being cut to a single line as a result.

     Correcting against the REAL line height, with a couple of pixels spare,
     fixes it in one step and needs no guess about how the font rounds. */
  const lh = parseFloat(getComputedStyle(el).lineHeight) || frac * panelH;
  const room = budget - 2;
  if (lh * lines > room) {
    frac = Math.max(S.nameMinSize, frac * room / (lh * lines));
    el.style.fontSize = (frac * 100).toFixed(3) + 'cqh';
  }


  if (el.scrollHeight <= budget + 1) return true;

  /* Still too tall even at the floor size, so it has to lose characters.
     Binary search the longest prefix that fits with an ellipsis on the end -
     about six measurements for any name, against one per character if this
     walked backwards. */
  let lo = 0, hi = full.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    el.textContent = full.slice(0, mid).replace(/\s+$/, '') + '…';
    if (el.scrollHeight <= budget + 1) lo = mid; else hi = mid - 1;
  }
  el.textContent = full.slice(0, lo).replace(/\s+$/, '') + '…';
  return true;
}

/* Only touches the DOM when a value has actually changed. Called every frame,
   and a layout is far more expensive than the comparison that avoids it. */
function updateScoreboards() {
  /* The column is built before the world exists, so the first call has no
     teams to read. The render loop fills them in a frame later; guarding here
     keeps the build order free rather than tying it to when ctx is assigned. */
  if (!ctx || !ctx.teams) return;
  for (let i = 0; i < boards.length; i++) {
    const b = boards[i], team = ctx.teams[i];
    if (!team) continue;
    if (b.shownName !== team.name) {
      /* Only record it as shown once it has actually been fitted. Before the
         panel is laid out there is nothing to measure against, and recording
         it would leave the name at whatever size it happened to get. */
      b.fullName = team.name;
      if (fitName(b)) b.shownName = team.name;
    }
    if (b.shownScore !== team.score) {
      b.score.textContent = String(team.score);
      b.shownScore = team.score;
    }

    /* Shown only on the team whose turn it is, and only once something has
       actually doubled it. It is a light, not a counter: the same coin
       whether the turn is running at x2 or x4. x1 is the normal state and
       does not need saying at all. */
    const D = CFG.multiplier;
    const on = !!(D && D.enabled && D.showIndicator &&
                  i === teamHighlight && turnMultiplier > 1);
    if (b.shownMult !== on) {
      b.mult.hidden = !on;
      b.shownMult = on;
    }
  }
}

/* ===========================================================================
   PRESENTS

   A present cannot come down the chute - see itemTypes.present - so the host
   places them. The button arms placement; the next click on the machine puts
   one just above whatever was clicked and lets it drop the last fraction of
   an inch. Clicking the button again cancels.

   Placing ON the pile is deliberately supported: the ray is tested against
   the decks AND every item, so clicking a heap of coins puts the present on
   top of the heap rather than inside it.
   ========================================================================= */
/* Which type the next click on the machine will put down, or null. One
   variable rather than one per button: arming the second has to disarm the
   first, and two booleans would let both be true at once. */
let placingType = null;
const placeButtons = [];        // { typeId, el, cap, glow }

/* The ones the game starts with, dropped at random across the top deck. Not
   part of startingLayout: that queue is laid out in tidy rows and a present
   is four times a coin's footprint, so it would carve a hole in the pile.
   Dropped in from just above instead, and left to settle where it lands. */
function seedPresents() {
  const P = CFG.presents;
  if (!P || !P.enabled || !(P.startingCount > 0)) return;
  const d = DIMS.itemDims(P.typeId);
  const tier = DIMS.tierLast;
  const lim = DIMS.width / 2 - d.hx - DIMS.D * 0.5;
  const back = Math.min(tier.backZ, tier.lipZ), front = Math.max(tier.backZ, tier.lipZ);
  for (let i = 0; i < P.startingCount; i++) {
    placePresent((Math.random() * 2 - 1) * lim,
                 tier.y + DIMS.deckStep + DIMS.D * 1.2,
                 back + (front - back) * (0.3 + Math.random() * 0.4));
  }
}

function countOnBoard(typeId) {
  let n = 0;
  for (let i = 0; i < ctx.items.length; i++) {
    if (ctx.items[i].typeId === typeId) n++;
  }
  return n;
}

function setPlacing(typeId) {
  if (typeId) {
    const b = placeButtons.find(function (x) { return x.typeId === typeId; });
    /* cap 0 means no limit - the jackpot token has none. */
    if (b && b.cap > 0 && countOnBoard(typeId) >= b.cap) return;
  }
  placingType = typeId || null;
  for (let i = 0; i < placeButtons.length; i++) {
    const b = placeButtons[i];
    b.el.style.filter = (placingType === b.typeId)
      ? 'brightness(1.25) drop-shadow(0 0 10px ' + b.glow + ')'
      : 'none';
  }
}

/* Where a click lands, as a point to stand a present on.

   Solid things first - the moving deck and every item - so clicking a heap of
   coins puts the present ON the heap rather than inside it. The fixed floor
   below the deck is not one of the meshes the machine hands out, so anything
   that misses falls back to a horizontal plane at that floor's height, which
   is the same answer without needing the geometry.

   Either way the result is clamped into the machine, so a click that clips
   the cabinet edge or the room behind it cannot drop a present into a wall.
   ------------------------------------------------------------------------- */
const placePlane = new THREE.Plane();
const placeHit = new THREE.Vector3();

function placementPoint(ray) {
  const targets = ctx.machine.shelves.map(function (s) { return s.mesh; })
    .concat(ctx.items.map(function (i) { return i.mesh; }));
  const hits = ray.intersectObjects(targets, true);
  let pt = hits.length ? hits[0].point.clone() : null;

  if (!pt) {
    placePlane.set(new THREE.Vector3(0, 1, 0), -DIMS.tierLast.y);
    if (!ray.ray.intersectPlane(placePlane, placeHit)) return null;
    pt = placeHit.clone();
  }

  const tier = DIMS.tierLast;
  const back = Math.min(tier.backZ, tier.lipZ), front = Math.max(tier.backZ, tier.lipZ);
  if (pt.z < back - DIMS.D * 3 || pt.z > front + DIMS.D * 3) return null;
  pt.z = Math.max(back + DIMS.D * 0.6, Math.min(front - DIMS.D * 0.6, pt.z));
  return pt;
}

/* Put one down at a world point, sitting just above whatever is there. */
function placeItem(typeId, x, y, z, dropInCoins) {
  const type = CFG.itemTypes[typeId];
  const d = DIMS.itemDims(typeId);
  /* Clamped inside the machine so a click that clips the cabinet edge does
     not drop a present into the wall. */
  /* A disc reports its size differently from a box, and the jackpot token is
     a disc while a present is a box. */
  const half = d.shape === 'box' ? d.hx : d.footprint / 2;
  const up   = d.shape === 'box' ? d.hy : d.halfHeight;
  const lim = DIMS.width / 2 - half - DIMS.D * 0.1;
  x = Math.max(-lim, Math.min(lim, x));
  return createItem(ctx, typeId, x, y + up + DIMS.D * dropInCoins, z,
                    (type.spawnYawDeg || 0) * Math.PI / 180);
}

/* How far above the click a thing starts, in coins. Asked by type rather
   than decided at the call site, because there are now three answers and the
   click handler should not have to know which is which. */
function dropHeightFor(typeId) {
  const P = CFG.presents, J = CFG.jackpot, C = CFG.placeCoin;
  if (J && typeId === J.typeId) return J.dropHeightInCoins;
  if (P && typeId === P.typeId) return P.dropHeightInCoins;
  return (C && C.dropHeightInCoins != null) ? C.dropHeightInCoins : 0.35;
}

function placePresent(x, y, z) {
  return placeItem(CFG.presents.typeId, x, y, z,
                   CFG.presents.dropHeightInCoins);
}

/* The placement buttons, in a row beside the points-per-coin box: jackpot
   token, then present, then the box. Each is the same size and each is a
   picture of the thing it puts down.

   Positioned by counting outwards from the right edge - every button is one
   button-width plus a gap further left than the last - so adding a third
   later is one more entry in the list rather than a new sum. */
function makeButtonRow() {
  const pts = CFG.pointsBox;
  const P = CFG.presents, J = CFG.jackpot;
  if (!P || !P.enabled) return;
  const B = P.button;

  const size = 'min(' + (B.sizeFraction * 100) + 'vw, ' +
                        (B.maxHeightFraction * 100) + 'vh)';
  const boxW = 'min(' + (pts.widthFraction * 100) + 'vw, ' +
                        (pts.maxHeightFraction * 100) + 'vh)';

  /* Right to left: the present sits against the points box, the jackpot
     token sits left of the present. */
  const list = [
    { typeId: P.typeId, icon: presentIcon(96), cap: P.maxOnBoard,
      glow: B.armedGlow, title: 'Place a present' }
  ];
  if (J && J.enabled) {
    list.push({ typeId: J.typeId, icon: itemFaceImage(J.typeId, 128),
                cap: J.maxOnBoard, glow: B.armedGlow,
                title: 'Place a jackpot token',
                gap: J.button && J.button.gapFraction });
  }

  let offset = 'calc(' + (pts.rightFraction * 100) + 'vw + ' + boxW + ')';
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    const gap = (item.gap != null ? item.gap : B.gapFraction) * 100;
    offset = 'calc(' + offset.slice(5, -1) + ' + ' + gap + 'vw)';

    const btn = document.createElement('div');
    btn.title = item.title;
    btn.style.cssText =
      'position:fixed;z-index:22;cursor:pointer;border-radius:50%;' +
      'width:' + size + ';height:' + size + ';' +
      'bottom:' + (pts.bottomFraction * 100) + 'vh;' +
      'right:' + offset + ';' +
      'background:center/contain no-repeat url(' + item.icon + ');' +
      'transition:filter .12s;';
    (function (typeId) {
      btn.addEventListener('pointerdown', function (e) {
        e.stopPropagation();
        setPlacing(placingType === typeId ? null : typeId);
      });
    })(item.typeId);
    document.body.appendChild(btn);
    placeButtons.push({ typeId: item.typeId, el: btn, cap: item.cap,
                        glow: item.glow });

    /* The next one along starts a full button further left. */
    offset = 'calc(' + offset.slice(5, -1) + ' + ' + size + ')';
  }
}

/* The present icon, drawn rather than shipped: the same box-and-ribbon idea
   as the 3D present, flat, in the first palette entry so the button looks
   like the thing it makes. The jackpot token needs no such thing - its face
   IS a flat drawing already, so the button borrows the coin's own. */
function presentIcon(px) {
  const W = CFG.itemTypes[CFG.presents.typeId].wrap;
  const c = W.palette[0];
  const hex = (v) => '#' + (v >>> 0).toString(16).padStart(6, '0');
  const cv = document.createElement('canvas');
  cv.width = cv.height = px;
  const g = cv.getContext('2d');
  const m = px * 0.10, s = px - m * 2, band = s * 0.19;
  g.fillStyle = hex(c.box);
  g.fillRect(m, m + s * 0.13, s, s - s * 0.13);
  g.fillStyle = hex(c.ribbon);
  g.fillRect(m + s / 2 - band / 2, m + s * 0.13, band, s - s * 0.13);  // down
  g.fillRect(m, m + s * 0.13, s, band * 0.9);                          // lid band
  /* Two loops and a knot, enough of a bow at button size. */
  g.beginPath();
  g.ellipse(m + s * 0.34, m + s * 0.12, s * 0.16, s * 0.10, 0, 0, 7);
  g.ellipse(m + s * 0.66, m + s * 0.12, s * 0.16, s * 0.10, 0, 0, 7);
  g.fill();
  return cv.toDataURL('image/png');
}

/* ===========================================================================
   THE VOLUME CONTROL

   A vertical slider with a speaker under it, bottom left. Built by hand
   rather than from an <input type=range>: a range input has to be rotated to
   stand up, and a rotated input's hit box no longer agrees with where it is
   drawn, which makes it miss clicks near the ends. A track and a handle with
   pointer capture is less code than fighting that.

   Both halves write through setVolume, which is the only place the audio is
   actually touched - so muting and dragging cannot disagree about the level.
   ========================================================================= */
let volumeLevel = 1;
let volumeMuted = false;
let volumeParts = null;         // { fill, handle, icon, hw }
/* What the slider is currently showing. Mirrors the innermost light tube -
   see the volume block in config for why that one rule covers flashing with
   the machine, going red while a zone is armed, and carrying a team's colour,
   without any of them being written out separately. White is the tube's own
   resting colour, so it is also the slider's. */
let volumeTint = 0xFFFFFF;

function tintCss(hex, alpha) {
  return 'rgba(' + ((hex >> 16) & 255) + ',' + ((hex >> 8) & 255) + ',' +
         (hex & 255) + ',' + alpha + ')';
}

function setVolumeTint(hex) {
  if (hex === volumeTint) return;      // the tubes only move on a transition
  volumeTint = hex;
  paintVolumeTint();
}

function paintVolumeTint() {
  if (!volumeParts) return;
  const V = CFG.volume;
  volumeParts.fill.style.background   = tintCss(volumeTint, V.tintAlpha);
  volumeParts.handle.style.background = tintCss(volumeTint, V.handleAlpha);
  /* The speaker takes it too. Colouring a MASK rather than redrawing the
     icon: the tint changes on almost every step of a flash, and redrawing a
     canvas and re-encoding it to a data url sixty times a second to recolour
     a 30-pixel picture would be absurd. The masks are generated once; from
     then on this is one CSS property. */
  volumeParts.body.style.background  = tintCss(volumeTint, V.iconAlpha);
  volumeParts.waves.style.background = tintCss(volumeTint, V.iconAlpha);
  /* The cog is part of the same column and takes the same colour. It is
     registered by makeSettings rather than built here, so it may not exist
     yet - this runs from the very first frame, the cog arrives a moment
     later. */
  if (volumeParts.cog) {
    volumeParts.cog.style.background = tintCss(volumeTint, V.iconAlpha);
  }
}

function applyVolume() {
  /* Both, and the config one matters: audio.js reads masterVolume when the
     AudioContext is built, which happens on START. Without this line, a level
     set on the title screen would be forgotten the moment the game began. */
  if (CFG.audio) CFG.audio.masterVolume = volumeLevel;
  setMasterVolume(volumeMuted ? 0 : volumeLevel);
  /* And the title track, which is a plain <audio> element outside the game's
     mixer. Without this the slider would be visible on the title screen and
     do nothing to the only sound playing, which reads as broken. */
  if (titleMusic) titleMusic.volume = titleMusicLevel();
  if (introVideo) introVideo.volume = introLevel();

  if (!volumeParts) return;
  const pct = (volumeLevel * 100).toFixed(1) + '%';
  volumeParts.fill.style.height = pct;
  volumeParts.handle.style.bottom = 'calc(' + pct + ' - ' + volumeParts.hw + ')';
  volumeParts.fill.style.opacity = volumeMuted ? '0.25' : '1';
  volumeParts.waves.hidden = volumeMuted;
  volumeParts.cross.hidden = !volumeMuted;
  paintVolumeTint();
}

function setVolume(v, mute) {
  /* Reject anything that is not a number BEFORE it reaches the level.

     Math.min and Math.max propagate NaN rather than clamping it, so one bad
     value poisons volumeLevel, then CFG.audio.masterVolume, and then throws
     out of the AudioParam - which silences the whole game with nothing on
     screen to say why. A slider measured while its panel is hidden has zero
     width, and a divide by zero is all it takes. */
  if (!isFinite(v)) v = volumeLevel;
  volumeLevel = Math.max(0, Math.min(1, v));
  if (mute !== undefined) volumeMuted = !!mute;
  applyVolume();
  /* The LEVEL is remembered, the mute is not - see the volume block in
     config. Wrapped because storage throws outright in a few contexts rather
     than just coming back empty. */
  try {
    if (CFG.volume.storageKey) {
      localStorage.setItem(CFG.volume.storageKey, String(volumeLevel));
    }
  } catch (e) { /* private window, or site data blocked - carry on */ }
}

function makeVolumeControl() {
  const V = CFG.volume;
  if (!V || !V.enabled) return;

  const icon = 'min(' + (V.iconFraction * 100) + 'vw, ' +
                        (V.iconMaxHeight * 100) + 'vh)';
  const trackH = (V.trackHeightFraction * 100) + 'vh';
  const trackW = 'min(' + (V.trackWidthFraction * 100) + 'vw, ' +
                          (V.trackWidthFraction * 200) + 'vh)';
  const knobSize = 'calc(' + trackW + ' * 2.6)';
  const half     = 'calc(' + knobSize + ' / 2)';

  const wrap = document.createElement('div');
  /* ABOVE the title screen, which is z-index 50 in index.html. This control
     is on screen before the game is, so it has to outrank the overlay it sits
     on - at 22 it was built, positioned and coloured correctly and then
     covered by a black panel, which looks exactly like it not being there. */
  wrap.style.cssText =
    'position:fixed;z-index:60;display:flex;flex-direction:column;' +
    'align-items:center;gap:' + (V.gapFraction * 100) + 'vh;' +
    'left:' + (V.leftFraction * 100) + 'vw;' +
    'bottom:' + (V.bottomFraction * 100) + 'vh;';

  /* The track sits inside a wider invisible column, so the whole strip is
     grabbable - a seven pixel wide track is a cruel target with a mouse. */
  const grab = document.createElement('div');
  grab.style.cssText =
    'position:relative;cursor:pointer;touch-action:none;' +
    'height:' + trackH + ';width:' + icon + ';' +
    'display:flex;justify-content:center;';

  const track = document.createElement('div');
  track.style.cssText =
    'position:relative;height:100%;width:' + trackW + ';border-radius:999px;' +
    'background:' + V.trackColour + ';';

  const fill = document.createElement('div');
  fill.style.cssText =
    'position:absolute;left:0;right:0;bottom:0;border-radius:999px;' +
    'transition:opacity .12s;';

  const knob = document.createElement('div');
  knob.style.cssText =
    'position:absolute;left:50%;transform:translateX(-50%);' +
    'width:' + knobSize + ';height:' + knobSize + ';border-radius:50%;' +
    'box-shadow:0 1px 4px rgba(0,0,0,.55);pointer-events:none;';

  track.appendChild(fill);
  track.appendChild(knob);
  grab.appendChild(track);

  /* The speaker is three stacked masks rather than one picture: the body and
     the sound waves take the machine's colour, the cross stays red. A single
     tinted image could not do that - the cross would flash with everything
     else and stop reading as "muted" at exactly the moment it matters. */
  const speaker = document.createElement('div');
  speaker.title = 'Mute';
  speaker.style.cssText =
    'position:relative;width:' + icon + ';height:' + icon + ';cursor:pointer;';

  const masks = speakerMasks(128);
  function layer(url) {
    const d = document.createElement('div');
    d.style.cssText =
      'position:absolute;inset:0;pointer-events:none;' +
      '-webkit-mask-image:url(' + url + ');mask-image:url(' + url + ');' +
      '-webkit-mask-size:contain;mask-size:contain;' +
      '-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;' +
      '-webkit-mask-position:center;mask-position:center;';
    speaker.appendChild(d);
    return d;
  }
  const body  = layer(masks.body);
  const waves = layer(masks.waves);
  const cross = layer(masks.cross);
  cross.style.background = V.mutedColour;
  cross.hidden = true;

  wrap.appendChild(grab);
  wrap.appendChild(speaker);
  document.body.appendChild(wrap);
  volumeParts = { fill: fill, handle: knob, icon: speaker, hw: half, wrap: wrap,
                  body: body, waves: waves, cross: cross };

  /* Dragging. Pointer capture means a drag that wanders off the track still
     controls it, which is what anyone expects from a slider. */
  function fromEvent(e) {
    const r = track.getBoundingClientRect();
    if (!r.height) return;           // hidden, or not laid out yet
    /* Dragging always unmutes: reaching for the slider means you want to hear
       something, and leaving it silent while the bar moves looks broken. */
    setVolume(1 - (e.clientY - r.top) / r.height, false);
  }
  grab.addEventListener('pointerdown', function (e) {
    e.stopPropagation();
    /* In a try: it throws on a pointer id the browser does not recognise, and
       an unguarded throw aborts the handler before the click is read - the
       slider simply does not respond. Same guard as the settings one. */
    try { grab.setPointerCapture(e.pointerId); } catch (err) { /* no capture */ }
    fromEvent(e);
  });
  grab.addEventListener('pointermove', function (e) {
    if (grab.hasPointerCapture(e.pointerId)) fromEvent(e);
  });

  speaker.addEventListener('pointerdown', function (e) {
    e.stopPropagation();          // do not clear whose turn it is
    setVolume(volumeLevel, !volumeMuted);
  });

  /* Start from what was stored, falling back to the config's own level. */
  let start = CFG.audio ? CFG.audio.masterVolume : 1;
  try {
    const saved = localStorage.getItem(V.storageKey);
    if (saved !== null && isFinite(parseFloat(saved))) start = parseFloat(saved);
  } catch (e) { /* nothing stored, or storage unavailable */ }
  setVolume(start, false);
}

/* The speaker as three separate MASKS - body, waves, cross - so each can be
   coloured independently in CSS afterwards. Drawn in solid black because a
   mask only reads alpha; the colour comes from the element behind it.

   Generated once and cached. Everything after that is a style change. */
let speakerMaskCache = null;

function speakerMasks(px) {
  if (speakerMaskCache) return speakerMaskCache;

  function sheet(draw) {
    const c = document.createElement('canvas');
    c.width = c.height = px;
    const g = c.getContext('2d');
    g.fillStyle = '#000';
    g.strokeStyle = '#000';
    g.lineCap = 'round';
    draw(g, px / 100);
    return c.toDataURL('image/png');
  }

  speakerMaskCache = {
    body: sheet(function (g, u) {
      g.beginPath();
      g.moveTo(16 * u, 38 * u);
      g.lineTo(32 * u, 38 * u);
      g.lineTo(50 * u, 18 * u);
      g.lineTo(50 * u, 82 * u);
      g.lineTo(32 * u, 62 * u);
      g.lineTo(16 * u, 62 * u);
      g.closePath();
      g.fill();
    }),
    waves: sheet(function (g, u) {
      for (let i = 0; i < 2; i++) {
        g.lineWidth = 7 * u;
        g.beginPath();
        g.arc(54 * u, 50 * u, (15 + i * 15) * u, -Math.PI / 3.4, Math.PI / 3.4);
        g.stroke();
      }
    }),
    cross: sheet(function (g, u) {
      g.lineWidth = 10 * u;
      g.beginPath();
      g.moveTo(60 * u, 34 * u); g.lineTo(92 * u, 66 * u);
      g.moveTo(92 * u, 34 * u); g.lineTo(60 * u, 66 * u);
      g.stroke();
    })
  };
  return speakerMaskCache;
}

/* ===========================================================================
   THE INTRO

   Full screen the moment START is pressed, with the game building behind it.
   Any key or click skips straight through.

   Nothing here blocks the build: this only puts a black sheet with a video on
   it over the top and takes it away again. The world is being assembled
   underneath the whole time, so by the time the video ends - or is skipped -
   the machine is already there.
   ========================================================================= */
let introVideo = null, introOverlay = null;

function introLevel() {
  const V = CFG.intro;
  const v = (volumeMuted ? 0 : volumeLevel) * (V ? V.volume : 1);
  return Math.max(0, Math.min(1, v));
}

/* Made on the title screen so it is buffered before anyone presses START -
   otherwise the first thing the intro does is stall on a black screen. */
function prepareIntro() {
  const V = CFG.intro;
  if (!V || !V.enabled || introVideo) return;
  const el = document.createElement('video');
  el.src = V.src;
  el.preload = 'auto';
  el.playsInline = true;
  el.volume = introLevel();
  introVideo = el;
}

function playIntro() {
  const V = CFG.intro;
  if (!V || !V.enabled) return;
  prepareIntro();
  if (!introVideo) return;

  const overlay = document.createElement('div');
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:100;background:#000;' +
    'display:flex;align-items:center;justify-content:center;';
  introVideo.style.cssText =
    'width:100%;height:100%;object-fit:contain;background:#000;';
  overlay.appendChild(introVideo);
  document.body.appendChild(overlay);
  introOverlay = overlay;

  let done = false;
  function finish() {
    if (done) return;
    done = true;
    window.removeEventListener('keydown', finish, true);
    window.removeEventListener('pointerdown', finish, true);
    if (introVideo) { try { introVideo.pause(); } catch (e) { /* already gone */ } }
    if (introOverlay && introOverlay.parentNode) {
      introOverlay.parentNode.removeChild(introOverlay);
    }
    introOverlay = null;
  }

  introVideo.addEventListener('ended', finish);
  /* A file that will not load or will not play must cost nothing worse than
     no intro. It must never hang on a black screen with no way forward. */
  introVideo.addEventListener('error', finish);
  const p = introVideo.play();
  if (p && p.catch) p.catch(finish);

  /* Armed late, so the click that pressed START cannot skip its own video. */
  setTimeout(function () {
    if (done) return;
    window.addEventListener('keydown', finish, true);
    window.addEventListener('pointerdown', finish, true);
  }, V.skipArmMs);
}

/* ===========================================================================
   THE TITLE MUSIC

   Loops behind the team-name screen and stops when the game begins.

   A plain <audio> element rather than the game's own audio graph, because of
   timing: that graph needs an AudioContext, an AudioContext needs a user
   gesture, and the gesture is the START click - by which point the title
   screen is over. An <audio> element carries the same restriction but its
   play() returns a promise that REJECTS rather than throwing, so it can be
   tried at once and started on the first click or keypress if the browser
   says no. The host types two team names before pressing START, so in
   practice it is running long before then.

   The level is scaled by whatever the volume slider was last set to. Without
   that, a host who turned the game down last week gets the title music at
   full blast this week, which is precisely the sort of thing that happens in
   front of a room full of people.
   ========================================================================= */
let titleMusic = null;

/* What the title track should be playing at right now: its own trim, scaled
   by the volume slider, and silenced by the mute. One expression, used both
   when it starts and every time the slider moves. */
function titleMusicLevel() {
  const T = CFG.titleMusic;
  const v = (volumeMuted ? 0 : volumeLevel) * (T ? T.volume : 1);
  return Math.max(0, Math.min(1, v));
}

function startTitleMusic() {
  const T = CFG.titleMusic;
  if (!T || !T.enabled || titleMusic) return;

  const el = document.createElement('audio');
  el.src = T.src;
  el.loop = true;
  /* T.volume is this track's own trim; the slider does the rest. Set through
     the same expression applyVolume uses, so the level the music starts at
     and the level a drag produces cannot disagree. */
  el.volume = titleMusicLevel();
  el.id = 'titleMusic';
  /* In the document, though an <audio> element plays perfectly well outside
     it. Being findable is worth the one line: a title track that will not
     start is exactly the sort of thing that needs looking at from a console
     rather than guessed at. */
  document.body.appendChild(el);
  titleMusic = el;

  /* Try immediately; if the browser refuses for want of a gesture, wait for
     one. The listeners are on the window with capture so they see the click
     wherever it lands - including on the team-name fields, which is the first
     thing the host touches. */
  function attempt() {
    const p = el.play();
    if (p && p.catch) p.catch(function () { /* still no gesture - wait */ });
  }
  function onGesture() {
    attempt();
    window.removeEventListener('pointerdown', onGesture, true);
    window.removeEventListener('keydown', onGesture, true);
  }
  attempt();
  window.addEventListener('pointerdown', onGesture, true);
  window.addEventListener('keydown', onGesture, true);
}

/* Faded rather than cut. A loop that vanishes mid-bar sounds like a fault. */
function stopTitleMusic() {
  const el = titleMusic;
  if (!el) return;
  titleMusic = null;

  const T = CFG.titleMusic;
  const steps = Math.max(1, Math.round((T.fadeOutSeconds || 0) * 30));
  const from = el.volume;
  let i = 0;
  const timer = setInterval(function () {
    i++;
    el.volume = Math.max(0, from * (1 - i / steps));
    if (i >= steps) {
      clearInterval(timer);
      el.pause();
      el.src = '';          // let the decoder go
      if (el.parentNode) el.parentNode.removeChild(el);
    }
  }, 1000 / 30);
}

/* ===========================================================================
   THE SETTINGS MENU

   A cog under the volume mixer - added to the SAME column, which is what
   pushes the mixer up to make room for it - opening a panel built from the
   same generator as the scoreboards. Real chrome, dark screen, the same
   condensed bold, so it reads as part of the machine rather than as a dialog.

   The machine keeps running while it is open, deliberately: a host adjusting
   the speed wants to see what the speed does.
   ========================================================================= */
let settingsPanel = null, settingsOpen = false;
let speedIndex = 4, multiplierOn = true, basePeriodMs = 0;

/* Remove every item the test picks out. Used by the four delete buttons, all
   of which differ only in the test. */
function removeItems(test) {
  if (!ctx) return 0;
  let n = 0;
  for (let i = ctx.items.length - 1; i >= 0; i--) {
    const it = ctx.items[i];
    if (!test(it)) continue;
    scene.remove(it.mesh);
    ctx.world.removeRigidBody(it.body);
    ctx.items.splice(i, 1);
    n++;
  }
  return n;
}

/* Anything wedged behind the glass among the pegs.

   BY POSITION, not by the in-the-chute flag. dropStep is cleared after 600
   steps as a give-up guard, so a coin stuck longer than ten seconds has
   already lost it - which is exactly the coin somebody reaches for this
   button to clear. trackChute makes the same point about a different pass. */
function inChute(it) {
  const t = it.body.translation();
  /* DEPTH does the discriminating, not height.

     Two earlier versions got this wrong from opposite ends. The first allowed
     a coin's diameter below the chute's floor and swept six coins off the
     shelf when one was stuck. The second raised the floor to chuteBottom
     exactly - which fixed that, and then failed to clear a coin wedged in the
     chute's MOUTH, half in and half out, because it sits below that line. It
     is not "leaving anyway" if it is jammed.

     Measured instead: a coin resting anywhere below the chute sits at least
     0.084 from the glass on a fresh pile, and 0.419 once the machine has been
     running - while a coin in the chute is within about 0.05 of it, because
     the slot is only 0.052 deep. So the z window separates them on its own,
     and the height only has to reach down far enough to include the mouth.
     Down to the deck's surface does that with room to spare. */
  return Math.abs(t.z - DIMS.panelZ) < DIMS.chuteDepth * 1.2 &&
         t.y > DIMS.tierTop.y + DIMS.deckStep - DIMS.D * 0.5 &&
         t.y < DIMS.chuteTop + DIMS.D;
}

function saveSettings() {
  try {
    localStorage.setItem(CFG.settings.storageKey, JSON.stringify({
      speed: speedIndex, multiplier: multiplierOn
    }));
  } catch (e) { /* private window, or site data blocked */ }
}

function applySpeed() {
  const S = CFG.settings;
  const mult = S.speedSteps[speedIndex] || 1;
  /* Off the ORIGINAL period, never off the current one, or every change
     compounds with the last. */
  CFG.shelf.periodMs = basePeriodMs / mult;
}

function applyMultiplier(deleteExisting) {
  CFG.multiplier.enabled = multiplierOn;
  if (!multiplierOn && deleteExisting) {
    removeItems(function (it) { return it.typeId === CFG.multiplier.typeId; });
  }
}

function speedLabel(m) {
  if (m === 1) return 'NORMAL';
  if (m > 1) return 'x' + (Math.round(m * 10) / 10);
  return '/' + (Math.round((1 / m) * 10) / 10);
}

function makeSettings() {
  const S = CFG.settings, SB = CFG.scoreboard, V = CFG.volume;
  if (!S || !S.enabled) return;

  basePeriodMs = CFG.shelf.periodMs;
  try {
    const saved = JSON.parse(localStorage.getItem(S.storageKey) || 'null');
    if (saved) {
      if (saved.speed >= 0 && saved.speed < S.speedSteps.length) speedIndex = saved.speed;
      if (typeof saved.multiplier === 'boolean') multiplierOn = saved.multiplier;
    }
  } catch (e) { /* nothing stored */ }
  applySpeed();
  applyMultiplier(false);

  /* ---- the cog, joining the volume column ---- */
  const size = 'min(' + (V.cogFraction * 100) + 'vw, ' +
                        (V.cogMaxHeight * 100) + 'vh)';
  const cog = document.createElement('div');
  cog.title = 'Settings';
  cog.style.cssText =
    'width:' + size + ';height:' + size + ';cursor:pointer;' +
    '-webkit-mask-image:url(' + cogMask(128) + ');mask-image:url(' + cogMask(128) + ');' +
    '-webkit-mask-size:contain;mask-size:contain;' +
    '-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;' +
    '-webkit-mask-position:center;mask-position:center;' +
    'background:rgba(255,255,255,0.82);';
  cog.addEventListener('pointerdown', function (e) {
    e.stopPropagation();
    toggleSettings();
  });
  if (volumeParts && volumeParts.wrap) {
    volumeParts.wrap.appendChild(cog);
    /* Hand it to the volume control so it takes the machine's colour with
       everything else in that corner - the tint is pushed from tickLights,
       and this is what puts the cog on the list. */
    volumeParts.cog = cog;
    paintVolumeTint();
  }

  /* ---- the panel ---- */
  const shadow =
    '0 ' + (SB.shadowDy * 100).toFixed(2) + 'cqh ' +
    (SB.shadowBlur * 100).toFixed(2) + 'cqh rgba(4,7,14,.72), ' +
    '0 0 4cqh rgba(190,220,255,.5)';

  const box = document.createElement('div');
  box.style.cssText =
    'position:fixed;z-index:70;left:50%;top:50%;transform:translate(-50%,-50%);' +
    'width:min(' + (S.widthFraction * 100) + 'vw, ' +
                   (S.maxHeightFraction * 100) + 'vh);' +
    'aspect-ratio:' + S.aspect + ';' +
    'background:url(' + S.src + ') center/100% 100% no-repeat;' +
    'container-type:size;';
  box.hidden = true;
  box.addEventListener('pointerdown', function (e) { e.stopPropagation(); });

  const inner = document.createElement('div');
  inner.style.cssText =
    'position:absolute;display:flex;flex-direction:column;' +
    'left:'   + (S.screenInsetX * 100).toFixed(3) + '%;' +
    'right:'  + (S.screenInsetX * 100).toFixed(3) + '%;' +
    'top:'    + (S.screenInsetY * 100).toFixed(3) + '%;' +
    'bottom:' + (S.screenInsetY * 100).toFixed(3) + '%;' +
    'padding:2.2cqh 4cqw;box-sizing:border-box;gap:1.5cqh;' +
    'font-family:' + SB.font + ';font-weight:bold;color:#fff;line-height:1;';

  const title = document.createElement('div');
  title.textContent = 'SETTINGS';
  title.style.cssText =
    'text-align:center;letter-spacing:0.08em;text-shadow:' + shadow + ';' +
    'font-size:' + (S.titleSize * 100).toFixed(2) + 'cqh;margin-bottom:0.6cqh;';
  inner.appendChild(title);

  function labelStyle() {
    return 'font-size:' + (S.labelSize * 100).toFixed(2) + 'cqh;' +
           'letter-spacing:0.05em;text-shadow:' + shadow + ';';
  }

  /* A label with a control beside it. */
  function row(text) {
    const r = document.createElement('div');
    r.style.cssText = 'display:flex;align-items:center;gap:3cqw;';
    const l = document.createElement('div');
    l.textContent = text;
    l.style.cssText = labelStyle() + 'flex:0 0 34%;';
    r.appendChild(l);
    inner.appendChild(r);
    return r;
  }

  /* A horizontal slider. onPick gets 0..1. */
  function slider(parent, initial, onPick) {
    const track = document.createElement('div');
    track.style.cssText =
      'position:relative;flex:1 1 auto;height:1.6cqh;border-radius:999px;' +
      'background:rgba(255,255,255,0.18);cursor:pointer;touch-action:none;';
    const fill = document.createElement('div');
    fill.style.cssText =
      'position:absolute;left:0;top:0;bottom:0;border-radius:999px;' +
      'background:rgba(255,255,255,0.72);';
    const knob = document.createElement('div');
    knob.style.cssText =
      'position:absolute;top:50%;transform:translate(-50%,-50%);' +
      'width:3.4cqh;height:3.4cqh;border-radius:50%;background:#F2F7FF;' +
      'box-shadow:0 1px 4px rgba(0,0,0,.55);pointer-events:none;';
    track.appendChild(fill);
    track.appendChild(knob);
    parent.appendChild(track);

    function paint(v) {
      fill.style.width = (v * 100).toFixed(1) + '%';
      knob.style.left  = (v * 100).toFixed(1) + '%';
    }
    function from(e) {
      const r = track.getBoundingClientRect();
      if (!r.width) return;          // hidden, or not laid out yet
      paint(onPick(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))));
    }
    track.addEventListener('pointerdown', function (e) {
      e.stopPropagation();
      /* Capture so a drag that wanders off the track still controls it. In a
         try: it throws on a pointer id the browser does not recognise, and an
         unguarded throw here would abort the handler before the click was
         even read - the slider would simply not respond. */
      try { track.setPointerCapture(e.pointerId); } catch (err) { /* no capture */ }
      from(e);
    });
    track.addEventListener('pointermove', function (e) {
      if (track.hasPointerCapture(e.pointerId)) from(e);
    });
    paint(initial);
    return paint;
  }

  /* A full-width button. */
  function button(text, onClick) {
    const b = document.createElement('div');
    b.textContent = text;
    b.style.cssText =
      'text-align:center;cursor:pointer;border-radius:1cqh;' +
      'padding:1.5cqh 0;background:rgba(255,255,255,0.10);' +
      'border:0.35cqh solid rgba(255,255,255,0.22);' +
      labelStyle() + 'transition:background .12s;';
    b.addEventListener('pointerdown', function (e) {
      e.stopPropagation();
      onClick(b);
    });
    b.addEventListener('pointerenter', function () {
      b.style.background = 'rgba(255,255,255,0.20)';
    });
    b.addEventListener('pointerleave', function () {
      b.style.background = 'rgba(255,255,255,0.10)';
    });
    inner.appendChild(b);
    return b;
  }

  /* Say what a button did, then put its name back - a delete that removes
     nothing looks broken otherwise. */
  function flash(b, text, revert) {
    b.textContent = text;
    setTimeout(function () { b.textContent = revert; }, 900);
  }

  /* ---- volume ---- */
  const volRow = row('VOLUME');
  const volPaint = slider(volRow, volumeLevel, function (v) {
    setVolume(v, false);
    return v;
  });

  /* ---- x2 coins ---- */
  const multRow = row('x2 COINS');
  const multBtn = document.createElement('div');
  multBtn.style.cssText =
    'flex:1 1 auto;text-align:center;cursor:pointer;border-radius:1cqh;' +
    'padding:1.2cqh 0;border:0.35cqh solid rgba(255,255,255,0.22);' +
    labelStyle();
  function paintMult() {
    multBtn.textContent = multiplierOn ? 'ON' : 'OFF';
    multBtn.style.background = multiplierOn
      ? 'rgba(155,92,255,0.45)' : 'rgba(255,255,255,0.08)';
  }
  multBtn.addEventListener('pointerdown', function (e) {
    e.stopPropagation();
    multiplierOn = !multiplierOn;
    applyMultiplier(true);
    paintMult();
    saveSettings();
  });
  paintMult();
  multRow.appendChild(multBtn);

  /* ---- speed ---- */
  const speedRow = row('SPEED');
  const speedVal = document.createElement('div');
  speedVal.style.cssText = labelStyle() + 'flex:0 0 18%;text-align:right;';
  const steps = S.speedSteps;
  const speedPaint = slider(speedRow, speedIndex / (steps.length - 1), function (v) {
    speedIndex = Math.round(v * (steps.length - 1));
    applySpeed();
    speedVal.textContent = speedLabel(steps[speedIndex]);
    saveSettings();
    return speedIndex / (steps.length - 1);
  });
  speedVal.textContent = speedLabel(steps[speedIndex]);
  speedRow.appendChild(speedVal);

  /* ---- the actions ---- */
  /* First, and above the destructive ones, because this is the only action
     here you would reach for DURING a round rather than between them. */
  button('PLACE COIN', function () {
    if (!ctx) return;
    toggleSettings(false);
    /* The colour is decided now rather than on the click. Cancelling with
       Escape therefore skips one place in the rotation - which nobody can
       see, and is cheaper than a second piece of state to carry it. */
    setPlacing(nextCoinType());
  });

  button('RESET BOARD', function (b) {
    if (!ctx) return;
    resetPile();
    flash(b, 'BOARD RESET', 'RESET BOARD');
  });
  button('RESET SCORES', function (b) {
    if (!ctx || !ctx.teams) return;
    ctx.teams.forEach(function (t) { t.score = 0; if (t.log) t.log.length = 0; });
    M.awarded = 0; M.prizes = 0;
    updateScoreboards();
    flash(b, 'SCORES RESET', 'RESET SCORES');
  });
  button('CLEAR CHUTE', function (b) {
    const n = removeItems(inChute);
    flash(b, n ? 'CLEARED ' + n : 'NOTHING STUCK', 'CLEAR CHUTE');
  });
  button('DELETE PRESENTS', function (b) {
    const id = CFG.presents ? CFG.presents.typeId : null;
    const n = id ? removeItems(function (it) { return it.typeId === id; }) : 0;
    flash(b, n ? 'DELETED ' + n : 'NONE ON BOARD', 'DELETE PRESENTS');
  });
  button('DELETE JACKPOTS', function (b) {
    const id = CFG.jackpot ? CFG.jackpot.typeId : null;
    const n = id ? removeItems(function (it) { return it.typeId === id; }) : 0;
    flash(b, n ? 'DELETED ' + n : 'NONE ON BOARD', 'DELETE JACKPOTS');
  });

  const close = button('CLOSE', function () { toggleSettings(false); });
  close.style.marginTop = 'auto';

  box.appendChild(inner);
  document.body.appendChild(box);
  settingsPanel = { box: box, volPaint: volPaint, speedPaint: speedPaint };

  /* Clicking anywhere else shuts it. The panel itself stops the event, so
     this only ever sees clicks outside. */
  document.addEventListener('pointerdown', function () {
    if (settingsOpen) toggleSettings(false);
  });
}

function toggleSettings(force) {
  if (!settingsPanel) return;
  settingsOpen = force === undefined ? !settingsOpen : !!force;
  settingsPanel.box.hidden = !settingsOpen;
  /* The corner mixer and the one in here are the same value; re-paint on open
     so a change made outside is reflected in here. */
  if (settingsOpen) settingsPanel.volPaint(volumeLevel);
}

/* The cog, as a mask so it can be coloured in CSS like the speaker is. */
function cogMask(px) {
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const g = c.getContext('2d');
  const R = px / 2, teeth = 8;
  g.fillStyle = '#000';
  g.beginPath();
  for (let i = 0; i < teeth * 2; i++) {
    const r = (i % 2) ? px * 0.33 : px * 0.46;
    const a = (i * Math.PI) / teeth;
    const x = R + Math.sin(a) * r, y = R - Math.cos(a) * r;
    if (i) g.lineTo(x, y); else g.moveTo(x, y);
  }
  g.closePath();
  g.fill();
  /* The hole. destination-out cuts it rather than painting over it, which
     matters for a mask - a filled circle would be opaque, not empty. */
  g.globalCompositeOperation = 'destination-out';
  g.beginPath();
  g.arc(R, R, px * 0.16, 0, Math.PI * 2);
  g.fill();
  return c.toDataURL('image/png');
}

/* ===========================================================================
   TEAM COLOURS THE CONTESTANTS PICK

   A swatch either side of the two name fields opens the browser's own colour
   picker, and what comes back becomes that team's colour - in the light
   tubes, on the score panel, and on the name field itself.

   The two panels are pre-rendered SVGs with the colour baked in. Rather than
   port the whole generator into the browser, the colour is changed where it
   actually lives: seven gradient stops derived from one base by the same two
   formulas the generator uses. Everything else in the file is left alone, so
   the panels cannot drift away from the ones the build script makes.
   ========================================================================= */
let teamColours = [];
let teamPanelUrl = [null, null];
const teamSwatch = [], teamPicker = [];
const svgTextCache = {};

const cssHex = (v) => '#' + (v >>> 0).toString(16).padStart(6, '0').toUpperCase();

/* The generator's own two, ported exactly - see shade() and lighten() in
   tools/build-scoreboard.py. */
function shadeHex(base, f) {
  const p = [(base >> 16) & 255, (base >> 8) & 255, base & 255]
    .map(function (c) { return Math.min(255, Math.round(c * f)); });
  return '#' + p.map(function (c) { return c.toString(16).padStart(2, '0'); })
                .join('').toUpperCase();
}
function lightenHex(base, t) {
  const p = [(base >> 16) & 255, (base >> 8) & 255, base & 255]
    .map(function (c) { return Math.round(c + (255 - c) * t); });
  return '#' + p.map(function (c) { return c.toString(16).padStart(2, '0'); })
                .join('').toUpperCase();
}

/* Pull a colour's LIGHTNESS into the readable band, leaving its hue and
   saturation alone. The name and score are white: too pale and they vanish,
   too dark and the panel swallows itself. */
function clampLightness(hex) {
  const T = CFG.teamColour;
  const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255,
        b = (hex & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0, sat = 0;
  const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    sat = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (mx === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  const want = Math.max(T.minLightness, Math.min(T.maxLightness, l));
  if (Math.abs(want - l) < 1e-6) return hex;

  const q = want < 0.5 ? want * (1 + sat) : want + sat - want * sat;
  const pp = 2 * want - q;
  const hue = function (t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return pp + (q - pp) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return pp + (q - pp) * (2 / 3 - t) * 6;
    return pp;
  };
  const out = sat === 0
    ? [want, want, want]
    : [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)];
  return out.reduce(function (acc, v) {
    return (acc << 8) | Math.max(0, Math.min(255, Math.round(v * 255)));
  }, 0) >>> 0;
}

function loadSvgText(src) {
  if (!svgTextCache[src]) {
    svgTextCache[src] = fetch(src).then(function (r) { return r.text(); });
  }
  return svgTextCache[src];
}

/* Re-tint one panel. Parsed as a document rather than string-replaced: the
   stops are found by what they ARE, not by the hex that happens to be in
   them, so this keeps working if the build script's colours ever change. */
function recolourPanel(src, base) {
  const T = CFG.teamColour;
  return loadSvgText(src).then(function (text) {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const screen = doc.querySelector('linearGradient[id^="screen"]');
    const sheen  = doc.querySelector('linearGradient[id^="sheen"]');
    if (screen) {
      const stops = screen.querySelectorAll('stop');
      for (let i = 0; i < stops.length && i < T.ramp.length; i++) {
        stops[i].setAttribute('stop-color', shadeHex(base, T.ramp[i]));
      }
    }
    if (sheen) {
      const st = sheen.querySelectorAll('stop');
      /* Two lightened and one shaded, matching the generator. */
      if (st[0]) st[0].setAttribute('stop-color', lightenHex(base, T.sheen[0]));
      if (st[1]) st[1].setAttribute('stop-color', lightenHex(base, T.sheen[1]));
      if (st[2]) st[2].setAttribute('stop-color', shadeHex(base, T.sheen[2]));
    }
    return 'data:image/svg+xml;charset=utf-8,' +
           encodeURIComponent(new XMLSerializer().serializeToString(doc.documentElement));
  });
}

function setTeamColour(i, hex) {
  const T = CFG.teamColour;
  if (!T || !T.enabled) return;

  hex = clampLightness(hex >>> 0);
  teamColours[i] = hex;
  CFG.scoreboard.teamColours[i] = hex;

  /* The swatch is a rainbow button now, not a readout - the name field beside
     it already shows the team's colour. Only the picker is kept in step, so
     it opens on the colour actually in use. */
  if (teamPicker[i]) teamPicker[i].value = cssHex(hex);

  recolourPanel(T.fieldSrcs[i], hex).then(function (url) {
    const el = document.getElementById(i ? 'teamB' : 'teamA');
    if (el) el.style.backgroundImage = 'url("' + url + '")';
  });
  recolourPanel(T.panelSrcs[i], hex).then(function (url) {
    teamPanelUrl[i] = url;
    if (boards[i]) boards[i].box.style.backgroundImage = 'url("' + url + '")';
  });

  /* The tubes read scoreboard.teamColours, so a repaint is all they need. */
  if (lights) paintZones();
}

function makeTeamColourPickers() {
  const T = CFG.teamColour;
  if (!T || !T.enabled) return;

  /* ALWAYS the defaults at startup, never a remembered choice.

     These were persisted at first, like the volume and the settings are. That
     was wrong for this one: the colours belong to whoever is playing tonight,
     and a pair chosen by last week's contestants coming back up is a puzzle
     rather than a convenience. A colour lasts for the session it was picked
     in and no longer.

     Any value stored by the earlier version is removed rather than merely
     ignored, so it cannot sit in a browser resurrecting itself if this is
     ever changed back. */
  teamColours = T.defaults.slice();
  try { localStorage.removeItem(T.storageKey); } catch (e) { /* fine */ }

  const row = document.querySelector('#setup .row');
  const fields = [document.getElementById('teamA'), document.getElementById('teamB')];
  if (!row || !fields[0]) {
    /* No title screen - the game was started straight into. Still push the
       stored colours through so the tubes and panels are right. */
    teamColours.forEach(function (hex, i) { setTeamColour(i, hex); });
    return;
  }

  /* 67px is the name field's height, set in index.html. align-self:stretch
     would match it automatically, but the swatch also needs a WIDTH, and
     taking both from the same number keeps the pair square to each other. */
  const H = 67;
  for (let i = 0; i < 2; i++) {
    const swatch = document.createElement('div');
    swatch.title = 'Choose this team\'s colour';
    /* Pulled in toward its own field by the difference between the row's gap
       and the gap wanted here - the row's 22px is right between the two name
       fields and too far for a button that belongs to one of them. */
    const pull = -(22 - T.swatchGapPx);
    swatch.style.cssText =
      'align-self:stretch;flex:0 0 auto;cursor:pointer;box-sizing:border-box;' +
      'width:' + Math.round(T.swatchWidth * H) + 'px;border-radius:6px;' +
      'border:2px solid rgba(255,255,255,0.75);' +
      'box-shadow:0 2px 6px rgba(0,0,0,.55);' +
      'background:linear-gradient(180deg,' + T.swatchGradient.join(',') + ');' +
      (i === 0 ? 'margin-right:' : 'margin-left:') + pull + 'px;';

    /* The browser's own picker: a wheel and a square, on every platform,
       for no code. It is an OS window rather than part of the machine, which
       is the trade - this is a setup control used once a session. */
    const picker = document.createElement('input');
    picker.type = 'color';
    picker.style.cssText =
      'position:absolute;width:0;height:0;opacity:0;pointer-events:none;';
    picker.addEventListener('input', function () {
      setTeamColour(i, parseInt(picker.value.slice(1), 16));
    });
    swatch.addEventListener('pointerdown', function (e) {
      e.stopPropagation();
      picker.click();
    });

    teamSwatch[i] = swatch;
    teamPicker[i] = picker;
    row.appendChild(picker);
    /* Outside edges: before the first field, after the second. */
    if (i === 0) row.insertBefore(swatch, fields[0]);
    else row.appendChild(swatch);
  }

  teamColours.forEach(function (hex, i) { setTeamColour(i, hex); });
}

/* ===========================================================================
   THE MOUSE POINTER

   The arrow becomes a white hand. See CFG.cursor for why this is code rather
   than a line of CSS: a cursor is drawn by the operating system, not by the
   page, so neither its SIZE nor its SHADOW can be reached from a stylesheet.
   Both have to be inside the image, which means building the image here.

   The hand is applied with !important, deliberately. Nearly every control in
   this file sets cursor:pointer in its own inline style, and an inline style
   beats an ordinary rule in a stylesheet - but not an important one. Without
   it the pointer would flip between this hand and the browser's own hand
   depending on what it happened to be over, which looks like a bug.
   ========================================================================= */
function applyCursor() {
  const C = CFG.cursor;
  if (!C || !C.enabled) return;

  loadSvgText(C.src).then(function (text) {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const svg = doc.documentElement;

    /* Chrome ignores anything larger than 128 and silently gives you the
       ordinary arrow back, which looks like the cursor simply failed. */
    const size = Math.max(8, Math.min(128, Math.round(C.size)));
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);

    const S = C.shadow;
    const drop = doc.querySelector('feDropShadow');
    if (!S || S.enabled === false) {
      /* The FILTER REFERENCE comes off, not the feDropShadow inside it. A
         filter left with no primitives in it renders nothing at all, so
         removing the wrong one would produce an invisible cursor. */
      const g = doc.querySelector('g[filter]');
      if (g) g.removeAttribute('filter');
    } else if (drop) {
      drop.setAttribute('dx', S.dx);
      drop.setAttribute('dy', S.dy);
      drop.setAttribute('stdDeviation', S.blur);
      drop.setAttribute('flood-opacity', S.opacity);
    }

    /* Double quotes are the one thing encodeURIComponent escapes that matters
       here, which is what makes url("...") safe to build by hand. */
    const url = 'data:image/svg+xml;charset=utf-8,' +
                encodeURIComponent(new XMLSerializer().serializeToString(svg));

    const hx = Math.round(C.hotspotX * size);
    const hy = Math.round(C.hotspotY * size);
    const hand = 'url("' + url + '") ' + hx + ' ' + hy + ', auto';

    let tag = document.getElementById('cursorStyle');
    if (!tag) {
      tag = document.createElement('style');
      tag.id = 'cursorStyle';
      document.head.appendChild(tag);
    }
    /* The two name fields keep their text beam. It is not the arrow being
       replaced - it is the one cursor on the screen that says "you can type
       in here", and a hand over a text box reads as a button. */
    tag.textContent =
      '*, *::before, *::after { cursor: ' + hand + ' !important; }' +
      'input:not([type]), input[type="text"], textarea' +
      ' { cursor: text !important; }';
  }).catch(function () {
    /* A missing or unreadable file must cost nothing worse than the ordinary
       arrow. There is no sensible half-measure to fall back to. */
  });
}

function makeHud() {
  hud = document.createElement('div');
  hud.style.cssText =
    'position:fixed;left:12px;top:10px;z-index:20;font:13px/1.6 ui-monospace,Consolas,monospace;' +
    'color:#EDE7FA;background:rgba(11,6,22,.66);padding:8px 12px;border-radius:8px;' +
    'pointer-events:none;white-space:nowrap';
  document.body.appendChild(hud);
}

function onResize() {
  const host = document.getElementById('game');
  camera.aspect = host.clientWidth / host.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(host.clientWidth, host.clientHeight);
  aimCamera();                       // re-fit: the screen shape just changed
}

window.startCoinPusher = function (teamA, teamB) {

  /* The title screen is over. */
  stopTitleMusic();

  /* And the intro goes up NOW, not after the world is ready - everything
     below this line runs behind it. */
  playIntro();

  /* The START click is the user gesture the browser demands before a page is
     allowed to make any noise at all. There is no second chance at this: an
     AudioContext created anywhere else starts suspended and stays that way
     until the next click, so it is created here and nowhere else. */
  initAudio();

  /* The f64 bundle inlines its wasm and needs no init; the compat build does.
     Tolerate both so the vendor file can be swapped without touching this. */
  const ready = RAPIER.init ? RAPIER.init() : Promise.resolve();
  return ready.then(function () {
    buildScene();
    makeRightColumn();
    makePointsBox();
    makeButtonRow();
    makeHud();

    ctx = {
      RAPIER: RAPIER,
      THREE: THREE,
      world: buildWorld(),
      scene: scene,
      items: [],
      teams: [
        { name: teamA || 'Team 1', score: 0, log: [] },
        { name: teamB || 'Team 2', score: 0, log: [] }
      ]
      /* No activeTeam here. There was one, unused, and it would now be a
         second place for whose turn it is to live - the team highlight is
         that, and it is also what is lit on the machine, so the two cannot
         disagree. */
    };

    /* Contact-force events for the audio. Only colliders that ask for them
       report - currently just the chute pegs - so this queue stays short.
       Deliberately NOT inside buildWorld's try/catch: if this ever throws it
       should be loud, not swallowed as an old-Rapier fallback. */
    ctx.eventQueue = new RAPIER.EventQueue(true);

    ctx.machine = buildMachine(ctx);

    /* Before resetPile, so the probe sees the machine and not the coins. */
    captureWidthProbe();
    aimCamera();

    /* Everything solid RECEIVES. Almost nothing casts.

       The shadows that matter are the ones items drop onto the deck and the
       platform - those are the contact cue. The cabinet walls and the drop
       panels behind them cast nothing anyone can see, and having all hundred
       meshes cast cost two thirds of the frame rate for no visible gain.

       Skipped entirely: the glass panes and the invisible click targets,
       which are transparent - a transparent caster drops a solid black
       shadow as though it were opaque. */
    scene.traverse(function (o) {
      if (!o.isMesh) return;
      const m = o.material;
      if (m && m.transparent && m.opacity < 0.9) return;
      o.castShadow = false;
      o.receiveShadow = true;
    });

    /* The shelf casts: its front face throws a shadow across the platform as
       it advances, which is the one piece of machine geometry whose shadow
       actually tells you something. Items cast too - set in createItem. */
    ctx.machine.shelves.forEach(function (sh) { sh.mesh.castShadow = true; });

    resetPile();

    /* Host interaction: a click on one of the four chutes. Hit-tested against
       invisible planes standing in front of the glass, never against the pile
       or the shelf. */
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    renderer.domElement.addEventListener('pointerdown', function (e) {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1
      );
      ray.setFromCamera(ndc, camera);

      /* Placement first: while it is armed, a click on the machine puts a
         present down rather than doing whatever it would normally do. */
      if (placingType) {
        const pt = placementPoint(ray);
        if (pt) {
          e.stopPropagation();
          placeItem(placingType, pt.x, pt.y, pt.z, dropHeightFor(placingType));
          setPlacing(null);
          return;
        }
      }

      const hits = ray.intersectObjects(ctx.machine.panels, false);
      if (hits.length) {
        /* A drop zone is not "somewhere else". Letting this bubble would hit
           the document handler and clear the team highlight the moment the
           host started playing, which is exactly when they want to still see
           whose turn it is. Clicking the cabinet or the background still
           clears it, because those genuinely are somewhere else. */
        e.stopPropagation();
        selectZone(hits[0].object.userData.zone);
      }
    });

    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', function (e) {
      /* Not while typing. The number keys drop coins, R resets the pile and
         SPACE pauses the machine - so without this, typing 1 into the points
         box would drop a coin, and typing 0 would do nothing but the 4 before
         it would have dropped another. */
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
                t.isContentEditable)) return;
      if (e.key >= '1' && e.key <= '4') selectZone(parseInt(e.key, 10) - 1);
      else if (e.key === 'r' || e.key === 'R') resetPile();
      else if (e.key === 's' || e.key === 'S') {
        const was = running; running = true; physicsStep(); running = was;
      } else if (e.code === 'Space') { running = !running; e.preventDefault(); }
      /* Audition every voice at three strengths, for judging the sounds by
         ear without having to coax the machine into producing each one. */
      else if (e.key === 'z' || e.key === 'Z') auditionAll();
      /* The way out of an armed placement. The present and jackpot buttons
         glow while they are waiting and can be pressed again to cancel;
         PLACE COIN closes the menu behind it and leaves nothing to press, so
         without this there would be no way to change your mind short of
         putting a coin somewhere you did not want one. */
      else if (e.key === 'Escape') setPlacing(null);
    });

    /* Live tuning from the browser console, as the 2D build had. */
    window.CP = {
      ctx: ctx, DIMS: DIMS, TIERS: TIERS, CFG: CFG, M: M,
      camera: camera, aimCamera: aimCamera, resetPile: resetPile,
      /* A getter, not a value: the backdrop module is fetched
         asynchronously and may not have arrived when CP is built. */
      get backdrop() { return backdrop; },
      renderer: renderer, scene: scene,

      /* Rebuild the pile from a fixed seed, so a measurement can be repeated.

         Worth having, because without it nothing here is measurable. The
         starting pile is randomised, and the run-to-run spread that causes is
         larger than most of the effects worth chasing: the SAME settings,
         measured six times, gave 2, 9, 4, 1, 11 and 1 coins visibly moving.
         Averaging over a fixed panel of seeds turns a coin flip into a
         result. */
      resetPileSeeded: function (seed) {
        const real = Math.random;
        let s = seed >>> 0;
        Math.random = function () {
          s = (s * 1664525 + 1013904223) >>> 0;
          return s / 4294967296;
        };
        try { resetPile(); } finally { Math.random = real; }
      },
      step: physicsStep,

      /* The turn's doubling, and a way to exercise the scoring without
         waiting for physics. Same spirit as setScore above: award() is the
         real function, so a test here is testing what the game runs, and the
         arithmetic that makes order irrelevant can be checked in a second
         rather than by dropping coins for ten minutes. */
      get turnMultiplier() { return turnMultiplier; },
      get turnSubtotal()   { return turnSubtotal; },
      selectTeam: setTeamHighlight,
      awardItem: function (typeId) { award({ typeId: typeId }); },
      nextDropType: nextDropType,
      startFlash: startDoublerFlash,
      get flashLeft() { return flashSeq.length - flashIndex; },
      setTubeColour: function (i, hex) { return setTubeColour(ctx, i, hex); },
      /* Set a team's score and redraw its panel at once. The panels are
         normally refreshed by the render loop, which is no use for testing
         them with the loop stopped. */
      setScore: function (i, v) {
        if (ctx.teams[i]) ctx.teams[i].score = v;
        updateScoreboards();
      },
      boards: function () { return boards; },
      refreshScores: updateScoreboards,
      dropInto: dropInto,
      selectZone: selectZone,
      armedZone: armedZoneIndex,
      teamHighlight: teamHighlightIndex,
      setTeamHighlight: setTeamHighlight,
      litZone: function () { return litZone; },
      setRunning: function (v) { running = v; },
      setAutoStep: function (v) { autoStep = v; },
      audio: { play: play, audition: auditionAll, ready: audioReady,
               setVolume: setMasterVolume, kinds: VOICE_KINDS },
      createItem: function (typeId, x, y, z, yaw, opts) {
        const it = createItem(ctx, typeId, x, y, z, yaw, opts);
        scene.add(it.mesh);
        return it;
      },
      clearItems: function () {
        ctx.items.forEach(function (it) {
          scene.remove(it.mesh);
          ctx.world.removeRigidBody(it.body);
        });
        ctx.items.length = 0;
      },
      getPhase: function () { return phase; }
    };

    last = performance.now();
    requestAnimationFrame(frame);
  });
};

/* The title screen is already on screen by the time this module finishes
   loading - index.html imports it before anyone can press START - so both of
   these belong here rather than in the game's own setup.

   ORDER MATTERS. makeVolumeControl reads the stored level into volumeLevel,
   and startTitleMusic scales itself by exactly that; the other way round and
   the music would come in at full and only settle when the slider was next
   touched. The music will not actually sound until the browser has seen a
   gesture - see startTitleMusic for how that is handled. */
applyCursor();
makeVolumeControl();
makeSettings();
makeTeamColourPickers();
startTitleMusic();
prepareIntro();

/* The background, behind the title screen. The game's renderer does not exist
   yet - it is built on START - so this runs on a canvas of its own until the
   real one takes over.

   The setup panel paints itself black in index.html, which would hide it. It
   is cleared here rather than there because index.html is the file the
   cache-buster cannot reach: changed there, a stale copy would leave a black
   panel over a background that is running perfectly well underneath. */
backdropModule.then(function (mod) {
  const setup = document.getElementById('setup');
  if (setup) setup.style.background = 'transparent';
  titleBackdrop = mod.createBackdropCanvas(CFG.backdrop);
}).catch(function (err) {
  console.warn('[backdrop] title screen not loaded:', err);
});
