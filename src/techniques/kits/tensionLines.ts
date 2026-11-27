import * as THREE from 'three';
import type { Game } from '../../app/game';
import type { Enemy } from '../../combat/enemies';
import type { PropInstance } from '../../world/props';
import { GROUP_WORLD, GROUP_PROP, GROUP_ENEMY, RAPIER } from '../../physics/world';
import { toon } from '../../render/materials';
import { damageProp } from './shared';
import { burningGround } from './heat';
import { appState } from '../../app/state';

// Tension's lines: prepared wire strung between two anchors, standing in the
// world until it snaps, slips or is let go. The kit (tension.ts) lays them,
// draws them and lets them go; this module keeps them: where each end is,
// what crosses them, what they hold, and how they look.
//
// A line is physical. Its force goes into its anchors: a body tied to one is
// held to its length and strains against it, a prop is dragged, a pin in open
// ground gives way sooner than a wall. Every line bears a load before it
// snaps, and everything it does adds to the load: a body tripping over it, a
// body pulling against it, a draw held too long. A boss's weight snaps it
// outright. A blow swung through a line cuts it.

export const COLOR = 0xff5fa2;

// Lines are strung in a chain. The newest runs from the caster's hand to
// the last thing a line struck; stringing the next passes that end on, so
// the line runs from the last anchor to the new one, and the hand takes up
// a fresh line to the new anchor. Two throws lay a line across the ground
// between them, a snared body can be tied off to a post, and two snared
// bodies can be tied to each other. `a` is the older end, `b` the newer.
export type Anchor =
  // A wall, a post, a roof edge, or a pin driven where the line struck the
  // ground (`pin`): a pin in open ground holds less.
  | { kind: 'fixed'; at: THREE.Vector3; pin: boolean }
  | { kind: 'prop'; prop: PropInstance; local: THREE.Vector3 }
  // Tied round a body, until game time `until`.
  | { kind: 'body'; enemy: Enemy; until: number }
  | { kind: 'hand' };

export interface Strand {
  id: number;
  a: Anchor;
  b: Anchor;
  // The length the line holds a body or prop to.
  rest: number;
  // The load it bears before it snaps, and the load on it now.
  strength: number;
  load: number;
  // Damage to a body that trips over it, and the force behind a draw.
  cut: number;
  power: number;
  // Seconds left loose: a slack line trips nobody and holds nobody.
  loose: number;
  // How far a draw has tightened it, 0 to 1.
  drawn: number;
  // Seconds left standing.
  life: number;
  // A pluck: the line shivers for a moment.
  shiver: number;
  // Seconds a tied body has pulled against it lately, for Slack.
  strain: number;
  // Which side of it each body stood on last frame.
  sides: Map<Enemy, number>;
  mesh: THREE.Mesh;
  pins: THREE.Object3D[];
}

// What happened on a line to a body: the drill and the checks listen.
export type LineEvent = 'trip' | 'snare' | 'cut' | 'yank' | 'spoil' | 'fall';
export const lineEvents = new Set<(kind: LineEvent, e: Enemy, release: number) => void>();
// Every release has a number, so a listener can tell two bodies caught by one
// release from two caught by two.
let releases = 0;
export const nextRelease = (): number => ++releases;

// Tuning. Seconds unless named otherwise.
export const LINES = {
  life: 20,
  fade: 1.5,
  // The longest a line pays out from the spool, in metres.
  maxLength: 22,
  // A pin stands this far out of the ground; a line over open ground is
  // strung knee high.
  pinHeight: 0.45,
  // A line between these heights over a body's feet trips it, up to `chest`
  // it catches the chest, and over that the body passes under.
  trip: 1.05,
  chest: 1.75,
  // How long a trip or a snare holds a body (through Enemy.freeze, so a
  // chain of them halves and then stops), and how long a snare holds per
  // second of that hold.
  tripHold: 0.7,
  snareHold: 0.9,
  snarePerHold: 4,
  // Load per trip, and per second per metre a tied body strains past its length.
  tripLoad: 0.34,
  strainLoad: 0.55,
  // A pin in open ground takes load this much faster than a wall or a post.
  pinLoad: 1.4,
  // Bodies a swung blow passes this close to a line cut it.
  severReach: 1.0,
  // A draw comes to full in `draw` seconds; held this long past full, the
  // line under the most load lets go on its own.
  draw: 0.85,
  overdraw: 0.6,
  // Hauling the caster to an anchor: speed in m/s, and the longest haul.
  haulSpeed: 15,
  haulMax: 1.4,
};

