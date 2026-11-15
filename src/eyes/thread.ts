import * as THREE from 'three';
import type { Game } from '../app/game';
import { CAST_SECONDS, type Enemy } from '../combat/enemies';
import { EYES } from './registry';
import { GroundMark, Strand } from './draw';
import { near, NO_EFFECT, type Sight } from './sight';

// The Thread Eye sees what depends on what. In a crowd the lighter bodies
// lean on the heaviest one near them: it is their anchor, and a thread runs
// from it to each of them. While the anchor stands they are harder to hurt;
// a blow to the anchor runs down every thread to them; when the anchor
// falls, its threads snap and they reel. The bodies the aim is on light up
// their whole group, so the bearer sees where a blow will travel before
// throwing it. A cast hangs from its caster the same way: the Kuroda's fuel
// is tied to him until it burns, and a blow that breaks his cast cuts it.

const RANGE = 22;
const REACH = 7;
const BOSS_REACH = 9;
// An anchor outweighs what leans on it by at least this much.
const HEAVIER = 1.2;
const CARRY = 0.4;
const SHIELD = 0.8;
const TRAVEL = 0.2;
const COLOR = EYES.thread.color;
const CSS = '#' + new THREE.Color(COLOR).getHexString();

interface Tie { anchor: Enemy; strand: Strand; snap: number }
interface Carry { anchor: Enemy; dep: Enemy; amount: number; t: number }

export class ThreadSight implements Sight {
  private ties = new Map<Enemy, Tie>();
  private knots = new Map<Enemy, GroundMark>();
  private carries: Carry[] = [];
  private fuel: Strand;
  private regroup = 0;

  constructor(private game: Game) {
    this.fuel = new Strand(game.renderer.scene, COLOR);
  }

  private anchorOf(e: Enemy): Enemy | null { const t = this.ties.get(e); return t && t.snap < 0 && t.anchor.alive ? t.anchor : null; }
  private depsOf(a: Enemy): Enemy[] { const out: Enemy[] = []; for (const [d, t] of this.ties) if (t.anchor === a && t.snap < 0 && d.alive) out.push(d); return out; }

  // Who leans on whom: each body on the heaviest body near it that clearly
  // outweighs it. A body that is itself tied passes its own up the line, so
  // every group has one anchor.
  private group(bodies: Enemy[]): void {
    const fighters = bodies.filter((e) => e.def.ai !== 'dummy' && e.def.ai !== 'rival');
    const pick = new Map<Enemy, Enemy>();
    for (const e of fighters) {
      let best: Enemy | null = null;
      for (const o of fighters) {
        if (o === e || o.maxHp < e.maxHp * HEAVIER) continue;
        if (o.position.distanceTo(e.position) > (o.isBoss ? BOSS_REACH : REACH)) continue;
        if (!best || o.maxHp > best.maxHp) best = o;
      }
      // A thread already there holds while it still fits, so groups do not flicker.
      const held = this.ties.get(e);
      if (held && held.snap < 0 && held.anchor.alive && held.anchor.position.distanceTo(e.position) < (held.anchor.isBoss ? BOSS_REACH : REACH) + 1.5 && (!best || best.maxHp <= held.anchor.maxHp)) best = held.anchor;
      if (best) pick.set(e, best);
    }
    for (const [e, a] of pick) { let top = a; for (let i = 0; i < 4 && pick.has(top); i++) top = pick.get(top)!; pick.set(e, top); }
    for (const [e, t] of this.ties) if (t.snap < 0 && t.anchor.alive && pick.get(e) !== t.anchor) { t.strand.dispose(); this.ties.delete(e); }
    for (const [e, a] of pick) if (!this.ties.has(e)) this.ties.set(e, { anchor: a, strand: new Strand(this.game.renderer.scene, COLOR), snap: -1 });
  }

  // The group the aim is on: the body nearest the line of the aim.
  private aimed(bodies: Enemy[]): Enemy | null {
    const g = this.game;
    const origin = g.cam.isTop && g.cam.aimPoint ? null : g.player.eye();
    const dir = g.cam.aimDirection();
    let best: Enemy | null = null, bestD = 1.4;
    for (const e of bodies) {
      let d: number;
      if (!origin) d = g.cam.aimPoint!.clone().setY(e.position.y).distanceTo(e.position);
      else {
        const to = e.center().sub(origin);
        const along = to.dot(dir);
        if (along < 0 || along > 25) continue;
        d = to.addScaledVector(dir, -along).length();
      }
      if (d < bestD) { bestD = d; best = e; }
    }
    return best ? this.anchorOf(best) ?? best : null;
  }

