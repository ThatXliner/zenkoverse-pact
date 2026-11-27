import * as THREE from 'three';
import { signal } from '@preact/signals';
import type { Game } from '../app/game';
import type { Gesture } from '../hands/gestures';
import type { Enemy } from './enemies';
import { MOVES } from './moves';
import { hasArea } from './field';
import { damageProp } from '../techniques/kits/shared';

// Bare hands: what everyone can do without a Technique. R throws a short
// combo, a jab, a cross and a hook; X draws part of the aura into one fist
// for a slower, heavier blow. Neither needs a Pact, and neither is meant to
// beat a Technique: they are how a Technique with no damage of its own
// still fights. Bodies can't be held by them either: each blow runs the
// flinch chain in src/combat/enemies.ts.
//
// How they share the hands: a Technique cast takes them at once (a blow in
// flight is dropped, before or after it lands), and a press during a cast
// waits `buffer` seconds for it to end. A dash drops a blow too, and a blow
// thrown from a dash keeps its speed. Taking a blow before your own lands
// knocks it aside. While the full sign plays, or a field is being pushed
// out, or a clash or a cutscene runs, the hands are not free. The only guard
// is the aura's: a settled field or body layer softens blows, and the aura
// strike goes through that and breaks it.

export type MeleeWeight = 'light' | 'heavy' | 'aura';

export interface BlowDef {
  name: 'jab' | 'cross' | 'hook' | 'strike';
  move: Gesture;
  weight: MeleeWeight;
  hand: 'l' | 'r';
  dmg: number;
  knock: number;
  lift: number;
  // Metres from the body's edge the fist reaches, and the most it steps in.
  reach: number;
  lunge: number;
  // Seconds into the blow when the next one may start.
  next: number;
  // The hit-stop when it lands.
  stop: number;
}

export const MELEE = {
  combo: [
    { name: 'jab', move: MOVES.punchJab, weight: 'light', hand: 'l', dmg: 4, knock: 1.5, lift: 0.2, reach: 1.25, lunge: 0.8, next: 0.2, stop: 0.03 },
    { name: 'cross', move: MOVES.punchCross, weight: 'light', hand: 'r', dmg: 5, knock: 2, lift: 0.3, reach: 1.3, lunge: 0.9, next: 0.24, stop: 0.04 },
    { name: 'hook', move: MOVES.punchHook, weight: 'heavy', hand: 'r', dmg: 9, knock: 3.8, lift: 1, reach: 1.4, lunge: 1.2, next: Infinity, stop: 0.075 },
  ] as const satisfies readonly BlowDef[],
  strike: { name: 'strike', move: MOVES.auraStrike, weight: 'aura', hand: 'r', dmg: 15, knock: 6.5, lift: 2.2, reach: 1.5, lunge: 1.5, next: Infinity, stop: 0.11 } as const satisfies BlowDef,
  // Seconds after a blow ends in which a press carries the combo on; after
  // the hook the hands come back to the guard (`rest`) before R throws again.
  chain: 0.4,
  rest: 0.3,
  // A press made while the hands are busy waits this long for them.
  buffer: 0.25,
  // Soft lock: a body within `range` m of the body's edge and `arc` radians
  // of the aim is faced and stepped toward, to `stand` m short of it.
  lock: { range: 2.8, arc: 0.9, stand: 0.95 },
  // A body's half-width, for reach.
  body: 0.36,
  // A boss takes this share of a bare-hand blow.
  boss: 0.6,
  // The aura strike costs `cost` of the pool, or `open` of an open field's
  // time (the aura is already out of the body, so it costs less). In the
  // body layer the fist is already wrapped: it lands `layer` x density
  // harder. In a field pushed out, the field's own sharpening applies
  // (src/combat/field.ts). It breaks a guard for `guard` seconds, adds
  // `poise` of its damage to a boss's posture, and needs `every` seconds
  // after one before the next.
  aura: { cost: 0.3, open: 0.12, layer: 0.5, guard: 1.5, poise: 1.5, every: 0.8 },
} as const;

