import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Physics, RAPIER } from '../../physics/world';
import type { LightPool, PointSource } from '../../render/lightPool';
import type { PropInstance, PropSystem } from '../props';
import { mangaShading } from '../../render/tone';
import { toon } from '../../render/materials';
import { boxUV } from '../textures';

// The city's builder. Everything is laid out in the region's own metres
// (north is -z, the origin at the middle of the district) and placed at
// `origin` in the world, so the same plan can stand wherever the region
// system puts it. The kit remembers every body, light and prop it makes, so
// `dispose` takes the whole district out again.
//
// Drawing: the district is a few thousand boxes. At the end (`finish`) every
// plain toon piece is folded into one mesh with its colour in the vertices,
// and textured pieces into one mesh per material, the way the valley is
// baked. A piece given a `group` belongs to a building the top-down camera
// may need to see through: each group bakes into its own meshes with its own
// copy of the materials, which the cut-away fades together.

export type Rot = [number, number, number];

export interface PieceOpts {
  rot?: Rot;
  // The cut-away group (a building, a roof). Undefined: static ground-level dressing.
  group?: string;
  shadow?: boolean;
  receive?: boolean;
  // Box colliders follow the box; false for dressing nobody should bump into.
  collide?: boolean;
  surface?: string;
  // World-metre UVs for textured boxes (see boxUV).
  uv?: number;
  uvSwap?: boolean;
}

interface GroupInfo { ghost: boolean; meshes: THREE.Mesh[] }

// The side of a tile of the static bake, in metres.
const TILE = 36;

export class CityKit {
  readonly root = new THREE.Group();
  readonly occluders: THREE.Mesh[] = [];
  private bodies: RAPIER.RigidBody[] = [];
  private sources: PointSource[] = [];
  private spawned: PropInstance[] = [];
  private groups = new Map<string, GroupInfo>();
  private mats = new Map<number, THREE.MeshToonMaterial>();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();

  constructor(readonly parent: THREE.Object3D, readonly physics: Physics, readonly lights: LightPool, readonly props: PropSystem, readonly origin: THREE.Vector3) {
    this.root.name = 'city';
    parent.add(this.root);
  }

  // One shared plain toon material per colour, so the bake folds them together.
  paint(color: number): THREE.MeshToonMaterial {
    let m = this.mats.get(color);
    if (!m) { m = toon(color); this.mats.set(color, m); }
    return m;
  }

  // One material (or anything else) per kit for a key, made on first ask.
  private sharedMats = new Map<string, THREE.Material>();
  shared<M extends THREE.Material>(key: string, make: () => M): M {
    let m = this.sharedMats.get(key) as M | undefined;
    if (!m) { m = make(); this.sharedMats.set(key, m); }
    return m;
  }

  // A world point from region metres.
  w(x: number, y: number, z: number): THREE.Vector3 { return new THREE.Vector3(x + this.origin.x, y + this.origin.y, z + this.origin.z); }

  // A group the cut-away fades together. A ghost stays faintly drawn when
  // faded; otherwise it hides once it is mostly gone. A city block is tall
  // enough that a ghost of it buries the street under its lines, so blocks hide.
  group(name: string, ghost = false): string {
    if (!this.groups.has(name)) this.groups.set(name, { ghost, meshes: [] });
    return name;
  }

  mesh(geo: THREE.BufferGeometry, mat: THREE.Material | number, x: number, y: number, z: number, o: PieceOpts = {}): THREE.Mesh {
    const m = new THREE.Mesh(geo, typeof mat === 'number' ? this.paint(mat) : mat);
    m.position.copy(this.w(x, y, z));
    if (o.rot) m.rotation.set(...o.rot);
    m.castShadow = o.shadow ?? true;
    m.receiveShadow = o.receive ?? true;
    this.root.add(m);
    if (o.group) {
      const gi = this.groups.get(o.group) ?? this.groups.set(o.group, { ghost: false, meshes: [] }).get(o.group)!;
      gi.meshes.push(m);
    }
    return m;
  }

