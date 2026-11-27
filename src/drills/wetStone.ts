import * as THREE from 'three';
import type { Game } from '../app/game';
import type { DrillDef, DrillItem, DrillTier } from './drills';
import type { Enemy } from '../combat/enemies';
import type { PropInstance } from '../world/props';
import type { MasteryStat } from '../mastery/mastery';
import { keyLabel } from '../app/keymap';
import { POND } from '../world/compound';
import { electroState } from '../techniques/kits/electro';

// Wet Stone (濡れ石), Electro's drill at the koi pond. Straw figures stand
// in the water and on the paving, an iron pot beside each dry one. One
// figure lights at a time; a discharge has to reach it. What it teaches is
// where a current goes: a touch, metal, water, and that water takes
// everyone standing in it, the caster too. Each tier adds a rule:
//   Contact      reach the lit figure, by any route          output, activation, range
//   Clean Line   only the lit one, and not through yourself   + precision, control
//   Caught Blow  no charge but a falling crate's, converted   + speed, tolerance, efficiency
// A tier raises its stats to a level, so clearing it again adds nothing.

const LIT = 0xffe45c;
const DARK = 0x6b5848;
const GOOD = 0xffd27a;
const BAD = 0xff5a4a;
// A blow settles this long after it lands, so a current that ran on to a
// dark figure after the lit one is counted with it.
const SETTLE = 0.3;
const CRATE_HEIGHT = 6;

// Where the student stands to begin, on the open paving north of the pond.
const STATION = new THREE.Vector3(POND.center.x, 0, POND.center.z - 5.4);
// The figures: two in the water (the second only in Contact), two on the
// paving either side of the station, each with a pot between it and the station.
const FLOOR = POND.floorY;
const WATER = [new THREE.Vector3(POND.center.x + 0.9, FLOOR, POND.center.z - 0.7), new THREE.Vector3(POND.center.x - 1.3, FLOOR, POND.center.z + 0.9)];
const DRY = [new THREE.Vector3(POND.center.x + 3.9, 0, POND.center.z - 5.9), new THREE.Vector3(POND.center.x - 3.9, 0, POND.center.z - 5.9)];
const POTS = [new THREE.Vector3(POND.center.x + 2.3, 0, POND.center.z - 5.9), new THREE.Vector3(POND.center.x - 2.3, 0, POND.center.z - 5.9)];

interface Rules { clean: boolean; crate: boolean; water: number; window: number; lines: string[] }

const AT = (level: number, stats: MasteryStat[]): Partial<Record<MasteryStat, number>> => Object.fromEntries(stats.map((s) => [s, level]));
const TIERS: (DrillTier & { rules: Rules })[] = [
  { name: 'Contact', count: 3, interval: 7.5, pass: 2, raises: AT(0.55, ['output', 'activation', 'range']), rules: { clean: false, crate: false, water: 2, window: 7, lines: [] } },
  {
    name: 'Clean Line', count: 4, interval: 6.5, pass: 3, raises: AT(0.7, ['output', 'activation', 'range', 'precision', 'control']),
    rules: { clean: true, crate: false, water: 1, window: 6, lines: ['Only the lit one. A current that reaches a dark one, or runs through you, spoils the mark.'] },
  },
  {
    name: 'Caught Blow', count: 4, interval: 7.5, pass: 3, raises: AT(0.85, ['output', 'activation', 'range', 'precision', 'control', 'speed', 'tolerance', 'efficiency']),
    rules: { clean: true, crate: true, water: 1, window: 7, lines: ['You start with no Charge. Take it from the falling crate, then strike. Your own body does not count.'] },
  },
];
const rulesOf = (tier: DrillTier): Rules => (tier as DrillTier & { rules?: Rules }).rules ?? TIERS[0]!.rules;

function pad(r0: number, r1: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 40), new THREE.MeshBasicMaterial({ color: DARK, transparent: true, opacity: 0.7, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  return m;
}

// The drill's world: the figures, the pots and the rings under each figure,
// made when the drill starts and taken away when it ends.
interface Station { group: THREE.Group; figures: Enemy[]; spots: THREE.Vector3[]; rings: THREE.Mesh[]; pots: PropInstance[] }
let station: Station | null = null;
let current: { lit: number; t: number } | null = null;
let lastLit = -1;

function build(g: Game, water: number): Station {
  const group = new THREE.Group();
  const spots = [...WATER.slice(0, water), ...DRY];
  const figures = spots.map((s) => {
    const e = g.encounters.spawn('dummy', s.clone());
    e.yaw = Math.atan2(-(STATION.x - s.x), -(STATION.z - s.z));
    return e;
  });
  const rings = spots.map((s) => {
    const r = pad(0.6, 0.74);
    r.position.set(s.x, s.y < 0 ? POND.surfaceY + 0.02 : 0.035, s.z);
    group.add(r);
    return r;
  });
  const mark = pad(0.42, 0.5);
  mark.position.set(STATION.x, 0.035, STATION.z);
  group.add(mark);
  g.renderer.scene.add(group);
  const pots = POTS.map((p) => g.props.spawn('pot', p.clone()));
  return { group, figures, spots, rings, pots };
}

function teardown(g: Game): void {
  const s = station;
  if (!s) return;
  for (const e of s.figures) { e.alive = false; e.dispose(); }
  for (const p of s.pots) g.props.remove(p);
  g.renderer.scene.remove(s.group);
  s.group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } });
  station = null;
  current = null;
}

