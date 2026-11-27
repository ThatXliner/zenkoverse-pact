import * as THREE from 'three';
import { signal } from '@preact/signals';
import type { TechniqueKit, AbilityContext } from '../kit';
import type { Game } from '../../app/game';
import { signGesture, gestureSet, rangeFor, frontOnly, targetsAllowed } from './shared';
import type { Pact } from '../../pacts/schema';
import { opening, blow, type CutsceneDef } from '../../cutscene/cutscene';
import { GROUP_WORLD, GROUP_PROP } from '../../physics/world';
import { addPuff, herd, blowOut, soak, vent, tickVapour, resetVapour, self, tally, VAPOUR } from './fuelVapour';
import { dokasen, showStation } from '../../drills/dokasen';

// Fuel (燃): the user makes a faint combustible vapour and moves it, and that
// is all. She cannot light it. Fire comes from outside: a stone lantern's
// flame the vapour climbs to, a Heat user, an Electro spark, iron striking
// sparks off stone in a heavy blow, the Kuroda's own fire. So the kit is
// played ahead of time: lay it, herd it to the right density and place, and
// find the flame. Where it gathers matters more than where she stands when it
// burns, and it burns her too if she stands in it. The vapour itself, and
// every rule of how it drifts, thins and burns, is src/techniques/kits/fuelVapour.ts.

const COLOR = 0xb4d23c;

// Residue each cast leaves on the hands (0 to 1; past `catches` a passing flame sets the user alight).
const RESIDUE = { lay: 0.15, pour: 0.025, soak: 0.08, herd: 0.03, clear: -0.3, max: 0.6 };
// How long a herd outlasts the last frame its key was down, and how long an untimed one runs.
const HOLD_GRACE = 0.12, HERD_TAP = 0.8;

export const fuelUi = { residue: signal(0) };

const catalogue: Pact[] = [
  { id: 'fuel.dispersal', technique: 'fuel', name: 'Dispersal', slot: 'primary', grant: { shape: 'lay', behaviors: ['fan'] }, clauses: [
    { kind: 'restrict', restriction: { param: 'range', value: 'medium' } }, { kind: 'restrict', restriction: { param: 'trigger', value: 'grounded' } }] },
  { id: 'fuel.concentration', technique: 'fuel', name: 'Concentration', slot: 'secondary', grant: { shape: 'herd' }, clauses: [
    { kind: 'restrict', restriction: { param: 'duration', value: 'held' } }, { kind: 'restrict', restriction: { param: 'body', value: 'bothHands' } }] },
  { id: 'fuel.delayed-ignition', technique: 'fuel', name: 'Delayed Ignition', slot: 'art1', grant: { shape: 'soak', behaviors: ['linger'] }, clauses: [
    { kind: 'restrict', restriction: { param: 'range', value: 'short' } }, { kind: 'restrict', restriction: { param: 'target', value: 'single' } }] },
  { id: 'fuel.saturation', technique: 'fuel', name: 'Saturation', slot: 'max', grant: { shape: 'saturate' }, clauses: [
    { kind: 'restrict', restriction: { param: 'resource', value: 'all' } }, { kind: 'restrict', restriction: { param: 'trigger', value: 'declared' } }, { kind: 'restrict', restriction: { param: 'range', value: 'medium' } }] },
];

// Saturation: close on the hands as they pull the vapour in from all round,
// a low look past the cupped palms at the target, the cut wide as the
// condensed charge is driven out and drenches it, and the flood settling over
// the ground in watercolour, waiting for a flame that is not hers to give.
const cutscene: CutsceneDef = {
  id: 'max-fuel', title: { jp: '飽和', en: 'Saturation' }, color: COLOR, pull: 2.8, reach: 11, word: 'ドプッ',
  shots: [
    { duration: 1.05, timeScale: 0.03, from: { pos: [-0.9, 1.25, 1.9], look: [0, 1.15, 0], fov: 38 }, to: { pos: [-0.62, 1.2, 1.4], fov: 31, roll: -0.04 }, events: opening('fuel.max.charge') },
    { duration: 0.5, timeScale: 0.03, from: { pos: [0.35, 1.05, 0.55], look: [0, 1.0, 0], lookRel: 'target', fov: 48, roll: 0.06 }, to: { pos: [0.3, 1.02, 0.4], fov: 42, roll: 0.09 }, ease: 'in', events: [{ at: 0.05, kind: 'sfx', id: 'fuel.max.inhale' }], page: { lines: 'rush' } },
    { duration: 0.95, timeScale: 0.3, from: { rel: 'mid', pos: [-4.0, 0.8, 0.3], look: [0, 0.8, 0], fov: 62, roll: 0.08 }, to: { pos: [-5.0, 1.2, 0.7], fov: 70, roll: 0.03 }, events: [...blow(0, 'fuel.max.blow', 0.7)], page: { lines: 'focus' } },
    { duration: 0.85, timeScale: 0.45, from: { rel: 'mid', pos: [2.4, 2.6, -3.4], look: [0, 0.2, 0], fov: 56 }, to: { pos: [2.9, 3.4, -4.2], fov: 60 }, ease: 'inOut', page: { look: 'watercolor' } },
  ],
};

