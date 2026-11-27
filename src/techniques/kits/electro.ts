import * as THREE from 'three';
import type { TechniqueKit, AbilityContext } from '../kit';
import type { Game } from '../../app/game';
import type { Enemy } from '../../combat/enemies';
import type { PropInstance } from '../../world/props';
import type { PointSource } from '../../render/lightPool';
import { signGesture, gestureSet, frontOnly, targetsAllowed } from './shared';
import { restriction, type Pact } from '../../pacts/schema';
import { opening, blow, type CutsceneDef } from '../../cutscene/cutscene';
import { surfaceAt } from '../../audio/surfaces';
import { GROUP_WORLD } from '../../physics/world';
import { wetStone } from '../../drills/wetStone';
import { kindle } from '../ignition';

// Electro (wiki: Electro, Energy family). Any energy in, only electricity
// out: a blow, fire, the user's own body. The output is the hard part. A
// discharge goes only where a route carries it: a touch, metal, water, the
// meltwater of a frost patch. Air carries it no further than a short gap.
// Water takes everyone standing in it, and the user is never insulated from
// their own current.

const COLOR = 0xffe45c;
const HOT = 0xfff6c8;
const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);

// Charge one discharge draws, at most.
const DRAW = 30;
// Charge leaks away on its own, faster while you stand in water.
const LEAK = 1;
const LEAK_WET = 10;
// The hand is about this far in front of the body.
const HAND = 0.5;
// How far a current jumps off metal, and between two bodies that touch.
const METAL_REACH = 2.2;
const TOUCH = 1.0;
// A stream, paddy or canal carries a current this far from where it went in.
const STREAM_REACH = 6;
// How long a metal prop holds what was put into it, and how close a body must come to take it.
const HELD_FOR = 6;
const HELD_TOUCH = 0.35;
// Static: moving fast builds a little charge on its own, up to this much.
const STATIC_CAP = 30;
const STATIC_RATE = 4;
// A blow taken outside Impact Conversion still leaves this share of itself as charge.
const STRUCK_SHARE = 0.5;

// What the drill and the checks read, in game time: when the current last
// ran through the player, when they last fed on their own body, when Impact
// Conversion last took something in, and the last discharge's shape.
export const electroState = { backlashAt: -Infinity, suppliedAt: -Infinity, convertedAt: -Infinity, last: null as null | { at: number; length: number; wanted: number; spent: number; cost: number; hits: number; nodes: number; ended: string } };

const catalogue: Pact[] = [
  { id: 'electro.discharge', technique: 'electro', name: 'Discharge', slot: 'secondary', grant: { shape: 'discharge', behaviors: ['seize'] }, clauses: [
    { kind: 'restrict', restriction: { param: 'range', value: 'short' } }, { kind: 'restrict', restriction: { param: 'direction', value: 'front' } }] },
  { id: 'electro.impact-conversion', technique: 'electro', name: 'Impact Conversion', slot: 'primary', grant: { shape: 'convert', behaviors: ['earth'] }, clauses: [
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

// ---------------------------------------------------------------- water

// Water a current can run through: the koi pond (unless Rime holds it
// frozen: ice carries nothing), the valley's stream and paddies near where
// it went in, a region's canals and pools, and the meltwater of a frost patch.
interface Wet { kind: 'pond' | 'stream' | 'canal' | 'pool' | 'melt'; at: THREE.Vector3; radius: number; surfaceY: number }

function pondFrozen(g: Game): boolean {
  const c = g.world.pond.center;
  const hit = g.physics.castRay(new THREE.Vector3(c.x, 1, c.z), DOWN, 3, GROUP_WORLD);
  return !!hit && hit.point.y > g.world.pond.surfaceY - 0.3;
}

// The region water under `p`: a canal is a strip that carries a few metres
// from where the current went in, a pool is one body of water. Ice laid over
// a canal lifts the feet above its surface, so a body on it is dry.
function regionWater(g: Game, p: THREE.Vector3, high: number): Wet | null {
  for (const w of g.world.waters) {
    if (p.y > w.surfaceY + high || p.y < w.surfaceY - 3) continue;
    if (w.kind === 'channel') {
      if (p.x >= w.x0 && p.x <= w.x1 && p.z >= w.z0 && p.z <= w.z1) return { kind: 'canal', at: new THREE.Vector3(p.x, w.surfaceY, p.z), radius: STREAM_REACH * 1.5, surfaceY: w.surfaceY };
    } else if (Math.hypot(p.x - w.center.x, p.z - w.center.z) < w.radius) return { kind: 'pool', at: w.center.clone().setY(w.surfaceY), radius: w.radius + 0.5, surfaceY: w.surfaceY };
  }
  return null;
}

function wetAt(g: Game, feet: THREE.Vector3, frozen: boolean): Wet | null {
  const pond = g.world.pond;
  if (surfaceAt(feet, '') === 'water') {
    const inPond = Math.hypot(feet.x - pond.center.x, feet.z - pond.center.z) < pond.radius + 1;
    if (inPond) return frozen ? null : { kind: 'pond', at: new THREE.Vector3(pond.center.x, pond.surfaceY, pond.center.z), radius: pond.radius + 0.5, surfaceY: pond.surfaceY };
    return { kind: 'stream', at: feet.clone(), radius: STREAM_REACH, surfaceY: feet.y };
  }
  const region = regionWater(g, feet, 0.4);
  if (region) return region;
  const melt = g.vfx.patchesUnder(feet, 'frost', 0.1)[0];
  return melt ? { kind: 'melt', at: melt.at, radius: melt.radius, surfaceY: melt.at.y } : null;
}

const wetKey = (w: Wet): string => w.kind === 'pond' ? 'pond' : w.kind === 'pool' ? `pool@${Math.round(w.at.x)},${Math.round(w.at.z)}` : `${w.kind}@${Math.round(w.at.x * 2)},${Math.round(w.at.z * 2)}`;
// In the same water: the pond or a pool is one body of water, a stream or a
// canal carries a few metres, and frost patches that touch share their meltwater.
function inWet(g: Game, w: Wet, feet: THREE.Vector3, frozen: boolean): boolean {
  if (w.kind === 'melt') return g.vfx.patchesUnder(feet, 'frost', 0.1).some((p) => flat(p.at, w.at) < p.radius + w.radius);
  const here = wetAt(g, feet, frozen);
  if (!here || here.kind !== w.kind) return false;
  if (w.kind === 'pool') return flat(here.at, w.at) < 0.5;
  return w.kind === 'pond' || flat(feet, w.at) < w.radius + 0.3;
}

// ---------------------------------------------------------------- conduction

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
function surfaceOver(w: Wet, p: THREE.Vector3): THREE.Vector3 {
  return new THREE.Vector3(p.x, w.kind === 'melt' || w.kind === 'stream' ? p.y + 0.03 : w.surfaceY + 0.02, p.z);
}

function handAt(g: Game): THREE.Vector3 {
  if (g.cam.isFirst) return g.player.eye().addScaledVector(g.cam.aimDirection(), 0.6).add(new THREE.Vector3(0, -0.25, 0));
  return g.avatar.boneWorld('hand_r', new THREE.Vector3());
}

const rnd = (k: number) => (Math.random() - 0.5) * 2 * k;

// A body the current is running through: arcs crawl over its outline,
// from one limb to another, a few at a time.
function crawl(g: Game, center: THREE.Vector3, n: number, size = 0.6, width = 0.07): void {
  const round = () => { const a = Math.random() * Math.PI * 2; return new THREE.Vector3(Math.cos(a) * size * 0.5, (Math.random() - 0.5) * size * 2.2, Math.sin(a) * size * 0.5); };
  for (let i = 0; i < n; i++) g.vfx.after(i * 0.035, () => g.vfx.arc(center.clone().add(round()), center.clone().add(round()), COLOR, 0.22, width, 0.35, 1));
}

// ---------------------------------------------------------------- what it leaves

// A scorch: the branching figure a current burns into what it runs over. It
// lands white-hot, cools to soot in half a second, and fades.
interface Scorch { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; t: number; life: number }
const scorches: Scorch[] = [];
const MAX_SCORCHES = 28;
const figures: THREE.CanvasTexture[] = [];

// Lichtenberg figures, drawn once: branches that random-walk out from the
// middle, thick at the root and splitting as they thin.
function figure(): THREE.CanvasTexture {
  if (figures.length < 3) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const x = c.getContext('2d')!;
    x.strokeStyle = '#fff';
    x.lineCap = 'round';
    const grow = (px: number, py: number, a: number, w: number, left: number): void => {
      while (left > 0 && w > 0.4) {
        const nx = px + Math.cos(a) * 7, ny = py + Math.sin(a) * 7;
        x.lineWidth = w;
        x.globalAlpha = Math.min(1, 0.35 + w / 6);
        x.beginPath(); x.moveTo(px, py); x.lineTo(nx, ny); x.stroke();
        px = nx; py = ny; a += rnd(0.55); w *= 0.93; left--;
        if (Math.random() < 0.22) grow(px, py, a + rnd(1.1), w * 0.75, left * 0.7);
      }
    };
    const n = 7 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) grow(128, 128, (i / n) * Math.PI * 2 + rnd(0.3), 7, 16);
    const glow = x.createRadialGradient(128, 128, 0, 128, 128, 40);
    glow.addColorStop(0, 'rgba(255,255,255,0.9)'); glow.addColorStop(1, 'rgba(255,255,255,0)');
    x.globalAlpha = 1; x.fillStyle = glow; x.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c);
    figures.push(t);
    return t;
  }
  return figures[Math.floor(Math.random() * figures.length)]!;
}
const scorchGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

