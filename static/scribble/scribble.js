/**
 * MQTT 2-player DIY Scribble. Man (host) owns rounds, timer, word, strokes, guesses.
 * Guesser sees scrambled hint; drawer sees plain word. Letters reveal as timer runs down.
 * Expects window.SCRIBBLE_CONFIG: { role, localLabel, remoteLabel, accentLeft, accentRight }
 */
(function () {
  'use strict';

  const cfg = window.SCRIBBLE_CONFIG;
  if (!cfg) {
    console.error('SCRIBBLE_CONFIG missing');
    return;
  }

  const BROKER_URL = 'wss://test.mosquitto.org:8081';
  const GAME_ID =
    typeof window.ArcadeRoom !== 'undefined' && window.ArcadeRoom.getRoomId
      ? window.ArcadeRoom.getRoomId('scribble')
      : 'bens_arcade';
  const HOST_ID = 'Man';
  const GUEST_ID = 'Boy';
  const SETTINGS_LS = 'scribble_settings_v2';

  const WORDS = [
    'apple',
    'banana',
    'pizza',
    'rocket',
    'dragon',
    'penguin',
    'rainbow',
    'guitar',
    'castle',
    'dinosaur',
    'octopus',
    'tornado',
    'volcano',
    'wizard',
    'pirate',
    'unicorn',
    'sandwich',
    'bicycle',
    'campfire',
    'treasure',
    'spaceship',
    'waterfall',
    'snowman',
    'jellyfish',
    'lightning',
    'mushroom',
    'telescope',
    'coconut',
    'hamster',
    'popcorn',
    'ice cream',
    'hot dog',
    'roller coaster',
    'video game',
    'birthday cake',
    'solar system',
    'time machine',
  ];

  const W = 640;
  const H = 420;

  let audioCtx = null;
  function beep(freq, dur) {
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        return;
      }
    }
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = freq;
    o.type = 'square';
    g.gain.value = 0.035;
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + dur);
  }

  function defaultSettings() {
    return {
      drawTimeSec: 90,
      hintStartPct: 35,
      roundsToWin: 5,
      scrambleStyle: 'pool',
      useCustomWords: false,
      customWordsRaw: '',
    };
  }

  /** Skribbl-style: word;visible hint. Entries separated by comma, newline, or space (before next word;). */
  function parseCustomWords(raw) {
    const text = String(raw || '').trim();
    if (!text) {
      return [];
    }
    let chunks = [];
    if (/[\n,]/.test(text)) {
      chunks = text.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    } else if (text.includes(';')) {
      chunks = text.split(/\s+(?=[^\s;]+;)/).map((s) => s.trim()).filter(Boolean);
    } else {
      chunks = text.split(/\s+/).map((s) => s.trim()).filter(Boolean);
    }
    const out = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const semi = chunk.indexOf(';');
      if (semi >= 0) {
        const word = chunk.slice(0, semi).trim();
        const hint = chunk.slice(semi + 1).trim();
        if (word) {
          out.push({ word, hint });
        }
      } else if (chunk) {
        out.push({ word: chunk, hint: '' });
      }
    }
    return out;
  }

  function getWordPool(settings) {
    const custom = parseCustomWords(settings.customWordsRaw);
    if (settings.useCustomWords && custom.length) {
      return custom;
    }
    return WORDS.map((w) => ({ word: w, hint: '' }));
  }

  function pickWordEntry(settings) {
    const pool = getWordPool(settings);
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_LS);
      if (raw) {
        const p = JSON.parse(raw);
        return { ...defaultSettings(), ...p };
      }
    } catch (e) {
      /* ignore */
    }
    return defaultSettings();
  }

  function saveSettings(s) {
    try {
      localStorage.setItem(SETTINGS_LS, JSON.stringify(s));
    } catch (e) {
      /* ignore */
    }
  }

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  function hashSeed(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function seededShuffle(arr, seed) {
    const a = arr.slice();
    let s = seed >>> 0;
    for (let i = a.length - 1; i > 0; i--) {
      s = (Math.imul(1664525, s) + 1013904223) >>> 0;
      const j = s % (i + 1);
      const t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  function letterSlots(word) {
    const slots = [];
    for (let i = 0; i < word.length; i++) {
      const ch = word[i];
      if (ch === ' ') {
        slots.push({ type: 'space', i });
      } else {
        slots.push({ type: 'letter', i, ch: ch.toUpperCase() });
      }
    }
    return slots;
  }

  function revealCountForTimer(word, settings, timerEnd, now) {
    const letterCount = [...word].filter((c) => c !== ' ').length;
    if (!timerEnd || letterCount === 0) {
      return 0;
    }
    const totalMs = settings.drawTimeSec * 1000;
    const left = Math.max(0, timerEnd - now);
    const elapsed = totalMs - left;
    const startAt = (settings.hintStartPct / 100) * totalMs;
    if (elapsed < startAt) {
      return 0;
    }
    const span = Math.max(1, totalMs - startAt);
    const t = (elapsed - startAt) / span;
    return clamp(Math.floor(t * letterCount), 0, letterCount);
  }

  function buildGuesserHint(word, revealCount, roundSeed) {
    const slots = letterSlots(word);
    const letters = slots.filter((s) => s.type === 'letter');
    const n = letters.length;
    const revealN = clamp(revealCount, 0, n);
    const indices = letters.map((_, idx) => idx);
    const revealOrder = seededShuffle(indices, hashSeed(word + '|' + roundSeed));
    const revealedSet = new Set(revealOrder.slice(0, revealN));

    const unrevealedChars = [];
    letters.forEach((l, idx) => {
      if (!revealedSet.has(idx)) {
        unrevealedChars.push(l.ch);
      }
    });
    const scrambledPool = seededShuffle(unrevealedChars, hashSeed('pool|' + word + '|' + roundSeed));
    let poolIdx = 0;

    const out = [];
    let letterIdx = 0;
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (s.type === 'space') {
        out.push('  ');
        continue;
      }
      if (revealedSet.has(letterIdx)) {
        out.push(s.ch);
      } else if (poolIdx < scrambledPool.length) {
        out.push(scrambledPool[poolIdx++]);
      } else {
        out.push('_');
      }
      letterIdx++;
    }
    return out.join(' ');
  }

  function freshState(settings) {
    return {
      phase: 'lobby',
      drawer: 'Man',
      round: 0,
      roundSeed: 0,
      timerEnd: 0,
      scores: { Man: 0, Boy: 0 },
      settings: { ...settings },
      strokes: [],
      guesserHint: '',
      roundHint: '',
      drawerWord: '',
      lastGuess: '',
      roundWinner: null,
      message: 'Host: pick settings and start a round.',
    };
  }

  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const wordBar = document.getElementById('wordBar');
  const wordHintBar = document.getElementById('wordHintBar');
  const timerFill = document.getElementById('timerFill');
  const scoreEl = document.getElementById('score');
  const guessInput = document.getElementById('guessInput');
  const guessBtn = document.getElementById('guessBtn');

  function syncCanvasSize() {
    const wrap = document.getElementById('boardWrap');
    const maxW = Math.max(200, (wrap && wrap.clientWidth) || W);
    const maxH = Math.max(160, (wrap && wrap.clientHeight) || H);
    const s = Math.min(maxW / W, maxH / H, 1);
    canvas.style.width = `${Math.floor(W * s)}px`;
    canvas.style.height = `${Math.floor(H * s)}px`;
    canvas.width = W;
    canvas.height = H;
  }
  syncCanvasSize();
  window.addEventListener('resize', syncCanvasSize);
  const roEl = document.getElementById('boardWrap');
  if (roEl && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(syncCanvasSize).observe(roEl);
  }

  document.getElementById('gameInfo').innerHTML =
    `ROOM: <span class="highlight">${GAME_ID}</span> · YOU: <span class="highlight">${cfg.localLabel}</span> · ROLE: <span class="highlight">${cfg.role}</span>`;
  document.getElementById('brokerInfo').innerHTML =
    `MQTT WS: <span class="highlight">${BROKER_URL}</span>`;

  let localConnected = false;
  let localConnecting = true;
  let partnerOk = false;
  let partnerTrying = true;
  let lastPartnerMsg = 0;
  const connectStart = Date.now();
  const connectionInfo = document.getElementById('connectionInfo');

  function updateConn() {
    const b = localConnected ? 'BROKER OK' : localConnecting ? 'CONNECTING…' : 'OFFLINE';
    const bc = localConnected ? '#7dffb3' : localConnecting ? '#ffe08a' : '#ff6b6b';
    const p = partnerOk ? 'PARTNER LINKED' : partnerTrying ? 'WAITING…' : 'NO PARTNER';
    const pc = partnerOk ? '#7dffb3' : partnerTrying ? '#ffe08a' : '#ff6b6b';
    connectionInfo.innerHTML = `MQTT: <span style="color:${bc}">${b}</span> · PARTNER: <span style="color:${pc}">${p}</span>`;
  }
  updateConn();

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
    beep(520, 0.06);
  });

  let hostSecretWord = '';
  let hostRoundHint = '';
  let hostState = freshState(loadSettings());
  let guestMirror = freshState(loadSettings());

  function currentState() {
    return cfg.role === 'host' ? hostState : guestMirror;
  }

  function amDrawer(s) {
    const id = cfg.role === 'host' ? HOST_ID : GUEST_ID;
    return s.drawer === id;
  }

  function amGuesser(s) {
    return s.phase === 'draw' && !amDrawer(s);
  }

  function setWordHintBar(text, visible) {
    if (!wordHintBar) {
      return;
    }
    if (!visible || !text) {
      wordHintBar.textContent = '';
      wordHintBar.hidden = true;
      return;
    }
    wordHintBar.hidden = false;
    wordHintBar.textContent = text;
  }

  function updateWordDisplay(s) {
    const roundHint = cfg.role === 'host' ? hostRoundHint : s.roundHint || '';

    if (s.phase === 'lobby') {
      wordBar.textContent = s.message || 'Waiting…';
      wordBar.classList.remove('scrambled');
      setWordHintBar('', false);
      return;
    }
    if (s.phase === 'reveal') {
      const w =
        cfg.role === 'host'
          ? hostSecretWord
          : s.revealWord || s.drawerWord || (s.guesserHint || '').replace(/\s+/g, ' ');
      wordBar.textContent = (w || '???').toUpperCase();
      wordBar.classList.remove('scrambled');
      const hint = cfg.role === 'host' ? hostRoundHint : s.roundHint || '';
      setWordHintBar(hint, Boolean(hint));
      return;
    }
    if (s.phase !== 'draw') {
      wordBar.textContent = s.message || '';
      wordBar.classList.remove('scrambled');
      setWordHintBar('', false);
      return;
    }
    if (amDrawer(s)) {
      const w = cfg.role === 'host' ? hostSecretWord : s.drawerWord;
      wordBar.textContent = (w || '???').toUpperCase();
      wordBar.classList.remove('scrambled');
      setWordHintBar(roundHint ? `Clue: ${roundHint}` : '', Boolean(roundHint));
    } else {
      wordBar.textContent = s.guesserHint || '???';
      wordBar.classList.add('scrambled');
      setWordHintBar(roundHint, Boolean(roundHint));
    }
  }

  function updateTimerBar(s) {
    if (s.phase !== 'draw' || !s.timerEnd) {
      timerFill.style.transform = 'scaleX(1)';
      return;
    }
    const total = s.settings.drawTimeSec * 1000;
    const left = Math.max(0, s.timerEnd - Date.now());
    const pct = total > 0 ? left / total : 0;
    timerFill.style.transform = `scaleX(${pct})`;
  }

  function setScoreText(s) {
    const win = s.settings.roundsToWin;
    scoreEl.textContent = `MAN ${s.scores.Man} · BOY ${s.scores.Boy} · first to ${win}`;
  }

  function updateUiFromState(s) {
    setScoreText(s);
    updateWordDisplay(s);
    updateTimerBar(s);
    const drawing = s.phase === 'draw' && amDrawer(s);
    const guessing = amGuesser(s);
    canvas.classList.toggle('draw-disabled', !drawing);
    if (guessInput) {
      guessInput.disabled = !guessing;
    }
    if (guessBtn) {
      guessBtn.disabled = !guessing;
    }
    const tools = document.getElementById('drawTools');
    if (tools) {
      tools.style.display = drawing ? 'flex' : 'none';
    }
    const clearBtn = document.getElementById('clearCanvasBtn');
    if (clearBtn) {
      clearBtn.disabled = !drawing;
    }
  }

  function redrawCanvas(strokes) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    if (!strokes || !strokes.length) {
      return;
    }
    for (let i = 0; i < strokes.length; i++) {
      const st = strokes[i];
      if (!st.points || st.points.length < 2) {
        continue;
      }
      ctx.strokeStyle = st.color || '#111';
      ctx.lineWidth = st.width || 4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(st.points[0].x, st.points[0].y);
      for (let j = 1; j < st.points.length; j++) {
        ctx.lineTo(st.points[j].x, st.points[j].y);
      }
      ctx.stroke();
    }
  }

  function settingsForPublish(s) {
    return {
      drawTimeSec: s.drawTimeSec,
      hintStartPct: s.hintStartPct,
      roundsToWin: s.roundsToWin,
      scrambleStyle: s.scrambleStyle,
      useCustomWords: Boolean(s.useCustomWords),
      customWordCount: parseCustomWords(s.customWordsRaw).length,
    };
  }

  function publishPayload() {
    const pub = {
      phase: hostState.phase,
      drawer: hostState.drawer,
      round: hostState.round,
      roundSeed: hostState.roundSeed,
      timerEnd: hostState.timerEnd,
      scores: hostState.scores,
      settings: settingsForPublish(hostState.settings),
      strokes: hostState.strokes,
      guesserHint: hostState.guesserHint,
      roundHint: hostRoundHint,
      lastGuess: hostState.lastGuess,
      roundWinner: hostState.roundWinner,
      message: hostState.message,
    };
    if (hostState.drawer === GUEST_ID && hostState.phase === 'draw') {
      pub.drawerWord = hostSecretWord;
    }
    if (hostState.phase === 'reveal') {
      pub.revealWord = hostSecretWord;
    }
    return pub;
  }

  let client = null;
  let lastStatePublishMs = 0;
  let lastHintOnlyPublishMs = 0;
  const STATE_PUBLISH_MIN_MS = 90;
  const HINT_PUBLISH_MIN_MS = 500;

  function publishStatus(s) {
    if (client && client.connected) {
      const id = cfg.role === 'host' ? HOST_ID : GUEST_ID;
      client.publish(`scribble/${GAME_ID}/${id}/status`, s);
    }
  }

  function publishGameState(opts) {
    if (!client || !client.connected || cfg.role !== 'host') {
      return;
    }
    const now = Date.now();
    const force = Boolean(opts && opts.force);
    const minGap = force ? STATE_PUBLISH_MIN_MS : HINT_PUBLISH_MIN_MS;
    if (!force && now - lastStatePublishMs < minGap) {
      return;
    }
    lastStatePublishMs = now;
    if (!force) {
      lastHintOnlyPublishMs = now;
    }
    client.publish(`scribble/${GAME_ID}/${HOST_ID}/state`, JSON.stringify(publishPayload()));
  }

  function publishGuestAction(payload) {
    if (!client || !client.connected || cfg.role !== 'guest') {
      return;
    }
    client.publish(`scribble/${GAME_ID}/${GUEST_ID}/action`, JSON.stringify(payload));
  }

  function readHostSettingsFromDom() {
    const s = { ...hostState.settings };
    const drawTime = document.getElementById('setDrawTime');
    const hintStart = document.getElementById('setHintStart');
    const roundsWin = document.getElementById('setRoundsWin');
    const scramble = document.getElementById('setScramble');
    if (drawTime) {
      s.drawTimeSec = clamp(parseInt(drawTime.value, 10) || 90, 20, 180);
    }
    if (hintStart) {
      s.hintStartPct = clamp(parseInt(hintStart.value, 10) || 35, 0, 90);
    }
    if (roundsWin) {
      s.roundsToWin = clamp(parseInt(roundsWin.value, 10) || 5, 1, 20);
    }
    if (scramble) {
      s.scrambleStyle = scramble.value === 'pool' ? 'pool' : 'pool';
    }
    const useCustom = document.getElementById('setUseCustomWords');
    const customRaw = document.getElementById('setCustomWords');
    if (useCustom) {
      s.useCustomWords = useCustom.checked;
    }
    if (customRaw) {
      s.customWordsRaw = customRaw.value;
    }
    return s;
  }

  function updateCustomWordsCount() {
    const el = document.getElementById('customWordsCount');
    const raw = document.getElementById('setCustomWords');
    if (!el || !raw) {
      return;
    }
    const n = parseCustomWords(raw.value).length;
    el.textContent = n ? `${n} word${n === 1 ? '' : 's'} parsed` : 'No words parsed yet';
  }

  function applySettingsToDom(s) {
    const drawTime = document.getElementById('setDrawTime');
    const hintStart = document.getElementById('setHintStart');
    const roundsWin = document.getElementById('setRoundsWin');
    const useCustom = document.getElementById('setUseCustomWords');
    const customRaw = document.getElementById('setCustomWords');
    if (drawTime) {
      drawTime.value = String(s.drawTimeSec);
    }
    if (hintStart) {
      hintStart.value = String(s.hintStartPct);
    }
    if (roundsWin) {
      roundsWin.value = String(s.roundsToWin);
    }
    if (useCustom) {
      useCustom.checked = Boolean(s.useCustomWords);
    }
    if (customRaw) {
      customRaw.value = s.customWordsRaw || '';
    }
    updateCustomWordsCount();
  }

  function hostRefreshHint() {
    if (hostState.phase !== 'draw') {
      return;
    }
    const rc = revealCountForTimer(hostSecretWord, hostState.settings, hostState.timerEnd, Date.now());
    hostState.guesserHint = buildGuesserHint(hostSecretWord, rc, hostState.roundSeed);
  }

  let refreshStartBtnLabel = function () {};

  function endRoundHost(reason, winner) {
    hostState.phase = 'reveal';
    hostState.roundWinner = winner;
    refreshStartBtnLabel();
    if (winner === 'Man' || winner === 'Boy') {
      hostState.scores[winner] += 1;
      hostState.message = `${winner} guessed it!`;
      beep(720, 0.12);
    } else {
      hostState.message = reason || 'Time is up!';
      beep(200, 0.1);
    }
    const winTarget = hostState.settings.roundsToWin;
    if (hostState.scores.Man >= winTarget) {
      hostState.message = 'MAN WINS THE MATCH!';
    } else if (hostState.scores.Boy >= winTarget) {
      hostState.message = 'BOY WINS THE MATCH!';
    }
    publishGameState({ force: true });
  }

  function startRoundHost() {
    if (hostState.scores.Man >= hostState.settings.roundsToWin || hostState.scores.Boy >= hostState.settings.roundsToWin) {
      hostState.scores = { Man: 0, Boy: 0 };
      hostState.message = 'New match — scores reset.';
    }
    hostState.settings = readHostSettingsFromDom();
    saveSettings(hostState.settings);
    const entry = pickWordEntry(hostState.settings);
    hostSecretWord = entry.word;
    hostRoundHint = entry.hint || '';
    hostState.roundHint = hostRoundHint;
    hostState.round += 1;
    hostState.roundSeed = hashSeed(hostSecretWord + '|' + hostState.round);
    hostState.strokes = [];
    hostState.lastGuess = '';
    hostState.roundWinner = null;
    hostState.phase = 'draw';
    hostState.timerEnd = Date.now() + hostState.settings.drawTimeSec * 1000;
    hostState.message = `${hostState.drawer} is drawing…`;
    hostRefreshHint();
    publishGameState({ force: true });
    beep(440, 0.06);
  }

  function nextDrawerAfterRound() {
    hostState.drawer = hostState.drawer === 'Man' ? 'Boy' : 'Man';
  }

  function checkGuessHost(text) {
    if (hostState.phase !== 'draw') {
      return;
    }
    const guess = String(text || '')
      .trim()
      .toLowerCase();
    if (!guess) {
      return;
    }
    hostState.lastGuess = guess;
    const target = hostSecretWord.toLowerCase();
    if (guess === target) {
      const winner = hostState.drawer === 'Man' ? 'Boy' : 'Man';
      endRoundHost('correct', winner);
      return;
    }
    hostState.message = `Nope: "${guess}"`;
    publishGameState({ force: true });
    beep(140, 0.03);
  }

  function mergeGuestState(data) {
    if (!data || typeof data !== 'object') {
      return;
    }
    guestMirror = {
      phase: data.phase || 'lobby',
      drawer: data.drawer === 'Boy' ? 'Boy' : 'Man',
      round: data.round | 0,
      roundSeed: data.roundSeed | 0,
      timerEnd: data.timerEnd | 0,
      scores: {
        Man: (data.scores && data.scores.Man) | 0,
        Boy: (data.scores && data.scores.Boy) | 0,
      },
      settings: { ...defaultSettings(), ...(data.settings || {}) },
      strokes: Array.isArray(data.strokes) ? data.strokes : [],
      guesserHint: data.guesserHint || '',
      roundHint: data.roundHint || '',
      drawerWord: data.drawerWord || '',
      revealWord: data.revealWord || '',
      lastGuess: data.lastGuess || '',
      roundWinner: data.roundWinner || null,
      message: data.message || '',
    };
    updateUiFromState(guestMirror);
    redrawCanvas(guestMirror.strokes);
  }

  if (cfg.role === 'host') {
    applySettingsToDom(hostState.settings);
    const fs = document.getElementById('hostSettings');
    if (fs) {
      fs.querySelectorAll('input, select, textarea').forEach((el) => {
        const evt = el.tagName === 'TEXTAREA' ? 'input' : 'change';
        el.addEventListener(evt, () => {
          hostState.settings = readHostSettingsFromDom();
          saveSettings(hostState.settings);
          updateCustomWordsCount();
          publishGameState({ force: true });
        });
      });
    }
    const startBtn = document.getElementById('startRoundBtn');
    refreshStartBtnLabel = function () {
      if (!startBtn) {
        return;
      }
      if (hostState.phase === 'draw') {
        startBtn.textContent = 'End round early';
      } else if (hostState.phase === 'reveal') {
        startBtn.textContent = 'Next round';
      } else {
        startBtn.textContent = 'Start round';
      }
    };
    refreshStartBtnLabel();
    if (startBtn) {
      startBtn.addEventListener('click', () => {
        if (hostState.phase === 'draw') {
          endRoundHost('skipped', null);
          refreshStartBtnLabel();
          return;
        }
        if (hostState.phase === 'reveal') {
          nextDrawerAfterRound();
          hostState.phase = 'lobby';
          hostState.message = `Next: ${hostState.drawer} draws. Host starts round.`;
          publishGameState({ force: true });
          refreshStartBtnLabel();
          return;
        }
        startRoundHost();
        refreshStartBtnLabel();
      });
    }
  } else {
    const startBtn = document.getElementById('startRoundBtn');
    if (startBtn) {
      startBtn.style.display = 'none';
    }
  }

  if (guessBtn && guessInput) {
    const submitGuess = () => {
      const s = currentState();
      if (!amGuesser(s)) {
        return;
      }
      const text = guessInput.value;
      if (cfg.role === 'host') {
        checkGuessHost(text);
        guessInput.value = '';
      } else {
        publishGuestAction({ guess: text });
        guessInput.value = '';
        beep(400, 0.04);
      }
    };
    guessBtn.addEventListener('click', submitGuess);
    guessInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        submitGuess();
      }
    });
  }

  const clearBtn = document.getElementById('clearCanvasBtn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      const s = currentState();
      if (!amDrawer(s)) {
        return;
      }
      if (cfg.role === 'host') {
        hostState.strokes = [];
        publishGameState({ force: true });
      } else {
        publishGuestAction({ clearCanvas: true });
      }
      redrawCanvas([]);
      beep(300, 0.04);
    });
  }

  let drawColor = '#111111';
  let drawWidth = 6;
  let drawing = false;
  let currentStroke = null;

  const colorInput = document.getElementById('penColor');
  const widthInput = document.getElementById('penWidth');
  if (colorInput) {
    colorInput.addEventListener('input', () => {
      drawColor = colorInput.value;
    });
  }
  if (widthInput) {
    widthInput.addEventListener('input', () => {
      drawWidth = parseInt(widthInput.value, 10) || 6;
    });
  }

  function pointerToCanvas(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  function appendPoint(stroke, x, y) {
    const pts = stroke.points;
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(last.x - x, last.y - y) > 1.5) {
      pts.push({ x, y });
    }
  }

  function pushStrokeHost(stroke) {
    hostState.strokes.push(stroke);
    publishGameState({ force: true });
  }

  function onPointerDown(e) {
    const s = currentState();
    if (!amDrawer(s) || s.phase !== 'draw') {
      return;
    }
    e.preventDefault();
    const p = pointerToCanvas(e.clientX, e.clientY);
    drawing = true;
    currentStroke = { color: drawColor, width: drawWidth, points: [p] };
    redrawCanvas(s.strokes);
    if (currentStroke.points.length >= 1) {
      ctx.strokeStyle = currentStroke.color;
      ctx.lineWidth = currentStroke.width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + 0.1, p.y + 0.1);
      ctx.stroke();
    }
  }

  function onPointerMove(e) {
    if (!drawing || !currentStroke) {
      return;
    }
    e.preventDefault();
    const p = pointerToCanvas(e.clientX, e.clientY);
    appendPoint(currentStroke, p.x, p.y);
    const s = currentState();
    const strokes = s.strokes.slice();
    strokes.push(currentStroke);
    redrawCanvas(strokes);
  }

  function onPointerUp(e) {
    if (!drawing || !currentStroke) {
      return;
    }
    e.preventDefault();
    drawing = false;
    if (currentStroke.points.length < 2) {
      currentStroke = null;
      return;
    }
    if (cfg.role === 'host') {
      pushStrokeHost(currentStroke);
    } else {
      publishGuestAction({ stroke: currentStroke });
    }
    currentStroke = null;
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointerleave', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);

  updateUiFromState(currentState());
  redrawCanvas(currentState().strokes);

  function hostTick() {
    if (hostState.phase !== 'draw') {
      return;
    }
    hostRefreshHint();
    const now = Date.now();
    if (now >= hostState.timerEnd) {
      endRoundHost('Time is up!', null);
      return;
    }
    updateWordDisplay(hostState);
    updateTimerBar(hostState);
  }

  setInterval(() => {
    if (cfg.role === 'host') {
      hostTick();
      if (hostState.phase === 'draw') {
        const now = Date.now();
        if (now - lastHintOnlyPublishMs >= HINT_PUBLISH_MIN_MS) {
          publishGameState();
        }
      }
    } else {
      const s = guestMirror;
      if (s.phase === 'draw') {
        updateWordDisplay(s);
        updateTimerBar(s);
      }
    }
  }, 250);

  function setupMQTT() {
    client = mqtt.connect(BROKER_URL, {
      reconnectPeriod: 4000,
      connectTimeout: 15000,
      keepalive: 30,
    });
    client.on('error', () => {
      localConnected = false;
      localConnecting = false;
      updateConn();
    });
    client.on('connect', () => {
      localConnected = true;
      localConnecting = false;
      updateConn();
      if (cfg.role === 'host') {
        client.subscribe(`scribble/${GAME_ID}/${GUEST_ID}/action`);
        client.subscribe(`scribble/${GAME_ID}/+/status`);
        publishGameState({ force: true });
      } else {
        client.subscribe(`scribble/${GAME_ID}/${HOST_ID}/state`);
        client.subscribe(`scribble/${GAME_ID}/+/status`);
      }
      if (localStatus !== '—') {
        publishStatus(localStatus);
      }
    });
    client.on('close', () => {
      localConnected = false;
      localConnecting = false;
      updateConn();
    });
    client.on('reconnect', () => {
      localConnected = false;
      localConnecting = true;
      updateConn();
    });
    client.on('offline', () => {
      localConnected = false;
      localConnecting = false;
      updateConn();
    });
    client.on('message', (topic, message) => {
      const parts = topic.split('/');
      const who = parts[2];
      const kind = parts[3];
      if (kind === 'status') {
        if (who === (cfg.role === 'host' ? GUEST_ID : HOST_ID)) {
          remoteStatus = message.toString();
          updateStatusDisplay();
          partnerOk = true;
          partnerTrying = false;
          lastPartnerMsg = Date.now();
          updateConn();
        }
        return;
      }
      if (cfg.role === 'host' && kind === 'action' && who === GUEST_ID) {
        try {
          const data = JSON.parse(message.toString());
          if (data.clearCanvas && hostState.drawer === GUEST_ID && hostState.phase === 'draw') {
            hostState.strokes = [];
            publishGameState({ force: true });
          }
          if (data.stroke && hostState.drawer === GUEST_ID && hostState.phase === 'draw') {
            hostState.strokes.push(data.stroke);
            publishGameState({ force: true });
          }
          if (typeof data.guess === 'string') {
            checkGuessHost(data.guess);
          }
          partnerOk = true;
          partnerTrying = false;
          lastPartnerMsg = Date.now();
          updateConn();
        } catch (err) {
          /* ignore */
        }
        return;
      }
      if (cfg.role === 'guest' && kind === 'state' && who === HOST_ID) {
        try {
          const data = JSON.parse(message.toString());
          mergeGuestState(data);
          partnerOk = true;
          partnerTrying = false;
          lastPartnerMsg = Date.now();
          updateConn();
        } catch (err) {
          /* ignore */
        }
      }
    });
  }

  setupMQTT();

  setInterval(() => {
    if (client && client.connected) {
      publishStatus(localStatus);
    }
  }, 3000);

  setInterval(() => {
    if (cfg.role === 'host' && client && client.connected) {
      publishGameState({ force: true });
    }
  }, 5000);

  setInterval(() => {
    const now = Date.now();
    if (partnerOk && now - lastPartnerMsg > 8000) {
      partnerOk = false;
      partnerTrying = false;
      updateConn();
    }
    if (partnerTrying && now - connectStart > 12000 && lastPartnerMsg === 0) {
      partnerTrying = false;
      updateConn();
    }
  }, 1000);
})();
