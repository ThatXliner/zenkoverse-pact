import * as THREE from 'three';
import type { Game } from '../app/game';
import type { DrillDef, DrillItem, DrillTier } from './drills';
import type { PropInstance } from '../world/props';
import type { Enemy } from '../combat/enemies';
import { keyLabel } from '../app/keymap';
import { summonedStrike } from '../techniques/kits/dark';

// Kaeshi (返し), Dark Dimension's drill, at the storehouse door. Crates are
// pitched out of the dark doorway at the student. A crate sealed in the air
// keeps the speed and the heading it had, so the skill is twofold: taking a
// thing in flight before it lands, and then placing the exit so its own
// heading carries it into the mark. Nothing in the drill aims for the
// student: the crate goes where it was going. Each tier raises a level:
//   Catch    seal a pitched crate before it lands         activation, speed
//   Return   send it into the straw figure on its own way  + control, precision
//   Ledger   two crates, both into the figure              + control to 1, efficiency, range

const STATION = new THREE.Vector3(12.6, 0, -0.6);
const DOOR = new THREE.Vector3(17.0, 1.5, -5.0);
// Where the straw figure may stand: open paving west of the mark, clear of
// the stone lanterns and the posts south of it.
const FIGURES = [new THREE.Vector3(8.0, 0, -2.2), new THREE.Vector3(8.2, 0, 1.0), new THREE.Vector3(9.8, 0, -2.0), new THREE.Vector3(6.8, 0, 2.2)];
const CHALK = 0xf4efe4;
const LIT = 0x5b6cff;
const GOOD = 0xffd27a;
const BAD = 0xff5a4a;

interface Rules { figure: boolean; crates: number; lines: string[] }
type Tier = DrillTier & { rules: Rules };

const TIERS: Tier[] = [
  { name: 'Catch', count: 4, interval: 4.5, pass: 3, window: 3.2, raises: { activation: 0.55, speed: 0.55 },
    rules: { figure: false, crates: 1, lines: [] } },
  { name: 'Return', count: 4, interval: 9, pass: 3, window: 8.5, raises: { control: 0.7, precision: 0.7 },
    rules: { figure: true, crates: 1, lines: ['Then let it out so its own heading carries it into the straw figure.'] } },
  { name: 'Ledger', count: 3, interval: 11, pass: 2, window: 10.5, raises: { control: 1, efficiency: 0.85, range: 0.85 },
    rules: { figure: true, crates: 2, lines: ['Two crates, one after the other. Both must strike the figure.'] } },
];

function flat(geo: THREE.BufferGeometry, color: number, opacity: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  return m;
}

// The chalk the drill draws, built the first time it is needed.
let chalk: { station: THREE.Group; ring: THREE.Mesh } | null = null;
function ensure(game: Game): NonNullable<typeof chalk> {
  if (chalk) return chalk;
  const station = new THREE.Group();
  station.add(flat(new THREE.RingGeometry(0.5, 0.58, 40), CHALK, 0.75));
  // A line pointing at the door the crates come from.
  const toDoor = DOOR.clone().sub(STATION).setY(0).normalize();
  const line = flat(new THREE.PlaneGeometry(1.3, 0.08), CHALK, 0.6);
  line.position.set(toDoor.x * 1.0, 0, toDoor.z * 1.0);
  line.rotation.z = Math.atan2(-toDoor.z, toDoor.x);
  station.add(line);
  station.position.set(STATION.x, 0.012, STATION.z);
  station.visible = false;
  const ring = flat(new THREE.RingGeometry(0.85, 1, 48), LIT, 0.85);
  ring.visible = false;
  game.renderer.scene.add(station, ring);
  chalk = { station, ring };
  return chalk;
}

// The station's chalk shows while Dark Dimension is in hand (the kit's passive asks for it).
export function showStation(game: Game, on: boolean): void {
  if (!on && !chalk) return;
  ensure(game).station.visible = on;
}

// Every crate the drill has pitched, put away when it ends (sealed ones too).
let crates: PropInstance[] = [];
let figure: Enemy | null = null;
let current: { crates: PropInstance[]; caught: number; struck: number } | null = null;

// A crate out of the doorway, on an arc that would land at the student's feet.
function pitch(g: Game): PropInstance {
  const p = g.props.spawn('crate', DOOR.clone().add(new THREE.Vector3(0, -0.5, (Math.random() - 0.5) * 1.2)));
  const from = p.mesh.position.clone();
  const to = g.player.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.2, 0.6, (Math.random() - 0.5) * 1.2));
  const t = 1.0 + Math.random() * 0.2;
  const v = to.sub(from).divideScalar(t);
  v.y += 0.5 * 9.81 * t;
  g.props.launch(p, v);
  p.body.setAngvel({ x: (Math.random() - 0.5) * 4, y: (Math.random() - 0.5) * 4, z: (Math.random() - 0.5) * 4 }, true);
  g.vfx.ring(from.clone(), CHALK, 0.3, 1.2, 0.3, v.clone().normalize());
  g.audio.play('friction.throw', { at: from, pitch: 0.8 });
  crates.push(p);
  while (crates.length > 8) { const old = crates.shift()!; if (!current?.crates.includes(old)) g.props.remove(old); }
  return p;
}

