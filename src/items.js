/* ============================================================================
   ITEMS
   Coins, tokens and prizes: one Three.js mesh and one Rapier body each, kept
   in a flat list that the render loop syncs every frame.
   ========================================================================= */

import * as THREE from 'three';
import { DIMS, TIERS } from '@app/dims';
import { GROUP_ITEM } from '@app/machine';

const CFG = window.COIN_PUSHER_CONFIG;
const PHY = CFG.physics;
const S = CFG.scale;

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
  const type = CFG.itemTypes[typeId];
  const f = type.finish || {};
  const m = new THREE.MeshStandardMaterial({
    color: type.color,
    /* Defaults are the old metal-token finish, so a type that says nothing
       about its surface looks exactly as it did before. */
    roughness: f.roughness === undefined ? 0.34 : f.roughness,
    metalness: f.metalness === undefined ? 0.35 : f.metalness
  });
  matCache[typeId] = m;
  return m;
}

export function createItem(ctx, typeId, x, y, z, yaw, opts) {
  opts = opts || {};
  const type = CFG.itemTypes[typeId];
  const d = DIMS.itemDims(typeId);

  const rot = opts.quat || quatFromYaw(yaw || 0);

  const mesh = new THREE.Mesh(geometryFor(typeId), materialFor(typeId));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.set(x, y, z);
  mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);
  ctx.scene.add(mesh);

  const body = ctx.world.createRigidBody(
    ctx.RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z)
      .setRotation(rot)
      /* A coin dropped on edge down a chute barely thicker than it is can
         tunnel straight through the glass in one step without this. */
      .setCcdEnabled(!!opts.ccd)
      .setCanSleep(PHY.allowSleep)
      /* See physics.angularDamping in config: this is standing in for
         spin friction, not papering over a missing rule. */
      .setLinearDamping(PHY.linearDamping)
      .setAngularDamping(PHY.angularDamping)
  );

  const desc = d.shape === 'box'
    ? ctx.RAPIER.ColliderDesc.cuboid(d.hx, d.hy, d.hz)
    : discCollider(ctx, d);

  /* A contact skin makes contacts engage a hair BEFORE the shapes touch, which
     is what steadies a stack - see physics.contactSkinInCoins in config. */
  if (PHY.contactSkinInCoins && desc.setContactSkin) {
    desc.setContactSkin(DIMS.D * PHY.contactSkinInCoins);
  }

  /* Audio. COLLISION events, not CONTACT FORCE events, and the difference
     matters more than it sounds.

     A contact-force event fires on every step the force exceeds its
     threshold - so a coin resting on the pile, carrying nothing but its own
     weight, would fire one sixty times a second forever. That is right for
     the pegs, where nothing ever rests, and completely wrong here.

     A collision event fires ONCE, when two colliders begin touching. That is
     exactly "a coin hit something". The trade is that it carries no force, so
     how hard the hit was has to come from the coin's own speed just before
     the step - captured in game.js, because by the time the event is read the
     solver has already taken that speed away. */
  ctx.world.createCollider(
    desc.setDensity(type.density)
      .setFriction(PHY.itemFriction)
      .setRestitution(PHY.itemRestitution)
      .setCollisionGroups(GROUP_ITEM)
      .setActiveEvents(ctx.RAPIER.ActiveEvents.COLLISION_EVENTS),
    body
  );

  const item = { typeId: typeId, mesh: mesh, body: body, dims: d };
  ctx.items.push(item);
  return item;
}

/* A disc as an N-sided prism. See physics.discColliderSides in config for
   why this is not just ColliderDesc.cylinder().

   With physics.discRimChamfer the rim is pinched to a ridge instead of a flat
   band - see the note on it in config for why a flat band makes coins stand
   on their edge when a real one would fall over. */
function discCollider(ctx, d) {
  const n = PHY.discColliderSides | 0;

  if (n < 3) {
    /* A true cylinder. See physics.discColliderSides for why this is now the
       default and the prism is the fallback rather than the other way round.

       physics.discRimRound rounds the rim, which is what a real coin's edge
       actually is. Rapier builds it as a Minkowski sum, so the cylinder has
       to be shrunk by the border radius first or the coin comes out fatter
       than it is drawn. */
    const rr = Math.min((PHY.discRimRound || 0) * d.halfHeight,
                        d.halfHeight * 0.9, d.radius * 0.4);
    if (rr > 0) {
      return ctx.RAPIER.ColliderDesc.roundCylinder(
        d.halfHeight - rr, d.radius - rr, rr);
    }
    return ctx.RAPIER.ColliderDesc.cylinder(d.halfHeight, d.radius);
  }

  /* Circumscribe, so the prism has the same width across the flats as the
     drawn cylinder does across its diameter and the pile packs the same. */
  const r = d.radius / Math.cos(Math.PI / n);
  const chamfer = PHY.discRimChamfer || 0;
  const pts = [];

  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);

    if (chamfer > 0) {
      /* Three rings: the faces pulled in, the equator left at full radius.
         The hull between them is a bevel, so the widest part of the coin is
         a single ring rather than a band with a flat top. */
      const rf = r * (1 - chamfer);
      pts.push(rf * c,  d.halfHeight, rf * s);
      pts.push(r  * c,  0,            r  * s);
      pts.push(rf * c, -d.halfHeight, rf * s);
    } else {
      pts.push(r * c,  d.halfHeight, r * s);
      pts.push(r * c, -d.halfHeight, r * s);
    }
  }
  return ctx.RAPIER.ColliderDesc.convexHull(new Float32Array(pts));
}

function quatFromYaw(yaw) {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

/* On edge: tip the disc 90 degrees about x so its faces point at the viewer
   and it falls within the plane of the chute. */
export function quatOnEdge(spin) {
  const h = Math.PI / 4;                       // half of 90 degrees
  const c = Math.cos(h), s = Math.sin(h);
  const a = { x: s, y: 0, z: 0, w: c };        // 90 about x
  const b = quatFromYaw(0);
  const t = spin / 2;
  const r = { x: 0, y: 0, z: Math.sin(t), w: Math.cos(t) };   // spin in plane
  return {
    x: r.w * a.x + r.x * a.w + r.y * a.z - r.z * a.y,
    y: r.w * a.y - r.x * a.z + r.y * a.w + r.z * a.x,
    z: r.w * a.z + r.x * a.y - r.y * a.x + r.z * a.w,
    w: r.w * a.w - r.x * a.x - r.y * a.y - r.z * a.z
  };
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
      /* Clamp, so a layout written for two tiers still loads onto one. */
      const want = Math.min(entry.tier, TIERS.length) - 1;
      if (want !== tierIdx) return;
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
        rowZ -= rowDepth * S.pileSpacing;
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

      cursorX += w * S.pileSpacing;
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
