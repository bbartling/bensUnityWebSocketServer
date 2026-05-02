/**
 * Blender-style 3D preview for Part Studio (Three.js).
 * Animation stays 2D on the main stage; this is preview-only.
 */

let THREE = null;
let loadThreePromise = null;

async function ensureThree() {
  if (THREE) return THREE;
  if (!loadThreePromise) {
    loadThreePromise = import('https://cdn.jsdelivr.net/npm/three@0.161.0/+esm').then((m) => m);
  }
  THREE = await loadThreePromise;
  return THREE;
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
  const t = (u + 1) * 0.5;
  const px = a.x + basis.tx * basis.len * t + basis.nx * v * basis.len * 0.33;
  const py = a.y + basis.ty * basis.len * t + basis.ny * v * basis.len * 0.33;
  return { x: px, y: py };
}

function stageToPreview(wx, wy) {
  const s = 0.0042;
  return { x: (wx - 640) * s, y: -(wy - 360) * s, z: 0 };
}

function cubic2d(p0, p1, p2, p3, t) {
  const o = 1 - t;
  return o * o * o * p0 + 3 * o * o * t * p1 + 3 * o * t * t * p2 + t * t * t * p3;
}

function sampleStrokeToVectors3(part, pose, stroke, THREE_) {
  const pts = stroke.points;
  if (!pts?.length) return [];
  const out = [];
  const pushW = (u, v) => {
    const w = mapNormToWorld(part, pose, u, v);
    const p = stageToPreview(w.x, w.y);
    out.push(new THREE_.Vector3(p.x, p.y, p.z));
  };
  pushW(pts[0].u || 0, pts[0].v || 0);
  for (let i = 0; i < pts.length - 1; i++) {
    const { c1u, c1v, c2u, c2v } = segmentControlsNorm(pts, i);
    const p0u = pts[i].u;
    const p0v = pts[i].v;
    const p3u = pts[i + 1].u;
    const p3v = pts[i + 1].v;
    for (let k = 1; k <= 12; k++) {
      const t = k / 12;
      pushW(cubic2d(p0u, c1u, c2u, p3u, t), cubic2d(p0v, c1v, c2v, p3v, t));
    }
  }
  return out;
}

function centroid3(vectors) {
  if (!vectors.length) return null;
  const c = vectors[0].clone();
  for (let i = 1; i < vectors.length; i++) c.add(vectors[i]);
  c.multiplyScalar(1 / vectors.length);
  return c;
}

function drawStrokesTexture(strokes, size = 192) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f1f5f9';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1;
  for (let g = 0; g < size; g += 24) {
    ctx.beginPath();
    ctx.moveTo(g, 0);
    ctx.lineTo(g, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, g);
    ctx.lineTo(size, g);
    ctx.stroke();
  }
  const cx = size * 0.5;
  const cy = size * 0.5;
  const rr = size * 0.38;
  for (const s of strokes || []) {
    if (!s?.points || s.points.length < 2) continue;
    ctx.strokeStyle = s.color || '#0f172a';
    ctx.lineWidth = Math.max(1.5, (s.widthNorm || 0.05) * size * 0.35);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    const p0 = s.points[0];
    ctx.moveTo(cx + p0.u * rr, cy + p0.v * rr);
    for (let i = 0; i < s.points.length - 1; i++) {
      const { c1u, c1v, c2u, c2v } = segmentControlsNorm(s.points, i);
      ctx.bezierCurveTo(
        cx + c1u * rr,
        cy + c1v * rr,
        cx + c2u * rr,
        cy + c2v * rr,
        cx + s.points[i + 1].u * rr,
        cy + s.points[i + 1].v * rr,
      );
    }
    ctx.stroke();
  }
  return c;
}

let previewInst = null;

class PartStudioPreview3D {
  constructor(mountEl, getSnapshot) {
    this.mountEl = mountEl;
    this.getSnapshot = getSnapshot;
    this.dirty = true;
    this.disposed = false;
    this.angX = 0.65;
    this.angY = 0.55;
    this.dist = 2.85;
    this.center = null;
    this.drag = null;
    this._raf = 0;
    this._lastHash = '';
  }

