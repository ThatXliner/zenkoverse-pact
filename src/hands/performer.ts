import * as THREE from 'three';
import { FINGERS, POSES, mirror, type HandPose, type Finger, type PoseName } from './poses';
import { resolvePose, type Gesture, type GestureKey } from './gestures';

// One gesture played over time: the first-person hands and every
// third-person body read their keys through this, so a cast is the same
// choreography whoever performs it.
export class GestureClock {
  gesture: Gesture | null = null;
  t = 0;
  private key = -1;
  private speed = 1;

  play(g: Gesture, speed: number): void { this.gesture = g; this.t = 0; this.key = -1; this.speed = speed; }
  stop(): void { this.gesture = null; }

  // Advances by `dt`, handing each key reached to `onKey`. True when a
  // gesture that does not hold has run out (the clock is then stopped).
  advance(dt: number, onKey: (k: GestureKey) => void): boolean {
    const g = this.gesture;
    if (!g) return false;
    this.t += dt * this.speed;
    while (this.key + 1 < g.keys.length && g.keys[this.key + 1]!.t <= this.t) {
      onKey(g.keys[++this.key]!);
      // A key's handler may have stopped or replaced the gesture.
      if (this.gesture !== g) return false;
    }
    if (this.t >= g.duration && !g.hold) { this.gesture = null; return true; }
    return false;
  }
}

// A hand driven toward its target pose by a spring. `snap` keys are stiff and
// underdamped, which gives the anticipation-then-overshoot read of key
// animation instead of a tween; `slow` keys are soft. Positions and
// rotations are in the pose space of src/hands/poses.ts.
export interface HandSpring {
  side: 1 | -1;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rot: THREE.Quaternion;
  rotVel: THREE.Vector3;
  curl: Record<Finger, [number, number, number]>;
  spread: number;
  targetPose: HandPose;
  stiffness: number;
  damping: number;
}

export function handSpring(side: 1 | -1, pose: HandPose): HandSpring {
  const p = side === 1 ? pose : mirror(pose);
  return {
    side, pos: new THREE.Vector3(...p.pos), vel: new THREE.Vector3(),
    rot: new THREE.Quaternion().setFromEuler(new THREE.Euler(...p.rot, 'YXZ')), rotVel: new THREE.Vector3(),
    curl: structuredClone(p.fingers) as HandSpring['curl'], spread: p.spread,
    targetPose: p, stiffness: 140, damping: 18,
  };
}

// Points the spring at a key's pose for this hand. A key that leaves a hand
// out keeps that hand on its last pose with the key's spring.
export function aimSpring(h: HandSpring, key: GestureKey, table: Record<PoseName, HandPose> = POSES): void {
  const named = h.side === 1 ? key.right : key.left;
  const pose = resolvePose(named, h.targetPose, table);
  h.targetPose = h.side === 1 || typeof named !== 'string' ? pose : mirror(pose);
  h.stiffness = key.snap ? 520 : key.slow ? 60 : 180;
  h.damping = key.snap ? 16 : key.slow ? 14 : 20;
}

export function poseSpring(h: HandSpring, pose: HandPose, stiffness: number, damping: number): void {
  h.targetPose = h.side === 1 ? pose : mirror(pose);
  h.stiffness = stiffness;
  h.damping = damping;
}

// Steps the spring toward `target` and `targetRot`; the fingers ease toward
// the target pose's curls.
export function stepSpring(h: HandSpring, target: THREE.Vector3, targetRot: THREE.Quaternion, dt: number): void {
  const acc = target.clone().sub(h.pos).multiplyScalar(h.stiffness).addScaledVector(h.vel, -h.damping);
  h.vel.addScaledVector(acc, dt);
  h.pos.addScaledVector(h.vel, dt);
  const err = new THREE.Quaternion().copy(h.rot).invert().multiply(targetRot);
  const axis = new THREE.Vector3(err.x, err.y, err.z);
  const angle = 2 * Math.atan2(axis.length(), err.w);
  if (axis.lengthSq() > 1e-9) axis.normalize().multiplyScalar(angle > Math.PI ? angle - 2 * Math.PI : angle);
  h.rotVel.addScaledVector(axis.multiplyScalar(h.stiffness * 0.9).addScaledVector(h.rotVel, -h.damping), dt);
  if (h.rotVel.lengthSq() > 1e-10) h.rot.multiply(new THREE.Quaternion().setFromAxisAngle(h.rotVel.clone().normalize(), h.rotVel.length() * dt)).normalize();
  const tp = h.targetPose;
  const curlRate = h.stiffness > 300 ? 40 : 16;
  for (const f of FINGERS) for (let j = 0; j < 3; j++) h.curl[f][j] = THREE.MathUtils.lerp(h.curl[f][j]!, tp.fingers[f][j]!, 1 - Math.exp(-curlRate * dt));
  h.spread = THREE.MathUtils.lerp(h.spread, tp.spread, 1 - Math.exp(-14 * dt));
}
