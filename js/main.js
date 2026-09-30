// 变色龙躲猫猫 —— 客户端主逻辑
import * as THREE from 'three';
import { World, MAPS } from './world.js';
import { Character, POSES, BASE_COLOR, getScale, setScale } from './character.js';
import { Controller } from './player.js';
import { Server } from './server.js';
import { hostRoom, joinRoom, offlineRoom, genRoomCode, netMode } from './net.js';
import { initAudio, sfx } from './audio.js';
import { sampleHit } from './textures.js';

const $ = id => document.getElementById(id);
const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
};

// 手机 / 平板：没有鼠标锁定，改用虚拟摇杆和按钮（网址加 ?touch=1 可在电脑上测试）
const IS_TOUCH = new URLSearchParams(location.search).get('touch') === '1' ||
  (matchMedia('(hover: none) and (pointer: coarse)').matches);
document.body.classList.toggle('touch', IS_TOUCH);

// ================= 渲染基础 =================
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, IS_TOUCH ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('game').appendChild(renderer.domElement);
const canvas = renderer.domElement;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 300);
camera.rotation.order = 'YXZ';
scene.add(camera);

const hemi = new THREE.HemisphereLight(0xffffff, 0xb0a89a, 1.9);
const sun = new THREE.DirectionalLight(0xfff6e8, 2.0);
sun.position.set(-18, 32, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(IS_TOUCH ? 1024 : 2048, IS_TOUCH ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -34, right: 34, top: 34, bottom: -34, near: 1, far: 90 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
sun.target.position.set(0, 0, 4);
scene.add(hemi, sun, sun.target);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const world = new World(scene);
world.build('house');
const ctrl = new Controller();
const ray = new THREE.Raycaster();

// ================= 状态 =================
const S = {
  inGame: false, myId: null, isHost: false, offline: false, code: '',
  send: () => {}, net: null, server: null,
  players: new Map(),
  game: { phase: 'lobby', endsAt: 0, map: 'house', settings: { map: 'house', hide: 45, seek: 180, hunters: 1 }, round: 0, result: null },
  mode: 'play',
  lobbyHunter: false,
  thirdPerson: true,
  pose: 0,
  tool: 'brush', color: store.get('cp_color', '#7fbf7f'), size: 4,
  recent: [],
  mirror: false,
  undo: [],
  poseMenu: false,
  orbit: { yaw: 0, pitch: 0.25, dist: 1.8 },
  cooldownUntil: 0, tauntUntil: 0,
  chatOpen: false,
  paused: true,
  joy: [0, 0], touchJump: false, touchCrouch: false,
  pendingOps: [],
  clones: new Map(),
  lastSnap: 0,
  lastTick: -1,
};
try { S.recent = JSON.parse(store.get('cp_recent', '[]')).slice(0, 16); } catch (e) { S.recent = []; }

const me = () => S.players.get(S.myId);
const myChar = () => { const p = me(); return p && p.char; };
const locked = () => document.pointerLockElement === canvas;
// “正在操控角色”：电脑上是鼠标已锁定，手机上是没有打开房间菜单
const active = () => IS_TOUCH ? !S.paused : locked();

function effRole() {
  const p = me();
  if (!p) return 'chameleon';
  if (S.game.phase === 'lobby') return S.lobbyHunter ? 'hunter' : 'chameleon';
  if (p.role === 'spectator' || (p.role === 'chameleon' && !p.alive)) return 'ghost';
  return p.role;
}

function isVisibleTo(p) {
  if (S.game.phase === 'lobby') return true;
  if (p.role === 'spectator') return false;
  if (p.role === 'chameleon' && !p.alive) return false;
  return true;
}

// ================= UI 小工具 =================
let toastTimer = 0;
function toast(text, ms = 2600) {
  const t = $('toast');
  t.textContent = text; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

let bannerTimer = 0;
function banner(title, sub = '', ms = 2800) {
  const b = $('banner');
  b.textContent = title;
  if (sub) { const s = document.createElement('small'); s.textContent = sub; b.appendChild(s); }
  b.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => b.classList.remove('show'), ms);
}

function feed(text) {
  const d = document.createElement('div');
  d.textContent = text;
  $('feed').appendChild(d);
  while ($('feed').children.length > 6) $('feed').firstChild.remove();
  setTimeout(() => d.remove(), 7000);
}

function chatLine(name, text, sys = false) {
  const d = document.createElement('div');
  if (sys) { d.textContent = text; d.style.color = '#ffeaa7'; }
  else {
    const b = document.createElement('b'); b.textContent = name + '：';
    d.appendChild(b); d.appendChild(document.createTextNode(text));
  }
  const log = $('chatLog');
  log.appendChild(d);
  while (log.children.length > 30) log.firstChild.remove();
  setTimeout(() => d.classList.add('old'), 9000);
}

const fmt = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// ================= 主菜单 =================
$('nameInput').value = store.get('cp_name', '') || ('变色龙' + Math.floor(Math.random() * 900 + 100));
const hashRoom = (location.hash.match(/room=([A-Za-z0-9]+)/) || [])[1];
if (hashRoom) { $('roomInput').value = hashRoom.toUpperCase(); $('menuMsg').className = 'msg ok'; $('menuMsg').textContent = `收到邀请：房间 ${hashRoom.toUpperCase()}，点击“加入房间”即可`; }
if (netMode === 'local') $('menuMsg').textContent = '（本地测试模式：多个标签页之间联机）';

function myName() {
  const n = $('nameInput').value.trim().slice(0, 12) || '玩家';
  store.set('cp_name', n);
  return n;
}
function menuBusy(b, text = '') {
  for (const id of ['btnCreate', 'btnJoin', 'btnPractice']) $(id).disabled = b;
  $('menuMsg').className = 'msg ok';
  $('menuMsg').textContent = text;
}
function menuError(text) { menuBusy(false); $('menuMsg').className = 'msg'; $('menuMsg').textContent = text; }

async function startHost(offline) {
  initAudio();
  menuBusy(true, offline ? '正在进入练习场…' : '正在创建房间…');
  try {
    let t = null, code = 'SOLO';
    if (offline) t = await offlineRoom();
    else {
      for (let i = 0; i < 4 && !t; i++) {
        code = genRoomCode();
        try { t = await hostRoom(code); } catch (e) { if (e.type !== 'unavailable-id') throw e; }
      }
      if (!t) throw new Error('无法创建房间，请重试');
    }
    S.isHost = true; S.offline = offline; S.code = code;
    S.server = new Server(t, onMsg);
    S.server.paintProvider = pid => { const p = S.players.get(pid); return p && p.char ? p.char.snapshot() : null; };
    S.send = m => S.server.handle('L', m);
    S.send({ t: 'hello', name: myName() });
  } catch (e) {
    menuError('创建失败：' + (e.message || e));
  }
}

async function startJoin() {
  const code = $('roomInput').value.trim().toUpperCase();
  if (code.length < 4) { menuError('请输入房间码'); return; }
  initAudio();
  menuBusy(true, '正在连接房间 ' + code + '…');
  try {
    const t = await joinRoom(code);
    S.net = t; S.code = code;
    t.onData = onMsg;
    t.onClose = () => fatal('与房主的连接已断开', '房主可能离开了房间或网络中断。');
    S.send = m => t.send(m);
    S.send({ t: 'hello', name: myName() });
    setTimeout(() => { if (!S.inGame) { t.close(); menuError('房间没有响应，请确认房间码或让房主保持页面打开'); } }, 10000);
  } catch (e) {
    menuError(e.message || String(e));
  }
}

$('btnCreate').onclick = () => startHost(false);
$('btnPractice').onclick = () => startHost(true);
$('btnJoin').onclick = startJoin;
$('roomInput').addEventListener('keydown', e => { if (e.key === 'Enter') startJoin(); });

function fatal(title, msg) {
  if ($('fatal').hidden === false) return;
  document.exitPointerLock && document.exitPointerLock();
  $('fatalTitle').textContent = title;
  $('fatalMsg').textContent = msg;
  $('fatal').hidden = false;
  S.inGame = false;
}

// ================= 玩家管理 =================
function addPlayer(info) {
  if (S.players.has(info.id)) return S.players.get(info.id);
  const char = new Character(info.id, info.name);
  scene.add(char.root);
  const p = { ...info, char, tgt: null, snapped: false };
  S.players.set(info.id, p);
  if (info.st) applyState(p, info.st, true);
  return p;
}

function removePlayer(id) {
  const p = S.players.get(id);
  if (!p) return;
  scene.remove(p.char.root);
  p.char.dispose();
  S.players.delete(id);
}

function applyState(p, st, snap) {
  p.tgt = st;
  if (snap || !p.snapped) {
    p.char.root.position.set(st[0], st[1], st[2]);
    p.char.root.rotation.y = st[3];
    p.snapped = true;
  }
}

function randomSpawn() {
  const sp = world.spawns[Math.floor(Math.random() * world.spawns.length)] || [0, 0];
  ctrl.teleport(sp[0] + (Math.random() - 0.5) * 1.2, 0.5, sp[1] + (Math.random() - 0.5) * 1.2, Math.random() * Math.PI * 2);
}

// ================= 网络消息 =================
function onMsg(m) {
  if (!m || typeof m !== 'object') return;
  switch (m.t) {
    case 'welcome': {
      S.myId = m.id;
      for (const info of m.players) addPlayer(info);
      applyGame(m.game, true);
      enterGame();
      break;
    }
    case 'join': {
      addPlayer(m.p);
      feed(`👋 ${m.p.name} 加入了房间`);
      sfx('join');
      refreshPanel();
      break;
    }
    case 'leave': {
      removeClone(m.id);
      removePlayer(m.id);
      feed(`🚪 ${m.name} 离开了`);
      refreshPanel();
      break;
    }
    case 'snap': {
      S.lastSnap = performance.now();
      for (const [id, st] of Object.entries(m.s)) {
        if (id === S.myId) continue;
        const p = S.players.get(id);
        if (p) applyState(p, st, false);
      }
      break;
    }
    case 'psnap': {
      const p = S.players.get(m.id);
      if (p && Array.isArray(m.urls)) p.char.loadSnapshot(m.urls);
      break;
    }
    case 'scores': {
      for (const [id, sc] of Object.entries(m.s || {})) { const p = S.players.get(id); if (p) p.score = sc; }
      break;
    }
    case 'clone': spawnClone(m); break;
    case 'paint': {
      const p = S.players.get(m.id);
      if (p && Array.isArray(m.ops)) for (const op of m.ops) p.char.applyOp(op);
      break;
    }
    case 'game': applyGame(m, false); break;
    case 'found': onFound(m); break;
    case 'shot': {
      if (m.id === S.myId || !Array.isArray(m.a) || !Array.isArray(m.b)) break;
      const a = new THREE.Vector3(...m.a), b = new THREE.Vector3(...m.b);
      tracer(a, b);
      sfx('shoot', distVol(a, 40));
      break;
    }
    case 'taunt': {
      const p = S.players.get(m.id);
      if (p) p.score = m.score;
      const pos = Array.isArray(m.pos) ? new THREE.Vector3(...m.pos) : (p ? p.char.root.position.clone() : null);
      if (pos) { sfx('taunt', m.id === S.myId ? 1 : distVol(pos, 35)); note(pos); }
      break;
    }
    case 'chat': chatLine(m.name, m.text); break;
    case 'toast': toast(m.text, 3500); break;
    case 'full': menuError('房间已满（最多 24 人）'); break;
    case 'closed': fatal('房间已关闭', '房主离开了房间。'); break;
  }
}

function applyGame(g, initial) {
  const prev = S.game.phase;
  const G = S.game;
  G.phase = g.phase;
  G.endsAt = performance.now() + (g.remain || 0);
  G.map = g.map; G.settings = g.settings; G.round = g.round; G.result = g.result;
  if (g.settings) applyCharScale(g.settings.size);
  for (const gp of g.players || []) {
    const p = S.players.get(gp.id);
    if (p) { p.role = gp.role; p.alive = gp.alive; p.score = gp.score; }
  }
  let respawned = false;
  if (world.mapId !== g.map) { world.build(g.map); randomSpawn(); respawned = true; }
  if (initial && !respawned) randomSpawn();

  if (g.reset) {
    clearClones();
    S.cloneUsed = false;
    S.undo = [];
    for (const p of S.players.values()) p.char.resetSkin(p.role === 'hunter' && g.phase !== 'lobby');
    S.pose = 0;
  }
  if (g.spawns && g.spawns[S.myId]) {
    S.lobbyHunter = false;
    if (g.spawns[S.myId] === 'hunter') {
      const [hx, hz] = world.hunterSpawn;
      ctrl.teleport(hx + (Math.random() - 0.5) * 2, 0.5, hz + (Math.random() - 0.5) * 2, 0);
    } else randomSpawn();
  }

  const role = effRole();
  if (S.mode === 'paint' && role !== 'chameleon') setMode('play');

  if (!initial && prev !== g.phase) {
    if (g.phase === 'hide') {
      sfx('start');
      if (role === 'hunter') banner('你是猎人 🔫', '等待变色龙躲好……');
      else banner('你是变色龙 🦎', `按 F 涂装伪装，${g.settings.hide} 秒内躲好！`, 4000);
      chatLine('', `—— 第 ${g.round} 回合开始！地图：${MAPS[g.map].name} ——`, true);
    } else if (g.phase === 'seek') {
      sfx('start');
      banner(role === 'hunter' ? '出发！找出所有变色龙！' : '猎人出动了！', role === 'hunter' ? '左键射击可疑物体，打空会冷却' : '千万别动……');
    } else if (g.phase === 'end') {
      showResults();
    } else if (g.phase === 'lobby') {
      $('results').hidden = true;
      banner('回到大厅', '房主可以开始下一回合');
    }
  }
  if (g.phase !== 'end') $('results').hidden = true;
  refreshPanel();
}

function onFound(m) {
  const t = S.players.get(m.id), h = S.players.get(m.by);
  for (const [id, sc] of Object.entries(m.scores || {})) { const p = S.players.get(id); if (p) p.score = sc; }
  if (t) {
    t.alive = false;
    poof(t.char.root.position.clone().add(new THREE.Vector3(0, getScale(), 0)));
    const cl = S.clones.get(t.id);
    if (cl) poof(cl.root.position.clone().add(new THREE.Vector3(0, getScale(), 0)));
    removeClone(t.id);
  }
  sfx('found');
  feed(`🎯 ${h ? h.name : '猎人'} 找到了 ${t ? t.name : '???'}！`);
  if (m.id === S.myId) {
    setMode('play');
    banner('你被发现了！😵', '进入观战模式：可以自由飞行（空格上升 / C 下降）');
    ctrl.pos.y += 1.5;
  } else if (m.by === S.myId) {
    banner('抓到了！+100', t ? t.name : '', 1600);
    sfx('hit');
  }
}

function showResults() {
  const r = S.game.result || {};
  const card = $('resultsCard');
  card.innerHTML = '';
  const h = document.createElement('h2');
  const myRole = me() && me().role;
  if (r.winner === 'cancel') h.textContent = '回合已结束';
  else h.textContent = r.winner === 'hunters' ? '🔫 猎人获胜！' : '🦎 变色龙获胜！';
  card.appendChild(h);
  const won = (r.winner === 'hunters' && myRole === 'hunter') || (r.winner === 'chameleons' && myRole === 'chameleon');
  if (r.winner !== 'cancel') sfx(won ? 'win' : 'lose');
  const p = document.createElement('p');
  p.className = 'muted'; p.style.textAlign = 'center';
  p.textContent = (r.survivors || []).length ? `存活：${r.survivors.map(id => (S.players.get(id) || {}).name).filter(Boolean).join('、')}` : '所有变色龙都被找到了';
  card.appendChild(p);
  card.appendChild(scoreTable());
  const n = document.createElement('p');
  n.className = 'muted small'; n.style.textAlign = 'center'; n.textContent = '几秒后回到大厅…';
  card.appendChild(n);
  $('results').hidden = false;
  document.exitPointerLock && document.exitPointerLock();
}

function scoreTable() {
  const tbl = document.createElement('table');
  const head = tbl.insertRow();
  for (const t of ['玩家', '身份', '状态', '得分']) { const th = document.createElement('th'); th.textContent = t; head.appendChild(th); }
  const list = [...S.players.values()].sort((a, b) => b.score - a.score);
  for (const p of list) {
    const tr = tbl.insertRow();
    const role = S.game.phase === 'lobby' ? '—' : ({ hunter: '🔫 猎人', chameleon: '🦎 变色龙', spectator: '👀 观战' }[p.role] || '');
    const st = S.game.phase === 'lobby' ? '大厅' : (p.role === 'chameleon' ? (p.alive ? '存活' : '被找到') : '');
    for (const v of [p.name + (p.id === S.myId ? '（你）' : ''), role, st, p.score]) tr.insertCell().textContent = v;
  }
  return tbl;
}

// ================= 分身 =================
function spawnClone(m) {
  const owner = S.players.get(m.id);
  if (!owner || !Array.isArray(m.pos)) return;
  removeClone(m.id);
  const c = new Character(m.id, owner.name, { clone: true });
  c.copySkinFrom(owner.char);
  c.root.position.set(m.pos[0], m.pos[1], m.pos[2]);
  c.root.rotation.y = m.yaw || 0;
  c.pose = m.pose | 0;
  c.snapPose();
  scene.add(c.root);
  S.clones.set(m.id, c);
  if (m.id === S.myId) {
    toast('分身已放置！小心：分身被打中也算你被抓', 2500);
    if (S.game.phase === 'hide' || S.game.phase === 'seek') S.cloneUsed = true;
  }
  sfx('pop');
}
function removeClone(id) {
  const c = S.clones.get(id);
  if (!c) return;
  scene.remove(c.root);
  c.dispose();
  S.clones.delete(id);
}
function clearClones() { for (const id of [...S.clones.keys()]) removeClone(id); }
function placeClone() {
  if (effRole() !== 'chameleon') return;
  flushPaint();
  const p = ctrl.pos, r = v => Math.round(v * 100) / 100;
  S.send({ t: 'clone', pos: [r(p.x), r(p.y), r(p.z)], yaw: r(ctrl.bodyYaw), pose: S.pose });
}

// ================= 进入游戏 / 面板 =================
function enterGame() {
  S.inGame = true;
  clearDemo();
  $('menu').hidden = true;
  $('hud').hidden = false;
  $('roomCode').textContent = S.code;
  $('offlineNote').hidden = !S.offline;
  $('btnCopyLink').hidden = $('btnCopyCode').hidden = S.offline;
  const sel = $('setMap');
  sel.innerHTML = '';
  for (const [id, m] of Object.entries(MAPS)) { const o = document.createElement('option'); o.value = id; o.textContent = m.name; sel.appendChild(o); }
  if (!S.offline) {
    history.replaceState(null, '', location.pathname + location.search + '#room=' + S.code);
  }
  refreshPanel();
  updateOverlays();
  if (S.offline) toast(IS_TOUCH ? '欢迎来到练习场！点“继续游戏”开始，点🎨进入涂装' : '欢迎来到练习场！点击画面开始，按 F 进入涂装模式', 4500);
  else toast(S.isHost ? '房间已创建！点“复制邀请链接”发给朋友' : '已加入房间！', 4000);
  setInterval(sendState, 66);
  setInterval(flushPaint, 60);
}

function refreshPanel() {
  if (!S.inGame) return;
  const list = $('playerList');
  list.innerHTML = '';
  const ps = [...S.players.values()];
  $('playerCount').textContent = `(${ps.length}/24)`;
  for (const p of ps) {
    const li = document.createElement('li');
    const icon = document.createElement('span');
    icon.textContent = S.game.phase === 'lobby' ? '🦎' : ({ hunter: '🔫', chameleon: p.alive ? '🦎' : '💀', spectator: '👀' }[p.role] || '🦎');
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = p.name;
    li.append(icon, nm);
    if (p.host) { const t = document.createElement('span'); t.className = 'tagHost'; t.textContent = '房主'; li.appendChild(t); }
    if (p.id === S.myId) { const t = document.createElement('span'); t.className = 'tagMe'; t.textContent = '你'; li.appendChild(t); }
    const sc = document.createElement('span'); sc.className = 'muted small'; sc.textContent = p.score + ' 分';
    li.appendChild(sc);
    list.appendChild(li);
  }
  const s = S.game.settings;
  const editable = S.isHost && S.game.phase === 'lobby';
  for (const [id, v] of [['setMap', s.map], ['setHide', s.hide], ['setSeek', s.seek], ['setHunters', s.hunters], ['setSize', s.size || 40]]) {
    const el = $(id);
    if (document.activeElement !== el) el.value = v;
    el.disabled = !editable;
  }
  $('hostOnly').hidden = S.isHost;
  $('btnStart').hidden = !(S.isHost && S.game.phase === 'lobby');
  $('btnEndRound').hidden = !(S.isHost && (S.game.phase === 'hide' || S.game.phase === 'seek'));
}

function sendSettings() {
  if (!S.isHost) return;
  S.send({ t: 'settings', settings: { map: $('setMap').value, hide: +$('setHide').value, seek: +$('setSeek').value, hunters: +$('setHunters').value, size: +$('setSize').value } });
}
for (const id of ['setMap', 'setHide', 'setSeek', 'setHunters', 'setSize']) $(id).addEventListener('change', sendSettings);
$('btnStart').onclick = () => S.send({ t: 'start' });
$('btnEndRound').onclick = () => { if (confirm('确定要提前结束本回合吗？')) S.send({ t: 'endRound' }); };
$('btnResume').onclick = () => requestLock();
$('btnLeave').onclick = () => {
  if (!confirm(S.isHost && !S.offline ? '你是房主，离开会解散房间。确定吗？' : '确定离开房间？')) return;
  if (S.server) S.server.close();
  if (S.net) S.net.close();
  setTimeout(() => { location.hash = ''; location.reload(); }, 300);
};
const inviteLink = () => location.origin + location.pathname + location.search + '#room=' + S.code;
async function copy(text, okMsg) {
  try { await navigator.clipboard.writeText(text); toast(okMsg); }
  catch (e) { prompt('复制下面的内容发给朋友：', text); }
}
$('btnCopyLink').onclick = () => copy(inviteLink(), '邀请链接已复制，发给朋友吧！');
$('btnCopyCode').onclick = () => copy(S.code, '房间码已复制：' + S.code);

function requestLock() {
  if (!S.inGame || S.mode !== 'play' || S.chatOpen) return;
  if (IS_TOUCH) { S.paused = false; updateOverlays(); return; }
  try {
    const r = canvas.requestPointerLock();
    if (r && r.catch) r.catch(() => {});
  } catch (e) { /* ignore */ }
}

function updateOverlays() {
  if (!S.inGame) return;
  const showPause = S.mode === 'play' && !active() && !S.chatOpen && !S.poseMenu && $('results').hidden;
  $('pause').hidden = !showPause;
  $('paintPanel').hidden = S.mode !== 'paint';
  if (IS_TOUCH) {
    const playing = S.mode === 'play' && !showPause && !S.poseMenu && $('results').hidden;
    $('touchUI').hidden = !playing;
    $('actionBar').hidden = !playing;
    $('tFire').hidden = effRole() !== 'hunter';
    $('tJump').innerHTML = effRole() === 'ghost' ? '⤒<small>上升</small>' : '⤒<small>跳</small>';
  }
  // 涂装面板打开时，把画面中心挪到面板旁边，自己的人偶不会被挡住
  if (S.mode === 'paint') {
    const portrait = innerWidth <= 700;
    const panel = $('paintPanel').getBoundingClientRect();
    if (portrait) camera.setViewOffset(innerWidth, innerHeight, 0, panel.height / 2, innerWidth, innerHeight);
    else camera.setViewOffset(innerWidth, innerHeight, (panel.width + 12) / 2, 0, innerWidth, innerHeight);
  } else if (camera.view && camera.view.enabled) camera.clearViewOffset();
}
document.addEventListener('pointerlockchange', () => { if (locked()) { $('pause').hidden = true; } updateOverlays(); });
canvas.addEventListener('click', () => { if (!IS_TOUCH && S.mode === 'play' && !locked()) requestLock(); });

// ================= 涂装模式 =================
function setMode(mode) {
  if (mode === 'paint' && effRole() !== 'chameleon') return;
  S.mode = mode;
  if (S.poseMenu) { S.poseMenu = false; $('poseMenu').hidden = true; }
  $('pickTip').hidden = true;
  brushCursor.visible = false;
  if (mode === 'paint') {
    // 从正面看自己，更方便涂装
    S.orbit.yaw = ctrl.bodyYaw + Math.PI;
    S.orbit.pitch = 0.2;
    S.orbit.dist = 2.9 * getScale();
    document.exitPointerLock && document.exitPointerLock();
    refreshPaintUI();
  } else {
    requestLock();
  }
  updateOverlays();
}

function setColor(c, addRecent = true, fromSliders = false) {
  S.color = c;
  if (!fromSliders) {
    const hsl = {};
    new THREE.Color().setStyle(c, THREE.SRGBColorSpace).getHSL(hsl, THREE.SRGBColorSpace);
    $('hueInput').value = Math.round(hsl.h * 360);
    $('satInput').value = Math.round(hsl.s * 100);
    $('litInput').value = Math.round(hsl.l * 100);
  }
  store.set('cp_color', c);
  $('colorInput').value = c;
  $('colorHex').textContent = c;
  $('swatchBig').style.background = c;
  if (addRecent) {
    S.recent = [c, ...S.recent.filter(x => x !== c)].slice(0, 16);
    store.set('cp_recent', JSON.stringify(S.recent));
  }
  refreshRecent();
}

function refreshRecent() {
  const box = $('recent');
  box.innerHTML = '';
  for (const c of S.recent) {
    const b = document.createElement('button');
    b.style.background = c; b.title = c;
    b.onclick = () => setColor(c);
    box.appendChild(b);
  }
}

const POSE_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='];
function poseKey(code) {
  const m = code.match(/^Digit(\d)$/);
  if (m) return m[1] === '0' ? 9 : +m[1] - 1;
  if (code === 'Minus') return 10;
  if (code === 'Equal') return 11;
  return -1;
}

function setTool(t) { S.tool = t; refreshPaintUI(); }
function setPose(i) {
  if (effRole() !== 'chameleon' || i < 0 || i >= POSES.length) return;
  S.pose = i;
  refreshPaintUI();
}

function refreshPaintUI() {
  document.querySelectorAll('.tools button').forEach(b => b.classList.toggle('on', b.dataset.tool === S.tool));
  document.querySelectorAll('.sizes button').forEach(b => b.classList.toggle('on', +b.dataset.size === S.size));
  document.querySelectorAll('#poseBtns button, #poseGrid button').forEach(b => b.classList.toggle('on', +b.dataset.pose === S.pose));
  $('sizeInput').value = S.size;
  $('mirrorInput').checked = S.mirror;
}

document.querySelectorAll('.tools button').forEach(b => { b.onclick = () => setTool(b.dataset.tool); });
document.querySelectorAll('.sizes button').forEach(b => { b.onclick = () => { S.size = +b.dataset.size; refreshPaintUI(); }; });
$('mirrorInput').addEventListener('change', e => { S.mirror = e.target.checked; });
function poseButton(p, i, big) {
  const b = document.createElement('button');
  b.dataset.pose = i;
  b.title = `${p.name}（${POSE_KEYS[i]}）`;
  b.innerHTML = `<span class="pi"></span><span class="pn"></span>${big ? '<span class="pk"></span>' : ''}`;
  b.querySelector('.pi').textContent = p.icon || '🧍';
  b.querySelector('.pn').textContent = p.name;
  if (big) b.querySelector('.pk').textContent = '按键 ' + POSE_KEYS[i];
  return b;
}
POSES.forEach((p, i) => {
  const small = poseButton(p, i, false);
  small.onclick = () => setPose(i);
  $('poseBtns').appendChild(small);
  const big = poseButton(p, i, true);
  big.onclick = () => { setPose(i); togglePoseMenu(false); };
  $('poseGrid').appendChild(big);
});

// ---------- 姿势菜单（R） ----------
function togglePoseMenu(on) {
  if (on && effRole() !== 'chameleon') return;
  S.poseMenu = on;
  $('poseMenu').hidden = !on;
  if (on) { document.exitPointerLock && document.exitPointerLock(); refreshPaintUI(); }
  else if (S.mode === 'play') requestLock();
  updateOverlays();
}
$('poseMenu').addEventListener('click', e => { if (e.target.id === 'poseMenu') togglePoseMenu(false); });

// ---------- 颜色微调 ----------
function shiftLightness(d) {
  const hsl = {};
  const c = new THREE.Color().setStyle(S.color, THREE.SRGBColorSpace);
  c.getHSL(hsl, THREE.SRGBColorSpace);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + d)), THREE.SRGBColorSpace);
  setColor('#' + c.getHexString(THREE.SRGBColorSpace));
}
$('btnDarker').onclick = () => shiftLightness(-0.07);
$('btnLighter').onclick = () => shiftLightness(0.07);
function hslToHex() {
  const c = new THREE.Color().setHSL(+$('hueInput').value / 360, +$('satInput').value / 100, +$('litInput').value / 100, THREE.SRGBColorSpace);
  return '#' + c.getHexString(THREE.SRGBColorSpace);
}
for (const id of ['hueInput', 'satInput', 'litInput']) {
  $(id).addEventListener('input', () => setColor(hslToHex(), false, true));
  $(id).addEventListener('change', () => setColor(hslToHex(), true, true));
}
$('colorInput').addEventListener('input', e => setColor(e.target.value, false));
$('colorInput').addEventListener('change', e => setColor(e.target.value, true));
$('sizeInput').addEventListener('input', e => { S.size = +e.target.value; refreshPaintUI(); });
$('btnFillAll').onclick = () => { pushUndo(); paintOp([3, 0, 0, 0, 0, 0, S.color, 0]); sfx('pop'); };
$('btnResetSkin').onclick = () => { pushUndo(); paintOp([5, 0, 0, 0, 0, 0, BASE_COLOR, 0]); toast('已擦掉，可以按“撤销”恢复', 1800); };
$('btnUndo').onclick = () => undo();