const UP = new THREE.Vector3(0, 1, 0);
const SEGMENTS = 18;
let nextId = 1;

export const lines = {
  list: [] as Strand[],
  // The draw in progress: how full, and how long held past full.
  charge: 0,
  over: 0,
  drawing: false,
  rang: false,
  // Props a released line flung, hitting what they pass.
  slung: [] as { prop: PropInstance; left: number; dmg: number; hit: Set<Enemy>; release: number }[],
  // The caster on the way to an anchor.
  haul: null as { to: THREE.Vector3; out: THREE.Vector3; left: number; last: THREE.Vector3; stuck: number; from: THREE.Vector3 } | null,
};

// ------------------------------------------------------------ anchors

const tmp = new THREE.Vector3();

// The caster's hand. In first person the body is not drawn, so the line
// leaves from where the hand is in view.
export function handPoint(g: Game, out = new THREE.Vector3()): THREE.Vector3 {
  if (g.cam.isFirst && !g.cam.inShot) {
    const cam = g.renderer.camera;
    return out.set(0.16, -0.2, -0.5).applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion())).add(cam.getWorldPosition(tmp));
  }
  return g.avatar.boneWorld('index_04_leaf_r', out);
}

export function anchorPoint(g: Game, a: Anchor, out = new THREE.Vector3()): THREE.Vector3 {
  switch (a.kind) {
    case 'fixed': return out.copy(a.at);
    case 'prop': return a.prop.mesh.localToWorld(out.copy(a.local));
    case 'body': return out.copy(a.enemy.position).add(new THREE.Vector3(0, Math.min(1.0, a.enemy.height * 0.52), 0));
    case 'hand': return handPoint(g, out);
  }
}

// Whether an anchor has gone: a body dead, a prop broken.
function gone(a: Anchor): boolean {
  return (a.kind === 'body' && (!a.enemy.alive || a.enemy.disposed)) || (a.kind === 'prop' && (!a.prop.alive || !!a.prop.sealed));
}

export const movable = (a: Anchor): a is Extract<Anchor, { kind: 'body' | 'prop' }> => a.kind === 'body' || a.kind === 'prop';
export const holds = (s: Strand, e: Enemy): boolean => (s.a.kind === 'body' && s.a.enemy === e) || (s.b.kind === 'body' && s.b.enemy === e);
export const inHand = (): Strand | undefined => lines.list.find((s) => s.a.kind === 'hand');
const same = (x: Anchor, y: Anchor): boolean => x === y || (x.kind === 'body' && y.kind === 'body' && x.enemy === y.enemy) || (x.kind === 'prop' && y.kind === 'prop' && x.prop === y.prop);

// The first thing a line meets along a ray: like a ray cast, but through
// the colliders nothing is drawn for.
export function look(g: Game, from: THREE.Vector3, dir: THREE.Vector3, reach: number, mask: number): ReturnType<Game['physics']['castRay']> {
  let o = from.clone(), left = reach;
  for (let i = 0; i < 6 && left > 0; i++) {
    const hit = g.physics.castRay(o, dir, left, mask, g.player.body);
    if (!hit || !g.physics.unseen.has(hit.collider.handle)) return hit;
    const step = hit.toi + 0.05;
    o = o.addScaledVector(dir, step);
    left -= step;
  }
  return null;
}

// Struck a wall just under a ledge (a roof edge, the top of a wall), the
// line goes over and catches on the top, a little in from the edge.
function ledge(g: Game, at: THREE.Vector3, normal: THREE.Vector3): THREE.Vector3 | null {
  const into = new THREE.Vector3(-normal.x, 0, -normal.z);
  if (into.lengthSq() < 0.25) return null;
  into.normalize();
  for (const d of [0.7, 1.4]) {
    const top = look(g, at.clone().addScaledVector(into, d).add(new THREE.Vector3(0, 2.4, 0)), new THREE.Vector3(0, -1, 0), 3.2, GROUP_WORLD);
    if (top && top.toi > 0.05 && top.normal.y > 0.7 && top.point.y > at.y - 0.4) return top.point;
  }
  return null;
}

