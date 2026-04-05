/**
 * Emoji Lobber — turn-based Angry-Birds-style lob + MQTT sync (Man / Boy).
 * window.LOBBER_CONFIG: { seat: 'Man'|'Boy', remoteLabel, accent }
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
  const SOLO = new URLSearchParams(window.location.search).get('solo') === '1';

  const W = 900;
  const H = 520;
  const GROUND_Y = 455;
  const SLING = { x: 125, y: 368 };
  const GRAVITY = 0.38;
  const MAX_PULL = 125;
  const MIN_PULL = 14;
  const POWER = 0.2;
  const PR = 20;
  const SPIN_RAD_S = 11;
  const REST_FRICTION = 0.92;
  const BOUNCE_DAMP = 0.55;

  const EMOJI_OPTIONS = ['🐷', '🐦', '🦆', '🐸', '🐵', '🦄', '🐙', '🦀', '🍕', '🚀', '⭐', '💥'];

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

  function defaultTowers() {
    const base = GROUND_Y;
    return [
      { id: 0, x: 580, y: base - 70, w: 46, h: 70, hp: 1, kind: 'wood', pts: 100 },
      { id: 1, x: 640, y: base - 70, w: 46, h: 70, hp: 1, kind: 'wood', pts: 100 },
      { id: 2, x: 700, y: base - 70, w: 46, h: 70, hp: 1, kind: 'wood', pts: 100 },
      { id: 3, x: 610, y: base - 140, w: 52, h: 52, hp: 1, kind: 'pig', pts: 500 },
      { id: 4, x: 670, y: base - 140, w: 52, h: 52, hp: 1, kind: 'pig', pts: 500 },
      { id: 5, x: 640, y: base - 200, w: 42, h: 42, hp: 1, kind: 'stone', pts: 150 },
    ];
  }

  let towers = defaultTowers();
  let scoreMan = 0;
  let scoreBoy = 0;
  let turn = 'Man';
  let phase = 'pick';
  let shotSeq = 0;

  let localEmoji = null;
  let remoteEmoji = null;
  let localLocked = false;
  let remoteLocked = false;

  let projectile = null;
  let shooterThisRound = null;
  let dragging = false;
  let dragCur = { x: SLING.x, y: SLING.y };

  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const turnLine = document.getElementById('turnLine');
  const scoreEl = document.getElementById('score');
  const pickOverlay = document.getElementById('emojiPicker');
  const pickStatus = document.getElementById('pickStatus');
  const lockBtn = document.getElementById('lockEmoji');
  const emojiGrid = document.getElementById('emojiGrid');

  function syncCanvasSize() {
    const wrap = document.getElementById('boardWrap');
    const maxW = Math.max(240, (wrap && wrap.clientWidth) || W);
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

  function canvasToWorld(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    const sx = canvas.width / r.width;
    const sy = canvas.height / r.height;
    return { x: (clientX - r.left) * sx, y: (clientY - r.top) * sy };
  }

  function setScoreText() {
    scoreEl.textContent = `MAN ${scoreMan}  ·  BOY ${scoreBoy}`;
  }

  function activeTurn() {
    return SOLO ? PLAYER_ID : turn;
  }

  function setTurnLine() {
    if (phase === 'pick') {
      turnLine.textContent = '';
      return;
    }
    if (phase === 'flight') {
      turnLine.textContent = `${shooterThisRound} lobbed!`;
      return;
    }
    const t = activeTurn();
    turnLine.textContent =
      t === PLAYER_ID ? 'YOUR TURN — pull back from the slingshot & release' : `Waiting for ${REMOTE_ID}…`;
  }

  function updatePickStatus() {
    if (!pickStatus) {
      return;
    }
    if (SOLO && remoteLocked && !localLocked) {
      pickStatus.textContent = 'Solo mode — pick an emoji and Lock in.';
    } else if (localLocked && remoteLocked) {
      pickStatus.textContent = SOLO ? 'Locked — launching!' : 'Both locked — launching!';
    } else if (localLocked) {
      pickStatus.textContent = `Waiting for ${REMOTE_ID} to pick…`;
    } else if (remoteLocked) {
      pickStatus.textContent = `${REMOTE_ID} is ready — pick yours!`;
    } else {
      pickStatus.textContent = 'Choose an emoji, then Lock in.';
    }
  }

  EMOJI_OPTIONS.forEach((em) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = em;
    b.dataset.emoji = em;
    b.addEventListener('click', () => {
      if (localLocked) {
        return;
      }
      localEmoji = em;
      emojiGrid.querySelectorAll('button').forEach((x) => x.classList.remove('selected'));
      b.classList.add('selected');
      lockBtn.disabled = false;
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
    publishPick(localEmoji);
    updatePickStatus();
    tryBeginMatch();
  });

  function tryBeginMatch() {
    if (localLocked && remoteLocked && phase === 'pick') {
      phase = 'aim';
      pickOverlay.classList.add('hidden');
      canvas.classList.remove('lobber-wait');
      towers = defaultTowers();
      turn = SOLO ? PLAYER_ID : 'Man';
      setTurnLine();
      setScoreText();
    }
  }

  function publishPick(emoji) {
    if (SOLO || !client || !client.connected) {
      return;
    }
    client.publish(`lobber/${GAME_ID}/${PLAYER_ID}/pick`, JSON.stringify({ emoji }));
  }

  let client = null;
  function publishStatus(s) {
    if (SOLO || !client || !client.connected) {
      return;
    }
    client.publish(`lobber/${GAME_ID}/${PLAYER_ID}/status`, s);
  }

  function publishShot(vx, vy, emoji) {
    shotSeq += 1;
    if (!SOLO && client && client.connected) {
      const payload = JSON.stringify({ vx, vy, emoji, by: PLAYER_ID, seq: shotSeq });
      client.publish(`lobber/${GAME_ID}/${PLAYER_ID}/shot`, payload);
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
    if (client && client.connected) {
      client.publish(`lobber/${GAME_ID}/${PLAYER_ID}/finish`, payload);
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
  }

  function startFlight(vx, vy, emoji, shooter) {
    phase = 'flight';
    shooterThisRound = shooter;
    projectile = {
      x: SLING.x,
      y: SLING.y,
      vx,
      vy,
      emoji,
      rot: 0,
    };
    setTurnLine();
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

  function resolveHits(p) {
    for (const b of towers) {
      if (b.hp <= 0) {
        continue;
      }
      if (!circleRectHit(p.x, p.y, PR, b)) {
        continue;
      }
      const nx = Math.max(b.x, Math.min(p.x, b.x + b.w));
      const ny = Math.max(b.y, Math.min(p.y, b.y + b.h));
      let dx = p.x - nx;
      let dy = p.y - ny;
      const d = Math.hypot(dx, dy) || 0.001;
      const pen = PR - d;
      p.x += (dx / d) * pen * 0.55;
      p.y += (dy / d) * pen * 0.55;
      dx /= d;
      dy /= d;
      const vn = p.vx * dx + p.vy * dy;
      if (vn < 0) {
        p.vx -= 2 * vn * dx * BOUNCE_DAMP;
        p.vy -= 2 * vn * dy * BOUNCE_DAMP;
      }
      b.hp -= 1;
      if (b.hp <= 0) {
        if (shooterThisRound === 'Man') {
          scoreMan += b.pts;
        } else {
          scoreBoy += b.pts;
        }
        beep(b.kind === 'pig' ? 520 : 320, 0.06);
      } else {
        beep(200, 0.03);
      }
      setScoreText();
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
    p.rot += SPIN_RAD_S * dt;

    if (p.y + PR >= GROUND_Y) {
      p.y = GROUND_Y - PR;
      p.vy *= -0.38;
      p.vx *= REST_FRICTION;
      if (Math.abs(p.vy) < 1.0) {
        p.vy = 0;
      }
    }

    resolveHits(p);

    const spd = Math.hypot(p.vx, p.vy);
    const grounded = p.y + PR >= GROUND_Y - 0.5;
    const oob = p.x > W + 100 || p.x < -100;
    const settled = grounded && spd < 2.2;
    if (oob || settled) {
      const shooter = shooterThisRound;
      if (SOLO) {
        turn = PLAYER_ID;
      } else {
        turn = shooter === 'Man' ? 'Boy' : 'Man';
      }
      if (PLAYER_ID === shooter && !SOLO) {
        publishFinish();
      }
      projectile = null;
      phase = 'aim';
      shooterThisRound = null;
      setTurnLine();
    }
  }

  function drawSkyGround() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#6ec5ff');
    g.addColorStop(0.55, '#87ceeb');
    g.addColorStop(1, '#5aad7a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#3d6b45';
    ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y);
    ctx.lineTo(W, GROUND_Y);
    ctx.stroke();
  }

  function drawTowers() {
    for (const b of towers) {
      if (b.hp <= 0) {
        continue;
      }
      if (b.kind === 'pig') {
        ctx.fillStyle = '#c8ff7a';
      } else if (b.kind === 'stone') {
        ctx.fillStyle = '#8899aa';
      } else {
        ctx.fillStyle = '#c4a574';
      }
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 2;
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      if (b.kind === 'pig') {
        ctx.font = `${Math.min(b.w, b.h) * 0.65}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🎯', b.x + b.w / 2, b.y + b.h / 2 + 2);
      }
    }
  }

  function drawSlingshotBand(ax, ay, bx, by) {
    ctx.strokeStyle = 'rgba(40, 30, 20, 0.85)';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }

  function drawSlingshotPost() {
    ctx.strokeStyle = '#3a3028';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(SLING.x - 18, SLING.y + 40);
    ctx.lineTo(SLING.x - 8, SLING.y - 25);
    ctx.moveTo(SLING.x + 18, SLING.y + 40);
    ctx.lineTo(SLING.x + 8, SLING.y - 25);
    ctx.stroke();
  }

  function drawProjectileAt(x, y, rot, emoji) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.font = `${PR * 2}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, 0, 2);
    ctx.restore();
  }

  function drawScene() {
    drawSkyGround();
    drawTowers();

    const aimEmoji = localEmoji || '😐';
    if (phase === 'aim' || phase === 'pick') {
      drawSlingshotPost();
      const restX = SLING.x;
      const restY = SLING.y;
      let drawX = restX;
      let drawY = restY;
      if (dragging && activeTurn() === PLAYER_ID && phase === 'aim') {
        drawX = dragCur.x;
        drawY = dragCur.y;
        drawSlingshotBand(SLING.x - 14, SLING.y - 18, drawX, drawY);
        drawSlingshotBand(SLING.x + 14, SLING.y - 18, drawX, drawY);
      } else {
        drawSlingshotBand(SLING.x - 14, SLING.y - 18, restX, restY);
        drawSlingshotBand(SLING.x + 14, SLING.y - 18, restX, restY);
      }
      if (phase === 'aim' && activeTurn() === PLAYER_ID) {
        drawProjectileAt(drawX, drawY, 0, aimEmoji);
      } else if (phase === 'aim') {
        drawProjectileAt(restX, restY, 0, aimEmoji);
      }
    } else if (phase === 'flight' && projectile) {
      drawSlingshotPost();
      drawSlingshotBand(SLING.x - 14, SLING.y - 18, SLING.x, SLING.y);
      drawSlingshotBand(SLING.x + 14, SLING.y - 18, SLING.x, SLING.y);
      drawProjectileAt(projectile.x, projectile.y, projectile.rot, projectile.emoji);
    } else {
      drawSlingshotPost();
    }
  }

  let lastT = performance.now();
  function frame(now) {
    const dt = Math.min(0.045, (now - lastT) / 1000);
    lastT = now;
    tickFlight(dt);
    drawScene();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  function tryStartDrag(wx, wy) {
    if (phase !== 'aim' || activeTurn() !== PLAYER_ID) {
      return;
    }
    const d = Math.hypot(wx - SLING.x, wy - SLING.y);
    if (d < 52) {
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
    if (len > MAX_PULL) {
      dx = (dx / len) * MAX_PULL;
      dy = (dy / len) * MAX_PULL;
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
    if (len < MIN_PULL) {
      dragCur = { x: SLING.x, y: SLING.y };
      return;
    }
    const emoji = localEmoji || '🐷';
    const vx = dx * POWER;
    const vy = dy * POWER;
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

  document.getElementById('gameInfo').innerHTML =
    `GAME: <span class="highlight">${GAME_ID}</span> · YOU: <span class="highlight">${PLAYER_ID}</span>`;
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

  function setupMQTT() {
    if (SOLO) {
      localConnected = true;
      localConnecting = false;
      updateConn();
      return;
    }
    client = mqtt.connect(BROKER_URL);
    client.on('connect', () => {
      localConnected = true;
      localConnecting = false;
      updateConn();
      client.subscribe(`lobber/${GAME_ID}/+/pick`);
      client.subscribe(`lobber/${GAME_ID}/+/shot`);
      client.subscribe(`lobber/${GAME_ID}/+/finish`);
      client.subscribe(`lobber/${GAME_ID}/+/status`);
      if (localLocked && localEmoji) {
        publishPick(localEmoji);
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
        if (who === REMOTE_ID) {
          remoteStatus = message.toString();
          updateStatusDisplay();
          partnerOk = true;
          partnerTrying = false;
          lastPartnerMsg = Date.now();
          updateConn();
        }
        return;
      }
      if (who === PLAYER_ID) {
        return;
      }
      try {
        const data = JSON.parse(message.toString());
        if (kind === 'pick') {
          remoteEmoji = data.emoji || '🐷';
          remoteLocked = true;
          updatePickStatus();
          tryBeginMatch();
          partnerOk = true;
          partnerTrying = false;
          lastPartnerMsg = Date.now();
          updateConn();
        } else if (kind === 'shot') {
          startFlight(data.vx, data.vy, data.emoji || '🐷', who);
          partnerOk = true;
          lastPartnerMsg = Date.now();
          updateConn();
        } else if (kind === 'finish') {
          applyFinish(data);
          lastPartnerMsg = Date.now();
        }
      } catch (err) {
        /* ignore */
      }
    });
  }

  setScoreText();
  updatePickStatus();
  updateConn();
  updateStatusDisplay();
  setupMQTT();
  if (SOLO) {
    remoteEmoji = '🎮';
    remoteLocked = true;
    partnerOk = true;
    partnerTrying = false;
    updatePickStatus();
    updateConn();
  }

  setInterval(() => {
    if (client && client.connected) {
      publishStatus(localStatus);
    }
  }, 3000);

  setInterval(() => {
    if (SOLO) {
      return;
    }
    const now = Date.now();
    if (partnerOk && now - lastPartnerMsg > 12000) {
      partnerOk = false;
      partnerTrying = false;
      updateConn();
    }
    if (partnerTrying && now - connectStart > 15000 && lastPartnerMsg === 0) {
      partnerTrying = false;
      updateConn();
    }
  }, 1000);
})();
