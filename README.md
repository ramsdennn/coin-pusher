# Coin Pusher Quiz

A browser-based coin pusher for quiz night. Host-driven: you ask the question,
the winning team gets one drop.

## Running it on the night

Double-click **`serve.bat`**. It starts a small local server and opens the game
in your browser. Press **F11** for full screen.

If `serve.bat` doesn't work (no Python on that machine), open a terminal in this
folder and run any static server, e.g.:

```bash
npx --yes serve -l 8000 .
```

Then go to `http://localhost:8000`.

> Don't just double-click `index.html`. Browsers block a page opened from
> `file://` from loading images out of the `assets/` folder, so your prize
> pictures won't show up.

Everything is offline — Phaser is bundled in `vendor/`. No internet needed.

## Playing

| Action | How |
|---|---|
| Pick the team that answered | Click their panel, or press **T** to toggle |
| Drop a coin | Click a drop zone, or press **1**-**4** |
| Pause the shelf | **SPACE** |
| New session (resets everything) | Reload the page |

Whatever falls off the front edge scores for the **currently selected team**, so
leave the right team selected between questions.

### How the machine works

**The drop zone is not an aiming device.** The coin goes in at the back and
rattles down through the pegs, drifting sideways on the way. Picking a zone
biases where it lands; it does not choose it.

**The shelf slides in and out of a slot at the back.** As it withdraws, part of
it disappears into the machine. Coins sitting on it are carried forward as it
comes out, and are simply left behind when it goes back in - they do not ride
back with it. That one-way action is the whole engine of the machine: every
stroke is a net gain forward, so the pile creeps towards the edge.

**Timing matters.** A coin takes two or three seconds to come down the chute and
the shelf keeps moving the whole time. Land it while the gap at the back is open
and it sits where the shelf can get behind it and do some work. Land it late and
it comes down further forward, past the shelf, where nothing can push it until
the pile catches up.

Items that fall off the top shelf land on the bottom shelf. Only items that
fall off the *bottom* shelf score.

The machine starts loaded right up to the edge, but it will not spill on its
own - nothing moves unless a coin lands on the shelf. Expect roughly the first
half dozen drops of a session to build pressure before anything comes out, then
a fairly steady one item per drop after that.

## Setting up prizes

Everything on the shelf is an "item", and every item is defined in one place:
**`src/config.js`**.

```js
chocolate: {
  label: 'Chocolate bar',
  image: 'chocolate.png',              // file in assets/, or null for a plain disc
  color: 0x8B4A2B,                     // fallback colour
  radius: 17,                          // physics size. 16 = normal coin
  value: { type: 'prize', label: 'Chocolate bar' }
}
```

`value` is either:

- `{ type: 'points', amount: 50 }` — adds to that team's score
- `{ type: 'prize', label: 'Chocolate bar' }` — shows a big banner so you know
  to hand over the real thing

To add a prize: drop a PNG in `assets/`, add a block like the one above, then
add it to `startingLayout` with how many you want and which shelf (`tier: 1` is
the top, `tier: 2` is the bottom).

Square PNGs with transparent backgrounds look best.

## Tuning the feel

Also in `src/config.js`, under `tuning`:

| Setting | What it does |
|---|---|
| `pusherPeriodMs` | Length of one full in-and-out stroke. Higher = slower, and a longer window to time a drop into. |
| `pusherAmplitude` | How far the shelf slides each stroke. |
| `shelfLength` | Length of the shelf when fully withdrawn. It extends by `pusherAmplitude` on top of this. |
| `shelfGrip` | How firmly the shelf drags its coins forward. Low = they slip and the shelf slides under them. High = it shoves hard. |
| `tipOverhang` | How far past the lip a coin must be before it tips off. The starting pile is loaded to just behind this line. Lower = the machine starts more primed and pays sooner. |
| `edgeTip` | The shove given to a coin that is overhanging. |
| `chuteGravity` | How fast a coin falls through the pegs. Lower = slower fall, more scatter, more time to time the drop. |
| `pegSpacing` | Gap between pegs. **Must stay comfortably wider than a coin** or they jam. |
| `pegRows` | Rows of pegs. They must sit further apart vertically than a coin is wide. |
| `itemFriction` | Coin-on-coin grip. Keep low - high values lock the pile into a rigid raft. |
| `rowGap` | Slack between rows of the starting pile. |

### If it feels wrong

**Nothing ever falls off, or it takes forever** — the pile is jamming. Lower
`itemFriction`, raise `shelfGrip`, or lower `tipOverhang` so coins tip off the
edge sooner. Adding more coins to `startingLayout` also helps, up to the point
where the tier is full (it warns in the browser console if you overfill it).

**Coins pour out constantly** — too many coins. Reduce the counts, or raise
`rowGap` to put more slack back in the pile.

**Coins fall with nobody having dropped one** — the pile is loaded past the
tipping line. Raise `tipOverhang` a little.

The counts in `startingLayout` are the main difficulty dial. Roughly one item
falls per drop once the shelf is loaded; the first few drops of a session build
the pile up before anything comes out, which is the tension you want.

### Why the shelf is built the way it is

Worth knowing before you change numbers. There is no world gravity — nothing
moves unless the shelf moves it. That means:

- The pile has to physically reach from the shelf to the front edge, or shoves
  don't travel and the machine sits dead.
- A pile packed with *zero* gaps is incompressible, and the whole thing marches
  off the edge at once. The `rowGap` slack is what stops that.
- Coins get Coulomb friction (a flat speed loss per step) rather than Matter's
  `frictionAir` drag, so a shove travels a bounded distance and items actually
  come to rest.
- Coins on the shelf are dragged by it with a capped grip, not welded to it. The
  cap is what lets the shelf slide out from under a pile that won't move.
- The carry is one-way. Coins ride the shelf out and are left behind when it
  goes back in. Make it symmetrical and the machine just rocks on the spot.
- Coins that overhang the lip are actively tipped off. Without that the front
  row carries the load of the whole pile and the tier locks solid.
- Coins in the chute are on their own collision layer, so they rattle off the
  pegs without touching the pile - the same job the glass does on a real
  cabinet.

If you change the geometry and it stops behaving, those are what to check.
