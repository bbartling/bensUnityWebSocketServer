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
    open: true,
    wizardDone: false,
    wizardStep: 0,
    part: 'head',
    mode: 'draw',
    presetStyle: 'classic',
    brushColor: '#111827',
    brushSize: 5,
    selectedStroke: -1,
    selectedPoint: -1,
    selectedHandle: 'anchor',
    art: {},
  },
  frames: [{ pose: defaultPose() }],
  index: 0,
  playing: false,
};

let dragJoint = null;
let partDrawing = null;
let timer = null;
let playbackGeneration = 0;

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function current() {
  return state.frames[state.index];
}

function hasSubstantialPartArt() {
  ensurePartArt();
  for (const part of PART_TABS) {
    const strokes = state.partStudio.art[part];
    if (!strokes?.length) continue;
    for (const s of strokes) {
      if (s?.points && s.points.length >= 2) return true;
    }
  }
  return false;
}

function stageSvg(playbackOnly = false) {
  const p = current().pose;
  const layers = [];
  const hideBaseRig = !!playbackOnly && hasSubstantialPartArt();
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
  const drawPartsOnly = (pose, stroke, opacity) => partArtSvg(pose, stroke, opacity, true);
  if (!playbackOnly && state.onionSkin) {
    for (let n = state.onionCount; n >= 1; n--) {
      const prev = state.frames[state.index - n];
      if (!prev) continue;
      const depth = state.onionCount - n + 1;
      const t = depth / state.onionCount;
      const op = state.onionOpacity * (0.24 + 0.76 * t);
      layers.push(
        hideBaseRig ? drawPartsOnly(prev.pose, '#7c8597', op) : drawPose(prev.pose, '#7c8597', op, false),
      );
    }
  }
  layers.push(
    hideBaseRig ? drawPartsOnly(p, '#0f172a', 1) : drawPose(p, '#0f172a', 1, !playbackOnly),
  );
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
  state.partStudio ??= {
    open: true,
    wizardDone: false,
    wizardStep: 0,
    part: 'head',
    mode: 'draw',
    presetStyle: 'classic',
    brushColor: '#111827',
    brushSize: 5,
    selectedStroke: -1,
    selectedPoint: -1,
    selectedHandle: 'anchor',
    art: {},
  };
  state.partStudio.mode = state.partStudio.mode === 'reshape' ? 'reshape' : 'draw';
  state.partStudio.presetStyle = ['classic', 'chunky', 'robot'].includes(state.partStudio.presetStyle)
    ? state.partStudio.presetStyle
    : 'classic';
  state.partStudio.selectedStroke = Number.isFinite(state.partStudio.selectedStroke) ? state.partStudio.selectedStroke : -1;
  state.partStudio.selectedPoint = Number.isFinite(state.partStudio.selectedPoint) ? state.partStudio.selectedPoint : -1;
  state.partStudio.selectedHandle = ['anchor', 'out', 'in'].includes(state.partStudio.selectedHandle)
    ? state.partStudio.selectedHandle
    : 'anchor';
  state.partStudio.wizardDone = !!state.partStudio.wizardDone;
  const ws = Number(state.partStudio.wizardStep);
  state.partStudio.wizardStep = Number.isFinite(ws)
    ? Math.max(0, Math.min(PART_TABS.length - 1, Math.floor(ws)))
    : 0;
  if (typeof state.partStudio.wizardDone !== 'boolean') {
    state.partStudio.wizardDone = true;
  }
  state.partStudio.art ??= {};
  for (const p of PART_TABS) {
    if (!Array.isArray(state.partStudio.art[p])) state.partStudio.art[p] = [];
  }
}