export const meleeUi = {
  // When an aura strike was refused for want of aura (Date.now()).
  denied: signal(0),
};

interface Blow { def: BlowDef; index: number; t: number; landed: boolean; lock: Enemy | null; dir: THREE.Vector3; sparkT: number }
export interface BlowLog { blow: BlowDef['name']; target: string | null; amount: number; aura: number; t: number }

const INK = 0x17110c;
const UP = new THREE.Vector3(0, 1, 0);

export class Melee {
  private blow: Blow | null = null;
  // The next blow in the combo, and how long the combo stays open.
  private step = 0;
  private chainLeft = 0;
  private rest = 0;
  private strikeCd = 0;
  private queued: { kind: 'punch' | 'strike'; left: number } | null = null;
  private wasDashing = false;
  // Where the body faces while a blow is out (the target, else the aim).
  facing: number | null = null;
  // Every blow thrown and what it hit, for the checks.
  readonly log: BlowLog[] = [];
  thrown = 0;

  constructor(private game: Game) {}

  get busy(): boolean { return this.blow !== null; }
  get current(): { name: string; t: number; landed: boolean } | null { return this.blow && { name: this.blow.def.name, t: this.blow.t, landed: this.blow.landed }; }
  get nextBlow(): BlowDef['name'] { return MELEE.combo[this.chainLeft > 0 || this.blow ? this.step : 0]!.name; }

  // What the aura strike would cost now, as a share of what the meter shows, and whether there is that much.
  get strikeCost(): number { return this.game.aura.field.open ? MELEE.aura.open : MELEE.aura.cost; }
  get canStrike(): boolean { return this.game.aura.field.canDraw(this.strikeCost); }

  reset(): void {
    this.cancel();
    this.step = 0;
    this.chainLeft = this.rest = this.strikeCd = 0;
    this.queued = null;
  }

  // Drops the blow in flight. The aura of a strike not yet landed is not spent.
  cancel(): void {
    const b = this.blow;
    if (!b) return;
    this.blow = null;
    this.facing = null;
    this.step = 0;
    this.chainLeft = 0;
    if (this.game.techniques.casting) return;
    this.game.hands.stop();
    this.game.avatar.release(b.def.move);
  }

  struck(): void { if (this.blow && !this.blow.landed) this.cancel(); }

  // Whether the hands are free for a blow.
  private free(): boolean {
    const g = this.game;
    return !g.cutscenes.active && !g.techniques.casting && !g.techniques.signing && !g.aura.pushing && !g.aura.clash.active && !g.net?.downed;
  }

  update(dt: number, raw: number): void {
    const g = this.game, inp = g.input;
    this.rest = Math.max(0, this.rest - dt);
    this.strikeCd = Math.max(0, this.strikeCd - dt);
    if (!this.blow) this.chainLeft = Math.max(0, this.chainLeft - dt);
    // A Technique cast takes the hands; so does a dash.
    if (this.blow && g.techniques.casting) this.cancel();
    const dashing = g.player.dashTimer > 0;
    if (dashing && !this.wasDashing) this.cancel();
    this.wasDashing = dashing;
    if (inp.enabled && !g.cutscenes.active) {
      if (inp.hit('punch')) this.queued = { kind: 'punch', left: MELEE.buffer };
      if (inp.hit('strike')) {
        if (this.canStrike) this.queued = { kind: 'strike', left: MELEE.buffer };
        else this.deny();
      }
    }
    if (this.queued) {
      this.queued.left -= raw;
      if (this.tryStart(this.queued.kind)) this.queued = null;
      else if (this.queued.left <= 0) this.queued = null;
    }
    if (this.blow) this.advance(dt);
  }

  // Not enough aura: the fist stays empty, the meter shudders, and a dull note.
  private deny(): void {
    this.game.audio.play('aura.denied');
    meleeUi.denied.value = Date.now();
  }