// What a line thrown from `from` toward `to` strikes first: a body, a prop,
// or the world, within `range`. Bodies within `assist` of where it lands
// are caught too, so a line thrown at someone's feet takes them.
export function strike(g: Game, from: THREE.Vector3, to: THREE.Vector3, range: number, opts: { bodies: boolean; props: boolean; assist: number }): { anchor: Anchor; point: THREE.Vector3; short: boolean } {
  const dir = to.clone().sub(from);
  const want = dir.length();
  dir.normalize();
  const reach = Math.min(range, want + 0.4);
  const mask = GROUP_WORLD | (opts.props ? GROUP_PROP : 0) | (opts.bodies ? GROUP_ENEMY : 0);
  const hit = look(g, from, dir, reach, mask);
  const point = hit ? hit.point : from.clone().addScaledVector(dir, reach);
  if (hit) {
    const enemy = (hit.collider as RAPIER.Collider & { enemy?: Enemy }).enemy;
    if (enemy && enemy.alive) return { anchor: { kind: 'body', enemy, until: 0 }, point, short: false };
    const body = hit.collider.parent();
    const prop = body ? g.props.find(body) : undefined;
    if (prop) return { anchor: { kind: 'prop', prop, local: prop.mesh.worldToLocal(point.clone()) }, point, short: false };
  }
  if (opts.bodies) {
    let best: Enemy | null = null, bestD = opts.assist;
    for (const e of g.targets()) {
      if (!e.alive) continue;
      const d = Math.hypot(e.position.x - point.x, e.position.z - point.z);
      if (d < bestD && Math.abs(e.position.y - point.y) < 2.5) { best = e; bestD = d; }
    }
    if (best) return { anchor: { kind: 'body', enemy: best, until: 0 }, point: best.center(), short: false };
  }
  // Short of anything, or into open ground or a roof: a pin where it comes down.
  const over = hit && hit.normal.y <= 0.7 ? ledge(g, hit.point, hit.normal) : null;
  if (!hit || hit.normal.y > 0.7 || over) {
    const ground = over ? null : look(g, point.clone().add(new THREE.Vector3(0, 0.6, 0)), new THREE.Vector3(0, -1, 0), 12, GROUP_WORLD);
    const at = (over ?? ground?.point ?? point).clone().addScaledVector(UP, LINES.pinHeight);
    return { anchor: { kind: 'fixed', at, pin: true }, point: at, short: !hit };
  }
  return { anchor: { kind: 'fixed', at: point.clone().addScaledVector(hit.normal, 0.04), pin: false }, point, short: false };
}


// ------------------------------------------------------------ laying and dropping

const pinMat = toon(0x3a2618);
const knotMat = toon(COLOR);
const pinGeo = new THREE.CylinderGeometry(0.03, 0.018, 0.55, 6).translate(0, -0.2, 0);
const knotGeo = new THREE.SphereGeometry(0.05, 8, 6);

function pinMesh(g: Game, a: Anchor): THREE.Object3D | null {
  if (a.kind !== 'fixed') return null;
  const o = new THREE.Group();
  if (a.pin) { const pin = new THREE.Mesh(pinGeo, pinMat); pin.castShadow = true; o.add(pin); }
  o.add(new THREE.Mesh(knotGeo, knotMat));
  o.position.copy(a.at);
  g.renderer.scene.add(o);
  return o;
}

export function lay(g: Game, a: Anchor, b: Anchor, opts: { strength: number; cut: number; power: number; life: number; loose?: boolean; pinB?: boolean }): Strand {
  const pa = anchorPoint(g, a), pb = anchorPoint(g, b);
  const mesh = ribbonMesh(g);
  const s: Strand = {
    id: nextId++, a, b, rest: Math.max(1, Math.hypot(pa.x - pb.x, pa.z - pb.z)), strength: opts.strength, load: 0, cut: opts.cut, power: opts.power,
    loose: opts.loose ? Infinity : 0, drawn: 0, life: opts.life, shiver: 0.6, strain: 0, sides: new Map(), mesh,
    pins: [pinMesh(g, a), opts.pinB === false ? null : pinMesh(g, b)].filter((p): p is THREE.Object3D => !!p),
  };
  lines.list.push(s);
  return s;
}

// Passes the line in hand on to `to`: it now runs from its anchor to `to`.
// False when `to` is what it already holds.
export function passOn(g: Game, s: Strand, to: Anchor): boolean {
  if (s.a.kind !== 'hand' || same(s.b, to)) return false;
  s.a = to;
  const pa = anchorPoint(g, s.a), pb = anchorPoint(g, s.b);
  s.rest = Math.max(1, Math.hypot(pa.x - pb.x, pa.z - pb.z));
  s.sides.clear();
  s.shiver = 0.5;
  return true;
}

