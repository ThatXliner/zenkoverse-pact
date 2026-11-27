import * as THREE from 'three';
import { signal } from '@preact/signals';
import type { TechniqueKit, AbilityContext } from '../kit';
import type { Game } from '../../app/game';
import { signGesture, gestureSet, rangeFor, damageProp, frontOnly, targetsAllowed } from './shared';
import { restriction, type Pact } from '../../pacts/schema';
import type { Enemy } from '../../combat/enemies';
import type { PropInstance } from '../../world/props';
import { opening, blow, type CutsceneDef } from '../../cutscene/cutscene';
import { GROUP_WORLD } from '../../physics/world';
import { surfaceAt } from '../../audio/surfaces';
import { worldRuns } from '../../app/state';
import { kaeshi, showStation } from '../../drills/kaeshi';
import { DarkPanel, type DarkStore } from './DarkHud';
import { kindle } from '../ignition';

// Dark Dimension (蔵): the user moves nonliving things between the world and
// a private, timeless space. Nothing is made, lost or copied: a sealed prop
// is the same prop, out of the world until it is let out again. Time does
// not pass inside, so a thing comes back exactly as it went in: as hot, as
// frozen, and moving as fast and in the same direction as it was. Where it
// comes out is the user's choice; which way it goes is not. The skill is
// placing the exit so the stored motion carries it where it should go.
// Living things cannot enter. Each transfer shuts the gate for a while, the
// longer the heavier the thing. When the bearer falls, everything stored
// comes back at once, still moving.

const COLOR = 0x5b6cff;
const INK = 0x17110c;
const WATER = 0x8ad0ea;
const FLAME = 0xff6a1a;

// What the dimension keeps unless a Pact says less.
const CAPACITY = 5;
// One hand lifts this much; a Pact that keeps only light things keeps nothing heavier.
const LIGHT_MASS = 10;
// A thing moving faster than this is too fast for the seam to close round it at
// that speed: it goes in at this speed. Nothing loops past it.
const MAX_SPEED = 22;
// Below this speed a thing is at rest, for a Pact that takes only what is still.
const STILL_SPEED = 1;
// A summoned thing strikes what it meets for this long.
const FLIGHT = 2.5;
// The things that are not props: the Kuroda's fuel, his fire while it is
// fresh, and a body of water. Each is put away whole and let out whole.
const MASS = { fuel: 12, fire: 2, water: 30 } as const;

export type Kept =
  | { kind: 'prop'; prop: PropInstance }
  | { kind: 'fuel' }
  | { kind: 'fire' }
  | { kind: 'water' };

const catalogue: Pact[] = [
  { id: 'dark.seal', technique: 'dark', name: 'Seal', slot: 'primary', grant: { shape: 'seal', behaviors: ['catch'] }, clauses: [
    { kind: 'restrict', restriction: { param: 'storage', value: 'three' } }, { kind: 'restrict', restriction: { param: 'range', value: 'medium' } }] },
  { id: 'dark.summon', technique: 'dark', name: 'Summon', slot: 'secondary', grant: { shape: 'summon' }, clauses: [
    { kind: 'restrict', restriction: { param: 'direction', value: 'front' } }, { kind: 'restrict', restriction: { param: 'trigger', value: 'grounded' } }] },
  // The wiki's Arsenal: Programming that files what is stored and calls the
  // right thing without a search. Written to fire on its own when struck.
  { id: 'dark.arsenal', technique: 'dark', name: 'Arsenal', slot: 'art1', grant: { shape: 'arsenal' }, clauses: [
    { kind: 'restrict', restriction: { param: 'range', value: 'short' } }, { kind: 'restrict', restriction: { param: 'resource', value: 'strain' } },
    { kind: 'program', when: 'struck', then: 'activate' }] },
  { id: 'dark.open-estate', technique: 'dark', name: 'Open Estate', slot: 'max', grant: { shape: 'estate' }, clauses: [
    { kind: 'restrict', restriction: { param: 'resource', value: 'all' } }, { kind: 'restrict', restriction: { param: 'body', value: 'bothHands' } }, { kind: 'restrict', restriction: { param: 'trigger', value: 'declared' } }] },
];

// Open Estate: the sign close, then the page goes black as every seam opens
// at once, and a high look down on the target as what was kept comes out at it.
const cutscene: CutsceneDef = {
  id: 'max-dark', title: { jp: '遺産開放', en: 'Open Estate' }, color: COLOR, pull: 3.4, reach: 12, word: 'ドォォン',
  shots: [
    { duration: 1.05, timeScale: 0.03, from: { pos: [-0.9, 1.4, 1.9], look: [0, 1.3, 0], fov: 38 }, to: { pos: [-0.62, 1.38, 1.45], fov: 31, roll: 0.04 }, events: opening('dark.max.charge') },
    { duration: 0.55, timeScale: 0.03, from: { pos: [0.6, 1.6, -0.5], look: [0, 1.2, 0], lookRel: 'target', fov: 46, roll: -0.05 }, to: { pos: [0.5, 1.55, -0.25], fov: 38, roll: -0.09 }, ease: 'in', events: [{ at: 0.05, kind: 'sfx', id: 'dark.max.inhale' }], page: { look: 'negative', lines: 'focus' } },
    { duration: 0.95, timeScale: 0.3, from: { rel: 'mid', pos: [-4.2, 5.4, -3.0], look: [0, 0.6, 0], fov: 60, roll: 0.05 }, to: { pos: [-5.0, 6.2, -3.8], fov: 66 }, events: [...blow(0, 'dark.max.blow', 0.85)], page: { lines: 'focus' } },
    { duration: 0.8, timeScale: 0.5, from: { rel: 'target', pos: [1.8, 0.7, -1.9], look: [0, 1.0, 0], fov: 50 }, to: { pos: [2.1, 0.9, -2.4], fov: 46 }, ease: 'inOut' },
  ],
};

