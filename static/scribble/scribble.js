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

  const W = 1280;
  const H = 840;
  const REVEAL_AUTO_MS = 4000;
  const GUESS_POPUP_MS = 2200;

  let audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        return false;
      }
    }
    return true;
  }

  function toneAt(freq, start, dur, type, vol) {
    if (!ensureAudio()) {
      return;
    }
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type || 'square';
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol || 0.045, start);
    g.gain.exponentialRampToValueAtTime(0.001, start + dur);
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start(start);
    o.stop(start + dur + 0.02);
  }

  function beep(freq, dur) {
    if (!ensureAudio()) {
      return;
    }
    toneAt(freq, audioCtx.currentTime, dur, 'square', 0.035);
  }

  /** Classic game-show wrong buzzer */
  function sfxWrong() {
    if (!ensureAudio()) {
      return;
    }
    const t = audioCtx.currentTime;
    toneAt(220, t, 0.18, 'sawtooth', 0.07);
    toneAt(180, t + 0.14, 0.22, 'sawtooth', 0.06);
    toneAt(140, t + 0.32, 0.28, 'triangle', 0.05);
  }

  /** Short fanfare when someone guesses correctly */
  function sfxWin() {
    if (!ensureAudio()) {
      return;
    }
    const t = audioCtx.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => {
      toneAt(f, t + i * 0.11, 0.16, 'square', 0.05);
    });
    toneAt(1047, t + 0.48, 0.35, 'square', 0.04);
  }

  /** Countdown-expired buzzer */
  function sfxTimesUp() {
    if (!ensureAudio()) {
      return;
    }
    const t = audioCtx.currentTime;
    for (let i = 0; i < 10; i++) {
      toneAt(380 - i * 8, t + i * 0.09, 0.08, 'square', 0.06);
    }
    toneAt(120, t + 0.95, 0.45, 'sawtooth', 0.07);
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

  function buildWordDeck(settings) {
    const pool = getWordPool(settings);
    const seed = hashSeed(
      GAME_ID + '|' + (settings.useCustomWords ? settings.customWordsRaw : 'builtin') + '|' + pool.length,
    );
    return seededShuffle(pool.slice(), seed);
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
      guessLog: [],
      wordNum: 0,
      deckTotal: 0,
      roundWinner: null,
      message: 'Host: load words, pick settings, then Start game.',
    };
  }

  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const wordBar = document.getElementById('wordBar');
  const wordHintBar = document.getElementById('wordHintBar');
  const timerRow = document.getElementById('timerRow');
  const timerText = document.getElementById('timerText');
  const timerFill = document.getElementById('timerFill');
  const guessFeed = document.getElementById('guessFeed');
  const guessPopup = document.getElementById('guessPopup');
  const scoreEl = document.getElementById('score');
  const guessInput = document.getElementById('guessInput');
  const guessBtn = document.getElementById('guessBtn');

  let hostWordDeck = [];
  let hostDeckIndex = 0;
  let autoNextTimer = null;
  let guessPopupTimer = null;
  let seenGuessCount = 0;

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
  document.getElementById('brokerInfo').innerHTML = 'MQTT: <span class="highlight">connecting…</span>';

  let localConnected = false;
  let partnerOk = false;
  let partnerTrying = true;
  let lastPartnerMsg = 0;
  const connectStart = Date.now();
  const connectionInfo = document.getElementById('connectionInfo');
  let mqttLink = null;

  function syncPartnerUi() {
    if (!mqttLink) {
      return;
    }
    if (partnerOk) {
      mqttLink.setPartner('linked');
    } else if (partnerTrying) {
      mqttLink.setPartner('waiting', 'Open ' + cfg.remoteLabel + ' with same ?room=, then Send ready ping.');
    } else {
      mqttLink.setPartner('none');
    }
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

  function formatTimerMs(ms) {
    const sec = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m + ':' + String(s).padStart(2, '0');
  }

  function updateTimerBar(s) {
    const show = s.phase === 'draw' && s.timerEnd;
    if (timerRow) {
      timerRow.hidden = !show;
    }
    if (!show) {
      if (timerFill) {
        timerFill.style.transform = 'scaleX(1)';
      }
      if (timerText) {
        timerText.textContent = '—';
        timerText.classList.remove('urgent');
      }
      return;
    }
    const total = s.settings.drawTimeSec * 1000;
    const left = Math.max(0, s.timerEnd - Date.now());
    const pct = total > 0 ? left / total : 0;
    if (timerFill) {
      timerFill.style.transform = 'scaleX(' + pct + ')';
    }
    if (timerText) {
      timerText.textContent = formatTimerMs(left);
      timerText.classList.toggle('urgent', left <= 10000);
    }
  }

  function renderGuessFeed(log) {
    if (!guessFeed) {
      return;
    }
    guessFeed.innerHTML = '';
    const items = Array.isArray(log) ? log : [];
    for (let i = 0; i < items.length; i++) {
      const g = items[i];
      const el = document.createElement('div');
      el.className = 'guess-feed-item ' + (g.correct ? 'win' : 'wrong');
      el.textContent = g.correct
        ? g.player + ' guessed it: "' + g.text + '"'
        : g.player + ' tried: "' + g.text + '"';
      guessFeed.appendChild(el);
    }
    if (guessFeed.lastElementChild) {
      guessFeed.lastElementChild.scrollIntoView({ block: 'nearest' });
    }
  }

  function showGuessPopup(kind, title, sub) {
    if (!guessPopup) {
      return;
    }
    guessPopup.hidden = false;
    guessPopup.className = kind;
    guessPopup.innerHTML =
      '<div class="guess-popup-card"><div class="guess-popup-title">' +
      title +
      '</div><div class="guess-popup-sub">' +
      (sub || '') +
      '</div></div>';
    clearTimeout(guessPopupTimer);
    guessPopupTimer = setTimeout(function () {
      guessPopup.hidden = true;
    }, GUESS_POPUP_MS);
  }

  function syncGuessUi(s) {
    const log = s.guessLog || [];
    renderGuessFeed(log);
    while (seenGuessCount < log.length) {
      const g = log[seenGuessCount];
      if (g.correct) {
        showGuessPopup('win', g.player + ' got it!', '"' + g.text + '"');
        sfxWin();
      } else {
        showGuessPopup('wrong', 'Wrong guess', g.player + ': "' + g.text + '"');
        sfxWrong();
      }
      seenGuessCount += 1;
    }
  }

  function pushGuessLog(player, text, correct) {
    const entry = { player: player, text: text, correct: correct };
    hostState.guessLog.push(entry);
    if (hostState.guessLog.length > 20) {
      hostState.guessLog.shift();
    }
    hostState.lastGuess = text;
    seenGuessCount = hostState.guessLog.length;
    renderGuessFeed(hostState.guessLog);
    if (correct) {
      showGuessPopup('win', player + ' got it!', '"' + text + '"');
      sfxWin();
    } else {
      showGuessPopup('wrong', 'Wrong guess', player + ': "' + text + '"');
      sfxWrong();
    }
  }

  function setScoreText(s) {
    const win = s.settings.roundsToWin;
    let txt = 'MAN ' + s.scores.Man + ' · BOY ' + s.scores.Boy;
    if (s.deckTotal > 0 && s.wordNum > 0) {
      txt += ' · word ' + s.wordNum + '/' + s.deckTotal;
    }
    txt += ' · first to ' + win;
    scoreEl.textContent = txt;
  }

  function updateUiFromState(s) {
    setScoreText(s);
    updateWordDisplay(s);
    updateTimerBar(s);
    syncGuessUi(s);
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
      guessLog: hostState.guessLog,
      wordNum: hostState.wordNum,
      deckTotal: hostState.deckTotal,
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

  function matchIsOver() {
    const win = hostState.settings.roundsToWin;
    return hostState.scores.Man >= win || hostState.scores.Boy >= win;
  }

  function clearAutoNext() {
    if (autoNextTimer) {
      clearTimeout(autoNextTimer);
      autoNextTimer = null;
    }
  }

  function scheduleAutoNextRound() {
    clearAutoNext();
    autoNextTimer = setTimeout(function () {
      autoNextTimer = null;
      if (cfg.role !== 'host') {
        return;
      }
      if (hostState.phase !== 'reveal') {
        return;
      }
      if (matchIsOver()) {
        hostState.phase = 'lobby';
        hostState.message =
          hostState.scores.Man >= hostState.settings.roundsToWin
            ? 'MAN WINS THE MATCH! Host: Start game for rematch.'
            : 'BOY WINS THE MATCH! Host: Start game for rematch.';
        refreshStartBtnLabel();
        publishGameState({ force: true });
        return;
      }
      nextDrawerAfterRound();
      startRoundHost();
    }, REVEAL_AUTO_MS);
  }

  function initWordDeck() {
    hostState.settings = readHostSettingsFromDom();
    const pool = getWordPool(hostState.settings);
    if (!pool.length) {
      hostState.message = 'Add custom words (word;hint) or turn off custom list.';
      publishGameState({ force: true });
      return false;
    }
    hostWordDeck = buildWordDeck(hostState.settings);
    hostDeckIndex = 0;
    hostState.deckTotal = hostWordDeck.length;
    return true;
  }

  function pickNextWordFromDeck() {
    if (!hostWordDeck.length) {
      if (!initWordDeck()) {
        return null;
      }
    }
    if (hostDeckIndex >= hostWordDeck.length) {
      hostWordDeck = buildWordDeck(hostState.settings);
      hostDeckIndex = 0;
    }
    const entry = hostWordDeck[hostDeckIndex];
    hostDeckIndex += 1;
    hostState.wordNum = hostDeckIndex;
    return entry;
  }

  function resetMatchHost() {
    clearAutoNext();
    hostState.scores = { Man: 0, Boy: 0 };
    hostState.round = 0;
    hostState.drawer = 'Man';
    hostWordDeck = [];
    hostDeckIndex = 0;
    seenGuessCount = 0;
    initWordDeck();
  }

  function endRoundHost(reason, winner) {
    hostState.phase = 'reveal';
    hostState.roundWinner = winner;
    refreshStartBtnLabel();
    if (winner === 'Man' || winner === 'Boy') {
      hostState.scores[winner] += 1;
      hostState.message = winner + ' guessed it!';
    } else {
      hostState.message = reason || 'Time is up!';
      showGuessPopup('timesup', "Time's up!", 'Nobody guessed the word');
      sfxTimesUp();
    }
    const winTarget = hostState.settings.roundsToWin;
    if (hostState.scores.Man >= winTarget) {
      hostState.message = 'MAN WINS THE MATCH!';
      clearAutoNext();
    } else if (hostState.scores.Boy >= winTarget) {
      hostState.message = 'BOY WINS THE MATCH!';
      clearAutoNext();
    } else {
      const nextDr = hostState.drawer === 'Man' ? 'Boy' : 'Man';
      hostState.message += ' · Next: ' + nextDr + ' draws in ' + REVEAL_AUTO_MS / 1000 + 's…';
      scheduleAutoNextRound();
    }
    publishGameState({ force: true });
    updateUiFromState(hostState);
  }

  function startRoundHost() {
    clearAutoNext();
    hostState.settings = readHostSettingsFromDom();
    saveSettings(hostState.settings);

    const entry = pickNextWordFromDeck();
    if (!entry) {
      return;
    }
    hostSecretWord = entry.word;
    hostRoundHint = entry.hint || '';
    hostState.roundHint = hostRoundHint;
    hostState.round += 1;
    hostState.roundSeed = hashSeed(hostSecretWord + '|' + hostState.round);
    hostState.strokes = [];
    hostState.guessLog = [];
    hostState.lastGuess = '';
    hostState.roundWinner = null;
    seenGuessCount = 0;
    hostState.phase = 'draw';
    hostState.timerEnd = Date.now() + hostState.settings.drawTimeSec * 1000;
    hostState.message =
      'Word ' +
      hostState.wordNum +
      '/' +
      hostState.deckTotal +
      ' · ' +
      hostState.drawer +
      ' is drawing…';
    hostRefreshHint();
    publishGameState({ force: true });
    updateUiFromState(hostState);
    redrawCanvas([]);
    beep(440, 0.06);
  }

  function startGameHost() {
    hostState.settings = readHostSettingsFromDom();
    saveSettings(hostState.settings);
    if (matchIsOver()) {
      resetMatchHost();
    } else if (!hostWordDeck.length) {
      if (!initWordDeck()) {
        return;
      }
    }
    if (hostState.round === 0) {
      hostState.drawer = 'Man';
    }
    startRoundHost();
    refreshStartBtnLabel();
  }

  function nextDrawerAfterRound() {
    hostState.drawer = hostState.drawer === 'Man' ? 'Boy' : 'Man';
  }

  function checkGuessHost(text, fromPlayer) {
    if (hostState.phase !== 'draw') {
      return;
    }
    const guess = String(text || '')
      .trim()
      .toLowerCase();
    if (!guess) {
      return;
    }
    const guesser = hostState.drawer === 'Man' ? 'Boy' : 'Man';
    const player = fromPlayer === 'Man' || fromPlayer === 'Boy' ? fromPlayer : guesser;
    const target = hostSecretWord.toLowerCase();
    if (guess === target) {
      pushGuessLog(player, guess, true);
      const winner = hostState.drawer === 'Man' ? 'Boy' : 'Man';
      endRoundHost('correct', winner);
      return;
    }
    pushGuessLog(player, guess, false);
    hostState.message = 'Nope: "' + guess + '"';
    publishGameState({ force: true });
    updateUiFromState(hostState);
  }

  function mergeGuestState(data) {
    if (!data || typeof data !== 'object') {
      return;
    }
    const prevRound = guestMirror.round;
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
      guessLog: Array.isArray(data.guessLog) ? data.guessLog : [],
      wordNum: data.wordNum | 0,
      deckTotal: data.deckTotal | 0,
      roundWinner: data.roundWinner || null,
      message: data.message || '',
    };
    if ((data.round | 0) !== prevRound) {
      seenGuessCount = 0;
    }
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
        startBtn.textContent = matchIsOver() ? 'Start new game' : 'Skip to next round';
      } else {
        startBtn.textContent = matchIsOver() ? 'Start new game' : 'Start game';
      }
    };
    refreshStartBtnLabel();
    if (startBtn) {
      startBtn.addEventListener('click', () => {
        if (hostState.phase === 'draw') {
          endRoundHost('Round ended early', null);
          refreshStartBtnLabel();
          return;
        }
        if (hostState.phase === 'reveal') {
          clearAutoNext();
          if (matchIsOver()) {
            resetMatchHost();
            hostState.phase = 'lobby';
            hostState.message = 'Rematch ready — Start game.';
            publishGameState({ force: true });
            refreshStartBtnLabel();
            return;
          }
          nextDrawerAfterRound();
          startRoundHost();
          refreshStartBtnLabel();
          return;
        }
        startGameHost();
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
        checkGuessHost(text, HOST_ID);
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
      if (s.phase === 'draw' || s.phase === 'reveal') {
        updateWordDisplay(s);
        updateTimerBar(s);
      }
    }
  }, 250);

  function onMqttMessage(topic, message) {
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
        syncPartnerUi();
        if (mqttLink) {
          mqttLink.log('ok', cfg.remoteLabel + ' status: ' + remoteStatus);
        }
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
          checkGuessHost(data.guess, GUEST_ID);
        }
        partnerOk = true;
        partnerTrying = false;
        lastPartnerMsg = Date.now();
        syncPartnerUi();
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
        syncPartnerUi();
      } catch (err) {
        /* ignore */
      }
    }
  }

  let mqttSession = null;

  function setupMQTT() {
    if (!window.ArcadeGameMqtt) {
      connectionInfo.innerHTML = 'MQTT: <span style="color:#ff6b6b">arcade-game-mqtt.js missing</span>';
      return;
    }
    mqttSession = window.ArcadeGameMqtt.setup({
      gameKey: 'scribble',
      localId: cfg.role === 'host' ? HOST_ID : GUEST_ID,
      remoteId: cfg.role === 'host' ? GUEST_ID : HOST_ID,
      localLabel: cfg.localLabel,
      remoteLabel: cfg.remoteLabel,
      brokerInfoEl: document.getElementById('brokerInfo'),
      connectionInfoEl: connectionInfo,
      uiRoot: document.getElementById('ui'),
      mqttOptions: { reconnectPeriod: 4000, connectTimeout: 15000, keepalive: 30 },
      subscribe: function (c) {
        if (cfg.role === 'host') {
          c.subscribe(`scribble/${GAME_ID}/${GUEST_ID}/action`);
          c.subscribe(`scribble/${GAME_ID}/+/status`);
        } else {
          c.subscribe(`scribble/${GAME_ID}/${HOST_ID}/state`);
          c.subscribe(`scribble/${GAME_ID}/+/status`);
        }
      },
      onConnected: function (c) {
        client = c;
        localConnected = true;
        if (cfg.role === 'host') {
          publishGameState({ force: true });
        }
        if (localStatus !== '—') {
          publishStatus(localStatus);
        }
        mqttLink = mqttSession.getLink();
        mqttLink.log('ok', 'Waiting for ' + cfg.remoteLabel);
        syncPartnerUi();
      },
      onClose: function () {
        localConnected = false;
        partnerOk = false;
        partnerTrying = true;
        syncPartnerUi();
      },
      onMessage: onMqttMessage,
    });
    mqttLink = mqttSession.getLink();
  }

  setupMQTT();
  syncPartnerUi();

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
      syncPartnerUi();
    }
    if (partnerTrying && now - connectStart > 12000 && lastPartnerMsg === 0) {
      partnerTrying = false;
      syncPartnerUi();
    }
  }, 1000);
})();
