// 可涂装的方块小人：每个身体部件都有自己的 canvas 贴图（3×2 格，每格对应盒子的一个面）
import * as THREE from 'three';
import { mulberry32 } from './textures.js';

export const CW = 192, CH = 128, CELL = 64;
export const BASE_COLOR = '#f2f2f2';
export const HUNTER_COLOR = '#ff7b3a';

// [名称, 尺寸]
const PART_DEFS = [
  ['head', [0.46, 0.44, 0.44]],
  ['torso', [0.54, 0.66, 0.3]],
  ['armL', [0.17, 0.62, 0.17]],
  ['armR', [0.17, 0.62, 0.17]],
  ['legL', [0.22, 0.7, 0.24]],
  ['legR', [0.22, 0.7, 0.24]],
];
export const PART_NAMES = ['头', '身体', '左臂', '右臂', '左腿', '右腿'];

// 姿势：body* 为整体变换，其余为关节欧拉角 [x, y, z]
export const POSES = [
  { name: '站立' },
  { name: '蹲下', hipsY: 0.36, legL: [1.3, 0, 0.1], legR: [1.3, 0, -0.1], spine: [-0.45, 0, 0], armL: [1.1, 0, 0.25], armR: [1.1, 0, -0.25], neck: [0.35, 0, 0] },
  { name: '坐下', hipsY: 0.13, legL: [1.52, 0, 0.06], legR: [1.52, 0, -0.06], armL: [0.25, 0, 0], armR: [0.25, 0, 0] },
  { name: 'T 字', armL: [0, 0, -1.57], armR: [0, 0, 1.57] },
  { name: '举手', armL: [0, 0, -2.95], armR: [0, 0, 2.95] },
  { name: '大字', armL: [0, 0, -2.3], armR: [0, 0, 2.3], legL: [0, 0, -0.38], legR: [0, 0, 0.38] },
  { name: '趴下', bodyRX: -1.5708, bodyY: 0.15, bodyZ: 0.9, armL: [-3.0, 0, 0], armR: [-3.0, 0, 0] },
  { name: '平躺', bodyRX: 1.5708, bodyY: 0.15, bodyZ: -0.9 },
  { name: '倒立', bodyRZ: Math.PI, bodyY: 1.98, armL: [0, 0, -3.05], armR: [0, 0, 3.05], legL: [0, 0, 0.15], legR: [0, 0, -0.15] },
];

