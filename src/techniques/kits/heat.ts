import * as THREE from 'three';
import { signal } from '@preact/signals';
import type { TechniqueKit, AbilityContext } from '../kit';
import { signGesture, gestureSet, rangeFor, propsInCone, frontOnly, targetsAllowed, breakProp } from './shared';
import { restriction, type Pact } from '../../pacts/schema';
import { opening, blow, type CutsceneDef } from '../../cutscene/cutscene';
import type { DrillDef, DrillTier } from '../../drills/drills';
import type { Game } from '../../app/game';
import type { Enemy } from '../../combat/enemies';
import type { PropInstance } from '../../world/props';
import { QUENCH } from '../../world/compound';
import { surfaceAt } from '../../audio/surfaces';
import { meltPond } from './rime';
import { kindle } from '../ignition';

// Heat (issue #18): any energy the user can reach goes in, a blow, a moving
// thing, their own body, and it comes out only as heat. Nothing here pushes:
// a body hit by Heat is burned, not thrown. The cost lives in the user's own
// body. Every cast leaves some heat in the hands, more when it lands on
// nothing, and a blow taken in heats them too. Past the top they overheat:
// they burn, slow, and can take nothing more in until they cool. Water takes
// heat best, so the pond (or any stream) is where a Heat user vents.

const COLOR = 0xff4a5e;
const EMBER = 0xffa04a;

// Every number the kit plays by, in one place.
export const HEAT = {
  // Body heat one cast leaves in the hands: when its heat lands somewhere,
  // when it lands on nothing, and for the exact dose of a spot. Control takes
  // up to half of it away; `steady` takes half of what is left.
  spill: { landed: 0.07, wasted: 0.2, spot: 0.035 },
  // Releasing heat into a body this close (metres) puts some back into you.
  pointBlank: { within: 1.1, spill: 0.14, hurt: 4 },
  // Cooling a second, at rest; Tolerance raises it. Standing in water adds
  // `water`, on wet stone or ice `wet`; heat thrown into water takes
  // `quench` off at once.
  vent: { rate: 0.07, water: 0.5, wet: 0.12, quench: 0.35 },
  // Body heat at which the user overheats, and below which it clears.
  overheat: { at: 1, clears: 0.85, hurt: 7, speed: 0.8 },
  // Impact Conversion: how much of a blow it takes in a second (the draw
  // rate, from its base and its potency), what one point of a blow is worth
  // in Draw, and what it leaves in the body.
  convert: { rate: 16, perPotency: 22, draw: 1.4, heat: 0.011, reach: 3.6, fire: 8 },
  // Heat a cast puts into a prop, before its potency.
  dose: { sear: 0.2, searPotency: 0.12, spot: 0.12, spotPotency: 0.08 },
  // A flammable prop catches at this heat.
  ignite: 0.55,
  // A body burned keeps burning: seconds, a tick, its damage.
  burn: { seconds: 1.2, scorch: 2.6, tick: 0.5, dmg: 3.5 },
  // A prop on fire: how long, its tick, its reach, what it does to bodies and
  // to the player, and how near another flammable thing must be to catch.
  fire: { seconds: 4.5, tick: 0.5, radius: 1.4, enemy: 5, player: 4, spread: 1.6 },
  // Hot metal burns what touches it, once in a while each.
  hot: { at: 0.5, reach: 0.55, dmg: 6, every: 0.7 },
  // White Heat leaves the body this hot: the heat it could not place.
  max: { core: 1.2, radius: 6.5 },
};

export const heatUi = { core: signal(0) };

// What the kit keeps between frames.
const st = {
  core: 0,
  overheated: false,
  // Seconds into the current overheat tick, and to the next wisp of steam.
  hurtT: 0,
  wispT: 0,
  ventT: 0,
  // Draw as it stood a frame ago: White Heat spends it all on its cast.
  drawBefore: 0,
  brace: null as null | { front: boolean; cap: number; bucket: number },
};
const burns = new Map<Enemy, { left: number; tick: number; dmg: number }>();
const fires: { prop: PropInstance; left: number; tick: number; age: number }[] = [];
const touched = new Map<PropInstance, number>();

const catalogue: Pact[] = [
  { id: 'heat.searing-hand', technique: 'heat', name: 'Searing Hand', slot: 'primary', grant: { shape: 'sear', behaviors: ['scorch'] }, clauses: [
    { kind: 'restrict', restriction: { param: 'range', value: 'short' } }, { kind: 'restrict', restriction: { param: 'direction', value: 'front' } }] },
  { id: 'heat.impact-conversion', technique: 'heat', name: 'Impact Conversion', slot: 'secondary', grant: { shape: 'convert' }, clauses: [
    { kind: 'restrict', restriction: { param: 'duration', value: 'held' } }, { kind: 'restrict', restriction: { param: 'body', value: 'bothHands' } }, { kind: 'restrict', restriction: { param: 'trigger', value: 'grounded' } }] },
  { id: 'heat.metabolic', technique: 'heat', name: 'Metabolic Heating', slot: 'primary', grant: { shape: 'spot', behaviors: ['steady'] }, clauses: [
    { kind: 'restrict', restriction: { param: 'resource', value: 'health' } }, { kind: 'restrict', restriction: { param: 'trigger', value: 'still' } }] },
  { id: 'heat.white-heat', technique: 'heat', name: 'White Heat', slot: 'max', grant: { shape: 'whiteHeat' }, clauses: [
    { kind: 'restrict', restriction: { param: 'body', value: 'palmContact' } }, { kind: 'restrict', restriction: { param: 'resource', value: 'all' } }, { kind: 'restrict', restriction: { param: 'trigger', value: 'declared' } }] },
];