// ---------- 撤销 ----------
function pushUndo() {
  const c = myChar();
  if (!c) return;
  S.undo.push(c.getSkin());
  if (S.undo.length > 25) S.undo.shift();
}
function undo() {
  const c = myChar();
  if (!c || !S.undo.length) { toast('没有可以撤销的了', 1200); return; }
  flushPaint();
  c.setSkin(S.undo.pop());
  S.send({ t: 'skin', urls: c.snapshot() });
  sfx('pick');
}
$('rotL').onclick = () => { ctrl.bodyYaw += Math.PI / 12; };
$('rotR').onclick = () => { ctrl.bodyYaw -= Math.PI / 12; };
$('zoomIn').onclick = () => zoomOrbit(0.8);
$('zoomOut').onclick = () => zoomOrbit(1.25);
$('btnPaintDone').onclick = () => setMode('play');
setColor(S.color, false);
refreshPaintUI();

function paintOp(op) {
  const c = myChar();
  if (!c) return;
  c.applyOp(op);
  S.pendingOps.push(op);
}

function flushPaint() {
  if (!S.pendingOps.length) return;
  const ops = S.pendingOps.splice(0, 300).map(o => o.map((v, i) => typeof v === 'number' && i >= 2 && i <= 5 ? Math.round(v * 1000) / 1000 : v));
  S.send({ t: 'paint', ops });
}

