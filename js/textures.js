// 程序化生成的贴图（全部用 canvas 画出来，所以吸管工具可以精确取色）
import * as THREE from 'three';

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cache = new Map();

// 创建 canvas 贴图；uv = 每多少米重复一次（0 表示拉伸铺满）
function mk(key, w, h, uv, draw) {
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (uv) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.userData = { canvas: c, ctx: g, uv };
  cache.set(key, t);
  return t;
}

function noise(g, w, h, amt, seed = 1) {
  const r = mulberry32(seed);
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * amt;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
}

function shade(hex, f) {
  const c = new THREE.Color(hex);
  const hsl = {}; c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + f)));
  return '#' + c.getHexString();
}

export const stripes = (a, b, n = 6, uv = 1.2) => mk(`stripes${a}${b}${n}`, 128, 128, uv, (g, w, h) => {
  const sw = w / n;
  for (let i = 0; i < n; i++) { g.fillStyle = i % 2 ? b : a; g.fillRect(i * sw, 0, sw, h); }
  noise(g, w, h, 6);
});

export const hstripes = (colors, uv = 2) => mk(`hstripes${colors.join()}`, 64, 128, uv, (g, w, h) => {
  const sh = h / colors.length;
  colors.forEach((c, i) => { g.fillStyle = c; g.fillRect(0, i * sh, w, sh + 1); });
});

export const checker = (a, b, n = 2, uv = 1.6) => mk(`checker${a}${b}${n}`, 128, 128, uv, (g, w, h) => {
  const s = w / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    g.fillStyle = (x + y) % 2 ? b : a; g.fillRect(x * s, y * s, s, s);
  }
  noise(g, w, h, 8, 3);
});

export const planks = (base, uv = 2.4) => mk(`planks${base}`, 256, 256, uv, (g, w, h) => {
  const r = mulberry32(7);
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  const rows = 5, rh = h / rows;
  for (let i = 0; i < rows; i++) {
    const off = r() * w;
    for (let k = -2; k < 2; k++) {
      g.fillStyle = shade(base, (r() - 0.5) * 0.08);
      g.fillRect(off + k * w * 0.62, i * rh, w * 0.62, rh);
      g.fillStyle = shade(base, -0.18);
      g.fillRect(off + k * w * 0.62, i * rh, 2, rh);
    }
    g.strokeStyle = shade(base, -0.06); g.lineWidth = 1;
    for (let l = 0; l < 5; l++) {
      g.beginPath();
      const y0 = i * rh + r() * rh;
      g.moveTo(0, y0);
      for (let x = 0; x <= w; x += 16) g.lineTo(x, y0 + Math.sin(x * 0.05 + l) * 2);
      g.stroke();
    }
    g.fillStyle = shade(base, -0.22); g.fillRect(0, i * rh, w, 2);
  }
  noise(g, w, h, 10, 7);
});

export const woodgrain = (base, uv = 1) => mk(`wood${base}`, 128, 128, uv, (g, w, h) => {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  const r = mulberry32(11);
  g.strokeStyle = shade(base, -0.07);
  for (let l = 0; l < 14; l++) {
    g.beginPath(); const y0 = r() * h;
    g.moveTo(0, y0);
    for (let x = 0; x <= w; x += 8) g.lineTo(x, y0 + Math.sin(x * 0.07 + l) * 3);
    g.stroke();
  }
  noise(g, w, h, 8, 11);
});

export const tiles = (a, grout, n = 4, uv = 1.2) => mk(`tiles${a}${grout}${n}`, 128, 128, uv, (g, w, h) => {
  g.fillStyle = grout; g.fillRect(0, 0, w, h);
  const s = w / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    g.fillStyle = a; g.fillRect(x * s + 1.5, y * s + 1.5, s - 3, s - 3);
  }
  noise(g, w, h, 5, 5);
});

export const multiTiles = (colors, n = 4, uv = 2.4) => mk(`mtiles${colors.join()}`, 128, 128, uv, (g, w, h) => {
  const r = mulberry32(21);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
  const s = w / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    g.fillStyle = colors[Math.floor(r() * colors.length)];
    g.fillRect(x * s + 1, y * s + 1, s - 2, s - 2);
  }
});

export const dots = (bg, fg, uv = 0.8) => mk(`dots${bg}${fg}`, 128, 128, uv, (g, w, h) => {
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = fg;
  const pts = [[32, 32], [96, 96], [96, 32], [32, 96], [64, 64], [0, 64], [64, 0], [128, 64], [64, 128], [0, 0], [128, 0], [0, 128], [128, 128]];
  const big = [[32, 32], [96, 96]];
  for (const [x, y] of pts) {
    const isBig = big.some(p => p[0] === x && p[1] === y);
    if (x % 64 === 32 && !isBig) continue;
    g.beginPath(); g.arc(x, y, isBig ? 13 : 7, 0, Math.PI * 2); g.fill();
  }
  noise(g, w, h, 6);
});