// ---------------------------------------------------------------- state
// `prev` and `was` are where it was and how fast last frame: a blow that
// bounces it within one physics step still counts at the speed it arrived with.
interface Flying { prop: PropInstance; t: number; potency: number; hit: Set<Enemy>; prev: THREE.Vector3; was: number }
interface Fuel { at: THREE.Vector3; mesh: THREE.Mesh; left: number }

// What is kept, in the order it went in. Summon lets the last one out first.
const store: Kept[] = [];
// The gate stays shut this long after a transfer, longer for a heavier thing.
let gate = 0;
// Open Estate letting everything out: nothing goes back in until it is done.
let estate = 0;
const flying: Flying[] = [];
const fuels: Fuel[] = [];
// A blow dealt by something summoned, for the drill to tell it from any other.
let striking = false;
let lastStrike: { e: Enemy; speed: number; t: number } | null = null;
// The last exit and the motion it was given, for the checks.
let lastExit: { at: THREE.Vector3; vel: THREE.Vector3 } | null = null;

export const darkUi = { store: signal<DarkStore[]>([]), next: signal(-1), gate: signal(0) };

const control = (g: Game): number => g.mastery.get('dark', 'control');
const massOf = (k: Kept): number => (k.kind === 'prop' ? k.prop.def.mass : MASS[k.kind]);
const halfOf = (k: Kept): THREE.Vector3 => (k.kind === 'prop' ? k.prop.half : k.kind === 'water' ? new THREE.Vector3(0.7, 0.7, 0.7) : new THREE.Vector3(0.5, 0.2, 0.5));
const motionOf = (k: Kept): THREE.Vector3 => (k.kind === 'prop' && k.prop.sealed ? k.prop.sealed.vel : new THREE.Vector3());
// The gate after a transfer: a can is nothing, a barrel a long breath. Control shortens it.
const lockFor = (g: Game, mass: number): number => (0.12 + mass * 0.034) * (1 - control(g) * 0.45);
const capacityOf = (pact: Pact | null): number => { const s = pact ? restriction(pact, 'storage') : undefined; return s === 'one' ? 1 : s === 'three' ? 3 : CAPACITY; };

// Open water under a point: the koi pond, a stream, a canal.
function isWater(g: Game, at: THREE.Vector3): boolean {
  const pond = g.world.pond;
  if (Math.hypot(at.x - pond.center.x, at.z - pond.center.z) < pond.radius && at.y < pond.surfaceY + 0.3) return true;
  if (g.world.waters.some((w) => w.kind === 'channel' && at.x > w.x0 && at.x < w.x1 && at.z > w.z0 && at.z < w.z1 && at.y < w.surfaceY + 0.3)) return true;
  return surfaceAt(at, '') === 'water';
}
function speedOf(p: PropInstance): number { const v = p.body.linvel(); return Math.hypot(v.x, v.y, v.z); }
function groundUnder(g: Game, at: THREE.Vector3): number {
  const hit = g.physics.castRay(new THREE.Vector3(at.x, at.y + 1.5, at.z), new THREE.Vector3(0, -1, 0), 12, GROUP_WORLD);
  return hit ? hit.point.y : at.y;
}

// A seam opening on `at`, sized to what passes through it, and the air
// around it: drawn in when something goes in (ink lines and a ring closing on
// the seam), thrown out when something comes out.
function seamAt(g: Game, at: THREE.Vector3, half: THREE.Vector3, life = 0.5, out = false): void {
  const size = Math.max(half.x, half.y, half.z);
  g.vfx.seam(at, size * 2 + 0.45, size * 3.4 + 0.8, COLOR, life);
  g.vfx.ring(at.clone(), COLOR, out ? 0.3 : 2.4, out ? 2.6 : 0.2, life * 0.8);
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + Math.random() * 0.4;
    const dir = new THREE.Vector3(Math.cos(a), Math.sin(a) * 0.5, Math.sin(a) * 0.9).normalize();
    const near = at.clone().addScaledVector(dir, size + 0.25), far = at.clone().addScaledVector(dir, size + 1.4 + Math.random() * 0.6);
    g.vfx.trail(out ? [near, far] : [far, near], INK, 0.07, life * 0.6);
  }
}

// The seam opens and finds nothing it may take, or the gate is still shut:
// it gutters out where it was cut.
function fizzle(g: Game, at: THREE.Vector3, why: 'empty' | 'shut' | 'full' | 'living'): void {
  g.vfx.seam(at, 0.18, why === 'living' ? 1.2 : 0.7, why === 'living' ? 0xd8342a : COLOR, why === 'living' ? 0.3 : 0.22);
  g.vfx.trail([at.clone().add(new THREE.Vector3(0, 0.4, 0)), at.clone().add(new THREE.Vector3(0, -0.4, 0))], INK, 0.05, 0.2);
  g.audio.play(why === 'living' ? 'dark.refuse' : 'dark.fizzle', { at });
}

// ---------------------------------------------------------------- Seal
// What the seam is cut on: whatever is nearest the line from the eye to the
// aim, within reach. A thing in flight is easier to find for a Pact that catches.
function sealTarget(ctx: AbilityContext, range: number): { kind: 'prop'; prop: PropInstance; d: number } | { kind: 'body'; e: Enemy; d: number } | null {
  const g = ctx.game, o = ctx.origin;
  const aim = ctx.aim ?? o.clone().addScaledVector(ctx.dir, range);
  const along = aim.clone().sub(o);
  const len = Math.min(range + 1.5, along.length() + 1.5);
  along.normalize();
  const offLine = (p: THREE.Vector3): { d: number; t: number } => {
    const t = THREE.MathUtils.clamp(p.clone().sub(o).dot(along), 0, len);
    return { d: o.clone().addScaledVector(along, t).distanceTo(p), t };
  };
  const catches = ctx.behaviors.includes('catch');
  const allow = targetsAllowed(ctx);
  let best: { kind: 'prop'; prop: PropInstance; d: number } | { kind: 'body'; e: Enemy; d: number } | null = null;
  if (allow.props) for (const p of g.props.instances) {
    if (!p.alive || p.mesh.position.distanceTo(o) > range + Math.max(p.half.x, p.half.z)) continue;
    const { d } = offLine(p.mesh.position);
    const reach = 0.9 + Math.max(p.half.x, p.half.y, p.half.z) + (catches && speedOf(p) > 3 ? 1.2 : 0);
    if (d < reach && (!best || d < best.d)) best = { kind: 'prop', prop: p, d };
  }
  if (allow.people) for (const e of g.techniques.enemiesInSphere(o, range + 0.5)) {
    const { d } = offLine(e.center());
    if (d < 0.7 && (!best || d < best.d - 0.2)) best = { kind: 'body', e, d };
  }
  return best;
}

