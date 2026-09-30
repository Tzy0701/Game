// 房主端的权威游戏逻辑：管理玩家、回合、计时、判定抓捕与得分
import { MAPS } from './world.js';

const LOCAL = 'L';
const clampNum = (v, a, b, d) => { v = Number(v); return Number.isFinite(v) ? Math.max(a, Math.min(b, v)) : d; };

export class Server {
  constructor(transport, deliverLocal) {
    this.t = transport;
    this.deliverLocal = deliverLocal;
    this.conns = new Map();      // connId -> playerId
    this.players = new Map();    // playerId -> player
    this.nextId = 1;
    this.paintProvider = null;   // (pid) => dataURL[]
    this.game = {
      phase: 'lobby', endsAt: 0, round: 0, map: 'house', seekStart: 0, result: null,
      settings: { map: 'house', hide: 45, seek: 180, hunters: 1, size: 40 },
    };
    transport.onConnect = () => {};
    transport.onData = (cid, m) => this.handle(cid, m);
    transport.onClose = cid => this.drop(cid);
    this.timer = setInterval(() => this.tick(), 66);
  }

  close() {
    clearInterval(this.timer);
    this.broadcast({ t: 'closed' }, LOCAL);
    setTimeout(() => this.t.close(), 200);
  }

  // ---------- 发送 ----------
  sendConn(cid, msg) {
    if (cid === LOCAL) queueMicrotask(() => this.deliverLocal(msg));
    else this.t.send(cid, msg);
  }
  sendTo(pid, msg) { const p = this.players.get(pid); if (p) this.sendConn(p.cid, msg); }
  broadcast(msg, exceptPid) {
    for (const p of this.players.values()) if (p.id !== exceptPid) this.sendConn(p.cid, msg);
  }

  publicPlayer(p) {
    return { id: p.id, name: p.name, role: p.role, alive: p.alive, score: p.score, host: p.cid === LOCAL, st: p.st };
  }

  gameMsg(extra = {}) {
    const g = this.game;
    return {
      t: 'game', phase: g.phase, remain: g.endsAt ? Math.max(0, g.endsAt - Date.now()) : 0,
      map: g.map, round: g.round, settings: g.settings, result: g.result,
      players: [...this.players.values()].map(p => ({ id: p.id, role: p.role, alive: p.alive, score: p.score })),
      ...extra,
    };
  }