// White Heat: close on the cupped hands as the glow climbs, a low look at the
// palm as it draws back, the cut wide and side on as it lands flat on the
// target, and the steam rolling off both of them in ink wash.
const cutscene: CutsceneDef = {
  id: 'max-heat', title: { jp: '白熱', en: 'White Heat' }, color: COLOR, pull: 2.6, reach: 10, word: 'ジュウゥッ',
  shots: [
    { duration: 1.05, timeScale: 0.03, from: { pos: [0.85, 1.3, 1.8], look: [0, 1.15, 0], fov: 36 }, to: { pos: [0.58, 1.24, 1.32], fov: 29, roll: 0.04 }, events: opening('heat.max.charge') },
    { duration: 0.5, timeScale: 0.03, from: { pos: [0.75, 0.95, 0.75], look: [0, 1.2, 0.2], fov: 54, roll: 0.12 }, to: { pos: [0.6, 0.98, 0.6], fov: 46, roll: 0.08 }, ease: 'in', events: [{ at: 0.05, kind: 'sfx', id: 'heat.max.inhale' }], page: { lines: 'rush' } },
    { duration: 0.95, timeScale: 0.3, from: { rel: 'mid', pos: [-4.0, 1.15, 0.3], look: [0, 1.1, 0], fov: 60, roll: 0.08 }, to: { pos: [-5.0, 1.5, 0.7], fov: 72, roll: 0.03 }, events: [...blow(0, 'heat.max.blow', 0.85)], page: { lines: 'focus' } },
    { duration: 0.75, timeScale: 0.45, from: { rel: 'mid', pos: [2.4, 2.2, -3.4], look: [0, 1.0, 0], fov: 56 }, to: { pos: [2.9, 3.0, -4.2], fov: 60 }, ease: 'inOut', page: { look: 'wash' } },
  ],
};

const ramp = (x: number, lo: number, hi: number) => THREE.MathUtils.clamp((x - lo) / (hi - lo), 0, 1);

// Heat the user keeps from a cast: Control halves it at most, and a steady
// Pact halves what is left.
function spill(g: Game, amount: number, steady = false): void {
  st.core += amount * (1 - 0.5 * g.mastery.get('heat', 'control')) * (steady ? 0.5 : 1);
}

// What is at ground level here: open water takes heat best, wet stone and
// ice steam, everything else nothing.
function waterAt(g: Game, at: THREE.Vector3): 'water' | 'wet' | 'ice' | null {
  const hit = g.physics.castRay(new THREE.Vector3(at.x, at.y + 2, at.z), new THREE.Vector3(0, -1, 0), 6);
  const p = hit ? hit.point : at;
  const s = surfaceAt(p, (hit?.collider as { surfaceTag?: string } | undefined)?.surfaceTag ?? '');
  return s === 'water' || s === 'wet' || s === 'ice' ? s : null;
}

// Sets a body burning for `seconds`, `dmg` a tick. Anything that burns a body
// does it through here (Fuel's vapour too), and the burns tick in `tickBurns`.
export function burn(e: Enemy, seconds: number, dmg: number): void {
  const b = burns.get(e);
  // A burn is refreshed, never stacked: a second hit keeps it going, no more.
  if (b) { b.left = Math.max(b.left, seconds); b.dmg = Math.max(b.dmg, dmg); return; }
  burns.set(e, { left: seconds, tick: 0, dmg });
}

// Sets a flammable prop alight: it burns where it stands (`tickFires`).
export function ignite(g: Game, p: PropInstance): boolean {
  if (!p.alive || fires.some((f) => f.prop === p)) return false;
  fires.push({ prop: p, left: HEAT.fire.seconds, tick: 0, age: 0 });
  const base = p.mesh.position.clone().setY(p.mesh.position.y - p.half.y);
  g.vfx.flames(base, Math.max(p.half.x, p.half.z), 10, 1.1);
  kindle(base, Math.max(p.half.x, p.half.z) + 0.6);
  g.vfx.flash(p.mesh.position.clone(), EMBER, 30, 0.35, 7);
  g.audio.play('heat.ignite', { at: p.mesh.position });
  return true;
}

// Heat into a prop: out of the ice first, then warmer; metal glows, and a
// flammable thing catches once it is hot enough. What it did, for the sound.
function heatProp(g: Game, p: PropInstance, dose: number): boolean {
  if (!p.alive) return false;
  const at = p.mesh.position.clone();
  if (g.props.unfreeze(p)) { g.vfx.steam(at, Math.max(p.half.x, p.half.z), 6, 1.1); g.audio.play('heat.steam', { at }); }
  g.props.warm(p, dose);
  if (p.def.traits.includes('metal')) g.audio.play('heat.glow', { at, pitch: 0.8 + p.heat * 0.4 });
  else if (p.def.traits.includes('flammable') && p.heat >= HEAT.ignite) ignite(g, p);
  else g.vfx.steam(at, Math.max(p.half.x, p.half.z) * 0.6, 2, 0.6, 0.5);
  return true;
}

// The pond's ice floor goes, here and, online, on every screen.
function melt(g: Game): void {
  if (meltPond()) g.net?.melt();
}

// Heat thrown into water: the pond (or a stream) boils off as steam, scalds
// whoever stands in it, takes the heat out of the user, and melts any ice on it.
function boil(g: Game, at: THREE.Vector3, kind: 'water' | 'wet' | 'ice', potency: number): void {
  const big = kind !== 'wet';
  g.vfx.steam(at, big ? 1.6 : 0.8, big ? 18 : 6, big ? 2.4 : 1.2);
  g.audio.play('heat.steam', { at });
  if (kind === 'ice' || kind === 'water') melt(g);
  g.vfx.melt(at, 2.5);
  if (!big) return;
  st.core = Math.max(0, st.core - HEAT.vent.quench);
  for (const e of g.techniques.enemiesInSphere(at, 2.4)) { e.hurt(Math.round(6 * potency), { from: at, stagger: false }); burn(e, 1, HEAT.burn.dmg); }
}

