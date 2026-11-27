import * as THREE from 'three';
import { Physics, RAPIER, GROUP_WORLD, groups } from '../physics/world';
import type { LightPool, LightSource } from '../render/lightPool';
import type { Surface } from '../audio/surfaces';
import type { Assets } from '../app/assets';
import type { PropSystem } from './props';

// The world is a chain of regions: the compound and its valley, the pass
// road over the mountains, the outskirts, the city. A region is a module
// that builds itself into a group and the physics world at an origin, says
// what it holds (places, spawn points, a map layer, the land it covers), and
// takes everything down again. `Regions` (src/world/regions.ts) streams them
// in and out as the player moves, a slice of building at a time, so there is
// never a loading screen or a hitch.
//
// Everything a region reports is in its own frame: local metres, with the
// origin where the host puts it. The host turns it into world space.

export type Pt = readonly [number, number];

// A box on the ground plane, in the region's frame.
export interface Bounds { x0: number; x1: number; z0: number; z1: number }

// A named place on the ground. The HUD shows the label (and the kanji, when
// there is one) as the player walks in. `indoors` softens the bed and lets
// the aura dome stop at the ceiling. `general` marks the region's catch-all
// zone, which any specific zone (in any region) overrides.
export interface Zone { id: string; label: string; jp?: string; min: THREE.Vector3; max: THREE.Vector3; indoors?: boolean; general?: boolean }

// A place worth walking to: the compass, the map, the tracked marker and the
// waypoint stones read these. Standing near `shrine` counts it as visited.
export interface Place {
  id: string;
  name: string;
  jp: string;
  glyph: string;
  blurb: string;
  at: THREE.Vector3;
  label: THREE.Vector3;
  // A place with no stone (a city street has no room for one) counts as visited standing near `at`.
  shrine?: THREE.Vector3;
}

// The map draws a region from these marks, in its own plan style (the class
// names are the map's: src/ui/nav/nav.css, `.m-<class>`).
export type MapClass = 'ground' | 'floor' | 'cliff' | 'wood' | 'meadow' | 'road' | 'path' | 'stream' | 'water' | 'field' | 'bridge' | 'structure' | 'building' | 'torii' | 'rail' | 'stones'
  | 'walk' | 'city-street' | 'city-paving' | 'city-rail' | 'city-stair';
export type MapMark =
  | { kind: 'area'; class: MapClass; pts: readonly Pt[] }
  | { kind: 'line'; class: MapClass; pts: readonly Pt[] }
  | { kind: 'box'; class: MapClass; x: number; z: number; w: number; d: number }
  | { kind: 'circle'; class: MapClass; x: number; z: number; r: number }
  | { kind: 'text'; text: string; x: number; z: number };
export interface MapLayer {
  // The map's scale tab for this region (or the tab it shares): its name and the plan it frames, in the region's frame.
  scope: { id: string; label: string; view: { x: number; z: number; w: number; h: number } };
  marks: readonly MapMark[];
}

// Running water near the listener: the bed places the stream's voice at the nearest stretch.
export interface WaterLine { pts: readonly Pt[]; y: number }

// Water a Technique can freeze into a floor (Rime). A channel runs along x
// between two walls; a pool is round (the compound's koi pond is one).
export type FreezableWater =
  | { kind: 'channel'; x0: number; x1: number; z0: number; z1: number; surfaceY: number }
  | { kind: 'pool'; center: THREE.Vector3; radius: number; surfaceY: number };

// A way in from another region: where a road meets the edge, in the region's
// frame, and the heading it runs in (radians, 0 along -z, PI / 2 along +x).
// The region before it is laid out to meet it there (src/world/atlas.ts).
export interface Entrance { id: string; at: THREE.Vector3; heading: number }