const mouseNDC = e => new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);

function visibleCharMeshes(excludeMe) {
  const out = [];
  for (const p of S.players.values()) {
    if (excludeMe && p.id === S.myId) continue;
    if (!p.char.root.visible) continue;
    out.push(...p.char.meshes);
  }
  for (const c of S.clones.values()) out.push(...c.meshes);
  return out;
}

function pickColorAt(ndc, excludeMe) {
  ray.setFromCamera(ndc, camera);
  ray.far = 200;
  const hits = ray.intersectObjects(world.meshes.concat(visibleCharMeshes(excludeMe)), false).filter(h => h.object.visible);
  if (!hits.length) return false;
  const c = sampleHit(hits[0]);
  if (!c) return false;
  setColor(c);
  sfx('pick');
  return true;
}

let lastDab = null;
const tmpL = new THREE.Vector3();
// 笔刷大小按人偶大小换算（“中”号约等于手臂粗细）
const brushRadius = () => S.size / 100 * getScale() / 0.62;

// 人偶大小（房主设置）
function applyCharScale(pct) {
  const s = Math.max(0.3, Math.min(0.5, (+pct || 40) / 100));
  if (Math.abs(s - getScale()) < 1e-6 && ctrl.H) { ctrl.setScale(s); return; }
  setScale(s);
  ctrl.setScale(s);
  for (const p of S.players.values()) p.char.applyScale();
  for (const c of S.clones.values()) c.applyScale();
  for (const c of demo) c.applyScale();
  S.orbit.dist = 2.9 * s;
}
// 以世界坐标点为笔尖，给所有“够得着”的身体部件各生成一个本地坐标笔触
function dabParts(c, w, kind, r, col) {
  const rl = r / getScale(); // 部件本地坐标中的半径（人偶被整体缩小了）
  for (const m of c.meshes) {
    const geo = m.geometry;
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    tmpL.copy(w);
    m.worldToLocal(tmpL);
    if (tmpL.distanceTo(geo.boundingSphere.center) > geo.boundingSphere.radius + rl) continue;
    paintOp([kind, m.userData.part, tmpL.x, tmpL.y, tmpL.z, rl, col, (Math.random() * 1e9) | 0]);
  }
}
function dabWorld(c, w, kind, r, col) {
  dabParts(c, w, kind, r, col);
  if (S.mirror) {
    // 在角色自身坐标系里左右镜像
    const m = c.root.worldToLocal(w.clone());
    m.x = -m.x;
    dabParts(c, c.root.localToWorld(m), kind, r, col);
  }
}