function seal(ctx: AbilityContext): number {
  const g = ctx.game;
  const range = rangeFor(ctx, 9);
  const aim = ctx.aim ?? ctx.origin.clone().addScaledVector(ctx.dir, range);
  const near = aim.distanceTo(ctx.origin) > range ? ctx.origin.clone().addScaledVector(aim.clone().sub(ctx.origin).normalize(), range) : aim;
  if (gate > 0 || estate > 0) { fizzle(g, near, 'shut'); return 0; }
  const cap = capacityOf(ctx.pact);
  const kind = ctx.pact ? restriction(ctx.pact, 'storage') : undefined;
  const target = sealTarget(ctx, range);
  // Living things cannot enter: the seam closes on the body, will not take
  // it, and throws it off. It is all the Technique does to a person directly.
  if (target?.kind === 'body') {
    const e = target.e;
    fizzle(g, e.center(), 'living');
    g.combat.hitEnemy(e, 6 * ctx.potency, { from: ctx.origin, knock: 3.5, lift: 0.8, kind: 'kinetic' });
    return 1;
  }
  if (target) {
    const p = target.prop;
    const speed = speedOf(p);
    if (store.length >= cap) { fizzle(g, p.mesh.position.clone(), 'full'); return 0; }
    if (kind === 'light' && p.def.mass > LIGHT_MASS) { fizzle(g, p.mesh.position.clone(), 'empty'); return 0; }
    if (kind === 'still' && speed > STILL_SPEED) { fizzle(g, p.mesh.position.clone(), 'empty'); return 0; }
    const at = p.mesh.position.clone();
    const v = p.body.linvel(), w = p.body.angvel();
    const vel = new THREE.Vector3(v.x, v.y, v.z);
    if (vel.length() > MAX_SPEED) vel.setLength(MAX_SPEED);
    // Claim it first, online, so it is this player's to take out of the room's world.
    g.props.touch(p);
    g.props.seal(p, vel, new THREE.Vector3(w.x, w.y, w.z));
    for (let i = flying.length - 1; i >= 0; i--) if (flying[i]!.prop === p) flying.splice(i, 1);
    store.push({ kind: 'prop', prop: p });
    gate = lockFor(g, p.def.mass);
    seamAt(g, at, p.half, 0.42);
    if (speed > 3) g.vfx.trail([at.clone().addScaledVector(vel.clone().normalize(), -1.4), at], COLOR, Math.max(p.half.x, p.half.y) * 1.2, 0.3);
    g.audio.play('dark.seal', { at });
    g.drills.notify(p, 'caught');
    g.mastery.gainPassive('dark', 'precision', 0.003);
    return 0;
  }
  // No prop on the line: the Kuroda's pour, or open water.
  if (!targetsAllowed(ctx).props) { fizzle(g, near, 'empty'); return 0; }
  if (store.length >= cap) { fizzle(g, near, 'full'); return 0; }
  for (const e of g.encounters.enemies) {
    const took = e.takeFuel(near, 1.2).slice(0, cap - store.length);
    if (!took.length) continue;
    for (const t of took) store.push({ kind: t });
    gate = lockFor(g, MASS.fuel);
    g.vfx.seam(near.clone().add(new THREE.Vector3(0, 0.6, 0)), 1.6, 2.6, COLOR, 0.45);
    g.audio.play('dark.seal', { at: near });
    return 0;
  }
  const ground = new THREE.Vector3(near.x, groundUnder(g, near), near.z);
  if (kind !== 'light' && isWater(g, ground) && ground.distanceTo(ctx.origin) <= range + 1) {
    store.push({ kind: 'water' });
    gate = lockFor(g, MASS.water);
    g.vfx.seam(ground.clone().add(new THREE.Vector3(0, 0.5, 0)), 1.4, 2.2, COLOR, 0.45);
    g.vfx.ring(ground.clone().add(new THREE.Vector3(0, 0.05, 0)), WATER, 1.2, 0.2, 0.4);
    g.vfx.burst(ground.clone().add(new THREE.Vector3(0, 0.2, 0)), 8, 'spark', 3, WATER);
    g.audio.play('dark.seal', { at: ground });
    return 0;
  }
  fizzle(g, near, 'empty');
  return 0;
}

// ---------------------------------------------------------------- Summon
// Where a thing comes out for an aim: at the aim, within reach of the eye,
// at least chest high over the floor there (higher for a Pact that drops it
// from above), and never inside a wall.
export function exitFor(g: Game, aim: THREE.Vector3, k: Kept, range: number, overhead = false): THREE.Vector3 {
  const eye = g.player.eye(), half = halfOf(k);
  const at = aim.clone();
  const off = at.clone().sub(eye);
  if (off.length() > range) at.copy(eye).add(off.setLength(range));
  // Off the face it was aimed at, toward the bearer.
  const back = eye.clone().sub(at).setY(0);
  if (back.lengthSq() > 1e-4) at.addScaledVector(back.normalize(), Math.min(back.length(), Math.max(half.x, half.z) + 0.15));
  const floor = groundUnder(g, at);
  at.y = Math.max(at.y, floor + Math.max(half.y + 0.35, 1.25)) + (overhead ? 4 : 0);
  // Inside a wall or under eaves: nearer the bearer first, then higher.
  const size = Math.min(half.x, half.y, half.z) * 0.9;
  const blocked = (p: THREE.Vector3): boolean => g.physics.bodiesInSphere(p, size, GROUP_WORLD).length > 0;
  const toward = eye.clone().sub(at).setY(0);
  const room = toward.length();
  toward.normalize();
  for (let d = 0; d < room && blocked(at); d += 0.4) at.addScaledVector(toward, Math.min(0.4, room - d));
  for (let i = 0; i < 6 && blocked(at); i++) at.y += 0.4;
  return at;
}

