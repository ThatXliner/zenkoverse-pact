import * as THREE from 'three';
import type { TechniqueKit, AbilityContext } from '../kit';
import type { Game } from '../../app/game';
import type { Enemy } from '../../combat/enemies';
import type { PropInstance } from '../../world/props';
import type { PointSource } from '../../render/lightPool';
import { signGesture, gestureSet, frontOnly, targetsAllowed } from './shared';
import { toast } from '../../app/game';
import { restriction, type Pact } from '../../pacts/schema';
import { opening, blow, type CutsceneDef } from '../../cutscene/cutscene';
import { surfaceAt } from '../../audio/surfaces';
import { GROUP_WORLD, GROUP_PROP, GROUP_ENEMY } from '../../physics/world';
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
// Conversion last took something in, when the held line began and ended (and
// ran dry), and its last tick.
export const electroState = {
  backlashAt: -Infinity, suppliedAt: -Infinity, convertedAt: -Infinity, beganAt: -Infinity, endedAt: -Infinity, dryAt: -Infinity,
  last: null as null | { at: number; length: number; ends: string; hits: number; ticks: number; spent: number; frames: number; start: [number, number, number]; end: [number, number, number]; air: number },
};

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

// The right hand. In first person it is the hand on screen: its fingertip,
// carried from the hands' own camera into the world along the same line of
// sight, so what leaves it leaves the hand the player sees.
function handAt(g: Game): THREE.Vector3 {
  if (!g.cam.isFirst) return g.avatar.boneWorld('hand_r', new THREE.Vector3());
  const tip = g.hands.fingertip(new THREE.Vector3());
  const cam = g.renderer.camera;
  const ndc = tip.clone().applyMatrix4(g.renderer.overlayCamera.projectionMatrix);
  const ray = new THREE.Vector3(ndc.x, ndc.y, 0.5).unproject(cam).sub(cam.position).normalize();
  return cam.position.clone().addScaledVector(ray, Math.max(0.3, tip.length()));
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
  g.avatar.flash(1.2);
  // A held line runs it through in ticks: the jolt comes with the first, then twice a second.
  const jolt = g.clock.time - electroState.backlashAt > 0.5;
  electroState.backlashAt = g.clock.time;
  if (!jolt) return;
  g.player.rooted = Math.max(g.player.rooted, 0.3);
  g.cam.shake(0.3);
  g.cam.kick({ fov: -3, roll: (Math.random() - 0.5) * 0.04 });
  g.hands.pulse(1);
  crawl(g, g.player.position.clone().add(new THREE.Vector3(0, 1.0, 0)), 6, 0.7, 0.08);
  g.audio.play('electro.backlash', { at: g.player.position });
}

// A metal prop the current ran into and stopped in holds it for a while:
// the next body to touch it takes it, the player included.
const held = new Map<PropInstance, { charge: number; left: number; next: number; at: number }>();
function charge(g: Game, p: PropInstance, amount: number): void {
  const was = held.get(p);
  held.set(p, { charge: Math.min(60, (was?.charge ?? 0) + amount), left: HELD_FOR, next: was?.next ?? 0, at: was && g.clock.time - was.at < 0.5 ? was.at : g.clock.time });
  if (was && g.clock.time - was.at < 0.5) return;
  // It jumps where it stands as the current goes in (a held line jolts it twice a second).
  g.props.push(p, new THREE.Vector3(0, p.def.mass * 1.2, 0), new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).multiplyScalar(p.def.mass * 0.15));
  g.audio.play('electro.metal', { at: p.mesh.position });
}

// `spare` is a body the current starts from without hurting it again.
// `per` turns power into charge: what metal at the end of a route keeps is
// never more than the charge that went into it.
// `held`: a tick of the held line. Bodies take a sting, not the whole blow;
// the heavier marks come only on a surge; and the bolt the line already
// draws to a route is not drawn again. `touched` is every body this hold has run through.
interface Conduct { hops: number; falloff: number; seize: number; people: boolean; props: boolean; single: boolean; per: number; strong: number; within?: { at: THREE.Vector3; radius: number }; spare?: Enemy; held?: { touched: Set<Enemy>; surge: boolean } }
// `fresh`: bodies a held line reached for the first time this hold.
interface Reached { bodies: Enemy[]; through: boolean; nodes: number; water: boolean; fresh: number }

