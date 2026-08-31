/* ============================================================================
   COIN PUSHER — HOST CONFIG
   This is the only file you should need to edit before a quiz night.
   ========================================================================= */

window.COIN_PUSHER_CONFIG = {

  /* --------------------------------------------------------------------
     ITEM TYPES
     Every object on the shelf is an "item". Each one has a look and a value.

       image:  filename inside the assets/ folder, e.g. 'chocolate.png'
               (use null to fall back to a plain coloured disc)
       color:  fallback colour, also used for the prize-log dot
       radius: physics size in px. 16 = standard coin. Bigger = harder to shift.
       value:  { type: 'points', amount: 10 }
            or { type: 'prize',  label: 'Chocolate bar' }
     -------------------------------------------------------------------- */
  itemTypes: {
    coin: {
      label: 'Coin',
      image: null,
      color: 0xE8C24A,
      radius: 16,
      value: { type: 'points', amount: 10 }
    },
    token50: {
      label: '50 Token',
      image: null,
      color: 0x4FD6C0,
      radius: 17,
      value: { type: 'points', amount: 50 }
    },
    token100: {
      label: '100 Token',
      image: null,
      color: 0xE0603F,
      radius: 17,
      value: { type: 'points', amount: 100 }
    },
    chocolate: {
      label: 'Chocolate bar',
      image: null,
      color: 0x8B4A2B,
      radius: 17,
      value: { type: 'prize', label: 'Chocolate bar' }
    },
    voucher: {
      label: 'Cinema voucher',
      image: null,
      color: 0xB05FD6,
      radius: 17,
      value: { type: 'prize', label: 'Cinema voucher' }
    }
  },

  /* What actually drops when the host clicks a drop zone. */
  dropItem: 'coin',

  /* --------------------------------------------------------------------
     STARTING SHELF (Random mode)
     Scattered across the shelf at setup. tier: 1 = top, 2 = bottom.
     -------------------------------------------------------------------- */
  startingLayout: [
    { type: 'coin',      count: 40, tier: 1 },
    { type: 'coin',      count: 41, tier: 2 },
    { type: 'token50',   count: 3,  tier: 1 },
    { type: 'token100',  count: 1,  tier: 2 },
    { type: 'chocolate', count: 2,  tier: 2 },
    { type: 'voucher',   count: 1,  tier: 1 }
  ],

  /* --------------------------------------------------------------------
     FEEL / TUNING — the knobs worth playing with
     -------------------------------------------------------------------- */
  tuning: {
    /* --- the shelf ------------------------------------------------------ */
    pusherPeriodMs:   2600,  // one full back-and-forth stroke. Higher = slower.
    pusherAmplitude:  42,    // how far the shelf slides each stroke (px)
    shelfLength:      34,    // length of the shelf when fully withdrawn into
                             // its slot. It extends by pusherAmplitude on top
                             // of this. Coins on it are carried forward, and
                             // are left behind when it withdraws.
    shelfGrip:        0.2,  // how firmly the moving shelf drags its coins.
                             // Low = coins slip and the shelf slides under the
                             // pile. High = the shelf shoves everything hard.

    /* --- the drop chute -------------------------------------------------- */
    chuteGravity:     0.03,  // downward pull on a coin falling through the pegs.
                             // Lower = a slower fall, which both scatters the
                             // coin more and widens the window to time a drop.
    chuteEntrySpeed:  0.6,   // how fast it enters at the top
    chuteMaxSpeed:    2.4,   // terminal speed, so it rattles instead of diving
    chuteTimeoutMs:   6000,  // safety: force a coin to land if it wedges
    pegRadius:        5,
    pegSpacing:       56,    // must stay wider than a coin, or nothing gets through
    pegRows:          3,     // rows must sit further apart than a coin is wide,
                             // or coins jam between two rows at once
    pegBounce:        0.8,   // how lively the pegs are

    /* --- how coins behave on the shelf ---------------------------------- */
    floorFriction:    0.002, // coins slide on a shelf: flat speed lost per step.
                             // Higher = shorter, heavier shoves.
    stopThreshold:    0.0008, // below this speed an item is treated as at rest
    itemFrictionAir:  0.005, // near zero - floorFriction does the real work
    itemFriction:     0.02,  // coin-on-coin grip. Keep low - a high value
                             // locks the pile into a rigid raft that no
                             // amount of pushing will shift.
    edgeTip:          0.6,   // shove given to a coin overhanging the lip
    tipOverhang:      0.35,  // how far over the lip a coin must be before it
                             // tips. The starting pile is loaded to just
                             // behind this line, so the machine begins primed
                             // without spilling on its own.
    itemFrictionStatic: 0.01,
    itemRestitution:  0.05,  // bounciness. Keep low for a weighty feel
    itemDensity:      0.002,
    rowGap:           1,     // slack between rows of the starting pile. This is
                             // what stops the pile being a rigid incompressible
                             // block - drops take up the slack, then things fall.

    /* --- look ------------------------------------------------------------ */
    spawnJitterPx:    9,     // random wobble on where a coin enters the chute
    flattenY:         0.72   // 1.0 = circles, lower = flatter perspective discs
  }
};
