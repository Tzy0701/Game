// 地图搭建：所有物体都是简单的盒子/圆柱/球，碰撞使用轴对齐包围盒
import * as THREE from 'three';
import * as T from './textures.js';

const matCache = new Map();
export function mat(src) {
  const key = typeof src === 'string' ? src : src.uuid;
  if (matCache.has(key)) return matCache.get(key);
  const m = typeof src === 'string'
    ? new THREE.MeshLambertMaterial({ color: src })
    : new THREE.MeshLambertMaterial({ map: src });
  m.userData.uv = typeof src === 'string' ? 0 : (src.userData.uv || 0);
  matCache.set(key, m);
  return m;
}

// 按世界坐标生成 UV，让相邻盒子上的花纹无缝衔接
function worldUV(geo, c, s) {
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + c.x, y = p.getY(i) + c.y, z = p.getZ(i) + c.z;
    const nx = n.getX(i), ny = n.getY(i), nz = n.getZ(i);
    let u, v;
    if (Math.abs(nx) > 0.5) { u = nx > 0 ? -z : z; v = y; }
    else if (Math.abs(ny) > 0.5) { u = x; v = ny > 0 ? -z : z; }
    else { u = nz > 0 ? x : -x; v = y; }
    uv.setXY(i, u / s, v / s);
  }
  uv.needsUpdate = true;
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.group = null;
    this.mapId = null;
  }

  build(mapId) {
    if (!MAPS[mapId]) mapId = 'house';
    if (this.group) {
      this.scene.remove(this.group);
      this.group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    }
    this.group = new THREE.Group();
    this.colliders = [];
    this.meshes = [];
    this.spawns = [];
    this.hunterSpawn = [0, 0];
    this.bounds = [-20, -20, 20, 20];
    this.mapId = mapId;
    const def = MAPS[mapId];
    def.build(this);
    this.scene.background = new THREE.Color(def.sky);
    this.scene.fog = new THREE.Fog(def.sky, 45, 110);
    this.scene.add(this.group);
  }

  add(mesh, collide) {
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.group.add(mesh); this.meshes.push(mesh);
    if (collide) {
      mesh.updateMatrixWorld();
      const b = new THREE.Box3().setFromObject(mesh);
      this.colliders.push({ min: b.min.toArray(), max: b.max.toArray() });
    }
    return mesh;
  }

  // 以底面中心 (cx, y, cz) 放一个 w×h×d 的盒子
  box(cx, y, cz, w, h, d, m, o = {}) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const center = new THREE.Vector3(cx, y + h / 2, cz);
    const scale = o.uv ?? (Array.isArray(m) ? 0 : m.userData.uv);
    if (scale) worldUV(geo, center, scale);
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.copy(center);
    mesh.castShadow = o.cast ?? true; mesh.receiveShadow = true;
    this.group.add(mesh); this.meshes.push(mesh);
    if (o.collide ?? true) this.colliders.push({ min: [cx - w / 2, y, cz - d / 2], max: [cx + w / 2, y + h, cz + d / 2] });
    return mesh;
  }

  cyl(cx, y, cz, r, h, m, o = {}) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(o.r2 ?? r, r, h, o.seg ?? 16), m);
    mesh.position.set(cx, y + h / 2, cz);
    this.add(mesh, false);
    if (o.collide ?? true) this.colliders.push({ min: [cx - r * 0.8, y, cz - r * 0.8], max: [cx + r * 0.8, y + h, cz + r * 0.8] });
    return mesh;
  }

  ball(cx, cy, cz, r, m, o = {}) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 12), m);
    mesh.position.set(cx, cy, cz);
    if (o.sy) mesh.scale.y = o.sy;
    this.add(mesh, false);
    if (o.collide) this.colliders.push({ min: [cx - r * 0.7, cy - r * (o.sy || 1), cz - r * 0.7], max: [cx + r * 0.7, cy + r * (o.sy || 1) * 0.7, cz + r * 0.7] });
    return mesh;
  }

  // 墙：axis='x' 表示沿 x 方向延伸（位于 z=fixed）。neg/pos 为两侧墙纸
  wall(axis, fixed, a0, a1, neg, pos, gaps = [], H = 3.6, TH = 0.3) {
    const edge = neg;
    const mats = axis === 'x' ? [edge, edge, edge, edge, pos, neg] : [pos, neg, edge, edge, edge, edge];
    const piece = (s0, s1, y0, y1) => {
      if (s1 - s0 < 0.01) return;
      const mid = (s0 + s1) / 2, len = s1 - s0;
      if (axis === 'x') this.box(mid, y0, fixed, len, y1 - y0, TH, mats, { uv: 1.2 });
      else this.box(fixed, y0, mid, TH, y1 - y0, len, mats, { uv: 1.2 });
    };
    let cur = a0;
    for (const g of [...gaps].sort((a, b) => a.c - b.c)) {
      const w = g.w ?? 1.8, h = g.h ?? 2.4;
      piece(cur, g.c - w / 2, 0, H);
      piece(g.c - w / 2, g.c + w / 2, h, H);
      cur = g.c + w / 2;
    }
    piece(cur, a1, 0, H);
  }

  floor(x0, z0, x1, z1, m, top = 0) {
    this.box((x0 + x1) / 2, top - 0.1, (z0 + z1) / 2, x1 - x0, 0.1, z1 - z0, m, { collide: false, cast: false });
  }

  plant(x, z, s = 1, potColor = '#d35400') {
    this.cyl(x, 0, z, 0.3 * s, 0.5 * s, mat(T.plain(potColor)), { r2: 0.36 * s });
    this.ball(x, 0.5 * s + 0.45 * s, z, 0.5 * s, mat(T.leaves('#3f8f3a')));
    this.ball(x + 0.2 * s, 0.5 * s + 0.85 * s, z - 0.1 * s, 0.34 * s, mat(T.leaves('#4fa64a')));
  }

  chair(x, z, facing, wood) {
    // facing: 椅背朝向（'n','s','e','w'）
    this.box(x, 0.45, z, 0.5, 0.06, 0.5, wood);
    for (const [dx, dz] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) this.box(x + dx, 0, z + dz, 0.06, 0.45, 0.06, wood, { collide: false });
    const off = { n: [0, -0.22], s: [0, 0.22], e: [0.22, 0], w: [-0.22, 0] }[facing];
    const horiz = facing === 'n' || facing === 's';
    this.box(x + off[0], 0.51, z + off[1], horiz ? 0.5 : 0.06, 0.55, horiz ? 0.06 : 0.5, wood);
  }

  table(x, z, w, d, h, wood) {
    this.box(x, h - 0.08, z, w, 0.08, d, wood);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.box(x + sx * (w / 2 - 0.1), 0, z + sz * (d / 2 - 0.1), 0.1, h - 0.08, 0.1, wood);
  }

  tree(x, z, s = 1) {
    this.cyl(x, 0, z, 0.25 * s, 2.2 * s, mat(T.woodgrain('#7b5230')), { r2: 0.2 * s });
    this.ball(x, 2.6 * s, z, 1.2 * s, mat(T.leaves('#3c8d3f')));
    this.ball(x + 0.6 * s, 2.2 * s, z + 0.3 * s, 0.8 * s, mat(T.leaves('#4aa84b')));
    this.ball(x - 0.5 * s, 2.3 * s, z - 0.4 * s, 0.8 * s, mat(T.leaves('#347a35')));
  }
}

