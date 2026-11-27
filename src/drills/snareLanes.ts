import * as THREE from 'three';
import type { Game } from '../app/game';
import type { DrillDef, DrillItem, DrillTier } from './drills';
import type { Enemy } from '../combat/enemies';
import type { MasteryStat } from '../mastery/mastery';
import { keyLabel } from '../app/keymap';
import { toon } from '../render/materials';
import { GROUNDS } from '../world/valleyPlan';
import { lineEvents, type LineEvent } from '../techniques/kits/tensionLines';

// Snare Lanes (罠線), Tension's drill, on the training ground east of the
// walls. Straw runners cross the sand one at a time, each down a lane that
// is marked on the ground a moment before it sets off. A runner is caught
// when a line takes it. The skill is the line's: where to string it, how
// soon, and when to let it go.
//   First Line  one lane, time to spare: string a line across it      output, precision, control
//   Crossing    any lane, little warning                               + range, speed
//   Snap        only a line let go counts, not one run into            + efficiency, activation
//   Web         two runners at once: one release must take both        + tolerance, all to the top
// Control is how long a drawn line holds past taut and how much of a
// line that gives comes back into the hand (tension.ts).
// A tier raises its stats to a level (`raises`), as the Striking Posts do:
// clearing it again adds nothing.

const C = new THREE.Vector3(GROUNDS.x, 0, GROUNDS.z);
// Where the drill is begun: a stake with a coil of line on it, west of centre.
const STATION = C.clone().add(new THREE.Vector3(-3, 0, 2.4));
// Each lane runs across the sand, clear of the posts, the stones and the log.
const LANES: [[number, number], [number, number]][] = [
  [[-7.5, -2.2], [6.2, -2.2]],
  [[6.0, 1.0], [-7.5, 0.6]],
  [[1.6, 7.6], [1.2, -4.4]],
  [[-0.6, -4.6], [-0.2, 7.6]],
];
// Lanes that cross each other, for two runners at once.
const PAIRS: [number, number][] = [[0, 2], [0, 3], [1, 2], [1, 3]];
// The runner's own velocity eases toward standing each frame; this makes
// up the difference so it runs at the tier's speed.
const DRIVE = 1 / 0.85;
const MARK = 0xf3e2c4;

interface Rules { lanes: number[]; lead: number; speed: number; counts: LineEvent[]; pair: boolean; lines: string[] }
const STATS_AT = (level: number, stats: MasteryStat[]): Partial<Record<MasteryStat, number>> => Object.fromEntries(stats.map((s) => [s, level]));
const ALL: LineEvent[] = ['trip', 'snare', 'cut', 'yank', 'fall'];
const LET_GO: LineEvent[] = ['cut', 'yank'];

const TIERS: (DrillTier & { rules: Rules })[] = [
  { name: 'First Line', count: 4, interval: 6.5, pass: 3, raises: STATS_AT(0.55, ['output', 'precision', 'control']),
    rules: { lanes: [0], lead: 2.6, speed: 2.8, counts: ALL, pair: false, lines: [] } },
  { name: 'Crossing', count: 5, interval: 5, pass: 4, raises: STATS_AT(0.7, ['output', 'precision', 'control', 'range', 'speed']),
    rules: { lanes: [0, 1, 2, 3], lead: 1.4, speed: 3.6, counts: ALL, pair: false, lines: ['Any lane now, with less warning.'] } },
  { name: 'Snap', count: 5, interval: 5.2, pass: 4, raises: STATS_AT(0.85, ['output', 'precision', 'control', 'range', 'speed', 'efficiency', 'activation']),
    rules: { lanes: [0, 1, 2, 3], lead: 1.6, speed: 3.4, counts: LET_GO, pair: false, lines: [] } },
  { name: 'Web', count: 4, interval: 6.5, pass: 3, raises: STATS_AT(1, ['output', 'precision', 'control', 'range', 'speed', 'efficiency', 'activation', 'tolerance']),
    rules: { lanes: [0, 1, 2, 3], lead: 1.8, speed: 3.0, counts: LET_GO, pair: true, lines: ['Two at once. One release must take both.'] } },
];

const rulesOf = (tier: DrillTier): Rules => (tier as DrillTier & { rules?: Rules }).rules ?? TIERS[0]!.rules;
const world = (p: [number, number]) => C.clone().add(new THREE.Vector3(p[0], 0, p[1]));

// The stake and its coil, standing where the drill begins, raised the first
// time Tension is in hand.
let station: THREE.Object3D | null = null;
export function standStation(g: Game): void {
  if (station) return;
  const o = new THREE.Group();
  const wood = toon(0x4e3024), rope = toon(0xc9a46a), line = toon(0xff5fa2);
  const stake = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.1, 8), wood);
  stake.position.y = 0.55;
  const coil = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.045, 6, 18), rope);
  coil.position.y = 0.78;
  coil.rotation.x = Math.PI / 2;
  const tag = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.02, 4, 18), line);
  tag.position.y = 0.86;
  tag.rotation.x = Math.PI / 2;
  for (const m of [stake, coil, tag]) { m.castShadow = true; o.add(m); }
  o.position.copy(STATION);
  o.position.y = g.physics.standingY(STATION.x, STATION.z, 0) ?? 0;
  o.userData.keep = true;
  g.renderer.scene.add(o);
  station = o;
}

