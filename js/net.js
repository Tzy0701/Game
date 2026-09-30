// 网络层：默认使用 PeerJS（WebRTC 点对点，无需自建服务器）
// 加 ?net=local 可在同一浏览器的多个标签页之间用 BroadcastChannel 测试
/* global Peer */

const PREFIX = 'chameleon-party-2026-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function genRoomCode() {
  let s = '';
  for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

export const netMode = new URLSearchParams(location.search).get('net') === 'local' ? 'local' : 'peer';

function peerOptions() {
  const o = { debug: 1 };
  // 可选：自建 PeerServer，例如 ?peerhost=my.server.com&peerport=443
  const q = new URLSearchParams(location.search);
  if (q.get('peerhost')) {
    o.host = q.get('peerhost');
    o.port = Number(q.get('peerport') || 443);
    o.path = q.get('peerpath') || '/';
    o.secure = o.port === 443;
  }
  return o;
}

function errText(e) {
  const map = {
    'peer-unavailable': '找不到这个房间，请检查房间码（房主需保持页面打开）',
    'unavailable-id': '房间码已被占用',
    'network': '无法连接到联机服务器，请检查网络',
    'server-error': '联机服务器出错，请稍后再试',
    'browser-incompatible': '浏览器不支持 WebRTC，请使用新版 Chrome / Edge / Firefox',
    'socket-error': '联机服务器连接失败',
  };
  return map[e && e.type] || (e && e.message) || '连接失败';
}

// ---------- 房主 ----------
export function hostRoom(code) {
  if (netMode === 'local') return hostLocal(code);
  if (typeof Peer === 'undefined') return Promise.reject(new Error('PeerJS 加载失败'));
  return new Promise((resolve, reject) => {
    const peer = new Peer(PREFIX + code, peerOptions());
    const conns = new Map();
    let opened = false;
    const t = {
      code,
      onConnect() {}, onData() {}, onClose() {}, onError() {},
      send(id, msg) { const c = conns.get(id); if (c && c.open) { try { c.send(msg); } catch (e) { /* ignore */ } } },
      close() { try { peer.destroy(); } catch (e) { /* ignore */ } },
    };
    peer.on('open', () => { opened = true; resolve(t); });
    peer.on('error', e => {
      if (!opened) { peer.destroy(); const err = new Error(errText(e)); err.type = e.type; reject(err); }
      else t.onError(e);
    });
    peer.on('disconnected', () => { if (!peer.destroyed) setTimeout(() => { try { peer.reconnect(); } catch (e) { /* ignore */ } }, 1000); });
    peer.on('connection', conn => {
      conn.on('open', () => { conns.set(conn.peer, conn); t.onConnect(conn.peer); });
      conn.on('data', d => t.onData(conn.peer, d));
      conn.on('close', () => { if (conns.delete(conn.peer)) t.onClose(conn.peer); });
      conn.on('error', () => { if (conns.delete(conn.peer)) t.onClose(conn.peer); });
    });
  });
}

// ---------- 加入者 ----------
export function joinRoom(code) {
  if (netMode === 'local') return joinLocal(code);
  if (typeof Peer === 'undefined') return Promise.reject(new Error('PeerJS 加载失败'));
  return new Promise((resolve, reject) => {
    const peer = new Peer(peerOptions());
    let done = false;
    const t = {
      onData() {}, onClose() {},
      send() {},
      close() { try { peer.destroy(); } catch (e) { /* ignore */ } },
    };
    const fail = err => { if (done) return; done = true; clearTimeout(timer); peer.destroy(); reject(err); };
    const timer = setTimeout(() => fail(new Error('连接超时：找不到房间或网络受限')), 20000);
    peer.on('error', e => { if (!done) fail(new Error(errText(e))); });
    peer.on('open', () => {
      const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
      t.send = m => { if (conn.open) { try { conn.send(m); } catch (e) { /* ignore */ } } };
      conn.on('open', () => { if (done) return; done = true; clearTimeout(timer); resolve(t); });
      conn.on('data', d => t.onData(d));
      conn.on('close', () => t.onClose());
      conn.on('error', () => t.onClose());
    });
  });
}

// ---------- 单人离线 ----------
export function offlineRoom() {
  return Promise.resolve({ code: 'SOLO', onConnect() {}, onData() {}, onClose() {}, onError() {}, send() {}, close() {} });
}

// ---------- 本地多标签测试 ----------
function hostLocal(code) {
  const ch = new BroadcastChannel('cp-' + code);
  const known = new Set();
  const t = {
    code,
    onConnect() {}, onData() {}, onClose() {}, onError() {},
    send(id, msg) { ch.postMessage({ to: id, d: msg }); },
    close() { ch.postMessage({ to: '*', bye: true }); ch.close(); },
  };
  ch.onmessage = e => {
    const m = e.data;
    if (!m.from) return;
    if (m.bye) { if (known.delete(m.from)) t.onClose(m.from); return; }
    if (!known.has(m.from)) { known.add(m.from); t.onConnect(m.from); }
    if (m.d) t.onData(m.from, m.d);
  };
  addEventListener('beforeunload', () => t.close());
  return Promise.resolve(t);
}

function joinLocal(code) {
  const ch = new BroadcastChannel('cp-' + code);
  const me = Math.random().toString(36).slice(2);
  const t = {
    onData() {}, onClose() {},
    send(msg) { ch.postMessage({ from: me, d: msg }); },
    close() { ch.postMessage({ from: me, bye: true }); ch.close(); },
  };
  ch.onmessage = e => {
    const m = e.data;
    if (m.from) return;
    if (m.bye && m.to === '*') { t.onClose(); return; }
    if (m.to === me || m.to === '*') t.onData(m.d);
  };
  addEventListener('beforeunload', () => t.close());
  ch.postMessage({ from: me });
  return Promise.resolve(t);
}