// The exit `back` metres up the path that a motion `v` would take through
// `c`, raised for the drop it makes on the way, so the path runs through `c`.
// Nearer, if a wall or a roof stands where it would open.
function behind(g: Game, c: THREE.Vector3, v: THREE.Vector3, back: number, size = 0.4): THREE.Vector3 {
  let at = c.clone();
  for (let d = back; d >= 0.8; d -= 0.6) {
    const t = d / Math.max(1, v.length());
    at = c.clone().addScaledVector(v, -t).add(new THREE.Vector3(0, 4.9 * t * t, 0));
    const floor = groundUnder(g, at);
    if (at.y < floor + 0.4) at.y = floor + 0.4;
    const clear = !g.physics.bodiesInSphere(at, size, GROUP_WORLD).length && !g.physics.castRay(c, at.clone().sub(c).normalize(), at.distanceTo(c), GROUP_WORLD);
    if (clear) return at;
  }
  return at;
}

// Which way a stored motion leaves the exit: as it went in, scattered a
// little by an untrained hand.
function exitMotion(g: Game, vel: THREE.Vector3): THREE.Vector3 {
  const out = vel.clone();
  const scatter = (1 - control(g)) * 0.2;
  if (out.lengthSq() < 0.01 || scatter <= 0) return out;
  const axis = new THREE.Vector3().randomDirection().cross(out).normalize();
  return axis.lengthSq() > 0 ? out.applyAxisAngle(axis, (Math.random() - 0.5) * 2 * scatter) : out;
}

// Lets one kept thing out at `at`. A body standing where it comes out is
// shoved aside: a gate cannot open inside anyone.
function letOut(g: Game, k: Kept, at: THREE.Vector3, potency: number, calm = false): void {
  const half = halfOf(k);
  if (!calm) for (const e of g.techniques.enemiesInSphere(at, Math.max(half.x, half.z) + 0.6)) {
    const away = e.position.clone().sub(at).setY(0);
    if (away.lengthSq() < 1e-4) away.set(1, 0, 0);
    g.combat.hitEnemy(e, 8 * potency, { from: e.position.clone().sub(away.normalize()), knock: 5, lift: 1.2, kind: 'kinetic' });
  }
  seamAt(g, at, half, 0.5, true);
  if (k.kind === 'prop') {
    const p = k.prop;
    const vel = calm ? new THREE.Vector3() : exitMotion(g, p.sealed?.vel ?? new THREE.Vector3());
    if (calm) p.frozen = 0;
    g.props.unseal(p, at, vel, calm ? new THREE.Vector3() : undefined);
    lastExit = { at: at.clone(), vel: vel.clone() };
    // Online, this screen streams it again, out in the world.
    g.props.touch(p);
    if (!calm) flying.push({ prop: p, t: FLIGHT, potency, hit: new Set(), prev: at.clone(), was: vel.length() });
    if (vel.length() > 3) g.vfx.trail([at.clone(), at.clone().addScaledVector(vel.clone().normalize(), 1.6)], COLOR, Math.max(half.x, half.y), 0.25);
    g.audio.play('dark.summon', { at });
    return;
  }
  g.audio.play('dark.summon', { at });
  if (calm) return;
  const floor = new THREE.Vector3(at.x, groundUnder(g, at), at.z);
  if (k.kind === 'water') {
    // The water falls as it was taken: all at once.
    g.vfx.after(0.18, () => {
      g.vfx.ring(floor.clone().add(new THREE.Vector3(0, 0.06, 0)), WATER, 0.4, 2.6, 0.5);
      g.vfx.burst(floor.clone().add(new THREE.Vector3(0, 0.3, 0)), 18, 'spark', 5, WATER);
      g.audio.play('dark.water', { at: floor });
      for (const e of g.techniques.enemiesInSphere(floor, 2.2)) g.combat.hitEnemy(e, 10 * potency, { from: floor, knock: 4, lift: 0.6, kind: 'kinetic' });
      // It puts out what burns and takes the heat out of hot metal.
      for (const p of g.props.instances) if (p.heat > 0 && p.mesh.position.distanceTo(floor) < 2.4) { g.vfx.steam(p.mesh.position.clone(), 0.6, 6, 1.2); g.props.warm(p, -p.heat); }
      for (let i = fuels.length - 1; i >= 0; i--) if (fuels[i]!.at.distanceTo(floor) < 2.4) { g.vfx.endPatch(fuels[i]!.mesh, 0.3); fuels.splice(i, 1); }
    });
    return;
  }
  if (k.kind === 'fuel') {
    fuels.push({ at: floor, mesh: g.vfx.patch(floor, 1.8, 'fuel', 12), left: 12 });
    g.vfx.burst(floor.clone().add(new THREE.Vector3(0, 0.4, 0)), 5, 'spark', 2.5, 0x5a4318);
    g.audio.play('dark.fuel', { at: floor });
    return;
  }
  // Fire: the flame comes out burning as it was, and lights what lies under it.
  burnAt(g, floor, 2.1, 18 * potency);
  for (let i = fuels.length - 1; i >= 0; i--) {
    const f = fuels[i]!;
    if (f.at.distanceTo(floor) > 3.2) continue;
    fuels.splice(i, 1);
    g.vfx.endPatch(f.mesh, 0.3);
    g.vfx.after(0.15, () => burnAt(g, f.at, 2.3, 22 * potency));
  }
  for (const e of g.encounters.enemies) e.igniteFuel(floor, 2.2);
  for (const p of g.props.instances) if (p.def.traits.includes('flammable') && p.mesh.position.distanceTo(floor) < 2.2) g.props.warm(p, 0.5);
}

