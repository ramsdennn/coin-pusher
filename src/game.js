/* ============================================================================
   COIN PUSHER - core game

   Two things drive everything here:

   1. A coin is dropped down a peg chute at the BACK of the machine (behind the
      glass on a real cabinet). It rattles down through the pegs and lands on
      the shelf. Where it ends up is not where you aimed it.

   2. The whole SHELF slides back and forth - it is not a bat swatting coins.
      Coins resting on the shelf ride with it in both directions, held by
      friction. On the forward stroke the shelf and its passengers drive into
      the pile sitting on the fixed floor ahead. On the back stroke the shelf
      slides out from under that pile and opens a gap at the back for the next
      coin. That gap is why the drop has to be timed.

   World gravity is zero. Nothing moves unless the shelf moves it. Gravity is
   applied by hand to coins while they are falling down the chute only.
   ========================================================================= */

const CFG = window.COIN_PUSHER_CONFIG;
const MB  = Phaser.Physics.Matter.Matter.Body;

const W = 1280, H = 720;

/* Collision groups. Coins in the chute are physically behind glass on a real
   machine, so they rattle off the pegs but must not touch the shelf pile. */
const CAT = { ITEM: 0x0001, CHUTE: 0x0002, PEG: 0x0004, WALL: 0x0008 };

const L = {
  playLeft:  440,
  playRight: 840,
  dropRowY:  22,
  dropRowH:  38,
  chuteTop:    46,
  chuteBottom: 196,
  wallThick: 14,
  tier1: { back: 202, front: 434 },
  tier2: { back: 450, front: 682 },
  trayTop: 688
};
L.playW = L.playRight - L.playLeft;
L.colW  = L.playW / 4;

const COL_X = [0, 1, 2, 3].map(i => L.playLeft + (i + 0.5) * L.colW);
const TEAM_COLORS = [0x3B82F6, 0xF97316];
const TEAM_CSS    = ['#3B82F6', '#F97316'];

class GameScene extends Phaser.Scene {
  constructor() { super('game'); }

  init(data) {
    this.teams = [
      { name: data.teamA || 'Team 1', score: 0, log: [] },
      { name: data.teamB || 'Team 2', score: 0, log: [] }
    ];
    this.activeTeam  = 0;
    this.items       = [];
    this.pusherOn    = true;
    this.pusherPhase = 0;
    this.lastDropAt  = 0;
    this.shelfOffset = 0;
    this.shelfVel    = 0;
  }

  preload() {
    for (const [id, t] of Object.entries(CFG.itemTypes)) {
      if (t.image) this.load.image('item-' + id, 'assets/' + t.image);
    }
    this.load.on('loaderror', f => console.warn('Asset missing:', f.src, '- falling back to a plain disc'));
  }

  create() {
    // The pile may only start clear of the shelf wall's fullest reach,
    // otherwise the wall sweeps into the back row on frame one.
    for (const t of [L.tier1, L.tier2]) {
      t.entryY = t.back + L.wallThick + CFG.tuning.shelfLength
               + CFG.tuning.pusherAmplitude + 3;
    }

    this.drawMachine();
    this.buildWalls();
    this.buildChute();
    this.buildShelves();
    this.buildDropZones();
    this.buildHud();
    this.bindKeys();
    this.populateShelf();
    this.refreshHud();
  }

  /* ---------------- geometry ---------------- */

  /* Live position of one tier's shelf: its back wall, and how far forward the
     shelf surface reaches. Everything else is derived from this. */
  shelfGeom(tierNo) {
    const t = tierNo === 1 ? L.tier1 : L.tier2;
    const wallBack  = t.back;                 // the slot it slides into never moves
    const wallFront = wallBack + L.wallThick;
    return {
      wallBack, wallFront,
      shelfFront: wallFront + CFG.tuning.shelfLength + this.shelfOffset
    };
  }

  /* ---------------- scenery ---------------- */

