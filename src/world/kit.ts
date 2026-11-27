import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toon, faceted } from '../render/materials';
import type { RegionPhysics } from './region';

// A region's building hand: flat toon pieces placed by hand, their colliders
// in the same frame, and a bake that folds a finished stretch of plain pieces
// into two vertex-coloured meshes (the ones that cast shadows and the ones
// that do not). A stretch is a group: bake it when it is done, so each bake
// is small enough for one slice of a frame and the stretches cull apart.

export type Rot = readonly [number, number, number];
export type Paint = number | THREE.Material;

const UP = new THREE.Vector3(0, 1, 0);

// A small seeded random, so the woods grow the same every time.
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export class Kit {
  // One plain material per colour, so every piece of one colour bakes together.
  private mats = new Map<number, THREE.MeshToonMaterial>();
  // The baked meshes' material: their colours ride in the vertices.
  readonly painted: THREE.MeshToonMaterial;

  constructor(readonly root: THREE.Group, readonly phys: RegionPhysics) {
    this.painted = toon(0xffffff);
    this.painted.vertexColors = true;
  }

  mat(color: number): THREE.MeshToonMaterial {
    let m = this.mats.get(color);
    if (!m) { m = toon(color); this.mats.set(color, m); }
    return m;
  }
  private paint(p: Paint): THREE.Material { return typeof p === 'number' ? this.mat(p) : p; }

  // A new stretch (a group under the region's root, or under `parent`).
  stretch(name: string, parent: THREE.Object3D = this.root): THREE.Group {
    const g = new THREE.Group();
    g.name = name;
    parent.add(g);
    return g;
  }

  at(parent: THREE.Object3D, x: number, y: number, z: number, rotY = 0): THREE.Group {
    const p = new THREE.Group();
    p.position.set(x, y, z);
    p.rotation.y = rotY;
    parent.add(p);
    return p;
  }

  add(p: THREE.Object3D, geo: THREE.BufferGeometry, paint: Paint, x: number, y: number, z: number, rot?: Rot, shadow = true): THREE.Mesh {
    const m = new THREE.Mesh(geo, this.paint(paint));
    m.position.set(x, y, z);
    if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
    m.castShadow = shadow;
    m.receiveShadow = true;
    p.add(m);
    return m;
  }
  box(p: THREE.Object3D, paint: Paint, x: number, y: number, z: number, w: number, h: number, d: number, rot?: Rot, shadow = true): THREE.Mesh {
    return this.add(p, new THREE.BoxGeometry(w, h, d), paint, x, y, z, rot, shadow);
  }
  cyl(p: THREE.Object3D, paint: Paint, x: number, y: number, z: number, rTop: number, rBot: number, h: number, seg = 8, rot?: Rot, shadow = true): THREE.Mesh {
    return this.add(p, new THREE.CylinderGeometry(rTop, rBot, h, seg), paint, x, y, z, rot, shadow);
  }
  // A cut stone or a crown: every face its own normal.
  rock(p: THREE.Object3D, paint: Paint, x: number, y: number, z: number, r: number, detail = 0, scale: readonly [number, number, number] = [1, 1, 1], rot?: Rot, shadow = true): THREE.Mesh {
    const m = this.add(p, faceted(new THREE.IcosahedronGeometry(r, detail)), paint, x, y, z, rot, shadow);
    m.scale.set(scale[0], scale[1], scale[2]);
    return m;
  }
  cone(p: THREE.Object3D, paint: Paint, x: number, y: number, z: number, r: number, h: number, seg = 7, rot?: Rot, shadow = true): THREE.Mesh {
    return this.add(p, faceted(new THREE.ConeGeometry(r, h, seg)), paint, x, y, z, rot, shadow);
  }

  // A collider in `p`'s frame: centre and half size, optionally turned further.
  solid(p: THREE.Object3D, x: number, y: number, z: number, hx: number, hy: number, hz: number, surface = 'stone', quat?: THREE.Quaternion): void {
    p.updateMatrixWorld(true);
    const c = p.localToWorld(new THREE.Vector3(x, y, z)).sub(this.root.getWorldPosition(new THREE.Vector3()));
    const q = p.getWorldQuaternion(new THREE.Quaternion());
    if (quat) q.multiply(quat);
    this.phys.box(c, new THREE.Vector3(hx, hy, hz), q, surface);
  }

  // A wall from (x0, z0) to (x1, z1) in the region's frame: `bottom` to `top`, `half` thick either side.
  wall(x0: number, z0: number, x1: number, z1: number, bottom: number, top: number, half = 0.4, surface = 'stone'): void {
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 0.05) return;
    const yaw = -Math.atan2(z1 - z0, x1 - x0);
    this.phys.box(new THREE.Vector3((x0 + x1) / 2, (bottom + top) / 2, (z0 + z1) / 2), new THREE.Vector3(len / 2, (top - bottom) / 2, half), new THREE.Quaternion().setFromAxisAngle(UP, yaw), surface);
  }

  // A mesh straight from triangles (x, y, z per corner). `up` lights thin
  // blades as the ground under them is lit, so a leaf turned from the sun
  // does not read as a black sliver.
  tris(parent: THREE.Object3D, pos: number[], paint: Paint, shadow: boolean, up = false, colors?: number[]): THREE.Mesh | null {
    if (!pos.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    if (colors) geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    if (up) geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    else geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, colors ? this.painted : this.paint(paint));
    m.castShadow = shadow;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  // Folds every plain, opaque toon piece under `g` into one vertex-coloured
  // mesh per shadow setting, in `g`'s parent frame. Textured, see-through,
  // double-sided and kept (`userData.keep`) pieces stay as they are.
  bake(g: THREE.Object3D): THREE.Mesh[] {
    const parent = g.parent ?? this.root;
    parent.updateMatrixWorld(true);
    const inv = parent.matrixWorld.clone().invert();
    const sets = new Map<boolean, THREE.Mesh[]>([[true, []], [false, []]]);
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || m.userData.cutaway !== undefined || m.userData.baked) return;
      for (let q: THREE.Object3D | null = m; q && q !== parent; q = q.parent) if (q.userData.keep || !q.visible) return;
      const mat = m.material as THREE.MeshToonMaterial;
      if (!mat.isMeshToonMaterial || mat.map || mat.transparent || mat.side !== THREE.FrontSide || (mat.vertexColors && !m.geometry.getAttribute('color'))) return;
      sets.get(m.castShadow)!.push(m);
    });
    const out: THREE.Mesh[] = [];
    for (const [shadow, list] of sets) {
      if (!list.length) continue;
      const merged = new THREE.Mesh(mergeGeometries(list.map((m) => painted(m, inv)), false)!, this.painted);
      merged.castShadow = shadow;
      merged.receiveShadow = true;
      merged.name = `${g.name}:baked`;
      merged.userData.baked = true;
      parent.add(merged);
      out.push(merged);
    }
    return out;
  }

  // Folds a set of pieces into one mesh with its own material, for a clump
  // that fades as one in the cutaway (each fades on its own material).
  clump(parts: THREE.Mesh[], parent: THREE.Object3D, name: string): THREE.Mesh {
    parent.updateMatrixWorld(true);
    const inv = parent.matrixWorld.clone().invert();
    const mat = toon(0xffffff);
    mat.vertexColors = true;
    const merged = new THREE.Mesh(mergeGeometries(parts.map((m) => painted(m, inv)), false)!, mat);
    merged.castShadow = true;
    merged.receiveShadow = true;
    merged.userData.cutaway = name;
    merged.userData.ghost = true;
    parent.add(merged);
    return merged;
  }
}

