import * as THREE from 'three';
import type { TechniqueKit, AbilityContext } from '../kit';
import type { Game } from '../../app/game';
import type { Enemy } from '../../combat/enemies';
import type { PropInstance } from '../../world/props';
import { signGesture, gestureSet, rangeFor, frontOnly, targetsAllowed } from './shared';
import { restriction, type Pact } from '../../pacts/schema';
import { opening, blow, type CutsceneDef } from '../../cutscene/cutscene';
import { surfaceAt } from '../../audio/surfaces';
import { GROUP_WORLD } from '../../physics/world';
import { wetStone } from '../../drills/wetStone';

// Electro (wiki: Electro, Energy family). Any energy in, only electricity
// out: a blow, fire, the user's own body. The output is the hard part. A
// discharge goes only where a route carries it: a touch, metal, water, the
// meltwater of a frost patch. Air carries it no further than a short gap.
// Water takes everyone standing in it, and the user is never insulated from
// their own current.

const COLOR = 0xffe45c;
const DOWN = new THREE.Vector3(0, -1, 0);

// Charge one discharge draws, at most.
const DRAW = 30;
// Charge leaks away on its own, faster while you stand in water.
const LEAK = 1;
const LEAK_WET = 10;
// How far a current jumps off metal, and between two bodies that touch.
const METAL_REACH = 2.2;
const TOUCH = 1.0;
// A stream or paddy carries a current this far from where it went in.
const STREAM_REACH = 6;
// How long a metal prop holds what was put into it, and how close a body must come to take it.
const HELD_FOR = 6;
const HELD_TOUCH = 0.35;

// What the drill and the checks read, in game time: when the current last
// ran through the player, when they last fed on their own body, and when
// Impact Conversion last took something in.
export const electroState = { backlashAt: -Infinity, suppliedAt: -Infinity, convertedAt: -Infinity };

const catalogue: Pact[] = [
  { id: 'electro.discharge', technique: 'electro', name: 'Discharge', slot: 'primary', grant: { shape: 'discharge', behaviors: ['seize'] }, clauses: [
    { kind: 'restrict', restriction: { param: 'range', value: 'short' } }, { kind: 'restrict', restriction: { param: 'direction', value: 'front' } }] },
  { id: 'electro.impact-conversion', technique: 'electro', name: 'Impact Conversion', slot: 'secondary', grant: { shape: 'convert', behaviors: ['earth'] }, clauses: [
    { kind: 'restrict', restriction: { param: 'direction', value: 'front' } }, { kind: 'restrict', restriction: { param: 'trigger', value: 'grounded' } }] },
  { id: 'electro.self-supply', technique: 'electro', name: 'Self-Supply', slot: 'secondary', grant: { shape: 'supply' }, clauses: [
    { kind: 'restrict', restriction: { param: 'trigger', value: 'still' } }, { kind: 'restrict', restriction: { param: 'body', value: 'bothHands' } }] },
  { id: 'electro.closed-circuit', technique: 'electro', name: 'Closed Circuit', slot: 'max', grant: { shape: 'circuit' }, clauses: [
    { kind: 'restrict', restriction: { param: 'resource', value: 'all' } }, { kind: 'restrict', restriction: { param: 'range', value: 'touch' } }, { kind: 'restrict', restriction: { param: 'trigger', value: 'declared' } }] },
];

// Closed Circuit: the fingertips tented close, a dutch angle up from the
// floor at the target, the cut to the blow as the current closes through
// everything near, and a crane up over where it ran.
const cutscene: CutsceneDef = {
  id: 'max-electro', title: { jp: '閉回路', en: 'Closed Circuit' }, color: COLOR, pull: 2.2, reach: 12, word: 'バリバリッ',
  shots: [
    { duration: 1.05, timeScale: 0.03, from: { pos: [0.95, 1.45, 1.85], look: [0, 1.38, 0], fov: 36 }, to: { pos: [0.66, 1.42, 1.42], fov: 30, roll: 0.03 }, events: opening('electro.max.charge') },
    { duration: 0.5, timeScale: 0.03, from: { pos: [-0.9, 0.2, -0.6], look: [0, 1.4, 0], lookRel: 'target', fov: 58, roll: -0.14 }, to: { pos: [-0.8, 0.25, -0.3], fov: 50, roll: -0.1 }, ease: 'in', events: [{ at: 0.05, kind: 'sfx', id: 'electro.max.inhale' }], page: { lines: 'focus' } },
    { duration: 0.95, timeScale: 0.3, from: { rel: 'mid', pos: [3.6, 1.2, -1.2], look: [0, 1.1, 0], fov: 60, roll: 0.08 }, to: { pos: [4.6, 1.6, -1.8], fov: 70, roll: 0.03 }, events: [...blow(0, 'electro.max.blow', 0.8)], page: { lines: 'focus' } },
    { duration: 0.75, timeScale: 0.5, from: { rel: 'mid', pos: [-3, 6.5, 4.5], look: [0, 0.3, 0], fov: 60 }, to: { pos: [-3.6, 8.2, 5.4], fov: 64 }, ease: 'inOut' },
  ],
};

