/* ============================================================================
   COIN PUSHER - entry point

   This pass builds the machine, points a fixed camera at it, and drops the
   starting pile in to settle. No shelf motion, no drop chute, no scoring yet:
   those come next, and they come next deliberately. If the scale or the
   colliders are wrong, it shows up here, with nothing else moving to confuse
   the diagnosis.
   ========================================================================= */

import * as THREE from 'three';
import * as RAPIER from 'rapier';
import { DIMS, TIERS } from '@app/dims';
import { buildMachine } from '@app/machine';
import { buildStartingPile } from '@app/items';

const CFG = window.COIN_PUSHER_CONFIG;
const PHY = CFG.physics;

let ctx = null;
let renderer, scene, camera, hud;
let acc = 0, last = 0, fps = 0, settledAt = null, stepCount = 0, presettleSteps = 0;

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
  settledAt = null;
  stepCount = 0;
  presettle();
}

/* Step the pile to rest before anyone looks at it, so the machine is already
   settled when the host sees it rather than shivering for twenty seconds.

   Damping is cranked up for the duration and put back afterwards. That is an
   initial condition, not a physics rule: it only decides how the pile arrives,
   and the pile has been checked to stay asleep once normal damping returns. */
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
    ctx.world.step();
    stepCount++;
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
}

/* -------------------------------------------------------------------------
   Debug readout. This pass is a physics sanity check, so the numbers that
   matter are: does everything fall asleep, does anything escape, and how
   long the settle takes.
   ------------------------------------------------------------------------- */
function updateHud() {
  let awake = 0, lowest = Infinity, escaped = 0;
  for (let i = 0; i < ctx.items.length; i++) {
    const it = ctx.items[i];
    if (!it.body.isSleeping()) awake++;
    const t = it.body.translation();
    if (t.y < lowest) lowest = t.y;
    if (Math.abs(t.x) > DIMS.width || t.y < DIMS.trayY - 0.5 || t.z > DIMS.playDepth + 1) escaped++;
  }

  if (awake === 0 && settledAt === null && ctx.items.length > 0) {
    settledAt = stepCount * PHY.timestep;
  }

  hud.innerHTML =
    '<b>fps</b> ' + fps.toFixed(0) +
    ' &nbsp; <b>items</b> ' + ctx.items.length +
    ' &nbsp; <b>awake</b> ' + awake +
    ' &nbsp; <b>lowest y</b> ' + (isFinite(lowest) ? lowest.toFixed(3) : '-') +
    ' &nbsp; <b>settled</b> ' + (settledAt === null ? 'no' : settledAt.toFixed(2) + 's') +
    ' &nbsp; <b>presettle</b> ' + presettleSteps + ' steps' +
    (escaped ? ' &nbsp; <b style="color:#ff6b6b">ESCAPED ' + escaped + '</b>' : '') +
    '<br><span style="opacity:.55">R reset pile &middot; ' +
    DIMS.width.toFixed(2) + ' wide x ' + DIMS.playDepth.toFixed(2) + ' deep &middot; ' +
    'coin ' + DIMS.D + ' &middot; stroke ' + DIMS.stroke.toFixed(3) + '</span>';
}

function makeHud() {
  hud = document.createElement('div');
  hud.style.cssText =
    'position:fixed;left:12px;top:10px;z-index:20;font:13px/1.5 ui-monospace,Consolas,monospace;' +
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
      if (e.key === 'r' || e.key === 'R') resetPile();
    });

    /* Live tuning from the browser console, as the 2D build had. */
    window.CP = { ctx: ctx, DIMS: DIMS, TIERS: TIERS, CFG: CFG, camera: camera, aimCamera: aimCamera, resetPile: resetPile };

    last = performance.now();
    requestAnimationFrame(frame);
  });
};
