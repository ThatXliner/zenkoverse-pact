import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Physics, RAPIER } from '../physics/world';
import type { LightPool } from '../render/lightPool';
import { toon, faceted, paintedSign } from '../render/materials';
import { waterMaterial, fallMaterial, foamMaterial } from './water';
import {
  type Pt, FLOOR_Y, WATER_Y, VALLEY, ROAD, ROAD_HALF, PATHS, PATH_HALF, STREAM, STREAM_HALF, BANK, FALLS, EXIT, BRIDGE, STONES,
  FIELD, GROUNDS, GINKGO, TERRACES, MEADOW, SHRINE, STONE_AT, CLIFF, heightAt, cliffDistance, cliffRun, nearest, nearPath, tierY, smooth,
} from './valleyPlan';
import { walkDistance as passRoad } from './pass/route';
import type { Zone, Footprint } from './compound';

// The open valley the compound sits in (the plan is src/world/valleyPlan.ts):
// one terrain mesh in flat painted fills over a height-grid collider, the
// stream and its falls, the road with its red bridge, the paths, the swept
// field by the gate, the training ground, the terraces, the tall grass, the
// roadside shrine, the old ginkgo and the woods. Everything static is added
// to the compound's group and baked with it (src/world/batch.ts).

export interface ValleyKit {
  g: THREE.Group;
  physics: Physics;
  lights: LightPool;
  onRoof(mesh: THREE.Mesh, roof: string, ghost?: boolean): void;
  tag(col: RAPIER.Collider, surface: string): RAPIER.Collider;
  // The stone lanterns' flames go in here.
  flames: THREE.Vector3[];
  mats: Record<'woodDark' | 'woodLight' | 'stone' | 'stoneDark' | 'iron' | 'tile' | 'tileEdge' | 'lantern', THREE.Material>;
}

export interface Valley {
  zones: Zone[];
  footprints: Footprint[];
  update(time: number): void;
}

// The terrain grid: 2 m cells over the valley and the slopes behind it.
const GRID = { x0: -112, z0: -92, cell: 2, n: 113 } as const;
// Floor trees fade in the cutaway in clumps this many metres across.
const CLUMP = 26;

type Rot = [number, number, number];

