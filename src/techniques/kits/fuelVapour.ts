import * as THREE from 'three';
import type { Game } from '../../app/game';
import type { Enemy } from '../../combat/enemies';
import type { PropInstance } from '../../world/props';
import type { Surface } from '../../audio/surfaces';
import { GROUP_WORLD } from '../../physics/world';
import { onKindle, kindle } from '../ignition';
import { breakProp } from './shared';
import { burn, ignite as setAlight, tickBurns, tickFires } from './heat';

// Fuel's vapour, as the world holds it: a field of low puffs lying on the
// ground. Each has a radius and a density. The user lays them, herds them and
// thins them (src/techniques/kits/fuel.ts); nothing here can light them. They
// light only from outside (src/techniques/ignition.ts) or from a lantern's
// flame they climb to, and then the flame runs puff to puff along whatever
// connects them.
//
// What decides a burn is the density, which the player reads from the cloud:
//   below `lean` it is too thin to carry a flame at all (a gap in a trail stops the fire);
//   near `best` it burns hottest;
//   past `rich` it is too rich: it burns slower and cooler.
// A puff climbs higher the denser it is, and only a dense one reaches a
// lantern's flame. Open air thins it and the breeze carries it off (less the
// better the user's Control holds it); water takes it fast; indoors it holds.
// Bodies walking through stir it thin. A puff burns once and is gone, so no
// fire outlasts the vapour it ate.

export const VAPOUR = {
  max: 150,
  lean: 0.22,
  best: 0.75,
  rich: 1.05,
  cap: 1.6,
  maxRadius: 2.2,
  // How fast the flame front runs along a trail, m/s; a rich puff passes it on at half that.
  flameSpeed: 7.5,
  // Flame jumps between puffs whose rims come this close (a share of their radii).
  link: 1.15,
  // Seconds a puff burns, from its density.
  burn: { base: 0.45, perDensity: 0.45 },
  // A burning puff: its blow to a body (before its heat and potency), to the
  // player, the push of a dense flash, and how long a body is spared after.
  fire: { dmg: 40, player: 14, flashAt: 0.6, knock: 3, every: 0.45, burnFor: 1.4, burnDmg: 3.5 },
  // Density lost a second, as a share: outdoors, more in the breeze; indoors; over water and wet stone.
  thin: { outdoors: 0.01, breeze: 0.02, indoors: 0.006, water: 0.45, wet: 0.14 },
  // Metres a second the radius grows as it thins, outdoors and in.
  spread: { outdoors: 0.015, indoors: 0.008 },
  breeze: { base: 0.45, gust: 0.55 },
  // Within this of the user the puffs hold against the breeze (Control decides how well).
  control: 12,
  // A soaked body: how long it carries the fuel, how often it drips a puff, and the flare when it catches.
  soak: { seconds: 12, drip: 0.45, flare: 26, burnFor: 2.6 },
  // A fuel drum in a fire cooks off, then bursts.
  drum: { fuse: 1.1, radius: 3.2, dmg: 48, player: 26, knock: 7 },
  // Residue the user's own casts leave on the hands, a share of 1 per cast; washed off by water.
  residue: { decay: 0.04, wash: 0.8, catches: 0.35, alight: 1.6, tick: 0.4, hurt: 4 },
} as const;

const TONE = 0xb4d23c;
const RICH_TONE = 0x5f7420;
const FLAME = 0xff7a26;
const FUME = 0x55601e;

export interface Puff {
  at: THREE.Vector3;
  r: number;
  d: number;
  vx: number; vz: number;
  age: number;
  potency: number;
  // Seconds of burning left; -1 while unlit.
  burning: number;
  // Seconds until the flame reaches it, Infinity while none is coming.
  catchIn: number;
  ground: Surface | null;
  probe: number;
  // Seconds it lies still whatever the breeze (Saturation's flood).
  still: number;
}

