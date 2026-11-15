// The valley around the compound, as data: where the ground lies, where the
// stream, the road and the paths run, and where each place sits. The build
// (src/world/valley.ts), the map, the footsteps and the bed all read this one
// plan, so moving a place means editing a number here. North is -z; the
// compound's gate opens south onto the road.
//
// The floor is flat (a hair below the courtyard paving) so everything placed
// on it stands level. It rises gently toward the edges, then a band of cliff
// too steep to climb closes the valley on every side; wooded slopes run on
// up behind the cliffs.

export type Pt = readonly [number, number];

// The valley floor and the water surface.
export const FLOOR_Y = -0.02;
export const WATER_Y = -0.38;
// The outside faces of the compound walls.
export const WALLS = { hx: 24.6, hz: 20.6 } as const;
// The foot of the cliffs: a rounded rectangle, a little ragged (`wobble`).
export const VALLEY = { x0: -66, x1: 68, z0: -48, z1: 92, r: 22 } as const;

export const ROAD: readonly Pt[] = [[0, 21], [0, 34], [2, 41], [2, 55], [4.5, 63], [3, 72], [0, 79], [0, 84.4]];
export const ROAD_HALF = 2.2;
export const PATH_HALF = 1.1;
export const PATHS: readonly (readonly Pt[])[] = [
  // Round the outside of the walls.
  [[0, 24.5], [28.5, 24.5], [28.5, -24.5], [-28.5, -24.5], [-28.5, 24.5], [0, 24.5]],
  // East to the training ground.
  [[28.5, 2], [37.5, 2]],
  // To the old ginkgo, and on west through the north wood to the falls.
  [[28.5, -24.5], [37, -27.5], [44, -25.5]],
  [[37, -27.5], [30, -35], [12, -38.5], [-8, -39.5], [-27, -40.5], [-38, -42.5]],
  [[-28.5, -24.5], [-27.5, -33], [-27, -40.5]],
  // West from the road to the terraces.
  [[2.6, 58], [-10, 61.5], [-23.6, 64.6]],
  // Through the tall grass, over the stepping stones, up to the training ground.
  [[4.2, 61], [16, 58.5], [28, 52], [37, 47], [40, 45.2], [40, 37.6], [42.5, 26], [45.5, 11.2]],
];

// The stream: out of the pool under the falls, south past the west wall,
// east under the road's bridge, and into a cleft in the east cliff.
export const STREAM: readonly Pt[] = [[-46, -46], [-44, -36], [-41, -22], [-39, -6], [-38, 10], [-35, 24], [-28, 38], [-14, 45], [2, 48], [18, 47], [34, 42], [50, 40], [61, 42.5], [67.5, 44]];
// Half the flat bed, and the bank up from it.
export const STREAM_HALF = 2.0;
export const BANK = 2.4;
export const BED_DEPTH = 1.0;

export const FALLS = { x: -46, z: -46.5, pool: 4.2, rim: 6.8, top: 14.6 } as const;
export const EXIT = { x: 67.5, z: 44 } as const;
export const BRIDGE = { x: 2, z0: 43.2, z1: 52.8, half: 1.5, rise: 0.95 } as const;
export const STONES = { x: 40, z0: 38.2, z1: 44.6 } as const;
// Clear, swept and level, beside the road outside the gate: kept empty for drills.
export const FIELD = { x: -12, z: 32, half: 5.5 } as const;
export const GROUNDS = { x: 46, z: 2, r: 9 } as const;
export const GINKGO = { x: 50, z: -24, knoll: 11, rise: 1.4 } as const;
// Four tiers stepping up westward, three paddies each.
export const TERRACES = { x0: -60, x1: -24, z0: 54, z1: 86, tiers: 4, step: 0.6, base: 0.35, cuts: [54, 64.6, 75.4, 86] } as const;
export const MEADOW = { x0: 11, x1: 60, z0: 50, z1: 86 } as const;
export const SHRINE = { x: 0, z: 88.4, toriiZ: 79.6, x0: -4.5, x1: 4.5, z0: 84.4, z1: 91, top: 1.2 } as const;
// Where each place's waypoint stone stands (src/world/waypoints.ts); the
// woods and the grass keep clear of them.
export const STONE_AT: Record<'field' | 'shrine' | 'falls' | 'grounds' | 'ginkgo' | 'terraces', Pt> = {
  field: [FIELD.x + FIELD.half + 1.4, FIELD.z + 2],
  shrine: [SHRINE.x - 4.4, SHRINE.toriiZ + 1.2],
  falls: [FALLS.x + 9.5, FALLS.z + 1],
  grounds: [GROUNDS.x - GROUNDS.r - 1.6, GROUNDS.z + 4.4],
  ginkgo: [GINKGO.x - 7.4, GINKGO.z + 4.6],
  terraces: [TERRACES.x1 + 2.2, TERRACES.cuts[1] + 2.6],
};

// ------------------------------------------------------------- geometry

const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smooth = (a: number, b: number, x: number): number => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// Distance from a point to a polyline, and the nearest point on it.
export function nearest(x: number, z: number, line: readonly Pt[], out?: { x: number; z: number }): number {
  let best = Infinity, bx = 0, bz = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i]!, [cx, cz] = line[i + 1]!;
    const dx = cx - ax, dz = cz - az;
    const t = clamp01(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1));
    const px = ax + dx * t, pz = az + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best) { best = d; bx = px; bz = pz; }
  }
  if (out) { out.x = bx; out.z = bz; }
  return best;
}

export const nearPath = (x: number, z: number): number => Math.min(...PATHS.map((p) => nearest(x, z, p)));

