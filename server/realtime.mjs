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
//
// Physics props (issue #58): each moving prop is simulated by one client, its
// owner, and the others follow the poses it streams. The server decides who
// owns what (the last claim it hears wins, and a client that leaves or goes
// quiet lets go of everything it held), relays only the owner's poses, keeps
// each prop's health so a prop breaks once for the whole room, and remembers
// where props came to rest for whoever joins later.
import { WebSocketServer } from 'ws';
import rules from '../src/net/rules.json' with { type: 'json' };
import { ClashReferee, fieldsContest, isPick } from '../src/net/clash.js';

const TICK_MS = 1000 / rules.tickHz;
// The gesture a cast plays: the full sign, the shortened one, or the flick.
const VARIANTS = ['long', 'short', 'none'];
const AWAY_MS = 1500;
const HITS_PER_SECOND = 40;
// The server is public on a home machine: bound what one script can cost it.
// A client sends about 20 states and a few casts and effects a second.
const MESSAGES_PER_SECOND = 120;
const MAX_CONNECTIONS = 128;
const MAX_ROOMS = 32;
// Props: the compound has a few dozen. Bounds on what a room tracks and on
// what one client may send.
const MAX_PROPS = 512;
const MAX_PROP_ID = 4095;
const PROP_ENTRIES = 64;
const PROP_HITS_PER_SECOND = 40;
const ICE_EVERY_MS = 500;
const PROP_REST = 1, PROP_SEALED = 2, PROP_CLAIM = 4;
// The kits' own world (src/net/kitsync.ts): heat in props and bodies, and
// Tension's standing lines. Each is a snapshot a client sends a few times a
// second at most; anything faster is dropped.
const HEAT_EVERY_MS = 100;
const HEAT_PROPS = 64;
const HEAT_BODIES = 8;
const LINES_EVERY_MS = 100;
const MAX_LINES = 32;
const STATE_FLAGS = 1 | 2;
const LINE_FLAGS = 1;

const cleanRoom = (s) => (String(s ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24) || rules.defaultRoom);
const cleanName = (s) => (String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 20) || 'Student');
const num = (x, lo, hi) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : lo);
const vec = (v) => (Array.isArray(v) && v.length === 3 && v.every(Number.isFinite) ? v : null);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const propId = (x) => (Number.isInteger(x) && x >= 0 && x <= MAX_PROP_ID ? x : null);
const playerId = (x) => (Number.isInteger(x) && x > 0 ? x : null);
const r2 = (x) => Math.round(x * 100) / 100;
// One end of a Tension line as src/net/protocol.ts describes it, bounded, or null.
function anchorWire(a) {
  if (!Array.isArray(a)) return null;
  if (a[0] === 0 && a.length === 5 && a.slice(1, 4).every(Number.isFinite)) return [0, num(a[1], -5000, 5000), num(a[2], -500, 500), num(a[3], -5000, 5000), a[4] === 1 ? 1 : 0];
  if (a[0] === 1 && a.length === 5 && propId(a[1]) !== null && a.slice(2).every(Number.isFinite)) return [1, a[1], num(a[2], -10, 10), num(a[3], -10, 10), num(a[4], -10, 10)];
  if (a[0] === 2 && a.length === 2 && playerId(a[1]) !== null) return [2, a[1]];
  if (a[0] === 3 && a.length === 1) return [3];
  return null;
}
function lineWire(l) {
  if (!Array.isArray(l) || l.length !== 5) return null;
  const a = anchorWire(l[0]), b = anchorWire(l[1]);
  if (!a || !b || !Number.isInteger(l[2])) return null;
  return [a, b, l[2] & LINE_FLAGS, num(l[3], 0, 1), num(l[4], 0, 1)];
}
// One prop pose as src/net/protocol.ts describes it, bounded, or null.
function propWire(e) {
  if (!Array.isArray(e) || e.length !== 13 || !e.every(Number.isFinite) || propId(e[0]) === null) return null;
  return [e[0], num(e[1], -500, 500), num(e[2], -500, 500), num(e[3], -500, 500), num(e[4], -1, 1), num(e[5], -1, 1), num(e[6], -1, 1), num(e[7], -1, 1), num(e[8], -60, 60), num(e[9], -60, 60), num(e[10], -60, 60), e[11] & (PROP_REST | PROP_SEALED | PROP_CLAIM), num(e[12], 0, 30)];
}

