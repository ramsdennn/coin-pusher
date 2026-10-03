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

/* ---------------------------------------------------------------------------
   A MARKED FACE

   Drawn to a canvas rather than loaded from a file. At the size a coin takes
   up on screen the glyph is a couple of hundred pixels across, and generating
   it costs no asset, no request and no decode - and stays crisp however close
   the camera gets.

   'mirrored' flips the canvas horizontally. Nothing currently asks for it -
   see TOP_MIRRORED / BOT_MIRRORED below for why - but a reversed 'x2' is
   exactly the sort of thing that looks like a bug on a television, so the
   switch stays where it can be found.
   ------------------------------------------------------------------------- */
const hex = (v) => '#' + (v >>> 0).toString(16).padStart(6, '0');

/* The face itself. Split out from faceTexture because the scoreboard's
   indicator draws the SAME face - one drawing routine, so the chip in the
   corner cannot drift out of step with the coin in the machine. */
function drawFace(g, N, face, mirrored) {
  g.fillStyle = hex(face.background);
  g.fillRect(0, 0, N, N);

  /* The cap's UVs put the disc in a circle inscribed in the square, so
     anything drawn outside that circle is never seen. The ring is placed
     against the circle, not the square. */
  const R = N / 2;
  if (face.ringWidth) {
    g.strokeStyle = hex(face.ringColour);
    g.lineWidth = face.ringWidth * N;
    g.beginPath();
    g.arc(R, R, R - g.lineWidth * 1.6, 0, Math.PI * 2);
    g.stroke();
  }

  g.save();
  if (mirrored) { g.translate(N, 0); g.scale(-1, 1); }
  g.fillStyle = hex(face.ink);

  if (face.star) {
    /* A star rather than a glyph. Points are stepped by pi/points and the
       radius alternates outer, inner, outer - which is all a star is. Drawn
       from the centre with y NEGATED so a point sits at the top, the way one
       is expected to. */
    const st = face.star;
    const pts = st.points || 5;
    const ro = st.outer * N, ri = st.inner * N;
    const rot = st.rotation || 0;
    g.beginPath();
    for (let i = 0; i < pts * 2; i++) {
      const r = (i % 2) ? ri : ro;
      const a = rot + i * Math.PI / pts;
      const x = R + Math.sin(a) * r;
      const y = R - Math.cos(a) * r;
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.closePath();
    g.fill();
  } else if (face.text) {
    g.font = 'bold ' + Math.round(face.sizeFraction * N) + 'px ' +
             "'Arial Narrow', Arial, Helvetica, sans-serif";
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(face.text, R, R + N * 0.02);
  }
  g.restore();
}

function faceTexture(face, mirrored) {
  const N = 256;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  drawFace(c.getContext('2d'), N, face, mirrored);

  const tex = new THREE.CanvasTexture(c);
  if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/* ---------------------------------------------------------------------------
   The same face, as a PNG data url, for use as a CSS background.

   Two things are added that the 3D version gets from the scene and a flat
   image does not: the disc is CLIPPED to a circle, so what lands in the DOM
   is a coin rather than a square with a coin on it, and a top-light plus a
   rim in the body colour stand in for the lighting - without them it reads as
   a printed sticker rather than an object.

   Returns null for a type with no face, so a caller can ask about any type.
   ------------------------------------------------------------------------- */
export function itemFaceImage(typeId, px) {
  const type = CFG.itemTypes[typeId];
  if (!type || !type.face) return null;

  px = px || 256;
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const g = c.getContext('2d');
  const R = px / 2;

  g.save();
  g.beginPath();
  g.arc(R, R, R, 0, Math.PI * 2);
  g.clip();
  drawFace(g, px, type.face, false);

  const lit = g.createRadialGradient(px * 0.35, px * 0.28, px * 0.05,
                                     R, R, px * 0.62);
  lit.addColorStop(0.00, 'rgba(255,255,255,0.30)');
  lit.addColorStop(0.55, 'rgba(255,255,255,0.05)');
  lit.addColorStop(1.00, 'rgba(0,0,0,0.30)');
  g.fillStyle = lit;
  g.fillRect(0, 0, px, px);
  g.restore();

  /* The rim, in the body colour - the edge you would see on the real disc. */
  g.strokeStyle = hex(type.color);
  g.lineWidth = px * 0.05;
  g.beginPath();
  g.arc(R, R, R - g.lineWidth / 2, 0, Math.PI * 2);
  g.stroke();

  return c.toDataURL('image/png');
}

/* NEITHER cap needs its canvas flipped.

   That is worth stating, because the obvious reasoning says otherwise: a
   cylinder's two caps are wound opposite ways, so the same texture on both
   ought to come out back-to-front on the underside. It was built that way
   first, and the underside came out reversed BECAUSE of the correction -
   THREE already lays the cap UVs out so both faces read the same way from
   outside.

   Settled by rendering a token face up and face down and looking at it, not
   by reasoning about winding order. These two are left in as named constants
   rather than deleted so the next person can flip one and see, instead of
   re-deriving the argument and getting it wrong the same way. */
const TOP_MIRRORED = false;
const BOT_MIRRORED = false;

function materialFor(typeId) {
  if (matCache[typeId]) return matCache[typeId];
  const type = CFG.itemTypes[typeId];
  const f = type.finish || {};
  const base = {
    color: type.color,
    /* Defaults are the old metal-token finish, so a type that says nothing
       about its surface looks exactly as it did before. */
    roughness: f.roughness === undefined ? 0.34 : f.roughness,
    metalness: f.metalness === undefined ? 0.35 : f.metalness
  };

  let m;
  if (type.face && type.shape !== 'box') {
    /* THREE gives a cylinder three material slots in this order: side, top,
       bottom. So the rim keeps the plain metal and both flat faces carry the
       glyph - both, because a disc lying in a pile is as likely to be face
       down as face up, and it was checked both ways up on screen. The map
       goes on a WHITE base or the fill colour would be multiplied by the body
       colour and come out muddy. */
    const cap = (mirrored) => new THREE.MeshStandardMaterial(
      Object.assign({}, base, { color: 0xFFFFFF,
                                map: faceTexture(type.face, mirrored) }));
    m = [new THREE.MeshStandardMaterial(base), cap(TOP_MIRRORED), cap(BOT_MIRRORED)];
  } else {
    m = new THREE.MeshStandardMaterial(base);
  }

  matCache[typeId] = m;
  return m;
}

/* ---------------------------------------------------------------------------
   A WRAPPED PRESENT

   Four pieces of geometry and two materials, assembled as a GROUP. The
   physics never sees any of it - the collider is still the single cuboid
   createItem builds from the type's size - so a present is exactly as cheap
   to simulate as the chocolate bar was, and cannot disturb the pile in any of
   the ways a compound collider would.

   The bands are two thin slabs at right angles, each one a hair larger than
   the box on the two axes it wraps around. That is the whole trick: two
   crossed slabs give you a cross on the top face, a cross on the bottom, and
   a band down all four sides, which is what a wrapped box looks like. Then a
   knot where they meet and two loops beside it, and that is enough of a bow
   at the size this renders on a television.

   Materials are built PER PRESENT rather than taken from the cache, because
   the whole point is that two on the shelf are two different colours. That is
   affordable here and would not be for coins - there are two of these, not
   sixty two.
   ------------------------------------------------------------------------- */
function buildWrapped(type, d) {
  const w = d.hx * 2, h = d.hy * 2, dp = d.hz * 2;
  const W = type.wrap;
  const f = type.finish || {};

  const pick = W.palette && W.palette.length
    ? W.palette[(Math.random() * W.palette.length) | 0]
    : { box: type.color, ribbon: 0xFFFFFF };

  const boxMat = new THREE.MeshStandardMaterial({
    color: pick.box,
    roughness: f.roughness === undefined ? 0.45 : f.roughness,
    metalness: f.metalness === undefined ? 0.02 : f.metalness
  });
  /* The ribbon reads as a different MATERIAL, not just a different colour -
     satin against paper. A little less rough is all that takes. */
  const ribMat = new THREE.MeshStandardMaterial({
    color: pick.ribbon,
    roughness: 0.28,
    metalness: 0.05
  });

  const g = new THREE.Group();
  const add = (geo, mat, px, py, pz, ry) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(px || 0, py || 0, pz || 0);
    if (ry) m.rotation.y = ry;
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };

  const band  = W.ribbonFraction * w;
  const proud = W.proud * w;

  add(new THREE.BoxGeometry(w, h, dp), boxMat);
  add(new THREE.BoxGeometry(band, h + proud, dp + proud), ribMat);
  add(new THREE.BoxGeometry(w + proud, h + proud, band), ribMat);

  const knot = W.knotFraction * w;
  const loop = W.loopFraction * w;
  const topY = h / 2 + proud / 2;
  add(new THREE.BoxGeometry(loop, knot * 0.42, knot * 0.72), ribMat,
      0, topY + knot * 0.28, 0,  Math.PI * 0.18);
  add(new THREE.BoxGeometry(loop, knot * 0.42, knot * 0.72), ribMat,
      0, topY + knot * 0.28, 0, -Math.PI * 0.18);
  add(new THREE.BoxGeometry(knot, knot * 0.62, knot), ribMat,
      0, topY + knot * 0.31, 0);

  return { group: g, colours: pick };
}

export function createItem(ctx, typeId, x, y, z, yaw, opts) {
  opts = opts || {};
  const type = CFG.itemTypes[typeId];
  const d = DIMS.itemDims(typeId);

  const rot = opts.quat || quatFromYaw(yaw || 0);

  let mesh, wrap = null;
  if (type.wrap) {
    const built = buildWrapped(type, d);
    mesh = built.group;
    wrap = built.colours;
  } else {
    mesh = new THREE.Mesh(geometryFor(typeId), materialFor(typeId));
  }
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
      /* neverSleeps overrides the global. See itemTypes.present for why a
         present must not sleep: a sleeping body is skipped by the solver, and
         a coin leaning on one makes no new contact to wake it. */
      .setCanSleep(PHY.allowSleep && !type.neverSleeps)
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

  /* wrap carries the colours this present was actually built in, so the
     lights can flash ITS two rather than a generic prize colour. */
  const item = { typeId: typeId, mesh: mesh, body: body, dims: d, wrap: wrap };
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
/* ---------------------------------------------------------------------------
   THE STARTING PILE

   Coins go in the two places that are ALWAYS on show, and nowhere else. Each
   one is dropped at a random spot; where it lands on a coin already there, it
   sits on top of it. No lattice, no rows, no even spacing.

   REGION 1 - the part of the shelf that never withdraws. The deck slides back
   by a stroke, so its surface covers z 0 to 0.792 at home and only back to
   0.301 when fully retracted. The overlap - covered at every point in the
   stroke - is z 0 to 0.301, which with a coin's radius held inside leaves a
   strip about a quarter of a coin deep. One line of coins, no more; the
   stroke is nearly two thirds of the deck's depth, so there is nothing else
   up there that is permanently solid.

   REGION 2 - the part of the platform the shelf never crosses. The deck's
   front face reaches 0.792 and no further, and the platform runs from there
   to the lip at 1.44, so none of it is ever overhung. About 1.7 coins deep
   and the full width, which is where the bulk of the pile lives.

   Coins are shared between the two in proportion to their AREA, so the pile
   thins out where there is less room rather than heaping up in the strip.

   NOTHING HERE PROTECTS A COIN FROM THE MACHINE. Earlier versions pulled the
   pile back from the edges so the opening strokes could not take any, and
   every one of them looked arranged rather than played. The regions are now
   used right to their limits and coins are free to be pushed, to topple, and
   to go over the lip.
   ------------------------------------------------------------------------- */
export function buildStartingPile(ctx) {
  const D = DIMS.D;
  const P = CFG.startingPile;
  const tier = DIMS.tierLast;

  /* x2 SWITCHED OFF MEANS NO x2 TOKENS ON THE SHELF.

     Without this the layout would lay them out anyway - it does not otherwise
     care what a type IS - and the result was worse than useless: two tokens
     sitting in the pile looking exactly like working ones, going over the
     edge, and paying out as ordinary coins. That reads as a broken machine
     rather than as a setting, which is the whole reason this is here.

     The setting is known by now. makeSettings reads it out of storage while
     the title screen is up, and the pile is not laid out until START. */
  const DBL = CFG.multiplier;
  const noDoublers = !!(DBL && !DBL.enabled);

  const queue = [];
  CFG.startingLayout.forEach(function (entry) {
    for (let i = 0; i < entry.count; i++) {
      /* Their places go back to being COINS rather than simply vanishing.
         The pile is tuned around holding 62 items - see startingLayout - and
         it should not quietly become 60 because of a switch somewhere else.
         One of each colour, so the even split holds. */
      queue.push(noDoublers && entry.type === DBL.typeId
        ? CFG.dropItem[i % CFG.dropItem.length]
        : entry.type);
    }
  });
  shuffle(queue);
  if (!queue.length) return;

  const r = D * 0.5;
  const margin = D * (P.edgeMarginInCoins || 0);

  /* Region 1: the deck's permanently covered strip. Its far edge is the
     deck's front face at FULL RETRACTION - shelfDepth less the stroke. */
  const deckLo = tier.backZ + r + margin;
  const deckHi = tier.backZ + DIMS.shelfDepth - DIMS.stroke - r - margin;

  /* Region 2: the whole platform in front of the deck's furthest reach. */
  const floorLo = tier.shelfHomeZ + r + margin;
  const floorHi = tier.lipZ       - r - margin;

  const halfUsable = DIMS.width / 2 - r - margin;

  const bands = [
    { id: 'deck',  lo: deckLo,  hi: deckHi,  surface: tier.y + DIMS.deckStep },
    { id: 'floor', lo: floorLo, hi: floorHi, surface: tier.y }
  ].filter(function (b) { return b.hi > b.lo; });
  if (!bands.length) return;

  /* Shared out by an explicit number rather than by area. Region 1 is only a
     quarter of a coin deep, so sharing by area gave it six coins and left the
     shelf looking bare. It physically holds eleven or twelve side by side
     across the width; past that they stack rather than spread. */
  const deckBand = bands.length > 1 ? bands[0] : null;
  const wantDeck = deckBand ? Math.round(queue.length * P.deckShare) : 0;

  const placed = [];
  let n = 0;

  queue.forEach(function (typeId) {
    const d = DIMS.itemDims(typeId);
    const h = d.shape === 'box' ? d.hy * 2 : d.height;
    const rad = d.shape === 'box' ? Math.max(d.hx, d.hz) : d.footprint / 2;

    const band = (deckBand && n < wantDeck) ? deckBand : bands[bands.length - 1];
    n++;

    /* BEST CANDIDATE, not plain random.

       Picking each spot independently and uniformly is what produced the
       clumps: uniform sampling clusters by nature, leaving some coins almost
       touching and others alone in a bare patch. Measured at spawn, the
       nearest-neighbour distance ranged from 0.015 of a coin to 0.8.

       So each coin tries several spots and takes whichever is FURTHEST from
       everything already down. Gaps get filled in preference to crowds and
       the scatter comes out even, while staying irregular - there is no grid
       here, and no fixed spacing. More coins would not have fixed this; they
       would have filled some gaps and deepened the piles at the same time. */
    let x = 0, z = 0, bestScore = -1;
    const tries = Math.max(1, P.candidates | 0);
    for (let c = 0; c < tries; c++) {
      const cx = -halfUsable + Math.random() * halfUsable * 2;
      const cz = band.lo + Math.random() * (band.hi - band.lo);
      let nearest = Infinity;
      for (let i = 0; i < placed.length; i++) {
        const q = placed[i];
        if (q.band !== band.id) continue;
        const dist = Math.hypot(cx - q.x, cz - q.z);
        if (dist < nearest) nearest = dist;
      }
      if (nearest > bestScore) { bestScore = nearest; x = cx; z = cz; }
    }

    /* Rest on the tallest thing already under this spot. Computing the height
       from what is underneath is what stops anything starting out INSIDE
       anything else, which is the usual way to make a solver explode on the
       first frame. */
    let top = band.surface;
    for (let i = 0; i < placed.length; i++) {
      const q = placed[i];
      if (q.band !== band.id) continue;
      if (Math.hypot(x - q.x, z - q.z) >= rad + q.rad) continue;
      if (q.top > top) top = q.top;
    }

    placed.push({ x: x, z: z, rad: rad, top: top + h, band: band.id });
    createItem(ctx, typeId, x, top + h / 2 + D * 0.004, z,
               /* The spin is free - a disc's footprint is the same whatever
                  its yaw - and it stops the marked faces all matching. */
               d.shape === 'box' ? jitter(0.05) : Math.random() * Math.PI * 2);
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