  async init() {
    const T = await ensureThree();
    if (this.disposed || !this.mountEl) return;
    this.THREE = T;
    const w = this.mountEl.clientWidth || 280;
    const h = this.mountEl.clientHeight || 280;
    this.scene = new T.Scene();
    this.scene.background = new T.Color(0x0f172a);
    this.camera = new T.PerspectiveCamera(42, w / Math.max(1, h), 0.05, 50);
    this.renderer = new T.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setSize(w, h);
    this.renderer.setClearColor(0x0f172a, 1);
    this.mountEl.innerHTML = '';
    this.mountEl.appendChild(this.renderer.domElement);

    this.scene.add(new T.HemisphereLight(0x9fb0cc, 0x1e293b, 0.85));
    const dl = new T.DirectionalLight(0xffffff, 0.9);
    dl.position.set(2, 4, 3);
    this.scene.add(dl);

    const grid = new T.GridHelper(3.5, 14, 0x475569, 0x334155);
    grid.rotation.x = Math.PI / 2;
    grid.position.y = -0.55;
    this.scene.add(grid);
    this.scene.add(new T.AxesHelper(0.65));

    this.meshGroup = new T.Group();
    this.scene.add(this.meshGroup);

    this._onPointerDown = (e) => {
      this.drag = { x: e.clientX, y: e.clientY, ax: this.angX, ay: this.angY };
      this.renderer.domElement.setPointerCapture?.(e.pointerId);
    };
    this._onPointerMove = (e) => {
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      this.angX = this.drag.ax + dx * 0.006;
      this.angY = Math.max(0.12, Math.min(1.35, this.drag.ay + dy * 0.006));
    };
    this._onPointerUp = () => {
      this.drag = null;
    };
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this._onPointerDown);
    el.addEventListener('pointermove', this._onPointerMove);
    el.addEventListener('pointerup', this._onPointerUp);
    el.addEventListener('pointercancel', this._onPointerUp);

    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(this.mountEl);