// The heat a cast puts out at one place: bodies, props, ice, water and fuel
// in reach. Returns how many things took it.
function deliver(ctx: AbilityContext, at: THREE.Vector3, radius: number, dose: number): number {
  const g = ctx.game;
  let took = 0;
  if (targetsAllowed(ctx).props) for (const p of g.props.instances) if (p.alive && p.mesh.position.distanceTo(at) < radius + Math.max(p.half.x, p.half.z)) took += heatProp(g, p, dose) ? 1 : 0;
  const melted = g.vfx.melt(at, radius + 0.4);
  if (melted) { g.vfx.steam(at, radius, 6 + melted, 1.4); g.audio.play('heat.steam', { at }); took++; }
  const water = waterAt(g, at);
  if (water) { boil(g, at, water, ctx.potency); took++; }
  for (const e of g.encounters.enemies) took += e.igniteFuel(at, radius);
  kindle(at, radius);
  return took;
}

// Props in front of the user, judged on the ground plane: heat reaches a
// crate at the feet as well as one at chest height.
function propsAhead(g: Game, flat: THREE.Vector3, range: number, half: number): PropInstance[] {
  const me = g.player.position, cos = Math.cos(half);
  return g.props.instances.filter((p) => {
    const to = p.mesh.position.clone().sub(me);
    if (to.y < -1.5 || to.y > 2.2) return false;
    to.y = 0;
    const d = to.length();
    return d < range && (d < 0.6 || to.normalize().dot(flat) > cos);
  });
}

// Bodies in front, judged the same way: one pressed against the user is in
// reach, not under the cone.
function bodiesAhead(g: Game, flat: THREE.Vector3, range: number, half: number): Enemy[] {
  const me = g.player.position, cos = Math.cos(half);
  return g.targets().filter((e) => {
    if (!e.alive) return false;
    const to = e.position.clone().sub(me);
    if (to.y < -1.5 || to.y > 2) return false;
    to.y = 0;
    const d = to.length() - 0.3;
    return d < range && (d < 0.5 || to.normalize().dot(flat) > cos);
  });
}

function sear(ctx: AbilityContext) {
  const g = ctx.game;
  const range = rangeFor(ctx, 3.4);
  const wide = ctx.behaviors.includes('wide');
  const half = (frontOnly(ctx) ? 0.38 : 0.55) + (wide ? 0.3 : 0);
  const draw = g.techniques.resource / g.techniques.def.resource.max;
  const allow = targetsAllowed(ctx);
  const me = g.player.position;
  const flat = ctx.dir.clone().setY(0).normalize();
  let bodies = allow.people ? bodiesAhead(g, flat, range, half) : [];
  if (allow.single && bodies.length > 1) bodies = [bodies.sort((a, b) => a.position.distanceTo(me) - b.position.distanceTo(me))[0]!];
  const dmg = (12 + 16 * draw) * ctx.potency * (wide ? 0.7 : 1);
  const hand = ctx.origin.clone().addScaledVector(ctx.dir, 0.8).add(new THREE.Vector3(0, -0.2, 0));
  for (const e of bodies) {
    // Ice on a body cracks off it, and the shock of it hurts more.
    const thawed = e.melt();
    g.combat.hitEnemy(e, dmg * (thawed ? 1.3 : 1), { from: ctx.origin, knock: 1.2, kind: 'heat', heavy: dmg > 30 });
    burn(e, ctx.behaviors.includes('scorch') ? HEAT.burn.scorch : HEAT.burn.seconds, HEAT.burn.dmg * ctx.potency);
    const c = e.center();
    g.vfx.ring(c, COLOR, 0.15, 0.9 + draw * 0.5, 0.28, ctx.dir);
    // The heat that went in shows where it went: a scorch at the feet and a ring on the ground.
    g.vfx.ring(e.position.clone().setY(e.position.y + 0.06), EMBER, 0.2, 1.1, 0.3);
    g.vfx.patch(e.position.clone(), 0.55, 'burn', 3);
    g.vfx.steam(c, 0.3, thawed ? 8 : 4, thawed ? 1.4 : 1, thawed ? 0.8 : 0.5);
    g.vfx.burst(c, 8, 'spark', 4, EMBER, ctx.dir);
  }
  const dose = HEAT.dose.sear + HEAT.dose.searPotency * Math.min(1.2, ctx.potency);
  let took = bodies.length;
  if (allow.props) for (const p of propsAhead(g, flat, range + 0.4, half + 0.1)) took += heatProp(g, p, dose) ? 1 : 0;
  // Along the ground in front: ice, water, fuel. Open water or ice anywhere
  // in reach takes it before the wet stone at its edge.
  const ground = me.clone().addScaledVector(flat, range * 0.65);
  const melted = g.vfx.melt(ground, range * 0.55);
  if (melted) { g.vfx.steam(ground, range * 0.4, 6 + melted, 1.4); took++; }
  const wet = [range * 0.35, range * 0.7, range].map((d) => { const at = me.clone().addScaledVector(flat, d); return { at, kind: waterAt(g, at) }; }).filter((w) => w.kind);
  const best = wet.find((w) => w.kind !== 'wet') ?? wet[0];
  if (best) { boil(g, best.at, best.kind!, ctx.potency); took++; }
  for (const e of g.encounters.enemies) took += e.igniteFuel(ground, range * 0.55);
  kindle(ground, range * 0.55);
  // Releasing into a body pressed against you puts some of it back into you.
  const close = bodies.some((e) => Math.hypot(e.position.x - me.x, e.position.z - me.z) < HEAT.pointBlank.within);
  spill(g, took ? HEAT.spill.landed : HEAT.spill.wasted, ctx.behaviors.includes('steady'));
  if (close) { st.core += HEAT.pointBlank.spill; g.combat.hurtPlayer(HEAT.pointBlank.hurt, { self: true }); g.vfx.steam(hand, 0.2, 3, 0.8, 0.5); }
  g.vfx.trail([ctx.origin.clone().add(new THREE.Vector3(0.18, -0.35, 0)), hand, hand.clone().addScaledVector(ctx.dir, range * 0.6)], COLOR, 0.32, 0.18);
  g.vfx.ring(me.clone().addScaledVector(flat, Math.min(range, 1.8)).setY(me.y + 0.06), COLOR, 0.3, 1.2 + draw * 0.6, 0.32);
  g.vfx.burst(hand.clone().addScaledVector(ctx.dir, 0.6), 6, 'spark', 4, EMBER, ctx.dir);
  g.vfx.flash(hand.clone().addScaledVector(ctx.dir, 1), EMBER, took ? 16 : 8, 0.2, 5);
  g.audio.play(took ? 'heat.sear' : 'heat.whiff', { weight: draw });
  g.mastery.gainPassive('heat', 'control', 0.003);
  return { hits: took, hitStop: bodies.length ? 0.05 + draw * 0.03 : 0, impactFrame: bodies.length && dmg > 30 ? 2 : 0, cameraKick: { fov: 5 + draw * 4, pitch: 0.015 } };
}