function scorch(g: Game, at: THREE.Vector3, radius: number, life = 7): void {
  // The floor under it: a body in the air scorches the ground below, not the air.
  const hit = g.physics.castRay(at.clone().setY(at.y + 0.6), DOWN, 3, GROUP_WORLD);
  const y = hit ? hit.point.y : at.y;
  while (scorches.length >= MAX_SCORCHES) { const old = scorches.shift()!; old.mesh.removeFromParent(); old.mat.dispose(); }
  const mat = new THREE.MeshBasicMaterial({ map: figure(), color: HOT, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, toneMapped: false });
  const mesh = new THREE.Mesh(scorchGeo, mat);
  mesh.position.set(at.x, y + 0.02, at.z);
  mesh.rotation.y = Math.random() * Math.PI * 2;
  mesh.scale.setScalar(radius * 2);
  mesh.renderOrder = 3;
  g.renderer.scene.add(mesh);
  const s: Scorch = { mesh, mat, t: 0, life };
  scorches.push(s);
  g.vfx.until(life, () => { mesh.removeFromParent(); mat.dispose(); const i = scorches.indexOf(s); if (i >= 0) scorches.splice(i, 1); });
}

const SOOT = new THREE.Color(0x1d1408), EMBER = new THREE.Color(COLOR);
function tickScorches(dt: number): void {
  for (const s of scorches) {
    s.t += dt;
    const cool = Math.min(1, s.t / 0.35);
    s.mat.color.copy(EMBER).lerp(SOOT, cool);
    s.mat.opacity = Math.min(1, (s.life - s.t) / 2) * (cool < 1 ? 1 : 0.75);
  }
}

// A body the current locks up: it convulses, lit white in jolts, with arcs
// crawling over it, for as long as the current holds it.
const seizing = new Map<Enemy, { left: number; next: number; spark: number }>();
function convulse(e: Enemy, seconds: number): void {
  const was = seizing.get(e);
  seizing.set(e, { left: Math.max(was?.left ?? 0, seconds), next: 0, spark: 0 });
}

function tickSeizing(g: Game, dt: number): void {
  for (const [e, s] of seizing) {
    s.left -= dt;
    if (s.left <= 0 || e.disposed) { seizing.delete(e); continue; }
    if ((s.next -= dt) <= 0) {
      s.next = 0.045 + Math.random() * 0.03;
      const a = Math.random() * Math.PI * 2;
      e.avatar.impact(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), 0.45 + Math.random() * 0.5);
      e.avatar.flash(Math.random() < 0.5 ? 1.4 : 0.3);
    }
    if ((s.spark -= dt) <= 0) {
      s.spark = 0.1 + Math.random() * 0.08;
      const c = e.center(), h = e.height;
      const pick = () => c.clone().add(new THREE.Vector3(rnd(0.35), rnd(h * 0.5), rnd(0.35)));
      g.vfx.arc(pick(), pick(), COLOR, 0.12, 0.08, 0.5, 1);
      if (Math.random() < 0.35) g.vfx.arc(c.clone().setY(e.position.y + h * 0.3), e.position.clone().add(new THREE.Vector3(rnd(0.7), 0.03, rnd(0.7))), COLOR, 0.1, 0.06, 0.4, 0);
      g.audio.play('electro.seize', { at: c });
    }
  }
}

// The light of a strike: the scene lit from where it landed, for a beat.
function strikeLight(g: Game, at: THREE.Vector3, strong: number): void {
  g.vfx.flash(at.clone().add(new THREE.Vector3(0, 0.8, 0)), HOT, 18 + 40 * strong, 0.12, 7 + 5 * strong);
}