// What a region's build hands back once it is standing.
export interface RegionContent {
  zones: Zone[];
  // Meshes that fade for the top-down camera when they stand between it and
  // the player (src/app/game.ts, `fadeCutaway`). A mesh's
  // `userData.cutaway` names the group it fades with; `userData.ghost` keeps
  // it drawn (faded) instead of hidden.
  occluders?: THREE.Mesh[];
  // The ground height at (x, z) as the colliders have it, or null off the region's land.
  groundAt?(x: number, z: number): number | null;
  // What a foot lands on, given the collider's tag ('ground', 'wood', ...), or null to fall back to the tag.
  surfaceAt?(p: THREE.Vector3, tag: string): Surface | null;
  // 0 outdoors to 1 well inside (the bed muffles the outside, the hall's room tone comes up).
  indoorsAt?(p: THREE.Vector3): number;
  water?: WaterLine[];
  // Water Rime can freeze into a floor.
  waters?: FreezableWater[];
  // Open flames at standing height (a stone lantern's light chamber): vapour
  // that climbs to one catches (src/techniques/kits/fuelVapour.ts).
  flames?: THREE.Vector3[];
  // Per frame while it stands: animated materials, things that move on
  // their own. `time` is the game clock, `dt` the frame's real seconds;
  // `player` and `camera` are in world space.
  update?(time: number, dt: number, player: THREE.Vector3, camera: THREE.Camera): void;
  // Anything the build made beyond the group's meshes and the scoped colliders and lights.
  dispose?(): void;
}

// What the host hands a region's build. Build in the region's own frame:
// `group` sits at the origin, and `physics` and `lights` take local
// coordinates and are taken down with the region.
export interface RegionContext {
  group: THREE.Group;
  physics: RegionPhysics;
  lights: RegionLights;
  origin: THREE.Vector3;
  // The shared props (crates, barrels, drums a Technique throws) and the loaded assets (the rigged human, ...).
  props: PropSystem;
  assets: Assets;
  // Names the stretch of building under way, so the host can say which one ran long (`Regions.status`).
  phase(name: string): void;
}

export interface RegionDef {
  id: string;
  name: string;
  // Where the region's local (0, 0, 0) stands in the world.
  origin: THREE.Vector3;
  // The land it owns, in its frame. The player inside it means it must be standing.
  bounds: Bounds;
  // Streaming distances from the bounds, in metres: it starts building when
  // the player comes within `load`, and goes (or hides, if resident) past `drop`.
  stream: { load: number; drop: number };
  // Never taken down: hidden past `drop` and shown again inside it.
  resident?: boolean;
  // While standing, the painted city skyline on the horizon hides (the city draws its own).
  hidesSkyline?: boolean;
  // Named spawn points, in its frame: the debug teleport and the checks use them.
  spawns: Readonly<Record<string, THREE.Vector3>>;
  places: readonly Place[];
  map: MapLayer;
  // Where roads from other regions come in.
  entrances?: readonly Entrance[];
  // A generator: each `yield` ends a slice, and the host lets a frame go
  // before the next one when it is over its time budget. Keep a slice under
  // about 2 ms on an M1; split a big loop into rows. Return the content.
  build(ctx: RegionContext): Generator<void, RegionContent, void>;
}

// ------------------------------------------------------------ scoped physics

// Static colliders in a region's frame. Every body it makes is removed when
// the region goes, so a region never leaves a collider behind.
export class RegionPhysics {
  private bodies: RAPIER.RigidBody[] = [];
  private q = new THREE.Quaternion();

  constructor(readonly physics: Physics, readonly origin: THREE.Vector3) {}