function presetPartStrokes(part, style) {
  const mk = (color, widthNorm, points) => ({
    color,
    widthNorm,
    points: points.map(([u, v]) => ({ u, v, outU: 0, outV: 0, inU: 0, inV: 0 })),
  });
  const dark = style === 'robot' ? '#334155' : '#111827';
  const accent = style === 'chunky' ? '#0ea5e9' : style === 'robot' ? '#22c55e' : '#111827';
  if (part === 'head') {
    return [
      mk(dark, 0.06, [[-0.35, -0.2], [-0.1, -0.25], [0.1, -0.25], [0.35, -0.2]]),
      mk(accent, 0.06, [[-0.35, 0.2], [-0.15, 0.34], [0, 0.38], [0.15, 0.34], [0.35, 0.2]]),
    ];
  }
  if (part.includes('Hand') || part.includes('Foot')) {
    return [
      mk(dark, 0.08, [[-0.25, -0.1], [0.0, -0.24], [0.25, -0.1], [0.3, 0.15], [0.0, 0.26], [-0.3, 0.15], [-0.25, -0.1]]),
    ];
  }
  if (part === 'torso') {
    return [
      mk(dark, 0.08, [[-0.6, -0.3], [-0.45, -0.45], [0.45, -0.45], [0.6, -0.3], [0.55, 0.4], [-0.55, 0.4], [-0.6, -0.3]]),
      mk(accent, 0.05, [[-0.2, -0.15], [0.2, -0.15], [0.2, 0.15], [-0.2, 0.15], [-0.2, -0.15]]),
    ];
  }
  return [
    mk(dark, style === 'chunky' ? 0.12 : 0.08, [[-0.9, -0.08], [-0.6, -0.2], [0.6, 0.2], [0.9, 0.08]]),
    mk(accent, 0.04, [[-0.35, -0.03], [0.35, 0.03]]),
  ];
}

function normDistance2(a, b) {
  const dx = (a.u || 0) - (b.u || 0);
  const dy = (a.v || 0) - (b.v || 0);
  return dx * dx + dy * dy;
}

function normUV(pt) {
  return { u: Number(pt?.u || 0), v: Number(pt?.v || 0) };
}

function hasCustomOut(pt) {
  return Math.hypot(Number(pt?.outU || 0), Number(pt?.outV || 0)) > 1e-4;
}

function hasCustomIn(pt) {
  return Math.hypot(Number(pt?.inU || 0), Number(pt?.inV || 0)) > 1e-4;
}

function catmullRomToBezierNorm(p0, p1, p2, p3, k = 0.5) {
  const t1x = (p2.u - p0.u) * k;
  const t1y = (p2.v - p0.v) * k;
  const t2x = (p3.u - p1.u) * k;
  const t2y = (p3.v - p1.v) * k;
  return {
    c1u: p1.u + t1x / 3,
    c1v: p1.v + t1y / 3,
    c2u: p2.u - t2x / 3,
    c2v: p2.v - t2y / 3,
  };
}

/** Cubic control points in normalized part space for segment pts[i] -> pts[i+1]. */
function segmentControlsNorm(pts, i) {
  const n = pts.length;
  const p1 = normUV(pts[i]);
  const p2 = normUV(pts[i + 1]);
  const p0 = i > 0 ? normUV(pts[i - 1]) : p1;
  const p3 = i + 2 < n ? normUV(pts[i + 2]) : p2;
  let { c1u, c1v, c2u, c2v } = catmullRomToBezierNorm(p0, p1, p2, p3);
  const pi = pts[i];
  const pj = pts[i + 1];
  if (hasCustomOut(pi)) {
    c1u = pi.u + Number(pi.outU || 0);
    c1v = pi.v + Number(pi.outV || 0);
  }
  if (hasCustomIn(pj)) {
    c2u = pj.u + Number(pj.inU || 0);
    c2v = pj.v + Number(pj.inV || 0);
  }
  return { c1u, c1v, c2u, c2v };
}

function newNormPoint(u, v) {
  return { u, v, outU: 0, outV: 0, inU: 0, inV: 0 };
}