function hitMyChar(ndc) {
  const c = myChar();
  if (!c) return null;
  ray.setFromCamera(ndc, camera);
  ray.far = 50;
  return ray.intersectObjects(c.meshes, false)[0] || null;
}

function brushAt(ndc, first) {
  const c = myChar();
  const h = hitMyChar(ndc);
  if (!h) { lastDab = null; return; }
  const col = S.color;
  if (S.tool === 'fill') {
    if (first) {
      paintOp([1, h.object.userData.part, 0, 0, 0, 0, col, 0]);
      if (S.mirror) {
        const mirrorPart = { 2: 3, 3: 2, 4: 5, 5: 4 }[h.object.userData.part];
        if (mirrorPart !== undefined) paintOp([1, mirrorPart, 0, 0, 0, 0, col, 0]);
      }
    }
    return;
  }
  const kind = S.tool === 'spray' ? 2 : 0;
  const r = brushRadius();
  const pt = h.point.clone();
  if (lastDab && lastDab.distanceTo(pt) < 0.4) {
    const d = lastDab.distanceTo(pt);
    const spacing = Math.max(0.003, r * (kind === 2 ? 0.7 : 0.35));
    if (d < spacing) return;
    const n = Math.ceil(d / spacing);
    for (let i = 1; i <= n; i++) dabWorld(c, lastDab.clone().lerp(pt, i / n), kind, r, col);
  } else dabWorld(c, pt, kind, r, col);
  lastDab = pt;
}