// ---------------------------------------------------------------- conduction

// Water a current can run through: the koi pond (unless Rime holds it
// frozen: ice carries nothing), the valley's stream and paddies near where
// it went in, and the meltwater of a frost patch.
interface Wet { kind: 'pond' | 'stream' | 'melt'; at: THREE.Vector3; radius: number }

function pondFrozen(g: Game): boolean {
  const c = g.world.pond.center;
  const hit = g.physics.castRay(new THREE.Vector3(c.x, 1, c.z), DOWN, 3, GROUP_WORLD);
  return !!hit && hit.point.y > g.world.pond.surfaceY - 0.3;
}

function wetAt(g: Game, feet: THREE.Vector3, frozen: boolean): Wet | null {
  const pond = g.world.pond;
  if (surfaceAt(feet, '') === 'water') {
    const inPond = Math.hypot(feet.x - pond.center.x, feet.z - pond.center.z) < pond.radius + 1;
    if (inPond) return frozen ? null : { kind: 'pond', at: new THREE.Vector3(pond.center.x, pond.surfaceY, pond.center.z), radius: pond.radius + 0.5 };
    return { kind: 'stream', at: feet.clone(), radius: STREAM_REACH };
  }
  const melt = g.vfx.patchesUnder(feet, 'frost', 0.1)[0];
  return melt ? { kind: 'melt', at: melt.at, radius: melt.radius } : null;
}

const wetKey = (w: Wet): string => w.kind === 'pond' ? 'pond' : `${w.kind}@${Math.round(w.at.x * 2)},${Math.round(w.at.z * 2)}`;
// In the same water: the pond is one body of water, a stream carries a
// few metres, and frost patches that touch share their meltwater.
function inWet(g: Game, w: Wet, feet: THREE.Vector3, frozen: boolean): boolean {
  if (w.kind === 'melt') return g.vfx.patchesUnder(feet, 'frost', 0.1).some((p) => flat(p.at, w.at) < p.radius + w.radius);
  const here = wetAt(g, feet, frozen);
  if (!here || here.kind !== w.kind) return false;
  return w.kind === 'pond' || flat(feet, w.at) < w.radius + 0.3;
}

type Node =
  | { kind: 'body'; e: Enemy }
  | { kind: 'metal'; p: PropInstance }
  | { kind: 'water'; w: Wet }
  | { kind: 'fuel'; at: THREE.Vector3 };

const isMetal = (p: PropInstance) => p.alive && p.def.traits.includes('metal');
const flat = (a: THREE.Vector3, b: THREE.Vector3) => Math.hypot(a.x - b.x, a.z - b.z);

function nodeAt(n: Node): THREE.Vector3 {
  if (n.kind === 'body') return n.e.center();
  if (n.kind === 'metal') return n.p.mesh.position.clone();
  if (n.kind === 'fuel') return n.at.clone();
  return n.w.at.clone();
}

// Where a body or a prop meets the water it stands in: the surface over its feet.
function surfaceOver(g: Game, w: Wet, p: THREE.Vector3): THREE.Vector3 {
  return new THREE.Vector3(p.x, w.kind === 'pond' ? g.world.pond.surfaceY + 0.02 : p.y + 0.03, p.z);
}

function handAt(g: Game): THREE.Vector3 {
  if (g.cam.isFirst) return g.player.eye().addScaledVector(g.cam.aimDirection(), 0.6).add(new THREE.Vector3(0, -0.25, 0));
  return g.avatar.boneWorld('hand_r', new THREE.Vector3());
}

// A body the current is running through: arcs crawl over its outline,
// from one limb to another, a few at a time.
function crawl(g: Game, center: THREE.Vector3, n: number, size = 0.6): void {
  const round = () => { const a = Math.random() * Math.PI * 2; return new THREE.Vector3(Math.cos(a) * size * 0.5, (Math.random() - 0.5) * size * 2.2, Math.sin(a) * size * 0.5); };
  for (let i = 0; i < n; i++) g.vfx.after(i * 0.035, () => g.vfx.arc(center.clone().add(round()), center.clone().add(round()), COLOR, 0.22, 0.06, 0.35));
}

// The current through the player: health, a jolt that roots them for a
// moment, the hands lit. Control over the Technique softens it.
function backlash(g: Game, amount: number): void {
  const a = amount * (1 - g.mastery.get('electro', 'control') * 0.5);
  if (a <= 0.5) return;
  g.combat.hurtPlayer(a, { self: true });
  g.player.rooted = Math.max(g.player.rooted, 0.3);
  g.cam.shake(0.3);
  g.cam.kick({ fov: -3, roll: (Math.random() - 0.5) * 0.04 });
  g.hands.pulse(1);
  crawl(g, g.player.position.clone().add(new THREE.Vector3(0, 1.0, 0)), 5, 0.7);
  g.audio.play('electro.backlash', { at: g.player.position });
  electroState.backlashAt = g.clock.time;
}

