import * as THREE from 'three';
import type { Game } from '../app/game';
import type { DrillDef, DrillItem, DrillTier } from './drills';
import { keyLabel, keyPhrase } from '../app/keymap';
import { toon } from '../render/materials';
import { HALL } from '../world/compound';
import { vapour } from '../techniques/kits/fuelVapour';

// Dōkasen (導火線, the fuse), Fuel's drill, at the stone lantern on the east
// side of the hall steps. Straw posts are set out in the yard; the student
// lays vapour out to them and brings it to the lantern's flame, and the fire
// runs back along it. The student cannot light anything: the lantern does,
// the moment dense enough vapour climbs to it. So the order is the skill.
// Touch the flame before the trail reaches the posts and it burns out short;
// leave a gap or let it thin and the fire stops there; outdoors the breeze
// carries it. Each tier raises Control, the stat that holds vapour where it
// is put and herds it fast (src/techniques/kits/fuelVapour.ts):
//   Thread  one post                                         control, range
//   Fork    two posts, one fire must reach both              + precision, efficiency
//   Spare   two posts and a white one between that must not burn  all of them higher
// A tier raises its stats to a level (`raises`), so clearing it again adds nothing.

const LANTERN = new THREE.Vector3(4.6, 0, HALL.z1 + 2.2);
const STATION = new THREE.Vector3(6.6, 0, LANTERN.z + 0.4);
// Where posts may stand: the flagstones east of the steps, clear of the pond.
const YARD = { x0: 6.5, x1: 15.5, z0: -1.5, z1: 7.2 };
const STRAW = 0xd8c27a, ROPE = 0x7a5a32, POLE = 0x5a3f2a, PAPER = 0xf2efe6, BAND = 0xc8402f, CHAR = 0x2a2420;
const GOOD = 0xffd27a, BAD = 0xff5a4a;
// A post burns when a burning puff comes this close.
const CATCH = 0.75;

interface Rules { posts: number; keeper: boolean; near: number; far: number; lines: string[] }
type Tier = DrillTier & { rules: Rules };

const TIERS: Tier[] = [
  { name: 'Thread', count: 3, interval: 30, window: 28, pass: 2, paced: true, raises: { control: 0.55, range: 0.5 },
    rules: { posts: 1, keeper: false, near: 4.5, far: 6.5, lines: [] } },
  { name: 'Fork', count: 3, interval: 30, window: 28, pass: 2, paced: true, raises: { control: 0.75, range: 0.65, precision: 0.7, efficiency: 0.6 },
    rules: { posts: 2, keeper: false, near: 5, far: 8, lines: ['Two posts now. One fire has to reach both.'] } },
  { name: 'Spare', count: 4, interval: 30, window: 28, pass: 3, paced: true, raises: { control: 1, range: 0.8, precision: 0.85, efficiency: 0.85 },
    rules: { posts: 2, keeper: true, near: 5.5, far: 8.5, lines: ['The white post must not burn. Keep the vapour off it.'] } },
];

function post(color: number, band: number): THREE.Group {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 1.5, 6), toon(POLE));
  pole.position.y = 0.75;
  const bundle = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.75, 9), toon(color));
  bundle.position.y = 0.8;
  bundle.name = 'bundle';
  for (const y of [0.55, 1.05]) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.235, 0.235, 0.06, 9), toon(band)); r.position.y = y; g.add(r); }
  const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.25, 9), toon(color));
  tuft.position.y = 1.3;
  g.add(pole, bundle, tuft);
  for (const m of g.children) m.castShadow = true;
  return g;
}

let marker: THREE.Group | null = null;
// The station's straw bundle stands by the lantern while Fuel is in hand.
export function showStation(game: Game, on: boolean): void {
  if (!on && !marker) return;
  if (!marker) {
    marker = post(STRAW, ROPE);
    marker.scale.setScalar(0.7);
    marker.position.copy(STATION).add(new THREE.Vector3(0.5, 0, -0.6));
    game.renderer.scene.add(marker);
  }
  marker.visible = on;
}

function spot(from: THREE.Vector3, near: number, far: number, avoid: THREE.Vector3[]): THREE.Vector3 {
  for (let i = 0; i < 80; i++) {
    const a = Math.random() * Math.PI * 0.55 - 0.1, d = near + Math.random() * (far - near);
    const x = from.x + Math.cos(a) * d, z = from.z + Math.sin(a) * d;
    if (x < YARD.x0 || x > YARD.x1 || z < YARD.z0 || z > YARD.z1) continue;
    if (avoid.some((p) => Math.hypot(p.x - x, p.z - z) < 2.6)) continue;
    return new THREE.Vector3(x, 0, z);
  }
  return new THREE.Vector3(10 + avoid.length * 2, 0, 3);
}

interface Live { posts: { at: THREE.Vector3; mesh: THREE.Group; burnt: boolean }[]; keeper: { at: THREE.Vector3; mesh: THREE.Group; burnt: boolean } | null; lit: boolean; quiet: number }
let current: Live | null = null;
export let dokasenView = (): { lantern: number[]; posts: { at: number[]; burnt: boolean }[]; keeper: { at: number[]; burnt: boolean } | null } => ({ lantern: [LANTERN.x, 1.45, LANTERN.z], posts: [], keeper: null });