// 笔刷预览球：鼠标停在身上时显示笔刷大小
const brushCursor = new THREE.Mesh(
  new THREE.SphereGeometry(1, 16, 12),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false }),
);
brushCursor.visible = false;
brushCursor.renderOrder = 5;
scene.add(brushCursor);

function sampleAt(ndc) {
  ray.setFromCamera(ndc, camera);
  ray.far = 200;
  const hits = ray.intersectObjects(world.meshes.concat(visibleCharMeshes(true)), false).filter(h => h.object.visible);
  return hits.length ? sampleHit(hits[0]) : null;
}

let hoverT = 0;
function updateHover(e) {
  const now = performance.now();
  if (now - hoverT < 30) return;
  hoverT = now;
  const ndc = mouseNDC(e);
  const h = hitMyChar(ndc);
  const tip = $('pickTip');
  if (h) {
    brushCursor.visible = S.tool !== 'fill';
    brushCursor.position.copy(h.point);
    brushCursor.scale.setScalar(brushRadius());
    brushCursor.material.color.set(S.color);
    tip.hidden = true;
    canvas.style.cursor = S.tool === 'fill' ? 'cell' : 'crosshair';
    return;
  }
  brushCursor.visible = false;
  const c = sampleAt(ndc);
  if (c) {
    tip.hidden = false;
    tip.style.left = e.clientX + 16 + 'px';
    tip.style.top = e.clientY + 14 + 'px';
    $('pickTipSw').style.background = c;
    canvas.style.cursor = 'copy';
  } else { tip.hidden = true; canvas.style.cursor = 'grab'; }
}

// 涂装模式的鼠标：点身体=涂色；点周围=吸色；拖动空白=转视角；右键=吸色
let painting = false, orbiting = false, pressed = null, lastMouse = null;
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('pointerdown', e => {
  if (!S.inGame) return;
  if (S.mode === 'play' && IS_TOUCH) { touchLookStart(e); return; }
  if (S.mode === 'paint' && e.pointerType === 'touch') {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) {
      // 第二根手指按下：取消当前笔画，改为缩放
      if (painting) undo();
      painting = false; orbiting = false; pressed = null;
      pinch = { d: pinchDist(), dist: S.orbit.dist };
      return;
    }
    if (touches.size > 2) return;
  }
  if (S.mode === 'paint') {
    const ndc = mouseNDC(e);
    if (e.button === 2) { pickColorAt(ndc, false); return; }
    if (e.button === 1) { orbiting = true; lastMouse = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId); return; }
    if (e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    if (!e.shiftKey && hitMyChar(ndc)) {
      pushUndo();
      painting = true; lastDab = null;
      brushAt(ndc, true);
    } else {
      pressed = { x: e.clientX, y: e.clientY, shift: e.shiftKey };
      lastMouse = [e.clientX, e.clientY];
    }
    return;
  }
  if (locked()) {
    if (e.button === 0 && effRole() === 'hunter') shoot();
    if (e.button === 2 && effRole() === 'chameleon') pickColorAt(new THREE.Vector2(0, 0), true);
  }
});
canvas.addEventListener('pointermove', e => {
  if (S.mode !== 'paint') return;
  if (touches.has(e.pointerId)) {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && touches.size === 2) {
      const s = getScale();
      S.orbit.dist = Math.max(0.9 * s, Math.min(9 * s, pinch.dist * pinch.d / Math.max(10, pinchDist())));
      return;
    }
  }
  if (pinch) return;
  if (pressed && !orbiting && Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) > 5) orbiting = true;
  if (orbiting && lastMouse) {
    S.orbit.yaw -= (e.clientX - lastMouse[0]) * 0.008;
    S.orbit.pitch = Math.max(-1.2, Math.min(1.35, S.orbit.pitch + (e.clientY - lastMouse[1]) * 0.006));
    lastMouse = [e.clientX, e.clientY];
    canvas.style.cursor = 'grabbing';
    $('pickTip').hidden = true;
  } else if (painting) {
    brushAt(mouseNDC(e), false);
    brushCursor.visible = false;
  } else updateHover(e);
});
function paintPointerEnd(e) {
  touches.delete(e.pointerId);
  if (pinch) { if (touches.size === 0) pinch = null; return; }
  if (S.mode === 'paint' && pressed && !orbiting && e.target === canvas && e.type === 'pointerup') pickColorAt(mouseNDC(e), false);
  painting = false; orbiting = false; pressed = null; lastDab = null;
  if (e.pointerType === 'touch') brushCursor.visible = false;
}
addEventListener('pointerup', paintPointerEnd);
addEventListener('pointercancel', paintPointerEnd);
canvas.addEventListener('pointerleave', () => { $('pickTip').hidden = true; brushCursor.visible = false; });
function zoomOrbit(f) { const s = getScale(); S.orbit.dist = Math.max(0.9 * s, Math.min(9 * s, S.orbit.dist * f)); }
canvas.addEventListener('wheel', e => {
  if (S.mode === 'paint') zoomOrbit(e.deltaY > 0 ? 1.1 : 0.9);
}, { passive: true });

// ================= 通用动作（键盘和触屏按钮共用） =================
function toggleLobbyHunter() {
  if (S.game.phase !== 'lobby') return;
  S.lobbyHunter = !S.lobbyHunter;
  if (S.mode === 'paint') setMode('play');
  toast(S.lobbyHunter ? (IS_TOUCH ? '猎人视角（练习）：点🔫射击' : '猎人视角（练习）：左键射击试试看能不能发现朋友') : '变回变色龙');
  updateOverlays();
}
function doAction(act) {
  const role = effRole();
  switch (act) {
    case 'paint': if (role === 'chameleon') setMode('paint'); break;
    case 'pose': togglePoseMenu(true); break;
    case 'pick': if (role === 'chameleon') pickColorAt(new THREE.Vector2(0, 0), true); break;
    case 'crouch': S.touchCrouch = !S.touchCrouch; break;
    case 'clone': placeClone(); break;
    case 'taunt': taunt(); break;
    case 'shoot': if (role === 'hunter') shoot(); break;
    case 'hunterToggle': toggleLobbyHunter(); break;
  }
}
$('actionBar').addEventListener('pointerdown', e => {
  const el = e.target.closest('.slot');
  if (!el || !el.dataset.act) return;
  e.preventDefault();
  e.stopPropagation();
  doAction(el.dataset.act);
});

