import * as THREE from 'three';
import { toon } from '../../render/materials';
import { flagstones, ashlar } from '../textures';
import { waterMaterial } from '../water';
import type { CityKit, PieceOpts } from './kit';
import { rng } from './kit';
import { INK } from './buildings';
import {
  BOUNDS, CANAL, PROMENADE, SOUTH_WALK, ODORI, EKIMAE, PLAZA, UNDER, ARCADE, BACK_W, BACK_E, CROSS, LANDING, BRIDGES,
} from './plan';

// The ground of the ward: asphalt everywhere a car could go, kerbed
// pavements and paving where people walk, the canal sunk between stone
// walls with steps down to the water, two bridges over it; and what stands
// in a Japanese street: wooden poles carrying sagging wires, a vending
// machine on a corner, ginkgo along the main road, willows on the canal.

export const GROUND = { asphalt: 0x5e6068, line: 0xe9e4d8, kerb: 0xa9a49a, paving: 0xbfb6a6, pavingLine: 0xa59c8b, lane: 0x8e8a84 } as const;

export interface Streets { water: THREE.ShaderMaterial }

export function buildStreets(k: CityKit): Streets {
  const r = rng(11);
  const paving = toon(0xffffff, { map: flagstones(GROUND.paving, 0xb3aa98, GROUND.pavingLine, 4) });
  paving.map!.repeat.set(1, 1);
  const arcadeFloor = toon(0xffffff, { map: flagstones(0xd2c6ae, 0xc6b89c, 0xa8987c, 2) });
  const stoneWall = toon(0xffffff, { map: ashlar(0x8f9596, 0x7d8486, 0x5c6264) });
  const S: PieceOpts = { shadow: false, collide: false };

  // ------------------------------------------------------------ ground
  // One asphalt slab over the ward and out past its edges, cut for the
  // canal; its collider stops at the bounds.
  const far = 120;
  k.span(GROUND.asphalt, -far, far, -0.4, 0, -far, CANAL.z0, { ...S });
  k.span(GROUND.asphalt, -far, far, -0.4, 0, CANAL.z1, far, { ...S });
  k.block(BOUNDS.x0 - 20, BOUNDS.x1 + 20, -1, 0, BOUNDS.z0 - 20, CANAL.z0, 'stone');
  k.block(BOUNDS.x0 - 20, BOUNDS.x1 + 20, -1, 0, CANAL.z1, BOUNDS.z1 + 20, 'stone');

  // Paved ground: a raised pavement (kerbed) or level paving, in metres.
  const pave = (x0: number, x1: number, z0: number, z1: number, y = 0.12, mat: THREE.Material = paving): void => {
    const m = k.span(mat, x0, x1, 0, y, z0, z1, { shadow: false, surface: 'stone' });
    boxUVWorld(m.geometry as THREE.BoxGeometry, x0, z0, 2);
    if (y > 0.05) {
      k.span(GROUND.kerb, x0 - 0.02, x1 + 0.02, y - 0.04, y + 0.005, z0 - 0.02, z0 + 0.14, S);
      k.span(GROUND.kerb, x0 - 0.02, x1 + 0.02, y - 0.04, y + 0.005, z1 - 0.14, z1 + 0.02, S);
    }
  };
  // The main road's pavements, the station street and plaza (level paving),
  // the arcade's floor, the walk along the tracks, the canal walks.
  pave(-far, far, ODORI.z0, ODORI.road0);
  pave(-far, far, ODORI.road1, ODORI.z1);
  pave(PLAZA.x0, PLAZA.x1, PLAZA.z0, PLAZA.z1, 0.04);
  pave(-far, far, UNDER.z0, UNDER.z1, 0.04);
  pave(ARCADE.x0 - 0.2, ARCADE.x1 + 0.2, ARCADE.z0, ARCADE.z1, 0.04, arcadeFloor);
  pave(-far, far, PROMENADE.z0, PROMENADE.z1, 0.12);
  pave(-far, far, SOUTH_WALK.z0, SOUTH_WALK.z1, 0.12);
  // The strip between the shop row and the promenade, and between the
  // buildings, laid as paving too.
  pave(-far, far, ODORI.z1, PROMENADE.z0, 0.04);
  // The station street: a painted edge line each side and a stop line.
  for (const z of [EKIMAE.z0 + 0.3, EKIMAE.z1 - 0.3]) k.span(GROUND.line, BOUNDS.x0, BOUNDS.x1, 0, 0.012, z - 0.06, z + 0.06, S);
  // The back streets: white edge lines and 止まれ at the main road.
  for (const b of [BACK_W, BACK_E]) {
    for (const x of [b.x0 + 0.25, b.x1 - 0.25]) k.span(GROUND.line, x - 0.06, x + 0.06, 0, 0.012, b.z0, b.z1, S);
    k.span(GROUND.line, b.x0 + 0.3, b.x1 - 0.3, 0, 0.012, b.z1 - 1.2, b.z1 - 0.9, S);
  }
  // The main road: a centre line in dashes, lane edges, and the zebra
  // crossing from the arcade to the park.
  const mid = (ODORI.road0 + ODORI.road1) / 2;
  for (let x = -far; x < far; x += 6) if (Math.abs(x) > 6) k.span(GROUND.line, x, x + 3, 0, 0.012, mid - 0.08, mid + 0.08, S);
  for (const z of [ODORI.road0 + 0.25, ODORI.road1 - 0.25]) k.span(GROUND.line, -far, far, 0, 0.012, z - 0.06, z + 0.06, S);
  for (let x = -3.6; x <= 3.6; x += 0.9) k.span(GROUND.line, x - 0.25, x + 0.25, 0, 0.014, ODORI.road0 + 0.6, ODORI.road1 - 0.6, S);
  for (const x of [-38, 46]) for (let dx = -2.4; dx <= 2.4; dx += 0.9) k.span(GROUND.line, x + dx - 0.25, x + dx + 0.25, 0, 0.014, ODORI.road0 + 0.6, ODORI.road1 - 0.6, S);
  // The lanes of the back alleys: pale concrete laid level.
  const lane = k.shared('lane', () => toon(0xa9a398));
  k.span(lane, -66, -18, 0, 0.03, -14, 18, { collide: false, shadow: false });
  // The cross alley through the shop rows: worn paving.
  pave(-14, -4, CROSS.z0, CROSS.z1, 0.04);
  pave(4, 14, CROSS.z0, CROSS.z1, 0.04);

  // ------------------------------------------------------------ canal
  // Stone walls down to a bed under shallow water, a landing at the water's
  // edge with steps down to it, stone blocks along both walls a body can
  // climb out by, and a railing along the walk.
  const C = CANAL;
  k.span(0x4e5a52, -far, far, C.bedY - 0.4, C.bedY, C.z0, C.z1, { shadow: false, surface: 'stone' });
  k.span(stoneWall, -far, far, C.bedY - 0.4, 0, C.z0 - 0.6, C.z0, { shadow: false, uv: 2 });
  k.span(stoneWall, -far, far, C.bedY - 0.4, 0, C.z1, C.z1 + 0.6, { shadow: false, uv: 2 });
  k.span(INK.parapet, -far, far, -0.02, 0.14, C.z0 - 0.5, C.z0 + 0.02, S);
  k.span(INK.parapet, -far, far, -0.02, 0.14, C.z1 - 0.02, C.z1 + 0.5, S);
  const water = waterMaterial(0x3f7f96, 0x8ac6d6);
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(far * 2, C.z1 - C.z0), water);
  sheet.rotation.x = -Math.PI / 2;
  sheet.position.copy(k.w(0, C.waterY, (C.z0 + C.z1) / 2));
  k.keep(sheet);
  // The landing: a ledge at the water's edge, steps down to it from the walk.
  const L = LANDING;
  k.span(stoneWall, L.x0, L.steps.x0, C.bedY, L.y, L.z0, L.z1, { uv: 2 });
  {
    const n = 4, rise = -L.y / n, run = (L.steps.x1 - L.steps.x0) / n;
    for (let i = 0; i < n; i++) k.span(INK.parapet, L.steps.x1 - (i + 1) * run, L.steps.x1 - i * run, C.bedY, -(i + 1) * rise, L.z0, L.z1, { surface: 'stone' });
  }
  // Climbing blocks along both walls.
  for (const [x, north] of [[-50, true], [6, true], [30, true], [56, true], [-40, false], [-8, false], [20, false], [50, false]] as const) {
    const z0 = north ? C.z0 : C.z1 - 1.2, z1 = north ? C.z0 + 1.2 : C.z1;
    k.span(stoneWall, x - 1, x + 1, C.bedY, -1.0, z0, z1, { uv: 2 });
  }
  // Railings along the walks, open where the steps and the bridges are.
  const bridgeGaps = BRIDGES.map((b) => [b.x0 - 0.2, b.x1 + 0.2] as [number, number]);
  for (const [z, gaps] of [[C.z0 - 0.3, [[L.steps.x0, L.steps.x1 + 0.3] as [number, number], ...bridgeGaps]], [C.z1 + 0.3, bridgeGaps]] as const) {
    let at = BOUNDS.x0 - 6;
    for (const [a, b] of [...gaps].sort((p, q) => p[0] - q[0])) { railing(k, at, a, z); at = b; }
    railing(k, at, BOUNDS.x1 + 6, z);
  }
  // Bridges: a flat deck on the walls with solid parapets.
  for (const b of BRIDGES) {
    const z0 = C.z0 - 0.8, z1 = C.z1 + 0.8;
    k.span(GROUND.kerb, b.x0, b.x1, b.deckY - 0.5, b.deckY, z0, z1, { surface: 'stone' });
    // Ramps on to the deck from the walks.
    for (const [za, zb] of [[z0 - 1.6, z0], [z1, z1 + 1.6]] as const) {
      const len = zb - za, ang = Math.atan2(b.deckY, len) * (za < z0 ? 1 : -1);
      k.box(GROUND.kerb, (b.x0 + b.x1) / 2, b.deckY / 2 - 0.05, (za + zb) / 2, b.x1 - b.x0, 0.2, Math.hypot(len, b.deckY), { rot: [ang, 0, 0], surface: 'stone' });
    }
    for (const x of [b.x0 + 0.12, b.x1 - 0.12]) {
      k.span(b.id === 'park' ? INK.parapet : 0x6e7f8c, x - 0.12, x + 0.12, b.deckY, b.deckY + 0.95, z0, z1);
      k.span(INK.roofDark, x - 0.16, x + 0.16, b.deckY + 0.95, b.deckY + 1.02, z0, z1, S);
    }
    k.span(INK.band, b.x0, b.x1, b.deckY - 0.7, b.deckY - 0.5, z0, z1, S);
  }

  // ------------------------------------------------------------ poles and wires
  // Wooden-look concrete poles every dozen metres along the main road's
  // south pavement, the station street and the lane through the back
  // alleys, with a crossarm, a transformer here and there, and three wires
  // sagging between each pair.
  const runs: [number, number][][] = [
    Array.from({ length: 10 }, (_, i) => [-56 + i * 12.4, ODORI.z1 - 0.5] as [number, number]),
    Array.from({ length: 5 }, (_, i) => [-62 + i * 10.6, EKIMAE.z0 + 0.4] as [number, number]),
    Array.from({ length: 4 }, (_, i) => [26 + i * 12, EKIMAE.z0 + 0.4] as [number, number]),
    [[-62.5, 6.8], [-50.5, 6.8], [-37.5, 6.8], [-26, 6.8], [-19, 6.8]],
  ];
  for (const run of runs) {
    run.forEach(([x, z], i) => pole(k, x, z, i % 3 === 1));
    for (let i = 0; i < run.length - 1; i++) for (const [dy, dz] of [[8.1, -0.55], [8.1, 0.55], [7.4, 0]] as const) wire(k, run[i]![0], run[i]![1] + dz, run[i + 1]![0], run[i + 1]![1] + dz, dy, 0.45);
  }
  // Service wires off the lane poles to the houses.
  for (const [x, z, tx, tz] of [[-50.5, 6.8, -52, 3.6], [-37.5, 6.8, -38, 7.2], [-26, 6.8, -28, 3.6], [-19, 6.8, -21, 3.6]] as const) wire(k, x, z, tx, tz, 7.4, 0.2, 5.2);

  // ------------------------------------------------------------ street trees
  // Ginkgo along the main road's north pavement, gold for the season.
  for (let x = -58; x <= 60; x += 11) if (Math.abs(x) > 8 && Math.abs(x + 16) > 3 && Math.abs(x - 16) > 3) tree(k, x + r() * 1.2, ODORI.z0 + 1.0, 'ginkgo', 0.95 + r() * 0.2, r);
  // Willows on the canal walk.
  for (let x = -60; x <= 62; x += 13) if (Math.abs(x) > 6 && Math.abs(x - 39) > 4 && Math.abs(x + 14) > 5) willow(k, x + r() * 2, PROMENADE.z0 + 1.6, r);

  // ------------------------------------------------------------ street furniture
  for (const [x, z, rot] of [[-21.4, -24, Math.PI / 2], [10, -18.6, Math.PI], [-15.4, 12, Math.PI / 2], [17.6, 19, Math.PI], [-35.4, 6.4, 0], [26, 27.2, Math.PI], [-24.6, -17.6, Math.PI]] as const) vending(k, x, z, rot, r);
  for (const [x, z] of [[-18, -22], [-14, -22], [-6, -24.8]] as const) bench(k, x, z, 0);
  // Bicycles parked along the plaza's west edge, a row of them in a rack.
  for (let i = 0; i < 8; i++) {
    const x = -21 + i * 0.7, z = -19.2;
    const g = new THREE.Group();
    g.position.copy(k.w(x, 0, z));
    k.root.add(g);
    const c = [0x7a9ab0, 0xc8463a, 0xe8e2d0, 0x3f6a4a, 0x2a2528][i % 5]!;
    for (const dz of [-0.5, 0.5]) { const w = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.03, 4, 12), k.paint(INK.black)); w.position.set(0, 0.32, dz); w.rotation.y = Math.PI / 2; w.castShadow = true; g.add(w); }
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.95), k.paint(c)); f.position.set(0, 0.56, 0); g.add(f);
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.3), k.paint(INK.steelLight)); s.position.set(0, 0.85, 0.62); g.add(s);
  }
  k.block(-21.4, -15.6, 0, 1, -19.8, -18.6);
  k.span(INK.steel, -21.6, -15.4, 0.1, 0.16, -19.25, -19.15, S);

  // The bounds: invisible walls round the ward. The west end of the main
  // road is where the pass comes in; it stays open (the region owner seals
  // it or leads the road on).
  const wallH = 30;
  k.block(BOUNDS.x0 - 1, BOUNDS.x0, -3, wallH, BOUNDS.z0, ODORI.z0);
  k.block(BOUNDS.x0 - 1, BOUNDS.x0, -3, wallH, ODORI.z1, BOUNDS.z1);
  k.block(BOUNDS.x1, BOUNDS.x1 + 1, -3, wallH, BOUNDS.z0, BOUNDS.z1);
  k.block(BOUNDS.x0, BOUNDS.x1, -3, wallH, BOUNDS.z0 - 1, BOUNDS.z0);
  k.block(BOUNDS.x0, BOUNDS.x1, -3, wallH, BOUNDS.z1, BOUNDS.z1 + 1);
  return { water };
}