function remove(game: Game, l: Live, fade = 0): void {
  for (const p of [...l.posts, ...(l.keeper ? [l.keeper] : [])]) {
    if (fade > 0) game.vfx.until(fade, () => game.renderer.scene.remove(p.mesh));
    else game.renderer.scene.remove(p.mesh);
  }
}

export const dokasen: DrillDef = {
  id: 'fuel-dokasen', technique: 'fuel', title: 'Dōkasen', jp: '導火線',
  brief: 'Lay vapour to the straw posts and bring it to the lantern. The fire runs back along it.',
  howTo: (tier) => {
    const r = (tier as Tier).rules ?? TIERS[0]!.rules;
    return [
      'Straw posts stand in the yard. Lay vapour out to them, then bring it to the lantern: the fire comes back along it.',
      `${cap(keyLabel('primary'))} lays a trail. Hold ${keyPhrase('secondary')} to draw it together: only dense vapour climbs to the flame, and thin vapour carries no fire.`,
      ...TIERS.slice(0, TIERS.findIndex((t) => t.rules === r) + 1).flatMap((t) => t.rules.lines),
    ];
  },
  cue: () => (!current ? 'Wait for the posts' : current.lit ? 'Burning' : 'Lay it, then the lantern'),
  position: [STATION.x, STATION.y, STATION.z],
  tiers: TIERS,
  end(game) { if (current) { remove(game, current); current = null; } },
  spawn(game, tier): DrillItem {
    const rules = (tier as Tier).rules;
    const taken: THREE.Vector3[] = [LANTERN];
    const posts = Array.from({ length: rules.posts }, () => {
      const at = spot(LANTERN, rules.near, rules.far, taken);
      taken.push(at);
      return { at, mesh: post(STRAW, ROPE), burnt: false };
    });
    // The white post stands across the way to the first: the fire must go round it.
    let keeper: Live['keeper'] = null;
    if (rules.keeper) {
      const to = posts[0]!.at.clone().sub(LANTERN).setY(0);
      const at = LANTERN.clone().addScaledVector(to, 0.55).add(new THREE.Vector3(-to.z, 0, to.x).setLength(0.4));
      keeper = { at, mesh: post(PAPER, BAND), burnt: false };
    }
    for (const p of [...posts, ...(keeper ? [keeper] : [])]) {
      p.mesh.position.copy(p.at);
      game.renderer.scene.add(p.mesh);
      game.vfx.ring(p.at.clone().add(new THREE.Vector3(0, 0.05, 0)), p === keeper ? PAPER : STRAW, 1.4, 0.5, 0.35);
    }
    const item: Live = { posts, keeper, lit: false, quiet: 0 };
    current = item;
    dokasenView = () => ({ lantern: [LANTERN.x, 1.45, LANTERN.z], posts: posts.map((p) => ({ at: p.at.toArray(), burnt: p.burnt })), keeper: keeper ? { at: keeper.at.toArray(), burnt: keeper.burnt } : null });
    let t = 0;
    const char = (p: { at: THREE.Vector3; mesh: THREE.Group; burnt: boolean }): void => {
      p.burnt = true;
      const b = p.mesh.getObjectByName('bundle') as THREE.Mesh;
      b.material = toon(CHAR);
      game.vfx.flames(p.at.clone().add(new THREE.Vector3(0, 0.45, 0)), 0.25, 10, 1.4);
      game.vfx.flash(p.at.clone().add(new THREE.Vector3(0, 1, 0)), 0xff7a26, 20, 0.35, 6);
      game.audio.play('fuel.catch', { at: p.at, pitch: 1.2 });
    };
    const done = (pts: number): number => {
      for (const p of posts) game.vfx.ring(p.at.clone().add(new THREE.Vector3(0, 0.06, 0)), pts ? GOOD : BAD, 0.4, pts ? 2 : 1.2, 0.45);
      remove(game, item, pts ? 1.4 : 0.6);
      if (current === item) current = null;
      return pts;
    };
    return {
      update(dt) {
        t += dt;
        let burning = 0;
        for (const p of vapour.puffs) {
          if (p.burning < 0) continue;
          burning++;
          for (const q of [...posts, ...(keeper ? [keeper] : [])]) if (!q.burnt && Math.hypot(q.at.x - p.at.x, q.at.z - p.at.z) < CATCH + p.r * 0.6) char(q);
        }
        if (burning) { item.lit = true; item.quiet = 0; }
        if (keeper?.burnt) return done(0);
        if (posts.every((p) => p.burnt)) return item.lit && burning ? null : done(1);
        // The fire came and went, and a post still stands: it burned out short.
        if (item.lit && !burning && (item.quiet += dt) > 1.2) return done(0);
        if (t >= (tier.window ?? 28)) return done(0);
        return null;
      },
      dispose() { remove(game, item); if (current === item) current = null; },
    };
  },
};

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