  drawMachine() {
    const g = this.add.graphics().setDepth(0);
    g.fillStyle(0x0B0616, 1).fillRect(0, 0, W, H);

    // chute recess at the back of the cabinet
    g.fillStyle(0x150B26, 1).fillRect(L.playLeft, L.chuteTop, L.playW, L.chuteBottom - L.chuteTop);

    // fixed floor of each tier
    g.fillStyle(0x6E1230, 1).fillRect(L.playLeft, L.tier1.back, L.playW, L.tier1.front - L.tier1.back);
    g.fillStyle(0x7C1636, 1).fillRect(L.playLeft, L.tier2.back, L.playW, L.tier2.front - L.tier2.back);

    // the lip each tier falls over
    g.fillStyle(0x2A0A18, 1)
      .fillRect(L.playLeft, L.tier1.front, L.playW, L.tier2.back - L.tier1.front)
      .fillRect(L.playLeft, L.tier2.front, L.playW, L.trayTop - L.tier2.front);

    g.fillStyle(0x05030C, 1).fillRect(L.playLeft, L.trayTop, L.playW, H - L.trayTop);

    // purple LED side walls
    g.fillStyle(0x7B2CBF, 1)
      .fillRect(L.playLeft - 14, L.chuteTop, 14, L.trayTop - L.chuteTop)
      .fillRect(L.playRight, L.chuteTop, 14, L.trayTop - L.chuteTop);
    g.fillStyle(0xC77DFF, 0.5)
      .fillRect(L.playLeft - 14, L.chuteTop, 4, L.trayTop - L.chuteTop)
      .fillRect(L.playRight + 10, L.chuteTop, 4, L.trayTop - L.chuteTop);

    // the pane of glass the chute sits behind
    g.lineStyle(2, 0x8B5FD0, 0.55)
      .lineBetween(L.playLeft, L.chuteBottom, L.playRight, L.chuteBottom);

    this.add.text(L.playLeft + L.playW / 2, L.trayTop + 20, 'WIN LINE', {
      fontFamily: 'Arial Black', fontSize: '18px', color: '#4A3A6E'
    }).setOrigin(0.5).setDepth(1);
  }

  buildWalls() {
    const opts = {
      isStatic: true, friction: 0.02, restitution: 0.02,
      collisionFilter: { category: CAT.WALL, mask: CAT.ITEM }
    };
    const h  = (L.trayTop - L.tier1.back) + 300;
    const cy = L.tier1.back + h / 2 - 150;
    this.matter.add.rectangle(L.playLeft - 12, cy, 24, h, opts);
    this.matter.add.rectangle(L.playRight + 12, cy, 24, h, opts);
  }

  /* ---------------- the peg chute ---------------- */

  buildChute() {
    const pegOpts = {
      isStatic: true, restitution: CFG.tuning.pegBounce, friction: 0.02,
      collisionFilter: { category: CAT.PEG, mask: CAT.CHUTE }
    };
    const r    = CFG.tuning.pegRadius;
    const rows = CFG.tuning.pegRows;
    const gap  = CFG.tuning.pegSpacing;
    const band = (L.chuteBottom - L.chuteTop) / (rows + 1);

    for (let row = 0; row < rows; row++) {
      const y = L.chuteTop + band * (row + 1);
      // stagger alternate rows so a coin can never fall straight through
      const offset = (row % 2) ? gap / 2 : 0;
      const n = Math.floor((L.playW - 20) / gap);
      const rowW = (n - 1) * gap;
      let x = L.playLeft + (L.playW - rowW) / 2 + offset - gap / 2;
      for (let i = 0; i <= n; i++, x += gap) {
        if (x < L.playLeft + 12 || x > L.playRight - 12) continue;
        this.matter.add.circle(x, y, r, pegOpts);
        this.add.circle(x, y, r, 0xC77DFF, 0.85).setDepth(3);
      }
    }

    // chute side walls, so a rattling coin cannot escape sideways
    const wallOpts = {
      isStatic: true, restitution: 0.2, friction: 0.02,
      collisionFilter: { category: CAT.PEG, mask: CAT.CHUTE }
    };
    const ch = L.chuteBottom - L.chuteTop + 40;
    const cy = L.chuteTop + ch / 2 - 20;
    this.matter.add.rectangle(L.playLeft - 8, cy, 16, ch, wallOpts);
    this.matter.add.rectangle(L.playRight + 8, cy, 16, ch, wallOpts);
  }

