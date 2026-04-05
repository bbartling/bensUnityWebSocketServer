/**
 * MQTT co-op Tetris — shared client logic.
 * Expects window.TETRIS_CONFIG before this script loads.
 */
(function () {
  'use strict';

  const cfg = window.TETRIS_CONFIG;
  if (!cfg) {
    console.error('TETRIS_CONFIG missing');
    return;
  }

  const COLS = 24;
  const ROWS = 20;
  let BLOCK_SIZE = 25;
  const DROP_INTERVAL = 1000;
  const MIN_DROP_MS = 120;
  const LINES_PER_LEVEL = 10;
  const MS_DROP_STEP = 70;

  const LINE_SCORE = [0, 100, 300, 500, 800];

  const localId = cfg.localId;
  const remoteId = cfg.remoteId;
  const PLAYER_COLOUR = cfg.playerColour;
  const REMOTE_COLOUR = cfg.remoteColour;
  const spawnFromRight = !!cfg.spawnFromRight;

  const PIECES = {
    T: { matrix: [[0, 0, 0], [1, 1, 1], [0, 1, 0]], colour: '#800080' },
    O: { matrix: [[2, 2], [2, 2]], colour: '#FFFF00' },
    L: { matrix: [[0, 3, 0], [0, 3, 0], [0, 3, 3]], colour: '#FFA500' },
    J: { matrix: [[0, 4, 0], [0, 4, 0], [4, 4, 0]], colour: '#0000FF' },
    I: { matrix: [[0, 5, 0, 0], [0, 5, 0, 0], [0, 5, 0, 0], [0, 5, 0, 0]], colour: '#00FFFF' },
    S: { matrix: [[0, 6, 6], [6, 6, 0], [0, 0, 0]], colour: '#00FF00' },
    Z: { matrix: [[7, 7, 0], [0, 7, 7], [0, 0, 0]], colour: '#FF0000' },
  };

  let audioCtx = null;
  function playTone(frequency, duration) {
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (err) {
        return;
      }
    }
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    osc.frequency.value = frequency;
    osc.type = 'square';
    gainNode.gain.value = 0.05;
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  }
  function playSuccessSound() {
    playTone(880, 0.1);
    playTone(1100, 0.15);
  }
  function playErrorSound() {
    playTone(220, 0.4);
  }

  function rotate(matrix) {
    const N = matrix.length;
    const result = [];
    for (let y = 0; y < N; y++) {
      result.push([]);
      for (let x = 0; x < N; x++) {
        result[y][x] = matrix[N - x - 1][y];
      }
    }
    return result;
  }

  /** Merge partner's locked cells only; never replace the whole board. */
  function applyRemoteLocks(game, senderId, incomingBoard) {
    if (!incomingBoard || !incomingBoard.length) return;
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (game.board[y][x] === senderId) {
          game.board[y][x] = 0;
        }
      }
    }
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (incomingBoard[y] && incomingBoard[y][x] === senderId) {
          game.board[y][x] = senderId;
        }
      }
    }
  }

  class Tetris {
    constructor(canvas, playerId) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.ctx.setTransform(BLOCK_SIZE, 0, 0, BLOCK_SIZE, 0, 0);
      this.board = this.createMatrix(COLS, ROWS);
      this.score = 0;
      this.linesTotal = 0;
      this.level = 0;
      this.playerId = playerId;
      this.dropCounter = 0;
      this.dropInterval = DROP_INTERVAL;
      this.lastTime = 0;
      this.resetPiece();
      this.remotePiece = null;
    }

    createMatrix(w, h) {
      const matrix = [];
      for (let i = 0; i < h; i++) {
        matrix.push(new Array(w).fill(0));
      }
      return matrix;
    }

    recomputeDropSpeed() {
      this.level = Math.floor(this.linesTotal / LINES_PER_LEVEL);
      this.dropInterval = Math.max(MIN_DROP_MS, DROP_INTERVAL - this.level * MS_DROP_STEP);
    }

    merge() {
      this.piece.matrix.forEach((row, y) => {
        row.forEach((value, x) => {
          if (value !== 0) {
            const boardY = y + this.piece.pos.y;
            const boardX = x + this.piece.pos.x;
            if (boardY >= 0 && boardY < ROWS && boardX >= 0 && boardX < COLS) {
              this.board[boardY][boardX] = localId;
            }
          }
        });
      });
    }

    collide(pos = this.piece.pos, mat = this.piece.matrix) {
      for (let y = 0; y < mat.length; y++) {
        for (let x = 0; x < mat[y].length; x++) {
          const value = mat[y][x];
          if (value !== 0) {
            const bx = x + pos.x;
            const by = y + pos.y;
            if (bx < 0 || bx >= COLS || by >= ROWS) {
              return true;
            }
            if (by >= 0 && this.board[by][bx] !== 0) {
              return true;
            }
            if (this.remotePiece) {
              for (let ry = 0; ry < this.remotePiece.matrix.length; ry++) {
                for (let rx = 0; rx < this.remotePiece.matrix[ry].length; rx++) {
                  if (this.remotePiece.matrix[ry][rx] !== 0) {
                    const rbx = rx + this.remotePiece.pos.x;
                    const rby = ry + this.remotePiece.pos.y;
                    if (bx === rbx && by === rby) {
                      return true;
                    }
                  }
                }
              }
            }
          }
        }
      }
      return false;
    }

    rotatePiece() {
      const rotated = rotate(this.piece.matrix);
      if (!this.collide(this.piece.pos, rotated)) {
        this.piece.matrix = rotated;
        publishState();
      }
    }

    movePiece(offsetX) {
      this.piece.pos.x += offsetX;
      if (this.collide()) {
        this.piece.pos.x -= offsetX;
      } else {
        publishState();
      }
    }

    dropPiece() {
      this.piece.pos.y++;
      if (this.collide()) {
        this.piece.pos.y--;
        this.merge();
        this.clearLines();
        this.resetPiece();
        publishState();
      } else {
        publishState();
      }
      this.dropCounter = 0;
    }

    clearLines() {
      let lines = 0;
      const clearedRows = [];
      outer: for (let y = ROWS - 1; y >= 0; y--) {
        for (let x = 0; x < COLS; x++) {
          if (this.board[y][x] === 0) {
            continue outer;
          }
        }
        const row = this.board.splice(y, 1)[0].fill(0);
        this.board.unshift(row);
        clearedRows.push(y);
        y++;
        lines++;
      }
      if (lines > 0) {
        this.linesTotal += lines;
        this.score += LINE_SCORE[lines] || lines * 100;
        this.recomputeDropSpeed();
        playSuccessSound();
        if (this.remotePiece) {
          clearedRows.forEach((rowIdx) => {
            if (this.remotePiece.pos.y < rowIdx) {
              this.remotePiece.pos.y++;
            }
          });
        }
        this.updateScore();
      }
    }

    resetPiece() {
      const types = Object.keys(PIECES);
      const type = types[Math.floor(Math.random() * types.length)];
      const matrix = PIECES[type].matrix.map((row) => row.slice());
      const pieceWidth = matrix[0].length;
      const spawnX = spawnFromRight ? COLS - pieceWidth : 0;
      this.piece = { type: type, matrix: matrix, pos: { x: spawnX, y: -1 } };
      if (this.collide()) {
        this.board.forEach((row) => row.fill(0));
        this.score = 0;
        this.linesTotal = 0;
        this.level = 0;
        this.recomputeDropSpeed();
        this.updateScore();
        playErrorSound();
        publishState();
      }
    }

    update(time = 0) {
      const deltaTime = time - this.lastTime;
      this.lastTime = time;
      this.dropCounter += deltaTime;
      if (this.dropCounter > this.dropInterval) {
        this.dropPiece();
      }
      this.draw();
      requestAnimationFrame(this.update.bind(this));
    }

    draw() {
      this.ctx.setTransform(BLOCK_SIZE, 0, 0, BLOCK_SIZE, 0, 0);
      this.ctx.fillStyle = '#111';
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

      this.ctx.strokeStyle = '#222';
      this.ctx.lineWidth = 0.05;
      for (let i = 0; i < COLS; i++) {
        this.ctx.beginPath();
        this.ctx.moveTo(i, 0);
        this.ctx.lineTo(i, ROWS);
        this.ctx.stroke();
      }
      for (let i = 0; i < ROWS; i++) {
        this.ctx.beginPath();
        this.ctx.moveTo(0, i);
        this.ctx.lineTo(COLS, i);
        this.ctx.stroke();
      }

      this.drawMatrix(this.board, { x: 0, y: 0 });
      if (this.remotePiece) {
        this.drawMatrix(this.remotePiece.matrix, this.remotePiece.pos, REMOTE_COLOUR);
      }
      this.drawMatrix(this.piece.matrix, this.piece.pos, PLAYER_COLOUR);
    }

    drawMatrix(matrix, offset, overrideColour) {
      matrix.forEach((row, y) => {
        row.forEach((value, x) => {
          if (value !== 0) {
            let colour;
            if (overrideColour) {
              colour = overrideColour;
            } else if (value === localId) {
              colour = PLAYER_COLOUR;
            } else if (value === remoteId) {
              colour = REMOTE_COLOUR;
            } else {
              colour = PLAYER_COLOUR;
            }
            this.ctx.fillStyle = colour;
            this.ctx.fillRect(x + offset.x, y + offset.y, 1, 1);
            this.ctx.fillStyle = 'rgba(255,255,255,0.2)';
            this.ctx.fillRect(x + offset.x, y + offset.y, 1, 0.15);
            this.ctx.fillStyle = 'rgba(0,0,0,0.3)';
            this.ctx.fillRect(x + offset.x, y + offset.y + 0.85, 1, 0.15);
          }
        });
      });
    }

    updateScore() {
      updateTeamScore();
    }

    toState() {
      return {
        board: this.board,
        score: this.score,
        linesTotal: this.linesTotal,
        level: this.level,
        piece: {
          type: this.piece.type,
          matrix: this.piece.matrix,
          pos: { x: this.piece.pos.x, y: this.piece.pos.y },
        },
      };
    }
  }

  let gameID = cfg.gameId || 'bens_arcade';
  let playerID = cfg.localId;

  const params = new URLSearchParams(window.location.search);
  if (params.get('game')) {
    gameID = params.get('game');
  }

  /** Eclipse Mosquitto public test broker (browser WebSocket over TLS). */
  const BROKER_URL = 'wss://test.mosquitto.org:8081';

  document.getElementById('gameInfo').innerHTML =
    `GAME: <span class="highlight">${gameID}</span> · YOU: <span class="highlight">${playerID}</span>`;
  document.getElementById('brokerInfo').innerHTML =
    `MQTT WS: <span class="highlight">${BROKER_URL}</span>`;

  let game = null;

  function adjustCanvasSizes() {
    const wrap = document.getElementById('boardWrap');
    if (!wrap) return;
    const maxHeight = Math.max(120, wrap.clientHeight - 8);
    const maxWidth = Math.max(120, wrap.clientWidth - 8);
    const blockFromHeight = Math.floor(maxHeight / ROWS);
    const blockFromWidth = Math.floor(maxWidth / COLS);
    let baseBlock = Math.min(blockFromHeight, blockFromWidth);
    if (baseBlock < 8) {
      baseBlock = 8;
    }
    BLOCK_SIZE = baseBlock;
    const gameCanvas = document.getElementById('gameCanvas');
    gameCanvas.width = BLOCK_SIZE * COLS;
    gameCanvas.height = BLOCK_SIZE * ROWS;
    if (game && game.ctx) {
      game.ctx.setTransform(BLOCK_SIZE, 0, 0, BLOCK_SIZE, 0, 0);
    }
  }

  const gameCanvas = document.getElementById('gameCanvas');
  adjustCanvasSizes();
  game = new Tetris(gameCanvas, playerID);
  window.addEventListener('resize', adjustCanvasSizes);
  const boardWrap = document.getElementById('boardWrap');
  if (boardWrap && typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => adjustCanvasSizes());
    ro.observe(boardWrap);
  }

  document.addEventListener('keydown', (event) => {
    if (
      ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].indexOf(event.code) > -1
    ) {
      event.preventDefault();
    }
    switch (event.key) {
      case 'ArrowLeft':
      case 'a':
        game.movePiece(-1);
        break;
      case 'ArrowRight':
      case 'd':
        game.movePiece(1);
        break;
      case 'ArrowUp':
      case 'w':
      case ' ':
        game.rotatePiece();
        break;
      case 'ArrowDown':
      case 's':
        game.dropPiece();
        break;
      default:
        break;
    }
  });

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
    playTone(600, 0.1);
  });

  let remoteScore = 0;
  let remoteLines = 0;
  function updateTeamScore() {
    const total = game.score + remoteScore;
    const lines = game.linesTotal + remoteLines;
    document.getElementById('score').textContent =
      `TEAM ${total} pts · LINES ${lines} · LVL ${game.level}`;
  }
  updateTeamScore();

  let localConnected = false;
  let remoteConnected = false;
  let localConnecting = true;
  let remoteTrying = true;
  let lastRemoteMessage = 0;
  const connectStartTime = Date.now();
  const connectionInfo = document.getElementById('connectionInfo');

  function updateConnectionDisplay() {
    const brokerText = localConnected
      ? 'BROKER OK'
      : localConnecting
        ? 'CONNECTING…'
        : 'OFFLINE';
    const brokerColour = localConnected ? '#7dffb3' : localConnecting ? '#ffe08a' : '#ff6b6b';
    const playerText = remoteConnected
      ? 'PARTNER LINKED'
      : remoteTrying
        ? 'WAITING…'
        : 'NO PARTNER';
    const playerColour = remoteConnected ? '#7dffb3' : remoteTrying ? '#ffe08a' : '#ff6b6b';
    connectionInfo.innerHTML = `MQTT: <span style="color:${brokerColour}">${brokerText}</span> · PARTNER: <span style="color:${playerColour}">${playerText}</span>`;
  }

  let client = null;
  function setupMQTT() {
    client = mqtt.connect(BROKER_URL);
    client.on('connect', () => {
      localConnected = true;
      localConnecting = false;
      updateConnectionDisplay();
      client.subscribe(`tetris/${gameID}/+/state`);
      client.subscribe(`tetris/${gameID}/+/status`);
      publishState();
      if (localStatus !== '—') {
        publishStatus(localStatus);
      }
    });
    client.on('close', () => {
      localConnected = false;
      localConnecting = false;
      updateConnectionDisplay();
    });
    client.on('reconnect', () => {
      localConnected = false;
      localConnecting = true;
      updateConnectionDisplay();
    });
    client.on('offline', () => {
      localConnected = false;
      localConnecting = false;
      updateConnectionDisplay();
    });
    client.on('message', (topic, message) => {
      const parts = topic.split('/');
      const sender = parts[2];
      if (sender === playerID) {
        return;
      }
      const suffix = parts[3];
      if (suffix === 'state') {
        try {
          const data = JSON.parse(message.toString());
          remoteScore = typeof data.score === 'number' ? data.score : 0;
          remoteLines = typeof data.linesTotal === 'number' ? data.linesTotal : 0;
          game.remotePiece = data.piece;
          applyRemoteLocks(game, sender, data.board);
          updateTeamScore();
          game.draw();
          remoteConnected = true;
          remoteTrying = false;
          lastRemoteMessage = Date.now();
          updateConnectionDisplay();
        } catch (err) {
          /* ignore */
        }
      } else if (suffix === 'status') {
        try {
          remoteStatus = message.toString();
          updateStatusDisplay();
          remoteConnected = true;
          remoteTrying = false;
          lastRemoteMessage = Date.now();
          updateConnectionDisplay();
        } catch (err) {
          /* ignore */
        }
      }
    });
  }

  function publishState() {
    if (client && client.connected) {
      client.publish(`tetris/${gameID}/${playerID}/state`, JSON.stringify(game.toState()));
    }
  }
  function publishStatus(status) {
    if (client && client.connected) {
      client.publish(`tetris/${gameID}/${playerID}/status`, status);
    }
  }

  game.update();
  updateConnectionDisplay();
  setupMQTT();

  setInterval(() => {
    if (client && client.connected) {
      publishStatus(localStatus);
    }
  }, 3000);

  setInterval(() => {
    const now = Date.now();
    if (remoteConnected && now - lastRemoteMessage > 10000) {
      remoteConnected = false;
      remoteTrying = false;
      updateConnectionDisplay();
    }
    if (
      !remoteConnected &&
      remoteTrying &&
      now - connectStartTime > 10000 &&
      lastRemoteMessage === 0
    ) {
      remoteTrying = false;
      updateConnectionDisplay();
    }
  }, 1000);
})();
