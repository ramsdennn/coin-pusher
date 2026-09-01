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
import { buildMachine, driveShelves } from '@app/machine';
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
  host.appendChild(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x3a2a4a, 1.5));
  const key = new THREE.DirectionalLight(0xffffff, 1.7);
  key.position.set(1.4, 3.2, 3.0);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xbfd4ff, 0.5);
  fill.position.set(-2.0, 1.6, 0.6);
  scene.add(fill);
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

  /* Pull back until every corner of the machine is inside the frame. A few
     passes is plenty - moving the camera back shrinks the projection close
     enough to proportionally for this to converge fast. */
  const pts = fitPoints();
  for (let pass = 0; pass < 5; pass++) {
    let worst = 0;
    for (let i = 0; i < pts.length; i++) {
      const v = pts[i].clone().project(camera);
      worst = Math.max(worst, Math.abs(v.x), Math.abs(v.y));
    }
    if (Math.abs(worst - c.fitMargin) < 0.01) break;
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
  M.dropped = 0; M.landed = 0; M.jammed = 0; M.fallSteps = []; M.landX = [];
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

function syncMeshes() {
  for (let i = 0; i < ctx.items.length; i++) {
    const it = ctx.items[i];
    const t = it.body.translation();
    const r = it.body.rotation();
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
      dropInto: dropInto,
      setRunning: function (v) { running = v; },
      getPhase: function () { return phase; }
    };

    last = performance.now();
    requestAnimationFrame(frame);
  });
};