    this._loop = () => {
      if (this.disposed) return;
      this._raf = requestAnimationFrame(this._loop);
      this._tick();
    };
    this._loop();
  }

  _resize() {
    if (!this.renderer || !this.mountEl) return;
    const w = this.mountEl.clientWidth || 280;
    const h = this.mountEl.clientHeight || 280;
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  _hashSnap(s) {
    try {
      return JSON.stringify(s);
    } catch {
      return String(Math.random());
    }
  }

  _rebuildMeshes() {
    const T = this.THREE;
    const snap = this.getSnapshot();
    const h = this._hashSnap(snap);
    if (h === this._lastHash && !this.dirty) return;
    this._lastHash = h;
    this.dirty = false;

    while (this.meshGroup.children.length) {
      const ch = this.meshGroup.children[0];
      this.meshGroup.remove(ch);
      if (ch.geometry) ch.geometry.dispose();
      if (ch.material) {
        if (Array.isArray(ch.material)) {
          ch.material.forEach((m) => {
            m.map?.dispose?.();
            m.dispose?.();
          });
        } else {
          ch.material.map?.dispose?.();
          ch.material.dispose?.();
        }
      }
    }

    const { part, pose, mode, viewYaw } = snap;
    if (!pose || !part) {
      this.center = new T.Vector3(0, 0.2, 0);
      return;
    }

    if (mode === 'cycler' && Array.isArray(snap.faceStrokes) && Number.isFinite(snap.sides)) {
      const sides = Math.max(4, Math.min(24, Math.floor(Number(snap.sides))));
      const wx = Math.max(0.35, Math.min(2.2, Number(snap.widthNorm) || 1));
      const hy = Math.max(0.35, Math.min(2.2, Number(snap.heightNorm) || 1));
      const r = 0.48 * wx;
      const h = 0.95 * hy;
      const mkFaceMat = (strokes) => {
        const cv = drawStrokesTexture(strokes, 200);
        const tex = new T.CanvasTexture(cv);
        if (T.SRGBColorSpace) tex.colorSpace = T.SRGBColorSpace;
        tex.needsUpdate = true;
        return new T.MeshStandardMaterial({ map: tex, roughness: 0.65, metalness: 0.08 });
      };
      const group = new T.Group();
      for (let i = 0; i < sides; i++) {
        const wFace = 2 * r * Math.sin(Math.PI / Math.max(3, sides));
        const geo = new T.PlaneGeometry(wFace, h, 1, 1);
        const strokes = snap.faceStrokes[i] || [];
        const mesh = new T.Mesh(geo, mkFaceMat(strokes));
        const ang = ((i + 0.5) / sides) * Math.PI * 2;
        const ox = Math.cos(ang);
        const oz = Math.sin(ang);
        mesh.position.set(r * ox, 0, r * oz);
        mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), new T.Vector3(ox, 0, oz));
        group.add(mesh);
      }
      const rad = ((Number(viewYaw) || 0) * Math.PI) / 180;
      group.rotation.y = -rad;
      this.meshGroup.add(group);
      this.center = new T.Vector3(0, 0, 0);
    } else {
      const strokes = snap.strokes || [];
      const allPts = [];
      for (const s of strokes) {
        const vecs = sampleStrokeToVectors3(part, pose, s, T);
        for (const v of vecs) allPts.push(v.clone());
        if (vecs.length >= 2) {
          try {
            const curve = new T.CatmullRomCurve3(vecs);
            const tube = new T.TubeGeometry(
              curve,
              Math.min(64, Math.max(8, vecs.length * 2)),
              Math.max(0.012, Math.min(0.05, (s.widthNorm || 0.05) * 0.45)),
              6,
              false,
            );
            const col = new T.Color(s.color || '#0f172a');
            const mat = new T.MeshStandardMaterial({ color: col, roughness: 0.55, metalness: 0.05 });
            this.meshGroup.add(new T.Mesh(tube, mat));
          } catch {
            /* skip degenerate */
          }
        }
      }
      if (allPts.length) {
        const cen = centroid3(allPts);
        this.center = cen || new T.Vector3(0, 0.15, 0);
        for (const ch of this.meshGroup.children) {
          ch.position.sub(this.center);
        }
      } else {
        this.center = new T.Vector3(0, 0.15, 0);
      }
    }
  }

  _tick() {
    if (!this.renderer || this.disposed) return;
    this._rebuildMeshes();
    const c = this.center || new this.THREE.Vector3(0, 0, 0);
    const T = this.THREE;
    const x =
      this.dist * Math.sin(this.angY) * Math.cos(this.angX);
    const z =
      this.dist * Math.sin(this.angY) * Math.sin(this.angX);
    const y = this.dist * Math.cos(this.angY);
    this.camera.position.set(c.x + x, c.y + y, c.z + z);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(c);
    this.renderer.render(this.scene, this.camera);
  }

  markDirty() {
    this.dirty = true;
    this._lastHash = '';
  }

  dispose() {
    this.disposed = true;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
    if (this._ro) this._ro.disconnect();
    this._ro = null;
    const el = this.renderer?.domElement;
    if (el) {
      el.removeEventListener('pointerdown', this._onPointerDown);
      el.removeEventListener('pointermove', this._onPointerMove);
      el.removeEventListener('pointerup', this._onPointerUp);
      el.removeEventListener('pointercancel', this._onPointerUp);
    }
    if (this.meshGroup) {
      while (this.meshGroup.children.length) {
        const ch = this.meshGroup.children[0];
        this.meshGroup.remove(ch);
        ch.geometry?.dispose();
        if (ch.material) {
          if (Array.isArray(ch.material)) {
            ch.material.forEach((m) => {
              m.map?.dispose?.();
              m.dispose?.();
            });
          } else {
            ch.material.map?.dispose?.();
            ch.material.dispose?.();
          }
        }
      }
    }
    this.renderer?.dispose();
    if (this.mountEl) this.mountEl.innerHTML = '';
    this.renderer = null;
    this.scene = null;
    this.camera = null;
  }
}

export function disposePartStudio3d() {
  if (previewInst) {
    previewInst.dispose();
    previewInst = null;
  }
}

export async function mountPartStudio3d(mountEl, getSnapshot) {
  disposePartStudio3d();
  if (!mountEl) return;
  const inst = new PartStudioPreview3D(mountEl, getSnapshot);
  previewInst = inst;
  await inst.init();
}

export function markPartStudio3dDirty() {
  previewInst?.markDirty();
}