const puffs: Puff[] = [];
const soaked = new Map<Enemy, { left: number; drip: number; potency: number; fume: number }>();
const spared = new Map<Enemy, number>();
const lastAt = new Map<Enemy, THREE.Vector3>();
const cooking: { prop: PropInstance; t: number }[] = [];
const vented = new WeakSet<PropInstance>();
const pending: { at: THREE.Vector3; r: number }[] = [];
const breeze = { angle: 0, gust: 0, target: 0, next: 0 };
// What the user carries: the residue on the hands, and a body on fire.
export const self = { residue: 0, alight: 0, tick: 0, spared: 0 };
// What it has done since the last reset, for the checks.
export const tally = { lit: 0, burned: 0, flares: 0, blasts: 0, lanterns: 0, taken: 0 };
let fumeT = 0;

onKindle((at, r) => { if (puffs.length && pending.length < 48) pending.push({ at: at.clone(), r }); });

export const top = (p: Puff): number => 0.25 + 1.25 * Math.min(p.d, 1.2);
// How hot a puff of this density burns, 0 to 1.
export function heatOf(d: number): number {
  if (d < VAPOUR.lean) return 0;
  if (d <= VAPOUR.best) return 0.3 + 0.7 * (d - VAPOUR.lean) / (VAPOUR.best - VAPOUR.lean);
  if (d <= VAPOUR.rich) return 1;
  return Math.max(0.4, 1 - (d - VAPOUR.rich) * 1.1);
}
const flat = (a: THREE.Vector3, b: THREE.Vector3): number => Math.hypot(a.x - b.x, a.z - b.z);
const isDrum = (p: PropInstance): boolean => p.def.traits.includes('metal') && p.def.traits.includes('flammable');

export const vapour = {
  get puffs(): readonly Puff[] { return puffs; },
  get soaked(): ReadonlyMap<Enemy, { left: number }> { return soaked; },
  get breeze(): THREE.Vector2 { const s = VAPOUR.breeze.base * (1 + breeze.gust * VAPOUR.breeze.gust * 2); return new THREE.Vector2(Math.cos(breeze.angle) * s, Math.sin(breeze.angle) * s); },
};

// A new puff on the ground under `at`.
export function addPuff(g: Game, at: THREE.Vector3, r: number, d: number, potency: number, still = 0): Puff {
  if (puffs.length >= VAPOUR.max) {
    let lean = 0;
    for (let i = 1; i < puffs.length; i++) if (puffs[i]!.burning < 0 && puffs[i]!.d < puffs[lean]!.d) lean = i;
    puffs.splice(lean, 1);
  }
  const p: Puff = { at: at.clone(), r, d: Math.min(VAPOUR.cap, d), vx: 0, vz: 0, age: 0, potency, burning: -1, catchIn: Infinity, ground: null, probe: 0, still };
  settle(g, p);
  puffs.push(p);
  return p;
}

// The floor under a puff and what it is. Vapour is heavier than air: off a
// roof's edge it pours down to the next floor.
function settle(g: Game, p: Puff): void {
  const hit = g.physics.castRay(new THREE.Vector3(p.at.x, p.at.y + 1.2, p.at.z), new THREE.Vector3(0, -1, 0), 8, GROUP_WORLD);
  // Begun inside something solid (a lantern's foot): it stays at the height it had.
  if (!hit || hit.toi < 1e-3) return;
  const tag = (hit.collider as { surfaceTag?: string }).surfaceTag ?? '';
  p.ground = g.world.surfaceAt(hit.point, tag);
  p.at.y = hit.point.y + 0.02;
}

// Herding: the puffs within `radius` of `to` (and within the user's hold)
// drift toward it and bunch, which makes them denser; `thin` pushes them out
// from it and spreads them instead. `only` limits it to one puff's cloud.
export function herd(g: Game, to: THREE.Vector3, radius: number, dt: number, speed: number, thin: boolean, front?: THREE.Vector3): number {
  const me = g.player.position;
  let n = 0;
  for (const p of puffs) {
    if (p.burning >= 0) continue;
    const dx = to.x - p.at.x, dz = to.z - p.at.z;
    const d = Math.hypot(dx, dz);
    if (d > radius || flat(p.at, me) > VAPOUR.control * 1.3) continue;
    if (front) { const ax = p.at.x - me.x, az = p.at.z - me.z, al = Math.hypot(ax, az) || 1; if ((ax * front.x + az * front.z) / al < 0.5) continue; }
    n++;
    const pull = 1 - d / (radius + 0.01);
    if (thin) {
      const ux = d > 0.05 ? -dx / d : Math.random() - 0.5, uz = d > 0.05 ? -dz / d : Math.random() - 0.5;
      p.vx += ux * speed * 2 * pull * dt * 4; p.vz += uz * speed * 2 * pull * dt * 4;
      spreadBy(p, 0.9 * pull * dt);
    } else if (d > 0.15) {
      const want = Math.min(speed, d * 2.4);
      p.vx += (dx / d * want - p.vx) * Math.min(1, 6 * dt);
      p.vz += (dz / d * want - p.vz) * Math.min(1, 6 * dt);
    } else { p.vx *= 0.5; p.vz *= 0.5; }
    p.still = Math.max(p.still, 0.3);
  }
  return n;
}