// One body takes the current: the bolt's weight in the hit, the lock, the
// light, the scorch where it stood, and the sparks thrown off it.
function shock(g: Game, e: Enemy, power: number, from: THREE.Vector3, strong: number, seize: number, delay: number): void {
  g.combat.hitEnemy(e, power, { from, kind: 'shock', knock: 0.6 + strong * 1.2, lift: 0.3, stagger: true, heavy: power >= 30 });
  if (seize > 0) e.freeze(seize);
  convulse(e, 0.35 + 0.65 * strong + seize * 0.5);
  g.vfx.after(delay, () => {
    const c = e.center();
    g.vfx.glint(c.clone().add(new THREE.Vector3(0, 0.2, 0)), 0.9 + 0.6 * strong, 0.2);
    strikeLight(g, c, strong);
    crawl(g, c, 4 + Math.round(4 * strong), 0.6, 0.06 + 0.04 * strong);
    // A ring at its feet: from above, where the current went is read off the floor.
    g.vfx.ring(e.position.clone().add(new THREE.Vector3(0, 0.06, 0)), COLOR, 0.3, 1.4 + strong, 0.3);
    scorch(g, e.position, 0.55 + 0.5 * strong);
  });
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
  g.avatar.flash(1.2);
  crawl(g, g.player.position.clone().add(new THREE.Vector3(0, 1.0, 0)), 6, 0.7, 0.08);
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
// `per` turns power into charge: what metal at the end of a route keeps is
// never more than the charge that went into it.
interface Conduct { hops: number; falloff: number; seize: number; people: boolean; props: boolean; single: boolean; per: number; strong: number; within?: { at: THREE.Vector3; radius: number }; spare?: Enemy }
interface Reached { bodies: Enemy[]; through: boolean; nodes: number; water: boolean }

// Runs a current from each of `starts` along every route it finds, breadth first,
// weaker at each hop. Bodies take it as damage; metal it ends in holds it;
// water passes it to everyone and everything in it, the player too.
function conduct(g: Game, starts: { n: Node; from: THREE.Vector3; power: number }[], o: Conduct): Reached {
  const frozen = pondFrozen(g);
  const bodies = new Set<Enemy>(), props = new Set<PropInstance>(), waters = new Set<string>();
  const out: Reached = { bodies: [], through: false, nodes: 0, water: false };
  const targets = g.targets().filter((e) => e.alive);
  const near = (p: THREE.Vector3) => !o.within || flat(p, o.within.at) < o.within.radius;
  const metals = () => g.props.instances.filter((p) => isMetal(p) && !props.has(p) && near(p.mesh.position));
  const mark = (n: Node): boolean => {
    if (n.kind === 'body') { if (bodies.has(n.e)) return false; bodies.add(n.e); return true; }
    if (n.kind === 'metal') { if (props.has(n.p)) return false; props.add(n.p); return true; }
    if (n.kind === 'water') { const k = wetKey(n.w); if (waters.has(k)) return false; waters.add(k); return true; }
    return true;
  };
  const width = 0.1 + 0.1 * o.strong;
  let layer: { n: Node; at: THREE.Vector3; power: number }[] = starts.filter((st) => mark(st.n)).map((st) => ({ n: st.n, at: st.from, power: st.power }));
  for (let depth = 0; depth <= o.hops && layer.length; depth++) {
    const next: typeof layer = [];
    for (const { n, at, power } of layer) {
      const here = nodeAt(n);
      // Drawn at once: the hit-stop holds the frame with the whole route lit in it.
      const d = depth > 1 ? depth * 0.02 : 0;
      // The bolt from where the current came from, drawn as it travels.
      if (n.kind !== 'water') g.vfx.after(d, () => g.vfx.arc(at, here, COLOR, n.kind === 'body' ? 0.3 : 0.22, width * (n.kind === 'body' ? 1 : 0.8), 0.24));
      out.nodes++;
      if (n.kind === 'body') {
        if (o.people && n.e !== o.spare && (!o.single || out.bodies.length === 0)) {
          shock(g, n.e, power, at, o.strong, o.seize, d);
          out.bodies.push(n.e);
        }
        igniteNear(g, n.e.position);
      } else if (n.kind === 'metal') {
        const p = n.p;
        g.vfx.after(d, () => {
          strikeLight(g, p.mesh.position, o.strong * 0.7);
          crawl(g, p.mesh.position, 3, Math.max(0.4, p.half.y * 2), 0.06);
        });
        igniteNear(g, n.p.mesh.position);
      } else if (n.kind === 'fuel') {
        igniteNear(g, n.at);
      } else {
        const w = n.w;
        out.water = true;
        const entry = surfaceOver(w, at);
        g.vfx.after(d, () => {
          const span = Math.min(7, w.radius * 1.2);
          g.vfx.ring(surfaceOver(w, here), COLOR, 0.3, span, 0.45);
          g.vfx.ring(entry, HOT, 0.2, span * 0.6, 0.3);
          // Arcs skitter across the surface from where it went in.
          for (let i = 0; i < 4; i++) {
            const a = Math.random() * Math.PI * 2, r = (0.5 + Math.random() * 0.5) * Math.min(w.radius, 6) * 0.95;
            const end = (w.kind === 'canal' || w.kind === 'stream' ? entry : here).clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
            g.vfx.arc(entry, surfaceOver(w, end), COLOR, 0.2, 0.04, 0.22, 1);
          }
        });
        g.vfx.flash(here.clone().add(new THREE.Vector3(0, 0.6, 0)), HOT, 25 + 40 * o.strong, 0.15, 10);
        g.audio.play('electro.water', { at: here });
        if (!out.through && inWet(g, w, g.player.position, frozen)) { out.through = true; backlash(g, power * 0.6); }
      }
      // Metal holds the current only where it ends: what it passes on, it does not keep.
      const ends = next.length;
      const settle = () => { if (n.kind === 'metal' && next.length === ends) charge(g, n.p, power * o.per * 0.7); };
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
        if (w) push({ kind: 'water', w }, surfaceOver(w, feet), p2);
      } else if (n.kind === 'water') {
        const w = n.w;
        // Water spreads it to everyone in it, and loses less of it than air
        // does. Drawn as a chain: from where it went in to the nearest body
        // standing in it, and from each on to the next nearest.
        const wading = targets.filter((e) => !bodies.has(e) && inWet(g, w, e.position, frozen));
        let from = at.clone();
        while (wading.length) {
          wading.sort((a, b) => flat(a.position, from) - flat(b.position, from));
          const e = wading.shift()!;
          push({ kind: 'body', e }, surfaceOver(w, from), power * 0.8);
          from = e.position.clone();
        }
        if (o.props) for (const p of metals()) if (inWet(g, w, p.mesh.position.clone().setY(p.mesh.position.y - p.half.y), frozen)) push({ kind: 'metal', p }, surfaceOver(w, p.mesh.position), power * 0.8);
      }
      settle();
    }
    layer = next;
  }
  return out;
}

// A spark lights fuel where it lands: the Kuroda's waiting pour, his or not,
// and any vapour lying there (src/techniques/ignition.ts).
function igniteNear(g: Game, at: THREE.Vector3): void {
  for (const e of g.encounters.enemies) if (e.alive && e.igniteFuel(at, 1.8) > 0) g.audio.play('electro.ignite', { at });
  kindle(at, 1.2);
}

// ---------------------------------------------------------------- the Abilities

// ---------------------------------------------------------------- the chain

// A discharge runs from the hand to the point aimed at, as far as the charge
// can carry it. Air takes it only a short gap for free; past that it is
// pushed hop by hop through the air, and each metre of air costs charge.
// Whatever lies on the line is a route: a body near it is stung on the way
// and passes it on, metal carries it a stretch for free and sends it on
// stronger, and water takes it across for nothing and gives it to everyone
// standing in it. Whatever the chain ends on takes the full blow; with
// nothing there it strikes the floor.
const REACH = 18;
const FREE_AIR = 3;
const PER_METRE = 1;
// How near the line a body or a piece of metal must be for the chain to take it.
const BODY_SIDE = 0.9;
const METAL_SIDE = 0.9;
// Metal carries the current this far each side of it without cost.
const METAL_CARRY = 1.25;
// Charge kept back for the blow at the end, whatever the distance.
const KEEP = 8;

interface Plan {
  from: THREE.Vector3;
  dir: THREE.Vector3;
  // Where the chain ends, how far it got, and how far it was asked to go.
  end: THREE.Vector3;
  length: number;
  wanted: number;
  // The routes on the way, in order, each at its distance along the line.
  nodes: { n: Node; s: number; at: THREE.Vector3 }[];
  // What the chain ends on: the last route when it lies at the end.
  target: Node | null;
  cost: number;
  metals: number;
}

function chainRange(g: Game, pact: Pact | null, behaviors: readonly string[]): number {
  const r = pact ? restriction(pact, 'range') : undefined;
  const f = r === 'touch' ? 0.35 : r === 'short' ? 0.65 : r === 'long' ? 1.25 : 1;
  return REACH * f * (1 + g.mastery.get('electro', 'range') * 0.4) * (behaviors.includes('arc') ? 1.3 : 1);
}

