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
const deckRake    = deckStep * S.deckRakeFraction;
const deckSkirt   = D * 0.25;                // how far the shelf reaches below
                                             // floor level, so coins cannot
                                             // slip under its leading edge

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

/* How far the cabinet carries on below the playfield. Items are deleted the
   moment they leave the lip, so there is nothing down here to look at - this
   is just enough of a lip for items to fall past on their way out. It used to
   be 2.2 coins holding a catch tray, which caught nothing and took up most of
   the lower third of the screen. */
const trayY = tierLast.y - D * S.skirtBelowLipInCoins;

/* ---- cabinet shell ---- */
const wallThick   = D * 0.35;
const wallHeight  = tierDrop + D * 3;
const panelHeight = D * CFG.chute.heightInCoins;   // the drop panes
const panelZ      = D * 0.15;       // stood just in front of the back wall

/* How wide the machine actually is, tubes included.
   The light tubes stand OUTSIDE the cabinet walls, each one a gap plus its
   own thickness further out than the one within it. Framing to the cabinet's
   half-width alone ran the outermost tube off the left of the screen, because
   as far as the camera was concerned it was not part of the machine. */
const LT = CFG.lightTubes;
const tubeBands = LT && LT.enabled ? LT.colours.length : 0;
const outerHalfWidth = width / 2 + wallThick +
  tubeBands * (LT ? LT.gap + LT.radius * 2 : 0);

/* ---- the drop chute ----------------------------------------------------
   A thin vertical volume behind glass, one per drop zone. The coin enters
   ON EDGE at the top and stays roughly in plane because the chute is barely
   thicker than the coin, which is what makes the peg bounces read.
   ---------------------------------------------------------------------- */
const C = CFG.chute;
const chuteDepth  = S.coinThickness * C.depthInCoinThicknesses;
const chuteTop    = tierTop.y + panelHeight;
const chuteBottom = tierTop.y + deckStep + D * C.exitHeightInCoins;
/* NOT deck level: see chute.exitHeightInCoins. A coin still on edge at the
   bottom of a chute this thin cannot topple, so the chute opens out above
   the deck and the coin falls the last stretch in free air. */
const pegRadius   = D * C.pegRadiusInCoins;
const pegRowDx    = D * C.rowOffsetInCoins;
const slotBottom  = chuteTop - (chuteTop - chuteBottom) * C.slotHeightFraction;

/* Peg columns across the FULL width, staggered row to row.

   A coin is one diameter across in every direction, so every gap it falls
   through has to clear a whole coin. Pick the densest row that still does,
   then offset alternate rows by half a spacing so the coin gets a real
   left-or-right choice at every row instead of a clear run. */
const pegCols = (function () {
  /* 1.1 coin diameters of clearance is too tight - items wedge in the gaps.
     1.5 leaves a gap of about 1.57 coins, which still gives five pegs per row
     and plenty of bouncing, with room to actually get through. */
  let n = Math.floor(width / (D * 1.5 + pegRadius * 2)) - 1;
  if (n < 1) n = 1;
  const s = width / (n + 1);
  const a = [], b = [];
  for (let i = 0; i < n; i++) a.push(-width / 2 + s * (i + 1));
  for (let i = 0; i < n - 1; i++) b.push(-width / 2 + s * (i + 1) + s / 2);
  return { spacing: s, gap: s - pegRadius * 2, a: a, b: b };
})();

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
  shelfDepth, fixedDepth, stroke, deckThick, deckStep, chamfer, deckSkirt, deckRake,
  tiers, tierTop, tierLast, trayY,
  wallThick, wallHeight, panelHeight, panelZ, outerHalfWidth,
  zoneCount, zoneWidth, zoneCentresX,
  chuteDepth, chuteTop, chuteBottom, pegRadius, pegRowDx, slotBottom, pegCols,
  itemDims
};

export const TIERS = tiers;