// ================= 手机触控：摇杆 / 滑动视角 / 按钮 =================
const joy = { id: null, ox: 0, oy: 0 };
const JOY_R = 55;
function setKnob(dx, dy) { $('joyKnob').style.transform = `translate(${dx}px, ${dy}px)`; }
$('joyZone').addEventListener('pointerdown', e => {
  if (joy.id !== null) return;
  e.preventDefault();
  joy.id = e.pointerId;
  const r = $('joyZone').getBoundingClientRect();
  joy.ox = e.clientX; joy.oy = e.clientY;
  $('joyBase').style.left = (e.clientX - r.left) + 'px';
  $('joyBase').style.top = (e.clientY - r.top) + 'px';
  $('joyZone').classList.add('active');
  $('joyZone').setPointerCapture(e.pointerId);
});
$('joyZone').addEventListener('pointermove', e => {
  if (e.pointerId !== joy.id) return;
  let dx = e.clientX - joy.ox, dy = e.clientY - joy.oy;
  const d = Math.hypot(dx, dy);
  if (d > JOY_R) { dx = dx / d * JOY_R; dy = dy / d * JOY_R; }
  setKnob(dx, dy);
  S.joy = [dx / JOY_R, -dy / JOY_R];
});
function joyEnd(e) {
  if (e.pointerId !== joy.id) return;
  joy.id = null;
  S.joy = [0, 0];
  setKnob(0, 0);
  $('joyZone').classList.remove('active');
}
$('joyZone').addEventListener('pointerup', joyEnd);
$('joyZone').addEventListener('pointercancel', joyEnd);

function holdButton(id, on, off) {
  const el = $(id);
  el.addEventListener('pointerdown', e => { e.preventDefault(); el.classList.add('down'); on(); });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(ev, () => { el.classList.remove('down'); off(); });
}
holdButton('tJump', () => { S.touchJump = true; }, () => { S.touchJump = false; });
holdButton('tFire', () => { if (effRole() === 'hunter') shoot(); }, () => {});
$('tMenu').addEventListener('pointerdown', e => { e.preventDefault(); S.paused = true; updateOverlays(); });

// 屏幕其他地方：单指滑动转视角
const look = { id: null, x: 0, y: 0 };
function touchLookStart(e) {
  if (!IS_TOUCH || S.mode !== 'play' || !active() || look.id !== null) return false;
  look.id = e.pointerId; look.x = e.clientX; look.y = e.clientY;
  canvas.setPointerCapture(e.pointerId);
  return true;
}
canvas.addEventListener('pointermove', e => {
  if (e.pointerId !== look.id) return;
  const k = 0.006;
  ctrl.yaw -= (e.clientX - look.x) * k;
  ctrl.pitch = Math.max(-1.5, Math.min(1.5, ctrl.pitch - (e.clientY - look.y) * k));
  look.x = e.clientX; look.y = e.clientY;
});
for (const ev of ['pointerup', 'pointercancel']) canvas.addEventListener(ev, e => { if (e.pointerId === look.id) look.id = null; });

// 涂装模式：两指捏合缩放
const touches = new Map();
let pinch = null;
function pinchDist() { const [a, b] = [...touches.values()]; return Math.hypot(a.x - b.x, a.y - b.y); }

// ================= 输入 =================
const keys = {};
const SENS = 0.0022;
document.addEventListener('mousemove', e => {
  if (!locked() || S.mode !== 'play') return;
  ctrl.yaw -= e.movementX * SENS;
  ctrl.pitch = Math.max(-1.5, Math.min(1.5, ctrl.pitch - e.movementY * SENS));
});

function openChat() {
  S.chatOpen = true;
  $('chat').classList.add('open');
  $('chatInput').hidden = false;
  $('chatInput').focus();
}
function closeChat() {
  S.chatOpen = false;
  $('chat').classList.remove('open');
  $('chatInput').value = '';
  $('chatInput').hidden = true;
  $('chatInput').blur();
  updateOverlays();
}
$('chatInput').addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Enter') {
    const text = $('chatInput').value.trim();
    if (text) S.send({ t: 'chat', text });
    closeChat();
  } else if (e.key === 'Escape') closeChat();
});

addEventListener('keydown', e => {
  if (!S.inGame || S.chatOpen) return;
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') && e.target.id !== 'sizeInput') return;
  const code = e.code;
  if (code === 'Tab') { e.preventDefault(); showScoreboard(true); return; }
  if (code === 'Enter') { e.preventDefault(); openChat(); return; }
  if (S.poseMenu) {
    if (code === 'KeyR' || code === 'Escape') togglePoseMenu(false);
    else if (poseKey(code) >= 0) { setPose(poseKey(code)); togglePoseMenu(false); }
    return;
  }
  if (S.mode === 'paint') {
    if ((e.ctrlKey || e.metaKey) && code === 'KeyZ') { e.preventDefault(); undo(); return; }
    if (code === 'KeyF' || code === 'Escape') { setMode('play'); return; }
    if (code === 'KeyB') setTool('brush');
    if (code === 'KeyN') setTool('spray');
    if (code === 'KeyK') setTool('fill');
    if (code === 'KeyM') { S.mirror = !S.mirror; refreshPaintUI(); }
    if (code === 'KeyQ') ctrl.bodyYaw += Math.PI / 12;
    if (code === 'KeyE') ctrl.bodyYaw -= Math.PI / 12;
    if (code === 'BracketLeft') { S.size = Math.max(1, S.size - 1); refreshPaintUI(); }
    if (code === 'BracketRight') { S.size = Math.min(15, S.size + 1); refreshPaintUI(); }
    if (poseKey(code) >= 0) setPose(poseKey(code));
    return;
  }
  keys[code] = true;
  if (code === 'Space') e.preventDefault();
  const role = effRole();
  if (code === 'KeyF' && role === 'chameleon') setMode('paint');
  if (code === 'KeyR' && role === 'chameleon') togglePoseMenu(true);
  if (poseKey(code) >= 0) setPose(poseKey(code));
  if (code === 'KeyV') S.thirdPerson = !S.thirdPerson;
  if (code === 'KeyT') taunt();
  if (code === 'KeyG') placeClone();
  if (code === 'KeyQ' && role === 'chameleon') ctrl.bodyYaw += Math.PI / 12;
  if (code === 'KeyE' && role === 'chameleon' && locked()) pickColorAt(new THREE.Vector2(0, 0), true);
  if (code === 'KeyH') toggleLobbyHunter();
});
addEventListener('keyup', e => {
  keys[e.code] = false;
  if (e.code === 'Tab') showScoreboard(false);
});
addEventListener('blur', () => { for (const k in keys) keys[k] = false; showScoreboard(false); });

function showScoreboard(on) {
  if (!S.inGame) return;
  if (on) {
    const card = $('scoreCard');
    card.innerHTML = '';
    const h = document.createElement('h3'); h.textContent = `计分板 · 房间 ${S.code}`; h.style.marginTop = '0';
    card.append(h, scoreTable());
  }
  $('scoreboard').hidden = !on;
}

function taunt() {
  const p = me();
  if (!p || effRole() !== 'chameleon') return;
  const now = performance.now();
  if (now < S.tauntUntil) { toast(`嘲讽冷却中（${Math.ceil((S.tauntUntil - now) / 1000)} 秒）`, 1200); return; }
  S.tauntUntil = now + 10000;
  const pos = ctrl.pos;
  S.send({ t: 'taunt', pos: [pos.x, pos.y + ctrl.H * 0.6, pos.z].map(v => Math.round(v * 100) / 100) });
}

// ================= 猎人射击 =================
function shoot() {
  const now = performance.now();
  if (now < S.cooldownUntil) return;
  if (S.game.phase === 'hide') return;
  ray.setFromCamera(new THREE.Vector2(0, 0), camera);
  ray.far = 60;
  const hits = ray.intersectObjects(world.meshes.concat(visibleCharMeshes(true)), false);
  const h = hits[0];
  const dir = ray.ray.direction.clone();
  const from = camera.position.clone().add(new THREE.Vector3(0.12, -0.1, 0).applyQuaternion(camera.quaternion));
  const to = h ? h.point.clone() : camera.position.clone().addScaledVector(dir, 60);
  const pid = h && h.object.userData.pid;
  const isClone = !!(h && h.object.userData.clone);
  const target = pid && pid !== S.myId ? S.players.get(pid) : null;
  tracer(from, to, true);
  if (h) splat(h);
  sfx('shoot');
  const r2 = v => v.toArray().map(x => Math.round(x * 100) / 100);
  S.send({ t: 'shot', a: r2(from), b: r2(to), hit: !!target });
  if (target) {
    S.cooldownUntil = now + 400;
    if (S.game.phase === 'seek' && target.role === 'chameleon' && target.alive) S.send({ t: 'tag', target: target.id });
    else if (S.game.phase === 'lobby') { toast(`🎯 命中 ${target.name}${isClone ? ' 的分身' : ''}！（练习）`, 1500); sfx('hit'); }
  } else {
    S.cooldownUntil = now + 1300;
    setTimeout(() => sfx('miss'), 80);
  }
}

