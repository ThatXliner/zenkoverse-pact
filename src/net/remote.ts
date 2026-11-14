import * as THREE from 'three';
import type { Game } from '../app/game';
import { Enemy, ENEMY_DEFS, NO_SCALE } from '../combat/enemies';
import type { CharacterModel } from '../character/avatar';
import { RULES, type PlayerInfo, type PlayerState } from './protocol';

// Each seat in a room has a suit colour and a look, the same on every screen.
export const SEAT_SUITS = [0x2a4a9e, 0xb3263a, 0x1f8a80, 0xd98a1c, 0x6a3fa0, 0x3f8f3a, 0x3a3d48, 0xc0407e];
const SEAT_LOOKS: CharacterModel[] = ['parted', 'buns', 'buzzed', 'long', 'beard', 'bald', 'parted', 'buns'];
export const seatSuit = (slot: number): number => SEAT_SUITS[slot % SEAT_SUITS.length]!;

// Two samples further apart than this are a jump (a respawn, a Shift), drawn
// as a cut rather than a slide.
const JUMP = 5;
// How far past the newest sample the body may be carried on its velocity
// before it waits for the next one.
const EXTRAPOLATE_MS = 150;
const KEEP_MS = 1500;

interface Timed { ct: number; run: () => void }

// Another player in the room. It is an Enemy so every Technique's targeting
// (cones, spheres, rays against the enemy group, the Maximum Output target)
// treats it like any other body, but it has no AI: it is drawn where its
// owner's own simulation put it, about `interpMs` in the past, and a hit on
// it goes to the server instead of taking health here.
export class RemotePlayer extends Enemy {
  info: PlayerInfo;
  away = false;
  cine = false;
  // Their aura field as their own screen draws it.
  fieldRadius = 0;
  fieldDensity = 0;
  private buf: PlayerState[] = [];
  // The sender's clock minus ours, from recent arrivals. The largest is the
  // least delayed sample, so it tracks the sender without the jitter.
  private skews: number[] = [];
  private offset: number | null = null;
  private events: Timed[] = [];
  private lastFrozen = 0;
  private sample: PlayerState | null = null;
  // Hits this client sent that the server has not confirmed yet. The name
  // plate subtracts them, so the attacker sees the bar drop on the blow
  // instead of a round trip later.
  private unconfirmed: { amount: number; at: number }[] = [];
  readonly id: number;

  constructor(game: Game, info: PlayerInfo, private onStatus: (target: RemotePlayer, frozen: number, slow: number) => void, private onHit: (target: RemotePlayer, amount: number, opts: { from?: THREE.Vector3; knock?: number; lift?: number }) => void) {
    const def = { ...ENEMY_DEFS.rival!, name: info.name, model: SEAT_LOOKS[info.slot % SEAT_LOOKS.length]!, tint: seatSuit(info.slot) };
    super(game, 'rival', new THREE.Vector3(0, -50, 0), NO_SCALE, false, def);
    this.id = info.id;
    this.info = info;
    this.hp = info.hp;
    this.avatar.root.visible = false;
    if (info.down) this.die();
  }

  get seen(): boolean { return this.sample !== null; }

  push(s: PlayerState, now: number): void {
    const last = this.buf[this.buf.length - 1];
    // A sender whose clock went back has reloaded: start its timeline again.
    if (last && s.ct < last.ct - 1000) { this.buf.length = 0; this.skews.length = 0; this.offset = null; this.events.length = 0; }
    else if (last && s.ct <= last.ct) return;
    this.buf.push(s);
    this.skews.push(s.ct - now);
    if (this.skews.length > 40) this.skews.shift();
    while (this.buf.length > 2 && this.buf[0]!.ct < s.ct - KEEP_MS) this.buf.shift();
  }

  // Casts and effects wait until the drawn body reaches the moment they happened.
  at(ct: number, run: () => void): void {
    if (this.offset === null || !ct) { run(); return; }
    this.events.push({ ct, run });
  }

  // Where the sender's timeline is drawn now.
  private renderTime(now: number): number | null {
    if (!this.skews.length) return null;
    const target = Math.max(...this.skews);
    this.offset = this.offset === null || Math.abs(target - this.offset) > 250 ? target : this.offset + (target - this.offset) * 0.05;
    return now + this.offset - RULES.interpMs;
  }

