import * as THREE from 'three';
import { Strokes, TONES } from '../strokes';
import { tree, rng, type Kit, type TreeKind } from '../kit';
import { ROUTE, SITES, ROAD_HALF, walkDistance, along } from './route';
import { GRID, GRID_X1, GRID_Z1, KNOLL, TARN, COL, ravineBed } from './plan';
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

  // The low growth, in unlined strokes as in the valley: tufts along the
  // road's verges with red spider lilies in drifts and wild flowers between,
  // lilies and reeds on the creek's banks, reeds round the tarn, tufts and
  // flowers over the open slopes, and dry silver grass on the far side's
  // open ground and along its shoulders.
  phase('woods:growth');
  {
    const band = k.stretch('pass:growth', parent);
    const s = new Strokes(rand, ground);
    const BLOOMS = [TONES.white, TONES.yellow, TONES.violet];
    let tested = 0;
    for (let z0 = GRID.z0; z0 < GRID_Z1 - 4; z0 += 40) {
      for (let x = GRID.x0 + 2; x < GRID_X1 - 2; x += 1.7) for (let z = z0; z < Math.min(z0 + 40, GRID_Z1 - 4); z += 1.7) {
        if (++tested % 80 === 0) yield;
        const jx = x + (rand() - 0.5) * 1.6, jz = z + (rand() - 0.5) * 1.6, roll = rand();
        const w = walkDistance(jx, jz);
        if (w > 30 || inView(jx, jz)) continue;
        const sl = slope(jx, jz);
        if (sl > 0.9) continue;
        along(jx, jz, al);
        // Off the road's surface (and its steps), and out of the water.
        if (al.d < ROAD_HALF + 0.25 || ground(jx, jz) < TARN.y + 0.05) continue;
        const far = jz > COL.z + 6, tarn = Math.hypot(jx - TARN.x, jz - TARN.z) - TARN.r;
        const bed = Math.abs(jx - 85) < 25 && jz > 150 && jz < 240 ? ravineBed(jx, jz) : null;
        const bank = bed && bed.d > 0.9 && bed.d < 2.8 && ground(jx, jz) - bed.y < 1.2;
        const verge = w < 2.2;
        if (tarn > -0.6 && tarn < 1.4 && ground(jx, jz) < TARN.y + 0.5) { if (roll < 0.7) s.reeds(jx, jz, 1.0 + rand() * 0.5); continue; }
        if (bank) {
          if (roll < 0.3) { for (let n = 0; n < 3 + Math.floor(rand() * 4); n++) s.lily(jx + (rand() - 0.5) * 1.2, jz + (rand() - 0.5) * 1.2, 0.3 + rand() * 0.12); }
          else if (roll < 0.55) s.reeds(jx, jz, 0.8 + rand() * 0.4);
          else if (roll < 0.8) s.tuft(jx, jz, 0.3 + rand() * 0.2);
          continue;
        }
        if (verge) {
          // Drifts of lilies where a slow wave along the road says so.
          const drift = Math.sin(jx * 0.21 + jz * 0.17) + Math.sin(jz * 0.09 - jx * 0.13 + 2);
          if (drift > 1.0 && roll < 0.55) { for (let n = 0; n < 3 + Math.floor(rand() * 4); n++) s.lily(jx + (rand() - 0.5) * 0.9, jz + (rand() - 0.5) * 0.9, 0.3 + rand() * 0.12); continue; }
          if (roll < 0.55) { for (let n = 0; n < 2 + Math.floor(rand() * 2); n++) s.tuft(jx + (rand() - 0.5) * 0.8, jz + (rand() - 0.5) * 0.8, 0.25 + rand() * 0.2, far ? TONES.dryTuft : TONES.tuft); continue; }
          if (roll < 0.68) { const kind = BLOOMS[Math.floor(rand() * BLOOMS.length)]!; for (let n = 0; n < 3 + Math.floor(rand() * 3); n++) s.flower(jx + (rand() - 0.5) * 1.1, jz + (rand() - 0.5) * 1.1, kind, 0.15 + rand() * 0.08, 0.06); }
          continue;
        }
        if (far) {
          // Silver grass in its patches, thinner off them.
          const patch = Math.sin(jx * 0.09 + jz * 0.05) + Math.sin(jz * 0.11 - jx * 0.04 + 1.3);
          if (sl < 0.75 && ((patch > -0.2 && roll < 0.2) || roll < 0.04)) { s.clump(jx, jz, 1.0 + rand() * 0.5); continue; }
          if (roll > 0.9) s.tuft(jx, jz, 0.3 + rand() * 0.2, TONES.dryTuft);
          continue;
        }
        // The open slopes of the hollow: a scatter of tufts and, here and there, flowers.
        if (sl < 0.7 && w < 16) {
          if (roll < 0.3) { for (let n = 0; n < 1 + Math.floor(rand() * 3); n++) s.tuft(jx + (rand() - 0.5) * 0.9, jz + (rand() - 0.5) * 0.9, 0.28 + rand() * 0.2); }
          else if (roll < 0.36) { const kind = BLOOMS[Math.floor(rand() * BLOOMS.length)]!; for (let n = 0; n < 3; n++) s.flower(jx + (rand() - 0.5) * 1.2, jz + (rand() - 0.5) * 1.2, kind, 0.15 + rand() * 0.08, 0.06); }
        }
      }
      s.mesh(band, `pass:growth:${z0}`);
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
      const cz = z + (side > 0 ? 20 : 0);
      // None stands out over the low country past the grid's south end: the
      // outskirts and the city lie there, and a cone's foot would rise
      // through their streets (it filled the top-down view over the Kuroda yard).
      if (cz + r > GRID_Z1) continue;
      k.cone(band, blue[(i + (side > 0 ? 1 : 0)) % 3]!, x, h / 2 - 6, cz, r, h, 7, [0, i * 1.3, 0], false);
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
