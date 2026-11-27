import * as THREE from 'three';
import { toon, paintedSign, emissive } from '../../render/materials';
import { waterMaterial } from '../water';
import type { Kit } from '../kit';
import type { RegionLights, WaterLine } from '../region';
import { ROUTE, SITES, ROAD_HALF, type Site } from './route';
import { TARN, RAVINE, natural } from './plan';
import type { Ground } from './road';

// The places along the pass, each built by hand: two stone figures at the
// mouth of the cutting, the tarn in the hollow with its reeds, the creek
// down the ravine, the rope bridge, the tea house on its ledge, and the
// lookout at the col with its marker stone and bench.

const C = {
  stone: 0xa3a7a8, stoneDark: 0x7c8284, moss: 0x7d8f58, red: 0xcf4a32, wood: 0x7a4b34, woodDark: 0x4e3024, woodLight: 0xc49a66,
  rope: 0x9a7a4e, ropeDark: 0x6e5534, plank: 0xa08a6c, plankDark: 0x8a7458, thatch: 0xb89a62, thatchDark: 0x8e7448, plaster: 0xe9dcc4,
  earthWall: 0xc9a880, felt: 0xc8372d, indigo: 0x2f3f66, paper: 0xf6eedc, iron: 0x2a2528, reed: 0xacb86a, reedGold: 0xd9c27a,
} as const;

const site = (id: string): Site => SITES.find((s) => s.id === id)!;

export interface Sites { occluders: THREE.Mesh[]; water: WaterLine[]; animated: THREE.ShaderMaterial[] }

