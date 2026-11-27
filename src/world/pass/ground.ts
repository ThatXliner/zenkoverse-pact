import * as THREE from 'three';
import { toon } from '../../render/materials';
import { heightAt as valleyHeight } from '../valleyPlan';
import type { Kit } from '../kit';
import { GRID, onGrid, gridHeights, TARN } from './plan';

// The pass's land: one height grid for the collider and, drawn from the same
// corners, a terrain mesh in flat painted fills, cut into bands of rows so
// each is one slice of building and the bands cull apart. North of the grid
// (the cutting through the valley's cliff) the valley's own grid is the land.

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

// Flat fills by what the ground is: the hollow's grass, darker slope under
// the woods, a russet band of dry grass high on the far side, rock on
// anything steep, and the bed under the tarn.
const COL = {
  grass: new THREE.Color(0x8fae58), slope: new THREE.Color(0x6a8f52), wood: new THREE.Color(0x5d7f4a),
  dry: new THREE.Color(0xa9a56a), rock: new THREE.Color(0x9c9384), rockDark: new THREE.Color(0x857d70), bed: new THREE.Color(0x58694c),
};

export function* buildTerrain(k: Kit, parent: THREE.Object3D, phase: (name: string) => void): Generator<void, Float32Array, void> {
  phase('terrain:heights');
  const h = yield* gridHeights(3);
  phase('terrain:collider');
  k.phys.heightfield(GRID.x0, GRID.z0, GRID.cell, GRID.nx, GRID.nz, h);
  yield;
  phase('terrain:mesh');
  const { x0, z0, cell, nx, nz } = GRID;
  const at = (i: number, j: number): number => h[Math.min(nz, Math.max(0, i)) * (nx + 1) + Math.min(nx, Math.max(0, j))]!;
  const mat = toon(0xffffff);
  mat.vertexColors = true;
  const BAND = 6;
  const p = new THREE.Vector3(), q = new THREE.Vector3(), r = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nv = new THREE.Vector3();
  const gridNormal = (i: number, j: number, out: THREE.Vector3): THREE.Vector3 => out.set(-(at(i, j + 1) - at(i, j - 1)) / (2 * cell), 1, -(at(i + 1, j) - at(i - 1, j)) / (2 * cell)).normalize();
  const tmp = new THREE.Color();
  for (let i0 = 0; i0 < nz; i0 += BAND) {
    const pos: number[] = [], nrm: number[] = [], clr: number[] = [];
    const tri = (c: [number, number][]): void => {
      const [[ia, ja], [ib, jb], [ic, jc]] = c as [[number, number], [number, number], [number, number]];
      p.set(x0 + ja * cell, at(ia, ja), z0 + ia * cell); q.set(x0 + jb * cell, at(ib, jb), z0 + ib * cell); r.set(x0 + jc * cell, at(ic, jc), z0 + ic * cell);
      const face = e1.subVectors(q, p).cross(e2.subVectors(r, p)).normalize();
      const y = (p.y + q.y + r.y) / 3, cx = (p.x + q.x + r.x) / 3, cz = (p.z + q.z + r.z) / 3;
      const tarn = Math.hypot(cx - TARN.x, cz - TARN.z) < TARN.r + 1 && y < TARN.y - 0.1;
      // Two greens broken up in patches, so the slopes read painted and not flat.
      const patch = Math.sin(cx * 0.09 + cz * 0.05) + Math.sin(cz * 0.11 - cx * 0.04 + 1.3);
      const k2 = tarn ? COL.bed : face.y < 0.55 ? (patch > 0.4 ? COL.rockDark : COL.rock) : face.y < 0.8 ? COL.slope
        : cz > 262 && y > 34 && patch > -0.2 ? COL.dry : patch > 0.6 ? COL.wood : y > 30 ? COL.slope : COL.grass;
      tmp.copy(k2);
      c.forEach(([ii, jj], idx) => {
        const v = idx === 0 ? p : idx === 1 ? q : r;
        pos.push(v.x, v.y, v.z);
        const nn = face.y > 0.94 ? face : gridNormal(ii, jj, nv);
        nrm.push(nn.x, nn.y, nn.z);
        clr.push(tmp.r, tmp.g, tmp.b);
      });
    };
    for (let i = i0; i < Math.min(nz, i0 + BAND); i++) for (let j = 0; j < nx; j++) {
      tri([[i, j], [i + 1, j], [i + 1, j + 1]]);
      tri([[i, j], [i + 1, j + 1], [i, j + 1]]);
    }
    // Skirts down the grid's east and west sides, so the land never shows an edge against the sky.
    for (let i = i0; i < Math.min(nz, i0 + BAND); i++) for (const j of [0, nx]) {
      const xa = x0 + j * cell, za = z0 + i * cell, zb = za + cell, ya = at(i, j), yb = at(i + 1, j), drop = -40;
      const quad = j === 0 ? [xa, ya, za, xa, drop, za, xa, drop, zb, xa, ya, za, xa, drop, zb, xa, yb, zb] : [xa, ya, za, xa, drop, zb, xa, drop, za, xa, ya, za, xa, yb, zb, xa, drop, zb];
      pos.push(...quad);
      for (let v = 0; v < 6; v++) { nrm.push(j === 0 ? -1 : 1, 0, 0); clr.push(COL.rockDark.r, COL.rockDark.g, COL.rockDark.b); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(clr, 3));
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    m.castShadow = false;
    m.name = `pass:terrain:${i0}`;
    m.userData.keep = true;
    parent.add(m);
    yield;
  }
  return h;
}