  private keep(body: RAPIER.RigidBody): RAPIER.RigidBody { this.bodies.push(body); return body; }
  private desc(cx: number, cy: number, cz: number, quat?: THREE.Quaternion): RAPIER.RigidBodyDesc {
    const o = this.origin, d = RAPIER.RigidBodyDesc.fixed().setTranslation(cx + o.x, cy + o.y, cz + o.z);
    if (quat) d.setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w });
    return d;
  }

  // A box at `center` with half extents `half`, turned by `quat`. `surface` tags it for footsteps.
  box(center: THREE.Vector3, half: THREE.Vector3, quat?: THREE.Quaternion, surface?: string): RAPIER.Collider {
    const body = this.keep(this.physics.world.createRigidBody(this.desc(center.x, center.y, center.z, quat)));
    return tag(this.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setCollisionGroups(groups(GROUP_WORLD, 0xffff)), body), surface);
  }

  // A box turned about the vertical only (yaw, radians, as three.js turns a mesh).
  yawBox(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, yaw: number, surface?: string): RAPIER.Collider {
    return this.box(new THREE.Vector3(cx, cy, cz), new THREE.Vector3(hx, hy, hz), this.q.setFromAxisAngle(UP, yaw), surface);
  }

  // Ground from a height grid: `heights[i * (nx + 1) + j]` is the height at
  // row i (along z) and column j (along x), from (x0, z0) in steps of `cell`.
  heightfield(x0: number, z0: number, cell: number, nx: number, nz: number, heights: Float32Array, surface = 'ground'): RAPIER.Collider {
    const cols = new Float32Array((nx + 1) * (nz + 1));
    // Rapier reads the grid column-major, rows along z.
    for (let i = 0; i <= nz; i++) for (let j = 0; j <= nx; j++) cols[i + j * (nz + 1)] = heights[i * (nx + 1) + j]!;
    const body = this.keep(this.physics.world.createRigidBody(this.desc(x0 + (nx * cell) / 2, 0, z0 + (nz * cell) / 2)));
    return tag(this.physics.world.createCollider(RAPIER.ColliderDesc.heightfield(nz, nx, cols, { x: nx * cell, y: 1, z: nz * cell }).setCollisionGroups(groups(GROUP_WORLD, 0xffff)), body), surface);
  }

  // A collider from a mesh's triangles, in the region's frame (the mesh's matrix applied).
  trimesh(mesh: THREE.Mesh, surface?: string): RAPIER.Collider | null {
    const pos = mesh.geometry.getAttribute('position');
    if (!pos) return null;
    mesh.updateWorldMatrix(true, false);
    const m = mesh.matrixWorld, v = new THREE.Vector3(), o = this.origin;
    const verts = new Float32Array(pos.count * 3);
    // The mesh sits in the region's group, which sits at the origin: its world matrix already includes it.
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(m); verts[i * 3] = v.x - o.x; verts[i * 3 + 1] = v.y - o.y; verts[i * 3 + 2] = v.z - o.z; }
    const idx = mesh.geometry.index ? new Uint32Array(mesh.geometry.index.array) : Uint32Array.from({ length: pos.count }, (_, i) => i);
    const body = this.keep(this.physics.world.createRigidBody(this.desc(0, 0, 0)));
    return tag(this.physics.world.createCollider(RAPIER.ColliderDesc.trimesh(verts, idx).setCollisionGroups(groups(GROUP_WORLD, 0xffff)), body), surface);
  }

  get count(): number { return this.bodies.length; }

  dispose(): void {
    for (const b of this.bodies) this.physics.world.removeRigidBody(b);
    this.bodies.length = 0;
  }
}

// Light sources in a region's frame, dropped from the pool with the region.
export class RegionLights {
  private sources: LightSource[] = [];
  constructor(readonly pool: LightPool, private origin: THREE.Vector3) {}
  add<S extends LightSource>(source: S): S {
    source.position.add(this.origin);
    if (source.kind === 'spot') source.target.add(this.origin);
    this.sources.push(source);
    return this.pool.add(source);
  }
  dispose(): void { for (const s of this.sources) this.pool.remove(s); this.sources.length = 0; }
}

const UP = new THREE.Vector3(0, 1, 0);

function tag(col: RAPIER.Collider, surface?: string): RAPIER.Collider {
  if (surface) (col as RAPIER.Collider & { surfaceTag?: string }).surfaceTag = surface;
  return col;
}

// Distance from a point to the region's bounds on the ground plane (0 inside).
export function boundsDistance(b: Bounds, x: number, z: number): number {
  const dx = Math.max(b.x0 - x, 0, x - b.x1), dz = Math.max(b.z0 - z, 0, z - b.z1);
  return Math.hypot(dx, dz);
}