// The chain a discharge would run now toward `aim`, without running it: the
// cast follows it, and the aim preview draws it.
function planChain(g: Game, aim: THREE.Vector3, range: number, budget: number, allow: { people: boolean; props: boolean }, frozen: boolean): Plan {
  const from = g.player.position.clone();
  const dir = aim.clone().sub(from).setY(0);
  const wanted = Math.min(range, Math.max(0.6, dir.length()));
  if (dir.lengthSq() < 1e-4) dir.set(-Math.sin(g.cam.yaw), 0, -Math.cos(g.cam.yaw));
  dir.normalize();
  const along = (p: THREE.Vector3) => { const v = p.clone().sub(from); return { s: v.x * dir.x + v.z * dir.z, side: Math.abs(v.x * dir.z - v.z * dir.x), dy: p.y - from.y }; };
  const found: { n: Node; s: number; at: THREE.Vector3 }[] = [];
  if (allow.people) for (const e of g.targets()) {
    if (!e.alive) continue;
    const a = along(e.position);
    if (a.s > 0.2 && a.s < wanted + 0.6 && a.side < BODY_SIDE && Math.abs(a.dy) < 2.5) found.push({ n: { kind: 'body', e }, s: Math.min(a.s, wanted), at: e.center() });
  }
  if (allow.props) for (const p of g.props.instances) {
    if (!isMetal(p)) continue;
    const a = along(p.mesh.position);
    if (a.s > 0.2 && a.s < wanted + 0.6 && a.side < METAL_SIDE + p.half.x && Math.abs(a.dy) < 3) found.push({ n: { kind: 'metal', p }, s: Math.min(a.s, wanted), at: p.mesh.position.clone() });
  }
  // Water on the line: where it first goes into each body of it.
  const pond = g.world.pond;
  const seen = new Set<string>();
  const wetSpans: [number, number][] = [];
  for (let s = 0.3; s <= wanted + 0.01; s += 0.25) {
    const p = from.clone().addScaledVector(dir, s);
    let w: Wet | null = null;
    if (!frozen && Math.hypot(p.x - pond.center.x, p.z - pond.center.z) < pond.radius && Math.abs(p.y - pond.surfaceY) < 2.5) w = { kind: 'pond', at: new THREE.Vector3(pond.center.x, pond.surfaceY, pond.center.z), radius: pond.radius + 0.5, surfaceY: pond.surfaceY };
    else { const r = regionWater(g, p, 2.5); if (r) w = r.kind === 'canal' ? { ...r, at: p.clone().setY(r.surfaceY) } : r; }
    if (!w) continue;
    const last = wetSpans.at(-1);
    if (last && s - last[1] < 0.3) last[1] = s; else wetSpans.push([s, s]);
    const k = w.kind === 'canal' ? 'canal' : wetKey(w);
    if (seen.has(k)) continue;
    seen.add(k);
    found.push({ n: { kind: 'water', w }, s, at: surfaceOver(w, p) });
  }
  // The aim itself: a stream, a paddy or meltwater under it, or the Kuroda's waiting pour.
  if (flat(aim, from) <= wanted + 0.3) {
    const w = seen.size ? null : wetAt(g, aim, frozen);
    if (w) found.push({ n: { kind: 'water', w }, s: wanted, at: surfaceOver(w, aim) });
    for (const e of g.encounters.enemies) if (e.pour.some((q) => flat(q, aim) < 2.3)) found.push({ n: { kind: 'fuel', at: aim.clone() }, s: wanted, at: aim.clone() });
  }
  found.sort((x, y) => x.s - y.s);
  // A body standing in water on the line is the water's to reach, with everyone else in it.
  const wets = found.flatMap((f) => f.n.kind === 'water' ? [f.n.w] : []);
  for (let i = found.length - 2; i >= 0; i--) { const n = found[i]!.n; if (n.kind === 'body' && wets.some((w) => inWet(g, w, n.e.position, frozen))) found.splice(i, 1); }
  // Walk out along the line paying for the air, until the charge runs out.
  const carried = (s: number) => wetSpans.some(([a, b]) => s >= a - 0.2 && s <= b + 0.2) || found.some((f) => f.n.kind === 'metal' && Math.abs(f.s - s) < METAL_CARRY);
  let cost = 0, length = wanted;
  for (let s = 0; s < wanted; s += 0.25) {
    if (s > FREE_AIR && !carried(s)) cost += PER_METRE * 0.25;
    if (cost > budget) { length = s; cost = budget; break; }
  }
  const nodes = found.filter((f) => f.s <= length + 0.3);
  const end = from.clone().addScaledVector(dir, length);
  // It ends on what lies at the end of the line: the body or metal there, or water it runs into.
  const last = nodes.at(-1);
  const target = last && last.n.kind !== 'water' && length - last.s < 1.5 ? last.n : last && last.n.kind === 'water' && length - last.s < 0.3 ? last.n : null;
  if (target && target.kind !== 'water' && target.kind !== 'fuel') end.copy(nodeAt(target)).setY(from.y);
  return { from, dir, end, length, wanted, nodes, target, cost, metals: nodes.filter((f) => f.n.kind === 'metal').length };
}

// Where the player aims now, as a cast would read it: the floor under the
// cursor from above, what the crosshair is on otherwise.
function aimNow(g: Game): THREE.Vector3 | null {
  if (g.cam.isTop) return g.cam.floorPoint?.clone() ?? null;
  const eye = g.player.eye(), dir = g.cam.aimDirection();
  const hit = g.physics.castRay(eye, dir, 60, GROUP_WORLD, g.player.body);
  return hit ? hit.point.clone() : eye.addScaledVector(dir, 30);
}

// The kinks where the bolt jumps the air between two routes that stand
// farther apart than a hop.
function hopPoints(a: THREE.Vector3, b: THREE.Vector3, height: number): THREE.Vector3[] {
  const d = flat(a, b);
  const n = Math.max(1, Math.ceil(d / 2.2));
  const out: THREE.Vector3[] = [];
  const side = new THREE.Vector3(-(b.z - a.z), 0, b.x - a.x).normalize();
  for (let i = 1; i < n; i++) out.push(a.clone().lerp(b, i / n).setY(height + rnd(0.25)).addScaledVector(side, rnd(0.45)));
  return out;
}