// ---------------------------------------------------------------- state
interface Herding { left: number; held: boolean; potency: number; thin: boolean; front: boolean; radius: number; ring: number; took: number }
interface Pouring { at: THREE.Vector3 | null; t: number; potency: number; range: number }
let herding: Herding | null = null;
let pouring: Pouring | null = null;

const flatOf = (v: THREE.Vector3): THREE.Vector3 => { const f = v.clone().setY(0); return f.lengthSq() > 1e-6 ? f.normalize() : new THREE.Vector3(0, 0, -1); };
const addResidue = (amount: number): void => { self.residue = THREE.MathUtils.clamp(self.residue + amount, 0, 1.2); };

// Where the user is pointing on the ground now: under the cursor top-down,
// else where the aim meets the world.
function aimPoint(g: Game): THREE.Vector3 {
  if (g.cam.isTop && g.cam.floorPoint) return g.cam.floorPoint.clone();
  const eye = g.player.eye(), dir = g.cam.aimDirection();
  const hit = g.physics.castRay(eye, dir, 30, GROUP_WORLD | GROUP_PROP, g.player.body);
  return hit ? hit.point : eye.addScaledVector(dir, 12);
}

// ---------------------------------------------------------------- Dispersal
// A trail breathed out from the hands along the ground, from the feet to the
// aim. Each puff is thin enough to carry a flame and no more. `fan` lays two
// lines side by side; a vow to the front lays one narrow line that breaks easily.
function lay(ctx: AbilityContext) {
  const g = ctx.game, me = g.player.position;
  const allow = targetsAllowed(ctx);
  const aim = ctx.aim ?? me.clone().addScaledVector(flatOf(ctx.dir), 6);
  const dir = flatOf(aim.clone().sub(me));
  const len = THREE.MathUtils.clamp(Math.hypot(aim.x - me.x, aim.z - me.z), 2, rangeFor(ctx, 7.5));
  const fan = ctx.behaviors.includes('fan');
  const r = 0.62 * (frontOnly(ctx) ? 0.75 : 1);
  const side = new THREE.Vector3(-dir.z, 0, dir.x);
  const lines = fan ? [-0.6, 0.6] : [0];
  const bodies = allow.people ? g.targets().filter((e) => e.alive) : [];
  const met = new Set<unknown>();
  let stop = len;
  if (allow.single) {
    // A vow to one target: the trail runs to the first body on its line and no further.
    for (const e of bodies) {
      const to = e.position.clone().sub(me); const along = to.dot(dir);
      if (along > 0 && along < stop && Math.abs(to.dot(side)) < 1) stop = along + 0.4;
    }
  }
  const step = 0.75;
  for (let s = 0.45; s <= stop; s += step) for (const o of lines) {
    const at = me.clone().addScaledVector(dir, s).addScaledVector(side, o);
    addPuff(g, at, r, fan ? 0.45 : 0.5, ctx.potency);
    for (const e of bodies) if (Math.hypot(e.position.x - at.x, e.position.z - at.z) < r + 0.3) met.add(e);
  }
  // The trail ends on a drum: its bung is knocked open.
  let vents = 0;
  if (allow.props) for (const p of g.props.instances) if (Math.hypot(p.mesh.position.x - (me.x + dir.x * stop), p.mesh.position.z - (me.z + dir.z * stop)) < 1.3 && vent(g, p, ctx.potency)) vents++;
  const hand = g.player.eye().addScaledVector(dir, 0.5).add(new THREE.Vector3(0, -0.6, 0));
  g.vfx.trail([hand, me.clone().addScaledVector(dir, 1.2).setY(me.y + 0.3), me.clone().addScaledVector(dir, stop * 0.6).setY(me.y + 0.15), me.clone().addScaledVector(dir, stop).setY(me.y + 0.1)], COLOR, 0.5 * r, 0.45);
  g.audio.play('fuel.lay', { at: me });
  addResidue(RESIDUE.lay);
  g.mastery.gainPassive('fuel', 'control', 0.002);
  return { hits: met.size + vents, cameraKick: { fov: 3, pitch: -0.01 } };
}

