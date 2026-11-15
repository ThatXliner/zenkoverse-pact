import type { Enemy } from '../combat/enemies';

// What an installed Eye adds to a fight: what its bearer sees, drawn every
// frame on this screen only, and the rules that follow from seeing it.
export interface Sight {
  update(dt: number): void;
  // How much harder a blow this player lands on `e` hits, and whether it
  // must stagger. Asked before the blow lands.
  dealt?(e: Enemy): { mult: number; stagger?: boolean };
  // After a blow of `amount` landed on `e`.
  landed?(e: Enemy, amount: number): void;
  dispose(): void;
}

export const NO_EFFECT = { mult: 1 };

// The bodies an Eye reads: every living one near the bearer.
export const near = (all: Enemy[], at: { distanceTo(v: Enemy['position']): number }, range: number): Enemy[] =>
  all.filter((e) => e.alive && !e.disposed && at.distanceTo(e.position) < range);
