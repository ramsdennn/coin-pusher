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
    roughness: opts.roughness !== undefined ? opts.roughness : 0.55,
    /* A little metalness on everything. Nothing in an arcade cabinet is a
       pure matte dielectric - painted steel and moulded plastic both pick up
       a broad highlight, and that highlight sliding across the shelf as it
       moves is most of what makes it read as a real surface. */
    metalness: opts.metalness !== undefined ? opts.metalness : 0.2,
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

/* -------------------------------------------------------------------------
   The shelf's side profile, in the z-y plane, local to the body centre.
   Extruded across the full width.

       back top ______________ front top        <- set back by the rake
               |               \
               |                \  raked face: pushes forward AND up
               |                 |  <- floor level
               |                 |  skirt, vertical, hidden below the floor
       back bot|_________________| front bottom
   ------------------------------------------------------------------------- */
function deckProfile(hz, hy, floorY, rake) {
  return [
    [-hz,  hy],
    [ hz - rake,  hy],
    [ hz,  floorY],
    [ hz, -hy],
    [-hz, -hy]
  ];
}

function deckGeometry(hx, profile) {
  const n = profile.length;
  const v = [];
  for (let side = 0; side < 2; side++) {
    const x = side === 0 ? -hx : hx;
    for (let i = 0; i < n; i++) v.push(x, profile[i][1], profile[i][0]);
  }
  const idx = [];
  for (let i = 1; i < n - 1; i++) {
    idx.push(0, i + 1, i);                       // left cap
    idx.push(n, n + i, n + i + 1);               // right cap
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    idx.push(i, j, n + j);
    idx.push(i, n + j, n + i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v), 3));
  g.setIndex(idx);
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

    const profile = deckProfile(hz, boxH / 2, tier.y - cy, DIMS.deckRake);
    geo = deckGeometry(width / 2, profile);

    const hull = [];
    profile.forEach(function (p) {
      hull.push(-width / 2, p[1], p[0]);
      hull.push( width / 2, p[1], p[0]);
    });
    colliderDesc = ctx.RAPIER.ColliderDesc.convexHull(new Float32Array(hull));
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

  const deckMat = mat(P.deck, { roughness: 0.42, metalness: 0.35 });
  deckMat.side = THREE.DoubleSide;      // hand-wound profile; do not risk it
  const mesh = new THREE.Mesh(geo, deckMat);
  mesh.position.set(0, cy, homeCz);

  if (step > 0) {
    /* The pushing face, in red. Parented to the deck so it travels with it
       rather than needing its own position update every frame. Sized to the
       step alone - the skirt below floor level is hidden, and colouring it
       would show red through the gap under the shelf. */
    const faceTop = (step + DIMS.deckSkirt) / 2;   // boxH is scoped to the
    const faceBottom = tier.y - cy;                // branch above
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(width, faceTop - faceBottom),
      mat(P.deckFace, { roughness: 0.30, metalness: 0.05 })
    );
    plate.position.set(0, (faceTop + faceBottom) / 2, hz + DIMS.D * 0.004);
    mesh.add(plate);
  }
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

/* -------------------------------------------------------------------------
   Lift out anything that has ended up INSIDE the shelf.

   This is a state guard, not a physics rule. A kinematic body ignores
   contacts by definition: it moves exactly where it is told, every step,
   whatever is in the way. So when an item is pinned between the advancing
   face and a pile that cannot yield, Rapier has no choice but to let the
   shelf overlap it - and once the item is fully enclosed there is no contact
   normal pointing anywhere useful, so it never comes out. Measured with a
   plain vertical face and NO drops at all, buried items stayed buried for a
   median of 9 seconds and as long as 33.

   Everything cheaper was measured first and rejected: a skirt through the
   floor, thicker discs, lengthUnit, solver iterations, CCD, soft CCD, and
   raking the face. Each helped a little or not at all, because none of them
   address a kinematic body's indifference to contact.

   This does not change how items behave in play. It only removes a state the
   simulation should never have been able to reach.
   ------------------------------------------------------------------------- */