// World-metre UVs on the top of a flat slab, so paving tiles at one size everywhere.
function boxUVWorld(geo: THREE.BoxGeometry, x0: number, z0: number, metres: number): void {
  const { width: w, depth: d } = geo.parameters;
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 8; i < 12; i++) uv.setXY(i, (x0 + uv.getX(i) * w) / metres, (z0 + uv.getY(i) * d) / metres);
  uv.needsUpdate = true;
}

function railing(k: CityKit, x0: number, x1: number, z: number): void {
  if (x1 - x0 < 0.3) return;
  k.span(0x56606a, x0, x1, 1.0, 1.06, z - 0.04, z + 0.04, { collide: false });
  k.span(0x56606a, x0, x1, 0.5, 0.53, z - 0.02, z + 0.02, { collide: false, shadow: false });
  for (let x = x0 + 0.1; x < x1; x += 2.0) k.box(0x56606a, x, 0.55, z, 0.06, 1.0, 0.06, { collide: false });
  k.block(x0, x1, 0, 1.4, z - 0.06, z + 0.06);
}

// A utility pole: a tapered grey column, two crossarms, insulators, and a
// transformer can on some.
function pole(k: CityKit, x: number, z: number, transformer: boolean): void {
  k.cyl(0x9e9a92, x, 4.3, z, 0.12, 0.17, 8.6, 8);
  k.solid(x, 4.3, z, 0.17, 4.3, 0.17);
  for (const y of [8.1, 7.4]) {
    k.box(INK.steel, x, y - 0.12, z, 0.1, 0.1, y > 8 ? 1.6 : 1.1, { collide: false });
    for (const dz of y > 8 ? [-0.55, 0.55] : [0]) k.cyl(INK.ac, x, y - 0.02, z + dz, 0.05, 0.06, 0.16, 6, { collide: false, shadow: false });
  }
  if (transformer) {
    k.cyl(0x7c8a8e, x + 0.42, 6.3, z, 0.24, 0.24, 0.8, 10, { collide: false });
    k.box(INK.steel, x + 0.21, 6.3, z, 0.42, 0.06, 0.06, { collide: false });
  }
  // A yellow guard on the pole's foot, as the city paints them.
  k.cyl(0xe6c13c, x, 1.0, z, 0.18, 0.18, 1.6, 8, { collide: false, shadow: false });
  for (const y of [0.4, 0.9, 1.4]) k.cyl(INK.black, x, y, z, 0.185, 0.185, 0.18, 8, { collide: false, shadow: false });
}