// Runs a current from each of `starts` along every route it finds, breadth first,
// weaker at each hop. Bodies take it as damage; metal it ends in holds it;
// water passes it to everyone and everything in it, the player too.
function conduct(g: Game, starts: { n: Node; from: THREE.Vector3; power: number }[], o: Conduct): Reached {
  const frozen = pondFrozen(g);
  const bodies = new Set<Enemy>(), props = new Set<PropInstance>(), waters = new Set<string>();
  const out: Reached = { bodies: [], through: false, nodes: 0, water: false, fresh: 0 };
  const quiet = !!o.held && !o.held.surge;
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
      // The bolt from where the current came from, drawn as it travels (a
      // held line's forks flicker, redrawn each tick).
      if (n.kind !== 'water' && (!o.held || at.distanceTo(here) > 0.6)) g.vfx.after(d, () => g.vfx.arc(at, here, COLOR, o.held ? 0.15 : n.kind === 'body' ? 0.3 : 0.22, width * (n.kind === 'body' ? 1 : 0.8), 0.24));
      out.nodes++;
      if (n.kind === 'body') {
        if (o.people && n.e !== o.spare && (!o.single || out.bodies.length === 0)) {
          if (o.held) {
            const first = !o.held.touched.has(n.e);
            o.held.touched.add(n.e);
            if (first) out.fresh++;
            sting(g, n.e, power, at, o.seize, first, o.held.surge, o.strong);
          } else shock(g, n.e, power, at, o.strong, o.seize, d);
          out.bodies.push(n.e);
        }
        if (!quiet) igniteNear(g, n.e.position);
      } else if (n.kind === 'metal') {
        const p = n.p;
        if (!quiet) g.vfx.after(d, () => {
          strikeLight(g, p.mesh.position, o.strong * 0.7);
          crawl(g, p.mesh.position, 3, Math.max(0.4, p.half.y * 2), 0.06);
        });
        if (!quiet) igniteNear(g, n.p.mesh.position);
      } else if (n.kind === 'fuel') {
        igniteNear(g, n.at);
      } else {
        const w = n.w;
        out.water = true;
        const entry = surfaceOver(w, at);
        g.vfx.after(d, () => {
          const span = Math.min(7, w.radius * 1.2);
          if (!quiet) {
            g.vfx.ring(surfaceOver(w, here), COLOR, 0.3, span, 0.45);
            g.vfx.ring(entry, HOT, 0.2, span * 0.6, 0.3);
          }
          // Arcs skitter across the surface from where it went in.
          for (let i = 0; i < (quiet ? 2 : 4); i++) {
            const a = Math.random() * Math.PI * 2, r = (0.5 + Math.random() * 0.5) * Math.min(w.radius, 6) * 0.95;
            const end = (w.kind === 'canal' || w.kind === 'stream' ? entry : here).clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
            g.vfx.arc(entry, surfaceOver(w, end), COLOR, 0.2, 0.04, 0.22, 1);
          }
        });
        if (!quiet) {
          g.vfx.flash(here.clone().add(new THREE.Vector3(0, 0.6, 0)), HOT, 25 + 40 * o.strong, 0.15, 10);
          g.audio.play('electro.water', { at: here });
        }
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

// ---------------------------------------------------------------- the line

// Held, the right click is a live line of current from the hand to the
// aim: drawn the frame the key goes down, redrawn every frame it is held,
// gone when it comes up. It ends at the aim, on the first body or solid
// thing in the way, or in the air at its reach. Air carries it only a short
// gap for nothing: every metre of air past that costs Charge for each second
// it is held. What it touches takes it in ticks. Metal on the way carries
// it on harder and forks it to the bodies near; water takes everyone in it.
const REACH = 18;
const FREE_AIR = 3;
// Charge a second while it is held, and more a second for each metre of air past the free gap.
const DRAIN = 10;
const DRAIN_PER_METRE = 0.8;
// A tick of current through what the line touches, every TICK seconds, at
// TICK_POWER before potency. Every SURGE ticks it surges: the scorch and the
// rumble come with that, not with every tick.
const TICK = 0.12;
const TICK_POWER = 6;
const SURGE = 5;
// How long a held line seizes a body each time the freeze chain lets it (Enemy.freeze halves each in a row).
const SEIZE = 0.45;
// How near the line a body's middle, or a piece of metal, must come for the line to take it.
const BODY_RADIUS = 0.5;
const METAL_SIDE = 0.6;
// Metal carries it this far each side without the air's cost; each one on the way sends it on harder.
const METAL_CARRY = 1.25;
const METAL_AMP = 0.25;
// The line's width, and how long one call keeps it drawn if the next does not come.
const WIDTH = 0.16;
const KEEP = 0.25;
// Below this much Charge the line thins and gutters.
const LOW = 25;

type Ends = 'body' | 'metal' | 'water' | 'solid' | 'air';
interface Line {
  start: THREE.Vector3;
  end: THREE.Vector3;
  ends: Ends;
  // The points it runs through after the hand: each piece of metal on the way, then the end.
  pts: THREE.Vector3[];
  body: Enemy | null;
  metal: PropInstance[];
  water: Wet | null;
  length: number;
  air: number;
}

function lineRange(g: Game, pact: Pact | null, behaviors: readonly string[]): number {
  // A conductive Pact gives up the air: it reaches as far as a touch.
  if (pact && restriction(pact, 'target') === 'conductive') return TOUCH + HAND + 0.4;
  const r = pact ? restriction(pact, 'range') : undefined;
  const f = r === 'touch' ? 0.35 : r === 'short' ? 0.65 : r === 'long' ? 1.25 : 1;
  return REACH * f * (1 + g.mastery.get('electro', 'range') * 0.4) * (behaviors.includes('arc') ? 1.3 : 1);
}

// Where the player aims now: the floor under the cursor from above, what
// the crosshair is on otherwise, or far out along it.
function aimNow(g: Game): THREE.Vector3 {
  if (g.cam.isTop && g.cam.floorPoint) {
    const c = g.cam.floorPoint;
    const floor = g.physics.castRay(new THREE.Vector3(c.x, g.player.position.y + 2.5, c.z), DOWN, 8, GROUP_WORLD | GROUP_PROP, g.player.body);
    return floor ? floor.point : c.clone();
  }
  const eye = g.player.eye(), dir = g.cam.aimDirection();
  const hit = g.physics.castRay(eye, dir, 60, GROUP_WORLD | GROUP_PROP | GROUP_ENEMY, g.player.body);
  return hit ? hit.point : eye.addScaledVector(dir, 60);
}

// The line as it runs now, from the hand toward the aim. Metal it meets
// or passes close by is a route: the line kinks through it and runs on to
// the aim from there, unless the aim is the metal itself.
function trace(g: Game, range: number, allow: { people: boolean; props: boolean }, frozen: boolean): Line {
  const start = handAt(g), aim = aimNow(g);
  const metal: PropInstance[] = [], pts: THREE.Vector3[] = [];
  const top = (p: PropInstance) => p.mesh.position.clone().setY(p.mesh.position.y + p.half.y * 0.6);
  let from = start, travelled = 0, ends: Ends = 'air', body: Enemy | null = null, water: Wet | null = null, end = start;
  for (let leg = 0; leg < 4; leg++) {
    const dir = aim.clone().sub(from);
    let length = dir.length();
    if (length < 0.3) { dir.copy(leg ? aim.clone().sub(start) : g.cam.aimDirection()); length = 0.3; }
    dir.normalize();
    ends = 'solid';
    if (length > range - travelled) { length = Math.max(0.1, range - travelled); ends = 'air'; }
    const o = from;
    const at = (s: number) => o.clone().addScaledVector(dir, s);
    // The first solid thing on the way: a wall, a prop, the floor.
    // A prop is met a little past the aim too: aimed at, the aim lies on its skin.
    const hit = g.physics.castRay(from, dir, length + 0.3, GROUP_WORLD | GROUP_PROP, leg ? metal.at(-1)!.body : g.player.body);
    const handle = hit?.collider.parent()?.handle;
    const struck = hit ? g.props.instances.find((p) => p.alive && p.body.handle === handle) ?? null : null;
    let prop: PropInstance | null = null;
    if (hit && (hit.toi < length - 0.02 || struck)) {
      length = Math.min(length, hit.toi); ends = 'solid';
      prop = struck;
    }
    // The first body it meets before that.
    if (allow.people) {
      const bodies = g.targets().filter((e) => e.alive);
      for (let s = 0.25; s < length && !body; s += 0.12) {
        const p = at(s);
        body = bodies.find((e) => flat(p, e.position) < BODY_RADIUS && p.y > e.position.y - 0.2 && p.y < e.position.y + e.height + 0.1) ?? null;
        if (body) { length = s; ends = 'body'; }
      }
    }
    // Metal it passes close by on the way, in order.
    const passed: { p: PropInstance; s: number }[] = [];
    if (allow.props) for (const p of g.props.instances) {
      if (!isMetal(p) || p === prop || metal.includes(p)) continue;
      const v = p.mesh.position.clone().sub(from);
      const s = v.dot(dir);
      if (s < 0.3 || s > length - 0.2) continue;
      if (v.addScaledVector(dir, -s).length() < METAL_SIDE + Math.max(p.half.x, p.half.y, p.half.z)) passed.push({ p, s });
    }
    passed.sort((a, b) => a.s - b.s);
    for (const { p } of passed) { metal.push(p); pts.push(top(p)); }
    // Into metal: through it and on, or into it, when that is what was aimed at.
    if (!body && prop && isMetal(prop) && allow.props) {
      metal.push(prop);
      end = top(prop);
      pts.push(end);
      travelled += from.distanceTo(end);
      if (aim.distanceTo(prop.mesh.position) < Math.max(prop.half.x, prop.half.y, prop.half.z) + 0.6 || travelled >= range - 0.3) { ends = 'metal'; break; }
      from = end;
      continue;
    }
    // Water where it lands takes it: the line ends at the surface.
    if (ends === 'solid') {
      water = wetAt(g, at(length), frozen);
      if (water) {
        const y = water.kind === 'melt' || water.kind === 'stream' ? at(length).y : water.surfaceY;
        if (dir.y < -0.02 && from.y > y) length = Math.min(length, (from.y - y) / -dir.y);
        ends = 'water';
      }
    }
    end = body ? at(length).lerp(body.center(), 0.6) : at(length);
    pts.push(end);
    travelled += length;
    break;
  }
  return { start, end, ends, pts, body, metal, water, length: travelled, air: Math.max(0, travelled - metal.length * METAL_CARRY * 2) };
}

// A body the line is on: a tick of current, the first one landing as a
// blow (a stagger, but no shove off the line), the rest as a buzz it can
// fight through. It is seized only through the freeze chain, so it is never held long.
function sting(g: Game, e: Enemy, power: number, from: THREE.Vector3, seize: number, first: boolean, surge: boolean, strong: number): void {
  g.combat.hitEnemy(e, power, { from, kind: 'shock', knock: 0, stagger: first, tick: true });
  if (seize > 0) e.freeze(seize);
  convulse(e, 0.3);
  if (!first && !surge) return;
  const c = e.center();
  g.vfx.glint(c.clone().add(new THREE.Vector3(0, 0.2, 0)), 0.7 + 0.4 * strong, 0.18);
  strikeLight(g, c, strong * 0.6);
  crawl(g, c, 3 + Math.round(3 * strong), 0.6, 0.05 + 0.03 * strong);
  if (surge) scorch(g, e.position, 0.45 + 0.3 * strong, 5);
  else g.vfx.ring(e.position.clone().add(new THREE.Vector3(0, 0.06, 0)), COLOR, 0.3, 1.2 + strong, 0.25);
}

interface Channel {
  tickIn: number;
  ticks: number;
  // The bodies it has run through in this hold: the first touch on each lands as a blow.
  touched: Set<Enemy>;
  // What it has spent and dealt, for the checks.
  spent: number;
  hits: number;
  frames: number;
  line: Line | null;
}
let channel: Channel | null = null;

// Pressed: the line is drawn now, on this frame, and its first tick lands.
function begin(ctx: AbilityContext): ReturnType<TechniqueKit['effects']['cast']> {
  const g = ctx.game;
  channel = { tickIn: 0, ticks: 0, touched: new Set(), spent: 0, hits: 0, frames: 0, line: null };
  electroState.beganAt = g.clock.time;
  g.audio.play('electro.snap', { at: handAt(g) });
  g.mastery.gainPassive('electro', 'precision', 0.003);
  if (g.techniques.resource > 0) channelFor(ctx, 0);
  return { cameraKick: { fov: 3, pitch: 0.006 } };
}

// One frame of the line held: traced again from the hand to the aim,
// drawn, paid for, and every tick run through what it touches.
function channelFor(ctx: AbilityContext, dt: number): void {
  const g = ctx.game, t = g.techniques, ch = channel;
  if (!ch) return;
  const frozen = pondFrozen(g);
  const line = trace(g, lineRange(g, ctx.pact, ctx.behaviors), targetsAllowed(ctx), frozen);
  ch.line = line;
  ch.frames++;
  g.vfx.current(g.avatar.model, line.pts, COLOR, WIDTH * (1 + 0.15 * line.metal.length), THREE.MathUtils.clamp(t.resource / LOW, 0.2, 1), KEEP, line.start);
  g.audio.play('electro.current', { at: line.start });
  if (g.cam.isFirst) g.hands.pulse(0.25 + Math.random() * 0.25);
  // Paid by the second: a flat draw, and more for the air it crosses.
  const rate = (DRAIN + DRAIN_PER_METRE * Math.max(0, line.air - FREE_AIR)) * (1 - g.mastery.get('electro', 'efficiency') * 0.3);
  const paid = Math.min(t.resource, rate * dt);
  t.resource -= paid;
  ch.spent += paid;
  if ((ch.tickIn -= dt) > 0) return;
  ch.tickIn = Math.max(0, ch.tickIn + TICK);
  tick(ctx, ch, line, rate * TICK, frozen);
}

// A tick of current through whatever the line touches now.
function tick(ctx: AbilityContext, ch: Channel, line: Line, spent: number, frozen: boolean): void {
  const g = ctx.game;
  const allow = targetsAllowed(ctx);
  const surge = ch.ticks % SURGE === 0;
  ch.ticks++;
  const strong = Math.min(1, g.techniques.resource / 60);
  const power = TICK_POWER * ctx.potency * Math.min(1.6, 1 + METAL_AMP * line.metal.length);
  const relay = ctx.behaviors.includes('relay');
  const starts: { n: Node; from: THREE.Vector3; power: number }[] = [];
  // Metal on the way passes some of it to whoever stands near; the end takes
  // it whole. Each starts where the line already reaches it, so no second bolt is drawn there.
  line.metal.forEach((p, i) => {
    const last = i === line.metal.length - 1 && line.ends === 'metal';
    starts.push({ n: { kind: 'metal', p }, from: p.mesh.position.clone(), power: last ? power : power * 0.6 });
  });
  if (line.body) starts.push({ n: { kind: 'body', e: line.body }, from: line.end, power });
  if (line.water) starts.push({ n: { kind: 'water', w: line.water }, from: line.end, power });
  // Standing in water, the current goes down through you as well.
  const under = wetAt(g, g.player.position, frozen);
  if (under) starts.push({ n: { kind: 'water', w: under }, from: g.player.position.clone().add(new THREE.Vector3(0, 0.1, 0)), power: power * 0.8 });
  // Into the floor with no route on: it stings whoever stands right there.
  if (line.ends === 'solid' && allow.people) for (const e of g.targets()) if (e.alive && flat(e.position, line.end) < 0.9 && Math.abs(e.position.y - line.end.y) < 1.5) starts.push({ n: { kind: 'body', e }, from: line.end, power: power * 0.6 });
  const reached = conduct(g, starts, { hops: relay ? 3 : 2, falloff: relay ? 0.85 : 0.6, seize: ctx.behaviors.includes('seize') ? SEIZE : 0, people: allow.people, props: allow.props, single: allow.single, per: spent / power, strong, held: { touched: ch.touched, surge } });
  ch.hits += reached.bodies.length;
  // Where it lands it throws sparks, and from above the floor shows it.
  if (line.ends !== 'body') g.vfx.burst(line.end, 3, 'spark', 3, COLOR);
  if (surge && (line.ends === 'solid' || line.ends === 'metal')) { scorch(g, line.end, 0.35 + 0.2 * strong, 4); igniteNear(g, line.end); }
  if (surge && line.ends === 'solid') g.audio.play('electro.gap', { at: line.end });
  if (Math.random() < 0.5) g.audio.play('electro.crackle', { at: line.end, gain: 0.8 });
  // The frame catches on a fresh body, harder for more at once; a held
  // line only rumbles, a little more for each body on it.
  const fresh = reached.fresh;
  if (fresh) {
    g.clock.hitStop(Math.min(0.09, 0.03 + 0.02 * fresh));
    g.cam.shake(0.12 + 0.08 * Math.min(3, fresh));
    g.cam.kick({ fov: 2 + 2 * Math.min(3, fresh), roll: rnd(0.01) });
    g.audio.play('electro.discharge', { at: line.end, weight: 0.4 + 0.2 * fresh });
    if (fresh >= 3) g.renderer.impactFrame(2, new THREE.Color(COLOR), line.end);
    g.mastery.gainPassive('electro', 'precision', 0.004);
  } else if (surge && reached.bodies.length) g.cam.shake(0.04 + 0.025 * Math.min(4, reached.bodies.length));
  if (surge && line.air > FREE_AIR) g.mastery.gainPassive('electro', 'range', 0.002);
  electroState.last = { at: g.clock.time, length: line.length, ends: line.ends, hits: ch.hits, ticks: ch.ticks, spent: ch.spent, frames: ch.frames, start: [line.start.x, line.start.y, line.start.z], end: [line.end.x, line.end.y, line.end.z], air: line.air };
}

// Let go, or run dry: the line goes. Dry, it sputters out of the hand and says so.
function end(g: Game): void {
  const ch = channel;
  channel = null;
  g.vfx.current(g.avatar.model, [], COLOR, 0, 0, 0);
  if (!ch) return;
  electroState.endedAt = g.clock.time;
  if (g.techniques.resource > 0.05) return;
  const hand = handAt(g), to = ch.line?.end ?? hand.clone().addScaledVector(g.cam.aimDirection(), 2);
  for (let i = 0; i < 4; i++) g.vfx.after(i * 0.06, () => g.vfx.arc(hand, hand.clone().lerp(to, 0.05 + Math.random() * (0.3 - i * 0.06)).add(new THREE.Vector3(rnd(0.2), rnd(0.2), rnd(0.2))), COLOR, 0.08, 0.05, 0.5, 0));
  g.audio.play('electro.sputter', { at: hand });
  g.hands.pulse(0.4);
  electroState.dryAt = g.clock.time;
  toast('Out of Charge', 'bad');
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
  // The held line pays for itself by the second (DRAIN, DRAIN_PER_METRE).
  resource: { name: 'Charge', max: 100, regen: 0, startsFull: false, free: ['primary', 'secondary'], holdDrain: 0 },
  strikes: 'secondary',
  primitive: { name: 'Electro', short: 'a static snap', description: 'Turn a little of any energy you hold into a spark. It needs something to touch.' },
  parameters: ['direction', 'range', 'target', 'trigger', 'duration', 'resource', 'body'],
  shapes: {
    discharge: { label: 'runs a line of current from your hand to where you aim', short: 'a held line to where you aim', kinds: ['secondary'], held: 0.2, description: 'Hold it and a line of current runs from your hand to where you aim, into whatever it meets first. It burns Charge while held, more for each metre of open air. Metal and water carry it on and harder. Water takes everyone standing in it, you too.' },
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
    // The spear hand snaps straight out at the aim and stays there while the line runs.
    secondary: gestureSet(0.3, 0, [{ t: 0, right: 'spear', left: 'guard', snap: true, camera: { fov: 3, pitch: 0.008 } }, { t: 0.2, right: 'spear', left: 'guard' }], true),
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
      if (ctx.shape === 'discharge') return begin(ctx);
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
    hold(ctx, dt) { if (ctx.shape === 'discharge') channelFor(ctx, dt); },
    release(ctx) { if (ctx.shape === 'discharge') end(ctx.game); },
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
      // A cast cut short without its release (a seal) takes the line with it.
      if (channel && !t.casting) end(g);
      tickBody(g, dt);
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
      openFor = 0; held.clear(); signAt = -1; heldAtCast = 0; channel = null;
      seizing.clear();
      for (const s of scorches.splice(0)) { s.mesh.removeFromParent(); s.mat.dispose(); }
      if (glow) { g.renderer.lights.remove(glow); glow = null; }
      if (meter) { meter.removeFromParent(); meter.geometry.dispose(); (meter.material as THREE.Material).dispose(); meter = null; meterK = -1; }
      dropBody();
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
// marks it left, the held line as it runs now (null when none), its last
// tick, and when it began, ended and last ran dry.
export function electroView(g: Game) {
  const l = channel?.line;
  const v = (p: THREE.Vector3): [number, number, number] => [p.x, p.y, p.z];
  return {
    held: [...held].map(([p, h]) => ({ id: p.id, charge: h.charge, left: h.left })), pondLive: !pondFrozen(g), open: openFor, seizing: seizing.size, scorches: scorches.length,
    line: l && channel ? { start: v(l.start), end: v(l.end), ends: l.ends, length: l.length, air: l.air, metal: l.metal.length, ticks: channel.ticks, hits: channel.hits, spent: channel.spent, frames: channel.frames } : null,
    last: electroState.last, beganAt: electroState.beganAt, endedAt: electroState.endedAt, dryAt: electroState.dryAt, time: g.clock.time,
  };
}