export function attachRealtime(httpServer, { latency = 0, log = console.log } = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  const rooms = new Map();
  let nextId = 1;
  let nextHit = 1;
  let nextClash = 1;
  let nextMax = 1;

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
      if (rooms.size >= MAX_ROOMS) return null;
      room = { code, players: new Map(), pending: new Map(), clashes: new Map(), timer: null, propOwner: new Map(), propRest: new Map(), propHp: new Map(), broken: new Set(), propSealed: new Set() };
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

  // The spawn farthest from everyone standing, in the region the player went
  // down in: out on the pass a player gets up on the pass, not back in the
  // compound (rules.regions; the compound's are rules.spawns).
  function spawnPoint(room, self) {
    const others = present(room).filter((p) => p !== self && !p.down && p.state);
    const at = self?.state?.p;
    const region = at ? (rules.regions ?? []).find(({ bounds: [x0, z0, x1, z1] }) => at[0] >= x0 && at[0] <= x1 && at[2] >= z0 && at[2] <= z1) : null;
    const spawns = region ? region.spawns : rules.spawns;
    let best = spawns[0], bestD = -1;
    for (const s of spawns) {
      const d = others.length ? Math.min(...others.map((o) => dist(o.state.p, s))) : Math.random();
      if (d > bestD) { bestD = d; best = s; }
    }
    return best;
  }

  // Every answered hit is announced, a blocked one as 0, so the attacker's
  // screen can settle what it predicted.
  function damage(room, target, amount, by) {
    if (target.down) return;
    // Both sides of a blow are fighting, so neither regenerates for a while.
    const now = Date.now();
    target.foughtAt = now;
    if (by) by.foughtAt = now;
    target.hp = Math.max(0, target.hp - amount);
    broadcast(room, { type: 'hp', id: target.id, hp: Math.round(target.hp * 10) / 10, by: by?.id ?? null, amount: Math.round(amount * 10) / 10 });
    if (target.hp > 0) return;
    target.down = true;
    target.downs++;
    target.respawnAt = Date.now() + rules.respawnSeconds * 1000;
    if (by && by !== target) by.kills++;
    for (const [id, h] of room.pending) if (h.target === target.id) room.pending.delete(id);
    endMax(room, target);
    const c = target.clash !== null ? room.clashes.get(target.clash) : null;
    if (c) for (const ev of c.ref.forfeit(c.a === target.id ? 0 : 1)) clashStep(room, c, ev);
    broadcast(room, { type: 'down', id: target.id, by: by && by !== target ? by.id : null });
    broadcast(room, { type: 'info', player: info(target) });
    if (by && by !== target) broadcast(room, { type: 'info', player: info(by) });
  }

  // Out-of-combat regen, the same rule the game runs offline: after
  // rules.regen.quietSeconds with no blow dealt or taken, health climbs at up
  // to perSecond, reached over rampSeconds. Not while down, in a clash or in
  // a Maximum Output. The snapshot carries the new value to everyone.
  function regen(p, now, dt) {
    if (p.down || p.hp >= rules.maxHp) return;
    if (p.clash !== null || p.max) { p.foughtAt = now; return; }
    const R = rules.regen;
    const quiet = (now - (p.foughtAt ?? 0)) / 1000;
    const rate = R.perSecond * Math.min(1, Math.max(0, (quiet - R.quietSeconds) / R.rampSeconds));
    if (rate > 0) p.hp = Math.min(rules.maxHp, p.hp + rate * dt);
  }

  function respawn(room, p) {
    p.down = false;
    p.hp = rules.maxHp;
    p.protectUntil = Date.now() + rules.spawnProtectSeconds * 1000;
    const at = spawnPoint(room, p);
    if (p.state) p.state = { ...p.state, p: at, v: [0, 0, 0] };
    broadcast(room, { type: 'respawn', id: p.id, p: at, hp: p.hp });
  }

  // Maximum Output cutscenes (issue #27). The caster's request locks the
  // caster and the target it pulled in, for the cutscene's length and never
  // longer than rules.max.maxMs, and one player may start one only every
  // rules.max.cooldownMs, so a cutscene is never a way to stay untouchable.
  // While locked, nobody else's hits or effects reach either of them, the
  // target cannot act, and the caster lands only its own Output's blows.
  const locked = (q, now) => q.max !== null && now < q.max.until;

  function startMax(room, p, m, now) {
    const ms = Math.round(num(m.ms, rules.max.minMs, rules.max.maxMs));
    if (p.down || p.clash !== null || locked(p, now) || now - p.maxAt < rules.max.cooldownMs) { send(p.ws, { type: 'max-denied' }); return; }
    let target = room.players.get(Number(m.target)) ?? null;
    if (target && (!target.ws || target === p || target.down || target.clash !== null || locked(target, now) || !p.state || !target.state
      || dist(p.state.p, target.state.p) > rules.max.reach + rules.max.slack)) target = null;
    p.maxAt = now;
    const id = nextMax++;
    const until = now + ms;
    p.max = { id, role: 'caster', partner: target?.id ?? null, until, hits: new Map() };
    if (target) target.max = { id, role: 'target', partner: p.id, until, hits: null };
    broadcast(room, { type: 'max', id, caster: p.id, target: target?.id ?? null, cut: String(m.cut ?? '').slice(0, 24), ms, p: vec(m.p) ?? p.state?.p ?? [0, 0, 0], yaw: num(m.yaw, -1e3, 1e3) });
  }

  // Lifts a lock for both people in it, at its end or when one of them leaves or falls.
  function endMax(room, q) {
    const lock = q.max;
    if (!lock) return;
    const caster = lock.role === 'caster' ? q : room.players.get(lock.partner);
    const target = lock.role === 'caster' ? (lock.partner !== null ? room.players.get(lock.partner) : null) : q;
    for (const x of [caster, target]) if (x?.max?.id === lock.id) x.max = null;
    broadcast(room, { type: 'max-end', id: lock.id, caster: caster?.id ?? q.id, target: target?.id ?? null });
  }

  // Whether `p`'s blow or effect may reach `target` under the locks.
  function lockAllows(p, target, now) {
    if (locked(target, now) && !(target.max.role === 'target' && target.max.partner === p.id)) return false;
    if (!locked(p, now)) return true;
    if (p.max.role !== 'caster') return false;
    const n = p.max.hits.get(target.id) ?? 0;
    if (n >= rules.max.hitsPerTarget) return false;
    p.max.hits.set(target.id, n + 1);
    return true;
  }

  // Aura Clash between two players (issue #4). The server runs the referee in
  // src/net/clash.js on its own clock, so both screens play the same picks
  // and the same winner. Every step goes to the whole room: the two in it
  // play it, everyone else just sees it. Health never changes in a clash.
  function clashStep(room, c, ev) {
    broadcast(room, { type: 'clash-step', id: c.id, a: c.a, b: c.b, ev });
    if (ev.kind !== 'end') return;
    room.clashes.delete(c.id);
    for (const id of [c.a, c.b]) { const q = room.players.get(id); if (q?.clash === c.id) q.clash = null; }
  }

  // A request is taken when both players stand in the room, neither is in a
  // clash, the asker is not asking faster than the cooldown, and the two
  // reported fields contest by the rule the browsers use (two body layers
  // never do), with some slack for the network.
  function startClash(room, p, target, now) {
    if (now - p.clashAt < rules.field.clashCooldownMs) return;
    p.clashAt = now;
    if (target && (locked(p, now) || locked(target, now))) return;
    if (!target?.ws || target === p || p.down || target.down || p.clash !== null || target.clash !== null) return;
    const fa = p.state?.f, fb = target.state?.f;
    if (!fa || !fb || !fieldsContest(dist(p.state.p, target.state.p), fa[0], fb[0], rules.field, rules.field.clashSlack)) return;
    const id = nextClash++;
    // Picks may arrive a little after the window the screens show.
    const timing = { ...rules.clash, windowMs: rules.clash.windowMs + rules.clash.graceMs };
    const c = { id, a: p.id, b: target.id, ref: new ClashReferee([fa[1], fb[1]], timing, now) };
    room.clashes.set(id, c);
    p.clash = target.clash = id;
    broadcast(room, { type: 'clash', id, a: c.a, b: c.b });
  }

  // Who owns which prop changes: everyone hears it, in the server's order.
  function setOwner(room, prop, owner) {
    if (owner === null) { if (!room.propOwner.delete(prop)) return; }
    else room.propOwner.set(prop, owner);
    broadcast(room, { type: 'prop-owner', prop, owner });
  }
  // A client that left or went quiet (a background tab sends nothing) hands
  // its props to someone still playing, who carries on simulating them from
  // the poses everyone last saw, so they still come to rest as one. With
  // nobody else playing, they fall where they are. What a player holds sealed
  // (Dark Dimension) stays theirs while the tab only sleeps; once they are
  // gone it is handed on too, and comes back into the world where they stood.
  function releaseProps(room, p) {
    const now = Date.now();
    let heir = null;
    for (const q of present(room)) if (q !== p && now - q.stateAt <= AWAY_MS && (!heir || q.id < heir.id)) heir = q;
    for (const [prop, o] of room.propOwner) {
      if (o !== p.id) continue;
      if (room.propSealed.has(prop)) { if (p.ws) continue; room.propSealed.delete(prop); }
      setOwner(room, prop, heir?.id ?? null);
    }
  }
  const propSnapshot = (room) => ({ rest: [...room.propRest.values()], broken: [...room.broken], owners: [...room.propOwner], sealed: [...room.propSealed] });

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
    const dt = Math.min(0.25, (now - (room.tickAt ?? now)) / 1000);
    room.tickAt = now;
    for (const p of room.players.values()) {
      if (p.down && now >= p.respawnAt && p.ws) respawn(room, p);
      regen(p, now, dt);
      if (now - p.stateAt > AWAY_MS) releaseProps(room, p);
      if (!p.ws && now - p.leftAt > rules.reconnectGraceSeconds * 1000) room.players.delete(p.id);
    }
    for (const c of room.clashes.values()) for (const ev of c.ref.step(now)) clashStep(room, c, ev);
    for (const p of room.players.values()) if (p.max?.role === 'caster' && now >= p.max.until) endMax(room, p);
    if (room.players.size === 0) { clearInterval(room.timer); rooms.delete(room.code); return; }
    const live = present(room);
    if (!live.length) return;
    const snap = { type: 'snap', t: now, players: live.map((p) => ({ id: p.id, hp: Math.round(p.hp * 10) / 10, down: p.down, away: now - p.stateAt > AWAY_MS, st: p.fresh.splice(0) })) };
    for (const p of live) send(p.ws, snap);
  }

  function join(ws, m) {
    const code = cleanRoom(m.room);
    const room = roomFor(code);
    if (!room) { send(ws, { type: 'full', room: code, max: rules.maxPlayers }); return null; }
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
      p = { id: nextId++, token, slot: freeSlot(room), hp: rules.maxHp, down: false, foughtAt: 0, kills: 0, downs: 0, state: null, fresh: [], stateAt: 0, protectUntil: 0, respawnAt: 0, leftAt: 0, bucket: HITS_PER_SECOND, bucketAt: Date.now(), seen: new Set(), clash: null, clashAt: 0, propBucket: PROP_HITS_PER_SECOND, propBucketAt: Date.now(), iceAt: 0, meltAt: 0, heatAt: 0, linesAt: 0, max: null, maxAt: -Infinity };
      room.players.set(p.id, p);
    }
    p.ws = ws;
    p.name = cleanName(m.name);
    p.tech = String(m.tech ?? 'recoil').slice(0, 16);
    p.stateAt = Date.now();
    const spawn = p.state && !p.down ? p.state.p : spawnPoint(room, p);
    if (!p.state) { p.protectUntil = Date.now() + rules.spawnProtectSeconds * 1000; p.state = { ct: 0, p: spawn, v: [0, 0, 0], yaw: 0, pitch: 0, g: true, sign: 0, cine: false }; }
    send(ws, { type: 'welcome', id: p.id, room: code, you: info(p), players: present(room).filter((o) => o !== p).map(info), spawn, t: Date.now(), props: propSnapshot(room) });
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
    releaseProps(room, p);
    endMax(room, p);
    // Leaving mid-clash loses it.
    const c = p.clash !== null ? room.clashes.get(p.clash) : null;
    if (c) for (const ev of c.ref.forfeit(c.a === p.id ? 0 : 1)) clashStep(room, c, ev);
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
        const st = { ct: s.ct, p: p.down ? (p.state?.p ?? pos) : pos, v, yaw: num(s.yaw, -1e3, 1e3), pitch: num(s.pitch, -2, 2), g: !!s.g, sign: s.sign === 1 || s.sign === 2 ? s.sign : 0, cine: !!s.cine, f: Array.isArray(s.f) ? [num(s.f[0], 0, rules.field.maxRadius), num(s.f[1], 0, 1), num(s.f[2] ?? 0, 0, rules.field.maxRadius)] : [0, 0, 0], e: Number.isInteger(s.e) && s.e >= 0 && s.e <= 5 ? s.e : 0, h: Number.isFinite(s.h) ? num(s.h, 0, 1) : 0, k: Number.isInteger(s.k) ? s.k & STATE_FLAGS : 0 };
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
        broadcast(room, { type: 'cast', id: p.id, ct: Number(m.ct) || 0, kind: String(m.kind).slice(0, 16), tech: String(m.tech).slice(0, 16), name: String(m.name ?? '').slice(0, 40), dir: vec(m.dir) ?? [0, 0, -1], variant: VARIANTS.includes(m.variant) ? m.variant : 'long', speed: Number.isFinite(m.speed) ? num(m.speed, 0.25, 4) : 1, shout: m.shout === true }, p);
        return;
      case 'fx':
        if (Array.isArray(m.calls) && m.calls.length <= 64) broadcast(room, { type: 'fx', id: p.id, ct: Number(m.ct) || 0, calls: m.calls }, p);
        return;
      case 'blow': {
        // A bare-hand blow's gesture, relayed: one of the four, no faster than a combo throws them.
        const n = m.n;
        if (p.down || !Number.isInteger(n) || n < 0 || n > 3 || now - (p.blowAt ?? 0) < 1000 / rules.melee.blowsPerSecond) return;
        p.blowAt = now;
        broadcast(room, { type: 'blow', id: p.id, ct: Number(m.ct) || 0, n, dir: vec(m.dir) ?? [0, 0, -1] }, p);
        return;
      }
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
        // A bare-hand blow (`m`) is held to arm's reach and a fist's damage.
        const melee = m.m === 1 || m.m === 2 ? m.m : 0;
        if (p.state && target.state && dist(p.state.p, target.state.p) > (melee ? rules.melee.range : rules.maxHitRange)) return;
        if (!lockAllows(p, target, now)) return;
        p.bucket = Math.min(HITS_PER_SECOND, p.bucket + ((now - p.bucketAt) / 1000) * HITS_PER_SECOND);
        p.bucketAt = now;
        if (p.bucket < 1) return;
        p.bucket--;
        const amount = num(m.amount, 0, melee ? rules.melee.maxDamage : rules.maxHitDamage);
        if (amount <= 0) return;
        const id = nextHit++;
        room.pending.set(id, { by: p.id, target: target.id, amount, at: now });
        send(target.ws, { type: 'struck', hit: id, by: p.id, amount, from: vec(m.from) ?? p.state?.p ?? [0, 0, 0], knock: num(m.knock, 0, 30), lift: num(m.lift, 0, 15), ...(melee ? { m: melee } : {}) });
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
        if ((locked(target, now) && target.max.partner !== p.id) || (locked(p, now) && p.max.role === 'target')) return;
        send(target.ws, { type: 'status', by: p.id, frozen: num(m.frozen, 0, 6), slow: num(m.slow, 0.1, 1) });
        return;
      }
      case 'max':
        startMax(room, p, m, now);
        return;
      case 'max-end':
        if (p.max?.role === 'caster') endMax(room, p);
        return;
      case 'clash':
        startClash(room, p, room.players.get(Number(m.target)), now);
        return;
      case 'clash-pick': {
        const c = p.clash !== null ? room.clashes.get(p.clash) : null;
        if (!c || c.id !== Number(m.id) || c.ref.round !== Number(m.round) || !isPick(m.pick)) return;
        if (!c.ref.pick(c.a === p.id ? 0 : 1, m.pick, now)) return;
        for (const ev of c.ref.step(now)) clashStep(room, c, ev);
        return;
      }
      case 'props': {
        // Poses from the prop's owner are relayed; a claim makes the sender
        // the owner; a rest entry sets the prop down and frees it.
        if (!Array.isArray(m.s) || m.s.length > PROP_ENTRIES) return;
        const out = [];
        for (const e of m.s) {
          const w = propWire(e);
          if (!w || room.broken.has(w[0])) continue;
          const id = w[0];
          if (room.propOwner.get(id) !== p.id) {
            if (!(w[11] & PROP_CLAIM) || (!room.propOwner.has(id) && room.propOwner.size >= MAX_PROPS)) continue;
            setOwner(room, id, p.id);
          }
          // Sealed by its owner, or back out in the world.
          if (w[11] & PROP_SEALED) room.propSealed.add(id); else room.propSealed.delete(id);
          if (w[11] & PROP_REST) {
            setOwner(room, id, null);
            if (room.propRest.has(id) || room.propRest.size < MAX_PROPS) room.propRest.set(id, w);
          }
          out.push(w);
        }
        if (out.length) broadcast(room, { type: 'props', id: p.id, s: out }, p);
        return;
      }
      case 'prop-hit': {
        const id = propId(m.prop);
        if (id === null || room.broken.has(id)) return;
        p.propBucket = Math.min(PROP_HITS_PER_SECOND, p.propBucket + ((now - p.propBucketAt) / 1000) * PROP_HITS_PER_SECOND);
        p.propBucketAt = now;
        if (p.propBucket < 1) return;
        p.propBucket--;
        const amount = num(m.amount, 0, 1000);
        if (amount <= 0 || (!room.propHp.has(id) && room.propHp.size >= MAX_PROPS)) return;
        const hp = (room.propHp.get(id) ?? num(m.max, 1, 1000)) - amount;
        if (hp > 0) { room.propHp.set(id, hp); return; }
        room.propHp.delete(id);
        room.propRest.delete(id);
        room.propOwner.delete(id);
        room.propSealed.delete(id);
        if (room.broken.size < MAX_PROPS) room.broken.add(id);
        broadcast(room, { type: 'prop-break', prop: id, by: p.id, from: vec(m.from) ?? p.state?.p ?? [0, 0, 0] });
        return;
      }
      case 'ice': {
        const secs = num(m.s, 0, 20);
        if (secs <= 0 || now - p.iceAt < ICE_EVERY_MS) return;
        p.iceAt = now;
        // A canal frozen across: where (bounded to the world) and how wide.
        const at = Array.isArray(m.at) && m.at.length === 2 ? [num(m.at[0], -5000, 5000), num(m.at[1], -5000, 5000)] : null;
        broadcast(room, at ? { type: 'ice', id: p.id, s: secs, at, r: num(m.r, 0.5, 20) } : { type: 'ice', id: p.id, s: secs }, p);
        return;
      }
      case 'melt':
        if (now - p.meltAt < ICE_EVERY_MS) return;
        p.meltAt = now;
        broadcast(room, { type: 'melt', id: p.id }, p);
        return;
      case 'heat': {
        // Glow and fire on props the room knows, and burns on players standing
        // within reach of the sender: what the sender's own screen shows.
        if (now - p.heatAt < HEAT_EVERY_MS) return;
        p.heatAt = now;
        const props = Array.isArray(m.p) ? m.p.slice(0, HEAT_PROPS).filter((e) => Array.isArray(e) && e.length === 3 && propId(e[0]) !== null && !room.broken.has(e[0])).map((e) => [e[0], r2(num(e[1], 0, 1.25)), r2(num(e[2], 0, 10))]) : [];
        const bodies = Array.isArray(m.b) ? m.b.slice(0, HEAT_BODIES).filter((e) => {
          if (!Array.isArray(e) || e.length !== 2) return false;
          const t = room.players.get(playerId(e[0]));
          return !!t?.ws && t !== p && !t.down && !!p.state && !!t.state && dist(p.state.p, t.state.p) <= rules.maxHitRange;
        }).map((e) => [e[0], r2(num(e[1], 0, 6))]) : [];
        if (p.down || (!props.length && !bodies.length)) return;
        broadcast(room, { type: 'heat', id: p.id, ...(props.length ? { p: props } : {}), ...(bodies.length ? { b: bodies } : {}) }, p);
        return;
      }
      case 'lines': {
        // The sender's lines as a whole: an empty list takes them all away.
        if (!Array.isArray(m.l) || m.l.length > MAX_LINES || now - p.linesAt < LINES_EVERY_MS) return;
        p.linesAt = now;
        const l = m.l.map(lineWire).filter((x) => x);
        broadcast(room, { type: 'lines', id: p.id, ct: Number(m.ct) || 0, l }, p);
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
    if (wss.clients.size > MAX_CONNECTIONS) { ws.close(1013, 'server full'); return; }
    let at = null;
    let budget = MESSAGES_PER_SECOND, budgetAt = Date.now();
    ws.alive = true;
    ws.on('pong', () => { ws.alive = true; });
    ws.on('message', (data) => later(() => {
      const now = Date.now();
      budget = Math.min(MESSAGES_PER_SECOND, budget + ((now - budgetAt) / 1000) * MESSAGES_PER_SECOND);
      budgetAt = now;
      if (budget < 1) { ws.close(1008, 'too many messages'); return; }
      budget--;
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
