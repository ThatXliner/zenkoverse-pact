import * as THREE from 'three';
import type { Game } from '../app/game';
import type { DrillDef, DrillItem, DrillTier } from './drills';
import type { Enemy } from '../combat/enemies';
import type { MasteryStat } from '../mastery/mastery';
import { toon } from '../render/materials';
import { keyLabel } from '../app/keymap';
import { FIELD } from '../world/valleyPlan';

// The Striking Posts (巻藁), the drill for landing heavy blows well. Any
// Technique can run it; the gains go to the Technique in hand. Three posts
// stand round a mark, and one at a time a post lights. Only a signed blow
// counts: the full hand sign first, then the cast, on the lit post. Each tier
// adds one rule to the last, and each rule is a skill the tier pays for:
//   Weight     a signed blow on the lit post              output, activation
//   Footwork   close the distance in time, no dark post   + range, precision
//   Timing     as the ring closes, not before              + speed
//   One Breath every cast signed and landing               + efficiency, tolerance
// A tier raises its stats to a level (`raises`): clearing it again adds
// nothing, so the posts pay for the skill and not for the time spent.

// Where the drill stands, as one value so the station can move: the swept
// field beside the road just out of the gate (src/world/valleyPlan.ts). The
// posts stand round it; the player begins the drill from it.
const STATION = new THREE.Vector3(FIELD.x, 0, FIELD.z);
// Each post's distance from the mark, and their bearings (0 is north). The
// bell frame stands to the north, between them.
const POST_RADIUS = 3;
const BEARINGS = [Math.PI / 3, Math.PI, (5 * Math.PI) / 3];
// The closing ring starts this wide round the lit post.
const RING = 2.2;
// A blow counts for the cast that threw it this long after the cast.
const BLOW_AFTER_CAST = 1.5;
// A One Breath cast that has landed on nothing this long after it is wasted.
const WASTED_AFTER = 1.0;
const LIT = 0xff8a3d;
const GOOD = 0xffd27a;
const BAD = 0xff5a4a;
const PAD = 0x6b5848;

interface TierRules { clean: boolean; timing: { close: number; open: number } | null; strict: boolean; window: number; lines: string[] }

const STATS_AT = (level: number, stats: MasteryStat[]): Partial<Record<MasteryStat, number>> => Object.fromEntries(stats.map((s) => [s, level]));

// Tier levels: play alone fills a stat to the passive ceiling (0.4); each
// tier lifts the stats it tests past it, and One Breath to the top.
const TIERS: (DrillTier & { rules: TierRules })[] = [
  {
    name: 'Weight', count: 3, interval: 6.8, pass: 2, raises: STATS_AT(0.55, ['output', 'activation']),
    rules: { clean: false, timing: null, strict: false, window: 6.5, lines: [] },
  },
  {
    name: 'Footwork', count: 4, interval: 4.4, pass: 3, raises: STATS_AT(0.7, ['output', 'activation', 'range', 'precision']),
    rules: { clean: true, timing: null, strict: false, window: 4, lines: ['The posts light in turn, quicker now. Close the distance in time.', 'A blow on a dark post spoils the mark.'] },
  },
  {
    name: 'Timing', count: 4, interval: 4.4, pass: 3, raises: STATS_AT(0.85, ['output', 'activation', 'range', 'precision', 'speed']),
    rules: { clean: true, timing: { close: 2.2, open: 0.85 }, strict: false, window: 0, lines: ['Strike as the ring closes on the post, not before.'] },
  },
  {
    name: 'One Breath', count: 5, interval: 4.2, pass: 4, raises: STATS_AT(1, ['output', 'activation', 'range', 'precision', 'speed', 'efficiency', 'tolerance']),
    rules: { clean: true, timing: { close: 2.2, open: 0.7 }, strict: true, window: 0, lines: ['Every cast must be signed and must land.'] },
  },
];

function flat(geo: THREE.BufferGeometry, color: number, opacity: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  return m;
}