  private tryStart(kind: 'punch' | 'strike'): boolean {
    if (!this.free()) return false;
    const b = this.blow;
    if (b && (!b.landed || b.t < b.def.next)) return false;
    if (kind === 'strike') {
      if (this.strikeCd > 0) return false;
      if (!this.canStrike) { this.deny(); return true; }
      this.begin(MELEE.strike, 3);
      return true;
    }
    if (this.rest > 0) return false;
    const i = b || this.chainLeft > 0 ? this.step : 0;
    this.begin(MELEE.combo[i]!, i);
    return true;
  }

  private begin(def: BlowDef, index: number): void {
    const g = this.game, me = g.player.position;
    const dir = this.aimDir();
    const lock = this.find(MELEE.lock.range, MELEE.lock.arc, dir);
    if (lock) {
      dir.set(lock.position.x - me.x, 0, lock.position.z - me.z);
      const gap = dir.length() - MELEE.body;
      dir.normalize();
      const step = THREE.MathUtils.clamp(gap - MELEE.lock.stand, 0, def.lunge);
      if (step > 0.05) g.player.lunge(dir.clone().multiplyScalar(step), def.move.impactAt);
    } else g.player.lunge(dir.clone().multiplyScalar(def.lunge * 0.3), def.move.impactAt);
    this.facing = Math.atan2(-dir.x, -dir.z);
    this.blow = { def, index, t: 0, landed: false, lock, dir, sparkT: 0 };
    this.step = index >= 0 && index < 2 ? index + 1 : 0;
    this.chainLeft = 0;
    this.thrown++;
    g.hands.play(def.move, 1, () => undefined, (k) => g.cam.kick(k), false);
    g.avatar.perform(def.move, 1);
    g.net?.blow(index, dir);
    if (def.weight === 'aura') {
      g.audio.play('melee.gather');
      // The fist lights: a star on it and the aura's light round it, until the blow.
      g.vfx.glint(this.fist(def.hand), 0.45, def.move.impactAt + 0.05, () => this.fist(def.hand));
      g.vfx.flash(this.fist(def.hand), g.aura.colorOf(null), 1.6, def.move.impactAt, 3.5);
      for (const e of g.encounters.enemies) if (e.position.distanceTo(me) < 4.5) e.threatened();
    } else g.audio.play('melee.swing', { pitch: def.weight === 'heavy' ? 0.8 : index === 0 ? 1.12 : 1 });
  }

  private advance(dt: number): void {
    const b = this.blow!, g = this.game;
    b.t += dt;
    if (b.def.weight === 'aura' && !b.landed) {
      // The fist fills: the hands take the colour in first person, and sparks
      // of it leave the fist for everyone else.
      const color = g.aura.colorOf(null), u = Math.min(1, b.t / b.def.move.impactAt);
      g.hands.flare(color, 0.3 + 0.7 * u);
      if ((b.sparkT -= dt) <= 0) {
        b.sparkT = 0.12;
        const at = this.fist('r');
        g.vfx.ring(at, color, 0.28 - 0.12 * u, 0.06, 0.12, b.dir, 0.8);
        g.vfx.burst(at, 1, 'spark', 0.3, color);
      }
    }
    if (!b.landed && b.t >= b.def.move.impactAt) this.land(b);
    if (this.blow !== b) return;
    if (b.def.weight === 'aura' && b.landed && b.t < b.def.move.impactAt + 0.12) g.hands.flare(g.aura.colorOf(null), 1);
    if (b.t >= b.def.move.duration) this.end(b);
  }

  private end(b: Blow): void {
    this.blow = null;
    this.facing = null;
    if (b.def.weight === 'aura') { this.strikeCd = MELEE.aura.every; this.step = 0; return; }
    if (b.index === 2) { this.rest = MELEE.rest; this.step = 0; return; }
    this.chainLeft = MELEE.chain;
  }