  private interpolate(t: number): PlayerState | null {
    const b = this.buf;
    if (!b.length) return null;
    if (t <= b[0]!.ct) return b[0]!;
    for (let i = 0; i < b.length - 1; i++) {
      const s0 = b[i]!, s1 = b[i + 1]!;
      if (t > s1.ct) continue;
      const u = (t - s0.ct) / (s1.ct - s0.ct);
      if (dist(s0.p, s1.p) > JUMP) return u < 1 ? s0 : s1;
      return {
        ...s1,
        p: [lerp(s0.p[0], s1.p[0], u), lerp(s0.p[1], s1.p[1], u), lerp(s0.p[2], s1.p[2], u)],
        v: [lerp(s0.v[0], s1.v[0], u), lerp(s0.v[1], s1.v[1], u), lerp(s0.v[2], s1.v[2], u)],
        yaw: s0.yaw + wrap(s1.yaw - s0.yaw) * u,
        pitch: lerp(s0.pitch, s1.pitch, u),
        g: u < 0.5 ? s0.g : s1.g,
      };
    }
    const last = b[b.length - 1]!;
    const ahead = Math.min(t - last.ct, EXTRAPOLATE_MS) / 1000;
    if (ahead <= 0 || !last.g) return last;
    return { ...last, p: [last.p[0] + last.v[0] * ahead, last.p[1], last.p[2] + last.v[2] * ahead] };
  }

  override hurt(amount: number, opts: { from?: THREE.Vector3; knock?: number; lift?: number; stagger?: boolean } = {}): void {
    if (!this.alive) return;
    this.avatar.flash(1.2);
    this.unconfirmed.push({ amount, at: performance.now() });
    this.onHit(this, amount, opts);
  }

  get shownHp(): number {
    const now = performance.now();
    while (this.unconfirmed.length && now - this.unconfirmed[0]!.at > RULES.hitTimeoutMs + 500) this.unconfirmed.shift();
    return Math.max(0, this.hp - this.unconfirmed.reduce((s, u) => s + u.amount, 0));
  }

  // The server confirmed health changed: the body reacts on every screen.
  // `mine` when the change answers a hit this client sent.
  struck(hp: number, mine = false): void {
    if (mine) this.unconfirmed.shift();
    const hurt = hp < this.hp;
    this.hp = hp;
    if (!hurt) return;
    this.avatar.flash(1.2);
    if (this.alive) this.avatar.playUpper('Hit_Chest', 1.2);
  }

  override die(): void {
    if (!this.alive) return;
    this.alive = false;
    this.hp = 0;
    this.unconfirmed.length = 0;
    this.collider.setEnabled(false);
    this.avatar.die();
  }

  revive(hp: number): void {
    this.alive = true;
    this.hp = hp;
    this.frozen = 0;
    this.resonance = 0;
    this.collider.setEnabled(true);
    this.avatar.revive();
  }

  override update(dt: number): void {
    if (this.disposed) return;
    const now = performance.now();
    const t = this.renderTime(now);
    const s = t === null ? null : this.interpolate(t);
    if (t !== null && this.events.length) {
      this.events.sort((a, b) => a.ct - b.ct);
      // Anything older than half a second is from while this tab was hidden: dropped, not replayed in a burst.
      while (this.events.length && this.events[0]!.ct <= t) { const e = this.events.shift()!; if (t - e.ct < 500) e.run(); }
    }
    // Effects from Techniques on this body: freezes travel to its owner, the
    // stacks a Technique counts stay with the attacker.
    if (this.frozen > this.lastFrozen + 0.01) this.onStatus(this, this.frozen, this.slow);
    this.frozen = Math.max(0, this.frozen - dt);
    this.lastFrozen = this.frozen;
    this.slow = THREE.MathUtils.lerp(this.slow, 1, 1 - Math.exp(-1.5 * dt));
    this.resonance = Math.max(0, this.resonance - dt * 0.5);
    if (!s) return;
    this.sample = s;
    this.cine = s.cine;
    this.fieldRadius = this.alive ? s.f?.[0] ?? 0 : 0;
    this.fieldDensity = s.f?.[1] ?? 0;
    this.position.set(s.p[0], s.p[1], s.p[2]);
    this.velocity.set(s.v[0], s.v[1], s.v[2]);
    this.yaw = s.yaw;
    this.grounded = s.g;
    this.body.setNextKinematicTranslation({ x: s.p[0], y: s.p[1] + this.height / 2, z: s.p[2] });
    const root = this.avatar.root;
    root.visible = true;
    root.position.copy(this.position);
    if (this.alive) {
      root.rotation.y = s.yaw;
      this.avatar.setLocomotion(this.velocity, s.g, dt);
      this.avatar.setAimPitch(s.pitch);
      this.avatar.seal = s.sign === 1 ? 1 : 0;
      // A Maximum Output in progress: the caster glows and cannot be hurt.
      if (s.cine) this.avatar.flash(0.55);
    }
    this.avatar.update(dt);
  }

  // The drawn position, for the checks.
  get drawn(): THREE.Vector3 | null { return this.sample ? this.position : null; }
}

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const dist = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
const wrap = (a: number) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
