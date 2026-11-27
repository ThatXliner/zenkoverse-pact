import * as THREE from 'three';
import type { TechniqueKit, AbilityContext } from '../kit';
import type { Game } from '../../app/game';
import { signGesture, gestureSet, rangeFor, targetsAllowed, propsInCone, damageProp } from './shared';
import type { Pact } from '../../pacts/schema';
import type { Enemy } from '../../combat/enemies';
import type { PropInstance } from '../../world/props';
import { opening, blow, type CutsceneDef } from '../../cutscene/cutscene';
import { WALK, type Footing } from '../../player/controller';
import { GROUP_WORLD } from '../../physics/world';
import { surfaceAt, type Surface } from '../../audio/surfaces';
import { suriashi, showStation } from '../../drills/suriashi';

// Friction (摩): the user sets how hard their own skin grips. Never the
// floor's, never an opponent's: only where the skin touches. Raised, a hand
// cannot slip and a palm holds a wall; lowered, the soles let go and the
// body slides on whatever speed it had, with no brakes and little steering.
// The grip is only as strong as the wrist behind it, and a wet hand slips.

const COLOR = 0xe0a96d;
const INK = 0x17110c;

// How long the skin stays wet after the water (or the Kuroda's fuel), seconds.
const WET_SECONDS = 5;
// How much of a slide's speed the floor takes each second, by what it is.
// Loose dust and water stop it; polished boards and ice barely touch it.
const DRAG: Record<Surface, number> = { ice: 0.03, wet: 0.12, wood: 0.18, tile: 0.22, stone: 0.26, grass: 0.9, gravel: 2.4, water: 4 };
// A held Ability lives while its key is down; this is how long it outlasts the last frame of it.
const HOLD_GRACE = 0.12;
// A slide not held runs this long at most: there are no brakes, only Open
// Hand's dead stop, a floor that drags it down, or the time running out.
const SLIDE_SECONDS = 2.5;
// The least a dead stop plants the feet for, however briefly Open Hand is held.
const PLANT_SECONDS = 0.25;
// The palms reach a wall this far from the chest.
const WALL_REACH = 0.75;
// Strides of Railstep: each glides, then catches dead.
const STRIDES = 3, STRIDE_GLIDE = 0.17, STRIDE_CATCH = 0.09;
// A body or a prop heavier than these costs the wrist to hold (health).
const HEAVY_BUILD = 1.1, HEAVY_MASS = 25;

const catalogue: Pact[] = [
  { id: 'friction.grip', technique: 'friction', name: 'Grip', slot: 'primary', grant: { shape: 'grip', behaviors: ['carry'] }, clauses: [
    { kind: 'restrict', restriction: { param: 'range', value: 'touch' } }, { kind: 'restrict', restriction: { param: 'target', value: 'single' } }] },
  { id: 'friction.slip', technique: 'friction', name: 'Slip', slot: 'secondary', grant: { shape: 'slip', behaviors: ['glance'] }, clauses: [
    { kind: 'restrict', restriction: { param: 'trigger', value: 'grounded' } }, { kind: 'restrict', restriction: { param: 'body', value: 'barefoot' } }] },
  { id: 'friction.absolute-traction', technique: 'friction', name: 'Absolute Traction', slot: 'max', grant: { shape: 'traction' }, clauses: [
    { kind: 'restrict', restriction: { param: 'resource', value: 'all' } }, { kind: 'restrict', restriction: { param: 'body', value: 'palmContact' } }, { kind: 'restrict', restriction: { param: 'trigger', value: 'declared' } }] },
  { id: 'friction.open-hand', technique: 'friction', name: 'Open Hand', slot: 'secondary', grant: { shape: 'openHand' }, clauses: [
    { kind: 'restrict', restriction: { param: 'duration', value: 'held' } }, { kind: 'restrict', restriction: { param: 'body', value: 'bothHands' } }] },
  { id: 'friction.railstep', technique: 'friction', name: 'Railstep', slot: 'primary', grant: { shape: 'railstep', behaviors: ['heel'] }, clauses: [
    { kind: 'restrict', restriction: { param: 'direction', value: 'line' } }, { kind: 'restrict', restriction: { param: 'resource', value: 'strain' } }] },
];

// Absolute Traction: the sign close, both hands closing on the collar seen
// over the caster's shoulder, a hard cut wide and low down the line as the
// body is hurled along the floor, and a look from behind the caster down
// the skid it leaves.
const cutscene: CutsceneDef = {
  id: 'max-friction', title: { jp: '絶対摩擦', en: 'Absolute Traction' }, color: COLOR, pull: 1.6, reach: 12, word: 'ズザァァッ',
  shots: [
    { duration: 1.05, timeScale: 0.03, from: { pos: [0.95, 1.45, 1.95], look: [0, 1.32, 0], fov: 37 }, to: { pos: [0.66, 1.42, 1.48], fov: 30, roll: 0.04 }, events: opening('friction.max.charge') },
    { duration: 0.5, timeScale: 0.03, from: { pos: [0.55, 1.55, -0.55], look: [0, 1.25, 0], lookRel: 'target', fov: 44, roll: -0.06 }, to: { pos: [0.45, 1.5, -0.3], fov: 36, roll: -0.1 }, ease: 'in', events: [{ at: 0.05, kind: 'sfx', id: 'friction.max.inhale' }], page: { lines: 'focus' } },
    { duration: 0.95, timeScale: 0.3, from: { pos: [-2.7, 0.35, -1.1], look: [0, 0.9, 4], fov: 62, roll: 0.13 }, to: { pos: [-3.1, 0.45, -1.7], fov: 72, roll: 0.05 }, events: [...blow(0, 'friction.max.blow', 0.8)], page: { lines: 'rush' } },
    { duration: 0.75, timeScale: 0.5, from: { pos: [0.6, 1.6, -2.3], look: [0, 0.6, 7], fov: 48 }, to: { pos: [0.5, 1.85, -2.9], fov: 44 }, ease: 'inOut' },
  ],
};