function spot(ctx: AbilityContext) {
  const g = ctx.game;
  const range = rangeFor(ctx, 14);
  const aim = ctx.aim ?? ctx.origin.clone().addScaledVector(ctx.dir, range);
  const at = ctx.origin.clone().add(aim.clone().sub(ctx.origin).clampLength(0, range));
  const floor = g.physics.castRay(at.clone().add(new THREE.Vector3(0, 0.6, 0)), new THREE.Vector3(0, -1, 0), 4);
  const point = floor && floor.point.distanceTo(at) < 1.2 ? at : floor ? floor.point : at;
  const radius = 1.0;
  const allow = targetsAllowed(ctx);
  let bodies = allow.people ? g.techniques.enemiesInSphere(point, radius + 0.5) : [];
  if (allow.single && bodies.length > 1) bodies = [bodies.sort((a, b) => a.position.distanceTo(point) - b.position.distanceTo(point))[0]!];
  for (const e of bodies) {
    const thawed = e.melt();
    // A dose, not a blow: it burns without breaking the body's stride.
    g.combat.hitEnemy(e, 8 * ctx.potency * (thawed ? 1.3 : 1), { from: point, kind: 'heat', stagger: false });
    burn(e, ctx.behaviors.includes('scorch') ? HEAT.burn.scorch : HEAT.burn.seconds, HEAT.burn.dmg * ctx.potency);
    g.vfx.steam(e.center(), 0.25, thawed ? 8 : 2, 0.8, 0.5);
  }
  const took = bodies.length + deliver(ctx, point, radius, HEAT.dose.spot + HEAT.dose.spotPotency * Math.min(1.2, ctx.potency));
  spill(g, took ? HEAT.spill.spot : HEAT.spill.wasted * 0.5, ctx.behaviors.includes('steady'));
  // Heat has no colour of its own: what shows is a shimmer on the line and
  // a ring of it where it lands.
  const hand = ctx.origin.clone().addScaledVector(ctx.dir, 0.7).add(new THREE.Vector3(0.15, -0.25, 0));
  g.vfx.trail([hand, hand.clone().lerp(point, 0.5), point], COLOR, 0.07, 0.12);
  g.vfx.ring(point.clone().add(new THREE.Vector3(0, 0.05, 0)), COLOR, 0.2, 1.3, 0.35);
  g.vfx.burst(point.clone().add(new THREE.Vector3(0, 0.2, 0)), 5, 'spark', 2.5, EMBER);
  g.vfx.flash(point.clone().add(new THREE.Vector3(0, 0.5, 0)), COLOR, 16, 0.2, 5);
  g.audio.play('heat.spot', { at: point });
  return { hits: took, hitStop: bodies.length ? 0.03 : 0, cameraKick: { fov: 3 } };
}

function whiteHeat(ctx: AbilityContext) {
  const g = ctx.game;
  const center = g.player.position.clone();
  const fuel = Math.max(st.drawBefore, g.techniques.resource) / g.techniques.def.resource.max;
  const radius = HEAT.max.radius;
  const flat = ctx.dir.clone().setY(0).normalize();
  // The palm lands on the body in front; the rest of the heat rolls out round it.
  const touch = g.techniques.enemiesInSphere(center.clone().addScaledVector(flat, 2.4), 2.2).sort((a, b) => a.position.distanceTo(center) - b.position.distanceTo(center))[0];
  let hits = 0;
  for (const e of g.techniques.enemiesInSphere(center, radius)) {
    const thawed = e.melt();
    const main = e === touch;
    const d = e.position.distanceTo(center);
    const dmg = main ? (55 + 135 * fuel) * ctx.potency : 18 * ctx.potency * (1 - d / (radius * 1.3));
    g.combat.hitEnemy(e, dmg * (thawed ? 1.3 : 1), { from: center, knock: main ? 3 : 1, lift: 1, kind: 'heat', heavy: main });
    burn(e, main ? 4 : HEAT.burn.scorch, HEAT.burn.dmg * ctx.potency * (main ? 2 : 1));
    g.vfx.steam(e.center(), 0.5, main ? 7 : 3, 1.8, main ? 0.9 : 0.6);
    hits++;
  }
  for (const p of [...g.props.instances]) {
    const d = p.mesh.position.distanceTo(center);
    if (d < radius) heatProp(g, p, 1.1 * (1 - d / (radius * 1.4)));
  }
  g.vfx.melt(center, radius);
  const water = waterAt(g, center.clone().addScaledVector(flat, 2));
  if (water) boil(g, center.clone().addScaledVector(flat, 2), water, ctx.potency);
  for (const e of g.encounters.enemies) e.igniteFuel(center, radius);
  kindle(center, radius);
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; g.vfx.steam(center.clone().add(new THREE.Vector3(Math.cos(a) * radius * 0.7, 0, Math.sin(a) * radius * 0.7)), 0.6, 1, 1.6, 1.2); }
  g.vfx.ring(center.clone().add(new THREE.Vector3(0, 0.08, 0)), COLOR, 0.5, radius * 1.25, 0.7);
  g.vfx.ring(center.clone().add(new THREE.Vector3(0, 1.2, 0)).addScaledVector(flat, 1.2), 0xfff2d0, 0.2, 3.2, 0.45, flat);
  g.vfx.burst(center.clone().add(new THREE.Vector3(0, 1, 0)).addScaledVector(flat, 1.2), 36, 'spark', 9, EMBER, flat);
  g.vfx.flash(center.clone().add(new THREE.Vector3(0, 1.4, 0)), COLOR, 130, 0.7, 24);
  g.techniques.resource = 0;
  // The heat it could not place stays in the user.
  st.core = Math.max(st.core, HEAT.max.core);
  g.audio.play('heat.max.tail');
  return { hits: Math.max(hits, 1), hitStop: 0.14, impactFrame: 3, rooted: 1.0, cameraKick: { fov: 14, pitch: 0.05 } };
}

