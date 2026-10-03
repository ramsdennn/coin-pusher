game based on tipping point. obligatory AI slop:

# Coin Pusher Quiz

A browser-based coin pusher for a family quiz night, run on a TV. The host asks
questions; whoever answers correctly gets one drop. Coins pile up, get shoved
toward the edge, and score when they fall off. Some items on the shelf are
physical prizes rather than points.

The host drives everything. Players don't need devices.

---

## Running it

Double-click **`serve.bat`**, then open the page it launches.

It has to be served over http, not opened as a file. The physics engine ships
as WebAssembly and browsers refuse to load that from a `file://` URL. That is
the only reason the batch file exists.

Everything is offline — Three.js and Rapier are bundled in `vendor/`. No
internet needed once the folder is on the machine.

Press **F11** for full screen. Reloading the page resets everything.

## Controls

| | |
|---|---|
| Drop a coin | **Click one of the four panels** at the back, or keys **1**–**4** |
| Pause / restart the shelf | **SPACE** |
| Single step (for a close look) | **S** |
| Reset the machine | **R** |

Clicking anywhere else — the pile, the shelf, the cabinet — does nothing. Only
the four chutes are clickable.

---

## How the machine works

**The coin does not drop onto the shelf.** It goes in at the back, behind
glass, and falls through a field of pegs, bouncing as it goes. So a drop zone
is not an aiming device. It *biases* where the coin lands; it does not choose
it. Measured spread is about two-thirds of a coin either side of the chute it
went into.

**Timing matters.** The fall takes about 0.7 seconds, which is roughly a
quarter of a shelf stroke. The shelf keeps moving the whole time, so *when* the
host clicks changes where the coin ends up as much as *which* panel they click.
Drop on the wrong beat and it lands on top of the pile instead of where it
would do useful work. That is a feature.

**The shelf is a block that slides forward and back**, at a constant rhythm
that never varies. About half of it withdraws into the cabinet on the back
stroke. It has a vertical front face, and that face is the entire mechanism: it
pushes on the way out and simply separates from the coins on the way back.

Coins riding on top of the shelf tumble off its front edge down onto the fixed
platform, and cannot climb back on. From there they get shoved along until they
fall off the front, which scores.

**It is stingy at first.** Roughly the first twenty drops of a session go into
building the pile up before anything starts falling off. After that it settles
into paying out about four items for every five dropped, and slowly gets
fuller as the night goes on.

---

## Setting it up before a quiz

Everything you need is in **`src/config.js`**. It is the only file you should
have to touch.

### Items

Every object on the shelf is an "item":

```js
coin: {
  label: 'Coin',
  image: null,              // a PNG in assets/, or null for a plain shape
  color: 0xE8C24A,          // fallback colour, also the prize-log dot
  shape: 'disc',            // 'disc' or 'box'
  size: { diameter: 1.0, thickness: 0.085 },
  density: 1.0,             // 1.0 is a coin; higher is harder to shove
  value: { type: 'points', amount: 10 }
}
```

**All sizes are in coin diameters**, so `1.0` is exactly one coin across. That
means the config stays valid if you change the scale of the machine.

A `box` takes `{ width, height, depth }` instead. Boxes behave very differently
from discs — they won't roll or slide sideways, and they dam up everything
behind them. Good for making a big prize feel hard-won; bad if you fill the
shelf with them.

For a prize, use `value: { type: 'prize', label: 'Chocolate bar' }`.

### What starts on the shelf

```js
startingLayout: [
  { type: 'coin',      count: 44, tier: 1 },
  { type: 'chocolate', count: 1,  tier: 1 },
]
```

The machine loads from the front lip backwards, so it starts primed — close to
tipping, but not spilling on its own.

### Pictures

Drop PNGs into `assets/` and name them in the item's `image` field. Square with
a transparent background works best.

---

## Tuning

The knobs worth playing with, all in `config.js`:

| | |
|---|---|
| `scale.coinsAcrossWidth` | How many coins fit across the machine. This is the number that decides how the whole thing *feels*, because it sets how much one added coin advances the pile. |
| `scale.coinsDeepPerTier` | How deep the playfield is. |
| `scale.fixedFloorFraction` | How much of that depth is fixed platform rather than moving shelf. Raising it makes the machine stingier — coins have further to travel. |
| `scale.deckStepInCoins` | How far the shelf's top sits above the platform. **Do not set this to 0** (see below). |
| `shelf.periodMs` | One full back-and-forth stroke. |
| `physics.itemFriction` | Coin on coin. Too high and the pile locks into a raft that won't shift. |
| `physics.shelfFriction` | How firmly the shelf carries what sits on it. |

If prizes are coming off too easily, put them further back in `startingLayout`
or raise their `density`.

Tune by adjusting friction, mass and geometry. If you find yourself wanting to
add a *rule* about how coins behave, something is wrong — that is what sank an
earlier attempt at this.

---

## Why it is built this way

A previous version was 2D, and failed. In 2D coins cannot stack, so the pile
compacted into a rigid raft, the front row dammed the lip, and nothing ever
fell off. Every fix was a hand-written rule patching over the missing third
axis, and they fought each other.

This version is 3D with real gravity and real friction. Coins stack because
they are solid, and fall off because they overbalance.

Two things were then found by measurement rather than reasoning, and both are
worth knowing before changing anything:

**The shelf needs its step.** A shelf flush with the platform can only transmit
force through friction, and friction is symmetric — it drags the pile back
exactly as hard as it pushes it forward. Sixty coins dropped over sixty strokes
produced *nothing* off the lip. The vertical front face is what makes the
motion one-way. `deckStepInCoins: 0` reproduces the failure if you want to see
it.

**The peg field has to be sparse.** A coin is one diameter across in every
direction, so any gap it falls through must be wider than a whole coin. In a
chute two and a half coins wide, that allows exactly one peg per row — a pair
cannot work, because widening it to clear the dividers shuts the centre gap and
narrowing it does the reverse. The dense dot grid in the reference photograph
cannot be a peg field; as pegs it would simply be a wall.

---

## Not built yet

- **Scoring.** Team names are collected at the start and items are counted off
  the lip, but scores, the prize log and the on-screen team panels are not
  wired up. Falling items are counted, not yet awarded.
- **Art.** Everything is plain shapes. The shelf is red and the platform white
  so the shelf's travel is easy to read while tuning; the real machine has both
  surfaces red with thin white lips.
- **Drop-panel colour and state.**

`REBUILD-BRIEF.md` in this folder is the current design brief, including
corrections made as the build went along. It is the thing to read first.
