import * as THREE from 'three';
import { toon } from '../../render/materials';
import { heightAt as valleyHeight } from '../valleyPlan';
import type { Kit } from '../kit';
import { GRID, onGrid, gridHeights, ravineBed, TARN, RAVINE } from './plan';
import { walkDistance } from './route';

// The pass's land: one height grid (1 m cells) for the collider and, drawn
// from the same corners, a terrain mesh in flat painted fills, in tiles so
// each is one slice of building and the camera draws only the ground it
// sees. Out past where anyone walks (far from the road, the ravine and the
// tarn) the mesh takes every other corner, 2 m cells, and a fine cell's
// corner on such a cell's edge follows that edge, so the two meet without a
// crack. North of the grid (the cutting through the valley's cliff) the
// valley's own grid is the land.

// The valley's grid, which carries the cutting (src/world/valley.ts).
const VALLEY_GRID = { x0: -112, z0: -92, cell: 2 } as const;

// The ground as the colliders have it, anywhere along the pass.
export function makeGround(h: Float32Array): (x: number, z: number) => number {
  return (x, z) => (z >= GRID.z0 ? onGrid(h, x, z) : valleyTri(x, z));
}

function valleyTri(x: number, z: number): number {
  const { x0, z0, cell } = VALLEY_GRID;
  const fx = (x - x0) / cell, fz = (z - z0) / cell, j = Math.floor(fx), i = Math.floor(fz), u = fx - j, v = fz - i;
  const at = (ii: number, jj: number): number => valleyHeight(x0 + jj * cell, z0 + ii * cell);
  const h00 = at(i, j), h11 = at(i + 1, j + 1);
  if (v > u) { const h10 = at(i + 1, j); return h00 + (h10 - h00) * v + (h11 - h10) * u; }
  const h01 = at(i, j + 1);
  return h00 + (h01 - h00) * u + (h11 - h01) * v;
}

// Flat fills, the valley's palette (src/world/valley.ts): the hollow's grass
// in patches of three greens, darker slope under the woods, a russet band of
// dry grass high on the far side; rock on anything steep, laid in strata of
// five tones; bare earth in strata where the road is cut deep into the
// hill; wet earth at the tarn's and the creek's waterline, the bed under the
// water. Where a fill changes inside a triangle (a stratum's edge, the
// waterline, a patch's rim) the triangle is cut along the line, so the edge
// runs clean across the cells as a painter would draw it, not in steps.
const C = (c: number) => new THREE.Color(c);
const COL = {
  grass: [C(0x83a453), C(0x8fae58), C(0x9cb862)], slope: C(0x6a8f52), wood: C(0x5d7f4a), dry: [C(0xa9a56a), C(0xb8a96a)],
  fill: C(0x7f9f55), bed: C(0x58694c), wet: C(0x7e7a58),
};
const STRATA = [C(0x9c9384), C(0xa89c86), C(0x8b877f), C(0x9a8a78), C(0x857b70)];
const EARTH = [C(0xb49a70), C(0xa58c63), C(0xbfa77c), C(0x9b8360)];
// Which tone a stratum takes: a fixed shuffle, so neighbours differ.
const stratum = (tones: THREE.Color[], band: number): THREE.Color => tones[(((band * 7 + 3) % tones.length) + tones.length) % tones.length]!;
// Height through the strata, warped a little so the beds are not ruled lines.
const strataY = (x: number, y: number, z: number): number => y + 0.9 * Math.sin(x * 0.11 + z * 0.07) + 0.5 * Math.sin(x * 0.31 - z * 0.23);
// Slow noise for the painted patches: smooth blobs some metres across.
const patchAt = (x: number, z: number): number => Math.sin(x * 0.09 + z * 0.05) + Math.sin(z * 0.11 - x * 0.04 + 1.3) + 0.6 * Math.sin(x * 0.23 + Math.sin(z * 0.19) * 1.7);

