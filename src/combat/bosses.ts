import * as THREE from 'three';
import type { Game } from '../app/game';
import type { Mark } from '../techniques/mark';
import type { Enemy } from './enemies';
import { inAttack, markOrigin, type AttackDef } from './attacks';

export const DANGER = 0xe0382b;
const FUEL = 0x2c1f0c;
const FLAME = 0xff6a1a;
const MASTER = 0x7dffb2;
// Her echoes: a pale jade ghost of her, not a glow.
export const GHOST = 0x5fb893;

// The Kuroda Enforcer's cast (issue #11). The fight shows its lesson and
// never says it. He pours: a dark, iridescent sheen splashes out of his sweeping
// palm and runs along the ground from his feet to where the player stood,
// pooling there. Nothing burns yet. On the snap of his fingers a spark starts
// at his feet and runs the fuel line, the line burning behind it, and each
// pool goes up when the spark reaches it. Fire only ever stands where fuel
// lay, and it burns whoever is in it: his own men, and him.
//
// Hit him out of the cast before the snap and the fuel lies there unlit.
// Below half health he pours a line of three pools toward the player.
const SPARK_SPEED = 13;
const POOL = 2.3;

interface Pool { at: THREE.Vector3; patch: THREE.Mesh | null; mark: Mark | null; dist: number; lit: boolean }

export class Fuse {
  private t = 0;
  private pools: Pool[] = [];
  private snapAt: number | null = null;
  private line: THREE.Vector3[] = [];
  private hitPlayer = false;
  private burnedAlong = 0;
  done = false;

  constructor(private game: Game, private owner: Enemy, target: THREE.Vector3, count: number) {
    const from = owner.position.clone().setY(target.y);
    const dir = target.clone().sub(from).setY(0);
    const len = Math.max(2, dir.length());
    dir.normalize();
    // One pool at the player, or a line of them that ends a little past where they stand.
    for (let i = 0; i < count; i++) {
      const d = count === 1 ? len : THREE.MathUtils.lerp(Math.max(2.4, len - 3.6), len + 1.2, i / (count - 1));
      this.pools.push({ at: from.clone().addScaledVector(dir, d), patch: null, mark: null, dist: d, lit: false });
    }
    const far = this.pools[this.pools.length - 1]!.dist;
    for (let i = 0; i <= 8; i++) this.line.push(from.clone().addScaledVector(dir, 0.6 + (far - 0.6) * (i / 8)).setY(target.y + 0.07));
  }

  // The pour lands, pool by pool, a moment into the sweep.
  private pour(): void {
    const g = this.game;
    g.vfx.trail([...this.line].reverse(), FUEL, 0.4, 6);
    this.pools.forEach((p, i) => g.vfx.after(i * 0.1, () => {
      if (this.done) return;
      p.patch = g.vfx.patch(p.at, POOL, 'fuel', 6);
      // Droplets thrown with it.
      g.vfx.burst(p.at.clone().add(new THREE.Vector3(0, 0.5, 0)), 5, 'spark', 2.5, 0x5a4318);
      p.mark = g.vfx.mark({ kind: 'sector', radius: POOL, arc: Math.PI, inner: 0.9 }, DANGER, p.at, 0, 0.8);
    }));
    g.audio.play('kuroda.fuel', { at: this.pools[0]!.at });
  }

  // The snap: the spark sets off along the line.
  snap(): void {
    if (this.snapAt !== null || this.done) return;
    this.snapAt = this.t;
    const g = this.game;
    g.vfx.glint(this.owner.center().add(new THREE.Vector3(0, 0.3, 0)), 0.5, 0.2);
    g.vfx.flash(this.line[0]!.clone().add(new THREE.Vector3(0, 0.6, 0)), FLAME, 25, 0.3, 6);
  }

  // The pools not burning yet.
  get waiting(): THREE.Vector3[] { return this.pools.filter((p) => !p.lit).map((p) => p.at); }

  // Someone else's heat reaches a pool still waiting to burn: it goes up now,
  // and burns whoever stands in it, him included. How many pools it lit.
  light(at: THREE.Vector3, radius: number): number {
    if (this.done) return 0;
    let n = 0;
    for (const p of this.pools) if (!p.lit && p.patch && p.at.distanceTo(at) < radius + POOL * 0.5) { this.ignite(p); n++; }
    if (this.pools.every((p) => p.lit)) this.done = true;
    return n;
  }

  // Hit out of the cast before the snap: the fuel stays, unlit and harmless.
  fizzle(): void {
    if (this.snapAt !== null) return;
    this.done = true;
    for (const p of this.pools) p.mark?.cancel();
  }

