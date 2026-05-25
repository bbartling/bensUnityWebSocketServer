/**
 * MQTT 2-player Tic Tac Toe. Man (host) owns board + turn; Boy publishes moves.
 * Expects window.TTT_CONFIG: { role: 'host'|'guest', localLabel, remoteLabel, accentLeft, accentRight }
 */
(function () {
  'use strict';

  const cfg = window.TTT_CONFIG;
  if (!cfg) {
    console.error('TTT_CONFIG missing');
    return;
  }

  const GAME_ID =
    typeof window.ArcadeRoom !== 'undefined' && window.ArcadeRoom.getRoomId
      ? window.ArcadeRoom.getRoomId('tictactoe')
      : 'bens_arcade';
  const HOST_ID = 'Man';
  const GUEST_ID = 'Boy';

  const W = 360;
  const H = 360;
  const PAD = 14;
  const INNER = W - PAD * 2;
  const CELL = INNER / 3;

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

  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');

  function syncCanvasSize() {
    const wrap = document.getElementById('boardWrap');
    const maxW = Math.max(200, (wrap && wrap.clientWidth) || W);
    const maxH = Math.max(200, (wrap && wrap.clientHeight) || H);
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
    `ROOM: <span class="highlight">${GAME_ID}</span> · YOU: <span class="highlight">${cfg.localLabel}</span> · ROLE: <span class="highlight">${cfg.role}</span> · Man = <span class="highlight">X</span> · Boy = <span class="highlight">O</span>`;
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

  const scoreEl = document.getElementById('score');

  function freshState() {
    return {
      cells: ['', '', '', '', '', '', '', '', ''],
      turn: 'Man',
      winner: null,
      winLine: null,
    };
  }

  function evaluateBoard(cells) {
    const lines = [
      [0, 1, 2],
      [3, 4, 5],
      [6, 7, 8],
      [0, 3, 6],
      [1, 4, 7],
      [2, 5, 8],
      [0, 4, 8],
      [2, 4, 6],
    ];
    for (let i = 0; i < lines.length; i++) {
      const [a, b, c] = lines[i];
      const v = cells[a];
      if (v && v === cells[b] && v === cells[c]) {
        return { winner: v === 'X' ? 'Man' : 'Boy', winLine: [a, b, c] };
      }
    }
    if (cells.every(Boolean)) {
      return { winner: 'draw', winLine: null };
    }
    return null;
  }

  let hostState = freshState();
  let guestMirror = freshState();

  function currentState() {
    return cfg.role === 'host' ? hostState : guestMirror;
  }

  function setScoreFromState(s) {
    if (s.winner === 'Man') {
      scoreEl.textContent = 'MAN WINS (X)';
    } else if (s.winner === 'Boy') {
      scoreEl.textContent = 'BOY WINS (O)';
    } else if (s.winner === 'draw') {
      scoreEl.textContent = 'DRAW';
    } else if (s.turn === 'Man') {
      scoreEl.textContent = "MAN'S TURN (X)";
    } else {
      scoreEl.textContent = "BOY'S TURN (O)";
    }
  }

  let client = null;

  function publishStatus(s) {
    if (client && client.connected) {
      const id = cfg.role === 'host' ? HOST_ID : GUEST_ID;
      client.publish(`tictactoe/${GAME_ID}/${id}/status`, s);
    }
  }

  function publishGameState() {
    if (!client || !client.connected || cfg.role !== 'host') {
      return;
    }
    client.publish(`tictactoe/${GAME_ID}/${HOST_ID}/state`, JSON.stringify(hostState));
  }

  function publishGuestMove(payload) {
    if (!client || !client.connected || cfg.role !== 'guest') {
      return;
    }
    client.publish(`tictactoe/${GAME_ID}/${GUEST_ID}/state`, JSON.stringify(payload));
  }

  function applyMoveHost(player, idx) {
    if (idx < 0 || idx > 8 || !Number.isInteger(idx)) {
      return false;
    }
    if (hostState.winner) {
      return false;
    }
    if (hostState.turn !== player) {
      return false;
    }
    if (hostState.cells[idx]) {
      return false;
    }
    hostState.cells[idx] = player === 'Man' ? 'X' : 'O';
    const ev = evaluateBoard(hostState.cells);
    if (ev) {
      hostState.winner = ev.winner;
      hostState.winLine = ev.winLine;
      hostState.turn = null;
      beep(ev.winner === 'draw' ? 220 : 660, 0.1);
    } else {
      hostState.turn = player === 'Man' ? 'Boy' : 'Man';
      beep(380, 0.04);
    }
    setScoreFromState(hostState);
    publishGameState();
    return true;
  }

  function resetHostBoard() {
    hostState = freshState();
    setScoreFromState(hostState);
    publishGameState();
    beep(340, 0.05);
  }

  function mergeGuestState(data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.cells) || data.cells.length !== 9) {
      return;
    }
    const turnOk = data.turn === 'Man' || data.turn === 'Boy' || data.turn === null;
    const winOk = data.winner === 'Man' || data.winner === 'Boy' || data.winner === 'draw' || data.winner === null;
    guestMirror = {
      cells: data.cells.map((c) => (c === 'X' || c === 'O' ? c : '')),
      turn: turnOk ? data.turn : 'Man',
      winner: winOk ? data.winner : null,
      winLine:
        Array.isArray(data.winLine) && data.winLine.length === 3
          ? data.winLine.map((n) => (n | 0))
          : null,
    };
    setScoreFromState(guestMirror);
  }

  function cellFromPointer(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;
    if (x < PAD || x > W - PAD || y < PAD || y > H - PAD) {
      return -1;
    }
    const ix = Math.floor((x - PAD) / CELL);
    const iy = Math.floor((y - PAD) / CELL);
    if (ix < 0 || ix > 2 || iy < 0 || iy > 2) {
      return -1;
    }
    return iy * 3 + ix;
  }

  canvas.addEventListener('click', (e) => {
    const idx = cellFromPointer(e.clientX, e.clientY);
    if (idx < 0) {
      return;
    }
    if (cfg.role === 'host') {
      if (applyMoveHost('Man', idx)) {
        partnerOk = true;
        lastPartnerMsg = Date.now();
      } else {
        beep(120, 0.03);
      }
    } else {
      const s = guestMirror;
      if (s.winner || s.turn !== 'Boy') {
        beep(120, 0.03);
        return;
      }
      if (s.cells[idx]) {
        beep(120, 0.03);
        return;
      }
      publishGuestMove({ cell: idx });
      beep(400, 0.04);
    }
  });

  document.getElementById('newGameBtn').addEventListener('click', () => {
    if (cfg.role === 'host') {
      resetHostBoard();
    } else {
      publishGuestMove({ newGame: true });
      beep(300, 0.05);
    }
  });

  function drawFrame() {
    const s = currentState();
    ctx.fillStyle = '#0c0f14';
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(122, 240, 255, 0.35)';
    ctx.lineWidth = 3;
    for (let i = 1; i <= 2; i++) {
      const x = PAD + i * CELL;
      ctx.beginPath();
      ctx.moveTo(x, PAD);
      ctx.lineTo(x, H - PAD);
      ctx.stroke();
      const y = PAD + i * CELL;
      ctx.beginPath();
      ctx.moveTo(PAD, y);
      ctx.lineTo(W - PAD, y);
      ctx.stroke();
    }

    if (s.winLine) {
      const [a, , c] = s.winLine;
      const ax = PAD + (a % 3) * CELL + CELL / 2;
      const ay = PAD + Math.floor(a / 3) * CELL + CELL / 2;
      const cx = PAD + (c % 3) * CELL + CELL / 2;
      const cy = PAD + Math.floor(c / 3) * CELL + CELL / 2;
      ctx.strokeStyle = 'rgba(255, 224, 138, 0.85)';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(cx, cy);
      ctx.stroke();
    }

    for (let i = 0; i < 9; i++) {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const x0 = PAD + col * CELL;
      const y0 = PAD + row * CELL;
      const mark = s.cells[i];
      const cx = x0 + CELL / 2;
      const cy = y0 + CELL / 2;
      const r = CELL * 0.28;
      if (mark === 'X') {
        ctx.strokeStyle = cfg.accentLeft;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(cx - r, cy - r);
        ctx.lineTo(cx + r, cy + r);
        ctx.moveTo(cx + r, cy - r);
        ctx.lineTo(cx - r, cy + r);
        ctx.stroke();
      } else if (mark === 'O') {
        ctx.strokeStyle = cfg.accentRight;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  function frame() {
    drawFrame();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  setScoreFromState(currentState());

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
    if (kind !== 'state') {
      return;
    }
    if (cfg.role === 'host') {
      if (who === GUEST_ID) {
        try {
          const data = JSON.parse(message.toString());
          if (data && data.newGame) {
            resetHostBoard();
            partnerOk = true;
            partnerTrying = false;
            lastPartnerMsg = Date.now();
            syncPartnerUi();
            return;
          }
          if (typeof data.cell === 'number') {
            if (applyMoveHost('Boy', data.cell)) {
              partnerOk = true;
              partnerTrying = false;
              lastPartnerMsg = Date.now();
              syncPartnerUi();
            }
          }
        } catch (err) {
          /* ignore */
        }
      }
    } else if (who === HOST_ID) {
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
      gameKey: 'tictactoe',
      localId: cfg.role === 'host' ? HOST_ID : GUEST_ID,
      remoteId: cfg.role === 'host' ? GUEST_ID : HOST_ID,
      localLabel: cfg.localLabel,
      remoteLabel: cfg.remoteLabel,
      brokerInfoEl: document.getElementById('brokerInfo'),
      connectionInfoEl: connectionInfo,
      uiRoot: document.getElementById('ui'),
      subscribe: function (c) {
        if (cfg.role === 'host') {
          c.subscribe(`tictactoe/${GAME_ID}/${GUEST_ID}/state`);
          c.subscribe(`tictactoe/${GAME_ID}/+/status`);
        } else {
          c.subscribe(`tictactoe/${GAME_ID}/${HOST_ID}/state`);
          c.subscribe(`tictactoe/${GAME_ID}/+/status`);
        }
      },
      onConnected: function (c) {
        client = c;
        localConnected = true;
        if (cfg.role === 'host') {
          publishGameState();
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
      publishGameState();
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