// A corner of a piece of ground: where it is, its normal, and the value of
// the field its fills are cut by.
interface Corner { x: number; y: number; z: number; nx: number; ny: number; nz: number; f: number }
const mix = (a: Corner, b: Corner, t: number): Corner => {
  const nx = a.nx + (b.nx - a.nx) * t, ny = a.ny + (b.ny - a.ny) * t, nz = a.nz + (b.nz - a.nz) * t, l = Math.hypot(nx, ny, nz) || 1;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, nx: nx / l, ny: ny / l, nz: nz / l, f: a.f + (b.f - a.f) * t };
};
// Cuts a convex piece along the levels of its field: hands each part, with
// how many levels lie below it, to `emit`.
function slice(poly: Corner[], levels: readonly number[], emit: (part: Corner[], band: number) => void): void {
  let rest = poly;
  for (let b = 0; b < levels.length && rest.length >= 3; b++) {
    const c = levels[b]!, below: Corner[] = [], above: Corner[] = [];
    for (let i = 0; i < rest.length; i++) {
      const p = rest[i]!, q = rest[(i + 1) % rest.length]!;
      if (p.f < c) below.push(p); else above.push(p);
      if ((p.f < c) !== (q.f < c)) { const m = mix(p, q, (c - p.f) / (q.f - p.f)); below.push(m); above.push(m); }
    }
    if (below.length >= 3) emit(below, b);
    rest = above;
  }
  if (rest.length >= 3) emit(rest, levels.length);
}

// The ravine's reach, for a quick test before measuring.
const RAVINE_BOX = { x0: Math.min(...RAVINE.map((p) => p[0])) - 18, x1: Math.max(...RAVINE.map((p) => p[0])) + 18, z0: Math.min(...RAVINE.map((p) => p[1])) - 18, z1: Math.max(...RAVINE.map((p) => p[1])) + 18 };
const nearRavine = (x: number, z: number, r: number): { d: number; y: number } | null =>
  x < RAVINE_BOX.x0 || x > RAVINE_BOX.x1 || z < RAVINE_BOX.z0 || z > RAVINE_BOX.z1 ? null : ((b) => (b.d < r ? b : null))(ravineBed(x, z));

export interface Terrain {
  // The collider's heights, row by row.
  heights: Float32Array;
  // The ground as drawn (the coarse cells' surface where the mesh is coarse): what to stand things on.
  drawn: (x: number, z: number) => number;
}