export function strikingPosts(game: Game): DrillDef {
  const spots = BEARINGS.map((a) => STATION.clone().add(new THREE.Vector3(Math.sin(a) * POST_RADIUS, 0, -Math.cos(a) * POST_RADIUS)));

  // The station at rest: a pad painted where each post will stand, the mark
  // in the middle, and a bell frame in the gap to the north.
  const station = new THREE.Group();
  const pads = spots.map((p) => {
    const pad = flat(new THREE.RingGeometry(0.72, 0.86, 40), PAD, 0.7);
    pad.position.set(p.x, 0.035, p.z);
    station.add(pad);
    return pad;
  });
  const mark = flat(new THREE.RingGeometry(0.42, 0.5, 4, 1, Math.PI / 4), PAD, 0.7);
  mark.position.set(STATION.x, 0.035, STATION.z);
  station.add(mark);
  const bellAt = STATION.clone().add(new THREE.Vector3(0, 0, -(POST_RADIUS + 0.2)));
  const wood = toon(0x4e3024);
  for (const dx of [-0.7, 0.7]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.9, 0.14), wood);
    post.position.set(bellAt.x + dx, 0.95, bellAt.z);
    post.castShadow = true;
    station.add(post);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.14, 0.18), wood);
  beam.position.set(bellAt.x, 1.92, bellAt.z);
  beam.castShadow = true;
  const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.26, 0.42, 10), toon(0x8a6a2c));
  bell.position.set(bellAt.x, 1.6, bellAt.z);
  bell.castShadow = true;
  station.add(beam, bell);
  game.renderer.scene.add(station);
  game.physics.staticBox(bellAt.clone().add(new THREE.Vector3(0, 0.95, 0)), new THREE.Vector3(0.8, 0.95, 0.1));

  // What the drill draws while it runs: the closing ring and the open mark.
  const closing = flat(new THREE.RingGeometry(0.9, 1, 48), LIT, 0.9);
  const fill = flat(new THREE.CircleGeometry(0.86, 40), LIT, 0.55);
  for (const m of [closing, fill]) { m.visible = false; game.renderer.scene.add(m); }

  let posts: Enemy[] = [];
  let lastLit = -1;
  let current: { lit: number; t: number; rules: TierRules } | null = null;
  // What the debug hook reports, so a check can aim at the lit post.
  postsView = () => ({ lit: current?.lit ?? -1, t: current?.t ?? 0, close: current?.rules.timing?.close ?? 0, spots: spots.map((p) => [p.x, p.y, p.z]), station: [STATION.x, STATION.y, STATION.z] });

  const padColor = (i: number, c: number, o: number) => { const m = pads[i]!.material as THREE.MeshBasicMaterial; m.color.setHex(c); m.opacity = o; };
  const clear = () => {
    current = null;
    for (let i = 0; i < pads.length; i++) padColor(i, PAD, 0.7);
    closing.visible = fill.visible = false;
  };
  const flash = (i: number, good: boolean) => game.vfx.ring(spots[i]!.clone().add(new THREE.Vector3(0, 0.06, 0)), good ? GOOD : BAD, 0.4, good ? 2.6 : 1.4, 0.4);
  const rulesFor = (tier: DrillTier): TierRules => (tier as DrillTier & { rules?: TierRules }).rules ?? TIERS[0]!.rules;

  return {
    id: 'striking-posts', technique: null, tiersPerTechnique: true, title: 'Striking Posts', jp: '巻藁',
    brief: 'Perform the full sign, then strike the lit post.',
    howTo: (tier) => {
      const r = rulesFor(tier);
      return ['One post lights at a time. Only a signed blow on it counts.', `Sign with ${keyLabel('fullsign')}, then strike the lit post.`, ...TIERS.slice(0, TIERS.findIndex((t) => t.rules === r) + 1).flatMap((t) => t.rules.lines)];
    },
    cue: () => {
      if (!current) return 'Watch the posts';
      const tm = current.rules.timing;
      if (tm && current.t < tm.close) return 'The ring closes';
      return tm ? 'Now' : 'Strike';
    },
    position: [STATION.x, STATION.y, STATION.z],
    tiers: TIERS,
    hold(g) {
      // The posts stand for the length of the drill, facing the mark.
      if (!posts.length || posts.some((p) => p.disposed)) {
        for (const p of posts) p.dispose();
        posts = spots.map((s) => {
          const e = g.encounters.spawn('dummy', s.clone());
          e.yaw = Math.atan2(-(STATION.x - s.x), -(STATION.z - s.z));
          return e;
        });
      }
      const c = current;
      if (!c) return;
      const at = spots[c.lit]!;
      const tm = c.rules.timing;
      if (tm) {
        const k = Math.min(1, c.t / tm.close);
        const open = c.t >= tm.close;
        closing.visible = !open;
        closing.position.set(at.x, 0.05, at.z);
        closing.scale.setScalar(RING - (RING - 0.86) * k);
        fill.visible = open;
        fill.position.set(at.x, 0.04, at.z);
      }
    },
    end() {
      clear();
      for (const p of posts) { p.alive = false; p.dispose(); }
      posts = [];
    },
    spawn(g, tier): DrillItem {
      const rules = rulesFor(tier);
      const choices = [0, 1, 2].filter((i) => i !== lastLit);
      const lit = choices[Math.floor(Math.random() * choices.length)]!;
      lastLit = lit;
      const item = { lit, t: 0, rules };
      const startedAt = g.clock.time;
      let bell = false;
      current = item;
      padColor(lit, LIT, 0.95);
      const done = (pts: number): number => { flash(lit, pts > 0); if (current === item) clear(); return pts; };
      const length = rules.timing ? rules.timing.close + rules.timing.open : rules.window;
      return {
        update: (dt) => {
          item.t += dt;
          if (rules.timing && !bell && item.t >= rules.timing.close) { bell = true; g.audio.play('drill.cue', { at: bellAt, pitch: 1.5 }); }
          // One Breath: a plain cast, or a signed one that lands on nothing, spoils the mark.
          const c = g.techniques.lastCast;
          if (rules.strict && c.kind !== 'max' && c.at > startedAt && (!c.primed || g.clock.time - c.at > WASTED_AFTER)) return done(0);
          if (item.t >= length) return done(0);
          return null;
        },
        struck: (e) => {
          const i = posts.indexOf(e);
          if (i < 0) return null;
          if (i !== lit) return rules.clean ? done(0) : null;
          const c = g.techniques.lastCast;
          const signed = c.primed && c.kind !== 'max' && g.clock.time - c.at < BLOW_AFTER_CAST;
          const early = !!rules.timing && item.t < rules.timing.close;
          if (signed && !early) return done(1);
          // A blow that breaks a rule: spoils the mark from Timing on, and before
          // that only fails to count, so the student can sign and strike again.
          if (rules.strict || early || (signed && rules.timing)) return done(0);
          flash(lit, false);
          return null;
        },
        dispose: () => { if (current === item) clear(); },
      };
    },
  };
}

export let postsView: () => { lit: number; t: number; close: number; spots: number[][]; station: number[] } = () => ({ lit: -1, t: 0, close: 0, spots: [], station: [STATION.x, STATION.y, STATION.z] });
