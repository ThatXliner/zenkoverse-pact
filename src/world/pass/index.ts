import * as THREE from 'three';
import { Kit } from '../kit';
import type { MapMark, Place, RegionContent, RegionDef, Zone, Pt } from '../region';
import { ROUTE, SITES, ROAD_HALF, along, walkDistance, type Paving } from './route';
import { GRID, GRID_X1, GRID_Z1, TARN, RAVINE, COL, onGrid, onValleyFloor } from './plan';
import { makeGround, buildTerrain } from './ground';
import { buildRoad } from './road';
import { buildSites } from './sites';
import { buildWoods } from './woods';
import type { Surface } from '../../audio/surfaces';

// The pass road over the mountains south of the valley (the route is
// src/world/pass/route.ts, the land src/world/pass/plan.ts). Its frame is the
// world's: the cutting it leaves the valley by is carved into the valley's
// own ground, so the two share coordinates.

const node = (i: number): THREE.Vector3 => new THREE.Vector3(ROUTE[i]!.x, ROUTE[i]!.y + 0.05, ROUTE[i]!.z);
const nodeNear = (x: number, z: number): number => ROUTE.reduce((best, n, i) => (Math.hypot(n.x - x, n.z - z) < Math.hypot(ROUTE[best]!.x - x, ROUTE[best]!.z - z) ? i : best), 0);
const site = (id: string) => SITES.find((s) => s.id === id)!;
const tea = site('teahouse'), look = site('lookout'), tarnSite = site('tarn');
const BRIDGE_I = ROUTE.findIndex((n) => n.pave === 'rope');
const bridgeMid = (): THREE.Vector3 => { const a = ROUTE[BRIDGE_I]!, b = ROUTE[BRIDGE_I + 1]!; return new THREE.Vector3((a.x + b.x) / 2, a.y - 0.45, (a.z + b.z) / 2); };

export const PASS_SPAWNS = {
  cutting: node(2),
  tarn: new THREE.Vector3(tarnSite.x, tarnSite.y + 0.05, tarnSite.z),
  switchbacks: node(nodeNear(66, 177)),
  ropebridge: node(BRIDGE_I - 1),
  teahouse: new THREE.Vector3(tea.x - 3.2, tea.y + 0.05, tea.z + 1.5),
  col: new THREE.Vector3(COL.x, ROUTE[nodeNear(COL.x, COL.z)]!.y + 0.05, COL.z),
  descent: node(nodeNear(56, 300)),
  passfoot: node(nodeNear(67, 405)),
} as const;

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
export const PASS_PLACES: readonly Place[] = [
  { id: 'cutting', name: 'The cutting', jp: '切通し', glyph: '切', blurb: 'A road cut through the south cliff, east of the shrine. It climbs out of the valley.', at: node(1), label: v(ROUTE[1]!.x, ROUTE[1]!.y + 5, ROUTE[1]!.z), shrine: v(ROUTE[0]!.x - 2.6, ROUTE[0]!.y, ROUTE[0]!.z - 1.4) },
  { id: 'teahouse', name: 'Tea house', jp: '茶屋', glyph: '茶', blurb: 'A thatched tea house on a ledge above the rope bridge. The bench outside is for anyone.', at: v(tea.x, tea.y, tea.z), label: v(tea.x, tea.y + 6.4, tea.z), shrine: v(tea.x - 4.6, tea.y, tea.z - 4.2) },
  { id: 'col', name: 'The col', jp: '峠', glyph: '峠', blurb: 'The top of the pass. A marker stone, a bench facing south, and the long way down.', at: v(look.x, look.y, look.z), label: v(look.x, look.y + 4.2, look.z), shrine: v(look.x - 4.2, look.y, look.z + 2.6) },
];

// ------------------------------------------------------------ zones

const box = (id: string, label: string, jp: string, x0: number, x1: number, z0: number, z1: number, general = false): Zone =>
  ({ id, label, jp, min: new THREE.Vector3(x0, -20, z0), max: new THREE.Vector3(x1, 200, z1), general });
const PASS_ZONES: Zone[] = [
  box('cutting', 'The cutting', '切通し', 14, 38, 88, 140),
  box('tarn', 'The tarn', '池', TARN.x - TARN.r - 14, TARN.x + TARN.r + 4, TARN.z - TARN.r - 8, TARN.z + TARN.r - 2),
  box('ropebridge', 'Rope bridge', '吊橋', Math.min(ROUTE[BRIDGE_I]!.x, ROUTE[BRIDGE_I + 1]!.x) - 2, Math.max(ROUTE[BRIDGE_I]!.x, ROUTE[BRIDGE_I + 1]!.x) + 2, Math.min(ROUTE[BRIDGE_I]!.z, ROUTE[BRIDGE_I + 1]!.z) - 3, Math.max(ROUTE[BRIDGE_I]!.z, ROUTE[BRIDGE_I + 1]!.z) + 3),
  box('teahouse', 'Tea house', '茶屋', tea.x - tea.edge, tea.x + tea.edge, tea.z - tea.edge, tea.z + tea.edge),
  box('col', 'The col', '峠', COL.x - 14, COL.x + 10, COL.z - 12, COL.z + 10),
  box('switchbacks', 'Switchbacks', '九十九折', 28, 110, 148, 202),
  box('descent', 'The way down', '下り坂', 20, 110, 262, 420),
  box('pass', 'The pass road', '峠道', GRID.x0, GRID_X1, 86, GRID_Z1, true),
];