  /* Coins in the chute get hand-applied gravity, and land on the shelf as soon
     as they are clear of the shelf's back wall - wherever the shelf has slid to
     by the time they arrive. Drop on the wrong beat and the coin lands late,
     on top of the pile, instead of cleanly at the back of the shelf. */
  updateChuteItems() {
    const g   = CFG.tuning.chuteGravity;
    const max = CFG.tuning.chuteMaxSpeed;

    for (const it of this.items) {
      if (!it.body || !it.getData('inChute')) continue;

      const v = it.body.velocity;
      const vy = Math.min(v.y + g, max);

      // A coin can land dead-centre on a peg and balance there forever, because
      // setting velocity by hand each frame overrides the deflection that would
      // otherwise tip it off. A constant sideways fidget makes balancing
      // impossible, and a harder shove frees anything that has already stalled.
      const stalled = Math.abs(v.y) < 0.3;
      const nudge = (Math.random() - 0.5) * (stalled ? 1.2 : 0.16);
      it.setVelocity(v.x * 0.98 + nudge, vy);

      const r = CFG.itemTypes[it.getData('typeId')].radius;
      const landY = this.shelfGeom(1).wallFront + r + 2;
      const stuck = this.time.now - it.getData('droppedAt') > CFG.tuning.chuteTimeoutMs;

      if (it.y >= landY) this.landItem(it, landY);
      else if (stuck)    this.landItem(it, landY, true);
    }
  }

  landItem(it, landY, wedged) {
    // A wedged coin is stranded somewhere up in the pegs. Drop it onto the
    // shelf rather than releasing it where it stuck, or it becomes a ghost
    // floating in the chute that nothing can ever move.
    if (wedged) {
      it.setPosition(it.x, landY);
      console.warn('A coin wedged in the pegs and was placed on the shelf. ' +
        'If this happens often, raise pegSpacing in config.js.');
    }
    it.setData('inChute', false);
    it.setData('tier', 1);
    it.setCollisionCategory(CAT.ITEM);
    it.setCollidesWith([CAT.ITEM, CAT.WALL]);
    const v = it.body.velocity;
    it.setVelocity(v.x * 0.3, v.y * 0.12);   // it has hit the shelf, not bounced onto it
  }

  /* ---------------- the shelf ---------------- */

  buildShelves() {
    this.shelves = [1, 2].map(n => {
      const t = n === 1 ? L.tier1 : L.tier2;
      const wall = this.matter.add.rectangle(
        L.playLeft + L.playW / 2, t.back + L.wallThick / 2, L.playW - 6, L.wallThick,
        {
          isStatic: true, friction: 0.9, frictionStatic: 1, restitution: 0,
          collisionFilter: { category: CAT.WALL, mask: CAT.ITEM }
        }
      );
      // the sliding shelf surface, drawn so the whole thing visibly travels
      // the deck slides out of the slot and back into it, so its visible
      // length changes rather than the whole slab sliding along
      const deck = this.add.rectangle(
        L.playLeft + L.playW / 2, 0, L.playW - 6, CFG.tuning.shelfLength, 0x8E1C44
      ).setDepth(2);
      const face = this.add.rectangle(
        L.playLeft + L.playW / 2, 0, L.playW - 6, 7, 0xC98BA8
      ).setDepth(3);
      // the fixed slot the shelf retreats into
      this.add.rectangle(
        L.playLeft + L.playW / 2, t.back + L.wallThick / 2, L.playW - 6, L.wallThick, 0x2A0A18
      ).setStrokeStyle(2, 0x7A3358).setDepth(3);
      return { tierNo: n, wall, deck, face };
    });
  }

  updateShelves(delta) {
    if (this.pusherOn) {
      this.pusherPhase += (delta / CFG.tuning.pusherPeriodMs) * Math.PI * 2;
    }
    const prev = this.shelfOffset;
    this.shelfOffset = (Math.sin(this.pusherPhase) * 0.5 + 0.5) * CFG.tuning.pusherAmplitude;
    this.shelfVel = this.shelfOffset - prev;   // px per step, signed

    for (const sh of this.shelves) {
      const gm  = this.shelfGeom(sh.tierNo);
      const len = gm.shelfFront - gm.wallFront;
      sh.deck.setSize(L.playW - 6, len);
      sh.deck.y = gm.wallFront + len / 2;
      sh.face.y = gm.shelfFront - 3;
    }
  }