export const diamonds = (a, b, uv = 1) => mk(`diam${a}${b}`, 128, 128, uv, (g, w, h) => {
  g.fillStyle = a; g.fillRect(0, 0, w, h);
  g.fillStyle = b;
  const d = (cx, cy, s) => { g.beginPath(); g.moveTo(cx, cy - s); g.lineTo(cx + s, cy); g.lineTo(cx, cy + s); g.lineTo(cx - s, cy); g.fill(); };
  d(64, 64, 30); d(0, 0, 30); d(128, 0, 30); d(0, 128, 30); d(128, 128, 30);
  g.fillStyle = shade(a, -0.1);
  d(64, 0, 8); d(0, 64, 8); d(128, 64, 8); d(64, 128, 8);
  noise(g, w, h, 6);
});

export const bricks = (brick, mortar, uv = 1.6) => mk(`brick${brick}${mortar}`, 128, 128, uv, (g, w, h) => {
  const r = mulberry32(9);
  g.fillStyle = mortar; g.fillRect(0, 0, w, h);
  const rows = 8, rh = h / rows, bw = w / 4;
  for (let y = 0; y < rows; y++) {
    const off = y % 2 ? bw / 2 : 0;
    for (let x = -1; x < 5; x++) {
      g.fillStyle = shade(brick, (r() - 0.5) * 0.1);
      g.fillRect(x * bw + off + 1.5, y * rh + 1.5, bw - 3, rh - 3);
    }
  }
  noise(g, w, h, 12, 9);
});

export const grass = (base = '#5fae4a', uv = 2) => mk(`grass${base}`, 128, 128, uv, (g, w, h) => {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  const r = mulberry32(4);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = shade(base, (r() - 0.5) * 0.2);
    g.fillRect(r() * w, r() * h, 1.5, 4);
  }
});

export const plain = (base, amt = 8, uv = 2) => mk(`plain${base}${amt}`, 64, 64, uv, (g, w, h) => {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  noise(g, w, h, amt, 2);
});

export const fabric = (base, uv = 0.5) => mk(`fabric${base}`, 64, 64, uv, (g, w, h) => {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 4) { g.fillStyle = shade(base, -0.04); g.fillRect(0, y, w, 2); }
  for (let x = 0; x < w; x += 4) { g.fillStyle = shade(base, 0.03); g.fillRect(x, 0, 1, h); }
  noise(g, w, h, 10, 6);
});

export const books = (seed = 1) => mk(`books${seed}`, 256, 256, 0, (g, w, h) => {
  const r = mulberry32(seed);
  const cols = ['#c0392b', '#2e86de', '#27ae60', '#f39c12', '#8e44ad', '#16a085', '#e67e22', '#34495e', '#d35400', '#f1c40f', '#ecf0f1'];
  g.fillStyle = '#7a4b2a'; g.fillRect(0, 0, w, h);
  const shelves = 4, sh = h / shelves;
  for (let s = 0; s < shelves; s++) {
    g.fillStyle = '#4a2c17'; g.fillRect(0, s * sh + 8, w, sh - 14);
    let x = 8;
    while (x < w - 12) {
      const bw = 7 + r() * 10, bh = sh * (0.55 + r() * 0.3);
      if (r() < 0.12) { x += bw; continue; }
      g.fillStyle = cols[Math.floor(r() * cols.length)];
      g.fillRect(x, s * sh + sh - 6 - bh, bw - 1, bh);
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(x + 1, s * sh + sh - 6 - bh * 0.8, bw - 3, 2);
      x += bw;
    }
    g.fillStyle = '#8d5a33'; g.fillRect(0, s * sh + sh - 6, w, 6);
  }
  g.fillStyle = '#8d5a33'; g.fillRect(0, 0, 8, h); g.fillRect(w - 8, 0, 8, h);
});

export const painting = (seed = 1) => mk(`paint${seed}`, 128, 96, 0, (g, w, h) => {
  const r = mulberry32(seed * 31 + 5);
  const pal = [['#f7d794', '#f19066', '#546de5', '#e15f41', '#3dc1d3'], ['#fdcb6e', '#00b894', '#0984e3', '#6c5ce7', '#fab1a0'], ['#ffeaa7', '#55efc4', '#ff7675', '#74b9ff', '#a29bfe']][seed % 3];
  g.fillStyle = pal[0]; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 9; i++) {
    g.fillStyle = pal[1 + Math.floor(r() * 4)];
    if (r() < 0.5) { g.beginPath(); g.arc(r() * w, r() * h, 8 + r() * 22, 0, Math.PI * 2); g.fill(); }
    else g.fillRect(r() * w, r() * h, 10 + r() * 40, 10 + r() * 30);
  }
  g.lineWidth = 8; g.strokeStyle = '#6b4226'; g.strokeRect(0, 0, w, h);
  g.lineWidth = 2; g.strokeStyle = '#d4a054'; g.strokeRect(5, 5, w - 10, h - 10);
});

