import type * as THREE from 'three';
import { POND, SPAWN } from '../world/compound';
import { groundSurface, heightAt, terraceTier } from '../world/valleyPlan';
import type { CueName } from './cues';

// What a foot lands on. The colliders tag wood, stone and the valley's
// ground; the rest is read from where the foot is: the raked sand of the ring
// crunches like gravel, the pond is water (or ice, while Rime holds it
// frozen), its rim is wet stone, and the roofs are tile. Out of the walls the
// valley's plan says what is underfoot: grass, the packed earth of the road
// and the paths (gravel), the stream and the paddies (water), the cliffs (stone).
export type Surface = 'stone' | 'wood' | 'grass' | 'gravel' | 'water' | 'wet' | 'ice' | 'tile';

const HX = 24, HZ = 20;
const RING_R = 6;
const RIM_R = POND.radius + 1.2;

export function surfaceAt(p: THREE.Vector3, tag: string): Surface {
  if (tag === 'wood') return 'wood';
  if (Math.abs(p.x) > HX + 0.5 || Math.abs(p.z) > HZ + 0.5) {
    const onGround = tag === 'ground' || terraceTier(p.x, p.z) >= 0 || Math.abs(p.y - heightAt(p.x, p.z)) < 0.25;
    return onGround ? groundSurface(p.x, p.y, p.z) : 'stone';
  }
  const dx = p.x - POND.center.x, dz = p.z - POND.center.z;
  const pond = Math.hypot(dx, dz);
  if (Math.abs(dx) < POND.hole && Math.abs(dz) < POND.hole && p.y < -0.35) return 'water';
  if (pond < POND.radius + 0.5 && p.y < 0.1) return 'ice';
  if (pond < RIM_R && p.y < 0.6) return 'wet';
  if (p.y > 2.2) return 'tile';
  if (p.y < 0.4 && Math.hypot(p.x - SPAWN.ring.x, p.z - SPAWN.ring.z) < RING_R) return 'gravel';
  return 'stone';
}

export const STEP_CUE: Record<Surface, CueName> = {
  stone: 'step.stone', wood: 'step.wood', grass: 'step.grass', gravel: 'step.gravel', water: 'step.water', wet: 'step.wet', ice: 'step.ice', tile: 'step.tile',
};
