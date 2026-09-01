/* ============================================================================
   THE MACHINE
   Cabinet, tiers, fixed floors and the two moving shelves. Builds the Three.js
   meshes and the Rapier bodies together so they can never drift apart.

   The shelves are created as kinematic bodies but are NOT driven yet. This
   pass is geometry, camera and a pile that settles.
   ========================================================================= */

import * as THREE from 'three';
import { DIMS, TIERS } from '@app/dims';

const CFG = window.COIN_PUSHER_CONFIG;
const P   = CFG.palette;
const PHY = CFG.physics;

function mat(color, opts) {
  opts = opts || {};
  return new THREE.MeshStandardMaterial({
    color: color,
    roughness: opts.roughness !== undefined ? opts.roughness : 0.75,
    metalness: 0.0,
    side: THREE.DoubleSide,
    transparent: opts.opacity !== undefined,
    opacity: opts.opacity !== undefined ? opts.opacity : 1
  });
}

/* A box whose TOP face sits at `top`, spanning z from z0 to z1. */
function staticBox(ctx, o) {
  const depth = o.z1 - o.z0;
  const cz = (o.z0 + o.z1) / 2;
  const cy = o.top - o.thickness / 2;
  const x = o.x || 0;

  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(o.width, o.thickness, depth), mat(o.color)
  );
  mesh.position.set(x, cy, cz);
  ctx.scene.add(mesh);

  const body = ctx.world.createRigidBody(
    ctx.RAPIER.RigidBodyDesc.fixed().setTranslation(x, cy, cz)
  );
  ctx.world.createCollider(
    ctx.RAPIER.ColliderDesc.cuboid(o.width / 2, o.thickness / 2, depth / 2)
      .setFriction(PHY.floorFriction)
      .setRestitution(PHY.itemRestitution),
    body
  );
  return mesh;
}

/* The shelf deck: a slab whose leading edge is chamfered from the bottom up,
   so on its forward stroke it wedges UNDER any item that dropped into the
   well behind it, rather than butting into its edge. */
function deckPoints(hx, t, hz, chamfer) {
  return [
    [-hx,  0, -hz], [hx,  0, -hz], [hx,  0, hz - chamfer], [-hx,  0, hz - chamfer],
    [-hx, -t, -hz], [hx, -t, -hz], [hx, -t, hz],           [-hx, -t, hz]
  ];
}

function wedgeGeometry(hx, t, hz, chamfer) {
  const pts = deckPoints(hx, t, hz, chamfer);
  const v = new Float32Array(pts.length * 3);
  pts.forEach(function (p, i) { v[i * 3] = p[0]; v[i * 3 + 1] = p[1]; v[i * 3 + 2] = p[2]; });

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(v, 3));
  g.setIndex([
    0, 1, 2,  0, 2, 3,      // top
    4, 6, 5,  4, 7, 6,      // bottom
    3, 2, 6,  3, 6, 7,      // chamfered leading face
    0, 5, 1,  0, 4, 5,      // back
    1, 5, 6,  1, 6, 2,      // right
    0, 3, 7,  0, 7, 4       // left
  ]);
  g.computeVertexNormals();
  return g;
}