function placeFigure(g: Game): Enemy {
  figure?.dispose();
  const at = FIGURES[Math.floor(Math.random() * FIGURES.length)]!.clone();
  const e = g.encounters.spawn('dummy', at);
  e.yaw = Math.atan2(-(STATION.x - at.x), -(STATION.z - at.z));
  const c = ensure(g);
  c.ring.position.set(at.x, 0.04, at.z);
  c.ring.visible = true;
  figure = e;
  return e;
}

function clearFigure(): void {
  if (figure) { figure.alive = false; figure.dispose(); }
  figure = null;
  if (chalk) chalk.ring.visible = false;
}

export let kaeshiView: () => { station: number[]; door: number[]; figure: number[] | null; crates: number[]; caught: number; struck: number } = () => ({ station: STATION.toArray(), door: DOOR.toArray(), figure: null, crates: [], caught: 0, struck: 0 });

export const kaeshi: DrillDef = {
  id: 'dark-kaeshi', technique: 'dark', title: 'Kaeshi', jp: '返し',
  brief: 'Seal the pitched crate out of the air.',
  howTo: (tier) => {
    const r = (tier as Tier).rules ?? TIERS[0]!.rules;
    return [
      'Crates come out of the storehouse door at you. Seal each one before it lands.',
      `${keyLabel('primary')} seals what you aim at; ${keyLabel('secondary')} lets the last thing out where you aim.`,
      ...TIERS.slice(0, TIERS.findIndex((t) => t.rules === r) + 1).flatMap((t) => t.rules.lines),
    ];
  },
  cue: () => (!current ? 'Watch the door' : current.caught < current.crates.length ? 'Seal it' : figure ? 'Send it back' : ''),
  position: [STATION.x, STATION.y, STATION.z],
  tiers: TIERS,
  end(g) {
    clearFigure();
    for (const p of crates) g.props.remove(p);
    crates = [];
    current = null;
  },
  spawn(game, tier): DrillItem {
    const rules = (tier as Tier).rules;
    const item = { crates: [] as PropInstance[], caught: 0, struck: 0 };
    // The crates taken in flight: those are the student's now, wherever they land.
    const kept = new Set<PropInstance>();
    current = item;
    if (rules.figure) placeFigure(game);
    item.crates.push(pitch(game));
    if (rules.crates > 1) game.vfx.after(0.9, () => { if (current === item) item.crates.push(pitch(game)); });
    let t = 0;
    const done = (pts: number): number => {
      const at = figure?.position ?? game.player.position;
      game.vfx.ring(at.clone().add(new THREE.Vector3(0, 0.06, 0)), pts > 0 ? GOOD : BAD, 0.5, pts > 0 ? 2.4 : 1.3, 0.45);
      if (current === item) { current = null; clearFigure(); }
      return pts;
    };
    kaeshiView = () => ({ station: STATION.toArray(), door: DOOR.toArray(), figure: figure ? figure.position.toArray() : null, crates: item.crates.map((p) => p.id), caught: item.caught, struck: item.struck });
    return {
      update: (dt) => {
        t += dt;
        // A crate that reached the ground unsealed was not caught.
        for (const p of item.crates) {
          if (p.sealed || !p.alive || t < 0.35) continue;
          const v = p.body.linvel();
          const landed = p.mesh.position.y < p.half.y + 0.25 && Math.abs(v.y) < 1.5;
          if (landed && !kept.has(p)) return done(0);
        }
        if (!rules.figure && item.caught >= rules.crates) return done(1);
        if (rules.figure && item.struck >= rules.crates) return done(1);
        if (t >= (tier.window ?? 4)) return done(0);
        return null;
      },
      notify: (prop, event) => {
        if (event !== 'caught' || !item.crates.includes(prop)) return null;
        // Taken in flight: it went in still moving.
        if ((prop.sealed?.vel.length() ?? 0) < 2) return null;
        if (kept.has(prop)) return null;
        kept.add(prop);
        item.caught++;
        game.vfx.ring(prop.mesh.position.clone(), GOOD, 0.3, 1.4, 0.3);
        if (!rules.figure && item.caught >= rules.crates) return done(1);
        return null;
      },
      struck: (e) => {
        if (!rules.figure || e !== figure || !summonedStrike()) return null;
        item.struck++;
        if (item.struck >= rules.crates) return done(1);
        return null;
      },
      dispose: () => { if (current === item) { current = null; clearFigure(); } },
    };
  },
};
