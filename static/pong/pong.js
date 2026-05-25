/**
 * MQTT 2-player Pong. Man (host) simulates ball + left paddle; Boy publishes right paddle Y.
 * Expects window.PONG_CONFIG: { role: 'host'|'guest', localLabel, remoteLabel, accentLeft, accentRight }
 */
(function () {
  'use strict';

  const cfg = window.PONG_CONFIG;
  if (!cfg) {
    console.error('PONG_CONFIG missing');
    return;
  }

  const GAME_ID =
    typeof window.ArcadeRoom !== 'undefined' && window.ArcadeRoom.getRoomId
      ? window.ArcadeRoom.getRoomId('pong')
      : 'bens_arcade';
  const HOST_ID = 'Man';
  const GUEST_ID = 'Boy';

  const W = 700;
  const H = 400;
  const PW = 12;
  const PH = 72;
  const EDGE = 20;
  const BALL_R = 9;
  const PADDLE_SPEED = 8;
  const BALL_SPEED = 5.2;

  let audioCtx = null;
  /** Browsers block AudioContext until a user gesture — prime on first click/key. */
  function primeAudioFromGesture() {
    if (audioCtx) {
      if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(function () {});
      }
      return;
    }
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      return;
    }
  }
  document.addEventListener('click', primeAudioFromGesture, { once: true, passive: true });
  document.addEventListener('keydown', primeAudioFromGesture, { once: true, passive: true });

  function beep(freq, dur) {
    if (!audioCtx) {
      return;
    }
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = freq;
    o.type = 'square';
    g.gain.value = 0.04;
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + dur);
  }

  function clampPaddle(y) {
    return Math.max(EDGE, Math.min(H - EDGE - PH, y));
  }

  function randomBall(towardRight) {
    const spread = (Math.random() * 0.55 - 0.275) * Math.PI;
    const dir = towardRight ? 1 : -1;
    const vx = Math.cos(spread) * BALL_SPEED * dir;
    let vy = Math.sin(spread) * BALL_SPEED;
    if (Math.abs(vy) < 0.8) {
      vy += vy >= 0 ? 0.9 : -0.9;
    }
    return { x: W / 2, y: H / 2, vx, vy };
  }

  const SERVE_FIRST_LS = 'pong_opening_serve_v1';

  function loadServePref() {
    try {
      const v = localStorage.getItem(SERVE_FIRST_LS);
      if (v === 'man' || v === 'boy' || v === 'random') {
        return v;
      }
    } catch (e) {
      /* ignore */
    }
    return 'random';
  }

  function saveServePref(v) {
    if (v !== 'man' && v !== 'boy' && v !== 'random') {
      return;
    }
    try {
      localStorage.setItem(SERVE_FIRST_LS, v);
    } catch (e) {
      /* ignore */
    }
  }

  function getHostServeFirstRadio() {
    if (cfg.role !== 'host') {
      return 'random';
    }
    const fs = document.getElementById('serveFirstFieldset');
    if (!fs) {
      return 'random';
    }
    const c = fs.querySelector('input[name="serveFirst"]:checked');
    const v = c && c.value;
    if (v === 'man' || v === 'boy' || v === 'random') {
      return v;
    }
    return 'random';
  }

  function applyServePrefsToDomHost() {
    if (cfg.role !== 'host') {
      return;
    }
    const fs = document.getElementById('serveFirstFieldset');
    if (!fs) {
      return;
    }
    const v = loadServePref();
    const inp = fs.querySelector(`input[name="serveFirst"][value="${v}"]`);
    if (inp) {
      inp.checked = true;
    }
  }

  function openingTowardRight() {
    const p = getHostServeFirstRadio();
    if (p === 'boy') {
      return true;
    }
    if (p === 'man') {
      return false;
    }
    return Math.random() > 0.5;
  }

  function serveFirstLabel(s) {
    if (s === 'man') {
      return 'first ball toward Man (left)';
    }
    if (s === 'boy') {
      return 'first ball toward Boy (right)';
    }
    return 'random first ball direction';
  }

  function updateServeFirstInfoForGuest() {
    if (cfg.role !== 'guest') {
      return;
    }
    const el = document.getElementById('serveFirstInfo');
    if (!el) {
      return;
    }
    const s = guestSnap.serveFirst === 'man' || guestSnap.serveFirst === 'boy' || guestSnap.serveFirst === 'random' ? guestSnap.serveFirst : 'random';
    el.textContent = `Host: ${serveFirstLabel(s)}`;
  }

  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');

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

  const keys = { up: false, down: false };

  document.addEventListener('keydown', (e) => {
    if (['ArrowUp', 'ArrowDown'].includes(e.code)) {
      e.preventDefault();
    }
    if (e.code === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
      keys.up = true;
    }
    if (e.code === 'ArrowDown' || e.key === 's' || e.key === 'S') {
      keys.down = true;
    }
  });
  document.addEventListener('keyup', (e) => {
    if (e.code === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
      keys.up = false;
    }
    if (e.code === 'ArrowDown' || e.key === 's' || e.key === 'S') {
      keys.down = false;
    }
  });

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

  const scoreEl = document.getElementById('score');
  function setScoreText(sl, sr) {
    scoreEl.textContent = `MAN ${sl}  ·  BOY ${sr}`;
  }

  let client = null;

  function publishStatus(s) {
    if (client && client.connected) {
      const id = cfg.role === 'host' ? HOST_ID : GUEST_ID;
      client.publish(`pong/${GAME_ID}/${id}/status`, s);
    }
  }

  /** --- Host simulation --- */
  applyServePrefsToDomHost();
  let hostState = {
    ball: randomBall(openingTowardRight()),
    leftY: H / 2 - PH / 2,
    rightY: H / 2 - PH / 2,
    scoreL: 0,
    scoreR: 0,
    serveFirst: getHostServeFirstRadio(),
  };
  let remoteRightY = hostState.rightY;
  let lastPublish = 0;

  if (cfg.role === 'host') {
    const fs = document.getElementById('serveFirstFieldset');
    if (fs) {
      fs.addEventListener('change', () => {
        const v = getHostServeFirstRadio();
        saveServePref(v);
        hostState.serveFirst = v;
        if (hostState.scoreL === 0 && hostState.scoreR === 0) {
          hostState.ball = randomBall(openingTowardRight());
        }
      });
    }
  }

  function bounceTopBottom(ball) {
    if (ball.y < BALL_R) {
      ball.y = BALL_R;
      ball.vy = Math.abs(ball.vy);
      beep(300, 0.04);
    } else if (ball.y > H - BALL_R) {
      ball.y = H - BALL_R;
      ball.vy = -Math.abs(ball.vy);
      beep(300, 0.04);
    }
  }

  function hitLeftPaddle(ball, paddleY) {
    const px = EDGE;
    if (ball.vx >= 0) {
      return;
    }
    if (
      ball.x - BALL_R <= px + PW &&
      ball.y >= paddleY - BALL_R &&
      ball.y <= paddleY + PH + BALL_R
    ) {
      ball.x = px + PW + BALL_R + 1;
      ball.vx = Math.abs(ball.vx);
      const hit = (ball.y - (paddleY + PH / 2)) / (PH / 2);
      ball.vy += hit * 2.4;
      capSpeed(ball);
      beep(440, 0.05);
    }
  }

  function hitRightPaddle(ball, paddleY) {
    const px = W - EDGE - PW;
    if (ball.vx <= 0) {
      return;
    }
    if (
      ball.x + BALL_R >= px &&
      ball.y >= paddleY - BALL_R &&
      ball.y <= paddleY + PH + BALL_R
    ) {
      ball.x = px - BALL_R - 1;
      ball.vx = -Math.abs(ball.vx);
      const hit = (ball.y - (paddleY + PH / 2)) / (PH / 2);
      ball.vy += hit * 2.4;
      capSpeed(ball);
      beep(440, 0.05);
    }
  }

  function capSpeed(ball) {
    const speed = Math.hypot(ball.vx, ball.vy);
    const cap = BALL_SPEED * 1.38;
    if (speed > cap) {
      ball.vx = (ball.vx / speed) * cap;
      ball.vy = (ball.vy / speed) * cap;
    }
  }

  function hostTick(dt) {
    if (keys.up) {
      hostState.leftY = clampPaddle(hostState.leftY - PADDLE_SPEED * dt * 60);
    }
    if (keys.down) {
      hostState.leftY = clampPaddle(hostState.leftY + PADDLE_SPEED * dt * 60);
    }
    hostState.rightY = clampPaddle(remoteRightY);

    const b = hostState.ball;
    b.x += b.vx * dt * 60;
    b.y += b.vy * dt * 60;

    bounceTopBottom(b);
    hitLeftPaddle(b, hostState.leftY);
    hitRightPaddle(b, hostState.rightY);

    if (b.x < -BALL_R) {
      hostState.scoreR += 1;
      hostState.ball = randomBall(true);
      beep(180, 0.12);
    } else if (b.x > W + BALL_R) {
      hostState.scoreL += 1;
      hostState.ball = randomBall(false);
      beep(180, 0.12);
    }

    b.y = Math.max(BALL_R, Math.min(H - BALL_R, b.y));

    setScoreText(hostState.scoreL, hostState.scoreR);

    const now = performance.now();
    if (client && client.connected && now - lastPublish > 33) {
      lastPublish = now;
      client.publish(
        `pong/${GAME_ID}/${HOST_ID}/state`,
        JSON.stringify({
          ball: hostState.ball,
          leftY: hostState.leftY,
          rightY: hostState.rightY,
          scoreL: hostState.scoreL,
          scoreR: hostState.scoreR,
          serveFirst: hostState.serveFirst,
        }),
      );
    }
  }

  /** --- Guest render --- */
  let guestSnap = {
    ball: { x: W / 2, y: H / 2, vx: 0, vy: 0 },
    leftY: H / 2 - PH / 2,
    scoreL: 0,
    scoreR: 0,
    serveFirst: 'random',
  };
  updateServeFirstInfoForGuest();
  let guestRightY = clampPaddle(H / 2 - PH / 2);
  let lastGuestSend = 0;

  function guestTick(dt) {
    if (keys.up) {
      guestRightY = clampPaddle(guestRightY - PADDLE_SPEED * dt * 60);
    }
    if (keys.down) {
      guestRightY = clampPaddle(guestRightY + PADDLE_SPEED * dt * 60);
    }
    setScoreText(guestSnap.scoreL, guestSnap.scoreR);
    const now = performance.now();
    if (client && client.connected && now - lastGuestSend > 45) {
      lastGuestSend = now;
      client.publish(`pong/${GAME_ID}/${GUEST_ID}/state`, JSON.stringify({ rightY: guestRightY }));
    }
  }

  function drawFrame() {
    ctx.fillStyle = '#0c0f14';
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(122, 240, 255, 0.12)';
    ctx.setLineDash([6, 10]);
    ctx.beginPath();
    ctx.moveTo(W / 2, EDGE);
    ctx.lineTo(W / 2, H - EDGE);
    ctx.stroke();
    ctx.setLineDash([]);

    const ball = cfg.role === 'host' ? hostState.ball : guestSnap.ball;
    const leftY = cfg.role === 'host' ? hostState.leftY : guestSnap.leftY;
    const rightY = cfg.role === 'host' ? hostState.rightY : guestRightY;

    ctx.fillStyle = cfg.accentLeft;
    ctx.fillRect(EDGE, leftY, PW, PH);
    ctx.fillStyle = cfg.accentRight;
    ctx.fillRect(W - EDGE - PW, rightY, PW, PH);

    ctx.fillStyle = '#7af0ff';
    ctx.shadowColor = '#7af0ff';
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  let lastT = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    if (cfg.role === 'host') {
      hostTick(dt);
    } else {
      guestTick(dt);
    }
    drawFrame();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

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
          if (typeof data.rightY === 'number') {
            remoteRightY = data.rightY;
          }
          partnerOk = true;
          partnerTrying = false;
          lastPartnerMsg = Date.now();
          syncPartnerUi();
        } catch (e) {
          /* ignore */
        }
      }
    } else if (who === HOST_ID) {
      try {
        const data = JSON.parse(message.toString());
        if (data.ball) {
          guestSnap.ball = data.ball;
        }
        if (typeof data.leftY === 'number') {
          guestSnap.leftY = data.leftY;
        }
        if (typeof data.scoreL === 'number') {
          guestSnap.scoreL = data.scoreL;
        }
        if (typeof data.scoreR === 'number') {
          guestSnap.scoreR = data.scoreR;
        }
        if (data.serveFirst === 'man' || data.serveFirst === 'boy' || data.serveFirst === 'random') {
          guestSnap.serveFirst = data.serveFirst;
          updateServeFirstInfoForGuest();
        }
        partnerOk = true;
        partnerTrying = false;
        lastPartnerMsg = Date.now();
        syncPartnerUi();
      } catch (e) {
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
      gameKey: 'pong',
      localId: cfg.role === 'host' ? HOST_ID : GUEST_ID,
      remoteId: cfg.role === 'host' ? GUEST_ID : HOST_ID,
      localLabel: cfg.localLabel,
      remoteLabel: cfg.remoteLabel,
      brokerInfoEl: document.getElementById('brokerInfo'),
      connectionInfoEl: connectionInfo,
      uiRoot: document.getElementById('ui'),
      onConnected: function (c) {
        client = c;
        localConnected = true;
        if (localStatus !== '—') {
          publishStatus(localStatus);
        }
        if (cfg.role === 'guest') {
          c.publish(`pong/${GAME_ID}/${GUEST_ID}/state`, JSON.stringify({ rightY: guestRightY }));
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