// ================= 特效 =================
const fx = [];
function tracer(a, b, mine = false) {
  const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
  const m = new THREE.LineBasicMaterial({ color: mine ? 0xff7b3a : 0xffd32a, transparent: true, opacity: 0.9 });
  const line = new THREE.Line(geo, m);
  scene.add(line);
  fx.push({ obj: line, life: 0.25, max: 0.25, fade: true });
}
function splat(h) {
  const n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
  const m = new THREE.Mesh(new THREE.CircleGeometry(0.06, 10), new THREE.MeshBasicMaterial({ color: 0xff7b3a, transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
  m.position.copy(h.point).addScaledVector(n, 0.01);
  m.lookAt(h.point.clone().add(n));
  scene.add(m);
  fx.push({ obj: m, life: 3, max: 3, fade: true });
}
function poof(pos) {
  const cols = [0xffffff, 0xffeaa7, 0xff7675, 0x74b9ff];
  for (let i = 0; i < 26; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), new THREE.MeshBasicMaterial({ color: cols[i % 4], transparent: true }));
    m.position.copy(pos);
    const v = new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 4 + 1, (Math.random() - 0.5) * 4);
    scene.add(m);
    fx.push({ obj: m, life: 1.1, max: 1.1, fade: true, vel: v });
  }
}
const noteTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'); g.font = '52px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#ffd32a'; g.strokeStyle = '#000'; g.lineWidth = 3; g.strokeText('♪', 32, 34); g.fillText('♪', 32, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
function note(pos) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: noteTex, transparent: true, depthTest: false }));
  s.position.copy(pos).add(new THREE.Vector3(0, getScale() * 1.2, 0));
  s.scale.set(0.6, 0.6, 1);
  scene.add(s);
  fx.push({ obj: s, life: 1.6, max: 1.6, fade: true, vel: new THREE.Vector3(0, 0.8, 0) });
}
function distVol(pos, range) {
  const d = camera.position.distanceTo(pos);
  return Math.max(0, 1 - d / range);
}
function updateFx(dt) {
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i];
    f.life -= dt;
    if (f.vel) { f.obj.position.addScaledVector(f.vel, dt); if (f.obj.isMesh) f.vel.y -= 9 * dt; }
    if (f.fade) f.obj.material.opacity = Math.max(0, f.life / f.max);
    if (f.life <= 0) {
      scene.remove(f.obj);
      if (f.obj.geometry) f.obj.geometry.dispose();
      f.obj.material.dispose();
      fx.splice(i, 1);
    }
  }
}

// ================= 状态同步 =================
function sendState() {
  if (!S.inGame || !S.myId) return;
  const p = ctrl.pos;
  const r = v => Math.round(v * 100) / 100;
  S.send({ t: 'st', s: [r(p.x), r(p.y), r(p.z), r(ctrl.bodyYaw), S.shownPose ?? S.pose, ctrl.moving ? 1 : 0] });
  if (!S.isHost && S.lastSnap && performance.now() - S.lastSnap > 30000) fatal('与房主失去联系', '30 秒没有收到房主的数据。');
}

// ================= 主循环 =================
const clock = new THREE.Clock();
let hudTimer = 0;

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  if (S.inGame) {
    updateLocal(dt);
    updateRemotes(dt);
    updateCamera(dt);
    updateFx(dt);
    hudTimer -= dt;
    if (hudTimer <= 0) { hudTimer = 0.1; updateHUD(); }
  } else {
    // 菜单背景：绕着客厅里的展示人偶慢慢转
    const t = performance.now() * 0.00012;
    camera.position.set(-7 + Math.sin(t) * 4.5, 1.9, -8.5 + Math.cos(t) * 3.8);
    camera.lookAt(-7, 0.3, -8.8);
    for (const c of demo) c.update(dt);
  }
  renderer.render(scene, camera);
}

function updateLocal(dt) {
  const p = me();
  if (!p) return;
  const role = effRole();
  const blind = S.game.phase === 'hide' && role === 'hunter';
  const canMove = active() && S.mode === 'play' && !S.chatOpen && !S.poseMenu && !blind;
  let input = {};
  if (canMove && IS_TOUCH) {
    const mag = Math.hypot(S.joy[0], S.joy[1]);
    input = { analog: S.joy, jump: S.touchJump, sprint: mag > 0.92, down: role === 'ghost' && S.touchCrouch };
  } else if (canMove) {
    input = {
      f: keys.KeyW || keys.ArrowUp, b: keys.KeyS || keys.ArrowDown,
      l: keys.KeyA || keys.ArrowLeft, r: keys.KeyD || keys.ArrowRight,
      jump: keys.Space, sprint: keys.ShiftLeft || keys.ShiftRight, down: keys.KeyC || keys.ControlLeft,
    };
  }
  const wantCrouch = IS_TOUCH ? S.touchCrouch : (keys.KeyC || keys.ControlLeft);
  ctrl.setCrouch(!!(canMove && role !== 'ghost' && wantCrouch), world);
  const speed = 2.8 + 2 * getScale() + (role === 'hunter' ? 0.4 : 0);
  ctrl.update(dt, input, world, { speed, fly: role === 'ghost', frozen: !canMove });
  if (ctrl.moving && S.pose !== 0) { S.pose = 0; refreshPaintUI(); }
  S.shownPose = ctrl.crouch ? 1 : S.pose;

  const c = p.char;
  c.root.position.copy(ctrl.pos);
  c.root.rotation.y = ctrl.bodyYaw;
  c.pose = S.shownPose;
  c.moving = ctrl.moving && ctrl.grounded;
  c.update(dt);
  const firstPerson = role === 'hunter' || (!S.thirdPerson && S.mode !== 'paint');
  c.root.visible = role !== 'ghost' && !firstPerson;
  c.tag.visible = false;
  const wantHat = role === 'hunter';
  if (c.hat.visible !== wantHat && S.game.phase === 'lobby') c.hat.visible = wantHat;
}

function updateRemotes(dt) {
  const myRole = effRole();
  const k = 1 - Math.exp(-dt * 12);
  for (const p of S.players.values()) {
    if (p.id === S.myId) continue;
    const c = p.char;
    if (p.tgt) {
      const [x, y, z, yaw, pose, mv] = p.tgt;
      const pos = c.root.position;
      if (Math.hypot(pos.x - x, pos.y - y, pos.z - z) > 6) pos.set(x, y, z);
      else { pos.x += (x - pos.x) * k; pos.y += (y - pos.y) * k; pos.z += (z - pos.z) * k; }
      let d = yaw - c.root.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      c.root.rotation.y += d * k;
      c.pose = pose | 0;
      c.moving = !!mv;
    }
    const vis = isVisibleTo(p) && !!p.tgt;
    c.root.visible = vis;
    c.tag.visible = vis && (S.game.phase === 'lobby' || p.role === 'hunter' || myRole !== 'hunter');
    c.update(dt);
  }
}

const tmpV = new THREE.Vector3();
let hiddenBlockers = [];
function restoreBlockers() { for (const m of hiddenBlockers) m.visible = true; hiddenBlockers = []; }
function updateCamera() {
  const role = effRole();
  const pos = ctrl.pos;
  if (S.mode === 'paint') {
    const pose = POSES[S.pose];
    const ty = (pose.bodyRX ? 0.35 : (pose.hipsY !== undefined && pose.hipsY < 0.5 ? 0.6 : 0.95)) * getScale();
    const target = tmpV.set(pos.x, pos.y + ty, pos.z);
    const { yaw, pitch, dist } = S.orbit;
    const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    camera.position.copy(target).addScaledVector(dir, dist);
    if (camera.position.y < 0.06) camera.position.y = 0.06;
    camera.lookAt(target);
    // 挡在镜头和人偶之间的家具暂时隐藏，涂装时总能看清自己
    restoreBlockers();
    const toCam = camera.position.clone().sub(target);
    ray.set(target, toCam.clone().normalize());
    ray.far = toCam.length();
    for (const h of ray.intersectObjects(world.meshes, false)) {
      if (h.object.visible) { h.object.visible = false; hiddenBlockers.push(h.object); }
    }
    return;
  }
  if (hiddenBlockers.length) restoreBlockers();
  camera.rotation.set(ctrl.pitch, ctrl.yaw, 0);
  const eye = (ctrl.crouch ? ctrl.CH : ctrl.H) * 0.86;
  if (role === 'ghost' || role === 'hunter' || !S.thirdPerson) {
    camera.position.set(pos.x, pos.y + eye, pos.z);
    return;
  }
  // 第三人称：带墙体遮挡检测
  const pivot = tmpV.set(pos.x, pos.y + eye - 0.05, pos.z);
  const back = new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion);
  let dist = 1.0 + 3 * getScale();
  ray.set(pivot, back);
  ray.far = dist;
  const hits = ray.intersectObjects(world.meshes, false);
  if (hits.length) dist = Math.max(0.2, hits[0].distance - 0.2);
  camera.position.copy(pivot).addScaledVector(back, dist);
}