// Impact Conversion held: whatever moves at the user from in front gives up
// its motion as Draw and drops, and a fire close by is drawn down and out.
function drawIn(ctx: AbilityContext, dt: number): void {
  const g = ctx.game, b = st.brace;
  if (!b) return;
  b.bucket = Math.min(b.cap, b.bucket + b.cap * dt);
  const t = g.techniques, max = t.def.resource.max;
  if (st.overheated) return;
  for (const p of propsInCone(g, g.player.eye(), g.cam.aimDirection(), HEAT.convert.reach, 0.7)) {
    const v = p.body.linvel();
    const speed = Math.hypot(v.x, v.y, v.z);
    if (speed < 2) continue;
    const energy = Math.min(b.bucket, 0.5 * p.def.mass * speed * speed * 0.02);
    if (energy < 0.5) continue;
    b.bucket -= energy;
    g.props.touch(p);
    p.body.setLinvel({ x: v.x * 0.1, y: Math.min(0, v.y * 0.1), z: v.z * 0.1 }, true);
    p.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    t.resource = Math.min(max, t.resource + energy * HEAT.convert.draw);
    st.core += energy * HEAT.convert.heat;
    g.vfx.ring(p.mesh.position, COLOR, 0.2, 1.1, 0.25);
    g.vfx.steam(p.mesh.position, 0.2, 2, 0.6, 0.5);
    g.audio.play('heat.drain', { at: p.mesh.position });
    g.drills.notify(p, 'absorbed');
  }
  for (let i = fires.length - 1; i >= 0; i--) {
    const f = fires[i]!;
    if (f.prop.mesh.position.distanceTo(g.player.position) > HEAT.convert.reach) continue;
    fires.splice(i, 1);
    f.prop.heat = Math.min(f.prop.heat, 0.3);
    t.resource = Math.min(max, t.resource + HEAT.convert.fire);
    st.core += HEAT.convert.fire * HEAT.convert.heat;
    g.vfx.steam(f.prop.mesh.position, Math.max(f.prop.half.x, f.prop.half.z), 6, 1.2);
    g.audio.play('heat.drain', { at: f.prop.mesh.position, pitch: 0.7 });
  }
}

// The drill: Quench (焼入れ). Iron is set out on the pond's rim one piece at a
// time, and the student brings it to the glow the tier asks for. Reading the
// colour is the whole skill: the dose a cast gives depends on the Pact and
// Output, so counting casts does not work. Each tier raises what it tests.
//   Dull Red  bring it to a glow                       precision, control
//   Cherry    hold it in the cherry band; white spoils  + efficiency
//   Straw     a narrower band, faster cooling, and heat
//             from an overheated body spoils the piece  + tolerance
interface QuenchRules { band: [number, number]; hold: number; spoils: boolean; cools: number; steady: boolean; window: number; lines: string[] }
const QUENCH_TIERS: (DrillTier & { rules: QuenchRules })[] = [
  { name: 'Dull Red', count: 4, interval: 7.5, pass: 3, raises: { precision: 0.55, control: 0.55 },
    rules: { band: [0.5, 9], hold: 0, spoils: false, cools: 0.05, steady: false, window: 7, lines: [] } },
  { name: 'Cherry', count: 5, interval: 7.5, pass: 4, raises: { precision: 0.7, control: 0.7, efficiency: 0.7 },
    rules: { band: [0.5, 0.85], hold: 1, spoils: true, cools: 0.07, steady: false, window: 7, lines: ['Hold it at cherry red for a breath. White heat spoils it.'] } },
  { name: 'Straw', count: 5, interval: 7, pass: 4, raises: { precision: 0.85, control: 0.85, efficiency: 0.85, tolerance: 0.85 },
    rules: { band: [0.6, 0.8], hold: 0.7, spoils: true, cools: 0.12, steady: true, window: 6.5, lines: ['It cools fast now, and heat from an overheated body spoils it.'] } },
];
const LIT = 0xff8a3d, GOOD = 0xffd27a, BAD = 0xff5a4a;
let quench: { piece: PropInstance; inBand: number; t: number; rules: QuenchRules; ring: THREE.Mesh } | null = null;
let lastStand = -1;
// What the debug hook reports, so a check can aim at the lit piece.
export const quenchView = (): { piece: [number, number, number] | null; heat: number; inBand: number; band: [number, number] | null } => {
  const q = quench;
  if (!q || !q.piece.alive) return { piece: null, heat: 0, inBand: 0, band: null };
  const p = q.piece.mesh.position;
  return { piece: [p.x, p.y, p.z], heat: q.piece.heat, inBand: q.inBand, band: q.rules.band };
};

