import * as THREE from 'three';
import { toon } from '../../render/materials';
import { tree, rng, type Kit, type TreeKind } from '../kit';
import { ROUTE, SITES, walkDistance, along } from './route';
import { GRID, GRID_X1, GRID_Z1, KNOLL, TARN, COL } from './plan';
import type { Ground } from './road';

// The woods over the pass: old cedars lining the stone stretches in pairs,
// as they line the old highways, and mixed wood on the slopes, cedar and
// pine with maples gone red and a few gold trees, thinning on the far side
// into dry silver grass. The knoll and the ground south of the lookout stay
// clear, so the view from the col reaches the horizon. Trees near the road
// fade in clumps for the top-down camera; the rest are scenery and cast no shadow.

const CLUMP = 24;
const NEAR = 12;

export function* buildWoods(k: Kit, parent: THREE.Object3D, ground: Ground, phase: (name: string) => void): Generator<void, THREE.Mesh[], void> {
  phase('woods:avenue');
  const clumps = new Map<string, THREE.Mesh[]>();
  const rand = rng(61);
  const lookout = SITES.find((s) => s.id === 'lookout')!;
  const slope = (x: number, z: number): number => Math.hypot(ground(x + 1, z) - ground(x - 1, z), ground(x, z + 1) - ground(x, z - 1)) / 2;
  // The view south from the lookout: a wedge kept clear of anything tall.
  const inView = (x: number, z: number): boolean => {
    const dx = x - lookout.x, dz = z - lookout.z;
    return dz > 2 && Math.abs(Math.atan2(dx, dz) - 0.05) < 0.5 && dz < 90;
  };
  const place = (band: THREE.Group, x: number, z: number, kind: TreeKind, s: number, seed: number): void => {
    const near = walkDistance(x, z) < NEAR;
    const parts = tree(k, band, x, ground(x, z), z, kind, s, seed, !near);
    if (!near) return;
    const name = `pass-grove:${Math.floor(x / CLUMP)}:${Math.floor(z / CLUMP)}`;
    // Marked for the cutaway, so the band's bake leaves them for the clump.
    for (const m of parts) m.userData.cutaway = name;
    const list = clumps.get(name);
    if (list) list.push(...parts); else clumps.set(name, parts);
  };
  const al = { d: 0, y: 0, seg: 0, t: 0, x: 0, z: 0 };
  // The bridge's ends stay open, so its frames read against the sky.
  const span = ROUTE.findIndex((n) => n.pave === 'rope');
  const nearBridgeEnd = (x: number, z: number): boolean => [ROUTE[span]!, ROUTE[span + 1]!].some((n) => Math.hypot(x - n.x, z - n.z) < 8);
  let placed = 0;

  // The cedar avenue: pairs along the stone stretches and the switchbacks.
  {
    const band = k.stretch('pass:avenue', parent);
    for (let i = 0; i < ROUTE.length - 1; i++) {
      const a = ROUTE[i]!, b = ROUTE[i + 1]!;
      if (a.pave !== 'stone' && !(a.z > 140 && a.z < 200)) continue;
      const len = Math.hypot(b.x - a.x, b.z - a.z), nx = -(b.z - a.z) / len, nz = (b.x - a.x) / len;
      // Along a stretch that runs across the screen, only the far (north) side:
      // the top-down camera hangs to the south and would look through the near row.
      const across = Math.abs(b.x - a.x) > Math.abs(b.z - a.z);
      for (let d = 3; d < len - 2; d += 7.5 + rand() * 3) {
        for (const side of [-1, 1]) {
          if (rand() < 0.25 || (across && nz * side > 0)) continue;
          const off = a.edge + 1.2 + rand() * 1.5, x = a.x + (b.x - a.x) * (d / len) + nx * side * off, z = a.z + (b.z - a.z) * (d / len) + nz * side * off;
          if (walkDistance(x, z) < 0.9 || slope(x, z) > 1.3 || inView(x, z) || nearBridgeEnd(x, z)) continue;
          place(band, x, z, 'cedar', 1.25 + rand() * 0.45, Math.floor(rand() * 100));
        }
      }
      yield;
    }
  }

  // The slopes, in bands down the grid.
  const STEP = 4.6, BAND = 12;
  for (let z0 = GRID.z0 - 44; z0 < GRID_Z1; z0 += BAND) {
    phase('woods:slopes');
    const band = k.stretch(`pass:wood:${z0}`, parent);
    for (let x = GRID.x0 + 2; x < GRID_X1 - 2; x += STEP) for (let z = Math.max(z0, 92); z < Math.min(z0 + BAND, GRID_Z1 - 2); z += STEP) {
      const jx = x + (rand() - 0.5) * 3.4, jz = z + (rand() - 0.5) * 3.4;
      const r = rand(), kindRoll = rand(), s = 0.95 + rand() * 0.6, seed = Math.floor(rand() * 100);
      const w = walkDistance(jx, jz);
      if (w < 1.2) continue;
      // North of the pass grid only the cutting's rims carry trees (the valley's own woods are the valley's).
      if (jz < GRID.z0 && (along(jx, jz, al).d > 18 || ground(jx, jz) < al.y + 5)) continue;
      if (slope(jx, jz) > 1.05 || inView(jx, jz) || Math.hypot(jx - TARN.x, jz - TARN.z) < TARN.r + 2.5) continue;
      if (Math.hypot(jx - KNOLL.x, jz - KNOLL.z) < KNOLL.r * 0.8) continue;
      // Close to the road on its south side a tree stands between the top-down camera and the player.
      if (w < 8 && jz > along(jx, jz, al).z + 1) continue;
      const far = jz > COL.z + 8;
      const dense = w < 30 ? 0.42 : 0.3;
      if (r > (far ? dense * 0.7 : dense)) continue;
      const kind: TreeKind = far
        ? kindRoll < 0.35 ? 'pine' : kindRoll < 0.6 ? 'gold' : kindRoll < 0.85 ? 'maple' : 'cedar'
        : kindRoll < 0.42 ? 'cedar' : kindRoll < 0.66 ? 'pine' : kindRoll < 0.9 ? 'maple' : 'gold';
      place(band, jx, jz, kind, s, seed);
      if (++placed % 12 === 0) yield;
    }
    yield;
    phase('woods:bake');
    k.bake(band);
    yield;
  }

  // Dry silver grass on the far side's open ground and along the road's shoulders there.
  phase('woods:grass');
  const grassGold = toon(0xd9c27a, { side: THREE.DoubleSide }), grassGreen = toon(0xacb86a, { side: THREE.DoubleSide }), grassPlume = toon(0xf1e7cf, { side: THREE.DoubleSide });
  {
    const band = k.stretch('pass:grass', parent);
    for (let z0 = COL.z + 6; z0 < GRID_Z1 - 4; z0 += 48) {
    const gold: number[] = [], green: number[] = [], plumes: number[] = [];
    for (let x = GRID.x0 + 2; x < GRID_X1 - 2; x += 2.6) for (let z = z0; z < Math.min(z0 + 48, GRID_Z1 - 4); z += 2.6) {
      const jx = x + (rand() - 0.5) * 2.2, jz = z + (rand() - 0.5) * 2.2;
      const w = walkDistance(jx, jz);
      if (w < 0.6 || slope(jx, jz) > 0.9) continue;
      const patch = Math.sin(jx * 0.09 + jz * 0.05) + Math.sin(jz * 0.11 - jx * 0.04 + 1.3);
      if (!(patch > -0.2 && rand() < 0.55) && !(w < 3 && rand() < 0.35)) continue;
      const y = ground(jx, jz), n = 3 + Math.floor(rand() * 3), spin = rand() * Math.PI * 2, tall = 1.0 + rand() * 0.5;
      for (let i = 0; i < n; i++) {
        const a = spin + (i / n) * Math.PI * 2 + rand() * 0.5, lean = 0.2 + rand() * 0.2, h = tall * (0.75 + rand() * 0.5), bw = 0.12 + rand() * 0.05;
        const tx = jx + Math.cos(a) * lean * h, tz = jz + Math.sin(a) * lean * h, mx = jx + Math.cos(a) * lean * h * 0.45, mz = jz + Math.sin(a) * lean * h * 0.45, my = y + h * 0.45;
        const px = -Math.sin(a) * bw, pz = Math.cos(a) * bw;
        const leaf = rand() < 0.6 ? gold : green;
        leaf.push(jx, y, jz, mx + px, my, mz + pz, tx, y + h, tz, jx, y, jz, tx, y + h, tz, mx - px, my, mz - pz);
        if (rand() < 0.4) plumes.push(tx - px * 0.8, y + h - 0.5, tz - pz * 0.8, tx + px * 0.8, y + h - 0.5, tz + pz * 0.8, tx + Math.cos(a) * 0.12, y + h + 0.12, tz + Math.sin(a) * 0.12);
      }
      if (++placed % 40 === 0) yield;
    }
    k.tris(band, gold, grassGold, false, true);
    yield;
    k.tris(band, green, grassGreen, false, true);
    k.tris(band, plumes, grassPlume, false, true);
    yield;
    }
  }

  // Boulders on the slopes and at the foot of the banks.
  phase('woods:rocks');
  {
    const band = k.stretch('pass:rocks', parent);
    for (let i = 0; i < 260; i++) {
      const x = GRID.x0 + rand() * (GRID_X1 - GRID.x0), z = 96 + rand() * (GRID_Z1 - 100);
      const w = walkDistance(x, z);
      if (w < 0.8 || w > 40 || inView(x, z)) continue;
      const r = 0.5 + rand() * (w < 6 ? 0.5 : 1.3);
      k.rock(band, rand() < 0.5 ? 0x9a948a : 0x7d7870, x, ground(x, z) + r * 0.2, z, r, 0, [1.3, 0.7, 1.0], [0, rand() * 6, 0]);
    }
    k.bake(band);
    yield;
  }

  // Mountains standing back beyond the land's east and west edges, so from
  // the outskirts and the far side the edge of the grid never shows against the sky.
  phase('woods:mountains');
  {
    const band = k.stretch('pass:mountains', parent);
    const blue = [0x6f93a4, 0x7d9fae, 0x6a8f8a];
    for (const side of [-1, 1]) for (let z = 150, i = 0; z < 470; z += 52, i++) {
      const r = 58 + ((i * 37) % 24), h = 78 + ((i * 53) % 36), x = side < 0 ? GRID.x0 - r * 0.55 : GRID_X1 + r * 0.55;
      k.cone(band, blue[(i + (side > 0 ? 1 : 0)) % 3]!, x, h / 2 - 6, z + (side > 0 ? 20 : 0), r, h, 7, [0, i * 1.3, 0], false);
    }
    k.bake(band);
    yield;
  }

  // Each clump of near trees as one mesh that fades as one.
  phase('woods:clumps');
  const occluders: THREE.Mesh[] = [];
  for (const [name, parts] of clumps) {
    occluders.push(k.clump(parts, parent, name));
    yield;
  }
  return occluders;
}
