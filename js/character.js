// 圆润的白色人偶：每个身体部件都有自己的贴图。
// 涂装在 3D 空间中进行：预先计算每个贴图像素对应的部件本地坐标，
// 画笔会把“离笔尖一定距离内”的所有像素涂上颜色，所以曲面上笔触不会变形。
import * as THREE from 'three';
import { mulberry32 } from './textures.js';

export const TEX = 128;
// 人偶整体缩放（相对原始 1.83 米的大小）：房主可在 30%~50% 之间调整
let charScale = 0.4;
export const getScale = () => charScale;
export function setScale(s) { charScale = Math.max(0.2, Math.min(1, +s || 0.4)); }
export const BASE_COLOR = '#f4f4f2';
export const HUNTER_COLOR = '#ff7b3a';

function capsule(r, total, sx = 1, sz = 1) {
  const g = new THREE.CapsuleGeometry(r, Math.max(0.001, total - 2 * r), 10, 20);
  if (sx !== 1 || sz !== 1) g.scale(sx, 1, sz);
  // 默认 UV 在纵向按顶点序号均分，中段圆柱只占一行像素；改为按高度均匀分布
  const pos = g.attributes.position, uv = g.attributes.uv;
  const half = total / 2;
  for (let i = 0; i < pos.count; i++) uv.setY(i, (pos.getY(i) + half) / total);
  uv.needsUpdate = true;
  return g;
}

// [名称, 几何体构造]
const PART_DEFS = [
  ['head', () => new THREE.SphereGeometry(0.21, 28, 20)],
  ['torso', () => capsule(0.2, 0.74, 1.12, 0.78)],
  ['armL', () => capsule(0.068, 0.64)],
  ['armR', () => capsule(0.068, 0.64)],
  ['legL', () => capsule(0.088, 0.74)],
  ['legR', () => capsule(0.088, 0.74)],
];
export const PART_NAMES = ['头', '身体', '左臂', '右臂', '左腿', '右腿'];

// 姿势：body* 为整体变换，其余为关节欧拉角 [x, y, z]
export const POSES = [
  { name: '站立', icon: '🧍' },
  { name: '蹲下', icon: '🧎', hipsY: 0.38, legL: [1.3, 0, 0.1], legR: [1.3, 0, -0.1], spine: [-0.45, 0, 0], armL: [1.1, 0, 0.25], armR: [1.1, 0, -0.25], neck: [0.35, 0, 0] },
  { name: '坐下', icon: '🪑', hipsY: 0.1, legL: [1.52, 0, 0.06], legR: [1.52, 0, -0.06], armL: [0.25, 0, 0], armR: [0.25, 0, 0] },
  { name: 'T 字', icon: '✈️', armL: [0, 0, -1.57], armR: [0, 0, 1.57] },
  { name: '举手', icon: '🙌', armL: [0, 0, -2.95], armR: [0, 0, 2.95] },
  { name: '大字', icon: '⭐', armL: [0, 0, -2.3], armR: [0, 0, 2.3], legL: [0, 0, -0.38], legR: [0, 0, 0.38] },
  { name: '趴下', icon: '🐊', bodyRX: -1.5708, bodyY: 0.16, bodyZ: 0.9, armL: [-3.0, 0, 0], armR: [-3.0, 0, 0] },
  { name: '平躺', icon: '🛌', bodyRX: 1.5708, bodyY: 0.16, bodyZ: -0.9 },
  { name: '倒立', icon: '🤸', bodyRZ: Math.PI, bodyY: 1.98, armL: [0, 0, -3.05], armR: [0, 0, 3.05], legL: [0, 0, 0.15], legR: [0, 0, -0.15] },
  { name: '抱膝', icon: '🥚', hipsY: 0.1, legL: [2.5, 0, 0.05], legR: [2.5, 0, -0.05], spine: [-0.35, 0, 0], armL: [1.9, 0, 0.35], armR: [1.9, 0, -0.35], neck: [0.3, 0, 0] },
  { name: '单腿', icon: '🦩', legL: [0, 0, 0], legR: [-1.2, 0, 0], armL: [0, 0, -1.2], armR: [0, 0, 1.2] },
  { name: '鞠躬', icon: '🙇', spine: [-1.2, 0, 0], armL: [0.3, 0, 0], armR: [0.3, 0, 0], neck: [0.2, 0, 0] },
];