  /* The ratchet, and the reason the machine works at all.

     On the way OUT the shelf carries its coins forward with it. On the way
     BACK it withdraws into its slot and simply leaves them behind - they do
     not ride back. So every stroke is a net gain forward, and the pile creeps
     towards the edge instead of rocking on the spot.

     The grip cap keeps it friction rather than a weld: if the pile ahead
     refuses to budge, the shelf slides on underneath the coin. */
  carryShelfItems() {
    if (this.shelfVel <= 0) return;   // withdrawing: the coins stay put

    const grip = CFG.tuning.shelfGrip;
    const target = this.shelfVel;

    for (const it of this.items) {
      if (!it.body || it.getData('inChute')) continue;
      const gm = this.shelfGeom(it.getData('tier'));
      if (it.y < gm.wallFront || it.y > gm.shelfFront) continue;   // on the fixed floor

      const vy = it.body.velocity.y;
      const dv = target - vy;
      const step = Math.sign(dv) * Math.min(Math.abs(dv), grip);
      it.setVelocity(it.body.velocity.x, vy + step);
    }
  }

  /* A real coin overhanging the lip tips off under its own weight. Without
     that, the front row just sits there bearing the load of everything behind
     it, the whole tier locks solid, and coins pile up instead of falling. This
     gives anything already past the edge a shove so it actually goes. */
  applyEdgeTipping() {
    const tip = CFG.tuning.edgeTip;
    for (const it of this.items) {
      if (!it.body || it.getData('inChute')) continue;
      const t = it.getData('tier') === 1 ? L.tier1 : L.tier2;
      const r = CFG.itemTypes[it.getData('typeId')].radius;
      if (it.y > t.front - r * CFG.tuning.tipOverhang && it.body.velocity.y < tip) {
        it.setVelocity(it.body.velocity.x, tip);
      }
    }
  }

  /* Coins are lying on a shelf, and Matter has no concept of that in a
     top-down sim. frictionAir alone is proportional drag - it never actually
     stops anything and a shove either dies instantly or runs away. This is
     Coulomb friction instead: a flat amount of speed removed per step, plus a
     threshold below which an item is simply at rest. */
  applyFloorFriction() {
    const decel = CFG.tuning.floorFriction;
    const stop  = CFG.tuning.stopThreshold;
    for (const it of this.items) {
      const b = it.body;
      if (!b || it.getData('inChute')) continue;
      const vx = b.velocity.x, vy = b.velocity.y;
      const sp = Math.sqrt(vx * vx + vy * vy);
      if (sp === 0) continue;
      if (sp < stop) { it.setVelocity(0, 0); continue; }
      const f = (sp - decel) / sp;
      it.setVelocity(vx * f, vy * f);
    }
  }

  /* ---------------- items ---------------- */

  makeItem(typeId, x, y, inChute) {
    const t  = CFG.itemTypes[typeId];
    const r  = t.radius;
    const fy = CFG.tuning.flattenY;
    const key = 'item-' + typeId;

    let go;
    if (t.image && this.textures.exists(key)) {
      go = this.add.image(x, y, key).setDisplaySize(r * 2, r * 2 * fy);
    } else {
      go = this.add.ellipse(x, y, r * 2, r * 2 * fy, t.color).setStrokeStyle(2, 0x000000, 0.35);
    }
    go.setDepth(inChute ? 8 : 5);

    this.matter.add.gameObject(go, {
      shape: { type: 'circle', radius: r },
      friction:       CFG.tuning.itemFriction,
      frictionAir:    CFG.tuning.itemFrictionAir,
      frictionStatic: CFG.tuning.itemFrictionStatic,
      restitution:    CFG.tuning.itemRestitution,
      density:        CFG.tuning.itemDensity
    });
    go.setFixedRotation();

    if (inChute) {
      go.setCollisionCategory(CAT.CHUTE);
      go.setCollidesWith([CAT.PEG]);
      go.setData('inChute', true);
      go.setData('droppedAt', this.time.now);
      go.setData('tier', 1);
    } else {
      go.setCollisionCategory(CAT.ITEM);
      go.setCollidesWith([CAT.ITEM, CAT.WALL]);
      go.setData('inChute', false);
      go.setData('tier', y < L.tier1.front ? 1 : 2);
    }
    go.setData('typeId', typeId);
    this.items.push(go);
    return go;
  }