  // The blow lands: on the body it locked to if that is still in reach, else
  // on whoever stands in reach along the aim.
  private land(b: Blow): void {
    const g = this.game, def = b.def, me = g.player.position;
    b.landed = true;
    const aura = def.weight === 'aura';
    // The strike takes its aura as it lands; if the aura went elsewhere in
    // the meantime, it lands as a plain heavy blow.
    const drew = aura && g.aura.field.canDraw(this.strikeCost);
    const layer = drew && g.aura.field.open && !hasArea(g.aura.field.radius) ? g.aura.field.density : 0;
    if (drew) g.aura.field.draw(this.strikeCost);
    const target = b.lock && this.inReach(b.lock, def.reach + 0.45) ? b.lock : this.find(def.reach + 0.2, 0.8, b.dir);
    const fist = this.fist(def.hand);
    const color = g.aura.colorOf(null);
    let dealt = 0;
    if (target) {
      const amount = def.dmg * (target.isBoss ? MELEE.boss : 1) * (1 + MELEE.aura.layer * layer);
      const contact = target.center().lerp(fist, 0.35);
      dealt = g.combat.hitEnemy(target, amount, {
        from: me, knock: def.knock, lift: def.lift, kind: 'kinetic', melee: def.weight, stop: def.stop,
        heavy: drew, pierce: drew, poise: drew ? MELEE.aura.poise : 0, word: drew ? 'DON' : undefined, color: drew ? color : undefined,
      });
      if (drew && target.alive && target.def.ai !== 'rival') target.guardBroken = Math.max(target.guardBroken, MELEE.aura.guard);
      g.vfx.burst(contact, def.weight === 'light' ? 4 : 8, 'spark', def.weight === 'light' ? 2.5 : 4, drew ? color : 0xfff0d0, b.dir);
      // The blow's star where it lands, as a panel inks a contact.
      if (!drew) g.vfx.ring(contact, 0xffffff, 0.05, def.weight === 'light' ? 0.45 : 0.8, def.weight === 'light' ? 0.1 : 0.16, b.dir, 1);
      if (def.weight === 'heavy') g.cam.shake(0.16);
    }
    this.shoveProps(b, drew);
    // The fist's path: an ink smear from the shoulder out past the reach.
    const shoulder = me.clone().add(new THREE.Vector3(0, 1.4, 0)).addScaledVector(new THREE.Vector3(-b.dir.z, 0, b.dir.x), def.hand === 'r' ? 0.2 : -0.2);
    const far = shoulder.clone().addScaledVector(b.dir, def.reach + MELEE.body + 0.3).setY(shoulder.y - 0.1);
    g.vfx.trail(def.name === 'hook' ? [shoulder.clone().addScaledVector(new THREE.Vector3(-b.dir.z, 0, b.dir.x), 0.4), shoulder.clone().lerp(far, 0.6).addScaledVector(new THREE.Vector3(-b.dir.z, 0, b.dir.x), 0.15), far] : [shoulder, shoulder.clone().lerp(far, 0.5), far], drew ? color : INK, def.weight === 'light' ? 0.22 : 0.34, 0.14);
    if (drew) this.burst(b, target, fist, color);
    this.log.push({ blow: def.name, target: target?.key ?? null, amount: dealt, aura: drew ? this.strikeCost : 0, t: g.clock.time });
    if (this.log.length > 64) this.log.shift();
  }