// How a line leaves the world: `snap` breaks it under load with a crack
// and the two ends whipping back, `slip` lets it fall off what it held,
// `spent` is a line used up by a release, `quiet` takes it away unseen.
export function drop(g: Game, s: Strand, how: 'snap' | 'slip' | 'spent' | 'quiet'): void {
  const i = lines.list.indexOf(s);
  if (i < 0) return;
  lines.list.splice(i, 1);
  if (how !== 'quiet') {
    const pa = anchorPoint(g, s.a), pb = anchorPoint(g, s.b);
    if (how === 'snap') {
      const mid = pa.clone().lerp(pb, 0.5);
      // Each half whips back toward its own anchor.
      g.vfx.trail([mid, mid.clone().lerp(pa, 0.55).addScaledVector(UP, 0.4), pa], COLOR, 0.08, 0.22);
      g.vfx.trail([mid, mid.clone().lerp(pb, 0.55).addScaledVector(UP, 0.4), pb], COLOR, 0.08, 0.22);
      g.vfx.burst(mid, 6, 'spark', 4, 0xffe0ee);
      g.audio.play('tension.break', { at: mid });
    } else if (how === 'slip') {
      g.vfx.trail([pa, pa.clone().lerp(pb, 0.5).setY(Math.min(pa.y, pb.y) - 0.3), pb], COLOR, 0.05, 0.4);
    }
  }
  g.renderer.scene.remove(s.mesh);
  s.mesh.geometry.dispose();
  (s.mesh.material as THREE.Material).dispose();
  for (const p of s.pins) g.renderer.scene.remove(p);
}

export function clearLines(g: Game): void {
  for (const s of [...lines.list]) drop(g, s, 'quiet');
  lines.charge = 0; lines.over = 0; lines.drawing = false; lines.rang = false;
  lines.slung.length = 0;
  lines.haul = null;
}

// ------------------------------------------------------------ a frame

// The point on segment a–b nearest p, as a fraction along it.
function along(a: THREE.Vector3, b: THREE.Vector3, p: THREE.Vector3): number {
  const ab = tmp.subVectors(b, a);
  const l = ab.lengthSq();
  return l < 1e-6 ? 0 : THREE.MathUtils.clamp(new THREE.Vector3().subVectors(p, a).dot(ab) / l, 0, 1);
}

// How far a line hangs below the chord at fraction t: a loose line droops,
// a set one barely, a drawn one not at all.
function sag(s: Strand, len: number, t: number): number {
  const k = s.loose > 0 ? 0.14 : s.drawn > 0 ? 0 : 0.015;
  return k * len * 4 * t * (1 - t);
}

export function pointOn(g: Game, s: Strand, t: number, out = new THREE.Vector3()): THREE.Vector3 {
  const pa = anchorPoint(g, s.a), pb = anchorPoint(g, s.b);
  return out.lerpVectors(pa, pb, t).addScaledVector(UP, -sag(s, pa.distanceTo(pb), t));
}

// The distance from a body's column (feet to head) to a line.
export function reachTo(g: Game, s: Strand, e: Enemy): { d: number; at: THREE.Vector3 } {
  const pa = anchorPoint(g, s.a), pb = anchorPoint(g, s.b);
  let best = Infinity;
  const at = new THREE.Vector3();
  for (const h of [0.3, 0.9, 1.5]) {
    const p = e.position.clone().add(new THREE.Vector3(0, h * (e.height / 1.8), 0));
    const t = along(pa, pb, p);
    const q = pointOn(g, s, t);
    const d = q.distanceTo(p);
    if (d < best) { best = d; at.copy(q); }
  }
  return { d: best, at };
}

export function updateLines(g: Game, dt: number): void {
  const cam = g.renderer.camera.getWorldPosition(new THREE.Vector3());
  for (const s of [...lines.list]) {
    if (gone(s.a) || gone(s.b)) { drop(g, s, 'slip'); continue; }
    s.life -= dt;
    if (s.life <= 0) { drop(g, s, 'slip'); continue; }
    if (s.loose > 0) s.loose -= dt;
    s.shiver = Math.max(0, s.shiver - dt);
    s.strain = Math.max(0, s.strain - dt);
    const pa = anchorPoint(g, s.a), pb = anchorPoint(g, s.b);
    const len = pa.distanceTo(pb);
    // The line in hand pays out as the caster walks away, up to the spool.
    if (s.a.kind === 'hand' && s.b.kind !== 'body') {
      if (len > LINES.maxLength) { drop(g, s, 'snap'); continue; }
      s.rest = Math.max(s.rest, Math.hypot(pa.x - pb.x, pa.z - pb.z));
    }
    if (holdEnds(g, s, pa, pb, dt)) continue;
    if (s.loose <= 0 && s.a.kind !== 'hand' && trips(g, s, pa, pb)) continue;
    if (sever(g, s)) continue;
    if (scorched(g, s, pa, pb)) continue;
    if (s.load >= s.strength) { drop(g, s, 'snap'); continue; }
    draw(s, pa, pb, len, cam, g.clock.time);
  }
  flung(g, dt);
  hauling(g, dt);
}