export function* buildSites(k: Kit, parent: THREE.Object3D, ground: Ground, lights: RegionLights, phase: (name: string) => void): Generator<void, Sites, void> {
  phase('sites:mouth');
  const occluders: THREE.Mesh[] = [];
  const water: WaterLine[] = [];
  const stream = waterMaterial(0x3f86b6, 0x8ad0ea);
  const animated = [stream];

  // ---------------------------------------------------------------- the cutting's mouth
  // Two small stone figures in red bibs either side of the way in, and a
  // weathered post with the road's name on it.
  {
    const g = k.stretch('pass:mouth', parent);
    const a = ROUTE[0]!, b = ROUTE[1]!, yaw = Math.atan2(b.x - a.x, b.z - a.z);
    for (const [side, along] of [[-1, 1.5], [1, 2.6]] as const) {
      const x = a.x + Math.cos(yaw) * side * 2.5 + Math.sin(yaw) * along, z = a.z - Math.sin(yaw) * side * 2.5 + Math.cos(yaw) * along;
      const j = k.at(g, x, ground(x, z), z, yaw + Math.PI + side * 0.3);
      k.box(j, C.stoneDark, 0, 0.1, 0, 0.6, 0.2, 0.5);
      k.cyl(j, C.stone, 0, 0.45, 0, 0.17, 0.22, 0.5, 7);
      k.rock(j, C.stone, 0, 0.82, 0, 0.15, 1);
      k.cone(j, C.red, 0, 0.58, 0.02, 0.23, 0.2, 7, [Math.PI, 0, 0]);
      k.solid(j, 0, 0.45, 0, 0.25, 0.45, 0.25);
    }
    const px = a.x - Math.cos(yaw) * 2.9 + Math.sin(yaw) * 4.2, pz = a.z + Math.sin(yaw) * 2.9 + Math.cos(yaw) * 4.2;
    const post = k.at(g, px, ground(px, pz), pz, yaw + Math.PI / 2);
    k.box(post, C.woodDark, 0, 0.95, 0, 0.2, 1.9, 0.2);
    k.solid(post, 0, 0.95, 0, 0.12, 0.95, 0.12, 'wood');
    const sign = paintedSign('峠道', { width: 0.34, vertical: true, wood: 0xc9b48c, paint: '#2b1d1a' });
    sign.scale.set(1, 0.4, 1);
    sign.position.set(px + Math.cos(yaw + Math.PI / 2) * 0.13, ground(px, pz) + 1.25, pz - Math.sin(yaw + Math.PI / 2) * 0.13);
    sign.rotation.y = yaw + Math.PI / 2;
    g.add(sign);
    k.bake(g);
  }
  yield;

  phase('sites:tarn');
  // ---------------------------------------------------------------- the tarn
  // Still water in the hollow's lowest place, reeds round its edge, a few
  // stones at the little clearing by the road.
  {
    const g = k.stretch('pass:tarn', parent);
    const pond = new THREE.Mesh(new THREE.CircleGeometry(TARN.r + 1.6, 40), stream);
    pond.rotation.x = -Math.PI / 2;
    pond.position.set(TARN.x, TARN.y - 0.25, TARN.z);
    pond.userData.keep = true;
    g.add(pond);
    const reeds: number[] = [];
    let seed = 3;
    const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 70; i++) {
      const a = r() * Math.PI * 2, d = TARN.r - 0.6 + r() * 2.4, x = TARN.x + Math.cos(a) * d, z = TARN.z + Math.sin(a) * d;
      const y = ground(x, z);
      if (y > TARN.y + 1.2) continue;
      for (let b = 0; b < 4; b++) {
        const ba = r() * Math.PI * 2, h = 0.9 + r() * 0.8, w = 0.05, tx = x + Math.cos(ba) * 0.25, tz = z + Math.sin(ba) * 0.25;
        reeds.push(x - Math.sin(ba) * w, y, z + Math.cos(ba) * w, x + Math.sin(ba) * w, y, z - Math.cos(ba) * w, tx, y + h, tz);
      }
    }
    k.tris(g, reeds, toon(C.reed, { side: THREE.DoubleSide }), false, true);
    const clearing = site('tarn');
    for (const [dx, dz, s] of [[-1.6, 1.2, 0.5], [1.9, -0.6, 0.38], [0.6, 2.2, 0.3]] as const) k.rock(g, C.stoneDark, clearing.x + dx, clearing.y + s * 0.2, clearing.z + dz, s, 0, [1.4, 0.6, 1]);
    water.push({ pts: [[TARN.x - TARN.r, TARN.z], [TARN.x + TARN.r, TARN.z]], y: TARN.y - 0.25 });
    k.bake(g);
  }
  yield;

  phase('sites:creek');
  // ---------------------------------------------------------------- the creek
  // Down the ravine's floor into the tarn: a strip of painted water laid on the bed.
  {
    const g = k.stretch('pass:creek', parent);
    const pts: [number, number][] = [];
    // From below the steps (the ravine's head is under the road) down to the tarn.
    for (let i = 1; i < RAVINE.length - 1; i++) {
      const [ax, az] = RAVINE[i]!, [bx, bz] = RAVINE[i + 1]!, n = Math.ceil(Math.hypot(bx - ax, bz - az) / 1.5);
      for (let s = 0; s < n; s++) pts.push([ax + ((bx - ax) * s) / n, az + ((bz - az) * s) / n]);
    }
    pts.push(RAVINE[RAVINE.length - 1]! as [number, number]);
    const pos: number[] = [];
    const half = 0.9;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i]!, [bx, bz] = pts[i + 1]!, l = Math.hypot(bx - ax, bz - az), nx = -(bz - az) / l * half, nz = (bx - ax) / l * half;
      const ya = Math.max(natural(ax, az), ground(ax, az)) + 0.12, yb = Math.max(natural(bx, bz), ground(bx, bz)) + 0.12;
      pos.push(ax + nx, ya, az + nz, bx - nx, yb, bz - nz, ax - nx, ya, az - nz, ax + nx, ya, az + nz, bx + nx, yb, bz + nz, bx - nx, yb, bz - nz);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const creek = new THREE.Mesh(geo, stream);
    creek.userData.keep = true;
    g.add(creek);
    // Stones in the bed.
    for (let i = 3; i < pts.length - 2; i += 3) { const [x, z] = pts[i]!; k.rock(g, i % 2 ? C.stoneDark : C.stone, x + ((i * 7) % 3 - 1) * 0.7, ground(x, z) + 0.1, z, 0.4 + (i % 4) * 0.12, 0, [1.3, 0.6, 1]); }
    water.push({ pts, y: ground(...pts[Math.floor(pts.length / 2)]!) });
    k.bake(g);
  }
  yield;

  phase('sites:bridge');
  yield* ropeBridge(k, parent, ground);
  phase('sites:teahouse');
  yield* teaHouse(k, parent, ground, lights, occluders);
  phase('sites:lookout');
  yield* lookout(k, parent, ground, lights);
  return { occluders, water, animated };
}

