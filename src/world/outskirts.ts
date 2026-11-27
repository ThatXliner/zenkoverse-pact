import * as THREE from 'three';
import { toon, emissive, paintedSign, faceted } from '../render/materials';
import { Kit, tree, rng } from './kit';
import { Strokes, TONES } from './strokes';
import { waterMaterial } from './water';
import type { MapMark, Place, RegionContent, RegionDef, Zone, Pt } from './region';
import type { Surface } from '../audio/surfaces';

// Where the pass road comes down onto the plain at the city's edge: the
// road goes on metalled between harvested rice fields, past a farmhouse
// with a persimmon tree and a bus stop with a vending machine, utility poles
// trailing their wires, then bends east between hedges and runs straight
// into the ward's main road (`CITY_ATTACH`, src/world/atlas.ts).
//
// Its frame: the road comes in along +z from the origin, the plain at y = 0.

export const OUTSKIRTS_ORIGIN = new THREE.Vector3(66, 20.2, 450);

const ROAD_HALF = 2.6;
const HEDGE = 16;
// The road's line: south from the foot of the pass, round the bend, east to the ward.
const ROAD_LINE: readonly Pt[] = [[0, -4], [0, 66], [0.6, 70.5], [2.4, 74.2], [5.2, 76.9], [9, 78], [30, 78]];
const BEND_Z = 78;
const EAST_END = 30;
// Where the road meets the next region: the end of the eastward stretch, in the world.
export const CITY_ATTACH = OUTSKIRTS_ORIGIN.clone().add(new THREE.Vector3(EAST_END, 0, BEND_Z));
// The ward's footprint on the plain (its ground, its canal reaching past its edge), which the plain leaves to it.
const WARD = { x0: EAST_END - 2, x1: EAST_END + 148, z0: BEND_Z - 75, z1: BEND_Z + 31 } as const;

const C = {
  ground: 0x9aa65a, asphalt: 0x5d5c61, line: 0xe9e4d6, hedge: 0x4f7a45, hedgeDark: 0x3e6438,
  pole: 0x8a8580, wire: 0x2a2528, plaster: 0xf3e9d8, tile: 0x55688a, tileEdge: 0x33425a, wood: 0x7a4b34, woodDark: 0x4e3024,
  shelter: 0xd8d2c4, roof: 0x7d8a8e, sign: 0x2f5aa8, vend: 0xd6e2ea, vendDark: 0x3a5d86, straw: 0xd8bf86, persimmon: 0xf08a24, leaf: 0xb8742c,
} as const;

const SPAWNS = {
  busstop: new THREE.Vector3(-1.4, 0.05, 32),
  bend: new THREE.Vector3(14, 0.05, BEND_Z),
} as const;

const PLACES: readonly Place[] = [
  { id: 'busstop', name: 'Bus stop', jp: '停留所', glyph: '停', blurb: 'Where the mountain road meets the plain. Two buses a day, by the board.', at: new THREE.Vector3(-4, 0, 32), label: new THREE.Vector3(-4, 3.6, 32), shrine: new THREE.Vector3(5.2, 0, 26) },
];

const zone = (id: string, label: string, jp: string, x0: number, x1: number, z0: number, z1: number, general = false): Zone =>
  ({ id, label, jp, min: new THREE.Vector3(x0, -20, z0), max: new THREE.Vector3(x1, 60, z1), general });

const MARKS: MapMark[] = [
  { kind: 'box', class: 'ground', x: -90, z: -4, w: WARD.x0 + 90, d: 110 },
  { kind: 'box', class: 'field', x: -HEDGE + 1, z: 40, w: HEDGE - 4, d: 38 },
  { kind: 'box', class: 'field', x: 3, z: 8, w: HEDGE - 4, d: 62 },
  { kind: 'line', class: 'road', pts: ROAD_LINE },
  { kind: 'box', class: 'structure', x: -28, z: 50, w: 9, d: 7 },
  { kind: 'box', class: 'structure', x: -6.5, z: 30, w: 3, d: 4 },
];