function discharge(ctx: AbilityContext): ReturnType<TechniqueKit['effects']['cast']> {
  const g = ctx.game, t = g.techniques;
  const allow = targetsAllowed(ctx);
  const frozen = pondFrozen(g);
  const hand = handAt(g);
  const aim = ctx.aim ?? g.player.position.clone().addScaledVector(ctx.dir.clone().setY(0).normalize(), 3);
  const plan = planChain(g, aim, chainRange(g, ctx.pact, ctx.behaviors), Math.max(0, t.resource - KEEP), allow, frozen);
  // A conductive Pact gives up the air: the chain runs only from a touch or along a route.
  const conductive = ctx.pact ? restriction(ctx.pact, 'target') === 'conductive' : false;
  if (conductive && !plan.nodes.some((f) => f.s < TOUCH + HAND + 0.35)) { plan.nodes.length = 0; plan.target = null; plan.length = Math.min(plan.length, TOUCH + HAND); plan.end = plan.from.clone().addScaledVector(plan.dir, plan.length); plan.cost = 0; }
  const spent = Math.min(t.resource, plan.cost + DRAW);
  t.resource -= spent;
  const payload = Math.max(0, spent - plan.cost);
  const strong = payload / DRAW;
  // Metal on the way sends it on stronger.
  const amp = Math.min(1.6, 1 + 0.2 * plan.metals);
  const power = (10 + 1.6 * payload) * ctx.potency * amp;
  const seize = ctx.behaviors.includes('seize') && payload >= 12 ? Math.min(0.8, 0.2 + payload / 50) : 0;
  const relay = ctx.behaviors.includes('relay');
  const opts: Conduct = { hops: relay ? 6 : 3, falloff: relay ? 0.85 : 0.75, seize, people: allow.people, props: allow.props, single: allow.single, per: power > 0 ? payload / power : 0, strong };
  const y = hand.y - 0.1;
  // The bolt: hand to each route in turn, kinking through the air between them.
  const starts: { n: Node; from: THREE.Vector3; power: number }[] = [];
  let at = hand.clone(), width = 0.11 + 0.11 * strong;
  const air = (to: THREE.Vector3): THREE.Vector3 => {
    let p = at;
    for (const k of hopPoints(at, to, y)) {
      g.vfx.arc(p, k, COLOR, 0.3, width, 0.3, 2);
      if (Math.random() < 0.6) g.vfx.arc(k, k.clone().setY(g.player.position.y + 0.03).add(new THREE.Vector3(rnd(0.4), 0, rnd(0.4))), COLOR, 0.18, width * 0.5, 0.4, 0);
      p = k;
    }
    return p;
  };
  for (const f of plan.nodes) {
    const last = air(f.at);
    // A body on the way is stung in passing; water takes it whole and gives it to everyone in it.
    starts.push({ n: f.n, from: last, power: f.n === plan.target || f.n.kind === 'water' ? power : power * 0.5 });
    // Through metal it comes out stronger: the bolt thickens past it.
    if (f.n.kind === 'metal') width *= 1.25;
    at = f.n.kind === 'water' ? f.at : nodeAt(f.n);
  }
  // Standing in water, the current goes down through you as well.
  const under = wetAt(g, g.player.position, frozen);
  if (under) {
    starts.push({ n: { kind: 'water', w: under }, from: g.player.position.clone().add(new THREE.Vector3(0, 0.1, 0)), power: power * 0.8 });
    crawl(g, g.player.position.clone().add(new THREE.Vector3(0, 0.5, 0)), 4, 0.6);
  }
  const reached = conduct(g, starts, opts);
  if (!plan.target) {
    // Nothing at the end: it strikes the floor there, and whoever stands on it.
    const end = plan.end.clone().setY(y);
    const last = air(end);
    g.vfx.arc(last, end, COLOR, 0.3, width, 0.3, 2);
    const hit = g.physics.castRay(end.clone().setY(end.y + 1), DOWN, 6, GROUP_WORLD);
    const floor = hit ? hit.point.clone() : plan.end.clone();
    for (let i = 0; i < 4; i++) g.vfx.arc(end, floor.clone().add(new THREE.Vector3(rnd(0.6), 0.03, rnd(0.6))), COLOR, 0.24, width * 0.7, 0.4, 1);
    g.vfx.ring(floor.clone().setY(floor.y + 0.05), COLOR, 0.2, 1.4 + strong, 0.3);
    scorch(g, floor, 0.5 + 0.4 * strong, 6);
    strikeLight(g, floor, strong * 0.6);
    igniteNear(g, floor);
    g.audio.play('electro.gap', { at: floor });
    if (allow.people) for (const e of g.targets()) if (e.alive && !reached.bodies.includes(e) && flat(e.position, floor) < 1.1 && Math.abs(e.position.y - floor.y) < 1.5) {
      shock(g, e, power * 0.6, floor, strong * 0.6, 0, 0);
      reached.bodies.push(e);
    }
  }
  const hits = reached.bodies.length;
  g.vfx.flash(hand.clone().addScaledVector(ctx.dir, 0.4), HOT, 10 + 20 * strong, 0.1, 5);
  g.audio.play(payload >= 8 ? 'electro.discharge' : 'electro.snap', { at: hand, weight: strong });
  if (hits && strong > 0.5) g.audio.play('electro.thunder', { at: hand, gain: 0.6 + 0.4 * strong });
  if (reached.nodes > 1 || plan.length > FREE_AIR) g.audio.play('electro.jump', { at: hand });
  // The whole frame catches on it, harder the more it spent and the more it found.
  if (hits) g.cam.shake(0.15 + 0.35 * strong + 0.06 * Math.min(4, hits - 1));
  g.mastery.gainPassive('electro', 'precision', 0.003);
  if (plan.length > FREE_AIR) g.mastery.gainPassive('electro', 'range', 0.002);
  electroState.last = { at: g.clock.time, length: plan.length, wanted: plan.wanted, spent, cost: plan.cost, hits, nodes: reached.nodes, ended: plan.target?.kind ?? 'floor' };
  return {
    hits,
    hitStop: hits ? Math.min(0.2, 0.05 + 0.08 * strong + 0.025 * Math.min(4, hits - 1)) : 0,
    impactFrame: hits >= 3 ? 3 : hits && payload >= DRAW * 0.9 ? 2 : 0,
    cameraKick: { fov: 4 + 6 * strong, pitch: 0.012 + 0.01 * strong, roll: rnd(0.012 * strong) },
  };
}

// ---------------------------------------------------------------- the aim preview

// Before the click the chain shows where it would run: a dotted line on the
// floor from the feet to where it would end, a ring round each route it
// would take on the way, and a ring where it lands. Past where the charge
// gives out, the line runs on faint to the cursor.
let preview: { group: THREE.Group; dots: THREE.Mesh; faint: THREE.Mesh; end: THREE.Mesh; marks: THREE.Mesh[] } | null = null;
let previewNext = 0;
// What the preview last showed, for the checks.
let aimShown: null | { end: [number, number]; length: number; wanted: number; routes: string[]; ends: string } = null;
const DOT_GEO = new THREE.CircleGeometry(0.1, 6).rotateX(-Math.PI / 2);
const RING_GEO = new THREE.RingGeometry(0.42, 0.52, 32).rotateX(-Math.PI / 2);
const MARK_GEO = new THREE.RingGeometry(0.5, 0.57, 24).rotateX(-Math.PI / 2);

function dotsGeometry(from: THREE.Vector3, dir: THREE.Vector3, s0: number, s1: number, y: number): THREE.BufferGeometry {
  const pos: number[] = [], index: number[] = [];
  const base = DOT_GEO.getAttribute('position'), idx = DOT_GEO.getIndex()!;
  for (let s = s0; s <= s1; s += 0.45) {
    const c = from.clone().addScaledVector(dir, s), o = pos.length / 3;
    for (let i = 0; i < base.count; i++) pos.push(base.getX(i) + c.x, y, base.getZ(i) + c.z);
    for (let i = 0; i < idx.count; i++) index.push(idx.getX(i) + o);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(index);
  return geo;
}

function tickPreview(g: Game, dt: number): void {
  const t = g.techniques;
  // The chain is the right click's: shown while that key holds a discharge (the raw Technique's, or a Pact's).
  const pact = t.pactFor('secondary');
  const show = g.input.enabled && !g.cutscenes.active && !g.cam.isFirst && (pact?.grant.shape ?? 'discharge') === 'discharge';
  if (!preview) {
    const mat = (opacity: number) => new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, opacity, depthWrite: false, depthTest: false, toneMapped: false });
    const group = new THREE.Group();
    const dots = new THREE.Mesh(new THREE.BufferGeometry(), mat(0.8));
    const faint = new THREE.Mesh(new THREE.BufferGeometry(), mat(0.22));
    const end = new THREE.Mesh(RING_GEO, mat(0.9));
    const marks = Array.from({ length: 6 }, () => new THREE.Mesh(MARK_GEO, mat(0.65)));
    for (const m of [dots, faint, end, ...marks]) { m.renderOrder = 19; m.frustumCulled = false; group.add(m); }
    g.renderer.scene.add(group);
    preview = { group, dots, faint, end, marks };
  }
  preview.group.visible = show;
  if (!show || (previewNext -= dt) > 0) return;
  previewNext = 1 / 20;
  const aim = aimNow(g);
  if (!aim) { preview.group.visible = false; return; }
  const plan = planChain(g, aim, chainRange(g, pact, pact?.grant.behaviors ?? []), Math.max(0, t.resource - KEEP), { people: true, props: true }, pondFrozen(g));
  aimShown = { end: [plan.end.x, plan.end.z], length: plan.length, wanted: plan.wanted, routes: plan.nodes.map((f) => f.n.kind), ends: plan.target?.kind ?? 'floor' };
  const y = g.player.position.y + 0.06;
  preview.dots.geometry.dispose();
  preview.dots.geometry = dotsGeometry(plan.from, plan.dir, 0.7, plan.length, y);
  preview.faint.geometry.dispose();
  preview.faint.geometry = dotsGeometry(plan.from, plan.dir, plan.length + 0.45, plan.wanted, y);
  preview.end.position.set(plan.end.x, y, plan.end.z);
  preview.end.scale.setScalar(plan.target ? 1.3 : 1);
  const marks = preview.marks;
  marks.forEach((m, i) => {
    const f = plan.nodes[i];
    m.visible = !!f && f.n !== plan.target;
    if (f) { m.position.set(f.at.x, y, f.at.z); m.scale.setScalar(f.n.kind === 'water' ? 1.6 : 1); }
  });
}