// Pushes every puff out of a ring round `center`, as a breath blown out from
// the body: the user's way out of their own vapour.
export function blowOut(center: THREE.Vector3, radius: number, speed: number): number {
  let n = 0;
  for (const p of puffs) {
    if (p.burning >= 0) continue;
    const dx = p.at.x - center.x, dz = p.at.z - center.z, d = Math.hypot(dx, dz);
    if (d > radius + p.r) continue;
    const ux = d > 0.05 ? dx / d : Math.random() - 0.5, uz = d > 0.05 ? dz / d : Math.random() - 0.5;
    p.vx = ux * speed * (1.2 - d / (radius + p.r)); p.vz = uz * speed * (1.2 - d / (radius + p.r));
    spreadBy(p, 0.25);
    n++;
  }
  return n;
}

// Spreads a puff wider by `dr` metres, its fuel the same, so thinner.
function spreadBy(p: Puff, dr: number): void {
  const r = Math.min(VAPOUR.maxRadius, p.r + dr);
  p.d *= (p.r * p.r) / (r * r);
  p.r = r;
}

// A body takes the fuel on its clothes: it carries it, drips it as it moves,
// and goes up if fire finds it.
export function soak(e: Enemy, potency: number): void {
  const s = soaked.get(e);
  if (s) { s.left = VAPOUR.soak.seconds; s.potency = Math.max(s.potency, potency); return; }
  soaked.set(e, { left: VAPOUR.soak.seconds, drip: 0, potency, fume: 0 });
}

// A fuel drum opened: its stock comes out round it as rich vapour, once.
export function vent(g: Game, p: PropInstance, potency: number): boolean {
  if (!p.alive || !isDrum(p) || vented.has(p)) return false;
  vented.add(p);
  const at = p.mesh.position.clone();
  for (let i = 0; i < 4; i++) g.vfx.after(i * 0.35, () => {
    const a = Math.random() * Math.PI * 2;
    addPuff(g, at.clone().add(new THREE.Vector3(Math.cos(a) * 0.6, 0, Math.sin(a) * 0.6)), 0.9, 0.85, potency);
  });
  g.audio.play('fuel.drum', { at });
  return true;
}
export const isVented = (p: PropInstance): boolean => vented.has(p);

// The flame reaches a puff.
function light(g: Game, p: Puff): void {
  if (p.burning >= 0 || p.d < VAPOUR.lean) return;
  p.burning = VAPOUR.burn.base + VAPOUR.burn.perDensity * Math.min(p.d, VAPOUR.cap);
  p.catchIn = Infinity;
  tally.lit++;
  const h = heatOf(p.d);
  spread(p);
  const base = p.at.clone();
  g.vfx.flames(base, p.r * 0.85, Math.round(5 + 10 * Math.min(1, p.d)), 0.8 + 1.1 * h);
  const big = p.d >= VAPOUR.fire.flashAt && p.r > 0.9;
  if (big) { g.vfx.flash(base.clone().add(new THREE.Vector3(0, 0.8, 0)), FLAME, 30 * h, 0.35, 8); g.vfx.ring(base.clone().add(new THREE.Vector3(0, 0.08, 0)), FLAME, p.r * 0.6, p.r * 1.8, 0.35); }
  if (p.d > 0.5) g.vfx.patch(base, p.r * 0.7, 'burn', 10);
  g.audio.play(big ? 'fuel.flash' : 'fuel.catch', { at: base, pitch: 0.9 + Math.random() * 0.2 });
  // Fire is fire: the Kuroda's waiting pour, the props in it, the bodies soaked in it.
  for (const e of g.encounters.enemies) if (e.alive) e.igniteFuel(base, p.r);
  for (const q of g.props.instances) {
    if (!q.alive || !q.def.traits.includes('flammable') || flat(q.mesh.position, base) > p.r + Math.max(q.half.x, q.half.z) || Math.abs(q.mesh.position.y - base.y) > top(p) + q.half.y) continue;
    if (isDrum(q)) cook(g, q, VAPOUR.drum.fuse);
    else setAlight(g, q);
  }
  scorch(g, p, h, big);
}

