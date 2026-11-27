import { heightAt as valleyHeight, cliffDistance, smooth } from '../valleyPlan';
import { carve, along, ROUTE, SITES, walkDistance, type Along } from './route';

// The land of the pass, as data the build, the colliders, the footsteps and
// the map all read. Past the valley's south rim the ground drops into a
// hollow with a tarn, then climbs the hollow's south wall to a ridge; the
// road crosses it at a col between higher ground east and west, with a knoll
// just south of it that hides the low country until the road has wound down
// round it. A ravine runs down the hollow's wall from the col's flank. Where
// the land meets the valley's (along z = GRID.z0) it is the valley's own
// height, so the two grids join without a step.

// The pass's height grid: 2 m cells, its corners on the valley's grid lines.
export const GRID = { x0: -24, z0: 134, cell: 2, nx: 92, nz: 158 } as const;
export const GRID_X1 = GRID.x0 + GRID.nx * GRID.cell;
export const GRID_Z1 = GRID.z0 + GRID.nz * GRID.cell;

// The plain at the pass's foot, where the outskirts and the city stand (src/world/outskirts.ts).
const PLAIN_Y = 20.2;

export const TARN = { x: 64, z: 158, r: 10, y: 6.9 } as const;
export const RAVINE: readonly (readonly [number, number])[] = [[93, 236], [90, 218], [88, 200], [84, 182], [80, 166], [72, 160]];
export const KNOLL = { x: 70, z: 287, r: 20, top: 50 } as const;
export const COL = { x: 84, z: 255 } as const;
export const BRIDGE = { a: ROUTE.findIndex((n) => n.pave === 'rope') } as const;

const bump = (x: number, z: number, cx: number, cz: number, r: number): number => {
  const d = Math.hypot(x - cx, z - cz) / r;
  return d >= 1 ? 0 : 0.5 + 0.5 * Math.cos(d * Math.PI);
};

function nearestOn(x: number, z: number, line: readonly (readonly [number, number])[]): { d: number; t: number } {
  let best = Infinity, bt = 0, acc = 0, total = 0;
  for (let i = 0; i < line.length - 1; i++) total += Math.hypot(line[i + 1]![0] - line[i]![0], line[i + 1]![1] - line[i]![1]);
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i]!, [bx, bz] = line[i + 1]!;
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
    const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / (len * len)));
    const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
    if (d < best) { best = d; bt = (acc + t * len) / total; }
    acc += len;
  }
  return { d: best, t: bt };
}

// The ridge the col crosses: where its crest runs and how high it stands.
// The col itself is the low point, at the road's height.
const COL_Y = 44;
const crestZ = (x: number): number => 256 + 6 * Math.sin(x * 0.045 + 0.6);
const crestY = (x: number): number => {
  const away = 1 - Math.exp(-(((x - COL.x) / 34) ** 2));
  return COL_Y + away * (24 + 6 * Math.sin(x * 0.06 + 1.1));
};

