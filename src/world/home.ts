import * as THREE from 'three';
import { SPAWN, type World } from './compound';
import type { RegionContent, RegionDef } from './region';

// The compound and the valley as a region. They are built whole at boot
// (src/world/compound.ts) and everything in the game that lives there (the
// fights, the drills, the rooftop trial, the tutorial, the props) holds on
// to them, so this region is resident: once the pass's far side hides it,
// it is hidden rather than taken down, and shown again on the way back.
// Its zones, footsteps and cutaway are the compound's own (Regions asks the
// World directly); its places are the navigation registry's (src/nav/poi.ts)
// and its map is the map's own compound and valley plans.

export const HOME_BOUNDS = { x0: -112, x1: 114, z0: -92, z1: 134 } as const;

export function homeRegion(world: World): RegionDef {
  return {
    id: 'home',
    name: 'The compound and the valley',
    origin: new THREE.Vector3(0, 0, 0),
    bounds: HOME_BOUNDS,
    resident: true,
    // Hidden once the player is well down the pass's far side, behind the col.
    stream: { load: Infinity, drop: 170 },
    spawns: SPAWN,
    places: [],
    map: { scope: { id: 'valley', label: 'Valley', view: { x: -84, z: -64, w: 170, h: 170 } }, marks: [] },
    // eslint-disable-next-line require-yield
    *build(ctx): Generator<void, RegionContent, void> {
      ctx.group.add(world.group);
      return { zones: [], update: (time) => world.update(time) };
    },
  };
}
