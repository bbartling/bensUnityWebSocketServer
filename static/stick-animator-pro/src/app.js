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
    presetByPart: {},
    brushColor: '#111827',
    brushSize: 5,
    selectedStroke: -1,
    selectedPoint: -1,
    selectedHandle: 'anchor',
    simple4View: false,
    fourViewFace: 'front',
    art: {},
  },
  frames: [{ pose: defaultPose(), viewYaw: 0 }],
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

function stageSvg(playbackOnly = false) {
  const p = current().pose;
  const layers = [];
  const hideBaseRig = !!playbackOnly;
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
    presetByPart: {},
    brushColor: '#111827',
    brushSize: 5,
    selectedStroke: -1,
    selectedPoint: -1,
    selectedHandle: 'anchor',
    simple4View: false,
    fourViewFace: 'front',
    art: {},
  };
  state.partStudio.mode = state.partStudio.mode === 'reshape' ? 'reshape' : 'draw';
  state.partStudio.presetByPart ??= {};
  if (state.partStudio.presetStyle && typeof state.partStudio.presetByPart === 'object') {
    const legacy = state.partStudio.presetStyle;
    if (legacy === 'chunky') {
      state.partStudio.presetByPart.head = 'head_spiky';
      state.partStudio.presetByPart.torso = 'torso_round';
      state.partStudio.presetByPart.leftArm = state.partStudio.presetByPart.rightArm = 'limb_chunky';
      state.partStudio.presetByPart.leftLeg = state.partStudio.presetByPart.rightLeg = 'limb_chunky';
    } else if (legacy === 'robot') {
      state.partStudio.presetByPart.head = 'head_boxy';
      state.partStudio.presetByPart.torso = 'torso_robot';
      state.partStudio.presetByPart.leftArm = state.partStudio.presetByPart.rightArm = 'limb_robot';
      state.partStudio.presetByPart.leftLeg = state.partStudio.presetByPart.rightLeg = 'limb_robot';
      state.partStudio.presetByPart.leftHand = state.partStudio.presetByPart.rightHand = 'hand_robot';
      state.partStudio.presetByPart.leftFoot = state.partStudio.presetByPart.rightFoot = 'foot_robot';
    }
    delete state.partStudio.presetStyle;
  }
  if (state.partStudio.presetByPart && typeof state.partStudio.presetByPart === 'object') {
    for (const key of Object.keys(state.partStudio.presetByPart)) {
      if (typeof state.partStudio.presetByPart[key] !== 'string') delete state.partStudio.presetByPart[key];
    }
  }
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
  state.partStudio.simple4View = !!state.partStudio.simple4View;
  state.partStudio.fourViewFace = ['front', 'right', 'back', 'left'].includes(state.partStudio.fourViewFace)
    ? state.partStudio.fourViewFace
    : 'front';
  if (state.partStudio.simple4View) state.partStudio.mode = 'draw';
  for (const p of PART_TABS) {
    const slot = state.partStudio.art[p];
    if (slot == null) {
      state.partStudio.art[p] = [];
      continue;
    }
    if (isFourViewArt(slot)) continue;
    if (Array.isArray(slot)) continue;
    state.partStudio.art[p] = [];
  }
  for (const fr of state.frames) {
    let y = Number(fr.viewYaw);
    if (!Number.isFinite(y)) y = 0;
    fr.viewYaw = ((y % 360) + 360) % 360;
  }
}

const FOUR_FACES = ['front', 'right', 'back', 'left'];

function isFourViewArt(v) {
  return !!(v && typeof v === 'object' && v.type === 'four' && v.faces && typeof v.faces === 'object');
}

function toFourViewArt(slot) {
  const strokes = Array.isArray(slot) ? [...slot] : isFourViewArt(slot) ? [...(slot.faces?.front || [])] : [];
  return {
    type: 'four',
    faces: { front: strokes, right: [], back: [], left: [] },
  };
}

function collapseArtToFlat(slot) {
  if (isFourViewArt(slot)) return [...(slot.faces?.front || [])];
  return Array.isArray(slot) ? [...slot] : [];
}

function yawToFace(deg) {
  const a = ((Number(deg) || 0) % 360 + 360) % 360;
  if (a >= 315 || a < 45) return 'front';
  if (a < 135) return 'right';
  if (a < 225) return 'back';
  return 'left';
}