// A lane marked on the sand: a pale stroke with a point at the far end.
function laneMark(g: Game, from: THREE.Vector3, to: THREE.Vector3): THREE.Mesh {
  const d = to.clone().sub(from);
  const len = d.length();
  const shape = new THREE.Shape();
  shape.moveTo(0, -0.09); shape.lineTo(len - 0.6, -0.09); shape.lineTo(len - 0.6, -0.3); shape.lineTo(len, 0);
  shape.lineTo(len - 0.6, 0.3); shape.lineTo(len - 0.6, 0.09); shape.lineTo(0, 0.09); shape.closePath();
  const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: MARK, transparent: true, opacity: 0, depthWrite: false }));
  m.rotation.set(-Math.PI / 2, 0, Math.atan2(-d.z, d.x));
  m.position.copy(from).setY(0.06);
  g.renderer.scene.add(m);
  return m;
}

interface Runner { e: Enemy | null; from: THREE.Vector3; to: THREE.Vector3; mark: THREE.Mesh; caught: number }
let live: Runner[] = [];
// What the debug hook reports, so a check can lay lines across the lanes.
export let lanesView: () => { station: number[]; runners: { lane: number[][]; at: number[] | null; caught: number }[] } = () => ({ station: STATION.toArray(), runners: [] });

export const snareLanes: DrillDef = {
  id: 'tension-lanes', technique: 'tension', title: 'Snare Lanes', jp: '罠線',
  brief: 'Straw runners cross the ground. Catch each with a line.',
  howTo: (tier) => {
    const r = rulesOf(tier);
    const first = [`A lane marks the sand before each runner. ${cap(keyLabel('primary'))} strings a line across it; a set line trips what runs into it.`];
    if (r.counts === LET_GO) first.push(`Only a line let go counts: hold ${keyLabel('secondary')} to draw, let go as it crosses.`);
    return [...first, ...TIERS.slice(0, TIERS.findIndex((t) => t.rules === r) + 1).flatMap((t) => t.rules.lines)];
  },
  cue: () => (live.some((r) => r.e && !r.caught) ? 'Runner' : live.length ? 'A lane' : 'Watch the sand'),
  position: [STATION.x, STATION.y, STATION.z],
  tiers: TIERS,
  hold(g) { standStation(g); },
  end(g) {
    for (const r of live) dispose(g, r);
    live = [];
  },
  spawn(g, tier): DrillItem {
    const rules = rulesOf(tier);
    const lanes = rules.pair ? PAIRS[Math.floor(Math.random() * PAIRS.length)]! : [rules.lanes[Math.floor(Math.random() * rules.lanes.length)]!];
    const runners: Runner[] = lanes.map((i) => {
      const [a, b] = LANES[i]!;
      const from = world(a), to = world(b);
      return { e: null, from, to, mark: laneMark(g, from, to), caught: 0 };
    });
    live.push(...runners);
    let t = 0;
    const travel = Math.max(...runners.map((r) => r.from.distanceTo(r.to))) / rules.speed;
    // A runner is caught by a line event this tier counts. A pair is caught
    // only when one release takes both.
    const listen = (kind: LineEvent, e: Enemy, release: number) => {
      const r = runners.find((x) => x.e === e);
      if (!r || r.caught || !rules.counts.includes(kind)) return;
      r.caught = release || -1;
    };
    lineEvents.add(listen);
    lanesView = () => ({ station: STATION.toArray(), runners: live.map((r) => ({ lane: [r.from.toArray(), r.to.toArray()], at: r.e ? r.e.position.toArray() : null, caught: r.caught })) });
    const done = (pts: number): number => {
      lineEvents.delete(listen);
      for (const r of runners) {
        if (r.e && r.caught) { g.vfx.burst(r.e.center(), 10, 'debris', 4, 0xd8bf86); g.vfx.ring(r.e.position.clone().setY(0.08), 0xffd27a, 0.3, 1.8, 0.4); }
        dispose(g, r);
      }
      live = live.filter((r) => !runners.includes(r));
      return pts;
    };
    return {
      update: (dt) => {
        t += dt;
        for (const r of runners) {
          (r.mark.material as THREE.MeshBasicMaterial).opacity = Math.min(0.75, t * 2) * (r.caught ? 0.3 : 1);
          if (!r.e && t >= rules.lead) {
            r.e = g.encounters.spawn('dummy', r.from.clone());
            g.audio.play('drill.cue', { at: r.from, pitch: 1.3 });
          }
          const e = r.e;
          if (!e || r.caught || e.frozen > 0) continue;
          const dir = r.to.clone().sub(e.position).setY(0);
          if (dir.length() < 0.5) continue;
          dir.normalize();
          e.yaw = Math.atan2(-dir.x, -dir.z);
          e.velocity.x = dir.x * rules.speed * DRIVE;
          e.velocity.z = dir.z * rules.speed * DRIVE;
        }
        const caught = runners.filter((r) => r.caught);
        if (rules.pair) {
          if (caught.length === 2) return done(caught[0]!.caught > 0 && caught[0]!.caught === caught[1]!.caught ? 1 : 0);
        } else if (caught.length) return done(1);
        const arrived = runners.some((r) => r.e && !r.caught && Math.hypot(r.e.position.x - r.to.x, r.e.position.z - r.to.z) < 0.6);
        if (arrived || t > rules.lead + travel * 1.6 + 2) return done(0);
        return null;
      },
      dispose: () => { lineEvents.delete(listen); for (const r of runners) dispose(g, r); live = live.filter((r) => !runners.includes(r)); },
    };
  },
};

function dispose(g: Game, r: Runner): void {
  if (r.e && !r.e.disposed) { r.e.alive = false; r.e.dispose(); }
  r.e = null;
  if (r.mark.parent) { g.renderer.scene.remove(r.mark); r.mark.geometry.dispose(); (r.mark.material as THREE.Material).dispose(); }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