// Dispersal held: the vapour runs out of the hand to wherever the aim moves,
// a line drawn on the ground as long as the key is down.
function pour(g: Game, p: Pouring, dt: number): void {
  p.t -= dt;
  const at = aimPoint(g), me = g.player.position;
  const off = at.clone().sub(me).setY(0);
  if (off.length() > p.range) at.copy(me).add(off.setLength(p.range));
  if (p.t > 0 && p.at && p.at.distanceTo(at) < 0.55) return;
  p.t = 0.14;
  p.at = at.clone();
  addPuff(g, at, 0.6, 0.42, p.potency);
  addResidue(RESIDUE.pour);
  g.audio.play('fuel.pour', { at });
}

// ---------------------------------------------------------------- Delayed Ignition
// A fine spray at one thing within reach: a body takes the fuel on its
// clothes and carries it until fire finds it; a drum is opened; anything else
// gets a dense, still charge laid at the aim to wait for a flame.
function douse(ctx: AbilityContext) {
  const g = ctx.game, me = g.player.position, eye = g.player.eye();
  const reach = rangeFor(ctx, 4.5);
  const allow = targetsAllowed(ctx);
  const flat = flatOf(ctx.dir);
  const linger = ctx.behaviors.includes('linger');
  const hand = eye.clone().addScaledVector(flat, 0.6).add(new THREE.Vector3(0.15, -0.3, 0));
  const e = allow.people ? g.techniques.enemiesInCone(eye, ctx.dir, reach + 1, frontOnly(ctx) ? 0.3 : 0.5).sort((a, b) => a.position.distanceTo(me) - b.position.distanceTo(me))[0] : undefined;
  let hits = 0;
  let at: THREE.Vector3;
  if (e) {
    soak(e, ctx.potency * (linger ? 1.3 : 1));
    at = e.center();
    g.vfx.burst(at, 8, 'spark', 2, 0x8a9a3a, flat);
    hits = 1;
  } else {
    // The thing under the aim, if any is within reach.
    const aimed = ctx.aim ?? me.clone().addScaledVector(flat, reach);
    const prop = allow.props ? g.props.instances.filter((p) => p.alive && p.mesh.position.distanceTo(me) < reach + 0.6 && Math.hypot(p.mesh.position.x - aimed.x, p.mesh.position.z - aimed.z) < Math.max(p.half.x, p.half.z) + 0.6).sort((a, b) => a.mesh.position.distanceTo(aimed) - b.mesh.position.distanceTo(aimed))[0] : undefined;
    if (prop && vent(g, prop, ctx.potency)) { at = prop.mesh.position.clone(); hits = 1; }
    else {
      at = me.clone().add(aimed.clone().sub(me).setY(0).clampLength(0, reach));
      // Laid on the ground she stands on, never on top of whatever the aim falls on (a lantern's roof).
      at.y = Math.abs(aimed.y - me.y) < 0.8 ? aimed.y : me.y;
      if (prop) at.copy(prop.mesh.position);
      addPuff(g, at, 0.75, 0.82, ctx.potency, linger ? 20 : 8);
    }
  }
  g.vfx.trail([hand, hand.clone().lerp(at, 0.5).add(new THREE.Vector3(0, 0.15, 0)), at], COLOR, 0.22, 0.35);
  g.audio.play('fuel.soak', { at });
  addResidue(RESIDUE.soak);
  return { hits, hitStop: hits ? 0.03 : 0, cameraKick: { fov: 3 } };
}

