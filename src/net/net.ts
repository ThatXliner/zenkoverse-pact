import * as THREE from 'three';
import { signal } from '@preact/signals';
import type { Game } from '../app/game';
import { toast } from '../app/game';
import { KITS } from '../techniques/techniques';
import { PLAYER_SUIT } from '../character/avatar';
import { FxWire } from './fxwire';
import { RemotePlayer, seatSuit } from './remote';
import { RULES, type ClientMsg, type PlayerInfo, type ServerMsg, type Vec3 } from './protocol';

export type NetStatus = 'off' | 'connecting' | 'online' | 'reconnecting' | 'full';

export interface Plate { id: number; name: string; x: number; y: number; hp: number; down: boolean; away: boolean; color: string; tech: string }

export const netUi = {
  status: signal<NetStatus>('off'),
  room: signal(''),
  me: signal<PlayerInfo | null>(null),
  others: signal<PlayerInfo[]>([]),
  plates: signal<Plate[]>([]),
  downed: signal<{ by: string | null; at: number } | null>(null),
  feed: signal<{ id: number; text: string }[]>([]),
  ping: signal(0),
};

const NAME_KEY = 'zenko.name';
const TOKEN_KEY = 'zenko.net.token';
export function savedName(): string { try { return localStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; } }
export function saveName(n: string): void { try { localStorage.setItem(NAME_KEY, n); } catch { /* private mode */ } }
// One token per tab: a reload or a dropped socket takes the same seat back,
// with its score, while a second tab is a second player.
function tabToken(): string {
  try {
    let t = sessionStorage.getItem(TOKEN_KEY);
    if (!t) { t = Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem(TOKEN_KEY, t); }
    return t;
  } catch { return Math.random().toString(36).slice(2); }
}
export function roomFromUrl(): string | null { return new URLSearchParams(location.search).get('room'); }
export function cleanRoom(s: string): string { return s.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24) || RULES.defaultRoom; }

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const v3 = (v: THREE.Vector3): Vec3 => [Math.round(v.x * 1000) / 1000, Math.round(v.y * 1000) / 1000, Math.round(v.z * 1000) / 1000];
const SEND_MS = 1000 / RULES.sendHz;

// The client side of an online room: one socket, the other players' bodies,
// and the bridge between this player's simulation and the server. Movement
// and Techniques stay local; health, downs and respawns come from the server.
export class Net {
  readonly remotes = new Map<number, RemotePlayer>();
  id: number | null = null;
  downed = false;
  private ws: WebSocket | null = null;
  private room = RULES.defaultRoom;
  private name = '';
  private token = tabToken();
  private retries = 0;
  private closing = false;
  private lastSend = 0;
  private seq = 0;
  private pingTimer: number | null = null;
  private retryTimer: number | null = null;
  private feedId = 0;
  private fx: FxWire;
  // What the check scripts read: every hit this client sent and every health
  // change the server announced.
  readonly log = { sent: [] as { target: number; amount: number; t: number }[], hp: [] as { id: number; hp: number; by: number | null; amount: number; t: number }[] };

  constructor(private game: Game) {
    this.fx = new FxWire(game.vfx);
  }

  get active(): boolean { return netUi.status.value !== 'off'; }
  get connected(): boolean { return this.ws?.readyState === WebSocket.OPEN && this.id !== null; }

  connect(room: string, name: string): void {
    this.room = cleanRoom(room);
    this.name = name;
    this.closing = false;
    netUi.room.value = this.room;
    netUi.status.value = 'connecting';
    const url = new URL('ws', location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    url.search = '';
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.send({ type: 'hello', room: this.room, name: this.name, token: this.token, tech: this.game.techniqueId });
    };
    ws.onmessage = (e) => {
      let m: ServerMsg;
      try { m = JSON.parse(String(e.data)) as ServerMsg; } catch { return; }
      this.receive(m);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.clearRemotes();
      if (this.closing || netUi.status.value === 'full') return;
      // The server restarted or the network dropped: keep playing locally and
      // try again, a little slower each time.
      netUi.status.value = 'reconnecting';
      const wait = Math.min(5000, 500 * 2 ** this.retries++);
      this.retryTimer = window.setTimeout(() => { if (!this.closing) this.connect(this.room, this.name); }, wait);
    };
    if (this.pingTimer === null) this.pingTimer = window.setInterval(() => this.send({ type: 'ping', t: performance.now() }), 2000);
  }