// ---------------------------------------------------------------- state
// What the kit holds between frames. Each is null (or empty) when idle.
// `feet` holds the soles' last two marked positions, so each stroke overlaps the last.
interface Marks { feet: [THREE.Vector3, THREE.Vector3][] | null; mark: number; sound: number }
interface Slide extends Marks { left: number; held: boolean; age: number; potency: number; glance: boolean; hit: Set<Enemy> }
interface Palms { left: number; held: boolean; wall: THREE.Vector3 | null; cd: number; print: number }
interface Rail extends Marks { t: number; dir: THREE.Vector3; speed: number; potency: number; heel: boolean; done: number }
interface Hold { e: Enemy; left: number; carry: number; all: boolean; potency: number }
// `at` is where the body stood last frame and `dt` that frame's length: the
// body moves after this kit's tick, so a frame's distance is read the next.
interface Thrown { e: Enemy; t: number; potency: number; dir: THREE.Vector3; at: THREE.Vector3; dt: number; mark: number }
interface Flung { prop: PropInstance; t: number; potency: number; hit: Set<Enemy> }

let slide: Slide | null = null;
let palms: Palms | null = null;
let rail: Rail | null = null;
const holds: Hold[] = [];
const thrown: Thrown[] = [];
const flung: Flung[] = [];
let wet = 0;

const UP = new THREE.Vector3(0, 1, 0);
const flatOf = (v: THREE.Vector3): THREE.Vector3 => { const f = v.clone().setY(0); return f.lengthSq() > 1e-6 ? f.normalize() : new THREE.Vector3(0, 0, -1); };
const planar = (v: THREE.Vector3): number => Math.hypot(v.x, v.z);
const aimFlat = (g: Game): THREE.Vector3 => flatOf(g.cam.aimDirection());
const control = (g: Game): number => g.mastery.get('friction', 'control');

// The wrist pays for a hold on something heavy: the grip does not slip, the joint takes it.
function wrist(g: Game, heavy: number): void {
  if (heavy <= 0) return;
  g.combat.hurtPlayer(heavy * (1 - g.mastery.get('friction', 'tolerance') * 0.5), { self: true });
  g.audio.play('friction.wrist', { at: g.player.eye() });
}

// A grip that did not take: the hand skids off with a squeal.
function slipOff(g: Game, at: THREE.Vector3, dir: THREE.Vector3): void {
  g.vfx.trail([at.clone().addScaledVector(dir, 0.3), at.clone(), at.clone().addScaledVector(dir, -0.5).add(new THREE.Vector3(0, -0.15, 0))], COLOR, 0.12, 0.25);
  g.vfx.glint(at, 0.35, 0.18);
  g.audio.play('friction.slips', { at });
}

// ---------------------------------------------------------------- Grip
function seize(ctx: AbilityContext): number {
  const g = ctx.game, p = g.player;
  const flat = flatOf(ctx.dir);
  const reach = 1.5 + rangeFor(ctx, 1.4);
  const allow = targetsAllowed(ctx);
  const hand = p.eye().addScaledVector(flat, 0.7).add(new THREE.Vector3(0, -0.35, 0));
  const carry = planar(p.velocity);
  const e = allow.people ? g.techniques.enemiesInCone(p.eye(), flat, reach, 0.75).filter((x) => x.gripped <= 0).sort((a, b) => a.position.distanceTo(p.position) - b.position.distanceTo(p.position))[0] : undefined;
  if (e) {
    const at = e.center();
    // A wet hand, or a body the chain of holds has run out on, will not stay held.
    const held = wet > 0 ? 0 : e.grip(0.32);
    if (held <= 0) {
      slipOff(g, at, flat);
      g.combat.hitEnemy(e, 5 * ctx.potency, { from: p.position, knock: 2.5, kind: 'kinetic' });
      return 1;
    }
    g.combat.hitEnemy(e, 7 * ctx.potency, { from: p.position, stagger: false, kind: 'kinetic' });
    holds.push({ e, left: Math.min(held, 0.15), carry, all: ctx.behaviors.includes('carry'), potency: ctx.potency });
    wrist(g, e.isBoss ? 6 : (e.def.build ?? 1) > HEAVY_BUILD ? 3 : 0);
    g.vfx.ring(at, COLOR, 0.12, 0.7, 0.22, flat);
    g.vfx.glint(at, 0.45, 0.16);
    g.audio.play('friction.grip', { at });
    return 1;
  }
  const prop = allow.props ? propsInCone(g, p.eye(), flat, reach, 0.8).sort((a, b) => a.mesh.position.distanceTo(p.position) - b.mesh.position.distanceTo(p.position))[0] : undefined;
  if (prop) {
    // The prop's material decides how it leaves the hand.
    const response = prop.def.traits.map((t) => friction.traits[t]).find((f) => f) ?? ((pr: PropInstance, c: AbilityContext) => fling(c, pr, 1));
    response(prop, ctx);
    return 1;
  }
  g.vfx.trail([hand.clone().addScaledVector(flat, -0.3), hand, hand.clone().addScaledVector(flat, 0.6)], INK, 0.16, 0.14);
  g.audio.play('friction.grip.whiff');
  return 0;
}