export function liftTrapped(ctx) {
  if (DIMS.deckStep <= 0) return 0;
  let lifted = 0;
  for (let s = 0; s < ctx.machine.shelves.length; s++) {
    const sh = ctx.machine.shelves[s];
    const t = sh.body.translation();
    const hx = DIMS.width / 2;
    const hy = (DIMS.deckStep + DIMS.deckSkirt) / 2;
    const hz = sh.deckLength / 2;
    const topY = t.y + hy;

    for (let i = 0; i < ctx.items.length; i++) {
      const it = ctx.items[i];
      const p = it.body.translation();
      if (Math.abs(p.x - t.x) > hx) continue;
      if (Math.abs(p.y - t.y) > hy) continue;
      if (Math.abs(p.z - t.z) > hz) continue;

      const dim = DIMS.itemDims(it.typeId);
      const lift = dim.shape === 'box' ? dim.hy : dim.halfHeight;
      const reach = dim.shape === 'box' ? Math.max(dim.hx, dim.hz) : dim.radius;

      /* Land it ON TOP of whatever already occupies this column, not at deck
         height regardless.

         Dropping every lifted item at the deck surface teleports it straight
         inside anything already resting there - measured, two items ending up
         at the same height with their centres aligned, 90%+ interpenetrated,
         which is what made stacked items look melted together. */
      let restY = topY;
      for (let j = 0; j < ctx.items.length; j++) {
        const other = ctx.items[j];
        if (other === it) continue;
        const q = other.body.translation();
        const od = DIMS.itemDims(other.typeId);
        const oReach = od.shape === 'box' ? Math.max(od.hx, od.hz) : od.radius;
        if (Math.hypot(q.x - p.x, q.z - p.z) > (reach + oReach) * 0.8) continue;
        const oTop = q.y + (od.shape === 'box' ? od.hy : od.halfHeight);
        if (oTop > restY) restY = oTop;
      }

      it.body.setTranslation({ x: p.x, y: restY + lift * 1.15, z: p.z }, true);
      const v = it.body.linvel();
      it.body.setLinvel({ x: v.x, y: 0, z: v.z }, true);
      lifted++;
    }
  }
  return lifted;
}

export function driveShelves(ctx, phase) {
  const dz = shelfOffset(phase);
  for (let i = 0; i < ctx.machine.shelves.length; i++) {
    const sh = ctx.machine.shelves[i];
    sh.body.setNextKinematicTranslation({ x: 0, y: sh.cy, z: sh.homeCz + dz });
  }
}

/* -------------------------------------------------------------------------
   The set the cabinet stands in. Decoration only - not one collider here, and
   nothing in this function is raycast for host clicks.
   ------------------------------------------------------------------------- */
/* -------------------------------------------------------------------------
   Light tubes. Decoration - no colliders, and they are excluded from shadow
   work: a glowing tube that catches a shadow reads as a painted pipe.

   Each tube follows the same profile the side walls do, so it sits level
   above the shelf and then descends with the wall to the front edge, rather
   than cutting across it.
   ------------------------------------------------------------------------- */