function burnAt(g: Game, at: THREE.Vector3, radius: number, dmg: number): void {
  g.vfx.flames(at, radius * 0.9, 14, 1.2);
  g.vfx.flash(at.clone().add(new THREE.Vector3(0, 1, 0)), FLAME, 40, 0.4, 9);
  g.vfx.patch(at, radius, 'burn', 8);
  g.audio.play('dark.fire', { at });
  kindle(at, radius);
  for (const e of g.techniques.enemiesInSphere(at, radius)) g.combat.hitEnemy(e, dmg, { from: at, knock: 3, kind: 'heat' });
  // It burns whoever stands in it, the bearer too.
  if (g.player.position.distanceTo(at) < radius) g.combat.hurtPlayer(10, { from: at });
}

// Arsenal, a summon written as a Program: it takes no thought over which
// thing to call. With a body in reach it calls the fastest thing kept and
// opens the gate behind the body along that thing's own heading, so the
// heading runs through it. With nobody in reach it calls the heaviest, as
// cover, between the bearer and whatever is nearest.
function arsenalPick(g: Game, ctx: AbilityContext): { i: number; at: THREE.Vector3 } | null {
  if (!store.length) return null;
  const me = g.player.position;
  const range = rangeFor(ctx, 10);
  const foe = g.techniques.enemiesInSphere(me, range + 2).sort((a, b) => a.position.distanceTo(me) - b.position.distanceTo(me))[0];
  const fastest = store.map((k, i) => ({ i, v: motionOf(k).length() })).sort((a, b) => b.v - a.v)[0]!;
  if (foe && fastest.v > 3) {
    return { i: fastest.i, at: behind(g, foe.center(), motionOf(store[fastest.i]!), Math.min(2.2, range), Math.min(...halfOf(store[fastest.i]!).toArray())) };
  }
  const heaviest = store.map((k, i) => ({ i, m: massOf(k) })).sort((a, b) => b.m - a.m)[0]!;
  const toward = foe ? foe.position.clone().sub(me).setY(0).normalize() : ctx.dir.clone().setY(0).normalize();
  const spot = me.clone().addScaledVector(toward, 1.6);
  return { i: heaviest.i, at: exitFor(g, spot, store[heaviest.i]!, range) };
}

function summon(ctx: AbilityContext): number {
  const g = ctx.game;
  const range = rangeFor(ctx, 10);
  let aim = ctx.aim ?? ctx.origin.clone().addScaledVector(ctx.dir, range);
  // A Pact that works only to the front opens no gate behind or beside.
  if (frontOnly(ctx)) {
    const to = aim.clone().sub(ctx.origin).setY(0), ahead = ctx.dir.clone().setY(0).normalize();
    if (to.lengthSq() > 1e-4 && to.clone().normalize().dot(ahead) < 0.5) aim = ctx.origin.clone().addScaledVector(ahead, Math.max(2, to.length())).setY(aim.y);
  }
  if (gate > 0 || estate > 0 || !store.length) { fizzle(g, exitFor(g, aim, { kind: 'fuel' }, range), store.length ? 'shut' : 'empty'); return 0; }
  let i = store.length - 1, at: THREE.Vector3;
  if (ctx.shape === 'arsenal') { const pick = arsenalPick(g, ctx)!; i = pick.i; at = pick.at; }
  else at = exitFor(g, aim, store[i]!, range, ctx.behaviors.includes('overhead'));
  const k = store.splice(i, 1)[0]!;
  gate = lockFor(g, massOf(k));
  letOut(g, k, at, ctx.potency);
  g.mastery.gainPassive('dark', 'control', 0.003);
  return 0;
}

// ---------------------------------------------------------------- Open Estate
function openEstate(ctx: AbilityContext): number {
  const g = ctx.game, me = g.player.position;
  const target = g.techniques.enemiesInSphere(me, 14).sort((a, b) => a.position.distanceTo(me) - b.position.distanceTo(me))[0];
  const c0 = target ? target.center() : (ctx.aim ?? me.clone().addScaledVector(ctx.dir, 5)).clone().add(new THREE.Vector3(0, 1, 0));
  const c = c0;
  const all = store.splice(0);
  const potency = ctx.potency * 1.5;
  estate = all.length * 0.14 + 0.4;
  // The seams open together: what stands at the heart of them is struck by the opening alone.
  let hits = 0;
  for (const e of g.techniques.enemiesInSphere(c, 3)) { g.combat.hitEnemy(e, 30 * ctx.potency, { from: me, knock: 1.5, kind: 'kinetic', heavy: true }); hits++; }
  for (let a = 0; a < 6; a++) {
    const ang = (a / 6) * Math.PI * 2;
    g.vfx.seam(c.clone().add(new THREE.Vector3(Math.cos(ang) * 2.6, 0.4, Math.sin(ang) * 2.6)), 0.6, 2.4, COLOR, 0.9);
  }
  g.vfx.ring(c.clone().setY(groundUnder(g, c) + 0.05), COLOR, 0.5, 5, 0.7);
  g.vfx.flash(c, COLOR, 60, 0.5, 14);
  g.audio.play('dark.max.tail', { at: c });
  // Then, in the order it went in, everything kept: each from the side its
  // own motion carries it through the target; what was still drops on it.
  all.forEach((k, n) => g.vfx.after(0.12 + n * 0.14, () => {
    // Each finds the target where it will be as it arrives.
    const c = target?.alive ? target.center().addScaledVector(target.velocity.clone().setY(0), 0.5) : c0;
    const v = motionOf(k);
    let at: THREE.Vector3;
    // What was still comes out over the target's head and drops on it.
    if (v.length() > 3) at = behind(g, c, v, 2.2, Math.min(...halfOf(k).toArray()));
    else at = c.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.3, 2.2 + halfOf(k).y, (Math.random() - 0.5) * 0.3));
    letOut(g, k, at, potency);
  }));
  return hits;
}