// ---------------- 地图 1：捉迷藏小屋 ----------------
function buildHouse(W) {
  const brick = mat(T.bricks('#b5543c', '#d8cfc4'));
  const wpLiving = mat(T.stripes('#bfe6d0', '#eaf6ee', 6));
  const wpKitchen = mat(T.tiles('#e8f1f8', '#9fb7c9', 4, 0.8));
  const wpBed = mat(T.dots('#f7c9d4', '#ffffff'));
  const wpPlay = mat(T.diamonds('#ffe28a', '#ffb347'));
  const flLiving = mat(T.planks('#b07a4a'));
  const flKitchen = mat(T.checker('#f2f2f2', '#333a45', 2, 1.6));
  const flBed = mat(T.fabric('#d8c3a5', 1.2));
  const flPlay = mat(T.multiTiles(['#74b9ff', '#55efc4', '#ff7675', '#ffeaa7', '#a29bfe']));
  const wood = mat(T.woodgrain('#a0673a'));
  const darkWood = mat(T.woodgrain('#5d3a1f'));
  const white = mat(T.plain('#f4f4f4', 6));

  W.bounds = [-18, -14, 18, 24];
  // 地面
  W.floor(-60, -60, 60, 60, mat(T.grass('#5fae4a', 3)), -0.03);
  W.floor(-18, -14, 4, 1, flLiving);
  W.floor(4, -14, 18, 1, flKitchen);
  W.floor(-18, 1, -3, 14, flBed);
  W.floor(-3, 1, 18, 14, flPlay);

  // 外墙（内侧墙纸，外侧砖墙）
  W.wall('x', -14, -18.15, 4, brick, wpLiving);
  W.wall('x', -14, 4, 18.15, brick, wpKitchen);
  W.wall('x', 14, -18.15, -3, wpBed, brick);
  W.wall('x', 14, -3, 18.15, wpPlay, brick, [{ c: 10, w: 2.2 }]);
  W.wall('z', -18, -14, 1, brick, wpLiving);
  W.wall('z', -18, 1, 14, brick, wpBed);
  W.wall('z', 18, -14, 1, wpKitchen, brick);
  W.wall('z', 18, 1, 14, wpPlay, brick);
  // 内墙
  W.wall('x', 1, -18, -3, wpLiving, wpBed, [{ c: -11 }]);
  W.wall('x', 1, -3, 4, wpLiving, wpPlay, [{ c: 0.5 }]);
  W.wall('x', 1, 4, 18, wpKitchen, wpPlay, [{ c: 9 }]);
  W.wall('z', 4, -14, 1, wpLiving, wpKitchen, [{ c: -6 }]);
  W.wall('z', -3, 1, 14, wpBed, wpPlay, [{ c: 8 }]);

  // ---- 客厅 ----
  W.box(-7, 0, -6.5, 7, 0.03, 4.5, mat(T.rug('#8e2c2c', '#e1b12c', '#f5e6c8')), { collide: false, cast: false });
  const sofa = mat(T.fabric('#3b6ea5'));
  W.box(-7, 0, -11.9, 5, 0.5, 1.5, sofa);
  W.box(-7, 0.5, -12.5, 5, 0.75, 0.35, sofa);
  W.box(-9.3, 0.5, -11.9, 0.4, 0.35, 1.5, sofa);
  W.box(-4.7, 0.5, -11.9, 0.4, 0.35, 1.5, sofa);
  W.box(-8, 0.5, -11.7, 0.7, 0.45, 0.25, mat(T.fabric('#f6b93b')), { collide: false });
  W.table(-7, -6.5, 2.4, 1.2, 0.45, darkWood);
  W.box(-7, 0, 0.35, 3.4, 0.6, 0.7, darkWood);
  W.box(-7, 0.6, 0.55, 2.4, 1.35, 0.12, [darkWood, darkWood, darkWood, darkWood, darkWood, mat(T.screen())]);
  W.box(-17.45, 0, -7, 0.8, 2.8, 3.4, [mat(T.books(3)), wood, wood, wood, wood, wood]);
  W.box(-17.45, 0, -2.5, 0.8, 1.6, 2.2, [mat(T.books(5)), wood, wood, wood, wood, wood]);
  const arm = mat(T.fabric('#c44569'));
  W.box(-14.5, 0, -1.5, 1.4, 0.5, 1.3, arm);
  W.box(-14.5, 0.5, -0.95, 1.4, 0.7, 0.3, arm);
  W.plant(-17.2, -13.2, 1.2);
  W.plant(3.2, -13.2, 1.1, '#2d98da');
  W.plant(-2, 0.2, 0.9, '#f7b731');
  W.cyl(-10.5, 0, -12.9, 0.22, 0.08, darkWood);
  W.cyl(-10.5, 0.08, -12.9, 0.04, 1.6, darkWood, { collide: false });
  W.cyl(-10.5, 1.6, -12.9, 0.3, 0.4, mat(T.plain('#ffeaa7')), { r2: 0.18, collide: false });
  W.box(-7, 1.5, -13.8, 2.4, 1.4, 0.05, mat(T.painting(1)), { collide: false });
  W.box(-14, 1.6, -13.8, 1.2, 0.9, 0.05, mat(T.painting(2)), { collide: false });
  W.box(-17.8, 1.7, -11, 0.05, 1.0, 1.4, mat(T.painting(3)), { collide: false });
  const card = mat(T.cardboard());
  W.box(1.8, 0, -9.5, 1, 1, 1, card);
  W.box(2.0, 1, -9.6, 0.8, 0.8, 0.8, card);
  W.box(2.9, 0, -8.2, 0.9, 0.7, 0.9, card);
  W.box(-1.5, 0, -12.5, 1.6, 0.9, 0.6, wood);

  // ---- 厨房 ----
  const cab = mat(T.woodgrain('#d9c5a0'));
  const counterTop = mat(T.plain('#7f8c8d', 10));
  W.box(10.5, 0, -13.25, 12, 0.95, 1.2, [cab, cab, counterTop, cab, cab, cab]);
  W.box(10.5, 2.1, -13.55, 12, 0.8, 0.6, cab);
  W.box(8, 0.95, -13.3, 1.2, 0.04, 0.9, mat(T.tiles('#222', '#444', 2, 0)), { collide: false });
  W.box(17.3, 0, -9, 1.1, 2.2, 1.2, [white, white, white, white, white, white]);
  W.box(17.3, 0, -10.6, 1.1, 0.95, 2, [cab, cab, counterTop, cab, cab, cab]);
  W.table(11, -5.5, 3.6, 1.8, 0.8, wood);
  W.chair(9.8, -6.9, 's', wood); W.chair(12.2, -6.9, 's', wood);
  W.chair(9.8, -4.1, 'n', wood); W.chair(12.2, -4.1, 'n', wood);
  const fruit = mat(T.dots('#e67e22', '#c0392b', 0.3));
  W.box(5.2, 0, -0.2, 1.2, 0.7, 0.8, wood);
  W.box(5.2, 0.7, -0.2, 1.1, 0.25, 0.7, fruit, { collide: false });
  W.cyl(16.8, 0, -1, 0.45, 1.0, mat(T.woodgrain('#8e5b2e')), { seg: 12 });
  W.cyl(15.8, 0, -0.6, 0.45, 1.0, mat(T.woodgrain('#8e5b2e')), { seg: 12 });
  W.box(11, 1.4, -13.9, 1.4, 1.0, 0.05, mat(T.painting(4)), { collide: false });
  W.box(4.7, 0, -12.5, 1.0, 1.9, 1.4, mat(T.plain('#dfe6e9', 5)));

  // ---- 卧室 ----
  const sheet = mat(T.checker('#74b9ff', '#dff1ff', 4, 1.2));
  W.box(-14, 0, 11, 3, 0.5, 4.4, darkWood);
  W.box(-14, 0.5, 11.1, 2.8, 0.25, 4.0, sheet);
  W.box(-14, 0.75, 12.4, 2.2, 0.2, 0.7, white, { collide: false });
  W.box(-14, 0, 13.4, 3.2, 1.5, 0.2, darkWood);
  W.box(-6, 0, 13.2, 2.6, 2.5, 1.1, mat(T.woodgrain('#c8a27a')));
  W.box(-17.2, 0, 5, 1.2, 0.8, 2.6, wood);
  W.chair(-16.2, 5, 'e', wood);
  W.box(-17.6, 0.8, 4.2, 0.4, 0.5, 0.3, mat(T.plain('#ffeaa7')), { collide: false });
  W.box(-10.5, 0, 3.5, 4, 0.03, 3, mat(T.rug('#6c5ce7', '#fd79a8', '#ffeaa7')), { collide: false, cast: false });
  W.box(-11.5, 0, 13.4, 1.4, 1.0, 0.8, wood);
  W.ball(-9.5, 0.45, 12.9, 0.45, mat(T.fabric('#e17055')));
  W.ball(-9.5, 1.0, 12.9, 0.3, mat(T.fabric('#e17055')));
  W.box(-14, 1.8, 13.8, 1.6, 1.0, 0.05, mat(T.painting(5)), { collide: false });
  W.plant(-4, 2, 1);

  // ---- 儿童游戏室 ----
  const r = T.mulberry32(42);
  const bcols = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22'];
  const letters = 'ABCDEFGHIJKLMNOP';
  for (let i = 0; i < 14; i++) {
    const x = 0 + r() * 8, z = 3 + r() * 5, s = 0.5 + r() * 0.5;
    W.box(x, 0, z, s, s, s, mat(T.letterBlock(letters[i], bcols[i % bcols.length])));
  }
  // 滑梯平台 + 台阶
  W.box(15, 0, 10.5, 4, 1.5, 3.5, mat(T.stripes('#ff7675', '#fab1a0', 8, 1)));
  W.box(12.1, 0, 10.5, 1.2, 0.5, 2, mat(T.plain('#fdcb6e')));
  W.box(12.7, 0, 10.5, 0.6, 1.0, 2, mat(T.plain('#fdcb6e')));
  W.box(15, 1.5, 12.2, 4, 0.8, 0.1, mat(T.plain('#0984e3')));
  // 球池
  const pit = mat(T.plain('#0984e3'));
  W.box(6, 0, 12.8, 4, 0.6, 0.2, pit); W.box(6, 0, 9.2, 4, 0.6, 0.2, pit);
  W.box(4.1, 0, 11, 0.2, 0.6, 3.4, pit); W.box(7.9, 0, 11, 0.2, 0.6, 3.4, pit);
  const bc = ['#ff7675', '#74b9ff', '#55efc4', '#ffeaa7', '#fd79a8'];
  for (let i = 0; i < 60; i++) W.ball(4.4 + r() * 3.2, 0.12 + r() * 0.35, 9.5 + r() * 3, 0.14, mat(bc[i % 5]));
  // 豆袋沙发
  W.ball(-1.5, 0.3, 12.5, 0.7, mat(T.fabric('#00b894')), { sy: 0.55, collide: true });
  W.ball(0.2, 0.3, 12.8, 0.7, mat(T.fabric('#e84393')), { sy: 0.55, collide: true });
  W.box(17.4, 0, 4, 0.8, 1.2, 3, [mat(T.books(9)), wood, wood, wood, wood, wood]);
  W.box(10, 1.7, 1.2, 2, 1.2, 0.05, mat(T.painting(6)), { collide: false });
  // 游戏机
  W.box(-2.2, 0, 4, 0.9, 1.9, 0.8, [mat('#6c5ce7'), mat('#6c5ce7'), mat('#6c5ce7'), mat('#6c5ce7'), mat('#6c5ce7'), mat(T.screen())]);

  // ---- 花园 ----
  const fence = mat(T.stripes('#ffffff', '#e6e6e6', 8, 0.8));
  W.box(0, 0, 24, 36.3, 1.3, 0.15, fence);
  W.box(-18.1, 0, 19, 0.15, 1.3, 10, fence);
  W.box(18.1, 0, 19, 0.15, 1.3, 10, fence);
  W.box(-8, 0, 17.5, 8, 0.2, 2, mat(T.flowers()), { cast: false });
  W.box(8, 0, 21.5, 6, 0.2, 2, mat(T.flowers()), { cast: false });
  W.box(0, 0, 19.5, 4, 0.03, 3, mat(T.water()), { collide: false, cast: false });
  W.tree(-14, 20); W.tree(14.5, 17, 1.1); W.tree(-3, 22.5, 0.9);
  W.ball(-17, 0.5, 15.2, 0.8, mat(T.leaves('#2f7d32')));
  W.ball(-11, 0.5, 22.8, 0.9, mat(T.leaves('#3d8b40')));
  W.ball(4, 0.5, 23, 0.8, mat(T.leaves('#2f7d32')));
  W.ball(16.8, 0.5, 22.8, 0.9, mat(T.leaves('#3d8b40')));
  W.box(13, 0, 21.5, 2.4, 2.2, 2.2, mat(T.planks('#8e6e53', 1.2)));
  W.box(13, 2.2, 21.5, 2.8, 0.2, 2.6, mat(T.plain('#6d4c41')));

  W.spawns = [[-7, -9], [-12, -4], [-1, -4], [10, -9], [14, -2], [-12, 7], [-7, 6], [2, 6], [9, 5], [14, 6], [0, 18], [-8, 21], [8, 18], [-15, -10], [6, -3]];
  W.hunterSpawn = [11, -9];
}