// The flame passes on to every puff it touches, slower out of a rich one.
// A burning puff keeps passing it on, so vapour herded into a fire catches.
function spread(p: Puff): void {
  for (const q of puffs) {
    if (q === p || q.burning >= 0 || q.d < VAPOUR.lean) continue;
    const d = flat(p.at, q.at);
    if (d > (p.r + q.r) * VAPOUR.link || Math.abs(p.at.y - q.at.y) > 1.4) continue;
    q.catchIn = Math.min(q.catchIn, d / VAPOUR.flameSpeed * (p.d > VAPOUR.rich ? 2 : 1) + 0.02);
  }
}

// A burning puff burns what stands in it, once a moment each.
function scorch(g: Game, p: Puff, h: number, big: boolean): void {
  const reachY = top(p) + 0.4;
  let hit = 0;
  for (const e of g.targets()) {
    if (!e.alive || flat(e.position, p.at) > p.r + 0.35 || e.position.y > p.at.y + reachY || e.position.y + e.height < p.at.y) continue;
    const s = soaked.get(e);
    if (s) flare(g, e, s.potency);
    if ((spared.get(e) ?? 0) > 0) continue;
    spared.set(e, VAPOUR.fire.every);
    g.combat.hitEnemy(e, VAPOUR.fire.dmg * h * p.potency, { from: p.at, kind: 'heat', knock: big ? VAPOUR.fire.knock : 0, stagger: big, heavy: false });
    burn(e, VAPOUR.fire.burnFor, VAPOUR.fire.burnDmg * p.potency);
    hit++;
  }
  if (hit) { tally.burned += hit; charge(g, hit); }
  const me = g.player.position;
  if (self.spared <= 0 && flat(me, p.at) < p.r + 0.3 && me.y < p.at.y + reachY && me.y + 1.8 > p.at.y) {
    self.spared = VAPOUR.fire.every;
    g.combat.hurtPlayer(VAPOUR.fire.player * h * (1 + self.residue), { from: p.at });
    if (self.residue > VAPOUR.residue.catches) catchFire(g);
  }
}

// Fire the user's vapour set burning on others fills the Maximum Output ring, as a landed blow does.
function charge(g: Game, hits: number): void {
  if (g.techniqueId !== 'fuel') return;
  const t = g.techniques;
  t.charge = Math.min(1, t.charge + 0.06 * hits);
  g.mastery.gainPassive('fuel', 'precision', 0.004 * hits);
}

function catchFire(g: Game): void {
  if (self.alight <= 0) g.audio.play('fuel.alight', { at: g.player.position });
  self.alight = VAPOUR.residue.alight;
  self.residue = 0;
}

// A soaked body goes up all at once.
function flare(g: Game, e: Enemy, potency: number): void {
  soaked.delete(e);
  tally.flares++;
  const c = e.center();
  g.combat.hitEnemy(e, VAPOUR.soak.flare * potency, { from: c, kind: 'heat', stagger: true });
  burn(e, VAPOUR.soak.burnFor, VAPOUR.fire.burnDmg * potency * 1.4);
  g.vfx.flames(e.position.clone(), 0.5, 12, 1.6);
  g.vfx.flash(c, FLAME, 35, 0.4, 7);
  g.audio.play('fuel.flash', { at: c, pitch: 1.1 });
  charge(g, 1);
}

// A fuel drum in the fire: it hisses, then bursts, and the burst lights
// whatever vapour and drums are close. A drum bursts once, so a chain of them
// ends where the drums do.
function cook(g: Game, p: PropInstance, fuse: number): void {
  if (!p.alive || cooking.some((c) => c.prop === p)) return;
  cooking.push({ prop: p, t: vented.has(p) ? fuse * 2 : fuse });
  g.vfx.flames(p.mesh.position.clone().setY(p.mesh.position.y + p.half.y), 0.2, 5, 0.8);
  g.audio.play('fuel.drum', { at: p.mesh.position, pitch: 1.4 });
}