// A prop seized and thrown, at the aim, with the thrower's speed in it.
function fling(ctx: AbilityContext, prop: PropInstance, k: number): void {
  const g = ctx.game, p = g.player;
  const dir = aimFlat(g);
  if (wet > 0 && prop.def.traits.includes('metal')) { slipOff(g, prop.mesh.position.clone(), dir); g.props.push(prop, dir.clone().multiplyScalar(prop.def.mass * 2)); return; }
  const speed = (9 + planar(p.velocity) * (ctx.behaviors.includes('carry') ? 1 : 0.6)) * k;
  g.props.launch(prop, dir.clone().multiplyScalar(speed).add(new THREE.Vector3(0, 2.2, 0)));
  prop.body.setAngvel({ x: (Math.random() - 0.5) * 8, y: (Math.random() - 0.5) * 8, z: (Math.random() - 0.5) * 8 }, true);
  flung.push({ prop, t: 1.6, potency: ctx.potency, hit: new Set() });
  wrist(g, prop.def.mass > HEAVY_MASS ? 3 : 0);
  const at = prop.mesh.position.clone();
  g.vfx.ring(at, COLOR, 0.15, 0.9, 0.22, dir);
  g.vfx.trail([at.clone().addScaledVector(dir, -1.2).add(new THREE.Vector3(0, 0.4, 0)), at, at.clone().addScaledVector(dir, 1.4)], COLOR, 0.3, 0.2);
  g.audio.play('friction.throw', { at });
}

// The hold runs out and the body goes where the aim points, carrying the
// thrower's speed: a grip that cannot slip passes all of it on.
function throwBody(g: Game, h: Hold): void {
  const e = h.e, p = g.player;
  e.letGo();
  if (!e.alive) return;
  const dir = aimFlat(g);
  const carry = Math.max(h.carry, planar(p.velocity)) * (h.all ? 1 : 0.6);
  const v = 9 + carry;
  const from = e.position.clone().addScaledVector(dir, -1);
  g.combat.hitEnemy(e, (12 + v * 1.6) * h.potency, { from, knock: v, lift: 1.6, kind: 'kinetic', heavy: v > 11 });
  thrown.push({ e, t: 1.6, potency: h.potency, dir, at: e.position.clone(), dt: 0, mark: 0 });
  const c = e.center();
  const side = new THREE.Vector3().crossVectors(dir, UP).normalize();
  g.vfx.trail([c.clone().addScaledVector(side, 0.9).add(new THREE.Vector3(0, 0.5, 0)), c.clone().addScaledVector(dir, -0.2), c.clone().addScaledVector(dir, 1.2).add(new THREE.Vector3(0, -0.3, 0))], COLOR, 0.42, 0.22);
  g.renderer.speed(dir, 0.5, 0.2);
  g.cam.kick({ fov: 6, roll: -0.03 });
  g.audio.play('friction.throw', { at: c });
}

function tickHolds(g: Game, dt: number): void {
  const p = g.player;
  for (let i = holds.length - 1; i >= 0; i--) {
    const h = holds[i]!;
    if (!h.e.alive) { h.e.letGo(); holds.splice(i, 1); continue; }
    // Held, the body is hauled to the hand, a little off its feet.
    const hand = p.position.clone().addScaledVector(aimFlat(g), 1.05);
    const pull = hand.sub(h.e.position);
    h.e.velocity.set(pull.x * 14, (p.position.y + 0.12 - h.e.position.y) * 12, pull.z * 14).clampLength(0, 12);
    h.left -= dt;
    if (h.left <= 0) { holds.splice(i, 1); throwBody(g, h); }
  }
}

// A thrown body skids along the floor, leaving marks, and if something
// stops it short (a wall, another body) the stop is a blow of its own.
function tickThrown(g: Game, dt: number): void {
  for (let i = thrown.length - 1; i >= 0; i--) {
    const th = thrown[i]!, e = th.e;
    th.t -= dt;
    if (!e.alive || th.t <= 0) { thrown.splice(i, 1); continue; }
    const moved = th.dt > 0 ? Math.hypot(e.position.x - th.at.x, e.position.z - th.at.z) / th.dt : Infinity;
    const meant = planar(e.velocity);
    if (meant > 5 && moved < meant * 0.4) {
      const hit = Math.min(14, meant);
      g.combat.hitEnemy(e, hit * 2.4 * th.potency, { from: e.position.clone().addScaledVector(th.dir, 1), stagger: true, kind: 'kinetic', heavy: hit > 9 });
      for (const o of g.techniques.enemiesInSphere(e.position, 1.4)) if (o !== e) g.combat.hitEnemy(o, hit * 1.5 * th.potency, { from: e.position, knock: hit * 0.6, lift: 1.5, kind: 'kinetic' });
      e.velocity.x = -th.dir.x * 1.5; e.velocity.z = -th.dir.z * 1.5;
      const c = e.center().addScaledVector(th.dir, 0.4);
      g.vfx.ring(c, COLOR, 0.3, 1.9, 0.32, th.dir.clone().negate());
      g.vfx.burst(c, 9, 'debris', 4.5, undefined, th.dir.clone().negate());
      g.cam.shake(0.3);
      g.audio.play('friction.slam', { at: c });
      thrown.splice(i, 1);
      continue;
    }
    // Skid marks under a body sliding on the floor.
    th.mark -= dt;
    if (e.grounded && meant > 2.5 && th.mark <= 0) {
      const y = e.position.y + 0.03;
      g.vfx.trail([th.at.clone().setY(y), e.position.clone().setY(y)], INK, 0.22, 0.9);
      th.mark = 0.05;
    }
    th.at.copy(e.position);
    th.dt = dt;
  }
}