  // A box by its centre and size; collides unless told not to.
  box(mat: THREE.Material | number, x: number, y: number, z: number, w: number, h: number, d: number, o: PieceOpts = {}): THREE.Mesh {
    const geo = new THREE.BoxGeometry(w, h, d);
    if (o.uv) boxUV(geo, o.uv, o.uvSwap);
    const m = this.mesh(geo, mat, x, y, z, o);
    if (o.collide !== false) {
      let quat: THREE.Quaternion | undefined;
      if (o.rot) quat = this.q.setFromEuler(this.e.set(...o.rot)).clone();
      this.solid(x, y, z, w / 2, h / 2, d / 2, quat, o.surface);
    }
    return m;
  }

  // A box spanning two corners.
  span(mat: THREE.Material | number, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, o: PieceOpts = {}): THREE.Mesh {
    return this.box(mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), o);
  }

  cyl(mat: THREE.Material | number, x: number, y: number, z: number, rTop: number, rBot: number, h: number, seg = 8, o: PieceOpts = {}): THREE.Mesh {
    return this.mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), mat, x, y, z, o);
  }

  // A collider only, by centre and half size.
  solid(x: number, y: number, z: number, hx: number, hy: number, hz: number, quat?: THREE.Quaternion, surface = 'stone'): RAPIER.Collider {
    const col = this.physics.staticBox(this.w(x, y, z), new THREE.Vector3(hx, hy, hz), quat);
    (col as RAPIER.Collider & { surfaceTag?: string }).surfaceTag = surface;
    const body = col.parent();
    if (body) this.bodies.push(body);
    return col;
  }

  // A collider spanning two corners.
  block(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, surface = 'stone'): void {
    this.solid((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, Math.abs(z1 - z0) / 2, undefined, surface);
  }

  light(color: number, intensity: number, distance: number, x: number, y: number, z: number): void {
    this.sources.push(this.lights.add({ kind: 'point', position: this.w(x, y, z), color: new THREE.Color(color), intensity, distance, decay: 2 }));
  }

  prop(key: string, x: number, y: number, z: number, rot = 0): PropInstance {
    const p = this.props.spawn(key, this.w(x, y, z), rot);
    this.spawned.push(p);
    return p;
  }

  // An object that animates or is held by code: added as is, never baked.
  keep<T extends THREE.Object3D>(o: T): T { o.userData.keep = true; this.root.add(o); return o; }

  // Bakes the district: each group into its own meshes (faded together),
  // then everything else that never moves.
  finish(): void { for (const _ of this.finishing()) { /* all at once */ } }

  // The same bake, a group or a tile at a time, for a build spread over frames.
  *finishing(): Generator<void, void, void> {
    this.root.updateMatrixWorld(true);
    for (const [name, gi] of this.groups) {
      yield;
      const live = gi.meshes.filter((m) => m.parent);
      if (!live.length) continue;
      for (const merged of yield* bakeSet(live, this.root, true)) {
        const src = merged.material as THREE.Material;
        const mat = src.clone();
        if ((mat as THREE.MeshToonMaterial).isMeshToonMaterial) mangaShading(mat as THREE.MeshToonMaterial);
        // Compiled transparent from the start, or a fade never takes (see compound.ts).
        mat.transparent = true;
        merged.material = mat;
        merged.userData.cutaway = name;
        merged.userData.ghost = gi.ghost;
        this.occluders.push(merged);
      }
    }
    const rest: THREE.Mesh[] = [];
    yield;
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || m.userData.cutaway !== undefined) return;
      for (let p: THREE.Object3D | null = m; p && p !== this.root; p = p.parent) if (p.userData.keep) return;
      rest.push(m);
    });
    // Static pieces bake in tiles, so the camera and the shadow map cull the
    // parts of the ward they do not see. A piece goes to the tile its middle
    // stands in; pieces longer than a tile (a road, a canal wall) go whole.
    const tiles = new Map<string, THREE.Mesh[]>();
    const box = new THREE.Box3(), mid = new THREE.Vector3(), size = new THREE.Vector3();
    for (const [i, m] of rest.entries()) {
      if (i % 300 === 299) yield;
      box.setFromObject(m).getCenter(mid);
      box.getSize(size);
      const key = Math.max(size.x, size.z) > TILE ? 'long' : `${Math.floor((mid.x - this.origin.x) / TILE)}:${Math.floor((mid.z - this.origin.z) / TILE)}`;
      const l = tiles.get(key);
      if (l) l.push(m); else tiles.set(key, [m]);
    }
    for (const l of tiles.values()) { yield; yield* bakeSet(l, this.root, false); }
  }

  dispose(): void {
    const world = this.physics.world;
    for (const b of this.bodies) if (world.getRigidBody(b.handle)) world.removeRigidBody(b);
    this.bodies.length = 0;
    for (const s of this.sources) this.lights.remove(s);
    this.sources.length = 0;
    for (const p of this.spawned) this.props.remove(p);
    this.spawned.length = 0;
    const seen = new Set<THREE.Material | THREE.BufferGeometry | THREE.Texture>();
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      seen.add(m.geometry);
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        seen.add(mat);
        const map = (mat as THREE.MeshToonMaterial).map;
        if (map) seen.add(map);
      }
    });
    for (const r of seen) r.dispose();
    this.root.removeFromParent();
    this.occluders.length = 0;
  }
}