// A tied body is held to the line's length from the other end; two bodies
// tied to each other are each held to it. A body pulls against the line
// and loads it; a prop is dragged. Returns true when the line let go.
function holdEnds(g: Game, s: Strand, pa: THREE.Vector3, pb: THREE.Vector3, dt: number): boolean {
  for (const end of [s.a, s.b]) if (end.kind === 'body' && g.clock.time > end.until) { drop(g, s, 'slip'); return true; }
  if (s.loose > 0) return false;
  const excess = Math.hypot(pa.x - pb.x, pa.z - pb.z) - s.rest;
  if (excess <= 0.05) return false;
  const ends: [Anchor, THREE.Vector3, Anchor][] = [[s.a, pb, s.b], [s.b, pa, s.a]];
  const both = s.a.kind === 'body' && s.b.kind === 'body';
  for (const [end, other, otherEnd] of ends) {
    if (end.kind === 'body') {
      // A body tied to a prop drags the prop, not the other way round.
      if (otherEnd.kind === 'prop') continue;
      const e = end.enemy;
      const flat = new THREE.Vector3(other.x - e.position.x, 0, other.z - e.position.z).normalize();
      const take = both ? excess / 2 : excess;
      e.position.addScaledVector(flat, Math.min(take, Math.max(2, take * 10) * dt));
      const out = -e.velocity.dot(flat);
      if (out > 0) e.velocity.addScaledVector(flat, out);
      const pinned = (otherEnd.kind === 'fixed' && otherEnd.pin) ? LINES.pinLoad : 1;
      s.load += take * dt * LINES.strainLoad * (e.isBoss ? 4 : 1) * pinned;
      s.strain = 0.6;
    } else if (end.kind === 'prop' && otherEnd.kind !== 'prop') {
      const pull = other.clone().sub(end.prop.mesh.position).normalize();
      g.props.push(end.prop, pull.multiplyScalar(Math.min(1.5, excess) * end.prop.def.mass * 6 * dt));
    }
  }
  return false;
}

// Bodies that cross a set line, below the chest, trip over it; at the chest
// it catches them. The hold goes through Enemy.freeze, so a body that keeps
// running into lines soon goes over them on its feet. Only a line set
// between two anchors trips anyone: the line in hand moves with the hand,
// and dragging it across a body is not running into it.
function trips(g: Game, s: Strand, pa: THREE.Vector3, pb: THREE.Vector3): boolean {
  const ax = pa.x, az = pa.z, bx = pb.x - ax, bz = pb.z - az;
  const l2 = bx * bx + bz * bz;
  if (l2 < 0.25) return false;
  for (const e of g.targets()) {
    if (!e.alive || holds(s, e)) continue;
    const px = e.position.x - ax, pz = e.position.z - az;
    const t = (px * bx + pz * bz) / l2;
    const cross = bx * pz - bz * px;
    const side = Math.abs(cross) < 1e-4 ? 0 : Math.sign(cross);
    const was = s.sides.get(e) ?? 0;
    s.sides.set(e, side || was);
    if (!was || !side || was === side || t < 0 || t > 1) continue;
    const y = THREE.MathUtils.lerp(pa.y, pb.y, t) - sag(s, Math.sqrt(l2), t);
    const h = y - e.position.y;
    if (h < 0 || h > LINES.chest) continue;
    const at = new THREE.Vector3(ax + bx * t, y, az + bz * t);
    const going = new THREE.Vector3(e.velocity.x, 0, e.velocity.z);
    if (going.lengthSq() < 0.01) going.set(-side * bz, 0, side * bx);
    going.normalize();
    if (e.isBoss) {
      // Too heavy to trip: the line takes it all and goes.
      g.combat.hitEnemy(e, s.cut * 0.5, { from: at, stagger: false, kind: 'cut' });
      s.load = s.strength;
    } else if (h <= LINES.trip) {
      const held = e.freeze(LINES.tripHold);
      // Over the line, face first, when it takes; a body that has been
      // tripped too often lately only stumbles across.
      g.combat.hitEnemy(e, held > 0 ? s.cut : s.cut * 0.5, held > 0 ? { from: e.position.clone().addScaledVector(going, -1), knock: 4.3, lift: 2.2, kind: 'cut' } : { from: at, stagger: false, kind: 'cut' });
      s.load += held > 0 ? LINES.tripLoad : LINES.tripLoad * 1.5;
      for (const f of lineEvents) f('trip', e, 0);
      g.mastery.gainPassive('tension', 'precision', 0.004);
    } else {
      g.combat.hitEnemy(e, s.cut * 1.2, { from: e.position.clone().addScaledVector(going, 1), knock: 4.5, lift: 2, kind: 'cut' });
      s.load += LINES.tripLoad * 1.5;
      for (const f of lineEvents) f('trip', e, 0);
    }
    s.shiver = 0.5;
    g.vfx.burst(at, 5, 'spark', 3, 0xffd0e4, going);
    g.audio.play('tension.trip', { at });
    if (s.load >= s.strength) { drop(g, s, 'snap'); return true; }
  }
  return false;
}

