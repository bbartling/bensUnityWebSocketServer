/**
 * MQTT 2-player Mahjong-style pair matching.
 * Man (host) validates picks and publishes authoritative state.
 */
(function () {
  'use strict';

  const cfg = window.MAHJONG_CONFIG;
  if (!cfg) {
    console.error('MAHJONG_CONFIG missing');
    return;
  }

  const BROKER_URL = 'wss://test.mosquitto.org:8081';
  const GAME_ID =
    typeof window.ArcadeRoom !== 'undefined' && window.ArcadeRoom.getRoomId
      ? window.ArcadeRoom.getRoomId('mahjong')
      : 'bens_arcade';
  const HOST_ID = 'Man';
  const GUEST_ID = 'Boy';

  const W = 460;
  const H = 420;
  const COLS = 4;
  const ROWS = 4;
  const PAD = 20;
  const GAP = 10;
  const CELL_W = (W - PAD * 2 - GAP * (COLS - 1)) / COLS;
  const CELL_H = (H - PAD * 2 - GAP * (ROWS - 1)) / ROWS;
  // ASCII-only symbols prevent replacement glyphs on systems lacking tile fonts.
  const SYMBOLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const scoreEl = document.getElementById('score');
  const turnBadge = document.getElementById('turnBadge');
  const lockLinksToggle = document.getElementById('lockLinksToggle');

  function syncCanvasSize() {
    const wrap = document.getElementById('boardWrap');
    const maxW = Math.max(260, (wrap && wrap.clientWidth) || W);
    const maxH = Math.max(220, (wrap && wrap.clientHeight) || H);
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
    `ROOM: <span class="highlight">${GAME_ID}</span> � YOU: <span class="highlight">${cfg.localLabel}</span> � ROLE: <span class="highlight">${cfg.role}</span>`;
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
    const b = localConnected ? 'BROKER OK' : localConnecting ? 'CONNECTING�' : 'OFFLINE';
    const bc = localConnected ? '#7dffb3' : localConnecting ? '#ffe08a' : '#ff6b6b';
    const p = partnerOk ? 'PARTNER LINKED' : partnerTrying ? 'WAITING�' : 'NO PARTNER';
    const pc = partnerOk ? '#7dffb3' : partnerTrying ? '#ffe08a' : '#ff6b6b';
    connectionInfo.innerHTML = `MQTT: <span style="color:${bc}">${b}</span> � PARTNER: <span style="color:${pc}">${p}</span>`;
  }
  updateConn();

  let localStatus = '�';
  let remoteStatus = '�';
  const statusBtn = document.getElementById('statusBtn');
  const statusInfo = document.getElementById('statusInfo');
  function updateStatusDisplay() {
    statusInfo.textContent = `You: ${localStatus} � ${cfg.remoteLabel}: ${remoteStatus}`;
  }
  statusBtn.addEventListener('click', () => {
    localStatus = 'READY';
    updateStatusDisplay();
    publishStatus('READY');
  });

  function shuffle(arr) {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  function freshState() {
    return {
      tiles: shuffle(SYMBOLS.concat(SYMBOLS)),
      claimed: Array(16).fill(''),
      revealed: [],
      turn: 'Man',
      scoreMan: 0,
      scoreBoy: 0,
      winner: null,
      pendingHide: false,
    };
  }

  let hostState = freshState();
  let guestState = freshState();
  let hideTimer = null;

  function currentState() {
    return cfg.role === 'host' ? hostState : guestState;
  }

  function updateTurnBadge(s) {
    if (!turnBadge) {
      return;
    }
    if (s.winner) {
      const w = s.winner === 'draw' ? 'DRAW' : `${s.winner.toUpperCase()} WINS`;
      turnBadge.textContent = w;
      turnBadge.className = `turn-badge ${s.winner === 'Man' ? 'turn-man' : s.winner === 'Boy' ? 'turn-boy' : ''}`;
      return;
    }
    turnBadge.textContent = `TURN: ${String(s.turn || '').toUpperCase()}`;
    turnBadge.className = `turn-badge ${s.turn === 'Man' ? 'turn-man' : 'turn-boy'}`;
  }

  function updateScoreText(s) {
    if (s.winner === 'Man') {
      scoreEl.textContent = `MAN ${s.scoreMan} � BOY ${s.scoreBoy}`;
    } else if (s.winner === 'Boy') {
      scoreEl.textContent = `MAN ${s.scoreMan} � BOY ${s.scoreBoy}`;
    } else if (s.winner === 'draw') {
      scoreEl.textContent = `MAN ${s.scoreMan} � BOY ${s.scoreBoy}`;
    } else {
      scoreEl.textContent = `MAN ${s.scoreMan} � BOY ${s.scoreBoy}`;
    }
    updateTurnBadge(s);
  }

  function allClaimed(s) {
    return s.claimed.every(Boolean);
  }

  function resolveWinner(s) {
    if (s.scoreMan > s.scoreBoy) s.winner = 'Man';
    else if (s.scoreBoy > s.scoreMan) s.winner = 'Boy';
    else s.winner = 'draw';
  }

  let client = null;
  function publishStatus(v) {
    if (!client || !client.connected) return;
    const id = cfg.role === 'host' ? HOST_ID : GUEST_ID;
    client.publish(`mahjong/${GAME_ID}/${id}/status`, v);
  }

  function publishHostState() {
    if (!client || !client.connected || cfg.role !== 'host') return;
    client.publish(`mahjong/${GAME_ID}/${HOST_ID}/state`, JSON.stringify(hostState));
  }

  function publishGuestAction(payload) {
    if (!client || !client.connected || cfg.role !== 'guest') return;
    client.publish(`mahjong/${GAME_ID}/${GUEST_ID}/state`, JSON.stringify(payload));
  }

  function nextTurn(player) {
    return player === 'Man' ? 'Boy' : 'Man';
  }

  function hostPick(player, idx) {
    if (hideTimer || hostState.pendingHide || hostState.winner) return false;
    if (hostState.turn !== player || idx < 0 || idx >= 16) return false;
    if (hostState.claimed[idx] || hostState.revealed.includes(idx)) return false;

    hostState.revealed.push(idx);
    if (hostState.revealed.length < 2) {
      publishHostState();
      return true;
    }

    const [a, b] = hostState.revealed;
    if (hostState.tiles[a] === hostState.tiles[b]) {
      hostState.claimed[a] = player;
      hostState.claimed[b] = player;
      if (player === 'Man') hostState.scoreMan += 1;
      else hostState.scoreBoy += 1;
      hostState.revealed = [];
      if (allClaimed(hostState)) resolveWinner(hostState);
      publishHostState();
      return true;
    }

    hostState.pendingHide = true;
    publishHostState();
    hideTimer = setTimeout(() => {
      hideTimer = null;
      hostState.revealed = [];
      hostState.pendingHide = false;
      hostState.turn = nextTurn(player);
      publishHostState();
    }, 700);
    return true;
  }

  function resetHostGame() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    hostState = freshState();
    updateScoreText(hostState);
    publishHostState();
  }

  function tileAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left) * (canvas.width / rect.width);
    const y = (clientY - rect.top) * (canvas.height / rect.height);
    for (let i = 0; i < 16; i++) {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const tx = PAD + col * (CELL_W + GAP);
      const ty = PAD + row * (CELL_H + GAP);
      if (x >= tx && x <= tx + CELL_W && y >= ty && y <= ty + CELL_H) return i;
    }
    return -1;
  }

  canvas.addEventListener('click', (e) => {
    const idx = tileAt(e.clientX, e.clientY);
    if (idx < 0) return;
    if (cfg.role === 'host') hostPick('Man', idx);
    else publishGuestAction({ pick: idx });
  });

  document.getElementById('newGameBtn').addEventListener('click', () => {
    if (cfg.role === 'host') resetHostGame();
    else publishGuestAction({ newGame: true });
  });

  function draw() {
    const s = currentState();
    ctx.fillStyle = '#0c0f14';
    ctx.fillRect(0, 0, W, H);

    for (let i = 0; i < 16; i++) {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const x = PAD + col * (CELL_W + GAP);
      const y = PAD + row * (CELL_H + GAP);
      const claimed = s.claimed[i];
      const revealed = s.revealed.includes(i);
      const face = claimed || revealed;

      if (claimed === 'Man') ctx.fillStyle = 'rgba(107,140,255,0.26)';
      else if (claimed === 'Boy') ctx.fillStyle = 'rgba(255,107,139,0.26)';
      else ctx.fillStyle = face ? 'rgba(38,52,76,0.95)' : 'rgba(20,28,44,0.95)';

      ctx.strokeStyle = face ? 'rgba(122,240,255,0.48)' : 'rgba(122,240,255,0.24)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(x, y, CELL_W, CELL_H, 8);
      ctx.fill();
      ctx.stroke();

      if (face) {
        ctx.fillStyle = '#e8f3ff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '700 28px "JetBrains Mono", monospace';
        ctx.fillText(s.tiles[i], x + CELL_W / 2, y + CELL_H / 2 + 2);
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.16)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '700 16px "Orbitron", sans-serif';
        ctx.fillText('?', x + CELL_W / 2, y + CELL_H / 2 + 1);
      }
    }
    updateScoreText(s);
  }

  function frame() {
    draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Guard against accidental navigation while in a live room.
  function linksLocked() {
    return !lockLinksToggle || lockLinksToggle.checked;
  }
  function askLeave() {
    return window.confirm('Leave this Mahjong room?');
  }
  document.addEventListener('click', (e) => {
    const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    const href = a.getAttribute('href') || '';
    if (!linksLocked() || href.startsWith('#') || href.startsWith('javascript:')) return;
    if (!askLeave()) {
      e.preventDefault();
      e.stopPropagation();
    }
  });
  window.addEventListener('beforeunload', (e) => {
    if (!linksLocked()) return;
    e.preventDefault();
    // Required for Chrome to trigger dialog
    e.returnValue = '';
  });

  function setupMQTT() {
    client = mqtt.connect(BROKER_URL);
    client.on('connect', () => {
      localConnected = true;
      localConnecting = false;
      updateConn();
      if (cfg.role === 'host') {
        client.subscribe(`mahjong/${GAME_ID}/${GUEST_ID}/state`);
        client.subscribe(`mahjong/${GAME_ID}/+/status`);
        publishHostState();
      } else {
        client.subscribe(`mahjong/${GAME_ID}/${HOST_ID}/state`);
        client.subscribe(`mahjong/${GAME_ID}/+/status`);
      }
      if (localStatus !== '�') publishStatus(localStatus);
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
      if (kind !== 'state') return;

      if (cfg.role === 'host') {
        if (who === GUEST_ID) {
          try {
            const data = JSON.parse(message.toString());
            if (data && data.newGame) resetHostGame();
            else if (typeof data.pick === 'number') hostPick('Boy', data.pick);
            partnerOk = true;
            partnerTrying = false;
            lastPartnerMsg = Date.now();
            updateConn();
          } catch (_e) {
            /* ignore */
          }
        }
      } else if (who === HOST_ID) {
        try {
          const data = JSON.parse(message.toString());
          if (Array.isArray(data.tiles) && Array.isArray(data.claimed) && Array.isArray(data.revealed)) {
            guestState = data;
            updateScoreText(guestState);
          }
          partnerOk = true;
          partnerTrying = false;
          lastPartnerMsg = Date.now();
          updateConn();
        } catch (_e) {
          /* ignore */
        }
      }
    });
  }

  updateStatusDisplay();
  updateScoreText(currentState());
  setupMQTT();

  setInterval(() => {
    if (client && client.connected) publishStatus(localStatus);
  }, 3000);

  setInterval(() => {
    if (cfg.role === 'host' && client && client.connected) publishHostState();
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