function blast(g: Game, p: PropInstance): void {
  const at = p.mesh.position.clone();
  const R = VAPOUR.drum.radius, emptied = vented.has(p);
  const k = emptied ? 0.4 : 1;
  tally.blasts++;
  let hits = 0;
  for (const e of g.targets()) {
    const d = e.position.distanceTo(at);
    if (!e.alive || d > R) continue;
    g.combat.hitEnemy(e, VAPOUR.drum.dmg * k * (1 - d / (R * 1.4)), { from: at, knock: VAPOUR.drum.knock * k, lift: 3 * k, kind: 'heat', heavy: true });
    burn(e, 2, VAPOUR.fire.burnDmg);
    hits++;
  }
  if (hits) charge(g, hits);
  const me = g.player.position;
  if (me.distanceTo(at) < R) g.combat.hurtPlayer(VAPOUR.drum.player * k * (1 + self.residue), { from: at, kinetic: true });
  for (const q of g.props.instances) if (q !== p && q.alive && isDrum(q) && q.mesh.position.distanceTo(at) < R * 0.8) cook(g, q, 0.3);
  g.vfx.flames(at, R * 0.6, 26, 2.2);
  g.vfx.flash(at.clone().add(new THREE.Vector3(0, 1.2, 0)), FLAME, 90 * k, 0.6, 16);
  g.vfx.ring(at.clone().setY(at.y - p.half.y + 0.08), FLAME, 0.4, R * 1.4, 0.5);
  g.vfx.burst(at, 14, 'spark', 7, 0xffb050);
  g.vfx.patch(at.clone().setY(at.y - p.half.y), R * 0.6, 'burn', 14);
  g.cam.shake(Math.max(0, 0.5 - me.distanceTo(at) * 0.03));
  g.audio.play('fuel.blast', { at });
  kindle(at, R);
  breakProp(g, p, at);
}

