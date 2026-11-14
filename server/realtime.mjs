// Realtime rooms on the game server's port, at /ws (issue #44). The message
// shapes are documented in src/net/protocol.ts; the numbers both sides share
// are in src/net/rules.json.
//
// Authority: each client simulates its own movement and its own Technique
// and Pacts, and decides whether its Abilities hit (what you see is what you
// hit). The server is the one place health changes. It checks each hit
// against sane bounds, asks the victim's client how much its own defences let
// through (Recoil's brace, Echo's quiet, the Horizon Eye: rules that live in
// the victim's Technique state), applies the result exactly once, and owns
// downs, respawns and the score. Movement is relayed at a fixed tick.
import { WebSocketServer } from 'ws';
import rules from '../src/net/rules.json' with { type: 'json' };

const TICK_MS = 1000 / rules.tickHz;
const AWAY_MS = 1500;
const HITS_PER_SECOND = 40;

const cleanRoom = (s) => (String(s ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24) || rules.defaultRoom);
const cleanName = (s) => (String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 20) || 'Student');
const num = (x, lo, hi) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : lo);
const vec = (v) => (Array.isArray(v) && v.length === 3 && v.every(Number.isFinite) ? v : null);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export function attachRealtime(httpServer, { latency = 0, log = console.log } = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  const rooms = new Map();
  let nextId = 1;
  let nextHit = 1;

  httpServer.on('upgrade', (req, socket, head) => {
    if (new URL(req.url ?? '/', 'http://x').pathname !== '/ws') { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  // Added latency for testing: every message in each direction waits the
  // same time, so order is kept.
  const later = (fn) => (latency > 0 ? setTimeout(fn, latency) : fn());
  const send = (ws, msg) => {
    if (!ws) return;
    const s = JSON.stringify(msg);
    later(() => { if (ws.readyState === 1) ws.send(s); });
  };
  const info = (p) => ({ id: p.id, name: p.name, tech: p.tech, slot: p.slot, hp: p.hp, down: p.down, kills: p.kills, downs: p.downs });
  const present = (room) => [...room.players.values()].filter((p) => p.ws);
  const broadcast = (room, msg, except = null) => { for (const p of present(room)) if (p !== except) send(p.ws, msg); };

  function roomFor(code) {
    let room = rooms.get(code);
    if (!room) {
      room = { code, players: new Map(), pending: new Map(), timer: null };
      room.timer = setInterval(() => tick(room), TICK_MS);
      rooms.set(code, room);
    }
    return room;
  }

  function freeSlot(room) {
    const used = new Set([...room.players.values()].map((p) => p.slot));
    for (let i = 0; i < rules.maxPlayers; i++) if (!used.has(i)) return i;
    return -1;
  }

  // The spawn farthest from everyone standing.
  function spawnPoint(room, self) {
    const others = present(room).filter((p) => p !== self && !p.down && p.state);
    let best = rules.spawns[0], bestD = -1;
    for (const s of rules.spawns) {
      const d = others.length ? Math.min(...others.map((o) => dist(o.state.p, s))) : Math.random();
      if (d > bestD) { bestD = d; best = s; }
    }
    return best;
  }

  // Every answered hit is announced, a blocked one as 0, so the attacker's
  // screen can settle what it predicted.
  function damage(room, target, amount, by) {
    if (target.down) return;
    target.hp = Math.max(0, target.hp - amount);
    broadcast(room, { type: 'hp', id: target.id, hp: Math.round(target.hp * 10) / 10, by: by?.id ?? null, amount: Math.round(amount * 10) / 10 });
    if (target.hp > 0) return;
    target.down = true;
    target.downs++;
    target.respawnAt = Date.now() + rules.respawnSeconds * 1000;
    if (by && by !== target) by.kills++;
    for (const [id, h] of room.pending) if (h.target === target.id) room.pending.delete(id);
    broadcast(room, { type: 'down', id: target.id, by: by && by !== target ? by.id : null });
    broadcast(room, { type: 'info', player: info(target) });
    if (by && by !== target) broadcast(room, { type: 'info', player: info(by) });
  }

  function respawn(room, p) {
    p.down = false;
    p.hp = rules.maxHp;
    p.protectUntil = Date.now() + rules.spawnProtectSeconds * 1000;
    const at = spawnPoint(room, p);
    if (p.state) p.state = { ...p.state, p: at, v: [0, 0, 0] };
    broadcast(room, { type: 'respawn', id: p.id, p: at, hp: p.hp });
  }

  function tick(room) {
    const now = Date.now();
    for (const [id, h] of room.pending) {
      // The victim never answered: its tab is gone or stalled. The hit still
      // lands, at the attacker's amount, so damage is never lost.
      if (now - h.at < rules.hitTimeoutMs) continue;
      room.pending.delete(id);
      const target = room.players.get(h.target);
      if (target) damage(room, target, h.amount, room.players.get(h.by) ?? null);
    }
    for (const p of room.players.values()) {
      if (p.down && now >= p.respawnAt && p.ws) respawn(room, p);
      if (!p.ws && now - p.leftAt > rules.reconnectGraceSeconds * 1000) room.players.delete(p.id);
    }
    if (room.players.size === 0) { clearInterval(room.timer); rooms.delete(room.code); return; }
    const live = present(room);
    if (!live.length) return;
    const snap = { type: 'snap', t: now, players: live.map((p) => ({ id: p.id, hp: p.hp, down: p.down, away: now - p.stateAt > AWAY_MS, st: p.fresh.splice(0) })) };
    for (const p of live) send(p.ws, snap);
  }

  function join(ws, m) {
    const code = cleanRoom(m.room);
    const room = roomFor(code);
    const token = String(m.token ?? '').slice(0, 64);
    let p = token ? [...room.players.values()].find((x) => x.token === token) : null;
    if (p?.ws && p.ws !== ws) { const old = p.ws; p.ws = null; try { old.close(4000, 'replaced'); } catch { /* gone */ } }
    if (!p) {
      // A seat held for someone who dropped goes to a newcomer when the room has no other.
      if (freeSlot(room) < 0) {
        const absent = [...room.players.values()].filter((x) => !x.ws).sort((x, y) => x.leftAt - y.leftAt)[0];
        if (absent) room.players.delete(absent.id);
      }
      if (present(room).length >= rules.maxPlayers || freeSlot(room) < 0) { send(ws, { type: 'full', room: code, max: rules.maxPlayers }); return null; }
      p = { id: nextId++, token, slot: freeSlot(room), hp: rules.maxHp, down: false, kills: 0, downs: 0, state: null, fresh: [], stateAt: 0, protectUntil: 0, respawnAt: 0, leftAt: 0, bucket: HITS_PER_SECOND, bucketAt: Date.now(), seen: new Set() };
      room.players.set(p.id, p);
    }
    p.ws = ws;
    p.name = cleanName(m.name);
    p.tech = String(m.tech ?? 'recoil').slice(0, 16);
    p.stateAt = Date.now();
    const spawn = p.state && !p.down ? p.state.p : spawnPoint(room, p);
    if (!p.state) { p.protectUntil = Date.now() + rules.spawnProtectSeconds * 1000; p.state = { ct: 0, p: spawn, v: [0, 0, 0], yaw: 0, pitch: 0, g: true, sign: 0, cine: false }; }
    send(ws, { type: 'welcome', id: p.id, room: code, you: info(p), players: present(room).filter((o) => o !== p).map(info), spawn, t: Date.now() });
    broadcast(room, { type: 'join', player: info(p) }, p);
    log(`[rt] ${p.name} (#${p.id}) joined ${code}: ${present(room).length}/${rules.maxPlayers}`);
    return { room, p };
  }

  // A dropped socket keeps the seat and score for a while, so a reload or a
  // reconnect takes them back; a player who chose to leave gives them up.
  function leave(at, chose = false) {
    const { room, p } = at;
    if (!p.ws) return;
    p.ws = null;
    p.leftAt = Date.now();
    if (chose) room.players.delete(p.id);
    for (const [id, h] of room.pending) if (h.by === p.id) room.pending.delete(id);
    broadcast(room, { type: 'leave', id: p.id });
    log(`[rt] ${p.name} (#${p.id}) left ${room.code}`);
  }

  function handle(ws, at, m) {
    if (!at) return;
    const { room, p } = at;
    const now = Date.now();
    switch (m.type) {
      case 'state': {
        const s = m.s, pos = vec(s?.p), v = vec(s?.v);
        if (!pos || !v || !Number.isFinite(s.ct)) return;
        const st = { ct: s.ct, p: p.down ? (p.state?.p ?? pos) : pos, v, yaw: num(s.yaw, -1e3, 1e3), pitch: num(s.pitch, -2, 2), g: !!s.g, sign: s.sign === 1 || s.sign === 2 ? s.sign : 0, cine: !!s.cine };
        p.state = st;
        p.stateAt = now;
        if (p.fresh.length < 6) p.fresh.push(st);
        return;
      }
      case 'tech':
        p.tech = String(m.tech ?? '').slice(0, 16);
        broadcast(room, { type: 'info', player: info(p) });
        return;
      case 'cast':
        if (p.down) return;
        broadcast(room, { type: 'cast', id: p.id, ct: Number(m.ct) || 0, kind: String(m.kind).slice(0, 16), tech: String(m.tech).slice(0, 16), name: String(m.name ?? '').slice(0, 40), dir: vec(m.dir) ?? [0, 0, -1] }, p);
        return;
      case 'fx':
        if (Array.isArray(m.calls) && m.calls.length <= 64) broadcast(room, { type: 'fx', id: p.id, ct: Number(m.ct) || 0, calls: m.calls }, p);
        return;
      case 'hit': {
        // Bounds, not a replay of the attacker's simulation: a hit is taken
        // on trust when both are standing, the victim is not protected, the
        // two are within any Ability's reach, the amount is sane, and the
        // attacker is not sending faster than any Technique casts. `seq`
        // makes a resent hit count once.
        const target = room.players.get(m.target);
        const key = Number(m.seq);
        if (!target?.ws || target === p || p.down || target.down || !Number.isFinite(key) || p.seen.has(key)) return;
        p.seen.add(key);
        if (p.seen.size > 512) p.seen.delete(p.seen.values().next().value);
        if (now < target.protectUntil) return;
        if (p.state && target.state && dist(p.state.p, target.state.p) > rules.maxHitRange) return;
        p.bucket = Math.min(HITS_PER_SECOND, p.bucket + ((now - p.bucketAt) / 1000) * HITS_PER_SECOND);
        p.bucketAt = now;
        if (p.bucket < 1) return;
        p.bucket--;
        const amount = num(m.amount, 0, rules.maxHitDamage);
        if (amount <= 0) return;
        const id = nextHit++;
        room.pending.set(id, { by: p.id, target: target.id, amount, at: now });
        send(target.ws, { type: 'struck', hit: id, by: p.id, amount, from: vec(m.from) ?? p.state?.p ?? [0, 0, 0], knock: num(m.knock, 0, 30), lift: num(m.lift, 0, 15) });
        return;
      }
      case 'resolve': {
        const h = room.pending.get(Number(m.hit));
        if (!h || h.target !== p.id) return;
        room.pending.delete(Number(m.hit));
        damage(room, p, num(m.taken, 0, h.amount), room.players.get(h.by) ?? null);
        return;
      }
      case 'self':
        if (num(m.amount, 0, rules.maxHp) > 0) damage(room, p, num(m.amount, 0, rules.maxHp), p);
        return;
      case 'status': {
        const target = room.players.get(m.target);
        if (!target?.ws || target.down || p.down || now < target.protectUntil) return;
        send(target.ws, { type: 'status', by: p.id, frozen: num(m.frozen, 0, 6), slow: num(m.slow, 0.1, 1) });
        return;
      }
      case 'ping':
        send(ws, { type: 'pong', t: m.t, s: now });
        return;
      case 'bye':
        leave(at, true);
        ws.close(1000, 'bye');
        return;
    }
  }

  wss.on('connection', (ws) => {
    let at = null;
    ws.alive = true;
    ws.on('pong', () => { ws.alive = true; });
    ws.on('message', (data) => later(() => {
      let m;
      try { m = JSON.parse(String(data)); } catch { return; }
      if (!m || typeof m.type !== 'string') return;
      if (m.type === 'hello') { if (!at) at = join(ws, m); return; }
      if (at && at.p.ws === ws) handle(ws, at, m);
    }));
    ws.on('close', () => later(() => { if (at && at.p.ws === ws) leave(at); }));
    ws.on('error', () => undefined);
  });

  // Protocol-level pings find sockets whose tab or network died without a
  // close. A background tab still answers them.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) { ws.terminate(); continue; }
      ws.alive = false;
      ws.ping();
    }
  }, 10000);

  return {
    rooms,
    close() { clearInterval(heartbeat); for (const r of rooms.values()) clearInterval(r.timer); for (const ws of wss.clients) ws.terminate(); wss.close(); },
  };
}