// A thrown prop that reaches a body knocks it down; one that hits a wall hard enough breaks.
function tickFlung(g: Game, dt: number): void {
  for (let i = flung.length - 1; i >= 0; i--) {
    const f = flung[i]!;
    f.t -= dt;
    if (!f.prop.alive || f.t <= 0) { flung.splice(i, 1); continue; }
    const v = f.prop.body.linvel();
    const speed = Math.hypot(v.x, v.y, v.z);
    if (speed < 4) continue;
    const at = f.prop.mesh.position;
    for (const e of g.techniques.enemiesInSphere(at, 1.0)) {
      if (f.hit.has(e)) continue;
      f.hit.add(e);
      g.combat.hitEnemy(e, (6 + f.prop.def.mass * speed * 0.06) * f.potency, { from: at.clone().sub(new THREE.Vector3(v.x, 0, v.z).normalize()), knock: Math.min(9, speed * 0.6), lift: 2, kind: 'kinetic' });
      damageProp(g, f.prop, speed * 3, at);
    }
  }
}

// ---------------------------------------------------------------- Slip
function startSlide(ctx: AbilityContext): void {
  const g = ctx.game, p = g.player;
  const moving = planar(p.velocity) > 1.5;
  const dir = moving ? flatOf(p.velocity) : p.wish.lengthSq() > 0.01 ? p.wish.clone().normalize() : flatOf(ctx.dir);
  const speed = Math.max(planar(p.velocity), 8.5 + 3 * ctx.potency);
  p.velocity.x = dir.x * speed; p.velocity.z = dir.z * speed;
  // The soles let go this frame, before the walk can brake the push.
  p.footing = slideFooting(g);
  const held = g.techniques.current?.held ?? false;
  slide = { left: held ? HOLD_GRACE : SLIDE_SECONDS, held, age: 0, potency: ctx.potency, glance: ctx.behaviors.includes('glance'), hit: new Set(), feet: null, mark: 0, sound: 0 };
  const foot = p.position.clone().add(new THREE.Vector3(0, 0.04, 0));
  g.vfx.ring(foot, COLOR, 0.3, 1.5, 0.3);
  g.vfx.trail([foot.clone().addScaledVector(dir, -1.4), foot.clone().addScaledVector(dir, -0.4), foot], INK, 0.35, 0.4);
  g.renderer.speed(dir, 0.8, 0.25);
  g.audio.play('friction.push', { at: p.position });
  g.mastery.gainPassive('friction', 'control', 0.003);
}

// The soles on the move: two skid marks drawn behind them, the dust a dusty
// floor gives up, the hiss, and speed lines once it is fast.
function soleMarks(g: Game, s: Marks, dt: number): void {
  const p = g.player;
  const sp = planar(p.velocity);
  if (!p.grounded || sp < 2) { s.feet = null; return; }
  const dir = flatOf(p.velocity);
  const side = new THREE.Vector3().crossVectors(dir, UP).normalize().multiplyScalar(0.16);
  const y = p.position.y + 0.03;
  const feet: [THREE.Vector3, THREE.Vector3] = [p.position.clone().add(side).setY(y), p.position.clone().sub(side).setY(y)];
  s.mark -= dt;
  if (!s.feet) s.feet = [feet];
  else if (s.mark <= 0) {
    for (let k = 0; k < 2; k++) g.vfx.trail([...s.feet.map((f) => f[k]!), feet[k]!], INK, 0.13, 1.4);
    const surface = surfaceAt(p.position, p.surface);
    if (surface === 'gravel' || surface === 'grass') g.vfx.burst(p.position.clone().add(new THREE.Vector3(0, 0.1, 0)), 1, 'debris', 2, undefined, dir.clone().negate());
    s.feet = [s.feet.at(-1)!, feet];
    s.mark = 0.05;
  }
  s.sound -= dt;
  if (s.sound <= 0) { g.audio.play('friction.skid', { at: p.position, pitch: 0.8 + Math.min(0.6, sp / 25) }); s.sound = 0.24; }
  if (sp > 6.5) g.renderer.speed(dir, Math.min(0.6, 0.2 + (sp - 6.5) * 0.05), 0.12);
}