// ---------------------------------------------------------------- the rope bridge
// Plank deck on two main ropes that sag a little across the ravine, rope
// hand lines at waist height on hangers, an A-frame of timber at each end
// with the ropes running back to stakes in the ground. Walking it sounds of wood.
function* ropeBridge(k: Kit, parent: THREE.Object3D, ground: Ground): Generator<void, void, void> {
  const i = ROUTE.findIndex((n) => n.pave === 'rope');
  const a = ROUTE[i]!, b = ROUTE[i + 1]!;
  const g = k.stretch('pass:bridge', parent);
  const len = Math.hypot(b.x - a.x, b.z - a.z), yaw = Math.atan2(b.x - a.x, b.z - a.z), SAG = 0.55, HALF = 0.95;
  const deckY = (t: number): number => a.y + (b.y - a.y) * t - SAG * 4 * t * (1 - t);
  const p = k.at(g, a.x, 0, a.z, yaw);
  // Local frame: +z along the bridge from a to b, +x to the right-hand side looking from a.
  const N = Math.round(len / 0.32);
  for (let s = 0; s < N; s++) {
    const t = (s + 0.5) / N, z = t * len;
    const plank = k.box(p, s % 3 === 0 ? C.plankDark : C.plank, 0, deckY(t) - 0.05, z, HALF * 2 + (s % 2) * 0.12, 0.07, 0.26);
    plank.rotation.z = ((s * 7) % 5 - 2) * 0.012;
    if (s % 20 === 19) yield;
  }
  yield;
  // The deck's colliders: short boxes following the sag.
  const PIECES = 10;
  for (let s = 0; s < PIECES; s++) {
    const t0 = s / PIECES, t1 = (s + 1) / PIECES, y0 = deckY(t0), y1 = deckY(t1), pitch = -Math.atan2(y1 - y0, len / PIECES);
    k.solid(p, 0, (y0 + y1) / 2 - 0.09, ((t0 + t1) / 2) * len, HALF + 0.05, 0.06, len / PIECES / 2 + 0.05, 'wood', new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, 0, 0)));
  }
  // Ropes: under the deck edges, and the hand lines with hangers down to them.
  const rope = (x: number, lift: (t: number) => number, thick: number, color: number): void => {
    const M = 16;
    for (let s = 0; s < M; s++) {
      const t0 = s / M, t1 = (s + 1) / M;
      const from = new THREE.Vector3(x, lift(t0), t0 * len), to = new THREE.Vector3(x, lift(t1), t1 * len);
      const m = k.cyl(p, color, (from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2, thick, thick, from.distanceTo(to) + 0.02, 5, undefined, false);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
    }
  };
  for (const side of [-1, 1]) {
    yield;
    rope(side * (HALF - 0.05), (t) => deckY(t) - 0.12, 0.05, C.ropeDark);
    rope(side * (HALF + 0.12), (t) => deckY(t) + 1.0 + SAG * 0.6 * 4 * t * (1 - t), 0.04, C.rope);
    for (let s = 1; s < 12; s++) {
      const t = s / 12, top = deckY(t) + 1.0 + SAG * 0.6 * 4 * t * (1 - t), bot = deckY(t) - 0.1;
      k.cyl(p, C.rope, side * (HALF + 0.05), (top + bot) / 2, t * len, 0.018, 0.018, top - bot, 4, [0, 0, -side * 0.08], false);
    }
    // The hand line holds a body in: a wall to well overhead.
    k.solid(p, side * (HALF + 0.2), a.y + 14, len / 2, 0.1, 15, len / 2, 'wood');
  }
  yield;
  // The A-frames and the stakes behind them.
  for (const [t, back] of [[0, -1], [1, 1]] as const) {
    const z = t * len, y = deckY(t);
    for (const side of [-1, 1]) {
      k.cyl(p, C.woodDark, side * (HALF + 0.25), y + 0.9, z, 0.09, 0.12, 2.2, 7, [0, 0, side * 0.08]);
      k.solid(p, side * (HALF + 0.25), y + 0.9, z, 0.12, 1.1, 0.12, 'wood');
      const sx = side * (HALF + 0.9), sz = z + back * 2.6;
      const wx = a.x + Math.cos(yaw) * sx + Math.sin(yaw) * sz, wz = a.z - Math.sin(yaw) * sx + Math.cos(yaw) * sz;
      const sy = ground(wx, wz);
      k.cyl(p, C.woodDark, sx, sy + 0.25, sz, 0.07, 0.09, 0.6, 6);
      const from = new THREE.Vector3(side * (HALF + 0.25), y + 1.9, z), to = new THREE.Vector3(sx, sy + 0.45, sz);
      const m = k.cyl(p, C.ropeDark, (from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2, 0.035, 0.035, from.distanceTo(to), 5, undefined, false);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
    }
    k.box(p, C.woodDark, 0, y + 2.0, z, HALF * 2 + 0.8, 0.16, 0.18);
    k.box(p, C.wood, 0, y + 2.18, z, HALF * 2 + 1.1, 0.1, 0.26);
  }
  yield;
  k.bake(g);
  yield;
}

// ---------------------------------------------------------------- the tea house
// A small house on the ledge above the bridge, its front open to the road:
// a deep thatched roof, posts and a low earth wall, an indigo curtain across
// the front with 茶 on it, a bench under a red felt cloth and a red parasol
// beside it, a lantern on a post and a banner. The roof fades for the
// top-down camera when the player stands under it.
function* teaHouse(k: Kit, parent: THREE.Object3D, ground: Ground, lights: RegionLights, occluders: THREE.Mesh[]): Generator<void, void, void> {
  const S = site('teahouse');
  const g = k.stretch('pass:teahouse', parent);
  // The house stands back from the road, its front (local +z) facing it (west-south-west).
  const road = ROUTE.find((n) => Math.hypot(n.x - S.x, n.z - S.z) < 8)!;
  const face = Math.atan2(road.x - S.x, road.z - S.z);
  const hx = S.x + Math.sin(face) * -1.8, hz = S.z + Math.cos(face) * -1.8;
  const p = k.at(g, hx, S.y, hz, face);
  const W = 5.2, D = 3.8, H = 2.3;
  // Floor platform, posts, back and side walls.
  k.box(p, C.stoneDark, 0, 0.12, 0, W + 0.4, 0.24, D + 0.4);
  k.box(p, C.plank, 0, 0.36, -0.3, W - 0.2, 0.12, D - 1.0);
  k.solid(p, 0, 0.21, -0.3, W / 2 - 0.1, 0.21, D / 2 - 0.5, 'wood');
  for (const [px, pz] of [[-W / 2, -D / 2], [W / 2, -D / 2], [-W / 2, D / 2], [W / 2, D / 2], [0, D / 2]] as const) {
    k.box(p, C.woodDark, px, H / 2 + 0.2, pz, 0.16, H, 0.16);
    k.solid(p, px, H / 2 + 0.2, pz, 0.1, H / 2, 0.1, 'wood');
  }
  k.box(p, C.earthWall, 0, H / 2 + 0.2, -D / 2 + 0.05, W - 0.2, H, 0.12);
  k.solid(p, 0, H / 2 + 0.2, -D / 2 + 0.05, W / 2, H / 2 + 0.2, 0.12, 'wood');
  for (const side of [-1, 1]) {
    k.box(p, C.earthWall, side * (W / 2 - 0.05), H / 2 + 0.2, -0.6, 0.12, H, D - 1.4);
    k.solid(p, side * (W / 2 - 0.05), H / 2 + 0.2, -0.6, 0.12, H / 2 + 0.2, D / 2 - 0.7, 'wood');
    // A lattice window in each side.
    for (let s = -2; s <= 2; s++) k.box(p, C.woodDark, side * (W / 2 + 0.02), H * 0.62, -0.4 + s * 0.16, 0.05, 0.6, 0.04, undefined, false);
  }
  k.box(p, C.woodDark, 0, H + 0.24, D / 2, W + 0.3, 0.16, 0.2);
  yield;
  // Inside: a hearth with a kettle, shelves of cups.
  k.box(p, C.stoneDark, 0.9, 0.55, -0.9, 0.9, 0.3, 0.9);
  k.cyl(p, C.iron, 0.9, 0.86, -0.9, 0.22, 0.26, 0.3, 9);
  k.box(p, C.wood, -1.3, 1.2, -D / 2 + 0.3, 1.8, 0.06, 0.32);
  for (let c = 0; c < 5; c++) k.cyl(p, c % 2 ? C.paper : 0x5d7f6c, -2 + c * 0.34, 1.29, -D / 2 + 0.3, 0.06, 0.05, 0.12, 7, undefined, false);
  // The thatch: a deep hipped roof, a ridge on top, eaves cut level.
  const roof = new THREE.Group();
  roof.position.set(0, H + 0.3, 0);
  p.add(roof);
  const thatch = k.cone(roof, C.thatch, 0, 1.35, 0, 4.7, 2.7, 4, [0, Math.PI / 4, 0]);
  thatch.scale.set(1.0, 1, 0.78);
  const ridge = k.box(roof, C.thatchDark, 0, 2.55, 0, 2.6, 0.32, 0.5);
  const eave = k.box(roof, C.thatchDark, 0, 0.02, 0, W + 1.9, 0.18, D + 1.9);
  for (const m of [thatch, ridge, eave]) { m.userData.cutaway = 'teahouse'; m.userData.ghost = true; }
  // The curtain across the front in three panels, 茶 on the middle one.
  for (let s = -1; s <= 1; s++) {
    if (s === 0) {
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.75), toon(0xffffff, { map: clothTexture('茶') }));
      panel.position.set(0, H - 0.25, D / 2 + 0.07);
      p.add(panel);
    } else k.box(p, C.indigo, s * 1.62, H - 0.25, D / 2 + 0.05, 1.5, 0.75, 0.03, undefined, false);
  }
  yield;
  // The bench out front under its red cloth, the parasol, a lantern post and a banner.
  const bench = k.at(p, -0.6, 0, D / 2 + 1.7, 0);
  k.box(bench, C.woodLight, 0, 0.42, 0, 2.0, 0.08, 0.7);
  k.box(bench, C.felt, 0, 0.47, 0, 2.04, 0.025, 0.74, undefined, false);
  k.box(bench, C.felt, 0, 0.38, 0.37, 2.04, 0.18, 0.02, undefined, false);
  for (const sx of [-0.85, 0.85]) for (const sz of [-0.28, 0.28]) k.box(bench, C.woodDark, sx, 0.2, sz, 0.08, 0.4, 0.08);
  k.solid(bench, 0, 0.25, 0, 1.0, 0.25, 0.36, 'wood');
  // A cup and a plate of dumplings on the cloth.
  k.cyl(bench, C.paper, 0.5, 0.53, 0.05, 0.05, 0.04, 0.09, 8, undefined, false);
  k.cyl(bench, C.woodDark, -0.3, 0.5, 0, 0.14, 0.14, 0.02, 10, undefined, false);
  for (const dx of [-0.36, -0.3, -0.24]) k.rock(bench, 0xf3e6c8, dx, 0.53, 0, 0.035, 1);
  const parasol = k.at(p, 1.3, 0, D / 2 + 1.9, 0);
  k.cyl(parasol, C.woodDark, 0, 1.25, 0, 0.03, 0.04, 2.5, 6);
  const shade = k.cone(parasol, C.felt, 0, 2.55, 0, 1.55, 0.55, 16);
  shade.material = toon(C.felt, { side: THREE.DoubleSide });
  for (let r = 0; r < 8; r++) { const a = (r / 8) * Math.PI * 2; k.box(parasol, C.woodDark, Math.cos(a) * 0.75, 2.42, Math.sin(a) * 0.75, 1.5, 0.02, 0.02, [0, -a, -0.32], false); }
  k.solid(parasol, 0, 1.2, 0, 0.06, 1.2, 0.06, 'wood');
  yield;
  const lp = k.at(p, -W / 2 - 0.6, 0, D / 2 + 0.6, 0);
  k.box(lp, C.woodDark, 0, 0.95, 0, 0.12, 1.9, 0.12);
  k.box(lp, C.woodDark, 0, 1.95, 0, 0.5, 0.08, 0.5);
  const lantern = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.44, 0.36), emissive(0xffb36b, 2.2));
  lantern.position.set(0, 1.68, 0);
  lantern.userData.keep = true;
  lp.add(lantern);
  k.solid(lp, 0, 0.95, 0, 0.1, 0.95, 0.1, 'wood');
  const lw = new THREE.Vector3();
  lantern.getWorldPosition(lw);
  lights.add({ kind: 'point', position: lw.sub(k.root.getWorldPosition(new THREE.Vector3())), color: new THREE.Color(0xffb36b), intensity: 8, distance: 9, decay: 2 });
  const banner = k.at(p, W / 2 + 0.7, 0, D / 2 + 0.9, 0);
  k.cyl(banner, C.woodDark, 0, 1.75, 0, 0.04, 0.05, 3.5, 6);
  k.box(banner, C.woodDark, -0.35, 3.4, 0, 0.7, 0.04, 0.04);
  const flag = paintedSign('御休処', { width: 0.6, vertical: true, wood: 0xf1e7cf, paint: '#8c2a1e' });
  flag.children[0]!.visible = false;
  flag.scale.set(1, 0.55, 1);
  flag.position.set(-0.36, 2.28, 0.02);
  banner.add(flag);
  k.solid(banner, 0, 1.6, 0, 0.08, 1.6, 0.08, 'wood');
  yield;
  // Bake the house; the roof stays its own, fading mesh.
  k.bake(g);
  yield;
  const roofMesh = k.clump([thatch, ridge, eave], g, 'teahouse');
  occluders.push(roofMesh);
  yield;
}

