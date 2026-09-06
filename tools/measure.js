/* ===========================================================================
   MEASUREMENT HARNESS

   Loaded on demand from the console; the game never imports it.

   Everything here exists because the pile is randomised and the run-to-run
   spread is bigger than most of the effects worth chasing. Identical settings,
   measured six times, gave 2, 9, 4, 1, 11 and 1 coins visibly moving. So:
   fixed seeds, a fixed panel of them, the same warm-up on both sides, and
   path length rather than endpoint drift - jitter oscillates, so a coin that
   buzzes for a second and comes back looks perfectly still if you only
   compare where it started with where it ended.
   ========================================================================= */
(function () {
  const D = () => CP.DIMS.D;

  function snap() {
    const out = [];
    const items = CP.ctx.items;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const t = it.body.translation(), q = it.body.rotation();
      out.push({ id: it.body.handle, x: t.x, y: t.y, z: t.z,
                 qx: q.x, qy: q.y, qz: q.z, qw: q.w });
    }
    return out;
  }

  function quatAngleDeg(a, b) {
    let d = a.qx * b.qx + a.qy * b.qy + a.qz * b.qz + a.qw * b.qw;
    d = Math.min(1, Math.abs(d));
    return 2 * Math.acos(d) * 180 / Math.PI;
  }

  function median(a) {
    if (!a.length) return 0;
    const s = a.slice().sort((x, y) => x - y);
    return s[Math.floor(s.length / 2)];
  }
  function pct(a, p) {
    if (!a.length) return 0;
    const s = a.slice().sort((x, y) => x - y);
    return s[Math.min(s.length - 1, Math.floor(s.length * p))];
  }

  /* One seed. Settle with the machine OFF, then accumulate every coin's
     angular and linear PATH over the measurement window. */
  async function runSeed(seed, o) {
    const settle  = o.settle  != null ? o.settle  : 600;   // 10s
    const window_ = o.window  != null ? o.window  : 300;   // 5s
    const running = !!o.running;

    CP.setAutoStep(false);          // the render loop must not add steps of its own
    CP.setRunning(false);
    CP.resetPileSeeded(seed);
    for (let i = 0; i < settle; i++) {
      CP.step();
      if ((i & 127) === 0) await new Promise(r => setTimeout(r, 0));
    }

    CP.setRunning(running);

    const ang = new Map(), lin = new Map();
    let prev = snap();
    for (const s of prev) { ang.set(s.id, 0); lin.set(s.id, 0); }

    for (let i = 0; i < window_; i++) {
      CP.step();
      if ((i & 127) === 0) await new Promise(r => setTimeout(r, 0));
      const now = snap();
      const byId = new Map(prev.map(s => [s.id, s]));
      for (const s of now) {
        const p = byId.get(s.id);
        if (!p) continue;                       // newly spawned; ignore
        if (!ang.has(s.id)) { ang.set(s.id, 0); lin.set(s.id, 0); }
        ang.set(s.id, ang.get(s.id) + quatAngleDeg(p, s));
        const dx = s.x - p.x, dy = s.y - p.y, dz = s.z - p.z;
        lin.set(s.id, lin.get(s.id) + Math.sqrt(dx * dx + dy * dy + dz * dz) / D());
      }
      prev = now;
    }
    CP.setRunning(false);

    /* Only score coins that were there for the whole window and are still on
       the machine - one that fell off mid-window is not evidence about
       stillness. */
    const live = new Set(snap().map(s => s.id));
    const A = [], L = [];
    let moving = 0, deadStill = 0;
    for (const [id, a] of ang) {
      if (!live.has(id)) continue;
      const l = lin.get(id);
      A.push(a); L.push(l);
      if (a > 1.0 || l > 0.004) moving++;
      if (a < 0.02 && l < 0.0002) deadStill++;
    }

    let asleep = 0;
    for (const it of CP.ctx.items) if (it.body.isSleeping()) asleep++;

    return {
      seed, n: A.length, moving, deadStill, asleep,
      angMed: +median(A).toFixed(3), angP90: +pct(A, 0.9).toFixed(2),
      angMax: +Math.max(0, ...A).toFixed(1),
      linMed: +median(L).toFixed(5), linP90: +pct(L, 0.9).toFixed(4)
    };
  }

  async function panel(seeds, o) {
    o = o || {};
    const rows = [];
    for (const s of seeds) rows.push(await runSeed(s, o));
    const sum = k => rows.reduce((a, r) => a + r[k], 0);
    const n = rows.length;
    return {
      rows,
      label: o.label || '',
      totalCoins: sum('n'),
      moving: +(sum('moving') / n).toFixed(2),
      movingPct: +(100 * sum('moving') / sum('n')).toFixed(1),
      deadStillPct: +(100 * sum('deadStill') / sum('n')).toFixed(1),
      asleepPct: +(100 * sum('asleep') / sum('n')).toFixed(1),
      perfectPiles: rows.filter(r => r.moving === 0).length + '/' + n,
      angMed: +(rows.reduce((a, r) => a + r.angMed, 0) / n).toFixed(3),
      angP90: +(rows.reduce((a, r) => a + r.angP90, 0) / n).toFixed(2)
    };
  }

  /* Worst disc-on-disc bite in the settled pile, as a fraction of a diameter.
     The metric that matters visually: how far one coin's face is inside
     another's, NOT the shortest escape distance, which is small and vertical
     and is what made an obviously-overlapping pile measure as nearly solid. */
  function overlap() {
    const items = CP.ctx.items, d = D();
    let worst = 0, pairs = 0;
    for (let i = 0; i < items.length; i++) {
      const a = items[i], ta = a.body.translation();
      const da = CP.DIMS.itemDims(a.typeId);
        if (da.shape !== 'disc') continue;
      for (let j = i + 1; j < items.length; j++) {
        const b = items[j], tb = b.body.translation();
        const db = CP.DIMS.itemDims(b.typeId);
        if (db.shape !== 'disc') continue;
        const dy = Math.abs(ta.y - tb.y);
        if (dy > (da.height + db.height) * 0.5) continue;          // stacked, not bitten
        const dx = ta.x - tb.x, dz = ta.z - tb.z;
        const horiz = Math.sqrt(dx * dx + dz * dz);
        const bite = (da.radius + db.radius) - horiz;
        if (bite > d * 0.02) { pairs++; if (bite / d > worst) worst = bite / d; }
      }
    }
    return { pairs, per100: +(100 * pairs / Math.max(1, items.length)).toFixed(1),
             worstBiteOfDiameter: +worst.toFixed(3) };
  }

  window.CPM = { runSeed, panel, overlap, snap };
  console.log('[CPM] harness ready');
})();