export const rug = (a, b, c) => mk(`rug${a}${b}${c}`, 256, 160, 0, (g, w, h) => {
  g.fillStyle = a; g.fillRect(0, 0, w, h);
  g.fillStyle = b; g.fillRect(12, 12, w - 24, h - 24);
  g.fillStyle = a; g.fillRect(22, 22, w - 44, h - 44);
  g.fillStyle = c;
  for (let x = 40; x < w - 30; x += 28) for (let y = 40; y < h - 30; y += 28) {
    g.beginPath(); g.moveTo(x, y - 8); g.lineTo(x + 8, y); g.lineTo(x, y + 8); g.lineTo(x - 8, y); g.fill();
  }
  noise(g, w, h, 12, 8);
});

export const screen = () => mk('screen', 128, 80, 0, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, w, h);
  gr.addColorStop(0, '#1e3799'); gr.addColorStop(1, '#0c2461');
  g.fillStyle = '#111'; g.fillRect(0, 0, w, h);
  g.fillStyle = gr; g.fillRect(4, 4, w - 8, h - 8);
  g.fillStyle = '#f6b93b'; g.beginPath(); g.arc(90, 30, 12, 0, 7); g.fill();
  g.fillStyle = '#78e08f'; g.beginPath(); g.moveTo(4, h - 4); g.lineTo(40, 36); g.lineTo(70, h - 4); g.fill();
});

export const letterBlock = (letter, color) => mk(`lb${letter}${color}`, 64, 64, 0, (g, w, h) => {
  g.fillStyle = color; g.fillRect(0, 0, w, h);
  g.strokeStyle = shade(color, -0.2); g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
  g.fillStyle = '#ffffff'; g.font = 'bold 40px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(letter, w / 2, h / 2 + 2);
});

export const flowers = (uv = 3) => mk('flowers', 128, 128, uv, (g, w, h) => {
  g.fillStyle = '#4e9a3a'; g.fillRect(0, 0, w, h);
  const r = mulberry32(12);
  const cols = ['#ff6b81', '#ffd32a', '#ffffff', '#a55eea', '#ff9f43'];
  for (let i = 0; i < 70; i++) {
    const x = r() * w, y = r() * h, c = cols[Math.floor(r() * cols.length)];
    g.fillStyle = c;
    for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2; g.beginPath(); g.arc(x + Math.cos(a) * 3, y + Math.sin(a) * 3, 2.4, 0, 7); g.fill(); }
    g.fillStyle = '#ffeaa7'; g.beginPath(); g.arc(x, y, 1.8, 0, 7); g.fill();
  }
});

export const leaves = (base = '#3f8f3a', uv = 1) => mk(`leaves${base}`, 64, 64, uv, (g, w, h) => {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  const r = mulberry32(13);
  for (let i = 0; i < 120; i++) {
    g.fillStyle = shade(base, (r() - 0.5) * 0.25);
    g.beginPath(); g.ellipse(r() * w, r() * h, 4, 2, r() * 3, 0, 7); g.fill();
  }
});

export const water = () => mk('water', 128, 128, 3, (g, w, h) => {
  g.fillStyle = '#4aa3df'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#8fd0f7'; g.lineWidth = 2;
  for (let y = 10; y < h; y += 22) {
    g.beginPath();
    for (let x = 0; x <= w; x += 4) g.lineTo(x, y + Math.sin(x / w * Math.PI * 4) * 3);
    g.stroke();
  }
});

export const swirl = (a, b, uv = 1.5) => mk(`swirl${a}${b}`, 128, 128, uv, (g, w, h) => {
  g.fillStyle = a; g.fillRect(0, 0, w, h);
  g.fillStyle = b;
  for (let i = -2; i < 8; i++) {
    g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32 + 16, 0); g.lineTo(i * 32 + 16 + 64, h); g.lineTo(i * 32 + 64, h); g.fill();
  }
});

export const cardboard = () => mk('cardboard', 64, 64, 0, (g, w, h) => {
  g.fillStyle = '#c89f6a'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#b4884f'; g.fillRect(0, h / 2 - 4, w, 8);
  noise(g, w, h, 14, 14);
});

// 从射线命中点读出表面的真实颜色（反照率），返回 '#rrggbb'
export function sampleHit(hit) {
  let m = hit.object.material;
  if (Array.isArray(m)) m = m[hit.face ? hit.face.materialIndex : 0];
  if (!m) return null;
  let rgb = [255, 255, 255];
  const map = m.map;
  if (map && map.userData && map.userData.canvas && hit.uv) {
    const c = map.userData.canvas;
    let u = hit.uv.x, v = hit.uv.y;
    u -= Math.floor(u); v -= Math.floor(v);
    const x = Math.min(c.width - 1, Math.floor(u * c.width));
    const y = Math.min(c.height - 1, Math.floor((map.flipY ? 1 - v : v) * c.height));
    const d = map.userData.ctx.getImageData(x, y, 1, 1).data;
    rgb = [d[0], d[1], d[2]];
  }
  const hex = m.color.getHex();
  const r = Math.round(rgb[0] * ((hex >> 16) & 255) / 255);
  const g = Math.round(rgb[1] * ((hex >> 8) & 255) / 255);
  const b = Math.round(rgb[2] * (hex & 255) / 255);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}