  /* Rows laid out from the back of each tier forward, every item in a slot its
     own size, with a deliberate gap between rows. The slack matters: a pile
     packed solid is incompressible and marches off the edge in one stroke. */
  populateShelf() {
    for (const tierNo of [1, 2]) {
      const t = tierNo === 1 ? L.tier1 : L.tier2;

      const queue = [];
      for (const row of CFG.startingLayout) {
        if (row.tier !== tierNo) continue;
        for (let i = 0; i < row.count; i++) queue.push(row.type);
      }
      if (!queue.length) continue;
      Phaser.Utils.Array.Shuffle(queue);

      const usableW = L.playW - 26;
      const left    = L.playLeft + 13;
      const rows    = [[]];
      let rowW = 0;
      for (const typeId of queue) {
        const d = CFG.itemTypes[typeId].radius * 2 + 1;
        if (rowW + d > usableW && rows[rows.length - 1].length) { rows.push([]); rowW = 0; }
        rows[rows.length - 1].push(typeId);
        rowW += d;
      }

      // Stack the rows FORWARD from the lip, not back from the shelf. A real
      // machine is loaded right up to the edge; if the pile stops short, every
      // session opens with a dead patch where drops only close the gap and
      // nothing can possibly fall out.
      const rowR = rows.map(r => Math.max(...r.map(id => CFG.itemTypes[id].radius)));
      const ys = new Array(rows.length);
      let y = t.front - rowR[rows.length - 1] * CFG.tuning.tipOverhang - 2;
      for (let i = rows.length - 1; i >= 0; i--) {
        ys[i] = y;
        if (i > 0) y -= rowR[i] + rowR[i - 1] + CFG.tuning.rowGap;
      }

      let skipped = 0;
      rows.forEach((row, i) => {
        const width = row.reduce((a, id) => a + CFG.itemTypes[id].radius * 2 + 1, 0);
        // shove each row sideways a little so the pile doesn't read as a grid
        let x = left + (usableW - width) / 2 + Phaser.Math.Between(-9, 9);
        for (const typeId of row) {
          const r = CFG.itemTypes[typeId].radius;
          x += r;
          // must clear the shelf's fullest reach, or the shelf starts the
          // session already shoving and coins fall with nobody having played
          if (ys[i] - r >= t.entryY) {
            this.makeItem(typeId,
              Phaser.Math.Clamp(x + Phaser.Math.Between(-3, 3), L.playLeft + 22, L.playRight - 22),
              ys[i] + Phaser.Math.Between(-2, 2), false);
          } else {
            skipped++;
          }
          x += r + 1;
        }
      });
      if (skipped) {
        console.warn('Tier ' + tierNo + ' is full: ' + skipped + ' item(s) from ' +
          'startingLayout had nowhere to go and were not placed. Reduce the ' +
          'counts for this tier in config.js.');
      }
    }
  }

  dropInto(col) {
    if (this.time.now - this.lastDropAt < 250) return;   // double-click guard
    this.lastDropAt = this.time.now;

    const x = COL_X[col] + Phaser.Math.Between(-CFG.tuning.spawnJitterPx, CFG.tuning.spawnJitterPx);
    const it = this.makeItem(CFG.dropItem, x, L.chuteTop - 6, true);
    it.setVelocity(0, CFG.tuning.chuteEntrySpeed);
    this.flashZone(col);
  }

  /* ---------------- edges ---------------- */