// One frame of the world's vapour, and every fire Fuel's kit owns.
export function tickVapour(g: Game, dt: number): void {
  const me = g.player.position;
  // The breeze: a slow swing of heading and gusts every few seconds.
  breeze.next -= dt;
  if (breeze.next <= 0) { breeze.target = breeze.target > 0.3 ? 0 : 0.4 + Math.random() * 0.6; breeze.next = 3 + Math.random() * 5; }
  breeze.gust += (breeze.target - breeze.gust) * Math.min(1, dt * 0.8);
  breeze.angle += (Math.random() - 0.5) * 0.12 * dt;
  const wind = vapour.breeze;
  const hold = 0.35 + 0.55 * g.mastery.get('fuel', 'control');
  const reach = VAPOUR.control * (1 + g.mastery.get('fuel', 'range') * 0.5);
  // Bodies on the move, to stir what they walk through.
  const movers: { at: THREE.Vector3; vx: number; vz: number }[] = [];
  for (const e of g.encounters.enemies) {
    if (!e.alive) { lastAt.delete(e); continue; }
    const was = lastAt.get(e);
    if (was && dt > 0) movers.push({ at: e.position, vx: (e.position.x - was.x) / dt, vz: (e.position.z - was.z) / dt });
    lastAt.set(e, e.position.clone());
  }
  movers.push({ at: me, vx: g.player.velocity.x, vz: g.player.velocity.z });

  // Flames from outside.
  for (const k of pending.splice(0)) for (const p of puffs) if (p.burning < 0 && flat(p.at, k.at) < k.r + p.r * 0.8 && k.at.y < p.at.y + top(p) + 0.6 && k.at.y > p.at.y - 1.2) light(g, p);
  const flames = g.world.flames.filter((f) => flat(f, me) < reach + 10);

  for (let i = puffs.length - 1; i >= 0; i--) {
    const p = puffs[i]!;
    p.age += dt;
    if (p.burning >= 0) {
      p.burning -= dt;
      spread(p);
      if (Math.random() < dt * 14) g.vfx.flames(p.at, p.r * 0.75, 2, 0.6 + 0.9 * heatOf(p.d));
      if (p.burning <= 0) puffs.splice(i, 1);
      continue;
    }
    if (p.catchIn !== Infinity && (p.catchIn -= dt) <= 0) { light(g, p); continue; }
    // A lantern's flame lights what climbs to it.
    for (const f of flames) if (flat(f, p.at) < 0.55 + p.r * 0.6 && p.at.y + top(p) >= f.y - 0.35 && p.at.y < f.y) { tally.lanterns++; light(g, p); break; }
    if (p.burning >= 0) continue;
    const indoors = g.world.indoorsAt(p.at);
    const exposure = (0.25 + 0.75 * g.world.openAt(p.at)) * (1 - indoors);
    const held = p.still > 0 ? 1 : flat(p.at, me) < reach ? hold : 0;
    p.still = Math.max(0, p.still - dt);
    const ease = Math.min(1, dt * 1.5);
    p.vx += (wind.x * exposure * (1 - held) - p.vx) * ease;
    p.vz += (wind.y * exposure * (1 - held) - p.vz) * ease;
    for (const m of movers) {
      const sp = Math.hypot(m.vx, m.vz);
      if (sp < 1.5 || flat(m.at, p.at) > p.r + 0.3) continue;
      p.vx += m.vx * 1.2 * dt; p.vz += m.vz * 1.2 * dt;
      p.d *= 1 - 0.35 * dt;
    }
    p.at.x += p.vx * dt; p.at.z += p.vz * dt;
    if ((p.probe -= dt) <= 0) { p.probe = 0.25; settle(g, p); }
    const wet = p.ground === 'water' ? VAPOUR.thin.water : p.ground === 'wet' ? VAPOUR.thin.wet : 0;
    const air = indoors > 0.5 ? VAPOUR.thin.indoors : VAPOUR.thin.outdoors + VAPOUR.thin.breeze * exposure * (1 + breeze.gust);
    p.d *= 1 - (air + wet) * dt * (p.still > 0 ? 0.2 : 1);
    spreadBy(p, (indoors > 0.5 ? VAPOUR.spread.indoors : VAPOUR.spread.outdoors * (0.3 + exposure)) * dt * (p.still > 0 ? 0.2 : 1));
    if (p.d < 0.06 || p.age > 90) puffs.splice(i, 1);
  }
  merge();

  // Soaked bodies carry the fuel with them and drip it where they walk.
  for (const [e, s] of soaked) {
    if (!e.alive || e.disposed) { soaked.delete(e); continue; }
    s.left -= dt; s.drip -= dt; s.fume -= dt;
    const was = lastAt.get(e);
    if (s.drip <= 0 && was) { s.drip = VAPOUR.soak.drip; addPuff(g, e.position.clone(), 0.55, 0.4, s.potency); }
    if (s.fume <= 0) { s.fume = 0.35; fume(g, e.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, e.height * (0.4 + Math.random() * 0.4), (Math.random() - 0.5) * 0.4)), 0.7); }
    if (s.left <= 0) soaked.delete(e);
  }
  for (const [e, t] of spared) if (t - dt <= 0) spared.delete(e); else spared.set(e, t - dt);
  for (let i = cooking.length - 1; i >= 0; i--) {
    const c = cooking[i]!;
    if (!c.prop.alive) { cooking.splice(i, 1); continue; }
    c.t -= dt;
    if (Math.random() < dt * 10) g.vfx.flames(c.prop.mesh.position.clone().setY(c.prop.mesh.position.y + c.prop.half.y), 0.2, 1, 0.7);
    if (c.t <= 0) { cooking.splice(i, 1); blast(g, c.prop); }
  }
  // The user: residue thins, water washes it off and puts a burning body out.
  self.spared = Math.max(0, self.spared - dt);
  const under = g.world.surfaceAt(me, g.player.surface);
  const washing = under === 'water' || under === 'wet';
  self.residue = Math.max(0, self.residue - dt * (VAPOUR.residue.decay + (washing ? VAPOUR.residue.wash : 0)));
  if (self.alight > 0) {
    self.alight = washing ? 0 : self.alight - dt;
    if ((self.tick += dt) >= VAPOUR.residue.tick) {
      self.tick -= VAPOUR.residue.tick;
      g.combat.hurtPlayer(VAPOUR.residue.hurt, { self: true });
      g.vfx.flames(me.clone(), 0.35, 4, 1.1);
      g.audio.play('fuel.alight', { at: me });
    }
  }
  // Fumes: the drawn sign of vapour, wavy lines rising off the denser puffs.
  if ((fumeT -= dt) <= 0 && puffs.length) {
    fumeT = 0.16;
    const p = puffs[Math.floor(Math.random() * puffs.length)]!;
    if (p.burning < 0 && p.d > 0.3) { const a = Math.random() * Math.PI * 2, r = Math.random() * p.r * 0.7; fume(g, p.at.clone().add(new THREE.Vector3(Math.cos(a) * r, top(p) * 0.6, Math.sin(a) * r)), 0.5 + 0.5 * Math.min(1, p.d)); }
  }
  // The props Fuel's fire set alight and the bodies it set burning run their
  // course here: Heat's rules, since fire is fire.
  tickFires(g, dt);
  tickBurns(g, dt);
  draw(g);
}

