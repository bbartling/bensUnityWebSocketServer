/**
 * Emoji Lobber — single-player slingshot puzzle (no networking).
 * Hero picker = human faces only (each has a power). Targets = villain/creature emojis.
 */
(function () {
  'use strict';

  const cfg = window.LOBBER_CONFIG;
  if (!cfg || cfg.seat !== 'Man') {
    console.error('LOBBER_CONFIG missing or invalid (single-player expects seat: Man)');
    return;
  }

  const PLAYER_ID = 'Man';
  const LOBBER_DEBUG = new URLSearchParams(window.location.search).get('debug') === '1';

  /** Verbose trace — add ?debug=1 to the URL. */
  function dlog() {
    if (LOBBER_DEBUG) {
      const args = Array.prototype.slice.call(arguments);
      args.unshift('[Lobber]');
      console.log.apply(console, args);
    }
  }

  const CANVAS_W = 900;
  const CANVAS_H = 520;
  let WORLD_W = 900;
  let WORLD_H = 520;
  let GROUND_Y = 458;
  let SLING = { x: 128, y: 372 };
  let useCustomLevel = false;
  let customMeta = { name: 'My level', ricochet: 0 };
  let editorMode = null;
  let builderNextId = 20000;
  let buildTool = 'wood';
  let buildGridSnap = true;
  let buildDragPiece = null;
  let buildDragSling = false;
  let builderTestSnapshot = null;
  let buildCarryKind = null;
  let buildVillainEmoji = '🐷';
  let builderReturnToPicker = false;
  const GRAVITY = 0.4;
  const MAX_PULL = 138;
  const MIN_PULL = 12;
  const BASE_POWER = 0.185;
  const PR = 21;
  const SPIN_BASE = 7.5;

  function cloneTowers(t) {
    return t.map((b) => Object.assign({}, b));
  }

  function levelDef() {
    if (useCustomLevel && customMeta) {
      return {
        name: customMeta.name,
        tier: 'Custom',
        worldW: WORLD_W,
        worldH: WORLD_H,
        wallBouncesToHurtVillain: customMeta.ricochet ? 1 : 0,
      };
    }
    return LEVELS[currentLevelIndex] || LEVELS[0];
  }

  const REF_WORLD_W = 900;
  const REF_WORLD_H = 520;

  /**
   * How “zoomed out” this level is vs the reference layout (900×520).
   * Uses both width and height so tall late-game stages shrink the ball a bit too, not only wide ones.
   */
  function worldZoomOutMul() {
    const sx = Math.max(REF_WORLD_W * 0.72, WORLD_W) / REF_WORLD_W;
    const sy = Math.max(REF_WORLD_H * 0.72, WORLD_H) / REF_WORLD_H;
    return Math.exp(0.62 * Math.log(sx) + 0.38 * Math.log(sy));
  }

  /**
   * Hero hit radius in **world units** (circle vs blocks / lava).
   * One curve for every stage — larger worlds → smaller ball so gaps and corridors stay fair.
   */
  function projectileRadiusWorld() {
    const z = worldZoomOutMul();
    const r = PR * Math.pow(1 / z, 0.82);
    return Math.max(8.1, r);
  }

  function projectileEmojiFontPx() {
    return Math.max(11, Math.round(projectileRadiusWorld() * 1.52));
  }

  function worldShotScale() {
    return Math.pow(WORLD_W / REF_WORLD_W, 0.38);
  }

  function splashRadiusWorld() {
    const z = worldZoomOutMul();
    return 96 * Math.pow(1 / z, 0.6);
  }

  function debrisEmojiFontPx() {
    const z = worldZoomOutMul();
    return Math.max(9, Math.round(22 * Math.pow(1 / z, 0.55)));
  }

  function maxPullWorld() {
    return MAX_PULL * Math.min(1.35, WORLD_W / REF_WORLD_W);
  }

  function minPullWorld() {
    return MIN_PULL * (WORLD_W / REF_WORLD_W);
  }

  function slingScale() {
    return WORLD_W / REF_WORLD_W;
  }
  const REST_FRICTION = 0.9;
  const BOUNCE_DAMP = 0.52;

  function tower(id, x, y, w, h, hp, kind, pts, emoji) {
    return { id, x, y, w, h, hp, kind, pts: pts || 0, emoji: emoji || '' };
  }

  /** Indestructible — touching ends the shot (emoji “dies”). */
  function lavaBar(id, x, y, w, h) {
    return { id, x, y, w, h, hp: 9999, kind: 'lava', pts: 0, emoji: '' };
  }

  /**
   * Stacked pyramid: bottom row has `bottomN` blocks, apex is one villain.
   * If `lavaBetweenLayers`, thin lava strips sit between every other brick layer.
   */
  /**
   * @param {object} [opts] lavaBetweenLayers only — `lavaFrac` (row width), `lavaH`, `lavaLift` (px toward sky from gap center)
   */
  function pyramidBlocks(cx, base, bottomN, cw, ch, vg, hg, id0, lavaBetweenLayers, opts) {
    opts = opts || {};
    const lavaFrac = opts.lavaFrac != null ? opts.lavaFrac : 0.88;
    const lavaH = opts.lavaH != null ? opts.lavaH : 7;
    const lavaLift = opts.lavaLift != null ? opts.lavaLift : 6;
    const out = [];
    let id = id0;
    for (let r = 0; r < bottomN; r++) {
      const n = bottomN - r;
      const rowW = n * cw + (n - 1) * hg;
      const x0 = cx - rowW / 2;
      const y = base - ch - r * (ch + vg);
      for (let c = 0; c < n; c++) {
        const apex = r === bottomN - 1;
        if (apex) {
          out.push(tower(id++, x0 + c * (cw + hg), y, cw, ch, 1, 'villain', 520, '👿'));
        } else {
          const band = Math.floor(r / 2);
          const st = band >= 1 ? 'stone' : 'wood';
          const hp = st === 'wood' ? 2 : 3;
          const pts = st === 'wood' ? 72 : 128;
          out.push(tower(id++, x0 + c * (cw + hg), y, cw, ch, hp, st, pts, ''));
        }
      }
      if (lavaBetweenLayers && r < bottomN - 2 && r % 2 === 1) {
        const nextN = bottomN - r - 1;
        const nextRowW = nextN * cw + Math.max(0, nextN - 1) * hg;
        const lw = Math.max(rowW, nextRowW) * lavaFrac;
        const midY = y - vg / 2 - lavaLift;
        out.push(lavaBar(id++, cx - lw / 2, midY, lw, lavaH));
      }
    }
    if (LOBBER_DEBUG && lavaBetweenLayers) {
      const n0 = bottomN;
      const rowW0 = n0 * cw + (n0 - 1) * hg;
      const lw0 = rowW0 * lavaFrac;
      const sideMargin = (rowW0 - lw0) / 2;
      const rad = projectileRadiusWorld();
      dlog('pyramidLavaCorridor (bottom row)', {
        bottomN,
        cw,
        ch,
        vg,
        rowW: rowW0,
        lavaW: Math.round(lw0 * 10) / 10,
        sideMargin: Math.round(sideMargin * 10) / 10,
        ballRadius: Math.round(rad * 100) / 100,
        ballDiameter: Math.round(2 * rad * 100) / 100,
        sideOk: sideMargin >= rad,
        rowGap: vg,
      });
    }
    return out;
  }

  /** Human-face heroes — each power affects shot / hits. */
  const HERO_ROSTER = [
    { emoji: '😀', name: 'Zip', desc: '+12% speed', vMul: 1.12, spinMul: 1.2, dmg: 1 },
    { emoji: '😃', name: 'Big grin', desc: '+8% speed · faster spin', vMul: 1.08, spinMul: 1.35, dmg: 1 },
    { emoji: '😎', name: 'Cool', desc: 'Heavy hit · 2× vs wood', vMul: 0.94, spinMul: 0.85, dmg: 1, woodDmg: 2 },
    { emoji: '🤠', name: 'Ranger', desc: '+spin · +5% speed', vMul: 1.05, spinMul: 1.45, dmg: 1 },
    { emoji: '😇', name: 'Halo', desc: '+bonus vs villains', vMul: 1.06, spinMul: 1.1, dmg: 1, villainBonus: 120 },
    { emoji: '🥳', name: 'Party', desc: 'Splash chip to neighbor block', vMul: 1.08, spinMul: 1.25, dmg: 1, splash: true },
    { emoji: '😂', name: 'Tears', desc: 'Bouncier impacts', vMul: 1.02, spinMul: 1.15, dmg: 1, bounceMul: 1.18 },
    { emoji: '🙂', name: 'Steady', desc: 'Balanced', vMul: 1.0, spinMul: 1.0, dmg: 1 },
    { emoji: '😉', name: 'Wink', desc: '+10% speed', vMul: 1.1, spinMul: 1.05, dmg: 1 },
    { emoji: '🤓', name: 'Smart', desc: '2× vs stone', vMul: 0.98, spinMul: 1.0, dmg: 1, stoneDmg: 2 },
    { emoji: '😏', name: 'Smirk', desc: '+15% villain points', vMul: 1.04, spinMul: 1.08, dmg: 1, villainPtsMul: 1.15 },
    { emoji: '🙃', name: 'Upside', desc: 'Wild spin', vMul: 1.03, spinMul: 1.55, dmg: 1 },
  ];

  const HERO_BY_EMOJI = Object.fromEntries(HERO_ROSTER.map((h) => [h.emoji, h]));

  function defaultPower() {
    return { vMul: 1, spinMul: 1, dmg: 1, name: '—', woodDmg: 1, stoneDmg: 1, villainBonus: 0, splash: false, bounceMul: 1, villainPtsMul: 1 };
  }

  function powerForEmoji(em) {
    const h = HERO_BY_EMOJI[em];
    if (!h) {
      return defaultPower();
    }
    return {
      vMul: h.vMul ?? 1,
      spinMul: h.spinMul ?? 1,
      dmg: h.dmg ?? 1,
      name: h.name,
      woodDmg: h.woodDmg ?? h.dmg ?? 1,
      stoneDmg: h.stoneDmg ?? h.dmg ?? 1,
      villainBonus: h.villainBonus ?? 0,
      splash: !!h.splash,
      bounceMul: h.bounceMul ?? 1,
      villainPtsMul: h.villainPtsMul ?? 1,
    };
  }

  /**
   * 15 stages — Easy / Medium / Hard / Impossible. Lava blocks end the shot on touch (hero dies).
   * Wider worlds = more zoomed out. Includes pyramid layouts with layered rows (and lava bands on harder pyramids).
   */
  const LEVELS = [
    {
      id: 0,
      tier: 'Easy',
      name: 'E1 · Boot Camp',
      worldW: 900,
      worldH: 520,
      towers(b) {
        return [
          lavaBar(10, 382, b - 20, 118, 14),
          lavaBar(11, 572, b - 20, 118, 14),
          tower(12, 540, b - 68, 48, 68, 2, 'wood', 80, ''),
          tower(13, 598, b - 68, 48, 68, 2, 'wood', 80, ''),
          tower(14, 656, b - 68, 48, 68, 2, 'wood', 80, ''),
          tower(15, 714, b - 68, 48, 68, 2, 'wood', 80, ''),
          tower(16, 575, b - 136, 54, 54, 1, 'villain', 420, '🐷'),
          tower(17, 640, b - 136, 54, 54, 1, 'villain', 480, '👹'),
          tower(18, 705, b - 136, 54, 54, 1, 'villain', 450, '🦇'),
          tower(19, 610, b - 200, 44, 44, 2, 'stone', 130, ''),
          tower(20, 668, b - 200, 44, 44, 2, 'stone', 130, ''),
          tower(21, 639, b - 252, 50, 50, 1, 'villain', 600, '👿'),
        ];
      },
    },
    {
      id: 1,
      tier: 'Easy',
      name: 'E2 · Lava 101',
      worldW: 920,
      worldH: 520,
      towers(b) {
        const w = 920;
        const rx = w - 280;
        return [
          lavaBar(30, rx - 40, b - 16, w - rx + 80, 14),
          tower(31, rx, b - 52, 46, 52, 2, 'wood', 78, ''),
          tower(32, rx + 54, b - 52, 46, 52, 2, 'wood', 78, ''),
          tower(33, rx + 27, b - 112, 52, 52, 1, 'villain', 400, '🐷'),
          tower(34, rx + 10, b - 178, 40, 40, 3, 'stone', 125, ''),
          tower(35, rx + 56, b - 178, 40, 40, 3, 'stone', 125, ''),
        ];
      },
    },
    {
      id: 2,
      tier: 'Easy',
      name: 'E3 · Bridge Run',
      worldW: 980,
      worldH: 520,
      towers(b) {
        const w = 980;
        const cx = w - 320;
        return [
          lavaBar(40, cx - 30, b - 22, 200, 16),
          lavaBar(41, cx + 200, b - 22, 200, 16),
          tower(42, cx - 8, b - 58, 42, 58, 2, 'wood', 76, ''),
          tower(43, cx + 38, b - 58, 42, 58, 2, 'wood', 76, ''),
          tower(44, cx + 84, b - 58, 42, 58, 2, 'wood', 76, ''),
          tower(45, cx + 38, b - 122, 50, 50, 1, 'villain', 430, '🐗'),
        ];
      },
    },
    {
      id: 3,
      tier: 'Easy',
      name: 'E4 · Twin Peaks',
      worldW: 1040,
      worldH: 520,
      towers(b) {
        const w = 1040;
        const a = w - 480;
        const c = w - 220;
        return [
          lavaBar(50, a - 20, b - 18, 160, 12),
          lavaBar(51, c - 20, b - 18, 160, 12),
          tower(52, a, b - 50, 40, 50, 2, 'wood', 74, ''),
          tower(53, a + 46, b - 50, 40, 50, 2, 'wood', 74, ''),
          tower(54, a + 23, b - 108, 48, 48, 1, 'villain', 390, '🦇'),
          tower(55, c, b - 50, 40, 50, 2, 'wood', 74, ''),
          tower(56, c + 46, b - 50, 40, 50, 2, 'wood', 74, ''),
          tower(57, c + 23, b - 108, 48, 48, 1, 'villain', 390, '🐷'),
        ];
      },
    },
    {
      id: 4,
      tier: 'Medium',
      name: 'M1 · Outpost',
      worldW: 1120,
      worldH: 520,
      towers(b) {
        const w = 1120;
        const rx = w - 420;
        return [
          lavaBar(60, rx - 24, b - 16, 90, 12),
          lavaBar(61, rx + 200, b - 16, 90, 12),
          tower(62, rx, b - 52, 44, 52, 2, 'wood', 75, ''),
          tower(63, rx + 52, b - 52, 44, 52, 2, 'wood', 75, ''),
          tower(64, rx + 104, b - 52, 44, 52, 2, 'wood', 75, ''),
          tower(65, rx + 156, b - 52, 44, 52, 2, 'wood', 75, ''),
          tower(66, rx + 26, b - 110, 50, 50, 1, 'villain', 400, '🐗'),
          tower(67, rx + 92, b - 110, 50, 50, 1, 'villain', 400, '🐷'),
          tower(68, rx + 158, b - 110, 50, 50, 1, 'villain', 400, '🦇'),
          tower(69, rx + 60, b - 168, 42, 42, 3, 'stone', 150, ''),
          tower(70, rx + 118, b - 168, 42, 42, 3, 'stone', 150, ''),
          tower(71, rx + 300, b - 120, 40, 100, 2, 'wood', 90, ''),
          tower(72, rx + 270, b - 220, 48, 48, 1, 'villain', 520, '👹'),
        ];
      },
    },
    {
      id: 5,
      tier: 'Medium',
      name: 'M2 · Molten River',
      worldW: 1180,
      worldH: 530,
      towers(b) {
        const w = 1180;
        return [
          lavaBar(80, 320, b - 48, w - 400, 22),
          tower(81, w - 520, b - 52, 44, 52, 2, 'wood', 73, ''),
          tower(82, w - 468, b - 52, 44, 52, 2, 'wood', 73, ''),
          tower(83, w - 416, b - 52, 44, 52, 2, 'wood', 73, ''),
          tower(84, w - 494, b - 112, 50, 50, 1, 'villain', 410, '🐷'),
          tower(85, w - 438, b - 112, 50, 50, 1, 'villain', 410, '👹'),
          tower(86, w - 280, b - 56, 42, 56, 2, 'wood', 82, ''),
          tower(87, w - 232, b - 56, 42, 56, 2, 'wood', 82, ''),
          tower(88, w - 256, b - 124, 48, 48, 1, 'villain', 480, '👿'),
        ];
      },
    },
    {
      id: 6,
      tier: 'Medium',
      name: 'M3 · Pyramid & Moat',
      worldW: 1240,
      worldH: 540,
      towers(b) {
        const w = 1240;
        const cx = w - 320;
        const moatW = 340;
        return [
          lavaBar(100, cx - moatW / 2, b - 20, moatW, 16),
          ...pyramidBlocks(cx, b, 6, 38, 36, 3, 2, 101, false),
        ];
      },
    },
    {
      id: 7,
      tier: 'Medium',
      name: 'M4 · Split Keep',
      worldW: 1300,
      worldH: 540,
      towers(b) {
        const w = 1300;
        const a = w - 560;
        const b2 = w - 300;
        return [
          lavaBar(200, a + 40, b - 18, 120, 12),
          lavaBar(201, b2 + 20, b - 18, 120, 12),
          tower(202, a, b - 48, 40, 48, 2, 'wood', 70, ''),
          tower(203, a + 48, b - 48, 40, 48, 2, 'wood', 70, ''),
          tower(204, a + 24, b - 102, 46, 46, 1, 'villain', 385, '🦎'),
          tower(205, b2, b - 52, 44, 52, 2, 'wood', 76, ''),
          tower(206, b2 + 54, b - 52, 44, 52, 2, 'wood', 76, ''),
          tower(207, b2 + 27, b - 118, 50, 50, 1, 'villain', 450, '🐉'),
          lavaBar(208, (a + b2) / 2 - 30, b - 24, 60, 14),
        ];
      },
    },
    {
      id: 8,
      tier: 'Hard',
      name: 'H1 · Fortress Line',
      worldW: 1380,
      worldH: 550,
      towers(b) {
        const w = 1380;
        const a = w - 540;
        const b2 = w - 280;
        return [
          lavaBar(300, a - 10, b - 20, 100, 14),
          tower(301, a, b - 48, 40, 48, 2, 'wood', 70, ''),
          tower(302, a + 48, b - 48, 40, 48, 2, 'wood', 70, ''),
          tower(303, a + 96, b - 48, 40, 48, 2, 'wood', 70, ''),
          tower(304, a + 24, b - 100, 46, 46, 1, 'villain', 380, '🐷'),
          tower(305, a + 48, b - 158, 40, 40, 4, 'stone', 160, ''),
          tower(306, b2, b - 56, 44, 56, 2, 'wood', 85, ''),
          tower(307, b2 + 52, b - 56, 44, 56, 2, 'wood', 85, ''),
          tower(308, b2 + 26, b - 120, 52, 52, 1, 'villain', 440, '👿'),
          tower(309, b2 + 10, b - 188, 38, 38, 3, 'stone', 140, ''),
          tower(310, b2 + 58, b - 188, 38, 38, 3, 'stone', 140, ''),
          tower(311, b2 + 34, b - 242, 48, 48, 1, 'villain', 660, '🐉'),
        ];
      },
    },
    {
      id: 9,
      tier: 'Hard',
      name: 'H2 · Lava Citadel',
      wallBouncesToHurtVillain: 1,
      worldW: 1520,
      worldH: 560,
      towers(b) {
        const w = 1520;
        const c1 = w - 600;
        const c2 = w - 380;
        const c3 = w - 190;
        return [
          lavaBar(400, c1 - 10, b - 26, 520, 18),
          tower(401, c1, b - 44, 38, 44, 2, 'wood', 65, ''),
          tower(402, c1 + 44, b - 44, 38, 44, 2, 'wood', 65, ''),
          tower(403, c1 + 88, b - 44, 38, 44, 2, 'wood', 65, ''),
          tower(404, c1 + 44, b - 96, 44, 44, 1, 'villain', 360, '🐷'),
          tower(405, c1 + 20, b - 150, 36, 36, 4, 'stone', 170, ''),
          tower(406, c1 + 68, b - 150, 36, 36, 4, 'stone', 170, ''),
          tower(407, c1 + 44, b - 200, 46, 46, 1, 'villain', 700, '👹'),
          tower(408, c2, b - 50, 42, 50, 2, 'wood', 80, ''),
          tower(409, c2 + 54, b - 50, 42, 50, 2, 'wood', 80, ''),
          tower(410, c2 + 27, b - 110, 48, 48, 1, 'villain', 420, '🦇'),
          tower(411, c3, b - 40, 36, 120, 2, 'wood', 95, ''),
          tower(412, c3 - 8, b - 175, 52, 52, 1, 'villain', 480, '🐗'),
          tower(413, c3 + 48, b - 175, 44, 44, 2, 'stone', 135, ''),
        ];
      },
    },
    {
      id: 10,
      tier: 'Hard',
      name: 'H3 · Grand Pyramid',
      wallBouncesToHurtVillain: 1,
      worldW: 1580,
      worldH: 570,
      towers(b) {
        const w = 1580;
        const cx = w - 340;
        return [
          lavaBar(500, cx - 200, b - 22, 400, 16),
          ...pyramidBlocks(cx, b, 7, 36, 34, 12, 2, 501, true, { lavaFrac: 0.62, lavaH: 5, lavaLift: 4 }),
        ];
      },
    },
    {
      id: 11,
      tier: 'Hard',
      name: 'H4 · Gauntlet',
      wallBouncesToHurtVillain: 1,
      worldW: 1680,
      worldH: 580,
      towers(b) {
        const w = 1680;
        const z = w - 680;
        return [
          lavaBar(600, z - 20, b - 18, 140, 12),
          lavaBar(601, z + 200, b - 18, 140, 12),
          tower(602, z, b - 40, 36, 40, 2, 'wood', 62, ''),
          tower(603, z + 40, b - 40, 36, 40, 2, 'wood', 62, ''),
          tower(604, z + 80, b - 40, 36, 40, 2, 'wood', 62, ''),
          tower(605, z + 120, b - 40, 36, 40, 2, 'wood', 62, ''),
          tower(606, z + 20, b - 88, 40, 40, 1, 'villain', 320, '🐷'),
          tower(607, z + 64, b - 88, 40, 40, 1, 'villain', 320, '🐷'),
          tower(608, z + 108, b - 88, 40, 40, 1, 'villain', 320, '🐷'),
          tower(609, z + 44, b - 136, 34, 34, 5, 'stone', 180, ''),
          tower(610, z + 86, b - 136, 34, 34, 5, 'stone', 180, ''),
          tower(611, z + 55, b - 188, 44, 44, 1, 'villain', 820, '👿'),
        ];
      },
    },
    {
      id: 12,
      tier: 'Impossible',
      name: 'I1 · Hell Hold',
      wallBouncesToHurtVillain: 1,
      worldW: 1780,
      worldH: 600,
      towers(b) {
        const w = 1780;
        const z = w - 720;
        const y2 = w - 460;
        const y3 = w - 240;
        return [
          lavaBar(700, z - 30, b - 24, 520, 20),
          tower(698, z + 52, b - 268, 52, 26, 4, 'stone', 90, ''),
          tower(699, z + 118, b - 232, 40, 26, 4, 'stone', 90, ''),
          tower(701, z, b - 40, 36, 40, 2, 'wood', 60, ''),
          tower(702, z + 40, b - 40, 36, 40, 2, 'wood', 60, ''),
          tower(703, z + 80, b - 40, 36, 40, 2, 'wood', 60, ''),
          tower(704, z + 120, b - 40, 36, 40, 2, 'wood', 60, ''),
          tower(705, z + 20, b - 88, 40, 40, 1, 'villain', 320, '🐷'),
          tower(706, z + 64, b - 88, 40, 40, 1, 'villain', 320, '🐷'),
          tower(707, z + 108, b - 88, 40, 40, 1, 'villain', 320, '🐷'),
          tower(708, z + 44, b - 136, 34, 34, 5, 'stone', 180, ''),
          tower(709, z + 86, b - 136, 34, 34, 5, 'stone', 180, ''),
          tower(710, z + 55, b - 188, 44, 44, 1, 'villain', 800, '👿'),
          tower(711, y2, b - 48, 40, 52, 2, 'wood', 75, ''),
          tower(712, y2 + 50, b - 48, 40, 52, 2, 'wood', 75, ''),
          tower(713, y2 + 24, b - 108, 48, 48, 1, 'villain', 500, '🐉'),
          tower(714, y3, b - 44, 38, 44, 2, 'wood', 70, ''),
          tower(715, y3 + 44, b - 44, 38, 44, 2, 'wood', 70, ''),
          tower(716, y3 + 22, b - 100, 46, 46, 1, 'villain', 450, '🦇'),
          tower(717, y3 + 6, b - 158, 50, 50, 1, 'villain', 580, '👹'),
        ];
      },
    },
    {
      id: 13,
      tier: 'Impossible',
      name: 'I2 · Caldera Peak',
      wallBouncesToHurtVillain: 1,
      worldW: 1880,
      worldH: 610,
      towers(b) {
        const w = 1880;
        const cx = w - 380;
        return [
          lavaBar(800, cx - 260, b - 28, 520, 22),
          lavaBar(801, cx - 100, b - 200, 200, 14),
          ...pyramidBlocks(cx, b, 8, 34, 32, 10, 2, 802, true, { lavaFrac: 0.62, lavaH: 5, lavaLift: 4 }),
        ];
      },
    },
    {
      id: 14,
      tier: 'Impossible',
      name: 'I3 · Apocalypse',
      wallBouncesToHurtVillain: 1,
      worldW: 1980,
      worldH: 620,
      towers(b) {
        const w = 1980;
        const z = w - 760;
        const y2 = w - 500;
        return [
          lavaBar(900, 280, b - 36, w - 560, 24),
          lavaBar(901, z + 40, b - 120, 300, 16),
          tower(902, z, b - 40, 34, 40, 2, 'wood', 58, ''),
          tower(903, z + 38, b - 40, 34, 40, 2, 'wood', 58, ''),
          tower(904, z + 76, b - 40, 34, 40, 2, 'wood', 58, ''),
          tower(905, z + 114, b - 40, 34, 40, 2, 'wood', 58, ''),
          tower(906, z + 152, b - 40, 34, 40, 2, 'wood', 58, ''),
          tower(907, z + 16, b - 86, 38, 38, 1, 'villain', 300, '🐷'),
          tower(908, z + 58, b - 86, 38, 38, 1, 'villain', 300, '🐷'),
          tower(909, z + 100, b - 86, 38, 38, 1, 'villain', 300, '🐷'),
          tower(910, z + 142, b - 86, 38, 38, 1, 'villain', 300, '🐷'),
          tower(911, z + 50, b - 132, 32, 32, 5, 'stone', 175, ''),
          tower(912, z + 88, b - 132, 32, 32, 5, 'stone', 175, ''),
          tower(913, z + 69, b - 182, 42, 42, 1, 'villain', 900, '👿'),
          tower(914, y2, b - 46, 38, 50, 2, 'wood', 72, ''),
          tower(915, y2 + 48, b - 46, 38, 50, 2, 'wood', 72, ''),
          tower(916, y2 + 24, b - 104, 46, 46, 1, 'villain', 520, '🐉'),
        ];
      },
    },
  ];

  function levelGroundY(L) {
    return Math.floor(L.worldH * (458 / REF_WORLD_H));
  }

  function levelSling(L) {
    const gy = levelGroundY(L);
    return { x: Math.round(L.worldW * (128 / REF_WORLD_W)), y: gy - 86 };
  }

  function towersForLevel(levelIndex) {
    const L = LEVELS[levelIndex] || LEVELS[0];
    const base = levelGroundY(L);
    return L.towers(base);
  }

  function wallBouncesRequired() {
    const L = levelDef();
    const n = L && L.wallBouncesToHurtVillain;
    return typeof n === 'number' && n > 0 ? n : 0;
  }

  const BUILD_GRID = 8;

  function hideBuilderPanel() {
    const p = document.getElementById('lobberBuilderPanel');
    if (p) {
      p.classList.add('hidden');
      p.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('lobber-builder-active');
  }

  function showBuilderPanel() {
    const p = document.getElementById('lobberBuilderPanel');
    if (p) {
      p.classList.remove('hidden');
      p.setAttribute('aria-hidden', 'false');
    }
    document.body.classList.add('lobber-builder-active');
  }

  function hidePlaytestHud() {
    const h = document.getElementById('lobberPlaytestHud');
    if (h) {
      h.classList.add('hidden');
      h.setAttribute('aria-hidden', 'true');
    }
  }

  function syncPlaytestLevelPills() {
    const wrap = document.getElementById('lobberPlaytestLevels');
    if (!wrap) {
      return;
    }
    wrap.querySelectorAll('button[data-level]').forEach((btn) => {
      const n = parseInt(btn.getAttribute('data-level'), 10);
      btn.classList.toggle('selected', n === selectedLevelIndex);
    });
  }

  function showPlaytestHud() {
    const h = document.getElementById('lobberPlaytestHud');
    if (h) {
      h.classList.remove('hidden');
      h.setAttribute('aria-hidden', 'false');
    }
    syncPlaytestLevelPills();
  }

  function playtestSwitchCampaignLevel(i) {
    if (editorMode !== 'test') {
      return;
    }
    document.body.classList.remove('lobber-playtest');
    hidePlaytestHud();
    document.body.classList.add('lobber-builder-active');
    builderTestSnapshot = null;
    editorMode = 'edit';
    phase = 'build';
    projectile = null;
    dragging = false;
    selectedLevelIndex = i;
    reloadBuilderFromSelectedStage();
    syncLevelButtonHighlight();
    syncPlaytestLevelPills();
    showBuilderPanel();
    refreshGameInfo();
    syncPlayStopButtons();
    setTurnLine();
  }

  function initPlaytestHud() {
    if (document.getElementById('lobberPlaytestHud')) {
      return;
    }
    const hud = document.createElement('div');
    hud.id = 'lobberPlaytestHud';
    hud.className = 'lobber-playtest-hud hidden';
    hud.setAttribute('aria-hidden', 'true');
    hud.innerHTML = [
      '<div class="lobber-playtest-hud-inner">',
      '<div class="lobber-playtest-hud-top">',
      '<span class="lobber-playtest-badge">Play test</span>',
      '<button type="button" class="lobber-playtest-stop" id="lobberPlaytestStopBtn">Stop test</button>',
      '</div>',
      '<div class="lobber-playtest-hud-sub">Campaign stages — tap to open that layout in the editor</div>',
      '<div id="lobberPlaytestLevels" class="lobber-playtest-levels"></div>',
      '</div>',
    ].join('');
    document.body.appendChild(hud);
    document.getElementById('lobberPlaytestStopBtn').addEventListener('click', stopTestCustom);
    const wrap = document.getElementById('lobberPlaytestLevels');
    LEVELS.forEach((L, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'lobber-playtest-level-btn';
      b.setAttribute('data-level', String(i));
      b.textContent = L.name;
      b.title = 'Leave play test and load this stage in the builder';
      b.addEventListener('click', () => playtestSwitchCampaignLevel(i));
      wrap.appendChild(b);
    });
  }

  function snapBuild(v) {
    if (!buildGridSnap) {
      return Math.round(v);
    }
    return BUILD_GRID * Math.round(v / BUILD_GRID);
  }

  function clampSling(s) {
    const padX = 36;
    const padTop = 64;
    const padBot = 48;
    return {
      x: Math.max(padX, Math.min(WORLD_W * 0.42, s.x)),
      y: Math.max(padTop, Math.min(GROUND_Y - padBot, s.y)),
    };
  }

  function allocBuilderId() {
    builderNextId += 1;
    return builderNextId;
  }

  function hitTowerAt(px, py) {
    for (let i = towers.length - 1; i >= 0; i--) {
      const b = towers[i];
      if (b.hp <= 0) {
        continue;
      }
      if (px >= b.x && py >= b.y && px <= b.x + b.w && py <= b.y + b.h) {
        return b;
      }
    }
    return null;
  }

  function defaultHpForKind(kind) {
    if (kind === 'wood') {
      return 2;
    }
    if (kind === 'stone') {
      return 4;
    }
    if (kind === 'villain') {
      return 1;
    }
    if (kind === 'lava') {
      return 9999;
    }
    return 1;
  }

  function resetCourseHp() {
    for (const b of towers) {
      b.hp = defaultHpForKind(b.kind);
    }
  }

  function applyCustomWorld(w, h, sling, tw) {
    WORLD_W = Math.max(640, Math.min(2200, w | 0));
    WORLD_H = Math.max(480, Math.min(800, h | 0));
    GROUND_Y = Math.floor(WORLD_H * (458 / REF_WORLD_H));
    SLING = clampSling({ x: sling.x, y: sling.y });
    towers = cloneTowers(tw);
    dragCur = { x: SLING.x, y: SLING.y };
    projectile = null;
    dragging = false;
    phase = editorMode === 'test' ? 'aim' : 'build';
    refreshGameInfo();
  }

  function snapshotCustomLevel() {
    return JSON.stringify({
      v: 1,
      name: customMeta.name,
      ricochet: customMeta.ricochet ? 1 : 0,
      worldW: WORLD_W,
      worldH: WORLD_H,
      sling: { x: SLING.x, y: SLING.y },
      pieces: towers.map((b) => ({
        id: b.id,
        x: b.x,
        y: b.y,
        w: b.w,
        h: b.h,
        hp: b.hp,
        kind: b.kind,
        pts: b.pts,
        emoji: b.emoji || '',
      })),
    });
  }

  function restoreFromSnapshot(json) {
    let o;
    try {
      o = JSON.parse(json);
    } catch (e) {
      return false;
    }
    if (!o || o.v !== 1 || !Array.isArray(o.pieces)) {
      return false;
    }
    customMeta = { name: o.name || 'My level', ricochet: !!o.ricochet };
    const tw = o.pieces.map((p) =>
      tower(p.id, p.x, p.y, p.w, p.h, p.hp, p.kind, p.pts || 0, p.emoji || ''),
    );
    builderNextId = tw.reduce((m, b) => Math.max(m, b.id | 0), 19999) + 1;
    useCustomLevel = true;
    applyCustomWorld(o.worldW | 0, o.worldH | 0, o.sling || { x: 140, y: 300 }, tw);
    syncBuilderForm();
    return true;
  }

  function placeStampAt(wx, wy) {
    const x = snapBuild(wx);
    const y = snapBuild(wy);
    if (buildTool === 'erase') {
      const hit = hitTowerAt(wx, wy);
      if (hit) {
        towers = towers.filter((t) => t.id !== hit.id);
      }
      return;
    }
    if (buildTool === 'move' || buildTool === 'sling') {
      return;
    }
    let piece = null;
    if (buildTool === 'wood') {
      piece = tower(allocBuilderId(), x, y, 48, 52, 2, 'wood', 80, '');
    } else if (buildTool === 'stone') {
      piece = tower(allocBuilderId(), x, y, 44, 44, 4, 'stone', 140, '');
    } else if (buildTool === 'lava') {
      piece = lavaBar(allocBuilderId(), x, y, 120, 12);
    } else if (buildTool === 'villain') {
      piece = tower(allocBuilderId(), x, y, 48, 48, 1, 'villain', 400, buildVillainEmoji);
    }
    if (
      piece &&
      piece.y >= 10 &&
      piece.x >= 6 &&
      piece.x + piece.w <= WORLD_W - 6 &&
      piece.y + piece.h <= WORLD_H - 8
    ) {
      towers.push(piece);
    }
  }

  function enterLevelBuilder(fromCampaign, fromPicker) {
    document.body.classList.remove('lobber-playtest');
    hidePlaytestHud();
    builderReturnToPicker = !!fromPicker && !localLocked;
    useCustomLevel = true;
    editorMode = 'edit';
    builderTestSnapshot = null;
    pickOverlay.classList.add('hidden');
    canvas.classList.remove('lobber-wait');
    if (!builderReturnToPicker) {
      localLocked = true;
    }
    if (!localEmoji) {
      localEmoji = '🙂';
    }
    dragging = false;
    projectile = null;
    canvas.classList.add('lobber-canvas-build');
    if (fromCampaign) {
      const L = LEVELS[selectedLevelIndex] || LEVELS[0];
      const base = levelGroundY(L);
      const tw = cloneTowers(L.towers(base));
      customMeta = {
        name: 'Edit · ' + L.name,
        ricochet: L.wallBouncesToHurtVillain ? 1 : 0,
      };
      applyCustomWorld(L.worldW, L.worldH, levelSling(L), tw);
    } else {
      const w = 1280;
      const h = 560;
      const gy = Math.floor(h * (458 / REF_WORLD_H));
      customMeta = { name: 'My level', ricochet: 0 };
      applyCustomWorld(w, h, { x: Math.round(w * 0.14), y: gy - 86 }, []);
    }
    showBuilderPanel();
    setTurnLine();
    refreshGameInfo();
    syncBuilderForm();
  }

  function exitLevelBuilder() {
    document.body.classList.remove('lobber-playtest');
    hidePlaytestHud();
    hideBuilderPanel();
    buildDragPiece = null;
    buildDragSling = false;
    buildCarryKind = null;
    canvas.classList.remove('lobber-canvas-build');
    loadLevel(selectedLevelIndex);
    if (builderReturnToPicker) {
      localLocked = false;
      phase = 'pick';
      pickOverlay.classList.remove('hidden');
      canvas.classList.add('lobber-wait');
    } else if (localLocked) {
      phase = 'aim';
    }
    builderReturnToPicker = false;
    setTurnLine();
  }

  function playTestCustom() {
    if (!useCustomLevel || editorMode !== 'edit') {
      return;
    }
    builderTestSnapshot = snapshotCustomLevel();
    resetCourseHp();
    score = 0;
    debris = [];
    setScoreText();
    editorMode = 'test';
    phase = 'aim';
    dragging = false;
    projectile = null;
    document.body.classList.add('lobber-playtest');
    document.body.classList.remove('lobber-builder-active');
    hideBuilderPanel();
    showPlaytestHud();
    setTurnLine();
    refreshGameInfo();
    syncPlayStopButtons();
  }

  function stopTestCustom() {
    if (editorMode !== 'test' || !builderTestSnapshot) {
      return;
    }
    const snap = builderTestSnapshot;
    builderTestSnapshot = null;
    editorMode = 'edit';
    restoreFromSnapshot(snap);
    phase = 'build';
    dragging = false;
    projectile = null;
    document.body.classList.remove('lobber-playtest');
    hidePlaytestHud();
    document.body.classList.add('lobber-builder-active');
    showBuilderPanel();
    setTurnLine();
    refreshGameInfo();
    syncPlayStopButtons();
  }

  function exportCustomJson() {
    const blob = new Blob([snapshotCustomLevel()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (customMeta.name || 'lobber-level').replace(/\s+/g, '-') + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function importCustomJson(text) {
    return restoreFromSnapshot(text);
  }

  function syncBuilderForm() {
    const nm = document.getElementById('lobberBuilderName');
    const rc = document.getElementById('lobberBuilderRicochet');
    const ve = document.getElementById('lobberBuilderVillainEmoji');
    const wp = document.getElementById('lobberBuilderWorldPreset');
    if (nm) {
      nm.value = customMeta.name || '';
    }
    if (rc) {
      rc.checked = !!customMeta.ricochet;
    }
    if (ve) {
      ve.value = buildVillainEmoji;
    }
    if (wp) {
      const key = `${WORLD_W}x${WORLD_H}`;
      const opt = wp.querySelector(`option[value="${key}"]`);
      if (opt) {
        wp.value = key;
      } else {
        wp.value = '1280x560';
      }
    }
    syncPlayStopButtons();
    syncBuildToolButtons();
  }

  function syncPlayStopButtons() {
    const playB = document.getElementById('lobberBuilderPlay');
    const stopB = document.getElementById('lobberBuilderStop');
    if (playB) {
      playB.disabled = editorMode !== 'edit';
    }
    if (stopB) {
      stopB.disabled = editorMode !== 'test';
    }
  }

  function syncBuildToolButtons() {
    const panel = document.getElementById('lobberBuilderPanel');
    if (!panel) {
      return;
    }
    panel.querySelectorAll('button[data-build-tool]').forEach((btn) => {
      const t = btn.getAttribute('data-build-tool');
      btn.classList.toggle('build-tool-on', t === buildTool);
    });
  }

  function builderPointerDown(wx, wy) {
    if (editorMode !== 'edit') {
      return;
    }
    if (buildTool === 'sling') {
      if (Math.hypot(wx - SLING.x, wy - SLING.y) < Math.max(56, projectileRadiusWorld() * 3.2)) {
        buildDragSling = true;
      }
      return;
    }
    if (buildTool === 'move') {
      const hit = hitTowerAt(wx, wy);
      if (hit) {
        buildDragPiece = { id: hit.id, ox: wx - hit.x, oy: wy - hit.y };
      }
      return;
    }
    if (buildTool === 'erase') {
      placeStampAt(wx, wy);
      return;
    }
    placeStampAt(wx, wy);
  }

  function builderPointerMove(wx, wy) {
    if (editorMode !== 'edit') {
      return;
    }
    if (buildDragSling) {
      SLING = clampSling({ x: wx, y: wy });
      dragCur = { x: SLING.x, y: SLING.y };
      return;
    }
    if (buildDragPiece) {
      const b = towers.find((t) => t.id === buildDragPiece.id);
      if (b) {
        let nx = snapBuild(wx - buildDragPiece.ox);
        let ny = snapBuild(wy - buildDragPiece.oy);
        nx = Math.max(4, Math.min(WORLD_W - b.w - 4, nx));
        ny = Math.max(4, Math.min(GROUND_Y - b.h - 2, ny));
        b.x = nx;
        b.y = ny;
      }
    }
  }

  function builderPointerUp() {
    buildDragPiece = null;
    buildDragSling = false;
  }

  function applyWorldPreset(key) {
    if (editorMode !== 'edit') {
      return;
    }
    const map = {
      '960x540': [960, 540],
      '1280x560': [1280, 560],
      '1580x570': [1580, 570],
      '1800x600': [1800, 600],
    };
    const dims = map[key] || [1280, 560];
    const gy = Math.floor(dims[1] * (458 / REF_WORLD_H));
    const sling = { x: Math.round(dims[0] * 0.14), y: gy - 86 };
    applyCustomWorld(dims[0], dims[1], sling, cloneTowers(towers));
    refreshGameInfo();
  }

  function reloadBuilderBlank() {
    if (editorMode !== 'edit') {
      return;
    }
    const w = 1280;
    const h = 560;
    const gy = Math.floor(h * (458 / REF_WORLD_H));
    customMeta = { name: 'My level', ricochet: 0 };
    applyCustomWorld(w, h, { x: Math.round(w * 0.14), y: gy - 86 }, []);
    syncBuilderForm();
  }

  function reloadBuilderFromSelectedStage() {
    if (editorMode !== 'edit') {
      return;
    }
    const L = LEVELS[selectedLevelIndex] || LEVELS[0];
    const base = levelGroundY(L);
    const tw = cloneTowers(L.towers(base));
    customMeta = {
      name: 'Edit · ' + L.name,
      ricochet: L.wallBouncesToHurtVillain ? 1 : 0,
    };
    applyCustomWorld(L.worldW, L.worldH, levelSling(L), tw);
    syncBuilderForm();
  }

  function initLevelBuilderUi() {
    if (document.getElementById('lobberBuilderPanel')) {
      return;
    }
    const host = document.body;
    const panel = document.createElement('div');
    panel.id = 'lobberBuilderPanel';
    panel.className = 'lobber-builder-panel hidden';
    panel.setAttribute('aria-hidden', 'true');
    panel.innerHTML = [
      '<div class="lobber-builder-inner">',
      '<div class="lobber-builder-row lobber-builder-title">Level builder</div>',
      '<div class="lobber-builder-row">',
      '<label class="lobber-builder-label">Name <input type="text" id="lobberBuilderName" maxlength="48" /></label>',
      '<label class="lobber-builder-check"><input type="checkbox" id="lobberBuilderRicochet" /> Ricochet rule</label>',
      '<label class="lobber-builder-label">Villain <select id="lobberBuilderVillainEmoji">',
      ['🐷', '👹', '🦇', '🐗', '👿', '🐉', '🦎'].map((e) => `<option value="${e}">${e}</option>`).join(''),
      '</select></label>',
      '</div>',
      '<div class="lobber-builder-row">',
      '<span class="lobber-builder-label">World</span>',
      '<select id="lobberBuilderWorldPreset">',
      '<option value="960x540">960×540</option>',
      '<option value="1280x560" selected>1280×560</option>',
      '<option value="1580x570">1580×570</option>',
      '<option value="1800x600">1800×600</option>',
      '</select>',
      '<label class="lobber-builder-check"><input type="checkbox" id="lobberBuilderSnap" checked /> Snap grid</label>',
      '</div>',
      '<div class="lobber-builder-tools">',
      '<span class="lobber-builder-hint">Tools — click canvas to stamp / select:</span>',
      '<button type="button" class="lobber-tool" data-build-tool="wood">Wood</button>',
      '<button type="button" class="lobber-tool" data-build-tool="stone">Stone</button>',
      '<button type="button" class="lobber-tool" data-build-tool="lava">Lava</button>',
      '<button type="button" class="lobber-tool" data-build-tool="villain">Villain</button>',
      '<button type="button" class="lobber-tool" data-build-tool="move">Move</button>',
      '<button type="button" class="lobber-tool" data-build-tool="sling">Slingshot</button>',
      '<button type="button" class="lobber-tool" data-build-tool="erase">Erase</button>',
      '</div>',
      '<div class="lobber-builder-row lobber-builder-actions">',
      '<button type="button" id="lobberBuilderBlank">New blank</button>',
      '<button type="button" id="lobberBuilderCloneStage">Copy selected stage</button>',
      '<button type="button" id="lobberBuilderPlay">Play test</button>',
      '<button type="button" id="lobberBuilderStop" disabled>Stop test</button>',
      '<button type="button" id="lobberBuilderExport">Save JSON</button>',
      '<label class="lobber-builder-file">Load <input type="file" id="lobberBuilderFile" accept=".json,application/json" style="display:none" /></label>',
      '<button type="button" id="lobberBuilderExit">Exit builder</button>',
      '</div>',
      '</div>',
    ].join('');
    host.appendChild(panel);

    panel.querySelectorAll('button[data-build-tool]').forEach((btn) => {
      btn.addEventListener('click', () => {
        buildTool = btn.getAttribute('data-build-tool') || 'wood';
        syncBuildToolButtons();
      });
    });
    document.getElementById('lobberBuilderBlank').addEventListener('click', reloadBuilderBlank);
    document.getElementById('lobberBuilderCloneStage').addEventListener('click', reloadBuilderFromSelectedStage);
    document.getElementById('lobberBuilderPlay').addEventListener('click', playTestCustom);
    document.getElementById('lobberBuilderStop').addEventListener('click', stopTestCustom);
    document.getElementById('lobberBuilderExport').addEventListener('click', exportCustomJson);
    document.getElementById('lobberBuilderExit').addEventListener('click', exitLevelBuilder);
    document.getElementById('lobberBuilderName').addEventListener('input', (e) => {
      customMeta.name = e.target.value || 'My level';
      refreshGameInfo();
    });
    document.getElementById('lobberBuilderRicochet').addEventListener('change', (e) => {
      customMeta.ricochet = e.target.checked ? 1 : 0;
      refreshGameInfo();
    });
    document.getElementById('lobberBuilderVillainEmoji').addEventListener('change', (e) => {
      buildVillainEmoji = e.target.value || '🐷';
    });
    document.getElementById('lobberBuilderWorldPreset').addEventListener('change', (e) => {
      applyWorldPreset(e.target.value);
    });
    document.getElementById('lobberBuilderSnap').addEventListener('change', (e) => {
      buildGridSnap = e.target.checked;
    });
    document.getElementById('lobberBuilderFile').addEventListener('change', (ev) => {
      const f = ev.target.files && ev.target.files[0];
      if (!f) {
        return;
      }
      const r = new FileReader();
      r.onload = () => {
        if (importCustomJson(String(r.result || ''))) {
          document.body.classList.remove('lobber-playtest');
          hidePlaytestHud();
          editorMode = 'edit';
          phase = 'build';
          showBuilderPanel();
          refreshGameInfo();
          syncBuilderForm();
        }
      };
      r.readAsText(f);
      ev.target.value = '';
    });
  }

  function applyCampaignLevelIndex(levelIndex) {
    const idx = Math.max(0, Math.min(LEVELS.length - 1, levelIndex | 0));
    const L = LEVELS[idx];
    currentLevelIndex = idx;
    WORLD_W = L.worldW;
    WORLD_H = L.worldH;
    GROUND_Y = levelGroundY(L);
    SLING = levelSling(L);
    towers = cloneTowers(towersForLevel(idx));
    dragCur = { x: SLING.x, y: SLING.y };
    dlog('loadLevel', L.name, { worldW: WORLD_W, worldH: WORLD_H, GROUND_Y, SLING, blocks: towers.length });
    if (LOBBER_DEBUG) {
      const rad = projectileRadiusWorld();
      dlog('projectileFit', {
        level: L.name,
        worldZoomOutMul: Math.round(worldZoomOutMul() * 1000) / 1000,
        hitRadius: Math.round(rad * 1000) / 1000,
        hitDiameter: Math.round(2 * rad * 1000) / 1000,
        fontNominalPx: projectileEmojiFontPx(),
      });
    }
    refreshGameInfo();
  }

  function loadLevel(levelIndex) {
    useCustomLevel = false;
    editorMode = null;
    hideBuilderPanel();
    applyCampaignLevelIndex(levelIndex);
  }

  function refreshGameInfo() {
    const el = document.getElementById('gameInfo');
    if (!el) {
      return;
    }
    const L = levelDef();
    const tier = L.tier ? `<span style="opacity:0.85">${L.tier}</span> · ` : '';
    const wb = wallBouncesRequired();
    const ric =
      wb > 0
        ? ` <span style="opacity:0.78">· Ricochet: bank off wood/stone (${wb}+) before villains take damage.</span>`
        : '';
    const edit =
      editorMode === 'edit'
        ? ` <span style="opacity:0.85">· <strong>Level builder</strong> — place parts, move slingshot, then Play test.</span>`
        : editorMode === 'test'
          ? ` <span style="opacity:0.85">· <strong>Play test</strong> — Stop test to keep editing.</span>`
          : '';
    el.innerHTML = `${tier}<span class="highlight">${L.name}</span> <span style="opacity:0.75">(${WORLD_W}×${WORLD_H})</span>${ric}${edit}`;
  }

  let currentLevelIndex = 0;

  let towers = [];
  let debris = [];
  let score = 0;
  let turn = 'Man';
  let phase = 'pick';
  let shotSeq = 0;

  let localEmoji = null;
  let localLocked = false;

  let projectile = null;
  let shooterThisRound = null;
  let dragging = false;
  let dragCur = { x: SLING.x, y: SLING.y };

  initLevelBuilderUi();
  loadLevel(0);

  const LOBBER_MUTE_KEY = 'lobber_audio_muted';

  function audioMuted() {
    try {
      return window.localStorage.getItem(LOBBER_MUTE_KEY) === '1';
    } catch (e) {
      return false;
    }
  }

  function setAudioMuted(muted) {
    try {
      window.localStorage.setItem(LOBBER_MUTE_KEY, muted ? '1' : '0');
    } catch (e) {
      /* ignore */
    }
    syncMuteToggle();
  }

  let audioCtx = null;
  function beep(f, t) {
    if (audioMuted()) {
      return;
    }
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        return;
      }
    }
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = f;
    o.type = 'square';
    g.gain.value = 0.035;
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + t);
  }

  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const turnLine = document.getElementById('turnLine');
  const scoreEl = document.getElementById('score');
  const pickOverlay = document.getElementById('emojiPicker');
  const pickStatus = document.getElementById('pickStatus');
  const lockBtn = document.getElementById('lockEmoji');
  const emojiGrid = document.getElementById('emojiGrid');
  const powerBlurb = document.getElementById('powerBlurb');
  const levelSelectLabelEl = document.getElementById('levelSelectLabel');

  const muteBtn = document.createElement('button');
  muteBtn.type = 'button';
  muteBtn.id = 'lobberMuteBtn';
  muteBtn.setAttribute('aria-label', 'Toggle sound');
  muteBtn.style.cssText =
    'margin-top:10px;font-family:Orbitron,sans-serif;font-size:0.55rem;letter-spacing:0.1em;padding:8px 14px;border-radius:8px;border:1px solid rgba(122,240,255,0.35);background:rgba(18,26,40,0.95);color:#c8d8f0;cursor:pointer;';
  function syncMuteToggle() {
    muteBtn.textContent = audioMuted() ? 'Sound: off' : 'Sound: on';
  }
  syncMuteToggle();
  muteBtn.addEventListener('click', () => setAudioMuted(!audioMuted()));
  const uiHost = document.getElementById('ui');
  if (uiHost) {
    uiHost.appendChild(muteBtn);
  }

  function resumeAudioIfNeeded() {
    if (!audioCtx || audioMuted()) {
      return;
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(function () {});
    }
  }

  function syncCanvasSize() {
    const wrap = document.getElementById('boardWrap');
    const maxW = Math.max(240, (wrap && wrap.clientWidth) || CANVAS_W);
    const maxH = Math.max(200, (wrap && wrap.clientHeight) || CANVAS_H);
    const s = Math.min(maxW / CANVAS_W, maxH / CANVAS_H, 1);
    canvas.style.width = `${Math.floor(CANVAS_W * s)}px`;
    canvas.style.height = `${Math.floor(CANVAS_H * s)}px`;
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
  }
  syncCanvasSize();
  window.addEventListener('resize', syncCanvasSize);
  const roEl = document.getElementById('boardWrap');
  if (roEl && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(syncCanvasSize).observe(roEl);
  }

  function canvasToWorld(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    const sx = canvas.width / r.width;
    const sy = canvas.height / r.height;
    const cx = (clientX - r.left) * sx;
    const cy = (clientY - r.top) * sy;
    return {
      x: (cx / CANVAS_W) * WORLD_W,
      y: (cy / CANVAS_H) * WORLD_H,
    };
  }

  function setScoreText() {
    scoreEl.textContent = `${score} pts`;
  }

  function activeTurn() {
    return PLAYER_ID;
  }

  function setTurnLine() {
    if (phase === 'pick') {
      turnLine.textContent = '';
      return;
    }
    if (phase === 'build') {
      turnLine.textContent =
        'Builder: choose a tool below — click to stamp · Move / Slingshot to drag pieces or launcher — Play test when ready';
      return;
    }
    if (phase === 'flight') {
      turnLine.textContent = 'Shot in flight…';
      return;
    }
    if (editorMode === 'test') {
      turnLine.textContent = 'Play test — pull back & release · use the stage strip below to swap layouts';
      return;
    }
    turnLine.textContent = 'Pull back & release — drag from the slingshot pocket';
  }

  function updatePickStatus() {
    if (!pickStatus) {
      return;
    }
    if (localLocked) {
      pickStatus.textContent = 'Starting…';
    } else {
      pickStatus.textContent = 'Choose a human-face hero (each has a power), then Lock in.';
    }
  }

  let selectedLevelIndex = 0;
  const levelButtonsEl = document.getElementById('levelButtons');

  function refreshLevelAuthorityUI() {
    if (levelSelectLabelEl) {
      levelSelectLabelEl.innerHTML =
        '<strong>Level</strong> — pick one of ' + LEVELS.length + ' stages (wider = more zoomed out).';
    }
    if (!levelButtonsEl) {
      return;
    }
    levelButtonsEl.querySelectorAll('button[data-level]').forEach((btn) => {
      btn.disabled = false;
      btn.setAttribute('aria-disabled', 'false');
    });
    levelButtonsEl.classList.remove('level-buttons-mirrored');
  }

  function syncLevelButtonHighlight() {
    if (!levelButtonsEl) {
      return;
    }
    levelButtonsEl.querySelectorAll('button[data-level]').forEach((btn) => {
      const n = parseInt(btn.getAttribute('data-level'), 10);
      btn.classList.toggle('selected', n === selectedLevelIndex);
    });
  }

  if (levelButtonsEl) {
    LEVELS.forEach((L, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('data-level', String(i));
      b.textContent = L.name;
      b.title = `${L.tier ? L.tier + ' · ' : ''}${L.name} — ${L.worldW}×${L.worldH}`;
      b.addEventListener('click', () => {
        if (localLocked || editorMode) {
          return;
        }
        selectedLevelIndex = i;
        loadLevel(i);
        syncLevelButtonHighlight();
        dlog('level selected', { i, name: L.name });
      });
      levelButtonsEl.appendChild(b);
    });
    syncLevelButtonHighlight();
    refreshLevelAuthorityUI();
  }

  initPlaytestHud();

  HERO_ROSTER.forEach((h) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = h.emoji;
    b.title = `${h.name}: ${h.desc}`;
    b.dataset.emoji = h.emoji;
    b.addEventListener('pointerenter', () => {
      if (localLocked || !powerBlurb) {
        return;
      }
      powerBlurb.textContent = `${h.name} — ${h.desc}`;
    });
    b.addEventListener('click', () => {
      if (localLocked) {
        return;
      }
      localEmoji = h.emoji;
      emojiGrid.querySelectorAll('button').forEach((x) => x.classList.remove('selected'));
      b.classList.add('selected');
      lockBtn.disabled = false;
      if (powerBlurb) {
        powerBlurb.textContent = `${h.name} — ${h.desc}`;
      }
    });
    emojiGrid.appendChild(b);
  });
  lockBtn.disabled = true;
  lockBtn.addEventListener('click', () => {
    if (!localEmoji || localLocked) {
      return;
    }
    resumeAudioIfNeeded();
    localLocked = true;
    lockBtn.disabled = true;
    updatePickStatus();
    tryBeginMatch();
  });

  function tryBeginMatch() {
    if (localLocked && phase === 'pick') {
      phase = 'aim';
      pickOverlay.classList.add('hidden');
      canvas.classList.remove('lobber-wait');
      loadLevel(selectedLevelIndex);
      debris = [];
      syncLevelButtonHighlight();
      turn = PLAYER_ID;
      setTurnLine();
      setScoreText();
      dlog('match start', {
        level: currentLevelIndex,
        name: LEVELS[currentLevelIndex].name,
        world: `${WORLD_W}×${WORLD_H}`,
      });
    }
  }

  function fireShot(vx, vy, emoji) {
    shotSeq += 1;
    dlog('shot', {
      seq: shotSeq,
      emoji,
      vx: Math.round(vx * 100) / 100,
      vy: Math.round(vy * 100) / 100,
      hitRadius: Math.round(projectileRadiusWorld() * 1000) / 1000,
      level: levelDef().name,
    });
    startFlight(vx, vy, emoji, PLAYER_ID);
  }

  function startFlight(vx, vy, emoji, shooter) {
    phase = 'flight';
    shooterThisRound = shooter;
    const p = powerForEmoji(emoji);
    projectile = {
      x: SLING.x,
      y: SLING.y,
      vx,
      vy,
      emoji,
      rot: 0,
      spin: SPIN_BASE * (p.spinMul || 1),
      power: p,
      structureBounces: 0,
    };
    setTurnLine();
  }

  function completeShotAndAdvanceTurn() {
    if (phase !== 'flight') {
      return;
    }
    turn = PLAYER_ID;
    projectile = null;
    phase = 'aim';
    shooterThisRound = null;
    setTurnLine();
  }

  function spawnDebris(cx, cy, emoji) {
    for (let i = 0; i < 5; i++) {
      debris.push({
        x: cx,
        y: cy,
        vx: (Math.random() - 0.5) * 6,
        vy: -4 - Math.random() * 5,
        rot: Math.random() * 6,
        spin: (Math.random() - 0.5) * 14,
        emoji: emoji || '💥',
        ttl: 0.9 + Math.random() * 0.5,
      });
    }
  }

  function circleRectHit(px, py, r, b) {
    if (b.hp <= 0) {
      return false;
    }
    const nx = Math.max(b.x, Math.min(px, b.x + b.w));
    const ny = Math.max(b.y, Math.min(py, b.y + b.h));
    const dx = px - nx;
    const dy = py - ny;
    return dx * dx + dy * dy < r * r;
  }

  function neighborSplashHit(broken, pwr, proj) {
    if (!pwr.splash) {
      return;
    }
    const need = wallBouncesRequired();
    for (const b of towers) {
      if (b.hp <= 0 || b.id === broken.id || b.kind === 'lava') {
        continue;
      }
      if (b.kind === 'villain' && need > 0 && proj && (proj.structureBounces || 0) < need) {
        continue;
      }
      const dist = Math.hypot(b.x + b.w / 2 - (broken.x + broken.w / 2), b.y + b.h / 2 - (broken.y + broken.h / 2));
      if (dist < splashRadiusWorld()) {
        b.hp -= 1;
        if (b.hp <= 0) {
          addScoreForBreak(b);
          spawnDebris(b.x + b.w / 2, b.y + b.h / 2, b.emoji || '💥');
        }
        beep(280, 0.04);
      }
    }
  }

  function addScoreForBreak(b) {
    let pts = b.pts;
    const pr = projectile && projectile.power;
    if (b.kind === 'villain' && pr && pr.villainBonus) {
      pts += pr.villainBonus;
    }
    if (b.kind === 'villain' && pr && pr.villainPtsMul) {
      pts = Math.floor(pts * pr.villainPtsMul);
    }
    score += pts + 25;
    setScoreText();
  }

  function resolveHits(p) {
    const pr = p.power || defaultPower();
    for (const b of towers) {
      if (b.hp <= 0) {
        continue;
      }
      if (!circleRectHit(p.x, p.y, projectileRadiusWorld(), b)) {
        continue;
      }
      if (b.kind === 'lava') {
        spawnDebris(p.x, p.y, '🔥');
        spawnDebris(p.x, p.y, '💀');
        beep(90, 0.22);
        completeShotAndAdvanceTurn();
        return;
      }
      const nx = Math.max(b.x, Math.min(p.x, b.x + b.w));
      const ny = Math.max(b.y, Math.min(p.y, b.y + b.h));
      let dx = p.x - nx;
      let dy = p.y - ny;
      const d = Math.hypot(dx, dy) || 0.001;
      const er = projectileRadiusWorld();
      const pen = er - d;
      p.x += (dx / d) * pen * 0.55;
      p.y += (dy / d) * pen * 0.55;
      dx /= d;
      dy /= d;
      const vn = p.vx * dx + p.vy * dy;
      const bm = (pr.bounceMul || 1) * BOUNCE_DAMP;
      if (vn < -0.28 && (b.kind === 'wood' || b.kind === 'stone')) {
        p.structureBounces = (p.structureBounces || 0) + 1;
      }
      if (vn < 0) {
        p.vx -= 2 * vn * dx * bm;
        p.vy -= 2 * vn * dy * bm;
      }
      const needRic = wallBouncesRequired();
      const villainArmored = b.kind === 'villain' && needRic > 0 && (p.structureBounces || 0) < needRic;
      if (villainArmored) {
        beep(130, 0.04);
        continue;
      }
      let dmg = pr.dmg || 1;
      if (b.kind === 'wood') {
        dmg = pr.woodDmg || dmg;
      }
      if (b.kind === 'stone') {
        dmg = pr.stoneDmg || dmg;
      }
      b.hp -= dmg;
      if (b.hp <= 0) {
        addScoreForBreak(b);
        spawnDebris(b.x + b.w / 2, b.y + b.h / 2, b.emoji || '👹');
        neighborSplashHit(b, pr, p);
        beep(b.kind === 'villain' ? 540 : 320, 0.07);
      } else {
        beep(210, 0.03);
      }
      setScoreText();
    }
  }

  function tickDebris(dt) {
    for (let i = debris.length - 1; i >= 0; i--) {
      const d = debris[i];
      d.ttl -= dt;
      d.vy += GRAVITY * dt * 55;
      d.x += d.vx * dt * 60;
      d.y += d.vy * dt * 60;
      d.rot += d.spin * dt;
      if (d.ttl <= 0 || d.y > WORLD_H + 60) {
        debris.splice(i, 1);
      }
    }
  }

  function tickFlight(dt) {
    if (!projectile || phase !== 'flight') {
      return;
    }
    const p = projectile;
    p.vy += GRAVITY * dt * 60;
    p.x += p.vx * dt * 60;
    p.y += p.vy * dt * 60;
    p.rot += (p.spin || SPIN_BASE) * dt;

    const er = projectileRadiusWorld();
    if (p.y + er >= GROUND_Y) {
      p.y = GROUND_Y - er;
      p.vy *= -0.36;
      p.vx *= REST_FRICTION;
      if (Math.abs(p.vy) < 0.95) {
        p.vy = 0;
      }
    }

    resolveHits(p);

    if (!projectile) {
      return;
    }

    const spd = Math.hypot(p.vx, p.vy);
    const grounded = p.y + er >= GROUND_Y - 0.5;
    const oob = p.x > WORLD_W + 140 || p.x < -140;
    const settled = grounded && spd < 2.05;
    if (oob || settled) {
      completeShotAndAdvanceTurn();
    }
  }

  function drawSkyGround() {
    const g = ctx.createLinearGradient(0, 0, 0, WORLD_H);
    g.addColorStop(0, '#5eb8ff');
    g.addColorStop(0.5, '#87ceeb');
    g.addColorStop(1, '#6abe7a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    ctx.fillStyle = '#3d6848';
    ctx.fillRect(0, GROUND_Y, WORLD_W, WORLD_H - GROUND_Y);
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = Math.max(2, (3 * WORLD_W) / REF_WORLD_W);
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y);
    ctx.lineTo(WORLD_W, GROUND_Y);
    ctx.stroke();
  }

  function drawTowers() {
    for (const b of towers) {
      if (b.hp <= 0) {
        continue;
      }
      if (b.kind === 'villain') {
        ctx.fillStyle = 'rgba(60, 40, 50, 0.35)';
        ctx.fillRect(b.x - 2, b.y - 2, b.w + 4, b.h + 4);
      } else if (b.kind === 'lava') {
        const lg = ctx.createLinearGradient(b.x, b.y, b.x, b.y + b.h);
        lg.addColorStop(0, '#ff9a3c');
        lg.addColorStop(0.45, '#ff3c1a');
        lg.addColorStop(1, '#6a0a0a');
        ctx.fillStyle = lg;
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.strokeStyle = 'rgba(255, 220, 120, 0.75)';
        ctx.lineWidth = Math.max(2, (2.5 * WORLD_W) / REF_WORLD_W);
        ctx.strokeRect(b.x, b.y, b.w, b.h);
        continue;
      } else if (b.kind === 'stone') {
        ctx.fillStyle = '#7a8a9a';
      } else {
        ctx.fillStyle = '#b8956a';
      }
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = Math.max(2, (2.5 * WORLD_W) / REF_WORLD_W);
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      if (b.kind === 'villain' && b.emoji) {
        ctx.font = `${Math.min(b.w, b.h) * 0.62}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(b.emoji, b.x + b.w / 2, b.y + b.h / 2 + 2);
      }
    }
  }

  function drawDebris() {
    for (const d of debris) {
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.rotate(d.rot);
      ctx.font = `${debrisEmojiFontPx()}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(d.emoji, 0, 0);
      ctx.restore();
    }
  }

  function drawSlingshotBand(ax, ay, bx, by) {
    ctx.strokeStyle = 'rgba(35, 28, 22, 0.88)';
    ctx.lineWidth = Math.max(5, 7 * slingScale());
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }

  function drawSlingshotPost() {
    const k = slingScale();
    ctx.strokeStyle = '#3a3028';
    ctx.lineWidth = Math.max(6, 9 * k);
    ctx.beginPath();
    ctx.moveTo(SLING.x - 20 * k, SLING.y + 42 * k);
    ctx.lineTo(SLING.x - 8 * k, SLING.y - 28 * k);
    ctx.moveTo(SLING.x + 20 * k, SLING.y + 42 * k);
    ctx.lineTo(SLING.x + 8 * k, SLING.y - 28 * k);
    ctx.stroke();
  }

  function drawProjectileAt(x, y, rot, emoji) {
    const r = projectileRadiusWorld();
    const maxSpan = r * 1.88;
    const fontPx = projectileEmojiFontPx();
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.font = `${fontPx}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const m = ctx.measureText(emoji);
    const gw = m.width || fontPx * 0.92;
    let gh = fontPx;
    if (m.actualBoundingBoxAscent != null || m.actualBoundingBoxDescent != null) {
      gh = (m.actualBoundingBoxAscent || 0) + (m.actualBoundingBoxDescent || 0);
    }
    const span = Math.max(gw, gh, 1);
    const sc = Math.min(1, maxSpan / span);
    if (LOBBER_DEBUG && projectile && !projectile._loggedDrawClamp) {
      projectile._loggedDrawClamp = true;
      dlog('emojiDrawClamp (once per shot)', {
        emoji,
        fontPx,
        measuredSpan: Math.round(span * 10) / 10,
        maxSpan: Math.round(maxSpan * 10) / 10,
        scale: Math.round(sc * 1000) / 1000,
      });
    }
    ctx.scale(sc, sc);
    ctx.font = `${fontPx}px serif`;
    ctx.fillText(emoji, 0, 0);
    ctx.restore();
  }

  function drawBuildGrid() {
    const step = BUILD_GRID * 8;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = Math.max(1, (WORLD_W / REF_WORLD_W) * 0.9);
    for (let x = 0; x <= WORLD_W; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, WORLD_H);
      ctx.stroke();
    }
    for (let y = 0; y <= WORLD_H; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(WORLD_W, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawAimVector() {
    if (!dragging || phase !== 'aim') {
      return;
    }
    const dx = SLING.x - dragCur.x;
    const dy = SLING.y - dragCur.y;
    const len = Math.hypot(dx, dy);
    if (len < minPullWorld()) {
      return;
    }
    const ux = dx / len;
    const uy = dy / len;
    const step = 55 * slingScale();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.setLineDash([6 * slingScale(), 8 * slingScale()]);
    ctx.lineWidth = Math.max(2, 2 * slingScale());
    ctx.beginPath();
    let x = SLING.x;
    let y = SLING.y;
    ctx.moveTo(x, y);
    for (let i = 0; i < 5; i++) {
      x += ux * step;
      y += uy * step + i * 8 * slingScale();
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawScene() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.save();
    ctx.scale(CANVAS_W / WORLD_W, CANVAS_H / WORLD_H);
    drawSkyGround();
    drawTowers();
    drawDebris();
    if (phase === 'build' && editorMode === 'edit') {
      drawBuildGrid();
    }

    const aimEmoji = localEmoji || '🙂';
    const sk = slingScale();
    const bandL = 16 * sk;
    const bandY = 20 * sk;
    if (phase === 'aim' || phase === 'pick' || phase === 'build') {
      drawSlingshotPost();
      const restX = SLING.x;
      const restY = SLING.y;
      let drawX = restX;
      let drawY = restY;
      if (dragging && activeTurn() === PLAYER_ID && phase === 'aim') {
        drawX = dragCur.x;
        drawY = dragCur.y;
        drawSlingshotBand(SLING.x - bandL, SLING.y - bandY, drawX, drawY);
        drawSlingshotBand(SLING.x + bandL, SLING.y - bandY, drawX, drawY);
        drawAimVector();
      } else {
        drawSlingshotBand(SLING.x - bandL, SLING.y - bandY, restX, restY);
        drawSlingshotBand(SLING.x + bandL, SLING.y - bandY, restX, restY);
      }
      if (phase === 'build') {
        if (editorMode === 'edit' && buildTool === 'sling') {
          ctx.strokeStyle = 'rgba(255, 220, 100, 0.55)';
          ctx.lineWidth = Math.max(3, 4 * sk);
          ctx.beginPath();
          ctx.arc(SLING.x, SLING.y, 36 * sk, 0, Math.PI * 2);
          ctx.stroke();
        }
        drawProjectileAt(restX, restY, 0, aimEmoji);
      } else if (phase === 'aim' && activeTurn() === PLAYER_ID) {
        drawProjectileAt(drawX, drawY, 0, aimEmoji);
      } else if (phase === 'aim') {
        drawProjectileAt(restX, restY, 0, aimEmoji);
      }
    } else if (phase === 'flight' && projectile) {
      drawSlingshotPost();
      drawSlingshotBand(SLING.x - bandL, SLING.y - bandY, SLING.x, SLING.y);
      drawSlingshotBand(SLING.x + bandL, SLING.y - bandY, SLING.x, SLING.y);
      drawProjectileAt(projectile.x, projectile.y, projectile.rot, projectile.emoji);
    } else {
      drawSlingshotPost();
    }
    ctx.restore();
  }

  let lastT = performance.now();
  function frame(now) {
    const dt = Math.min(0.045, (now - lastT) / 1000);
    lastT = now;
    tickFlight(dt);
    tickDebris(dt);
    drawScene();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  function tryStartDrag(wx, wy) {
    resumeAudioIfNeeded();
    if (editorMode === 'edit') {
      return;
    }
    if (phase !== 'aim' || activeTurn() !== PLAYER_ID) {
      return;
    }
    const d = Math.hypot(wx - SLING.x, wy - SLING.y);
    const grabR = Math.max(40, Math.min(78, projectileRadiusWorld() * 2.85));
    if (d < grabR) {
      dragging = true;
      dragCur = { x: wx, y: wy };
    }
  }

  function moveDrag(wx, wy) {
    if (!dragging) {
      return;
    }
    let dx = wx - SLING.x;
    let dy = wy - SLING.y;
    const len = Math.hypot(dx, dy) || 1;
    const mp = maxPullWorld();
    if (len > mp) {
      dx = (dx / len) * mp;
      dy = (dy / len) * mp;
    }
    dragCur = { x: SLING.x + dx, y: SLING.y + dy };
  }

  function endDrag() {
    if (!dragging) {
      return;
    }
    dragging = false;
    const dx = SLING.x - dragCur.x;
    const dy = SLING.y - dragCur.y;
    const len = Math.hypot(dx, dy);
    const mp = maxPullWorld();
    if (len < minPullWorld()) {
      dragCur = { x: SLING.x, y: SLING.y };
      return;
    }
    const emoji = localEmoji || '🙂';
    const pow = powerForEmoji(emoji);
    const pullT = Math.min(1, len / mp);
    const speed = BASE_POWER * (0.55 + 0.65 * pullT) * (pow.vMul || 1) * worldShotScale();
    const vx = dx * speed;
    const vy = dy * speed;
    fireShot(vx, vy, emoji);
    dragCur = { x: SLING.x, y: SLING.y };
  }

  canvas.addEventListener('mousedown', (e) => {
    const p = canvasToWorld(e.clientX, e.clientY);
    if (editorMode === 'edit') {
      resumeAudioIfNeeded();
      builderPointerDown(p.x, p.y);
      return;
    }
    tryStartDrag(p.x, p.y);
  });
  window.addEventListener('mousemove', (e) => {
    const p = canvasToWorld(e.clientX, e.clientY);
    if ((buildDragPiece || buildDragSling) && editorMode === 'edit') {
      builderPointerMove(p.x, p.y);
      return;
    }
    if (!dragging) {
      return;
    }
    moveDrag(p.x, p.y);
  });
  window.addEventListener('mouseup', () => {
    if (buildDragPiece || buildDragSling) {
      builderPointerUp();
    }
    endDrag();
  });

  canvas.addEventListener(
    'touchstart',
    (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      const p = canvasToWorld(t.clientX, t.clientY);
      if (editorMode === 'edit') {
        resumeAudioIfNeeded();
        builderPointerDown(p.x, p.y);
        return;
      }
      tryStartDrag(p.x, p.y);
    },
    { passive: false },
  );
  canvas.addEventListener(
    'touchmove',
    (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      const p = canvasToWorld(t.clientX, t.clientY);
      if ((buildDragPiece || buildDragSling) && editorMode === 'edit') {
        builderPointerMove(p.x, p.y);
        return;
      }
      if (!dragging) {
        return;
      }
      moveDrag(p.x, p.y);
    },
    { passive: false },
  );
  canvas.addEventListener('touchend', (e) => {
    e.preventDefault();
    if (editorMode === 'edit') {
      builderPointerUp();
    }
    endDrag();
  });

  const openPicker = document.getElementById('openLevelBuilderPicker');
  if (openPicker) {
    openPicker.addEventListener('click', () => enterLevelBuilder(false, true));
  }
  const openBlankGame = document.getElementById('openLevelBuilderGameBlank');
  if (openBlankGame) {
    openBlankGame.addEventListener('click', () => {
      if (!localLocked) {
        return;
      }
      enterLevelBuilder(false, false);
    });
  }
  const openForkGame = document.getElementById('openLevelBuilderGameFork');
  if (openForkGame) {
    openForkGame.addEventListener('click', () => {
      if (!localLocked) {
        return;
      }
      enterLevelBuilder(true, false);
    });
  }

  refreshGameInfo();

  canvas.classList.add('lobber-wait');

  setScoreText();
  updatePickStatus();
})();
