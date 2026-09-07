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
import { buildStartingPile, createItem, quatOnEdge } from '@app/items';
import { initAudio, auditionAll, play, audioReady, setMasterVolume,
         coinReady, hasSample, playMusic, stopMusic, VOICE_KINDS } from '@app/audio';

const CFG = window.COIN_PUSHER_CONFIG;
const PHY = CFG.physics;

let ctx = null;
let renderer, scene, camera, hud;
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
function collectFallen() {
  for (let i = ctx.items.length - 1; i >= 0; i--) {
    const it = ctx.items[i];
    const t = it.body.translation();
    if (t.y < DIMS.tierLast.y - DIMS.D) {
      M.fallen++;
      /* Something went over the edge - the moment the music was held for. */
      endResolve();
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
function nextDropType() {
  const d = CFG.dropItem;
  if (typeof d === 'string') return d;
  return d[dropTurn++ % d.length];
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
let armedZone = -1;          // -1 when nothing is armed
let resolving = false;
/* Both are STEP COUNTS, not wall-clock times.

   Wall clock was tried and is wrong here. The countdown has to run on the same
   clock as the machine: tie it to real time and a paused or backgrounded game
   keeps counting down while nothing moves, so the music expires against a
   frozen playfield and, on resume, a drop that never happened is already over.
   Counting steps means the timer only advances when the coin does. */
let resolveDeadline = 0;     // stepCount at which to give up; 0 when not resolving
let resolveEarliest = 0;     // before this step, a fall is not the payoff

function paintZones() {
  const A = CFG.arming;
  const lit = CFG.palette.panelGlow;
  for (let i = 0; i < DIMS.zoneCount; i++) {
    const on = armedZone < 0 || i === armedZone;
    if (on) setZoneColour(ctx, i, lit, lit, A.litEmissive);
    else    setZoneColour(ctx, i, A.dimmedColour, A.dimmedGlow, A.dimmedEmissive);
  }
}

/* The host pointed at a zone. Whether that arms it or releases it depends on
   what is already armed. */
export function selectZone(zone) {
  const A = CFG.arming;
  if (!A || !A.enabled) { dropInto(zone); return; }
  if (zone < 0 || zone >= DIMS.zoneCount) return;

  if (armedZone === zone) {                 // release
    armedZone = -1;
    paintZones();
    play('drop', 1, 0);
    dropInto(zone);
    /* The music does NOT stop here. It carries on through the fall. */
    resolving = true;
    resolveEarliest = stepCount + A.minResolveSeconds    / PHY.timestep;
    resolveDeadline = stepCount + A.resolveTimeoutSeconds / PHY.timestep;
    return;
  }

  if (armedZone >= 0 && !A.reArmOnOtherZone) return;

  armedZone = zone;                          // arm, or move the selection
  resolving = false;
  resolveDeadline = 0;
  resolveEarliest = 0;
  paintZones();
  playMusic('tense', { loop: true });
}

/* Called when a coin goes over the front edge - the payoff the music has been
   waiting for - and from the timeout, so a drop that delivers nothing does not
   leave the bed running for ever. */
function endResolve(fromTimeout) {
  if (!resolving) return;
  /* A coin going over the edge in the first couple of seconds is one the
     pusher was already carrying, not the payoff for this drop. Ignore it. */
  if (!fromTimeout && stepCount < resolveEarliest) return;
  resolving = false;
  resolveDeadline = 0;
  resolveEarliest = 0;
  if (armedZone < 0) stopMusic(0.35);
}

function tickArming() {
  if (!resolving || !resolveDeadline) return;
  if (stepCount >= resolveDeadline) endResolve(true);
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

    if (a) {
      if (!a.hitWindow) a.hitWindow = { at: stepCount, peak: 0, voice: 'surface' };
      if (metal) a.hitWindow.voice = 'peg';
    }
    if (b) {
      if (!b.hitWindow) b.hitWindow = { at: stepCount, peak: 0, voice: 'surface' };
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

    /* A hard hit does not wait - it would be audibly late. Only the ones that
       start softly and bloom are held for the window to close. */
    const done = win.peak >= A.surfaceImmediateImpact ||
                 stepCount - win.at >= A.surfaceWindowSteps;
    if (!done) continue;

    it.hitWindow = null;
    if (win.peak < A.surfaceMinImpact) continue;
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
  updateHud();
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
function makeLogo() {
  const L = CFG.logo;
  if (!L || !L.enabled) return;

  const img = document.createElement('img');
  img.src = L.src;
  img.alt = '';
  img.style.cssText =
    'position:fixed;z-index:10;pointer-events:none;' +
    'left:' + ((L.centreAtScreenX - L.widthFraction / 2) * 100).toFixed(3) + '%;' +
    'top:' + (L.topFraction * 100).toFixed(3) + '%;' +
    'width:' + (L.widthFraction * 100).toFixed(3) + '%;' +
    'height:auto;opacity:' + L.opacity + ';';
  document.body.appendChild(img);
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
    makeLogo();
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
      ],
      activeTeam: 0
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
      const hits = ray.intersectObjects(ctx.machine.panels, false);
      if (hits.length) selectZone(hits[0].object.userData.zone);
    });

    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', function (e) {
      if (e.key >= '1' && e.key <= '4') selectZone(parseInt(e.key, 10) - 1);
      else if (e.key === 'r' || e.key === 'R') resetPile();
      else if (e.key === 's' || e.key === 'S') {
        const was = running; running = true; physicsStep(); running = was;
      } else if (e.code === 'Space') { running = !running; e.preventDefault(); }
      /* Audition every voice at three strengths, for judging the sounds by
         ear without having to coax the machine into producing each one. */
      else if (e.key === 'z' || e.key === 'Z') auditionAll();
    });

    /* Live tuning from the browser console, as the 2D build had. */
    window.CP = {
      ctx: ctx, DIMS: DIMS, TIERS: TIERS, CFG: CFG, M: M,
      camera: camera, aimCamera: aimCamera, resetPile: resetPile,

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
      setTubeColour: function (i, hex) { return setTubeColour(ctx, i, hex); },
      dropInto: dropInto,
      selectZone: selectZone,
      armedZone: armedZoneIndex,
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