function dropPreview(): void {
  if (!preview) return;
  preview.group.removeFromParent();
  preview.dots.geometry.dispose();
  preview.faint.geometry.dispose();
  preview = null;
}

// Impact Conversion is open for a moment from its beat. What lands in it
// becomes charge, up to what the hands can take in at once.
let openFor = 0;
let windowCtx: { front: boolean; earth: boolean; bank: boolean } = { front: false, earth: false, bank: false };

function intake(g: Game): number {
  const control = g.mastery.get('electro', 'control'), tolerance = g.mastery.get('electro', 'tolerance');
  return (20 + 18 * control) * (1 + tolerance * 0.5) * (1 - g.techniques.strain * 0.5);
}

// Energy taken in: into the charge, and what does not fit goes to ground
// (Pacts that keep a hand to the floor) or through the body.
function store(g: Game, energy: number, at: THREE.Vector3): void {
  const t = g.techniques, max = t.def.resource.max;
  const gained = energy * (windowCtx.bank ? 2.2 : 1.7);
  const room = max - t.resource;
  t.resource = Math.min(max, t.resource + gained);
  t.strain = Math.min(1, t.strain + 0.05);
  const over = gained - room;
  const hand = handAt(g);
  g.vfx.arc(at, hand, COLOR, 0.26, 0.1, 0.25, 2);
  g.vfx.ring(at, COLOR, 0.2, 1.2, 0.3, at.clone().sub(g.player.eye()).normalize());
  g.vfx.flash(hand, HOT, 25, 0.2, 5);
  crawl(g, g.player.position.clone().add(new THREE.Vector3(0, 1.1, 0)), 3, 0.6, 0.06);
  g.audio.play('electro.converted', { at });
  g.hands.pulse(0.8);
  electroState.convertedAt = g.clock.time;
  if (over <= 1) return;
  if (windowCtx.earth) {
    const floor = g.player.position.clone().add(new THREE.Vector3(0, 0.04, 0));
    g.vfx.arc(hand, floor.clone().add(new THREE.Vector3(rnd(0.4), 0, rnd(0.4))), COLOR, 0.2, 0.07, 0.3);
    g.vfx.ring(floor, COLOR, 0.3, 1.6, 0.35);
    scorch(g, floor, 0.4, 4);
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
    g.vfx.arc(p.mesh.position, hand, COLOR, 0.3, 0.12, 0.2, 2);
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
  // The current climbs out of the body: up from the floor round the feet, through the chest, into the hands.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.random();
    g.vfx.after(i * 0.04, () => g.vfx.arc(feet.clone().add(new THREE.Vector3(Math.cos(a) * 0.45, 0.05, Math.sin(a) * 0.45)), feet.clone().add(new THREE.Vector3(Math.cos(a) * 0.2, 1.1 + Math.random() * 0.4, Math.sin(a) * 0.2)), COLOR, 0.24, 0.07, 0.35, 1));
  }
  g.vfx.after(0.25, () => { g.vfx.flash(feet.clone().setY(feet.y + 1.2), HOT, 30, 0.25, 6); g.avatar.flash(0.8); });
  g.vfx.gather(feet, 1.4, 14, 0.35, COLOR);
  g.vfx.ring(feet.clone().setY(feet.y + 0.05), COLOR, 1.6, 0.4, 0.35);
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
  const each = (24 + 0.7 * spent) * ctx.potency;
  const spread: Conduct = { hops: 10, falloff: 0.9, seize: 0.7, people: true, props: true, single: false, within, per: 0.5, strong: 1 };
  const struck: Enemy[] = [];
  if (target) {
    const c = target.center();
    g.combat.hitEnemy(target, (50 + 1.2 * spent) * ctx.potency, { from: me, kind: 'shock', knock: 5, lift: 2.5, heavy: true });
    target.freeze(1.2);
    convulse(target, 1.6);
    struck.push(target);
    // The blow is a column of current: a white core and its channels round it, striking again.
    for (let k = 0; k < 3; k++) g.vfx.after(k * 0.12, () => { for (let i = 0; i < 3; i++) g.vfx.arc(hand, target.center(), i === 0 ? HOT : COLOR, 0.5, 0.2 - i * 0.05, 0.22 + i * 0.1, 4); });
    crawl(g, c, 10, 0.8, 0.08);
    scorch(g, target.position, 1.6, 10);
    // From the target, down into the ground around it.
    for (let i = 0; i < 8; i++) { const a = Math.random() * Math.PI * 2, r = 1 + Math.random() * 2.5; g.vfx.after(0.03 * i, () => g.vfx.arc(c, target.position.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.05, Math.sin(a) * r)), COLOR, 0.4, 0.08, 0.25, 2)); }
  } else {
    // No body to close it through: it goes into the ground, and whatever the ground carries.
    for (const e of g.techniques.enemiesInSphere(me, 3)) { g.combat.hitEnemy(e, each, { from: me, kind: 'shock', knock: 3, heavy: true }); e.freeze(0.7); convulse(e, 1.4); struck.push(e); }
  }
  const starts: { n: Node; from: THREE.Vector3; power: number }[] = target ? [{ n: { kind: 'body', e: target }, from: hand, power: each / spread.falloff }] : [];
  if (!target) for (const p of g.props.instances) if (isMetal(p) && flat(p.mesh.position, me) < 6) starts.push({ n: { kind: 'metal', p }, from: hand, power: each });
  const under = wetAt(g, me, pondFrozen(g));
  if (under) starts.push({ n: { kind: 'water', w: under }, from: me, power: each });
  const reached = conduct(g, starts, { ...spread, spare: target ?? undefined });
  for (const e of reached.bodies) { convulse(e, 1.5); struck.push(e); }
  // Every body it closed through is one circuit: a web of current between
  // them all and back to the user, striking again and again as it holds.
  const chest = me.clone().add(new THREE.Vector3(0, 1.1, 0));
  for (let k = 0; k < 4; k++) g.vfx.after(0.08 + k * 0.16, () => {
    const live = struck.filter((e) => !e.disposed);
    for (const e of live) {
      const c = e.center();
      const nearest = live.filter((o) => o !== e).sort((a, b) => a.position.distanceTo(c) - b.position.distanceTo(c))[0];
      if (nearest) g.vfx.arc(c, nearest.center(), COLOR, 0.24, 0.09, 0.25, 2);
      if (k % 2 === 0) g.vfx.arc(chest, c, k === 0 ? HOT : COLOR, 0.2, 0.08, 0.22, 2);
    }
  });
  // The ground round the user splits with it: bolts running out along the floor, scorching as they go.
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + rnd(0.2), r = 4 + Math.random() * 5;
    const end = me.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.06, Math.sin(a) * r));
    g.vfx.after(0.02 * i, () => { g.vfx.arc(me.clone().setY(me.y + 0.06), end, COLOR, 0.5, 0.08, 0.2, 3); scorch(g, me.clone().lerp(end, 0.6), 0.7, 9); });
  }
  scorch(g, me, 2.4, 12);
  // Metal round about takes what is left, and hums with it after.
  for (const p of g.props.instances) if (isMetal(p) && flat(p.mesh.position, me) < 10 && !held.has(p)) charge(g, p, 12);
  g.vfx.flash(me.clone().add(new THREE.Vector3(0, 2.5, 0)), HOT, 160, 0.45, 30);
  if (target) g.vfx.after(0.12, () => g.vfx.flash(target.center(), HOT, 80, 0.3, 16));
  g.vfx.ring(me.clone().add(new THREE.Vector3(0, 0.08, 0)), COLOR, 0.5, 14, 0.7);
  g.vfx.after(0.15, () => g.vfx.ring(me.clone().add(new THREE.Vector3(0, 0.1, 0)), HOT, 0.5, 9, 0.5));
  g.cam.shake(0.9);
  // It closes through the user too.
  g.combat.hurtPlayer(g.combat.maxHp * 0.08, { self: true });
  crawl(g, me.clone().add(new THREE.Vector3(0, 1, 0)), 10, 0.8, 0.1);
  g.avatar.flash(1.5);
  g.audio.play('electro.max.tail', { at: me });
  g.audio.play('electro.thunder', { at: me });
  return { hits: struck.length, hitStop: 0.18, impactFrame: 4, rooted: 1.4, cameraKick: { fov: 16, pitch: 0.05, roll: -0.03 } };
}