export const OUTSKIRTS: RegionDef = {
  id: 'outskirts',
  name: 'The outskirts',
  origin: OUTSKIRTS_ORIGIN.clone(),
  bounds: { x0: -60, x1: EAST_END, z0: -2, z1: 96 },
  stream: { load: 170, drop: 250 },
  spawns: SPAWNS,
  places: PLACES,
  map: { scope: { id: 'pass', label: 'Pass', view: { x: -40 - OUTSKIRTS_ORIGIN.x, z: 70 - OUTSKIRTS_ORIGIN.z, w: 230, h: 470 } }, marks: MARKS },
  *build(ctx): Generator<void, RegionContent, void> {
    const k = new Kit(ctx.group, ctx.physics);
    const rand = rng(88);
    ctx.phase('ground');
    const g = k.stretch('outskirts:plain');
    // ---------------------------------------------------------- ground
    // The plain under the fields, out past where anyone can walk, leaving
    // the ward its own ground; one collider for the walkable part.
    const groundMat = toon(C.ground);
    const plainRect = (x0: number, x1: number, z0: number, z1: number): void => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), groundMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set((x0 + x1) / 2, -0.02, (z0 + z1) / 2);
      m.receiveShadow = true;
      m.userData.keep = true;
      g.add(m);
    };
    plainRect(-380, WARD.x0, -10, 560);
    plainRect(WARD.x1, 380, -10, 560);
    plainRect(WARD.x0, WARD.x1, -10, WARD.z0);
    plainRect(WARD.x0, WARD.x1, WARD.z1, 560);
    ctx.physics.box(new THREE.Vector3(-25, -1, 45), new THREE.Vector3(55, 1, 55), undefined, 'ground');
    const flat = (c: number): THREE.MeshToonMaterial => { const m = toon(c); m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -4; return m; };
    // ---------------------------------------------------------- the paddies
    ctx.phase('paddies');
    const growth = new Strokes(rand, () => 0);
    const paddyWater = waterMaterial(0x7fb3c6, 0xd2e9ef);
    yield* paddies(k, g, growth, paddyWater, rand);
    ctx.phase('verges');
    yield* verges(k, g, growth, rand);
    yield;
    ctx.phase('road');
    // ---------------------------------------------------------- the road
    // A metalled strip along the line, a white line along each edge.
    const ribbon = (half: number, off: number, lift: number, mat: THREE.Material): void => {
      const pos: number[] = [];
      for (let i = 0; i < ROAD_LINE.length - 1; i++) {
        const [ax, az] = ROAD_LINE[i]!, [bx, bz] = ROAD_LINE[i + 1]!;
        const n = (p: number): [number, number] => {
          const [px, pz] = ROAD_LINE[Math.max(0, p - 1)]!, [qx, qz] = ROAD_LINE[Math.min(ROAD_LINE.length - 1, p + 1)]!, l = Math.hypot(qx - px, qz - pz);
          return [-(qz - pz) / l, (qx - px) / l];
        };
        const [anx, anz] = n(i), [bnx, bnz] = n(i + 1);
        const A = (s: number): [number, number, number] => [ax + anx * (off + s * half), lift, az + anz * (off + s * half)];
        const B = (s: number): [number, number, number] => [bx + bnx * (off + s * half), lift, bz + bnz * (off + s * half)];
        pos.push(...A(-1), ...A(1), ...B(1), ...A(-1), ...B(1), ...B(-1));
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.computeVertexNormals();
      // Wound either way round depending on the turn: drawn from both sides, it lies flat on the ground.
      const m = new THREE.Mesh(geo, mat);
      (m.material as THREE.Material).side = THREE.DoubleSide;
      m.receiveShadow = true;
      m.userData.keep = true;
      g.add(m);
    };
    ribbon(ROAD_HALF, 0, 0.02, flat(C.asphalt));
    const line = flat(C.line);
    for (const s of [-1, 1]) ribbon(0.07, s * (ROAD_HALF - 0.25), 0.03, line);
    // An old country road: patched where it was dug up, a manhole or two, a
    // curve mirror on the outside of the bend, and a stone jizo in a red bib
    // by the bus stop.
    {
      const patch = flat(0x4e4d52), worn = flat(0x6a686c), iron = flat(0x3a3a3e);
      for (const [x, z, w, d, m] of [[-0.9, 9, 1.3, 3.2, patch], [1.1, 22, 1.0, 1.8, worn], [0, 44, 4.6, 0.9, patch], [-1.2, 57, 1.6, 5.2, worn], [0.6, 63, 1.1, 1.2, patch]] as const) {
        const q = new THREE.Mesh(new THREE.PlaneGeometry(w, d), m);
        q.rotation.x = -Math.PI / 2;
        q.position.set(x, 0.025, z);
        q.receiveShadow = true;
        q.userData.keep = true;
        g.add(q);
      }
      for (const [x, z] of [[0.9, 15], [0.9, 47], [16, BEND_Z - 0.8]] as const) {
        const c = new THREE.Mesh(new THREE.CircleGeometry(0.34, 14), iron);
        c.rotation.x = -Math.PI / 2;
        c.position.set(x, 0.028, z);
        c.receiveShadow = true;
        c.userData.keep = true;
        g.add(c);
      }
      // The curve mirror, turned to show each way round the bend.
      const cm = k.at(g, -3.3, 0, BEND_Z + 3.0, Math.PI * 0.75);
      k.cyl(cm, 0xe0702a, 0, 1.6, 0, 0.05, 0.06, 3.2, 8);
      k.box(cm, 0xe0702a, 0, 3.0, 0.12, 0.08, 0.08, 0.3);
      k.cyl(cm, 0xe0702a, 0, 3.0, 0.3, 0.46, 0.46, 0.06, 18, [Math.PI / 2, 0, 0]);
      k.cyl(cm, 0xc8dbe6, 0, 3.0, 0.34, 0.4, 0.4, 0.02, 18, [Math.PI / 2, 0, 0], false);
      k.solid(cm, 0, 1.6, 0, 0.07, 1.6, 0.07);
      const jz = k.at(g, -3.5, 0, 27.6, Math.PI / 2 + 0.2);
      k.box(jz, 0x8a8580, 0, 0.12, 0, 0.6, 0.24, 0.5);
      k.cyl(jz, 0xa3a7a8, 0, 0.5, 0, 0.16, 0.2, 0.52, 7);
      k.rock(jz, 0xa3a7a8, 0, 0.86, 0, 0.15, 1);
      k.cone(jz, 0xcf4a32, 0, 0.62, 0.02, 0.22, 0.2, 7, [Math.PI, 0, 0]);
      k.solid(jz, 0, 0.45, 0, 0.3, 0.45, 0.25);
    }
    // Utility poles down the east verge and along the north side of the eastward stretch, their wires sagging between them.
    let prev: THREE.Vector3[] | null = null;
    for (const [px, pz, yaw] of [[4.2, 4, 0], [4.2, 28, 0], [4.2, 52, 0], [8, 73.4, 0.9], [19, 74, Math.PI / 2], [EAST_END - 1, 74, Math.PI / 2]] as const) {
      const p = k.at(g, px, 0, pz, yaw);
      k.cyl(p, C.pole, 0, 4.4, 0, 0.12, 0.16, 8.8, 8);
      k.box(p, C.pole, 0, 8.2, 0, 1.6, 0.1, 0.12);
      k.cyl(p, 0x4a4a4e, 0.45, 7.4, 0, 0.22, 0.22, 0.6, 8);
      k.solid(p, 0, 4.4, 0, 0.16, 4.4, 0.16);
      const tops = [-0.7, 0, 0.7].map((dx) => new THREE.Vector3(px + Math.cos(yaw) * dx, 8.32, pz - Math.sin(yaw) * dx));
      if (prev) for (let w = 0; w < 3; w++) {
        const a = prev[w]!, b = tops[w]!;
        for (let s = 0; s < 6; s++) {
          const t0 = s / 6, t1 = (s + 1) / 6, sag = (t: number) => 0.6 * 4 * t * (1 - t);
          const from = a.clone().lerp(b, t0).setY(a.y - sag(t0)), to = a.clone().lerp(b, t1).setY(a.y - sag(t1));
          const m = k.cyl(g, C.wire, (from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2, 0.018, 0.018, from.distanceTo(to), 4, undefined, false);
          m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
        }
      }
      prev = tops;
      yield;
    }
    ctx.phase('busstop');
    // ---------------------------------------------------------- the bus stop
    {
      const p = k.at(g, -5, 0, 32, Math.PI / 2);
      k.box(p, 0xb8b2a6, 0, 0.06, 0, 4.2, 0.12, 2.4);
      for (const sx of [-1.9, 1.9]) { k.box(p, C.woodDark, sx, 1.2, -0.9, 0.12, 2.4, 0.12); k.box(p, C.woodDark, sx, 1.1, 0.9, 0.12, 2.2, 0.12); k.solid(p, sx, 1.2, 0, 0.1, 1.2, 1.0, 'wood'); }
      k.box(p, C.shelter, 0, 1.3, -1.0, 3.8, 1.8, 0.08);
      k.solid(p, 0, 1.3, -1.0, 1.9, 1.3, 0.08, 'wood');
      k.box(p, C.roof, 0, 2.48, 0, 4.4, 0.08, 2.7, [0.08, 0, 0]);
      k.box(p, C.wood, 0, 0.45, -0.6, 3.0, 0.07, 0.42);
      for (const sx of [-1.2, 1.2]) k.box(p, C.woodDark, sx, 0.22, -0.6, 0.08, 0.44, 0.38);
      k.solid(p, 0, 0.24, -0.6, 1.5, 0.24, 0.22, 'wood');
      yield;
      // The stop's sign: a round plate on a post at the kerb, and the timetable under it.
      const sp = k.at(g, -3.2, 0, 34.6, Math.PI / 2);
      k.cyl(sp, C.pole, 0, 1.2, 0, 0.04, 0.05, 2.4, 6);
      k.cyl(sp, 0x3a3a40, 0, 0.06, 0, 0.32, 0.36, 0.12, 10);
      const plate = k.cyl(sp, C.sign, 0, 2.35, 0, 0.36, 0.36, 0.05, 20, [Math.PI / 2, 0, 0]);
      plate.castShadow = true;
      const face = paintedSign('峠口', { width: 0.5, wood: 0xf4f0e6, paint: '#2f5aa8' });
      face.children[0]!.visible = false;
      face.position.set(0, 2.35, 0.03);
      face.scale.set(1, 1.6, 1);
      sp.add(face);
      k.box(sp, 0xf4f0e6, 0, 1.5, 0.03, 0.42, 0.56, 0.03, undefined, false);
      for (let r = 0; r < 4; r++) k.box(sp, 0x5a5a60, 0, 1.68 - r * 0.11, 0.05, 0.3, 0.02, 0.01, undefined, false);
      k.solid(sp, 0, 1.2, 0, 0.06, 1.2, 0.06);
      yield;
      // A vending machine by the shelter, lit.
      const vm = k.at(g, -5.2, 0, 36.6, Math.PI / 2);
      k.box(vm, C.vend, 0, 0.95, 0, 1.0, 1.9, 0.7);
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.9, 0.02), emissive(0xdff2ff, 1.6));
      panel.position.set(0, 1.35, 0.36);
      panel.userData.keep = true;
      vm.add(panel);
      for (let r = 0; r < 2; r++) for (let c = 0; c < 6; c++) k.box(vm, [0xd04a3a, 0x3a7ad0, 0xe8b23a, 0x4aa05a][(r * 6 + c) % 4]!, -0.35 + c * 0.14, 1.12 + r * 0.42, 0.38, 0.08, 0.2, 0.04, undefined, false);
      k.box(vm, C.vendDark, 0, 0.45, 0.36, 0.8, 0.22, 0.02, undefined, false);
      k.solid(vm, 0, 0.95, 0, 0.5, 0.95, 0.35);
      ctx.lights.add({ kind: 'point', position: new THREE.Vector3(-4.6, 1.4, 36.6), color: new THREE.Color(0xdff2ff), intensity: 4, distance: 6, decay: 2 });
    }
    yield;
    ctx.phase('farm');
    // ---------------------------------------------------------- the farmhouse
    {
      const p = k.at(g, -24, 0, 54, Math.PI / 2);
      k.box(p, 0x8a8580, 0, 0.2, 0, 9.4, 0.4, 7.4);
      k.box(p, C.plaster, 0, 1.8, 0, 9, 2.8, 7);
      for (let i = -3; i <= 3; i++) k.box(p, C.woodDark, i * 1.4, 1.8, 3.52, 0.14, 2.8, 0.06, undefined, false);
      k.box(p, C.woodDark, 0, 3.15, 0, 9.2, 0.14, 7.2);
      const roof = k.cone(p, C.tile, 0, 4.6, 0, 6.6, 2.8, 4, [0, Math.PI / 4, 0]);
      roof.scale.set(1.12, 1, 0.86);
      k.box(p, C.tileEdge, 0, 5.85, 0, 3.4, 0.3, 0.4);
      k.box(p, C.woodDark, 0, 1.0, 3.6, 1.6, 2.0, 0.08);
      k.solid(p, 0, 1.8, 0, 4.6, 1.8, 3.6, 'wood');
      yield;
      // The persimmon tree in the yard, its leaves turned and its fruit still on.
      const t = k.at(g, -14, 0, 46, 0.6);
      k.cyl(t, C.woodDark, 0, 1.1, 0, 0.16, 0.24, 2.2, 7, [0, 0, 0.08]);
      for (const [x, y, z, r] of [[0.3, 2.9, 0, 1.4], [-0.9, 2.5, 0.6, 1.0], [0.9, 2.4, -0.7, 1.0], [0, 3.6, 0.2, 0.9]] as const) k.rock(t, C.leaf, x, y, z, r, 1);
      for (let i = 0; i < 16; i++) { const a = rand() * Math.PI * 2, r = 0.9 + rand() * 0.7; k.add(t, new THREE.SphereGeometry(0.11, 7, 5), C.persimmon, Math.cos(a) * r, 2.1 + rand() * 1.7, Math.sin(a) * r, undefined, false); }
      k.solid(t, 0, 1.1, 0, 0.24, 1.1, 0.24, 'wood');
      // Beaten earth under it, fallen fruit, and the kitchen garden beside: ridges of daikon tops.
      const yard = new THREE.Mesh(new THREE.CircleGeometry(3.6, 18), flat(0xc4ae84));
      yard.rotation.x = -Math.PI / 2;
      yard.position.set(-13.2, 0.01, 45.6);
      yard.scale.set(1, 1.25, 1);
      yard.receiveShadow = true;
      yard.userData.keep = true;
      g.add(yard);
      for (let i = 0; i < 6; i++) k.add(g, new THREE.SphereGeometry(0.09, 6, 4), C.persimmon, -14 + (rand() - 0.5) * 3, 0.06, 46 + (rand() - 0.5) * 3, undefined, false);
      for (let r = 0; r < 5; r++) {
        const z = 37.6 + r * 0.9;
        k.box(g, 0x7d6448, -11.5, 0.06, z, 6.2, 0.12, 0.5, undefined, false);
        for (let x = -14.3; x < -8.8; x += 0.42) growth.tuft(x + (rand() - 0.5) * 0.1, z, 0.34 + rand() * 0.12, TONES.green);
      }
      yield;
      // Drying racks of rice sheaves in the field across the road.
      for (const z of [20, 56]) {
        const r = k.at(g, 9.5, 0, z, 0);
        for (const sx of [-3, 0, 3]) k.cyl(r, C.woodDark, sx, 0.9, 0, 0.05, 0.06, 1.8, 6);
        k.cyl(r, C.wood, 0, 1.55, 0, 0.04, 0.04, 6.4, 6, [0, 0, Math.PI / 2]);
        for (let s = 0; s < 14; s++) { const x = -2.9 + s * 0.45; k.add(r, faceted(new THREE.ConeGeometry(0.24, 1.1, 5)), C.straw, x, 1.12, 0, [0, s, Math.PI], true); }
        k.solid(r, 0, 0.9, 0, 3.2, 0.9, 0.2, 'wood');
      }
    }
    yield;
    growth.mesh(g, 'outskirts:growth');
    ctx.phase('hedges');
    // ---------------------------------------------------------- the hedges
    // Hedges close the walk in, from the foot of the pass round the bend to
    // the ward's edge, where its own walls take over.
    const hedge = (x0: number, z0: number, x1: number, z1: number): void => {
      const len = Math.hypot(x1 - x0, z1 - z0), yaw = Math.atan2(x1 - x0, z1 - z0);
      const p = k.at(g, (x0 + x1) / 2, 0, (z0 + z1) / 2, yaw);
      k.box(p, C.hedge, 0, 0.65, 0, 1.2, 1.3, len);
      for (let s = 0; s < len; s += 2.2) k.rock(p, s % 4.4 ? C.hedgeDark : C.hedge, (rand() - 0.5) * 0.3, 1.25, -len / 2 + s + 1.1, 0.62, 0, [1, 0.6, 1.4]);
      k.wall(x0, z0, x1, z1, -1, 30, 0.6);
    };
    for (const s of [-1, 1]) { hedge(s * 3.4, -3, s * 3.4, 4); hedge(s * 3.4, 4, s * HEDGE, 4); }
    yield;
    hedge(-HEDGE, 4, -HEDGE, BEND_Z + 5);
    hedge(-HEDGE, BEND_Z + 5, EAST_END, BEND_Z + 5);
    hedge(HEDGE, 4, HEDGE, BEND_Z - 5);
    hedge(HEDGE, BEND_Z - 5, EAST_END, BEND_Z - 5);
    yield;
    ctx.phase('far');
    // ---------------------------------------------------------- the far plain
    // Farm groves out on the plain, each round a farmhouse among the
    // paddies (cedars on the windward side, a maple or a gold tree by the
    // house), and hills round the plain's edge.
    const far = k.stretch('outskirts:far', g);
    for (const [gx, gz, gr] of GROVES) {
      const yaw = rand() * 0.6 - 0.3;
      const p = k.at(far, gx + gr * 0.15, 0, gz, yaw);
      k.box(p, C.plaster, 0, 1.4, 0, 6.4, 2.8, 4.6);
      const roof = k.cone(p, rand() < 0.5 ? C.tile : 0x6d5a4a, 0, 3.9, 0, 4.8, 2.4, 4, [0, Math.PI / 4, 0]);
      roof.scale.set(1.15, 1, 0.84);
      for (let i = 0; i < 9; i++) {
        const a = Math.PI * (0.6 + rand() * 1.1) + yaw, d = gr * (0.55 + rand() * 0.4);
        const kind = i < 5 ? 'cedar' : rand() < 0.5 ? 'maple' : 'gold';
        tree(k, far, gx + Math.cos(a) * d, 0, gz + Math.sin(a) * d, kind, 1 + rand() * 0.5, Math.floor(rand() * 100), true);
      }
      yield;
    }
    for (let i = 0; i < 14; i++) {
      const a = Math.PI * (0.05 + (i / 13) * 0.9), r = 250 + Math.sin(i * 2.3) * 40;
      const h = 30 + Math.abs(Math.sin(i * 1.7)) * 26;
      const hill = k.cone(far, i % 3 ? 0x6f93a4 : 0x8fb0bf, Math.cos(a) * r * 1.2, h / 2 - 2, 120 + Math.sin(a) * r, 60 + (i % 3) * 15, h, 7, [0, i, 0], false);
      hill.receiveShadow = false;
    }
    // Shoulders of the mountains either side of where the pass comes down.
    for (const sx of [-1, 1]) k.cone(far, 0x6a8f52, sx * 150, 26, -70, 90, 62, 7, [0, sx, 0], false);
    yield;
    ctx.phase('bake');
    k.bake(far);
    yield;
    k.bake(g);
    yield;
    return {
      zones: [
        zone('busstop', 'Bus stop', '停留所', -9, 2, 26, 40),
        zone('outskirts', 'The outskirts', '郊外', -60, EAST_END, -2, 96, true),
      ],
      groundAt: (x, z) => (x >= -80 && x <= EAST_END && z >= -10 && z <= 100 ? 0 : null),
      surfaceAt(p, tag): Surface | null {
        if (tag === 'wood') return 'wood';
        const along = p.z < BEND_Z - 6 ? Math.abs(p.x) : Math.abs(p.z - BEND_Z);
        if (along < ROAD_HALF + 0.2 || (p.x > 0 && p.z > BEND_Z - 6 && Math.hypot(p.x - 9, p.z - 69) < 9 + ROAD_HALF && Math.hypot(p.x - 9, p.z - 69) > 9 - ROAD_HALF)) return 'stone';
        return Math.abs(p.x) < HEDGE ? 'gravel' : 'grass';
      },
      update(time) { paddyWater.uniforms.time!.value = time; },
    };
  },
};

