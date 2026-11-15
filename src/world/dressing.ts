import * as THREE from 'three';
import type { Physics } from '../physics/world';
import type { LightPool } from '../render/lightPool';
import { toon, faceted, paintedSign } from '../render/materials';
import { tatami, boxUV } from './textures';
import { HALL, STORE, GATE, POND } from './compound';

// The compound's furnishings: what a working dojo has lying about, each
// placed by hand where someone would have put it. Built from boxes and
// cylinders in the compound's palette; the whole lot is baked into a few
// meshes afterwards (src/world/batch.ts), so a prop costs triangles, not
// draw calls.

export interface DressKit {
  g: THREE.Group;
  physics: Physics;
  lights: LightPool;
  onRoof(mesh: THREE.Mesh, roof: string, ghost?: boolean): void;
  mats: Record<'wood' | 'woodDark' | 'woodLight' | 'stone' | 'stoneDark' | 'plaster' | 'iron' | 'tile' | 'tileEdge' | 'lantern', THREE.Material>;
}

type Rot = [number, number, number];

export function dressCompound(k: DressKit): void {
  const { g, physics, mats: M } = k;
  const straw = toon(0xd8bf86), strawDark = toon(0xb89a5e), rope = toon(0x8a6a44);
  const paper = toon(0xf4ead6);
  const paperGlow = toon(0xfbf0dc, { emissive: 0xffc880, emissiveIntensity: 0.55 });
  const indigo = toon(0x2f4a7a), white = toon(0xf1ece0), red = toon(0xbf3f35), ochre = toon(0xd9a040);
  const lacquer = toon(0x7a2e24), hide = toon(0xeadcbf);
  const pine = toon(0x3d6b45), pineLight = toon(0x55864f);
  const bamboo = toon(0x86a85a), leaf = toon(0x5d8b47), leafLight = toon(0x7fa552);
  const glaze = toon(0x3c5566), soil = toon(0x3a2a22);
  const pathStone = toon(0xb9b2a5), rock = toon(0x8d9392);
  const ink = toon(0x1d1a1e), waterDark = toon(0x29465a);
  const reed = toon(0x6f9a4e), lotus = toon(0xf2b8c6);
  const sackCloth = toon(0xcdb791);

  // ------------------------------------------------------------ primitives
  // A prop: a group placed and turned; its parts are given in its own frame.
  const at = (x: number, y: number, z: number, rotY = 0): THREE.Group => {
    const p = new THREE.Group();
    p.position.set(x, y, z);
    p.rotation.y = rotY;
    g.add(p);
    return p;
  };
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
  // A collider in the prop's frame (centre and half size).
  const solid = (p: THREE.Group, x: number, y: number, z: number, hx: number, hy: number, hz: number): void => {
    p.updateMatrixWorld(true);
    const c = p.localToWorld(new THREE.Vector3(x, y, z));
    physics.staticBox(c, new THREE.Vector3(hx, hy, hz), p.quaternion.clone());
  };
  const AX: Rot = [0, 0, Math.PI / 2]; // a cylinder lying along x
  const AZ: Rot = [Math.PI / 2, 0, 0]; // a cylinder lying along z

  // ------------------------------------------------------------ props
  // A rack of wooden swords (or staffs), its back to a wall; front is +z.
  const weaponRack = (x: number, y: number, z: number, rotY: number, staffs = false): void => {
    const p = at(x, y, z, rotY);
    const h = staffs ? 1.9 : 1.3;
    box(p, M.woodDark, 0, 0.04, 0, 1.6, 0.08, 0.4);
    for (const sx of [-0.75, 0.75]) box(p, M.woodDark, sx, h / 2, -0.1, 0.09, h, 0.09);
    box(p, M.woodDark, 0, h - 0.05, -0.1, 1.62, 0.08, 0.1);
    box(p, M.woodDark, 0, 0.55, 0.06, 1.5, 0.06, 0.06);
    const n = staffs ? 5 : 6;
    for (let i = 0; i < n; i++) {
      const sx = -0.6 + (1.2 * i) / (n - 1);
      if (staffs) cyl(p, M.woodLight, sx, 0.98, -0.02, 0.025, 0.025, 1.85, 5, [-0.06, 0, 0]);
      else {
        box(p, M.woodLight, sx, 0.62, 0.0, 0.045, 1.02, 0.06, [-0.1, 0, 0]);
        box(p, ink, sx, 0.98, -0.02, 0.1, 0.02, 0.1, [-0.1, 0, 0]);
      }
    }
    solid(p, 0, h / 2, -0.05, 0.8, h / 2, 0.22);
  };
  // A floor cushion.
  const zabuton = (x: number, y: number, z: number, rotY: number, mat: THREE.Material): void => {
    const p = at(x, y, z, rotY);
    box(p, mat, 0, 0.05, 0, 0.62, 0.1, 0.62);
    box(p, mat, 0, 0.1, 0, 0.54, 0.04, 0.54, undefined, false);
  };
  // A hanging scroll on a wall: brushed characters on paper between two rods.
  const scroll = (x: number, y: number, z: number, rotY: number, text: string): void => {
    const s = paintedSign(text, { width: 0.5, vertical: true, wood: 0xf2e8d2 });
    s.position.set(x, y, z);
    s.rotation.y = rotY;
    g.add(s);
    const p = at(x, y, z, rotY);
    for (const ry of [1.08, -1.08]) cyl(p, M.woodDark, 0, ry, 0.05, 0.03, 0.03, 0.72, 6, AX, false);
    cyl(p, rope, 0, 1.3, 0.04, 0.008, 0.008, 0.5, 4, [0, 0, 0.9], false);
  };
  // The god shelf high on the back wall: a little shrine, a rope and paper.
  const kamidana = (x: number, y: number, z: number): void => {
    const p = at(x, y, z);
    box(p, M.woodLight, 0, 0, 0.22, 1.8, 0.06, 0.45);
    for (const sx of [-0.7, 0.7]) box(p, M.woodLight, sx, -0.18, 0.08, 0.06, 0.3, 0.16);
    box(p, M.woodLight, 0, 0.27, 0.2, 0.62, 0.48, 0.3);
    box(p, M.woodDark, 0, 0.23, 0.36, 0.22, 0.3, 0.02, undefined, false);
    box(p, M.woodDark, -0.2, 0.6, 0.2, 0.46, 0.05, 0.5, [0, 0, 0.55]);
    box(p, M.woodDark, 0.2, 0.6, 0.2, 0.46, 0.05, 0.5, [0, 0, -0.55]);
    for (const sx of [-0.62, 0.62]) { cyl(p, M.woodLight, sx, 0.12, 0.25, 0.07, 0.06, 0.2, 6); cyl(p, pine, sx, 0.34, 0.25, 0.05, 0.12, 0.3, 6); }
    cyl(p, strawDark, 0, -0.08, 0.47, 0.035, 0.035, 1.7, 6, AX, false);
    for (const sx of [-0.5, 0, 0.5]) box(p, white, sx, -0.24, 0.48, 0.08, 0.26, 0.01, undefined, false);
  };
  // A taiko drum on a cradle, its heads facing along x.
  const taiko = (x: number, y: number, z: number, rotY: number): void => {
    const p = at(x, y, z, rotY);
    cyl(p, lacquer, 0, 0.92, 0, 0.42, 0.42, 0.62, 14, AX);
    for (const sx of [-0.32, 0.32]) cyl(p, hide, sx, 0.92, 0, 0.44, 0.44, 0.03, 14, AX);
    for (const sx of [-0.31, 0.31]) cyl(p, ink, sx, 0.92, 0, 0.455, 0.455, 0.015, 14, AX, false);
    for (const sz of [-0.32, 0.32]) {
      box(p, M.woodDark, 0, 0.3, sz, 0.08, 0.6, 0.08, [0, 0, 0.5]);
      box(p, M.woodDark, 0, 0.3, sz, 0.08, 0.6, 0.08, [0, 0, -0.5]);
    }
    box(p, M.woodDark, 0, 0.04, 0, 0.9, 0.08, 0.8);
    for (const sz of [-0.12, 0.12]) cyl(p, M.woodLight, 0.55, 0.62, sz, 0.02, 0.02, 0.4, 5, [0, 0, 0.35]);
    solid(p, 0, 0.7, 0, 0.45, 0.7, 0.45);
  };
  // A low writing desk with scrolls, an ink stone and a brush, and the
  // cushion behind it. Front is +z.
  const lowDesk = (x: number, y: number, z: number): void => {
    const p = at(x, y, z);
    box(p, M.woodDark, 0, 0.4, 0, 1.7, 0.07, 0.85);
    for (const [sx, sz] of [[-0.78, -0.36], [0.78, -0.36], [-0.78, 0.36], [0.78, 0.36]] as const) box(p, M.woodDark, sx, 0.19, sz, 0.08, 0.38, 0.08);
    box(p, paper, -0.25, 0.44, 0.05, 0.6, 0.01, 0.42, undefined, false);
    box(p, ink, 0.35, 0.45, 0.08, 0.16, 0.04, 0.26);
    cyl(p, M.woodLight, 0.55, 0.45, -0.05, 0.012, 0.012, 0.3, 4, AZ, false);
    for (let i = 0; i < 3; i++) cyl(p, paper, 0.55 - i * 0.02, 0.46 + i * 0.05, -0.28, 0.035, 0.035, 0.46 - i * 0.06, 6, AX, false);
    zabuton(x, y, z - 0.95, 0, indigo);
    // A stack of scroll boxes beside the desk.
    for (let i = 0; i < 3; i++) box(p, i === 1 ? M.woodLight : M.wood, 1.25, 0.09 + i * 0.16, -0.1 + (i % 2) * 0.05, 0.5, 0.15, 0.32, [0, i * 0.15, 0]);
  };
  // A paper floor lamp.
  const andon = (x: number, y: number, z: number): void => {
    const p = at(x, y, z, 0.2);
    box(p, paperGlow, 0, 0.6, 0, 0.34, 0.6, 0.34, undefined, false);
    for (const [sx, sz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]] as const) box(p, M.woodDark, sx, 0.45, sz, 0.04, 0.9, 0.04);
    box(p, M.woodDark, 0, 0.92, 0, 0.42, 0.04, 0.42);
    box(p, M.woodDark, 0, 0.3, 0, 0.4, 0.03, 0.4);
    solid(p, 0, 0.45, 0, 0.2, 0.45, 0.2);
  };
  // A scroll shelf against a wall: cubbies of rolled scrolls and bound books. Front is +z.
  const scrollShelf = (x: number, y: number, z: number, rotY: number): void => {
    const p = at(x, y, z, rotY);
    const w = 1.6, h = 1.9, d = 0.42;
    box(p, M.wood, 0, h / 2, -d / 2 + 0.02, w, h, 0.04);
    for (const sx of [-w / 2, w / 2]) box(p, M.wood, sx, h / 2, 0, 0.05, h, d);
    for (let i = 0; i < 5; i++) box(p, M.wood, 0, 0.04 + i * 0.46, 0, w, 0.05, d);
    box(p, M.wood, 0, h / 2, 0, 0.04, h, d);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) {
      const cx = (c - 0.5) * w / 2, cy = 0.08 + r * 0.46;
      if ((r + c) % 2 === 0) {
        for (let i = 0; i < 5; i++) cyl(p, i % 3 === 0 ? ochre : paper, cx - 0.24 + i * 0.12, cy + 0.06 + (i % 2) * 0.1, 0.02, 0.05, 0.05, d - 0.06, 6, AZ, false);
      } else {
        for (let i = 0; i < 4; i++) box(p, [indigo, M.woodDark, red, indigo][i]!, cx - 0.2 + i * 0.12, cy + 0.15, 0, 0.1, 0.3 - (i % 2) * 0.05, d - 0.1, undefined, false);
      }
    }
    solid(p, 0, h / 2, 0, w / 2, h / 2, d / 2);
  };
  // A potted pine, clipped into flat pads.
  const pottedPine = (x: number, y: number, z: number, s = 1, seed = 0): void => {
    const p = at(x, y, z, seed);
    cyl(p, glaze, 0, 0.24 * s, 0, 0.42 * s, 0.32 * s, 0.48 * s, 8);
    cyl(p, soil, 0, 0.47 * s, 0, 0.38 * s, 0.38 * s, 0.03 * s, 8, undefined, false);
    cyl(p, M.woodDark, 0.05 * s, 0.75 * s, 0, 0.05 * s, 0.09 * s, 0.6 * s, 6, [0, 0, -0.3]);
    cyl(p, M.woodDark, -0.05 * s, 1.15 * s, 0.03 * s, 0.04 * s, 0.05 * s, 0.5 * s, 6, [0.2, 0, 0.4]);
    const pads: [number, number, number, number, THREE.Material][] = [[0.32, 0.92, 0.05, 0.42, pine], [-0.28, 1.25, 0.1, 0.36, pine], [0.1, 1.5, -0.05, 0.32, pineLight]];
    for (const [px, py, pz, r, mat] of pads) { const m = add(p, faceted(new THREE.IcosahedronGeometry(r * s, 0)), mat, px * s, py * s, pz * s); m.scale.set(1.25, 0.42, 1.0); }
    solid(p, 0, 0.5 * s, 0, 0.4 * s, 0.5 * s, 0.4 * s);
  };
  // A well: stone curb, water far down, a little tiled roof on two posts,
  // the pulley and a bucket on the rim.
  const well = (x: number, z: number, rotY: number): void => {
    const p = at(x, 0, z, rotY);
    cyl(p, M.stone, 0, 0.4, 0, 0.92, 0.98, 0.8, 10);
    cyl(p, M.stoneDark, 0, 0.83, 0, 0.98, 0.98, 0.08, 10);
    cyl(p, waterDark, 0, 0.85, 0, 0.72, 0.72, 0.04, 10, undefined, false);
    for (const sx of [-1.05, 1.05]) box(p, M.woodDark, sx, 1.15, 0, 0.14, 2.3, 0.14);
    box(p, M.woodDark, 0, 1.95, 0, 2.3, 0.1, 0.1);
    cyl(p, M.woodLight, 0, 1.82, 0, 0.12, 0.12, 0.14, 8, AX);
    cyl(p, rope, 0, 1.36, 0, 0.012, 0.012, 0.9, 4, undefined, false);
    for (const side of [-1, 1]) {
      const r = add(p, boxUV(new THREE.BoxGeometry(2.6, 0.08, 1.0), 1.2), M.tile, 0, 2.3, side * 0.42, [side * 0.55, 0, 0]);
      r.castShadow = true;
    }
    box(p, M.tileEdge, 0, 2.55, 0, 2.7, 0.12, 0.14);
    const b = at(x + Math.cos(rotY) * 0.62, 0.87, z - Math.sin(rotY) * 0.62, rotY + 0.4);
    cyl(b, M.wood, 0, 0.16, 0, 0.17, 0.14, 0.3, 8);
    cyl(b, M.iron, 0, 0.22, 0, 0.175, 0.175, 0.03, 8, undefined, false);
    solid(p, 0, 0.6, 0, 1.0, 0.6, 1.0);
  };
  // Split logs stacked against a wall, ends out. Front is +z.
  const woodpile = (x: number, z: number, rotY: number, len: number): void => {
    const p = at(x, 0, z, rotY);
    const rows = [5, 4, 4, 3];
    rows.forEach((n, r) => {
      for (let i = 0; i < Math.round(n * len); i++) cyl(p, i % 3 === 1 ? M.woodLight : M.wood, -len / 2 + 0.14 + (i + (r % 2) * 0.5) * (len / (n * len)) * 0.98, 0.13 + r * 0.22, 0, 0.12, 0.12, 0.9, 6, AZ);
    });
    box(p, M.tile, 0, 1.05, -0.1, len + 0.3, 0.06, 1.2, [-0.25, 0, 0]);
    solid(p, 0, 0.5, 0, len / 2, 0.5, 0.45);
  };
  // A wooden tub of water.
  const tub = (x: number, z: number, r = 0.45): void => {
    const p = at(x, 0, z);
    cyl(p, M.wood, 0, 0.25, 0, r, r * 0.9, 0.5, 10);
    for (const y of [0.1, 0.4]) cyl(p, M.iron, 0, y, 0, r + 0.01, r + 0.01, 0.04, 10, undefined, false);
    cyl(p, waterDark, 0, 0.46, 0, r - 0.05, r - 0.05, 0.02, 10, undefined, false);
    solid(p, 0, 0.25, 0, r, 0.25, r);
  };
  // A washing line between two T posts with the hall's laundry on it.
  const laundry = (x0: number, x1: number, z: number): void => {
    const p = at(0, 0, z);
    for (const x of [x0, x1]) { box(p, M.woodDark, x, 1.15, 0, 0.12, 2.3, 0.12); box(p, M.woodDark, x, 2.22, 0, 0.1, 0.08, 0.7); solid(p, x, 1.15, 0, 0.08, 1.15, 0.08); }
    const sag = (t: number): number => 2.16 - Math.sin(Math.PI * t) * 0.18;
    const len = x1 - x0;
    const n = 12;
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n;
      const ax = x0 + len * t0, bx = x0 + len * t1, ay = sag(t0), by = sag(t1);
      cyl(p, rope, (ax + bx) / 2, (ay + by) / 2, 0.2, 0.01, 0.01, Math.hypot(bx - ax, by - ay), 3, [0, 0, Math.PI / 2 + Math.atan2(by - ay, bx - ax)], false);
    }
    // [where along, width, drop, cloth]
    const cloths: [number, number, number, THREE.Material][] = [[0.12, 0.9, 0.85, white], [0.28, 0.75, 1.05, indigo], [0.42, 0.38, 0.7, white], [0.56, 0.9, 0.85, white], [0.7, 0.3, 0.95, red], [0.84, 0.55, 0.75, indigo]];
    for (const [t, w, drop, mat] of cloths) {
      const top = sag(t);
      box(p, mat, x0 + len * t, top - drop / 2, 0.2, w, drop, 0.03, [0, (t * 7 % 1 - 0.5) * 0.25, 0]);
    }
  };
  // A striking post: a plank set in a stone foot, a straw pad at chest height.
  const makiwara = (x: number, z: number, rotY: number): void => {
    const p = at(x, 0, z, rotY);
    cyl(p, M.stoneDark, 0, 0.08, 0, 0.3, 0.34, 0.16, 7);
    box(p, M.woodLight, 0, 0.75, 0, 0.13, 1.5, 0.08);
    box(p, straw, 0, 1.2, 0.05, 0.17, 0.32, 0.06);
    for (const y of [1.08, 1.2, 1.32]) box(p, rope, 0, y, 0.05, 0.18, 0.02, 0.07, undefined, false);
    solid(p, 0, 0.75, 0, 0.1, 0.75, 0.1);
  };
  // Rice bales stacked on their sides. Bales run along x.
  const bales = (x: number, z: number, rotY: number, rows: number[]): void => {
    const p = at(x, 0, z, rotY);
    rows.forEach((n, r) => {
      for (let i = 0; i < n; i++) {
        const bx = (i - (n - 1) / 2) * 0.62, by = 0.3 + r * 0.52;
        cyl(p, i % 2 ? strawDark : straw, 0, by, bx, 0.3, 0.3, 0.85, 8, AX);
        for (const sx of [-0.28, 0, 0.28]) cyl(p, rope, sx, by, bx, 0.31, 0.31, 0.04, 8, AX, false);
        cyl(p, strawDark, 0.44, by, bx, 0.24, 0.3, 0.04, 8, AX, false);
      }
    });
    const w = Math.max(...rows) * 0.62;
    solid(p, 0, rows.length * 0.26, 0, 0.45, rows.length * 0.26, w / 2);
  };
  // A grain sack slumped on the ground.
  const sack = (p: THREE.Object3D, x: number, y: number, z: number, rotY: number): void => {
    const m = add(p, faceted(new THREE.IcosahedronGeometry(0.3, 1)), sackCloth, x, y + 0.2, z, [0, rotY, 0]);
    m.scale.set(1.0, 0.72, 0.78);
    box(p, rope, x, y + 0.4, z, 0.12, 0.05, 0.12, [0, rotY, 0], false);
  };
  // A two-wheeled handcart with sacks on it, its handles on the ground. Front is +x.
  const handcart = (x: number, z: number, rotY: number): void => {
    const p = at(x, 0, z, rotY);
    const tilt = 0.18;
    const bed = new THREE.Group();
    bed.position.set(0, 0.5, 0);
    bed.rotation.z = tilt;
    p.add(bed);
    box(bed, M.wood, 0, 0, 0, 1.5, 0.07, 0.95);
    for (const sz of [-0.46, 0.46]) box(bed, M.woodDark, 0, 0.14, sz, 1.5, 0.22, 0.05);
    for (const sz of [-0.32, 0.32]) box(bed, M.woodDark, -1.25, -0.02, sz, 1.1, 0.07, 0.07);
    sack(bed, 0.3, 0.02, -0.18, 0.4);
    sack(bed, 0.25, 0.02, 0.22, -0.3);
    sack(bed, 0.35, 0.32, 0.0, 1.2);
    for (const sz of [-0.55, 0.55]) {
      cyl(p, M.woodDark, 0.25, 0.45, sz, 0.45, 0.45, 0.07, 12, AZ);
      cyl(p, M.wood, 0.25, 0.45, sz, 0.1, 0.1, 0.1, 6, AZ, false);
    }
    solid(p, 0, 0.5, 0, 1.2, 0.5, 0.6);
  };
  // A bed of bamboo against a wall, behind a low stone kerb. Runs along x.
  const bambooBed = (x0: number, x1: number, z: number, depth: number): void => {
    const p = at(0, 0, z);
    box(p, M.stoneDark, (x0 + x1) / 2, 0.12, -depth / 2, x1 - x0, 0.24, 0.16);
    box(p, soil, (x0 + x1) / 2, 0.08, 0, x1 - x0, 0.06, depth - 0.1, undefined, false);
    let s = 7;
    const rnd = (): number => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const n = Math.round((x1 - x0) * 2.2);
    for (let i = 0; i < n; i++) {
      const bx = x0 + 0.2 + (x1 - x0 - 0.4) * (i + rnd() * 0.6) / n, bz = (rnd() - 0.5) * (depth - 0.3);
      const h = 3.6 + rnd() * 2.2, lean = (rnd() - 0.5) * 0.12;
      cyl(p, bamboo, bx, h / 2, bz, 0.045, 0.06, h, 5, [lean, 0, lean * 0.6]);
      // Sprays of narrow leaves at the top and part way up.
      for (let j = 0; j < 3; j++) {
        const y = h * (0.62 + j * 0.16), r = 0.3 + rnd() * 0.15;
        const m = add(p, faceted(new THREE.OctahedronGeometry(r, 0)), j === 2 ? leafLight : leaf, bx + lean * y * 0.6, y, bz - lean * y, [0, rnd() * Math.PI, 0]);
        m.scale.set(1.8, 0.28, 0.55);
      }
    }
    solid(p, (x0 + x1) / 2, 1.5, 0, (x1 - x0) / 2, 1.5, depth / 2);
  };
  // A tall cloth banner on a pole, its text facing +z.
  const nobori = (x: number, z: number, rotY: number, text: string): void => {
    const p = at(x, 0, z, rotY);
    cyl(p, M.woodDark, 0, 1.75, 0, 0.04, 0.05, 3.5, 6);
    cyl(p, M.stoneDark, 0, 0.1, 0, 0.18, 0.22, 0.2, 6);
    box(p, M.woodDark, 0.35, 3.4, 0, 0.7, 0.04, 0.04);
    const b = paintedSign(text, { width: 0.6, vertical: true, wood: 0x2f4a7a, paint: '#f4ead8' });
    b.position.set(x + Math.cos(rotY) * 0.36, 2.25, z - Math.sin(rotY) * 0.36);
    b.rotation.y = rotY;
    b.scale.set(1, 0.55, 1);
    g.add(b);
    solid(p, 0, 1.2, 0, 0.12, 1.2, 0.12);
  };
  // Lily pads on the water, a flower on one or two.
  const lilies = (x: number, z: number, seed: number): void => {
    const p = at(x, POND.surfaceY + 0.015, z, seed);
    const pads: [number, number, number][] = [[0, 0, 0.34], [0.55, 0.25, 0.26], [0.2, -0.5, 0.22], [-0.45, 0.35, 0.2]];
    pads.forEach(([px, pz, r], i) => {
      add(p, new THREE.CylinderGeometry(r, r, 0.02, 9, 1, false, 0.5, Math.PI * 2 - 0.5), i % 2 ? pineLight : reed, px, 0, pz, undefined, false);
      if (i === 0 || (i === 2 && seed > 1)) add(p, faceted(new THREE.ConeGeometry(0.09, 0.1, 5)), lotus, px + 0.05, 0.06, pz, [Math.PI, 0, 0], false);
    });
  };
  const boulder = (x: number, z: number, r: number, rotY: number): void => {
    const p = at(x, 0, z, rotY);
    const m = add(p, faceted(new THREE.IcosahedronGeometry(r, 0)), rock, 0, r * 0.35, 0);
    m.scale.set(1.3, 0.7, 1.0);
    solid(p, 0, r * 0.35, 0, r * 1.1, r * 0.5, r * 0.85);
  };

  // ------------------------------------------------------------ the hall
  const H = HALL, fy = H.floorY;
  // The mat the Master fights on: tatami laid on the boards.
  const mat = new THREE.Mesh(boxUV(new THREE.BoxGeometry(8, 0.04, 7.2), 4), toon(0xffffff, { map: tatami(0xd3c28a, 0xc4b27a, 0x2f3a33) }));
  mat.position.set(-6, fy + 0.02, -12.4);
  mat.receiveShadow = true;
  g.add(mat);
  box(g, M.woodDark, -6, fy + 0.02, -12.4, 8.12, 0.035, 7.32, undefined, false);
  // The back wall: the god shelf over the centre, a scroll either side.
  kamidana(0, fy + 3.05, H.z0 + 0.42);
  scroll(-5.25, fy + 2.15, H.z0 + 0.46, 0, '精進');
  scroll(5.25, fy + 2.15, H.z0 + 0.46, 0, '不動心');
  // The Architect's corner, west end of the back wall.
  lowDesk(-10, fy, -17.6);
  andon(-12.6, fy, -18.6);
  andon(-7.4, fy, -18.6);
  scrollShelf(-13.3, fy, -14, Math.PI / 2);
  scrollShelf(-13.3, fy, -11.6, Math.PI / 2);
  // Students' cushions along the front wall, west bay.
  for (let i = 0; i < 5; i++) zabuton(-12.4 + i * 0.95, fy, -5.1, (i % 2) * 0.08, i === 2 ? red : indigo);
  // Weapons along the east wall, between the posts.
  weaponRack(13.35, fy, -14, -Math.PI / 2);
  weaponRack(13.35, fy, -10, -Math.PI / 2, true);
  weaponRack(13.35, fy, -6.2, -Math.PI / 2);
  // The drum in the front east corner, a pine by the west door.
  taiko(11.4, fy, -5.6, 0);
  pottedPine(-12.6, fy, -6.4, 0.9, 1);
  andon(12.9, fy, -18.7);

  // ------------------------------------------------------------ the yard
  // A cut-stone path from the gate to the hall step: long stones in pairs
  // or singly, a hand's gap between rows, so it reads from the roofs.
  {
    const p = at(0, 0, 0);
    let z = GATE.z0 - 0.3, i = 0;
    while (z > H.z1 + 1.5) {
      const len = [0.9, 0.7, 1.1, 0.8, 0.6][i % 5]!;
      const z1 = z, z0 = Math.max(H.z1 + 1.45, z - len);
      if (i % 3 === 1) box(p, pathStone, 0, 0.025, (z0 + z1) / 2, 1.9, 0.05, z1 - z0 - 0.08, undefined, false);
      else {
        const split = [-0.25, 0.3, 0.1][i % 3]!;
        box(p, pathStone, (-0.95 + split) / 2 - 0.03, 0.025, (z0 + z1) / 2, 0.95 + split - 0.06, 0.05, z1 - z0 - 0.08, undefined, false);
        box(p, pathStone, (0.95 + split) / 2 + 0.03, 0.025, (z0 + z1) / 2, 0.95 - split - 0.06, 0.05, z1 - z0 - 0.08, undefined, false);
      }
      z = z0; i++;
    }
  }
  // Banners just inside the gate.
  nobori(-7.0, GATE.z0 - 3.4, 0, '武道');
  nobori(7.0, GATE.z0 - 3.4, 0, '精進');
  pottedPine(-6.6, GATE.z0 - 0.4, 1.2, 2);
  pottedPine(8.6, GATE.z0 - 0.2, 1.1, 4);
  // Bamboo along the south wall, west of the gate.
  bambooBed(-18.5, -11.8, 19.25, 1.3);
  // Weapon racks on the west wall, by the yard's training corner.
  weaponRack(-23.6, 0, -6.6, Math.PI / 2, true);
  weaponRack(-23.6, 0, -4.4, Math.PI / 2);
  // Striking posts between the pond and the crates.
  for (const [x, z, r] of [[9.2, 2.2, 0.1], [10.9, 2.0, -0.05], [12.6, 2.3, 0.15]] as const) makiwara(x, z, r);
  // The laundry, strung south of the storehouse.
  laundry(14.6, 20.6, 5.6);
  tub(15.2, 6.6, 0.5);
  // The pond's edge: reeds, iris and a couple of stones.
  const pc = POND.center;
  lilies(pc.x - 1.5, pc.z + 1.4, 1);
  lilies(pc.x + 1.7, pc.z - 1.1, 2);
  boulder(pc.x - 4.3, pc.z - 1.6, 0.55, 0.4);
  boulder(pc.x + 2.8, pc.z + 4.2, 0.4, 1.3);

  // ------------------------------------------------------------ the back yard
  // North-east, behind the storehouse: the well, firewood and water.
  well(18.6, -14.6, 0.3);
  woodpile(23.2, -15.4, -Math.PI / 2, 3.2);
  tub(16.4, -12.6);
  tub(17.2, -12.0, 0.36);
  pottedPine(15.6, -18.6, 1.0, 3);

  // ------------------------------------------------------------ the storehouse
  // The lower walls in namako tile (dark squares, white raised joints), a
  // painted name over the door, and the stock piled outside it.
  const S = STORE;
  const namako = toon(0xffffff, { map: namakoTexture() });
  const band = (x0: number, x1: number, z0: number, z1: number, uvSwap = false): void => {
    const geo = boxUV(new THREE.BoxGeometry(x1 - x0, 1.3, z1 - z0), 0.9, uvSwap);
    const m = new THREE.Mesh(geo, namako);
    m.position.set((x0 + x1) / 2, 0.6 + 0.65, (z0 + z1) / 2);
    m.receiveShadow = true;
    g.add(m);
    k.onRoof(m, 'store-wall', true);
  };
  band(S.x0 - 0.04, S.x0, S.z0, -6.1);
  band(S.x0 - 0.04, S.x0, -3.9, S.z1);
  band(S.x0, S.x1, S.z1, S.z1 + 0.04);
  band(S.x0, S.x1, S.z0 - 0.04, S.z0);
  const kura = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), toon(0xffffff, { map: crestTexture('蔵'), alphaTest: 0.5 }));
  kura.position.set(S.x0 - 0.06, 3.15, -5);
  kura.rotation.y = -Math.PI / 2;
  g.add(kura);
  bales(16.2, -8.2, 0, [3, 2]);
  handcart(15.0, -3.2, 2.6);
  {
    const p = at(16.6, 0, -2.0);
    sack(p, 0, 0, 0, 0.3);
    sack(p, 0.55, 0, 0.2, 1.4);
  }
}

// A painted crest: a dark disc with the glyph left white.
function crestTexture(glyph: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#2b2a33';
  g.beginPath(); g.arc(128, 128, 122, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#efe7d6'; g.lineWidth = 8;
  g.beginPath(); g.arc(128, 128, 104, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#efe7d6';
  g.font = '800 140px "Shippori Mincho B1", "Zen Kaku Gothic New", serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(glyph, 128, 136);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Namako wall: dark slate squares set on the diagonal with raised white joints.
function namakoTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#4a5560';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#efe7d6';
  g.lineWidth = 7;
  g.beginPath();
  for (let i = -128; i <= 256; i += 64) { g.moveTo(i, 0); g.lineTo(i + 128, 128); g.moveTo(i, 128); g.lineTo(i + 128, 0); }
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