function frameViewYaw() {
  return Number(current().viewYaw) || 0;
}

function renderFaceFromYaw() {
  return yawToFace(frameViewYaw());
}

/** Strokes drawn on stage for this part (respects 4-side + turntable). */
function getStrokesListForPartRender(part) {
  const slot = state.partStudio.art[part];
  if (state.partStudio.simple4View && isFourViewArt(slot)) {
    const face = renderFaceFromYaw();
    return slot.faces[face] || [];
  }
  if (isFourViewArt(slot)) return slot.faces?.front || [];
  return Array.isArray(slot) ? slot : [];
}

/** Mutable stroke array for the active Part Studio tab (selected side in 4-view). */
function getEditableStrokesForPart(part) {
  let slot = state.partStudio.art[part];
  if (state.partStudio.simple4View) {
    if (!isFourViewArt(slot)) {
      state.partStudio.art[part] = toFourViewArt(slot);
      slot = state.partStudio.art[part];
    }
    const face = state.partStudio.fourViewFace || 'front';
    if (!slot.faces[face]) slot.faces[face] = [];
    return slot.faces[face];
  }
  if (isFourViewArt(slot)) {
    if (!slot.faces.front) slot.faces.front = [];
    return slot.faces.front;
  }
  if (!Array.isArray(slot)) state.partStudio.art[part] = [];
  return state.partStudio.art[part];
}

const PRESET_DEFAULT_ID = {
  head: 'head_round',
  torso: 'torso_vest',
  leftArm: 'limb_smooth',
  rightArm: 'limb_smooth',
  leftHand: 'hand_round',
  rightHand: 'hand_round',
  leftLeg: 'limb_smooth',
  rightLeg: 'limb_smooth',
  leftFoot: 'foot_sneaker',
  rightFoot: 'foot_sneaker',
};

const PRESET_CHOICES = {
  head: [
    ['head_round', 'Round + smile'],
    ['head_oval', 'Oval portrait'],
    ['head_boxy', 'Boxy / block'],
    ['head_alien', 'Big eyes (alien)'],
    ['head_hood', 'Hood + face'],
    ['head_spiky', 'Spiky hair'],
  ],
  torso: [
    ['torso_vest', 'Vest / jacket'],
    ['torso_tank', 'Tank top'],
    ['torso_robot', 'Robot chest'],
    ['torso_coat', 'Open coat'],
    ['torso_round', 'Round belly'],
  ],
  limb: [
    ['limb_smooth', 'Smooth taper'],
    ['limb_chunky', 'Thick limb'],
    ['limb_robot', 'Segmented bot'],
    ['limb_spring', 'Coil / spring'],
  ],
  hand: [
    ['hand_round', 'Round mitt'],
    ['hand_point', 'Pointing'],
    ['hand_robot', 'Three-finger bot'],
    ['hand_mitten', 'Mitten'],
  ],
  foot: [
    ['foot_sneaker', 'Sneaker'],
    ['foot_boot', 'Boot'],
    ['foot_simple', 'Simple slipper'],
    ['foot_robot', 'Block foot'],
  ],
};

function partPresetCategory(part) {
  if (part === 'head') return 'head';
  if (part === 'torso') return 'torso';
  if (/Arm$/.test(part) || /Leg$/.test(part)) return 'limb';
  if (/Hand$/.test(part)) return 'hand';
  if (/Foot$/.test(part)) return 'foot';
  return 'limb';
}

function presetChoiceListForPart(part) {
  return PRESET_CHOICES[partPresetCategory(part)] || PRESET_CHOICES.limb;
}

function allowedPresetIdsForPart(part) {
  return new Set(presetChoiceListForPart(part).map(([id]) => id));
}

function currentPresetIdForPart(part) {
  ensurePartArt();
  const allowed = allowedPresetIdsForPart(part);
  const saved = state.partStudio.presetByPart?.[part];
  if (saved && allowed.has(saved)) return saved;
  const def = PRESET_DEFAULT_ID[part];
  if (def && allowed.has(def)) return def;
  return presetChoiceListForPart(part)[0][0];
}

function mkPresetStroke(color, widthNorm, points) {
  return {
    color,
    widthNorm,
    points: points.map(([u, v]) => ({ u, v, outU: 0, outV: 0, inU: 0, inV: 0 })),
  };
}