// Signed distance past the foot of the cliffs (negative on the valley floor).
export function edgeDistance(x: number, z: number): number {
  const V = VALLEY, cx = (V.x0 + V.x1) / 2, cz = (V.z0 + V.z1) / 2;
  const qx = Math.abs(x - cx) - ((V.x1 - V.x0) / 2 - V.r), qz = Math.abs(z - cz) - ((V.z1 - V.z0) / 2 - V.r);
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - V.r;
}

const bump = (x: number, z: number, cx: number, cz: number, r: number): number => {
  const d = Math.hypot(x - cx, z - cz) / r;
  return d >= 1 ? 0 : 0.5 + 0.5 * Math.cos(d * Math.PI);
};

// The ragged line of the cliffs, held straight where the falls, the stream's
// cleft and the shrine stand against them.
function wobble(x: number, z: number): number {
  const w = 2.2 * Math.sin(x * 0.083 + z * 0.051) + 1.4 * Math.sin(z * 0.121 - x * 0.067 + 1.7);
  return w * (1 - bump(x, z, FALLS.x, FALLS.z, 16)) * (1 - bump(x, z, EXIT.x, EXIT.z, 12)) * (1 - bump(x, z, SHRINE.x, SHRINE.z, 14));
}

export const cliffDistance = (x: number, z: number): number => edgeDistance(x, z) + wobble(x, z);

// Height of the ground over the cliff line: level, a gentle rise over the
// last 14 m, a cliff of 9 to 14 m (always steeper than anyone can climb, so
// a lower stretch is also a shorter one), then the wooded slope.
export const CLIFF = { foot: 14, rise: 1.0, grade: 2.6 } as const;
export function cliffHeight(x: number, z: number): number {
  const n = 0.5 + 0.5 * Math.sin(x * 0.047 + 0.8) * Math.sin(z * 0.061 - x * 0.013 + 2.1);
  return mix(9.2, 14, Math.max(n, bump(x, z, FALLS.x, FALLS.z, 18), bump(x, z, SHRINE.x, SHRINE.z, 16)));
}
export const cliffRun = (x: number, z: number): number => cliffHeight(x, z) / CLIFF.grade;
function profile(d: number, x: number, z: number): number {
  if (d <= -CLIFF.foot) return 0;
  if (d <= 0) { const t = (d + CLIFF.foot) / CLIFF.foot; return t * t * CLIFF.rise; }
  const height = cliffHeight(x, z), run = height / CLIFF.grade;
  if (d <= run) return CLIFF.rise + d * CLIFF.grade;
  const up = d - run;
  return CLIFF.rise + height + Math.min(up, 42) * 0.55 + Math.sin(x * 0.07 + z * 0.045) * 2.4 * smooth(0, 14, up);
}
// The ground height at (x, z), as the terrain mesh and its collider have it
// at their vertices. Inside the compound the paving is the floor, so the
// ground there sinks out of the way (and out of the pond).
export function heightAt(x: number, z: number): number {
  if (Math.abs(x) < 22 && Math.abs(z) < 18) return -3;
  const d = cliffDistance(x, z);
  let h = profile(d, x, z) + GINKGO.rise * bump(x, z, GINKGO.x, GINKGO.z, GINKGO.knoll);
  if (d < 1.5) {
    const s = nearest(x, z, STREAM);
    if (s < STREAM_HALF + BANK) h = Math.min(h, -BED_DEPTH + BED_DEPTH * smooth(STREAM_HALF, STREAM_HALF + BANK, s));
  }
  const pool = Math.hypot(x - FALLS.x, z - FALLS.z);
  if (pool < FALLS.rim) h = Math.min(h, -1.2 + 1.2 * smooth(FALLS.pool, FALLS.rim, pool));
  return h + FLOOR_Y;
}

// How far out of the walls a point is, 0 inside to 1 a few metres out.
export function openness(x: number, z: number): number {
  return clamp01(Math.max(Math.abs(x) - WALLS.hx, Math.abs(z) - WALLS.hz) / 5);
}

export const inField = (x: number, z: number): boolean => Math.abs(x - FIELD.x) <= FIELD.half && Math.abs(z - FIELD.z) <= FIELD.half;

// The tier a point stands on, or -1.
export function terraceTier(x: number, z: number): number {
  const T = TERRACES;
  if (x < T.x0 || x > T.x1 || z < T.z0 || z > T.z1) return -1;
  return Math.min(T.tiers - 1, Math.floor((T.x1 - x) / ((T.x1 - T.x0) / T.tiers)));
}
export const tierY = (i: number): number => TERRACES.base + i * TERRACES.step;

// What a foot lands on out here (the bridge and the stones tag themselves).
export function groundSurface(x: number, y: number, z: number): 'grass' | 'gravel' | 'water' | 'stone' {
  const tier = terraceTier(x, z);
  if (tier >= 0) return y < tierY(tier) + 0.12 ? 'water' : 'grass';
  if (y < WATER_Y + 0.25 && (nearest(x, z, STREAM) < STREAM_HALF + 1.4 || Math.hypot(x - FALLS.x, z - FALLS.z) < FALLS.pool + 0.8)) return 'water';
  if (cliffDistance(x, z) > 0.5) return 'stone';
  if (nearest(x, z, ROAD) < ROAD_HALF + 0.2 || nearPath(x, z) < PATH_HALF + 0.2 || inField(x, z) || Math.hypot(x - GROUNDS.x, z - GROUNDS.z) < GROUNDS.r) return 'gravel';
  return 'grass';
}