// ------------------------------------------------------------ map

const routeLine = (from: number, to: number): Pt[] => ROUTE.slice(from, to + 1).map((n) => [n.x, n.z] as Pt);
const ridge: Pt[] = Array.from({ length: 34 }, (_, i) => { const x = GRID.x0 + 4 + i * 5.3; return [x, 256 + 6 * Math.sin(x * 0.045 + 0.6)] as Pt; });
const MARKS: MapMark[] = [
  { kind: 'box', class: 'ground', x: GRID.x0, z: GRID.z0 - 40, w: GRID_X1 - GRID.x0, d: GRID_Z1 - GRID.z0 + 40 },
  { kind: 'area', class: 'wood', pts: [[-20, 140], [30, 145], [36, 200], [60, 228], [70, 246], [-20, 250]] },
  { kind: 'area', class: 'wood', pts: [[110, 150], [158, 150], [158, 250], [104, 246], [112, 215], [110, 175]] },
  { kind: 'area', class: 'meadow', pts: [[20, 300], [64, 270], [110, 300], [108, 400], [40, 410]] },
  { kind: 'line', class: 'cliff', pts: ridge.filter(([x]) => Math.abs(x - COL.x) > 9) },
  { kind: 'line', class: 'stream', pts: RAVINE },
  { kind: 'circle', class: 'water', x: TARN.x, z: TARN.z, r: TARN.r },
  { kind: 'line', class: 'road', pts: routeLine(0, BRIDGE_I) },
  { kind: 'line', class: 'rail', pts: routeLine(BRIDGE_I, BRIDGE_I + 1) },
  { kind: 'line', class: 'road', pts: routeLine(BRIDGE_I + 1, ROUTE.length - 1) },
  { kind: 'circle', class: 'structure', x: tea.x, z: tea.z, r: 3.6 },
  { kind: 'circle', class: 'field', x: look.x, z: look.z, r: look.r },
];

// ------------------------------------------------------------ the region

export const PASS: RegionDef = {
  id: 'pass',
  name: 'The pass road',
  origin: new THREE.Vector3(0, 0, 0),
  bounds: { x0: GRID.x0, x1: GRID_X1, z0: 86, z1: GRID_Z1 },
  // Standing from anywhere in the valley, so its rim never changes behind a
  // player's back; gone once the far side has hidden it.
  stream: { load: 150, drop: 240 },
  spawns: PASS_SPAWNS,
  places: PASS_PLACES,
  map: { scope: { id: 'pass', label: 'Pass', view: { x: -40, z: 70, w: 220, h: 400 } }, marks: MARKS },
  *build(ctx): Generator<void, RegionContent, void> {
    const k = new Kit(ctx.group, ctx.physics);
    const land = k.stretch('pass:land');
    ctx.phase('terrain');
    const { heights, drawn } = yield* buildTerrain(k, land, ctx.phase);
    const ground = makeGround(heights);
    ctx.phase('road');
    yield* buildRoad(k, k.stretch('pass:road'), ground, ctx.phase);
    ctx.phase('sites');
    const sites = yield* buildSites(k, k.stretch('pass:sites'), ground, ctx.lights, ctx.phase);
    ctx.phase('woods');
    // Trees, rocks and growth stand on the ground as drawn.
    const standing = (x: number, z: number): number => (z >= GRID.z0 ? drawn(x, z) : ground(x, z));
    const groves = yield* buildWoods(k, k.stretch('pass:woods'), standing, ctx.phase);
    ctx.phase('done');
    const occluders = [...sites.occluders, ...groves];
    const at = { d: 0, y: 0, seg: 0, t: 0, x: 0, z: 0 };
    return {
      zones: PASS_ZONES.map((z) => ({ ...z, min: z.min.clone(), max: z.max.clone() })),
      occluders,
      water: sites.water,
      groundAt: (x, z) => (x >= GRID.x0 && x <= GRID_X1 && z >= GRID.z0 && z <= GRID_Z1 ? onGrid(heights, x, z) : null),
      surfaceAt(p, tag) {
        if (onValleyFloor(p.x, p.z)) return null;
        if (tag === 'wood') return 'wood';
        if (Math.hypot(p.x - TARN.x, p.z - TARN.z) < TARN.r + 0.5 && p.y < TARN.y + 0.1) return 'water';
        along(p.x, p.z, at);
        if (at.d < ROAD_HALF + 0.35) return PAVED[ROUTE[at.seg]!.pave];
        if (walkDistance(p.x, p.z) < 0 && Math.hypot(p.x - tea.x, p.z - tea.z) < tea.r) return 'gravel';
        if (Math.hypot(p.x - look.x, p.z - look.z) < look.r) return 'gravel';
        if (Math.abs(p.y - ground(p.x, p.z)) > 0.35) return 'stone';
        return 'grass';
      },
      update(time) { for (const m of sites.animated) m.uniforms.time!.value = time; },
    };
  },
};

const PAVED: Record<Paving, Surface> = { earth: 'gravel', stone: 'stone', steps: 'stone', rope: 'wood', asphalt: 'stone' };