// 把 BoxGeometry 六个面的 UV 分别映射到 3×2 网格，让每个面拥有独立画布区域
function remapUV(geo) {
  const uv = geo.attributes.uv;
  for (let f = 0; f < 6; f++) {
    const col = f % 3, row = Math.floor(f / 3);
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, (col + uv.getX(i)) / 3, (row + uv.getY(i)) / 2);
    }
  }
  uv.needsUpdate = true;
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
  constructor(id, name) {
    this.id = id;
    this.name = name;
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.hips = new THREE.Group();
    this.hips.position.y = 0.7;
    this.body.add(this.hips);
    this.spine = new THREE.Group();
    this.hips.add(this.spine);

    this.canvases = []; this.ctxs = []; this.textures = []; this.meshes = [];
    const pivots = {};
    const mkPart = (idx, parent, px, py, pz, offY) => {
      const [pname, size] = PART_DEFS[idx];
      const c = document.createElement('canvas');
      c.width = CW; c.height = CH;
      const g = c.getContext('2d', { willReadFrequently: true });
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.userData = { canvas: c, ctx: g };
      const geo = new THREE.BoxGeometry(...size);
      remapUV(geo);
      const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex }));
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.userData = { pid: id, part: idx };
      const pivot = new THREE.Group();
      pivot.position.set(px, py, pz);
      mesh.position.y = offY;
      pivot.add(mesh);
      parent.add(pivot);
      pivots[pname] = pivot;
      this.canvases[idx] = c; this.ctxs[idx] = g; this.textures[idx] = tex; this.meshes[idx] = mesh;
    };
    mkPart(4, this.hips, -0.12, 0, 0, -0.35);
    mkPart(5, this.hips, 0.12, 0, 0, -0.35);
    mkPart(1, this.spine, 0, 0, 0, 0.33);
    mkPart(0, this.spine, 0, 0.66, 0, 0.22);
    mkPart(2, this.spine, -0.36, 0.6, 0, -0.28);
    mkPart(3, this.spine, 0.36, 0.6, 0, -0.28);
    this.j = { head: pivots.head, armL: pivots.armL, armR: pivots.armR, legL: pivots.legL, legR: pivots.legR };

    // 猎人帽子
    const capMat = new THREE.MeshLambertMaterial({ color: '#d63031' });
    this.hat = new THREE.Group();
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.48), capMat);
    top.position.y = 0.5;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.04, 0.26), capMat);
    visor.position.set(0, 0.44, -0.32);
    this.hat.add(top, visor);
    this.hat.traverse(o => { o.castShadow = true; o.userData = { pid: id, part: 0 }; });
    this.hat.visible = false;
    this.j.head.add(this.hat);

    this.tag = makeNameSprite(name, '#ffffff');
    this.tag.position.y = 2.25;
    this.root.add(this.tag);

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
    this.tag.position.y = 2.25;
    this.root.add(this.tag);
  }

  // ---------- 涂装 ----------
  drawFace() {
    const g = this.ctxs[0];
    // 头部 -z 面 (索引5) => 第 2 列第 1 行 => 画布 x:128..192, y:0..64
    const x0 = 128, y0 = 0;
    g.fillStyle = '#1e1e1e';
    g.beginPath(); g.ellipse(x0 + 21, y0 + 28, 5, 8, 0, 0, 7); g.fill();
    g.beginPath(); g.ellipse(x0 + 43, y0 + 28, 5, 8, 0, 0, 7); g.fill();
    g.fillStyle = '#ffffff';
    g.fillRect(x0 + 20, y0 + 23, 2.5, 3); g.fillRect(x0 + 42, y0 + 23, 2.5, 3);
  }

  resetSkin(hunter) {
    for (let i = 0; i < 6; i++) {
      const g = this.ctxs[i];
      g.fillStyle = hunter ? HUNTER_COLOR : BASE_COLOR;
      g.fillRect(0, 0, CW, CH);
      if (hunter && i === 1) { g.fillStyle = '#2d3436'; g.fillRect(0, 46, CW, 8); g.fillRect(0, 110, CW, 8); }
    }
    this.drawFace();
    this.hat.visible = !!hunter;
    this.textures.forEach(t => t.needsUpdate = true);
  }

  // op: [kind, part, x, y, r, color, seed]  kind 0=圆刷 1=填充部件 2=喷枪 3=全身填充 4=填充单面 5=重置
  applyOp(op) {
    const [k, p, x, y, r, c, s] = op;
    if (k === 5) { this.resetSkin(false); return; }
    if (k === 3) {
      for (let i = 0; i < 6; i++) { this.ctxs[i].fillStyle = c; this.ctxs[i].fillRect(0, 0, CW, CH); this.textures[i].needsUpdate = true; }
      return;
    }
    const g = this.ctxs[p];
    if (!g) return;
    if (k === 1) {
      g.fillStyle = c; g.fillRect(0, 0, CW, CH);
    } else {
      const cx = Math.floor(x / CELL) * CELL, cy = Math.floor(y / CELL) * CELL;
      g.save();
      g.beginPath(); g.rect(cx, cy, CELL, CELL); g.clip();
      g.fillStyle = c;
      if (k === 0) {
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      } else if (k === 2) {
        const rnd = mulberry32(s || 1);
        const n = Math.ceil(r * r * 0.35) + 3;
        for (let i = 0; i < n; i++) {
          const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * r;
          const sz = 1 + rnd() * 1.6;
          g.fillRect(x + Math.cos(a) * d - sz / 2, y + Math.sin(a) * d - sz / 2, sz, sz);
        }
      } else if (k === 4) {
        g.fillRect(cx, cy, CELL, CELL); // 填充单个面
      }
      g.restore();
    }
    this.textures[p].needsUpdate = true;
  }

  snapshot() {
    return this.canvases.map(c => c.toDataURL('image/png'));
  }

  loadSnapshot(urls) {
    urls.forEach((u, i) => {
      if (!u || !this.ctxs[i]) return;
      const img = new Image();
      img.onload = () => { this.ctxs[i].clearRect(0, 0, CW, CH); this.ctxs[i].drawImage(img, 0, 0); this.textures[i].needsUpdate = true; };
      img.src = u;
    });
  }

  // ---------- 姿势与动画 ----------
  targetPose(i) {
    const p = POSES[i] || POSES[0];
    const z = [0, 0, 0];
    return {
      bodyRX: p.bodyRX || 0, bodyRZ: p.bodyRZ || 0, bodyY: p.bodyY || 0, bodyZ: p.bodyZ || 0,
      hipsY: p.hipsY ?? 0.7,
      spine: p.spine || z, neck: p.neck || z,
      armL: p.armL || z, armR: p.armR || z, legL: p.legL || z, legR: p.legR || z,
    };
  }

  update(dt) {
    const tp = this.targetPose(this.pose);
    const k = 1 - Math.exp(-dt * 14);
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
      if (o.geometry) o.geometry.dispose();
      if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    });
  }
}