// The land before the road is cut into it.
export function natural(x: number, z: number): number {
  const cz = crestZ(x), top = crestY(x);
  let h: number;
  if (z < cz) {
    // The hollow's floor, then its south wall climbing steadily to the col,
    // and higher the further from the col it is.
    const t = Math.max(0, (z - 148) / (cz - 148));
    h = 8.4 + 0.04 * Math.abs(x - 62) * (1 - t) + (COL_Y - 8.4) * t + (top - COL_Y) * Math.pow(smooth(148, cz, z), 1.4);
  } else {
    // The far side: a broad valley down from the col to the low country by
    // the outskirts, the high ground standing back from it.
    const away = 1 - Math.exp(-(((x - 76) / 70) ** 2));
    const t = smooth(cz, 440, z), s = Math.max(0, (z - cz) / (440 - cz));
    h = COL_Y + (20 - COL_Y) * (0.4 * s + 0.4 * Math.pow(s, 0.6) + 0.2 * t) + (top - COL_Y) * Math.max(away, 1 - smooth(cz, cz + 16, z));
  }
  // High ground east and west of the hollow, closing it in.
  h = Math.min(h + 26 * smooth(8, -22, x) + 24 * smooth(124, 168, x), 96);
  // The knoll south of the col.
  h = Math.max(h, KNOLL.top - 30 * (1 - bump(x, z, KNOLL.x, KNOLL.z, KNOLL.r * 1.8)));
  // A little life in the slopes.
  h += 1.6 * Math.sin(x * 0.11 + z * 0.07) + 1.1 * Math.sin(z * 0.13 - x * 0.05 + 2.3);
  // The ravine: a V cut down the hollow's wall, deepest under the bridge.
  const rv = nearestOn(x, z, RAVINE);
  const depth = 2 + 9 * Math.sin(Math.PI * Math.min(1, rv.t * 1.25));
  h -= depth * Math.max(0, 1 - rv.d / (3 + depth * 0.9));
  // The tarn's bowl.
  const tarn = Math.hypot(x - TARN.x, z - TARN.z);
  if (tarn < TARN.r + 14) h = Math.min(h, TARN.y - 1.0 + 1.4 * smooth(TARN.r - 3, TARN.r + 2, tarn) + 1.2 * Math.max(0, tarn - TARN.r - 2));
  // At its south edge the land settles to the plain the outskirts and the city stand on.
  if (z > 396) h += (PLAIN_Y - 0.05 - h) * smooth(396, 446, z);
  // Next to the valley the land is the valley's: its rim and the slopes behind.
  return blendValley(x, z, h);
}

function blendValley(x: number, z: number, h: number): number {
  if (z > 166) return h;
  const w = smooth(134, 166, z);
  return valleyHeight(x, z) * (1 - w) + h * w;
}

// The ground the colliders and the mesh are built from.
export const groundHeight = (x: number, z: number): number => carve(x, z, natural(x, z));

// ------------------------------------------------------------ the grid

// Heights at the grid's corners, row by row (rows along z). A generator, so
// the build can spread the work over frames.
export function* gridHeights(rowsPerSlice = 16): Generator<void, Float32Array, void> {
  const { x0, z0, cell, nx, nz } = GRID;
  const h = new Float32Array((nx + 1) * (nz + 1));
  for (let i = 0; i <= nz; i++) {
    for (let j = 0; j <= nx; j++) h[i * (nx + 1) + j] = groundHeight(x0 + j * cell, z0 + i * cell);
    if (i % rowsPerSlice === rowsPerSlice - 1) yield;
  }
  return h;
}

// The height on the triangulated grid at (x, z), as the collider has it:
// each cell splits on its (j, i)-(j+1, i+1) diagonal.
export function onGrid(h: Float32Array, x: number, z: number): number {
  const { x0, z0, cell, nx, nz } = GRID;
  const fx = Math.min(nx - 1e-6, Math.max(0, (x - x0) / cell)), fz = Math.min(nz - 1e-6, Math.max(0, (z - z0) / cell));
  const j = Math.floor(fx), i = Math.floor(fz), u = fx - j, v = fz - i;
  const at = (ii: number, jj: number): number => h[ii * (nx + 1) + jj]!;
  const h00 = at(i, j), h11 = at(i + 1, j + 1);
  // Below the diagonal (v > u) the triangle is (i,j) (i+1,j) (i+1,j+1).
  return v > u ? h00 + (at(i + 1, j) - h00) * v + (h11 - at(i + 1, j)) * u : h00 + (at(i, j + 1) - h00) * u + (h11 - at(i, j + 1)) * v;
}

export const onLand = (x: number, z: number): boolean => x >= GRID.x0 && x <= GRID_X1 && z >= GRID.z0 && z <= GRID_Z1;

// Whether (x, z) is down on the valley's floor (the valley's grid draws it, and no edge stands there).
export const onValleyFloor = (x: number, z: number): boolean => cliffDistance(x, z) < 0.4 && z < 100;

export { carve, along, walkDistance, ROUTE, SITES, type Along };
