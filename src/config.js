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

    coinsAcrossWidth: 13.75, // machine width, in coins
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
    /* Measured off the footage at roughly 2.2 coin diameters, correcting the
       56px of on-screen travel for foreshortening (counters read as ellipses
       about 0.54 as tall as wide). */
    shelfStrokeFraction: 0.62,

    /* How far the deck's top sits ABOVE the fixed floor, in coin diameters.

       0 is a flush deck. Measured, a flush deck does not work: it can only
       transmit force through friction, friction is symmetric, and it drags
       the pile back exactly as hard as it pushes it. 60 coins added over 60
       strokes gave net creep of 0.003 coin/stroke and nothing fell off at all.

       A step gives the deck a vertical front face. That face pushes on the
       out-stroke and simply separates from the coins on the return, which is
       the one-way element a pusher needs, and it is what a real machine has.
       Coins tumble off the front of the deck onto the field and cannot climb
       back on.

       This is the ONLY step in the machine, and it does both jobs at once:
       items ride the shelf top, tumble off this face onto the platform below,
       and that same face then pushes them along it. So it is a real level
       drop, not a lip - at 0.55 of a coin it read as a bump and the two
       levels were not legible. */
    deckStepInCoins: 1.4,

    /* How far the TOP of the shelf's front face is set back from its bottom,
       as a fraction of the step height. A dead vertical face cannot lift
       anything: a coin that is jammed and cannot slide forward simply gets
       overrun, and once it is inside the shelf it is enclosed by a kinematic
       body and never comes out. Measured with a vertical face and no drops at
       all, buried coins stayed buried for a median of 9 seconds.

       Raking the face makes its normal point forward AND up, so a coin that
       cannot move forward rides up onto the deck instead of being run over.
       The face still pushes - the rake is mild. */
    deckRakeFraction: 0.0,   // measured: raking made burial WORSE, 56 -> 75
                             // episodes. Kept configurable, set to 0.

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
      size: { diameter: 1.0, thickness: 0.16 },
      density: 1.0,
      value: { type: 'points', amount: 10 }
    },
    token50: {
      label: '50 Token',
      image: null,
      color: 0x4FD6C0,
      shape: 'disc',
      size: { diameter: 1.15, thickness: 0.17 },
      density: 1.0,
      value: { type: 'points', amount: 50 }
    },
    token100: {
      label: '100 Token',
      image: null,
      color: 0xE0603F,
      shape: 'disc',
      size: { diameter: 1.15, thickness: 0.17 },
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
    { type: 'coin',      count: 57, tier: 1 },
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
    solverIterations: 16,

    /* Rapier scales its contact tolerances by this. It defaults to 1, meaning
       metre-sized objects, and it allows contact penetration of 0.005 of that
       before it considers anything wrong. Our coins are 0.0204 THICK - so the
       default tolerance is a quarter of a coin's thickness, which is why thin
       discs sink into the shelf and take a second or more to climb back out.

       Setting it to roughly the size of a real object here scales that down.
       Measured over 40 strokes: worst case a coin spent inside the shelf fell
       from 8.5s to 2.7s, and episodes lasting over a second from 14 to 4.

       Set to 0.2. Briefly reverted to 1.0 to cure pile shimmer, which worked
       but multiplied Rapier's allowed contact penetration by five and made
       items visibly overlap each other. The shimmer is dealt with by
       renderDeadzone and wakeAllWhileRunning instead, which cost nothing.

       Original reasoning, still valid: Tightening it was the right call when the shelf step
       was only 0.55 of a coin and the period 2.6s, but the step is now 1.4
       and the period 7s, and those removed the sinking on their own. The
       tightening was left behind doing nothing useful except making every
       resting contact stiffer, which is what made the pile shiver.

       Measured, same 8 strokes: at 0.2 the settled pile had mean speed
       0.0110 and mean spin 0.326; at 1.0 it is 0.0052 and 0.158, and the
       trapped-item guard fires a fraction as often. Do not go below 0.2 - at
       0.08 the solver destabilises badly. */
    lengthUnit: 0.2,

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
       enough on its own.

       Set FALSE. Rapier wakes bodies on contact by itself, so the shelf still
       picks up everything it touches - measured, throughput and scoring are
       unchanged. Forcing every item awake every step meant the pile could
       never settle, and a pile that never settles is a pile that visibly
       shivers. This was half the wobble. */
    wakeAllWhileRunning: false,
    /* How far an item must actually drift before its mesh is redrawn. A
       resting pile never goes perfectly still - the solver regenerates a
       little contact noise every step - and below these thresholds that noise
       is not movement, it is shimmer. Purely a drawing decision; the physics
       is untouched. Raise if the pile still shivers, lower if slow genuine
       motion looks steppy. */
    renderDeadzone:      0.0012,   // world units, coin is 0.24 across
    renderDeadzoneAngle: 0.00002,  // 1 - dot(q1,q2); about 0.4 degrees


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
    /* Measured off the reference footage: the real machine runs a full
       in-and-out cycle in about 9 seconds. Tracked frame by frame in two
       separate shots - peak to trough of 4.7s in one, 4.3s in the other.

       Set to 7000 at the host's request: a little quicker than the real
       machine, which suits a quiz where the drop wants to feel responsive. */
    periodMs: 7000,
    motion: 'sine',
    startRunning: true
  },

  /* --------------------------------------------------------------------
     THE DROP CHUTE
     The coin does not drop straight onto the shelf. It goes in at the BACK
     of the machine, behind glass, and falls through a field of pegs before
     landing. So a drop zone is not an aiming device - it biases where the
     coin lands, it does not choose it.

     PEG SPACING IS NOT FREE. A coin is a disc, which means it is exactly one
     diameter across in every direction, so any gap it falls through has to
     be wider than a whole coin. A chute 2.5 coins wide has room for at most
     two such gaps side by side. That is why the dense dot grid in the
     reference photograph cannot be a peg field the coin passes through - as
     pegs it would simply be a wall. Rows here alternate instead:

     A PAIR OF PEGS IN ONE ROW IS IMPOSSIBLE HERE, and this was measured the
     hard way - 39 of 40 coins jammed. Setting the pair wide enough to leave a
     passable gap against each divider forces the centre gap shut; setting it
     narrow enough to open the centre gap closes the sides. Either way the
     coin wedges in a pocket it cannot descend.

     So: ONE peg per row, offset a little from the centreline, alternating
     side each row. Both gaps stay wider than a coin, and the coin still picks
     left or right at every row - four rows is sixteen paths. The offset must
     stay under about 0.17 of a coin or the tighter gap shuts.
     -------------------------------------------------------------------- */
  chute: {
    depthInCoinThicknesses: 2.6,   // front-to-back gap the coin falls down

    /* Total height of the drop, in coins. The fall has to take a real
       fraction of a shelf stroke or timing the drop means nothing. */
    heightInCoins:          13,

    /* The four entry slots are only divided for the TOP of the chute. Below
       that the peg field opens out to the FULL WIDTH of the machine.

       This is what makes a real peg field possible. Sealed into its own
       2.5-coin-wide box, a chute has room for exactly one peg per row, near
       the centreline - which is why the pegs were all stacked in the middle.
       Across the full 10-coin width there is room for seven per row, so a
       coin can bounce sideways between them. The slot still biases where it
       ends up; it no longer dictates it. */
    slotHeightFraction:     1.0,
    /* Four rows, not five. A fifth row is a single peg on the zone
       centreline at the very bottom of the field, which means an item can
       never leave the chute down the middle of its zone. Ending on a PAIR
       leaves a 1.15-coin gap on the centreline, so the middle is a real
       outcome again. 0 = no pegs at all. */
    pegRows:                4,

    /* Vertical spacing between peg rows, in coin diameters. MUST exceed 1.0.
       The 2D build already knew this and said so in its own config: "rows
       must sit further apart than a coin is wide, or coins jam between two
       rows at once". I did not carry the warning over, packed seven rows into
       a space that allowed 0.54 of a coin between them, and every coin
       spanned two rows and wedged. Rows are now derived from this gap and the
       space available, so the machine cannot be configured into that state. */
    pegRowGapInCoins:       1.5,
    /* Where the peg field starts and how far apart the rows are, as
       fractions of the chute height. The first row has to clear the entry
       point by more than a coin radius plus a peg radius, or coins are born
       interpenetrating the first peg and wedge on the spot. */
    firstRowFraction:       0.32,
    rowGapFraction:         0.15,
    entryHeightInCoins:     0.55,  // how far below the top the coin enters

    /* How far ABOVE the deck the chute opens out, in coins. This is not
       cosmetic. The chute is barely thicker than a coin, so a coin that
       reaches the bottom still on edge is held upright by the glass and can
       never topple flat - it just stands there forever. Measured: with the
       chute running down to deck level, half of all coins stuck standing on
       edge at the bottom. The chute has to end high enough that the coin
       leaves it in free air and lands flat. */
    /* Measured off the reference close-up: the gap between the bottom of the
       glass and the surface below is about ONE coin diameter - a counter
       standing on edge is TALLER than it, and that is the whole point.

       The item drops down behind the glass and comes to rest vertically with
       its top caught behind the glass edge. The shelf then drags its lower end
       forward, the item pivots over that edge, and it is released - landing
       flat, which is the only way it can push anything.

       So this MUST be less than 1.0. At 1.05 the item stood clear of the edge,
       nothing caught it, and it simply rode along upright and useless. */
    exitHeightInCoins:      0.92,
    pegRadiusInCoins:       0.035,
    /* Peg offset from the zone centreline, alternating side each row.

       One peg per row per zone is the maximum: two side by side is
       geometrically impossible even in a 3.13-coin zone, because opening the
       side gaps to clear a coin closes the middle one and the reverse.

       The offset is what makes a single peg worth having - dead centre it
       just splits the flow evenly every time. Both gaps keep clearing a whole
       coin while this stays under about 0.51, so 0.40 leaves margin. */
    /* A quincunx: rows alternate between a PAIR set either side of the
       centreline and a SINGLE peg on it, so an item meets three gaps then
       two, staggered.

       The pair is the tight part. Its offset must be large enough that the
       middle gap clears a whole coin and small enough that the two side gaps
       do too, and those demands nearly meet. In a 3.12-coin zone they cross
       over and a pair is flatly impossible - which is why the machine widened
       again to make room. At 3.44 coins the valid window is 0.128 to 0.164,
       and 0.146 sits in the middle of it. */
    pairOffsetInCoins:      0.61,

    /* One row also carries a peg hard against each edge of the zone, sitting
       from the top, zero-based, so 2 is the third row down.

       Sat exactly on the divider they were never hit - an item's rim reaches
       the divider before its centre can get near a peg buried in it - so they
       are set inboard instead.

       Note only ONE of the two gaps either side of them can pass an item.
       Clearing a whole coin outside AND inside needs the offset to be at once
       under 0.68 and over 1.07 coins. So these deflect rather than sort: the
       outer gap is deliberately far too tight to enter (0.33 of a coin at
       this offset, well clear of the 0.53 that wedged items in an earlier
       attempt) and everything is funnelled through the inner gap. */
    edgePegRow:             2,
    edgePegOffsetInCoins:   1.35,
    entryJitterInCoins:     0.30,  // scatter on where the coin enters

    /* The coin does not enter at rest. Dropped dead vertical it lands square
       on a peg apex and balances there - measured at a third of all drops.
       A real coin is pushed into the slot and arrives with sideways motion,
       and that is also what stops the fall being repeatable. Coin diameters
       per second, random direction. */
    entrySpeedInCoins:      1.8,
    entrySpinInCoins:       6.0,
    glassOpacity:           0.20
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

    /* Pull back until the whole machine is inside the frame, whatever shape
       the screen is. Without this the framing is tuned for one aspect ratio
       and a phone held upright crops the machine's sides off, because a
       perspective camera keeps its VERTICAL angle and narrows horizontally.
       `distance` above is the starting guess. */
    autoFit:      true,
    fitMargin:    0.94,
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