// A wavy fume line rising from `at`, as a page draws a smell or a vapour.
function fume(g: Game, at: THREE.Vector3, height: number): void {
  const pts: THREE.Vector3[] = [];
  const phase = Math.random() * Math.PI * 2, side = 0.07 + Math.random() * 0.06;
  for (let k = 0; k < 6; k++) pts.push(at.clone().add(new THREE.Vector3(Math.sin(phase + k * 1.4) * side, (k / 5) * height, Math.cos(phase + k * 1.4) * side * 0.5)));
  g.vfx.trail(pts, FUME, 0.05, 0.9);
}

// Puffs herded or drifted into each other bunch into one, denser.
function merge(): void {
  for (let i = 0; i < puffs.length; i++) {
    const a = puffs[i]!;
    if (a.burning >= 0) continue;
    for (let j = puffs.length - 1; j > i; j--) {
      const b = puffs[j]!;
      if (b.burning >= 0 || flat(a.at, b.at) > 0.4 * (a.r + b.r) || Math.abs(a.at.y - b.at.y) > 0.8) continue;
      const area = (a.r * a.r + b.r * b.r) * 0.7;
      const fuel = a.d * a.r * a.r + b.d * b.r * b.r;
      const r = Math.min(1.7, Math.sqrt(area));
      const w = b.r * b.r / (a.r * a.r + b.r * b.r);
      a.at.lerp(b.at, w);
      a.vx = a.vx * (1 - w) + b.vx * w; a.vz = a.vz * (1 - w) + b.vz * w;
      a.potency = a.potency * (1 - w) + b.potency * w;
      a.d = Math.min(VAPOUR.cap, fuel / (r * r));
      a.r = r;
      a.still = Math.max(a.still, b.still);
      a.catchIn = Math.min(a.catchIn, b.catchIn);
      a.age = Math.min(a.age, b.age);
      puffs.splice(j, 1);
    }
  }
}

// ---------------------------------------------------------------- drawing
// Each puff is a low dome printed in screentone: a dot screen whose dots grow
// with the density, pinned to the puff so they travel with it. Thin vapour is
// a faint scatter of dots; a rich bank is nearly solid and darker. Burning,
// the dots turn to flame and the dome sinks.
let mesh: THREE.InstancedMesh | null = null;
let dens: THREE.InstancedBufferAttribute, tint: THREE.InstancedBufferAttribute;
const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), c3 = new THREE.Color(), vp = new THREE.Vector4();

const VERT = `
attribute float aDens;
attribute vec3 aTint;
uniform vec2 uView;
varying float vDens;
varying vec3 vTint;
varying vec2 vCentre;
varying float vFace;
void main() {
  vDens = aDens;
  vTint = aTint;
  vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vec4 c = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vCentre = (c.xy / c.w * 0.5 + 0.5) * uView;
  vec3 n = normalize(mat3(modelMatrix * instanceMatrix) * normal);
  vFace = abs(dot(n, normalize(cameraPosition - world.xyz)));
  gl_Position = projectionMatrix * viewMatrix * world;
}`;
const FRAG = `
uniform float uCell;
uniform vec2 uOffset;
varying float vDens;
varying vec3 vTint;
varying vec2 vCentre;
varying float vFace;
void main() {
  vec2 p = (gl_FragCoord.xy - uOffset - vCentre) / uCell;
  vec2 q = mat2(0.7071, -0.7071, 0.7071, 0.7071) * p;
  vec2 f = fract(q) - 0.5;
  float fill = clamp(vDens * (0.55 + 0.6 * vFace), 0.0, 1.0);
  float r = sqrt(fill) * 0.62;
  float dotted = 1.0 - smoothstep(r - 0.1, r + 0.1, length(f));
  float a = max(dotted * 0.85, 0.13 * fill) * smoothstep(0.0, 0.25, vFace + 0.1);
  if (a < 0.02) discard;
  gl_FragColor = vec4(vTint, a);
}`;