  update(dt: number): void {
    if (this.done) return;
    const prev = this.t;
    this.t += dt;
    if (prev < 0.3 && this.t >= 0.3) this.pour();
    const g = this.game;
    // Before the snap, the rims fill slowly: it will burn, not yet when.
    if (this.snapAt === null) { for (const p of this.pools) if (p.mark) p.mark.progress = Math.min(0.5, (this.t - 0.3) * 0.5); return; }
    const run = (this.t - this.snapAt) * SPARK_SPEED;
    // The line burns behind the spark.
    const far = this.pools[this.pools.length - 1]!.dist;
    while (this.burnedAlong < Math.min(run, far)) {
      const at = this.pointAt(this.burnedAlong);
      g.vfx.flames(at, 0.12, 1, 0.45);
      g.vfx.burst(at.clone().add(new THREE.Vector3(0, 0.1, 0)), 1, 'spark', 1.5, 0xffd27a);
      this.burnedAlong += 0.7;
    }
    for (const p of this.pools) {
      if (p.lit) continue;
      if (p.mark) p.mark.progress = 0.5 + 0.5 * Math.min(1, run / p.dist);
      if (run >= p.dist) this.ignite(p);
    }
    if (this.pools.every((p) => p.lit)) this.done = true;
  }

  private pointAt(d: number): THREE.Vector3 {
    const a = this.line[0]!, b = this.line[this.line.length - 1]!;
    const len = a.distanceTo(b) || 1;
    return a.clone().lerp(b, THREE.MathUtils.clamp(d / len, 0, 1));
  }

  private ignite(p: Pool): void {
    const g = this.game, at = p.at;
    p.lit = true;
    p.mark?.fire();
    if (p.patch) g.vfx.endPatch(p.patch, 0.4);
    g.vfx.flames(at, POOL * 0.9, 16, 1.3);
    g.vfx.flash(at.clone().add(new THREE.Vector3(0, 1, 0)), FLAME, 45, 0.45, 10);
    g.vfx.burst(at.clone().add(new THREE.Vector3(0, 0.3, 0)), 10, 'spark', 6, 0xff8a2a);
    g.vfx.patch(at, POOL, 'burn', 20);
    g.audio.play('kuroda.ignite', { at });
    // Caught in it, the player gets the held frame; seen from outside it is only fire.
    if (!this.hitPlayer && g.player.position.distanceTo(at) < POOL + 0.2) {
      this.hitPlayer = true;
      if (g.combat.hurtPlayer(this.owner.dmg * 1.6, { from: at, kinetic: false }) > 0) g.renderer.impactFrame(2, new THREE.Color(FLAME), at.clone().add(new THREE.Vector3(0, 1, 0)));
    }
    for (const e of g.encounters.enemies) {
      if (!e.alive || e.position.distanceTo(at) >= POOL) continue;
      // It burns him like anyone else.
      e.hurt(e === this.owner ? 30 : 20, { from: at, knock: 3 });
      if (e === this.owner) g.combat.letter(e.center().add(new THREE.Vector3(0, 0.9, 0)), 'ボッ', FLAME, false);
    }
  }

  // The scene or the fight ended: drop the rims, leave the ground as it is.
  end(): void { this.done = true; for (const p of this.pools) p.mark?.cancel(); }
}

// The Master's blow echoes (issue #11: she feels ancient). Where her palm
// struck, the same blow comes again a beat later, from the spot and the
// heading she threw it at, whatever she does meanwhile: a ghost of her strike
// stands there and the mark refills. A player who stepped out of the first
// must step out again. That delayed second beat is the fight's rhythm.
export class Echo {
  private t = 0;
  private mark: Mark;
  done = false;

  constructor(private game: Game, private owner: Enemy, private attack: AttackDef, private from: THREE.Vector3, private yaw: number) {
    this.mark = game.vfx.mark(attack.shape, DANGER, markOrigin(attack, from, yaw), yaw, 0.75);
    game.vfx.afterimage(owner.avatar.root, GHOST, attack.echo!.delay + 0.15, false);
  }

  update(dt: number): void {
    if (this.done) return;
    this.t += dt;
    const delay = this.attack.echo!.delay;
    this.mark.progress = this.t / delay;
    if (this.t < delay) return;
    this.done = true;
    this.mark.fire();
    const g = this.game;
    g.vfx.ring(this.from.clone().add(new THREE.Vector3(0, 0.1, 0)), MASTER, 0.5, 7, 0.5);
    g.audio.play('enemy.palm', { at: this.from, pitch: 0.7 });
    if (inAttack(this.attack, this.from, this.yaw, g.player.position)) g.combat.hurtPlayer(this.owner.dmg * this.attack.echo!.dmg, { from: this.from.clone().setY(this.from.y + 1), kinetic: true });
  }

  end(): void { this.done = true; this.mark.cancel(); }
}