const drill: DrillDef = {
  id: 'heat-quench', technique: 'heat', title: 'Quench', jp: '焼入れ',
  brief: 'Heat the lit piece of iron on the rim until it glows.',
  howTo: (tier) => {
    const r = (tier as DrillTier & { rules?: QuenchRules }).rules ?? QUENCH_TIERS[0]!.rules;
    return ['A piece of iron lights on the rim. Heat it until it glows.', ...QUENCH_TIERS.slice(0, QUENCH_TIERS.findIndex((t) => t.rules === r) + 1).flatMap((t) => t.rules.lines)];
  },
  cue: () => {
    const q = quench;
    if (!q) return 'Watch the rim';
    return q.inBand > 0 && q.rules.hold > 0 ? 'Hold it' : 'Heat it';
  },
  position: [QUENCH.station.x, QUENCH.station.y, QUENCH.station.z],
  tiers: QUENCH_TIERS,
  end(g) {
    if (quench) { g.renderer.scene.remove(quench.ring); if (quench.piece.alive) g.props.remove(quench.piece); quench = null; }
  },
  spawn(g, tier) {
    const rules = (tier as DrillTier & { rules?: QuenchRules }).rules ?? QUENCH_TIERS[0]!.rules;
    const choices = [0, 1, 2].filter((i) => i !== lastStand);
    const i = choices[Math.floor(Math.random() * choices.length)]!;
    lastStand = i;
    const stand = QUENCH.stands[i]!;
    const piece = g.props.spawn('pot', stand.clone());
    piece.cools = rules.cools;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.68, 36), new THREE.MeshBasicMaterial({ color: LIT, transparent: true, opacity: 0.9, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(stand.x, stand.y + 0.03, stand.z);
    g.renderer.scene.add(ring);
    const item = { piece, inBand: 0, t: 0, rules, ring };
    quench = item;
    let last = 0;
    const done = (pts: number): number => {
      g.renderer.scene.remove(ring);
      (ring.material as THREE.Material).dispose();
      ring.geometry.dispose();
      const at = piece.mesh.position.clone();
      g.vfx.ring(at.clone().setY(stand.y + 0.05), pts ? GOOD : BAD, 0.4, pts ? 2.2 : 1.2, 0.4);
      // A good piece is quenched: it goes into the water with a hiss.
      if (pts) { g.vfx.steam(at, 0.4, 12, 2); g.audio.play('heat.steam', { at }); }
      if (piece.alive) g.vfx.until(pts ? 0.2 : 1.2, () => g.props.remove(piece));
      if (quench === item) quench = null;
      return pts;
    };
    return {
      update(dt) {
        item.t += dt;
        if (!piece.alive) return done(0);
        const h = piece.heat;
        // Heat from shaking, overheated hands spoils the piece.
        if (rules.steady && st.overheated && h > last + 0.02) return done(0);
        last = h;
        if (rules.spoils && h >= 1) return done(0);
        if (h >= rules.band[0] && h <= rules.band[1]) { item.inBand += dt; if (item.inBand >= rules.hold) return done(1); } else item.inBand = 0;
        if (item.t >= rules.window) return done(0);
        return null;
      },
      dispose() {
        if (quench === item) quench = null;
        g.renderer.scene.remove(ring);
        if (piece.alive) g.props.remove(piece);
      },
    };
  },
};

// Burns run their course. Heat's passive runs this, and so does any kit
// whose own fire burns bodies (Fuel's vapour).
export function tickBurns(g: Game, dt: number): void {
  for (const [e, b] of burns) {
    if (!e.alive || e.disposed) { e.avatar.heat = 0; burns.delete(e); continue; }
    b.left -= dt;
    e.avatar.heat = Math.min(1, b.left) * 0.9;
    if ((b.tick += dt) >= HEAT.burn.tick) {
      b.tick -= HEAT.burn.tick;
      const n = Math.max(1, Math.round(b.dmg));
      e.hurt(n, { from: e.position, stagger: false });
      g.combat.number(e.center(), String(n), '#ffa04a', false);
      g.vfx.steam(e.center().add(new THREE.Vector3(0, 0.4, 0)), 0.2, 1, 0.7, 0.45);
    }
    if (b.left <= 0) { e.avatar.heat = 0; burns.delete(e); }
  }
}

// Props on fire burn where they caught, spread to what is close, and burn
// anyone in them, the player included.
export function tickFires(g: Game, dt: number): void {
  const me = g.player.position;
  for (let i = fires.length - 1; i >= 0; i--) {
    const f = fires[i]!, p = f.prop;
    if (!p.alive) { fires.splice(i, 1); continue; }
    f.left -= dt; f.age += dt;
    p.heat = Math.max(p.heat, 0.7);
    if ((f.tick += dt) < HEAT.fire.tick) continue;
    f.tick -= HEAT.fire.tick;
    const at = p.mesh.position;
    const base = at.clone().setY(at.y - p.half.y);
    g.vfx.flames(base, Math.max(p.half.x, p.half.z), 6, 1.1);
    g.audio.play('heat.burn', { at });
    kindle(base, Math.max(p.half.x, p.half.z) + 0.6);
    for (const e of g.encounters.enemies) if (e.alive && Math.hypot(e.position.x - at.x, e.position.z - at.z) < HEAT.fire.radius) { e.hurt(HEAT.fire.enemy, { from: at, stagger: false }); burn(e, 1, HEAT.burn.dmg); }
    if (Math.hypot(me.x - at.x, me.z - at.z) < HEAT.fire.radius && Math.abs(me.y - base.y) < 1.5) g.combat.hurtPlayer(HEAT.fire.player, { from: at });
    if (f.age > 1.2) for (const q of g.props.instances) if (q !== p && q.def.traits.includes('flammable') && q.mesh.position.distanceTo(at) < HEAT.fire.spread) { g.props.warm(q, 0.3); if (q.heat >= HEAT.ignite) ignite(g, q); }
    if (f.left <= 0) {
      fires.splice(i, 1);
      if (p.def.breakable) breakProp(g, p, at); else { p.heat = 0.3; g.vfx.steam(at, p.half.x, 4, 1); }
    }
  }
}

export const heat: TechniqueKit = {
  id: 'heat', name: 'Heat', glyph: '熱', color: COLOR, type: 'Conversion, Energy family', sfx: 'ジュッ',
  blurb: 'Take in energy from a blow, a moving thing or your own body. It comes out only as heat, and the heat has to go somewhere.',
  breadth: 3,
  resource: { name: 'Draw', max: 100, regen: 5, startsFull: true },
  gauge: { name: 'Body heat', glyph: '灼', value: heatUi.core },
  primitive: { name: 'Heat', short: 'warm what you touch', description: 'Turn a little energy into heat in what is in front of you. What lands on nothing stays in your hands.' },
  parameters: ['direction', 'range', 'target', 'trigger', 'duration', 'resource', 'body'],
  shapes: {
    sear: { label: 'puts heat into what is in front of you', short: 'heat what is in front', kinds: ['primary'], description: 'Burns people, makes metal glow, lights what burns, melts ice and boils water.' },
    spot: { label: 'heats one point under the aim', short: 'heat one point at range', kinds: ['primary'], description: 'A small, exact dose where you aim.' },
    convert: { label: 'takes blows and moving things in as energy', short: 'hold to take blows in', kinds: ['secondary'], description: 'Hold. What hits you from in front feeds your Draw instead. A blow faster than you can draw still lands, and what you take in heats you.' },
    whiteHeat: { label: 'gives everything drawn back as heat through one palm', short: 'everything out as heat', kinds: ['max'], description: 'All of it at once. The heat you cannot place stays in you.' },
  },
  behaviors: { scorch: 'what it burns keeps burning a moment', steady: 'less of the heat stays in your hands', wide: 'a wider spread, less in each' },
  catalogue,
  gestures: {
    // The heat drawn into a cupped palm at the hip, then the open grip driven
    // out at head height to put it in.
    primary: gestureSet(0.62, 0.28, [
      { t: 0, right: 'emberCup', left: 'guard', slow: true }, { t: 0.17, right: 'emberCup' }, { t: 0.26, right: 'seize', snap: true, camera: { fov: 5, pitch: 0.012 } }, { t: 0.42, right: 'seize' }, { t: 0.54, right: 'rest', left: 'rest' }]),
    // Open hands crossed before the face, to take the blow in.
    secondary: gestureSet(0.5, 0.2, [{ t: 0, right: 'crossBlock', left: 'crossBlock', snap: true, camera: { fov: -3 } }, { t: 0.3, right: 'crossBlock', left: 'crossBlock' }], true),
    // Both palms cup the heat at the belly, open out and up to draw from all
    // round, and drive out together.
    max: gestureSet(2.3, 1.7, [
      { t: 0, right: 'emberCup', left: 'emberCup', slow: true }, { t: 0.85, right: 'kilnRaise', left: 'kilnRaise', slow: true }, { t: 1.62, right: 'twinPalm', left: 'twinPalm', snap: true, camera: { fov: 14, pitch: 0.05 } }, { t: 2.1, right: 'rest', left: 'rest' }]),
  },
  // The palms meet and rub, as cold hands are warmed, then open upward with
  // the heat held in them. The right keeps it cupped; the left guards.
  sign: signGesture([
    { t: 0, right: 'sealGather', left: 'sealGather', slow: true },
    { t: 0.45, right: 'seal', left: 'seal', snap: true, camera: { fov: -3 }, event: 'seal' },
    { t: 0.62, right: 'sealRubUp', left: 'sealRubDown' },
    { t: 0.8, right: 'sealRubDown', left: 'sealRubUp' },
    { t: 0.98, right: 'sealRubUp', left: 'sealRubDown' },
    { t: 1.2, right: 'emberCup', left: 'emberCup', snap: true, camera: { fov: 6 }, event: 'release' },
    { t: 1.42, right: 'emberCup', left: 'guard' },
  ]),
  traits: {
    metal: (prop, ctx) => { heatProp(ctx.game, prop, HEAT.dose.sear); },
    flammable: (prop, ctx) => { heatProp(ctx.game, prop, HEAT.dose.sear); },
    freezable: (prop, ctx) => { if (ctx.game.props.unfreeze(prop)) ctx.game.vfx.steam(prop.mesh.position, prop.half.x, 6, 1.1); },
  },
  drill,
  cutscene,
  effects: {
    cast(ctx) {
      if (ctx.shape === 'sear') return sear(ctx);
      if (ctx.shape === 'spot') return spot(ctx);
      if (ctx.shape === 'convert') {
        const p = ctx.potency;
        const cap = HEAT.convert.rate + HEAT.convert.perPotency * p;
        st.brace = { front: ctx.pact ? restriction(ctx.pact, 'direction') === 'front' : false, cap, bucket: cap };
        ctx.game.vfx.ring(ctx.game.player.eye().addScaledVector(ctx.game.cam.aimDirection(), 0.6), COLOR, 0.2, 0.9, 0.25, ctx.game.cam.aimDirection());
        return { cameraKick: { fov: -3 } };
      }
      if (ctx.shape === 'whiteHeat') return whiteHeat(ctx);
      return undefined;
    },
    hold(ctx, dt) { drawIn(ctx, dt); },
    release() { st.brace = null; },
    onStruck(game, amount, from) {
      const b = st.brace;
      if (!b || !game.techniques.casting) return amount;
      const dir = from.clone().sub(game.player.position).setY(0).normalize();
      if (b.front && game.cam.aimDirection().setY(0).normalize().dot(dir) < 0.3) return amount;
      const chest = game.player.eye().add(new THREE.Vector3(0, -0.4, 0)).addScaledVector(dir, 0.5);
      // Overheated, there is nowhere for more heat to go: the blow lands whole.
      if (st.overheated) { game.vfx.steam(chest, 0.3, 6, 1); game.audio.play('heat.overrun'); return amount; }
      const took = Math.min(amount, b.bucket);
      b.bucket -= took;
      const t = game.techniques;
      t.resource = Math.min(t.def.resource.max, t.resource + took * HEAT.convert.draw);
      st.core += took * HEAT.convert.heat;
      game.vfx.ring(chest, COLOR, 0.2, 1.1, 0.28, dir);
      game.vfx.steam(chest, 0.25, 3, 0.9, 0.5);
      game.audio.play('heat.converted', { weight: Math.min(1, took / 20) });
      game.cam.kick({ fov: 2 });
      // A blow faster than the draw: the rest still lands.
      if (amount - took > 0.5) game.audio.play('heat.overrun');
      return amount - took;
    },
    passive(game, dt) {
      const g = game, me = g.player.position;
      if (!g.techniques.casting) st.brace = null;
      st.drawBefore = g.techniques.resource;
      // Cooling: always a little, more for a tolerant body, far more in water.
      const under = surfaceAt(me, '');
      const wet = under === 'water' ? HEAT.vent.water : under === 'wet' || under === 'ice' ? HEAT.vent.wet : 0;
      st.core = THREE.MathUtils.clamp(st.core - dt * (HEAT.vent.rate * (1 + g.mastery.get('heat', 'tolerance')) + wet), 0, 1.5);
      if (wet && st.core > 0.08 && (st.ventT -= dt) <= 0) { st.ventT = 0.25; g.vfx.steam(me.clone().add(new THREE.Vector3(0, 0.1, 0)), 0.5, 2, 1.4, 0.7); g.audio.play('heat.vent', { at: me }); }
      // An overheated body standing on ice melts it out from under itself.
      if (under === 'ice' && st.core >= HEAT.overheat.at) melt(g);
      if (!st.overheated && st.core >= HEAT.overheat.at) { st.overheated = true; st.hurtT = 0; g.player.speedScale = Math.min(g.player.speedScale, HEAT.overheat.speed); }
      else if (st.overheated && st.core < HEAT.overheat.clears) { st.overheated = false; if (g.player.speedScale === HEAT.overheat.speed) g.player.speedScale = 1; }
      if (st.overheated && (st.hurtT += dt) >= 0.5) { st.hurtT -= 0.5; g.combat.hurtPlayer(HEAT.overheat.hurt * 0.5, { self: true }); g.audio.play('heat.overheat'); }
      // Shown, not told: the skin flushes, the palms glow, steam comes off.
      const glow = ramp(st.core, 0.3, 1);
      g.hands.heat = glow;
      g.avatar.heat = glow * 0.8;
      if (st.core > 0.55 && (st.wispT -= dt) <= 0) {
        st.wispT = st.overheated ? 0.18 : 0.45;
        if (!g.cam.isFirst || g.cam.inShot) g.vfx.steam(me.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.5, 1.35 + Math.random() * 0.2, (Math.random() - 0.5) * 0.3)), 0.15, 1, 0.8, 0.35);
      }
      heatUi.core.value = st.core;
      tickBurns(g, dt);
      tickFires(g, dt);
      // Hot metal burns whatever it touches.
      for (const p of g.props.instances) {
        if (p.heat < HEAT.hot.at || !p.def.traits.includes('metal')) continue;
        const cd = (touched.get(p) ?? 0) - dt;
        if (cd > 0) { touched.set(p, cd); continue; }
        const at = p.mesh.position, reach = Math.max(p.half.x, p.half.z) + HEAT.hot.reach;
        const dmg = Math.round(HEAT.hot.dmg * p.heat);
        let hit = false;
        for (const e of g.encounters.enemies) if (e.alive && Math.hypot(e.position.x - at.x, e.position.z - at.z) < reach && at.y < e.position.y + e.height) { e.hurt(dmg, { from: at, stagger: false }); g.combat.number(e.center(), String(dmg), '#ffa04a', false); hit = true; }
        if (Math.hypot(me.x - at.x, me.z - at.z) < reach && at.y < me.y + 1.8 && at.y > me.y - 0.5) { g.combat.hurtPlayer(dmg, { from: at }); hit = true; }
        if (hit) { g.vfx.steam(at, 0.2, 2, 0.8, 0.5); g.audio.play('heat.glow', { at, pitch: 1.3 }); }
        touched.set(p, hit ? HEAT.hot.every : 0);
      }
    },
    // Cold and quiet again, for a new run or a new Technique: the body, the
    // burns, the fires and every hot prop.
    reset(game) {
      st.core = 0; st.overheated = false; st.brace = null; st.hurtT = 0; st.wispT = 0; st.ventT = 0;
      for (const e of burns.keys()) e.avatar.heat = 0;
      burns.clear();
      fires.length = 0;
      touched.clear();
      game.props.cool();
      game.hands.heat = 0;
      game.avatar.heat = 0;
      heatUi.core.value = 0;
    },
  },
  audio: { primary: 'heat.cast', secondary: 'heat.convert', max: 'heat.max.cast' },
};