function pointToSegmentDistance2(p, a, b) {
  const ax = a.u || 0;
  const ay = a.v || 0;
  const bx = b.u || 0;
  const by = b.v || 0;
  const px = p.u || 0;
  const py = p.v || 0;
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-9) {
    const ux = px - ax;
    const uy = py - ay;
    return { d2: ux * ux + uy * uy, t: 0 };
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * dx;
  const qy = ay + t * dy;
  const ux = px - qx;
  const uy = py - qy;
  return { d2: ux * ux + uy * uy, t };
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

function partStrokePathD(part, pose, s) {
  const pts = s.points;
  if (!pts?.length) return '';
  const fmt = (x, y) => `${Math.round(x * 100) / 100} ${Math.round(y * 100) / 100}`;
  const p0w = mapNormToWorld(part, pose, pts[0].u || 0, pts[0].v || 0);
  let d = `M ${fmt(p0w.x, p0w.y)}`;
  if (pts.length < 2) return d;
  for (let i = 0; i < pts.length - 1; i++) {
    const { c1u, c1v, c2u, c2v } = segmentControlsNorm(pts, i);
    const c1w = mapNormToWorld(part, pose, c1u, c1v);
    const c2w = mapNormToWorld(part, pose, c2u, c2v);
    const p1w = mapNormToWorld(part, pose, pts[i + 1].u || 0, pts[i + 1].v || 0);
    d += ` C ${fmt(c1w.x, c1w.y)} ${fmt(c2w.x, c2w.y)} ${fmt(p1w.x, p1w.y)}`;
  }
  return d;
}

function partArtSvg(pose, stroke, opacity, playbackOnly) {
  ensurePartArt();
  const out = [];
  for (const part of PART_TABS) {
    const strokes = state.partStudio.art[part];
    if (!strokes?.length) continue;
    for (const s of strokes) {
      if (!s?.points || s.points.length < 2) continue;
      const sw = Math.max(1.2, Number(s.widthNorm || 0.05) * 30);
      const col = playbackOnly ? (s.color || stroke) : (s.color || stroke);
      const pathD = partStrokePathD(part, pose, s);
      out.push(
        `<path d="${pathD}" fill="none" stroke="${col}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}"/>`,
      );
    }
  }
  return out.join('');
}

function scheduleNextPlaybackTickFromCurrentGen() {
  if (!state.playing) return;
  const gen = playbackGeneration;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    if (!state.playing || gen !== playbackGeneration) return;
    state.index = (state.index + 1) % state.frames.length;
    render();
    scheduleNextPlaybackTickFromCurrentGen();
  }, currentPlayDelayMs());
}

function startPlayback() {
  state.playing = true;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  playbackGeneration++;
  state.index = (state.index + 1) % state.frames.length;
  render();
  scheduleNextPlaybackTickFromCurrentGen();
}