// A metal prop the current ran into and stopped in holds it for a while:
// the next body to touch it takes it, the player included.
const held = new Map<PropInstance, { charge: number; left: number; next: number }>();
function charge(g: Game, p: PropInstance, amount: number): void {
  const was = held.get(p);
  held.set(p, { charge: Math.min(60, (was?.charge ?? 0) + amount), left: HELD_FOR, next: 0 });
  // It jumps where it stands as the current goes in.
  g.props.push(p, new THREE.Vector3(0, p.def.mass * 1.2, 0), new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).multiplyScalar(p.def.mass * 0.15));
  g.audio.play('electro.metal', { at: p.mesh.position });
}

// `spare` is a body the current starts from without hurting it again.
interface Conduct { hops: number; falloff: number; seize: number; people: boolean; props: boolean; single: boolean; within?: { at: THREE.Vector3; radius: number }; spare?: Enemy }
interface Reached { bodies: Enemy[]; through: boolean; nodes: number }

// Runs a current from each of `starts` along every route it finds, breadth first,
// weaker at each hop. Bodies take it as damage; metal it ends in holds it;
// water passes it to everyone and everything in it, the player too.
function conduct(g: Game, starts: { n: Node; from: THREE.Vector3; power: number }[], o: Conduct): Reached {
  const frozen = pondFrozen(g);
  const bodies = new Set<Enemy>(), props = new Set<PropInstance>(), waters = new Set<string>();
  const out: Reached = { bodies: [], through: false, nodes: 0 };
  const targets = g.targets().filter((e) => e.alive);
  const near = (p: THREE.Vector3) => !o.within || flat(p, o.within.at) < o.within.radius;
  const metals = () => g.props.instances.filter((p) => isMetal(p) && !props.has(p) && near(p.mesh.position));
  const mark = (n: Node): boolean => {
    if (n.kind === 'body') { if (bodies.has(n.e)) return false; bodies.add(n.e); return true; }
    if (n.kind === 'metal') { if (props.has(n.p)) return false; props.add(n.p); return true; }
    if (n.kind === 'water') { const k = wetKey(n.w); if (waters.has(k)) return false; waters.add(k); return true; }
    return true;
  };
  let layer: { n: Node; at: THREE.Vector3; power: number }[] = starts.filter((st) => mark(st.n)).map((st) => ({ n: st.n, at: st.from, power: st.power }));
  for (let depth = 0; depth <= o.hops && layer.length; depth++) {
    const next: typeof layer = [];
    for (const { n, at, power } of layer) {
      const here = nodeAt(n);
      const delay = depth * 0.04;
      // The bolt from where the current came from, drawn as it travels.
      if (n.kind !== 'water') g.vfx.after(delay, () => g.vfx.arc(at, here, COLOR, 0.26, 0.09 + Math.min(0.12, power / 250), n.kind === 'body' ? 0.22 : 0.15));
      out.nodes++;
      if (n.kind === 'body') {
        if (o.people && n.e !== o.spare && (!o.single || out.bodies.length === 0)) {
          g.combat.hitEnemy(n.e, power, { from: at, kind: 'shock', knock: 0.6, lift: 0.3, stagger: true, heavy: power >= 30 });
          if (o.seize > 0) n.e.freeze(o.seize);
          crawl(g, here, 5);
          // A ring at its feet: from above, where the current went is read off the floor.
          g.vfx.after(delay, () => g.vfx.ring(n.e.position.clone().add(new THREE.Vector3(0, 0.06, 0)), COLOR, 0.3, 1.5, 0.3));
          out.bodies.push(n.e);
        }
        igniteNear(g, n.e.position);
      } else if (n.kind === 'metal') {
        igniteNear(g, n.p.mesh.position);
      } else if (n.kind === 'fuel') {
        igniteNear(g, n.at);
      } else {
        const w = n.w;
        g.vfx.after(delay, () => {
          g.vfx.ring(surfaceOver(g, w, here), COLOR, 0.3, Math.min(6, w.radius * 1.3), 0.4);
          // Arcs skitter across the surface from where it went in.
          for (let i = 0; i < 5; i++) {
            const a = Math.random() * Math.PI * 2, r = Math.random() * w.radius * 0.9;
            g.vfx.arc(surfaceOver(g, w, at), surfaceOver(g, w, here.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r))), COLOR, 0.2, 0.04, 0.12);
          }
        });
        g.vfx.flash(here.clone().add(new THREE.Vector3(0, 0.6, 0)), COLOR, 30, 0.3, 8);
        g.audio.play('electro.water', { at: here });
        if (!out.through && inWet(g, w, g.player.position, frozen)) { out.through = true; backlash(g, power * 0.6); }
      }
      // Metal holds the current only where it ends: what it passes on, it does not keep.
      const ends = next.length;
      const settle = () => { if (n.kind === 'metal' && next.length === ends) charge(g, n.p, power * 0.6); };
      if (depth === o.hops) { settle(); continue; }
      const p2 = power * o.falloff;
      const push = (m: Node, from2: THREE.Vector3, p: number) => { if (mark(m)) next.push({ n: m, at: from2, power: p }); };
      if (n.kind === 'body' || n.kind === 'metal') {
        const c = n.kind === 'body' ? n.e.center() : n.p.mesh.position;
        const feet = n.kind === 'body' ? n.e.position : n.p.mesh.position.clone().setY(n.p.mesh.position.y - n.p.half.y);
        if (o.props) for (const p of metals()) if (c.distanceTo(p.mesh.position) < METAL_REACH + p.half.x) push({ kind: 'metal', p }, c, p2);
        for (const e of targets) {
          if (bodies.has(e) || !near(e.position)) continue;
          const reach = n.kind === 'metal' ? METAL_REACH + n.p.half.x : TOUCH;
          if (flat(e.position, feet) < reach && Math.abs(e.position.y - feet.y) < 2) push({ kind: 'body', e }, c, p2);
        }
        const w = wetAt(g, feet, frozen);
        if (w) push({ kind: 'water', w }, surfaceOver(g, w, feet), p2);
      } else if (n.kind === 'water') {
        const w = n.w;
        // Water spreads it to everyone in it, and loses more of it doing so.
        for (const e of targets) if (!bodies.has(e) && inWet(g, w, e.position, frozen)) push({ kind: 'body', e }, surfaceOver(g, w, e.position), power * 0.7);
        if (o.props) for (const p of metals()) if (inWet(g, w, p.mesh.position.clone().setY(p.mesh.position.y - p.half.y), frozen)) push({ kind: 'metal', p }, surfaceOver(g, w, p.mesh.position), power * 0.7);
      }
      settle();
    }
    layer = next;
  }
  return out;
}

