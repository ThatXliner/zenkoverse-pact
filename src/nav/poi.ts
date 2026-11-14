import * as THREE from 'three';
import { SPAWN, HALL, STORE, GATE } from '../world/compound';
import type { TutorialStepId } from '../app/state';

export type PoiId = keyof typeof SPAWN;

// One entry per place worth going to in the compound. The compass, the
// tracked marker, the map, the landmark labels and the waypoint shrines all
// read this table, so adding a place means adding a row.
export interface Poi {
  id: PoiId;
  name: string;
  jp: string;
  glyph: string;
  blurb: string;
  // What the compass, the tracked marker, and the map point at.
  at: THREE.Vector3;
  // Anchor of the name label hung in the world.
  label: THREE.Vector3;
  // The waypoint shrine. Standing within UNLOCK_RADIUS of it counts the place as visited.
  shrine: THREE.Vector3;
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export const POIS: readonly Poi[] = [
  { id: 'hall', name: 'Training hall', jp: '道場', glyph: '道', blurb: 'The Pact Architect keeps the Workshop at the desk inside. The dummies wait at the back, and the Master takes challengers on the mat.', at: v(3, HALL.floorY, -8), label: v(0, HALL.deckY + 0.5, HALL.z1 + 1.5), shrine: v(-3.2, 0, HALL.z1 + 2.6) },
  { id: 'ring', name: 'Sparring ring', jp: '稽古場', glyph: '稽', blurb: 'A raked sand circle for sparring. Call the partners from the centre.', at: SPAWN.ring.clone(), label: v(SPAWN.ring.x, 3.6, SPAWN.ring.z), shrine: v(SPAWN.ring.x - 1, 0, SPAWN.ring.z + 7.4) },
  { id: 'pond', name: 'Koi pond', jp: '池', glyph: '池', blurb: 'Water for Rime. Freeze it and walk across.', at: v(11, 0, 11), label: v(11, 2.4, 11), shrine: v(11, 0, 16.6) },
  { id: 'roof', name: 'Hall roof', jp: '屋上', glyph: '屋', blurb: 'The stair on the hall\'s west side climbs to the deck. The rooftop trial begins at the board up there, and a plank bridge crosses to the storehouse.', at: v(-6, HALL.deckY, -13), label: v(0, HALL.deckY + 3.2, -12), shrine: v(-16.9, HALL.deckY, -12.3) },
  { id: 'store', name: 'Storehouse roof', jp: '蔵', glyph: '蔵', blurb: 'Across the bridge from the hall roof. From its south edge you can drop to the wall walk.', at: v((STORE.x0 + STORE.x1) / 2, STORE.deckY, (STORE.z0 + STORE.z1) / 2), label: v((STORE.x0 + STORE.x1) / 2, STORE.deckY + 2.6, (STORE.z0 + STORE.z1) / 2), shrine: v(STORE.x0 + 1.4, STORE.deckY, STORE.z1 - 1.4) },
  { id: 'gate', name: 'The gate', jp: '門', glyph: '門', blurb: 'The way out, shut for the night. The Kuroda Enforcer answers a challenge here.', at: v(0, 0, GATE.z0 - 2), label: v(0, GATE.roofY + 1.8, GATE.z0), shrine: v(5.2, 0, 15.4) },
];

export const poiById = (id: PoiId): Poi => POIS.find((p) => p.id === id)!;

export const UNLOCK_RADIUS = 5;
export const ARRIVE_RADIUS = 8;

// The tutorial step is a tracked objective whenever it points at a place.
export const TUTORIAL_TARGETS: Partial<Record<TutorialStepId, { title: string; jp: string; at: THREE.Vector3 } | { poi: PoiId }>> = {
  look: { title: 'The hoist', jp: '起重機', at: v(-20, 5, 3) },
  secondary: { title: 'Crates by the hoist', jp: '木箱', at: v(-22.6, 0, 10.6) },
  done: { poi: 'hall' },
};

// The current goal is the first of these whose place has not been visited.
export interface Goal { id: string; poi: PoiId; title: string; hint: string }

export const GOALS: readonly Goal[] = [
  { id: 'hall', poi: 'hall', title: 'Find the Pact Workshop', hint: 'The Architect\'s desk is inside the hall, at the north of the yard.' },
  { id: 'ring', poi: 'ring', title: 'Step into the sparring ring', hint: 'The sand circle on the west side of the yard.' },
  { id: 'roof', poi: 'roof', title: 'Climb to the hall roof', hint: 'Take the stair on the hall\'s west side.' },
  { id: 'store', poi: 'store', title: 'Cross to the storehouse roof', hint: 'The plank bridge leaves the east edge of the hall roof.' },
  { id: 'gate', poi: 'gate', title: 'Walk the wall to the gate', hint: 'Drop from the storehouse to the wall walk and follow it round.' },
  { id: 'pond', poi: 'pond', title: 'Visit the koi pond', hint: 'East side of the yard, under the maple.' },
];

export const ZONE_JP: Record<string, string> = { hall: '道場', courtyard: '中庭', ring: '稽古場', storehouse: '蔵', gate: '門', roof: '屋上' };
