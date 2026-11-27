import type * as THREE from 'three';
import type { Assets } from '../../app/assets';
import type { Physics } from '../../physics/world';
import type { LightPool } from '../../render/lightPool';
import type { PropSystem } from '../props';
import type { Zone } from '../compound';

// The shape a region is built to: given a parent, the physics world, the
// light pool, the props and an origin, it builds itself there and reports
// what the game needs to know about it, and takes itself out again with
// `dispose`. Every position it reports is in world space.

export interface RegionContext {
  parent: THREE.Object3D;
  physics: Physics;
  lights: LightPool;
  props: PropSystem;
  assets: Assets;
  // Where the region's own origin stands in the world.
  origin: THREE.Vector3;
}

// Water a Technique can freeze into a floor. A channel runs along x between
// two walls; a pool is round (the compound's koi pond is one).
export type FreezableWater =
  | { kind: 'channel'; x0: number; x1: number; z0: number; z1: number; surfaceY: number }
  | { kind: 'pool'; center: THREE.Vector3; radius: number; surfaceY: number };

// What the map draws: a plan of shapes in world metres (north up), and the
// places on it.
export type MapShapeKind = 'building' | 'roof' | 'street' | 'paving' | 'water' | 'rail' | 'green' | 'deck' | 'stair';
export interface MapShape { kind: MapShapeKind; x: number; z: number; w: number; h: number }
export interface MapPlace { id: string; name: string; jp: string; x: number; z: number }
export interface RegionMap { view: { x: number; z: number; w: number; h: number }; shapes: MapShape[]; places: MapPlace[] }

// A way into the region from another one: where a road meets its edge,
// and the direction it runs in.
export interface RegionEntrance { id: string; at: THREE.Vector3; heading: number }

export interface Region {
  id: string;
  name: string;
  origin: THREE.Vector3;
  bounds: THREE.Box3;
  zones: Zone[];
  spawns: Record<string, THREE.Vector3>;
  entrances: RegionEntrance[];
  // Meshes the top-down camera fades when they stand between it and the player (see Game.fadeCutaway).
  occluders: THREE.Mesh[];
  waters: FreezableWater[];
  map: RegionMap;
  // The most specific zone at a point, or null outside the region.
  zoneAt(p: THREE.Vector3): Zone | null;
  contains(p: THREE.Vector3): boolean;
  update(time: number, dt: number, player: THREE.Vector3, camera: THREE.Camera): void;
  dispose(): void;
}