// A wire between two points at height `y`, sagging `sag` metres in the middle (in four straight runs).
function wire(k: CityKit, x0: number, z0: number, x1: number, z1: number, y: number, sag: number, y1 = y): void {
  const pts: THREE.Vector3[] = [];
  const n = 4;
  for (let i = 0; i <= n; i++) { const t = i / n; pts.push(new THREE.Vector3(x0 + (x1 - x0) * t, y + (y1 - y) * t - sag * 4 * t * (1 - t), z0 + (z1 - z0) * t)); }
  for (let i = 0; i < n; i++) {
    const a = pts[i]!, b = pts[i + 1]!;
    const len = a.distanceTo(b);
    const m = k.mesh(new THREE.CylinderGeometry(0.018, 0.018, len, 3), INK.black, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, { shadow: false });
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  }
}

// A drinks machine: a white cabinet, a lit front of bottles in rows, the slot.
function vending(k: CityKit, x: number, z: number, rot: number, r: () => number): void {
  const g = new THREE.Group();
  g.position.copy(k.w(x, 0, z));
  g.rotation.y = rot;
  k.root.add(g);
  const add = (color: number | THREE.Material, w: number, h: number, d: number, px: number, py: number, pz: number): void => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), typeof color === 'number' ? k.paint(color) : color);
    m.position.set(px, py, pz); m.castShadow = true; m.receiveShadow = true; g.add(m);
  };
  const body = r() < 0.5 ? 0xf1efe8 : 0xc8463a;
  add(body, 1.0, 1.85, 0.75, 0, 0.925, 0);
  add(INK.frame, 0.88, 1.0, 0.04, 0, 1.25, 0.38);
  for (let row = 0; row < 3; row++) for (let i = 0; i < 6; i++) add([0x3f8a5a, 0xc8463a, 0xe8e2d0, 0x2f6a8a, 0xd9a040, 0x8a5a2a][(i + row * 2) % 6]!, 0.08, 0.2, 0.05, -0.32 + i * 0.13, 0.95 + row * 0.3, 0.4);
  add(GROUND.kerb, 0.88, 0.04, 0.12, 0, 0.85 + 0 * 0.3, 0.42);
  add(INK.frame, 0.5, 0.18, 0.06, 0, 0.35, 0.39);
  add(0xd8d4c8, 0.14, 0.3, 0.06, 0.32, 0.75, 0.39);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.98), k.shared('vending-glow', () => new THREE.MeshBasicMaterial({ color: 0xf4f1e6 })));
  glow.position.set(0, 1.25, 0.401);
  g.add(glow);
  // A recycling bin beside it.
  add(0x2f6a8a, 0.38, 0.8, 0.38, 0.75, 0.4, 0.1);
  g.updateMatrixWorld(true);
  const c = new THREE.Vector3(0.2, 0.92, 0).applyMatrix4(g.matrixWorld);
  k.physics.staticBox(c, new THREE.Vector3(Math.abs(Math.cos(rot)) * 0.75 + Math.abs(Math.sin(rot)) * 0.42, 0.92, Math.abs(Math.sin(rot)) * 0.75 + Math.abs(Math.cos(rot)) * 0.42));
}