  // ---------- 接收 ----------
  handle(cid, m) {
    if (!m || typeof m !== 'object') return;
    const pid = this.conns.get(cid);
    const p = pid && this.players.get(pid);
    if (p) p.lastSeen = Date.now();

    if (m.t === 'hello') {
      if (p) return;
      if (this.players.size >= 24) { this.sendConn(cid, { t: 'full' }); return; }
      const id = 'p' + (this.nextId++);
      const name = String(m.name || '玩家').slice(0, 12) || '玩家';
      const inRound = this.game.phase === 'hide' || this.game.phase === 'seek';
      const np = {
        id, cid, name, score: 0, huntedCount: 0,
        role: inRound ? 'spectator' : 'chameleon', alive: !inRound,
        st: null, lastSeen: Date.now(),
      };
      this.conns.set(cid, id);
      this.players.set(id, np);
      this.sendConn(cid, {
        t: 'welcome', id,
        players: [...this.players.values()].map(q => this.publicPlayer(q)),
        game: this.gameMsg(),
      });
      // 每个玩家的涂装单独发送，避免单条消息过大
      if (this.paintProvider) {
        for (const q of this.players.values()) {
          if (q.id === id) continue;
          const urls = this.paintProvider(q.id);
          if (urls) this.sendConn(cid, { t: 'psnap', id: q.id, urls });
        }
      }
      this.broadcast({ t: 'join', p: this.publicPlayer(np) }, id);
      return;
    }
    if (!p) return;

    switch (m.t) {
      case 'st':
        if (Array.isArray(m.s) && m.s.length >= 6) p.st = m.s.slice(0, 7).map(Number);
        break;
      case 'paint':
        if (Array.isArray(m.ops) && m.ops.length < 400) this.broadcast({ t: 'paint', id: p.id, ops: m.ops }, p.id);
        break;
      case 'skin':
        // 撤销后整套涂装同步给其他人
        if (Array.isArray(m.urls) && m.urls.length <= 8 && m.urls.every(u => typeof u === 'string' && u.startsWith('data:image/') && u.length < 200000)) {
          this.broadcast({ t: 'psnap', id: p.id, urls: m.urls }, p.id);
        }
        break;
      case 'shot':
        this.broadcast({ t: 'shot', id: p.id, a: m.a, b: m.b, hit: !!m.hit }, p.id);
        break;
      case 'tag':
        this.tag(p, m.target);
        break;
      case 'clone': {
        const inRound = this.game.phase === 'hide' || this.game.phase === 'seek';
        if (p.role !== 'chameleon' || !p.alive || this.game.phase === 'end') return;
        if (inRound && p.clones >= 1) { this.sendConn(cid, { t: 'toast', text: '本回合的分身已经用掉了' }); return; }
        if (!Array.isArray(m.pos) || m.pos.length !== 3) return;
        if (inRound) p.clones = (p.clones || 0) + 1;
        this.broadcast({ t: 'clone', id: p.id, pos: m.pos.map(Number), yaw: +m.yaw || 0, pose: m.pose | 0 });
        break;
      }
      case 'taunt': {
        const now = Date.now();
        if (p.role !== 'chameleon' || !p.alive || now - (p.lastTaunt || 0) < 10000) return;
        p.lastTaunt = now;
        if (this.game.phase === 'seek') p.score += 10;
        this.broadcast({ t: 'taunt', id: p.id, pos: m.pos, score: p.score });
        break;
      }
      case 'chat': {
        const text = String(m.text || '').slice(0, 120).trim();
        if (text) this.broadcast({ t: 'chat', id: p.id, name: p.name, text });
        break;
      }
      case 'settings':
        if (cid !== LOCAL || this.game.phase !== 'lobby') return;
        this.applySettings(m.settings || {});
        break;
      case 'start':
        if (cid !== LOCAL) return;
        this.startRound();
        break;
      case 'endRound':
        if (cid !== LOCAL) return;
        if (this.game.phase === 'hide' || this.game.phase === 'seek') this.endRound('cancel');
        break;
      case 'ping':
        this.sendConn(cid, { t: 'pong', c: m.c });
        break;
    }
  }

  applySettings(s) {
    const g = this.game.settings;
    if (s.map && MAPS[s.map]) g.map = s.map;
    g.hide = clampNum(s.hide ?? g.hide, 10, 180, 45);
    g.seek = clampNum(s.seek ?? g.seek, 30, 900, 180);
    g.hunters = clampNum(s.hunters ?? g.hunters, 1, 6, 1);
    g.size = clampNum(s.size ?? g.size, 30, 50, 40);
    const mapChanged = this.game.map !== g.map;
    this.game.map = g.map;
    this.broadcast(this.gameMsg({ mapChanged }));
  }

  drop(cid) {
    const pid = this.conns.get(cid);
    if (!pid) return;
    this.conns.delete(cid);
    const p = this.players.get(pid);
    this.players.delete(pid);
    if (p) this.broadcast({ t: 'leave', id: pid, name: p.name });
    this.checkRoundState();
  }

  // ---------- 回合 ----------
  startRound() {
    const g = this.game;
    if (g.phase !== 'lobby') return;
    const ps = [...this.players.values()];
    if (ps.length < 2) { this.sendTo(ps[0] && ps[0].id, { t: 'toast', text: '至少需要 2 名玩家才能开始（单人可在大厅自由练习）' }); return; }
    const nh = Math.max(1, Math.min(g.settings.hunters, ps.length - 1));
    // 当猎人次数最少的优先，同次数随机
    const order = ps.map(p => ({ p, k: p.huntedCount + Math.random() * 0.9 })).sort((a, b) => a.k - b.k).map(o => o.p);
    const spawns = {};
    g.map = g.settings.map;
    order.forEach((p, i) => {
      p.role = i < nh ? 'hunter' : 'chameleon';
      p.alive = true;
      p.clones = 0;
      if (p.role === 'hunter') p.huntedCount++;
      spawns[p.id] = i < nh ? 'hunter' : 'random';
    });
    g.round++;
    g.phase = 'hide';
    g.endsAt = Date.now() + g.settings.hide * 1000;
    g.result = null;
    this.broadcast(this.gameMsg({ spawns, reset: true }));
  }