// A spark that reaches the Kuroda's waiting fuel lights it, his or not.
function igniteNear(g: Game, at: THREE.Vector3): void {
  for (const e of g.encounters.enemies) if (e.alive && e.igniteFuel(at, 1.8) > 0) g.audio.play('electro.ignite', { at });
}

// ---------------------------------------------------------------- the Abilities

function discharge(ctx: AbilityContext): ReturnType<TechniqueKit['effects']['cast']> {
  const g = ctx.game;
  const allow = targetsAllowed(ctx);
  const conductive = ctx.pact ? restriction(ctx.pact, 'target') === 'conductive' : false;
  const reach = rangeFor(ctx, 2.4) * (ctx.behaviors.includes('arc') ? 1.7 : 1);
  const half = frontOnly(ctx) ? 0.45 : 0.8;
  const frozen = pondFrozen(g);
  const hand = handAt(g);
  // The first thing the current can reach: a body (only by touch, under a
  // conductive Pact), metal, water or a waiting pour under the aim.
  const firsts: { n: Node; d: number }[] = [];
  if (allow.people) for (const e of g.techniques.enemiesInCone(ctx.origin, ctx.dir, reach + 0.6, half)) {
    const d = flat(e.position, ctx.origin) - 0.35;
    if (d <= (conductive ? TOUCH : reach)) firsts.push({ n: { kind: 'body', e }, d });
  }
  if (allow.props) for (const p of g.props.instances) {
    if (!isMetal(p)) continue;
    const to = p.mesh.position.clone().sub(ctx.origin);
    const d = Math.hypot(to.x, to.z) - p.half.x;
    if (d <= reach && to.setY(0).normalize().dot(ctx.dir.clone().setY(0).normalize()) > Math.cos(half + 0.2)) firsts.push({ n: { kind: 'metal', p }, d });
  }
  const aim = ctx.aim;
  if (aim && flat(aim, ctx.origin) <= reach + 0.8) {
    const w = wetAt(g, aim, frozen);
    if (w) firsts.push({ n: { kind: 'water', w }, d: flat(aim, ctx.origin) });
    for (const e of g.encounters.enemies) if (e.pour.some((p) => flat(p, aim) < 2.3)) firsts.push({ n: { kind: 'fuel', at: aim.clone() }, d: flat(aim, ctx.origin) + 0.1 });
  }
  firsts.sort((a, b) => a.d - b.d);
  const first = firsts[0];
  // Standing in water, the current goes down through you as well.
  const under = wetAt(g, g.player.position, frozen);
  if (!first && !under) {
    // Nothing to touch: a spark at the fingertips, and the charge stays.
    const tip = hand.clone().addScaledVector(ctx.dir, 0.5);
    g.vfx.arc(hand, tip, COLOR, 0.12, 0.03, 0.5);
    g.vfx.burst(tip, 4, 'spark', 2.5, COLOR, ctx.dir);
    g.audio.play('electro.snap', { at: tip });
    return { hits: 0, cameraKick: { fov: 2 } };
  }
  const spent = Math.min(g.techniques.resource, DRAW);
  g.techniques.resource -= spent;
  const power = (6 + 1.1 * spent) * ctx.potency;
  const seize = ctx.behaviors.includes('seize') && spent >= 12 ? Math.min(0.8, 0.2 + spent / 50) : 0;
  const relay = ctx.behaviors.includes('relay');
  const opts: Conduct = { hops: relay ? 7 : 4, falloff: relay ? 0.85 : 0.75, seize, people: allow.people, props: allow.props, single: allow.single };
  const starts = first ? [{ n: first.n, from: hand, power }] : [];
  if (under) {
    starts.push({ n: { kind: 'water', w: under }, from: g.player.position.clone().add(new THREE.Vector3(0, 0.1, 0)), power: power * 0.8 });
    crawl(g, g.player.position.clone().add(new THREE.Vector3(0, 0.5, 0)), 4, 0.6);
  }
  const reached = conduct(g, starts, opts);
  const strong = spent / DRAW;
  g.vfx.flash(hand.clone().addScaledVector(ctx.dir, 0.4), COLOR, 10 + 25 * strong, 0.18, 5);
  g.vfx.burst(hand.clone().addScaledVector(ctx.dir, 0.4), 6 + Math.round(8 * strong), 'spark', 4, COLOR, ctx.dir);
  g.audio.play(spent >= 8 ? 'electro.discharge' : 'electro.snap', { at: hand, weight: strong });
  if (reached.nodes > 1) g.audio.play('electro.jump', { at: hand });
  g.mastery.gainPassive('electro', 'precision', 0.003);
  const hits = reached.bodies.length;
  return { hits, hitStop: hits ? 0.04 + 0.04 * strong : 0, impactFrame: hits && spent >= DRAW * 0.9 ? 1 : 0, cameraKick: { fov: 4 + 5 * strong, pitch: 0.012 } };
}