  update(dt: number): void {
    const g = this.game;
    const cam = g.renderer.camera;
    const bodies = near(g.targets(), g.player.position, RANGE);
    this.regroup -= dt;
    if (this.regroup <= 0) { this.regroup = 0.3; this.group(bodies); }

    // An anchor that fell: its threads snap and what hung on it reels.
    for (const [e, t] of this.ties) {
      if (t.snap < 0 && !t.anchor.alive) {
        t.snap = 0.35;
        if (e.alive) e.stagger();
        g.audio.play('eye.thread.snap', { at: e.center() });
      }
    }
    const focus = this.aimed(bodies);
    const anchors = new Set<Enemy>();
    for (const [e, t] of this.ties) {
      if (e.disposed || !e.alive) { if (t.snap < 0 || e.disposed) { t.strand.dispose(); this.ties.delete(e); continue; } }
      if (t.snap >= 0) {
        t.snap -= dt;
        if (t.snap <= 0) { t.strand.dispose(); this.ties.delete(e); continue; }
        // A snapped thread whips back to the body that held it.
        const k = t.snap / 0.35;
        const end = e.center().lerp(t.anchor.center(), 1 - k);
        t.strand.set(end, e.center(), cam, 0.035, 0.6 * k, -0.15);
        continue;
      }
      anchors.add(t.anchor);
      const lit = focus === t.anchor;
      const carry = this.carries.find((c) => c.dep === e);
      t.strand.set(t.anchor.center(), e.center(), cam, lit ? 0.07 : 0.045, lit ? 0.9 : 0.5, 0.35, carry ? carry.t / TRAVEL : -1);
    }
    for (const a of anchors) {
      let k = this.knots.get(a);
      if (!k) { k = new GroundMark(g.renderer.scene, COLOR); this.knots.set(a, k); }
      const r = a.isBoss ? 0.95 : 0.7;
      k.set(a.position, { inner: r - 0.1, outer: r, fill: 0.35, line: 0.03 }, focus === a ? 0.95 : 0.6, 0);
    }
    for (const [a, k] of this.knots) if (!anchors.has(a)) { k.dispose(); this.knots.delete(a); }

    // Blows travelling down the threads arrive.
    for (let i = this.carries.length - 1; i >= 0; i--) {
      const c = this.carries[i]!;
      c.t += dt;
      if (c.t < TRAVEL) continue;
      this.carries.splice(i, 1);
      if (!c.dep.alive) continue;
      c.dep.hurt(c.amount, { from: c.anchor.position, stagger: false });
      g.combat.number(c.dep.center(), String(c.amount), CSS, false);
    }
    this.castThread(bodies);
  }

  private castThread(bodies: Enemy[]): void {
    const kuroda = bodies.find((e) => e.def.ai === 'kuroda' && e.state === 'cast');
    const at = kuroda ? (kuroda as Enemy & { fuelAt?: THREE.Vector3 }).fuelAt : undefined;
    if (!kuroda || !at) { this.fuel.hide(); return; }
    const k = Math.min(1, kuroda.stateTime / CAST_SECONDS);
    this.fuel.set(kuroda.center(), at.clone().add(new THREE.Vector3(0, 0.1, 0)), this.game.renderer.camera, 0.05, 0.75, 0.6, k);
  }

  dealt(e: Enemy): { mult: number } {
    return this.anchorOf(e) ? { mult: SHIELD } : NO_EFFECT;
  }

  landed(e: Enemy, amount: number): void {
    const deps = this.depsOf(e);
    if (!deps.length || amount <= 0) return;
    const n = Math.max(1, Math.round(amount * CARRY));
    for (const d of deps) this.carries.push({ anchor: e, dep: d, amount: n, t: 0 });
    this.game.audio.play('eye.thread.carry', { at: e.center() });
  }

  dispose(): void {
    for (const t of this.ties.values()) t.strand.dispose();
    for (const k of this.knots.values()) k.dispose();
    this.fuel.dispose();
    this.ties.clear(); this.knots.clear(); this.carries = [];
  }
}
