import * as THREE from 'three';

// What the ward's people (life.ts, drawn by the region) and the game's fights
// (src/combat/ward.ts) tell each other, in world metres. The game writes the
// fight and the Technique casts it saw; the region writes back where the
// officer is and what he is doing. Plain data, so neither side imports the other.

export type OfficerMode = 'patrol' | 'whistle' | 'approach' | 'watch' | 'return';

export interface StreetFight {
  id: string;
  // Where it is, and how far round it the street gives it room.
  at: THREE.Vector3;
  radius: number;
  // Behind a fence: the officer does not go in.
  private: boolean;
  // Someone watching it from the end of the lane, who leaves when it ends.
  watcher: THREE.Vector3 | null;
}

export const street = {
  fight: null as StreetFight | null,
  // A Technique used in the ward by this player: where, and when (game time).
  casts: [] as { at: THREE.Vector3; time: number }[],
  officer: null as { at: THREE.Vector3; mode: OfficerMode; target: THREE.Vector3 | null } | null,
  // The two men at the Kuroda gate are away from it: in the fight, or down.
  gateEmpty: false,
};

export function noteCast(at: THREE.Vector3, time: number): void {
  street.casts.push({ at: at.clone(), time });
  if (street.casts.length > 8) street.casts.shift();
}

export function clearStreet(): void {
  street.fight = null;
  street.casts.length = 0;
  street.gateEmpty = false;
}