// 光栅化 UV 三角形，得到“像素 -> 本地坐标”表（只保存被覆盖的像素）
const posMapCache = new Map();
function buildPosMap(key, geo) {
  if (posMapCache.has(key)) return posMapCache.get(key);
  const W = TEX, H = TEX;
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  const index = geo.index ? geo.index.array : null;
  const triCount = index ? index.length / 3 : pos.count / 3;
  const full = new Float32Array(W * H * 3);
  const filled = new Uint8Array(W * H);
  for (let t = 0; t < triCount; t++) {
    const ia = index ? index[t * 3] : t * 3, ib = index ? index[t * 3 + 1] : t * 3 + 1, ic = index ? index[t * 3 + 2] : t * 3 + 2;
    const ax = uv.getX(ia) * W, ay = (1 - uv.getY(ia)) * H;
    const bx = uv.getX(ib) * W, by = (1 - uv.getY(ib)) * H;
    const cx = uv.getX(ic) * W, cy = (1 - uv.getY(ic)) * H;
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(den) < 1e-9) continue;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / den;
      const w2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / den;
      const w3 = 1 - w1 - w2;
      if (w1 < -0.02 || w2 < -0.02 || w3 < -0.02) continue;
      const i = y * W + x;
      full[i * 3] = w1 * pos.getX(ia) + w2 * pos.getX(ib) + w3 * pos.getX(ic);
      full[i * 3 + 1] = w1 * pos.getY(ia) + w2 * pos.getY(ib) + w3 * pos.getY(ic);
      full[i * 3 + 2] = w1 * pos.getZ(ia) + w2 * pos.getZ(ib) + w3 * pos.getZ(ic);
      filled[i] = 1;
    }
  }
  // 向外扩张几圈，避免贴图接缝处出现未涂到的细线
  for (let pass = 0; pass < 3; pass++) {
    const add = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (filled[i]) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (filled[j] === 1) { add.push(i, j); break; }
      }
    }
    for (let k = 0; k < add.length; k += 2) {
      const i = add[k], j = add[k + 1];
      full[i * 3] = full[j * 3]; full[i * 3 + 1] = full[j * 3 + 1]; full[i * 3 + 2] = full[j * 3 + 2];
      filled[i] = 2;
    }
    for (let i = 0; i < filled.length; i++) if (filled[i] === 2) filled[i] = 1;
  }
  let n = 0;
  for (let i = 0; i < filled.length; i++) if (filled[i]) n++;
  const idx = new Uint32Array(n), p = new Float32Array(n * 3);
  let k = 0;
  for (let i = 0; i < filled.length; i++) if (filled[i]) {
    idx[k] = i; p[k * 3] = full[i * 3]; p[k * 3 + 1] = full[i * 3 + 1]; p[k * 3 + 2] = full[i * 3 + 2]; k++;
  }
  const res = { idx, p };
  posMapCache.set(key, res);
  return res;
}

