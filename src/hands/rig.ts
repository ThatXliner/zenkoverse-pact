import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FINGERS, type Finger } from './poses';

export type Side = 'l' | 'r';
const UP = new THREE.Vector3(0, 1, 0);

// Quaternion of the frame that looks along `f` with `u` as its up. Canonical
// frame: forward is -Z, up is +Y. `u` only has to be non-parallel to `f`.
export function frameQuat(f: THREE.Vector3, u: THREE.Vector3): THREE.Quaternion {
  const z = f.clone().normalize().negate();
  const x = new THREE.Vector3().crossVectors(u, z).normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

// A bone with the frame it had at rest, so a target frame maps onto it
// whatever axes the file gave the bone.
interface Aimed { bone: THREE.Bone; rest: THREE.Quaternion; frameInv: THREE.Quaternion }
interface FingerJoint { bone: THREE.Bone; rest: THREE.Quaternion; curl: THREE.Vector3; spread: THREE.Vector3 }

export interface Arm {
  side: Side;
  clavicle: Aimed;
  upper: Aimed;
  fore: Aimed;
  hand: Aimed;
  clavicleRoot: THREE.Vector3;
  clavicleLen: number;
  shoulder: THREE.Vector3;
  upperLen: number;
  foreLen: number;
  parentRest: THREE.Quaternion;
  fingers: Record<Finger, FingerJoint[]>;
  tips: Record<Finger, THREE.Bone>;
}

export interface ArmTarget {
  wrist: THREE.Vector3;
  hand: THREE.Quaternion;
  curl: Record<Finger, [number, number, number]>;
  spread: number;
  twitch?: { finger: Finger; amount: number };
}

const MAX_CURL: Record<'finger' | 'thumb', [number, number, number]> = { finger: [1.5, 1.65, 0.95], thumb: [0.55, 0.95, 1.0] };
const SPREAD: Record<Finger, number> = { thumb: 0, index: -1, middle: -0.2, ring: 0.5, pinky: 1.2 };
// Fraction of the hand's roll the forearm takes, standing in for pronation.
const FOREARM_TWIST = 0.55;

// First-person arm rig loaded from human.glb: the Arms mesh (skin and sleeve)
// on the shared skeleton. Everything is calibrated from the T-pose, so the
// solver never assumes which local axis a bone points along.
export class ArmRig {
  readonly object: THREE.Object3D;
  readonly eye = new THREE.Vector3();
  readonly arms: Record<Side, Arm>;
  readonly skinMeshes: THREE.SkinnedMesh[] = [];
  readonly sleeveMeshes: THREE.SkinnedMesh[] = [];

  constructor(gltf: GLTF) {
    this.object = cloneSkeleton(gltf.scene);
    const bones = new Map<string, THREE.Bone>();
    const drop: THREE.Object3D[] = [];
    const extras = gltf.userData as { eye?: [number, number, number] };
    if (!extras.eye) throw new Error('human.glb lacks the eye position in its extras');
    this.eye.fromArray(extras.eye);
    this.object.traverse((o) => {
      if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone);
      if (/^(Body|Eyes|Eyebrows|Hair_)/.test(o.name)) drop.push(o);
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh || o.parent?.name !== 'Arms') return;
      m.frustumCulled = false;
      m.castShadow = false;
      m.receiveShadow = false;
      ((m.material as THREE.Material).name === 'Suit' ? this.sleeveMeshes : this.skinMeshes).push(m);
    });
    for (const o of drop) o.removeFromParent();
    this.object.updateMatrixWorld(true);

    const b = (n: string): THREE.Bone => { const x = bones.get(n); if (!x) throw new Error(`human.glb lacks bone ${n}`); return x; };
    const pos = (n: string) => b(n).getWorldPosition(new THREE.Vector3());
    const quat = (n: string) => b(n).getWorldQuaternion(new THREE.Quaternion());
    const aimed = (n: string, f: THREE.Vector3, u: THREE.Vector3): Aimed => ({ bone: b(n), rest: quat(n), frameInv: frameQuat(f, u).invert() });

    const calibrate = (side: Side): Arm => {
      const clavicleRoot = pos(`clavicle_${side}`), shoulder = pos(`upperarm_${side}`), elbow = pos(`lowerarm_${side}`), wrist = pos(`hand_${side}`);
      const knuckle = pos(`middle_01_${side}`), index = pos(`index_01_${side}`), pinky = pos(`pinky_01_${side}`), thumb = pos(`thumb_01_${side}`);
      const fingerDir = knuckle.clone().sub(wrist).normalize();
      const across = pinky.clone().sub(index).normalize();
      const palm = new THREE.Vector3().crossVectors(fingerDir, across).normalize();
      if (palm.dot(thumb.clone().sub(wrist)) < 0) palm.negate();
      // T-pose, palms down: the elbows point backward.
      const elbowOut = new THREE.Vector3(0, 0, -1);
      const fingers = {} as Record<Finger, FingerJoint[]>;
      const tips = {} as Record<Finger, THREE.Bone>;
      for (const f of FINGERS) {
        const names = [1, 2, 3].map((i) => `${f}_0${i}_${side}`);
        const leaf = `${f}_04_leaf_${side}`;
        const dir = pos(leaf).sub(pos(names[0]!)).normalize();
        const curlWorld = f === 'thumb' ? new THREE.Vector3().crossVectors(dir, pinky.clone().sub(pos(names[0]!))).normalize() : new THREE.Vector3().crossVectors(dir, palm).normalize();
        const spreadWorld = new THREE.Vector3().crossVectors(dir, across).normalize();
        fingers[f] = names.map((n) => {
          const inv = quat(n).invert();
          return { bone: b(n), rest: b(n).quaternion.clone(), curl: curlWorld.clone().applyQuaternion(inv), spread: spreadWorld.clone().applyQuaternion(inv) };
        });
        tips[f] = b(leaf);
      }
      return {
        side,
        clavicle: aimed(`clavicle_${side}`, shoulder.clone().sub(clavicleRoot), UP),
        upper: aimed(`upperarm_${side}`, elbow.clone().sub(shoulder), elbowOut),
        fore: aimed(`lowerarm_${side}`, wrist.clone().sub(elbow), elbowOut),
        hand: aimed(`hand_${side}`, fingerDir, palm.clone().negate()),
        clavicleRoot, clavicleLen: shoulder.distanceTo(clavicleRoot), shoulder,
        upperLen: elbow.distanceTo(shoulder), foreLen: wrist.distanceTo(elbow),
        parentRest: quat('spine_03'),
        fingers, tips,
      };
    };
    this.arms = { l: calibrate('l'), r: calibrate('r') };
  }

  // Poses one arm so the wrist reaches `t.wrist` with the hand oriented by
  // `t.hand`, both in the rig's model space (character faces +Z).
  solve(arm: Arm, t: ArmTarget): void {
    const out = arm.side === 'r' ? -1 : 1;
    const aim = (a: Aimed, f: THREE.Vector3, u: THREE.Vector3, parent: THREE.Quaternion): THREE.Quaternion => {
      const world = frameQuat(f, u).multiply(a.frameInv).multiply(a.rest);
      a.bone.quaternion.copy(parent).invert().multiply(world);
      return world;
    };

    // The clavicle follows a long reach so the shoulder comes with the arm.
    const toTarget = t.wrist.clone().sub(arm.clavicleRoot);
    const reach = THREE.MathUtils.clamp((t.wrist.distanceTo(arm.shoulder) - 0.34) / 0.16, 0, 1);
    const lift = THREE.MathUtils.clamp((t.wrist.y - arm.shoulder.y) / 0.3, -0.3, 1);
    const clavDir = arm.shoulder.clone().sub(arm.clavicleRoot).normalize().lerp(toTarget.normalize(), 0.3 * reach).add(new THREE.Vector3(0, 0.25 * Math.max(0, lift), 0)).normalize();
    const clavQ = aim(arm.clavicle, clavDir, UP, arm.parentRest);
    const shoulder = arm.clavicleRoot.clone().addScaledVector(clavDir, arm.clavicleLen);

    // Two-bone IK with the elbow pushed out, down and back.
    const d = THREE.MathUtils.clamp(t.wrist.distanceTo(shoulder), 0.05, arm.upperLen + arm.foreLen - 0.004);
    const dir = t.wrist.clone().sub(shoulder).normalize();
    const cosA = (arm.upperLen ** 2 + d * d - arm.foreLen ** 2) / (2 * arm.upperLen * d);
    const a = Math.acos(THREE.MathUtils.clamp(cosA, -1, 1));
    const hint = new THREE.Vector3(out * 0.8, -1, -0.3).normalize();
    const bend = hint.clone().addScaledVector(dir, -hint.dot(dir));
    if (bend.lengthSq() < 1e-6) bend.set(out, 0, 0);
    bend.normalize();
    const elbow = shoulder.clone().addScaledVector(dir, Math.cos(a) * arm.upperLen).addScaledVector(bend, Math.sin(a) * arm.upperLen);
    const upperQ = aim(arm.upper, elbow.clone().sub(shoulder), bend, clavQ);

    const handWorld = t.hand.clone().multiply(arm.hand.frameInv).multiply(arm.hand.rest);
    const handUp = UP.clone().applyQuaternion(t.hand);
    const foreAxis = t.wrist.clone().sub(elbow).normalize();
    const handUpPerp = handUp.clone().addScaledVector(foreAxis, -handUp.dot(foreAxis));
    const foreUp = bend.clone().lerp(handUpPerp, handUpPerp.lengthSq() > 0.05 ? FOREARM_TWIST : 0);
    if (foreUp.lengthSq() < 1e-4) foreUp.copy(bend);
    const foreQ = aim(arm.fore, t.wrist.clone().sub(elbow), foreUp, upperQ);
    arm.hand.bone.quaternion.copy(foreQ).invert().multiply(handWorld);

    for (const f of FINGERS) {
      const max = MAX_CURL[f === 'thumb' ? 'thumb' : 'finger'];
      const twitch = t.twitch?.finger === f ? t.twitch.amount : 0;
      arm.fingers[f].forEach((j, i) => {
        const angle = THREE.MathUtils.clamp(t.curl[f][i]! + twitch, 0, 1.15) * max[i]!;
        j.bone.quaternion.copy(j.rest).multiply(new THREE.Quaternion().setFromAxisAngle(j.curl, angle));
        if (i === 0 && f !== 'thumb') j.bone.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(j.spread, SPREAD[f] * t.spread * 0.3));
      });
    }
  }
}