/** Pre-drawn vector strokes for the active part tab (normalized part space). */
function presetPartStrokes(part, presetId) {
  const mk = mkPresetStroke;
  const id = allowedPresetIdsForPart(part).has(presetId) ? presetId : currentPresetIdForPart(part);
  const B = PRESET_STROKE_BUILDERS[id];
  if (typeof B === 'function') return B(mk);
  return PRESET_STROKE_BUILDERS.limb_smooth(mk);
}

const PRESET_STROKE_BUILDERS = {
  head_round: (mk) => [
    mk('#0f172a', 0.075, [
      [0, -0.88], [-0.58, -0.52], [-0.82, 0.05], [-0.52, 0.72], [0, 0.92], [0.52, 0.72], [0.82, 0.05], [0.58, -0.52], [0, -0.88],
    ]),
    mk('#1e293b', 0.055, [
      [-0.38, -0.12], [-0.32, -0.02], [-0.38, 0.08], [-0.44, -0.02], [-0.38, -0.12],
    ]),
    mk('#1e293b', 0.055, [
      [0.38, -0.12], [0.32, -0.02], [0.38, 0.08], [0.44, -0.02], [0.38, -0.12],
    ]),
    mk('#1e293b', 0.055, [[-0.3, 0.48], [0, 0.58], [0.3, 0.48]]),
    mk('#64748b', 0.04, [[-0.55, -0.65], [-0.2, -0.78], [0.2, -0.78], [0.55, -0.65]]),
  ],
  head_oval: (mk) => [
    mk('#0f172a', 0.07, [
      [0, -0.92], [-0.42, -0.75], [-0.65, -0.2], [-0.65, 0.35], [-0.4, 0.78], [0, 0.9], [0.4, 0.78], [0.65, 0.35], [0.65, -0.2], [0.42, -0.75], [0, -0.92],
    ]),
    mk('#334155', 0.045, [[-0.35, -0.05], [-0.25, 0.08]]),
    mk('#334155', 0.045, [[0.35, -0.05], [0.25, 0.08]]),
    mk('#334155', 0.045, [[-0.22, 0.42], [0.22, 0.42]]),
  ],
  head_boxy: (mk) => [
    mk('#0f172a', 0.08, [
      [-0.55, -0.75], [0.55, -0.75], [0.65, -0.35], [0.65, 0.45], [0.45, 0.75], [-0.45, 0.75], [-0.65, 0.45], [-0.65, -0.35], [-0.55, -0.75],
    ]),
    mk('#475569', 0.05, [[-0.35, -0.2], [0.35, -0.2]]),
    mk('#475569', 0.05, [[-0.28, 0.1], [-0.28, 0.35]]),
    mk('#475569', 0.05, [[0.28, 0.1], [0.28, 0.35]]),
    mk('#475569', 0.055, [[-0.25, 0.52], [0.25, 0.52]]),
  ],
  head_alien: (mk) => [
    mk('#0f172a', 0.06, [
      [0, -0.55], [-0.7, -0.15], [-0.85, 0.4], [-0.35, 0.82], [0.35, 0.82], [0.85, 0.4], [0.7, -0.15], [0, -0.55],
    ]),
    mk('#22c55e', 0.08, [
      [-0.45, -0.05], [-0.55, 0.15], [-0.35, 0.35], [-0.12, 0.22], [-0.2, 0], [-0.45, -0.05],
    ]),
    mk('#22c55e', 0.08, [
      [0.45, -0.05], [0.55, 0.15], [0.35, 0.35], [0.12, 0.22], [0.2, 0], [0.45, -0.05],
    ]),
    mk('#0f172a', 0.04, [[-0.08, 0.55], [0.08, 0.55]]),
  ],
  head_hood: (mk) => [
    mk('#1e293b', 0.07, [
      [0, -0.95], [-0.75, -0.55], [-0.88, 0.1], [-0.55, 0.55], [0, 0.65], [0.55, 0.55], [0.88, 0.1], [0.75, -0.55], [0, -0.95],
    ]),
    mk('#64748b', 0.06, [
      [0, -0.35], [-0.42, -0.1], [-0.48, 0.35], [-0.25, 0.62], [0.25, 0.62], [0.48, 0.35], [0.42, -0.1], [0, -0.35],
    ]),
    mk('#0f172a', 0.045, [[-0.2, 0.15], [0.2, 0.15]]),
    mk('#0f172a', 0.045, [[-0.15, 0.38], [0.15, 0.38]]),
  ],
  head_spiky: (mk) => [
    mk('#0f172a', 0.065, [
      [-0.55, 0.15], [-0.45, -0.35], [-0.25, -0.75], [0, -0.95], [0.25, -0.75], [0.45, -0.35], [0.55, 0.15], [0.45, 0.55], [0, 0.78], [-0.45, 0.55], [-0.55, 0.15],
    ]),
    mk('#b45309', 0.06, [[-0.5, -0.2], [-0.35, -0.65], [-0.1, -0.85], [0.1, -0.82], [0.35, -0.55], [0.5, -0.15]]),
    mk('#1e293b', 0.045, [[-0.28, 0.05], [-0.22, 0.22]]),
    mk('#1e293b', 0.045, [[0.28, 0.05], [0.22, 0.22]]),
    mk('#1e293b', 0.05, [[-0.22, 0.42], [0, 0.48], [0.22, 0.42]]),
  ],
  torso_vest: (mk) => [
    mk('#0f172a', 0.085, [
      [-0.55, -0.42], [-0.35, -0.48], [0.35, -0.48], [0.55, -0.42], [0.58, 0.38], [0.35, 0.48], [-0.35, 0.48], [-0.58, 0.38], [-0.55, -0.42],
    ]),
    mk('#334155', 0.055, [[0, -0.48], [0, 0.12], [-0.22, 0.35], [0.22, 0.35], [0, 0.12]]),
    mk('#64748b', 0.045, [[-0.35, -0.25], [0.35, -0.25]]),
  ],
  torso_tank: (mk) => [
    mk('#0f172a', 0.08, [
      [-0.42, -0.45], [-0.22, -0.52], [0.22, -0.52], [0.42, -0.45], [0.48, 0.4], [0.25, 0.5], [-0.25, 0.5], [-0.48, 0.4], [-0.42, -0.45],
    ]),
    mk('#475569', 0.05, [[-0.28, -0.35], [0.28, -0.35]]),
    mk('#475569', 0.04, [[-0.15, 0], [0.15, 0]]),
  ],
  torso_robot: (mk) => [
    mk('#334155', 0.09, [
      [-0.52, -0.45], [0.52, -0.45], [0.55, 0.42], [-0.55, 0.42], [-0.52, -0.45],
    ]),
    mk('#22c55e', 0.05, [[-0.38, -0.25], [0.38, -0.25]]),
    mk('#22c55e', 0.05, [[-0.38, 0.15], [0.38, 0.15]]),
    mk('#64748b', 0.045, [[-0.2, -0.05], [0.2, -0.05]]),
    mk('#64748b', 0.045, [[-0.2, 0.28], [0.2, 0.28]]),
  ],
  torso_coat: (mk) => [
    mk('#0f172a', 0.075, [
      [-0.5, -0.4], [-0.25, -0.52], [0.25, -0.52], [0.5, -0.4], [0.55, 0.45], [0.2, 0.55], [-0.2, 0.55], [-0.55, 0.45], [-0.5, -0.4],
    ]),
    mk('#1e293b', 0.055, [[0, -0.52], [0, 0.35]]),
    mk('#475569', 0.05, [[-0.35, -0.2], [-0.05, 0.05]]),
    mk('#475569', 0.05, [[0.35, -0.2], [0.05, 0.05]]),
  ],
  torso_round: (mk) => [
    mk('#0f172a', 0.08, [
      [-0.45, -0.38], [-0.55, 0.1], [-0.35, 0.48], [0.35, 0.48], [0.55, 0.1], [0.45, -0.38], [0, -0.52], [-0.45, -0.38],
    ]),
    mk('#64748b', 0.045, [[-0.2, -0.15], [0.2, -0.15]]),
    mk('#64748b', 0.04, [[0, -0.05], [0, 0.25]]),
  ],
  limb_smooth: (mk) => [
    mk('#0f172a', 0.085, [[-0.88, -0.06], [-0.55, -0.18], [0.55, 0.18], [0.88, 0.06]]),
    mk('#475569', 0.04, [[-0.35, -0.04], [0.35, 0.04]]),
  ],
  limb_chunky: (mk) => [
    mk('#0f172a', 0.12, [[-0.85, -0.12], [-0.5, -0.22], [0.5, 0.22], [0.85, 0.12]]),
    mk('#334155', 0.06, [[-0.4, -0.08], [0.4, 0.08]]),
  ],
  limb_robot: (mk) => [
    mk('#334155', 0.09, [[-0.82, 0], [-0.5, -0.12], [-0.18, 0], [0.18, 0], [0.5, 0.12], [0.82, 0]]),
    mk('#22c55e', 0.045, [[-0.35, 0], [0.35, 0]]),
    mk('#64748b', 0.04, [[-0.15, -0.06], [-0.15, 0.06]]),
    mk('#64748b', 0.04, [[0.15, -0.06], [0.15, 0.06]]),
  ],
  limb_spring: (mk) => [
    mk('#0f172a', 0.06, [
      [-0.75, -0.15], [-0.55, 0.05], [-0.75, 0.25], [-0.55, 0.45], [-0.75, 0.65], [0.75, 0.15], [0.55, -0.05], [0.75, -0.25], [0.55, -0.45], [0.75, -0.65],
    ]),
  ],
  hand_round: (mk) => [
    mk('#0f172a', 0.08, [
      [-0.22, -0.12], [0, -0.28], [0.28, -0.08], [0.32, 0.18], [0.12, 0.32], [-0.12, 0.32], [-0.32, 0.18], [-0.28, -0.08], [-0.22, -0.12],
    ]),
  ],
  hand_point: (mk) => [
    mk('#0f172a', 0.065, [[-0.15, 0.1], [0.1, -0.35], [0.35, -0.55], [0.42, -0.35], [0.2, -0.1], [0.05, 0.15], [-0.15, 0.1]]),
    mk('#475569', 0.05, [[-0.25, 0.05], [-0.1, 0.22], [0.05, 0.18]]),
  ],
  hand_robot: (mk) => [
    mk('#334155', 0.08, [[-0.25, -0.1], [0.25, -0.1], [0.3, 0.2], [0, 0.35], [-0.3, 0.2], [-0.25, -0.1]]),
    mk('#22c55e', 0.045, [[-0.12, 0], [0.12, 0]]),
    mk('#22c55e', 0.045, [[0, -0.05], [0, 0.22]]),
  ],
  hand_mitten: (mk) => [
    mk('#0f172a', 0.075, [
      [-0.28, 0.05], [-0.2, -0.22], [0, -0.32], [0.2, -0.22], [0.28, 0.05], [0.15, 0.28], [-0.15, 0.28], [-0.28, 0.05],
    ]),
  ],
  foot_sneaker: (mk) => [
    mk('#0f172a', 0.08, [
      [-0.35, -0.08], [0.38, -0.05], [0.42, 0.18], [0.25, 0.32], [-0.28, 0.32], [-0.42, 0.12], [-0.35, -0.08],
    ]),
    mk('#ffffff', 0.05, [[-0.15, 0.02], [0.2, 0.05], [0.22, 0.18]]),
    mk('#1e293b', 0.04, [[-0.25, 0.22], [0.3, 0.25]]),
  ],
  foot_boot: (mk) => [
    mk('#1e293b', 0.09, [
      [-0.25, -0.35], [0.25, -0.35], [0.35, 0.05], [0.32, 0.38], [-0.32, 0.38], [-0.35, 0.05], [-0.25, -0.35],
    ]),
    mk('#451a03', 0.055, [[-0.18, -0.2], [0.18, -0.2], [0.22, 0.12], [-0.22, 0.12], [-0.18, -0.2]]),
  ],
  foot_simple: (mk) => [
    mk('#0f172a', 0.07, [
      [-0.32, -0.05], [0.32, -0.05], [0.38, 0.2], [0.2, 0.35], [-0.2, 0.35], [-0.38, 0.2], [-0.32, -0.05],
    ]),
  ],
  foot_robot: (mk) => [
    mk('#475569', 0.09, [[-0.35, -0.12], [0.35, -0.12], [0.38, 0.28], [-0.38, 0.28], [-0.35, -0.12]]),
    mk('#22c55e', 0.045, [[-0.2, 0.05], [0.2, 0.05]]),
  ],
};

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
    const strokes = getStrokesListForPartRender(part);
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
          <div class="controls view-yaw-row ${state.partStudio.simple4View ? '' : 'is-hidden'}">
            <label class="hint">Turntable (4-side)
              <input id="viewYaw" type="range" min="0" max="360" step="1" value="${Math.round(frameViewYaw())}" />
            </label>
            <span class="hint" id="viewYawReadout">${Math.round(frameViewYaw())}° → ${renderFaceFromYaw()} on stage</span>
          </div>
          <div class="hint">Frame ${state.index + 1} / ${state.frames.length} · ${
            playbackOnly
              ? 'Playback — rig hidden (Part Studio art only)'
              : state.partStudio.simple4View
                ? 'Pose the rig · each part has Front/Back/Left/Right art · Turntable picks which side shows'
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
          <label class="simple-4-toggle hint">
            <input type="checkbox" id="simple4View" ${state.partStudio.simple4View ? 'checked' : ''} />
            Simple 4-side mode (draw front / back / left / right — still 2D, turntable swaps sides)
          </label>
          <div class="simple-four-panel ${state.partStudio.simple4View ? '' : 'is-hidden'}">
            <div class="hint">Painting side (this part only)</div>
            <div class="four-face-bar">
              ${FOUR_FACES.map(
                (f) =>
                  `<button type="button" class="small ${state.partStudio.fourViewFace === f ? 'good' : ''}" data-four-face="${f}">${f}</button>`,
              ).join('')}
            </div>
            <label>Brush color <input id="simpleBrushColor" type="color" value="${state.partStudio.brushColor}" /></label>
            <label>Brush size <input id="simpleBrushSize" type="range" min="2" max="18" step="1" value="${state.partStudio.brushSize}" /></label>
            <button type="button" id="simpleClearFace" class="small danger">Clear this side</button>
          </div>
          <div class="face-studio-tools ${state.partStudio.simple4View ? 'is-hidden' : ''}">
            <label>Mode
              <select id="partMode">
                <option value="draw" ${state.partStudio.mode === 'draw' ? 'selected' : ''}>Draw</option>
                <option value="reshape" ${state.partStudio.mode === 'reshape' ? 'selected' : ''}>Reshape</option>
              </select>
            </label>
            <label class="part-preset-label">Pre-drawn
              <select id="partPresetPick">
                ${presetChoiceListForPart(state.partStudio.part)
                  .map(
                    ([id, label]) =>
                      `<option value="${id}" ${currentPresetIdForPart(state.partStudio.part) === id ? 'selected' : ''}>${label}</option>`,
                  )
                  .join('')}
              </select>
            </label>
            <button type="button" id="partApplyPreset" class="small">Apply to this part</button>
            <label>Brush color <input id="partBrushColor" type="color" value="${state.partStudio.brushColor}" /></label>
            <label>Brush size <input id="partBrushSize" type="range" min="2" max="18" step="1" value="${state.partStudio.brushSize}" /></label>
            <button id="partSmoothCurves" class="small" title="Reset to auto-smooth (Catmull) cubics">Smooth curves</button>
            <button id="partClear" class="small danger">Clear part</button>
          </div>
          <canvas id="partStudioCanvas" width="360" height="360" aria-label="Part Studio canvas"></canvas>
          <p class="hint">${
            state.partStudio.simple4View
              ? '4-side: pick a body tab, pick Front/Right/Back/Left, draw. Use Turntable on the stage to preview. Full vector tools return when you turn this off (other sides are kept but only Front is used in normal mode).'
              : 'Pre-drawn: pick a shape for this body part, then Apply. Draw / reshape as needed. Play mode hides the default stick; only Part Studio art shows.'
          }</p>
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
    state.frames.splice(state.index + 1, 0, clone(current()));
    state.index += 1;
    render();
  });
  document.getElementById('dup').addEventListener('click', () => {
    state.frames.splice(state.index + 1, 0, clone(current()));
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
  document.getElementById('partMode')?.addEventListener('change', (e) => {
    state.partStudio.mode = e.target.value === 'reshape' ? 'reshape' : 'draw';
    state.partStudio.selectedStroke = -1;
    state.partStudio.selectedPoint = -1;
    state.partStudio.selectedHandle = 'anchor';
    drawPartStudioCanvas();
  });
  document.getElementById('partPresetPick')?.addEventListener('change', (e) => {
    const part = state.partStudio.part;
    state.partStudio.presetByPart ??= {};
    const v = e.target.value;
    if (allowedPresetIdsForPart(part).has(v)) state.partStudio.presetByPart[part] = v;
  });
  document.getElementById('partApplyPreset')?.addEventListener('click', () => {
    const part = state.partStudio.part;
    const pid = currentPresetIdForPart(part);
    state.partStudio.presetByPart ??= {};
    state.partStudio.presetByPart[part] = pid;
    const arr = getEditableStrokesForPart(part);
    const newStrokes = presetPartStrokes(part, pid);
    arr.length = 0;
    for (const s of newStrokes) arr.push(s);
    state.partStudio.selectedStroke = -1;
    state.partStudio.selectedPoint = -1;
    state.partStudio.selectedHandle = 'anchor';
    drawPartStudioCanvas();
    document.getElementById('stage').innerHTML = stageSvg(!!state.playing);
  });
  document.getElementById('partSmoothCurves')?.addEventListener('click', () => {
    const part = state.partStudio.part;
    const strokes = getEditableStrokesForPart(part);
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
  document.getElementById('partBrushColor')?.addEventListener('input', (e) => { state.partStudio.brushColor = e.target.value || '#111827'; });
  document.getElementById('partBrushSize')?.addEventListener('input', (e) => { state.partStudio.brushSize = Math.max(2, Math.min(18, Number(e.target.value || 5))); });
  document.getElementById('simpleBrushColor')?.addEventListener('input', (e) => { state.partStudio.brushColor = e.target.value || '#111827'; });
  document.getElementById('simpleBrushSize')?.addEventListener('input', (e) => { state.partStudio.brushSize = Math.max(2, Math.min(18, Number(e.target.value || 5))); });
  document.getElementById('simpleClearFace')?.addEventListener('click', () => {
    getEditableStrokesForPart(state.partStudio.part).length = 0;
    state.partStudio.selectedStroke = -1;
    state.partStudio.selectedPoint = -1;
    state.partStudio.selectedHandle = 'anchor';
    drawPartStudioCanvas();
    document.getElementById('stage').innerHTML = stageSvg(!!state.playing);
  });
  document.getElementById('simple4View')?.addEventListener('change', (e) => {
    if (e.target.checked) {
      for (const p of PART_TABS) {
        if (!isFourViewArt(state.partStudio.art[p])) state.partStudio.art[p] = toFourViewArt(state.partStudio.art[p]);
      }
      state.partStudio.simple4View = true;
      state.partStudio.mode = 'draw';
    } else {
      for (const p of PART_TABS) {
        state.partStudio.art[p] = collapseArtToFlat(state.partStudio.art[p]);
      }
      state.partStudio.simple4View = false;
    }
    partDrawing = null;
    render();
  });
  document.querySelectorAll('[data-four-face]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.partStudio.fourViewFace = btn.getAttribute('data-four-face') || 'front';
      partDrawing = null;
      render();
    });
  });
  document.getElementById('viewYaw')?.addEventListener('input', (e) => {
    current().viewYaw = Math.max(0, Math.min(360, Number(e.target.value) || 0));
    const r = document.getElementById('viewYawReadout');
    if (r) r.textContent = `${Math.round(current().viewYaw)}° → ${renderFaceFromYaw()} on stage`;
    const st = document.getElementById('stage');
    if (st) st.innerHTML = stageSvg(!!state.playing);
  });
  document.getElementById('partClear')?.addEventListener('click', () => {
    const part = state.partStudio.part;
    const arr = getEditableStrokesForPart(part);
    arr.length = 0;
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
    const strokes = getEditableStrokesForPart(part);
    if (state.partStudio.mode === 'reshape' && !state.partStudio.simple4View) {
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
    strokes.push(stroke);
    state.partStudio.selectedStroke = strokes.length - 1;
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
      const strokes = getEditableStrokesForPart(state.partStudio.part);
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
  const strokes = getEditableStrokesForPart(part);
  if (state.partStudio.simple4View) {
    ctx.fillStyle = '#334155';
    ctx.font = '600 13px system-ui,sans-serif';
    ctx.fillText(`Painting: ${state.partStudio.fourViewFace}`, 12, 22);
  }
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