// A small seeded random, so the woods grow the same every time.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function buildValley(k: ValleyKit): Valley {
  const { physics, lights, onRoof, tag, mats: M } = k;
  // Everything here hangs off one group, so the colour bake below sees only the valley.
  const g = new THREE.Group();
  k.g.add(g);
  const zones: Zone[] = [];
  const footprints: Footprint[] = [];
  const animated: THREE.ShaderMaterial[] = [];

  // One material per colour, shared, so the bake folds each into one mesh.
  const path = toon(0xc8ad86), rut = toon(0xb2966f), earth = toon(0xd5c098), sand = toon(0xe6d3ad);
  for (const m of [path, rut, earth, sand]) { m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -4; }
  const rock = toon(0x9a948a), rockDark = toon(0x7d7870);
  const red = toon(0xcf4a32), redDark = toon(0x9e3426), ink = toon(0x2a2528);
  const straw = toon(0xd8bf86), rope = toon(0x8a6a44), paper = toon(0xf6eedc);
  const pine = toon(0x3e7d4a), pineDark = toon(0x2f6440), cedar = toon(0x2d5c45), maple = toon(0xe8713a), gold = toon(0xe6b83c);
  const ginkgo = toon(0xeebd3e), ginkgoLight = toon(0xf6d460), leafLitter = toon(0xf0c64a, { side: THREE.DoubleSide });
  const rice = toon(0x74b04c, { side: THREE.DoubleSide });
  const grassMat = toon(0xffffff, { side: THREE.DoubleSide, transparent: true });
  grassMat.vertexColors = true;
  // The tall grass is painted without ink: it writes no depth, so the ink
  // pass never sees it, and a field of a thousand outlined leaves no longer
  // closes into a dark mass at a distance. It draws after everything solid
  // (and after the water), still hidden behind whatever stands in front.
  // Each leaf is one stroke, darker at its foot and pale at its tip.
  grassMat.depthWrite = false;
  const terraceSide = toon(0x7d8a4e), bund = toon(0x8aab57);
  const meadowFill = toon(0xb7b36c);
  meadowFill.polygonOffset = true; meadowFill.polygonOffsetFactor = -1; meadowFill.polygonOffsetUnits = -2;
  const bronze = toon(0x5d7f6c);
  const stream = waterMaterial(0x3f86b6, 0x8ad0ea), paddy = waterMaterial(0x7fb3c6, 0xd2e9ef);
  const falls = fallMaterial(0x7cc4e4, 0xc8ecf6), foam = foamMaterial(FALLS.x, -51.2, 2.8);
  animated.push(stream, paddy, falls, foam);
  const lanternGlow = M.lantern;
  const groveMat = toon(0xffffff), paintedMat = toon(0xffffff);
  groveMat.vertexColors = true;
  paintedMat.vertexColors = true;
  const clumps = new Map<string, THREE.Mesh[]>();

  // ------------------------------------------------------------ primitives
  const at = (x: number, y: number, z: number, rotY = 0): THREE.Group => { const p = new THREE.Group(); p.position.set(x, y, z); p.rotation.y = rotY; g.add(p); return p; };
  const add = (p: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rot?: Rot, shadow = true): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (rot) m.rotation.set(...rot);
    m.castShadow = shadow;
    m.receiveShadow = true;
    p.add(m);
    return m;
  };
  const box = (p: THREE.Object3D, mat: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number, rot?: Rot, shadow = true): THREE.Mesh => add(p, new THREE.BoxGeometry(w, h, d), mat, x, y, z, rot, shadow);
  const cyl = (p: THREE.Object3D, mat: THREE.Material, x: number, y: number, z: number, rTop: number, rBot: number, h: number, seg = 8, rot?: Rot, shadow = true): THREE.Mesh => add(p, new THREE.CylinderGeometry(rTop, rBot, h, seg), mat, x, y, z, rot, shadow);
  // A collider in a prop's frame (centre and half size).
  const solid = (p: THREE.Object3D, x: number, y: number, z: number, hx: number, hy: number, hz: number, surface = 'stone', quat?: THREE.Quaternion): void => {
    p.updateMatrixWorld(true);
    const c = p.localToWorld(new THREE.Vector3(x, y, z));
    const q = p.getWorldQuaternion(new THREE.Quaternion());
    if (quat) q.multiply(quat);
    tag(physics.staticBox(c, new THREE.Vector3(hx, hy, hz), q), surface);
  };
  const AX: Rot = [0, 0, Math.PI / 2];
  const ground = (x: number, z: number): number => heightAt(x, z);

  // ------------------------------------------------------------ terrain
  // Heights at the grid's corners and the same grid as the collider, then
  // one mesh of flat-painted triangles over it. Where the ground bends
  // faster than a 2 m cell can follow (the stream's banks, the pool, the
  // cliff faces) a cell is cut into a finer grid that samples the plan's own
  // height, so a bank curves and the waterline runs as a line instead of a
  // row of teeth. A fine edge against a plain cell follows that cell's edge,
  // so the two meet without a crack. The cliff faces in the fine grid also
  // carry flutes and ledges; that is paint only (the wall below holds you).
  {
    const { x0, z0, cell, n } = GRID;
    const heights = new Float32Array((n + 1) * (n + 1));
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) heights[i * (n + 1) + j] = heightAt(x0 + j * cell, z0 + i * cell);
    tag(physics.staticHeightfield(x0, z0, cell, n, heights), 'ground');

    const F = 3, fc = cell / F, nf = n * F;
    const fineCells = new Uint8Array(n * n);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const cx = x0 + (j + 0.5) * cell, cz = z0 + (i + 0.5) * cell, d = cliffDistance(cx, cz);
      const bank = d < 2 && nearest(cx, cz, STREAM) < STREAM_HALF + BANK + 2.2;
      const pool = Math.hypot(cx - FALLS.x, cz - FALLS.z) < FALLS.rim + 2.4;
      const face = d > -1.5 && d < cliffRun(cx, cz) + 2;
      fineCells[i * n + j] = bank || pool || face ? 1 : 0;
    }
    const plain = (i: number, j: number): boolean => i >= 0 && j >= 0 && i < n && j < n && fineCells[i * n + j] === 0;
    const H = (i: number, j: number): number => heights[Math.min(n, Math.max(0, i)) * (n + 1) + Math.min(n, Math.max(0, j))]!;
    const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
    // The painted height: the plan's, with the cliff's flutes and ledges.
    const painted = (x: number, z: number): number => {
      const y = heightAt(x, z), d = cliffDistance(x, z), run = cliffRun(x, z);
      if (d <= 0.25 || d >= run + 1.2) return y;
      // Fading out into the pass road's cutting, whose banks are the road's (src/world/pass/).
      const w = smooth(0.25, 1.6, d) * smooth(run + 1.2, run - 0.4, d) * smooth(2, 8, passRoad(x, z));
      const flute = Math.sin(x * 0.62 + Math.sin(z * 0.37) * 1.8) * Math.sin(z * 0.66 + Math.sin(x * 0.29) * 1.8);
      const band = (y - CLIFF.rise) / 2.3, ledge = (Math.floor(band) + smooth(0.45, 1, band - Math.floor(band))) * 2.3 + CLIFF.rise;
      return y + w * (flute * 1.5 + (ledge - y) * 0.7);
    };
    const memo = new Float32Array((nf + 1) * (nf + 1)).fill(NaN);
    // Height at a fine-grid vertex (I down z, J along x).
    const at = (I: number, J: number): number => {
      I = Math.min(nf, Math.max(0, I)); J = Math.min(nf, Math.max(0, J));
      const key = I * (nf + 1) + J, hit = memo[key]!;
      if (!Number.isNaN(hit)) return hit;
      const i = Math.floor(I / F), j = Math.floor(J / F), a = I - i * F, b = J - j * F;
      let y: number;
      if (a === 0 && b === 0) y = plain(i - 1, j - 1) || plain(i - 1, j) || plain(i, j - 1) || plain(i, j) ? H(i, j) : painted(x0 + J * fc, z0 + I * fc);
      else if (b === 0) y = plain(i, j - 1) || plain(i, j) ? lerp(H(i, j), H(i + 1, j), a / F) : painted(x0 + J * fc, z0 + I * fc);
      else if (a === 0) y = plain(i - 1, j) || plain(i, j) ? lerp(H(i, j), H(i, j + 1), b / F) : painted(x0 + J * fc, z0 + I * fc);
      else y = painted(x0 + J * fc, z0 + I * fc);
      memo[key] = y;
      return y;
    };

    // Flat fills: grass on the floor, a darker green on the slopes above
    // the cliffs, rock on anything steep (laid in strata of five tones),
    // wet earth where the banks meet the water, the bed under it. Level
    // ground keeps its face normal; slopes and cliffs take the grid's
    // smoothed normal, so the tone turns across a cliff instead of in facets.
    const C = (c: number) => new THREE.Color(c);
    const col = { grass: C(0x8fae58), slope: C(0x6a8f52), bed: C(0x58694c), wet: C(0x7e7a58) };
    const strata = [C(0x9c9384), C(0xa89c86), C(0x8b877f), C(0x9a8a78), C(0x857b70)];
    const rockAt = (x: number, y: number, z: number): THREE.Color => {
      const band = Math.floor((y + 0.9 * Math.sin(x * 0.11 + z * 0.07) + 0.5 * Math.sin(x * 0.31 - z * 0.23)) / 1.9);
      const stretch = Math.floor((x * 0.6 + z * 0.8) / 23);
      return strata[(((band * 7 + stretch * 3) % strata.length) + strata.length) % strata.length]!;
    };
    const normalAtVertex = (I: number, J: number, step: number, out: THREE.Vector3): THREE.Vector3 =>
      out.set(-(at(I, J + step) - at(I, J - step)) / (2 * step * fc), 1, -(at(I + step, J) - at(I - step, J)) / (2 * step * fc)).normalize();
    let pos: number[] = [], nrm: number[] = [], clr: number[] = [];
    const p = new THREE.Vector3(), q = new THREE.Vector3(), r = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nv = new THREE.Vector3();
    const tri = (corners: [number, number][], step: number): void => {
      const [[ia, ja], [ib, jb], [ic, jc]] = corners as [[number, number], [number, number], [number, number]];
      p.set(x0 + ja * fc, at(ia, ja), z0 + ia * fc); q.set(x0 + jb * fc, at(ib, jb), z0 + ib * fc); r.set(x0 + jc * fc, at(ic, jc), z0 + ic * fc);
      if (p.y < -2 && q.y < -2 && r.y < -2) return;
      const mx = (p.x + q.x + r.x) / 3, mz = (p.z + q.z + r.z) / 3;
      // Past the crest of the ridge the ground is never seen from the valley.
      if (cliffDistance(mx, mz) > 50) return;
      const face = e1.subVectors(q, p).cross(e2.subVectors(r, p)).normalize();
      const h = (p.y + q.y + r.y) / 3;
      const wet = h < WATER_Y + 0.16 && Math.min(p.y, q.y, r.y) < WATER_Y + 0.02;
      const k = h < WATER_Y - 0.06 ? col.bed : wet ? col.wet : face.y < 0.6 ? rockAt(mx, h, mz) : h > CLIFF.rise + 2 ? col.slope : col.grass;
      corners.forEach(([i, j], idx) => {
        const v = idx === 0 ? p : idx === 1 ? q : r;
        pos.push(v.x, v.y, v.z);
        const nn = face.y > 0.94 ? face : normalAtVertex(i, j, step, nv);
        nrm.push(nn.x, nn.y, nn.z);
        clr.push(k.r, k.g, k.b);
      });
    };
    const quad = (I: number, J: number, s: number): void => {
      tri([[I, J], [I + s, J], [I + s, J + s]], s);
      tri([[I, J], [I + s, J + s], [I, J + s]], s);
    };
    // In tiles, so the camera draws only the ground it can see.
    const mat = toon(0xffffff);
    mat.vertexColors = true;
    const TILE = 29;
    for (let ti = 0; ti < n; ti += TILE) for (let tj = 0; tj < n; tj += TILE) {
      pos = []; nrm = []; clr = [];
      for (let i = ti; i < Math.min(n, ti + TILE); i++) for (let j = tj; j < Math.min(n, tj + TILE); j++) {
        if (plain(i, j)) { quad(i * F, j * F, F); continue; }
        for (let a = 0; a < F; a++) for (let b = 0; b < F; b++) quad(i * F + a, j * F + b, 1);
      }
      if (!pos.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(clr, 3));
      geo.computeBoundingSphere();
      const terrain = new THREE.Mesh(geo, mat);
      terrain.receiveShadow = true;
      terrain.castShadow = false;
      // Its colours live in the vertices, which the bake does not carry.
      terrain.userData.keep = true;
      g.add(terrain);
    }
  }

  // ------------------------------------------------------------ water
  // A strip of painted water down the stream, wide enough that the banks
  // close over its edges, and a round pool under the falls.
  {
    const pts = resample(STREAM, 1.2);
    const half = STREAM_HALF + BANK * 0.8;
    const pos: number[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i]!, [bx, bz] = pts[i + 1]!;
      const [anx, anz] = normalAt(pts, i), [bnx, bnz] = normalAt(pts, i + 1);
      const l0 = [ax + anx * half, az + anz * half], r0 = [ax - anx * half, az - anz * half], l1 = [bx + bnx * half, bz + bnz * half], r1 = [bx - bnx * half, bz - bnz * half];
      pos.push(l0[0]!, WATER_Y, l0[1]!, r0[0]!, WATER_Y, r0[1]!, r1[0]!, WATER_Y, r1[1]!, l0[0]!, WATER_Y, l0[1]!, r1[0]!, WATER_Y, r1[1]!, l1[0]!, WATER_Y, l1[1]!);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const water = new THREE.Mesh(geo, stream);
    water.material.side = THREE.DoubleSide;
    water.userData.keep = true;
    g.add(water);
    const pool = new THREE.Mesh(new THREE.CircleGeometry(FALLS.pool + 1.7, 40), stream);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(FALLS.x, WATER_Y + 0.004, FALLS.z);
    pool.userData.keep = true;
    g.add(pool);
  }

  // ------------------------------------------------------------ the falls
  // A sheet of falling water out of a notch in the north cliff, foam where it
  // lands, and the rocks that frame it.
  {
    const top = new THREE.Vector3(FALLS.x, FALLS.top, -53.8), bottom = new THREE.Vector3(FALLS.x, WATER_Y, -51.4);
    const len = top.distanceTo(bottom);
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(4.4, len, 1, 6), falls);
    sheet.position.copy(top).add(bottom).multiplyScalar(0.5);
    sheet.rotation.x = -Math.atan2(top.z - bottom.z, top.y - bottom.y);
    sheet.userData.keep = true;
    g.add(sheet);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.3, 0.9), falls);
    lip.position.set(FALLS.x, FALLS.top + 0.05, -54.1);
    lip.userData.keep = true;
    g.add(lip);
    const froth = new THREE.Mesh(new THREE.CircleGeometry(2.8, 28), foam);
    froth.rotation.x = -Math.PI / 2;
    froth.position.set(FALLS.x, WATER_Y + 0.03, -51.2);
    froth.userData.keep = true;
    g.add(froth);
    // Rocks at the lip and round the pool.
    for (const [x, y, z, r] of [[-49.4, 14.2, -54.4, 1.8], [-42.5, 14.0, -54.6, 2.0], [-50.6, 1.2, -51.8, 1.5], [-41.4, 1.0, -51.6, 1.4]] as const) boulder(x, z, r, x * 0.7, y, false);
    for (let i = 0; i < 9; i++) {
      const a = Math.PI * (0.05 + i * 0.11) + 0.1;
      const x = FALLS.x + Math.cos(a) * (FALLS.pool + 2.4), z = FALLS.z + Math.sin(a) * (FALLS.pool + 2.4);
      if (i % 3 !== 1) boulder(x, z, 0.5 + (i % 3) * 0.25, i * 1.3);
    }
    zones.push(zone('falls', FALLS.x - 9, FALLS.x + 9, -58, -37, 'The falls'));
  }

  // The stream's end: it runs into a dark cleft at the foot of the east cliff.
  {
    const p = at(EXIT.x + 1.6, FLOOR_Y, EXIT.z, -Math.PI / 2);
    const mouth = add(p, new THREE.CircleGeometry(2.4, 10, 0, Math.PI), ink, 0, -0.6, 0, [0, Math.PI, 0], false);
    mouth.scale.set(1, 1.2, 1);
    for (const [x, z, r] of [[EXIT.x + 0.8, EXIT.z - 3.4, 1.4], [EXIT.x + 0.6, EXIT.z + 3.3, 1.6], [EXIT.x - 1.0, EXIT.z + 2.6, 0.7], [EXIT.x - 0.6, EXIT.z - 2.8, 0.6]] as const) boulder(x, z, r, x + z);
  }

  // ------------------------------------------------------------ road and paths
  // Packed earth laid over the ground; the road carries two worn ruts.
  const onBridge = (x: number, z: number): boolean => Math.abs(x - BRIDGE.x) < BRIDGE.half + 0.8 && z > BRIDGE.z0 - 0.2 && z < BRIDGE.z1 + 0.2;
  const insideWalls = (x: number, z: number): boolean => Math.abs(x) < 24.7 && Math.abs(z) < 21;
  ribbon(ROAD, ROAD_HALF, 0, 0.03, path, (x, z) => onBridge(x, z) || insideWalls(x, z));
  for (const off of [-0.85, 0.85]) ribbon(ROAD, 0.2, off, 0.034, rut, (x, z) => onBridge(x, z) || insideWalls(x, z));
  for (const line of PATHS) ribbon(line, PATH_HALF, 0, 0.026, path, (x, z) => insideWalls(x, z) || nearest(x, z, ROAD) < ROAD_HALF - 0.3);

  // ------------------------------------------------------------ the bridge
  // An arched bridge in red lacquer where the road crosses the stream: a
  // plank deck on two red beams, posts and a rail along each side, bronze
  // caps on the end posts, two piers standing in the water.
  {
    const B = BRIDGE, len = B.z1 - B.z0, zc = (B.z0 + B.z1) / 2, N = 12;
    const arc = (z: number): number => FLOOR_Y + B.rise * (1 - ((z - zc) / (len / 2)) ** 2);
    const deck = toon(0xa08a6c);
    const p = at(0, 0, 0);
    for (let i = 0; i < N; i++) {
      const za = B.z0 + (len * i) / N, zb = B.z0 + (len * (i + 1)) / N, ya = arc(za), yb = arc(zb);
      const ang = -Math.atan2(yb - ya, zb - za), segLen = Math.hypot(zb - za, yb - ya) + 0.03;
      const zm = (za + zb) / 2, ym = (ya + yb) / 2;
      box(p, deck, B.x, ym - 0.08, zm, B.half * 2, 0.16, segLen, [ang, 0, 0]);
      solid(p, B.x, ym - 0.08, zm, B.half, 0.08, segLen / 2, 'wood', new THREE.Quaternion().setFromEuler(new THREE.Euler(ang, 0, 0)));
      for (const s of [-1, 1]) {
        box(p, red, B.x + s * (B.half - 0.05), ym - 0.3, zm, 0.22, 0.3, segLen, [ang, 0, 0]);
        box(p, red, B.x + s * (B.half + 0.02), ym + 0.92, zm, 0.12, 0.1, segLen, [ang, 0, 0]);
        box(p, red, B.x + s * (B.half + 0.02), ym + 0.42, zm, 0.06, 0.06, segLen, [ang, 0, 0], false);
        solid(p, B.x + s * (B.half + 0.02), ym + 0.6, zm, 0.06, 0.6, segLen / 2, 'wood', new THREE.Quaternion().setFromEuler(new THREE.Euler(ang, 0, 0)));
      }
    }
    for (let i = 0; i <= N; i += 2) {
      const z = B.z0 + (len * i) / N, y = arc(z);
      for (const s of [-1, 1]) {
        box(p, red, B.x + s * (B.half + 0.02), y + 0.5, z, 0.16, 1.0, 0.16);
        if (i === 0 || i === N) {
          cyl(p, bronze, B.x + s * (B.half + 0.02), y + 1.05, z, 0.1, 0.12, 0.1, 8);
          add(p, new THREE.SphereGeometry(0.11, 8, 6), bronze, B.x + s * (B.half + 0.02), y + 1.16, z);
          add(p, faceted(new THREE.ConeGeometry(0.07, 0.16, 6)), bronze, B.x + s * (B.half + 0.02), y + 1.3, z);
        }
      }
    }
    for (const z of [zc - 2.2, zc + 2.2]) for (const s of [-1, 1]) cyl(p, redDark, B.x + s * (B.half - 0.3), (arc(z) - 0.3 - BED_Y) / 2 + BED_Y, z, 0.13, 0.15, arc(z) - 0.3 - BED_Y, 8);
    for (const z of [zc - 2.2, zc + 2.2]) box(p, redDark, B.x, arc(z) - 0.42, z, B.half * 2 - 0.2, 0.14, 0.18);
    zones.push(zone('bridge', B.x - 3, B.x + 3, B.z0 - 0.5, B.z1 + 0.5, 'Red bridge'));
    footprints.push({ x: B.x, z: zc, w: B.half * 2, d: len, y: B.rise });
  }

  // Stepping stones across the stream on the meadow path.
  {
    const n = 6;
    for (let i = 0; i < n; i++) {
      const z = STONES.z0 + ((STONES.z1 - STONES.z0) * i) / (n - 1), x = STONES.x + (i % 2 ? 0.35 : -0.3);
      const y = Math.min(FLOOR_Y, ground(x, z)) ;
      const top = Math.max(y, WATER_Y + 0.22);
      const p = at(x, 0, z, i * 0.9);
      const m = add(p, faceted(new THREE.CylinderGeometry(0.55, 0.68, top - BED_Y + 0.05, 7)), i % 2 ? rock : rockDark, 0, (top + BED_Y) / 2 - 0.02, 0);
      m.scale.z = 0.85;
      solid(p, 0, (top + BED_Y) / 2 - 0.02, 0, 0.5, (top - BED_Y) / 2, 0.45, 'stone');
    }
  }

  // ------------------------------------------------------------ the field
  // Swept earth beside the road just out of the gate, level and kept clear:
  // the Striking Posts drill (src/drills/strikingPosts.ts) stands its posts
  // here. Only a paper streamer on a stake at each corner.
  {
    const F = FIELD;
    const p = at(F.x, 0, F.z);
    box(p, earth, 0, FLOOR_Y - 0.01, 0, F.half * 2, 0.06, F.half * 2, undefined, false);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const x = sx * (F.half + 0.35), z = sz * (F.half + 0.35);
      cyl(p, M.woodLight, x, 0.45, z, 0.035, 0.045, 0.9, 6);
      box(p, paper, x + 0.06, 0.74, z, 0.02, 0.26, 0.09, [0, 0, 0.12], false);
      solid(p, x, 0.45, z, 0.06, 0.45, 0.06, 'wood');
    }
    zones.push(zone('field', F.x - F.half - 1, F.x + F.half + 1, F.z - F.half - 1, F.z + F.half + 1, 'Striking Posts'));
  }

  // Stone lanterns: a pair where the road leaves the wall.
  stoneLantern(-3.6, 27.2);
  stoneLantern(3.6, 27.2);

  // ------------------------------------------------------------ training ground
  // A cleared circle of packed sand with a kerb of field stones, three
  // striking posts, the lifting stones on a straw mat, a balance log on two
  // stumps, a rack of staffs and a bench, and banners where the path comes in.
  {
    const T = GROUNDS;
    const p = at(T.x, 0, T.z);
    const disc = add(p, new THREE.CylinderGeometry(T.r, T.r, 0.06, 44), sand, 0, FLOOR_Y + 0.01, 0, undefined, false);
    disc.receiveShadow = true;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      if (Math.abs(Math.atan2(Math.sin(a - Math.PI), Math.cos(a - Math.PI))) < 0.25) continue;
      const m = add(p, faceted(new THREE.IcosahedronGeometry(0.34, 0)), i % 2 ? rock : rockDark, Math.cos(a) * (T.r + 0.35), 0.08, Math.sin(a) * (T.r + 0.35), [0, a, 0]);
      m.scale.set(1.4, 0.55, 1);
    }
    for (const [x, z] of [[-3.2, -5.6], [0, -6.2], [3.2, -5.6]] as const) makiwara(p, x, z, Math.atan2(-x, -z));
    // Lifting stones, smallest to largest.
    box(p, straw, 5.2, 0.01, 2.6, 2.6, 0.04, 1.2, undefined, false);
    [0.26, 0.34, 0.42].forEach((r, i) => { const m = add(p, faceted(new THREE.IcosahedronGeometry(r, 1)), i === 2 ? rockDark : rock, 4.3 + i * 0.85, r * 0.8, 2.6); m.scale.y = 0.8; });
    solid(p, 5.2, 0.35, 2.6, 1.3, 0.35, 0.5);
    // The balance log.
    for (const sx of [-2.3, 2.3]) cyl(p, M.woodDark, -4 + sx, 0.25, 4.2, 0.28, 0.32, 0.5, 8);
    cyl(p, M.woodLight, -4, 0.68, 4.2, 0.19, 0.21, 5.4, 9, AX);
    solid(p, -4, 0.45, 4.2, 2.8, 0.45, 0.3, 'wood');
    // A rack of staffs and a bench on the east side.
    const rack = at(T.x + 7.2, 0, T.z - 1.4, -Math.PI / 2);
    box(rack, M.woodDark, 0, 0.04, 0, 1.6, 0.08, 0.4);
    for (const sx of [-0.75, 0.75]) box(rack, M.woodDark, sx, 0.95, -0.1, 0.09, 1.9, 0.09);
    box(rack, M.woodDark, 0, 1.85, -0.1, 1.62, 0.08, 0.1);
    for (let i = 0; i < 5; i++) cyl(rack, M.woodLight, -0.6 + i * 0.3, 0.98, -0.02, 0.025, 0.025, 1.85, 5, [-0.06, 0, 0]);
    solid(rack, 0, 0.95, -0.05, 0.8, 0.95, 0.22, 'wood');
    const bench = at(T.x + 6.6, 0, T.z + 3.2, -Math.PI / 2 + 0.3);
    box(bench, M.woodLight, 0, 0.44, 0, 1.8, 0.07, 0.38);
    for (const sx of [-0.7, 0.7]) box(bench, M.woodDark, sx, 0.2, 0, 0.1, 0.4, 0.34);
    solid(bench, 0, 0.24, 0, 0.9, 0.24, 0.2, 'wood');
    for (const s of [-1, 1]) nobori(T.x - T.r - 0.6, T.z + s * 2.2, -Math.PI / 2, s < 0 ? '鍛' : '錬');
    zones.push(zone('grounds', T.x - T.r - 2, T.x + T.r + 2, T.z - T.r - 2, T.z + T.r + 2, 'Training ground'));
    footprints.push({ x: T.x, z: T.z, w: T.r * 2, d: T.r * 2, y: 0 });
  }

  // ------------------------------------------------------------ the old ginkgo
  // A great gold tree on a low knoll north-east of the walls, seen from
  // anywhere in the valley: a thick trunk bound with a straw rope and paper,
  // heavy limbs, a crown of gold, and its leaves fallen round it.
  {
    const G = GINKGO, y = ground(G.x, G.z);
    const p = at(G.x, y, G.z, 0.4);
    cyl(p, M.woodDark, 0, 3.0, 0, 0.85, 1.35, 6.0, 10);
    for (const [a, tilt, l] of [[0.3, 0.7, 4.2], [2.4, 0.8, 3.8], [4.3, 0.65, 4.4], [5.5, 0.9, 3.2]] as const) {
      const m = cyl(p, M.woodDark, Math.cos(a) * 1.3, 6.6, Math.sin(a) * 1.3, 0.35, 0.6, l, 7);
      m.rotation.set(Math.sin(a) * tilt, 0, -Math.cos(a) * tilt);
    }
    const crown: [number, number, number, number][] = [[0, 11.5, 0, 4.6], [3.2, 9.6, 1.2, 3.6], [-3.0, 9.8, -1.0, 3.8], [1.0, 9.2, -3.4, 3.4], [-1.2, 9.4, 3.3, 3.5], [2.6, 12.6, -1.8, 2.8], [-2.4, 12.4, 1.9, 2.9], [0.4, 14.2, 0.3, 2.6], [4.4, 8.4, -1.8, 2.4], [-4.2, 8.6, 2.0, 2.4]];
    crown.forEach(([cx, cy, cz, r], i) => add(p, faceted(new THREE.IcosahedronGeometry(r, 1)), i % 3 === 1 ? ginkgoLight : ginkgo, cx, cy, cz));
    // The rope round the trunk, and its paper.
    add(p, new THREE.TorusGeometry(1.18, 0.11, 6, 24), straw, 0, 2.6, 0, [Math.PI / 2, 0, 0]);
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; box(p, paper, Math.cos(a) * 1.24, 2.2, Math.sin(a) * 1.24, 0.12, 0.5, 0.02, [0, -a + Math.PI / 2, 0], false); }
    solid(p, 0, 3, 0, 1.1, 3, 1.1, 'wood');
    // It stands over the path: the whole tree fades when it hides the player.
    p.traverse((o) => { if ((o as THREE.Mesh).isMesh) onRoof(o as THREE.Mesh, 'ginkgo', true); });
    // Fallen leaves: scattered gold flecks under the crown.
    const leaves: number[] = [];
    const lr = rng(23);
    for (let i = 0; i < 140; i++) {
      const a = lr() * Math.PI * 2, r = 1.6 + Math.sqrt(lr()) * 7.5;
      const x = G.x + Math.cos(a) * r, z = G.z + Math.sin(a) * r, y = ground(x, z) + 0.03, s2 = 0.16 + lr() * 0.14, t = lr() * Math.PI;
      const cx2 = Math.cos(t) * s2, cz2 = Math.sin(t) * s2;
      leaves.push(x - cx2, y, z - cz2, x + cz2 * 0.6, y, z - cx2 * 0.6, x + cx2, y, z + cz2);
    }
    meshFrom(leaves, leafLitter, false, true);
    zones.push(zone('ginkgo', G.x - 9, G.x + 9, G.z - 9, G.z + 9, 'Old ginkgo'));
  }

  // ------------------------------------------------------------ terraces
  // Paddies stepping up the west slope: each a level of water inside a
  // grass bund, the tiers held up on earthen sides. Two wide bunds cross
  // them as paths, with a step at each rise. Every other paddy is planted.
  {
    const T = TERRACES, w = (T.x1 - T.x0) / T.tiers;
    const tufts: number[] = [];
    const rand = rng(17);
    for (let t = 0; t < T.tiers; t++) {
      const xa = T.x1 - (t + 1) * w, xb = T.x1 - t * w, ty = tierY(t);
      for (let c = 0; c < T.cuts.length - 1; c++) {
        const za = T.cuts[c]!, zb = T.cuts[c + 1]!;
        const p = at(0, 0, 0);
        box(p, terraceSide, (xa + xb) / 2, (ty - 0.08 - 0.8) / 2, (za + zb) / 2, xb - xa, ty - 0.08 + 0.8, zb - za, undefined, false);
        solid(p, (xa + xb) / 2, (ty - 0.08 - 0.8) / 2, (za + zb) / 2, (xb - xa) / 2, (ty - 0.08 + 0.8) / 2, (zb - za) / 2, 'ground');
        const water = new THREE.Mesh(new THREE.PlaneGeometry(xb - xa - 0.5, zb - za - 0.5), paddy);
        water.rotation.x = -Math.PI / 2;
        water.position.set((xa + xb) / 2, ty - 0.02, (za + zb) / 2);
        g.add(water);
        // Bunds: the cross bunds at the inner cuts are wide enough to walk.
        const wide = (zEdge: number) => (zEdge === T.cuts[1] || zEdge === T.cuts[2] ? 0.6 : 0.24);
        const bundBox = (x0: number, x1: number, z0: number, z1: number) => {
          box(p, bund, (x0 + x1) / 2, (ty - 0.08 + ty + 0.14) / 2, (z0 + z1) / 2, x1 - x0, 0.22, z1 - z0, undefined, false);
          solid(p, (x0 + x1) / 2, (ty - 0.08 + ty + 0.14) / 2, (z0 + z1) / 2, (x1 - x0) / 2, 0.11, (z1 - z0) / 2, 'ground');
        };
        bundBox(xa, xb, za, za + wide(za));
        bundBox(xa, xb, zb - wide(zb), zb);
        bundBox(xa, xa + 0.25, za, zb);
        bundBox(xb - 0.25, xb, za, zb);
        if ((t + c) % 2 === 0) {
          for (let x = xa + 0.8; x < xb - 0.6; x += 0.7) for (let z = za + 0.9; z < zb - 0.7; z += 0.55) blades(tufts, x + (rand() - 0.5) * 0.1, ty - 0.08, z, 3, 0.32, 0.12, 0.035, rand);
        }
      }
      // A step up onto this tier from the one below (or the ground) on each path bund.
      const below = t === 0 ? FLOOR_Y : tierY(t - 1) + 0.14;
      const stepTop = (below + ty + 0.14) / 2;
      for (const zc of [T.cuts[1]!, T.cuts[2]!]) {
        const p = at(xb + 0.35, 0, zc, 0);
        box(p, M.stoneDark, 0, (stepTop - 0.6) / 2, 0, 0.7, stepTop + 0.6, 1.3);
        solid(p, 0, (stepTop - 0.6) / 2, 0, 0.35, (stepTop + 0.6) / 2, 0.65, 'stone');
      }
    }
    meshFrom(tufts, rice, false, true);
    zones.push(zone('terraces', T.x0, T.x1 + 1, T.z0, T.z1, 'Rice terraces'));
    footprints.push({ x: (T.x0 + T.x1) / 2, z: (T.z0 + T.z1) / 2, w: T.x1 - T.x0, d: T.z1 - T.z0, y: tierY(T.tiers - 1) });
  }

  // ------------------------------------------------------------ tall grass
  // Silver grass over the meadow south-east of the bridge: a patch of dry
  // gold painted on the ground and tufts of broad leaves over it, gold and
  // pale green with cream plumes. It thins to clumps along the foot of the
  // slopes, with reeds on the banks. Each leaf is a long flat diamond.
  {
    const leaves: number[] = [], tints: number[] = [];
    const C = (c: number) => new THREE.Color(c);
    const GOLD = [C(0x9c8f4e), C(0xeedb96)], GREEN = [C(0x76884a), C(0xcdd38c)], PLUME = [C(0xe2d6b8), C(0xfbf5e6)];
    const stroke = (kind: THREE.Color[], ...v: number[]): void => {
      leaves.push(...v);
      // Foot, middle and tip by height within the leaf.
      const ys = [v[1]!, v[4]!, v[7]!], lo = Math.min(...ys), hi = Math.max(...ys);
      for (const y of ys) { const c = kind[0]!.clone().lerp(kind[1]!, hi > lo ? (y - lo) / (hi - lo) : 1); tints.push(c.r, c.g, c.b); }
    };
    const rand = rng(5);
    const M2 = MEADOW, mx = (M2.x0 + M2.x1) / 2, mz = (M2.z0 + M2.z1) / 2 + 1, rx = (M2.x1 - M2.x0) / 2 - 2, rz = (M2.z1 - M2.z0) / 2 - 3.5;
    const radius = (a: number): number => 1 + 0.12 * Math.sin(3 * a + 0.4) + 0.08 * Math.sin(5 * a + 1.9);
    const inMeadow = (x: number, z: number): number => { const dx = (x - mx) / rx, dz = (z - mz) / rz; return Math.hypot(dx, dz) / radius(Math.atan2(dz, dx)); };
    const outline: THREE.Vector2[] = [];
    for (let i = 0; i < 64; i++) { const a = (i / 64) * Math.PI * 2, r = radius(a); outline.push(new THREE.Vector2(mx + Math.cos(a) * rx * r, -(mz + Math.sin(a) * rz * r))); }
    const patch = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(outline)), meadowFill);
    patch.rotation.x = -Math.PI / 2;
    patch.position.y = FLOOR_Y + 0.012;
    patch.receiveShadow = true;
    g.add(patch);
    const clump = (x: number, z: number, tall: number): void => {
      const y = ground(x, z);
      const n = 3 + Math.floor(rand() * 3);
      const spin = rand() * Math.PI * 2;
      for (let i = 0; i < n; i++) {
        const a = spin + (i / n) * Math.PI * 2 + rand() * 0.5, lean = 0.18 + rand() * 0.22, h = tall * (0.75 + rand() * 0.5), w = 0.13 + rand() * 0.06;
        const tx = x + Math.cos(a) * lean * h, tz = z + Math.sin(a) * lean * h;
        const mx2 = x + Math.cos(a) * lean * h * 0.45, mz2 = z + Math.sin(a) * lean * h * 0.45, my = y + h * 0.45;
        const px = -Math.sin(a) * w, pz = Math.cos(a) * w;
        const leaf = rand() < 0.55 ? GOLD : GREEN;
        stroke(leaf, x, y, z, mx2 + px, my, mz2 + pz, tx, y + h, tz);
        stroke(leaf, x, y, z, tx, y + h, tz, mx2 - px, my, mz2 - pz);
        if (rand() < 0.4) stroke(PLUME, tx - px * 0.8, y + h - 0.5, tz - pz * 0.8, tx + px * 0.8, y + h - 0.5, tz + pz * 0.8, tx + Math.cos(a) * 0.12, y + h + 0.12, tz + Math.sin(a) * 0.12);
      }
    };
    const clear = (x: number, z: number, pad: number): boolean => nearest(x, z, ROAD) > ROAD_HALF + pad && nearPath(x, z) > PATH_HALF + pad && nearest(x, z, STREAM) > STREAM_HALF + BANK + 0.6;
    for (let x = M2.x0; x < M2.x1; x += 1.8) for (let z = M2.z0; z < M2.z1; z += 1.8) {
      const jx = x + (rand() - 0.5) * 1.5, jz = z + (rand() - 0.5) * 1.5;
      const m = inMeadow(jx, jz);
      if (m > 1.08 || (m > 0.9 && rand() < 0.5)) continue;
      if (cliffDistance(jx, jz) > -1.5 || !clear(jx, jz, 0.9)) continue;
      clump(jx, jz, 1.3);
    }
    for (let x = VALLEY.x0; x < VALLEY.x1; x += 3.1) for (let z = VALLEY.z0; z < VALLEY.z1; z += 3.1) {
      const jx = x + (rand() - 0.5) * 2.4, jz = z + (rand() - 0.5) * 2.4;
      const d = cliffDistance(jx, jz), s = nearest(jx, jz, STREAM);
      const foot = d > -9 && d < -0.8 && rand() < 0.22;
      const reed = s > STREAM_HALF + BANK + 0.2 && s < STREAM_HALF + BANK + 1.6 && rand() < 0.4;
      if (!foot && !reed) continue;
      if (Math.abs(jx) < 31 && Math.abs(jz) < 27) continue;
      if (inMeadow(jx, jz) < 1.1 || !clear(jx, jz, 0.8) || occupied(jx, jz, 2)) continue;
      clump(jx, jz, reed ? 1.1 : 0.9);
    }

    // The open floor between the places: low tufts, a few white and yellow
    // wild flowers, and red spider lilies along the banks and the paths, in
    // the same unlined strokes.
    const TUFT = [C(0x6f8e48), C(0xa9c46c)], LILY = [C(0xb8322a), C(0xe8503a)], BLOOM = [[C(0xe9e4d2), C(0xfffbef)], [C(0xd9b53c), C(0xf3da6a)]];
    const tuft = (x: number, z: number, h: number): void => {
      const y = ground(x, z), spin = rand() * 6;
      for (let i = 0; i < 3; i++) {
        const a = spin + i * 2.1, lean = 0.12 + rand() * 0.1, w = 0.06;
        const px = -Math.sin(a) * w, pz = Math.cos(a) * w;
        stroke(TUFT, x - px, y, z - pz, x + px, y, z + pz, x + Math.cos(a) * lean, y + h * (0.7 + rand() * 0.5), z + Math.sin(a) * lean);
      }
    };
    // A spider lily: a bare stem and a head of thin red petals curling up and out.
    const lily = (x: number, z: number, h: number): void => {
      const y = ground(x, z) + h, spin = rand() * 6;
      stroke(TUFT, x - 0.015, y - h, z, x + 0.015, y - h, z, x, y, z);
      for (let i = 0; i < 6; i++) {
        const a = spin + i * 1.05, ca = Math.cos(a), sa = Math.sin(a), w = 0.012;
        stroke(LILY, x - sa * w, y, z + ca * w, x + sa * w, y, z - ca * w, x + ca * 0.1, y + 0.07, z + sa * 0.1);
      }
    };
    const flower = (x: number, z: number, kind: THREE.Color[], h: number, r: number): void => {
      const y = ground(x, z) + h;
      stroke(TUFT, x - 0.02, y - h, z, x + 0.02, y - h, z, x, y, z);
      for (let i = 0; i < 3; i++) {
        const a = rand() * 6 + i * 2.1;
        stroke(kind, x, y, z, x + Math.cos(a) * r, y + 0.03, z + Math.sin(a) * r, x + Math.cos(a + 0.9) * r, y - 0.02, z + Math.sin(a + 0.9) * r);
      }
    };
    for (let x = VALLEY.x0; x < VALLEY.x1; x += 2.6) for (let z = VALLEY.z0; z < VALLEY.z1; z += 2.6) {
      const jx = x + (rand() - 0.5) * 2.4, jz = z + (rand() - 0.5) * 2.4, roll = rand();
      if (cliffDistance(jx, jz) > -1.5 || (Math.abs(jx) < 26.5 && Math.abs(jz) < 22.5) || inMeadow(jx, jz) < 1.05 || occupied(jx, jz, 0.5)) continue;
      if (nearest(jx, jz, ROAD) < ROAD_HALF + 0.3 || nearPath(jx, jz) < PATH_HALF + 0.3 || nearest(jx, jz, STREAM) < STREAM_HALF + BANK - 0.6) continue;
      const edge = Math.min(nearPath(jx, jz) - PATH_HALF, nearest(jx, jz, STREAM) - STREAM_HALF - BANK, nearest(jx, jz, ROAD) - ROAD_HALF);
      if (edge < 1.6 && roll < 0.32) { for (let k = 0; k < 3 + Math.floor(rand() * 4); k++) lily(jx + (rand() - 0.5) * 1.4, jz + (rand() - 0.5) * 1.4, 0.3 + rand() * 0.12); continue; }
      if (roll < 0.62) { for (let k = 0; k < 2 + Math.floor(rand() * 3); k++) tuft(jx + (rand() - 0.5) * 1.2, jz + (rand() - 0.5) * 1.2, 0.3 + rand() * 0.2); continue; }
      if (roll < 0.72) { const kind = BLOOM[Math.floor(rand() * 2)]!; for (let k = 0; k < 4 + Math.floor(rand() * 4); k++) flower(jx + (rand() - 0.5) * 1.8, jz + (rand() - 0.5) * 1.8, kind, 0.16 + rand() * 0.08, 0.06); }
    }
    meshFrom(leaves, grassMat, false, true, tints).renderOrder = 2;

    // Patches of a lighter and a deeper green laid over the open floor, so
    // the grass between the places is painted, not one flat fill. Only on
    // level ground, as one mesh under the paths.
    {
      const fills = [C(0x9cb862), C(0x83a453), C(0x96b05a)];
      const pos: number[] = [], clr: number[] = [];
      const level = (x: number, z: number): boolean => Math.abs(heightAt(x, z) - FLOOR_Y) < 0.005;
      const laid: [number, number, number][] = [];
      for (let tries = 0, made = 0; tries < 400 && made < 34; tries++) {
        const x = VALLEY.x0 + rand() * (VALLEY.x1 - VALLEY.x0), z = VALLEY.z0 + rand() * (VALLEY.z1 - VALLEY.z0), r = 3 + rand() * 5.5;
        if (cliffDistance(x, z) > -r - 14 || (Math.abs(x) < 24 + r && Math.abs(z) < 20 + r) || inMeadow(x, z) < 1.1 + r / 12 || occupied(x, z, r)) continue;
        if (nearest(x, z, STREAM) < STREAM_HALF + BANK + r * 1.7) continue;
        if (laid.some(([lx, lz, lr]) => Math.hypot(x - lx, z - lz) < (r + lr) * 1.7)) continue;
        const k = fills[made % fills.length]!, spin = rand() * 6, wob = [rand() * 6, rand() * 6];
        const ring: [number, number][] = [];
        for (let i = 0; i < 20; i++) {
          const a = spin + (i / 20) * Math.PI * 2, rr = r * (1 + 0.18 * Math.sin(3 * a + wob[0]!) + 0.1 * Math.sin(5 * a + wob[1]!));
          ring.push([x + Math.cos(a) * rr * 1.3, z + Math.sin(a) * rr * 0.85]);
        }
        if (!ring.every(([px, pz]) => level(px, pz))) continue;
        for (let i = 0; i < ring.length; i++) {
          const [ax, az] = ring[i]!, [bx, bz] = ring[(i + 1) % ring.length]!;
          pos.push(x, FLOOR_Y + 0.008, z, bx, FLOOR_Y + 0.008, bz, ax, FLOOR_Y + 0.008, az);
          for (let v = 0; v < 3; v++) clr.push(k.r, k.g, k.b);
        }
        laid.push([x, z, r]);
        made++;
      }
      const fill = toon(0xffffff);
      fill.vertexColors = true;
      fill.polygonOffset = true; fill.polygonOffsetFactor = -1; fill.polygonOffsetUnits = -2;
      meshFrom(pos, fill, false, true, clr);
    }
    zones.push(zone('meadow', M2.x0, M2.x1, M2.z0 + 3, M2.z1, 'Tall grass'));
  }

  // ------------------------------------------------------------ the shrine
  // At the road's end under the south cliff: a vermilion torii over the
  // road, then a stone platform with a small wooden shrine on it, a rope and
  // paper across its front, an offering box, two lanterns and two old cedars.
  {
    const S = SHRINE;
    torii(S.x, S.toriiZ);
    const base = at(0, 0, 0);
    box(base, M.stone, S.x, (S.top - 0.6) / 2, (S.z0 + S.z1) / 2, S.x1 - S.x0, S.top + 0.6, S.z1 - S.z0);
    solid(base, S.x, (S.top - 0.6) / 2, (S.z0 + S.z1) / 2, (S.x1 - S.x0) / 2, (S.top + 0.6) / 2, (S.z1 - S.z0) / 2);
    box(base, M.stoneDark, S.x, S.top + 0.02, (S.z0 + S.z1) / 2, S.x1 - S.x0 + 0.1, 0.06, S.z1 - S.z0 + 0.1, undefined, false);
    for (let i = 0; i < 3; i++) {
      const top = S.top - 0.3 * (i + 1), z1 = S.z0 - 0.34 * i, z0 = z1 - 0.34;
      box(base, M.stone, S.x, (top - 0.6) / 2, (z0 + z1) / 2, 3.2, top + 0.6, z1 - z0);
      solid(base, S.x, (top - 0.6) / 2, (z0 + z1) / 2, 1.6, (top + 0.6) / 2, (z1 - z0) / 2);
    }
    const p = at(S.x, S.top, S.z, Math.PI);
    box(p, M.stoneDark, 0, 0.15, 0, 2.0, 0.3, 1.8);
    box(p, M.woodLight, 0, 0.88, 0, 1.3, 1.16, 1.1);
    box(p, M.woodDark, 0, 0.84, 0.56, 0.9, 0.86, 0.04, undefined, false);
    box(p, M.woodLight, 0, 0.84, 0.585, 0.04, 0.86, 0.02, undefined, false);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) box(p, M.woodDark, sx * 0.66, 0.9, sz * 0.56, 0.1, 1.2, 0.1);
    for (const s of [-1, 1]) {
      box(p, M.tile, s * 0.48, 1.78, 0.05, 1.12, 0.1, 1.9, [0, 0, -s * 0.62]);
      // Crossed boards over the ridge ends.
      for (const ez of [-0.95, 0.95]) box(p, M.woodDark, s * 0.14, 2.32, ez, 0.07, 0.62, 0.05, [0, 0, s * 0.55], false);
    }
    box(p, M.tileEdge, 0, 2.1, 0.05, 0.22, 0.16, 2.0);
    cyl(p, straw, 0, 1.52, 0.66, 0.07, 0.07, 1.5, 6, AX);
    for (const sx of [-0.45, 0, 0.45]) box(p, paper, sx, 1.3, 0.68, 0.1, 0.36, 0.02, undefined, false);
    box(p, M.woodDark, 0, 0.62, 1.25, 0.8, 0.5, 0.42);
    solid(p, 0, 1.0, 0.2, 1.0, 1.0, 1.1, 'wood');
    stoneLantern(S.x - 3.2, S.z0 + 1.1, S.top);
    stoneLantern(S.x + 3.2, S.z0 + 1.1, S.top);
    lights.add({ kind: 'point', position: new THREE.Vector3(S.x, S.top + 1.8, S.z0 + 1.4), color: new THREE.Color(0xffb36b), intensity: 9, distance: 9, decay: 2 });
    tree(S.x - 7.4, S.z + 0.4, 'cedar', 1.9, 3, true);
    tree(S.x + 7.2, S.z - 0.6, 'cedar', 1.75, 8, true);
    // A small stone figure with a red bib by the road, where the paths fork.
    const j = at(6.4, ground(6.4, 56.6), 56.6, -Math.PI / 2 - 0.2);
    box(j, M.stoneDark, 0, 0.1, 0, 0.6, 0.2, 0.5);
    add(j, faceted(new THREE.CylinderGeometry(0.17, 0.22, 0.5, 7)), M.stone, 0, 0.45, 0);
    add(j, faceted(new THREE.IcosahedronGeometry(0.15, 1)), M.stone, 0, 0.82, 0);
    add(j, faceted(new THREE.ConeGeometry(0.23, 0.2, 7)), red, 0, 0.58, 0.02, [Math.PI, 0, 0]);
    solid(j, 0, 0.45, 0, 0.25, 0.45, 0.25);
    zones.push(zone('shrine', S.x - 7, S.x + 7, S.toriiZ - 3, S.z1 + 2, 'Roadside shrine'));
    footprints.push({ x: S.x, z: (S.z0 + S.z1) / 2, w: S.x1 - S.x0, d: S.z1 - S.z0, y: S.top });
  }

  // ------------------------------------------------------------ the woods
  // Pines and cedars thick on the slopes above the cliffs and in belts on the
  // floor (north behind the hall, west past the stream), maples and gold
  // trees scattered between. The paths run through the belts. Trees on the
  // floor fade in clumps when one stands between the top-down camera and the player.
  {
    const rand = rng(41);
    const keepOff = (x: number, z: number, pad: number): boolean => nearest(x, z, ROAD) < ROAD_HALF + pad || nearPath(x, z) < PATH_HALF + pad || nearest(x, z, STREAM) < STREAM_HALF + BANK + pad * 0.6 || occupied(x, z, pad + 1.5);
    for (let x = GRID.x0 + 4; x < GRID.x0 + GRID.n * GRID.cell - 4; x += 5.2) for (let z = GRID.z0 + 4; z < GRID.z0 + GRID.n * GRID.cell - 4; z += 5.2) {
      const jx = x + (rand() - 0.5) * 3.6, jz = z + (rand() - 0.5) * 3.6;
      const d = cliffDistance(jx, jz);
      const r = rand(), kindRoll = rand(), s = 0.95 + rand() * 0.55, seed = Math.floor(rand() * 100);
      if (d > cliffRun(jx, jz) + 0.6) {
        // The pass road's cutting climbs through these slopes (src/world/pass/).
        if (d > 36 || r > 0.62 || passRoad(jx, jz) < 14) continue;
        tree(jx, jz, kindRoll < 0.45 ? 'cedar' : kindRoll < 0.86 ? 'pine' : kindRoll < 0.94 ? 'maple' : 'gold', s * 1.15, seed, false, true);
        continue;
      }
      if (d > -1.2) continue;
      if (Math.abs(jx) < 31.5 && Math.abs(jz) < 27.5) continue;
      const north = jz < -29, west = jx < -45 && jz < 50, east = jx > 30 && jz < 36, rim = d > -9;
      const p = north ? 0.78 : west ? 0.62 : east ? 0.16 : rim ? 0.22 : 0.025;
      if (r > p || keepOff(jx, jz, 2.2)) continue;
      const kind = north || west ? (kindRoll < 0.5 ? 'pine' : kindRoll < 0.72 ? 'cedar' : kindRoll < 0.88 ? 'maple' : 'gold') : kindRoll < 0.4 ? 'maple' : kindRoll < 0.65 ? 'gold' : 'pine';
      tree(jx, jz, kind, s, seed, true);
    }
  }

  mergeClumps();

  // Boulders along the foot of the cliffs and the stream banks.
  {
    const rand = rng(9);
    for (let i = 0; i < 420; i++) {
      const x = VALLEY.x0 - 6 + rand() * (VALLEY.x1 - VALLEY.x0 + 12), z = VALLEY.z0 - 6 + rand() * (VALLEY.z1 - VALLEY.z0 + 12);
      const d = cliffDistance(x, z), s = nearest(x, z, STREAM);
      const foot = d > -2.5 && d < 0.8 && rand() < 0.12, bank = s > STREAM_HALF + 0.6 && s < STREAM_HALF + BANK && rand() < 0.08;
      if (!foot && !bank) continue;
      if (nearest(x, z, ROAD) < ROAD_HALF + 1.5 || nearPath(x, z) < PATH_HALF + 1 || occupied(x, z, 1.5)) continue;
      boulder(x, z, 0.5 + rand() * (foot ? 1.1 : 0.4), rand() * 6, undefined, foot);
    }
  }

  // ------------------------------------------------------------ cliff dressing
  // Buttresses of rock standing out of the cliff faces in the strata's
  // tones, so the wall breaks into masses; scrub along the crest. All of it
  // above head height or behind the wall that holds you.
  {
    const rand = rng(31);
    const tones = [0x9c9384, 0xa89c86, 0x8b877f, 0x9a8a78, 0x857b70].map((c) => toon(c));
    const scrub = [toon(0x55794a), toon(0x4a6b45), toon(0x6c8a4c)];
    const quiet = (x: number, z: number): boolean => Math.hypot(x - FALLS.x, z - FALLS.z) < 10 || Math.hypot(x - EXIT.x, z - EXIT.z) < 7 || passRoad(x, z) < 9;
    const V = VALLEY, cx = (V.x0 + V.x1) / 2, cz = (V.z0 + V.z1) / 2;
    const perimeter = 2 * (V.x1 - V.x0 + V.z1 - V.z0);
    for (let t = 0; t < perimeter; t += 4.2 + rand() * 3) {
      const a = (t / perimeter) * Math.PI * 2;
      // March out from the middle to the cliff line along this bearing.
      const dx = Math.cos(a), dz = Math.sin(a);
      let r = 30;
      for (let k = 0; k < 60 && cliffDistance(cx + dx * r, cz + dz * r) < 0; k++) r += 1.5;
      for (let k = 0; k < 8; k++) r -= cliffDistance(cx + dx * r, cz + dz * r);
      const fx = cx + dx * r, fz = cz + dz * r;
      if (quiet(fx, fz)) continue;
      // The face's outward normal, from the gradient of the cliff line.
      const gx = cliffDistance(fx + 0.5, fz) - cliffDistance(fx - 0.5, fz), gz = cliffDistance(fx, fz + 0.5) - cliffDistance(fx, fz - 0.5);
      const gl = Math.hypot(gx, gz) || 1, nx = gx / gl, nz = gz / gl;
      const run = cliffRun(fx, fz), back = run * (0.45 + rand() * 0.35);
      const x = fx + nx * back, z = fz + nz * back, y = heightAt(x, z);
      const size = 1.1 + rand() * 1.1;
      const p = at(x, y, z, Math.atan2(nx, nz) + (rand() - 0.5) * 0.5);
      const m = add(p, faceted(new THREE.IcosahedronGeometry(size, 0)), tones[Math.floor(rand() * tones.length)]!, 0, size * 0.2, 0, [rand() * 0.4 - 0.2, 0, rand() * 0.3 - 0.15], false);
      m.scale.set(1.2 + rand() * 0.6, 1.3 + rand() * 0.9, 0.55);
      if (rand() < 0.7) {
        const up = run + 0.8 + rand() * 1.4, sx = fx + nx * up, sz = fz + nz * up;
        for (let b = 0; b < 2 + Math.floor(rand() * 3); b++) {
          const ox = sx + (rand() - 0.5) * 3, oz = sz + (rand() - 0.5) * 3, br = 0.5 + rand() * 0.5;
          const bush = add(at(ox, heightAt(ox, oz) - 0.1, oz), faceted(new THREE.IcosahedronGeometry(br, 0)), scrub[b % scrub.length]!, 0, br * 0.5, 0, [0, rand() * 6, 0], false);
          bush.scale.y = 0.75;
        }
      }
    }
  }

  // ------------------------------------------------------------ the edge
  // The cliffs are steeper than anyone can walk up, but a body pressed to
  // rock that steep still counts as standing and could jump its way up. So
  // the rock's own face is the collider that stops you: a wall that follows
  // the ragged line of the cliffs a hand's breadth into the rock, where the
  // face is already head high. A second ring on the cliff tops stops a
  // Technique that throws or translates a body over them.
  {
    const V = VALLEY, cx = (V.x0 + V.x1) / 2, cz = (V.z0 + V.z1) / 2, hx = (V.x1 - V.x0) / 2 - V.r, hz = (V.z1 - V.z0) / 2 - V.r;
    // Points round the foot of the cliffs `out` metres past it (plain
    // distance), each with its outward direction, about `step` apart.
    const loop = (out: number, step: number): [number, number, number, number][] => {
      const R = V.r + out, pts: [number, number, number, number][] = [];
      const corners = [[1, 1], [-1, 1], [-1, -1], [1, -1]] as const;
      corners.forEach(([sx, sz], c) => {
        const ox = cx + sx * hx, oz = cz + sz * hz, a0 = Math.atan2(sz, sx) - Math.PI / 4;
        const arc = Math.max(2, Math.ceil((R * Math.PI) / 2 / step));
        for (let i = 0; i < arc; i++) { const a = a0 + (i / arc) * (Math.PI / 2); pts.push([ox + Math.cos(a) * R, oz + Math.sin(a) * R, Math.cos(a), Math.sin(a)]); }
        // The straight run from the end of this corner's arc to the start of the next one.
        const [nx2, nz2] = corners[(c + 1) % 4]!, a1 = a0 + Math.PI / 2;
        const x0 = ox + Math.cos(a1) * R, z0 = oz + Math.sin(a1) * R, x1 = cx + nx2 * hx + Math.cos(a1) * R, z1 = cz + nz2 * hz + Math.sin(a1) * R;
        const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / step));
        for (let i = 0; i < n; i++) pts.push([x0 + ((x1 - x0) * i) / n, z0 + ((z1 - z0) * i) / n, Math.cos(a1), Math.sin(a1)]);
      });
      return pts;
    };
    const wall = (x0: number, z0: number, x1: number, z1: number, nx: number, nz: number): void => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      physics.staticBox(new THREE.Vector3((x0 + x1) / 2 + nx * 0.5, 30, (z0 + z1) / 2 + nz * 0.5), new THREE.Vector3(len / 2 + 0.15, 32, 0.5), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.atan2(z1 - z0, x1 - x0)));
    };
    const ring = (pts: [number, number, number, number][]): void => {
      for (let i = 0; i < pts.length; i++) {
        const [x0, z0, nx, nz] = pts[i]!, [x1, z1] = pts[(i + 1) % pts.length]!;
        // The pass road's cutting leaves the valley through the rock here; its own edges close it (src/world/pass/road.ts).
        if ([0.5, 0.25, 0.75, 0, 1].some((t) => passRoad(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t) < 0.3)) continue;
        wall(x0, z0, x1, z1, nx, nz);
      }
    };
    // Slide each point out along its direction until it sits on the ragged line.
    const FACE = 0.35;
    ring(loop(0, 2.2).map(([x, z, nx, nz]) => {
      let t = 0;
      for (let k = 0; k < 6; k++) t -= cliffDistance(x + nx * t, z + nz * t) - FACE;
      return [x + nx * t, z + nz * t, nx, nz];
    }));
    ring(loop(9, 8));
  }

  bakeColours();
  zones.push(zone('valley', VALLEY.x0 - 20, VALLEY.x1 + 20, VALLEY.z0 - 20, VALLEY.z1 + 20, 'The valley'));
  return { zones, footprints, update(time) { for (const m of animated) m.uniforms.time!.value = time; } };

  // ------------------------------------------------------------ helpers
  function zone(id: Zone['id'], x0: number, x1: number, z0: number, z1: number, label: string): Zone {
    return { id, min: new THREE.Vector3(x0, -4, z0), max: new THREE.Vector3(x1, 30, z1), label };
  }

  // Places built by hand that the woods, the grass and the rocks keep clear of.
  function occupied(x: number, z: number, pad: number): boolean {
    const box2 = (x0: number, x1: number, z0: number, z1: number) => x > x0 - pad && x < x1 + pad && z > z0 - pad && z < z1 + pad;
    return box2(FIELD.x - FIELD.half, FIELD.x + FIELD.half, FIELD.z - FIELD.half, FIELD.z + FIELD.half)
      || Math.hypot(x - GROUNDS.x, z - GROUNDS.z) < GROUNDS.r + pad + 1
      || Math.hypot(x - GINKGO.x, z - GINKGO.z) < 7 + pad
      || Math.hypot(x - FALLS.x, z - FALLS.z) < FALLS.rim + pad
      || box2(TERRACES.x0, TERRACES.x1, TERRACES.z0, TERRACES.z1)
      || box2(SHRINE.x - 9, SHRINE.x + 9, SHRINE.toriiZ - 2, SHRINE.z1 + 4)
      || box2(BRIDGE.x - 3, BRIDGE.x + 3, BRIDGE.z0, BRIDGE.z1)
      || Math.hypot(x - EXIT.x, z - EXIT.z) < 5 + pad
      || Object.values(STONE_AT).some(([sx, sz]) => Math.hypot(x - sx, z - sz) < 1.6 + pad);
  }

  // Packed earth along a line, `half` wide either side of it (shifted
  // sideways by `offset`), following the ground. Under water it stops.
  function ribbon(line: readonly Pt[], half: number, offset: number, lift: number, mat: THREE.Material, skip: (x: number, z: number) => boolean): void {
    const pts = resample(line, 1.0);
    const pos: number[] = [];
    const side = (i: number, s: number): [number, number, number] => {
      const [x, z] = pts[i]!, [nx, nz] = normalAt(pts, i);
      const px = x + nx * (offset + s * half), pz = z + nz * (offset + s * half);
      return [px, ground(px, pz) + lift, pz];
    };
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i]!, [bx, bz] = pts[i + 1]!;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      if (skip(mx, mz)) continue;
      const l0 = side(i, 1), r0 = side(i, -1), l1 = side(i + 1, 1), r1 = side(i + 1, -1);
      if (Math.min(l0[1], r0[1], l1[1], r1[1]) < FLOOR_Y - 0.12 + lift) continue;
      pos.push(...r0, ...l0, ...l1, ...r0, ...l1, ...r1);
    }
    meshFrom(pos, mat, false);
  }

  // A mesh from raw triangles, flat-shaded; blades of grass are lit as the
  // ground under them is (`up`), so a thin leaf turned from the sun does not
  // read as a black sliver.
  function meshFrom(pos: number[], mat: THREE.Material, shadow: boolean, up = false, colours?: number[]): THREE.Mesh {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    if (colours) geo.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
    if (up) geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    else geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = shadow;
    m.receiveShadow = true;
    g.add(m);
    return m;
  }

  // A tuft of thin blades (rice, reeds): `n` triangles leaning out from (x, y, z).
  function blades(out: number[], x: number, y: number, z: number, n: number, h: number, lean: number, w: number, rand: () => number): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand();
      const tx = x + Math.cos(a) * lean, tz = z + Math.sin(a) * lean;
      const px = -Math.sin(a) * w, pz = Math.cos(a) * w;
      out.push(x - px, y, z - pz, x + px, y, z + pz, tx, y + h * (0.8 + rand() * 0.4), tz);
    }
  }

  function boulder(x: number, z: number, r: number, rotY: number, y?: number, collide = true): void {
    // On a bank it settles to the low side, so no edge hangs over the slope.
    const base = y ?? Math.min(ground(x, z), ground(x + r, z), ground(x - r, z), ground(x, z + r), ground(x, z - r));
    const p = at(x, base, z, rotY);
    const m = add(p, faceted(new THREE.IcosahedronGeometry(r, 0)), (Math.floor(x * 3 + z * 7) & 1) ? rock : rockDark, 0, r * 0.3, 0);
    m.scale.set(1.3, 0.75, 1.0);
    if (collide) solid(p, 0, r * 0.35, 0, r * 1.05, r * 0.55, r * 0.8);
  }

  function stoneLantern(x: number, z: number, y = ground(x, z)): void {
    const p = at(x, y, z);
    cyl(p, M.stone, 0, 0.11, 0, 0.5, 0.6, 0.22, 8);
    cyl(p, M.stone, 0, 0.67, 0, 0.16, 0.22, 0.9, 8);
    cyl(p, M.stone, 0, 1.18, 0, 0.4, 0.4, 0.12, 6);
    cyl(p, lanternGlow, 0, 1.45, 0, 0.26, 0.26, 0.42, 6);
    k.flames.push(new THREE.Vector3(x, y + 1.45, z));
    add(p, new THREE.ConeGeometry(0.62, 0.4, 6), M.stoneDark, 0, 1.86, 0);
    solid(p, 0, 1, 0, 0.4, 1, 0.4);
  }

  // A striking post in a stone foot, the straw pad facing its front (+z).
  function makiwara(p: THREE.Object3D, x: number, z: number, rotY: number): void {
    const q = new THREE.Group();
    q.position.set(x, 0, z);
    q.rotation.y = rotY;
    p.add(q);
    cyl(q, M.stoneDark, 0, 0.08, 0, 0.3, 0.34, 0.16, 7);
    box(q, M.woodLight, 0, 0.75, 0, 0.13, 1.5, 0.08);
    box(q, straw, 0, 1.2, 0.05, 0.17, 0.32, 0.06);
    for (const y of [1.08, 1.2, 1.32]) box(q, rope, 0, y, 0.05, 0.18, 0.02, 0.07, undefined, false);
    solid(q, 0, 0.75, 0, 0.1, 0.75, 0.1, 'wood');
  }

  function nobori(x: number, z: number, rotY: number, text: string): void {
    const p = at(x, 0, z, rotY);
    cyl(p, M.woodDark, 0, 1.75, 0, 0.04, 0.05, 3.5, 6);
    cyl(p, M.stoneDark, 0, 0.1, 0, 0.18, 0.22, 0.2, 6);
    box(p, M.woodDark, 0.35, 3.4, 0, 0.7, 0.04, 0.04);
    const b = paintedSign(text, { width: 0.6, vertical: true, wood: 0x2f4a7a, paint: '#f4ead8' });
    b.position.set(x + Math.cos(rotY) * 0.36, 2.25, z - Math.sin(rotY) * 0.36);
    b.rotation.y = rotY;
    b.scale.set(1, 0.55, 1);
    g.add(b);
    solid(p, 0, 1.2, 0, 0.12, 1.2, 0.12, 'wood');
  }

  // A vermilion torii over the road, its posts on black feet.
  function torii(x: number, z: number): void {
    const p = at(x, ground(x, z), z);
    const span = 2.45, h = 4.7;
    for (const s of [-1, 1]) {
      cyl(p, red, s * span, h / 2, 0, 0.2, 0.24, h, 10);
      cyl(p, ink, s * span, 0.22, 0, 0.3, 0.3, 0.44, 10);
      solid(p, s * span, h / 2, 0, 0.24, h / 2, 0.24, 'wood');
    }
    box(p, red, 0, h - 1.15, 0, span * 2 + 1.0, 0.26, 0.24);
    box(p, red, 0, h - 0.05, 0, span * 2 + 1.5, 0.3, 0.42);
    box(p, ink, 0, h + 0.2, 0, span * 2 + 1.9, 0.22, 0.55);
    for (const s of [-1, 1]) box(p, ink, s * (span + 1.05), h + 0.3, 0, 0.6, 0.2, 0.55, [0, 0, s * 0.18]);
    box(p, red, 0, h - 0.6, 0, 0.26, 0.85, 0.2);
    box(p, ink, 0, h - 0.6, 0.11, 0.42, 0.62, 0.04, undefined, false);
  }

  // A tree. Floor trees get a trunk collider and fade in their clump in the
  // cutaway; trees on the slopes are scenery. Slope trees use plainer crowns.
  function tree(x: number, z: number, kind: 'pine' | 'cedar' | 'maple' | 'gold', s: number, seed: number, floor: boolean, far = false): void {
    const t = at(x, ground(x, z) - 0.05, z, seed);
    t.rotation.z = ((seed % 3) - 1) * 0.03;
    const parts: THREE.Mesh[] = [];
    if (kind === 'pine' || kind === 'cedar') {
      const cedarTree = kind === 'cedar';
      const trunkH = (cedarTree ? 2.2 : 1.6) * s;
      parts.push(cyl(t, M.woodDark, 0, trunkH / 2, 0, 0.14 * s, 0.24 * s, trunkH, 6));
      const layers = cedarTree ? 4 : 3;
      for (let i = 0; i < layers; i++) {
        const r = cedarTree ? (1.35 - i * 0.26) * s : (2.0 - i * 0.45) * s, h = (cedarTree ? 2.4 : 2.2) * s;
        parts.push(add(t, faceted(new THREE.ConeGeometry(r, h, far ? 6 : 7)), cedarTree ? cedar : (seed + i) % 2 ? pine : pineDark, 0, trunkH + (0.6 + i * (cedarTree ? 1.35 : 1.3)) * s, 0, [0, seed + i, 0]));
      }
    } else {
      const trunkH = 2.4 * s;
      parts.push(cyl(t, M.woodDark, 0, trunkH / 2, 0, 0.16 * s, 0.26 * s, trunkH, 6));
      for (let i = 0; i < 4; i++) {
        const r = (1.4 + ((seed * 7 + i * 3) % 4) * 0.2) * s;
        const a = seed * 1.3 + i * 1.7;
        parts.push(add(t, far ? faceted(new THREE.IcosahedronGeometry(r, 0)) : new THREE.IcosahedronGeometry(r, 1), kind === 'maple' ? maple : gold, Math.cos(a) * 0.9 * s, trunkH + (0.6 + (i % 2) * 0.9) * s, Math.sin(a) * 0.9 * s));
      }
    }
    // Scenery on the slopes casts no shadow: the shadow map only reaches the
    // floor round the player, and drawing the whole wood into it costs every frame.
    if (far) for (const m of parts) m.castShadow = false;
    if (!floor) return;
    physics.staticBox(new THREE.Vector3(x, ground(x, z) + 1.2 * s, z), new THREE.Vector3(0.28 * s, 1.2 * s, 0.28 * s));
    const name = `grove:${Math.floor(x / CLUMP)}:${Math.floor(z / CLUMP)}`;
    const list = clumps.get(name);
    if (list) list.push(...parts); else clumps.set(name, parts);
  }

  // Each clump of floor trees becomes one mesh, its colours carried in the
  // vertices, so a clump fading in the cutaway is one draw and not one per colour.
  function mergeClumps(): void {
    g.updateMatrixWorld(true);
    for (const [name, parts] of clumps) {
      const merged = new THREE.Mesh(mergeGeometries(parts.map(painted), false)!, groveMat);
      merged.castShadow = true;
      merged.receiveShadow = true;
      g.add(merged);
      onRoof(merged, name, true);
    }
  }

  // The valley's props are many small pieces in many flat colours; drawn a
  // material at a time that is a draw call (and a shadow call) per colour.
  // Every plain, opaque, one-sided toon piece that never moves is folded into
  // one mesh with its colour in the vertices instead: one for the pieces that
  // cast shadows, one for the rest. Textured, see-through, offset and fading
  // pieces keep their own materials and go to the compound's bake.
  function bakeColours(): void {
    g.updateMatrixWorld(true);
    const sets = new Map<boolean, THREE.Mesh[]>([[true, []], [false, []]]);
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || m.userData.cutaway !== undefined) return;
      for (let p: THREE.Object3D | null = m; p; p = p.parent) if (p.userData.keep) return;
      const mat = m.material as THREE.MeshToonMaterial;
      if (!mat.isMeshToonMaterial || mat.map || mat.transparent || mat.polygonOffset || mat.side !== THREE.FrontSide || mat.vertexColors) return;
      sets.get(m.castShadow)!.push(m);
    });
    for (const [shadow, list] of sets) {
      if (list.length < 2) continue;
      const merged = new THREE.Mesh(mergeGeometries(list.map(painted), false)!, paintedMat);
      merged.castShadow = shadow;
      merged.receiveShadow = true;
      g.add(merged);
    }
  }

  // A piece's triangles in world space, its material's colour in every vertex; the piece leaves the scene.
  function painted(m: THREE.Mesh): THREE.BufferGeometry {
    const src = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', src.getAttribute('position').clone());
    out.setAttribute('normal', src.getAttribute('normal').clone());
    const c = (m.material as THREE.MeshToonMaterial).color, n = out.getAttribute('position').count;
    const cols = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b; }
    out.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    out.applyMatrix4(m.matrixWorld);
    m.parent?.remove(m);
    src.dispose();
    return out;
  }
}

// ------------------------------------------------------------ line helpers

const BED_Y = FLOOR_Y - 1.0;

// Points along a polyline at most `step` apart, its corners kept.
function resample(line: readonly Pt[], step: number): Pt[] {
  const out: Pt[] = [line[0]!];
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i]!, [bx, bz] = line[i + 1]!;
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  return out;
}

// The sideways unit vector at a resampled point (left of the direction of travel).
function normalAt(pts: readonly Pt[], i: number): [number, number] {
  const [ax, az] = pts[Math.max(0, i - 1)]!, [bx, bz] = pts[Math.min(pts.length - 1, i + 1)]!;
  const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1;
  return [-dz / l, dx / l];
}