// ---------------- 地图 2：积木乐园 ----------------
function buildBlocks(W) {
  W.bounds = [-22, -22, 22, 22];
  const quad = [
    mat(T.checker('#ff9ff3', '#feca57', 2, 2)),
    mat(T.stripes('#48dbfb', '#c8f7ff', 6, 2)),
    mat(T.swirl('#1dd1a1', '#b8f2e0', 2)),
    mat(T.dots('#f368e0', '#ffd6f5', 1.2)),
  ];
  W.floor(-60, -60, 60, 60, mat(T.grass('#7bd389', 3)), -0.03);
  W.floor(-22, -22, 0, 0, quad[0]);
  W.floor(0, -22, 22, 0, quad[1]);
  W.floor(-22, 0, 0, 22, quad[2]);
  W.floor(0, 0, 22, 22, quad[3]);
  const rainbow = mat(T.hstripes(['#ff6b6b', '#feca57', '#1dd1a1', '#54a0ff', '#5f27cd'], 3.6));
  W.box(0, 0, -22.15, 44.6, 3.6, 0.3, rainbow);
  W.box(0, 0, 22.15, 44.6, 3.6, 0.3, rainbow);
  W.box(-22.15, 0, 0, 0.3, 3.6, 44, rainbow);
  W.box(22.15, 0, 0, 0.3, 3.6, 44, rainbow);

  const pats = [
    () => T.checker('#ff9ff3', '#feca57', 2, 1),
    () => T.stripes('#48dbfb', '#c8f7ff', 6, 1),
    () => T.swirl('#1dd1a1', '#b8f2e0', 1),
    () => T.dots('#f368e0', '#ffd6f5', 0.6),
    () => T.diamonds('#ff9f43', '#ffeaa7', 1),
    () => T.tiles('#54a0ff', '#2e86de', 3, 1),
    () => T.bricks('#ee5253', '#ffd8d8', 1.2),
    () => T.plain('#ffffff', 4, 1),
    () => T.plain('#222f3e', 6, 1),
  ];
  const r = T.mulberry32(2024);
  const spots = [];
  for (let i = 0; i < 46; i++) {
    const x = -19 + r() * 38, z = -19 + r() * 38;
    if (Math.hypot(x, z) < 3) continue;
    const w = 1 + r() * 3, d = 1 + r() * 3, h = 0.6 + r() * 2.6;
    const m = mat(pats[Math.floor(r() * pats.length)]());
    W.box(x, 0, z, w, h, d, m);
    if (r() < 0.35) W.box(x + (r() - 0.5) * w * 0.5, h, z + (r() - 0.5) * d * 0.5, w * 0.6, 0.5 + r(), d * 0.6, mat(pats[Math.floor(r() * pats.length)]()));
    spots.push([x, z]);
  }
  // 拱门
  for (const [x, z, rot] of [[0, -10, 0], [-10, 0, 1], [10, 6, 1], [4, 14, 0]]) {
    const m = mat(T.hstripes(['#ff6b6b', '#feca57', '#1dd1a1', '#54a0ff'], 1));
    if (rot) { W.box(x, 0, z - 1.5, 1, 2.6, 0.8, m); W.box(x, 0, z + 1.5, 1, 2.6, 0.8, m); W.box(x, 2.6, z, 1, 0.8, 3.8, m); }
    else { W.box(x - 1.5, 0, z, 0.8, 2.6, 1, m); W.box(x + 1.5, 0, z, 0.8, 2.6, 1, m); W.box(x, 2.6, z, 3.8, 0.8, 1, m); }
  }
  for (let i = 0; i < 12; i++) {
    const x = -19 + r() * 38, z = -19 + r() * 38;
    W.cyl(x, 0, z, 0.5 + r() * 0.5, 1 + r() * 3, mat(pats[Math.floor(r() * pats.length)]()));
  }
  for (let i = 0; i < 10; i++) W.ball(-19 + r() * 38, 0.7, -19 + r() * 38, 0.7 + r() * 0.4, mat(pats[Math.floor(r() * pats.length)]()));

  // 出生点：找不在方块里的位置
  const free = (x, z) => !W.colliders.some(b => x > b.min[0] - 0.5 && x < b.max[0] + 0.5 && z > b.min[2] - 0.5 && z < b.max[2] + 0.5);
  const r2 = T.mulberry32(7);
  while (W.spawns.length < 16) {
    const x = -19 + r2() * 38, z = -19 + r2() * 38;
    if (free(x, z)) W.spawns.push([x, z]);
  }
  W.hunterSpawn = [0, 0];
}

export const MAPS = {
  house: { name: '捉迷藏小屋', sky: '#a8dcff', build: buildHouse },
  blocks: { name: '积木乐园', sky: '#ffd9ec', build: buildBlocks },
};