// Impact Conversion is open for a moment from its beat. What lands in it
// becomes charge, up to what the hands can take in at once.
let openFor = 0;
let windowCtx: { front: boolean; earth: boolean; bank: boolean } = { front: false, earth: false, bank: false };

function intake(g: Game): number {
  const control = g.mastery.get('electro', 'control'), tolerance = g.mastery.get('electro', 'tolerance');
  return (14 + 16 * control) * (1 + tolerance * 0.5) * (1 - g.techniques.strain * 0.5);
}

// Energy taken in: into the charge, and what does not fit goes to ground
// (Pacts that keep a hand to the floor) or through the body.
function store(g: Game, energy: number, at: THREE.Vector3): void {
  const t = g.techniques, max = t.def.resource.max;
  const gained = energy * (windowCtx.bank ? 2 : 1.5);
  const room = max - t.resource;
  t.resource = Math.min(max, t.resource + gained);
  t.strain = Math.min(1, t.strain + 0.05);
  const over = gained - room;
  const hand = handAt(g);
  g.vfx.arc(at, hand, COLOR, 0.22, 0.07, 0.25);
  g.vfx.ring(at, COLOR, 0.2, 1.2, 0.3, at.clone().sub(g.player.eye()).normalize());
  g.audio.play('electro.converted', { at });
  g.hands.pulse(0.8);
  electroState.convertedAt = g.clock.time;
  if (over <= 1) return;
  if (windowCtx.earth) {
    const floor = g.player.position.clone().add(new THREE.Vector3(0, 0.04, 0));
    g.vfx.arc(hand, floor.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.8, 0, (Math.random() - 0.5) * 0.8)), COLOR, 0.2, 0.05, 0.3);
    g.vfx.ring(floor, COLOR, 0.3, 1.6, 0.35);
  } else backlash(g, over * 0.4);
}

function convertProps(g: Game): void {
  const eye = g.player.eye(), dir = g.cam.aimDirection();
  for (const p of g.props.instances) {
    const v = p.body.linvel();
    const speed = Math.hypot(v.x, v.y, v.z);
    if (speed < 2) continue;
    const to = p.mesh.position.clone().sub(eye);
    if (to.length() > 3.4) continue;
    if (windowCtx.front && to.clone().normalize().dot(dir) < 0.3) continue;
    // The motion it had is taken out of it, and it drops where it is.
    const energy = Math.min(intake(g), p.def.mass * speed * 0.12);
    g.props.touch(p);
    p.body.setLinvel({ x: v.x * 0.1, y: Math.min(0, v.y * 0.1), z: v.z * 0.1 }, true);
    p.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    store(g, energy, p.mesh.position.clone());
    g.drills.notify(p, 'absorbed');
    g.tutorial.notify('absorbed');
    g.mastery.gainPassive('electro', 'efficiency', 0.01);
  }
}

