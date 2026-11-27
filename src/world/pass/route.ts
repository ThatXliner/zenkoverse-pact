// The pass road as data: the line it runs along, how high its surface is at
// every node, how wide the walkable strip is, and what it is paved with. It
// leaves the valley through a cutting in the south cliff, east of the
// roadside shrine; it climbs a hollow in switchbacks, crosses a ravine on a
// rope bridge, passes the tea house, goes up stone steps to the col, and
// winds down the far side to the outskirts. The ground is carved to it:
// `carve` holds the land to a bench along the road (cut banks above it, fill
// below), and the valley's height (src/world/valleyPlan.ts) and the pass's
// own land (src/world/pass/plan.ts) both pass through it, so the cutting the
// valley draws and the road the pass draws meet without a seam.
//
// No imports: the valley's plan reads this file. World metres, north is -z.

export type Paving = 'earth' | 'stone' | 'steps' | 'rope' | 'asphalt';

export interface Node {
  x: number;
  z: number;
  // The road surface here.
  y: number;
  // What the segment from this node to the next is laid with.
  pave: Paving;
  // How steeply the cut bank rises from the bench (rise over run): rock in the cutting, earth elsewhere.
  cut: number;
  // How far either side of the line the walkable strip reaches before the edge (a wall in the rock, a fence over a drop).
  edge: number;
}

const n = (x: number, z: number, y: number, pave: Paving = 'earth', cut = 1.0, edge = 2.9): Node => ({ x, z, y, pave, cut, edge });

export const ROAD_HALF = 1.55;
// The level bench either side of the line, past the road's own edge.
export const BENCH = ROAD_HALF + 0.55;
// The bank below a fill.
const FILL = 0.8;
// The rock face under a bridge's abutment.
const ABUTMENT = 2.6;

export const ROUTE: readonly Node[] = [
  // Out of the valley: the path from the shrine road meets the cutting.
  n(22.6, 88.5, 0.62, 'earth', 1.0, 2.8),
  // The cutting: rock walls, a gentle climb, a bend that hides the far end.
  n(23.4, 96, 1.4, 'earth', 1.6, 2.8),
  n(25.6, 105, 2.6, 'earth', 1.6, 2.8),
  n(24.6, 115, 3.9, 'earth', 1.6, 2.8),
  n(27.2, 125, 5.2, 'earth', 1.5, 2.8),
  n(31.5, 134, 6.5, 'earth', 1.3, 2.8),
  // Into the hollow, past the tarn.
  n(38, 143, 7.6, 'earth', 1.0, 2.8),
  n(48, 150, 8.6),
  // The switchbacks up the hollow's south wall.
  n(62, 153, 9.6),
  n(92, 160, 13.2, 'stone'),
  n(101, 166, 14.4, 'stone'),
  n(98, 173.5, 15.4, 'stone'),
  n(66, 177, 19.4, 'stone'),
  n(42, 181, 22.2, 'stone'),
  n(36, 188, 23.2, 'stone'),
  n(42, 195, 24.4, 'stone'),
  n(68, 198, 27.8, 'earth'),
  // The rope bridge over the ravine.
  n(79.5, 199.5, 28.4, 'rope', 1.0, 1.05),
  n(98.5, 201.5, 28.4, 'earth'),
  n(101.6, 201.9, 28.5, 'earth'),
  // The tea house terrace, then stone steps up to the col.
  n(104, 205.5, 28.8, 'stone'),
  n(103, 214, 30.0, 'steps', 1.2, 2.8),
  n(98, 228, 36.2, 'stone', 1.2, 2.8),
  n(93, 236, 37.6, 'steps', 1.2, 2.8),
  n(88, 246, 42.4, 'stone', 1.2, 2.8),
  // The col.
  n(84, 254, 43.4, 'stone', 1.0, 2.8),
  // Down the far side: west above the knoll, round its foot, back east below it, south.
  n(72, 263, 42.2),
  n(52, 271, 39.6),
  n(40, 282, 37.6),
  n(42, 293, 36.2),
  n(56, 300, 34.6),
  n(82, 307, 32.0),
  n(100, 318, 29.8),
  n(98, 331, 28.2),
  n(84, 348, 25.8),
  n(73, 376, 22.9),
  n(67, 405, 21.2),
  // The edge of the outskirts: the road goes on, metalled, into the next region.
  n(66, 430, 20.4, 'asphalt'),
  n(66, 448, 20.2, 'asphalt'),
];