function hexRGB(c) {
  const n = parseInt(String(c).replace('#', ''), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function makeNameSprite(text, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 30px "PingFang SC","Microsoft YaHei",sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const w = Math.min(250, g.measureText(text).width + 24);
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.beginPath(); g.roundRect(128 - w / 2, 8, w, 48, 16); g.fill();
  g.fillStyle = color; g.fillText(text, 128, 33);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(1.2, 0.3, 1);
  s.renderOrder = 10;
  return s;
}

const lerpA = (a, b, t) => a + (b - a) * t;

export class Character {
  constructor(id, name, opts = {}) {
    this.id = id;
    this.name = name;
    this.isClone = !!opts.clone;
    this.root = new THREE.Group();
    this.root.scale.setScalar(charScale);
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.hips = new THREE.Group();
    this.hips.position.y = 0.72;
    this.body.add(this.hips);
    this.spine = new THREE.Group();
    this.hips.add(this.spine);

    this.canvases = []; this.ctxs = []; this.textures = []; this.meshes = []; this.imgs = []; this.pmaps = [];
    this.dirty = new Set();
    const pivots = {};
    const mkPart = (idx, parent, px, py, pz, offY) => {
      const [pname, mkGeo] = PART_DEFS[idx];
      const c = document.createElement('canvas');
      c.width = TEX; c.height = TEX;
      const g = c.getContext('2d', { willReadFrequently: true });
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.userData = { canvas: c, ctx: g };
      const geo = mkGeo();
      const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex }));
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.userData = { pid: id, part: idx, clone: this.isClone };
      const pivot = new THREE.Group();
      pivot.position.set(px, py, pz);
      mesh.position.y = offY;
      pivot.add(mesh);
      parent.add(pivot);
      pivots[pname] = pivot;
      this.canvases[idx] = c; this.ctxs[idx] = g; this.textures[idx] = tex; this.meshes[idx] = mesh;
      this.imgs[idx] = g.createImageData(TEX, TEX);
      this.pmaps[idx] = buildPosMap(pname, geo);
    };
    mkPart(4, this.hips, -0.1, 0, 0, -0.36);
    mkPart(5, this.hips, 0.1, 0, 0, -0.36);
    mkPart(1, this.spine, 0, 0, 0, 0.35);
    mkPart(0, this.spine, 0, 0.68, 0, 0.2);
    mkPart(2, this.spine, -0.3, 0.58, 0, -0.29);
    mkPart(3, this.spine, 0.3, 0.58, 0, -0.29);
    this.j = { head: pivots.head, armL: pivots.armL, armR: pivots.armR, legL: pivots.legL, legR: pivots.legR };

    // 猎人帽子
    const capMat = new THREE.MeshLambertMaterial({ color: '#d63031' });
    this.hat = new THREE.Group();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.215, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), capMat);
    dome.position.y = 0.22;
    const visor = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.025, 16, 1, false, Math.PI / 2, Math.PI), capMat);
    visor.scale.set(1.2, 1, 1.4);
    visor.position.set(0, 0.23, -0.16);
    this.hat.add(dome, visor);
    this.hat.traverse(o => { o.castShadow = true; o.userData = { pid: id, part: 0, clone: this.isClone }; });
    this.hat.visible = false;
    this.j.head.add(this.hat);

    this.tag = makeNameSprite(name, '#ffffff');
    this.placeTag();
    if (this.isClone) this.tag.visible = false;

    this.loading = 0;
    this.opQueue = [];
    this.pose = 0;
    this.cur = this.targetPose(0);
    this.walkPhase = 0;
    this.moving = false;
    this.resetSkin(false);
  }

  setName(name, color = '#ffffff') {
    this.root.remove(this.tag);
    this.tag.material.map.dispose(); this.tag.material.dispose();
    this.tag = makeNameSprite(name, color);
    this.placeTag();
  }

  placeTag() {
    this.tag.position.y = 2.25;
    this.root.add(this.tag);
    this.applyScale();
  }

  applyScale() {
    const s = this.root.scale.x;
    if (s !== charScale) this.root.scale.setScalar(charScale);
    // 名字标签保持差不多的屏幕大小
    this.tag.scale.set(0.8 / charScale, 0.2 / charScale, 1);
  }

  // 撤销用：保存 / 恢复整套涂装
  getSkin() { this.flush(); return this.imgs.map(im => new Uint8ClampedArray(im.data)); }
  setSkin(arr) {
    arr.forEach((d, i) => { if (this.imgs[i]) { this.imgs[i].data.set(d); this.dirty.add(i); } });
    this.flush();
  }

  // ---------- 涂装 ----------
  fillPart(p, rgb) {
    const d = this.imgs[p].data;
    for (let i = 0; i < d.length; i += 4) { d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2]; d[i + 3] = 255; }
    this.dirty.add(p);
  }

  // 在部件本地坐标 (x,y,z) 处画一个半径 r（米）的球形笔触
  dab(p, x, y, z, r, rgb, spray = 0, seed = 1) {
    const pm = this.pmaps[p], d = this.imgs[p] && this.imgs[p].data;
    if (!pm || !d) return;
    const r2 = r * r;
    const rnd = spray ? mulberry32(seed) : null;
    const { idx, p: P } = pm;
    for (let k = 0; k < idx.length; k++) {
      const dx = P[k * 3] - x, dy = P[k * 3 + 1] - y, dz = P[k * 3 + 2] - z;
      if (dx * dx + dy * dy + dz * dz > r2) continue;
      if (rnd && rnd() > 0.16) continue;
      const i = idx[k] * 4;
      d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2]; d[i + 3] = 255;
    }
    this.dirty.add(p);
  }

  drawFace() {
    // 头部朝向 -z，两只黑色圆眼睛
    const R = 0.21;
    for (const sx of [-1, 1]) {
      const v = new THREE.Vector3(sx * 0.075, 0.035, -0.19).normalize().multiplyScalar(R);
      this.dab(0, v.x, v.y, v.z, 0.036, [28, 28, 30]);
      const h = new THREE.Vector3(sx * 0.075 - 0.012, 0.055, -0.19).normalize().multiplyScalar(R);
      this.dab(0, h.x, h.y, h.z, 0.011, [255, 255, 255]);
    }
  }

  resetSkin(hunter) {
    const base = hexRGB(hunter ? HUNTER_COLOR : BASE_COLOR);
    for (let i = 0; i < this.meshes.length; i++) this.fillPart(i, base);
    if (hunter) {
      // 腰带
      const { idx, p } = this.pmaps[1], d = this.imgs[1].data;
      for (let k = 0; k < idx.length; k++) {
        const y = p[k * 3 + 1];
        if (y > -0.2 && y < -0.13) { const i = idx[k] * 4; d[i] = 45; d[i + 1] = 52; d[i + 2] = 54; }
      }
    }
    this.drawFace();
    this.hat.visible = !!hunter;
  }

  // op: [kind, part, x, y, z, r, color, seed]
  // kind 0=圆刷 1=填满部件 2=喷点 3=全身填充 5=重置
  applyOp(op) {
    if (this.loading) { this.opQueue.push(op); return; }
    const [k, p, x, y, z, r, c, s] = op;
    if (k === 5) { this.resetSkin(false); return; }
    const rgb = hexRGB(c);
    if (k === 3) { for (let i = 0; i < this.meshes.length; i++) this.fillPart(i, rgb); return; }
    if (!this.imgs[p]) return;
    if (k === 1) { this.fillPart(p, rgb); return; }
    const rr = Math.max(0.005, Math.min(0.3, +r || 0.05));
    this.dab(p, +x, +y, +z, rr, rgb, k === 2 ? 1 : 0, s | 0);
  }

  // 把改动写回 canvas 并通知 GPU（每帧最多一次）
  flush() {
    if (!this.dirty.size) return;
    for (const p of this.dirty) {
      this.ctxs[p].putImageData(this.imgs[p], 0, 0);
      this.textures[p].needsUpdate = true;
    }
    this.dirty.clear();
  }

  copySkinFrom(other) {
    other.flush();
    for (let i = 0; i < this.meshes.length; i++) {
      this.imgs[i].data.set(other.imgs[i].data);
      this.dirty.add(i);
    }
    this.hat.visible = other.hat.visible;
    this.flush();
  }

  snapshot() {
    this.flush();
    return this.canvases.map(c => {
      const u = c.toDataURL('image/webp', 0.92);
      return u.startsWith('data:image/webp') ? u : c.toDataURL('image/png');
    });
  }

  // 图片解码是异步的：加载期间收到的笔触先排队，加载完再补上
  loadSnapshot(urls) {
    const list = urls.map((u, i) => [u, i]).filter(([u, i]) => typeof u === 'string' && this.ctxs[i]);
    if (!list.length) return;
    this.loading = (this.loading || 0) + list.length;
    if (!this.opQueue) this.opQueue = [];
    for (const [u, i] of list) {
      const img = new Image();
      const done = () => {
        this.loading--;
        if (this.loading === 0) { const q = this.opQueue; this.opQueue = []; q.forEach(op => this.applyOp(op)); }
      };
      img.onload = () => {
        const g = this.ctxs[i];
        g.clearRect(0, 0, TEX, TEX);
        g.drawImage(img, 0, 0, TEX, TEX);
        this.imgs[i] = g.getImageData(0, 0, TEX, TEX);
        this.textures[i].needsUpdate = true;
        done();
      };
      img.onerror = done;
      img.src = u;
    }
  }

  // ---------- 姿势与动画 ----------
  targetPose(i) {
    const p = POSES[i] || POSES[0];
    const z = [0, 0, 0];
    return {
      bodyRX: p.bodyRX || 0, bodyRZ: p.bodyRZ || 0, bodyY: p.bodyY || 0, bodyZ: p.bodyZ || 0,
      hipsY: p.hipsY ?? 0.72,
      spine: p.spine || z, neck: p.neck || z,
      armL: p.armL || z, armR: p.armR || z, legL: p.legL || z, legR: p.legR || z,
    };
  }

  snapPose() { this.cur = this.targetPose(this.pose); this.update(0); }

  update(dt) {
    this.flush();
    const tp = this.targetPose(this.pose);
    const k = dt ? 1 - Math.exp(-dt * 14) : 1;
    const c = this.cur;
    for (const key of ['bodyRX', 'bodyRZ', 'bodyY', 'bodyZ', 'hipsY']) c[key] = lerpA(c[key], tp[key], k);
    for (const key of ['spine', 'neck', 'armL', 'armR', 'legL', 'legR']) c[key] = c[key].map((v, i) => lerpA(v, tp[key][i], k));

    let swing = 0;
    if (this.moving && this.pose === 0) { this.walkPhase += dt * 10; swing = Math.sin(this.walkPhase) * 0.7; }
    else this.walkPhase = 0;

    this.body.rotation.set(c.bodyRX, 0, c.bodyRZ);
    this.body.position.set(0, c.bodyY, c.bodyZ);
    this.hips.position.y = c.hipsY;
    this.spine.rotation.set(...c.spine);
    this.j.head.rotation.set(...c.neck);
    this.j.armL.rotation.set(c.armL[0] - swing, c.armL[1], c.armL[2]);
    this.j.armR.rotation.set(c.armR[0] + swing, c.armR[1], c.armR[2]);
    this.j.legL.rotation.set(c.legL[0] + swing, c.legL[1], c.legL[2]);
    this.j.legR.rotation.set(c.legR[0] - swing, c.legR[1], c.legR[2]);
  }

  dispose() {
    this.root.traverse(o => {
      if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    });
    // 几何体各实例独立创建，这里一起释放
    this.root.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  }
}