function supply(ctx: AbilityContext): ReturnType<TechniqueKit['effects']['cast']> {
  const g = ctx.game, t = g.techniques, max = t.def.resource.max;
  const hand = handAt(g);
  // A charged prop within reach is a source: drawn back, less what was lost.
  for (const [p, h] of held) {
    if (!p.alive || p.mesh.position.distanceTo(g.player.position.clone().add(new THREE.Vector3(0, 0.8, 0))) > 1.8) continue;
    t.resource = Math.min(max, t.resource + h.charge * 0.8);
    held.delete(p);
    g.vfx.arc(p.mesh.position, hand, COLOR, 0.3, 0.08, 0.2);
    g.audio.play('electro.converted', { at: p.mesh.position });
    return { cameraKick: { fov: -3 } };
  }
  const tolerance = g.mastery.get('electro', 'tolerance');
  electroState.suppliedAt = g.clock.time;
  if (t.strain >= 0.85) {
    // Nothing left to burn: the body refuses, and it costs a little anyway.
    g.combat.hurtPlayer(3, { self: true });
    g.audio.play('electro.spent', { at: g.player.position });
    g.cam.shake(0.2);
    return { cameraKick: { fov: -2 } };
  }
  const gain = 30 * (1 - t.strain * 0.6) * (1 + g.mastery.get('electro', 'efficiency') * 0.4) * (0.7 + ctx.potency * 0.4);
  t.resource = Math.min(max, t.resource + gain);
  t.strain = Math.min(1, t.strain + 0.2 * (1 - tolerance * 0.4));
  const feet = g.player.position.clone();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.random();
    g.vfx.after(i * 0.05, () => g.vfx.arc(feet.clone().add(new THREE.Vector3(Math.cos(a) * 0.3, 0.1, Math.sin(a) * 0.3)), feet.clone().add(new THREE.Vector3(Math.cos(a) * 0.25, 1.0 + Math.random() * 0.3, Math.sin(a) * 0.25)), COLOR, 0.2, 0.04, 0.3));
  }
  g.vfx.gather(feet, 1.2, 10, 0.35, COLOR);
  g.hands.pulse(0.9);
  g.audio.play('electro.supply', { at: feet });
  g.mastery.gainPassive('electro', 'tolerance', 0.004);
  return { cameraKick: { fov: -4, pitch: -0.01 } };
}

function circuit(ctx: AbilityContext): ReturnType<TechniqueKit['effects']['cast']> {
  const g = ctx.game, t = g.techniques;
  const me = g.player.position.clone();
  // What was held as the Output began: its cost has already left the bar.
  const spent = Math.max(t.resource, heldAtCast);
  t.resource = 0;
  const hand = handAt(g);
  const target = g.targets().filter((e) => e.alive && flat(e.position, me) < 3.6).sort((a, b) => flat(a.position, me) - flat(b.position, me))[0] ?? null;
  const within = { at: me, radius: 16 };
  const each = (20 + 0.6 * spent) * ctx.potency;
  const spread: Conduct = { hops: 10, falloff: 0.9, seize: 0.7, people: true, props: true, single: false, within };
  let hits = 0;
  if (target) {
    const c = target.center();
    g.combat.hitEnemy(target, (50 + 1.2 * spent) * ctx.potency, { from: me, kind: 'shock', knock: 5, lift: 2.5, heavy: true });
    target.freeze(1.2);
    hits++;
    for (let i = 0; i < 3; i++) g.vfx.arc(hand, c, i === 0 ? 0xffffff : COLOR, 0.5, 0.25 - i * 0.06, 0.22 + i * 0.1);
    crawl(g, c, 8, 0.7);
    // From the target, down into the ground around it.
    for (let i = 0; i < 6; i++) { const a = Math.random() * Math.PI * 2, r = 1 + Math.random() * 2; g.vfx.after(0.03 * i, () => g.vfx.arc(c, target.position.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.05, Math.sin(a) * r)), COLOR, 0.35, 0.08, 0.25)); }
  } else {
    // No body to close it through: it goes into the ground, and whatever the ground carries.
    for (const e of g.techniques.enemiesInSphere(me, 3)) { g.combat.hitEnemy(e, each, { from: me, kind: 'shock', knock: 3, heavy: true }); e.freeze(0.7); hits++; }
  }
  const starts: { n: Node; from: THREE.Vector3; power: number }[] = target ? [{ n: { kind: 'body', e: target }, from: hand, power: each / spread.falloff }] : [];
  if (!target) for (const p of g.props.instances) if (isMetal(p) && flat(p.mesh.position, me) < 6) starts.push({ n: { kind: 'metal', p }, from: hand, power: each });
  const under = wetAt(g, me, pondFrozen(g));
  if (under) starts.push({ n: { kind: 'water', w: under }, from: me, power: each });
  hits += conduct(g, starts, { ...spread, spare: target ?? undefined }).bodies.length;
  g.vfx.flash(me.clone().add(new THREE.Vector3(0, 1.5, 0)), COLOR, 140, 0.6, 26);
  g.vfx.ring(me.clone().add(new THREE.Vector3(0, 0.08, 0)), COLOR, 0.5, 12, 0.6);
  g.vfx.burst(hand, 30, 'spark', 10, COLOR);
  // It closes through the user too.
  g.combat.hurtPlayer(g.combat.maxHp * 0.08, { self: true });
  crawl(g, me.clone().add(new THREE.Vector3(0, 1, 0)), 6, 0.8);
  g.audio.play('electro.max.tail', { at: me });
  return { hits, hitStop: 0.14, impactFrame: 3, rooted: 1.4, cameraKick: { fov: 14, pitch: 0.05, roll: -0.03 } };
}

// ---------------------------------------------------------------- the kit

let signAt = -1;
// The Charge held on the last frame nothing was being cast.
let heldAtCast = 0;