// ---------------------------------------------------------------- everything out
// The bearer falls and the storage gives up all it held, at once, round the
// body and still moving. Reset lets it all out quietly instead (a new run, a
// new Technique): nothing kept is ever lost.
function releaseAll(g: Game, calm: boolean): void {
  if (!store.length) return;
  const all = store.splice(0);
  const me = g.player.position;
  all.forEach((k, n) => {
    const ang = (n / all.length) * Math.PI * 2;
    const at = me.clone().add(new THREE.Vector3(Math.cos(ang) * 1.4, 1.3 + (n % 2) * 0.6, Math.sin(ang) * 1.4));
    if (calm && k.kind !== 'prop') return;
    letOut(g, k, at, 1, calm);
  });
  if (calm) return;
  g.vfx.ring(me.clone().add(new THREE.Vector3(0, 0.05, 0)), COLOR, 0.4, 4.5, 0.8);
  g.audio.play('dark.release', { at: me });
}

// ---------------------------------------------------------------- what is summoned meets
function tickFlying(g: Game, dt: number): void {
  for (let i = flying.length - 1; i >= 0; i--) {
    const f = flying[i]!;
    f.t -= dt;
    if (!f.prop.alive || f.prop.sealed || f.t <= 0) { flying.splice(i, 1); continue; }
    const v = f.prop.body.linvel();
    const now = Math.hypot(v.x, v.y, v.z);
    const speed = Math.max(now, f.was);
    const at = f.prop.mesh.position.clone(), from = f.prev.clone();
    f.prev.copy(at); f.was = now;
    if (speed < 4) continue;
    const reach = 0.75 + Math.max(f.prop.half.x, f.prop.half.y, f.prop.half.z);
    const path = at.clone().sub(from), plen = path.length();
    if (plen > 1e-4) path.divideScalar(plen);
    // Nearest the body came along this frame's path, not only where it ended.
    const nearest = (p: THREE.Vector3): THREE.Vector3 => from.clone().addScaledVector(path, THREE.MathUtils.clamp(p.clone().sub(from).dot(path), 0, plen));
    const heading = new THREE.Vector3(v.x, 0, v.z).lengthSq() > 0.01 ? new THREE.Vector3(v.x, 0, v.z).normalize() : path.clone().setY(0).normalize();
    for (const e of g.techniques.enemiesInSphere(at, reach + plen + 1.2)) {
      const c = e.center();
      if (f.hit.has(e) || nearest(c).distanceTo(c) > reach + 0.35) continue;
      f.hit.add(e);
      const hot = f.prop.heat > 0.35;
      const dmg = (5 + f.prop.def.mass * speed * 0.055 + (hot ? 12 * f.prop.heat : 0)) * f.potency;
      striking = true;
      lastStrike = { e, speed, t: g.clock.time };
      g.combat.hitEnemy(e, dmg, { from: c.clone().sub(heading), knock: Math.min(10, speed * 0.6), lift: 1.8, kind: hot ? 'heat' : 'kinetic', heavy: dmg >= 30 });
      striking = false;
      g.techniques.charge = Math.min(1, g.techniques.charge + 0.08);
      g.audio.play('dark.strike', { at });
      damageProp(g, f.prop, speed * 2, at);
    }
  }
}

function tickFuels(g: Game, dt: number): void {
  for (let i = fuels.length - 1; i >= 0; i--) if ((fuels[i]!.left -= dt) <= 0) fuels.splice(i, 1);
}

// ---------------------------------------------------------------- the next exit, drawn
// Where the next Summon would come out and which way it would go, drawn at
// the aim in ink and the Technique's colour: an outline of the thing and the
// first second of its path. It is the bearer's alone; nobody else sees it.
let ghost: { root: THREE.Group; box: THREE.LineSegments; path: THREE.Line } | null = null;
function ghostFor(g: Game): NonNullable<typeof ghost> {
  if (ghost) return ghost;
  const root = new THREE.Group();
  const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(2, 2, 2)), new THREE.LineDashedMaterial({ color: COLOR, dashSize: 0.12, gapSize: 0.08, transparent: true, opacity: 0.85, depthWrite: false }));
  box.computeLineDistances();
  const path = new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 16 }, () => new THREE.Vector3())), new THREE.LineDashedMaterial({ color: COLOR, dashSize: 0.18, gapSize: 0.14, transparent: true, opacity: 0.8, depthWrite: false }));
  path.frustumCulled = false;
  root.add(box, path);
  root.visible = false;
  g.renderer.scene.add(root);
  ghost = { root, box, path };
  return ghost;
}

function drawGhost(g: Game): void {
  const show = store.length > 0 && worldRuns.value && !g.cutscenes.active && g.techniqueId === 'dark';
  if (!show) { if (ghost) ghost.root.visible = false; return; }
  const gh = ghostFor(g);
  const k = store[store.length - 1]!;
  const pact = g.techniques.pactFor('secondary');
  const fake = { game: g, pact } as AbilityContext;
  const range = rangeFor(fake, 10);
  let aim: THREE.Vector3;
  if (g.cam.isTop && g.cam.floorPoint) aim = g.cam.floorPoint.clone();
  else {
    const eye = g.player.eye(), dir = g.cam.aimDirection();
    const hit = g.physics.castRay(eye, dir, range + 2, 0xffff, g.player.body);
    aim = hit ? hit.point : eye.clone().addScaledVector(dir, range);
  }
  const shape = pact?.grant.shape;
  const at = exitFor(g, aim, k, range, shape === 'summon' && (pact?.grant.behaviors ?? []).includes('overhead'));
  gh.root.visible = true;
  gh.box.position.copy(at);
  gh.box.scale.copy(halfOf(k));
  const v = motionOf(k);
  const pts: THREE.Vector3[] = [];
  for (let s = 0; s < 16; s++) {
    const t = (s / 15) * (v.length() > 1 ? 1 : 0.6);
    pts.push(at.clone().addScaledVector(v, t).add(new THREE.Vector3(0, -4.9 * t * t, 0)));
  }
  gh.path.geometry.setFromPoints(pts);
  gh.path.computeLineDistances();
}