function tickSlide(g: Game, s: Slide, dt: number): Footing {
  const p = g.player;
  const sp = planar(p.velocity);
  const dir = flatOf(p.velocity);
  soleMarks(g, s, dt);
  // Whatever stands in the way takes the speed: the body is bowled over and
  // the slider loses most of what it had. Not while the hands are reaching
  // for a grab: the grab takes the body instead, and the speed with it.
  const c = g.techniques.current;
  const reaching = !!c && !c.fired && c.ctx.shape === 'grip';
  if (sp > 4 && !reaching) {
    for (const e of g.techniques.enemiesInSphere(p.position, 1.15)) {
      // A body in the slider's own grip rides along; it is not bowled over.
      if (s.hit.has(e) || e.state === 'knocked' || e.gripped > 0 || Math.abs(e.position.y - p.position.y) > 1.2) continue;
      s.hit.add(e);
      g.combat.hitEnemy(e, (5 + sp * 1.5) * s.potency, { from: e.position.clone().addScaledVector(dir, -1), knock: Math.min(10, sp * 0.75), lift: 1.4, kind: 'kinetic', heavy: sp > 10 });
      p.velocity.x *= 0.55; p.velocity.z *= 0.55;
      g.vfx.ring(e.center(), COLOR, 0.2, 1.3, 0.25, dir);
      g.audio.play('friction.bowl', { at: e.center() });
    }
    for (const prop of g.props.instances) {
      if (prop.mesh.position.distanceTo(p.position.clone().add(new THREE.Vector3(0, 0.5, 0))) > 1.0) continue;
      g.props.push(prop, dir.clone().multiplyScalar(prop.def.mass * sp * 0.5).add(new THREE.Vector3(0, prop.def.mass * 1.5, 0)));
    }
  }
  return slideFooting(g);
}

// Slick soles: steering that trained control earns, and the floor's own drag.
function slideFooting(g: Game): Footing {
  return { kind: 'slide', steer: 1.0 + control(g) * 2.2, drag: DRAG[surfaceAt(g.player.position, g.player.surface)] };
}

// ---------------------------------------------------------------- Open Hand
// A face a palm can hold, `reach` along `dir` from `from`. Only a built face
// takes one: plaster, stone and timber, never the bare ground or the rails
// nobody can see.
function faceAt(g: Game, from: THREE.Vector3, dir: THREE.Vector3): { point: THREE.Vector3; normal: THREE.Vector3 } | null {
  const hit = g.physics.castRay(from, dir, WALL_REACH, GROUP_WORLD, g.player.body);
  const tag = hit ? (hit.collider as { surfaceTag?: string }).surfaceTag : undefined;
  return hit && (tag === 'stone' || tag === 'wood') && Math.abs(hit.normal.y) < 0.4 ? hit : null;
}

function tickPalms(g: Game, h: Palms, dt: number): Footing {
  const p = g.player;
  h.cd = Math.max(0, h.cd - dt);
  const dir = h.wall ? h.wall.clone().negate() : p.wish.lengthSq() > 0.01 ? p.wish.clone().normalize() : aimFlat(g);
  // The palms reach at the chest. Already on a wall with the chest past its
  // top, the hands hold the lip, felt for at the hips.
  const chest = faceAt(g, p.position.clone().add(new THREE.Vector3(0, 1.15, 0)), dir);
  const lip = !chest && h.wall ? faceAt(g, p.position.clone().add(new THREE.Vector3(0, 0.55, 0)), dir) : null;
  const hit = chest ?? lip;
  const face = hit ? flatOf(hit.normal) : null;
  const reaching = face && (h.wall || !p.grounded || p.wish.dot(face) < -0.5);
  if (!face || !reaching || h.cd > 0) {
    h.wall = null;
    return p.grounded ? { kind: 'plant' } : WALK;
  }
  if (!h.wall) {
    g.vfx.ring(hit!.point.clone().addScaledVector(face, 0.03), COLOR, 0.15, 0.6, 0.25, face);
    g.audio.play('friction.stop', { at: hit!.point });
  }
  h.wall = face;
  if (g.input.hit('jump')) {
    // Kick off the wall: away from it and up.
    h.wall = null; h.cd = 0.35;
    p.footing = WALK;
    p.velocity.y = 6.8;
    p.shove(face.clone().multiplyScalar(10));
    g.vfx.ring(hit!.point.clone().addScaledVector(face, 0.05), COLOR, 0.3, 1.3, 0.3, face);
    g.audio.play('friction.kick', { at: hit!.point });
    return WALK;
  }
  const into = Math.max(0, -p.wish.dot(face));
  const tangent = new THREE.Vector3(-face.z, 0, face.x);
  const along = p.wish.dot(tangent);
  const rate = 2.6 + control(g) * 1.2;
  // Wet palms will not hold: the body slides down the face whatever the keys
  // say. At the lip the hands can go no higher; over it is the walk's mantle.
  const climb = wet > 0 ? new THREE.Vector3(0, -1.6, 0) : new THREE.Vector3(0, lip ? 0 : into * rate, 0).addScaledVector(tangent, along * rate * 0.7);
  climb.addScaledVector(face, -0.6);
  h.print -= dt;
  if (h.print <= 0 && (into > 0.1 || Math.abs(along) > 0.1 || wet > 0)) {
    const at = hit!.point.clone().addScaledVector(face, 0.03).add(new THREE.Vector3(0, 0.35, 0));
    if (wet > 0) g.vfx.trail([at.clone().add(new THREE.Vector3(0, 0.4, 0)), at], COLOR, 0.2, 0.5);
    else g.vfx.ring(at, COLOR, 0.1, 0.32, 0.5, face, 0.6);
    g.audio.play(wet > 0 ? 'friction.slips' : 'friction.climb', { at });
    h.print = 0.3;
  }
  return { kind: 'cling', climb };
}