export const electro: TechniqueKit = {
  id: 'electro', name: 'Electro', glyph: '電', color: COLOR, type: 'Conversion, Energy family', sfx: 'バチッ',
  blurb: 'Any energy in, only electricity out. A discharge needs a route: a touch, metal, water. You are never insulated from your own current.',
  breadth: 3,
  resource: { name: 'Charge', max: 100, regen: 0, startsFull: false, free: ['primary', 'secondary'] },
  primitive: { name: 'Electro', short: 'a static snap', description: 'Turn a little of any energy you hold into a spark. It needs something to touch.' },
  parameters: ['direction', 'range', 'target', 'trigger', 'duration', 'resource', 'body'],
  shapes: {
    discharge: { label: 'releases charge through whatever it touches', short: 'discharge through a touch', kinds: ['primary'], description: 'It needs a route: a touch, metal or water. Water takes everyone standing in it, you too.' },
    convert: { label: 'turns the blow that lands into charge', short: 'turn a blow into charge', kinds: ['secondary'], description: 'Meet a blow as it lands. What you cannot take in still reaches you.' },
    supply: { label: 'burns your own body for charge', short: 'burn your body for charge', kinds: ['secondary'], description: 'Charge from your own fuel. It strains you and heals nothing.' },
    circuit: { label: 'closes one circuit through the target and every conductor near it', short: 'one circuit through it all', kinds: ['max'], description: 'Everything at once, through every route there is, and through you.' },
  },
  behaviors: {
    seize: 'the current locks the muscles it runs through, for a moment',
    relay: 'carries farther along metal and water',
    arc: 'jumps a short gap of air',
    earth: 'what you cannot hold goes to the ground, not through you',
    bank: 'stores more of each blow it takes in',
  },
  catalogue,
  gestures: {
    // A spear hand drawn back by the ear and driven out to touch.
    primary: gestureSet(0.55, 0.24, [{ t: 0, right: 'spearDraw', left: 'guard', slow: true }, { t: 0.2, right: 'spear', snap: true, camera: { fov: 5, pitch: 0.012 } }, { t: 0.34, right: 'spear' }, { t: 0.48, right: 'rest', left: 'rest' }]),
    // One palm meets the blow, the other goes to the floor.
    secondary: gestureSet(0.5, 0.12, [{ t: 0, right: 'catchPalm', left: 'groundPalm', snap: true, camera: { fov: -3 } }, { t: 0.32, right: 'catchPalm', left: 'groundPalm' }, { t: 0.44, right: 'rest', left: 'rest' }]),
    // Hands wide, then the fists clench down by the hips and shake.
    supply: gestureSet(0.72, 0.4, [{ t: 0, right: 'gripOpen', left: 'gripOpen', slow: true }, { t: 0.36, right: 'gripDown', left: 'gripDown', snap: true, camera: { fov: -4, pitch: -0.01 } }, { t: 0.46, right: 'gripOpen', left: 'gripDown' }, { t: 0.54, right: 'gripDown', left: 'gripOpen' }, { t: 0.66, right: 'rest', left: 'rest' }]),
    max: gestureSet(2.3, 1.7, [{ t: 0, right: 'tent', left: 'tent', slow: true }, { t: 0.8, right: 'arcSpread', left: 'arcSpread', slow: true }, { t: 1.3, right: 'spearDraw', left: 'groundPalm', slow: true }, { t: 1.65, right: 'spear', left: 'groundPalm', snap: true, camera: { fov: 14, pitch: 0.04 } }, { t: 2.1, right: 'rest', left: 'rest' }]),
  },
  // The hands open, the fingertips tent before the sternum, then tear apart
  // with the fingers splayed. The spear hand cocks for the primed cast.
  sign: signGesture([
    { t: 0, right: 'gripOpen', left: 'gripOpen', slow: true },
    { t: 0.5, right: 'tent', left: 'tent', snap: true, camera: { fov: -4 }, event: 'seal' },
    { t: 1.2, right: 'arcSpread', left: 'arcSpread', snap: true, camera: { fov: 7, roll: -0.02 }, event: 'release' },
    { t: 1.42, right: 'spearDraw', left: 'guard' },
  ]),
  traits: {
    metal: (prop, ctx) => charge(ctx.game, prop, 10 * ctx.potency),
  },
  drill: wetStone,
  cutscene,
  effects: {
    cast(ctx) {
      const g = ctx.game;
      if (ctx.shape === 'discharge') return discharge(ctx);
      if (ctx.shape === 'convert') {
        const m = g.mastery.get('electro', 'tolerance');
        openFor = 0.42 + m * 0.25;
        windowCtx = { front: frontOnly(ctx), earth: ctx.behaviors.includes('earth'), bank: ctx.behaviors.includes('bank') };
        // Bracing the nerves for it is a strain of its own.
        g.techniques.strain = Math.min(1, g.techniques.strain + 0.03);
        g.vfx.ring(handAt(g), COLOR, 0.1, 0.6, 0.2, g.cam.aimDirection());
        g.tutorial.notify('absorb');
        return { cameraKick: { fov: -3 } };
      }
      if (ctx.shape === 'supply') return supply(ctx);
      if (ctx.shape === 'circuit') return circuit(ctx);
      return undefined;
    },
    passive(g, dt) {
      const t = g.techniques;
      if (!t.casting) heldAtCast = t.resource;
      const frozen = pondFrozen(g);
      // Charge leaks on its own, and runs out into water you stand in.
      const wet = t.resource > 0 && wetAt(g, g.player.position, frozen);
      if (t.resource > 0) t.resource = Math.max(0, t.resource - (wet ? LEAK_WET : LEAK * (1 - g.mastery.get('electro', 'efficiency') * 0.6)) * dt);
      if (wet && Math.random() < dt * 8) {
        const p = g.player.position, a = Math.random() * Math.PI * 2;
        g.vfx.arc(surfaceOver(g, wet, p), surfaceOver(g, wet, p.clone().add(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(0.6 + Math.random()))), COLOR, 0.12, 0.03, 0.2);
      }
      if (openFor > 0) { openFor -= dt; convertProps(g); }
      // Held charge crackles on the hands: lit in first person, arcing between them from outside.
      const k = t.resource / t.def.resource.max;
      if (k > 0.35 && Math.random() < dt * 4 * k) {
        if (g.cam.isFirst) g.hands.pulse(0.2 + Math.random() * 0.25 * k);
        else {
          const h = g.avatar.boneWorld('hand_r', new THREE.Vector3());
          g.vfx.arc(h, h.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.35, (Math.random() - 0.5) * 0.35, (Math.random() - 0.5) * 0.35)), COLOR, 0.1, 0.025, 0.5);
        }
      }
      // The sign tears an arc between the hands on its release.
      const s = t.sign;
      if (s.kind === 'signing' && signAt < 1.2 && s.t >= 1.2 && !g.cam.isFirst) {
        const l = g.avatar.boneWorld('hand_l', new THREE.Vector3()), r = g.avatar.boneWorld('hand_r', new THREE.Vector3());
        g.vfx.arc(l, r, COLOR, 0.3, 0.06, 0.3);
        g.audio.play('electro.jump', { at: r });
      }
      signAt = s.kind === 'signing' ? s.t : -1;
      tickHeld(g, dt);
    },
    reset() { openFor = 0; held.clear(); signAt = -1; heldAtCast = 0; },
    onStruck(g, amount, from) {
      if (openFor <= 0) return amount;
      const dir = from.clone().sub(g.player.position).setY(0).normalize();
      if (windowCtx.front && g.cam.aimDirection().setY(0).normalize().dot(dir) < 0.3) return amount;
      // The hands take in only so much at once; the rest of the blow lands.
      const taken = Math.min(amount, intake(g));
      store(g, taken, g.player.eye().addScaledVector(dir, 0.6).add(new THREE.Vector3(0, -0.3, 0)));
      g.tutorial.notify('absorbed');
      g.mastery.gainPassive('electro', 'tolerance', 0.006);
      g.mastery.gainPassive('electro', 'control', 0.003);
      return amount - taken;
    },
  },
  audio: { primary: 'electro.cast', secondary: 'electro.convert.cast', max: 'electro.max.cast' },
};

