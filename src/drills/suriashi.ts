import * as THREE from 'three';
import type { Game } from '../app/game';
import type { DrillDef, DrillItem, DrillTier } from './drills';
import { keyLabel, keyPhrase } from '../app/keymap';

// Suriashi (摺り足), Friction's drill: sliding feet on the hall's polished
// boards. A mark is chalked a few strides off; the student lets the soles go
// (Slip), rides the slide there and stops it dead (Open Hand) so the body
// comes to rest inside it. A slide has no brakes, so the stop is the whole
// skill: Open Hand takes a moment to land, and the boards carry the body on
// until it does. Only the first rest after a slide is judged, so there is one
// push and one stop: no creeping in. What it tests is control, the one stat that
// steers a slide (src/techniques/kits/friction.ts), and each tier raises it:
//   Glide      stop inside a wide mark                      control
//   No Steps   every metre slid, not walked; a smaller mark + precision
//   Dead Stop  a small far mark, at rest inside 2.4 s       + efficiency
// A tier raises its stats to a level (`raises`), so clearing it again adds nothing.

// Where the student begins it: the hall's south-west corner, clear of the
// Architect's desk. The marks are chalked anywhere on the open boards.
const STATION = new THREE.Vector3(-11.4, 0.3, -7.4);
const FLOOR = { x0: -12.2, x1: 12.4, z0: -15.2, z1: -6.2, y: 0.3 };
const CHALK = 0xf4efe4;
const LIT = 0xe0a96d;
const GOOD = 0xffd27a;
const BAD = 0xff5a4a;
// A body this slow on its feet has come to rest.
const AT_REST = 0.25;

interface Rules { radius: number; near: number; far: number; noSteps: boolean; within: number | null; lines: string[] }
type Tier = DrillTier & { rules: Rules };

const TIERS: Tier[] = [
  { name: 'Glide', count: 4, interval: 7, pass: 3, window: 6.5, raises: { control: 0.55 },
    rules: { radius: 1.3, near: 6, far: 8, noSteps: false, within: null, lines: [] } },
  { name: 'No Steps', count: 4, interval: 7, pass: 3, window: 6.5, raises: { control: 0.75, precision: 0.7 },
    rules: { radius: 1.0, near: 7, far: 10, noSteps: true, within: null, lines: ['No steps: once the mark is chalked, every metre is slid.'] } },
  { name: 'Dead Stop', count: 5, interval: 6, pass: 4, window: 5.5, raises: { control: 1, precision: 0.85, efficiency: 0.85 },
    rules: { radius: 0.75, near: 9, far: 12, noSteps: true, within: 2.4, lines: ['A small mark, far off. Be at rest on it within two and a half seconds of the push.'] } },
];

function flat(geo: THREE.BufferGeometry, color: number, opacity: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  return m;
}

// The chalk the drill draws, built the first time it is needed.
let chalk: { station: THREE.Group; ring: THREE.Mesh; fill: THREE.Mesh } | null = null;
function ensure(game: Game): NonNullable<typeof chalk> {
  if (chalk) return chalk;
  const station = new THREE.Group();
  const circle = flat(new THREE.RingGeometry(0.5, 0.58, 40), CHALK, 0.75);
  const line = flat(new THREE.PlaneGeometry(0.08, 1.3), CHALK, 0.6);
  line.position.set(0.95, 0, 0);
  line.rotation.z = Math.PI / 2;
  station.add(circle, line);
  station.position.set(STATION.x, FLOOR.y + 0.012, STATION.z);
  station.visible = false;
  const ring = flat(new THREE.RingGeometry(0.92, 1, 56), CHALK, 0.9);
  const fill = flat(new THREE.CircleGeometry(0.92, 48), LIT, 0.28);
  for (const m of [ring, fill]) m.visible = false;
  game.renderer.scene.add(station, ring, fill);
  chalk = { station, ring, fill };
  return chalk;
}

// The station's chalk shows while Friction is in hand (the kit's passive asks for it).
export function showStation(game: Game, on: boolean): void {
  if (!on && !chalk) return;
  ensure(game).station.visible = on;
}

