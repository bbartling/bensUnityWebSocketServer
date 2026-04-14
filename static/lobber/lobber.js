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

  let CANVAS_W = 900;
  let CANVAS_H = 520;
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
  let buildDragPieceStart = null;
  let buildDragPieceUndoSnap = '';
  let buildDragSling = false;
  let buildDragSlingStart = null;
  let buildDragSlingUndoSnap = '';
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

  function isMetalKind(kind) {
    return kind === 'metal' || kind === 'beam';
  }

  /** Indestructible — touching ends the shot (emoji “dies”). */
  function lavaBar(id, x, y, w, h) {
    return { id, x, y, w, h, hp: 9999, kind: 'lava', pts: 0, emoji: '' };
  }

  /** Hanging vine — indestructible; ball slows and can get “stuck” until the shot ends. */
  function vineHang(id, x, y, w, h) {
    return { id, x, y, w, h, hp: 9999, kind: 'vine', pts: 0, emoji: '' };
  }

  /** Indestructible metal rail — pinball-style bounces (legacy JSON may still say kind "beam"). */
  function metalRail(id, x, y, w, h) {
    return { id, x, y, w, h, hp: 9999, kind: 'metal', pts: 0, emoji: '' };
  }

  /** Rebuild one JSON level piece with the correct constructor (metal/lava/vines stay indestructible). */
  function pieceFromLevelJson(p) {
    const id = p.id | 0;
    const x = p.x | 0;
    const y = p.y | 0;
    const w = Math.max(4, p.w | 0);
    const h = Math.max(4, p.h | 0);
    const kind = p.kind || 'wood';
    if (isMetalKind(kind)) {
      return metalRail(id, x, y, w, h);
    }
    if (kind === 'lava') {
      return lavaBar(id, x, y, w, h);
    }
    if (kind === 'vine') {
      return vineHang(id, x, y, w, h);
    }
    return tower(id, x, y, w, h, p.hp | 0, kind, p.pts | 0, p.emoji || '');
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

  const BUILD_TILE = 24;
  const BUILD_GRID = BUILD_TILE;
  const BUILDER_UNDO_LIMIT = 50;
  let builderUndoStack = [];
  let builderHistorySuspended = false;

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
    if (useCustomLevel) {
      const minY = Math.max(padTop, WORLD_H * 0.8);
      return {
        x: Math.max(padX, Math.min(WORLD_W * 0.25, s.x)),
        y: Math.max(minY, Math.min(GROUND_Y - padBot, s.y)),
      };
    }
    return {
      x: Math.max(padX, Math.min(WORLD_W * 0.42, s.x)),
      y: Math.max(padTop, Math.min(GROUND_Y - padBot, s.y)),
    };
  }

  /** Axis-aligned overlap (world units). */
  function rectsOverlapWorld(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  /**
   * Custom levels: rectangle where the slingshot is allowed to sit (see clampSling).
   * In the editor, no blocks may be placed here (Mario Maker style reserved corner).
   */
  function customLauncherReservedRect() {
    const padX = 36;
    const padTop = 64;
    const padBot = 48;
    const y0 = Math.max(padTop, WORLD_H * 0.8);
    const y1 = GROUND_Y - padBot;
    const x0 = padX;
    const x1 = WORLD_W * 0.25;
    return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
  }

  /** Extra no-build padding around the slingshot anchor (posts + band), even if sling moves in the corner. */
  function slingPocketKeepoutRect() {
    const k = slingScale();
    const mw = 72 * k;
    const mh = 100 * k;
    return {
      x: SLING.x - mw,
      y: SLING.y - mh * 0.62,
      w: mw * 2,
      h: mh * 1.78,
    };
  }

  /** True if a placed rect overlaps the reserved corner and/or the slingshot pocket (edit mode only). */
  function pieceOverlapsLauncherNoBuild(piece) {
    if (!useCustomLevel || editorMode !== 'edit' || !piece) {
      return false;
    }
    const zone = customLauncherReservedRect();
    const pocket = slingPocketKeepoutRect();
    const inZone = zone.w >= 1 && zone.h >= 1 && rectsOverlapWorld(piece, zone);
    const inPocket = pocket.w >= 1 && pocket.h >= 1 && rectsOverlapWorld(piece, pocket);
    return inZone || inPocket;
  }

  function aliveVillainCount() {
    let n = 0;
    for (const b of towers) {
      if (b.hp > 0 && b.kind === 'villain') {
        n += 1;
      }
    }
    return n;
  }

  function slingOverlapsAnyPiece(sx, sy) {
    const r = Math.max(18, projectileRadiusWorld() * 1.2);
    for (const b of towers) {
      if (b.hp <= 0) {
        continue;
      }
      if (circleRectHit(sx, sy, r, b)) {
        return true;
      }
    }
    return false;
  }

  function placeSlingInValidZone(desired) {
    const base = clampSling(desired);
    if (!useCustomLevel || !slingOverlapsAnyPiece(base.x, base.y)) {
      return base;
    }
    const step = BUILD_GRID;
    const yMin = Math.max(64, WORLD_H * 0.8);
    const xMin = 36;
    const xMax = WORLD_W * 0.25;
    const yMax = GROUND_Y - 48;
    let best = null;
    let bestD = 1e18;
    for (let y = yMin; y <= yMax; y += step) {
      for (let x = xMin; x <= xMax; x += step) {
        if (slingOverlapsAnyPiece(x, y)) {
          continue;
        }
        const d = (x - base.x) * (x - base.x) + (y - base.y) * (y - base.y);
        if (d < bestD) {
          bestD = d;
          best = { x, y };
        }
      }
    }
    return best || base;
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
    if (kind === 'vine') {
      return 9999;
    }
    if (isMetalKind(kind)) {
      return 9999;
    }
    return 1;
  }

  function resetCourseHp() {
    for (const b of towers) {
      b.hp = defaultHpForKind(b.kind);
    }
  }

  function syncBuilderNextIdFromTowers() {
    const mx = towers.reduce((m, b) => Math.max(m, b.id | 0), 0);
    builderNextId = Math.max(20000, mx + 1);
  }

  function canCaptureBuilderHistory() {
    return useCustomLevel && editorMode === 'edit' && !builderHistorySuspended;
  }

  function pushBuilderUndo(label) {
    if (!canCaptureBuilderHistory()) {
      return;
    }
    builderUndoStack.push({ label: label || 'edit', snap: snapshotCustomLevel() });
    if (builderUndoStack.length > BUILDER_UNDO_LIMIT) {
      builderUndoStack.shift();
    }
    syncBuilderUndoUi();
  }

  function pushBuilderUndoSnapshot(label, snap) {
    if (!canCaptureBuilderHistory() || !snap) {
      return;
    }
    builderUndoStack.push({ label: label || 'edit', snap });
    if (builderUndoStack.length > BUILDER_UNDO_LIMIT) {
      builderUndoStack.shift();
    }
    syncBuilderUndoUi();
  }

  function syncBuilderUndoUi() {
    const undoBtn = document.getElementById('lobberBuilderUndo');
    if (!undoBtn) {
      return;
    }
    undoBtn.disabled = !(editorMode === 'edit' && builderUndoStack.length > 0);
    undoBtn.title =
      builderUndoStack.length > 0
        ? `Undo ${builderUndoStack[builderUndoStack.length - 1].label || 'edit'}`
        : 'Nothing to undo';
  }

  function undoBuilderAction() {
    if (editorMode !== 'edit' || builderUndoStack.length < 1) {
      return;
    }
    const prev = builderUndoStack.pop();
    if (!prev || !prev.snap) {
      syncBuilderUndoUi();
      return;
    }
    builderHistorySuspended = true;
    const ok = restoreFromSnapshot(prev.snap);
    builderHistorySuspended = false;
    if (ok) {
      phase = 'build';
      dragging = false;
      projectile = null;
      showBuilderPanel();
      document.body.classList.remove('lobber-playtest');
      hidePlaytestHud();
      syncBuilderForm();
      refreshGameInfo();
    }
    syncBuilderUndoUi();
  }

  function applyCustomWorld(w, h, sling, tw) {
    WORLD_W = Math.max(640, Math.min(2200, w | 0));
    WORLD_H = Math.max(480, Math.min(800, h | 0));
    GROUND_Y = Math.floor(WORLD_H * (458 / REF_WORLD_H));
    towers = cloneTowers(tw);
    SLING = placeSlingInValidZone({ x: sling.x, y: sling.y });
    syncBuilderNextIdFromTowers();
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
    const tw = o.pieces.map((p) => pieceFromLevelJson(p));
    useCustomLevel = true;
    applyCustomWorld(o.worldW | 0, o.worldH | 0, o.sling || { x: 140, y: 300 }, tw);
    syncBuilderForm();
    return true;
  }

  /** Same-kind touching pieces merge into one body (custom levels: compiled in play test only). */
  const MORPH_KINDS = ['metal', 'lava', 'vine', 'wood', 'stone', 'villain'];

  /** Max gap (world px) for merge — only true adjacency / tiny snap error, not wide air gaps. */
  const MERGE_GAP_SLOP = 5;

  /** True if rects overlap or are within `gapSlop` world units on an axis (touching / micro-gap only). */
  function rectsMergeChainable(a, b, gapSlop) {
    const s = gapSlop;
    return !(a.x + a.w < b.x - s || b.x + b.w < a.x - s || a.y + a.h < b.y - s || b.y + b.h < a.y - s);
  }

  function mergedMorphPiece(kind, minX, minY, maxX, maxY, hpSum, ptsSum, emoji) {
    const w = Math.max(4, maxX - minX);
    const h = Math.max(4, maxY - minY);
    if (kind === 'metal') {
      return metalRail(allocBuilderId(), minX, minY, w, h);
    }
    if (kind === 'lava') {
      return lavaBar(allocBuilderId(), minX, minY, w, h);
    }
    if (kind === 'vine') {
      return vineHang(allocBuilderId(), minX, minY, w, h);
    }
    if (kind === 'wood') {
      return tower(
        allocBuilderId(),
        minX,
        minY,
        w,
        h,
        Math.max(1, hpSum | 0),
        'wood',
        Math.max(0, ptsSum | 0),
        emoji || '',
      );
    }
    if (kind === 'stone') {
      return tower(
        allocBuilderId(),
        minX,
        minY,
        w,
        h,
        Math.max(1, hpSum | 0),
        'stone',
        Math.max(0, ptsSum | 0),
        emoji || '',
      );
    }
    if (kind === 'villain') {
      return tower(
        allocBuilderId(),
        minX,
        minY,
        w,
        h,
        Math.max(1, hpSum | 0),
        'villain',
        Math.max(0, ptsSum | 0),
        emoji || buildVillainEmoji,
      );
    }
    return null;
  }

  /** Union touching / overlapping same-kind morph pieces into one solid (erase removes whole morph). */
  function mergeOnePass(kind) {
    if (MORPH_KINDS.indexOf(kind) < 0) {
      return false;
    }
    const idxs = [];
    for (let i = 0; i < towers.length; i++) {
      const tk = towers[i].kind;
      const match = kind === 'metal' ? isMetalKind(tk) : tk === kind;
      if (match && towers[i].hp > 0) {
        idxs.push(i);
      }
    }
    if (idxs.length < 2) {
      return false;
    }
    const n = idxs.length;
    const parent = [];
    for (let i = 0; i < n; i++) {
      parent[i] = i;
    }
    function find(u) {
      return parent[u] === u ? u : (parent[u] = find(parent[u]));
    }
    function unite(u, v) {
      const ru = find(u);
      const rv = find(v);
      if (ru !== rv) {
        parent[rv] = ru;
      }
    }
    for (let a = 0; a < n; a++) {
      const ta = towers[idxs[a]];
      for (let b = a + 1; b < n; b++) {
        const tb = towers[idxs[b]];
        if (rectsMergeChainable(ta, tb, MERGE_GAP_SLOP)) {
          unite(a, b);
        }
      }
    }
    const groups = new Map();
    for (let i = 0; i < n; i++) {
      const r = find(i);
      if (!groups.has(r)) {
        groups.set(r, []);
      }
      groups.get(r).push(i);
    }
    const removeIdx = new Set();
    const additions = [];
    for (const [, members] of groups) {
      if (members.length < 2) {
        continue;
      }
      let minX = 1e9;
      let minY = 1e9;
      let maxX = -1e9;
      let maxY = -1e9;
      let hpSum = 0;
      let ptsSum = 0;
      let emoji = '';
      for (const m of members) {
        const t = towers[idxs[m]];
        minX = Math.min(minX, t.x);
        minY = Math.min(minY, t.y);
        maxX = Math.max(maxX, t.x + t.w);
        maxY = Math.max(maxY, t.y + t.h);
        hpSum += t.hp | 0;
        ptsSum += t.pts | 0;
        if (!emoji && t.emoji) {
          emoji = t.emoji;
        }
        removeIdx.add(idxs[m]);
      }
      const nw = mergedMorphPiece(kind, minX, minY, maxX, maxY, hpSum, ptsSum, emoji);
      if (nw) {
        additions.push(nw);
      }
    }
    if (!additions.length) {
      return false;
    }
    const next = [];
    for (let i = 0; i < towers.length; i++) {
      if (!removeIdx.has(i)) {
        next.push(towers[i]);
      }
    }
    for (let j = 0; j < additions.length; j++) {
      next.push(additions[j]);
    }
    towers = next;
    return true;
  }

  function mergeMorphableKinds() {
    if (!useCustomLevel || editorMode !== 'test') {
      return;
    }
    for (let i = 0; i < towers.length; i++) {
      if (towers[i].kind === 'beam') {
        towers[i].kind = 'metal';
      }
    }
    let guard = 0;
    let changed = true;
    while (changed && guard < 24) {
      guard += 1;
      changed = false;
      for (let k = 0; k < MORPH_KINDS.length; k++) {
        if (mergeOnePass(MORPH_KINDS[k])) {
          changed = true;
        }
      }
    }
  }

  function placeStampAt(wx, wy) {
    const x = snapBuild(wx);
    const y = snapBuild(wy);
    if (buildTool === 'erase') {
      const hit = hitTowerAt(wx, wy);
      if (hit) {
        pushBuilderUndo('erase piece');
        towers = towers.filter((t) => t.id !== hit.id);
        syncPlayStopButtons();
      }
      return;
    }
    if (buildTool === 'move' || buildTool === 'sling') {
      return;
    }
    let piece = null;
    if (buildTool === 'wood') {
      piece = tower(allocBuilderId(), x, y, BUILD_TILE, BUILD_TILE, 2, 'wood', 80, '');
    } else if (buildTool === 'stone') {
      piece = tower(allocBuilderId(), x, y, BUILD_TILE, BUILD_TILE, 4, 'stone', 140, '');
    } else if (buildTool === 'lava') {
      piece = lavaBar(allocBuilderId(), x, y, BUILD_TILE, BUILD_TILE);
    } else if (buildTool === 'villain') {
      piece = tower(allocBuilderId(), x, y, BUILD_TILE, BUILD_TILE, 1, 'villain', 400, buildVillainEmoji);
    } else if (buildTool === 'vine') {
      piece = vineHang(allocBuilderId(), x, y, BUILD_TILE, BUILD_TILE);
    } else if (buildTool === 'metal') {
      piece = metalRail(allocBuilderId(), x, y, BUILD_TILE, BUILD_TILE);
    }
    if (
      piece &&
      piece.y >= 10 &&
      piece.x >= 6 &&
      piece.x + piece.w <= WORLD_W - 6 &&
      piece.y + piece.h <= WORLD_H - 8
    ) {
      if (pieceOverlapsLauncherNoBuild(piece)) {
        turnLine.textContent = 'Cannot build on or over the launcher (reserved corner + slingshot pocket).';
        return;
      }
      pushBuilderUndo(`place ${buildTool}`);
      towers.push(piece);
      syncPlayStopButtons();
    }
  }

  function enterLevelBuilder(fromCampaign, fromPicker) {
    document.body.classList.remove('lobber-playtest');
    hidePlaytestHud();
    builderReturnToPicker = !!fromPicker && !localLocked;
    useCustomLevel = true;
    editorMode = 'edit';
    builderTestSnapshot = null;
    builderUndoStack = [];
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
    syncBuilderUndoUi();
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
    if (aliveVillainCount() < 1) {
      const msg = 'Add at least one villain before Play test. Villains are the level objective.';
      turnLine.textContent = msg;
      window.alert(msg);
      return;
    }
    builderTestSnapshot = snapshotCustomLevel();
    editorMode = 'test';
    mergeMorphableKinds();
    resetCourseHp();
    score = 0;
    debris = [];
    setScoreText();
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
    syncBuilderUndoUi();
  }

  function syncPlayStopButtons() {
    const playB = document.getElementById('lobberBuilderPlay');
    const stopB = document.getElementById('lobberBuilderStop');
    if (playB) {
      playB.disabled = editorMode !== 'edit';
      if (!playB.disabled && useCustomLevel && aliveVillainCount() < 1) {
        playB.title = 'Add at least one villain — Play test needs a target to clear.';
      } else {
        playB.title = '';
      }
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
        buildDragSlingStart = { x: SLING.x, y: SLING.y };
        buildDragSlingUndoSnap = canCaptureBuilderHistory() ? snapshotCustomLevel() : '';
      }
      return;
    }
    if (buildTool === 'move') {
      const hit = hitTowerAt(wx, wy);
      if (hit) {
        buildDragPieceStart = { x: hit.x, y: hit.y };
        buildDragPieceUndoSnap = canCaptureBuilderHistory() ? snapshotCustomLevel() : '';
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
      const nextSling = placeSlingInValidZone({ x: wx, y: wy });
      if (!slingOverlapsAnyPiece(nextSling.x, nextSling.y)) {
        SLING = nextSling;
        dragCur = { x: SLING.x, y: SLING.y };
      }
      return;
    }
    if (buildDragPiece) {
      const b = towers.find((t) => t.id === buildDragPiece.id);
      if (b) {
        let nx = snapBuild(wx - buildDragPiece.ox);
        let ny = snapBuild(wy - buildDragPiece.oy);
        nx = Math.max(4, Math.min(WORLD_W - b.w - 4, nx));
        ny = Math.max(4, Math.min(GROUND_Y - b.h - 2, ny));
        const trial = { x: nx, y: ny, w: b.w, h: b.h };
        if (!pieceOverlapsLauncherNoBuild(trial)) {
          b.x = nx;
          b.y = ny;
        } else {
          turnLine.textContent = 'Cannot move parts onto the launcher (reserved corner + slingshot pocket).';
        }
      }
    }
  }

  function builderPointerUp() {
    const hadSlingDrag = !!buildDragSling;
    const hadPieceDrag = !!buildDragPiece;
    const draggedPieceId = hadPieceDrag ? buildDragPiece.id : null;
    const savedPieceStart =
      hadPieceDrag && buildDragPieceStart ? { x: buildDragPieceStart.x, y: buildDragPieceStart.y } : null;
    if (editorMode === 'edit' && hadPieceDrag && draggedPieceId != null) {
      const b = towers.find((t) => t.id === draggedPieceId);
      if (b && pieceOverlapsLauncherNoBuild(b) && savedPieceStart) {
        b.x = savedPieceStart.x;
        b.y = savedPieceStart.y;
        turnLine.textContent = 'Cannot leave parts on the launcher (reserved corner + slingshot pocket).';
      }
      if (b && savedPieceStart && (b.x !== savedPieceStart.x || b.y !== savedPieceStart.y)) {
        pushBuilderUndoSnapshot('move piece', buildDragPieceUndoSnap);
      }
    }
    if (
      editorMode === 'edit' &&
      hadSlingDrag &&
      buildDragSlingStart &&
      (SLING.x !== buildDragSlingStart.x || SLING.y !== buildDragSlingStart.y)
    ) {
      pushBuilderUndoSnapshot('move slingshot', buildDragSlingUndoSnap);
    }
    buildDragPiece = null;
    buildDragPieceStart = null;
    buildDragPieceUndoSnap = '';
    buildDragSling = false;
    buildDragSlingStart = null;
    buildDragSlingUndoSnap = '';
  }

  function applyWorldPreset(key) {
    if (editorMode !== 'edit') {
      return;
    }
    pushBuilderUndo('world resize');
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
    pushBuilderUndo('new blank');
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
    pushBuilderUndo('copy stage');
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
      '<span class="lobber-builder-hint">Mario-style builder: one-tile pieces on a shared grid · No-build over launcher (corner zone + sling pocket) · Metal is indestructible in play · Same-kind tiles merge only when touching (Play test) · Erase clears a merged piece</span>',
      '<button type="button" class="lobber-tool" data-build-tool="wood">Wood</button>',
      '<button type="button" class="lobber-tool" data-build-tool="stone">Stone</button>',
      '<button type="button" class="lobber-tool" data-build-tool="lava">Lava</button>',
      '<button type="button" class="lobber-tool" data-build-tool="vine" title="Hanging vine — slows and traps the shot">Vine</button>',
      '<button type="button" class="lobber-tool" data-build-tool="metal" title="Solid metal — indestructible, bouncy">Metal</button>',
      '<button type="button" class="lobber-tool" data-build-tool="villain">Villain</button>',
      '<button type="button" class="lobber-tool" data-build-tool="move">Move</button>',
      '<button type="button" class="lobber-tool" data-build-tool="sling">Slingshot</button>',
      '<button type="button" class="lobber-tool" data-build-tool="erase">Erase</button>',
      '</div>',
      '<div class="lobber-builder-row lobber-builder-actions">',
      '<button type="button" id="lobberBuilderBlank">New blank</button>',
      '<button type="button" id="lobberBuilderCloneStage">Copy selected stage</button>',
      '<button type="button" id="lobberBuilderPlay" class="lobber-builder-play-primary">Play test</button>',
      '<button type="button" id="lobberBuilderStop" disabled>Stop test</button>',
      '<button type="button" id="lobberBuilderUndo" disabled>Undo</button>',
      '<button type="button" id="lobberBuilderExport">Save Game</button>',
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
    document.getElementById('lobberBuilderUndo').addEventListener('click', undoBuilderAction);
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
        const before = canCaptureBuilderHistory() ? snapshotCustomLevel() : '';
        if (importCustomJson(String(r.result || ''))) {
          pushBuilderUndoSnapshot('import level', before);
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
        ? ` <span style="opacity:0.78">· Ricochet: bank off wood, stone, or metal (${wb}+) before villains take damage.</span>`
        : '';
    const obj = useCustomLevel ? ' <span style="opacity:0.82">· Objective: clear all villains.</span>' : '';
    const edit =
      editorMode === 'edit'
        ? ` <span style="opacity:0.85">· <strong>Level builder</strong> — place parts, move slingshot, then Play test.</span>`
        : editorMode === 'test'
          ? ` <span style="opacity:0.85">· <strong>Play test</strong> — Stop test to keep editing.</span>`
          : '';
    el.innerHTML = `${tier}<span class="highlight">${L.name}</span> <span style="opacity:0.75">(${WORLD_W}×${WORLD_H})</span>${ric}${obj}${edit}`;
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
    const availW = Math.max(480, (wrap && wrap.clientWidth) || CANVAS_W);
    const availH = Math.max(320, (wrap && wrap.clientHeight) || CANVAS_H);
    const fitMul = 0.95;
    const targetW = availW * fitMul;
    const targetH = availH * fitMul;
    const aspect = WORLD_W / Math.max(1, WORLD_H);
    let cssW = targetW;
    let cssH = cssW / aspect;
    if (cssH > targetH) {
      cssH = targetH;
      cssW = cssH * aspect;
    }
    cssW = Math.max(560, cssW);
    cssH = Math.max(320, cssH);

    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const longEdge = Math.max(cssW, cssH) * dpr;
    let backingScale = 1;
    if (longEdge > 1760) {
      backingScale = 1760 / longEdge;
    }

    CANVAS_W = Math.max(640, Math.floor(cssW * dpr * backingScale));
    CANVAS_H = Math.max(360, Math.floor(cssH * dpr * backingScale));

    canvas.style.width = `${Math.floor(cssW)}px`;
    canvas.style.height = `${Math.floor(cssH)}px`;
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
      vineStuck: false,
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
    if (aliveVillainCount() === 0) {
      turnLine.textContent = 'All villains cleared! Level complete.';
      return;
    }
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

  function projectileStartsInsideAnyTower(ox, oy, er) {
    for (const b of towers) {
      if (b.hp > 0 && circleRectHit(ox, oy, er, b)) {
        return true;
      }
    }
    return false;
  }

  /**
   * First t in [0,1] where segment (ox,oy)→(nx,ny) enters the Minkowski sum of rect b with a disk of radius er.
   * Used so fast shots cannot tunnel through wide merged planks in one frame.
   */
  function segmentEnterMinkowskiAabb(ox, oy, nx, ny, bx, by, bw, bh, er) {
    const xmin = bx - er;
    const xmax = bx + bw + er;
    const ymin = by - er;
    const ymax = by + bh + er;
    const dx = nx - ox;
    const dy = ny - oy;
    function axisClip(o, d, lo, hi) {
      if (Math.abs(d) < 1e-10) {
        if (o < lo || o > hi) {
          return null;
        }
        return [0, 1];
      }
      let t0 = (lo - o) / d;
      let t1 = (hi - o) / d;
      if (t0 > t1) {
        const z = t0;
        t0 = t1;
        t1 = z;
      }
      return [t0, t1];
    }
    const xc = axisClip(ox, dx, xmin, xmax);
    if (!xc) {
      return null;
    }
    const yc = axisClip(oy, dy, ymin, ymax);
    if (!yc) {
      return null;
    }
    const t0 = Math.max(0, xc[0], yc[0]);
    const t1 = Math.min(1, xc[1], yc[1]);
    if (t0 > t1) {
      return null;
    }
    return t0;
  }

  function earliestTowerPathHitT(ox, oy, nx, ny, er) {
    if ((nx === ox && ny === oy) || projectileStartsInsideAnyTower(ox, oy, er)) {
      return null;
    }
    let best = null;
    for (const b of towers) {
      if (b.hp <= 0) {
        continue;
      }
      const t = segmentEnterMinkowskiAabb(ox, oy, nx, ny, b.x, b.y, b.w, b.h, er);
      if (t != null && t >= 0 && t <= 1) {
        if (best === null || t < best) {
          best = t;
        }
      }
    }
    return best;
  }

  function neighborSplashHit(broken, pwr, proj) {
    if (!pwr.splash) {
      return;
    }
    const need = wallBouncesRequired();
    for (const b of towers) {
      if (b.hp <= 0 || b.id === broken.id || b.kind === 'lava' || b.kind === 'vine' || isMetalKind(b.kind)) {
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
    const er = projectileRadiusWorld();
    for (const b of towers) {
      if (b.hp > 0 && b.kind === 'lava' && circleRectHit(p.x, p.y, er, b)) {
        spawnDebris(p.x, p.y, '🔥');
        spawnDebris(p.x, p.y, '💀');
        beep(90, 0.22);
        completeShotAndAdvanceTurn();
        return;
      }
    }
    /**
     * Resolve one structural block at a time, deepest penetration first.
     * Prevents two adjacent rects at a corner from applying conflicting normals in the same pass.
     */
    const usedBlock = new Set();
    for (let iter = 0; iter < 5; iter++) {
      let bestB = null;
      let bestPen = -1;
      for (const b of towers) {
        if (b.hp <= 0 || b.kind === 'lava') {
          continue;
        }
        if (b.kind !== 'vine' && !isMetalKind(b.kind) && b.kind !== 'wood' && b.kind !== 'stone' && b.kind !== 'villain') {
          continue;
        }
        if (usedBlock.has(b.id)) {
          continue;
        }
        if (!circleRectHit(p.x, p.y, er, b)) {
          continue;
        }
        const cn = contactNormalForRect(p, b, er);
        if (cn.pen > bestPen) {
          bestPen = cn.pen;
          bestB = b;
        }
      }
      if (!bestB || bestPen < 0.015) {
        break;
      }
      usedBlock.add(bestB.id);
      const b = bestB;
      if (b.kind === 'vine') {
        const cn = contactNormalForRect(p, b, er);
        p.x += cn.nx * (cn.pen * 0.52 + 0.06);
        p.y += cn.ny * (cn.pen * 0.52 + 0.06);
        p.vx *= 0.16;
        p.vy = p.vy * 0.2 + 0.14;
        p.spin = (p.spin || 0) * 0.88;
        p.vineStuck = true;
        beep(175, 0.028);
        continue;
      }
      if (isMetalKind(b.kind)) {
        const cn = contactNormalForRect(p, b, er);
        p.x += cn.nx * (cn.pen + 0.2) * 0.58;
        p.y += cn.ny * (cn.pen + 0.2) * 0.58;
        const vn = p.vx * cn.nx + p.vy * cn.ny;
        const bumpOnce = p._metalVelBump || null;
        if (!bumpOnce || !bumpOnce.has(b.id)) {
          if (bumpOnce) {
            bumpOnce.add(b.id);
          }
          const bmPin = (pr.bounceMul || 1) * 0.9;
          if (vn < -0.22) {
            p.structureBounces = (p.structureBounces || 0) + 1;
          }
          if (vn < 0) {
            p.vx -= 2 * vn * cn.nx * bmPin;
            p.vy -= 2 * vn * cn.ny * bmPin;
          }
          const sp = p.spin || SPIN_BASE;
          p.spin = sp * 1.05 + (Math.random() - 0.5) * 3.5;
          beep(268, 0.02);
        }
        continue;
      }
      const cn = contactNormalForRect(p, b, er);
      p.x += cn.nx * (cn.pen + 0.16) * 0.55;
      p.y += cn.ny * (cn.pen + 0.16) * 0.55;
      const vn = p.vx * cn.nx + p.vy * cn.ny;
      const bm = (pr.bounceMul || 1) * BOUNCE_DAMP;
      if (vn < -0.28 && (b.kind === 'wood' || b.kind === 'stone')) {
        p.structureBounces = (p.structureBounces || 0) + 1;
      }
      if (vn < 0) {
        p.vx -= 2 * vn * cn.nx * bm;
        p.vy -= 2 * vn * cn.ny * bm;
      }
      const needRic = wallBouncesRequired();
      const villainArmored = b.kind === 'villain' && needRic > 0 && (p.structureBounces || 0) < needRic;
      if (villainArmored) {
        beep(130, 0.04);
        continue;
      }
      if (isMetalKind(b.kind) || b.kind === 'lava' || b.kind === 'vine') {
        continue;
      }
      let dmg = pr.dmg || 1;
      if (b.kind === 'wood') {
        dmg = pr.woodDmg || dmg;
      }
      if (b.kind === 'stone') {
        dmg = pr.stoneDmg || dmg;
      }
      const skipDmg = p._dmgOnce && p._dmgOnce.has(b.id);
      if (!skipDmg) {
        b.hp -= dmg;
        if (p._dmgOnce) {
          p._dmgOnce.add(b.id);
        }
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

  function contactNormalForRect(p, b, er) {
    const px = p.x;
    const py = p.y;
    const bx = b.x;
    const by = b.y;
    const bw = b.w;
    const bh = b.h;
    const cx = Math.max(bx, Math.min(px, bx + bw));
    const cy = Math.max(by, Math.min(py, by + bh));
    const dx = px - cx;
    const dy = py - cy;
    const d2 = dx * dx + dy * dy;
    const vx = p.vx || 0;
    const vy = p.vy || 0;
    const dEps = 1e-8;
    if (d2 > dEps) {
      const d = Math.sqrt(d2);
      let nx = dx / d;
      let ny = dy / d;
      let pen = Math.max(0, er - d);
      // Near a rect corner, dx/dy is unstable; bias to a cardinal axis using velocity (into surface).
      const cornerBlend = d < er * 0.28 && Math.abs(Math.abs(dx) - Math.abs(dy)) < d * 0.42;
      if (cornerBlend) {
        const card = [
          { nx: -1, ny: 0 },
          { nx: 1, ny: 0 },
          { nx: 0, ny: -1 },
          { nx: 0, ny: 1 },
        ];
        let best = card[0];
        let bestDot = best.nx * vx + best.ny * vy;
        for (let i = 1; i < 4; i++) {
          const c = card[i];
          const dot = c.nx * vx + c.ny * vy;
          if (dot < bestDot - 1e-5) {
            best = c;
            bestDot = dot;
          }
        }
        if (bestDot < -0.04) {
          nx = best.nx;
          ny = best.ny;
          pen = Math.max(pen, er - d + er * 0.06);
        }
      }
      return { nx, ny, pen };
    }
    const left = Math.abs(px - bx);
    const right = Math.abs(bx + bw - px);
    const top = Math.abs(py - by);
    const bot = Math.abs(by + bh - py);
    const minEdge = Math.min(left, right, top, bot);
    const tieSlop = Math.max(0.55, er * 0.12);
    const edges = [
      { nx: -1, ny: 0, dist: left },
      { nx: 1, ny: 0, dist: right },
      { nx: 0, ny: -1, dist: top },
      { nx: 0, ny: 1, dist: bot },
    ];
    const near = edges.filter((e) => e.dist <= minEdge + tieSlop);
    let pick = near[0] || edges[0];
    let pickDot = pick.nx * vx + pick.ny * vy;
    for (let i = 1; i < near.length; i++) {
      const e = near[i];
      const dot = e.nx * vx + e.ny * vy;
      if (dot < pickDot - 1e-5) {
        pick = e;
        pickDot = dot;
      }
    }
    return { nx: pick.nx, ny: pick.ny, pen: Math.max(er * 0.35, er - minEdge + er * 0.08) };
  }

  function projectileOverlapsAnyVine(p) {
    const er = projectileRadiusWorld();
    for (const b of towers) {
      if (b.hp <= 0 || b.kind !== 'vine') {
        continue;
      }
      if (circleRectHit(p.x, p.y, er, b)) {
        return true;
      }
    }
    return false;
  }

  function tickFlight(dt) {
    if (!projectile || phase !== 'flight') {
      return;
    }
    const p = projectile;
    p._dmgOnce = new Set();
    p._metalVelBump = new Set();
    const er = projectileRadiusWorld();
    const gStep = (GRAVITY * dt * 60) / 1;
    const moveScale = dt * 60;
    const preVy = p.vy + gStep;
    const moveLen = Math.hypot(p.vx * moveScale, preVy * moveScale);
    const nStep = Math.min(12, Math.max(1, Math.ceil(moveLen / Math.max(4, er * 0.22))));

    for (let si = 0; si < nStep; si++) {
      p.vy += gStep / nStep;
      const ox = p.x;
      const oy = p.y;
      const nx = ox + (p.vx * moveScale) / nStep;
      const ny = oy + (p.vy * moveScale) / nStep;
      const tHit = earliestTowerPathHitT(ox, oy, nx, ny, er);
      if (tHit != null) {
        const u = Math.min(1, Math.max(0, tHit + 1e-4));
        p.x = ox + (nx - ox) * u;
        p.y = oy + (ny - oy) * u;
      } else {
        p.x = nx;
        p.y = ny;
      }
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
    }

    p.rot += (p.spin || SPIN_BASE) * dt;

    const spd = Math.hypot(p.vx, p.vy);
    const grounded = p.y + er >= GROUND_Y - 0.5;
    const oob = p.x > WORLD_W + 140 || p.x < -140;
    const settled = grounded && spd < 2.05;
    const inVine = projectileOverlapsAnyVine(p);
    const vineDone = inVine && spd < 0.48;
    if (oob || settled || vineDone) {
      completeShotAndAdvanceTurn();
    }
  }

  function drawMetal(b) {
    const g = ctx.createLinearGradient(b.x, b.y, b.x + b.w, b.y + b.h);
    g.addColorStop(0, '#7a8794');
    g.addColorStop(0.4, '#c8d4e0');
    g.addColorStop(0.55, '#aebdcf');
    g.addColorStop(1, '#4e5866');
    ctx.fillStyle = g;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = 'rgba(30, 36, 44, 0.65)';
    ctx.lineWidth = Math.max(1.5, (2 * WORLD_W) / REF_WORLD_W);
    ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 1;
    if (b.w >= b.h) {
      const mid = b.y + b.h / 2;
      ctx.beginPath();
      ctx.moveTo(b.x + 4, mid);
      ctx.lineTo(b.x + b.w - 4, mid);
      ctx.stroke();
    } else {
      const mid = b.x + b.w / 2;
      ctx.beginPath();
      ctx.moveTo(mid, b.y + 4);
      ctx.lineTo(mid, b.y + b.h - 4);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(40, 48, 58, 0.35)';
    ctx.fillRect(b.x + 2, b.y + 2, Math.min(8, b.w * 0.15), Math.min(8, b.h * 0.35));
    ctx.fillRect(b.x + b.w - 10, b.y + b.h - 10, 8, 8);
  }

  function drawVine(b) {
    const cx = b.x + b.w / 2;
    const g = ctx.createLinearGradient(b.x, b.y, b.x + b.w, b.y + b.h);
    g.addColorStop(0, '#1a4d28');
    g.addColorStop(0.35, '#3d8f4f');
    g.addColorStop(0.7, '#2d6a3a');
    g.addColorStop(1, '#153820');
    ctx.fillStyle = g;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = 'rgba(25, 80, 40, 0.75)';
    ctx.lineWidth = Math.max(1.2, b.w * 0.12);
    ctx.beginPath();
    const segs = Math.max(5, Math.floor(b.h / 28));
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const yy = b.y + t * b.h;
      const sway = Math.sin(t * Math.PI * 2.4 + b.x * 0.03) * (b.w * 0.42);
      const xx = cx + sway;
      if (i === 0) {
        ctx.moveTo(xx, yy);
      } else {
        ctx.lineTo(xx, yy);
      }
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(160, 240, 140, 0.45)';
    ctx.lineWidth = 1;
    for (let k = 0; k < 5; k++) {
      const ty = b.y + (k + 0.45) * (b.h / 5);
      const side = k % 2 === 0 ? 1 : -1;
      ctx.beginPath();
      ctx.moveTo(cx, ty);
      ctx.quadraticCurveTo(cx + side * (b.w + 10), ty - 6, cx + side * 6, ty - 14);
      ctx.stroke();
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
    const alive = [];
    for (let i = 0; i < towers.length; i++) {
      if (towers[i].hp > 0) {
        alive.push(towers[i]);
      }
    }
    const nonVillain = alive.filter((b) => b.kind !== 'villain');
    const villains = alive.filter((b) => b.kind === 'villain');
    function drawOneTower(b) {
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
        return;
      }
      if (b.kind === 'vine') {
        drawVine(b);
        return;
      }
      if (isMetalKind(b.kind)) {
        drawMetal(b);
        return;
      }
      if (b.kind === 'stone') {
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
    for (let i = 0; i < nonVillain.length; i++) {
      drawOneTower(nonVillain[i]);
    }
    for (let j = 0; j < villains.length; j++) {
      drawOneTower(villains[j]);
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

  function drawLauncherReservedZoneOverlay() {
    if (!useCustomLevel) {
      return;
    }
    const z = customLauncherReservedRect();
    const pocket = slingPocketKeepoutRect();
    ctx.save();
    ctx.setLineDash([10, 7]);
    ctx.lineWidth = Math.max(1.5, (WORLD_W / REF_WORLD_W) * 1.1);
    if (z.w >= 2 && z.h >= 2) {
      ctx.fillStyle = 'rgba(255, 120, 90, 0.1)';
      ctx.strokeStyle = 'rgba(255, 200, 140, 0.38)';
      ctx.fillRect(z.x, z.y, z.w, z.h);
      ctx.strokeRect(z.x + 0.5, z.y + 0.5, z.w - 1, z.h - 1);
    }
    if (pocket.w >= 2 && pocket.h >= 2) {
      ctx.fillStyle = 'rgba(180, 140, 255, 0.09)';
      ctx.strokeStyle = 'rgba(200, 170, 255, 0.42)';
      ctx.fillRect(pocket.x, pocket.y, pocket.w, pocket.h);
      ctx.strokeRect(pocket.x + 0.5, pocket.y + 0.5, pocket.w - 1, pocket.h - 1);
    }
    ctx.setLineDash([]);
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
      drawLauncherReservedZoneOverlay();
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

  window.addEventListener('keydown', (e) => {
    if (editorMode !== 'edit') {
      return;
    }
    const k = (e.key || '').toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z' && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      undoBuilderAction();
    }
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