  leave(): void {
    this.closing = true;
    this.send({ type: 'bye' });
    this.ws?.close();
    this.ws = null;
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.pingTimer = this.retryTimer = null;
    this.clearRemotes();
    this.fx.dispose();
    this.id = null;
    if (this.downed) this.respawned(this.game.player.position.clone(), RULES.maxHp);
    this.game.avatar.setSuit(PLAYER_SUIT);
    netUi.status.value = 'off';
    netUi.me.value = null;
    netUi.downed.value = null;
    netUi.plates.value = [];
  }

  private send(m: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  private clearRemotes(): void {
    for (const r of this.remotes.values()) r.dispose();
    this.remotes.clear();
    netUi.others.value = [];
    netUi.plates.value = [];
  }

  private addRemote(info: PlayerInfo): void {
    if (info.id === this.id) return;
    const had = this.remotes.get(info.id);
    if (had) { had.info = info; return; }
    this.remotes.set(info.id, new RemotePlayer(this.game, info, (t, frozen, slow) => this.send({ type: 'status', target: t.id, frozen, slow }), (t, amount, o) => this.hit(t, amount, o)));
  }

  private refreshRoster(): void {
    netUi.others.value = [...this.remotes.values()].map((r) => r.info);
  }

  private nameOf(id: number | null): string | null {
    if (id === null) return null;
    if (id === this.id) return 'You';
    return this.remotes.get(id)?.info.name ?? null;
  }

  private feed(text: string): void {
    const id = ++this.feedId;
    netUi.feed.value = [...netUi.feed.value, { id, text }].slice(-4);
    setTimeout(() => { netUi.feed.value = netUi.feed.value.filter((f) => f.id !== id); }, 5000);
  }

  private receive(m: ServerMsg): void {
    const g = this.game;
    switch (m.type) {
      case 'welcome': {
        const rejoin = this.id === m.id;
        this.id = m.id;
        this.retries = 0;
        netUi.status.value = 'online';
        netUi.room.value = m.room;
        netUi.me.value = m.you;
        g.avatar.setSuit(seatSuit(m.you.slot));
        for (const id of [...this.remotes.keys()]) if (!m.players.some((p) => p.id === id)) { this.remotes.get(id)!.dispose(); this.remotes.delete(id); }
        for (const p of m.players) this.addRemote(p);
        this.refreshRoster();
        g.combat.setHp(m.you.hp);
        if (!rejoin) { g.player.teleport(new THREE.Vector3(...m.spawn)); g.cam.yaw = Math.atan2(m.spawn[0], m.spawn[2]); }
        if (m.you.down && !this.downed) this.goDown(null);
        if (!m.you.down && this.downed) this.respawned(g.player.position.clone(), m.you.hp);
        const url = new URL(location.href);
        url.searchParams.set('room', m.room);
        history.replaceState(null, '', url);
        if (!rejoin) toast(m.players.length ? `Room ${m.room}: ${m.players.length + 1} here.` : `Room ${m.room}. Share the link to bring someone in.`, 'good');
        else toast('Reconnected.', 'good');
        return;
      }
      case 'full':
        netUi.status.value = 'full';
        toast(`Room ${m.room} is full (${m.max} players).`, 'bad');
        return;
      case 'join':
        this.addRemote(m.player);
        this.refreshRoster();
        this.feed(`${m.player.name} entered the compound`);
        return;
      case 'leave': {
        const r = this.remotes.get(m.id);
        if (!r) return;
        this.feed(`${r.info.name} left`);
        r.dispose();
        this.remotes.delete(m.id);
        this.refreshRoster();
        return;
      }
      case 'info':
        if (m.player.id === this.id) { netUi.me.value = m.player; return; }
        { const r = this.remotes.get(m.player.id); if (r) { r.info = m.player; this.refreshRoster(); } else { this.addRemote(m.player); this.refreshRoster(); } }
        return;
      case 'snap': {
        const now = performance.now();
        for (const p of m.players) {
          if (p.id === this.id) continue;
          const r = this.remotes.get(p.id);
          if (!r) continue;
          r.away = p.away;
          if (r.alive) r.hp = p.hp;
          for (const s of p.st) r.push(s, now);
        }
        return;
      }
      case 'cast': {
        const r = this.remotes.get(m.id);
        const kit = KITS[m.tech as keyof typeof KITS];
        if (!r || !kit) return;
        r.at(m.ct, () => {
          const kind = m.kind as keyof typeof kit.avatarClips;
          r.avatar.playUpper(kit.avatarClips[kind] ?? kit.avatarClips.primary, 1.1);
          // Their sound, quieter with distance.
          const d = r.position.distanceTo(g.player.position);
          const a = kit.audio[kind] ?? kit.audio.primary;
          if (d < 30) g.audio.play(a.cast, (a.volume ?? 0.6) * (1 - d / 30) * 0.8, a.pitch ?? 1);
          if (kind === 'max') toast(`${r.info.name}: Maximum Output, ${kit.cutscene.title.en}`, 'bad');
        });
        return;
      }
      case 'fx': {
        const r = this.remotes.get(m.id);
        if (r) r.at(m.ct, () => this.fx.replay(m.calls, r.avatar.model));
        return;
      }
      case 'struck': {
        if (this.downed) { this.send({ type: 'resolve', hit: m.hit, taken: 0 }); return; }
        const from = new THREE.Vector3(...m.from);
        // This player's own defences decide what gets through: the same
        // rules as a hit from anything else in the compound.
        const taken = g.combat.hurtPlayer(m.amount, { from, kinetic: true, pvp: true });
        if (taken > 0 && m.knock > 0) {
          const away = g.player.position.clone().sub(from).setY(0).normalize();
          g.player.velocity.addScaledVector(away, m.knock);
          g.player.velocity.y += m.lift || m.knock * 0.35;
          if (m.knock > 4) g.player.moveLock = Math.max(g.player.moveLock, 0.3);
        }
        this.send({ type: 'resolve', hit: m.hit, taken });
        return;
      }
      case 'hp': {
        this.log.hp.push({ id: m.id, hp: m.hp, by: m.by, amount: m.amount, t: performance.now() });
        if (m.id === this.id) { g.combat.setHp(m.hp); return; }
        const r = this.remotes.get(m.id);
        if (!r) return;
        r.struck(m.hp, m.by === this.id);
        // The attacker already saw its number when it swung; everyone else sees it now.
        if (m.by !== this.id && m.amount > 0) g.combat.number(r.center(), String(Math.round(m.amount)), '#f3eee4', m.amount >= 40);
        if (m.by === this.id && m.amount === 0) g.combat.number(r.center(), 'blocked', '#9fb4c8', false);
        return;
      }
      case 'down': {
        const by = this.nameOf(m.by);
        if (m.id === this.id) { this.goDown(m.by); this.feed(by ? `${by} downed you` : 'You went down'); return; }
        const r = this.remotes.get(m.id);
        if (!r) return;
        r.die();
        this.feed(by ? `${by} downed ${r.info.name}` : `${r.info.name} went down`);
        if (m.by === this.id) g.audio.play('confirmation_002', 0.6);
        return;
      }
      case 'respawn': {
        if (m.id === this.id) { this.respawned(new THREE.Vector3(...m.p), m.hp); return; }
        this.remotes.get(m.id)?.revive(m.hp);
        return;
      }
      case 'status':
        if (this.downed) return;
        g.player.rooted = Math.max(g.player.rooted, m.frozen);
        if (m.slow < 1) { g.player.speedScale = Math.min(g.player.speedScale, m.slow); setTimeout(() => { g.player.speedScale = 1; }, (m.frozen + 1.2) * 1000); }
        return;
      case 'pong':
        netUi.ping.value = Math.round(performance.now() - m.t);
        return;
    }
  }

  private goDown(by: number | null): void {
    const g = this.game;
    this.downed = true;
    g.combat.setHp(0);
    g.techniques.reset();
    g.avatar.die();
    g.input.clear();
    netUi.downed.value = { by: this.nameOf(by), at: performance.now() };
  }

  private respawned(p: THREE.Vector3, hp: number): void {
    const g = this.game;
    this.downed = false;
    netUi.downed.value = null;
    g.player.teleport(p);
    g.avatar.revive();
    g.combat.setHp(hp);
    g.combat.invuln = RULES.spawnProtectSeconds;
  }

  // A Technique connected with another player. The number shows at once;
  // the server applies it.
  hit(target: RemotePlayer, amount: number, opts: { from?: THREE.Vector3; knock?: number; lift?: number }): void {
    if (this.downed || !this.connected) return;
    const from = opts.from ?? this.game.player.position;
    this.log.sent.push({ target: target.id, amount, t: performance.now() });
    this.send({ type: 'hit', seq: ++this.seq, target: target.id, amount, from: v3(from), knock: opts.knock ?? 0, lift: opts.lift ?? 0 });
  }

  // Health this player spends on its own Pacts and Risks.
  selfDamage(amount: number): void { if (!this.downed) this.send({ type: 'self', amount }); }

  cast(kind: string, name: string): void {
    this.send({ type: 'cast', ct: performance.now(), kind, tech: this.game.techniqueId, name, dir: v3(this.game.cam.aimDirection()) });
  }

  setTechnique(id: string): void { this.send({ type: 'tech', tech: id }); }

  // Every frame, paused or not: send this player's state on the send clock,
  // forward the effects it drew, and move everyone else.
  update(raw: number): void {
    const g = this.game;
    const now = performance.now();
    if (this.connected) {
      const calls = this.fx.take();
      if (calls) this.send({ type: 'fx', ct: now, calls });
      if (now - this.lastSend >= SEND_MS - 2) {
        this.lastSend = now;
        const s = g.techniques.sign;
        this.send({ type: 'state', s: { ct: now, p: v3(g.player.position), v: v3(g.player.velocity), yaw: Math.round(g.cam.yaw * 1000) / 1000, pitch: g.cam.isTop ? 0 : Math.round(g.cam.pitch * 1000) / 1000, g: g.player.grounded, sign: s.kind === 'signing' ? 1 : s.kind === 'primed' ? 2 : 0, cine: g.cutscenes.active } });
      }
    } else this.fx.take();
    for (const r of this.remotes.values()) r.update(raw);
    this.plates();
  }

  private plates(): void {
    const cam = this.game.renderer.camera;
    const out: Plate[] = [];
    const v = new THREE.Vector3();
    for (const r of this.remotes.values()) {
      if (!r.seen) continue;
      v.copy(r.position).add(new THREE.Vector3(0, r.height + 0.45, 0)).project(cam);
      if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) continue;
      out.push({ id: r.id, name: r.info.name, x: (v.x * 0.5 + 0.5) * 100, y: (-v.y * 0.5 + 0.5) * 100, hp: r.shownHp / RULES.maxHp, down: !r.alive, away: r.away, color: hex(seatSuit(r.info.slot)), tech: r.info.tech });
    }
    if (out.length || netUi.plates.value.length) netUi.plates.value = out;
  }
}
