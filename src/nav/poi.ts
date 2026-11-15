import * as THREE from 'three';
import { SPAWN, HALL, STORE, GATE } from '../world/compound';
import { FIELD, FALLS, GROUNDS, GINKGO, TERRACES, SHRINE, STONE_AT, heightAt, tierY } from '../world/valleyPlan';
import type { TutorialStepId } from '../app/state';

export type PoiId = keyof typeof SPAWN;

// One entry per place worth going to, in the compound and the valley round
// it. The compass, the
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
// A point on the valley's ground, lifted by `up`.
const g = (x: number, z: number, up = 0) => new THREE.Vector3(x, heightAt(x, z) + up, z);
const stone = (id: keyof typeof STONE_AT) => g(...STONE_AT[id]);

export const POIS: readonly Poi[] = [
  { id: 'hall', name: 'Training hall', jp: '道場', glyph: '道', blurb: 'The Pact Architect keeps the Workshop at the desk inside. The dummies wait at the back, and the Master takes challengers on the mat.', at: v(3, HALL.floorY, -8), label: v(0, HALL.deckY + 0.5, HALL.z1 + 1.5), shrine: v(-3.2, 0, HALL.z1 + 2.6) },
  { id: 'ring', name: 'Sparring ring', jp: '稽古場', glyph: '稽', blurb: 'A raked sand circle for sparring. Call the partners from the centre.', at: SPAWN.ring.clone(), label: v(SPAWN.ring.x, 3.6, SPAWN.ring.z), shrine: v(SPAWN.ring.x - 1, 0, SPAWN.ring.z + 7.4) },
  { id: 'pond', name: 'Koi pond', jp: '池', glyph: '池', blurb: 'Water for Rime. Freeze it and walk across.', at: v(11, 0, 11), label: v(11, 2.4, 11), shrine: v(11, 0, 16.6) },
  { id: 'roof', name: 'Hall roof', jp: '屋上', glyph: '屋', blurb: 'The stair on the hall\'s west side climbs to the deck. The rooftop trial begins at the board up there, and a plank bridge crosses to the storehouse.', at: v(-6, HALL.deckY, -13), label: v(0, HALL.deckY + 3.2, -12), shrine: v(-16.9, HALL.deckY, -12.3) },
  { id: 'store', name: 'Storehouse roof', jp: '蔵', glyph: '蔵', blurb: 'Across the bridge from the hall roof. From its south edge you can drop to the wall walk.', at: v((STORE.x0 + STORE.x1) / 2, STORE.deckY, (STORE.z0 + STORE.z1) / 2), label: v((STORE.x0 + STORE.x1) / 2, STORE.deckY + 2.6, (STORE.z0 + STORE.z1) / 2), shrine: v(STORE.x0 + 1.4, STORE.deckY, STORE.z1 - 1.4) },
  { id: 'gate', name: 'The gate', jp: '門', glyph: '門', blurb: 'The way out to the valley, its doors open. The Kuroda Enforcer answers a challenge here.', at: v(0, 0, GATE.z0 - 2), label: v(0, GATE.roofY + 1.8, GATE.z0), shrine: v(5.2, 0, 15.4) },
  { id: 'field', name: 'Striking Posts', jp: '巻藁', glyph: '巻', blurb: 'Swept ground beside the road, just out of the gate. Three posts stand round a mark; begin the drill from the mark.', at: g(FIELD.x, FIELD.z), label: g(FIELD.x, FIELD.z, 2.6), shrine: stone('field') },
  { id: 'shrine', name: 'Roadside shrine', jp: '祠', glyph: '祠', blurb: 'Where the road ends under the south cliff: a red torii, a small shrine, two old cedars.', at: g(SHRINE.x, SHRINE.toriiZ + 2), label: v(SHRINE.x, SHRINE.top + 3.2, SHRINE.z), shrine: stone('shrine') },
  { id: 'falls', name: 'The falls', jp: '滝', glyph: '滝', blurb: 'The stream comes over the north cliff here. The path through the north wood ends at the pool.', at: g(FALLS.x, FALLS.z + 4), label: v(FALLS.x, 9, FALLS.z - 3), shrine: stone('falls') },
  { id: 'grounds', name: 'Training ground', jp: '鍛錬場', glyph: '鍛', blurb: 'A cleared circle east of the walls: striking posts, lifting stones, a balance log.', at: g(GROUNDS.x, GROUNDS.z), label: g(GROUNDS.x, GROUNDS.z, 3.4), shrine: stone('grounds') },
  { id: 'ginkgo', name: 'Old ginkgo', jp: '大銀杏', glyph: '杏', blurb: 'The great gold tree on the knoll north-east of the walls, bound with rope.', at: g(GINKGO.x, GINKGO.z), label: g(GINKGO.x, GINKGO.z, 7), shrine: stone('ginkgo') },
  { id: 'terraces', name: 'Rice terraces', jp: '棚田', glyph: '田', blurb: 'Paddies stepping up the west slope. Walk the wide bunds.', at: v(TERRACES.x1 - 4.5, tierY(0), (TERRACES.z0 + TERRACES.z1) / 2), label: v(TERRACES.x1 - 9, tierY(1) + 2.6, (TERRACES.z0 + TERRACES.z1) / 2), shrine: stone('terraces') },
];

export const poiById = (id: PoiId): Poi => POIS.find((p) => p.id === id)!;

export const UNLOCK_RADIUS = 5;
export const ARRIVE_RADIUS = 8;

// The tutorial step is a tracked objective whenever it points at a place.
// These match the tutorial's beacons (src/tutorial/tutorial.ts).
export const TUTORIAL_TARGETS: Partial<Record<TutorialStepId, { title: string; jp: string; at: THREE.Vector3 } | { poi: PoiId }>> = {
  move: { title: 'The gold ring', jp: '標', at: v(1.5, 0, 2.5) },
  clash: { title: 'The listening stone', jp: '気読み', at: v(6, 0, 3.2) },
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
  { id: 'shrine', poi: 'shrine', title: 'Walk the road to the shrine', hint: 'Out of the gate and south, over the red bridge.' },
  { id: 'falls', poi: 'falls', title: 'Find the falls', hint: 'Round the back of the walls and west through the north wood.' },
];

export const ZONE_JP: Record<string, string> = {
  hall: '道場', courtyard: '中庭', ring: '稽古場', storehouse: '蔵', gate: '門', roof: '屋上',
  valley: '谷', field: '巻藁', bridge: '橋', grounds: '鍛錬場', ginkgo: '大銀杏', falls: '滝', terraces: '棚田', meadow: '芒原', shrine: '祠',
};
