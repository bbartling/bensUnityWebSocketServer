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
   * Five Angry-Birds-style stages: wider/taller world = more “zoomed out” on the same canvas.
   * Coordinates are in world space; rendering scales world → 900×520 canvas.
   */
  const LEVELS = [
    {
      id: 0,
      name: '1 · Training',
      worldW: 900,
      worldH: 520,
      towers(base) {
        return [
          { id: 10, x: 540, y: base - 68, w: 48, h: 68, hp: 2, kind: 'wood', pts: 80, emoji: '' },
          { id: 11, x: 598, y: base - 68, w: 48, h: 68, hp: 2, kind: 'wood', pts: 80, emoji: '' },
          { id: 12, x: 656, y: base - 68, w: 48, h: 68, hp: 2, kind: 'wood', pts: 80, emoji: '' },
          { id: 13, x: 714, y: base - 68, w: 48, h: 68, hp: 2, kind: 'wood', pts: 80, emoji: '' },
          { id: 14, x: 575, y: base - 136, w: 54, h: 54, hp: 1, kind: 'villain', pts: 420, emoji: '🐷' },
          { id: 15, x: 640, y: base - 136, w: 54, h: 54, hp: 1, kind: 'villain', pts: 480, emoji: '👹' },
          { id: 16, x: 705, y: base - 136, w: 54, h: 54, hp: 1, kind: 'villain', pts: 450, emoji: '🦇' },
          { id: 17, x: 610, y: base - 200, w: 44, h: 44, hp: 2, kind: 'stone', pts: 130, emoji: '' },
          { id: 18, x: 668, y: base - 200, w: 44, h: 44, hp: 2, kind: 'stone', pts: 130, emoji: '' },
          { id: 19, x: 639, y: base - 252, w: 50, h: 50, hp: 1, kind: 'villain', pts: 600, emoji: '👿' },
        ];
      },
    },
    {
      id: 1,
      name: '2 · Outpost',
      worldW: 1100,
      worldH: 520,
      towers(base) {
        const w = 1100;
        const rx = w - 420;
        return [
          { id: 20, x: rx, y: base - 52, w: 44, h: 52, hp: 2, kind: 'wood', pts: 75, emoji: '' },
          { id: 21, x: rx + 52, y: base - 52, w: 44, h: 52, hp: 2, kind: 'wood', pts: 75, emoji: '' },
          { id: 22, x: rx + 104, y: base - 52, w: 44, h: 52, hp: 2, kind: 'wood', pts: 75, emoji: '' },
          { id: 23, x: rx + 156, y: base - 52, w: 44, h: 52, hp: 2, kind: 'wood', pts: 75, emoji: '' },
          { id: 24, x: rx + 26, y: base - 110, w: 50, h: 50, hp: 1, kind: 'villain', pts: 400, emoji: '🐗' },
          { id: 25, x: rx + 92, y: base - 110, w: 50, h: 50, hp: 1, kind: 'villain', pts: 400, emoji: '🐷' },
          { id: 26, x: rx + 158, y: base - 110, w: 50, h: 50, hp: 1, kind: 'villain', pts: 400, emoji: '🦇' },
          { id: 27, x: rx + 60, y: base - 168, w: 42, h: 42, hp: 3, kind: 'stone', pts: 150, emoji: '' },
          { id: 28, x: rx + 118, y: base - 168, w: 42, h: 42, hp: 3, kind: 'stone', pts: 150, emoji: '' },
          { id: 29, x: rx + 300, y: base - 120, w: 40, h: 100, hp: 2, kind: 'wood', pts: 90, emoji: '' },
          { id: 30, x: rx + 270, y: base - 220, w: 48, h: 48, hp: 1, kind: 'villain', pts: 520, emoji: '👹' },
        ];
      },
    },
    {
      id: 2,
      name: '3 · Fort',
      worldW: 1320,
      worldH: 540,
      towers(base) {
        const w = 1320;
        const a = w - 520;
        const b = w - 280;
        return [
          { id: 40, x: a, y: base - 48, w: 40, h: 48, hp: 2, kind: 'wood', pts: 70, emoji: '' },
          { id: 41, x: a + 48, y: base - 48, w: 40, h: 48, hp: 2, kind: 'wood', pts: 70, emoji: '' },
          { id: 42, x: a + 96, y: base - 48, w: 40, h: 48, hp: 2, kind: 'wood', pts: 70, emoji: '' },
          { id: 43, x: a + 24, y: base - 100, w: 46, h: 46, hp: 1, kind: 'villain', pts: 380, emoji: '🐷' },
          { id: 44, x: a + 82, y: base - 100, w: 46, h: 46, hp: 1, kind: 'villain', pts: 380, emoji: '🦎' },
          { id: 45, x: a + 48, y: base - 158, w: 40, h: 40, hp: 4, kind: 'stone', pts: 160, emoji: '' },
          { id: 46, x: b, y: base - 56, w: 44, h: 56, hp: 2, kind: 'wood', pts: 85, emoji: '' },
          { id: 47, x: b + 52, y: base - 56, w: 44, h: 56, hp: 2, kind: 'wood', pts: 85, emoji: '' },
          { id: 48, x: b + 26, y: base - 120, w: 52, h: 52, hp: 1, kind: 'villain', pts: 440, emoji: '👿' },
          { id: 49, x: b + 10, y: base - 188, w: 38, h: 38, hp: 3, kind: 'stone', pts: 140, emoji: '' },
          { id: 50, x: b + 58, y: base - 188, w: 38, h: 38, hp: 3, kind: 'stone', pts: 140, emoji: '' },
          { id: 51, x: b + 34, y: base - 240, w: 48, h: 48, hp: 1, kind: 'villain', pts: 650, emoji: '🐉' },
        ];
      },
    },
    {
      id: 3,
      name: '4 · Citadel',
      worldW: 1560,
      worldH: 560,
      towers(base) {
        const w = 1560;
        const c1 = w - 620;
        const c2 = w - 400;
        const c3 = w - 200;
        return [
          { id: 60, x: c1, y: base - 44, w: 38, h: 44, hp: 2, kind: 'wood', pts: 65, emoji: '' },
          { id: 61, x: c1 + 44, y: base - 44, w: 38, h: 44, hp: 2, kind: 'wood', pts: 65, emoji: '' },
          { id: 62, x: c1 + 88, y: base - 44, w: 38, h: 44, hp: 2, kind: 'wood', pts: 65, emoji: '' },
          { id: 63, x: c1 + 44, y: base - 96, w: 44, h: 44, hp: 1, kind: 'villain', pts: 360, emoji: '🐷' },
          { id: 64, x: c1 + 20, y: base - 150, w: 36, h: 36, hp: 4, kind: 'stone', pts: 170, emoji: '' },
          { id: 65, x: c1 + 68, y: base - 150, w: 36, h: 36, hp: 4, kind: 'stone', pts: 170, emoji: '' },
          { id: 66, x: c1 + 44, y: base - 200, w: 46, h: 46, hp: 1, kind: 'villain', pts: 700, emoji: '👹' },
          { id: 67, x: c2, y: base - 50, w: 42, h: 50, hp: 2, kind: 'wood', pts: 80, emoji: '' },
          { id: 68, x: c2 + 54, y: base - 50, w: 42, h: 50, hp: 2, kind: 'wood', pts: 80, emoji: '' },
          { id: 69, x: c2 + 27, y: base - 110, w: 48, h: 48, hp: 1, kind: 'villain', pts: 420, emoji: '🦇' },
          { id: 70, x: c3, y: base - 40, w: 36, h: 120, hp: 2, kind: 'wood', pts: 95, emoji: '' },
          { id: 71, x: c3 - 8, y: base - 175, w: 52, h: 52, hp: 1, kind: 'villain', pts: 480, emoji: '🐗' },
          { id: 72, x: c3 + 48, y: base - 175, w: 44, h: 44, hp: 2, kind: 'stone', pts: 135, emoji: '' },
        ];
      },
    },
    {
      id: 4,
      name: '5 · Stronghold',
      worldW: 1780,
      worldH: 600,
      towers(base) {
        const w = 1780;
        const z = w - 720;
        const y2 = w - 460;
        const y3 = w - 240;
        return [
          { id: 80, x: z, y: base - 40, w: 36, h: 40, hp: 2, kind: 'wood', pts: 60, emoji: '' },
          { id: 81, x: z + 40, y: base - 40, w: 36, h: 40, hp: 2, kind: 'wood', pts: 60, emoji: '' },
          { id: 82, x: z + 80, y: base - 40, w: 36, h: 40, hp: 2, kind: 'wood', pts: 60, emoji: '' },
          { id: 83, x: z + 120, y: base - 40, w: 36, h: 40, hp: 2, kind: 'wood', pts: 60, emoji: '' },
          { id: 84, x: z + 20, y: base - 88, w: 40, h: 40, hp: 1, kind: 'villain', pts: 320, emoji: '🐷' },
          { id: 85, x: z + 64, y: base - 88, w: 40, h: 40, hp: 1, kind: 'villain', pts: 320, emoji: '🐷' },
          { id: 86, x: z + 108, y: base - 88, w: 40, h: 40, hp: 1, kind: 'villain', pts: 320, emoji: '🐷' },
          { id: 87, x: z + 44, y: base - 136, w: 34, h: 34, hp: 5, kind: 'stone', pts: 180, emoji: '' },
          { id: 88, x: z + 86, y: base - 136, w: 34, h: 34, hp: 5, kind: 'stone', pts: 180, emoji: '' },
          { id: 89, x: z + 55, y: base - 188, w: 44, h: 44, hp: 1, kind: 'villain', pts: 800, emoji: '👿' },
          { id: 90, x: y2, y: base - 48, w: 40, h: 52, hp: 2, kind: 'wood', pts: 75, emoji: '' },
          { id: 91, x: y2 + 50, y: base - 48, w: 40, h: 52, hp: 2, kind: 'wood', pts: 75, emoji: '' },
          { id: 92, x: y2 + 24, y: base - 108, w: 48, h: 48, hp: 1, kind: 'villain', pts: 500, emoji: '🐉' },
          { id: 93, x: y2 + 8, y: base - 168, w: 38, h: 38, hp: 3, kind: 'stone', pts: 145, emoji: '' },
          { id: 94, x: y3, y: base - 44, w: 38, h: 44, hp: 2, kind: 'wood', pts: 70, emoji: '' },
          { id: 95, x: y3 + 44, y: base - 44, w: 38, h: 44, hp: 2, kind: 'wood', pts: 70, emoji: '' },
          { id: 96, x: y3 + 22, y: base - 100, w: 46, h: 46, hp: 1, kind: 'villain', pts: 450, emoji: '🦇' },
          { id: 97, x: y3 + 6, y: base - 158, w: 50, h: 50, hp: 1, kind: 'villain', pts: 580, emoji: '👹' },
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
    el.innerHTML = `GAME: <span class="highlight">${GAME_ID}</span> · YOU: <span class="highlight">${PLAYER_ID}</span> · ${IS_MAN ? 'HOST' : 'JOIN'} · <span class="highlight">${L.name}</span> <span style="opacity:0.75">(${WORLD_W}×${WORLD_H})</span>`;
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
      b.title = `${L.name} — world ${L.worldW}×${L.worldH}`;
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
          t.hp = row.hp;
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
      if (b.hp <= 0 || b.id === broken.id) {
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

    const spd = Math.hypot(p.vx, p.vy);
    const grounded = p.y + er >= GROUND_Y - 0.5;
    const oob = p.x > WORLD_W + 140 || p.x < -140;
    const settled = grounded && spd < 2.05;
    if (oob || settled) {
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
