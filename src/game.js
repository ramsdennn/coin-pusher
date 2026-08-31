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
import { buildStartingPile, createItem } from '@app/items';

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
function aimCamera() {
  const c = CFG.camera;
  const el = (c.elevationDeg * Math.PI) / 180;
  const target = new THREE.Vector3(0, c.lookAt.y, DIMS.playDepth * c.lookAt.zFraction);
  camera.position.set(
    0,
    target.y + Math.sin(el) * c.distance,
    target.z + Math.cos(el) * c.distance
  );
  camera.lookAt(target);
}

function buildWorld() {
  const world = new RAPIER.World({ x: 0, y: PHY.gravity, z: 0 });
  world.timestep = PHY.timestep;
  try { world.numSolverIterations = PHY.solverIterations; } catch (e) { /* older Rapier */ }
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
function tierOf(y) { return y > DIMS.tier1.y - DIMS.D * 0.5 ? 0 : 1; }

function centroidZ() {
  const sum = [0, 0], n = [0, 0];
  for (let i = 0; i < ctx.items.length; i++) {
    const t = ctx.items[i].body.translation();
    if (t.y < DIMS.tier2.y - DIMS.D) continue;      // in the tray, not on a tier
    const k = tierOf(t.y);
    sum[k] += t.z; n[k]++;
  }
  return [n[0] ? sum[0] / n[0] : null, n[1] ? sum[1] / n[1] : null];
}

function push(arr, v) { arr.push(v); if (arr.length > 20) arr.shift(); }
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
    if (t.y < DIMS.tier2.y - DIMS.D) {
      M.fallen++;
      M.fallenByType[it.typeId] = (M.fallenByType[it.typeId] || 0) + 1;
      scene.remove(it.mesh);
      ctx.world.removeRigidBody(it.body);
      ctx.items.splice(i, 1);
    }
  }
}

/* -------------------------------------------------------------------------
   A drop. No chute and no pegs yet - this just puts an item in at the back of
   the top tier so the machine has input flow, which is the only condition
   under which "does the pile advance" is a meaningful question. The peg field
   and the four glass chutes come next; this is deliberately the crudest thing
   that lets the shelf be measured.
   ------------------------------------------------------------------------- */
export function dropInto(zone) {
  const x = DIMS.zoneCentresX[Math.max(0, Math.min(3, zone | 0))];
  return createItem(
    ctx, CFG.dropItem,
    x + (Math.random() * 2 - 1) * DIMS.D * 0.15,
    DIMS.tier1.y + DIMS.D * 2.5,
    DIMS.tier1.backZ + DIMS.D * 0.9,
    Math.random() * Math.PI * 2
  );
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

    if (M.atForward === null) M.atForward = centroidZ()[1];

    /* Sample the pile at each end of the stroke. 0 -> 0.5 is the deck
       withdrawing, 0.5 -> 1 is it advancing. */
    if (prev < 0.5 && phase >= 0.5) {
      const c = centroidZ();
      if (M.atForward !== null && c[1] !== null) push(M.retract, c[1] - M.atForward);
      M.atBack = c[1];
    }
    if (phase < prev) {                              // wrapped past 0
      const c = centroidZ();
      if (M.atBack !== null && c[1] !== null) push(M.extend, c[1] - M.atBack);
      if (M.atForward !== null && c[1] !== null) push(M.creep, c[1] - M.atForward);
      M.atForward = c[1];
      M.strokes++;
    }
  }

  ctx.world.step();
  stepCount++;
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