function buildLightTubes(ctx) {
  const T = CFG.lightTubes;
  if (!T.enabled) return [];

  const D = DIMS.D;
  const yBack  = DIMS.tierTop.y + DIMS.deckStep + D * CFG.scale.wallAboveShelfInCoins;
  const zBack  = -DIMS.wallThick;
  const zHold  = DIMS.tierTop.shelfHomeZ;
  const zFront = DIMS.tierLast.fixedLipZ;
  const yFront = yBack -
    (zFront - zHold) * Math.tan((CFG.scale.wallDescentDeg * Math.PI) / 180);

  const UP = new THREE.Vector3(0, 1, 0);
  const UP_ALT = new THREE.Vector3(0, 0, 1);   // for runs that are vertical

  /* Straight runs, joined by a ball at each corner.

     A smoothed curve through these points is no good: fitting a spline to a
     right angle bows the long side runs out away from the machine entirely,
     which is what happened first time. Straight segments hug the wall by
     construction. */
  const SIDE = new THREE.Vector3();
  const AXIS = new THREE.Vector3();
  const OUT  = new THREE.Vector3();
  const BASIS = new THREE.Matrix4();

  function run(from, to, radius, material, group) {
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    if (len < 1e-6) return;

    const seg = new THREE.Mesh(
      new THREE.BoxGeometry(radius * 2, len, radius * 2), material
    );
    seg.position.copy(from).addScaledVector(dir, 0.5);

    /* A square section needs its ROLL controlled, which a round one did not.
       setFromUnitVectors picks an arbitrary rotation about the run's axis, so
       a box ends up randomly diamond-on instead of flat-on. Build the basis
       explicitly against a world reference and the flats stay square to the
       machine. */
    AXIS.copy(dir).normalize();
    const ref = Math.abs(AXIS.y) > 0.9 ? UP_ALT : UP;
    SIDE.crossVectors(ref, AXIS).normalize();
    /* SIDE x AXIS, not AXIS x SIDE. The other order gives a LEFT-handed
       basis - determinant -1, a reflection rather than a rotation - and
       building a quaternion from one produces nonsense. Every run direction
       was affected, which is what tore the tubes apart at the corners. */
    OUT.crossVectors(SIDE, AXIS).normalize();
    BASIS.makeBasis(SIDE, AXIS, OUT);
    seg.quaternion.setFromRotationMatrix(BASIS);

    group.add(seg);
  }

  const tubes = [];

  /* Each tube is a bigger frame than the one inside it: further out at the
     sides, and higher across the top. The side runs all sit at the same
     height because they follow the wall, and stay distinct by their x. */
  const step = T.gap + T.radius * 2;

  T.colours.forEach(function (colour, i) {
    const x = DIMS.width / 2 + DIMS.wallThick
            + T.gap * (i + 1) + T.radius * (2 * i + 1);
    const yTop = DIMS.chuteTop + step * i;
    const yBot = DIMS.trayY;

    const material = new THREE.MeshStandardMaterial({
      color: colour,
      emissive: new THREE.Color(colour),
      emissiveIntensity: T.glow,
      roughness: 0.35,
      metalness: 0.0
    });

    /* One continuous run, front-left round to front-right:

         down the front face of the left wall
         up that face to the wall top
         back along the wall's descent, then its level section
         UP the back wall
         across the back at the top
         down the far side of the back wall
         forward along the right wall
         down its front face                                             */
    const pts = [
      new THREE.Vector3(-x, yBot,   zFront),
      new THREE.Vector3(-x, yFront, zFront),
      new THREE.Vector3(-x, yBack,  zHold),
      new THREE.Vector3(-x, yBack,  zBack),
      new THREE.Vector3(-x, yTop,   zBack),
      new THREE.Vector3( x, yTop,   zBack),
      new THREE.Vector3( x, yBack,  zBack),
      new THREE.Vector3( x, yBack,  zHold),
      new THREE.Vector3( x, yFront, zFront),
      new THREE.Vector3( x, yBot,   zFront)
    ];

    const group = new THREE.Group();
    for (let k = 0; k < pts.length - 1; k++) run(pts[k], pts[k + 1], T.radius, material, group);

    /* Cubes, not balls, fill the mitre at each corner - a sphere on the end
       of a square run reads as a bead threaded onto it. */
    const cornerGeo = new THREE.BoxGeometry(T.radius * 2, T.radius * 2, T.radius * 2);
    for (let k = 1; k < pts.length - 1; k++) {
      const corner = new THREE.Mesh(cornerGeo, material);
      corner.position.copy(pts[k]);
      group.add(corner);
    }

    group.traverse(function (o) {
      if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; }
    });
    group.userData.isLightTube = true;
    ctx.scene.add(group);

    tubes.push({ group: group, material: material });
  });

  return tubes;
}

