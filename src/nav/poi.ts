import * as THREE from 'three';
import { SPAWN } from '../world/district';
import type { TutorialStepId } from '../app/state';

export type PoiId = keyof typeof SPAWN;

// One entry per place worth going to. The compass, the tracked marker, the
// map, the landmark labels, the waypoint shrines, and fast travel all read
// this table, so adding a place means adding a row.
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
  // The waypoint shrine. Standing within UNLOCK_RADIUS of it unlocks fast travel.
  shrine: THREE.Vector3;
  // Fast travel lands on the district spawn point, facing `yaw`.
  arrive: THREE.Vector3;
  yaw: number;
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export const POIS: readonly Poi[] = [
  { id: 'academy', name: 'Academy courtyard', jp: '学院', glyph: '学', blurb: 'Where new Technique holders drill. The crane rig and the training dummies are here.', at: v(-58, 0, -58), label: v(-58, 8, -58), shrine: v(-53.5, 0, -52), arrive: SPAWN.academy, yaw: -Math.PI / 2 },
  { id: 'dojo', name: 'Pact Workshop', jp: '道場', glyph: '道', blurb: 'The Pact Architect inscribes your Pacts here. A dummy room waits at the back.', at: v(-26, 0, -61), label: v(-26, 8.8, -64), shrine: v(-31.8, 0, -57.5), arrive: SPAWN.dojo, yaw: Math.PI },
  { id: 'market', name: 'Market street', jp: '市場', glyph: '市', blurb: 'Neon, stalls and vending machines along the main street of the district.', at: v(-20, 0, 0), label: v(-20, 8.5, 0), shrine: v(-16.5, 0, 3.4), arrive: SPAWN.market, yaw: Math.PI / 2 },
  { id: 'alley', name: 'Back alley', jp: '路地', glyph: '路', blurb: 'Criminal Underworld thugs wait in the dark. Expect a fight.', at: v(21, 0, 31), label: v(21, 8, 23), shrine: v(18, 0, 26), arrive: SPAWN.alley, yaw: 0 },
  { id: 'bridge', name: 'Canal bridge', jp: '橋', glyph: '橋', blurb: 'A steel bridge over the canal. The Ancient Echo Master takes challengers.', at: v(70, 0, 0), label: v(70, 6.5, 0), shrine: v(60, 0, 2.6), arrive: SPAWN.bridge, yaw: -Math.PI / 2 },
  { id: 'kuroda', name: 'Kuroda house', jp: '黒田', glyph: '黒', blurb: 'A lit house behind a warm fence. Their "fire" is fuel.', at: v(52, 0, 56), label: v(52, 7, 52), shrine: v(46, 0, 54), arrive: SPAWN.kuroda, yaw: Math.PI },
  { id: 'rooftop', name: 'Rooftop trial', jp: '屋上試験', glyph: '試', blurb: 'A tower on the far bank of the canal. Ride the lift and begin the trial: eight waves, with a Pact to choose between each.', at: v(83, 0, -28), label: v(84, 12.5, -28), shrine: v(79.5, 0, -33.5), arrive: SPAWN.rooftop, yaw: -Math.PI / 2 },
  { id: 'roof', name: 'Rooftops', jp: '屋上', glyph: '屋', blurb: 'Climb the fire escape on the block north of the market. A lore plaque waits at the top.', at: v(-8, 14.2, -16), label: v(-8, 18, -16), shrine: v(-11, 14.2, -16), arrive: SPAWN.roof, yaw: Math.PI / 2 },
];

export const poiById = (id: PoiId): Poi => POIS.find((p) => p.id === id)!;

export const UNLOCK_RADIUS = 6;
export const ARRIVE_RADIUS = 8;

// The tutorial step is a tracked objective whenever it points at a place.
export const TUTORIAL_TARGETS: Partial<Record<TutorialStepId, { title: string; jp: string; at: THREE.Vector3 } | { poi: PoiId }>> = {
  look: { title: 'Academy drill crane', jp: '起重機', at: v(-62, 6, -60) },
  secondary: { title: 'Crates by the crane', jp: '木箱', at: v(-54, 0, -72) },
  done: { poi: 'dojo' },
};

// The current goal is the first of these whose waypoint is still locked.
export interface Goal { id: string; poi: PoiId; title: string; hint: string }

export const GOALS: readonly Goal[] = [
  { id: 'dojo', poi: 'dojo', title: 'Find the Pact Workshop', hint: 'The Pact Architect keeps the Workshop in the dojo.' },
  { id: 'market', poi: 'market', title: 'Walk the market street', hint: 'The main street runs east to west under the neon.' },
  { id: 'alley', poi: 'alley', title: 'Look into the back alley', hint: 'Thugs wait south of the market.' },
  { id: 'bridge', poi: 'bridge', title: 'Cross the canal bridge', hint: 'The canal runs along the east edge of the district.' },
  { id: 'kuroda', poi: 'kuroda', title: 'Find the Kuroda house', hint: 'It stands in the south-east, behind a fence.' },
  { id: 'rooftop', poi: 'rooftop', title: 'Take the lift to the rooftop trial', hint: 'Cross the canal bridge and follow the bank north to the tower with the lit door.' },
  { id: 'roof', poi: 'roof', title: 'Climb to the rooftops', hint: 'Take the fire escape north of the market.' },
];

export const ZONE_JP: Record<string, string> = { academy: '学院', dojo: '道場', market: '市場', alley: '路地', rooftop: '屋上', bridge: '橋', kuroda: '黒田', canal: '運河' };
