/* ============================================================================
   DIMENSIONS
   Every measurement in the machine, derived from config.scale. Nothing else
   in the codebase should contain a hard-coded size.

   Axes:
     x  left/right, 0 at the centre of the machine
     y  up, 0 at the LOWEST tier's surface
     z  depth, 0 at the back wall, increasing TOWARDS the viewer

   So the back of the cabinet is z = 0 and items score by falling off the
   largest z, off the front of the lowest tier.
   ========================================================================= */

const CFG = window.COIN_PUSHER_CONFIG;
const S = CFG.scale;

const D = S.coinDiameter;

/* ---- the playfield ---- */
const width     = S.coinsAcrossWidth * D;
const tierDepth = S.coinsDeepPerTier * D;
const tierDrop  = S.tierDropInCoins  * D;
const tierCount = Math.max(1, S.tierCount | 0);

/* ---- the shelf ---------------------------------------------------------
   The shelf is a block riding on the fixed floor with a VERTICAL front face,
   and that face is the entire mechanism. It pushes on the out-stroke and
   simply separates from the items on the return.

   A flush deck was tried and measured: it can only transmit force through
   friction, friction is symmetric, and it drags the pile back exactly as hard
   as it pushes it. 60 coins over 60 strokes produced nothing off the lip at
   all. Set scale.deckStepInCoins to 0 to reproduce that.

   Items riding the shelf tumble off its front edge down onto the fixed
   platform and cannot climb back on. That one-way step is the "falls to the
   next platform" stage of the machine.
   ---------------------------------------------------------------------- */
const shelfDepth  = tierDepth * (1 - S.fixedFloorFraction);
const fixedDepth  = tierDepth - shelfDepth;
const stroke      = shelfDepth * S.shelfStrokeFraction;
const deckThick   = D * 0.12;
const deckStep    = D * S.deckStepInCoins;   // 0 = flush deck (does not work)
const chamfer     = D * 0.18;                // only used by the flush variant

/* ---- tiers -------------------------------------------------------------
   Built top-down. With tierCount 1 - which is the machine as specified -
   there is a single shelf, a single fixed platform in front of it, and the
   front lip. Nothing below.
   ---------------------------------------------------------------------- */
const tiers = [];
for (let k = 0; k < tierCount; k++) {
  const backZ = k * tierDepth;
  tiers.push({
    index:      k,
    y:          (tierCount - 1 - k) * tierDrop,
    backZ:      backZ,
    lipZ:       backZ + tierDepth,
    shelfHomeZ: backZ + shelfDepth,
    fixedBackZ: backZ + shelfDepth,
    fixedLipZ:  backZ + tierDepth
  });
}

const tierTop  = tiers[0];
const tierLast = tiers[tiers.length - 1];      // the one items score off
const playDepth = tierCount * tierDepth;

const trayY = tierLast.y - D * 2.2;

/* ---- cabinet shell ---- */
const wallThick   = D * 0.35;
const wallHeight  = tierDrop + D * 3;
const panelHeight = D * 5.2;        // the four drop panes, above the top tier
const panelZ      = D * 0.15;       // stood just in front of the back wall

/* ---- drop zones ---- */
const zoneCount = 4;
const zoneWidth = width / zoneCount;
const zoneCentresX = Array.from(
  { length: zoneCount },
  (_, i) => -width / 2 + (i + 0.5) * zoneWidth
);

/* ---- items ---- */
function itemDims(type) {
  const t = CFG.itemTypes[type];
  if (t.shape === 'box') {
    return {
      shape: 'box',
      hx: (t.size.width  * D) / 2,
      hy: (t.size.height * D) / 2,
      hz: (t.size.depth  * D) / 2,
      height: t.size.height * D,
      footprint: Math.max(t.size.width, t.size.depth) * D
    };
  }
  const radius = (t.size.diameter * D) / 2;
  const height = t.size.thickness * D;
  return {
    shape: 'disc',
    radius: radius,
    height: height,
    halfHeight: height / 2,
    footprint: radius * 2
  };
}

export const DIMS = {
  D, width, tierDepth, tierDrop, tierCount, playDepth,
  shelfDepth, fixedDepth, stroke, deckThick, deckStep, chamfer,
  tiers, tierTop, tierLast, trayY,
  wallThick, wallHeight, panelHeight, panelZ,
  zoneCount, zoneWidth, zoneCentresX,
  itemDims
};

export const TIERS = tiers;
