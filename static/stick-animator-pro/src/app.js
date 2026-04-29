const app = document.getElementById('app');

const W = 1280;
const H = 720;
const PART_TABS = ['head', 'torso', 'leftArm', 'rightArm', 'leftHand', 'rightHand', 'leftLeg', 'rightLeg', 'leftFoot', 'rightFoot'];

const defaultPose = () => ({
  head: { x: 640, y: 170 },
  neck: { x: 640, y: 230 },
  hip: { x: 640, y: 360 },
  leftElbow: { x: 560, y: 290 },
  leftHand: { x: 510, y: 360 },
  rightElbow: { x: 720, y: 290 },
  rightHand: { x: 770, y: 360 },
  leftKnee: { x: 590, y: 500 },
  leftFoot: { x: 560, y: 620 },
  rightKnee: { x: 690, y: 500 },
  rightFoot: { x: 720, y: 620 },
});

let state = {
  name: 'Stick Animator Pro',
  frameMs: 180,
  playFps: 12,
  zoom: 1,
  onionSkin: true,
  onionCount: 3,
  onionOpacity: 0.32,
  partStudio: {
    open: false,
    part: 'head',
    brushColor: '#111827',
    brushSize: 5,
    art: {},
  },
  frames: [{ pose: defaultPose() }],
  index: 0,
  playing: false,
};

let dragJoint = null;
let partDrawing = null;
let timer = null;

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function current() {
  return state.frames[state.index];
}

function stageSvg(playbackOnly = false) {
  const p = current().pose;
  const layers = [];
  const line = (a, b) => `<line x1="${p[a].x}" y1="${p[a].y}" x2="${p[b].x}" y2="${p[b].y}" stroke="#0f172a" stroke-width="14" stroke-linecap="round"/>`;
  const joint = (k) =>
    `<circle data-joint="${k}" draggable="false" cx="${p[k].x}" cy="${p[k].y}" r="15" fill="#7dd3fc" stroke="#ffffff" stroke-width="3"/>`;
  const limbs = [
    ['head', 'neck'], ['neck', 'hip'],
    ['neck', 'leftElbow'], ['leftElbow', 'leftHand'],
    ['neck', 'rightElbow'], ['rightElbow', 'rightHand'],
    ['hip', 'leftKnee'], ['leftKnee', 'leftFoot'],
    ['hip', 'rightKnee'], ['rightKnee', 'rightFoot'],
  ];
  const drawPose = (pose, stroke, opacity, includeJoints) => {
    const ln = (a, b) => `<line x1="${pose[a].x}" y1="${pose[a].y}" x2="${pose[b].x}" y2="${pose[b].y}" stroke="${stroke}" stroke-width="14" stroke-linecap="round" opacity="${opacity}"/>`;
    const jn = (k) => `<circle data-joint="${k}" draggable="false" cx="${pose[k].x}" cy="${pose[k].y}" r="15" fill="#7dd3fc" stroke="#ffffff" stroke-width="3"/>`;
    return [
      `<circle cx="${pose.head.x}" cy="${pose.head.y}" r="42" fill="none" stroke="${stroke}" stroke-width="8" opacity="${opacity}"/>`,
      limbs.map(([a, b]) => ln(a, b)).join(''),
      partArtSvg(pose, stroke, opacity, !!playbackOnly),
      includeJoints ? Object.keys(pose).map(jn).join('') : '',
    ].join('');
  };
  if (!playbackOnly && state.onionSkin) {
    for (let n = state.onionCount; n >= 1; n--) {
      const prev = state.frames[state.index - n];
      if (!prev) continue;
      const depth = state.onionCount - n + 1;
      const t = depth / state.onionCount;
      const op = state.onionOpacity * (0.24 + 0.76 * t);
      layers.push(drawPose(prev.pose, '#7c8597', op, false));
    }
  }
  layers.push(drawPose(p, '#0f172a', 1, !playbackOnly));
  return `
    <defs>
      <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
        <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#e2e8f0" stroke-width="1"/>
      </pattern>
    </defs>
    <rect width="${W}" height="${H}" fill="#f8fafc"/>
    <rect width="${W}" height="${H}" fill="url(#grid)"/>
    ${layers.join('')}
  `;
}

function ensurePartArt() {
  state.partStudio ??= { open: false, part: 'head', brushColor: '#111827', brushSize: 5, art: {} };
  state.partStudio.art ??= {};
  for (const p of PART_TABS) {
    if (!Array.isArray(state.partStudio.art[p])) state.partStudio.art[p] = [];
  }
}

function segmentBasis(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.max(1, Math.hypot(dx, dy));
  const tx = dx / len;
  const ty = dy / len;
  const nx = -ty;
  const ny = tx;
  return { len, tx, ty, nx, ny };
}