function paint(i: number, color: number, opacity: number): void {
  const m = station?.rings[i]?.material as THREE.MeshBasicMaterial | undefined;
  if (m) { m.color.setHex(color); m.opacity = opacity; }
}

// The pots go back where they stood before each figure lights.
function resetPots(): void {
  for (const [i, p] of (station?.pots ?? []).entries()) {
    if (!p.alive) continue;
    const at = POTS[i]!;
    p.body.setTranslation({ x: at.x, y: at.y + p.half.y, z: at.z }, true);
    p.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    p.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    p.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
  }
}

export const wetStone: DrillDef = {
  id: 'electro-wet-stone', technique: 'electro', title: 'Wet Stone', jp: '濡れ石',
  brief: 'One straw figure lights at a time. Reach it with a discharge.',
  howTo: (tier) => {
    const r = rulesOf(tier);
    return ['One straw figure lights at a time. Reach it with a discharge.', `${keyLabel('secondary')} runs a discharge to where you aim. Metal and water carry it on.`, ...TIERS.slice(0, TIERS.findIndex((t) => t.rules === r) + 1).flatMap((t) => t.rules.lines)];
  },
  cue: () => (current ? 'Strike' : 'Watch the figures'),
  position: [STATION.x, STATION.y, STATION.z],
  tiers: TIERS,
  hold(g) {
    const tier = g.drills.reached('electro-wet-stone');
    const water = rulesOf(TIERS[Math.min(tier, TIERS.length - 1)]!).water;
    if (!station || station.figures.some((e) => e.disposed) || station.figures.length !== water + DRY.length) { teardown(g); station = build(g, water); }
  },
  end(g) { teardown(g); },
  spawn(g, tier): DrillItem {
    const rules = rulesOf(tier);
    const s = station!;
    const choices = s.figures.map((_, i) => i).filter((i) => i !== lastLit);
    const lit = choices[Math.floor(Math.random() * choices.length)]!;
    lastLit = lit;
    const item = { lit, t: 0 };
    current = item;
    for (let i = 0; i < s.rings.length; i++) paint(i, i === lit ? LIT : DARK, i === lit ? 0.95 : 0.6);
    resetPots();
    const t0 = g.clock.time;
    const res = g.techniques;
    // Contact and Clean Line hand the student a charge to spend; Caught Blow
    // takes it all and drops a crate to take it back from.
    if (rules.crate) {
      res.resource = 0;
      const dir = g.cam.aimDirection().setY(0);
      if (dir.lengthSq() < 1e-4) dir.set(0, 0, -1);
      const at = g.player.position.clone().addScaledVector(dir.normalize(), 2.2).setY(g.player.position.y + CRATE_HEIGHT);
      const crate = g.props.spawn('crate', at);
      crate.body.setLinvel({ x: 0, y: -1.5, z: 0 }, true);
      g.audio.play('prop.drop', { at });
      g.vfx.until(rules.window, () => g.props.remove(crate));
    } else res.resource = Math.max(res.resource, 0.6 * res.def.resource.max);
    let hitLit = false, hitDark = false, hitAt = -1;
    const done = (pts: number): number => {
      const at = s.spots[lit]!;
      g.vfx.ring(new THREE.Vector3(at.x, at.y < 0 ? POND.surfaceY + 0.05 : 0.06, at.z), pts > 0 ? GOOD : BAD, 0.4, pts > 0 ? 2.6 : 1.4, 0.4);
      paint(lit, DARK, 0.6);
      if (current === item) current = null;
      return pts;
    };
    return {
      update: (dt) => {
        item.t += dt;
        const through = electroState.backlashAt > t0;
        if (rules.crate && electroState.suppliedAt > t0) return done(0);
        if (hitAt >= 0 && item.t - hitAt >= SETTLE) {
          if (rules.clean && (hitDark || through)) return done(0);
          // Caught Blow counts only a strike made with the crate's energy.
          if (hitLit) return done(rules.crate && electroState.convertedAt <= t0 ? 0 : 1);
          hitAt = -1;
        }
        if (item.t >= rules.window) return done(0);
        return null;
      },
      struck: (e) => {
        const i = s.figures.indexOf(e);
        if (i < 0) return null;
        if (i === lit) hitLit = true; else hitDark = true;
        if (hitAt < 0) hitAt = item.t;
        return null;
      },
      dispose: () => { if (current === item) current = null; },
    };
  },
};

// What the debug hook reports, so a check can find the lit figure and the pots.
export function wetStoneView(): { lit: number; spots: number[][]; pots: number[][]; station: number[] } {
  return {
    lit: current?.lit ?? -1,
    spots: (station?.spots ?? []).map((p) => [p.x, p.y, p.z]),
    pots: (station?.pots ?? []).map((p) => [p.mesh.position.x, p.mesh.position.y, p.mesh.position.z]),
    station: [STATION.x, STATION.y, STATION.z],
  };
}