// ------------------------------------------------------------ the paddies
// Harvested rice paddies, as the plain lies in autumn from the road and from
// above: a mosaic of plots between low grassed bunds. Most are stubble in
// rows, some still hold water with the stubble standing in it, some have
// come up green again with the second growth, a few are ploughed; straw
// stooks dry in rows on some, a scarecrow stands in one, and red spider
// lilies grow in drifts along the bunds. The land is one vertex-coloured
// mesh and the water another, so the whole plain is a few draw calls.

const PADDY = {
  stubble: [0xc9b77a, 0xd3c184, 0xbfae72], row: 0xa8955e, regrowth: 0xa9b862, regrowthRow: 0x8a9f50,
  ploughed: 0x9a7a52, furrow: 0x7a5f40, mud: 0x8b7a5a, bund: 0x8aab57, bundSide: 0x76924a,
} as const;

// The fields: inside the hedges either side of the road, and out over the plain round the ward.
const FIELDS: readonly (readonly [number, number, number, number, boolean])[] = [
  [-HEDGE + 0.8, -3.7, 5, BEND_Z + 4.2, true],
  [3.9, HEDGE - 0.8, 6, BEND_Z - 5.8, true],
  [-118, -HEDGE - 1.2, 1, 214, false],
  [-HEDGE + 0.8, WARD.x0 - 1, BEND_Z + 6.2, 214, false],
  [HEDGE + 1.2, WARD.x0 - 1, 1, BEND_Z - 6.2, false],
  [WARD.x0, WARD.x1, WARD.z1 + 2, 214, false],
];
// Ground the plots leave: the bus stop, the farmhouse and its yard with the
// persimmon, and the farm groves out on the plain, each round a house.
const YARDS: readonly (readonly [number, number, number])[] = [[-5, 33, 4.5], [-24, 54, 6.5], [-12, 43, 6]];
const GROVES: readonly (readonly [number, number, number])[] = [[-44, 118, 9], [-78, 30, 10], [-96, 150, 9], [-58, 192, 10], [-6, 168, 8], [62, 152, 9], [124, 186, 10], [-36, 96, 7]];
const clearOf = (x0: number, z0: number, x1: number, z1: number): boolean =>
  [...YARDS, ...GROVES].every(([x, z, r]) => Math.hypot(x - Math.min(x1, Math.max(x0, x)), z - Math.min(z1, Math.max(z0, z))) > r);

