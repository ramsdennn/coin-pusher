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
    /* How far the cabinet extends below the front lip, in coins. Items are
       removed as they fall off, so this only needs to be deep enough to see
       them go. */
    /* 0.55 left the machine stopping dead just under the lip - a cliff edge.
       2.05 carries the red fascia and the cabinet sides down past the bottom
       of the frame so the machine reads as continuing rather than ending. The
       camera fit deliberately does NOT include this, so it bleeds off the
       edge instead of shrinking the playfield to make room for it. */
    skirtBelowLipInCoins: 2.05,

    /* The side walls are not a plain slab. They stand one coin above the
       shelf surface and hold that height back as far as the shelf reaches at
       full extension - so nothing can spill over the side while it is being
       pushed - then fall away at a shallow angle to the front of the machine,
       which opens up the view of the pile rather than fencing it in. */
    wallAboveShelfInCoins: 1.0,
    wallDescentDeg:        20,

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
    /* Two coins, identical but for their colour, so the pile reads as a mix
       the way the real machine's does. A dark grey and a mid-light grey,
       picked by rendering candidate pairs in the pile under the real scene
       lighting and comparing them side by side.

       Note how much lighter these render than the hex suggests - the scene is
       bright, and a lighter pair tried first came out reading as white rather
       than as grey at all.

       They are separate TYPES rather than one type with two colours because
       everything downstream - the geometry cache, the material cache, the
       dimensions, the fallen-item tally - is keyed by type id. A type that
       could come in more than one colour would have to be special-cased in
       every one of them.

       finish is optional. Left out, an item uses the defaults in items.js.
       These two are plastic, not metal: low roughness for a sharp highlight,
       almost no metalness, which is what makes them read as glossy discs
       rather than the gold tokens they started as. */
    coinLight: {
      label: 'Light coin',
      image: null,
      color: 0x9AA0A7,
      finish: { roughness: 0.25, metalness: 0.05 },
      shape: 'disc',
      size: { diameter: 1.0, thickness: 0.16 },
      density: 1.0,
      value: { type: 'points', amount: 10 }
    },
    coinDark: {
      label: 'Dark coin',
      image: null,
      /* Dark grey, not black. A true black disc loses its edges against the
         shadows between coins and the pile turns into one dark mass; keeping
         it off the floor is what holds the individual coins apart. */
      color: 0x4A4F55,
      finish: { roughness: 0.25, metalness: 0.05 },
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

  /* --------------------------------------------------------------------
     LOGO
     Sits in the empty right-hand side of the screen that camera.widthFraction
     frees up. A screen-space overlay, not geometry in the scene: it has to
     hold the same place on any TV, it must not be walked through by the
     camera, and drawn as an image it costs the renderer nothing.

     Sizes are fractions of the window, so the placement holds at any size
     without a resize handler - the browser does the arithmetic in CSS.
     -------------------------------------------------------------------- */
  logo: {
    enabled: true,
    src: 'assets/logo/tipping-point.svg',
    widthFraction:   0.34,   // of the window's WIDTH
    centreAtScreenX: 0.81,   // matches camera.centreAtScreenX in spirit
    topFraction:     0.05,   // of the window's HEIGHT
    opacity:         1.0
  },

  /* What actually drops when the host clicks a drop zone. */
  /* A single type id, or a list to cycle through. Cycling, not picking at
     random: random drifts, and across a night's play one colour would end up
     noticeably commoner than the other. */
  dropItem: ['coinLight', 'coinDark'],

  /* --------------------------------------------------------------------
     STARTING SHELF
     Scattered across the shelf at setup. tier: 1 = top, 2 = bottom.
     Loaded from the front lip backwards, so the machine starts primed.
     -------------------------------------------------------------------- */
  startingLayout: [
    /* Plain coins only for now. The token and prize types are still defined
       above and still work - they are just not loaded onto the shelf. Add a
       line back here to bring one in. The count is 62 rather than 57 so the
       field holds the same number of items it did with the extras. */
    { type: 'coinLight', count: 31, tier: 1 },
    { type: 'coinDark',  count: 31, tier: 1 }
  ],

  /* --------------------------------------------------------------------
     PHYSICS
     Tune these. Do not add rules - that was what sank the 2D attempt.
     -------------------------------------------------------------------- */
  physics: {
    gravity:          -9.81,
    timestep:         1 / 60,
    /* Four, not sixteen. Prompted by the reference implementation at
       github.com/gildas-lormeau/coin-pusher-2000, which runs on two.

       Sixteen was not just wasteful, it was WORSE. Measured over two runs of
       8 strokes each - coin pairs overlapping by more than a quarter of a
       diameter per 100 coins, against the physics cost:

           2 iterations    14.2 overlap    30 ms per simulated second
           4 iterations     4.4 overlap    41 ms
           8 iterations     9.2 overlap    65 ms
          16 iterations     7.5 overlap   103 ms

       Four is the best result on the table and two and a half times cheaper
       than sixteen. Rapier's solver is soft-contact based, and piling on
       iterations makes it over-correct rather than converge. Chute fall time
       and delivery were unchanged across all four settings. */
    solverIterations: 4,

    /* Rapier's inner PGS loop. Defaults to 1; 4 measurably reduces how far
       items interpenetrate when the shelf compresses the pile, for almost no
       cost (2.32 -> 2.37 ms/step). It does NOT solve the problem - see the
       note on shelf compression below. */
    pgsIterations: 4,

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
    /* Contact stiffness, in Hz. Rapier models a contact as a spring, and this
       is its natural frequency; the default is 30.

       This is what stops coins visibly sinking into each other while the shelf
       is pushing. The metric is pairs of flat coins on the field whose rims
       cross by more than a quarter of a diameter, counted per 100 coins, after
       8 strokes.

       Measured A/B/A within ONE page load, four runs each, because the first
       run after a load is reliably the worst and comparing across loads made
       the warm-up look like a result:

           30 Hz (default)   13.1    spread  6-21    14 delivered
           180 Hz             3.3    spread  2-4     14 delivered
           30 Hz again       15.6    spread 12-19    16 delivered

       So it is the setting and not drift over the session: 180 takes out about
       three quarters of the overlap, and delivery and pile size are unchanged.
       Note the spread as much as the average - at 30Hz the run to run
       variation is as large as the whole effect, which is a good part of why
       earlier attempts at this could not tell whether anything had helped.

       A coarser sweep put 120 Hz at roughly twice the overlap of 180, and 240
       slightly better again but delivering a third fewer coins - past the knee
       the pile goes rigid enough that the shelf stops moving it.

       It costs nothing. Contact stiffness changes the error reduction the
       solver applies, not how many iterations it runs.

       Halving the timestep instead works about as well but costs twice the
       physics budget AND changes the game: delivery jumped from 30 coins a run
       to 44-75, because the drive force integrates differently. Not worth it
       when a free dial does the same job. */
    contactHz: 180,

    /* --------------------------------------------------------------------
       REST CLAMP
       Coins must move because the player moved them, and for no other reason.
       That is the whole game, so this is a rule of the game rather than a
       physics setting, and it is enforced rather than tuned for.

       A settled pile in Rapier never actually stops. Every coin touching
       every other forms ONE contact island, so a couple of lively coins keep
       the sleep timer reset for all of them, and the solver's penetration
       correction keeps nudging positions inside world.step() forever. Left
       alone the pile shimmers, and a coin balanced on the lip eventually gets
       shaken off with nobody having touched it.

       Measured, the two motions overlap, which is why no simple threshold
       works. Per step, in coin diameters:

           at rest, nothing touching   p90 0.0039   p99 0.0082   max 0.0214
           in play, shelf pushing      p90 0.0153 (exactly the shelf's speed)

       So the worst jitter step is LARGER than a real push step. What
       separates them is direction, not size: a push is consistent, jitter is
       random. So each resting coin is pinned to a reference pose, and what
       the physics wanted to do is accumulated instead of applied. Random
       jitter random-walks about the reference and never escapes; a real push
       adds up in one direction and breaks out within two or three steps,
       after which the coin is released and behaves completely normally.

       The coin stays a DYNAMIC body throughout. An earlier attempt froze
       resting coins into static bodies instead, and that failed badly: the
       pile's job is to carry force from the shelf to the lip, and a static
       coin cannot pass a push along, so coins dammed up behind the frozen
       ones and delivery halved. Nothing here removes a coin from the solver.

       Every coin is pinned every step, with no test on how fast it is going.
       A speed test was tried and dropped: it made the worst drifter nearly
       four times worse (0.46 of a coin against 0.12 over 15 seconds), because
       the coins that shimmer worst are exactly the ones moving fast enough to
       fail it. The deadzone is the better judge and now the only one.

       Measured at rest over 15 seconds, machine held immovable:

           off      median 0.051 coin   17 of 61 moved over a tenth of a coin
           on       median 0.002 coin    1 of 62

       Delivery is unaffected: 3.3 and 6.6 coins a stroke with it on, 8.5 and
       0.9 with it off. The machine's throughput swings that much on its own.

       One dial. Below the deadzone a coin cannot move at all; above it, the
       coin is handed back and behaves exactly as it always did. A shelf push
       covers half the deadzone in a single step, so it breaks out in two. */
    rest: {
      /* OFF. It works - it removes the shimmer almost completely - but it
         costs the machine its whole mechanic, and the measurement below says
         no amount of tuning will fix that.

           the pile's real advance    0.000125 of a coin per step
           jitter at rest, median     0.000107 per step
           jitter at rest, p90        0.0039 per step

         The pile creeps forward LESS per step than it jitters. The signal is
         1.17x the median noise and 3% of the p90. Over a whole stroke the
         real advance is 0.053 of a coin while jitter random-walks 0.079.

         So no filter on per-coin motion can tell "being pushed" from
         "shimmering" - not by speed, not by distance, not by accumulating
         direction, because the noise accumulates faster than the signal. Every
         version of this was measured killing the machine: with the clamp on,
         creep runs BACKWARDS at -0.027 a stroke against +0.013, and delivery
         falls from 6.8 coins a stroke to 0.4.

         Turning it on needs the jitter reduced at source first, or the pile
         driven hard enough to lift the signal above it. Left here with the
         numbers so the next attempt starts from them rather than from
         scratch. */
      enabled:         false,
      deadzoneInCoins: 0.030,

      /* Only pin a coin that has been moving too little to be being pushed,
         for this many steps running. Set from the measured distributions:
         jitter at rest is under 0.0082 of a coin per step at the 99th
         percentile, a coin riding the deck moves 0.0153. */
      pinBelowInCoins: 0.010,
      pinSteps:        3,

      /* Downward speed above which a coin is falling and must be left alone.
         Jitter is random in direction and never sustains a fall, so this
         separates cleanly. Coins in the chute are excluded outright. */
      fallSpeed:       0.45
    },

    lengthUnit: 0.2,

    /* A disc's collider is a many-sided prism, not a mathematical
       cylinder. Rapier's cylinder-vs-cylinder contacts collapse to a
       single point and the pile never stops shivering; flat facets give
       it a proper multi-point manifold. 16 sides is visually identical.
       Set to 0 to go back to a true cylinder and see the difference. */
    discColliderSides: 16,

    /* How much of the radius the flat faces are pulled in by, leaving the
       rim as a ridge rather than a flat band.

       This is what stops coins standing on their edge on the field. A 16-gon
       prism's rim is sixteen FLAT facets, and at this size each facet is
       0.0477 across against a coin 0.0384 thick - so a coin stood on its rim
       has a support base wider than it is thick, which is a properly stable
       resting pose. Nothing tips it over, and 12% of the field ended up
       standing up. A real coin's rim is a smooth cylinder: it touches the
       floor along a line of no width, balancing on it is a knife edge, and it
       falls flat almost at once.

       Pinching the rim to a ridge restores that. The coin can still balance
       against ROLLING, which is the one thing a real coin on its edge can do,
       but it has nothing to stand on across its thickness.

       Raising the side count instead does NOT fix it - measured, 32 sides gave
       16.9% standing against 13.3% at 16, no better at all. That result also
       corrects the reasoning above: narrow facets are not what lets a coin
       stand. What does is that a square-cut rim is FLAT across the coin's
       thickness, so the coin has a real base to balance on either way. The
       bevel takes that base away while leaving the faces almost full size.

       Measured over 10 strokes, coins standing on the field against coins
       delivered:

           chamfer 0     13.3%     40 delivered   (square rim)
           chamfer 0.08   1.8%     43 delivered
           chamfer 0.14   1.3%     24 delivered
           chamfer 0.22   1.1%      8 delivered

       So it is a trade, and past about 0.1 it turns into a bad one. A deep
       bevel meets the deck's vertical push face at an angle, so part of the
       push becomes lift and the machine stops delivering. 0.08 takes out
       seven eighths of the standing and costs nothing.

       Set 0 for the old square-rimmed prism. */
    discRimChamfer: 0.08,

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

    /* The starting pile lies flat. Items can stack on each other, but none of
       them may come to rest standing on edge - on a machine nobody has played
       yet that reads as a glitch. Enforced by locking tipping while the pile
       settles, not by nudging items afterwards. Applies to the starting pile
       only; anything dropped later tips freely. */
    flatStartingPile: true,
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

    /* The shelf is a DYNAMIC body pushed by a force-limited spring, not a
       kinematic one teleported into place.

       A kinematic body ignores contacts entirely: it goes exactly where it is
       told every step, so when items had nowhere left to go the solver was
       the only thing that could give, and items ended up 94% inside each
       other. A dynamic shelf on a capped force simply STALLS against a jam,
       which is what a real machine does.

       maxForce is the whole point. Too low and the shelf cannot push a full
       pile; too high and it crushes again, which is the behaviour we are
       trying to leave behind.

       stiffness and damping are a critically damped spring on the target
       position - stiff enough to track a 7s stroke closely, soft enough that
       resistance registers. */
    drive: {
      /* 'kinematic' or 'dynamic'.

         Kinematic is what the reference implementation uses and what this
         started as: the shelf goes exactly where it is told every step and
         ignores what the coins do about it. Dynamic came later, driven by a
         force-limited spring, so the shelf would STALL against a jam rather
         than drive through it - which cured interpenetration before
         physics.contactHz existed to do the same job better.

         Suspected of feeding the shimmer: with the shelf lifted out of the
         field entirely, at-rest drift fell from 0.050 of a coin to 0.0097 and
         the number of coins drifting fell from 20 to 4. */
      mode: 'kinematic',
      mass:      5.0,
      stiffness: 2000,
      damping:   200,
      maxForce:  10
    },
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
    /* Where the machine sits across the screen, 0 = hard left, 0.5 = centred.
       Below 0.5 it moves left and frees the right-hand side for scoreboards.

       Done as a LENS SHIFT - an off-centre projection - rather than by turning
       the camera. Turning it would view the machine from an angle, and the
       four drop panes would stop being equally square-on to the viewer, which
       is the whole reason the camera is frontal in the first place. */
    centreAtScreenX: 0.32,

    autoFit:      true,
    fitMargin:    0.94,

    /* How much of the screen's WIDTH the machine takes, leaving the rest for
       the scoreboards and logo. 0.6 is three fifths.

       This is a separate dial from fitMargin on purpose. fitMargin says how
       close the machine may come to the edge of the frame, so on a 16:9 screen
       it ends up governing the HEIGHT - and how wide the machine then lands is
       whatever the aspect ratio happens to make it. That is no good when a
       fixed slice of the screen has to stay clear for something else: change
       TV and the space for the scoreboards changes with it.

       Set this and the fit sizes the machine to that width directly, so the
       space left over is the same on any screen. fitMargin still applies as a
       ceiling, so a tall narrow window pulls back further rather than running
       the machine off the top and bottom. */
    widthFraction: 0.60,
    lookAt: {
      y:         0.38,    // world height the camera is aimed at
      zFraction: 0.45     // how far into the playfield, 0 = back, 1 = front lip
    }
  },

  /* Plain-shape colours for this pass. Art is a later phase. The deck is
     red and the fixed floor white, matching the reference machine, so the
     shelf's travel is readable while tuning. */
  /* Greys carry the machine, red is reserved for the two vertical faces that
     front each level - the shelf's pushing face and the fascia under the lip.
     The horizontal surfaces items sit on are all pale grey, so the red reads
     as a stripe across the machine rather than a slab of colour. The greys
     are cooled very slightly towards blue so they sit against the red rather
     than muddying into it. */
  /* Exposure for the filmic tone mapping. Raise to lift the whole image,
     lower if the greys start clipping to white under the key light. */
  render: { exposure: 1.15, envIntensity: 0.85 },

  /* The set around the cabinet. Not decoration for its own sake - a machine
     floating in a void has nothing to sit on and nothing to catch light from,
     which is most of why it reads as a model rather than an object. The
     coloured spill from the flanks onto the cabinet sides does more work here
     than the geometry does. */

  /* Three tubes of light tracing the machine: up one side wall, across the
     back, down the other. Innermost first.

     Colour is expected to change during play, so each tube keeps its own
     material and machine.setTubeColour(i, hex) swaps it live - no geometry is
     rebuilt, and the emissive follows the colour automatically. */
  lightTubes: {
    enabled: true,
    radius:  0.058,        // half the side of the square section
    gap:     0.075,        // between the cabinet and the first tube, and between tubes
    glow:    1.6,
    /* Default gradient, innermost outwards: white, light blue, deeper blue.
       Each step drops brightness as well as shifting hue, so the three read
       as one graded frame rather than three separate rings. */
    colours: [0xFFFFFF, 0x8FD3FF, 0x2E7BE8]
  },

  palette: {
    background: 0x0B0616,
    deck:       0xC9CDD4,   // shelf top - items rest on this
    deckFace:   0xD22B2B,   // its front face, the pushing edge
    fixedFloor: 0xDFE2E6,   // the platform below
    fascia:     0xC22525,   // front of the machine, under the lip
    wall:       0xAEB4BD,
    cabinet:    0x6E7681,
    panel:      0xF6F2F4,
    panelEdge:  0x9AA1AB,
    chrome:     0xDCE2E8,   // bezel, mullions and peg studs
    panelGlow:  0xFFFFFF,   // the lit face behind the glass
    peg:        0x3E454E,
    tray:       0x1A1030
  }
};