function buildShelf(ctx, tier) {
  const width = DIMS.width, deckThick = DIMS.deckThick, chamfer = DIMS.chamfer;
  const step = DIMS.deckStep;

  /* Long enough that its back end is still buried in the cabinet at full
     retraction, so it never reveals its own tail. */
  const deckLength = DIMS.shelfDepth + DIMS.stroke + DIMS.D;
  const hz = deckLength / 2;

  let geo, colliderDesc, cy, homeCz;

  if (step > 0) {
    /* STEPPED: a block riding on the fixed floor, with a vertical front face.
       That face is the whole mechanism - it pushes on the out-stroke and just
       separates from the coins on the return. Coins riding the deck tumble
       off its front edge onto the field and cannot climb back on, which is
       the one-way behaviour a flush deck cannot produce.

       A plain box is safe here: the deck's underside sits exactly on the
       floor, so a coin lying on that floor cannot get beneath it and there is
       nothing to wedge. */
    /* The shelf reaches DOWN THROUGH the floor, not just to it.

       Sitting its underside exactly on the floor looks airtight and is not:
       contact tolerance lets a coin settle a fraction into the floor slab,
       and the shelf's flat bottom edge then rides straight over it. The coin
       ends up under the shelf, dragged along inside the block - measured at
       16 items buried after 50 strokes, the worst 0.064 deep.

       Kinematic and fixed bodies do not collide in Rapier, so the shelf can
       pass through the floor for free, and the skirt is hidden under an
       opaque floor. Now the front face has no bottom edge to climb. */
    const skirt = DIMS.deckSkirt;
    const boxH = step + skirt;
    homeCz = tier.shelfHomeZ - hz;
    cy = tier.y + step / 2 - skirt / 2;
    geo = new THREE.BoxGeometry(width, boxH, deckLength);
    colliderDesc = ctx.RAPIER.ColliderDesc.cuboid(width / 2, boxH / 2, hz);
  } else {
    /* FLUSH: deck top level with the fixed floor. Sit it so its FLAT TOP
       meets the floor, not its chamfer tip, or the bevel leaves a V-groove
       across the seam and coins rock in the notch forever. */
    homeCz = tier.shelfHomeZ - hz + chamfer;
    cy = tier.y;
    geo = wedgeGeometry(width / 2, deckThick, hz, chamfer);
    const flat = [];
    deckPoints(width / 2, deckThick, hz, chamfer).forEach(function (p) {
      flat.push(p[0], p[1], p[2]);
    });
    colliderDesc = ctx.RAPIER.ColliderDesc.convexHull(new Float32Array(flat));
  }

  const mesh = new THREE.Mesh(geo, mat(P.deck, { roughness: 0.55 }));
  mesh.position.set(0, cy, homeCz);
  ctx.scene.add(mesh);

  const body = ctx.world.createRigidBody(
    ctx.RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, cy, homeCz)
  );
  ctx.world.createCollider(
    colliderDesc.setFriction(PHY.shelfFriction).setRestitution(PHY.itemRestitution),
    body
  );

  return { mesh: mesh, body: body, homeCz: homeCz, cy: cy, deckLength: deckLength };
}

/* -------------------------------------------------------------------------
   Drive both decks from one phase, because there is one mechanism.

   phase 0   = fully forward (home)
   phase 0.5 = fully retracted
   phase 1   = fully forward again

   So 0 -> 0.5 is the RETURN (deck withdrawing) and 0.5 -> 1 is the OUT-stroke
   (deck advancing). Which of those actually moves the pile is not decided
   here - friction decides it, and the metrics in game.js measure which.

   setNextKinematicTranslation, not setTranslation: Rapier derives the deck's
   contact velocity from the position delta, and that derived velocity is the
   entire reason friction can carry anything. Teleporting it would move the
   deck through the pile without ever gripping it.
   ------------------------------------------------------------------------- */
export function shelfOffset(phase) {
  const stroke = DIMS.stroke;
  if (CFG.shelf.motion === 'triangle') {
    const p = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
    return -stroke * p;
  }
  return -stroke * (1 - Math.cos(phase * Math.PI * 2)) / 2;
}

export function driveShelves(ctx, phase) {
  const dz = shelfOffset(phase);
  for (let i = 0; i < ctx.machine.shelves.length; i++) {
    const sh = ctx.machine.shelves[i];
    sh.body.setNextKinematicTranslation({ x: 0, y: sh.cy, z: sh.homeCz + dz });
  }
}

