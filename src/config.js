/* ============================================================================
   COIN PUSHER - HOST CONFIG
   This is the only file you should need to edit before a quiz night.
   ========================================================================= */

window.COIN_PUSHER_CONFIG = {

  /* --------------------------------------------------------------------
     SCALE
     Everything else in the machine is derived from these. The world is
     modelled at 10x real size (a 24mm coin becomes 0.24 units) because
     Rapier's contact tolerances are tuned for roughly human-scale objects
     and behave poorly down at millimetre scale.

     coinsAcrossWidth is the number that decides how the machine FEELS.
     It sets how much one added coin advances the pile. Measured off the
     reference photo at about 10.
     -------------------------------------------------------------------- */
  scale: {
    coinDiameter:  0.24,
    coinThickness: 0.02,

    coinsAcrossWidth: 10,   // machine width, in coins
    coinsDeepPerTier:  6,   // depth of each tier, in coins

    /* How many tiers the machine has.

       1 is the machine as specified: a coin drops in, lands on the shelf,
       tumbles off the shelf's front edge onto the fixed platform, gets shoved
       along it and falls off the front to score. Nothing below that.

       One tier means one shelf, which is the whole mechanism. Set to 2 to get
       a second tier below, fed by whatever falls off the first - but note the
       lower tier gets its own shelf, and the brief calls for only one. */
    tierCount: 1,

    /* Of a tier's depth, how much is fixed floor at the front. The rest is
       the moving shelf, at the back. Reference photos read as a third to
       a half. */
    fixedFloorFraction: 0.45,

    /* How much of the shelf withdraws into the cabinet on the back stroke.
       0.5 = about half of it disappears, which is what the machine does. */
    shelfStrokeFraction: 0.5,

    /* How far the deck's top sits ABOVE the fixed floor, in coin diameters.

       0 is a flush deck. Measured, a flush deck does not work: it can only
       transmit force through friction, friction is symmetric, and it drags
       the pile back exactly as hard as it pushes it. 60 coins added over 60
       strokes gave net creep of 0.003 coin/stroke and nothing fell off at all.

       A step gives the deck a vertical front face. That face pushes on the
       out-stroke and simply separates from the coins on the return, which is
       the one-way element a pusher needs, and it is what a real machine has.
       Coins tumble off the front of the deck onto the field and cannot climb
       back on. About half a coin diameter. */
    deckStepInCoins: 0.55,

    /* Height from the top tier's surface down to the bottom tier's. */
    tierDropInCoins: 1.6
  },

  /* --------------------------------------------------------------------
     ITEM TYPES
     Every object on the shelf is an "item".

       shape:  'disc' or 'box'
       size:   for a disc, { diameter, thickness }
               for a box,  { width, height, depth }
               ALL SIZES ARE IN COIN DIAMETERS, so 1.0 = exactly one coin
               across. This keeps the config valid if the scale changes.
       image:  filename inside assets/, or null for a plain coloured shape
       color:  fallback colour, also used for the prize-log dot
       density: 1.0 is a coin. Higher = heavier for its size, harder to shove
       value:  { type: 'points', amount: 10 }
            or { type: 'prize',  label: 'Chocolate bar' }

     A box dams the pile very differently from a disc - it will not roll or
     slide sideways, and it holds back everything behind it. That is a fair
     way to make a big prize feel hard-won, but do not fill the shelf with
     them.
     -------------------------------------------------------------------- */
  itemTypes: {
    coin: {
      label: 'Coin',
      image: null,
      color: 0xE8C24A,
      shape: 'disc',
      size: { diameter: 1.0, thickness: 0.085 },
      density: 1.0,
      value: { type: 'points', amount: 10 }
    },
    token50: {
      label: '50 Token',
      image: null,
      color: 0x4FD6C0,
      shape: 'disc',
      size: { diameter: 1.15, thickness: 0.09 },
      density: 1.0,
      value: { type: 'points', amount: 50 }
    },
    token100: {
      label: '100 Token',
      image: null,
      color: 0xE0603F,
      shape: 'disc',
      size: { diameter: 1.15, thickness: 0.09 },
      density: 1.0,
      value: { type: 'points', amount: 100 }
    },
    chocolate: {
      label: 'Chocolate bar',
      image: null,
      color: 0x8B4A2B,
      shape: 'box',
      size: { width: 1.7, height: 0.3, depth: 0.75 },
      density: 0.6,
      value: { type: 'prize', label: 'Chocolate bar' }
    },
    voucher: {
      label: 'Cinema voucher',
      image: null,
      color: 0xB05FD6,
      shape: 'box',
      size: { width: 1.3, height: 0.16, depth: 0.9 },
      density: 0.4,
      value: { type: 'prize', label: 'Cinema voucher' }
    }
  },

  /* What actually drops when the host clicks a drop zone. */
  dropItem: 'coin',

  /* --------------------------------------------------------------------
     STARTING SHELF
     Scattered across the shelf at setup. tier: 1 = top, 2 = bottom.
     Loaded from the front lip backwards, so the machine starts primed.
     -------------------------------------------------------------------- */
  startingLayout: [
    { type: 'coin',      count: 42, tier: 1 },
    { type: 'token50',   count: 2,  tier: 1 },
    { type: 'token100',  count: 1,  tier: 1 },
    { type: 'chocolate', count: 1,  tier: 1 },
    { type: 'voucher',   count: 1,  tier: 1 }
  ],

  /* --------------------------------------------------------------------
     PHYSICS
     Tune these. Do not add rules - that was what sank the 2D attempt.
     -------------------------------------------------------------------- */
  physics: {
    gravity:          -9.81,
    timestep:         1 / 60,
    solverIterations: 8,

    /* A disc's collider is a many-sided prism, not a mathematical
       cylinder. Rapier's cylinder-vs-cylinder contacts collapse to a
       single point and the pile never stops shivering; flat facets give
       it a proper multi-point manifold. 16 sides is visually identical.
       Set to 0 to go back to a true cylinder and see the difference. */
    discColliderSides: 16,

    /* Damping stands in for the spin friction a real coin gets from its
       contact patch, which a point-contact solver does not model at all:
       without it a coin spinning on its own axis never slows down. Too
       high and coins get sluggish about tipping over the lip, so this is
       a knob to revisit once the shelf is moving. */
    linearDamping:  0.20,
    angularDamping: 3.50,

    itemFriction:    0.32,  // coin on coin. Too high and the pile locks up
    itemRestitution: 0.04,  // keep low for a weighty feel
    shelfFriction:   1.00,  // the moving deck needs grip to carry its coins
    floorFriction:   0.30,  // fixed floor ahead of the shelf
    wallFriction:    0.08,

    /* The starting pile is dropped in from a stagger of heights so it
       lands jumbled rather than in a tidy grid, and that takes a good
       few seconds to come to rest. Run those steps before the first
       frame is drawn, so the machine is already settled when the host
       sees it. Costs about a second at startup. */
    presettleMaxSteps: 2400,
    presettleAngularDamping: 12.0,
    presettleLinearDamping:   2.0,

    /* A kinematic deck sliding under a SLEEPING pile moves nothing at
       all, so while the shelf runs every item is kept awake. This is the
       known cost of sleeping being on: it buys a cheap idle machine and
       a clean settle, and it has to be switched off the moment anything
       moves. Set false to test whether Rapier's own contact waking is
       enough on its own. */
    wakeAllWhileRunning: true,

    /* Let the pile fall asleep when it settles. Rapier will need waking
       once the shelf starts moving - that is a later problem, and a known
       one. */
    allowSleep: true
  },

  /* --------------------------------------------------------------------
     THE SHELF
     One mechanism drives both tiers together, in phase. Constant rhythm -
     no speed-ups, no pauses, the period never varies.

     motion: 'sine' is a real crank-driven pusher, easing at each end of
     the stroke. 'triangle' is literally constant speed with an instant
     reversal, which is harsher on the solver because the deck's velocity
     flips sign in a single step. Both keep the rhythm fixed.
     -------------------------------------------------------------------- */
  shelf: {
    periodMs: 2600,
    motion: 'sine',
    startRunning: true
  },

  /* --------------------------------------------------------------------
     CAMERA
     Fixed. Frontal and symmetric so all four drop panels are equally
     clickable, elevated enough to judge how far forward the pile has crept.
     -------------------------------------------------------------------- */
  camera: {
    elevationDeg: 30,     // degrees off horizontal
    distance:     3.45,    // how far back from the point it looks at
    fovDeg:       38,
    lookAt: {
      y:         0.38,    // world height the camera is aimed at
      zFraction: 0.45     // how far into the playfield, 0 = back, 1 = front lip
    }
  },

  /* Plain-shape colours for this pass. Art is a later phase. The deck is
     red and the fixed floor white, matching the reference machine, so the
     shelf's travel is readable while tuning. */
  palette: {
    background: 0x0B0616,
    deck:       0xD8232A,
    fixedFloor: 0xF2F0EE,
    wall:       0xB9A9C9,
    cabinet:    0x2A1B3D,
    panel:      0xF6F2F4,
    panelEdge:  0xB9A9C9,
    peg:        0x54455F,
    tray:       0x1A1030
  }
};
