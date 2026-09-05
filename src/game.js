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
import { buildMachine, driveShelves, liftTrapped, setTubeColour } from '@app/machine';
import { buildStartingPile, createItem, quatOnEdge } from '@app/items';

const CFG = window.COIN_PUSHER_CONFIG;
const PHY = CFG.physics;

let ctx = null;
let renderer, scene, camera, hud;
let acc = 0, last = 0, fps = 0;
let stepCount = 0, presettleSteps = 0;
let phase = 0, running = CFG.shelf.startRunning;

const M = {
  strokes: 0,
  fallen: 0,
  fallenByType: {},
  dropped: 0,
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

function aimCamera() {
  const c = CFG.camera;
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
    for (let i = 0; i < pts.length; i++) {
      const v = pts[i].clone().project(camera);
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
      worstX = Math.max(worstX, Math.abs(v.x));
    }

    /* Nudge the aim so the content's vertical mid-point sits on the centreline. */
    const midY = (maxY + minY) / 2;
    const spanY = Math.max(maxY - minY, 1e-3);
    target.y += midY * (worldSpan / spanY);

    const worst = Math.max(worstX, Math.abs(maxY - midY), Math.abs(minY - midY));
    if (Math.abs(worst - c.fitMargin) < 0.005 && Math.abs(midY) < 0.01) {
      place(d);
      break;
    }
    d = Math.max(0.3, d * (worst / c.fitMargin));
    place(d);
  }
}

function buildWorld() {
  const world = new RAPIER.World({ x: 0, y: PHY.gravity, z: 0 });
  world.timestep = PHY.timestep;
  try { world.numSolverIterations = PHY.solverIterations; } catch (e) { /* older Rapier */ }
  try {
    world.integrationParameters.lengthUnit = PHY.lengthUnit;
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
export function dropInto(zone) {
  const z = Math.max(0, Math.min(DIMS.zoneCount - 1, zone | 0));
  const jitter = (Math.random() * 2 - 1) * DIMS.D * CFG.chute.entryJitterInCoins;

  const item = createItem(
    ctx, CFG.dropItem,
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

  ctx.world.step();
  stepCount++;
  M.lifted += liftTrapped(ctx);
  trackChute();
  collectFallen();
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
  while (acc >= PHY.timestep && steps < 5) {
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
  return RAPIER.init().then(function () {
    buildScene();
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

    ctx.machine = buildMachine(ctx);

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
      if (o.userData.noShadow) return;
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
      if (hits.length) dropInto(hits[0].object.userData.zone);
    });

    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', function (e) {
      if (e.key >= '1' && e.key <= '4') dropInto(parseInt(e.key, 10) - 1);
      else if (e.key === 'r' || e.key === 'R') resetPile();
      else if (e.key === 's' || e.key === 'S') {
        const was = running; running = true; physicsStep(); running = was;
      } else if (e.code === 'Space') { running = !running; e.preventDefault(); }
    });

    /* Live tuning from the browser console, as the 2D build had. */
    window.CP = {
      ctx: ctx, DIMS: DIMS, TIERS: TIERS, CFG: CFG, M: M,
      camera: camera, aimCamera: aimCamera, resetPile: resetPile,
      step: physicsStep,
      setTubeColour: function (i, hex) { return setTubeColour(ctx, i, hex); },
      dropInto: dropInto,
      setRunning: function (v) { running = v; },
      getPhase: function () { return phase; }
    };

    last = performance.now();
    requestAnimationFrame(frame);
  });
};
