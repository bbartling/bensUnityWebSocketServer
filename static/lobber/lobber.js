/**
 * Emoji Lobber — Angry-Birds-style lob, MQTT Man/Boy, master sync, solo & auto-1P fallback.
 * HERO picker = human faces only (each has a power). Targets = villain/creature emojis.
 */
(function () {
  'use strict';

  const cfg = window.LOBBER_CONFIG;
  if (!cfg) {
    console.error('LOBBER_CONFIG missing');
    return;
  }

  const BROKER_URL = 'wss://test.mosquitto.org:8081';
  const GAME_ID = 'bens_arcade';
  const PLAYER_ID = cfg.seat;
  const REMOTE_ID = PLAYER_ID === 'Man' ? 'Boy' : 'Man';
  const IS_MAN = PLAYER_ID === 'Man';
  const SOLO = new URLSearchParams(window.location.search).get('solo') === '1';
  const LOBBER_DEBUG = new URLSearchParams(window.location.search).get('debug') === '1';

  /** Verbose 2P / MQTT trace — add ?debug=1 to the URL. */
  function dlog() {
    if (LOBBER_DEBUG) {
      const args = Array.prototype.slice.call(arguments);
      args.unshift(`[Lobber:${PLAYER_ID}]`);
      console.log.apply(console, args);
    }
  }
  /** Always-on breadcrumbs for connection issues (lightweight). */
  function ilog() {
    const args = Array.prototype.slice.call(arguments);
    const ts = new Date().toISOString().slice(11, 23);
    args.unshift(ts, `[Lobber:${PLAYER_ID}]`);
    console.log.apply(console, args);
  }

  const CANVAS_W = 900;
  const CANVAS_H = 520;
  let WORLD_W = 900;
  let WORLD_H = 520;
  let GROUND_Y = 458;
  let SLING = { x: 128, y: 372 };
  const GRAVITY = 0.4;
  const MAX_PULL = 138;
  const MIN_PULL = 12;
  const BASE_POWER = 0.185;
  const PR = 21;
  const SPIN_BASE = 7.5;

  function cloneTowers(t) {
    return t.map((b) => Object.assign({}, b));
  }

  function worldShotScale() {
    return Math.pow(WORLD_W / 900, 0.38);
  }

  function effectivePR() {
    return PR * Math.pow(WORLD_W / 900, 0.12);
  }

  function splashRadiusWorld() {
    return 96 * (WORLD_W / 900);
  }

  function maxPullWorld() {
    return MAX_PULL * Math.min(1.35, WORLD_W / 900);
  }

  function minPullWorld() {
    return MIN_PULL * (WORLD_W / 900);
  }

  function slingScale() {
    return WORLD_W / 900;
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
  function pyramidBlocks(cx, base, bottomN, cw, ch, vg, hg, id0, lavaBetweenLayers) {
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
        const lw = Math.max(rowW, nextRowW) * 0.92;
        const midY = y - vg / 2 - 4;
        out.push(lavaBar(id++, cx - lw / 2, midY, lw, 8));
      }
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
      worldW: 1580,
      worldH: 570,
      towers(b) {
        const w = 1580;
        const cx = w - 340;
        return [
          lavaBar(500, cx - 200, b - 22, 400, 16),
          ...pyramidBlocks(cx, b, 7, 36, 34, 3, 2, 501, true),
        ];
      },
    },
    {
      id: 11,
      tier: 'Hard',
      name: 'H4 · Gauntlet',
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
      worldW: 1780,
      worldH: 600,
      towers(b) {
        const w = 1780;
        const z = w - 720;
        const y2 = w - 460;
        const y3 = w - 240;
        return [
          lavaBar(700, z - 30, b - 24, 520, 20),
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
      worldW: 1880,
      worldH: 610,
      towers(b) {
        const w = 1880;
        const cx = w - 380;
        return [
          lavaBar(800, cx - 260, b - 28, 520, 22),
          lavaBar(801, cx - 100, b - 200, 200, 14),
          ...pyramidBlocks(cx, b, 8, 34, 32, 2, 2, 802, true),
        ];
      },
    },
    {
      id: 14,
      tier: 'Impossible',
      name: 'I3 · Apocalypse',
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
    return Math.floor(L.worldH * (458 / 520));
  }

  function levelSling(L) {
    const gy = levelGroundY(L);
    return { x: Math.round(L.worldW * (128 / 900)), y: gy - 86 };
  }

  function towersForLevel(levelIndex) {
    const L = LEVELS[levelIndex] || LEVELS[0];
    const base = levelGroundY(L);
    return L.towers(base);
  }

  function loadLevel(levelIndex) {
    const idx = Math.max(0, Math.min(LEVELS.length - 1, levelIndex | 0));
    const L = LEVELS[idx];
    currentLevelIndex = idx;
    WORLD_W = L.worldW;
    WORLD_H = L.worldH;
    GROUND_Y = levelGroundY(L);
    SLING = levelSling(L);
    towers = cloneTowers(towersForLevel(idx));
    dlog('loadLevel', L.name, { worldW: WORLD_W, worldH: WORLD_H, GROUND_Y, SLING, blocks: towers.length });
    refreshGameInfo();
  }

  function refreshGameInfo() {
    const el = document.getElementById('gameInfo');
    if (!el) {
      return;
    }
    const L = LEVELS[currentLevelIndex] || LEVELS[0];
    const tier = L.tier ? `<span style="opacity:0.85">${L.tier}</span> · ` : '';
    el.innerHTML = `GAME: <span class="highlight">${GAME_ID}</span> · YOU: <span class="highlight">${PLAYER_ID}</span> · ${IS_MAN ? 'HOST' : 'JOIN'} · ${tier}<span class="highlight">${L.name}</span> <span style="opacity:0.75">(${WORLD_W}×${WORLD_H})</span>`;
  }

  let currentLevelIndex = 0;
  /** In 2P, set from Man’s pick payload so Boy matches host stage. */
  let hostLevelId = null;

  let towers = [];
  loadLevel(0);
  let debris = [];
  let scoreMan = 0;
  let scoreBoy = 0;
  let turn = 'Man';
  let phase = 'pick';
  let shotSeq = 0;
  let syncVer = 0;

  let localEmoji = null;
  let remoteEmoji = null;
  let localLocked = false;
  let remoteLocked = false;
  let playAlone = SOLO;
  let joinSent = false;

  let projectile = null;
  let shooterThisRound = null;
  let dragging = false;
  let dragCur = { x: SLING.x, y: SLING.y };

  let audioCtx = null;
  function beep(f, t) {
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
    if (playAlone || SOLO) {
      const mine = IS_MAN ? scoreMan : scoreBoy;
      scoreEl.textContent = `${PLAYER_ID} ${mine} pts`;
    } else {
      scoreEl.textContent = `MAN ${scoreMan}  ·  BOY ${scoreBoy}`;
    }
  }

  function activeTurn() {
    if (SOLO || playAlone) {
      return PLAYER_ID;
    }
    return turn;
  }

  function setTurnLine() {
    if (phase === 'pick') {
      turnLine.textContent = '';
      return;
    }
    if (phase === 'flight') {
      turnLine.textContent = `${shooterThisRound} in flight…`;
      return;
    }
    const t = activeTurn();
    if (playAlone || SOLO) {
      turnLine.textContent = 'Pull back & release — your emoji spins in the air';
    } else {
      turnLine.textContent =
        t === PLAYER_ID ? 'YOUR TURN — drag from slingshot pocket & release' : `Waiting for ${REMOTE_ID}…`;
    }
  }

  function updatePickStatus() {
    if (!pickStatus) {
      return;
    }
    if ((SOLO || playAlone) && remoteLocked && !localLocked) {
      pickStatus.textContent = SOLO ? 'Solo — pick a hero face & Lock in.' : 'No partner yet — pick a hero & Lock in (1-player).';
    } else if (localLocked && remoteLocked) {
      pickStatus.textContent = playAlone || SOLO ? 'Ready — go!' : 'Both ready — first volley: Man.';
    } else if (localLocked) {
      if (playAlone) {
        pickStatus.textContent = 'Starting…';
      } else {
        const sec = Math.max(0, Math.ceil((JOIN_WAIT_MS - (Date.now() - waitPartnerSince)) / 1000));
        pickStatus.textContent = `Waiting for ${REMOTE_ID}… (${sec}s → 1-player)`;
      }
    } else if (remoteLocked) {
      pickStatus.textContent = `${REMOTE_ID} ready — pick your hero!`;
    } else {
      pickStatus.textContent = 'Choose a human-face hero (each has a power), then Lock in.';
    }
  }

  let waitPartnerSince = Date.now();
  const JOIN_WAIT_MS = 14000;

  let selectedLevelIndex = 0;
  const levelButtonsEl = document.getElementById('levelButtons');

  function levelForNewMatch() {
    if (SOLO || playAlone || IS_MAN) {
      return selectedLevelIndex;
    }
    return hostLevelId != null ? hostLevelId : selectedLevelIndex;
  }

  function syncLevelButtonHighlight() {
    if (!levelButtonsEl) {
      return;
    }
    const show = IS_MAN ? selectedLevelIndex : hostLevelId != null ? hostLevelId : selectedLevelIndex;
    levelButtonsEl.querySelectorAll('button[data-level]').forEach((btn) => {
      const n = parseInt(btn.getAttribute('data-level'), 10);
      btn.classList.toggle('selected', n === show);
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
        if (localLocked) {
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
  }

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
    localLocked = true;
    lockBtn.disabled = true;
    waitPartnerSince = Date.now();
    publishPick(localEmoji);
    updatePickStatus();
    tryBeginMatch();
  });

  function tryBeginMatch() {
    if (localLocked && remoteLocked && phase === 'pick') {
      phase = 'aim';
      pickOverlay.classList.add('hidden');
      canvas.classList.remove('lobber-wait');
      loadLevel(levelForNewMatch());
      debris = [];
      syncLevelButtonHighlight();
      turn = SOLO || playAlone ? PLAYER_ID : 'Man';
      setTurnLine();
      setScoreText();
      ilog('match start', { level: currentLevelIndex, name: LEVELS[currentLevelIndex].name, world: `${WORLD_W}×${WORLD_H}`, twoPlayer: !(SOLO || playAlone) });
      if (IS_MAN && !SOLO && !playAlone) {
        publishSync();
      }
    }
  }

  function enterPlayAlone() {
    if (playAlone || SOLO) {
      return;
    }
    ilog('enter 1-player fallback', { reason: 'partner_wait_timeout', joinWaitMs: JOIN_WAIT_MS, level: selectedLevelIndex });
    playAlone = true;
    remoteEmoji = '🌐';
    remoteLocked = true;
    partnerOk = true;
    partnerTrying = false;
    updatePickStatus();
    updateConn();
    tryBeginMatch();
  }

  let client = null;

  function publishPick(emoji) {
    if (SOLO || !client || !client.connected) {
      return;
    }
    const payload = { emoji, levelId: selectedLevelIndex };
    client.publish(`lobber/${GAME_ID}/${PLAYER_ID}/pick`, JSON.stringify(payload), { qos: 0 });
    dlog('tx pick', payload);
  }

  function publishStatus(s) {
    if (SOLO || playAlone || !client || !client.connected) {
      return;
    }
    client.publish(`lobber/${GAME_ID}/${PLAYER_ID}/status`, s, { qos: 0 });
    dlog('tx status', s);
  }

  function publishJoin() {
    if (!client || !client.connected || IS_MAN) {
      return;
    }
    const topic = `lobber/${GAME_ID}/Boy/join`;
    client.publish(topic, JSON.stringify({ t: Date.now() }), { qos: 0 });
    ilog('tx Boy/join', { topic, seat: PLAYER_ID });
  }

  function publishSync() {
    if (!IS_MAN || SOLO || playAlone || !client || !client.connected) {
      return;
    }
    const payload = {
      v: syncVer++,
      levelId: currentLevelIndex,
      worldW: WORLD_W,
      worldH: WORLD_H,
      towers: cloneTowers(towers),
      debris: [],
      scoreMan,
      scoreBoy,
      turn,
      phase,
      shotSeq,
    };
    client.publish(`lobber/${GAME_ID}/Man/sync`, JSON.stringify(payload), { qos: 0 });
    dlog('tx sync', { v: payload.v, levelId: payload.levelId, blocks: payload.towers.length, turn, phase, shotSeq });
  }

  function applySync(data) {
    if (!data || !data.towers) {
      return;
    }
    if (typeof data.levelId === 'number' && data.levelId >= 0 && data.levelId < LEVELS.length) {
      loadLevel(data.levelId);
    }
    towers = cloneTowers(data.towers);
    scoreMan = data.scoreMan | 0;
    scoreBoy = data.scoreBoy | 0;
    turn = data.turn === 'Boy' ? 'Boy' : 'Man';
    shotSeq = data.shotSeq | 0;
    debris = [];
    if (data.phase === 'aim' || data.phase === 'flight') {
      phase = 'aim';
      projectile = null;
      shooterThisRound = null;
      pickOverlay.classList.add('hidden');
      canvas.classList.remove('lobber-wait');
    }
    setScoreText();
    setTurnLine();
    bumpPartnerSeen();
    ilog('applySync', {
      levelId: data.levelId,
      blocks: data.towers.length,
      turn: data.turn,
      phase: data.phase,
      shotSeq: data.shotSeq,
      scores: { scoreMan: data.scoreMan, scoreBoy: data.scoreBoy },
    });
    syncLevelButtonHighlight();
  }

  function publishShot(vx, vy, emoji) {
    shotSeq += 1;
    if (!SOLO && !playAlone && client && client.connected) {
      const payload = JSON.stringify({
        vx,
        vy,
        emoji,
        by: PLAYER_ID,
        seq: shotSeq,
      });
      client.publish(`lobber/${GAME_ID}/${PLAYER_ID}/shot`, payload, { qos: 0 });
      dlog('tx shot', { seq: shotSeq, emoji, vx: Math.round(vx * 100) / 100, vy: Math.round(vy * 100) / 100 });
    }
    startFlight(vx, vy, emoji, PLAYER_ID);
  }

  function publishFinish() {
    const payload = JSON.stringify({
      towers: towers.map((t) => ({ id: t.id, hp: t.hp })),
      scoreMan,
      scoreBoy,
      nextTurn: turn,
      by: PLAYER_ID,
      seq: shotSeq,
    });
    if (!SOLO && !playAlone && client && client.connected) {
      client.publish(`lobber/${GAME_ID}/${PLAYER_ID}/finish`, payload, { qos: 0 });
      dlog('tx finish', { seq: shotSeq, nextTurn: turn });
    }
    if (IS_MAN && !SOLO && !playAlone && client && client.connected) {
      publishSync();
    }
  }

  function applyFinish(data) {
    scoreMan = data.scoreMan;
    scoreBoy = data.scoreBoy;
    turn = data.nextTurn;
    if (data.towers && data.towers.length) {
      data.towers.forEach((row) => {
        const t = towers.find((x) => x.id === row.id);
        if (t) {
          if (t.kind === 'lava') {
            t.hp = 9999;
          } else {
            t.hp = row.hp;
          }
        }
      });
    }
    projectile = null;
    phase = 'aim';
    shooterThisRound = null;
    setScoreText();
    setTurnLine();
    bumpPartnerSeen();
    if (IS_MAN && !SOLO && !playAlone) {
      publishSync();
    }
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
    };
    setTurnLine();
  }

  function completeShotAndAdvanceTurn() {
    if (phase !== 'flight') {
      return;
    }
    const shooter = shooterThisRound;
    if (SOLO || playAlone) {
      turn = PLAYER_ID;
    } else {
      turn = shooter === 'Man' ? 'Boy' : 'Man';
    }
    if (PLAYER_ID === shooter && !SOLO && !playAlone) {
      publishFinish();
    }
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

  function neighborSplashHit(broken, pwr) {
    if (!pwr.splash) {
      return;
    }
    for (const b of towers) {
      if (b.hp <= 0 || b.id === broken.id || b.kind === 'lava') {
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
    if (shooterThisRound === 'Man') {
      scoreMan += pts + 25;
    } else {
      scoreBoy += pts + 25;
    }
    setScoreText();
  }

  function resolveHits(p) {
    const pr = p.power || defaultPower();
    for (const b of towers) {
      if (b.hp <= 0) {
        continue;
      }
      if (!circleRectHit(p.x, p.y, effectivePR(), b)) {
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
      const er = effectivePR();
      const pen = er - d;
      p.x += (dx / d) * pen * 0.55;
      p.y += (dy / d) * pen * 0.55;
      dx /= d;
      dy /= d;
      const vn = p.vx * dx + p.vy * dy;
      const bm = (pr.bounceMul || 1) * BOUNCE_DAMP;
      if (vn < 0) {
        p.vx -= 2 * vn * dx * bm;
        p.vy -= 2 * vn * dy * bm;
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
        neighborSplashHit(b, pr);
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

    const er = effectivePR();
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
    ctx.lineWidth = Math.max(2, (3 * WORLD_W) / 900);
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
        ctx.lineWidth = Math.max(2, (2.5 * WORLD_W) / 900);
        ctx.strokeRect(b.x, b.y, b.w, b.h);
        continue;
      } else if (b.kind === 'stone') {
        ctx.fillStyle = '#7a8a9a';
      } else {
        ctx.fillStyle = '#b8956a';
      }
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = Math.max(2, (2.5 * WORLD_W) / 900);
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
      ctx.font = `${Math.round(22 * (WORLD_W / 900))}px serif`;
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
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.font = `${Math.round(PR * 2 * slingScale())}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, 0, 2);
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

    const aimEmoji = localEmoji || '🙂';
    const sk = slingScale();
    const bandL = 16 * sk;
    const bandY = 20 * sk;
    if (phase === 'aim' || phase === 'pick') {
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
      if (phase === 'aim' && activeTurn() === PLAYER_ID) {
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
    if (phase !== 'aim' || activeTurn() !== PLAYER_ID) {
      return;
    }
    const d = Math.hypot(wx - SLING.x, wy - SLING.y);
    if (d < 56 * Math.sqrt(slingScale())) {
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
    publishShot(vx, vy, emoji);
    dragCur = { x: SLING.x, y: SLING.y };
  }

  canvas.addEventListener('mousedown', (e) => {
    const p = canvasToWorld(e.clientX, e.clientY);
    tryStartDrag(p.x, p.y);
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) {
      return;
    }
    const p = canvasToWorld(e.clientX, e.clientY);
    moveDrag(p.x, p.y);
  });
  window.addEventListener('mouseup', endDrag);

  canvas.addEventListener(
    'touchstart',
    (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      const p = canvasToWorld(t.clientX, t.clientY);
      tryStartDrag(p.x, p.y);
    },
    { passive: false },
  );
  canvas.addEventListener(
    'touchmove',
    (e) => {
      e.preventDefault();
      if (!dragging) {
        return;
      }
      const t = e.changedTouches[0];
      const p = canvasToWorld(t.clientX, t.clientY);
      moveDrag(p.x, p.y);
    },
    { passive: false },
  );
  canvas.addEventListener('touchend', (e) => {
    e.preventDefault();
    endDrag();
  });

  refreshGameInfo();
  document.getElementById('brokerInfo').innerHTML =
    `MQTT WS: <span class="highlight">${BROKER_URL}</span>`;

  let localConnected = false;
  let localConnecting = true;
  let partnerOk = false;
  let partnerTrying = true;
  let lastPartnerMsg = 0;
  const connectStart = Date.now();
  const connectionInfo = document.getElementById('connectionInfo');

  function bumpPartnerSeen() {
    lastPartnerMsg = Date.now();
    const was = partnerOk;
    partnerOk = true;
    partnerTrying = false;
    updateConn();
    if (!was) {
      ilog('partner linked', { lastPartnerMsg, seat: PLAYER_ID });
    }
    dlog('bumpPartnerSeen');
  }

  function updateConn() {
    const b = localConnected ? 'BROKER OK' : localConnecting ? 'CONNECTING…' : 'OFFLINE';
    const bc = localConnected ? '#7dffb3' : localConnecting ? '#ffe08a' : '#ff6b6b';
    let p;
    let pc;
    if (SOLO || playAlone) {
      p = playAlone ? '1-PLAYER (no link needed)' : 'SOLO';
      pc = '#7dffb3';
    } else {
      p = partnerOk ? 'PARTNER LINKED' : partnerTrying ? 'WAITING…' : 'NO PARTNER';
      pc = partnerOk ? '#7dffb3' : partnerTrying ? '#ffe08a' : '#ff6b6b';
    }
    connectionInfo.innerHTML = `MQTT: <span style="color:${bc}">${b}</span> · <span style="color:${pc}">${p}</span>`;
  }

  let localStatus = '—';
  let remoteStatus = '—';
  const statusBtn = document.getElementById('statusBtn');
  const statusInfo = document.getElementById('statusInfo');
  function updateStatusDisplay() {
    statusInfo.textContent = `You: ${localStatus} · ${cfg.remoteLabel}: ${remoteStatus}`;
  }
  statusBtn.addEventListener('click', () => {
    localStatus = 'READY';
    updateStatusDisplay();
    publishStatus('READY');
    beep(480, 0.05);
  });

  canvas.classList.add('lobber-wait');

  function onRemoteMessage(who, kind, raw) {
    if (who === PLAYER_ID) {
      return;
    }
    if (kind === 'sync' && who === 'Man' && IS_MAN) {
      return;
    }
    try {
      const data = kind === 'status' ? null : JSON.parse(raw.toString());
      if (kind === 'status') {
        remoteStatus = raw.toString();
        updateStatusDisplay();
        bumpPartnerSeen();
        dlog('rx status', { from: who, text: remoteStatus });
        return;
      }
      if (kind === 'pick') {
        remoteEmoji = (data && data.emoji) || '🙂';
        remoteLocked = true;
        if (who === 'Man' && data && typeof data.levelId === 'number') {
          hostLevelId = Math.max(0, Math.min(LEVELS.length - 1, data.levelId | 0));
          if (!localLocked) {
            loadLevel(hostLevelId);
            syncLevelButtonHighlight();
          }
        }
        waitPartnerSince = Date.now();
        updatePickStatus();
        tryBeginMatch();
        bumpPartnerSeen();
        ilog('rx pick', { from: who, emoji: remoteEmoji, levelId: data && data.levelId, bothReady: localLocked && remoteLocked });
        dlog('rx pick payload', data);
        return;
      }
      if (kind === 'shot') {
        dlog('rx shot', { from: who, seq: data && data.seq, emoji: data && data.emoji });
        startFlight(data.vx, data.vy, data.emoji || '🙂', who);
        bumpPartnerSeen();
        return;
      }
      if (kind === 'finish') {
        dlog('rx finish', { from: who, seq: data && data.seq, nextTurn: data && data.nextTurn });
        applyFinish(data);
        return;
      }
      if (kind === 'sync' && who === 'Man' && !IS_MAN) {
        dlog('rx sync incoming', { v: data && data.v, levelId: data && data.levelId });
        applySync(data);
        return;
      }
      if (kind === 'join' && who === 'Boy' && IS_MAN) {
        ilog('rx join from Boy → sending sync', { levelId: currentLevelIndex, phase });
        publishSync();
        bumpPartnerSeen();
        return;
      }
    } catch (err) {
      ilog('onRemoteMessage parse error', { who, kind, err: String(err) });
    }
  }

  function setupMQTT() {
    if (SOLO) {
      localConnected = true;
      localConnecting = false;
      playAlone = true;
      updateConn();
      ilog('solo mode — MQTT skipped');
      return;
    }
    const clientId = `lobber_${GAME_ID}_${PLAYER_ID}_${Math.random().toString(36).slice(2, 11)}`;
    ilog('mqtt start', {
      broker: BROKER_URL,
      clientId,
      gameId: GAME_ID,
      seat: PLAYER_ID,
      topicPattern: `lobber/${GAME_ID}/#`,
      debugVerbose: LOBBER_DEBUG,
    });
    if (!LOBBER_DEBUG) {
      console.info(`[Lobber:${PLAYER_ID}] Tip: add ?debug=1 to URL for verbose MQTT logs`);
    }
    client = mqtt.connect(BROKER_URL, {
      clientId,
      reconnectPeriod: 2500,
      connectTimeout: 30000,
    });
    client.on('connect', () => {
      localConnected = true;
      localConnecting = false;
      updateConn();
      ilog('mqtt connected', { clientId });
      client.subscribe(`lobber/${GAME_ID}/#`, { qos: 0 }, (err) => {
        if (err) {
          ilog('mqtt subscribe FAILED', err);
        } else {
          ilog('mqtt subscribed', { filter: `lobber/${GAME_ID}/#` });
        }
      });
      if (!IS_MAN && !joinSent) {
        joinSent = true;
        setTimeout(publishJoin, 400);
      }
      if (localLocked && localEmoji) {
        publishPick(localEmoji);
        ilog('re-sent pick after reconnect', { emoji: localEmoji, levelId: selectedLevelIndex });
      }
      if (localStatus !== '—') {
        publishStatus(localStatus);
      }
      if (IS_MAN && phase !== 'pick') {
        publishSync();
      }
    });
    client.on('error', (err) => {
      ilog('mqtt error', err);
    });
    client.on('close', () => {
      ilog('mqtt close');
      localConnected = false;
      localConnecting = false;
      updateConn();
    });
    client.on('reconnect', () => {
      ilog('mqtt reconnecting…');
      localConnected = false;
      localConnecting = true;
      updateConn();
    });
    client.on('offline', () => {
      ilog('mqtt offline');
      localConnected = false;
      localConnecting = false;
      updateConn();
    });
    client.on('message', (topic, message) => {
      dlog('mqtt message', topic, message.length, 'bytes');
      const parts = topic.split('/');
      if (parts.length < 4) {
        dlog('skip topic (short)', topic);
        return;
      }
      const who = parts[2];
      const kind = parts[3];
      onRemoteMessage(who, kind, message);
    });
  }

  setScoreText();
  waitPartnerSince = Date.now();
  updatePickStatus();
  updateConn();
  updateStatusDisplay();
  setupMQTT();

  if (SOLO) {
    remoteEmoji = '🎮';
    remoteLocked = true;
    partnerOk = true;
    partnerTrying = false;
    playAlone = true;
    updatePickStatus();
    updateConn();
  }

  setInterval(() => {
    if (SOLO || playAlone || !client || !client.connected) {
      return;
    }
    publishStatus(localStatus);
    if (IS_MAN && phase === 'aim') {
      publishSync();
    }
  }, 4000);

  setInterval(() => {
    if (SOLO || playAlone) {
      return;
    }
    if (localLocked && !remoteLocked && localConnected && Date.now() - waitPartnerSince > JOIN_WAIT_MS) {
      enterPlayAlone();
    }
  }, 800);

  setInterval(() => {
    if (SOLO || playAlone) {
      return;
    }
    const now = Date.now();
    if (partnerOk && lastPartnerMsg > 0 && now - lastPartnerMsg > 90000) {
      partnerOk = false;
      updateConn();
    }
  }, 5000);

  updatePickStatus();

  setInterval(() => {
    if (pickOverlay && !pickOverlay.classList.contains('hidden') && localLocked && !remoteLocked && !playAlone && !SOLO) {
      updatePickStatus();
    }
  }, 1000);
})();
