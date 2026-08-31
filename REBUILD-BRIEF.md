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

## Camera and drop-zone interaction (from reference images)

Two reference screenshots confirm the intended look and resolve one open
question from the original brief.

### Camera
Elevated, angled down and into the machine — looking from in front of and
above the playfield, back toward the pile, roughly 30–40° off horizontal. Both
shelf tiers are visible from above, along with the lower portion of the four
vertical drop-zone panes at the back. This is a fixed camera; no orbit/pan/zoom
controls implied by the reference. Treat it as one static camera transform to
set up once, not a controllable rig.

### Drop zones
Four vertical panels at the back of the cabinet, side by side, separated by
thin visible dividers. Each panel shows a faint dot grid through it — the peg
field the coin bounces through on the way down — confirming drop zones are
glass-fronted chutes, not open slots. Host interaction is a click/tap on one of
these four panels; this should hit-test against the four chute volumes (or four
simple invisible click-planes positioned in front of them), not against the
pile or shelf geometry.

### Shelf retraction — resolved (CORRECTED 2026-08-31)
**The shelf retracts about halfway, not fully.** An earlier draft of this brief
claimed full retraction — that it disappears from view entirely — based on a
reading of the second reference image. The host has since corrected this
directly: roughly **half** the shelf withdraws into the cabinet on the backward
stroke; the remainder stays in the playfield at all times.

Do not restore the "full retraction" wording. It was wrong.

### Shelf depth — partially resolved
With the shelf at its back position, the fixed platform ahead of it reads as
roughly a third to half of the total playfield depth. Worth confirming against
the coin-diameter scale once geometry is built, but a reasonable starting
proportion rather than a guess.

### Deferred
Panel color/state (a white panel vs. red panels appears in the reference
images) is explicitly out of scope for this pass — mechanics first, art/state-
color logic later.

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
- Fixed camera — angled down and into the machine from the front (see
  Camera and drop-zone interaction, above).
- Art polish, including drop-zone panel coloring/state, is a later phase — get
  the mechanics right with plain shapes first.

---

## Open decisions — ask, do not guess

1. **How much of the tier depth is moving shelf versus fixed floor?** Reference
   images suggest the fixed floor is roughly a third to half of playfield
   depth, which is a reasonable starting point — but confirm against actual
   coin scale once geometry is built rather than treating it as exact.

---

## Resolved in session, 2026-08-31

Answers given by the host against the two reference screenshots. These replace
the corresponding open questions above.

- **Coin size / scale.** Roughly **10 coins across the playfield width**,
  measured off the frontal reference image. Model at 1 unit = 1 metre with a
  coin 0.24 across and 0.02 thick (i.e. 10x real size, which keeps Rapier's
  contact tolerances in their comfortable range); gravity -9.81. Playfield
  therefore ~2.4 units wide. Confirm against the built geometry — the starting
  layout of ~40 items per tier should read as roughly half a single layer.
- **Shelf is flush**, not a raised slab: its deck is coplanar with the fixed
  floor and coins slide across the seam. Chamfer the leading edge and overlap
  slightly vertically, or coins catch on the seam every stroke.
- **Shelf retraction is roughly half**, not full — see the corrected section
  above.
- **Fixed floor runs underneath the shelf** for the full tier depth, so a coin
  landing in the vacated back region rests on solid ground and waits to be
  shoved. The retraction does not open a hole.
- **Prize items may be discs or boxes.** The config schema needs a per-item
  shape, not just a radius — a box dams the pile very differently from a
  cylinder, and both are wanted.

Note: the direction of the push (whether coins advance on the out-stroke or the
return) is *no longer a design decision*. In 3D, friction decides it. That was
only ever a question because the 2D version had to hand-write the rule.

Note: shelf travel distance is resolved (see Camera and drop-zone interaction,
above) — roughly half retraction. An earlier draft said full retraction; that
was wrong and has been corrected.

---

## Success criterion

"Does it feel satisfying to watch and play" beats matching any number in this
document. Expect to tune. But tuning should mean adjusting friction, mass and
geometry — not inventing new rules to paper over the engine.