export function* buildTerrain(k: Kit, parent: THREE.Object3D, phase: (name: string) => void): Generator<void, Terrain, void> {
  phase('terrain:heights');
  const { h, moved } = yield* gridHeights(2);
  phase('terrain:collider');
  k.phys.heightfield(GRID.x0, GRID.z0, GRID.cell, GRID.nx, GRID.nz, h);
  yield;

  // Which 2 x 2 blocks of cells the mesh draws coarse: well away from the road, the ravine and the tarn.
  phase('terrain:plan');
  const { x0, z0, cell, nx, nz } = GRID;
  const nbx = nx / 2, nbz = nz / 2;
  const coarse = new Uint8Array(nbx * nbz);
  for (let bi = 0; bi < nbz; bi++) {
    for (let bj = 0; bj < nbx; bj++) {
      const cx = x0 + (bj * 2 + 1) * cell, cz = z0 + (bi * 2 + 1) * cell;
      coarse[bi * nbx + bj] = walkDistance(cx, cz) > 14 && !nearRavine(cx, cz, 15) && Math.hypot(cx - TARN.x, cz - TARN.z) > TARN.r + 10 ? 1 : 0;
    }
    if (bi % 12 === 11) yield;
  }
  const isCoarse = (bi: number, bj: number): boolean => bi >= 0 && bj >= 0 && bi < nbz && bj < nbx && coarse[bi * nbx + bj] === 1;
  const H = (i: number, j: number): number => h[Math.min(nz, Math.max(0, i)) * (nx + 1) + Math.min(nx, Math.max(0, j))]!;
  const M = (i: number, j: number): number => moved[Math.min(nz, Math.max(0, i)) * (nx + 1) + Math.min(nx, Math.max(0, j))]!;
  // A drawn corner: a corner halfway along a coarse cell's edge (or along
  // the seam with the valley's 2 m grid) lies on that edge.
  const at = (i: number, j: number): number => {
    i = Math.min(nz, Math.max(0, i)); j = Math.min(nx, Math.max(0, j));
    const oi = i & 1, oj = j & 1;
    if (oi === 0 && oj === 1 && (i === 0 || isCoarse(i / 2 - 1, j >> 1) || isCoarse(i / 2, j >> 1))) return (H(i, j - 1) + H(i, j + 1)) / 2;
    if (oi === 1 && oj === 0 && (isCoarse(i >> 1, j / 2 - 1) || isCoarse(i >> 1, j / 2))) return (H(i - 1, j) + H(i + 1, j)) / 2;
    return H(i, j);
  };
  const drawn = (x: number, z: number): number => {
    const fx = Math.min(nx - 1e-6, Math.max(0, (x - x0) / cell)), fz = Math.min(nz - 1e-6, Math.max(0, (z - z0) / cell));
    const j = Math.floor(fx), i = Math.floor(fz);
    const s = isCoarse(i >> 1, j >> 1) ? 2 : 1;
    const ia = i - (i % s), ja = j - (j % s), u = (fx - ja) / s, v = (fz - ia) / s;
    const h00 = at(ia, ja), h11 = at(ia + s, ja + s);
    return v > u ? h00 + (at(ia + s, ja) - h00) * v + (h11 - at(ia + s, ja)) * u : h00 + (at(ia, ja + s) - h00) * u + (h11 - at(ia, ja + s)) * v;
  };

  phase('terrain:mesh');
  const mat = toon(0xffffff);
  mat.vertexColors = true;
  const p = new THREE.Vector3(), q = new THREE.Vector3(), r = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nv = new THREE.Vector3();
  const normalAt = (i: number, j: number, s: number, out: THREE.Vector3): THREE.Vector3 =>
    out.set(-(at(i, j + s) - at(i, j - s)) / (2 * s * cell), 1, -(at(i + s, j) - at(i - s, j)) / (2 * s * cell)).normalize();
  let pos: number[] = [], nrm: number[] = [], clr: number[] = [];
  // How a piece of ground is filled: the field its fills change along, the
  // levels they change at, and the fill between each two.
  interface Fill { field: (c: Corner) => number; levels: number[]; tone: (band: number) => THREE.Color }
  const solid = (tone: THREE.Color): Fill => ({ field: () => 0, levels: [], tone: () => tone });
  // Strata: a level every `height` metres through the warped beds.
  const strata = (tones: THREE.Color[], height: number, lo: number, hi: number): Fill => {
    const base = Math.floor(lo / height), levels: number[] = [];
    for (let l = (base + 1) * height; l < hi; l += height) levels.push(l);
    return { field: (c) => strataY(c.x, c.y, c.z), levels, tone: (b) => stratum(tones, base + b) };
  };
  // The open ground's patches.
  const meadow = (cy: number, cz: number): Fill => {
    const field = (c: Corner): number => patchAt(c.x, c.z);
    // The far side's dry grass lies in broad sweeps, not the hollow's patches.
    if (cz > 262 && cy > 34) return { field: (c) => Math.sin(c.x * 0.07 + c.z * 0.04) + Math.sin(c.z * 0.09 - c.x * 0.03 + 1.3), levels: [-0.5, 0.9], tone: (b) => [COL.grass[0]!, COL.dry[0]!, COL.dry[1]!][b]! };
    if (cy > 30) return { field, levels: [-1.1, 0.2, 1.0], tone: (b) => [COL.grass[0]!, COL.grass[1]!, COL.slope, COL.wood][b]! };
    return { field, levels: [-1.1, 0.45, 1.0], tone: (b) => [COL.grass[0]!, COL.grass[1]!, COL.grass[2]!, COL.wood][b]! };
  };
  const fillFor = (k: Corner[], face: THREE.Vector3, work: number): Fill => {
    const cx = (k[0]!.x + k[1]!.x + k[2]!.x) / 3, cy = (k[0]!.y + k[1]!.y + k[2]!.y) / 3, cz = (k[0]!.z + k[1]!.z + k[2]!.z) / 3;
    const lo = Math.min(k[0]!.y, k[1]!.y, k[2]!.y);
    const land = (): Fill => {
      if (face.y < 0.6) { const f = k.map((c) => strataY(c.x, c.y, c.z)); return strata(STRATA, 1.9, Math.min(...f), Math.max(...f)); }
      // Cut deep into the hill beside the road: bare earth in its own beds.
      if (work < -1.0 && face.y < 0.74 && walkDistance(cx, cz) < 4.5) { const f = k.map((c) => strataY(c.x, c.y, c.z)); return strata(EARTH, 1.2, Math.min(...f), Math.max(...f)); }
      if (face.y < 0.78) return solid(COL.slope);
      // The road's banks of fill, grown over a shade darker.
      if (work > 0.5 && face.y < 0.97) return solid(COL.fill);
      return meadow(cy, cz);
    };
    // The waterline: the bed under the water, a band of wet earth, then the land above.
    const shore = (waterAt: (c: Corner) => number, under: number, wet: number): Fill => {
      const above = land(), top = above.tone(Math.floor(above.levels.length / 2));
      return { field: (c) => c.y - waterAt(c), levels: [under, wet], tone: (b) => [COL.bed, COL.wet, top][b]! };
    };
    // The tarn's surface lies a hand under its level, the creek's a hand over its bed (src/world/pass/sites.ts).
    if (Math.hypot(cx - TARN.x, cz - TARN.z) < TARN.r + 4 && lo < TARN.y + 0.3) return shore(() => TARN.y - 0.25, 0.02, 0.4);
    const rv = nearRavine(cx, cz, 3);
    if (rv && lo - rv.y < 0.8) return shore((c) => ravineBed(c.x, c.z).y + 0.12, 0.04, 0.5);
    return land();
  };
  const corner = (i: number, j: number, s: number, face: THREE.Vector3): Corner => {
    const x = x0 + j * cell, z = z0 + i * cell, y = at(i, j);
    const n = face.y > 0.94 ? face : normalAt(i, j, s, nv);
    return { x, y, z, nx: n.x, ny: n.y, nz: n.z, f: 0 };
  };
  const tri = (a: [number, number], b: [number, number], c: [number, number], s: number): void => {
    p.set(x0 + a[1] * cell, at(a[0], a[1]), z0 + a[0] * cell);
    q.set(x0 + b[1] * cell, at(b[0], b[1]), z0 + b[0] * cell);
    r.set(x0 + c[1] * cell, at(c[0], c[1]), z0 + c[0] * cell);
    const face = e1.subVectors(q, p).cross(e2.subVectors(r, p)).normalize();
    const k = [corner(a[0], a[1], s, face), corner(b[0], b[1], s, face), corner(c[0], c[1], s, face)];
    const work = (M(a[0], a[1]) + M(b[0], b[1]) + M(c[0], c[1])) / 3;
    const fill = fillFor(k, face, work);
    for (const v of k) v.f = fill.field(v);
    slice(k, fill.levels, (part, band) => {
      const t = fill.tone(band);
      for (let n = 1; n < part.length - 1; n++) for (const v of [part[0]!, part[n]!, part[n + 1]!]) {
        pos.push(v.x, v.y, v.z);
        nrm.push(v.nx, v.ny, v.nz);
        clr.push(t.r, t.g, t.b);
      }
    });
  };
  // Both halves split on the collider's diagonal, (i, j)-(i+s, j+s).
  const quad = (i: number, j: number, s: number): void => {
    tri([i, j], [i + s, j], [i + s, j + s], s);
    tri([i, j], [i + s, j + s], [i, j + s], s);
  };
  const skirt = (i: number, j: number): void => {
    const xa = x0 + j * cell, za = z0 + i * cell, zb = za + cell, ya = at(i, j), yb = at(i + 1, j), drop = -40;
    pos.push(...(j === 0 ? [xa, ya, za, xa, drop, za, xa, drop, zb, xa, ya, za, xa, drop, zb, xa, yb, zb] : [xa, ya, za, xa, drop, zb, xa, drop, za, xa, ya, za, xa, yb, zb, xa, drop, zb]));
    for (let v = 0; v < 6; v++) { nrm.push(j === 0 ? -1 : 1, 0, 0); clr.push(STRATA[4]!.r, STRATA[4]!.g, STRATA[4]!.b); }
  };
  const TILE = 12;
  for (let ti = 0; ti < nz; ti += TILE) for (let tj = 0; tj < nx; tj += TILE) {
    pos = []; nrm = []; clr = [];
    for (let i = ti; i < Math.min(nz, ti + TILE); i += 2) for (let j = tj; j < Math.min(nx, tj + TILE); j += 2) {
      if (isCoarse(i >> 1, j >> 1)) { quad(i, j, 2); continue; }
      for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) quad(i + a, j + b, 1);
    }
    // Skirts down the grid's east and west sides, so the land never shows an edge against the sky.
    if (tj === 0 || tj + TILE >= nx) for (let i = ti; i < Math.min(nz, ti + TILE); i++) skirt(i, tj === 0 ? 0 : nx);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(clr, 3));
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    m.castShadow = false;
    m.name = `pass:terrain:${ti}:${tj}`;
    m.userData.keep = true;
    parent.add(m);
    yield;
  }
  return { heights: h, drawn };
}
