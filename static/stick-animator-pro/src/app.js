const app = document.getElementById('app');

const W = 1280;
const H = 720;

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
  onionSkin: true,
  onionCount: 3,
  onionOpacity: 0.32,
  frames: [{ pose: defaultPose() }],
  index: 0,
  playing: false,
};

let dragJoint = null;
let timer = null;

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function current() {
  return state.frames[state.index];
}

function stageSvg() {
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
    const jn = (k) => `<circle data-joint="${k}" cx="${pose[k].x}" cy="${pose[k].y}" r="15" fill="#7dd3fc" stroke="#ffffff" stroke-width="3"/>`;
    return [
      `<circle cx="${pose.head.x}" cy="${pose.head.y}" r="42" fill="none" stroke="${stroke}" stroke-width="8" opacity="${opacity}"/>`,
      limbs.map(([a, b]) => ln(a, b)).join(''),
      includeJoints ? Object.keys(pose).map(jn).join('') : '',
    ].join('');
  };
  if (state.onionSkin) {
    for (let n = state.onionCount; n >= 1; n--) {
      const prev = state.frames[state.index - n];
      if (!prev) continue;
      const depth = state.onionCount - n + 1;
      const t = depth / state.onionCount;
      const op = state.onionOpacity * (0.24 + 0.76 * t);
      layers.push(drawPose(prev.pose, '#7c8597', op, false));
    }
  }
  layers.push(drawPose(p, '#0f172a', 1, true));
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

function render() {
  app.innerHTML = `
    <div class="wrap">
      <header>
        <div>
          <h1>Stick Animator Pro</h1>
          <div class="hint">Restored in-repo build so /stick-animator-pro/ works on Render and local.</div>
        </div>
        <div class="controls">
          <button id="play" class="good">${state.playing ? 'Pause' : 'Play'}</button>
          <button id="prev">Prev</button>
          <button id="next">Next</button>
          <button id="add">+ Frame</button>
          <button id="dup">Duplicate</button>
          <button id="exportJson">Download JSON</button>
        </div>
      </header>
      <main>
        <section class="panel stage-wrap">
          <div class="controls">
            <label class="hint">Onion skin <input id="onionSkin" type="checkbox" ${state.onionSkin ? 'checked' : ''} /></label>
            <label class="hint">Ghost frames <input id="onionCount" type="number" min="1" max="6" value="${state.onionCount}" /></label>
          </div>
          <div class="hint">Frame ${state.index + 1} / ${state.frames.length} · Drag joints to pose</div>
          <svg id="stage" draggable="false" viewBox="0 0 ${W} ${H}" aria-label="Stick animation stage">${stageSvg()}</svg>
        </section>
      </main>
      <div class="footer">This deploy-safe version is stored in /static/stick-animator-pro.</div>
    </div>
  `;

  document.getElementById('play').addEventListener('click', togglePlay);
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
  document.getElementById('exportJson').addEventListener('click', exportJson);
  document.getElementById('onionSkin').addEventListener('change', (e) => { state.onionSkin = !!e.target.checked; render(); });
  document.getElementById('onionCount').addEventListener('input', (e) => { state.onionCount = Math.max(1, Math.min(6, Number(e.target.value || 3))); render(); });
  bindStageDrag();
}

function bindStageDrag() {
  const svg = document.getElementById('stage');
  if (!svg) return;
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

function playLoop() {
  if (!state.playing) return;
  state.index = (state.index + 1) % state.frames.length;
  render();
  timer = setTimeout(playLoop, state.frameMs);
}

render();