function tickHeld(g: Game, dt: number): void {
  if (!held.size) return;
  const me = g.player.position;
  for (const [p, h] of held) {
    h.left -= dt;
    if (!p.alive || h.left <= 0) { held.delete(p); continue; }
    const at = p.mesh.position;
    if ((h.next -= dt) <= 0) {
      h.next = 0.15 + Math.random() * 0.25;
      g.vfx.arc(at.clone().add(new THREE.Vector3(0, p.half.y * 0.6, 0)), at.clone().add(new THREE.Vector3((Math.random() - 0.5) * p.half.x * 3, p.half.y * (0.5 + Math.random()), (Math.random() - 0.5) * p.half.z * 3)), COLOR, 0.1, 0.03, 0.4);
      g.audio.play('electro.crackle', { at });
    }
    // Touching: within a hand's breadth of its sides.
    const touching = (q: THREE.Vector3) => Math.hypot(Math.max(0, Math.abs(q.x - at.x) - p.half.x), Math.max(0, Math.abs(q.z - at.z) - p.half.z)) < HELD_TOUCH && Math.abs(q.y + 0.9 - at.y) < 1.5;
    const body = g.targets().find((e) => e.alive && touching(e.position));
    if (body) {
      g.vfx.arc(at, body.center(), COLOR, 0.24, 0.08, 0.2);
      g.combat.hitEnemy(body, h.charge, { from: at, kind: 'shock', knock: 0.6, stagger: true });
      crawl(g, body.center(), 4);
      g.audio.play('electro.discharge', { at, weight: h.charge / 60 });
      held.delete(p);
    } else if (touching(me)) {
      // The player's own charge, in metal they walked into.
      g.vfx.arc(at, g.player.position.clone().add(new THREE.Vector3(0, 1, 0)), COLOR, 0.24, 0.08, 0.2);
      held.delete(p);
      backlash(g, h.charge * 0.6);
    }
  }
}

// What the checks read: the props holding charge, and whether the pond carries.
export function electroView(g: Game): { held: { id: number; charge: number; left: number }[]; pondLive: boolean; open: number } {
  return { held: [...held].map(([p, h]) => ({ id: p.id, charge: h.charge, left: h.left })), pondLive: !pondFrozen(g), open: openFor };
}
