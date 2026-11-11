import * as THREE from 'three';
import type { Game } from '../../app/game';
import type { AbilityContext } from '../kit';
import { restriction } from '../../pacts/schema';
import type { PropInstance } from '../../world/props';
import { variants, type Gesture, type GestureKey, type GestureSet } from '../../hands/gestures';
import type { Enemy } from '../../combat/enemies';

export function gestureSet(duration: number, impactAt: number, keys: GestureKey[], hold = false): GestureSet {
  const long: Gesture = { duration, impactAt, keys, hold };
  return variants(long);
}

// Range in metres from the Pact's range restriction, the kit's base, and the
// Range mastery stat. A Pact that gives up range gets it back as potency.
export function rangeFor(ctx: AbilityContext, base: number): number {
  const r = ctx.pact ? restriction(ctx.pact, 'range') : undefined;
  const m = 1 + ctx.game.mastery.get(ctx.game.techniqueId, 'range') * 0.5;
  const f = r === 'touch' ? 0.35 : r === 'short' ? 0.6 : r === 'medium' ? 1 : r === 'long' ? 1.5 : 1;
  return base * f * m;
}

export function frontOnly(ctx: AbilityContext): boolean {
  return ctx.pact ? restriction(ctx.pact, 'direction') === 'front' : false;
}

export function targetsAllowed(ctx: AbilityContext): { people: boolean; props: boolean; single: boolean } {
  const t = ctx.pact ? restriction(ctx.pact, 'target') : undefined;
  return { people: t !== 'props', props: t !== 'people', single: t === 'single' || t === 'named' };
}

export function hitCone(ctx: AbilityContext, range: number, halfAngle: number, dmg: number, opts: { knock?: number; lift?: number; kind?: 'kinetic' | 'cold' | 'pulse' | 'resonance' | 'cut'; heavy?: boolean } = {}): Enemy[] {
  const g = ctx.game;
  const allow = targetsAllowed(ctx);
  if (!allow.people) return [];
  let list = g.techniques.enemiesInCone(ctx.origin, ctx.dir, range, halfAngle);
  if (allow.single && list.length > 1) list = [list.sort((a, b) => a.position.distanceTo(ctx.origin) - b.position.distanceTo(ctx.origin))[0]!];
  for (const e of list) g.combat.hitEnemy(e, dmg, { from: ctx.origin, knock: opts.knock, lift: opts.lift, kind: opts.kind, heavy: opts.heavy });
  return list;
}

export function propsInCone(g: Game, origin: THREE.Vector3, dir: THREE.Vector3, range: number, halfAngle: number): PropInstance[] {
  return g.props.instances.filter((p) => {
    const to = p.mesh.position.clone().sub(origin);
    const d = to.length();
    return d < range && to.normalize().dot(dir) > Math.cos(halfAngle);
  });
}

export function shoveProps(ctx: AbilityContext, props: PropInstance[], impulse: number, lift = 0.4): number {
  const allow = targetsAllowed(ctx);
  if (!allow.props) return 0;
  let n = 0;
  for (const p of props) {
    const dir = p.mesh.position.clone().sub(ctx.origin).normalize().lerp(ctx.dir, 0.5).normalize();
    dir.y += lift;
    p.body.wakeUp();
    p.body.applyImpulse(dir.multiplyScalar(impulse * p.def.mass), true);
    p.body.applyTorqueImpulse({ x: (Math.random() - 0.5) * impulse * 0.4, y: (Math.random() - 0.5) * impulse * 0.4, z: (Math.random() - 0.5) * impulse * 0.4 }, true);
    damageProp(ctx.game, p, impulse * 2.5, ctx.origin);
    n++;
  }
  return n;
}

export function damageProp(g: Game, p: PropInstance, amount: number, from?: THREE.Vector3): void {
  if (!p.def.breakable || !p.alive) return;
  p.hp -= amount;
  if (p.hp <= 0) breakProp(g, p, from);
}

// Pre-broken pieces: debris of the prop's material fanning from the hit.
export function breakProp(g: Game, p: PropInstance, from?: THREE.Vector3): void {
  if (!p.alive) return;
  const c = p.mesh.position.clone();
  const dir = from ? c.clone().sub(from).setY(0.3).normalize() : undefined;
  const wood = p.def.traits.includes('wood') || p.def.traits.includes('porous');
  g.vfx.burst(c, p.def.breakable?.pieces ?? 5, 'debris', 5, wood ? undefined : 0x888c92, dir);
  g.vfx.burst(c, 8, 'spark', 4, wood ? 0xd8a060 : 0xfff0c0, dir);
  g.audio.play(wood ? 'impactWood_heavy_001' : 'impactMetal_heavy_001', 0.7, 0.9 + Math.random() * 0.2);
  g.props.remove(p);
}

export function spawnDebrisAt(g: Game, at: THREE.Vector3, n: number, color?: number): void { g.vfx.burst(at, n, 'debris', 4, color); }