export function buildMachine(ctx) {
  const width = DIMS.width, D = DIMS.D, deckThick = DIMS.deckThick;
  const parts = { shelves: [], panels: [] };

  TIERS.forEach(function (tier) {
    if (DIMS.deckStep > 0) {
      /* One continuous field floor for the whole tier depth. The deck rides
         on top of it, so there is no well and no step-down to climb. */
      staticBox(ctx, {
        top: tier.y, z0: tier.backZ - D, z1: tier.fixedLipZ,
        width: width, thickness: deckThick * 1.6, color: P.fixedFloor
      });
    } else {
      /* Fixed floor: the front portion of the tier, level with the deck. */
      staticBox(ctx, {
        top: tier.y, z0: tier.fixedBackZ, z1: tier.fixedLipZ,
        width: width, thickness: deckThick * 1.6, color: P.fixedFloor
      });
      /* Well floor: one deck-thickness lower, under the shelf's travel. */
      staticBox(ctx, {
        top: tier.y - deckThick, z0: tier.backZ - D, z1: tier.fixedBackZ,
        width: width, thickness: deckThick, color: P.cabinet
      });
    }

    parts.shelves.push(buildShelf(ctx, tier));
  });

  /* Back walls. The top tier's underside sits exactly at deck level, so the
     deck slides beneath it and half of it vanishes from view. The bottom
     tier's sits directly under the top tier's lip, so items tipping off the
     top land just in front of it. */
  function backWall(top, bottom, z) {
    const h = top - bottom;
    const cy = bottom + h / 2, cz = z - DIMS.wallThick / 2;
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(width, h, DIMS.wallThick), mat(P.cabinet)
    );
    m.position.set(0, cy, cz);
    ctx.scene.add(m);
    const b = ctx.world.createRigidBody(
      ctx.RAPIER.RigidBodyDesc.fixed().setTranslation(0, cy, cz)
    );
    ctx.world.createCollider(
      ctx.RAPIER.ColliderDesc.cuboid(width / 2, h / 2, DIMS.wallThick / 2)
        .setFriction(PHY.wallFriction), b
    );
  }
  /* One back wall per tier. The topmost runs full height; any lower tier's
     wall runs up to the underside of the tier above, so items tipping off
     that tier land just in front of it. Each starts at deck level so the
     shelf slides beneath it and half of it disappears from view. */
  TIERS.forEach(function (tier, k) {
    const top = k === 0 ? tier.y + DIMS.wallHeight : TIERS[k - 1].y;
    backWall(top, tier.y + DIMS.deckStep, tier.backZ);
  });

  /* Side walls, spanning both tiers and the full depth. Kept translucent so
     they do not hide the pile from a front camera. */
  [-1, 1].forEach(function (sx) {
    const x = sx * (width / 2 + DIMS.wallThick / 2);
    const h = DIMS.tierTop.y + DIMS.wallHeight - DIMS.trayY;
    const cy = DIMS.trayY + h / 2, cz = DIMS.playDepth / 2;
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(DIMS.wallThick, h, DIMS.playDepth),
      mat(P.wall, { opacity: 0.28 })
    );
    m.position.set(x, cy, cz);
    ctx.scene.add(m);
    const b = ctx.world.createRigidBody(
      ctx.RAPIER.RigidBodyDesc.fixed().setTranslation(x, cy, cz)
    );
    ctx.world.createCollider(
      ctx.RAPIER.ColliderDesc.cuboid(DIMS.wallThick / 2, h / 2, DIMS.playDepth / 2)
        .setFriction(PHY.wallFriction), b
    );
  });

  /* Tray. Nothing scores yet - this just catches what falls so it does not
     drop forever and quietly eat frame time. */
  staticBox(ctx, {
    top: DIMS.trayY, z0: DIMS.tierLast.lipZ - D * 0.5, z1: DIMS.tierLast.lipZ + D * 3,
    width: width, thickness: deckThick * 2, color: P.tray
  });

  /* ---------------------------------------------------------------------
     THE FOUR DROP CHUTES
     Each is a real volume: two glass panes front and back, a divider either
     side, and a staggered peg field. The coin goes in on edge at the top and
     rattles down. Nothing here filters or steers it - the scatter is just
     bouncing.
     --------------------------------------------------------------------- */
  const chuteH = DIMS.chuteTop - DIMS.chuteBottom;
  const chuteCy = (DIMS.chuteTop + DIMS.chuteBottom) / 2;
  const glassT = D * 0.04;

  function chuteWall(cx, cy, cz, sx, sy, sz, material) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
    m.position.set(cx, cy, cz);
    ctx.scene.add(m);
    const b = ctx.world.createRigidBody(
      ctx.RAPIER.RigidBodyDesc.fixed().setTranslation(cx, cy, cz)
    );
    ctx.world.createCollider(
      ctx.RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2)
        .setFriction(PHY.wallFriction)
        .setRestitution(PHY.itemRestitution),
      b
    );
    return m;
  }

  const glassMat = mat(P.panel, { roughness: 0.15, opacity: CFG.chute.glassOpacity });
  const backMat  = mat(P.panel, { roughness: 0.5 });

  /* Back pane: solid, and the surface the peg dots read against. */
  chuteWall(0, chuteCy, DIMS.panelZ - DIMS.chuteDepth / 2 - glassT / 2,
            width, chuteH, glassT, backMat);
  /* Front pane: glass, so the falling coin is visible. */
  const frontPane = chuteWall(0, chuteCy, DIMS.panelZ + DIMS.chuteDepth / 2 + glassT / 2,
            width, chuteH, glassT, glassMat);
  frontPane.renderOrder = 2;

  /* Dividers between the chutes, and the two outer walls. */
  for (let i = 0; i <= DIMS.zoneCount; i++) {
    chuteWall(-width / 2 + i * DIMS.zoneWidth, chuteCy, DIMS.panelZ,
              D * 0.05, chuteH, DIMS.chuteDepth + glassT * 2,
              mat(P.panelEdge));
  }

  /* Pegs. CYLINDERS spanning the full chute depth, not spheres.

     A sphere was tried and it jams: it only occupies the middle of the chute,
     leaving a slot about 0.010 wide between it and each glass pane. The
     solver squeezes a 0.020-thick coin into that slot, half through the
     glass, and it sticks there. Measured, that was 6 jams in 32 drops. A peg
     that reaches both panes leaves nowhere to wedge. */
  const pegLen = DIMS.chuteDepth * 1.2;
  const pegGeo = new THREE.CylinderGeometry(DIMS.pegRadius, DIMS.pegRadius, pegLen, 12);
  pegGeo.rotateX(Math.PI / 2);                 // lie the cylinder along z
  const pegQuat = { x: Math.sin(Math.PI / 4), y: 0, z: 0, w: Math.cos(Math.PI / 4) };
  const pegMat = mat(P.peg, { roughness: 0.4 });
  const rowGap = chuteH * CFG.chute.rowGapFraction;
  const firstRowY = DIMS.chuteTop - chuteH * CFG.chute.firstRowFraction;

  parts.pegs = [];
  for (let z = 0; z < DIMS.zoneCount; z++) {
    const cx = DIMS.zoneCentresX[z];
    for (let r = 0; r < CFG.chute.pegRows; r++) {
      const py = firstRowY - r * rowGap;
      const xs = [(r % 2 === 0 ? 1 : -1) * DIMS.pegRowDx];
      xs.forEach(function (dx) {
        const px = cx + dx;
        const m = new THREE.Mesh(pegGeo, pegMat);
        m.position.set(px, py, DIMS.panelZ);
        ctx.scene.add(m);
        const b = ctx.world.createRigidBody(
          ctx.RAPIER.RigidBodyDesc.fixed().setTranslation(px, py, DIMS.panelZ)
        );
        ctx.world.createCollider(
          ctx.RAPIER.ColliderDesc.cylinder(pegLen / 2, DIMS.pegRadius)
            .setRotation(pegQuat)
            .setFriction(0.05)
            .setRestitution(0.45),
          b
        );
        parts.pegs.push(m);
      });
    }
  }

  /* Invisible click targets, one per chute, in front of the glass. Host
     interaction hit-tests against these, never against the pile. */
  for (let i = 0; i < DIMS.zoneCount; i++) {
    const target = new THREE.Mesh(
      new THREE.PlaneGeometry(DIMS.zoneWidth * 0.96, chuteH),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
    );
    target.position.set(DIMS.zoneCentresX[i], chuteCy, DIMS.panelZ + D * 0.3);
    target.userData.zone = i;
    ctx.scene.add(target);
    parts.panels.push(target);
  }

  return parts;
}