// ---------------------------------------------------------------- the HUD's list
const GLYPH: Record<string, string> = {
  crate: '箱', crateSmall: '箱', barrel: '樽', trashA: '缶', trashB: '缶', cone: '錐', barrier: '柵', can: '缶', sodaCan: '缶',
  cardboard: '箱', cardboardOpen: '箱', steamer: '蒸', pot: '鍋', stool: '椅', chair: '椅', dummy: '木', drum: '缶', beerCrate: '箱', signStand: '札',
};
const NAME: Record<string, string> = {
  crate: 'crate', crateSmall: 'crate', barrel: 'barrel', trashA: 'bin', trashB: 'bin', cone: 'cone', barrier: 'barrier', can: 'can', sodaCan: 'can',
  cardboard: 'box', cardboardOpen: 'box', steamer: 'steamer', pot: 'pot', stool: 'stool', chair: 'chair', dummy: 'dummy', drum: 'drum', beerCrate: 'crate', signStand: 'sign',
};
function refreshUi(g: Game): void {
  const list: DarkStore[] = store.map((k) => {
    if (k.kind !== 'prop') return { glyph: k.kind === 'fuel' ? '油' : k.kind === 'fire' ? '火' : '水', name: k.kind, heading: null, speed: 0, hot: k.kind === 'fire', cold: false };
    const v = motionOf(k);
    const flat = Math.hypot(v.x, v.z);
    return { glyph: GLYPH[k.prop.key] ?? '物', name: NAME[k.prop.key] ?? 'thing', heading: v.length() > 1.5 ? Math.atan2(v.x, -v.z) + (g.cam.isTop ? 0 : g.cam.yaw) : null, speed: Math.round(flat > 0.5 ? v.length() : Math.abs(v.y)), hot: k.prop.heat > 0.35, cold: k.prop.frozen > 0 };
  });
  const same = list.length === darkUi.store.value.length && list.every((x, i) => { const y = darkUi.store.value[i]!; return x.glyph === y.glyph && x.speed === y.speed && x.hot === y.hot && x.cold === y.cold && (x.heading === null) === (y.heading === null) && (x.heading === null || Math.abs(x.heading - y.heading!) < 0.05); });
  if (!same) darkUi.store.value = list;
  darkUi.next.value = store.length - 1;
  const gv = Math.min(1, gate / 1.6);
  if (Math.abs(darkUi.gate.value - gv) > 0.01 || (gv === 0 && darkUi.gate.value !== 0)) darkUi.gate.value = gv;
}

