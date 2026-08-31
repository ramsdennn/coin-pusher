# Coin Pusher Quiz — Rebuild Brief

Hand this to a fresh session **instead of** the original `coin-pusher-brief.md`.
The original is now wrong in one critical respect (it rules out 3D) and should
not be used as-is.

---

## What this is

A browser-based coin pusher / penny falls machine, run on a TV during a family
quiz night. The host asks questions; whoever answers correctly gets one drop.
Coins pile up, get pushed toward the edge, and score when they fall off. Some
items on the shelf represent physical prizes rather than points.

The host drives everything. Players don't need devices.

---

## The correction: this must be built in 3D

The original brief specified 2D physics with faked perspective art, explicitly
ruling out 3D to keep things simple. **That decision was wrong and has been
reversed.** A previous attempt built it in 2D (Phaser + Matter.js) and failed.

The reason is specific and worth understanding, because it will re-surface as a
temptation to "just add one more rule":

In 2D, coins cannot stack. Everything downstream of that breaks:

- The pile compacts into a rigid raft that no amount of pushing will shift.
- The front row bears the load of the whole pile and dams the lip, so nothing
  falls off.
- A mistimed drop cannot land *on top of* the pile — which is a mechanic the
  host explicitly wants.
- With no vertical axis there is no normal force, so gravity has to be set to
  zero and friction hand-applied per frame.

The 2D attempt ended up with hand-written rules for one-way shelf carry, Coulomb
floor friction, edge tipping, stop thresholds and pile priming — every one of
them a workaround for the missing third axis. They interact badly and the thing
was still wrong.

In 3D none of those rules exist. Real gravity, real friction, a kinematic
platform. Coins ride the shelf because friction carries them, climb over each
other because they are solid, and fall off the lip because they overbalance.

**More setup, far less fighting. Do not attempt a 2.5D fake-height compromise.**

Bonus: the angled, looking-down-into-the-machine *Tipping Point* look was going
to be faked with skewed art. In 3D you just position the camera.

---

## How the real machine works

Stated precisely, because the 2D attempt kept guessing and getting this wrong.

### The drop
The coin is **not** dropped straight down onto the shelf. It goes in at the
**back of the machine**, behind a vertical pane of glass, and falls through a
field of pegs/spokes, bouncing as it goes, before landing on the shelf.

Consequence: the drop zone is not an aiming device. It biases where the coin
lands; it does not choose it.

### The shelf
There is **one shelf mechanism**, driving both tiers together. Constant speed
and rhythm — no speed-ups, no pauses.

The shelf is a **rigid platform that slides forward and backward**. As it moves
backward it **retreats into the machine itself** — part of it physically
disappears from view into the back of the cabinet. It does not shrink, stretch,
or stay put. It travels.

Coins sitting on the shelf are carried by friction with its surface. Coins
further forward sit on fixed floor and only move when shoved.

> The 2D attempt got this wrong twice: first as a bat swatting coins, then as a
> rectangle that changed length while staying in place. Neither is a shelf that
> moves. Build it as a real rigid body that translates.

### Stacking and timing
Coins **can and must be able to land on top of each other**. A coin takes a
noticeable time to come down the chute while the shelf keeps moving, so the
drop has to be timed. Drop on the wrong beat and the coin lands on top of the
pile instead of where it would do useful work. This is a feature, not a defect.

### Tiers
Two tiers. Items falling off the top tier land on the bottom tier. Only items
falling off the **bottom** tier score. Four drop zones across the top, above the
top tier only.

---

## Tech

- **Three.js** for rendering.
- **Rapier** for physics — its solver handles stacked bodies far better than
  cannon-es or ammo.js, which matters enormously here.
- Vendor both locally. No build step, no CDN, works offline.
- Rapier ships as WASM, so the page **must** be served over http, not opened as
  a `file://` URL. A `serve.bat` already exists for this.

---

## What already exists and is worth keeping

In this folder. All of it is physics-agnostic and survives the rewrite:

| File | Status |
|---|---|
| `index.html` | **Keep.** Setup screen, team-name entry, and a cache-busting script loader (without which the browser serves stale config after edits — this bit already caused a real debugging detour, don't drop it). |
| `src/config.js` | **Keep the schema.** Item types with `image` / `color` / `value` where value is `{type:'points', amount}` or `{type:'prize', label}`, plus `startingLayout`. Radii become 3D dimensions; the `tuning` block is all 2D-specific and goes. |
| `src/game.js` | **Keep only the game layer**, and rewrite the rest. Worth lifting: team/score state, active-team selection, prize log, the drop-zone and keyboard input handling, the prize banner and floating score text, and the "tier is full" config warning. Everything touching Matter.js, shelf carry, floor friction, edge tipping, pile packing or tier transfer should be deleted outright, not ported. |
| `serve.bat`, `vendor/`, `assets/` | Keep. Swap Phaser for Three.js + Rapier in `vendor/`. |
| `README.md` | Largely reusable structure; the physics sections are wrong now. |

Roughly half the useful work — the whole session/scoring/config layer — carries
over. It is only the engine that failed.

---

## Settled decisions (don't relitigate)

- 2 teams, always. Names typed fresh at the start of each session.
- Host selects the active team, then clicks a drop zone. One drop per correct
  answer.
- Whatever falls off scores for the **currently selected team**, whenever it
  falls.
- Prize log shows all won items under each team.
- No persistence between sessions. Reload = fresh machine.
- No in-game image upload. Host edits a config file and drops PNGs in a folder.
- 4 drop zones, no bonus zones or trigger pockets.
- Constant shelf speed.
- Art polish is a later phase — get the mechanics right with plain shapes first.

---

## Open decisions — ask, do not guess

1. **How much of the tier depth is moving shelf versus fixed floor?** Is the
   shelf essentially the whole playfield with a narrow fixed ledge at the front,
   or a distinct block at the back with a large fixed floor ahead of it? The 2D
   attempt guessed at this repeatedly and got it wrong every time.

2. **How far does the shelf travel**, relative to a coin's diameter?

3. **Coin size relative to the machine** — how many coins across the width? This
   turned out to strongly affect how responsive the machine feels, because it
   determines how much one added coin advances the pile.

Note: the direction of the push (whether coins advance on the out-stroke or the
return) is *no longer a design decision*. In 3D, friction decides it. That was
only ever a question because the 2D version had to hand-write the rule.

---

## Success criterion

"Does it feel satisfying to watch and play" beats matching any number in this
document. Expect to tune. But tuning should mean adjusting friction, mass and
geometry — not inventing new rules to paper over the engine.
