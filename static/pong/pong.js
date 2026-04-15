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

  const BROKER_URL = 'wss://test.mosquitto.org:8081';
  const GAME_ID = 'bens_arcade';
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
    `GAME: <span class="highlight">${GAME_ID}</span> · YOU: <span class="highlight">${cfg.localLabel}</span> · ROLE: <span class="highlight">${cfg.role}</span>`;
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
  let hostState = {
    ball: randomBall(Math.random() > 0.5),
    leftY: H / 2 - PH / 2,
    rightY: H / 2 - PH / 2,
    scoreL: 0,
    scoreR: 0,
  };
  let remoteRightY = hostState.rightY;
  let lastPublish = 0;

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
  };
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

  function setupMQTT() {
    client = mqtt.connect(BROKER_URL);
    client.on('connect', () => {
      localConnected = true;
      localConnecting = false;
      updateConn();
      client.subscribe(`pong/${GAME_ID}/+/state`);
      client.subscribe(`pong/${GAME_ID}/+/status`);
      if (localStatus !== '—') {
        publishStatus(localStatus);
      }
      if (cfg.role === 'guest') {
        client.publish(`pong/${GAME_ID}/${GUEST_ID}/state`, JSON.stringify({ rightY: guestRightY }));
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
            updateConn();
          } catch (e) {
            /* ignore */
          }
        }
      } else {
        if (who === HOST_ID) {
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
            partnerOk = true;
            partnerTrying = false;
            lastPartnerMsg = Date.now();
            updateConn();
          } catch (e) {
            /* ignore */
          }
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