// A blow swung through a line cuts it: any body in the strike of its attack
// near the line, the one tied to it included.
function sever(g: Game, s: Strand): boolean {
  for (const e of g.targets()) {
    if (!e.alive || e.state !== 'strike') continue;
    if (reachTo(g, s, e).d < LINES.severReach) {
      g.vfx.glint(e.center(), 0.5, 0.2);
      drop(g, s, 'snap');
      return true;
    }
  }
  return false;
}

// Fire burns through a line strung low over it: wherever the ground is
// burning (src/techniques/kits/heat.ts), on this screen or, online, on
// another player's, a stretch of line within the flames parts there.
function scorched(g: Game, s: Strand, pa: THREE.Vector3, pb: THREE.Vector3): boolean {
  const fires = burningGround(g);
  if (!fires.length) return false;
  const dx = pb.x - pa.x, dz = pb.z - pa.z, l2 = dx * dx + dz * dz;
  for (const f of fires) {
    const t = l2 < 1e-6 ? 0 : THREE.MathUtils.clamp(((f.at.x - pa.x) * dx + (f.at.z - pa.z) * dz) / l2, 0, 1);
    const q = pointOn(g, s, t);
    if (Math.hypot(q.x - f.at.x, q.z - f.at.z) > f.radius || q.y < f.at.y - 0.3 || q.y > f.at.y + f.height) continue;
    g.vfx.flames(q.clone().setY(Math.max(f.at.y, q.y - 0.3)), 0.15, 4, 0.6);
    g.vfx.burst(q, 5, 'spark', 2.5, 0xffa04a);
    drop(g, s, 'snap');
    return true;
  }
  return false;
}

// A line is a ribbon of even width on screen, turned to the eye: unlit, in
// the Technique's colour, over the page like a stroke of coloured ink.
// Across its width the stroke is ink at both edges and colour between, so
// a line reads against sand, plaster and sky alike, as the page's own ink does.
let strokeTex: THREE.Texture | null = null;
function stroke(): THREE.Texture {
  if (strokeTex) return strokeTex;
  const c = document.createElement('canvas');
  c.width = 2; c.height = 32;
  const x = c.getContext('2d')!;
  x.fillStyle = '#1a0e12'; x.fillRect(0, 0, 2, 32);
  x.fillStyle = '#ffffff'; x.fillRect(0, 9, 2, 14);
  strokeTex = new THREE.CanvasTexture(c);
  strokeTex.colorSpace = THREE.SRGBColorSpace;
  return strokeTex;
}

function ribbonMesh(g: Game): THREE.Mesh {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((SEGMENTS + 1) * 2 * 3), 3));
  const uv = new Float32Array((SEGMENTS + 1) * 2 * 2);
  for (let i = 0; i <= SEGMENTS; i++) { uv[i * 4] = i / SEGMENTS; uv[i * 4 + 1] = 0; uv[i * 4 + 2] = i / SEGMENTS; uv[i * 4 + 3] = 1; }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const idx: number[] = [];
  for (let i = 0; i < SEGMENTS; i++) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 2, k + 1, k + 3); }
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: COLOR, map: stroke(), side: THREE.DoubleSide, transparent: true, depthWrite: false }));
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  mesh.userData.tensionLine = true;
  g.renderer.scene.add(mesh);
  return mesh;
}