  checkEdges() {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (!it.body || it.getData('inChute')) continue;

      if (it.getData('tier') === 1 && it.y > L.tier1.front) {
        // over the lip: lands on tier 2's shelf, wherever that has slid to
        const r = CFG.itemTypes[it.getData('typeId')].radius;
        const x = Phaser.Math.Clamp(it.x + Phaser.Math.Between(-6, 6), L.playLeft + 26, L.playRight - 26);
        const landY = this.shelfGeom(2).wallFront + r + 2;
        this.tumbleGhost(it, x, landY);
        it.setPosition(x, landY);
        it.setVelocity(0, 0);
        it.setData('tier', 2);
      } else if (it.getData('tier') === 2 && it.y > L.tier2.front) {
        this.resolveItem(it, i);
      } else if (it.y > H + 80 || it.x < -80 || it.x > W + 80) {
        it.destroy();
        this.items.splice(i, 1);
      }
    }
  }

  /* The item itself teleports down to tier 2. This throwaway sprite falls down
     the lip so the eye sees a drop rather than a jump cut. */
  tumbleGhost(it, toX, toY) {
    const typeId = it.getData('typeId');
    const t  = CFG.itemTypes[typeId];
    const fy = CFG.tuning.flattenY;
    const g = (t.image && this.textures.exists('item-' + typeId))
      ? this.add.image(it.x, it.y, 'item-' + typeId).setDisplaySize(t.radius * 2, t.radius * 2 * fy)
      : this.add.ellipse(it.x, it.y, t.radius * 2, t.radius * 2 * fy, t.color).setStrokeStyle(2, 0x000000, 0.35);
    g.setDepth(6);
    this.tweens.add({
      targets: g, x: toX, y: toY, scaleX: 0.82, scaleY: 0.82, alpha: 0.25,
      duration: 220, ease: 'Quad.easeIn', onComplete: () => g.destroy()
    });
  }

  resolveItem(it, idx) {
    const typeId = it.getData('typeId');
    const t    = CFG.itemTypes[typeId];
    const team = this.teams[this.activeTeam];

    if (t.value.type === 'points') {
      team.score += t.value.amount;
      this.floatText('+' + t.value.amount, it.x, TEAM_CSS[this.activeTeam]);
    } else {
      this.prizeBanner(team.name + ' wins: ' + t.value.label);
    }
    team.log.push(typeId);

    it.destroy();
    this.items.splice(idx, 1);
    this.refreshHud();
  }

  /* ---------------- drop zones ---------------- */

  buildDropZones() {
    this.zoneViews = COL_X.map((cx, i) => {
      const r = this.add.rectangle(cx, L.dropRowY, L.colW - 14, L.dropRowH, 0x1E1233)
        .setStrokeStyle(3, 0x7B2CBF).setDepth(10).setInteractive({ useHandCursor: true });
      this.add.text(cx, L.dropRowY, String(i + 1), {
        fontFamily: 'Arial Black', fontSize: '26px', color: '#C77DFF'
      }).setOrigin(0.5).setDepth(11);

      r.on('pointerover', () => r.setFillStyle(0x33205C));
      r.on('pointerout',  () => r.setFillStyle(0x1E1233));
      r.on('pointerdown', () => this.dropInto(i));
      return r;
    });
  }

  flashZone(i) {
    const r = this.zoneViews[i];
    r.setFillStyle(0xC77DFF);
    this.time.delayedCall(140, () => r.setFillStyle(0x1E1233));
  }

  /* ---------------- HUD ---------------- */

  buildHud() {
    this.panels = [0, 1].map(i => {
      const cx = i === 0 ? 196 : W - 196;
      const bg = this.add.rectangle(cx, 300, 340, 430, 0x140D24)
        .setStrokeStyle(5, 0x2A1D45).setDepth(9).setInteractive({ useHandCursor: true });
      bg.on('pointerdown', () => this.setActiveTeam(i));

      const name = this.add.text(cx, 132, '', {
        fontFamily: 'Arial Black', fontSize: '30px', color: TEAM_CSS[i],
        align: 'center', wordWrap: { width: 310 }
      }).setOrigin(0.5).setDepth(10);

      const score = this.add.text(cx, 212, '0', {
        fontFamily: 'Arial Black', fontSize: '78px', color: '#FFFFFF'
      }).setOrigin(0.5).setDepth(10);

      const badge = this.add.text(cx, 106, 'ACTIVE', {
        fontFamily: 'Arial Black', fontSize: '17px', color: '#0B0616',
        backgroundColor: TEAM_CSS[i], padding: { x: 12, y: 4 }
      }).setOrigin(0.5).setDepth(11);

      this.add.text(cx, 288, 'WON', {
        fontFamily: 'Arial', fontSize: '15px', color: '#6E5A94'
      }).setOrigin(0.5).setDepth(10);

      return { bg, name, score, badge, cx, dots: [] };
    });

    this.add.text(196, 600, [
      'Click a team to make them active,',
      'then click a drop zone.',
      '',
      '1-4   drop into that zone',
      'T      switch team',
      'SPACE  pause the shelf'
    ].join('\n'),
      { fontFamily: 'Arial', fontSize: '16px', color: '#4A3A6E', align: 'center', lineSpacing: 3 })
      .setOrigin(0.5).setDepth(12);

    this.pausedText = this.add.text(W - 196, 600, 'SHELF PAUSED', {
      fontFamily: 'Arial Black', fontSize: '24px', color: '#FFD166'
    }).setOrigin(0.5).setDepth(30).setVisible(false);
  }

  refreshHud() {
    this.teams.forEach((team, i) => {
      const p = this.panels[i];
      p.name.setText(team.name);
      p.score.setText(String(team.score));
      p.badge.setVisible(i === this.activeTeam);
      p.bg.setStrokeStyle(5, i === this.activeTeam ? TEAM_COLORS[i] : 0x2A1D45);

      p.dots.forEach(d => d.destroy());
      p.dots = [];
      const perRow = 6, step = 30;
      team.log.slice(-30).forEach((typeId, n) => {
        const t   = CFG.itemTypes[typeId];
        const key = 'item-' + typeId;
        const x = p.cx - ((perRow - 1) * step) / 2 + (n % perRow) * step;
        const y = 320 + Math.floor(n / perRow) * step;
        const dot = (t.image && this.textures.exists(key))
          ? this.add.image(x, y, key).setDisplaySize(22, 22)
          : this.add.ellipse(x, y, 22, 22 * CFG.tuning.flattenY, t.color).setStrokeStyle(1, 0x000000, 0.4);
        p.dots.push(dot.setDepth(10));
      });
    });
  }

  setActiveTeam(i) {
    this.activeTeam = i;
    this.refreshHud();
  }

  floatText(msg, x, color) {
    const t = this.add.text(x, L.tier2.front + 10, msg, {
      fontFamily: 'Arial Black', fontSize: '38px', color
    }).setOrigin(0.5).setDepth(30);
    this.tweens.add({ targets: t, y: t.y + 46, alpha: 0, duration: 1100, onComplete: () => t.destroy() });
  }

  prizeBanner(msg) {
    const bg = this.add.rectangle(W / 2, 360, 900, 130, 0x000000, 0.88)
      .setStrokeStyle(6, 0xFFD166).setDepth(40);
    const t = this.add.text(W / 2, 360, 'PRIZE!   ' + msg, {
      fontFamily: 'Arial Black', fontSize: '42px', color: '#FFD166',
      align: 'center', wordWrap: { width: 840 }
    }).setOrigin(0.5).setDepth(41);
    this.time.delayedCall(4200, () => {
      this.tweens.add({
        targets: [bg, t], alpha: 0, duration: 500,
        onComplete: () => { bg.destroy(); t.destroy(); }
      });
    });
  }

  /* ---------------- input ---------------- */

  bindKeys() {
    this.input.keyboard.on('keydown-ONE',   () => this.dropInto(0));
    this.input.keyboard.on('keydown-TWO',   () => this.dropInto(1));
    this.input.keyboard.on('keydown-THREE', () => this.dropInto(2));
    this.input.keyboard.on('keydown-FOUR',  () => this.dropInto(3));
    this.input.keyboard.on('keydown-T',     () => this.setActiveTeam(1 - this.activeTeam));
    this.input.keyboard.on('keydown-SPACE', () => {
      this.pusherOn = !this.pusherOn;
      this.pausedText.setVisible(!this.pusherOn);
    });
  }

  update(time, delta) {
    this.updateShelves(delta);
    this.updateChuteItems();
    this.applyFloorFriction();
    this.carryShelfItems();
    this.applyEdgeTipping();
    this.checkEdges();
  }
}

/* ------------------------------------------------------------------ */

window.startCoinPusher = function (teamA, teamB) {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    width: W,
    height: H,
    parent: 'game',
    backgroundColor: '#0B0616',
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    physics: {
      default: 'matter',
      matter: { gravity: { x: 0, y: 0 }, enableSleeping: false, debug: false }
    },
    scene: []          // added below so team names reach init()
  });
  game.scene.add('game', GameScene, true, { teamA, teamB });
  window.GAME = game;  // handy for live tuning from the browser console
  return game;
};
