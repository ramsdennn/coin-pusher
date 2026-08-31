/* ============================================================================
   ITEMS
   Coins, tokens and prizes: one Three.js mesh and one Rapier body each, kept
   in a flat list that the render loop syncs every frame.
   ========================================================================= */

import * as THREE from 'three';
import { DIMS, TIERS } from '@app/dims';

const CFG = window.COIN_PUSHER_CONFIG;
const PHY = CFG.physics;

const geoCache = {};
const matCache = {};

function geometryFor(typeId) {
  if (geoCache[typeId]) return geoCache[typeId];
  const d = DIMS.itemDims(typeId);
  const g = d.shape === 'box'
    ? new THREE.BoxGeometry(d.hx * 2, d.hy * 2, d.hz * 2)
    : new THREE.CylinderGeometry(d.radius, d.radius, d.height, 22);
  geoCache[typeId] = g;
  return g;
}

function materialFor(typeId) {
  if (matCache[typeId]) return matCache[typeId];
  const m = new THREE.MeshStandardMaterial({
    color: CFG.itemTypes[typeId].color,
    roughness: 0.45,
    metalness: 0.25
  });
  matCache[typeId] = m;
  return m;
}

export function createItem(ctx, typeId, x, y, z, yaw) {
  const type = CFG.itemTypes[typeId];
  const d = DIMS.itemDims(typeId);

  const mesh = new THREE.Mesh(geometryFor(typeId), materialFor(typeId));
  mesh.position.set(x, y, z);
  mesh.rotation.y = yaw || 0;
  ctx.scene.add(mesh);

  const body = ctx.world.createRigidBody(
    ctx.RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z)
      .setRotation(quatFromYaw(yaw || 0))
      .setCanSleep(PHY.allowSleep)
      /* See physics.angularDamping in config: this is standing in for
         spin friction, not papering over a missing rule. */
      .setLinearDamping(PHY.linearDamping)
      .setAngularDamping(PHY.angularDamping)
  );

  const desc = d.shape === 'box'
    ? ctx.RAPIER.ColliderDesc.cuboid(d.hx, d.hy, d.hz)
    : discCollider(ctx, d);

  ctx.world.createCollider(
    desc.setDensity(type.density)
      .setFriction(PHY.itemFriction)
      .setRestitution(PHY.itemRestitution),
    body
  );

  const item = { typeId: typeId, mesh: mesh, body: body, dims: d };
  ctx.items.push(item);
  return item;
}

/* A disc as an N-sided prism. See physics.discColliderSides in config for
   why this is not just ColliderDesc.cylinder(). */
function discCollider(ctx, d) {
  const n = PHY.discColliderSides | 0;
  if (n < 3) return ctx.RAPIER.ColliderDesc.cylinder(d.halfHeight, d.radius);

  /* Circumscribe, so the prism has the same width across the flats as the
     drawn cylinder does across its diameter and the pile packs the same. */
  const r = d.radius / Math.cos(Math.PI / n);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    pts.push(x, d.halfHeight, z, x, -d.halfHeight, z);
  }
  return ctx.RAPIER.ColliderDesc.convexHull(new Float32Array(pts));
}

function quatFromYaw(yaw) {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

/* --------------------------------------------------------------------------
   THE STARTING PILE
   Laid out from the front lip backwards, so the machine begins primed - close
   to the tipping line but not spilling. Packed row by row, because items are
   not all the same size and a fixed grid would either overlap the wide ones
   or waste space around the narrow ones.

   Everything starts with a hair of air under it and settles under gravity.
   Nothing is placed interpenetrating, which is the usual way to make a solver
   explode on frame one.
   -------------------------------------------------------------------------- */
export function buildStartingPile(ctx) {
  const D = DIMS.D;
  const margin = D * 0.35;
  const usableWidth = DIMS.width - D * 0.5;

  TIERS.forEach(function (tier, tierIdx) {
    const queue = [];
    CFG.startingLayout.forEach(function (entry) {
      if (entry.tier !== tierIdx + 1) return;
      for (let i = 0; i < entry.count; i++) queue.push(entry.type);
    });
    shuffle(queue);

    let layer = 0;
    let rowZ = tier.lipZ - margin;
    let rowDepth = 0;
    let cursorX = -usableWidth / 2;
    let layerTopY = tier.y;

    queue.forEach(function (typeId) {
      const d = DIMS.itemDims(typeId);
      const w = d.shape === 'box' ? d.hx * 2 : d.footprint;
      const dep = d.shape === 'box' ? d.hz * 2 : d.footprint;
      const h = d.shape === 'box' ? d.hy * 2 : d.height;

      /* Wrap to a new row when this one is full. */
      if (cursorX + w > usableWidth / 2) {
        cursorX = -usableWidth / 2;
        rowZ -= rowDepth * 0.82;
        rowDepth = 0;
      }

      /* Ran out of tier depth: start another layer on top. The reference
         machine's pile is more than one coin deep in places, so this is
         wanted, not a fallback. */
      if (rowZ - dep < tier.backZ + margin) {
        layer++;
        layerTopY += D * 0.14;
        rowZ = tier.lipZ - margin;
        rowDepth = 0;
        cursorX = -usableWidth / 2;
      }

      /* Staggered drop heights are what stop this looking like a tidy
         grid. Items land on each other and jumble, the way a real
         primed machine looks, and none of them start interpenetrating
         - which is the usual way to make a solver explode on frame 1. */
      const cx = cursorX + w / 2 + jitter(D * 0.07);
      const cz = rowZ - dep / 2 + jitter(D * 0.07);
      /* Behind the deck's leading edge the resting surface is the deck top,
         which with a stepped deck is higher than the fixed floor. */
      const surface = cz < tier.shelfHomeZ ? layerTopY + DIMS.deckStep : layerTopY;
      const cy = surface + h / 2 + D * (0.03 + Math.random() * 0.38);

      createItem(ctx, typeId, cx, cy, cz,
        d.shape === 'box' ? jitter(0.05) : Math.random() * Math.PI * 2);

      cursorX += w * 0.84;
      rowDepth = Math.max(rowDepth, dep);
    });
  });
}

function jitter(a) { return (Math.random() * 2 - 1) * a; }

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}