// Level places beside the road: the tea house terrace, the lookout at the
// col, the clearing where the road meets the outskirts. Carved flat to `y`
// within `r`, walkable to `edge`.
export interface Site { id: string; x: number; z: number; y: number; r: number; edge: number }
export const SITES: readonly Site[] = [
  { id: 'teahouse', x: 109, z: 207, y: 28.8, r: 6.4, edge: 8.4 },
  { id: 'lookout', x: 84, z: 262, y: 43.4, r: 4.6, edge: 6.0 },
  { id: 'tarn', x: 50, z: 157, y: 8.2, r: 2.0, edge: 6.0 },
];

// ------------------------------------------------------------ geometry

export interface Along { d: number; y: number; seg: number; t: number; x: number; z: number }

const seg = ROUTE.slice(0, -1).map((a, i) => {
  const b = ROUTE[i + 1]!;
  const reach = Math.max(a.edge, b.edge) + 40;
  // Which of its ends is a rope span's abutment.
  const abutB = b.pave === 'rope', abutA = i > 0 && ROUTE[i - 1]!.pave === 'rope';
  return { a, b, abutA, abutB, x0: Math.min(a.x, b.x) - reach, x1: Math.max(a.x, b.x) + reach, z0: Math.min(a.z, b.z) - reach, z1: Math.max(a.z, b.z) + reach };
});
export const ROUTE_BOX = { x0: Math.min(...seg.map((s) => s.x0)), x1: Math.max(...seg.map((s) => s.x1)), z0: Math.min(...seg.map((s) => s.z0)), z1: Math.max(...seg.map((s) => s.z1)) };

// The nearest point of the road's line to (x, z): its distance, the road
// height there, and which segment and how far along it.
export function along(x: number, z: number, out: Along = { d: 0, y: 0, seg: 0, t: 0, x: 0, z: 0 }): Along {
  out.d = Infinity;
  for (let i = 0; i < seg.length; i++) {
    const s = seg[i]!;
    if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) continue;
    const { a, b } = s, dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
    const px = a.x + dx * t, pz = a.z + dz * t, d = Math.hypot(x - px, z - pz);
    if (d < out.d) { out.d = d; out.seg = i; out.t = t; out.x = px; out.z = pz; out.y = a.y + (b.y - a.y) * t; }
  }
  return out;
}

// The land at (x, z), `h`, held to the road: no higher than the cut bank
// above its bench and no lower than the fill below it, for every stretch of
// road (and every site) near enough to matter. A rope span holds nothing up:
// the ravine stays open under it, and past the end of the road at each of its
// abutments the ground falls away steeply instead of on a bank of fill, which
// would bury the ravine under the span. Steps are carved a riser low, so the
// treads stand on the ground and not in it.
export function carve(x: number, z: number, h: number): number {
  if (x < ROUTE_BOX.x0 || x > ROUTE_BOX.x1 || z < ROUTE_BOX.z0 || z > ROUTE_BOX.z1) return h;
  let lo = -Infinity, hi = Infinity;
  for (const s of seg) {
    if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) continue;
    const { a, b } = s;
    if (a.pave === 'rope') continue;
    const dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
    const d = Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
    const e = Math.max(0, d - BENCH);
    const y = a.y + (b.y - a.y) * t - (a.pave === 'steps' ? 0.28 : 0);
    const cut = a.cut + (b.cut - a.cut) * t;
    const abut = (t === 1 && s.abutB) || (t === 0 && s.abutA);
    hi = Math.min(hi, y + e * cut);
    lo = Math.max(lo, y - e * (abut ? ABUTMENT : FILL));
  }
  for (const st of SITES) {
    const d = Math.hypot(x - st.x, z - st.z);
    if (d > st.r + 40) continue;
    const e = Math.max(0, d - st.r);
    hi = Math.min(hi, st.y + e * 1.1);
    lo = Math.max(lo, st.y - e * FILL);
  }
  if (lo > hi) return (lo + hi) / 2;
  return Math.min(hi, Math.max(lo, h));
}

// How far inside the walkable strip (road and sites) a point is: negative
// inside, by that many metres. Without `rope`, the bridge's span is left out
// (the strip the ground carries).
export function walkDistance(x: number, z: number, rope = true): number {
  let best = Infinity;
  for (const s of seg) {
    if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) continue;
    if (!rope && s.a.pave === 'rope') continue;
    const { a, b } = s, dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
    const d = Math.hypot(x - a.x - dx * t, z - a.z - dz * t) - (a.edge + (b.edge - a.edge) * t);
    if (d < best) best = d;
  }
  for (const st of SITES) best = Math.min(best, Math.hypot(x - st.x, z - st.z) - st.edge);
  return best;
}

// Whether a point stands in the cutting's mouth, where the valley's cliff rings leave their gap.
export const inCutting = (x: number, z: number): boolean => x > 12 && x < 36 && z > 84 && z < 136 && walkDistance(x, z) < 6;