// ---------------------------------------------------------------- the lookout
// At the col: a marker stone carved 峠, a plain bench facing south over the
// knoll toward the city's skyline, a stone lantern, and an old pine leaning
// out over the drop.
function* lookout(k: Kit, parent: THREE.Object3D, ground: Ground, lights: RegionLights): Generator<void, void, void> {
  const S = site('lookout');
  const g = k.stretch('pass:lookout', parent);
  const south = Math.PI * 0.03;
  // The marker: a tall dressed stone on a plinth, the character cut into its face.
  const mk = k.at(g, S.x - 1.5, S.y, S.z - 2.6, south + 0.5);
  k.box(mk, C.stoneDark, 0, 0.15, 0, 1.0, 0.3, 0.8);
  k.box(mk, C.stone, 0, 1.2, 0, 0.55, 1.9, 0.4);
  k.box(mk, C.stone, 0, 2.2, 0, 0.6, 0.12, 0.45);
  k.solid(mk, 0, 1.1, 0, 0.5, 1.1, 0.4);
  const carved = paintedSign('峠', { width: 0.34, vertical: true, wood: 0xa3a7a8, paint: '#3b3a36' });
  carved.children[0]!.visible = false;
  carved.scale.set(1, 0.36, 1);
  carved.position.set(0, 1.45, 0.19);
  mk.add(carved);
  yield;
  // The bench, facing the view.
  const bench = k.at(g, S.x + 0.6, S.y, S.z + 2.0, south);
  k.box(bench, C.woodLight, 0, 0.44, 0, 2.2, 0.08, 0.42);
  for (const sx of [-0.9, 0.9]) k.box(bench, C.woodDark, sx, 0.2, 0, 0.1, 0.4, 0.38);
  k.solid(bench, 0, 0.24, 0, 1.1, 0.24, 0.22, 'wood');
  // A stone lantern.
  const sl = k.at(g, S.x - 3.0, S.y, S.z + 1.0);
  k.cyl(sl, C.stone, 0, 0.11, 0, 0.42, 0.5, 0.22, 8);
  k.cyl(sl, C.stone, 0, 0.6, 0, 0.14, 0.2, 0.8, 8);
  k.cyl(sl, C.stone, 0, 1.05, 0, 0.34, 0.34, 0.1, 6);
  const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.36, 6), emissive(0xffb36b, 2.0));
  glow.position.set(0, 1.28, 0);
  glow.userData.keep = true;
  sl.add(glow);
  k.cone(sl, C.stoneDark, 0, 1.65, 0, 0.54, 0.36, 6);
  k.solid(sl, 0, 0.9, 0, 0.36, 0.9, 0.36);
  lights.add({ kind: 'point', position: new THREE.Vector3(S.x - 3.0, S.y + 1.4, S.z + 1.0), color: new THREE.Color(0xffb36b), intensity: 5, distance: 7, decay: 2 });
  // The old pine, leaning out over the south edge.
  const px = S.x + 4.2, pz = S.z + 4.4, py = ground(px, pz);
  const pine = k.at(g, px, py, pz, 0.4);
  const lean = 0.42;
  k.cyl(pine, C.woodDark, 0.9, 1.7, 0, 0.18, 0.3, 3.8, 7, [0, 0, -lean]);
  k.cyl(pine, C.woodDark, 2.1, 3.7, 0.3, 0.12, 0.18, 2.4, 6, [0.2, 0, -1.05]);
  for (const [x, y, z, r] of [[1.9, 3.9, 0, 1.6], [3.4, 4.3, 0.4, 1.3], [0.6, 3.4, -0.5, 1.1], [2.6, 4.9, -0.3, 1.0]] as const) {
    const pad = k.cyl(pine, (x * 10) % 2 > 1 ? 0x2f6440 : 0x3e7d4a, x, y, z, r, r * 1.15, 0.5, 9);
    pad.scale.z = 0.8;
  }
  k.solid(pine, 0.2, 1.2, 0, 0.3, 1.2, 0.3, 'wood');
  yield;
  k.bake(g);
  yield;
}

export { ROAD_HALF };

// An indigo cloth panel with one character dyed out of it in white.
function clothTexture(text: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#2f3f66';
  g.fillRect(0, 0, 256, 128);
  g.font = '700 92px "Shippori Mincho B1", "Zen Kaku Gothic New", serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#f4ead8';
  g.fillText(text, 128, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