function mapNormToWorld(part, pose, u, v) {
  if (part === 'head') {
    const c = pose.head;
    const r = 42;
    return { x: c.x + u * r, y: c.y + v * r };
  }
  if (part === 'leftHand' || part === 'rightHand' || part === 'leftFoot' || part === 'rightFoot') {
    const c = pose[part];
    const r = 22;
    return { x: c.x + u * r, y: c.y + v * r };
  }
  const links = {
    torso: ['neck', 'hip'],
    leftArm: ['neck', 'leftHand'],
    rightArm: ['neck', 'rightHand'],
    leftLeg: ['hip', 'leftFoot'],
    rightLeg: ['hip', 'rightFoot'],
  };
  const pair = links[part];
  if (!pair) return { x: 0, y: 0 };
  const a = pose[pair[0]];
  const b = pose[pair[1]];
  const basis = segmentBasis(a, b);
  const t = (u + 1) * 0.5; // map -1..1 to 0..1 along segment
  const px = a.x + basis.tx * basis.len * t + basis.nx * v * basis.len * 0.33;
  const py = a.y + basis.ty * basis.len * t + basis.ny * v * basis.len * 0.33;
  return { x: px, y: py };
}

function partArtSvg(pose, stroke, opacity, playbackOnly) {
  ensurePartArt();
  const out = [];
  for (const part of PART_TABS) {
    const strokes = state.partStudio.art[part];
    if (!strokes?.length) continue;
    for (const s of strokes) {
      if (!s?.points || s.points.length < 2) continue;
      const pts = s.points
        .map((p) => {
          const q = mapNormToWorld(part, pose, Number(p.u || 0), Number(p.v || 0));
          return `${Math.round(q.x * 100) / 100},${Math.round(q.y * 100) / 100}`;
        })
        .join(' ');
      const sw = Math.max(1.2, Number(s.widthNorm || 0.05) * 30);
      const col = playbackOnly ? (s.color || stroke) : (s.color || stroke);
      out.push(`<polyline points="${pts}" fill="none" stroke="${col}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}"/>`);
    }
  }
  return out.join('');
}