// ---------------------------------------------------------------- Railstep
// One foot glides while the other catches: a stride of free sliding, then a
// dead stop that stamps whatever stands close. Three, zigzagging along the aim.
function tickRail(g: Game, r: Rail, dt: number): Footing {
  const p = g.player;
  r.t += dt;
  const per = STRIDE_GLIDE + STRIDE_CATCH;
  const i = Math.floor(r.t / per);
  if (i >= STRIDES) { rail = null; return WALK; }
  const into = r.t - i * per;
  const lean = (i % 2 === 0 ? 1 : -1) * 0.32;
  const dir = r.dir.clone().applyAxisAngle(UP, lean);
  if (into < STRIDE_GLIDE) {
    p.velocity.x = dir.x * r.speed; p.velocity.z = dir.z * r.speed;
    soleMarks(g, r, dt);
    return { kind: 'slide', steer: 0, drag: 0 };
  }
  r.feet = null;
  if (r.done <= i) {
    r.done = i + 1;
    const foot = p.position.clone().add(new THREE.Vector3(0, 0.05, 0));
    const reach = r.heel ? 1.9 : 1.6;
    for (const e of g.techniques.enemiesInSphere(p.position, reach)) g.combat.hitEnemy(e, (9 + (r.heel ? 5 : 0)) * r.potency, { from: p.position, knock: 4.5, lift: 2, kind: 'kinetic' });
    for (const prop of g.props.instances) if (prop.mesh.position.distanceTo(p.position) < reach) g.props.push(prop, prop.mesh.position.clone().sub(p.position).setY(0.4).normalize().multiplyScalar(prop.def.mass * 3));
    g.vfx.ring(foot, COLOR, 0.2, reach, 0.3);
    g.vfx.burst(foot, 3, 'debris', 2.5);
    g.cam.shake(0.08);
    g.audio.play('friction.rail', { at: foot, pitch: 1 + i * 0.06 });
  }
  return { kind: 'plant' };
}

