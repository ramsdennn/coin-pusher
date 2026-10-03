# Coin Pusher — notes for Claude

Tipping Point-themed 3D coin pusher (Three.js + Rapier) for Sean's family quiz night, run full-screen on a TV. Read README.md first for how it plays. It is finished and in use — work is additions and fixes, not rebuilds.

- Run with `serve.bat` (port 8000) or the `coin-pusher` launch entry. It must be served over http — Rapier is WASM and browsers refuse `file://`. Don't replace the server; Sean rejected a custom one.
- `src/config.js` is the single host-editable file. Every feature gets a documented block there, and every value carries the measurement it came from. `index.html` is the one file the `Date.now()` cache-buster cannot protect — keep features out of it.
- Edits are done with Python scripts using `s.replace` + `assert`; a failed assert leaves the file untouched, so anchor on exact text.
- `window.CP` (exists once the game has started) has test hooks: `nextDropType`, `awardItem`, `selectTeam`, `setScore`, `resetPile`, `resetPileSeeded(seed)`, `turnMultiplier`. Use them rather than driving the physics.
- Speed and ×2 on/off persist in `localStorage['coinPusher.settings']`. Turning ×2 OFF deletes tokens on the board; ON doesn't restore them — RESET BOARD does. This looked like a bug once.
- Browser-pane testing: the first click after `navigate` is often swallowed (retry); the console buffer keeps old errors across reloads; screenshots never show the OS cursor.

How Sean works: he asks for a **playback before you start**, then says "go". "Diagnose before fixing" means diagnose only — he decides. Measure and state the numbers; several confident conclusions here were reversed by measurement. Use his source files for artwork — he rejected a hand-reconstructed icon outright.