// ---------------------------------------------------------------- Concentration
function tickHerd(g: Game, h: Herding, dt: number): void {
  const at = aimPoint(g);
  const speed = 3.4 + 3.2 * g.mastery.get('fuel', 'control');
  const front = h.front ? flatOf(g.cam.aimDirection()) : undefined;
  herd(g, at, h.radius, dt, speed, h.thin, front);
  // The family's own fuel is the same stuff: her hands draw the Kuroda's
  // waiting pour up off the ground, and it is hers to move.
  if (!h.thin) for (const e of g.encounters.enemies) for (const p of e.drawFuel(at, 1.4)) {
    addPuff(g, p, 1.25, 1.0, Math.max(1, h.potency), 1);
    g.vfx.gather(p, 1.6, 8, 0.4, COLOR);
    g.audio.play('fuel.take', { at: p });
    tally.taken++;
    h.took++;
  }
  addResidue(RESIDUE.herd * dt);
  if ((h.ring -= dt) <= 0) {
    h.ring = 0.3;
    g.vfx.ring(at.clone().add(new THREE.Vector3(0, 0.06, 0)), COLOR, h.thin ? 0.4 : h.radius, h.thin ? h.radius : 0.4, 0.4, undefined, 0.5);
    g.audio.play('fuel.herding', { at });
  }
}

// ---------------------------------------------------------------- Saturation
// Every bit of vapour she can make, condensed and driven out at once: the
// target is drenched and thrown back by it, and the ground for metres round
// it is flooded at the density that burns hottest, lying still for a while.
// Round the user herself the air stays clear. She still cannot light it.
function saturate(ctx: AbilityContext) {
  const g = ctx.game, me = g.player.position.clone();
  const flat = flatOf(ctx.dir);
  const range = rangeFor(ctx, 9);
  const target = g.techniques.enemiesInSphere(me.clone().addScaledVector(flat, 3.5), 4).sort((a, b) => a.position.distanceTo(me) - b.position.distanceTo(me))[0];
  const center = target ? target.position.clone() : me.clone().addScaledVector(flat, Math.min(5, range));
  let hits = 0;
  if (target) {
    g.combat.hitEnemy(target, (40 + 50 * Math.min(1, ctx.potency)) * ctx.potency, { from: me, knock: 6, lift: 1.5, kind: 'kinetic', heavy: true });
    hits++;
  }
  const R = Math.min(6.5, range * 0.75);
  for (let ring = 0; ring < 4; ring++) {
    const rr = ring * 1.6, n = ring === 0 ? 1 : Math.round(rr * 3.4);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + ring * 0.4;
      const at = center.clone().add(new THREE.Vector3(Math.cos(a) * rr, 0, Math.sin(a) * rr));
      if (Math.hypot(at.x - me.x, at.z - me.z) < 2.2 || rr > R) continue;
      addPuff(g, at, 1.1, VAPOUR.best, ctx.potency * 1.2, 14);
    }
  }
  for (const e of g.techniques.enemiesInSphere(center, R)) { soak(e, ctx.potency * 1.5); if (e !== target) hits++; }
  const hand = g.player.eye().addScaledVector(flat, 0.7).add(new THREE.Vector3(0, -0.3, 0));
  for (let k = 0; k < 5; k++) {
    const sway = new THREE.Vector3((Math.random() - 0.5) * 0.8, 0, (Math.random() - 0.5) * 0.8);
    g.vfx.trail([hand, hand.clone().lerp(center, 0.5).add(sway).setY(me.y + 0.9), center.clone().add(sway).setY(center.y + 0.6)], COLOR, 0.9, 0.7);
  }
  g.vfx.ring(center.clone().add(new THREE.Vector3(0, 0.08, 0)), COLOR, 0.6, R * 1.3, 0.8);
  g.vfx.burst(center.clone().add(new THREE.Vector3(0, 1, 0)), 24, 'spark', 5, 0x8a9a3a, flat);
  g.audio.play('fuel.max.tail', { at: center });
  addResidue(RESIDUE.max);
  return { hits: Math.max(1, hits), hitStop: 0.12, impactFrame: 3, rooted: 1.0, cameraKick: { fov: 12, pitch: 0.03 } };
}