function* paddies(k: Kit, g: THREE.Object3D, growth: Strokes, water: THREE.Material, rand: () => number): Generator<void, void, void> {
  const pos: number[] = [], clr: number[] = [], wet: number[] = [];
  const col = new THREE.Color();
  const paint = (c: number, n: number): void => { col.setHex(c); for (let i = 0; i < n; i++) clr.push(col.r, col.g, col.b); };
  // A level rectangle facing up.
  const quad = (x0: number, z0: number, x1: number, z1: number, y: number, c: number): void => {
    pos.push(x0, y, z0, x0, y, z1, x1, y, z1, x0, y, z0, x1, y, z1, x1, y, z0);
    paint(c, 6);
  };
  // A bund: a grassed top `h` high with its sides sloping out to the plots.
  const bund = (x0: number, z0: number, x1: number, z1: number, h = 0.13, s = 0.14): void => {
    if (YARDS.some(([x, z, r]) => Math.hypot(x - Math.min(x1, Math.max(x0, x)), z - Math.min(z1, Math.max(z0, z))) < r)) return;
    quad(x0, z0, x1, z1, h, PADDY.bund);
    const side = (...v: number[]): void => { pos.push(v[0]!, v[1]!, v[2]!, v[3]!, v[4]!, v[5]!, v[6]!, v[7]!, v[8]!, v[0]!, v[1]!, v[2]!, v[6]!, v[7]!, v[8]!, v[9]!, v[10]!, v[11]!); paint(PADDY.bundSide, 6); };
    side(x0, h, z1, x0, 0, z1 + s, x1, 0, z1 + s, x1, h, z1);
    side(x1, h, z0, x1, 0, z0 - s, x0, 0, z0 - s, x0, h, z0);
    side(x1, h, z1, x1 + s, 0, z1, x1 + s, 0, z0, x1, h, z0);
    side(x0, h, z0, x0 - s, 0, z0, x0 - s, 0, z1, x0, h, z1);
  };
  // Rows across a plot, `gap` apart, `w` wide, along its long side.
  const rows = (x0: number, z0: number, x1: number, z1: number, y: number, gap: number, w: number, c: number): void => {
    if (x1 - x0 < z1 - z0) for (let x = x0 + gap / 2; x < x1 - w; x += gap) quad(x, z0, x + w, z1, y, c);
    else for (let z = z0 + gap / 2; z < z1 - w; z += gap) quad(x0, z, x1, z + w, y, c);
  };
  // Lilies in drifts along a bund's line.
  const lilies = (x0: number, z0: number, x1: number, z1: number): void => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    for (let t = 0.4; t < len; t += 0.55) {
      const x = x0 + ((x1 - x0) * t) / len, z = z0 + ((z1 - z0) * t) / len;
      if (Math.sin(x * 0.37 + z * 0.23) + Math.sin(z * 0.19 - x * 0.29 + 1.7) < 0.9 || rand() < 0.35) continue;
      growth.lily(x + (rand() - 0.5) * 0.3, z + (rand() - 0.5) * 0.3, 0.42 + rand() * 0.12);
    }
  };
  let scarecrow = false;
  for (const [fx0, fx1, fz0, fz1, near] of FIELDS) {
    const cols = Math.max(1, Math.round((fx1 - fx0) / (near ? 12 : 16)));
    const cw = (fx1 - fx0) / cols;
    for (let c = 0; c < cols; c++) {
      const x0 = fx0 + c * cw, x1 = x0 + cw;
      let z0 = fz0;
      while (z0 < fz1 - 3) {
        const z1 = Math.min(fz1, z0 + (near ? 7 : 9) + rand() * 6);
        const px0 = x0 + 0.25, px1 = x1 - 0.25, pz0 = z0 + 0.25, pz1 = z1 - 0.25;
        const roll = rand();
        if (!clearOf(x0, z0, x1, z1)) {
          // Left to grass.
        } else if (roll < 0.16) {
          // Still holding water, the stubble standing in it.
          quad(px0, pz0, px1, pz1, 0.006, PADDY.mud);
          wet.push(px0, 0.03, pz0, px0, 0.03, pz1, px1, 0.03, pz1, px0, 0.03, pz0, px1, 0.03, pz1, px1, 0.03, pz0);
          rows(px0 + 0.2, pz0 + 0.2, px1 - 0.2, pz1 - 0.2, 0.045, 0.6, 0.08, PADDY.row);
        } else if (roll < 0.32) {
          quad(px0, pz0, px1, pz1, 0.006, PADDY.regrowth);
          rows(px0 + 0.2, pz0 + 0.2, px1 - 0.2, pz1 - 0.2, 0.02, 0.6, 0.12, PADDY.regrowthRow);
        } else if (roll < 0.44) {
          quad(px0, pz0, px1, pz1, 0.006, PADDY.ploughed);
          rows(px0 + 0.1, pz0 + 0.1, px1 - 0.1, pz1 - 0.1, 0.02, 0.45, 0.16, PADDY.furrow);
        } else {
          quad(px0, pz0, px1, pz1, 0.006, PADDY.stubble[Math.floor(rand() * 3)]!);
          rows(px0 + 0.2, pz0 + 0.2, px1 - 0.2, pz1 - 0.2, 0.02, 0.55, 0.09, PADDY.row);
          // Straw stooks drying in a row or two.
          if (rand() < (near ? 0.4 : 0.25)) {
            const along = px1 - px0 > pz1 - pz0, n = Math.floor(3 + rand() * 6), line = rand() * 0.6 + 0.2;
            for (let i = 0; i < n; i++) {
              const t = (i + 0.5) / n, x = along ? px0 + (px1 - px0) * t : px0 + (px1 - px0) * line, z = along ? pz0 + (pz1 - pz0) * line : pz0 + (pz1 - pz0) * t;
              k.cone(g, rand() < 0.5 ? 0xd8bf86 : 0xc9ad72, x, 0.36, z, 0.26, 0.72, 6, [0, rand() * 3, 0], near);
            }
          }
          if (near && !scarecrow && px1 - px0 > 6) { scarecrow = true; scarecrowAt(k, g, (px0 + px1) / 2, (pz0 + pz1) / 2); }
        }
        // The bund along this plot's far end, and lilies along it near the road.
        bund(x0 - 0.25, z1 - 0.25, x1 + 0.25, z1 + 0.25);
        if (near) lilies(x0, z1, x1, z1);
        z0 = z1;
      }
      bund(x0 - 0.25, fz0 - 0.25, x1 + 0.25, fz0 + 0.25);
      // The bunds down the field's sides and between its columns.
      bund(x0 - 0.25, fz0, x0 + 0.25, fz1);
      if (near) lilies(x0, fz0, x0, fz1);
      if (c === cols - 1) { bund(x1 - 0.25, fz0, x1 + 0.25, fz1); if (near) lilies(x1, fz0, x1, fz1); }
      yield;
    }
  }
  k.tris(g, pos, 0xffffff, false, false, clr);
  yield;
  k.tris(g, wet, water, false, true);
  yield;
}