function bench(k: CityKit, x: number, z: number, rot: number): void {
  const g = new THREE.Group();
  g.position.copy(k.w(x, 0, z)); g.rotation.y = rot; k.root.add(g);
  const add = (c: number, w: number, h: number, d: number, px: number, py: number, pz: number): void => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), k.paint(c)); m.position.set(px, py, pz); m.castShadow = true; g.add(m); };
  add(INK.woodLight, 1.8, 0.06, 0.45, 0, 0.45, 0);
  add(INK.woodLight, 1.8, 0.35, 0.05, 0, 0.72, -0.22);
  for (const dx of [-0.75, 0.75]) add(INK.steel, 0.06, 0.45, 0.45, dx, 0.22, 0);
  k.solid(x, 0.4, z, 0.9, 0.4, 0.28);
}

// The compound's tree shapes in the city: a ginkgo is a narrow gold crown
// of a few lumps; the trunk collides.
export function tree(k: CityKit, x: number, z: number, kind: 'ginkgo' | 'zelkova' | 'cherry', s: number, r: () => number, y = 0.12): void {
  const trunkH = (kind === 'zelkova' ? 2.8 : 2.4) * s;
  k.cyl(INK.woodDark, x, y + trunkH / 2, z, 0.14 * s, 0.24 * s, trunkH, 6);
  const color = kind === 'ginkgo' ? 0xe6b83c : kind === 'cherry' ? 0xd88a7a : 0x6f9a4e;
  const n = kind === 'ginkgo' ? 4 : 5;
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2;
    const rad = (kind === 'ginkgo' ? 1.05 : 1.5) * s * (0.85 + r() * 0.3);
    const spread = kind === 'ginkgo' ? 0.5 : 1.1;
    k.mesh(new THREE.IcosahedronGeometry(rad, 1), color, x + Math.cos(a) * spread * s, y + trunkH + (kind === 'ginkgo' ? 0.4 + i * 0.75 : 0.5 + (i % 2) * 0.9) * s, z + Math.sin(a) * spread * s);
  }
  k.solid(x, y + trunkH / 2, z, 0.25 * s, trunkH / 2, 0.25 * s);
}

// A weeping willow: a low, wide crown and long thin strands hanging round
// it to near the ground, a few lighter ones at the front.
function willow(k: CityKit, x: number, z: number, r: () => number): void {
  const y = 0.12;
  k.cyl(INK.woodDark, x, y + 1.5, z, 0.14, 0.24, 3.0, 6);
  for (const [dx, dz, s] of [[0, 0, 1.5], [0.6, 0.3, 1.1], [-0.6, -0.2, 1.0]] as const) {
    const m = k.mesh(new THREE.IcosahedronGeometry(s, 1), 0x8aa858, x + dx, y + 3.6, z + dz);
    m.scale.set(1.1, 0.55, 1.1);
  }
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + r() * 0.2;
    const rad = 1.2 + r() * 0.6;
    const len = 1.8 + r() * 1.1;
    k.box(i % 3 ? 0x7f9e52 : 0xa3bd6c, x + Math.cos(a) * rad, y + 3.4 - len / 2, z + Math.sin(a) * rad, 0.05, len, 0.26, { rot: [0, -a, Math.sin(i) * 0.06], collide: false });
  }
  k.solid(x, y + 1.5, z, 0.24, 1.5, 0.24);
}