// ---------------------------------------------------------------- held charge on the body

// What the user holds shows on them: arcs crawling over the arms and up to
// the shoulders, more and thicker the more they hold, a crackle that grows,
// sparks lifting off the head, a light that gutters round them, and a thin
// ring at the feet that fills with the charge.
let glow: PointSource | null = null;
let meter: THREE.Mesh | null = null;
let meterK = -1;
let crawlIn = 0;
const LIMBS = ['hand_r', 'hand_l', 'lowerarm_r', 'lowerarm_l', 'upperarm_r', 'upperarm_l', 'spine_03', 'Head'] as const;

function tickBody(g: Game, dt: number): void {
  const t = g.techniques;
  const k = t.resource / t.def.resource.max;
  const me = g.player.position;
  if (!glow) glow = g.renderer.lights.add<PointSource>({ kind: 'point', urgent: true, position: new THREE.Vector3(), color: new THREE.Color(HOT), intensity: 0, distance: 5, decay: 2 });
  glow.position.copy(me).setY(me.y + 1.2);
  glow.intensity = k > 0.15 ? k * k * (5 + Math.random() * 5) : 0;
  if (!meter) {
    meter = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, opacity: 0.7, depthWrite: false, depthTest: false, side: THREE.DoubleSide, toneMapped: false }));
    meter.renderOrder = 18;
    g.renderer.scene.add(meter);
  }
  const shown = Math.round(k * 60) / 60;
  if (shown !== meterK) {
    meterK = shown;
    meter.geometry.dispose();
    meter.geometry = new THREE.RingGeometry(0.72, 0.84, 48, 1, Math.PI / 2, -Math.max(0.001, shown) * Math.PI * 2).rotateX(-Math.PI / 2);
  }
  meter.visible = k > 0.01 && !g.cam.isFirst;
  meter.position.set(me.x, me.y + 0.06, me.z);
  (meter.material as THREE.MeshBasicMaterial).opacity = k > 0.97 ? 0.6 + 0.4 * Math.sin(g.clock.time * 14) : 0.7;
  if (k < 0.08) return;
  crawlIn -= dt;
  if (crawlIn > 0) return;
  crawlIn = 1 / (2 + 22 * k) * (0.6 + Math.random() * 0.8);
  if (g.cam.isFirst) { g.hands.pulse(0.2 + Math.random() * 0.35 * k); return; }
  // Hands and forearms first; past half the arcs climb to the shoulders and the head.
  const reach = k > 0.5 ? LIMBS.length : 4;
  const a = g.avatar.boneWorld(LIMBS[Math.floor(Math.random() * reach)]!, new THREE.Vector3());
  const b = Math.random() < 0.4
    ? a.clone().add(new THREE.Vector3(rnd(0.3), rnd(0.3), rnd(0.3)))
    : g.avatar.boneWorld(LIMBS[Math.floor(Math.random() * reach)]!, new THREE.Vector3());
  g.vfx.arc(a, b, COLOR, 0.08 + Math.random() * 0.08, 0.03 + 0.06 * k, 0.5, k > 0.6 ? 1 : 0);
  g.audio.play('electro.crackle', { at: a, gain: 0.3 + 0.9 * k });
  // Full, it lifts off the head like hair standing up, and runs down to the floor.
  if (k > 0.45 && Math.random() < k) { const head = g.avatar.boneWorld('Head', new THREE.Vector3()); g.vfx.arc(head.clone().add(new THREE.Vector3(rnd(0.1), 0.1, rnd(0.1))), head.clone().add(new THREE.Vector3(rnd(0.25), 0.3 + Math.random() * 0.25, rnd(0.25))), COLOR, 0.09, 0.035, 0.5, 0); }
  if (k > 0.75 && Math.random() < 0.25) g.vfx.arc(a, me.clone().add(new THREE.Vector3(rnd(0.6), 0.03, rnd(0.6))), COLOR, 0.1, 0.04, 0.4, 0);
}

function dropBody(): void {
  if (glow) glow.intensity = 0;
  if (meter) meter.visible = false;
}

// ---------------------------------------------------------------- the kit

let signAt = -1;
// The Charge held on the last frame nothing was being cast.
let heldAtCast = 0;
let staticNext = 0;