  tick() {
    const g = this.game;
    const now = Date.now();
    // 快照
    const s = {};
    for (const p of this.players.values()) if (p.st) s[p.id] = p.st;
    this.broadcast({ t: 'snap', s });
    // 超时掉线
    for (const p of [...this.players.values()]) {
      if (p.cid !== LOCAL && now - p.lastSeen > 20000) { this.t.send(p.cid, { t: 'closed' }); this.drop(p.cid); }
    }
    if (g.phase === 'seek' && now - (g.lastScoreTick || 0) >= 1000) {
      g.lastScoreTick = now;
      this.proximityScore();
    }
    if (g.phase === 'hide' && now >= g.endsAt) {
      g.phase = 'seek';
      g.seekStart = now;
      g.endsAt = now + g.settings.seek * 1000;
      this.broadcast(this.gameMsg());
    } else if (g.phase === 'seek' && now >= g.endsAt) {
      this.endRound('chameleons');
    } else if (g.phase === 'end' && now >= g.endsAt) {
      g.phase = 'lobby';
      g.endsAt = 0;
      for (const p of this.players.values()) { p.role = 'chameleon'; p.alive = true; }
      this.broadcast(this.gameMsg({ reset: true }));
    }
  }

  // 寻找阶段每秒加分：离猎人越近加得越多（致敬原作的“近距离高风险高回报”）
  proximityScore() {
    const ps = [...this.players.values()];
    const hunters = ps.filter(p => p.role === 'hunter' && p.st);
    const scores = {};
    for (const p of ps) {
      if (p.role !== 'chameleon' || !p.alive) continue;
      let near = Infinity;
      if (p.st) for (const h of hunters) near = Math.min(near, Math.hypot(h.st[0] - p.st[0], h.st[1] - p.st[1], h.st[2] - p.st[2]));
      p.score += 1 + (near < 4 ? 4 : near < 8 ? 2 : near < 14 ? 1 : 0);
      scores[p.id] = p.score;
    }
    this.broadcast({ t: 'scores', s: scores });
  }

  tag(hunter, targetId) {
    const g = this.game;
    if (g.phase !== 'seek' || hunter.role !== 'hunter') return;
    const t = this.players.get(targetId);
    if (!t || t.role !== 'chameleon' || !t.alive) return;
    if (hunter.st && t.st) {
      const d = Math.hypot(hunter.st[0] - t.st[0], hunter.st[1] - t.st[1], hunter.st[2] - t.st[2]);
      if (d > 60) return;
    }
    t.alive = false;
    hunter.score += 100;
    this.broadcast({ t: 'found', id: t.id, by: hunter.id, scores: { [t.id]: t.score, [hunter.id]: hunter.score } });
    this.checkRoundState();
  }

  checkRoundState() {
    const g = this.game;
    if (g.phase !== 'hide' && g.phase !== 'seek') return;
    const ps = [...this.players.values()];
    const hunters = ps.filter(p => p.role === 'hunter');
    const alive = ps.filter(p => p.role === 'chameleon' && p.alive);
    if (!alive.length) this.endRound('hunters');
    else if (!hunters.length) this.endRound('chameleons');
  }

  endRound(winner) {
    const g = this.game;
    const now = Date.now();
    const survivors = [];
    for (const p of this.players.values()) {
      if (p.role === 'chameleon' && p.alive) {
        if (winner === 'chameleons') p.score += 100;
        survivors.push(p.id);
      }
    }
    g.phase = 'end';
    g.endsAt = now + 9000;
    g.result = { winner, survivors };
    this.broadcast(this.gameMsg());
  }
}