  // The aura leaves the fist: a ring standing across the blow's line where it
  // lands, one on the ground under it, an inked frame, and the sound.
  private burst(b: Blow, target: Enemy | null, fist: THREE.Vector3, color: number): void {
    const g = this.game;
    const at = target ? target.center().lerp(fist, 0.3) : fist.clone().addScaledVector(b.dir, 0.6);
    g.vfx.ring(at, color, 0.15, target ? 1.9 : 1.2, 0.32, b.dir, 1);
    g.vfx.ring(at, 0xffffff, 0.1, target ? 1.1 : 0.7, 0.2, b.dir, 0.9);
    const feet = (target ? target.position : g.player.position.clone().addScaledVector(b.dir, 1.4)).clone().setY((target ?? g.player).position.y + 0.07);
    g.vfx.ring(feet, color, 0.3, target ? 2.8 : 1.6, 0.5, UP, 0.7);
    g.vfx.burst(at, 10, 'spark', 5, color, b.dir);
    g.vfx.flash(at, color, 2.5, 0.2, 6);
    g.audio.play('melee.strike', { at });
    if (!target) g.renderer.impactFrame(1, new THREE.Color(color), at);
    g.cam.shake(target ? 0.3 : 0.15);
    g.cam.kick({ fov: target ? 7 : 4, pitch: 0.015 });
  }

  // Loose props in front of the fist are knocked away; an aura strike breaks what can break.
  private shoveProps(b: Blow, drew: boolean): void {
    const g = this.game, me = g.player.position, def = b.def;
    for (const p of g.props.instances) {
      const to = p.mesh.position.clone().sub(me).setY(0);
      const d = to.length();
      if (d > def.reach + 0.8 || d < 0.01 || to.normalize().dot(b.dir) < 0.6 || Math.abs(p.mesh.position.y - me.y - 1) > 1.3) continue;
      g.props.push(p, b.dir.clone().setY(0.3).multiplyScalar(p.def.mass * (drew ? 5 : def.weight === 'heavy' ? 2.5 : 1.2)));
      if (drew || def.weight === 'heavy') damageProp(g, p, drew ? 40 : 10, me);
    }
  }

  private inReach(e: Enemy, reach: number): boolean {
    const me = this.game.player.position;
    return e.alive && !e.disposed && Math.abs(e.position.y - me.y) < 1.6 && Math.hypot(e.position.x - me.x, e.position.z - me.z) - MELEE.body <= reach;
  }

  // The body nearest the aim within `range` m of the body's edge and `arc` of the aim.
  private find(range: number, arc: number, dir: THREE.Vector3): Enemy | null {
    const g = this.game, me = g.player.position;
    let best: Enemy | null = null, score = Infinity;
    for (const e of g.targets()) {
      if (!this.inReach(e, range) || g.aura.clash.involves(e)) continue;
      const dx = e.position.x - me.x, dz = e.position.z - me.z, d = Math.hypot(dx, dz);
      const ang = d < 0.05 ? 0 : Math.acos(THREE.MathUtils.clamp((dx * dir.x + dz * dir.z) / d, -1, 1));
      if (ang > arc) continue;
      const s = d + ang * 1.5;
      if (s < score) { score = s; best = e; }
    }
    return best;
  }

  // Flat, along the aim: under the cursor top-down, else the crosshair's heading.
  private aimDir(): THREE.Vector3 {
    const g = this.game, me = g.player.position;
    if (g.cam.isTop && g.cam.floorPoint) {
      const v = g.cam.floorPoint.clone().sub(me).setY(0);
      if (v.lengthSq() > 0.04) return v.normalize();
    }
    const d = g.cam.aimDirection().setY(0);
    return d.lengthSq() > 1e-4 ? d.normalize() : new THREE.Vector3(-Math.sin(g.cam.yaw), 0, -Math.cos(g.cam.yaw));
  }

  // Where a fist is in the world: on the body's hand, or in first person,
  // where the hand is drawn in front of the eye.
  private fist(hand: 'l' | 'r'): THREE.Vector3 {
    const g = this.game;
    if (g.cam.isFirst) {
      const aim = g.cam.aimDirection();
      const right = new THREE.Vector3().crossVectors(aim, UP).normalize();
      return g.player.eye().addScaledVector(aim, 0.75).addScaledVector(right, hand === 'r' ? 0.12 : -0.12).add(new THREE.Vector3(0, -0.22, 0));
    }
    return g.avatar.boneWorld(`hand_${hand}`, new THREE.Vector3());
  }
}