function ensureMesh(g: Game): THREE.InstancedMesh {
  if (mesh) return mesh;
  const geo = new THREE.SphereGeometry(1, 18, 7, 0, Math.PI * 2, 0, Math.PI / 2);
  dens = new THREE.InstancedBufferAttribute(new Float32Array(VAPOUR.max), 1);
  tint = new THREE.InstancedBufferAttribute(new Float32Array(VAPOUR.max * 3), 3);
  geo.setAttribute('aDens', dens);
  geo.setAttribute('aTint', tint);
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
    uniforms: { uView: { value: new THREE.Vector2(1, 1) }, uOffset: { value: new THREE.Vector2() }, uCell: { value: 6 } },
  });
  mesh = new THREE.InstancedMesh(geo, mat, VAPOUR.max);
  mesh.name = 'fuel:vapour';
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.count = 0;
  // The dot screen is sized to the frame it is drawn into, whatever its resolution.
  mesh.onBeforeRender = (r) => {
    r.getCurrentViewport(vp);
    mat.uniforms.uView!.value.set(vp.z, vp.w);
    mat.uniforms.uOffset!.value.set(vp.x, vp.y);
    mat.uniforms.uCell!.value = Math.max(3.5, vp.w / 150);
  };
  g.renderer.scene.add(mesh);
  return mesh;
}

function draw(g: Game): void {
  if (!puffs.length && !mesh) return;
  const m = ensureMesh(g);
  let n = 0;
  for (const p of puffs) {
    const lit = p.burning >= 0;
    const sink = lit ? Math.max(0.1, p.burning / (VAPOUR.burn.base + VAPOUR.burn.perDensity * Math.min(p.d, VAPOUR.cap))) : 1;
    sc.set(p.r, top(p) * sink, p.r);
    m4.compose(p.at, q, sc);
    m.setMatrixAt(n, m4);
    dens.setX(n, lit ? 0.9 : Math.min(1, p.d * 0.9));
    if (lit) c3.setHex(FLAME); else c3.setHex(TONE).lerp(new THREE.Color(RICH_TONE), THREE.MathUtils.clamp((p.d - VAPOUR.best) / (VAPOUR.rich - VAPOUR.best + 0.3), 0, 1));
    tint.setXYZ(n, c3.r, c3.g, c3.b);
    n++;
  }
  m.count = n;
  m.instanceMatrix.needsUpdate = true;
  dens.needsUpdate = true;
  tint.needsUpdate = true;
}

// Empties the world of vapour and Fuel's fires, for a new run or Technique.
export function resetVapour(): void {
  puffs.length = 0;
  soaked.clear(); spared.clear(); lastAt.clear(); cooking.length = 0; pending.length = 0;
  self.residue = 0; self.alight = 0; self.tick = 0; self.spared = 0;
  for (const k of Object.keys(tally) as (keyof typeof tally)[]) tally[k] = 0;
  if (mesh) mesh.count = 0;
}

// The debug hook and the checks read the vapour through here.
export function vapourView(): { puffs: { at: number[]; r: number; d: number; burning: boolean }[]; soaked: number; residue: number; alight: boolean; cooking: number; breeze: number[]; tally: typeof tally } {
  const b = vapour.breeze;
  return {
    puffs: puffs.map((p) => ({ at: [p.at.x, p.at.y, p.at.z], r: p.r, d: p.d, burning: p.burning >= 0 })),
    soaked: soaked.size, residue: self.residue, alight: self.alight > 0, cooking: cooking.length, breeze: [b.x, b.y], tally: { ...tally },
  };
}