// What Heat has put into the world, as another screen needs it (src/net/kitsync.ts):
// the props on fire with their seconds left, and the bodies burning with theirs.
export const heatWorld = (): { fires: Map<PropInstance, number>; burns: Map<Enemy, number> } =>
  ({ fires: new Map(fires.map((f) => [f.prop, f.left])), burns: new Map([...burns].map(([e, b]) => [e, b.left])) });

// Fires another player's Heat lit, as their screen reports them, until game time.
const heard = new Map<PropInstance, number>();
export function heardFire(g: Game, p: PropInstance, seconds: number): void {
  if (seconds > 0) heard.set(p, g.clock.time + seconds); else heard.delete(p);
}

// Where the ground is burning now: under every prop on fire, lit here or,
// online, on another screen, out to the fire's reach and up to where its
// flames lick. Fire parts a Tension line strung through it.
export function burningGround(g: Game): { at: THREE.Vector3; radius: number; height: number }[] {
  const out: { at: THREE.Vector3; radius: number; height: number }[] = [];
  const add = (p: PropInstance) => { if (p.alive) out.push({ at: p.mesh.position.clone().setY(p.mesh.position.y - p.half.y), radius: Math.max(p.half.x, p.half.z) + 0.3, height: 1.6 }); };
  for (const f of fires) add(f.prop);
  for (const [p, until] of heard) { if (until <= g.clock.time || !p.alive) heard.delete(p); else if (!fires.some((f) => f.prop === p)) add(p); }
  return out;
}

// The debug hook and the checks read the body's heat through here.
export const heatState = (): { core: number; overheated: boolean; bracing: boolean; burning: number; fires: number } =>
  ({ core: st.core, overheated: st.overheated, bracing: !!st.brace, burning: burns.size, fires: fires.length });
export const setBodyHeat = (v: number): void => { st.core = v; };