// ---------------------------------------------------------------- the kit
export const friction: TechniqueKit = {
  id: 'friction', name: 'Friction', glyph: '摩', color: COLOR, type: 'Bodily, Manipulation', sfx: 'キュッ',
  blurb: 'Raise or lower the grip of your own skin. A hand that cannot slip; a body that cannot stop.',
  breadth: 2,
  resource: { name: 'Skin', max: 100, regen: 11, startsFull: true },
  primitive: { name: 'Friction', short: 'grab and throw', description: 'Change how hard your skin grips what it touches. Crude: the whole hand at once, and the wrist still takes the strain.' },
  parameters: ['direction', 'range', 'target', 'trigger', 'duration', 'resource', 'body'],
  shapes: {
    grip: { label: 'takes hold of a body or a prop and throws it with all your speed', short: 'seize and throw', kinds: ['primary'], description: 'A grip that cannot slip. The throw carries your own speed.' },
    railstep: { label: 'skates three strides, gliding and catching dead on each', short: 'three skating strides', kinds: ['primary'], description: 'One foot glides while the other catches. Each catch stamps.' },
    slip: { label: 'lets go of the ground and slides on the speed you have', short: 'push off and slide', kinds: ['secondary'], description: 'No friction underfoot: no brakes and little steering. Held, it lasts while the key is down. Blows glance off.' },
    openHand: { label: 'locks both open palms to whatever they touch', short: 'stop dead; climb walls', kinds: ['secondary'], description: 'Fingertip friction: stop a slide dead, climb a wall, refuse a shove.' },
    traction: { label: 'takes one body with every inch of skin and hurls it', short: 'seize and hurl', kinds: ['max'], description: 'Nothing slips, and nothing lets go until it is thrown. Some skin stays behind.' },
  },
  behaviors: { carry: 'the throw carries all of your speed', glance: 'blows slide off you while you slide', heel: 'each caught stride stamps harder and wider' },
  catalogue,
  gestures: {
    // Grip: the hand shoots out and closes on the collar, then hauls it in
    // across the body for the throw as the other arm swings out.
    primary: gestureSet(0.62, 0.22, [
      { t: 0, right: 'clawReady', left: 'guard', slow: true },
      { t: 0.2, right: 'collar', snap: true, camera: { fov: 4, pitch: 0.01 } },
      { t: 0.36, right: 'wrench', left: 'glideOut', snap: true, camera: { fov: 7, roll: -0.03 } },
      { t: 0.52, right: 'rest', left: 'rest' },
    ]),
    // Slip: a crouch's gather, then both arms thrown out low for balance as
    // the soles let go. Short, so a Grip can follow while the slide runs.
    secondary: gestureSet(0.38, 0.12, [
      { t: 0, right: 'chamber', left: 'chamber', slow: true },
      { t: 0.1, right: 'glideOut', left: 'glideOut', snap: true, camera: { fov: 8, roll: 0.02 } },
      { t: 0.28, right: 'glideOut', left: 'glideOut' },
      { t: 0.38, right: 'restLow', left: 'restLow' },
    ]),
    openHand: gestureSet(0.5, 0.18, [
      { t: 0, right: 'sealGather', left: 'sealGather', slow: true },
      { t: 0.16, right: 'wallPress', left: 'wallPress', snap: true, camera: { fov: -3, pitch: -0.01 } },
    ], true),
    railstep: gestureSet(0.92, 0.18, [
      { t: 0, right: 'skateBack', left: 'skateFwd', slow: true },
      { t: 0.16, right: 'skateFwd', left: 'skateBack', snap: true, camera: { fov: 5, roll: 0.03 } },
      { t: 0.42, right: 'skateBack', left: 'skateFwd', snap: true, camera: { fov: 4, roll: -0.03 } },
      { t: 0.68, right: 'skateFwd', left: 'skateBack', snap: true, camera: { fov: 5, roll: 0.03 } },
      { t: 0.86, right: 'rest', left: 'rest' },
    ]),
    max: gestureSet(2.2, 1.6, [
      { t: 0, right: 'clawReady', left: 'clawReady', slow: true },
      { t: 0.8, right: 'heave', left: 'heave', slow: true },
      { t: 1.55, right: 'collar', left: 'collar', snap: true, camera: { fov: 12, pitch: 0.04 } },
      { t: 1.78, right: 'wrench', left: 'glideOut', snap: true, camera: { fov: 8, roll: -0.05 } },
      { t: 2.1, right: 'rest', left: 'rest' },
    ]),
  },
  // The fingers hook into each other at the sternum and the elbows haul
  // against the lock, three times, and it does not give; on the release the
  // hands tear apart flat and splayed, and settle into a grab.
  sign: signGesture([
    { t: 0, right: 'sealGather', left: 'sealGather', slow: true },
    { t: 0.42, right: 'hookLock', left: 'hookLock', snap: true, camera: { fov: -3 }, event: 'seal' },
    { t: 0.62, right: 'hookPull', left: 'hookPull', snap: true, camera: { fov: -1, roll: 0.01 } },
    { t: 0.8, right: 'hookLock', left: 'hookLock' },
    { t: 0.98, right: 'hookPull', left: 'hookPull', snap: true, camera: { fov: -1, roll: -0.01 } },
    { t: 1.2, right: 'wallPress', left: 'wallPress', snap: true, camera: { fov: 7, pitch: -0.01 }, event: 'release' },
    { t: 1.42, right: 'clawReady', left: 'guard' },
  ]),
  // How a seized prop leaves the hand, by what it is made of. Anything else is thrown plainly.
  traits: {
    // Grain bites: wood leaves the hand as cleanly as a body does.
    wood: (prop, ctx) => fling(ctx, prop, 1),
    // Smooth and dense, it keeps going further; a wet hand cannot hold it at all (see fling).
    metal: (prop, ctx) => fling(ctx, prop, 1.2),
  },
  drill: suriashi,
  cutscene,
  effects: {
    cast(ctx) {
      const g = ctx.game;
      if (ctx.shape === 'grip') {
        const hits = seize(ctx);
        g.mastery.gainPassive('friction', 'precision', 0.003);
        return { hits, hitStop: hits ? 0.04 : 0, cameraKick: { fov: 5 } };
      }
      if (ctx.shape === 'slip') {
        startSlide(ctx);
        return { cameraKick: { fov: 8, roll: 0.02 } };
      }
      if (ctx.shape === 'openHand') {
        const held = g.techniques.current?.held ?? false;
        palms = { left: held ? PLANT_SECONDS : 2.0, held, wall: null, cd: 0, print: 0 };
        // Fingertips and soles catch at once: a slide stops dead.
        if (slide) { if (planar(g.player.velocity) > 3) g.audio.play('friction.stop', { at: g.player.position }); slide = null; }
        g.vfx.ring(g.player.eye().addScaledVector(aimFlat(g), 0.6), COLOR, 0.15, 0.7, 0.2, aimFlat(g));
        g.audio.play('friction.open', { at: g.player.position });
        return { cameraKick: { fov: -3 } };
      }
      if (ctx.shape === 'railstep') {
        const reach = rangeFor(ctx, 2.6);
        slide = null;
        rail = { t: 0, dir: flatOf(ctx.dir), speed: reach / STRIDE_GLIDE, potency: ctx.potency, heel: ctx.behaviors.includes('heel'), done: 0, feet: null, mark: 0, sound: 0 };
        g.audio.play('friction.push', { at: g.player.position, pitch: 1.2 });
        return { moveLock: STRIDES * (STRIDE_GLIDE + STRIDE_CATCH), cameraKick: { fov: 5 } };
      }
      if (ctx.shape === 'traction') {
        const p = g.player, me = p.position.clone();
        const dir = flatOf(ctx.dir);
        const target = g.techniques.enemiesInSphere(me, 3.4).sort((a, b) => a.position.distanceTo(me) - b.position.distanceTo(me))[0];
        let hits = 0;
        if (target) {
          // Every inch of skin on it: no chain of holds to run out, it cannot slip away.
          target.letGo();
          g.combat.hitEnemy(target, 110 * ctx.potency, { from: target.position.clone().addScaledVector(dir, -1), knock: 15, lift: 2.2, kind: 'kinetic', heavy: true });
          thrown.push({ e: target, t: 2.2, potency: ctx.potency * 1.5, dir, at: target.position.clone(), dt: 0, mark: 0 });
          hits++;
        }
        // The swing takes whatever stands close.
        for (const o of g.techniques.enemiesInSphere(me, 3.8)) if (o !== target) { g.combat.hitEnemy(o, 35 * ctx.potency, { from: me, knock: 9, lift: 2.5, kind: 'kinetic', heavy: true }); hits++; }
        for (const prop of g.props.instances) if (prop.mesh.position.distanceTo(me) < 3.8) g.props.push(prop, prop.mesh.position.clone().sub(me).setY(0.5).normalize().multiplyScalar(prop.def.mass * 9));
        const floor = me.clone().add(new THREE.Vector3(0, 0.05, 0));
        g.vfx.ring(floor, COLOR, 0.5, 6, 0.7);
        g.vfx.ring(p.eye().addScaledVector(dir, 1), 0xffffff, 0.2, 2.4, 0.4, dir);
        for (let k = 0; k < 7; k++) {
          const a = dir.clone().applyAxisAngle(UP, (k - 3) * 0.35);
          g.vfx.trail([floor.clone().addScaledVector(a, 0.6), floor.clone().addScaledVector(a, 2.2 + Math.random()), floor.clone().addScaledVector(a, 3.6 + Math.random() * 1.5)], INK, 0.3, 1.2);
        }
        g.vfx.burst(floor, 16, 'debris', 6, undefined, dir);
        g.vfx.flash(p.eye(), COLOR, 90, 0.5, 18);
        g.audio.play('friction.max.tail', { at: me });
        // What the grip leaves behind: skin.
        g.combat.hurtPlayer(g.combat.maxHp * 0.08, { self: true });
        return { hits, hitStop: 0.12, impactFrame: 3, rooted: 1.4, cameraKick: { fov: 14, roll: -0.05 } };
      }
      return undefined;
    },
    hold(ctx) {
      if (ctx.shape === 'slip' && slide) slide.left = HOLD_GRACE;
      if (ctx.shape === 'openHand' && palms) palms.left = Math.max(palms.left, HOLD_GRACE);
    },
    release(ctx) {
      if (ctx.shape === 'slip' && slide) slide.left = 0;
      if (ctx.shape === 'openHand' && palms) {
        // Out of Skin with the palms on a wall: they come away, and leave some of it there.
        if (palms.wall && ctx.game.techniques.resource < 1) { ctx.game.combat.hurtPlayer(5, { self: true }); slipOff(ctx.game, ctx.game.player.eye(), palms.wall.clone().negate()); }
        // Off a wall, a tapped Open Hand still lands its stop before the hands open.
        palms.held = false;
        palms.left = palms.wall ? 0 : Math.min(palms.left, PLANT_SECONDS);
      }
    },
    passive(game, dt) {
      const g = game, p = g.player;
      // Water and the Kuroda's fuel wet the skin, and wet skin will not grip.
      const surface = surfaceAt(p.position, p.surface);
      const fuel = g.encounters.enemies.some((e) => e.pour.some((q) => Math.hypot(q.x - p.position.x, q.z - p.position.z) < 1.2));
      wet = (p.grounded && (surface === 'water' || surface === 'wet')) || fuel ? WET_SECONDS : Math.max(0, wet - dt);
      // A held Ability that ended without its release (a clash took the cast) lets go too.
      if (slide?.held && !g.techniques.casting) slide.left = 0;
      if (palms?.held && !g.techniques.casting) palms.left = 0;
      // Bodies already in flight first: one thrown this frame has not moved yet.
      tickThrown(g, dt);
      tickHolds(g, dt);
      tickFlung(g, dt);
      let footing: Footing = WALK;
      if (rail) footing = tickRail(g, rail, dt);
      else if (palms && palms.left > 0) footing = tickPalms(g, palms, dt);
      else if (slide && slide.left > 0) footing = tickSlide(g, slide, dt);
      if (slide && !slide.held) {
        slide.left -= dt;
        slide.age += dt;
        // A slide that has run down to a shuffle is over: the soles catch.
        if (slide.age > 0.3 && p.grounded && planar(p.velocity) < 1) slide.left = 0;
      }
      if (palms && !palms.held) palms.left -= dt;
      if (slide && slide.left <= 0 && footing.kind !== 'slide') {
        // The soles catch again: the stop squeaks.
        if (planar(p.velocity) > 3 && p.grounded) g.audio.play('friction.stop', { at: p.position });
        slide = null;
      }
      if (palms && palms.left <= 0) palms = null;
      p.footing = footing;
      g.avatar.glide = footing.kind === 'slide' && p.grounded;
      showStation(g, true);
    },
    onStruck(game, amount, from) {
      if (!slide || slide.left <= 0 || !game.player.grounded) return amount;
      // Slick skin: the blow glances and pushes the slider along instead.
      const away = game.player.position.clone().sub(from).setY(0).normalize();
      game.player.shove(away.multiplyScalar(4));
      game.vfx.glint(game.player.eye().add(new THREE.Vector3(0, -0.4, 0)), 0.5, 0.18);
      game.audio.play('friction.glance', { at: game.player.position });
      return amount * (slide.glance ? 0.35 : 0.55);
    },
    reset(game) {
      for (const h of holds) h.e.letGo();
      holds.length = 0; thrown.length = 0; flung.length = 0;
      slide = null; palms = null; rail = null; wet = 0;
      game.player.footing = WALK;
      game.avatar.glide = false;
      showStation(game, false);
    },
  },
  audio: { primary: 'friction.cast', secondary: 'friction.slip.cast', max: 'friction.max.cast' },
};