// A scarecrow: a crossed frame, an old coat, a straw hat, a face drawn on cloth.
function scarecrowAt(k: Kit, g: THREE.Object3D, x: number, z: number): void {
  const p = k.at(g, x, 0, z, 0.5);
  k.cyl(p, 0x6b4a32, 0, 0.8, 0, 0.04, 0.05, 1.6, 6);
  k.cyl(p, 0x6b4a32, 0, 1.25, 0, 0.03, 0.03, 1.3, 6, [0, 0, Math.PI / 2]);
  k.box(p, 0x3f5d8a, 0, 1.05, 0, 0.55, 0.6, 0.18);
  k.box(p, 0x3f5d8a, 0, 1.25, 0, 1.2, 0.16, 0.16);
  k.rock(p, 0xf1e7cf, 0, 1.55, 0, 0.17, 1);
  k.cone(p, 0xd8bf86, 0, 1.78, 0, 0.36, 0.22, 10);
  k.solid(p, 0, 0.8, 0, 0.1, 0.8, 0.1, 'wood');
}

// The verges along the road: a gravel shoulder each side, a concrete ditch
// with water in it down the east side, and tufts, wild flowers and lilies
// in the grass between the road and the fields.
function* verges(k: Kit, g: THREE.Object3D, growth: Strokes, rand: () => number): Generator<void, void, void> {
  const shoulder = toon(0xb3aa94);
  shoulder.polygonOffset = true; shoulder.polygonOffsetFactor = -1; shoulder.polygonOffsetUnits = -2;
  for (const s of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 66), shoulder);
    m.rotation.x = -Math.PI / 2;
    m.position.set(s * (ROAD_HALF + 0.17), 0.012, 33);
    m.receiveShadow = true;
    m.userData.keep = true;
    g.add(m);
  }
  // The ditch: two kerbs of cast concrete, a dark channel, lids over it where a track crosses.
  const dx = ROAD_HALF + 0.62;
  k.box(g, 0x5d5a52, dx, -0.01, 34, 0.42, 0.04, 60, undefined, false);
  for (const s of [-1, 1]) k.box(g, 0xbab4a6, dx + s * 0.26, 0.05, 34, 0.1, 0.14, 60, undefined, false);
  for (const z of [12, 40, 41.2, 58]) k.box(g, 0xa8a294, dx, 0.11, z, 0.6, 0.06, 1.1);
  yield;
  // The grass between: drifts of lilies, tufts, a few flowers, thick at the hedge foot.
  const BLOOMS = [TONES.white, TONES.yellow];
  const sow = (x: number, z: number): void => {
    const roll = rand(), drift = Math.sin(x * 0.4 + z * 0.21) + Math.sin(z * 0.13 + 1.1);
    if (drift > 0.9 && roll < 0.6) { for (let n = 0; n < 3 + Math.floor(rand() * 3); n++) growth.lily(x + (rand() - 0.5) * 0.5, z + (rand() - 0.5) * 0.5, 0.36 + rand() * 0.12); return; }
    if (roll < 0.55) { for (let n = 0; n < 2; n++) growth.tuft(x + (rand() - 0.5) * 0.5, z + (rand() - 0.5) * 0.5, 0.25 + rand() * 0.2); return; }
    if (roll < 0.66) for (let n = 0; n < 3; n++) growth.flower(x + (rand() - 0.5) * 0.6, z + (rand() - 0.5) * 0.6, BLOOMS[Math.floor(rand() * 2)]!, 0.14 + rand() * 0.08, 0.055);
  };
  for (let z = 4.5; z < 64; z += 0.8) {
    sow(ROAD_HALF + 1.05 + rand() * 0.2, z + rand() * 0.6);
    // Not across the bus stop's standing.
    if (z > 29 && z < 38) continue;
    sow(-(ROAD_HALF + 0.65 + rand() * 0.35), z + rand() * 0.6);
  }
  // Round the bend and along the eastward stretch, on both sides.
  for (let x = 6; x < EAST_END - 1; x += 0.9) for (const side of [-1, 1]) sow(x + rand() * 0.5, BEND_Z + side * (ROAD_HALF + 0.6 + rand() * 1.4));
  // At the hedges' feet.
  for (let z = 6; z < BEND_Z + 4; z += 1.1) for (const s of [-1, 1]) if (s < 0 || z < BEND_Z - 6) { if (rand() < 0.6) growth.tuft(s * (HEDGE - 0.9 - rand() * 0.3), z, 0.3 + rand() * 0.25); }
  yield;
}