// Folds a set of meshes into as few as possible: every plain, opaque,
// one-sided toon piece into one mesh per shadow setting with its colour in
// the vertices; every other piece into one mesh per material and shadow
// setting. Returns the meshes made. A generator: the pieces go into world
// space a batch at a time, so a large set spreads over several slices.
function* bakeSet(list: THREE.Mesh[], parent: THREE.Object3D, keepAlone: boolean): Generator<void, THREE.Mesh[], void> {
  const painted = new Map<string, THREE.Mesh[]>();
  const byMat = new Map<string, THREE.Mesh[]>();
  for (const m of list) {
    const mat = m.material as THREE.MeshToonMaterial;
    const shadow = `${m.castShadow ? 1 : 0}${m.receiveShadow ? 1 : 0}`;
    const plain = mat.isMeshToonMaterial && !mat.map && !mat.transparent && !mat.polygonOffset && mat.side === THREE.FrontSide && !mat.vertexColors && mat.emissive.getHex() === 0;
    const key = plain ? shadow : `${mat.uuid}|${shadow}`;
    const target = plain ? painted : byMat;
    const l = target.get(key);
    if (l) l.push(m); else target.set(key, [m]);
  }
  const out: THREE.Mesh[] = [];
  const BATCH = 60;
  const world = function* (l: THREE.Mesh[], colour: boolean): Generator<void, THREE.BufferGeometry[], void> {
    const geos: THREE.BufferGeometry[] = [];
    for (let i = 0; i < l.length; i++) { geos.push(worldGeometry(l[i]!, colour)); if (i % BATCH === BATCH - 1) yield; }
    return geos;
  };
  for (const l of painted.values()) {
    if (l.length < 2 && !keepAlone) continue;
    const geos = yield* world(l, true);
    yield;
    const geo = mergeGeometries(geos, false);
    if (!geo) throw new Error('city bake: painted geometries do not match');
    const mat = toon(0xffffff);
    mat.vertexColors = true;
    out.push(place(new THREE.Mesh(geo, mat), l, parent));
  }
  for (const l of byMat.values()) {
    if (l.length < 2 && !keepAlone) continue;
    const geos = yield* world(l, false);
    const geo = mergeGeometries(geos, false);
    if (!geo) throw new Error('city bake: geometries do not match');
    out.push(place(new THREE.Mesh(geo, l[0]!.material), l, parent));
  }
  return out;
}

function place(merged: THREE.Mesh, from: THREE.Mesh[], parent: THREE.Object3D): THREE.Mesh {
  merged.castShadow = from[0]!.castShadow;
  merged.receiveShadow = from[0]!.receiveShadow;
  for (const m of from) { m.removeFromParent(); m.geometry.dispose(); }
  parent.add(merged);
  return merged;
}

// A piece's triangles in world space with position, normal and uv; with
// `colour`, its material's colour in every vertex as well.
function worldGeometry(m: THREE.Mesh, colour: boolean): THREE.BufferGeometry {
  const src = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
  const out = new THREE.BufferGeometry();
  const n = src.getAttribute('position').count;
  out.setAttribute('position', src.getAttribute('position').clone());
  out.setAttribute('normal', src.getAttribute('normal')?.clone() ?? new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  out.setAttribute('uv', src.getAttribute('uv')?.clone() ?? new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (colour) {
    const c = (m.material as THREE.MeshToonMaterial).color;
    const cols = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b; }
    out.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  }
  out.applyMatrix4(m.matrixWorld);
  src.dispose();
  return out;
}

// A small seeded random, so the district is built the same every time.
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