// A piece's triangles in `inv`'s frame, its colour in every vertex; the piece leaves the scene.
function painted(m: THREE.Mesh, inv: THREE.Matrix4): THREE.BufferGeometry {
  const src = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', src.getAttribute('position').clone());
  out.setAttribute('normal', src.getAttribute('normal').clone());
  const n = out.getAttribute('position').count;
  const given = src.getAttribute('color');
  if (given) out.setAttribute('color', given.clone());
  else {
    const c = (m.material as THREE.MeshToonMaterial).color, cols = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b; }
    out.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  }
  m.updateMatrixWorld(true);
  out.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
  m.parent?.remove(m);
  m.geometry.dispose();
  src.dispose();
  return out;
}

// ------------------------------------------------------------ trees

export type TreeKind = 'pine' | 'cedar' | 'maple' | 'gold';
export const TREE_COLORS = { trunk: 0x4e3024, pine: 0x3e7d4a, pineDark: 0x2f6440, cedar: 0x2d5c45, cedarDark: 0x264f3b, maple: 0xe8713a, mapleDeep: 0xc9452c, gold: 0xe6b83c } as const;

// A tree in the compound's manner: stacked faceted cones for pines and
// cedars, a cluster of faceted crowns for maples and gold trees. Returns its
// pieces (to bake or to clump). `far` trees have plainer crowns and cast no shadow.
export function tree(k: Kit, parent: THREE.Object3D, x: number, y: number, z: number, kind: TreeKind, s: number, seed: number, far = false): THREE.Mesh[] {
  const C = TREE_COLORS;
  const t = k.at(parent, x, y - 0.05, z, seed);
  t.rotation.z = ((seed % 3) - 1) * 0.03;
  const parts: THREE.Mesh[] = [];
  if (kind === 'pine' || kind === 'cedar') {
    const cedar = kind === 'cedar';
    const trunkH = (cedar ? 2.6 : 1.6) * s;
    parts.push(k.cyl(t, C.trunk, 0, trunkH / 2, 0, 0.14 * s, 0.26 * s, trunkH, 6));
    const layers = cedar ? 5 : 3;
    for (let i = 0; i < layers; i++) {
      const r = cedar ? (1.3 - i * 0.2) * s : (2.0 - i * 0.45) * s, h = (cedar ? 2.3 : 2.2) * s;
      parts.push(k.cone(t, cedar ? ((seed + i) % 2 ? C.cedar : C.cedarDark) : (seed + i) % 2 ? C.pine : C.pineDark, 0, trunkH + (0.6 + i * (cedar ? 1.3 : 1.3)) * s, 0, r, h, far ? 6 : 7, [0, seed + i, 0]));
    }
  } else {
    const trunkH = 2.4 * s;
    parts.push(k.cyl(t, C.trunk, 0, trunkH / 2, 0, 0.16 * s, 0.26 * s, trunkH, 6));
    for (let i = 0; i < 4; i++) {
      const r = (1.4 + ((seed * 7 + i * 3) % 4) * 0.2) * s, a = seed * 1.3 + i * 1.7;
      const col = kind === 'maple' ? (i % 3 === 2 ? C.mapleDeep : C.maple) : C.gold;
      parts.push(k.rock(t, col, Math.cos(a) * 0.9 * s, trunkH + (0.6 + (i % 2) * 0.9) * s, Math.sin(a) * 0.9 * s, r, far ? 0 : 1));
    }
  }
  if (far) for (const m of parts) m.castShadow = false;
  return parts;
}