// ---------------------------------------------------------------- the kit
export const fuel: TechniqueKit = {
  id: 'fuel', name: 'Fuel', glyph: '燃', color: COLOR, type: 'Production, Matter', sfx: 'ボワッ',
  blurb: 'Make a faint vapour that burns, and move it. You cannot light it. Something else has to.',
  breadth: 2,
  resource: { name: 'Vapour', max: 100, regen: 7, startsFull: true },
  gauge: { name: 'Residue', glyph: '油', value: fuelUi.residue },
  primitive: { name: 'Fuel', short: 'lay vapour', description: 'Breathe a trail of vapour along the ground from your feet to the aim. It burns only when something else lights it.' },
  parameters: ['direction', 'range', 'target', 'trigger', 'duration', 'resource', 'body'],
  shapes: {
    lay: { label: 'lays a trail of vapour from your feet to the aim', short: 'lay a trail', kinds: ['primary'], description: 'Thin enough to carry a flame and no more. Held, it follows the aim while the key is down.' },
    soak: { label: 'sprays one body or thing within reach with vapour', short: 'soak one target', kinds: ['primary'], description: 'A soaked body carries the fuel and drips it as it moves. A drum is opened. Anything else gets a dense charge laid to wait.' },
    herd: { label: 'draws the vapour round the aim together', short: 'herd vapour', kinds: ['secondary'], description: 'Hold. Drawn together it gets denser and climbs higher. Draws up the Kuroda\'s poured fuel as well.' },
    clear: { label: 'blows the vapour out of the air round you', short: 'clear the air', kinds: ['secondary'], description: 'A breath out from the whole body: your own vapour away from you, and some of the residue off your hands.' },
    saturate: { label: 'condenses all of it into one drenching charge', short: 'flood the ground', kinds: ['max'], description: 'The target is drenched and thrown back, and the ground round it flooded with vapour that waits for a flame.' },
  },
  behaviors: { fan: 'two lines side by side, a little thinner', linger: 'what it soaks holds the fuel longer and burns harder', thin: 'pushes the vapour apart instead, thinning it' },
  catalogue,
  gestures: {
    // Dispersal: the palm cups the vapour at the hip, then sweeps out low and
    // wide, fingers trailing, as if strewing it along the ground.
    primary: gestureSet(0.6, 0.24, [
      { t: 0, right: 'fanGather', left: 'guard', slow: true },
      { t: 0.14, right: 'fanGather' },
      { t: 0.24, right: 'fanSweep', snap: true, camera: { fov: 3, pitch: -0.01 } },
      { t: 0.42, right: 'fanSweep', left: 'guard' },
      { t: 0.56, right: 'rest', left: 'rest' },
    ]),
    // Delayed Ignition: the fingertips pinched at the shoulder, then flicked
    // open at the target in a fine spray.
    soak: gestureSet(0.5, 0.2, [
      { t: 0, right: 'flickReady', left: 'guard', slow: true },
      { t: 0.12, right: 'flickReady' },
      { t: 0.2, right: 'flickOpen', snap: true, camera: { fov: 3 } },
      { t: 0.44, right: 'rest', left: 'rest' },
    ]),
    // Concentration, held: both hands out and cupped, drawing the air in.
    secondary: gestureSet(0.5, 0.18, [
      { t: 0, right: 'herdCup', left: 'herdCup', slow: true },
      { t: 0.18, right: 'herdDraw', left: 'herdDraw', snap: true, camera: { fov: -2 } },
      { t: 0.4, right: 'herdCup', left: 'herdCup' },
    ], true),
    // Clear: both hands thrown out wide from the chest.
    clear: gestureSet(0.5, 0.16, [
      { t: 0, right: 'condense', left: 'condense', slow: true },
      { t: 0.16, right: 'parting', left: 'parting', snap: true, camera: { fov: 6 } },
      { t: 0.44, right: 'rest', left: 'rest' },
    ]),
    // Saturation: both arms sweep in low from the sides, the palms close
    // cupped on what they gathered, and drive it out together.
    max: gestureSet(2.3, 1.7, [
      { t: 0, right: 'fanSweep', left: 'fanSweep', slow: true },
      { t: 0.8, right: 'condense', left: 'condense', slow: true },
      { t: 1.3, right: 'herdDraw', left: 'herdDraw' },
      { t: 1.62, right: 'twinPalm', left: 'twinPalm', snap: true, camera: { fov: 12, pitch: 0.03 } },
      { t: 2.1, right: 'rest', left: 'rest' },
    ]),
  },
  // The palms press together, then part slowly with the fingers spread, as
  // if something clinging stretched between them, and close again; on the
  // release both hands strew it down and out. The right keeps a cupped palm.
  sign: signGesture([
    { t: 0, right: 'sealGather', left: 'sealGather', slow: true },
    { t: 0.45, right: 'seal', left: 'seal', snap: true, camera: { fov: -3 }, event: 'seal' },
    { t: 0.66, right: 'stretch', left: 'stretch' },
    { t: 0.88, right: 'stretchWide', left: 'stretchWide', slow: true },
    { t: 1.04, right: 'stretch', left: 'stretch' },
    { t: 1.2, right: 'fanSweep', left: 'fanSweep', snap: true, camera: { fov: 6 }, event: 'release' },
    { t: 1.42, right: 'fanGather', left: 'guard' },
  ]),
  // What a Fuel cast does to a prop, by what it is made of.
  traits: {
    // A drum of the family's stock: its bung is knocked open and it leaks.
    metal: (prop, ctx) => { vent(ctx.game, prop, ctx.potency); },
    // Cloth, card and dry wood drink it in: a dense charge on them, waiting.
    porous: (prop, ctx) => { addPuff(ctx.game, prop.mesh.position.clone(), Math.max(0.7, prop.half.x + 0.3), 0.85, ctx.potency, 12); },
    flammable: (prop, ctx) => { addPuff(ctx.game, prop.mesh.position.clone(), Math.max(0.7, prop.half.x + 0.3), 0.8, ctx.potency, 8); },
  },
  drill: dokasen,
  cutscene,
  effects: {
    cast(ctx) {
      const g = ctx.game;
      const held = g.techniques.current?.held ?? false;
      if (ctx.shape === 'lay') {
        if (held) { pouring = { at: null, t: 0, potency: ctx.potency, range: rangeFor(ctx, 9) }; g.audio.play('fuel.lay', { at: g.player.position, pitch: 1.2 }); return { cameraKick: { fov: 2 } }; }
        return lay(ctx);
      }
      if (ctx.shape === 'soak') return douse(ctx);
      if (ctx.shape === 'herd') {
        herding = { left: held ? HOLD_GRACE : HERD_TAP, held, potency: ctx.potency, thin: ctx.behaviors.includes('thin'), front: frontOnly(ctx), radius: rangeFor(ctx, 5), ring: 0, took: 0 };
        g.audio.play('fuel.herd', { at: g.player.position });
        return { cameraKick: { fov: -2 } };
      }
      if (ctx.shape === 'clear') {
        const n = blowOut(g.player.position, rangeFor(ctx, 3.6), 5.5);
        addResidue(RESIDUE.clear);
        const me = g.player.position.clone().add(new THREE.Vector3(0, 0.1, 0));
        g.vfx.ring(me, COLOR, 0.5, 3.6, 0.4);
        g.vfx.ring(me.clone().add(new THREE.Vector3(0, 0.9, 0)), 0xf2f0e6, 0.3, 2.2, 0.3);
        g.audio.play('fuel.clear', { at: me });
        return { hits: 0, cameraKick: { fov: n ? 6 : 4 } };
      }
      if (ctx.shape === 'saturate') return saturate(ctx);
      return undefined;
    },
    hold(ctx, dt) {
      if (ctx.shape === 'herd' && herding) herding.left = Math.max(herding.left, HOLD_GRACE);
      if (ctx.shape === 'lay' && pouring) pour(ctx.game, pouring, dt);
    },
    release(ctx) {
      if (ctx.shape === 'herd' && herding) herding.left = 0;
      if (ctx.shape === 'lay') pouring = null;
    },
    passive(game, dt) {
      const g = game;
      if (herding?.held && !g.techniques.casting) herding.left = 0;
      if (pouring && !g.techniques.casting) pouring = null;
      if (herding) { if (herding.left > 0) tickHerd(g, herding, dt); if ((herding.left -= dt) <= 0) herding = null; }
      tickVapour(g, dt);
      // The gauge reads full where a passing flame would set the user alight.
      fuelUi.residue.value = self.residue / VAPOUR.residue.catches;
      showStation(g, true);
    },
    reset(game) {
      herding = null; pouring = null;
      resetVapour();
      fuelUi.residue.value = 0;
      showStation(game, false);
    },
  },
  audio: { primary: 'fuel.cast', secondary: 'fuel.herd', max: 'fuel.max.cast' },
};

// For the checks: whether a herd or a pour is running now.
export const fuelHands = (): { herding: boolean; pouring: boolean; took: number } => ({ herding: !!herding && herding.left > 0, pouring: !!pouring, took: herding?.took ?? 0 });