const ROLE_INFO = {
  chameleon: ['🦎', '变色龙'],
  hunter: ['🔫', '猎人'],
  ghost: ['👻', '观战中'],
};
let lastBar = '';
function slot(key, icon, label, extra = '', cls = '', act = '') {
  return `<div class="slot ${cls}" data-act="${act}"><span class="ky">${key}</span>${extra}<span class="ic">${icon}</span><span class="lb">${label}</span></div>`;
}
function updateActionBar(role) {
  const now = performance.now();
  let html = '';
  if (S.mode === 'paint' || S.poseMenu) html = '';
  else if (role === 'chameleon') {
    const tauntCd = Math.max(0, S.tauntUntil - now) / 10000;
    const pose = POSES[S.pose] || POSES[0];
    html = slot('F', '🎨', '涂装', '', '', 'paint') +
      slot('R', pose.icon || '🧍', pose.name, '', '', 'pose') +
      slot('E', `<span class="sw" style="background:${/^#[0-9a-f]{6}$/i.test(S.color) ? S.color : '#fff'}"></span>`, '吸色', '', '', 'pick') +
      slot('C', '🧎', '蹲下', '', ctrl.crouch ? 'on' : '', 'crouch') +
      slot('G', '👥', S.cloneUsed ? '已用' : '分身', '', S.cloneUsed ? 'used' : '', 'clone') +
      slot('T', '📣', '嘲讽', tauntCd > 0 ? `<div class="cd" style="height:${Math.round(tauntCd * 100)}%"></div>` : '', '', 'taunt') +
      (IS_TOUCH && S.game.phase === 'lobby' ? slot('H', '🔫', '猎人', '', '', 'hunterToggle') : '');
  } else if (role === 'hunter') {
    const cd = Math.max(0, S.cooldownUntil - now) / 1300;
    html = (IS_TOUCH ? '' : slot('左键', '🔫', '射击', cd > 0 ? `<div class="cd" style="height:${Math.round(Math.min(1, cd) * 100)}%"></div>` : '', 'wide', 'shoot')) +
      slot('C', '🧎', '蹲下', '', ctrl.crouch ? 'on' : '', 'crouch') +
      (S.game.phase === 'lobby' ? slot('H', '🦎', '变回', '', '', 'hunterToggle') : '');
  } else if (role === 'ghost' && IS_TOUCH) {
    html = slot('C', '⤓', '下降', '', S.touchCrouch ? 'on' : '', 'crouch');
  }
  if (html !== lastBar) { $('actionBar').innerHTML = html; lastBar = html; }
}

function updateHUD() {
  const p = me();
  if (!p) return;
  const G = S.game;
  const role = effRole();
  const remain = G.endsAt - performance.now();
  const labels = { lobby: S.offline ? '🎨 练习场' : '🏠 大厅 · 自由活动', hide: '🙈 躲藏阶段', seek: '🔍 寻找阶段', end: '🏁 回合结束' };
  $('phaseLabel').textContent = labels[G.phase] || '';
  $('timer').textContent = G.phase === 'hide' || G.phase === 'seek' || G.phase === 'end' ? fmt(remain) : '';
  $('timer').classList.toggle('urgent', (G.phase === 'hide' || G.phase === 'seek') && remain < 10000);
  const total = G.phase === 'hide' ? G.settings.hide * 1000 : G.phase === 'seek' ? G.settings.seek * 1000 : 0;
  $('timeBar').classList.toggle('hidden', !total);
  if (total) $('timeFill').style.width = Math.max(0, Math.min(100, remain / total * 100)) + '%';
  const ps = [...S.players.values()];
  const cham = ps.filter(q => q.role === 'chameleon');
  $('aliveInfo').textContent = G.phase === 'lobby' ? `👥 ${ps.length} 人` : `🦎 ${cham.filter(q => q.alive).length}/${cham.length}`;

  let hot = false;
  if (G.phase === 'seek' && role === 'chameleon') {
    for (const q of ps) if (q.role === 'hunter' && q.char.root.position.distanceTo(ctrl.pos) < 8) hot = true;
  }
  $('hudScore').textContent = `⭐ ${p.score} 分` + (hot ? ' · 🔥 近距离加分' : '');
  $('hudScore').className = hot ? 'hot' : '';
  $('roleCard').className = role;
  $('roleIcon').textContent = ROLE_INFO[role][0];
  $('roleName').textContent = ROLE_INFO[role][1] + (G.phase === 'lobby' && role === 'hunter' ? '（练习）' : '');

  const ch = $('crosshair');
  ch.className = role === 'hunter' ? 'hunter' + (performance.now() < S.cooldownUntil ? ' cool' : '') : '';
  ch.hidden = S.mode === 'paint' || role === 'ghost';
  updateActionBar(role);

  let hint = '';
  if (S.mode !== 'paint') {
    if (role === 'ghost') hint = '👻 观战模式：WASD 飞行 · 空格上升 · C 下降';
    else if (G.phase === 'lobby') hint = IS_TOUCH ? '自由练习中 · 左边摇杆移动，右边滑动转视角 · ☰ 打开房间菜单' : (role === 'hunter' ? '练习射击：看看能不能找到朋友 · Esc 打开房间菜单' : '自由练习中 · 按 H 试试猎人视角 · Esc 打开房间菜单');
    else if (G.phase === 'hide' && role === 'chameleon') hint = '快找地方躲好，按 F 涂装伪装！';
    else if (G.phase === 'seek' && role === 'chameleon') hint = '别动！摆好姿势，猎人正在找你……';
    else if (G.phase === 'seek' && role === 'hunter') hint = '仔细观察，射击可疑的东西 · 打空会冷却';
  }
  $('hint').textContent = hint;
  $('hint').hidden = !hint;

  const blind = G.phase === 'hide' && role === 'hunter';
  $('blind').hidden = !blind;
  if (blind) $('blindTimer').textContent = Math.max(0, Math.ceil(remain / 1000));
  const sec = Math.ceil(remain / 1000);
  if ((G.phase === 'hide' || G.phase === 'seek') && sec <= 5 && sec > 0 && sec !== S.lastTick) { S.lastTick = sec; sfx('tick'); }
  updateOverlays();
}

// ================= 主菜单背景里的展示人偶 =================
const demo = [];
(function makeDemo() {
  const defs = [
    { pos: [-7.8, 0.5, -11.8], yaw: 0, pose: 2, fill: '#3b6ea5' },            // 坐在沙发上、涂成沙发蓝
    { pos: [-6.2, 0, -8.6], yaw: Math.PI * 0.85, pose: 5, fill: null },        // 白色原色，大字
    { pos: [-4.6, 0, -6.2], yaw: Math.PI * 1.2, pose: 4, fill: '#ff9f43' },   // 举手
    { pos: [-9.4, 0, -5.8], yaw: Math.PI * 0.2, pose: 1, stripes: true },      // 蹲着，涂成墙纸条纹色
  ];
  defs.forEach((d, i) => {
    const c = new Character('demo' + i, '');
    c.tag.visible = false;
    if (d.fill) c.applyOp([3, 0, 0, 0, 0, 0, d.fill, 0]);
    if (d.stripes) { c.applyOp([3, 0, 0, 0, 0, 0, '#bfe6d0', 0]); c.applyOp([1, 1, 0, 0, 0, 0, '#eaf6ee', 0]); }
    if (d.fill || d.stripes) c.drawFace();
    c.root.position.set(...d.pos);
    c.root.rotation.y = d.yaw;
    c.pose = d.pose;
    c.snapPose();
    scene.add(c.root);
    demo.push(c);
  });
})();
function clearDemo() { for (const c of demo) { scene.remove(c.root); c.dispose(); } demo.length = 0; }

frame();

// 调试用（控制台）
window.__game = { S, world, ctrl, camera, scene };