export const electro: TechniqueKit = {
  id: 'electro', name: 'Electro', glyph: '電', color: COLOR, type: 'Conversion, Energy family', sfx: 'バチッ',
  blurb: 'Any energy in, only electricity out. A discharge needs a route: a touch, metal, water. You are never insulated from your own current.',
  breadth: 3,
  resource: { name: 'Charge', max: 100, regen: 0, startsFull: false, free: ['primary', 'secondary'] },
  strikes: 'secondary',
  primitive: { name: 'Electro', short: 'a static snap', description: 'Turn a little of any energy you hold into a spark. It needs something to touch.' },
  parameters: ['direction', 'range', 'target', 'trigger', 'duration', 'resource', 'body'],
  shapes: {
    discharge: { label: 'releases charge through whatever it touches', short: 'a chain to where you aim', kinds: ['secondary'], description: 'It runs to where you aim, as far as your charge can push it through the air. Metal and water carry it farther and harder. Water takes everyone standing in it, you too.' },
    convert: { label: 'turns the blow that lands into charge', short: 'turn a blow into charge', kinds: ['primary'], description: 'Meet a blow as it lands. What you cannot take in still reaches you.' },
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
    secondary: gestureSet(0.55, 0.24, [{ t: 0, right: 'spearDraw', left: 'guard', slow: true }, { t: 0.2, right: 'spear', snap: true, camera: { fov: 5, pitch: 0.012 } }, { t: 0.34, right: 'spear' }, { t: 0.48, right: 'rest', left: 'rest' }]),
    // One palm meets the blow, the other goes to the floor.
    primary: gestureSet(0.5, 0.12, [{ t: 0, right: 'catchPalm', left: 'groundPalm', snap: true, camera: { fov: -3 } }, { t: 0.32, right: 'catchPalm', left: 'groundPalm' }, { t: 0.44, right: 'rest', left: 'rest' }]),
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
      if (wet && Math.random() < dt * 10) {
        const p = g.player.position, a = Math.random() * Math.PI * 2;
        g.vfx.arc(surfaceOver(wet, p), surfaceOver(wet, p.clone().add(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(0.6 + Math.random()))), COLOR, 0.14, 0.05, 0.3, 1);
      }
      // Static: running builds a little charge, as far as static goes, and sparks at the feet say so.
      if (!wet && g.player.grounded && g.player.planarSpeed.value > 4.5 && t.resource < STATIC_CAP) {
        t.resource = Math.min(STATIC_CAP, t.resource + STATIC_RATE * dt);
        if ((staticNext -= dt) <= 0) {
          staticNext = 0.12 + Math.random() * 0.12;
          const f = g.player.position.clone().add(new THREE.Vector3(rnd(0.25), 0.05, rnd(0.25)));
          g.vfx.arc(f, f.clone().add(new THREE.Vector3(rnd(0.3), 0.25 + Math.random() * 0.3, rnd(0.3))), COLOR, 0.07, 0.03, 0.5, 0);
        }
      }
      if (openFor > 0) { openFor -= dt; convertProps(g); }
      tickBody(g, dt);
      tickPreview(g, dt);
      tickSeizing(g, dt);
      tickScorches(dt);
      // The sign tears an arc between the hands on its release.
      const s = t.sign;
      if (s.kind === 'signing' && signAt < 1.2 && s.t >= 1.2 && !g.cam.isFirst) {
        const l = g.avatar.boneWorld('hand_l', new THREE.Vector3()), r = g.avatar.boneWorld('hand_r', new THREE.Vector3());
        g.vfx.arc(l, r, COLOR, 0.35, 0.1, 0.3, 2);
        g.vfx.flash(r, HOT, 30, 0.2, 5);
        g.audio.play('electro.jump', { at: r });
      }
      signAt = s.kind === 'signing' ? s.t : -1;
      tickHeld(g, dt);
    },
    reset(g) {
      openFor = 0; held.clear(); signAt = -1; heldAtCast = 0;
      seizing.clear();
      for (const s of scorches.splice(0)) { s.mesh.removeFromParent(); s.mat.dispose(); }
      if (glow) { g.renderer.lights.remove(glow); glow = null; }
      if (meter) { meter.removeFromParent(); meter.geometry.dispose(); (meter.material as THREE.Material).dispose(); meter = null; meterK = -1; }
      dropBody();
      dropPreview();
    },
    onStruck(g, amount, from) {
      const dir = from.clone().sub(g.player.position).setY(0).normalize();
      if (openFor <= 0 || (windowCtx.front && g.cam.aimDirection().setY(0).normalize().dot(dir) < 0.3)) {
        // Unready, the blow lands whole; the body still keeps some of it as charge.
        const t = g.techniques;
        const was = t.resource;
        t.resource = Math.min(t.def.resource.max, t.resource + amount * STRUCK_SHARE);
        if (t.resource - was > 1) {
          const hit = g.player.position.clone().add(new THREE.Vector3(0, 1.1, 0)).addScaledVector(dir, 0.3);
          crawl(g, hit, 2, 0.5, 0.05);
        }
        return amount;
      }
      // The hands take in only so much at once; the rest of the blow lands.
      const taken = Math.min(amount, intake(g));
      store(g, taken, g.player.eye().addScaledVector(dir, 0.6).add(new THREE.Vector3(0, -0.3, 0)));
      g.tutorial.notify('absorbed');
      g.mastery.gainPassive('electro', 'tolerance', 0.006);
      g.mastery.gainPassive('electro', 'control', 0.003);
      return amount - taken;
    },
  },
  audio: { primary: 'electro.convert.cast', secondary: 'electro.cast', max: 'electro.max.cast' },
};

function tickHeld(g: Game, dt: number): void {
  if (!held.size) return;
  const me = g.player.position;
  for (const [p, h] of held) {
    h.left -= dt;
    if (!p.alive || h.left <= 0) { held.delete(p); continue; }
    const at = p.mesh.position;
    // Metal holding a current hums with it: arcs over it and down to the floor, and a light that flickers.
    if ((h.next -= dt) <= 0) {
      h.next = 0.07 + Math.random() * 0.12;
      const k = Math.min(1, h.charge / 30);
      g.vfx.arc(at.clone().add(new THREE.Vector3(0, p.half.y * 0.6, 0)), at.clone().add(new THREE.Vector3(rnd(p.half.x * 1.6), p.half.y * (0.5 + Math.random()), rnd(p.half.z * 1.6))), COLOR, 0.12, 0.04 + 0.04 * k, 0.45, 1);
      if (Math.random() < 0.3) g.vfx.arc(at, at.clone().setY(at.y - p.half.y + 0.03).add(new THREE.Vector3(rnd(0.6), 0, rnd(0.6))), COLOR, 0.1, 0.04, 0.4, 0);
      if (Math.random() < 0.5) g.vfx.flash(at, HOT, 6 + 10 * k, 0.12, 4);
      g.audio.play('electro.crackle', { at });
      g.audio.play('electro.hum', { at });
    }
    // Touching: within a hand's breadth of its sides.
    const touching = (q: THREE.Vector3) => Math.hypot(Math.max(0, Math.abs(q.x - at.x) - p.half.x), Math.max(0, Math.abs(q.z - at.z) - p.half.z)) < HELD_TOUCH && Math.abs(q.y + 0.9 - at.y) < 1.5;
    const body = g.targets().find((e) => e.alive && touching(e.position));
    if (body) {
      g.vfx.arc(at, body.center(), COLOR, 0.28, 0.12, 0.2, 2);
      g.combat.hitEnemy(body, h.charge, { from: at, kind: 'shock', knock: 0.6, stagger: true });
      convulse(body, 0.6);
      crawl(g, body.center(), 4);
      strikeLight(g, body.center(), Math.min(1, h.charge / 40));
      scorch(g, body.position, 0.6);
      g.audio.play('electro.discharge', { at, weight: h.charge / 60 });
      held.delete(p);
    } else if (touching(me)) {
      // The player's own charge, in metal they walked into.
      g.vfx.arc(at, g.player.position.clone().add(new THREE.Vector3(0, 1, 0)), COLOR, 0.24, 0.1, 0.2);
      held.delete(p);
      backlash(g, h.charge * 0.6);
    }
  }
}

// What the checks read: the props holding charge, whether the pond carries,
// Impact Conversion's open moment, the bodies the current holds locked, the
// marks it left, and the last discharge.
export function electroView(g: Game): { held: { id: number; charge: number; left: number }[]; pondLive: boolean; open: number; seizing: number; scorches: number; last: typeof electroState.last; aim: typeof aimShown } {
  return { held: [...held].map(([p, h]) => ({ id: p.id, charge: h.charge, left: h.left })), pondLive: !pondFrozen(g), open: openFor, seizing: seizing.size, scorches: scorches.length, last: electroState.last, aim: preview?.group.visible ? aimShown : null };
}
