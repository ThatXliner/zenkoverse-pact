import * as THREE from 'three';
import type { Gesture } from '../hands/gestures';
import type { MarkShape } from '../techniques/mark';
import { MOVES } from './moves';

// Every melee blow an enemy throws, by role (issue #11). Each one is read the
// same way, in the order Sifu and Sekiro teach it: the arms chamber and a
// mark rules the area it covers on the ground; a sweep crosses the mark as the
// wind-up runs; a glint at the head marks the moment the attacker commits and
// stops turning to follow; the blow lands as the sweep reaches the edge.
// The mark is the hit test, so stepping out of it always works.
export interface AttackDef {
  move: Gesture;
  // Seconds from the first frame of the wind-up to the blow.
  windup: number;
  // How far into the wind-up the attacker stops tracking the player (the glint).
  commit: number;
  shape: MarkShape;
  // How far ahead of the feet the shape is centred (a slam lands in front).
  offset?: number;
  // The blow's damage, as a multiple of the role's.
  dmg: number;
  // Metres the body travels with the blow (a lunge).
  lunge?: number;
  // A ground-shaking blow: debris and a dust ring where it lands, a held frame on a hit.
  heavy?: boolean;
  recover: number;
  pitch: number;
  // The Master's blow comes again from where it was thrown, `delay` seconds later.
  echo?: { delay: number; dmg: number };
}

const JAB: AttackDef = { move: MOVES.jab, windup: 0.45, commit: 0.6, shape: { kind: 'sector', radius: 2.3, arc: 0.75 }, dmg: 1, recover: 0.55, pitch: 1 };
const SLAM: AttackDef = { move: MOVES.slam, windup: 0.72, commit: 0.55, shape: { kind: 'sector', radius: 1.7, arc: Math.PI }, offset: 1.2, dmg: 1.35, heavy: true, recover: 0.85, pitch: 0.75 };

export const ATTACKS: Record<string, AttackDef> = {
  thug: JAB,
  bruiser: SLAM,
  husk: { ...SLAM, windup: 0.82, shape: { kind: 'sector', radius: 1.9, arc: Math.PI }, offset: 1.3, recover: 1 },
  runner: { move: MOVES.jab, windup: 0.38, commit: 0.5, shape: { kind: 'rect', length: 4.6, width: 1.1 }, dmg: 1, lunge: 3.4, recover: 0.65, pitch: 1.15 },
  kuroda: { ...JAB, windup: 0.42 },
  ancient: { move: MOVES.palm, windup: 0.8, commit: 0.55, shape: { kind: 'sector', radius: 8, arc: 0.42, inner: 0.08 }, dmg: 1, recover: 1.05, pitch: 0.8, echo: { delay: 0.7, dmg: 0.6 } },
};

// How close the attacker walks before it starts the wind-up.
export function reachOf(a: AttackDef): number {
  const s = a.shape;
  return s.kind === 'rect' ? s.length * 0.6 : (a.offset ?? 0) + s.radius * (a.offset ? 0.3 : 0.75);
}

const fwd = new THREE.Vector3(), right = new THREE.Vector3(), rel = new THREE.Vector3();

// Whether `p` stands inside the attack thrown from `from` facing `yaw`,
// with `pad` metres for the body's width.
export function inAttack(a: AttackDef, from: THREE.Vector3, yaw: number, p: THREE.Vector3, pad = 0.3): boolean {
  fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  right.set(-fwd.z, 0, fwd.x);
  rel.copy(p).sub(from).setY(0).addScaledVector(fwd, -(a.offset ?? 0));
  const s = a.shape;
  if (s.kind === 'rect') {
    const along = rel.dot(fwd);
    return along > -pad && along < s.length + pad && Math.abs(rel.dot(right)) < s.width / 2 + pad;
  }
  const r = rel.length();
  if (r > s.radius + pad) return false;
  if (s.arc >= Math.PI || r < 0.5) return true;
  return Math.acos(THREE.MathUtils.clamp(rel.dot(fwd) / r, -1, 1)) < s.arc + Math.atan(pad / r);
}

// Where the shape lies: the feet, moved forward by the offset.
export function markOrigin(a: AttackDef, from: THREE.Vector3, yaw: number): THREE.Vector3 {
  return from.clone().add(new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)).multiplyScalar(a.offset ?? 0));
}
