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

    /* Centre-to-centre spacing of the starting pile, in coin diameters.

       Was 0.84 across and 0.82 back, which packed the coins SIXTEEN PERCENT
       INSIDE EACH OTHER before the simulation had run a single step. The
       usable width fits about 13 coins in a row; the layout was putting 16 in.
       They cannot separate afterwards because there is nowhere to go - the row
       is over-full - so the solver pushes at them forever and the pile buzzes.

       Measured on a settled pile, flat coins only, pairs whose bodies actually
       cross, per 100 coins:

           0.84   85.3 pairs   mean 26.8% of a coin's thickness   worst 98%

       Anything at or above 1.0 lays the pile out with no overlap at all, and
       the rows that no longer fit are stacked into a second layer, which is
       what the machine does anyway. */
    pileSpacing: 1.02,

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
    /* The DOUBLER.

       Physically a coin and nothing else: same diameter, same thickness, same
       density, same true-cylinder collider. That is not laziness. The pile's
       stillness came from those cylinder colliders specifically, and a token
       that shoved differently from a coin would put the whole pile back into
       the shimmering state it took a long time to get out of. It has to be a
       coin. It just has to be an OBVIOUS one.

       So the only differences are the ones you can see: gold, a little more
       metal in the finish than the plastic coins have, and a face.

       'face' is new. Nothing before this ever put a mark on an item, and the
       mechanics of doing it are in items.js - the short version is that a
       cylinder gives THREE three material slots, so the rim can stay plain
       metal while both flat faces carry the glyph. Both, because a disc in a
       pile is as likely to be face down as face up.

       Its 'value' is a coin's value, which is what makes 'one token and two
       coins' come to thirty before doubling. It is listed in pointsBox.types
       as well, so changing points-per-coin during the quiz moves it too - a
       doubler worth 10 in a round where coins are worth 50 would be a trap. */
    multiplier: {
      label: 'x2 Token',
      image: null,
      /* P4 indigo, chosen off a sheet of five purples rendered into the real
         pile rather than judged on a black card - which mattered, because the
         two darkest candidates looked fine in isolation and disappeared among
         sixty coins. Gold is deliberately NOT used here; it is being kept for
         a coin type still to come. */
      color: 0x4B2E8C,
      finish: { roughness: 0.28, metalness: 0.45 },
      shape: 'disc',
      size: { diameter: 1.0, thickness: 0.16 },
      density: 1.0,
      value: { type: 'points', amount: 10 },
      /* Drawn to a canvas at startup, not loaded from a file. At the size a
         coin occupies on screen this is a couple of hundred pixels across,
         and a generated glyph stays crisp at any camera distance while
         costing no asset and no load. */
      face: {
        text:       'x2',
        background: 0x6140A5,   // a shade brighter than the rim, so the face
        ink:        0xF2EAFF,   //   reads as a stamped disc, not a flat one
        sizeFraction: 0.52,     // of the face's diameter
        ringWidth:    0.045,    // an inset ring, the way a real token is milled
        ringColour:   0x33205F
      }
    },

    /* A PRESENT.

       Two coins wide, two high and two deep - a cube of 0.48 against the
       coin's 0.24. Measured against the machine before it was chosen: there
       are 2.32 coins of clearance between the top deck and the bottom of the
       chute, so it fits standing up with about a third of a coin to spare.

       That measurement settles something else too. A present can never come
       DOWN the chute: it is several times too big for the peg field. Placing
       them by hand is the only way one gets onto the shelf, which is why
       there is a button for it.

       Its value is a prize and nothing else - no points. It is a thing
       somebody takes home, and the score is for coins. The x2 therefore does
       not double it, because there is nothing there to double.

       density is the number to reach for if it misbehaves. It is a big object
       - sixty four times a coin's volume - so at a coin's density it would
       weigh sixty four coins and plough through the pile like a brick. At
       0.30 it weighs about nineteen, which is heavy enough to shove a pile
       and light enough for the pile to shove back.
       ------------------------------------------------------------------- */
    present: {
      label: 'Present',
      image: null,
      color: 0xE8467C,          // the fallback if wrap.palette is emptied
      finish: { roughness: 0.45, metalness: 0.02 },
      shape: 'box',
      size: { width: 1, height: 1, depth: 1 },   // in coin diameters
      /* About a coin's own weight, so coins shove it as readily as they
         shove each other. Swept on seeded piles: at 0.22 it kept up with a
         free coin 74% of the time, at 0.10 it was 78%, and at 0.05 it went
         unstable - lighter than a coin, it gets flicked rather than pushed,
         which is not what a box does. 0.10 is the useful end of that. */
      density: 0.10,
      value: { type: 'prize', label: 'Present' },

      /* Presents are exempt from sleeping, and it is worth writing down why
         a general-purpose flag exists for one item type.

         A sleeping body is skipped by the solver completely. Rapier wakes one
         when a NEW contact is made - and a coin already touching a present
         and simply leaning harder makes no new contact. So a sleeping present
         sat there inert while the pile pressed on it, which is exactly what
         "the coins just stack up against the back of it" looks like.
         Measured before the fix: a present on the floor was asleep for 69 to
         89 per cent of a three-stroke run.

         The risk this carries is real and was measured too - see the note in
         physics.sleep. Rapier sleeps by ISLAND, so a body that cannot sleep
         can hold every coin touching it awake, and the pile's stillness was
         hard won. */
      neverSleeps: true,

      /* WRAPPING. The presence of this block is what tells items.js to build
         a small GROUP - box, two ribbon bands crossing over the top and down
         the faces, a knot and two loops - instead of a single mesh. The
         physics is unaffected: the collider is still one cuboid.

         The pair is drawn per present, so two on the shelf are two colours.
         NOT random rgb, which is how you end up with a beige present under a
         slightly different beige ribbon. A curated list of bright pairs can
         only produce combinations that were looked at. */
      wrap: {
        palette: [
          { box: 0xE8467C, ribbon: 0x8E1130 },   // the reference: pink / deep red
          { box: 0xE23B3B, ribbon: 0xF5C542 },   // red / gold
          { box: 0x2E7BE8, ribbon: 0xF2F5FA },   // blue / white
          { box: 0x2FA84F, ribbon: 0xF5C542 },   // green / gold
          { box: 0x8B4DD8, ribbon: 0xA8E063 },   // purple / lime
          { box: 0xF07B24, ribbon: 0x17A9A0 },   // orange / teal
          { box: 0x17A9A0, ribbon: 0xE8467C },   // teal / pink
          { box: 0xF5C542, ribbon: 0x2E7BE8 }    // gold / blue
        ],
        ribbonFraction: 0.17,   // band width, of the box's own width
        proud:          0.012,  // how far the bands stand off the faces
        knotFraction:   0.34,   // the knot, of the box's width
        loopFraction:   0.62    // the two bow loops, of the box's width
      },

      /* Spawned upright and turned a little, so it reads from the game's
         camera the way the reference picture does - bow up, ribbon down the
         near corner. It tumbles freely from the moment anything touches it;
         this only decides how it arrives. */
      spawnYawDeg: 22
    },

    /* THE JACKPOT TOKEN.

       A coin in every way that matters to the simulation - same diameter,
       thickness and density - so it sits and shoves and falls exactly as a
       coin does. Gold, with a red five-pointed star across most of the face,
       which is the only thing that makes it different.

       Never spawned by the game. There is no entry in startingLayout and
       nothing in the chute produces one: the host places every single one.

       No points. The lights and the fanfare are the payoff - it announces
       that somebody has won, it does not add to a score, and the x2 has
       nothing to double. */
    jackpot: {
      label: 'Jackpot Token',
      image: null,
      color: 0xD9A521,
      finish: { roughness: 0.26, metalness: 0.55 },
      shape: 'disc',
      size: { diameter: 1.0, thickness: 0.16 },
      density: 1.0,
      value: { type: 'prize', label: 'JACKPOT' },
      face: {
        background: 0xF0BE38,
        ink:        0xC81E28,
        ringWidth:  0.045,
        ringColour: 0x8A6410,
        /* A star instead of a glyph. Same drawing routine either way - see
           drawFace in items.js. outer and inner are radii as a fraction of
           the face, so the star scales with the coin. */
        star: { points: 5, outer: 0.40, inner: 0.165, rotation: 0 }
      }
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
  /* --------------------------------------------------------------------
     AUDIO
     Everything is synthesised - see src/audio.js. There are no sound files,
     nothing to load, and nothing to license.

     The coins SOUND metal even though they LOOK plastic. That is a deliberate
     choice, not an oversight: a metallic ring is more satisfying and reads as
     more arcade, and nobody watching a quiz night is going to audit it.

     Sound cannot start until the page has had a real user gesture - every
     browser blocks it - so the audio engine is started by the START button.
     -------------------------------------------------------------------- */
  audio: {
    enabled: true,

    /* This is the one to reach for on the night. It is going through a TV. */
    masterVolume: 0.65,

    /* Per-voice trim, multiplied on top of masterVolume. 0 silences a voice
       entirely, which is the quickest way to find out whether one of them is
       the thing making the machine sound cluttered.

         peg      coin on a steel peg in the drop chute
         surface  coin landing on the deck or the floor
         coin     coin on coin
         glass    coin on the chute glass
         wall     coin on a side wall

       peg and surface are measured off real footage. The other three are
       derived from them by ear - see the note in src/audio.js. */
    levels: {
      /* Well above 1.0, deliberately. The pegs are the sound the whole drop is
         built around and everything else in the mix sits under them now. The
         limiter is what stops this simply making the machine louder.

         It took three goes to get here, and the first two were treating the
         symptom: the pegs were not quiet, they were being covered by a 3.41s
         sting playing over the whole fall. That sting is gone, so this is now
         doing what it says. */
      peg:     2.50,
      surface: 0.70,
      tense:   0.55,      // a bed, not a feature - it sits under the machine
      drop:    0.22,      // under the pegs on purpose - it used to bury them
      scoring: 0.90,      // the payoff, and the loudest thing after the pegs
      bonus:   0.95,      // the x2's own payoff, a shade above an ordinary one
      jackpot:    1.00,   // the biggest thing that happens all night
      jackpotWin: 1.00,
      coin:    0.60,
      glass:   0.45,
      wall:    0.40
    },

    /* THE THROTTLE. A settled pile generates a continuous storm of contacts,
       and a clink for each one is white noise, not a coin pusher. Three
       separate limits, because no one of them is enough on its own:

         maxVoices        hard ceiling on sounds playing at once
         coinCooldownMs   one coin cannot sound twice inside this. A coin
                          bouncing off a peg registers several contacts in a
                          single hop; without this, each hop machine-guns
         perFrameBudget   loudest N impacts in a step, rest dropped. Stops one
                          collapsing stack drowning everything else

       These are first guesses. Step 2 measures the real event rate and they
       get set from that rather than from taste. */
    /* Measured hitting the ceiling during real play - peak 16 of 16 - which
       starves whatever is queued behind it. Sounds are played loudest-first,
       so the ones dropped are the quietest, which is the right thing to drop;
       this just gives a busy moment more room. The limiter on the master bus
       is what stops more voices meaning a louder output. */
    maxVoices:      24,

    /* Measured: a coin falling the chute generates about 3 peg contacts above
       the engine threshold. That is sparse - there is no machine-gun to
       defend against at that rate - so the cooldown is set just long enough
       to collapse the two or three contacts of a single visible bounce into
       one sound, and no longer. At 55ms it was swallowing most of the hits
       and the drop went nearly silent. */
    coinCooldownMs: 28,
    perFrameBudget: 4,

    /* Files loaded at startup, one per voice name. A loaded sample REPLACES
       the synthesised voice of the same name - everything downstream is
       identical either way, so it changes the sound and nothing else.

       peg-hit.mp3 is a hand striking a plastic bucket, from Freesound, chosen
       by the host. Synthesis was tried twice for this and rejected both
       times; the second attempt reached a spectrogram correlation of 0.74
       against this very clip, which was a good number and a bad sound. */
    samples: {
      peg:     'assets/audio/peg-hit.mp3',
      surface: 'assets/audio/surface-hit.mp3',
      /* Held while a zone is armed and all the way through the fall, until the
         outcome is settled. Loops - a player can deliberate for as long as
         they like and the bed must not just stop. */
      tense:   'assets/audio/tense.mp3',

      /* The sting on release. It is CUT the moment the coin clears the chute
         rather than being left to run: the clip is 3.41s against a 1.94s
         fall, so letting it finish means it plays straight over the coin
         rattling down the pegs. The bed ducks out for it and comes back at
         that same moment. Remove this line and the release is silent, with
         the music simply running through it. */
      drop:    'assets/audio/drop.mp3',

      /* One per coin over the front lip. Every coin gets its own, so three
         going over is three sounds, not one louder one. */
      scoring: 'assets/audio/scoring.mp3',

      /* What the x2 token plays INSTEAD of 'scoring' when it goes over. Not
         as well as - it is that coin's scoring sound, so one coin still makes
         one sound, and it takes its turn in the same stagger so a token and
         two coins coming off together read as three separate events. */
      bonus:   'assets/audio/bonus.mp3',

      /* The jackpot pair, played back to back rather than together: the win
         sting starts the moment the jackpot clip ends. Scheduled on the audio
         clock off the first clip's measured duration, so the join is exact
         however busy the frame is - a timer would drift. */
      jackpot:    'assets/audio/jackpot.mp3',
      jackpotWin: 'assets/audio/jackpot-win.mp3'
    },

    /* Contact force below which the ENGINE does not even report a peg hit.
       The cheapest throttle there is, because it is applied inside the solver
       and never crosses into JavaScript. Raise it if faint grazes are
       chattering, lower it if soft touches go silent. */
    pegForceThreshold: 0.02,

    /* Contact force that counts as a full-strength hit: at or above this a
       peg sound plays at full volume and full brightness. */
    pegForceForFullHit: 2.5,

    /* Coins come off the lip in twos and threes on the same step, and three
       copies of a sound starting on the same sample are not three sounds -
       they are one, three times louder. Fanning them out a little turns that
       into the run of separate hits it should be.

       Scheduled on the audio clock rather than with a timer, so the spacing is
       exact however busy the frame is. */
    scoringStaggerSeconds: 0.11,

    /* --------------------------------------------------------------------
       SURFACE AND COIN-ON-COIN

       Everything except the pegs: the moving deck, the fixed floor, the side
       walls, the chute glass, and coins hitting each other.

       These run off collision-STARTED events and are scaled by the coin's
       speed going into the step, not by contact force. A resting pile carries
       a steady contact force, so force events would have every settled coin
       chirping sixty times a second forever; a collision event fires once,
       when two things begin touching, which is what a hit actually is.
       -------------------------------------------------------------------- */

    /* How much speed a step must take away from a coin before it counts as a
       hit. NOT how fast the coin is going - that was tried and it is wrong.

       A coin riding the moving deck travels faster than any sensible landing
       threshold, so scoring on absolute speed made every contact it started
       while being shoved along fire a sound: eight seconds of the pusher
       running with nothing dropped gave 38 of them, five a second of noise.
       Scoring on the CHANGE in velocity separates the two cleanly - being
       carried along changes nothing, being hit changes everything. */
    /* THE RUN-UP GATE. A hit must also have been APPROACHING at this speed
       to make a sound - see captureImpactSpeeds. It is what separates a coin
       that landed from a coin that was sitting still and got nudged.

       runUpDecay is how fast the remembered speed fades, per step. 0.93
       halves it in about ten steps, a sixth of a second, which is long enough
       to still hold the approach when the contact resolves.

       Set surfaceMinRunUp to 0 to turn the gate off entirely.

       0.45 comes from a survival table, not from taste. Seven minutes of the
       machine idling against a run with eight drops, counting the hits that
       actually SOUND rather than the contacts that are thrown away:

           gate    idle clangs left    drop sounds kept
           off           74                  100%
           0.35          37                   88%
           0.45           4                   60%
           0.55           0                   44%
           1.00           0                   39%

       0.45 removes 95 per cent of the idling noise - from about ten a minute
       to one every two minutes - and keeps two thirds of the drop. Chasing
       the last four costs another sixth of the drop, and past 0.55 the curve
       flattens: everything above it is a genuine landing. */
    /* Coin against coin only sounds while a team's turn is running. Between
       turns the pile can settle as noisily as it likes and nobody hears it,
       which is most of an evening. Coin against a SURFACE is not affected.
       false lets them sound all the time. */
    coinOnCoinNeedsTurn: true,

    runUpDecay:       0.93,
    surfaceMinRunUp:  0.45,

    surfaceMinImpact: 0.30,

    /* Change in speed at which a landing plays at full volume. */
    surfaceImpactForFullHit: 2.0,

    /* A contact start opens a WINDOW; the sound is scored on the loudest
       moment inside it, not on the starting step.

       This is what makes a coin toppling flat under the pusher audible. A
       contact starts the instant the rim first grazes, and at that instant
       almost nothing has happened: measured over 83 real impacts, the median
       velocity change on the starting step was 0.163 - under the threshold -
       while the actual slap peaked at 1.85 a median of ONE step later. Only
       30 of the 83 were already loud when their contact began. Scoring on the
       starting step silenced 29 of 39 topples.

       4 steps is 67ms. The peak lands within it for most hits; the tail
       reaches 7 steps, but 117ms of delay on an impact is audibly late and
       not worth chasing. */
    surfaceWindowSteps: 4,

    /* A hit this hard plays at once rather than waiting for the window - a
       sharp impact delayed by even 67ms reads as out of sync. */
    surfaceImmediateImpact: 1.5,

    /* Loudest N per step, rest dropped. Lower than the pegs' budget because a
       pile collapsing can start dozens of contacts on one frame and a coin
       pusher should sound busy, not like static. */
    surfacePerFrameBudget: 3,

    /* The chute's chrome - the four dividers between the entry slots and the
       two outer walls, which are the same part - plays the PEG sound rather
       than the surface one. It is polished metal, the same as a peg, and it
       was reading as a dull surface hit.

       Measured: every one of 24 dropped coins touches a divider on its way
       down, so this is not a rare event. Set false to put them back on the
       surface sound. */
    dividerUsesPegSound: true,

    /* Quietest a hit can be, as a fraction of full. Without a floor, the long
       tail of feather-light contacts is inaudible and the machine sounds like
       it only reacts to hard hits. */
    minGain: 0.10,

    /* A soft hit is not just a quiet hard one - it is duller and slightly
       lower. Brightness is the strongest of the three cues by a distance. */
    cutoffSoft:    1400,   // Hz, lowpass on the weakest hit
    cutoffHard:   17000,   // Hz, on the hardest
    pitchByEnergy:  0.10,  // +/- this much playback rate across the range
    pitchJitter:    0.06,  // random, so repeated hits are not identical

    /* Coins are spread right across the machine, so panning them costs
       nothing and adds a lot. 0 for mono. */
    stereoWidth: 0.55
  },

  logo: {
    enabled: true,
    src: 'assets/logo/tipping-point.svg',
    opacity: 1.0,
    /* Width as a fraction of the COLUMN, not the window - see rightColumn.
       1.0 makes the logo set the column's width and everything else follow. */
    widthFraction: 1.0
  },

  /* --------------------------------------------------------------------
     THE RIGHT-HAND COLUMN

     The logo and the two score panels are ONE STACK, not three things placed
     separately. They have to be, and the reason is worth writing down because
     the bug it caused only appeared at one shape of window.

     The logo is a 2:1 image sized as a fraction of the window's WIDTH, so its
     height grows with width. The panels used to be placed at a fraction of
     the window's HEIGHT. Those are different reference dimensions, so the gap
     between them was not fixed - it closed as the window got wider:

         logo bottom  =  0.05*H + 0.17*W
         panels top   =  0.282*H
         they touch when W/H > 1.37

     A laptop window is about 1.2 and full screen is about 2.05, so it looked
     right while being built and the panels sat on top of the logo the moment
     anyone went full screen. Anything sized off width, stacked above anything
     sized off height, can only be correct at one aspect ratio.

     They are now a flex column, so the panels are below the logo BY
     CONSTRUCTION at any shape of window, with nothing measuring anything and
     no resize handler.

     The width is bounded on BOTH axes - min() of a slice of the width and a
     slice of the height - so a short window narrows the whole stack rather
     than pushing it off the bottom.
     -------------------------------------------------------------------- */
  rightColumn: {
    widthFraction:     0.36,   // of the window's WIDTH
    maxHeightFraction: 0.94,   // of the window's HEIGHT - the bound that
                               // stops a short window overflowing
    centreAtScreenX:   0.805,
    topFraction:       0.040,  // of the window's HEIGHT
    gapFraction:       0.050   // logo to panels, as a fraction of column width
  },

  /* --------------------------------------------------------------------
     SCOREBOARDS

     Two panels under the logo, in the right-hand third the camera framing
     leaves clear. Placed to the boxes the host drew over a screenshot.

     Drawn as a DOM overlay, like the logo, and for the same reason: the
     numbers have to stay crisp and readable from across a room, and the 3D
     renderer's job is the machine.

     The CHROME is a static SVG and the TEXT is live HTML laid over it. That
     split matters - the score changes constantly so it cannot be baked into
     the file, and injecting the same SVG twice would collide on every gradient
     id inside it, leaving both panels quietly sharing one set of defs.

     Sizes are fractions of the WINDOW, so the layout holds at any size without
     a resize handler - the browser does the arithmetic in CSS.
     -------------------------------------------------------------------- */
  scoreboard: {
    enabled: true,
    /* The two teams' screen colours, so the game can light the machine to
       match a panel. These are the SAME values the panels are generated from -
       TEAM_A and TEAM_B in tools/build-scoreboard.py - and have to be changed
       in both places together, because a panel is a picture and the game
       cannot read a colour out of it. */
    teamColours: [0x2F7550, 0xCE6067],

    /* One per team: they are different colours now, so there is a file each
       rather than one shared background. Team A green, Team B red, matching
       how the teams are coloured in the quiz running alongside this.

       The red is deliberately clear of the machine's own red - see
       arming.dimmedGlow, which the drop zones go while a coin is armed. Two
       reds on one screen that are nearly the same read as a mistake. */
    srcs: ['assets/scoreboard/panel-blank-a.svg',
           'assets/scoreboard/panel-blank-b.svg'],

    /* The panel was 560x400 and read as too long next to the logo - more
       letterbox than score display. It is 480x400 now, and the width here is
       pulled in to match so the panels keep the height they had rather than
       growing to fill the gap. */
    /* Height came off three times: 15% (400 -> 340), 5% (340 -> 323) and 5%
       again (323 -> 307). The width comes from the row, so each of those only
       took height away.

       Note what that has done to the shape: 1.2:1 at the start, 1.56:1 now.
       Every one of those steps made the panel WIDER relative to its height, so
       if the complaint is that they look stretched, this is the wrong lever -
       rowWidthFraction below is the one that narrows them. */
    aspect:          '480/307',

    /* Both are fractions of the COLUMN now, not the window. The panels share
       whatever width the column has, so they cannot drift away from the logo
       above them however the window is shaped. */
    rowWidthFraction: 0.88,  // the pair, within the column
    gapFraction:      0.055, // between the two, of the row

    /* Text geometry, as fractions of the panel's HEIGHT. These are printed by
       tools/build-scoreboard.py rather than matched by eye, so the live text
       and the baked SVG cannot drift apart. Change the panel there and paste
       what it prints. */
    /* MINIMUM gap, as a fraction of panel height. The actual gaps are not set
       here - space-evenly divides whatever is left over into three equal
       parts, above the name, between the two, and below the score. This only
       reserves enough that they cannot collapse to nothing and leave the text
       touching the bezel, and it is what caps how large a wrapped name may be.

       It costs something, and worth knowing: reserving three gaps instead of
       one leaves less for a two-line name, so long names come out smaller than
       they did under the old centred layout. That is the price of the three
       gaps being genuinely equal. */
    evenGapFraction: 0.040,

    nameSize:     0.1889,

    /* The name's LINE HEIGHT, as a multiple of its font size.

       Not 1. The block around it uses line-height:1 deliberately - the default
       leaves descender space under every line that nothing is drawn in, which
       pushes the whole block high in the panel. But a line box of exactly one
       em does not CONTAIN the font: Arial's ascent and descent come to about
       1.12em together, so the tail of every g, j, p, q and y falls outside the
       box and the overflow:hidden guard slices it flat. Measured at 1920x1080
       before the fix: the name reported a scroll height of 36 against a client
       height of 35, which is the flat-bottomed g in the bug report.

       So the name gets its own, big enough to hold the descenders, while
       everything else keeps the tight one. fitName reads this back from the
       computed style, so the two-line fitting follows it without being told. */
    nameLineHeight: 1.18,

    /* Room for the name's SHADOW inside the clip, as a fraction of panel
       height. The line height above fixed the glyphs; the shadow is a second
       thing entirely - it is drawn below and around the letters, outside the
       line box, so overflow:hidden went on cutting it off in a straight line
       under the descenders.

       This is added as PADDING on the name's wrapper and taken straight back
       off as a negative margin, so the clip box grows while the space the
       element occupies does not - the panel's spacing is untouched.

       On the wrapper rather than on the name itself for a specific reason:
       fitName measures the name's scrollHeight, and scrollHeight includes
       padding. Put here, every measurement the fitting makes is unchanged.

       Big enough for the drop (shadowDy + blur) and the glow around it. */
    nameShadowPad: 0.060,

    /* A long name WRAPS to a second line, and a second line does not fit at
       the full size - measured, the block becomes 283.8 against 263 of screen
       and pushes the score out through the bezel. So the name is shrunk only
       when it wraps; a short name keeps the full size and looks exactly as it
       did.

       nameMinSize is the floor. Past it the name is clamped to two lines and
       whatever is left over is cut with an ellipsis, which is what stops an
       absurd name shrinking the whole panel into unreadability. */
    nameMinSize:  0.105,
    nameMaxLines: 2,
    scoreSize:    0.4886,
    screenInsetX: 0.0625,
    screenInsetY: 0.0977,

    /* Glow AND a cast shadow. The glow on its own left the text flat and
       printed on: a lit panel throws light around a letter, but a letter in
       front of one also casts a shadow onto it, and without the second half
       there is no depth. Down and slightly right, matching the light the
       chrome is lit by - a shadow disagreeing with the metal beside it is
       worse than no shadow. */
    shadowDy:   0.0228,
    shadowBlur: 0.0163,

    /* Same stack as the SVG, so the two versions cannot drift apart. */
    font: "'Arial Narrow','Haettenschweiler','Arial Bold',Arial,Helvetica,sans-serif"
  },

  /* --------------------------------------------------------------------
     POINTS PER COIN

     A box in the bottom right, in the same style as the scoreboards, where
     the host types what a coin is worth. Changing it takes effect on the very
     next coin - there is no apply step and nothing to restart, because on a
     quiz night the moment you want to change it is the moment you have just
     realised the scores are wrong.

     Neutral blue on purpose: it is a setting, not a team, and either team's
     colour would say it belonged to them.

     It writes to the coin TYPES rather than holding a number of its own, so
     there is still exactly one place a coin's worth lives. The tokens and
     prizes are untouched by it - they carry their own values, and a box
     labelled "points per coin" should not silently rewrite what a 100 token
     is worth.
     -------------------------------------------------------------------- */
  pointsBox: {
    enabled: true,
    src: 'assets/scoreboard/panel-blank-neutral.svg',
    label: 'POINTS PER COIN',

    /* Which types the box controls: the ordinary coins, not the tokens. */
    types: ['coinLight', 'coinDark', 'multiplier'],

    min: 0,
    max: 9999,

    /* Its own shape, not a scoreboard's. 40% off the height and 20% off the
       width makes it far flatter - 2.09:1 against the scoreboards' 1.56:1 - so
       it gets its own panel drawn at 480x230 with a thinner bezel. A bezel
       scaled for a 307-tall panel looks clumsy wrapped round a 230-tall one. */
    aspect:       '480/230',
    screenInsetX: 0.0417,
    screenInsetY: 0.0870,

    /* The text stays the SAME SIZE ON SCREEN through that shrink, so as
       fractions of a much shorter box these had to go up: 0.100 -> 0.167 and
       0.300 -> 0.500. It leaves the text nearly filling the screen with only a
       few pixels of gap, which is the cost of holding the text still while the
       box comes in around it. */
    labelSize: 0.167,   // of the box's height
    valueSize: 0.500,

    /* Tucked into the bottom-right CORNER rather than centred under the
       scoreboards, anchored to the right edge with a margin so it never sits
       hard against it. Bounded on both axes like the right-hand column, so a
       short window shrinks it rather than pushing it off screen - the trap the
       logo and the panels both fell into. */
    /* NOTE these bound the WIDTH: it is min(widthFraction of the viewport's
       width, maxHeightFraction of its height), and the height then follows
       from the aspect. Worth spelling out, because the box was being sized by
       the SECOND of them without that being obvious - at 1869x868 the height
       bound gave 174px and the width bound 196, so changing the width fraction
       alone would have done nothing at all. */
    widthFraction:     0.0744,
    maxHeightFraction: 0.16,
    rightFraction:     0.030,
    bottomFraction:    0.055
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
  /* -------------------------------------------------------------------------
     HOW THE STARTING PILE IS LAID OUT

     Every coin is placed AT REST somewhere the machine cannot disturb it. The
     bands it uses are derived from the geometry in items.js - see the note on
     buildStartingPile - and these are the knobs that shape them.

     The measurement that drove all of it: before this, the opening three
     strokes swept 6 to 9 coins over the edge with nobody playing, because the
     pile was built to within three quarters of a coin of the lip and dropped
     from a height so it was still tumbling when play began.
     ----------------------------------------------------------------------- */
  /* -------------------------------------------------------------------------
     HOW THE STARTING PILE IS LAID OUT

     Coins are dropped at random into the two areas that are always on show -
     the strip of shelf that never withdraws, and the platform the shelf never
     crosses. The regions come from the machine's own geometry; see the note
     on buildStartingPile in items.js. There is almost nothing to tune here on
     purpose, because every knob the previous versions had was a way of
     pulling the pile back from the edges, and that is what made them look
     arranged rather than played.
     ----------------------------------------------------------------------- */
  startingPile: {
    /* Extra clearance beyond the coin's own radius, in coin diameters, at the
       walls and at both ends of each region. 0 uses every bit of the space.
       Raise it a little if coins are starting out half over an edge. */
    edgeMarginInCoins: 0,

    /* How much of the pile goes on the shelf strip rather than the platform.
       Sharing by area gave the strip six coins and left the shelf looking
       bare - it is only a quarter of a coin deep, so area is a poor guide to
       how many belong there. It holds eleven or twelve side by side across
       the width; past that they stack rather than spread. */
    deckShare: 0.22,

    /* How many spots each coin tries before taking the one furthest from the
       coins already down. 1 is plain uniform random, which CLUMPS - that is
       what sampling does, and it is not a sign of too few coins. A dozen is
       plenty; more evens it out further and starts to look deliberate. */
    candidates: 12
  },

  startingLayout: [
    /* Plain coins only for now. The token and prize types are still defined
       above and still work - they are just not loaded onto the shelf. Add a
       line back here to bring one in. The count is 62 rather than 57 so the
       field holds the same number of items it did with the extras. */
    { type: 'coinLight', count: 30, tier: 1 },
    { type: 'coinDark',  count: 30, tier: 1 },
    /* The two doublers the game starts with. Where they land is not decided
       here: buildStartingPile shuffles this queue before it lays anything
       out, so two lines in a list is all "place them randomly" costs. Sixty
       two items either way - the coins gave up the two places.

       SKIPPED ENTIRELY when x2 is switched off in the settings menu, with
       two ordinary coins taking their places so the pile still holds 62.
       See buildStartingPile: a token that cannot double is indistinguishable
       from a working one until it fails to pay, so the answer is not to put
       it there. */
    { type: 'multiplier', count: 2, tier: 1 }
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
    /* Spin friction - see settleSpin() in game.js.

       Rapier contacts resist sliding but not spinning, so a disc lying flat
       spins freely and any stray torque from the solve stays in it forever.
       This is the fidgeting: measured with the machine off, the median coin
       turned 53 degrees in ten seconds and the worst turned 1188, while
       barely moving from the spot.

       stopRate is in radians per second, shed per second, Coulomb style - a
       fixed amount removed each step rather than a proportion, so a spin
       actually reaches zero. 8 stops a 1 rad/s spin in about an eighth of a
       second, which is roughly how a coin spun on a table behaves. */
    staticFriction: {
      /* OFF. This whole pass - Coulomb spin friction, rock damping, the
         velocity quietening before each step - existed to fight the prism
         collider's invented contacts. With a true cylinder it is not needed
         and it is very slightly harmful: on seeds where Rapier puts all 62
         coins to sleep by itself, switching this on dropped that to 26.

         Kept, with its numbers, because it is the right shape of fix if a
         future change ever brings the problem back. Nothing in it was wrong
         except that it was treating a symptom. */
      enabled:   false,

      /* Radians per second of spin shed each second, Coulomb style: a fixed
         amount removed per step rather than a proportion, so a spin actually
         reaches zero. Damping cannot do this - it scales with speed, so it
         approaches zero without arriving and never beats a torque that is
         re-applied every step.

         Measured on a settled pile, machine off, ten seconds, two runs each -
         coins that turned more than 5 degrees, and the distance the median
         coin walked while going nowhere:

             off    30.5 coins spinning    median path 0.046 of a coin
             25     25.0                                 0.087
             80      2.0                                 0.012
             200     0.0                                 0.036

         80 is the knee. Above it the correction starts disturbing the contact
         solve and the linear buzz creeps back. */
      spinRate:  80.0,

      /* The same trick for SLIDING, and it does not work - measured, it makes
         things worse: median path 0.007 with it off, 0.020 at 0.05 and 0.081
         at 0.10. Removing linear speed from a supported coin appears to let
         gravity and the contact re-accelerate it in a cycle. Left in at zero
         because the asymmetry is worth knowing: spin has nothing resisting it,
         sliding already has real friction doing the job. */
      /* Only damp the spin of coins lying this flat (1 = perfectly face down).
         A coin on its rim must stay free to roll, which is how it topples. */
      faceDownAbove: 0.85,

      slideRate: 0,

      /* Vertical-only anti-bounce, units/s shed per second. The same Coulomb
         trick aimed at what was left after spin was fixed: coins stacked on
         OTHER COINS, whose remaining motion is 80% up and down.

         A coin on the fixed floor cannot sustain a bounce - the floor has
         infinite mass and the contact solves at once. A coin on another coin
         is dynamic against dynamic and the pair can hold a limit cycle.
         Rapier exposes its soft contacts' natural frequency but not their
         damping ratio, so the springiness cannot be taken out through the
         engine.

         Vertical only, and that is the point: the pusher moves coins along z,
         so bleeding y costs the machine nothing. Measured over a five-seed
         panel, coins visibly moving with the machine off:

             0        7.8 visible    34.8 still
             0.02     3.6            43.0
             0.05     2.6            42.2
             0.8      3.4            36.8    and 15% less delivery

         Switching it on is what matters; the value barely does. 0.05 is the
         cheap end - delivery 2.9 coins a stroke against 2.6-3.1 with it off,
         no chute jams, fall time unchanged. */
      bounceRate: 0.05,

      /* Below these, a coin is stopped dead so the island can sleep. Set at
         Rapier's own resting thresholds - below them the engine already counts
         the motion as rest, so nothing real is lost, but the pile can finally
         cross the bar instead of hovering under it. */
      /* Rocking: a coin tilting back and forth on an uneven support, which
         is what the last few moving coins in a settled pile are doing - 88% of
         their motion vertical while turning 120 to 580 degrees in ten seconds.

         The spin friction above only damps rotation about the coin's own axis,
         so that tumbling stays free and coins still tip off the shelf. Rocking
         is about a HORIZONTAL axis and went completely undamped. Real friction
         stops it quickly.

         Applied only to a coin that is slow AND resting on something, so a
         coin in the air still tumbles. rad/s shed per second.

         Found by asking which coins were blocking the island from sleeping. On
         a pile that would not settle, only 7 coins of 51 were above the rest
         threshold at all - all near the front lip, all in the second layer,
         and all turning at 1.2 to 2.7 rad/s, thirty to sixty times the
         threshold. Flat coins turning about a HORIZONTAL axis: rocking, which
         the own-axis spin friction above deliberately does not touch.

         Measured on the three seeds that were failing, total pile motion:

             off   0.67 + 1.29 + 2.04 = 4.00,  17 coins moving
             30    0.74 + 0.70 + 1.14 = 2.57,  12 coins moving

         and delivery went up rather than down, 4.9 a stroke against 4.6. */
      rockRate:        30.0,
      rockSpeedFactor: 6.0,   // multiples of restLinear that still count as slow

      /* Zero the residual BEFORE the step rather than after. Rapier judges
         whether a body may sleep from the velocities it sees during its own
         step, so tidying up afterwards never reaches that decision. */
      quietenBeforeStep: true,

      restLinear:  0.02,   // units/s
      restAngular: 0.04,   // rad/s

      fallSpeed: 0.45    // above this downward speed, leave the coin alone
    },

    /* Contact skin: a soft margin, in coin diameters, making a contact engage
       just BEFORE the shapes touch. In principle it steadies a stack, since
       the contact is live by the time weight arrives instead of being found
       after the shapes have interpenetrated.

       OFF, because measured it is either useless or catastrophic. Five-seed
       panel, coins visibly moving with the machine off:

           0       2.8 visible    42.4 still
           0.005   3.2            39.6
           0.02   52.6             1.6      the whole pile churns
           0.05   53.8             0

       Left plumbed in at zero so the result is on record rather than being
       rediscovered. */
    contactSkinInCoins: 0,

    /* Coins are SOLID and may not occupy the same space. Enforced as a
       constraint after each step rather than left to the solver, which is
       soft-contact based and resolves penetration over time instead of
       forbidding it - under a pushed pile it never catches up.

       See separateCoins() in game.js for why the push is horizontal rather
       than along the shortest escape. */
    /* Let settled coins sleep. See sleepSettled() in game.js.

       Rapier sleeps by ISLAND, and every coin in the pile touches another, so
       one lively coin keeps all of them awake and nothing ever settles. Sleeping
       each coin on its own merits is what stops the buzzing for good: a
       sleeping body is skipped by the solver, so it cannot drift at all.

       Thresholds are generous on purpose. A sleeping coin is not stuck - the
       engine wakes it as soon as anything touches it, verified: with the shelf
       running, 51 of 62 slept coins woke within three quarters of a second. */
    sleep: {
      /* OFF. Sleeping IS the answer to a still pile - it is what every other
         game relies on - but Rapier's own island sleeping already does it far
         better than this did. Sleeping coins individually was a disaster:
         measured against Rapier alone, 7.3 coins perfectly still instead of
         54, motion eight times higher, and eighteen coins lost off the machine
         in a ten second idle because a coin tipping over the lip could be
         slept in mid-air and simply hang there. Adding a downward ray so a
         coin had to be resting on something did not save it.

         What DOES matter, and is the real lesson here: anything that nudges a
         coin every step stops Rapier sleeping it, and Rapier's sleeping is
         what stills the pile. That is why the separation pass above now has a
         large slop. Left here, off, with the numbers. */
      enabled: false,
      linear:  0.05,   // units/s
      angular: 0.20,   // rad/s
      steps:   20,     // consecutive quiet steps before it may sleep

      /* How far below itself a coin must find something solid, in half
         thicknesses, before it is allowed to sleep. Without this check a coin
         tipping over the lip could be slept in mid-air and simply hang there:
         measured, five coins stopped dead below the floor, the pile lost
         sixteen coins and buzzed nine times worse than with sleeping off. */
      supportReach: 1.6
    },

    separate: {
      /* OFF. A hard positional constraint that shoved interpenetrating coins
         apart every step, because the prism collider let them merge and never
         pushed them out again. The cylinder resolves a 65%-deep overlap on
         its own in well under a second, so this now has nothing to do, and
         anything that nudges a coin every step is something that stops the
         pile ever falling asleep.

         Left in place with its tuning intact - it took a lot of measuring to
         stop it slinging coins off stacks and shaking them - in case a future
         collider change needs it again. */
      enabled:           false,
      iterations:        4,      // relaxation passes, for chains of coins
      /* Gentle on purpose. A correction spread over several steps disturbs
         a resting pile far less than one that closes the whole gap at once,
         and it lets a coin landing on another settle instead of being shoved.
         Measured over two seeds:

             0.60 / 0.050   worst bite 2.9%   3 stacks   worst sink 16.7%
             0.20 / 0.012   worst bite 3.9%   5 stacks   worst sink  4.5%

         and in the shake test the gentle pair held 7 stacked coins against 3,
         at the same up-and-down travel. */
      strength:          0.2,    // fraction of the gap closed per pass
      maxPerStepInCoins: 0.012,  // never teleport a coin

      /* Only correct pairs whose centres are closer VERTICALLY than this
         fraction of a coin's thickness - that is, at roughly the same height.

         Height is the discriminator, not distance in plan. A coin overlapping
         another by 90% has its centre very close in plan, so gating on plan
         distance exempted exactly the worst cases. Stacked coins sit a full
         thickness apart and are left alone: their contact is face to face, the
         solver handles it, and correcting it is what made stacks shake.

         The value trades the bite against stacking, because a coin landing
         partway onto another passes through this band on its way to settling:

             0.55   worst bite 2.1%   0 stacks formed   sink 0%
             0.35   worst bite 5.0%   9 stacks          sink 30%
             0.22   worst bite 7.0%   4 stacks          sink 17%

         0.35 keeps the bite negligible - 5% of a diameter is about two pixels
         on a TV - while leaving coins room to settle on top of each other. */
      sameHeightBelow:   0.35,

      /* Overlap below this fraction of a coin's DIAMETER is left alone.

         Large on purpose. This pass nudges coins, and a nudged coin never
         falls asleep - and Rapier's own sleeping is what actually stills the
         pile. Measured with the pass off, 30.8 coins slept and 54 of 62 were
         perfectly still; with it firing on every marginal overlap, only 10.5
         slept and 44.7 were still. Correcting overlaps too small to see bought
         nothing and cost the sleep that matters.

         So it fires only on overlaps big enough to look wrong, fixes those,
         and gets out of the way. Swept, machine off, three seeds:

             slop   worst bite   coins still   coins moving   asleep
             0.04       4.6%        46.3           7.7         14.3
             0.08       6.2%        47.7           5.7         19.7
             0.12      11.7%        51.7           4.7         15.0
             0.20      14.0%        52.7           5.0         19.1
             off      85.4%        51.3           5.0         19.7

         0.08 keeps the bite at about three pixels on a TV while leaving the
         pile as still as it is with no separation at all. */
      slopInDiameters:   0.08,
      flatAbove:         0.90    // only coins lying this flat
    },

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

    /* 0 = a true cylinder. Anything 3 or more builds the disc as a convex
       hull prism with that many sides instead.

       THIS IS THE SETTING THAT STOPS THE COINS MOVING ON THEIR OWN, and the
       comment that used to sit here said the exact opposite, so it is worth
       being precise about what was measured.

       The prism is broken. Not marginal - broken. Put two coins alone in the
       world, nothing else, one starting 65% sunk into the other, and let it
       run for ten seconds:

           16-gon + chamfer   never separates, passes THROUGH, spins at
                              3.9 rad/s forever, neither body ever sleeps
           16-gon, no chamfer  same
           32-gon + chamfer    same, spins harder
           true cylinder       resolves to a clean stack, both asleep,
                               zero spin - from either starting depth

       Two coins. Nothing else in the world. Perpetual motion. Rapier's
       hull-vs-hull contact generation cannot resolve a deep overlap between
       two coaxial prisms, so it invents a normal, the pair never separates,
       and because every coin in a pile is in one contact island, one such
       pair keeps all sixty-odd awake and jittering. That was the shimmer.

       With a true cylinder Rapier has an analytic contact for the case and
       the whole thing evaporates. Eight seeded piles, 496 coins, settled and
       then watched for five seconds:

           16-gon + chamfer, with the stabilisation passes below
                              3 of 62 asleep, worst coin turned 172 deg
           true cylinder, no stabilisation passes at all
                              8/8 piles fully asleep, 496/496 coins,
                              worst coin turned 0.1 deg

       Play a real session and switch the machine off and the pile does not
       move by one part in a hundred thousand of a coin. */
    discColliderSides: 0,

    /* Rim rounding for the true cylinder, as a fraction of a coin's HALF
       thickness. A real coin's edge is a rounded band, not a sharp corner,
       and a rounded rim is a knife edge to balance on - which is the whole
       reason a dropped coin falls flat instead of standing up. 0 for a sharp
       cylinder. Ignored when discColliderSides is 3 or more.

       A sharp cylinder brings back the on-edge landings the prism's chamfer
       existed to cure - measured over 75 tracked drops, 10.8% of coins ended
       up standing on their rim. Rounding the rim fixes it without touching
       the stillness above:

           sharp        10.8% on edge
           round 0.5     8.0%
           round 0.9     2.7%

       0.9 is very nearly a half-torus rim, which is what a real coin has. */
    discRimRound: 0.9,

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

    /* Damping used to stand in for the spin friction the prism collider never
       generated - a coin spinning on its own axis otherwise never slowed down.
       It was 0.20 / 3.50, which is enormous, and it was propping up a broken
       collider rather than modelling anything.

       The cylinder does not need it. Measured across five seeds for stillness
       and a hundred tracked drops for landing:

           0.20 / 3.50   5/5 piles asleep   10% land on edge
           0.02 / 0.30   5/5 piles asleep    3% land on edge
           0.05 / 0.50   5/5 piles asleep    7% land on edge

       Stillness is untouched at every setting - it was never damping that was
       holding the pile together - and the heavy damping was making coins
       sluggish about tipping flat when they fall off the shelf. Delivery is
       unchanged at 3.7 coins a stroke. */
    linearDamping:  0.02,
    angularDamping: 0.30,

    /* Coin on coin, and half of coin-on-floor (Rapier averages the two).

       Raised from 0.32 because the coins that drift on their own are the ones
       at the FRONT LIP - measured, the drifters sit 0.6 to 0.8 of a coin from
       the edge while the settled ones sit further back. A coin half over the
       edge is only marginally supported, and Rapier models no STATIC friction
       at all, so any residual force slides it. More friction resists that.

       Measured at rest over 15 seconds, three runs each:

           0.32   median drift 0.0193 of a coin   13.7 coins drifting
           0.80   median drift 0.0073             8.7
           1.50   median drift 0.0951             29     (much worse)

       0.8 won all three pairs. 1.5 is past the point where the pile locks up
       and starts fighting itself. Delivery is unchanged at 3.2 coins a stroke
       against 3.0, the chute is untouched, and overlap is the same. */
    itemFriction:    0.80,
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
    /* Was 0.0012, hiding solver noise that no longer exists: a sleeping body
       does not move at all, so at rest this now does nothing. Kept small and
       non-zero purely so a coin creeping under the pusher is not redrawn for
       sub-micron changes. */
    renderDeadzone:      0.0002,   // world units, coin is 0.24 across
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
     ARMING A DROP

     Choosing a zone and dropping into it are two separate acts. First click
     ARMS a zone: it stays lit, the other three go dark red, and the music
     starts. Second click on the SAME zone releases the coin.

     The point is the pause in between. A drop that happens the instant you
     touch the screen has no moment to it; arming one and then choosing when
     to let it go is where the tension lives, which is the whole reason the
     real show does it this way.
     -------------------------------------------------------------------- */
  arming: {
    enabled: true,

    /* The lit zone keeps the panel's own colour, so this is only the OTHER
       three. Dark, because these panels are emissive and a bright red at this
       size reads as an alarm rather than as a zone being closed off. */
    /* Kept dark so the white key light has little to wash out - this is the
       DIFFUSE, and the scene lights multiply it. */
    dimmedColour: 0x1E0305,

    /* The colour the zone actually reads as. Emissive is not lit by anything,
       so it keeps its saturation where the diffuse cannot. */
    dimmedGlow:   0x8E1216,

    /* 0.5 is the panel's own default, so a lit zone looks exactly as it always
       has. The dimmed one glows less AND redder - see setZoneColour for why
       both are needed. */
    litEmissive:    0.5,
    dimmedEmissive: 0.42,

    /* Clicking a DIFFERENT zone while one is armed moves the selection there
       rather than dropping. Dropping into a zone the player did not just
       point at would be the one unforgivable outcome here. */
    reArmOnOtherZone: true,

    /* The music gets out of the way for the drop sound and comes back under
       the fall. How long it is gone for is read off the drop clip itself, so
       swapping the file re-times this with nothing to adjust; these are only
       the fades either side of it.

       Not a duck to a lower level but a full stop: the drop sting is short and
       deliberate, and leaving a bed running under it just muddies both. */
    duckFadeOut:  0.05,
    duckFadeIn:   0.12,

    /* The sting is CUT when the coin clears the chute rather than being left
       to run out. Measured, the clip is 3.41s against a 1.94s fall, so letting
       it finish meant it played over every peg strike on the way down - which
       is why the pegs could not be heard at any volume. Short fade, because
       chopping a sound off mid-waveform clicks. */
    stingFadeOut: 0.09,

    /* THE LIGHTS NO LONGER WAIT FOR THE MUSIC.

       They used to go out together. Now the red starts clearing a beat after
       the coin lands and eases back rather than snapping, so the machine
       returns to normal while the result is still playing out.

       Both are measured from the LANDING, not from the arming, so the timing
       is the same however long a player deliberates before letting go. */
    fadeBackDelaySeconds: 1.0,
    fadeBackSeconds:      2.0,

    /* How long an ordinary light change takes - arming a zone, picking a team,
       going back to neutral. Nothing switches instantly; a light that snaps
       reads as a value being replaced rather than a light changing.

       Short, because these follow a click and a click should feel answered.
       The long one above is only for the machine easing back after a drop,
       which is a different kind of moment and wants the room. */
    lightFadeSeconds:     0.35,

    /* WHEN THE MUSIC STOPS.

       The first coin over the front lip of the platform ends it - the scoring
       drop, not a coin merely tumbling off the shelf onto the platform, which
       is still in play and does not count.

       BUT NOT A DELIVERY THE PUSHER HAD ALREADY SET UP. The pusher runs
       continuously, so when a coin lands the shelf is usually mid-stroke with
       the pile already at the lip. Measured on a real drop: the coin landed at
       1.72s and three coins went over at 4.20s - genuine scoring drops, and
       not one of them the coin that had just been dropped. It had not been
       touched yet. The music was ending two and a half seconds after the
       landing on a result the player had no part in.

       So deliveries are ignored until a full pusher stroke has passed since
       the landing - long enough that the stroke already in progress has
       finished and the shelf has come back for the coin that was just added.
       After that, the first coin over the lip ends it.

       This is measured in STROKES rather than seconds because that is what it
       actually depends on: change the shelf period and this follows it. */
    deliveryIgnoreStrokes: 1.0,

    /* --- how it ends ---

       Worth knowing what that means in practice, because it is quicker than it
       sounds. Measured across four drops, the coin lands at about 1.8s and the
       first coin goes over at 3.2 to 3.8s - so the music runs for roughly two
       seconds after the landing. Those early ones are usually NOT caused by
       the dropped coin at all: the pusher runs continuously and is already
       mid-stroke when the coin arrives, so it is the machine's own delivery
       that ends the music.

       Coins carry on going over until 10 to 18 seconds, in clusters one
       pusher stroke apart. Ending on the first one is a deliberate choice for
       pace, not an oversight - a previous version waited for a whole stroke to
       pass with nothing falling, which is a truer reading of "the outcome is
       known" but left the bed running for 11 to 18 seconds. If it ever wants
       to go back, that is the change. */

    /* Coming to rest is NOT usable as a signal, which is worth recording so
       nobody reaches for it later. With the pusher running the pile never
       settles: 13 to 14 coins are moving at any moment - the ones riding the
       deck - pulsing to 40 or 50 on every stroke whether or not anything
       falls. There were motion spikes at 18s and 25s in a run where nothing
       went over at all. Falls are the only reliable signal here.

       The case where nothing scores at all. Counted from the LANDING rather
       than from the arming, so a player who takes a long time deciding does
       not eat into it. */
    resolveTimeoutSeconds: 12
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

    /* Narrowest gap a peg row may leave, in coin diameters - to a side wall
       or between neighbours. Anything at or below 1.0 is a gap a coin cannot
       fall through, and a gap a coin cannot fall through is a shelf it sits
       on permanently.

       The edge-peg row is built with twelve pegs, gaps of 0.334 to each wall
       and 0.667 between neighbours, and coins DO arch across them and stay.

       DEFAULTED OFF ANYWAY, at 0, because enforcing it costs more than it
       saves. Set to 1.12 it drops that row from twelve pegs to six and trims
       two others, and measured over 160 fast drops the jam rate went the
       wrong way:

           every peg kept, no unjam pass      1.3%
           rule at 1.12, no unjam pass       10.0%

       Fewer pegs means fewer deflections, so coins free-fall further, arrive
       at the lower rows faster, and impale themselves on pegs far more often
       than they ever arched on the narrow gaps. The trap the rule removes is
       real and rarer than the problem it creates.

       Left here, working and configurable, because the observation stands: a
       gap narrower than a coin is a shelf, not a gap. If the peg field is
       ever redesigned, redistribute the row to keep the count and widen the
       gaps - eleven pegs fit across this machine at 1.05 - rather than
       deleting pegs as this does. */
    minPegGapInCoins:       0,

    /* --------------------------------------------------------------------
       UNJAMMING

       A coin can end up IMPALED on a peg, and when it does it is stuck there
       permanently. Worth spelling out, because it is not the failure anyone
       expects and none of the obvious fixes touch it:

       The pegs are cylinders lying along z, spanning the full chute depth.
       The coin falls face-on down a slot only 1.35 coin-thicknesses deep. A
       coin near terminal velocity covers about five peg-diameters in a single
       60Hz step, so despite CCD it can end a step with the peg's axis INSIDE
       its disc. Once there, the shortest way out is sideways along z - and
       the chute glass and the back panel are exactly there. The solver sees a
       perfectly legitimate resting contact, generates no push-out at all, and
       the body falls asleep impaled.

       Measured on one such coin: zeroing the coin's friction, the walls'
       friction, the pegs' restitution, forcing it awake every step, and
       raising the CCD substeps ALL left it at exactly the same height. It is
       not friction and it is not sleep - it is geometry, and nothing in the
       physics will ever undo it.

       So it is undone here instead: spot a chute coin that has stopped with a
       peg inside its disc, and slide it out HORIZONTALLY, which is the one
       direction that is not blocked. */
    unjam: {
      enabled: true,

      /* Speed below which a coin in the chute counts as not falling. Well
         under the speed of a coin merely grazing a peg on its way down. */
      stuckSpeed: 0.05,

      /* Consecutive steps at that speed before acting. A coin can legitimately
         pause for a moment balanced on a peg before toppling off, and jumping
         in too early would rob the drop of exactly the hesitation that makes
         it worth watching. 45 steps is three quarters of a second. */
      stuckSteps: 45,

      /* Extra clearance when ejecting, in coin diameters, so the coin comes
         out genuinely free rather than resting exactly on the surface. */
      slopInCoins: 0.03,

      /* Coins can also ARCH - two or three bridging a gap, each holding the
         others up, with no peg inside any of them. Give those longer before
         intervening, since they are rarer and a shove is cruder than sliding
         a coin off a peg. */
      archExtraSteps: 75,

      /* How far an arch-breaking move displaces the coin, in coin diameters,
         before escalation. Small: almost every arch gives at the first touch,
         and a big jump is more visible than the jam it fixes. */
      archStepInCoins: 0.10,

      /* How much further each successive attempt moves it, capped here. A coin
         still stuck after several small moves needs a bigger one. */
      nudgeMaxScale:  4.0
    },
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

  /* -------------------------------------------------------------------------
     THE DOUBLER

     A x2 token that goes over the edge doubles EVERYTHING the team captured
     in that turn - including the coins that already went over before it did.
     Order does not matter, which is the whole point: you cannot lose the
     doubling by getting the token out first, and you cannot game it by
     holding the token back.

     The arithmetic that makes order not matter is in award() in game.js. In
     short: the token scores as an item first, then the turn's running
     subtotal is added a SECOND time, and everything after it scores at the
     new multiplier. One token gives x2, two give x4, and the sums come out
     the same whichever order they land in.

     A turn is one team's box being lit. The multiplier resets when the light
     moves, so no doubling ever reaches back past the start of a turn, and a
     token that goes over while it is nobody's turn is simply spent.
     ----------------------------------------------------------------------- */
  multiplier: {
    enabled: true,
    typeId: 'multiplier',

    /* What one token multiplies the turn by. Two tokens compound, so two of
       these at 2 is x4, three is x8. */
    factor: 2,

    /* How often one comes down the chute instead of a coin. 0.1 is one in
       ten, which is what was asked for.

       This is the ONLY way another one enters play: the two that start on the
       shelf are gone once they fall. There is no ceiling on how many can be
       on the shelf at once - a run of luck can leave three or four sitting
       there, which is a good problem for the room to have. */
    dropChance: 0.1,

    /* THE INDICATOR.

       A picture of the token itself, tilted, in the corner of the scoring
       team's panel while their turn is doubled. Drawn from the SAME canvas
       that paints the token's 3D face - not a second drawing of it - so it
       cannot drift out of step with the coin in the machine, and changing the
       colour above moves both.

       It is a light, not a counter. It says "this turn is doubled" and shows
       x2 whether the turn is running at x2 or x4; the score itself still does
       the full arithmetic. false removes it, and the scoring is unaffected
       either way. */
    showIndicator: true,
    indicatorAngle: 55,      // degrees clockwise; negative tilts the other way
    indicatorSize:  0.235,   // of the panel's height

    /* -----------------------------------------------------------------------
       THE FLASH

       A x2 going over the edge takes the three tubes purple and back, three
       times, then leaves them wherever they should be at that moment - the
       team's colour, neutral, or the armed red if a drop is still resolving.
       The resting colour is RE-DERIVED when the flash ends rather than
       remembered from before it, so a flash that lands in the middle of a
       drop cannot strand the lights on a stale colour.

       colour is NOT the token's own indigo, and that is deliberate. The tubes
       are emissive - they are lit, not painted - so setting them to a dark
       colour reads as the tube going OUT rather than flashing. This is the
       same purple family, lifted to something a light can actually be.

       Snappier than the machine's other light moves on purpose: the smooth
       fade that suits a team change reads as a throb rather than a flash at
       this length. onSeconds is the rise, offSeconds the fall back.
       ----------------------------------------------------------------------- */
    flash: {
      enabled:    true,
      colour:     0x9B5CFF,
      count:      3,
      onSeconds:  0.12,
      offSeconds: 0.18
    }
  },

  /* -------------------------------------------------------------------------
     THE INTRO

     Played full screen the moment START is pressed, with the game BUILDING
     BEHIND IT. That ordering is the whole point: starting the world takes a
     moment - Rapier initialising, the pile laid out and pre-settled - and
     doing it after the video would mean the intro finishing onto a black
     screen while that happened. Run together, the load disappears.

     Any key or click stops it and goes straight to the game.
     ----------------------------------------------------------------------- */
  intro: {
    enabled: true,
    src: 'assets/video/intro.mp4',

    /* Scaled by the volume slider like everything else - a muted machine
       should not blast an intro. */
    volume: 1.0,

    /* How long before a key or click will skip it.

       Not zero, and not for taste: the START click is still being delivered
       when the video begins, so listeners armed immediately catch that very
       click and the intro is cancelled by the thing that started it. */
    skipArmMs: 350
  },

  /* -------------------------------------------------------------------------
     THE TITLE MUSIC

     Loops behind the team-name screen and stops when the game begins.

     Played through a plain <audio> element rather than the game's own audio
     graph, and the reason is timing: that graph is built on an AudioContext
     which cannot exist until the browser has seen a user gesture, and the
     gesture in question is the START click - by which point the title screen
     is over. An <audio> element has the same restriction but degrades
     usefully rather than throwing, so it can be tried immediately and started
     on the first click or keypress if the browser refuses.

     In practice the host types two team names before pressing START, so the
     music will be running well before then. On a page nobody touches at all
     it stays silent, which is the correct behaviour and not a bug.
     ----------------------------------------------------------------------- */
  titleMusic: {
    enabled: true,
    src: 'assets/audio/title.mp3',

    /* Scaled by whatever the volume slider was last set to, so this cannot
       come blaring out at a level the host already turned down. */
    volume: 0.55,

    /* Cut rather than stopped dead when START is pressed - a loop that
       vanishes mid-bar sounds like a fault. */
    fadeOutSeconds: 0.6
  },

  /* -------------------------------------------------------------------------
     TEAM COLOURS THE CONTESTANTS PICK

     A swatch either side of the two name fields on the title screen. Clicking
     one opens the browser's own colour picker; what comes back becomes that
     team's colour, and the defaults below are what you get if nobody touches
     them.

     The colour has to reach three places, and only the first is trivial:

       the light tubes    a config value, read by paintZones
       the score panel    a pre-rendered SVG
       the name field     another pre-rendered SVG

     The artwork is generated by tools/build-scoreboard.py with the colour
     baked in. Rather than port that whole generator into the browser, the
     colour is changed where it actually lives: SEVEN gradient stops - four in
     the screen gradient, three in the sheen - all derived from one base by
     the two formulas below. Everything else in the file, the chrome and the
     bevel and the corner radii, is left exactly as the build script made it,
     so the panels cannot drift away from the ones it generates.
     ----------------------------------------------------------------------- */
  teamColour: {
    enabled: true,

    /* Copied from scoreboard.teamColours - G2 and R4, the pair chosen off a
       swatch sheet rendered in the real scene. */
    defaults: [0x2F7550, 0xCE6067],

    /* The artwork to recolour, per team. */
    panelSrcs: ['assets/scoreboard/panel-blank-a.svg',
                'assets/scoreboard/panel-blank-b.svg'],
    fieldSrcs: ['assets/scoreboard/title-name-a.svg',
                'assets/scoreboard/title-name-b.svg'],

    /* The gradient ramp the generator uses, copied stop for stop rather than
       re-invented - see RAMP in tools/build-scoreboard.py. */
    ramp:  [1.00, 0.80, 0.64, 0.88],
    sheen: [0.72, 0.42, 0.22],

    /* THE LIGHTNESS CLAMP. The name and the score are white; a pale colour
       makes them vanish and a near-black one swallows the panel. The picked
       colour keeps its hue and saturation and has only its lightness pulled
       into this band, so what comes out can be a little deeper than what was
       clicked.

       The band is set by the DEFAULTS, not by taste: G2 sits at 0.32 and R4
       at 0.59, and neither may be altered by a clamp meant for other people's
       choices. */
    minLightness: 0.15,
    maxLightness: 0.62,

    /* The swatch buttons, as fractions of the name field's own height. */
    swatchWidth: 0.21,

    /* How close the swatch sits to its field. The row's own gap is 22px,
       which is right between the two name fields and too far for a button
       that belongs to one of them, so the swatch is pulled back in by a
       negative margin on its inner edge. This is the gap that survives. */
    swatchGapPx: 6,

    /* A rainbow down the button, so it reads as "pick a colour" rather than
       as a coloured strip. It no longer shows the team's current colour -
       the name field beside it is already tinted that, so nothing is lost. */
    swatchGradient: ['#FF3B30', '#FFD60A', '#34C759',
                     '#32ADE6', '#3B4CFF', '#FF2D95'],

    storageKey: 'coinPusher.teamColours'
  },

  /* -------------------------------------------------------------------------
     THE SETTINGS MENU

     A cog under the volume mixer, in the same corner and on both screens.
     Clicking it opens a panel built from the SAME generator as the
     scoreboards and the points box - real chrome, dark screen, the same
     condensed bold - so it reads as another part of the machine rather than
     as a dialog that wandered in.

     The machine keeps running while it is open. A host adjusting the speed
     wants to see what the speed does, and SPACE still pauses if they want it
     stopped.
     ----------------------------------------------------------------------- */
  settings: {
    enabled: true,
    src: 'assets/scoreboard/panel-settings.svg',
    aspect: '480/660',

    /* From the generator, so the controls sit inside the lit screen rather
       than over the bezel. */
    screenInsetX: 0.0542,
    screenInsetY: 0.0394,

    /* Bounded on both axes, for the reason given in rightColumn: one bound
       alone is only correct at one shape of window. */
    widthFraction:     0.30,   // of the viewport's width
    maxHeightFraction: 0.42,   // of its height, via the aspect

    /* Type sizes, as fractions of the panel's height. */
    titleSize: 0.046,
    labelSize: 0.030,
    valueSize: 0.030,

    /* THE SPEED STEPS, as multiples of normal. Stepped rather than smooth on
       purpose: normal has to be a detent you can always get back to, not a
       spot you have to hunt for with a mouse. */
    speedSteps: [0.25, 0.333, 0.5, 0.667, 1, 1.5, 2, 3, 4],

    /* Remembered between reloads, like the volume. The reset buttons
       obviously are not. */
    storageKey: 'coinPusher.settings'
  },

  /* -------------------------------------------------------------------------
     PLACING A COIN BY HAND

     PLACE COIN in the settings menu shuts the menu and puts the next click on
     the machine down as a coin. One click, one coin, then it is over.

     The same machinery the present and jackpot buttons use, pointed at an
     ordinary coin - so it lands ON a heap rather than inside one, a click
     that misses the machine costs nothing, and the coin that results is in
     every way a normal coin. It scores if it goes over the edge, to whoever's
     turn it is. It does not use up a drop or touch the turn.

     There is no cap. Presents have one because four of them is a cluttered
     board; coins are what the board is made of.

     WHICH COIN: the next one in the light/dark rotation that dropped coins
     use, sharing their counter, so placing by hand does not fill the pile
     with one colour. Never a x2 token - that roll belongs to the chute.
     ----------------------------------------------------------------------- */
  placeCoin: {
    enabled: true,

    /* Dropped from a hair above whatever was clicked rather than set exactly
       on it, so it settles instead of being wedged into the surface. The same
       0.35 of a coin the presents and the jackpot token use. */
    dropHeightInCoins: 0.35
  },

  /* -------------------------------------------------------------------------
     THE MOUSE POINTER

     The arrow is replaced by a white hand, because the whole screen is a thing
     you point at and press, and an arrow says "operating system" where a hand
     says "go on then".

     The artwork is assets/cursor/hand.svg, built by tools/build-cursor.py from
     the icon in hand-source.svg beside it. Read that script before changing
     anything here - the hand is white and outlined and tilted because of what
     it does, not by accident.

     Two things about cursors that are not obvious and that shape all of this:

       THE SHADOW HAS TO BE INSIDE THE IMAGE. A cursor is a picture the
       operating system draws, not an element on the page, so CSS filters and
       box-shadows do not touch it. The shadow is drawn into the SVG, and the
       image carries transparent padding for it to fall into or it would be
       clipped square at the edge.

       THE SIZE HAS TO BE INSIDE THE IMAGE TOO. CSS cannot scale a cursor; the
       browser draws it at the image's own width and height. So the file is
       fetched, its size rewritten to whatever size says below, and the result
       handed over as a data URL. That is why this is done in code rather than
       as one line of CSS in index.html.
     ----------------------------------------------------------------------- */
  cursor: {
    enabled: true,
    src: 'assets/cursor/hand.svg',

    /* In pixels, and the image is square. Chrome refuses anything over 128
       and quietly falls back to the ordinary arrow, so that is the ceiling.

       64 rather than something nearer the 20-odd pixels of a normal arrow
       because this is played across a room on a television. The hand does not
       fill the square - it is tilted, and the corners are the shadow's room -
       so a 64px cursor is a hand about 48px tall. */
    size: 64,

    /* WHERE THE CLICK ACTUALLY LANDS, as a fraction of the image, measured on
       the tip of the pointing finger. Printed by tools/build-cursor.py; copy
       them across if that script is ever re-run.

       Worth getting right rather than eyeballing: presents and jackpots are
       placed by clicking, so an error here would put them somewhere other
       than where the hand is pointing, and it would look like the placement
       was broken rather than the pointer. */
    hotspotX: 0.0851,
    hotspotY: 0.1986,

    /* The shadow, in the SVG's own units - the hand is about 40 of them
       across, so these are meant to be small. Raising blur and opacity
       together is what makes it read as a shadow rather than as a smudge.

       Set enabled to false for no shadow at all. */
    shadow: {
      enabled: true,
      dx: 1.0,        // right
      dy: 1.3,        // and down, so the light reads as coming from above
      blur: 0.9,
      opacity: 0.45
    }
  },

  /* -------------------------------------------------------------------------
     THE VOLUME CONTROL

     Bottom left, vertical: the slider above, the speaker below. Deliberately
     the opposite corner from the placement buttons and the points box, and
     deliberately quiet - it is the one control that gets used when something
     has gone wrong in the room rather than as part of the game.

     It drives the MASTER volume, so coins, pegs, the fanfares and the music
     all move together. Clicking the speaker crosses it out and silences
     everything; clicking again brings it back at whatever the slider says -
     the slider does not drop to zero while muted, so unmuting returns you to
     exactly the level you had.

     The level is remembered between reloads and the MUTE is not. A quiz that
     resets the volume every time the page reloads would be maddening, and a
     machine that boots silently reads as broken rather than as muted.
     ----------------------------------------------------------------------- */
  volume: {
    enabled: true,

    /* Sized to fit in the strip of empty screen to the LEFT of the machine,
       rather than matched to the buttons on the other side. That strip is
       narrow, and these numbers come from measuring it rather than guessing:
       raycasting across the control's own band of the screen put the
       machine's leftmost pixel at

           1200x800   38px   3.17% of the width
           1600x900   54px   3.38%
           1920x1080  64px   3.33%

       - the same fraction of the WIDTH at every shape, because that is what
       the camera framing is tied to. So everything here is a fraction of the
       width too, and the whole control lands clear of the cabinet at any
       window: left margin plus icon comes to about 2.4% against the 3.2% of
       clear strip, leaving a small gap to the machine.

       Bounded on height as well for the reason given in rightColumn - a bound
       on one axis alone is only correct at one aspect ratio. */
    iconFraction:      0.017,   // of the viewport's width
    iconMaxHeight:     0.034,   // of its height

    trackHeightFraction: 0.155, // the slider's length, of viewport height
    trackWidthFraction:  0.0042,// and its thickness, of viewport width
    gapFraction:         0.010, // between the slider and the speaker

    leftFraction:   0.007,      // hard against the edge, clear of the machine
    bottomFraction: 0.055,      // matches pointsBox, so the corners line up

    /* Muted enough to sit in the corner unnoticed, bright enough to find.

       THE SLIDER IS A LIGHT ON THE MACHINE. Rather than a colour of its own,
       the filled bar and the handle show whatever the innermost light tube is
       showing at that instant, driven from the same place on the same clock -
       so it cannot fall out of step with the machine, and it needed no rules
       of its own for "flash with the lights" or "go red while armed". Those
       fall out of it.

       It works because that tube's own resting colour is already white: with
       nothing happening the slider is white, during a team's turn it carries
       their colour, while a zone is armed it goes red with the cabinet, and
       through a flash it flashes.

       The empty part of the track stays neutral whatever the machine is
       doing, so the level is still readable at a glance. The speaker takes
       the colour as well, but only its body and its sound waves - the mute
       cross stays red, because a red cross on a red speaker would disappear
       exactly when you needed to see it. */
    trackColour:  'rgba(255,255,255,0.16)',
    tintAlpha:    0.62,         // the filled bar
    handleAlpha:  0.88,         // the handle, a little more solid
    iconAlpha:    0.82,         // the speaker, which takes the colour too
    mutedColour:  '#E2484F',    // the cross

    storageKey: 'coinPusher.volume',

    /* The cog sits under the speaker in the same column, which is what pushes
       the mixer up to make room for it. */
    cogFraction:   0.019,       // of the viewport's width
    cogMaxHeight:  0.038        // of its height
  },

  /* -------------------------------------------------------------------------
     THE JACKPOT

     The biggest thing that happens all evening, and the machine is supposed to
     look like it. Ten flashes with everything moving on ONE beat:

       the backlight   all four panes together, white / yellow / white ...
       the tubes       a checkerboard - the outer two yellow with the middle
                       white, then the outer two white with the middle yellow

     so on every beat the whole machine flips, and the tubes are always the
     opposite of each other. Then it all goes back to whatever it should be -
     team colour, neutral, or the armed red if a drop is still resolving.

     Placed by hand and never spawned, like a present, but with no limit on
     how many can be on the board.
     ----------------------------------------------------------------------- */
  jackpot: {
    enabled: true,
    typeId: 'jackpot',

    maxOnBoard: 0,        // 0 = no limit
    dropHeightInCoins: 0.35,

    /* This flash is GAPLESS - each state replaces the last with no beat of
       resting colour between - so a "flash" here is one state, not an on-off
       pair. onSeconds is how long each state is held, and it is the number
       that decides the CHARACTER of the effect: 0.22 reads as flashing, much
       slower reads as a pulse.

       matchSound decides how MANY. With it on, the count is worked out at the
       moment the token drops from the two clips' measured durations, so the
       lights run for exactly as long as the fanfare and follow it
       automatically if either clip is ever swapped - which has already
       happened once. 'flashes' is then only the fallback for when the audio
       has not loaded.

       Set matchSound false to go back to a fixed count. */
    matchSound: true,
    flashes:    10,
    onSeconds:  0.22,
    offSeconds: 0.22,

    /* The two colours the machine alternates between. white is the panels'
       own lit colour so the "off" beat is the machine's normal look rather
       than a second effect. */
    yellow: 0xFFD21E,
    white:  0xFFFFFF,

    /* Back to back, not together: 'win' starts the moment 'sound' ends. */
    sound:    'jackpot',
    thenPlay: 'jackpotWin',

    button: { gapFraction: 0.010 }   // between it and the present button
  },

  /* -------------------------------------------------------------------------
     PRESENTS

     A present is a prize rather than a score: when one goes over the edge
     somebody in the room has won something they collect in person, and the
     machine's job is to make that unmistakable.

     It cannot arrive down the chute - see itemTypes.present for the
     measurement - so they are PLACED. The button arms placement, the next
     click on the machine puts one just above that spot, and it drops the last
     fraction of an inch into place. Clicking the button again cancels.
     ----------------------------------------------------------------------- */
  presents: {
    enabled: true,
    typeId: 'present',

    /* None at the start - every present is placed by hand. The seeding code
       is left in place and driven by this number, so it is one edit away if
       that changes back. */
    startingCount: 0,
    maxOnBoard:    10,    // the button goes dead at this many, until one falls

    /* How far above whatever was clicked the present appears. Small on
       purpose: a present dropped from a height bounces and takes the pile
       with it, and the host clicked a spot because that is where they wanted
       it. In coin diameters. */
    dropHeightInCoins: 0.35,

    /* Six flashes, alternating the present's OWN two colours - box, ribbon,
       box, ribbon, box, ribbon - so what the tubes do matches the thing that
       just dropped rather than being a generic prize colour.

       Emissive again, so the two are lifted the way the x2's purple is: a
       dark ribbon set on a light tube reads as the tube going out. lift is
       how far towards white each colour is pulled before it reaches them. */
    flashPairs: 3,
    flashLift:  0.42,
    onSeconds:  0.13,
    offSeconds: 0.13,

    /* One play, not two. */
    sound: 'bonus',

    /* The button. Sits beside the points-per-coin box in the bottom right
       corner and is deliberately much smaller than it - it is used a handful
       of times an evening, and the points box is read all night. */
    button: {
      /* Measured rather than guessed: at 0.043 it came out 69px against the
         points box's 57 tall, so the button that gets used a handful of times
         an evening was BIGGER than the number that is read all night. These
         put it at about 40px - clearly the smaller of the two. */
      sizeFraction:   0.025,   // of the viewport's width, bounded by height
      maxHeightFraction: 0.050,
      gapFraction:    0.012,   // between it and the points box
      armedGlow:      '#F5C542'
    }
  },

  /* -------------------------------------------------------------------------
     THE BACKDROP - a dot wall

     A grid of soft round lights on a near-black ground, with broad glows
     drifting behind it and paler columns sweeping across. It replaced a
     photograph, and the reasons are in backdrop.js: generated per pixel it is
     as sharp at 4K as at 720p, it loads nothing where the photograph was
     1.4MB, and the grid is measured in SCREEN PIXELS so the dots stay the
     same size and land on the pixel grid instead of crawling when the window
     changes shape.

     The same background runs behind the title screen and behind the game, off
     one clock, so pressing START does not restart it.

     If it ever pulls the eye, the knobs in order are exposure (how bright),
     dots.contrast (how much of the wall is lit at once) and dots.driftSpeed.
     enabled:false puts the flat palette.background colour back.
     ----------------------------------------------------------------------- */
  backdrop: {
    enabled: true,

    /* Display grade, applied last. The machine has to stay the brightest
       thing on screen - it is the only thing anyone is meant to watch. */
    exposure: 0.88,
    vignette: 0.55,   // corners fall away, so the scoreboards sit on quiet

    dots: {
      /* Spacing and size. pitchPx is in real screen pixels: at 26 a 1080-tall
         television gets about 41 rows, which is close to the reference and
         still reads as individual lights from across a room rather than as a
         texture. radius and softness are fractions of one cell. */
      pitchPx:  26,
      radius:   0.30,
      softness: 0.55,

      /* The lighting behind the grid. driftSpeed scales the whole motion, so
         one number slows everything together; glowScale is how large the
         drifting blobs are, and the column pair is the slow sweep across. */
      driftSpeed:  1.0,
      glowScale:   0.42,
      columnScale: 0.60,
      columnSpeed: 0.008,

      /* Shaping. Most of the wall should sit low with the bright regions the
         exception - lift floor to darken the quiet areas, raise contrast to
         make the lit ones stand out further.

         These came from comparing three renders side by side. The first pass
         lit the whole wall fairly evenly and read as polka dots rather than
         as a lit set; a much darker version after it lost the background
         almost entirely. This sits between them: large quiet regions with the
         brightness concentrated, which is what the reference does. */
      floor:    0.36,
      contrast: 2.45,
      gamma:    1.30,

      /* Blue, and staying blue. The light tubes go green, red and purple to
         MEAN something; a background doing the same at ten times the size
         would drown them out. mid is deliberately the machine's own blue. */
      ground: 0x03060F,
      dim:    0x123A78,
      mid:    0x2E7BE8,
      hot:    0x7FD8FF,

      /* How much of the glow bleeds between the dots. Without a little of
         this the wall reads as dots painted on a board rather than as lights
         behind glass. */
      groundGlow: 0.11
    },

    noiseSize: 256       // the tileable noise built at startup; 256 is plenty
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