// ---------------------------------------------------------------- the kit
export const dark: TechniqueKit = {
  id: 'dark', name: 'Dark Dimension', glyph: '蔵', color: COLOR, type: 'Spatial, Storage', sfx: 'ズゥン',
  blurb: 'Put things away where time stands still, and let them out again exactly as they were. Even moving.',
  breadth: 3,
  resource: { name: 'Seam', max: 100, regen: 12, startsFull: true },
  gauge: { name: 'Gate', glyph: '閂', value: darkUi.gate },
  primitive: { name: 'Dark Dimension', short: 'seal and summon', description: 'Move a nonliving thing into a space where no time passes, and back. Crude: the seam opens wide and wanders, and the exit scatters what comes out.' },
  parameters: ['direction', 'range', 'target', 'trigger', 'duration', 'resource', 'body', 'storage'],
  shapes: {
    seal: { label: 'seals a nonliving thing out of the world, moving or not', short: 'seal a thing away', kinds: ['primary'], description: 'The thing leaves the world as it is: its heat, its ice, its speed. Living things cannot enter.' },
    summon: { label: 'lets the last kept thing out at the aim, moving as it went in', short: 'let it out', kinds: ['secondary'], description: 'It comes out where you aim. It goes the way it was going.' },
    arsenal: { label: 'calls the right kept thing for the moment, unasked', short: 'call the right thing', kinds: ['primary', 'secondary'], description: 'At a body, the fastest thing kept, from behind it along its own heading. Otherwise the heaviest, as cover.' },
    estate: { label: 'opens every seam at once and lets everything out at one body', short: 'everything out', kinds: ['max'], description: 'Everything kept, in the order it went in, each from the side its own motion carries it through.' },
  },
  behaviors: { catch: 'the seam reaches further for a thing in flight', overhead: 'the exit opens high above the aim, and the thing falls' },
  catalogue,
  gestures: {
    // Seal: the sword seal raised high, drawn down across the thing like a
    // cut, and the hand closes and turns as a key in a lock.
    primary: gestureSet(0.56, 0.24, [
      { t: 0, right: 'seamDraw', left: 'guard', slow: true },
      { t: 0.2, right: 'seamCut', snap: true, camera: { fov: 4, roll: 0.03 } },
      { t: 0.32, right: 'keyTurn', snap: true, camera: { fov: -2 } },
      { t: 0.5, right: 'rest', left: 'rest' },
    ]),
    // Summon: the hand pinches at nothing beside the head, then is thrown
    // out open and palm down, letting go.
    secondary: gestureSet(0.58, 0.26, [
      { t: 0, right: 'pocketReach', left: 'guard', slow: true },
      { t: 0.24, right: 'unveil', snap: true, camera: { fov: 6, pitch: 0.01 } },
      { t: 0.46, right: 'rest', left: 'rest' },
    ]),
    // Arsenal: the left palm opens like a ledger, the right finger finds the
    // line, and the hand is thrown out with it.
    arsenal: gestureSet(0.62, 0.3, [
      { t: 0, right: 'tally', left: 'ledger', slow: true },
      { t: 0.14, right: 'pocketReach', left: 'ledger', snap: true },
      { t: 0.28, right: 'unveil', left: 'ledger', snap: true, camera: { fov: 5 } },
      { t: 0.52, right: 'rest', left: 'rest' },
    ]),
    // Open Estate: the backs of the hands set together, held, and thrown
    // apart like double doors.
    max: gestureSet(2.2, 1.6, [
      { t: 0, right: 'sealGather', left: 'sealGather', slow: true },
      { t: 0.6, right: 'doorsGrip', left: 'doorsGrip', slow: true },
      { t: 1.55, right: 'doorsWide', left: 'doorsWide', snap: true, camera: { fov: 12, pitch: 0.03 } },
      { t: 2.05, right: 'rest', left: 'rest' },
    ]),
  },
  // Thumbs and forefingers make a frame, which turns a quarter and back, a
  // lock tried; on the release the right fist turns as a key and the sword
  // seal comes up, ready to cut.
  sign: signGesture([
    { t: 0, right: 'sealGather', left: 'sealGather', slow: true },
    { t: 0.42, right: 'frame', left: 'frame', snap: true, camera: { fov: -3 }, event: 'seal' },
    { t: 0.7, right: 'frameTurn', left: 'frameTurn', snap: true, camera: { roll: 0.02, fov: -1 } },
    { t: 0.95, right: 'frame', left: 'frame' },
    { t: 1.2, right: 'keyTurn', left: 'ledger', snap: true, camera: { fov: 6 }, event: 'release' },
    { t: 1.42, right: 'seamDraw', left: 'guard' },
  ]),
  // What the seam does to things by what they are made of is nothing: it
  // keeps them as they are. The traits matter when they come out (see
  // tickFlying: hot metal burns what it strikes; a frozen thing hangs where it appears).
  traits: {},
  drill: kaeshi,
  panel: DarkPanel,
  cutscene,
  effects: {
    cast(ctx) {
      if (ctx.shape === 'seal') { const hits = seal(ctx); return { hits, hitStop: hits ? 0.03 : 0, cameraKick: { fov: 3 } }; }
      if (ctx.shape === 'summon' || ctx.shape === 'arsenal') { summon(ctx); return { cameraKick: { fov: 5 } }; }
      if (ctx.shape === 'estate') {
        const hits = openEstate(ctx);
        return { hits, hitStop: 0.12, impactFrame: 3, rooted: 1.0, cameraKick: { fov: 12, pitch: 0.03 } };
      }
      return undefined;
    },
    passive(g, dt) {
      gate = Math.max(0, gate - dt);
      estate = Math.max(0, estate - dt);
      // Something kept may have left by another way: another player took it
      // first online, or the scene that made it put it away.
      for (let i = store.length - 1; i >= 0; i--) { const k = store[i]!; if (k.kind === 'prop' && (!k.prop.alive || !k.prop.sealed)) store.splice(i, 1); }
      // The bearer falls: everything comes back at once (online, health is the server's).
      if (g.combat.hp <= 0) releaseAll(g, false);
      tickFlying(g, dt);
      tickFuels(g, dt);
      drawGhost(g);
      refreshUi(g);
      showStation(g, true);
    },
    onStruck(game, amount) {
      const c = game.techniques.current;
      // A blow landing before the seam closes spoils it, and shuts the gate.
      if (c && !c.fired && c.ctx.shape === 'seal') {
        game.techniques.interrupt();
        gate = Math.max(gate, 0.6);
        fizzle(game, game.player.eye().addScaledVector(c.ctx.dir, 1), 'shut');
      }
      // A lethal blow: the storage lets go as the bearer falls.
      if (!game.net && !game.combat.god && amount >= game.combat.hp) releaseAll(game, false);
      return amount;
    },
    reset(game) {
      releaseAll(game, true);
      store.length = 0; flying.length = 0; fuels.length = 0;
      gate = 0; estate = 0; lastStrike = null;
      if (ghost) ghost.root.visible = false;
      darkUi.store.value = []; darkUi.next.value = -1; darkUi.gate.value = 0;
      showStation(game, false);
    },
  },
  audio: { primary: 'dark.cast', secondary: 'dark.summon.cast', max: 'dark.max.cast', arsenal: 'dark.arsenal.cast' },
};

// For the drill: whether the blow being dealt now comes from something summoned.
export const summonedStrike = (): boolean => striking;

// The kit as the checks read it.
export function darkView(g: Game): { stored: { kind: string; id: number | null; speed: number; vel: number[]; heat: number; frozen: number }[]; gate: number; estate: number; flying: number; fuels: number; lastStrike: { speed: number; ago: number } | null; ghost: number[] | null; sealedProps: number; lastExit: { at: number[]; vel: number[] } | null } {
  return {
    stored: store.map((k) => ({ kind: k.kind, id: k.kind === 'prop' ? k.prop.id : null, speed: motionOf(k).length(), vel: motionOf(k).toArray(), heat: k.kind === 'prop' ? k.prop.heat : 0, frozen: k.kind === 'prop' ? k.prop.frozen : 0 })),
    gate, estate, flying: flying.length, fuels: fuels.length,
    lastStrike: lastStrike ? { speed: lastStrike.speed, ago: g.clock.time - lastStrike.t } : null,
    ghost: ghost?.root.visible ? ghost.box.position.toArray() : null,
    sealedProps: g.props.sealed.length,
    lastExit: lastExit ? { at: lastExit.at.toArray(), vel: lastExit.vel.toArray() } : null,
  };
}