// Where to chalk the next mark: `near` to `far` metres from the student, on the open boards.
function markFrom(from: THREE.Vector3, r: Rules): THREE.Vector3 {
  for (let i = 0; i < 60; i++) {
    const a = Math.random() * Math.PI * 2, d = r.near + Math.random() * (r.far - r.near);
    const x = from.x + Math.sin(a) * d, z = from.z + Math.cos(a) * d;
    if (x > FLOOR.x0 + r.radius && x < FLOOR.x1 - r.radius && z > FLOOR.z0 + r.radius && z < FLOOR.z1 - r.radius) return new THREE.Vector3(x, FLOOR.y, z);
  }
  return new THREE.Vector3((FLOOR.x0 + FLOOR.x1) / 2, FLOOR.y, (FLOOR.z0 + FLOOR.z1) / 2);
}

let current: { at: THREE.Vector3; radius: number; slid: boolean } | null = null;

export const suriashi: DrillDef = {
  id: 'friction-suriashi', technique: 'friction', title: 'Suriashi', jp: '摺り足',
  brief: 'Slide to the chalk mark and stop dead inside it.',
  howTo: (tier) => {
    const r = (tier as Tier).rules ?? TIERS[0]!.rules;
    return [
      'A mark is chalked on the boards. Slide to it and come to rest inside it.',
      `${keyLabel('secondary')} pushes off; ${keyPhrase('art1')} stops you dead. Only the first stop counts.`,
      ...TIERS.slice(0, TIERS.findIndex((t) => t.rules === r) + 1).flatMap((t) => t.rules.lines),
    ];
  },
  cue: () => (!current ? 'Wait for the mark' : current.slid ? 'Stop on it' : 'Slide'),
  position: [STATION.x, STATION.y, STATION.z],
  tiers: TIERS,
  end() {
    current = null;
    if (chalk) chalk.ring.visible = chalk.fill.visible = false;
  },
  spawn(game, tier): DrillItem {
    const rules = (tier as Tier).rules;
    const c = ensure(game);
    const at = markFrom(game.player.position, rules);
    const item = { at, radius: rules.radius, slid: false };
    current = item;
    c.ring.scale.setScalar(rules.radius);
    c.fill.scale.setScalar(rules.radius);
    c.ring.position.set(at.x, FLOOR.y + 0.014, at.z);
    c.fill.position.set(at.x, FLOOR.y + 0.012, at.z);
    (c.fill.material as THREE.MeshBasicMaterial).opacity = 0.28;
    c.ring.visible = c.fill.visible = true;
    game.vfx.ring(at.clone().setY(FLOOR.y + 0.05), CHALK, rules.radius * 1.6, rules.radius, 0.35);
    let t = 0, pushedAt = 0;
    const done = (pts: number): number => {
      game.vfx.ring(at.clone().setY(FLOOR.y + 0.06), pts > 0 ? GOOD : BAD, rules.radius * 0.6, rules.radius * (pts > 0 ? 2.4 : 1.3), 0.45);
      if (current === item) { current = null; c.ring.visible = c.fill.visible = false; }
      return pts;
    };
    return Object.assign({
      update: (dt: number) => {
        const p = game.player;
        const speed = p.planarSpeed.value;
        const sliding = p.footing.kind === 'slide';
        t += dt;
        // The mark brightens as the student closes on it.
        const near = Math.hypot(p.position.x - at.x, p.position.z - at.z);
        (c.fill.material as THREE.MeshBasicMaterial).opacity = 0.2 + 0.4 * Math.max(0, 1 - near / (rules.radius * 4));
        if (sliding && speed > 3 && !item.slid) { item.slid = true; pushedAt = t; }
        if (rules.noSteps && !sliding && p.grounded && p.wish.lengthSq() > 0.01 && speed > 0.6) return done(0);
        if (item.slid && !sliding && p.grounded && speed < AT_REST) {
          const inside = near <= rules.radius && (rules.within === null || t - pushedAt <= rules.within);
          return done(inside ? 1 : 0);
        }
        if (t >= (tier.window ?? 6)) return done(0);
        return null;
      },
      dispose: () => { if (current === item) { current = null; c.ring.visible = c.fill.visible = false; } },
    }, { mark: item });
  },
};