function render() {
  const playbackOnly = !!state.playing;
  ensurePartArt();
  app.innerHTML = `
    <div class="wrap">
      <header>
        <div>
          <h1>Stick Animator Pro</h1>
          <div class="hint">Restored in-repo build so /stick-animator-pro/ works on Render and local.</div>
        </div>
        <div class="controls">
          <button id="play" class="good">${state.playing ? 'Pause' : 'Play'}</button>
          <label class="hint">Play FPS
            <select id="playFps">
              <option value="0" ${state.playFps === 0 ? 'selected' : ''}>Use frame timing</option>
              <option value="6" ${state.playFps === 6 ? 'selected' : ''}>6</option>
              <option value="8" ${state.playFps === 8 ? 'selected' : ''}>8</option>
              <option value="10" ${state.playFps === 10 ? 'selected' : ''}>10</option>
              <option value="12" ${state.playFps === 12 ? 'selected' : ''}>12</option>
              <option value="15" ${state.playFps === 15 ? 'selected' : ''}>15</option>
              <option value="24" ${state.playFps === 24 ? 'selected' : ''}>24</option>
              <option value="30" ${state.playFps === 30 ? 'selected' : ''}>30</option>
              <option value="60" ${state.playFps === 60 ? 'selected' : ''}>60</option>
            </select>
          </label>
          <button id="prev">Prev</button>
          <button id="next">Next</button>
          <button id="add">+ Frame</button>
          <button id="dup">Duplicate</button>
          <button id="openPartStudio">Part Studio</button>
          <button id="exportJson">Download JSON</button>
        </div>
      </header>
      <main>
        <section class="panel stage-wrap">
          <div class="controls">
            <label class="hint">Onion skin <input id="onionSkin" type="checkbox" ${state.onionSkin ? 'checked' : ''} ${playbackOnly ? 'disabled' : ''} /></label>
            <label class="hint">Ghost frames <input id="onionCount" type="number" min="1" max="6" value="${state.onionCount}" /></label>
            <label class="hint">Zoom <input id="zoomRange" type="range" min="0.5" max="3" step="0.1" value="${state.zoom}" /></label>
            <button id="zoomReset">Reset Zoom</button>
          </div>
          <div class="hint">Frame ${state.index + 1} / ${state.frames.length} · ${playbackOnly ? 'Playback view (clean)' : 'Drag joints to pose'}</div>
          <div class="stage-viewport">
            <svg id="stage" style="width:${Math.round(state.zoom * 100)}%;max-width:none;" draggable="false" viewBox="0 0 ${W} ${H}" aria-label="Animation stage">${stageSvg(playbackOnly)}</svg>
          </div>
        </section>
      </main>
      <div class="footer">This deploy-safe version is stored in /static/stick-animator-pro.</div>
      <div id="partStudioModal" class="face-studio-modal ${state.partStudio.open ? '' : 'hidden'}">
        <div class="face-studio-card">
          <div class="face-studio-head">
            <h3>Part Studio (Vector Reshape)</h3>
            <button id="closePartStudio" class="small">Close</button>
          </div>
          <div class="part-tabs">
            ${PART_TABS.map((p) => `<button class="small ${state.partStudio.part === p ? 'good' : ''}" data-part-tab="${p}">${p}</button>`).join('')}
          </div>
          <div class="face-studio-tools">
            <label>Brush color <input id="partBrushColor" type="color" value="${state.partStudio.brushColor}" /></label>
            <label>Brush size <input id="partBrushSize" type="range" min="2" max="18" step="1" value="${state.partStudio.brushSize}" /></label>
            <button id="partClear" class="small danger">Clear part</button>
          </div>
          <canvas id="partStudioCanvas" width="360" height="360" aria-label="Part Studio canvas"></canvas>
          <p class="hint">Draw each body part in vector space. Art follows the rig while animating.</p>
        </div>
      </div>
    </div>
  `;

  document.getElementById('play').addEventListener('click', togglePlay);
  document.getElementById('playFps').addEventListener('change', (e) => {
    state.playFps = Math.max(0, Math.min(60, Number(e.target.value || 0)));
    if (state.playing) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(playLoop, currentPlayDelayMs());
    }
  });
  document.getElementById('prev').addEventListener('click', () => { state.index = (state.index - 1 + state.frames.length) % state.frames.length; render(); });
  document.getElementById('next').addEventListener('click', () => { state.index = (state.index + 1) % state.frames.length; render(); });
  document.getElementById('add').addEventListener('click', () => {
    state.frames.splice(state.index + 1, 0, { pose: clone(current().pose) });
    state.index += 1;
    render();
  });
  document.getElementById('dup').addEventListener('click', () => {
    state.frames.splice(state.index + 1, 0, { pose: clone(current().pose) });
    state.index += 1;
    render();
  });
  document.getElementById('openPartStudio').addEventListener('click', () => { state.partStudio.open = true; render(); });
  document.getElementById('closePartStudio').addEventListener('click', () => { state.partStudio.open = false; partDrawing = null; render(); });
  document.querySelectorAll('[data-part-tab]').forEach((el) =>
    el.addEventListener('click', () => {
      state.partStudio.part = el.dataset.partTab || 'head';
      drawPartStudioCanvas();
      render();
    }),
  );
  document.getElementById('partBrushColor').addEventListener('input', (e) => { state.partStudio.brushColor = e.target.value || '#111827'; });
  document.getElementById('partBrushSize').addEventListener('input', (e) => { state.partStudio.brushSize = Math.max(2, Math.min(18, Number(e.target.value || 5))); });
  document.getElementById('partClear').addEventListener('click', () => {
    const part = state.partStudio.part;
    state.partStudio.art[part] = [];
    drawPartStudioCanvas();
    document.getElementById('stage').innerHTML = stageSvg(!!state.playing);
  });
  document.getElementById('exportJson').addEventListener('click', exportJson);
  document.getElementById('onionSkin').addEventListener('change', (e) => { state.onionSkin = !!e.target.checked; render(); });
  document.getElementById('onionCount').addEventListener('input', (e) => { state.onionCount = Math.max(1, Math.min(6, Number(e.target.value || 3))); render(); });
  document.getElementById('zoomRange').addEventListener('input', (e) => { state.zoom = Math.max(0.5, Math.min(3, Number(e.target.value || 1))); render(); });
  document.getElementById('zoomReset').addEventListener('click', () => { state.zoom = 1; render(); });
  bindStageDrag();
  bindPartStudio();
}

function bindPartStudio() {
  if (!state.partStudio.open) return;
  const canvas = document.getElementById('partStudioCanvas');
  if (!canvas) return;
  drawPartStudioCanvas();
  canvas.addEventListener('pointerdown', (e) => {
    const p = partCanvasToNorm(canvas, e.clientX, e.clientY);
    if (!p) return;
    const stroke = {
      color: state.partStudio.brushColor || '#111827',
      widthNorm: Math.max(0.02, Math.min(0.16, Number(state.partStudio.brushSize || 5) / 80)),
      points: [p],
    };
    state.partStudio.art[state.partStudio.part].push(stroke);
    partDrawing = stroke;
    canvas.setPointerCapture?.(e.pointerId);
    drawPartStudioCanvas();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!partDrawing) return;
    const p = partCanvasToNorm(canvas, e.clientX, e.clientY);
    if (!p) return;
    partDrawing.points.push(p);
    drawPartStudioCanvas();
    document.getElementById('stage').innerHTML = stageSvg(!!state.playing);
  });
  const done = () => {
    if (!partDrawing) return;
    partDrawing = null;
  };
  canvas.addEventListener('pointerup', done);
  canvas.addEventListener('pointercancel', done);
}