/* Recolour a tube in place. Index 0 is the innermost. */
export function setTubeColour(ctx, index, colour) {
  const t = ctx.machine.tubes[index];
  if (!t) return false;
  /* Every segment and corner of a tube shares one material, so this is a
     single assignment however many pieces the run is built from. */
  t.material.color.set(colour);
  t.material.emissive.set(colour);
  return true;
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

  /* Side walls, in profile rather than as a slab.

     They stand a coin above the shelf surface and hold that height back to
     the point the shelf reaches at full extension - so nothing spills over
     the side while it is being pushed - then fall away at a shallow angle to
     the front edge, which opens up the pile instead of fencing it in.

     Built as an extruded profile in the z-y plane, the same way the shelf is,
     so the mesh and the collider come from one set of points and cannot drift
     apart. */
  [-1, 1].forEach(function (sx) {
    const x = sx * (width / 2 + DIMS.wallThick / 2);

    const yBot   = DIMS.trayY;
    const yBack  = DIMS.tierTop.y + DIMS.deckStep + D * CFG.scale.wallAboveShelfInCoins;
    const zBack  = -DIMS.wallThick;
    const zHold  = DIMS.tierTop.shelfHomeZ;          // full shelf extension
    const zFront = DIMS.tierLast.fixedLipZ;
    const yFront = yBack -
      (zFront - zHold) * Math.tan((CFG.scale.wallDescentDeg * Math.PI) / 180);

    const prof = [
      [zBack,  yBot],
      [zBack,  yBack],
      [zHold,  yBack],
      [zFront, yFront],
      [zFront, yBot]
    ];

    const m = new THREE.Mesh(
      deckGeometry(DIMS.wallThick / 2, prof),
      mat(P.wall, { roughness: 0.24, metalness: 0.85 })
    );
    m.material.side = THREE.DoubleSide;
    m.position.set(x, 0, 0);
    ctx.scene.add(m);

    const hull = [];
    prof.forEach(function (p) {
      hull.push(-DIMS.wallThick / 2, p[1], p[0]);
      hull.push( DIMS.wallThick / 2, p[1], p[0]);
    });
    const b = ctx.world.createRigidBody(
      ctx.RAPIER.RigidBodyDesc.fixed().setTranslation(x, 0, 0)
    );
    ctx.world.createCollider(
      ctx.RAPIER.ColliderDesc.convexHull(new Float32Array(hull))
        .setFriction(PHY.wallFriction), b
    );
  });

  /* No tray. Items are deleted as they pass the lip, so a catch tray caught
     nothing and only added dead cabinet below the playfield. */

  /* The fascia: the red band across the front of the machine below the lip.
     Purely a face - items are already gone by the time they pass it. */
  {
    const top = DIMS.tierLast.y, bottom = DIMS.trayY;
    const fascia = new THREE.Mesh(
      new THREE.PlaneGeometry(width, top - bottom),
      mat(P.fascia, { roughness: 0.30, metalness: 0.05 })
    );
    fascia.position.set(0, (top + bottom) / 2, DIMS.tierLast.fixedLipZ + D * 0.004);
    ctx.scene.add(fascia);
  }

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

  /* The backing panel is LIT, not painted. A flat fill is what makes the
     chute read as a rectangle on a screen: real backlit acrylic is brightest
     near the top where the lamp sits and falls away down the panel, and that
     gradient alone does most of the work. Drawn to a canvas rather than
     shipped as an image so there is nothing to load. */
  function panelTexture() {
    const c = document.createElement('canvas');
    c.width = 8; c.height = 256;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0.00, '#ffffff');
    grad.addColorStop(0.38, '#f4f7fa');
    grad.addColorStop(0.78, '#dbe2ea');
    grad.addColorStop(1.00, '#c3ccd6');
    g.fillStyle = grad;
    g.fillRect(0, 0, 8, 256);
    const t = new THREE.CanvasTexture(c);
    if (THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  const panelTex = panelTexture();

  /* Glass: barely there in tint, but smooth and slightly metallic so it
     catches a specular streak off the key light. That highlight is the only
     thing that says there is a pane here at all. */
  const glassMat = mat(P.panel, { roughness: 0.22, opacity: CFG.chute.glassOpacity });
  glassMat.metalness = 0.0;

  const backMat = mat(P.panelGlow, { roughness: 0.85, metalness: 0.0 });
  backMat.map = panelTex;
  backMat.emissive = new THREE.Color(P.panelGlow);
  backMat.emissiveMap = panelTex;
  backMat.emissiveIntensity = 0.5;

  /* Back pane: solid, and the surface the peg dots read against. */
  chuteWall(0, chuteCy, DIMS.panelZ - DIMS.chuteDepth / 2 - glassT / 2,
            width, chuteH, glassT, backMat);
  /* Front pane: glass, so the falling coin is visible. */
  const frontPane = chuteWall(0, chuteCy, DIMS.panelZ + DIMS.chuteDepth / 2 + glassT / 2,
            width, chuteH, glassT, glassMat);
  frontPane.renderOrder = 2;

  /* Dividers, but only down as far as the entry slots. Below that the field
     is open across the full width so coins can bounce between chutes. The two
     outermost run the full height - they are the cabinet walls. */
  const slotH = DIMS.chuteTop - DIMS.slotBottom;
  const slotCy = (DIMS.chuteTop + DIMS.slotBottom) / 2;
  for (let i = 0; i <= DIMS.zoneCount; i++) {
    const edge = (i === 0 || i === DIMS.zoneCount);
    chuteWall(-width / 2 + i * DIMS.zoneWidth,
              edge ? chuteCy : slotCy,
              DIMS.panelZ,
              D * 0.05,
              edge ? chuteH : slotH,
              DIMS.chuteDepth + glassT * 2,
              mat(P.chrome, { roughness: 0.18, metalness: 0.95 }));
  }

  /* A chrome bezel round the opening: a head rail across the top, a bright
     rail along the bottom where the glass meets the playfield, and a post up
     each side. Without a frame the panels just stop, which is most of why
     the whole assembly looked drawn on rather than built. */
  {
    const bez = mat(P.chrome, { roughness: 0.15, metalness: 0.95 });
    const t = D * 0.09;
    const zc = DIMS.panelZ + DIMS.chuteDepth / 2 + glassT;

    const head = new THREE.Mesh(new THREE.BoxGeometry(width + t * 2, t, t * 1.6), bez);
    head.position.set(0, DIMS.chuteTop + t / 2, zc);
    ctx.scene.add(head);

    const sill = new THREE.Mesh(new THREE.BoxGeometry(width + t * 2, t * 1.2, t * 2.0), bez);
    sill.position.set(0, DIMS.chuteBottom - t * 0.6, zc);
    ctx.scene.add(sill);

    [-1, 1].forEach(function (sx) {
      const post = new THREE.Mesh(
        new THREE.BoxGeometry(t, DIMS.chuteTop - DIMS.chuteBottom + t * 2, t * 1.6), bez);
      post.position.set(sx * (width / 2 + t / 2), chuteCy, zc);
      ctx.scene.add(post);
    });
  }

  /* Pegs. CYLINDERS spanning the full chute depth, not spheres.

     A sphere was tried and it jams: it only occupies the middle of the chute,
     leaving a slot about 0.010 wide between it and each glass pane. The
     solver squeezes a 0.020-thick coin into that slot, half through the
     glass, and it sticks there. Measured, that was 6 jams in 32 drops. A peg
     that reaches both panes leaves nowhere to wedge. */
  const pegLen = DIMS.chuteDepth * 1.2;

  /* The peg collider is a ROUND cylinder, deliberately.

     A prism was tried and is worse: its flat facets give a coin a flat
     horizontal ledge to sit on, and a flat-on-flat rest is stable no matter
     how frictionless the surfaces are. Round pegs give a line contact that
     nothing can balance on once friction is gone.

     Superseded note, kept because it is still true of the coins themselves: Rapier's cylinder contacts
     degenerate the same way they do for the coins - which is why the coins are
     16-sided prisms already. As cylinders the pegs let coins sink into them
     and stick: measured 22 of 40 drops jammed, every one of them overlapping
     a peg rather than balanced between two. */
  const pegHull = (function () {
    const pts = [];
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      const cx = Math.cos(a) * DIMS.pegRadius, cy2 = Math.sin(a) * DIMS.pegRadius;
      pts.push(cx, cy2, -pegLen / 2);
      pts.push(cx, cy2,  pegLen / 2);
    }
    return new Float32Array(pts);
  })();
  const pegGeo = new THREE.CylinderGeometry(DIMS.pegRadius, DIMS.pegRadius, pegLen, 12);
  pegGeo.rotateX(Math.PI / 2);                 // lie the cylinder along z
  const pegQuat = { x: Math.sin(Math.PI / 4), y: 0, z: 0, w: Math.cos(Math.PI / 4) };
  /* Polished studs, not dark dots. A peg that catches a highlight reads as a
     round metal pin standing off the panel; a matte one reads as a printed
     spot, which is exactly how they looked. */
  const pegMat = mat(P.chrome, { roughness: 0.12, metalness: 0.95 });
  /* Spread the rows through the open part of the chute, leaving a run-out at
     the bottom so a coin is falling clear before it leaves. */
  /* The first peg row must clear the dividers by more than a whole coin.
     At half a coin, an item resting on a peg still pokes its top back up into
     the divider zone and wedges between the peg below and a divider beside
     it - a stable jam that no amount of friction tuning shifts. Measured at
     0.5: 6 of 12 single drops stuck, every one at the first two rows. */
  /* The peg field starts well below the entry point. An item resting on a peg
     stands a full radius tall, so a first row placed too near where items
     arrive means they drop straight onto an apex and balance there. Rows sit
     more than a coin diameter apart for the reason the 2D build already knew
     and wrote in its own config: closer than that and an item spans two rows
     at once and wedges between them. The run-out at the bottom lets an item
     fall clear before it leaves the chute. */
  const fieldTop = DIMS.chuteTop - D * (CFG.chute.entryHeightInCoins + 1.5);
  const fieldBottom = DIMS.chuteBottom + D * 1.2;
  const minGap = D * CFG.chute.pegRowGapInCoins;
  const rows = CFG.chute.pegRows <= 0 ? 0
             : Math.max(1, Math.min(CFG.chute.pegRows,
                        Math.floor((fieldTop - fieldBottom) / minGap) + 1));
  const rowGap = rows > 1 ? (fieldTop - fieldBottom) / (rows - 1) : 0;
  const pairDx = D * CFG.chute.pairOffsetInCoins;

  parts.pegs = [];
  {
    for (let r = 0; r < rows; r++) {
      const py = fieldTop - r * rowGap;

      /* Quincunx: one on the centreline, then a pair either side of it,
         alternating. The SINGLE row goes first so an item entering on the
         zone centreline meets a peg head-on and is thrown to one side,
         instead of sailing down a clear middle gap undeflected. */
      const xs = [];
      DIMS.zoneCentresX.forEach(function (cx) {
        if (r % 2 === 0) { xs.push(cx); }
        else { xs.push(cx - pairDx); xs.push(cx + pairDx); }

        /* Edge pegs, set inboard of the zone edge so items actually strike
           them. On the divider itself they were unreachable. */
        if (r === CFG.chute.edgePegRow) {
          const ex = D * CFG.chute.edgePegOffsetInCoins;
          xs.push(cx - ex);
          xs.push(cx + ex);
        }
      });

      xs.forEach(function (px) {
        const m = new THREE.Mesh(pegGeo, pegMat);
        m.position.set(px, py, DIMS.panelZ);
        ctx.scene.add(m);
        const b = ctx.world.createRigidBody(
          ctx.RAPIER.RigidBodyDesc.fixed().setTranslation(px, py, DIMS.panelZ)
        );
        ctx.world.createCollider(
          /* Frictionless pegs, combined with MIN so the coin's own friction
             cannot reintroduce grip. A coin landing slightly off a peg apex
             sits on a 10 degree slope; any friction above tan(10) = 0.18 holds
             it there forever, and with 46 pegs there are 46 places to balance.
             Measured with grippy pegs: 23 of 40 drops stopped dead on an apex.
             Polished steel pegs are also what a real machine has. */
          ctx.RAPIER.ColliderDesc.cylinder(pegLen / 2, DIMS.pegRadius)
            .setRotation(pegQuat)
            .setFriction(0.0)
            .setFrictionCombineRule(ctx.RAPIER.CoefficientCombineRule.Min)
            .setRestitution(0.5)
            .setRestitutionCombineRule(ctx.RAPIER.CoefficientCombineRule.Max),
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

  parts.tubes = buildLightTubes(ctx);

  return parts;
}
