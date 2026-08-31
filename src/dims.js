/* ============================================================================
   DIMENSIONS
   Every measurement in the machine, derived from config.scale. Nothing else
   in the codebase should contain a hard-coded size.

   Axes:
     x  left/right, 0 at the centre of the machine
     y  up, 0 at the BOTTOM tier's surface
     z  depth, 0 at the back wall, increasing TOWARDS the viewer

   So the back of the cabinet is z = 0 and coins score by falling off the
   largest z.
   ========================================================================= */

const CFG = window.COIN_PUSHER_CONFIG;
const S = CFG.scale;

const D = S.coinDiameter;

/* ---- the playfield ---- */
const width     = S.coinsAcrossWidth * D;
const tierDepth = S.coinsDeepPerTier * D;
const tierDrop  = S.tierDropInCoins  * D;

/* ---- the shelf ---------------------------------------------------------
   The shelf is FLUSH: its deck top sits level with the fixed floor ahead of
   it, and coins slide across the seam rather than stepping up onto it. It
   pushes nothing directly. It carries the coins sitting on it by friction,
   and those coins shove the ones ahead. That is the whole mechanism.

   Its leading edge is chamfered, so that when it returns it wedges under
   any coin that dropped into the well behind it instead of butting into it.
   ---------------------------------------------------------------------- */
const shelfDepth  = tierDepth * (1 - S.fixedFloorFraction);
const fixedDepth  = tierDepth - shelfDepth;
const stroke      = shelfDepth * S.shelfStrokeFraction;
const deckThick   = D * 0.12;
const deckStep    = D * S.deckStepInCoins;   // 0 = flush deck
const chamfer     = D * 0.18;   // horizontal run of the leading-edge bevel

/* ---- vertical stack ---- */
const tier2Y = 0;
const tier1Y = tierDrop;
const trayY  = -D * 2.2;

/* ---- z spans -----------------------------------------------------------
   Tier 1 runs from the back wall forward. Tier 2 begins at tier 1's lip and
   runs forward again, so tier 1 spills onto tier 2's own moving shelf.
   ---------------------------------------------------------------------- */
const tier1 = {
  y:          tier1Y,
  backZ:      0,
  lipZ:       tierDepth,
  shelfHomeZ: shelfDepth,          // z of the deck's leading edge, fully out
  fixedBackZ: shelfDepth,
  fixedLipZ:  tierDepth
};

const tier2 = {
  y:          tier2Y,
  backZ:      tierDepth,
  lipZ:       tierDepth * 2,
  shelfHomeZ: tierDepth + shelfDepth,
  fixedBackZ: tierDepth + shelfDepth,
  fixedLipZ:  tierDepth * 2
};

const playDepth = tierDepth * 2;

/* ---- cabinet shell ---- */
const wallThick   = D * 0.35;
const wallHeight  = tierDrop + D * 3;
const panelHeight = D * 5.2;        // the four drop panes, above tier 1
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
    radius,
    height,
    halfHeight: height / 2,
    footprint: radius * 2
  };
}

export const DIMS = {
  D, width, tierDepth, tierDrop, playDepth,
  shelfDepth, fixedDepth, stroke, deckThick, chamfer, deckStep,
  tier1, tier2, trayY,
  wallThick, wallHeight, panelHeight, panelZ,
  zoneCount, zoneWidth, zoneCentresX,
  itemDims
};

export const TIERS = [tier1, tier2];