// `droop` is how far its middle hangs below the chord, `wobble` how far it
// shivers, `width` a multiple of the line's own width.
function ribbon(mesh: THREE.Mesh, pa: THREE.Vector3, pb: THREE.Vector3, cam: THREE.Vector3, time: number, droop: number, wobble: number, width: number): void {
  const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
  const dir = pb.clone().sub(pa).normalize();
  const p = new THREE.Vector3(), side = new THREE.Vector3(), to = new THREE.Vector3();
  for (let i = 0; i <= SEGMENTS; i++) {
    const t = i / SEGMENTS;
    p.lerpVectors(pa, pb, t).addScaledVector(UP, -droop * 4 * t * (1 - t));
    if (wobble > 0) p.addScaledVector(UP, Math.sin(t * Math.PI) * Math.sin(time * 70 + t * 9) * wobble);
    to.subVectors(cam, p);
    const w = THREE.MathUtils.clamp(to.length() * 0.0042, 0.0015, 0.12) * width;
    side.crossVectors(dir, to).normalize().multiplyScalar(w);
    pos.setXYZ(i * 2, p.x - side.x, p.y - side.y, p.z - side.z);
    pos.setXYZ(i * 2 + 1, p.x + side.x, p.y + side.y, p.z + side.z);
  }
  pos.needsUpdate = true;
}

// The line with its sag, its shiver, and its colour going white as it is drawn tight.
function draw(s: Strand, pa: THREE.Vector3, pb: THREE.Vector3, len: number, cam: THREE.Vector3, time: number): void {
  const wobble = s.shiver * 0.08 + s.drawn * 0.02 + (s.load / s.strength > 0.7 ? 0.03 : 0);
  paint(s.mesh, pa, pb, cam, time, sag(s, len, 0.5), wobble, s.loose > 0, s.drawn, s.shiver, Math.min(1, s.life / LINES.fade));
}
function paint(mesh: THREE.Mesh, pa: THREE.Vector3, pb: THREE.Vector3, cam: THREE.Vector3, time: number, droop: number, wobble: number, loose: boolean, drawn: number, shiver: number, opacity: number): void {
  ribbon(mesh, pa, pb, cam, time, droop, wobble, 1 + drawn * 0.4);
  const mat = mesh.material as THREE.MeshBasicMaterial;
  mat.color.setHex(loose ? 0xa0506e : COLOR).lerp(WHITE, Math.min(0.7, drawn * 0.55 + shiver * 0.6));
  mat.opacity = opacity;
}
const WHITE = new THREE.Color(0xffffff);

// Another player's line, online (src/net/kitsync.ts): only the stroke and
// its pins, drawn from what their screen sends. It holds nothing and trips
// nobody here; the caster's own screen decides what its lines do.
export interface ShownLine { mesh: THREE.Mesh; pins: THREE.Object3D[]; key: string }
export function showLine(g: Game, ends: { at: THREE.Vector3; pin: boolean }[], key: string): ShownLine {
  return { mesh: ribbonMesh(g), pins: ends.map((e) => pinMesh(g, { kind: 'fixed', at: e.at, pin: e.pin })!), key };
}
export function paintLine(g: Game, l: ShownLine, pa: THREE.Vector3, pb: THREE.Vector3, loose: boolean, drawn: number, shown: number): void {
  l.mesh.visible = true;
  const len = pa.distanceTo(pb);
  const droop = (loose ? 0.14 : drawn > 0 ? 0 : 0.015) * len;
  paint(l.mesh, pa, pb, g.renderer.camera.getWorldPosition(new THREE.Vector3()), g.clock.time, droop, drawn * 0.02, loose, drawn, 0, shown);
}
export function hideLine(g: Game, l: ShownLine): void {
  g.renderer.scene.remove(l.mesh);
  l.mesh.geometry.dispose();
  (l.mesh.material as THREE.Material).dispose();
  for (const p of l.pins) g.renderer.scene.remove(p);
}

// Ghost lines hold nothing and are only drawn: the string figure between
// the hands, the network forming in Drawn World. Ask for them each frame;
// `endGhosts` puts away the ones not asked for.
const ghosts: THREE.Mesh[] = [];
let ghostsUsed = 0;
export function ghost(g: Game, pa: THREE.Vector3, pb: THREE.Vector3, opacity: number, width = 0.7): void {
  const mesh = ghosts[ghostsUsed] ?? ghosts[ghosts.push(ribbonMesh(g)) - 1]!;
  ghostsUsed++;
  mesh.visible = true;
  ribbon(mesh, pa, pb, g.renderer.camera.getWorldPosition(new THREE.Vector3()), g.clock.time, 0, 0.004, width);
  const mat = mesh.material as THREE.MeshBasicMaterial;
  mat.color.setHex(COLOR).lerp(WHITE, 0.2);
  mat.opacity = opacity;
}
export function endGhosts(): void {
  for (let i = ghostsUsed; i < ghosts.length; i++) ghosts[i]!.visible = false;
  ghostsUsed = 0;
}