function stopPlayback() {
  state.playing = false;
  playbackGeneration++;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

function render() {
  const playbackOnly = !!state.playing;
  ensurePartArt();
  if (!state.partStudio.wizardDone) {
    state.partStudio.part = PART_TABS[state.partStudio.wizardStep];
  }
  app.innerHTML = `
    <div class="wrap">
      <header>
        <div>
          <h1>Stick Animator Pro</h1>
          <div class="hint">Restored in-repo build so /stick-animator-pro/ works on Render and local.</div>
        </div>
        <div class="controls">
          <button type="button" id="play" class="good">${state.playing ? 'Pause' : 'Play'}</button>
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
          <div class="hint">Frame ${state.index + 1} / ${state.frames.length} · ${
            playbackOnly
              ? hasSubstantialPartArt()
                ? 'Playback — custom parts only (rig hidden)'
                : 'Playback view (clean)'
              : 'Drag joints to pose'
          } · Space = play/pause</div>
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
            <button id="closePartStudio" class="small">${state.partStudio.wizardDone ? 'Close' : 'Skip setup'}</button>
          </div>
          ${
            !state.partStudio.wizardDone
              ? `<div class="part-wizard-bar">
            <strong>Setup ${state.partStudio.wizardStep + 1} / ${PART_TABS.length}</strong>
            <span class="hint">Edit <code>${state.partStudio.part}</code>, then continue.</span>
            <div class="part-wizard-actions">
              <button type="button" id="wizPrev" class="small" ${state.partStudio.wizardStep <= 0 ? 'disabled' : ''}>← Prev part</button>
              <button type="button" id="wizNext" class="small good">${state.partStudio.wizardStep >= PART_TABS.length - 1 ? 'Start animating' : 'Next part →'}</button>
            </div>
          </div>`
              : ''
          }
          <div class="part-tabs">
            ${PART_TABS.map((p) => `<button class="small ${state.partStudio.part === p ? 'good' : ''}" data-part-tab="${p}">${p}</button>`).join('')}
          </div>
          <div class="face-studio-tools">
            <label>Mode
              <select id="partMode">
                <option value="draw" ${state.partStudio.mode === 'draw' ? 'selected' : ''}>Draw</option>
                <option value="reshape" ${state.partStudio.mode === 'reshape' ? 'selected' : ''}>Reshape</option>
              </select>
            </label>
            <label>Preset
              <select id="partPresetStyle">
                <option value="classic" ${state.partStudio.presetStyle === 'classic' ? 'selected' : ''}>Classic</option>
                <option value="chunky" ${state.partStudio.presetStyle === 'chunky' ? 'selected' : ''}>Chunky</option>
                <option value="robot" ${state.partStudio.presetStyle === 'robot' ? 'selected' : ''}>Robot</option>
              </select>
            </label>
            <button id="partApplyPreset" class="small">Apply preset</button>
            <label>Brush color <input id="partBrushColor" type="color" value="${state.partStudio.brushColor}" /></label>
            <label>Brush size <input id="partBrushSize" type="range" min="2" max="18" step="1" value="${state.partStudio.brushSize}" /></label>
            <button id="partSmoothCurves" class="small" title="Reset to auto-smooth (Catmull) cubics">Smooth curves</button>
            <button id="partClear" class="small danger">Clear part</button>
          </div>
          <canvas id="partStudioCanvas" width="360" height="360" aria-label="Part Studio canvas"></canvas>
          <p class="hint">Draw: freehand. Reshape: drag anchors; drag teal (out) / violet (in) handles for Bezier tangents; click segment to add a node. Smooth curves clears custom handles.</p>
        </div>
      </div>
    </div>
  `;

  document.getElementById('play').addEventListener('click', togglePlay);
  document.getElementById('playFps').addEventListener('change', (e) => {
    state.playFps = Math.max(0, Math.min(60, Number(e.target.value || 0)));
    if (state.playing) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      scheduleNextPlaybackTickFromCurrentGen();
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
  document.getElementById('openPartStudio').addEventListener('click', () => {
    state.partStudio.open = true;
    render();
  });
  document.getElementById('closePartStudio').addEventListener('click', () => {
    state.partStudio.open = false;
    partDrawing = null;
    if (!state.partStudio.wizardDone) {
      state.partStudio.wizardDone = true;
    }
    render();
  });
  const wizPrev = document.getElementById('wizPrev');
  const wizNext = document.getElementById('wizNext');
  if (wizPrev) {
    wizPrev.addEventListener('click', () => {
      state.partStudio.wizardStep = Math.max(0, state.partStudio.wizardStep - 1);
      state.partStudio.part = PART_TABS[state.partStudio.wizardStep];
      partDrawing = null;
      render();
    });
  }
  if (wizNext) {
    wizNext.addEventListener('click', () => {
      if (state.partStudio.wizardStep >= PART_TABS.length - 1) {
        state.partStudio.wizardDone = true;
        state.partStudio.open = false;
        partDrawing = null;
      } else {
        state.partStudio.wizardStep += 1;
        state.partStudio.part = PART_TABS[state.partStudio.wizardStep];
        partDrawing = null;
      }
      render();
    });
  }
  document.querySelectorAll('[data-part-tab]').forEach((el) =>
    el.addEventListener('click', () => {
      const tab = el.dataset.partTab || 'head';
      state.partStudio.part = tab;
      const idx = PART_TABS.indexOf(tab);
      if (idx >= 0 && !state.partStudio.wizardDone) state.partStudio.wizardStep = idx;
      state.partStudio.selectedStroke = -1;
      state.partStudio.selectedPoint = -1;
      state.partStudio.selectedHandle = 'anchor';
      drawPartStudioCanvas();
      render();
    }),
  );
  document.getElementById('partMode').addEventListener('change', (e) => {
    state.partStudio.mode = e.target.value === 'reshape' ? 'reshape' : 'draw';
    state.partStudio.selectedStroke = -1;
    state.partStudio.selectedPoint = -1;
    state.partStudio.selectedHandle = 'anchor';
    drawPartStudioCanvas();
  });
  document.getElementById('partPresetStyle').addEventListener('change', (e) => {
    state.partStudio.presetStyle = ['classic', 'chunky', 'robot'].includes(e.target.value) ? e.target.value : 'classic';
  });
  document.getElementById('partApplyPreset').addEventListener('click', () => {
    const part = state.partStudio.part;
    state.partStudio.art[part] = presetPartStrokes(part, state.partStudio.presetStyle);
    state.partStudio.selectedStroke = -1;
    state.partStudio.selectedPoint = -1;
    state.partStudio.selectedHandle = 'anchor';
    drawPartStudioCanvas();
    document.getElementById('stage').innerHTML = stageSvg(!!state.playing);
  });
  document.getElementById('partSmoothCurves').addEventListener('click', () => {
    const part = state.partStudio.part;
    const strokes = state.partStudio.art[part] || [];
    for (const s of strokes) {
      for (const pt of s.points || []) {
        pt.outU = 0;
        pt.outV = 0;
        pt.inU = 0;
        pt.inV = 0;
      }
    }
    drawPartStudioCanvas();
    document.getElementById('stage').innerHTML = stageSvg(!!state.playing);
  });
  document.getElementById('partBrushColor').addEventListener('input', (e) => { state.partStudio.brushColor = e.target.value || '#111827'; });
  document.getElementById('partBrushSize').addEventListener('input', (e) => { state.partStudio.brushSize = Math.max(2, Math.min(18, Number(e.target.value || 5))); });
  document.getElementById('partClear').addEventListener('click', () => {
    const part = state.partStudio.part;
    state.partStudio.art[part] = [];
    state.partStudio.selectedStroke = -1;
    state.partStudio.selectedPoint = -1;
    state.partStudio.selectedHandle = 'anchor';
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
    const part = state.partStudio.part;
    const strokes = state.partStudio.art[part] || [];
    if (state.partStudio.mode === 'reshape') {
      const handleHitR2 = 0.055 * 0.055;
      const pointHitR2 = 0.016 * 0.016;
      const prefer = state.partStudio.selectedStroke;
      const strokeOrder = [];
      if (prefer >= 0 && prefer < strokes.length) strokeOrder.push(prefer);
      for (let si = 0; si < strokes.length; si++) if (si !== prefer) strokeOrder.push(si);

      let bestH = Number.POSITIVE_INFINITY;
      let handlePick = null;
      for (const si of strokeOrder) {
        const s = strokes[si];
        const pts = s.points || [];
        for (let seg = 0; seg < pts.length - 1; seg++) {
          const { c1u, c1v, c2u, c2v } = segmentControlsNorm(pts, seg);
          const dOut = normDistance2(p, { u: c1u, v: c1v });
          if (dOut < handleHitR2 && dOut < bestH) {
            bestH = dOut;
            handlePick = { kind: 'out', si, seg };
          }
          const dIn = normDistance2(p, { u: c2u, v: c2v });
          if (dIn < handleHitR2 && dIn < bestH) {
            bestH = dIn;
            handlePick = { kind: 'in', si, seg };
          }
        }
      }
      if (handlePick) {
        const { kind, si, seg } = handlePick;
        state.partStudio.selectedStroke = si;
        state.partStudio.selectedHandle = kind;
        if (kind === 'out') {
          state.partStudio.selectedPoint = seg;
          const pi = strokes[si].points[seg];
          if (!hasCustomOut(pi)) {
            const { c1u, c1v } = segmentControlsNorm(strokes[si].points, seg);
            pi.outU = c1u - pi.u;
            pi.outV = c1v - pi.v;
          }
          partDrawing = { mode: 'reshape', kind: 'out', stroke: si, seg };
        } else {
          const j = seg + 1;
          state.partStudio.selectedPoint = j;
          const pj = strokes[si].points[j];
          if (!hasCustomIn(pj)) {
            const { c2u, c2v } = segmentControlsNorm(strokes[si].points, seg);
            pj.inU = c2u - pj.u;
            pj.inV = c2v - pj.v;
          }
          partDrawing = { mode: 'reshape', kind: 'in', stroke: si, seg };
        }
        canvas.setPointerCapture?.(e.pointerId);
        drawPartStudioCanvas();
        return;
      }

      let pickedStroke = -1;
      let pickedPoint = -1;
      let best = Number.POSITIVE_INFINITY;
      for (const si of strokeOrder) {
        const s = strokes[si];
        for (let pi = 0; pi < s.points.length; pi++) {
          const d2 = normDistance2(p, s.points[pi]);
          if (d2 < pointHitR2 && d2 < best) {
            best = d2;
            pickedStroke = si;
            pickedPoint = pi;
          }
        }
      }
      if (pickedStroke >= 0) {
        state.partStudio.selectedStroke = pickedStroke;
        state.partStudio.selectedPoint = pickedPoint;
        state.partStudio.selectedHandle = 'anchor';
        partDrawing = { mode: 'reshape', kind: 'anchor', stroke: pickedStroke, point: pickedPoint };
        canvas.setPointerCapture?.(e.pointerId);
        drawPartStudioCanvas();
        return;
      }
      const segHitR2 = 0.03 * 0.03;
      let segBest = { d2: Number.POSITIVE_INFINITY, si: -1, insertAt: -1, t: 0 };
      for (let si = 0; si < strokes.length; si++) {
        const pts = strokes[si].points || [];
        for (let i = 0; i < pts.length - 1; i++) {
          const hit = pointToSegmentDistance2(p, pts[i], pts[i + 1]);
          if (hit.d2 < segBest.d2) {
            segBest = { d2: hit.d2, si, insertAt: i + 1, t: hit.t };
          }
        }
      }
      if (segBest.si >= 0 && segBest.d2 <= segHitR2) {
        const pts = strokes[segBest.si].points;
        const a = pts[segBest.insertAt - 1];
        const b = pts[segBest.insertAt];
        const ins = newNormPoint(a.u + (b.u - a.u) * segBest.t, a.v + (b.v - a.v) * segBest.t);
        pts.splice(segBest.insertAt, 0, ins);
        state.partStudio.selectedStroke = segBest.si;
        state.partStudio.selectedPoint = segBest.insertAt;
        state.partStudio.selectedHandle = 'anchor';
        partDrawing = { mode: 'reshape', kind: 'anchor', stroke: segBest.si, point: segBest.insertAt };
        canvas.setPointerCapture?.(e.pointerId);
        drawPartStudioCanvas();
        document.getElementById('stage').innerHTML = stageSvg(!!state.playing);
        return;
      }
      // fallback: select closest stroke
      let closest = { si: -1, d2: Number.POSITIVE_INFINITY };
      for (let si = 0; si < strokes.length; si++) {
        const pts = strokes[si].points || [];
        for (let i = 0; i < pts.length - 1; i++) {
          const hit = pointToSegmentDistance2(p, pts[i], pts[i + 1]);
          if (hit.d2 < closest.d2) closest = { si, d2: hit.d2 };
        }
      }
      state.partStudio.selectedStroke = closest.si;
      state.partStudio.selectedPoint = -1;
      state.partStudio.selectedHandle = 'anchor';
      drawPartStudioCanvas();
      return;
    }
    const stroke = {
      color: state.partStudio.brushColor || '#111827',
      widthNorm: Math.max(0.02, Math.min(0.16, Number(state.partStudio.brushSize || 5) / 80)),
      points: [newNormPoint(p.u, p.v)],
    };
    state.partStudio.art[part].push(stroke);
    state.partStudio.selectedStroke = state.partStudio.art[part].length - 1;
    state.partStudio.selectedPoint = -1;
    partDrawing = stroke;
    canvas.setPointerCapture?.(e.pointerId);
    drawPartStudioCanvas();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!partDrawing) return;
    const p = partCanvasToNorm(canvas, e.clientX, e.clientY);
    if (!p) return;
    if (partDrawing.mode === 'reshape') {
      const strokes = state.partStudio.art[state.partStudio.part] || [];
      const stroke = strokes[partDrawing.stroke];
      if (!stroke?.points) return;
      const clamp = (q) => ({
        u: Math.max(-1.2, Math.min(1.2, q.u)),
        v: Math.max(-1.2, Math.min(1.2, q.v)),
      });
      const pc = clamp(p);
      if (partDrawing.kind === 'anchor') {
        const pt = stroke.points[partDrawing.point];
        if (!pt) return;
        pt.u = pc.u;
        pt.v = pc.v;
        state.partStudio.selectedStroke = partDrawing.stroke;
        state.partStudio.selectedPoint = partDrawing.point;
        state.partStudio.selectedHandle = 'anchor';
      } else if (partDrawing.kind === 'out') {
        const pt = stroke.points[partDrawing.seg];
        if (!pt) return;
        pt.outU = pc.u - pt.u;
        pt.outV = pc.v - pt.v;
        state.partStudio.selectedStroke = partDrawing.stroke;
        state.partStudio.selectedPoint = partDrawing.seg;
        state.partStudio.selectedHandle = 'out';
      } else if (partDrawing.kind === 'in') {
        const j = partDrawing.seg + 1;
        const pt = stroke.points[j];
        if (!pt) return;
        pt.inU = pc.u - pt.u;
        pt.inV = pc.v - pt.v;
        state.partStudio.selectedStroke = partDrawing.stroke;
        state.partStudio.selectedPoint = j;
        state.partStudio.selectedHandle = 'in';
      }
    } else {
      partDrawing.points.push(newNormPoint(p.u, p.v));
    }
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
  for (let si = 0; si < strokes.length; si++) {
    const s = strokes[si];
    if (!s.points || s.points.length < 2) continue;
    const selected = state.partStudio.mode === 'reshape' && state.partStudio.selectedStroke === si;
    ctx.strokeStyle = selected ? '#f97316' : (s.color || '#111827');
    ctx.lineWidth = Math.max(2, (s.widthNorm || 0.05) * 80);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    const pts = s.points;
    ctx.moveTo(cx + pts[0].u * rr, cy + pts[0].v * rr);
    for (let i = 0; i < pts.length - 1; i++) {
      const { c1u, c1v, c2u, c2v } = segmentControlsNorm(pts, i);
      ctx.bezierCurveTo(
        cx + c1u * rr,
        cy + c1v * rr,
        cx + c2u * rr,
        cy + c2v * rr,
        cx + pts[i + 1].u * rr,
        cy + pts[i + 1].v * rr,
      );
    }
    ctx.stroke();
    if (state.partStudio.mode === 'reshape' && selected) {
      for (let seg = 0; seg < pts.length - 1; seg++) {
        const { c1u, c1v, c2u, c2v } = segmentControlsNorm(pts, seg);
        const p0 = pts[seg];
        const p1 = pts[seg + 1];
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(cx + p0.u * rr, cy + p0.v * rr);
        ctx.lineTo(cx + c1u * rr, cy + c1v * rr);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx + p1.u * rr, cy + p1.v * rr);
        ctx.lineTo(cx + c2u * rr, cy + c2v * rr);
        ctx.stroke();
        ctx.setLineDash([]);
        const drawHandle = (hu, hv, fill, isActive) => {
          const hx = cx + hu * rr;
          const hy = cy + hv * rr;
          ctx.fillStyle = fill;
          ctx.strokeStyle = '#0f172a';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.rect(hx - (isActive ? 5 : 4), hy - (isActive ? 5 : 4), isActive ? 10 : 8, isActive ? 10 : 8);
          ctx.fill();
          ctx.stroke();
        };
        const outActive =
          state.partStudio.selectedPoint === seg && state.partStudio.selectedHandle === 'out';
        const inActive =
          state.partStudio.selectedPoint === seg + 1 && state.partStudio.selectedHandle === 'in';
        drawHandle(c1u, c1v, '#14b8a6', outActive);
        drawHandle(c2u, c2v, '#a855f7', inActive);
      }
    }
    if (state.partStudio.mode === 'reshape') {
      for (let pi = 0; pi < s.points.length; pi++) {
        const p = s.points[pi];
        const px = cx + p.u * rr;
        const py = cy + p.v * rr;
        const isPicked =
          state.partStudio.selectedStroke === si &&
          state.partStudio.selectedPoint === pi &&
          state.partStudio.selectedHandle === 'anchor';
        ctx.beginPath();
        ctx.fillStyle = isPicked ? '#ef4444' : (selected ? '#fb923c' : '#64748b');
        ctx.arc(px, py, isPicked ? 5.5 : 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
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
  if (state.playing) {
    stopPlayback();
  } else {
    startPlayback();
  }
  render();
}

function currentPlayDelayMs() {
  if (state.playFps && state.playFps > 0) {
    return Math.max(16, Math.round(1000 / state.playFps));
  }
  return Math.max(40, Number(state.frameMs || 180));
}

function bindGlobalPlaybackKeysOnce() {
  if (bindGlobalPlaybackKeysOnce.did) return;
  bindGlobalPlaybackKeysOnce.did = true;
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' && e.key !== ' ') return;
    if (state.partStudio.open && !state.playing) return;
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;
    e.preventDefault();
    togglePlay();
  });
}

render();
bindGlobalPlaybackKeysOnce();