function partCanvasToNorm(canvas, clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  const x = ((clientX - r.left) * canvas.width) / r.width;
  const y = ((clientY - r.top) * canvas.height) / r.height;
  const cx = canvas.width * 0.5;
  const cy = canvas.height * 0.5;
  const rr = canvas.width * 0.38;
  return { u: Math.max(-1.2, Math.min(1.2, (x - cx) / rr)), v: Math.max(-1.2, Math.min(1.2, (y - cy) / rr)) };
}

function drawPartStudioCanvas() {
  const canvas = document.getElementById('partStudioCanvas');
  if (!canvas) return;
  ensurePartArt();
  const part = state.partStudio.part;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const cx = w * 0.5;
  const cy = h * 0.5;
  const rr = w * 0.38;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#e5e7eb';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#f8fafc';
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 3;
  if (part === 'head' || part.includes('Hand') || part.includes('Foot')) {
    ctx.beginPath();
    ctx.arc(cx, cy, rr * 0.75, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(cx - rr, cy);
    ctx.lineTo(cx + rr, cy);
    ctx.stroke();
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy - rr * 0.8);
    ctx.lineTo(cx, cy + rr * 0.8);
    ctx.stroke();
  }
  const strokes = state.partStudio.art[part] || [];
  for (const s of strokes) {
    if (!s.points || s.points.length < 2) continue;
    ctx.strokeStyle = s.color || '#111827';
    ctx.lineWidth = Math.max(2, (s.widthNorm || 0.05) * 80);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(cx + s.points[0].u * rr, cy + s.points[0].v * rr);
    for (let i = 1; i < s.points.length; i++) {
      const p = s.points[i];
      ctx.lineTo(cx + p.u * rr, cy + p.v * rr);
    }
    ctx.stroke();
  }
}

function bindStageDrag() {
  const svg = document.getElementById('stage');
  if (!svg) return;
  if (state.playing) return;
  svg.addEventListener('dragstart', (e) => e.preventDefault());
  svg.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const pt = clientToSvg(svg, e.clientX, e.clientY);
    const exact = e.target?.dataset?.joint || null;
    const nearest = exact || nearestJointAtPoint(current().pose, pt.x, pt.y);
    if (!nearest) return;
    dragJoint = nearest;
    svg.setPointerCapture(e.pointerId);
    svg.style.cursor = 'grabbing';
  });
  svg.addEventListener('pointermove', (e) => {
    if (!dragJoint) return;
    e.preventDefault();
    const pt = clientToSvg(svg, e.clientX, e.clientY);
    const cur = current().pose[dragJoint] || { x: 0, y: 0 };
    current().pose[dragJoint] = {
      x: Math.max(0, Math.min(W, Math.round(pt.x))),
      y: Math.max(0, Math.min(H, Math.round(pt.y))),
    };
    if (cur.x === current().pose[dragJoint].x && cur.y === current().pose[dragJoint].y) {
      return;
    }
    svg.innerHTML = stageSvg();
  });
  const stopDrag = () => {
    dragJoint = null;
    svg.style.cursor = '';
  };
  svg.addEventListener('pointerup', stopDrag);
  svg.addEventListener('pointercancel', stopDrag);
  svg.addEventListener('lostpointercapture', stopDrag);
}

function nearestJointAtPoint(pose, x, y) {
  let best = null;
  let bestD2 = Number.POSITIVE_INFINITY;
  for (const [name, pt] of Object.entries(pose || {})) {
    const dx = pt.x - x;
    const dy = pt.y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= bestD2) {
      bestD2 = d2;
      best = name;
    }
  }
  return best;
}

function clientToSvg(svg, clientX, clientY) {
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

function exportJson() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'stick-animator-pro-backup.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

function togglePlay() {
  state.playing = !state.playing;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (state.playing) playLoop();
  render();
}

function currentPlayDelayMs() {
  if (state.playFps && state.playFps > 0) {
    return Math.max(16, Math.round(1000 / state.playFps));
  }
  return Math.max(40, Number(state.frameMs || 180));
}

function playLoop() {
  if (!state.playing) return;
  state.index = (state.index + 1) % state.frames.length;
  render();
  timer = setTimeout(playLoop, currentPlayDelayMs());
}

render();