// A flung prop hits the bodies it passes while it still flies fast.
function flung(g: Game, dt: number): void {
  for (let i = lines.slung.length - 1; i >= 0; i--) {
    const f = lines.slung[i]!;
    f.left -= dt;
    if (f.left <= 0 || !f.prop.alive) { lines.slung.splice(i, 1); continue; }
    const v = f.prop.body.linvel();
    const speed = Math.hypot(v.x, v.y, v.z);
    if (speed < 5) continue;
    const at = f.prop.mesh.position;
    for (const e of g.targets()) {
      if (!e.alive || f.hit.has(e)) continue;
      if (e.center().distanceTo(at) > Math.max(f.prop.half.x, f.prop.half.z) + 0.7) continue;
      f.hit.add(e);
      const dmg = f.dmg * Math.min(1.4, speed / 14);
      g.combat.hitEnemy(e, dmg, { from: at.clone().sub(new THREE.Vector3(v.x, 0, v.z).normalize()), knock: 4 + speed * 0.25, lift: 2, kind: 'kinetic', heavy: dmg > 30 });
      for (const fn of lineEvents) fn('yank', e, f.release);
      damageProp(g, f.prop, dmg, e.center());
    }
  }
}

// Hauled along a line to its anchor: the caster rises outside the edge it
// is tied over, then is drawn in over it. The rails that keep bodies on a
// roof would stop them at its edge, so a haul blocked a short way from a
// deck above lands on it, as the last pull over the edge. Never off a roof,
// and never in the rooftop trial, whose fight the rails keep on the deck.
export function haulTo(g: Game, to: THREE.Vector3): void {
  const from = g.player.position.clone();
  const out = new THREE.Vector3(from.x - to.x, 0, from.z - to.z);
  if (out.lengthSq() < 1e-4) out.set(0, 0, 1);
  out.normalize();
  lines.haul = { to: to.clone().add(new THREE.Vector3(0, 0.5, 0)), out, left: Math.min(LINES.haulMax, from.distanceTo(to) / LINES.haulSpeed + 0.6), last: from, stuck: 0, from };
  g.player.grounded = false;
  g.audio.play('tension.reel');
}

function hauling(g: Game, dt: number): void {
  const h = lines.haul;
  if (!h) return;
  h.left -= dt;
  const p = g.player.position;
  const onto = h.to.clone().addScaledVector(h.out, -0.7);
  const below = p.y < h.to.y - 0.25;
  const aim = below ? h.to.clone().addScaledVector(h.out, 1.8).add(new THREE.Vector3(0, 0.4, 0)) : onto.clone();
  const flat = Math.hypot(onto.x - p.x, onto.z - p.z);
  // Progress since last frame, against what the pull asks for.
  const moved = p.distanceTo(h.last);
  h.stuck = moved < LINES.haulSpeed * dt * 0.25 ? h.stuck + 1 : 0;
  h.last = p.clone();
  if (!below && flat < 0.5) { land(g, 1.5); return; }
  if (h.stuck >= 3 || h.left <= 0) {
    if (flat < 4 && hop(g, onto, h.from.y)) return;
    land(g, 0.5);
    return;
  }
  const dir = aim.sub(p).normalize();
  g.player.velocity.copy(dir.multiplyScalar(LINES.haulSpeed));
  g.player.grounded = false;
  if (Math.random() < dt * 30) g.renderer.speed(g.player.velocity.clone().normalize(), 0.6, 0.12);
}

function land(g: Game, up: number): void {
  const v = g.player.velocity;
  v.set(v.x * 0.15, Math.max(up, v.y * 0.2), v.z * 0.15);
  lines.haul = null;
}

// Over the edge onto the deck at `onto`, if there is one to stand on there.
function hop(g: Game, onto: THREE.Vector3, startY: number): boolean {
  const p = g.player.position;
  if (appState.value.kind === 'rooftop') return false;
  const y = g.physics.standingY(onto.x, onto.z, onto.y, 1.2);
  if (y === null || y < startY + 0.8) return false;
  const feet = new THREE.Vector3(onto.x, y, onto.z);
  if (g.physics.castRay(feet.clone().add(new THREE.Vector3(0, 0.1, 0)), UP, 1.8, GROUP_WORLD)) return false;
  g.player.displace(feet.sub(p));
  g.player.velocity.set(0, 2.5, 0);
  g.vfx.trail([p.clone().add(new THREE.Vector3(0, 1, 0)), g.player.position.clone().add(new THREE.Vector3(0, 1.2, 0))], COLOR, 0.2, 0.2);
  lines.haul = null;
  return true;
}
