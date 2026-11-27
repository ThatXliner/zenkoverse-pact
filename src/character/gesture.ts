import * as THREE from 'three';
import { GestureClock, handSpring, aimSpring, poseSpring, stepSpring, type HandSpring } from '../hands/performer';
import { calibrateArms, solveArm, type Arm } from '../hands/rig';
import { FINGERS, POSES, type HandPose, type PoseName } from '../hands/poses';
import type { Gesture } from '../hands/gestures';

// The third-person half of a gesture (issue #46). A body plays the same
// gesture data as the first-person hands: the same keys, springs and poses,
// solved onto its own arms by the same IK, over whatever the locomotion clips
// are doing. Only the arms and the chest take it; the legs keep their stride.
//
// Poses are authored for a camera at the eyes, where a hand has to stay in
// frame. Seen from outside, the same pose reads small, so the body plays a
// bolder cut of it: reach, spread and height from the shoulders are pushed
// out (BODY), the poses the camera cramps are restaged (STAGED), and the
// chest turns into the leading hand and leans with the reach, which gives
// the wind-up and the follow-through a silhouette.

// Pose space (metres from the eyes: x right, y up, -z ahead) to the body's.
// The shoulders sit about here in pose space.
const SHOULDER_Y = -0.27;
const BODY = { spread: 1.35, lift: 1.35, reach: 1.35, drop: -0.03 };

const toBodySpace = (p: readonly number[]): [number, number, number] => [p[0]! * BODY.spread, (p[1]! - SHOULDER_Y) * BODY.lift + SHOULDER_Y + BODY.drop, p[2]! * BODY.reach];
const toPoseSpace = (p: readonly number[]): [number, number, number] => [p[0]! / BODY.spread, (p[1]! - BODY.drop - SHOULDER_Y) / BODY.lift + SHOULDER_Y, p[2]! / BODY.reach];

// Where the body puts the hands for the poses the first-person camera
// cramps, in the body's own metres from the eyes (shoulders at about
// x ±0.17, y -0.27; an arm reaches 0.48). Seen from outside, a fist drives
// out level from the shoulder and a chambered one draws back to the ribs; a
// seal sits at the sternum, not at arm's length; a slam goes up overhead and
// down past the knee; claws and spreads open wide of the body; and at rest
// the hands hang where the idle clip holds them, so a gesture hands back to
// the clip without a swing.
const STAGED: Partial<Record<PoseName, { pos: [number, number, number]; rot?: [number, number, number] }>> = {
  rest: { pos: [0.27, -0.66, -0.06], rot: [-1.3, -0.3, 0.3] },
  restLow: { pos: [0.27, -0.68, -0.04], rot: [-1.35, -0.3, 0.3] },
  chamber: { pos: [0.24, -0.58, 0.06] },
  punch: { pos: [0.07, -0.3, -0.78] },
  punchOver: { pos: [0.03, -0.29, -0.82] },
  guard: { pos: [0.2, -0.22, -0.34] },
  slamUp: { pos: [0.26, 0.28, -0.05] },
  slamDown: { pos: [0.32, -1.0, -0.5] },
  clawReady: { pos: [0.48, -0.36, -0.3] },
  clawReach: { pos: [0.12, -0.26, -0.8] },
  cupFlinch: { pos: [0.42, 0.02, -0.34] },
  snapReady: { pos: [0.4, -0.08, -0.22] },
  snapped: { pos: [0.44, -0.04, -0.3] },
  quietSpread: { pos: [0.6, -0.36, -0.22] },
  palmSurface: { pos: [0.16, -0.6, -0.5] },
  palmPress: { pos: [0.14, -0.78, -0.56] },
  sealGather: { pos: [0.3, -0.6, -0.2] },
  seal: { pos: [0.03, -0.26, -0.3] },
  kuji: { pos: [0.03, -0.22, -0.3] },
  fistToPalm: { pos: [0.05, -0.25, -0.32] },
  veilEyes: { pos: [0.08, -0.04, -0.22] },
  emberCup: { pos: [0.24, -0.46, -0.24] },
  seize: { pos: [0.09, -0.18, -0.8] },
  crossBlock: { pos: [-0.05, 0.0, -0.36] },
  kilnRaise: { pos: [0.58, -0.14, -0.18] },
  twinPalm: { pos: [0.07, -0.26, -0.78] },
  sealRubUp: { pos: [0.03, -0.22, -0.3] },
  sealRubDown: { pos: [0.03, -0.31, -0.3] },
  threadPinch: { pos: [0.22, -0.3, -0.32] },
  threadWind: { pos: [0.34, -0.12, 0.02] },
  threadCast: { pos: [0.1, -0.24, -0.82] },
  drawFront: { pos: [0.08, -0.22, -0.8] },
  drawBack: { pos: [0.3, -0.18, 0.08] },
  drawRelease: { pos: [0.5, -0.12, 0.18] },
  slackDrop: { pos: [0.34, -0.62, -0.4] },
  cradle: { pos: [0.1, -0.3, -0.36] },
  cradleWide: { pos: [0.5, -0.28, -0.32] },
  drawYank: { pos: [0.28, -0.56, 0.08] },
  spearDraw: { pos: [0.36, 0.04, -0.06] },
  spear: { pos: [0.05, -0.28, -0.82] },
  catchPalm: { pos: [0.12, -0.24, -0.72] },
  groundPalm: { pos: [0.44, -0.8, 0.02] },
  gripOpen: { pos: [0.62, -0.12, -0.24] },
  gripDown: { pos: [0.46, -0.66, -0.12] },
  tent: { pos: [0.03, -0.32, -0.34] },
  arcSpread: { pos: [0.66, -0.22, -0.3] },
};
const BODY_POSES = Object.fromEntries(Object.entries(POSES).map(([name, pose]) => {
  const st = STAGED[name as PoseName];
  return [name, st ? { ...pose, pos: toPoseSpace(st.pos), rot: st.rot ?? pose.rot } : pose];
})) as Record<PoseName, HandPose>;
// Chest turn per metre of reach one hand has over the other, and lean per
// metre of reach past a relaxed guard, in radians.
const TWIST = { perMetre: 2.2, max: 0.75 };
const LEAN = { perMetre: 1.2, guard: 0.4, low: 1.0, max: 0.45 };
const UP = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);
// How much of the aim pitch the spine takes (Avatar.update), which the arms follow.
const AIM_SPINE = 0.55;

type BodyHand = HandSpring & { arm: Arm };

export class BodyGesture {
  private clock = new GestureClock();
  private hands: BodyHand[];
  private chain: { bone: THREE.Bone; clip: THREE.Quaternion }[] = [];
  private weight = 0;
  private want = 0;
  // How far the chest is turned and leaned, eased so a snap still carries the body.
  private twist = 0;
  private lean = 0;
  private wrote = false;
  private chest: THREE.Bone;
  // The chest at calibration, and the point the body turns about, in root space.
  private chestRest: THREE.Matrix4;
  private pivot: THREE.Vector3;

  // `bones` stand in the T-pose with their matrices current, in the space
  // of the avatar's root; `eye` is in that space too; `scale` is the body's
  // height against the 1.78 m the poses were authored for.
  constructor(bones: Map<string, THREE.Bone>, private eye: THREE.Vector3, private scale: number) {
    const arms = calibrateArms(bones);
    this.chest = bones.get('spine_03')!;
    this.chestRest = this.chest.matrixWorld.clone();
    this.pivot = bones.get('spine_01')!.getWorldPosition(new THREE.Vector3());
    this.hands = [{ ...handSpring(1, BODY_POSES.rest), arm: arms.r }, { ...handSpring(-1, BODY_POSES.rest), arm: arms.l }];
    for (const h of this.hands) {
      const a = h.arm;
      for (const b of [a.clavicle.bone, a.upper.bone, a.fore.bone, a.hand.bone, ...FINGERS.flatMap((f) => a.fingers[f].map((j) => j.bone))]) this.chain.push({ bone: b, clip: new THREE.Quaternion() });
    }
  }

  // Starts a gesture. The hands set off from where the arms are now, so the
  // first key is reached, not cut to.
  play(g: Gesture, speed: number, root: THREE.Object3D): void {
    const wasIdle = this.weight < 0.05;
    this.clock.play(g, speed);
    this.want = 1;
    if (!wasIdle) return;
    const inv = root.matrixWorld.clone().invert();
    for (const h of this.hands) {
      h.arm.hand.bone.getWorldPosition(h.pos).applyMatrix4(inv);
      this.toPose(h.pos);
      h.vel.set(0, 0, 0);
      h.rotVel.set(0, 0, 0);
      poseSpring(h, BODY_POSES.rest, 180, 20);
    }
  }

  // Lets go of the gesture (or only of `only`, if that is the one playing):
  // the arms ease back to the clips.
  release(only?: Gesture): void {
    if (only && this.clock.gesture !== only) return;
    this.clock.stop();
    this.want = 0;
  }
  get playing(): boolean { return this.clock.gesture !== null; }
  get active(): boolean { return this.weight > 0.002; }

  // Runs after the mixer has posed the body. `turn` rotates a bone about a
  // world axis on top of its pose; `right` is the body's right in the world;
  // `pitch` is the aim pitch the spine already bends by.
  apply(dt: number, root: THREE.Object3D, turn: (bone: string, axis: THREE.Vector3, angle: number) => void, right: THREE.Vector3, pitch: number): void {
    if (this.clock.advance(dt, (key) => { for (const h of this.hands) aimSpring(h, key, BODY_POSES); })) this.want = 0;
    this.weight += (this.want - this.weight) * (1 - Math.exp(-(this.want > this.weight ? 16 : 7) * dt));
    if (!this.active) { this.weight = this.want; this.twist = this.lean = 0; return; }
    const w = this.weight;
    const target = new THREE.Vector3(), q = new THREE.Quaternion();
    for (const h of this.hands) {
      const tp = h.targetPose;
      stepSpring(h, target.set(...tp.pos), q.setFromEuler(new THREE.Euler(...tp.rot, 'YXZ')), dt);
    }

    // The chest: turned toward whichever hand reaches further, leaned in by
    // the reach and down over a hand driven low, back under hands held high.
    const [r, l] = this.hands as [BodyHand, BodyHand];
    const reachR = -r.pos.z, reachL = -l.pos.z;
    const wantTwist = THREE.MathUtils.clamp((reachR - reachL) * TWIST.perMetre, -TWIST.max, TWIST.max);
    const low = Math.max(0, -0.32 - Math.min(r.pos.y, l.pos.y));
    const high = Math.max(0, Math.max(r.pos.y, l.pos.y) + 0.05);
    const wantLean = THREE.MathUtils.clamp((Math.max(reachR, reachL) - LEAN.guard) * LEAN.perMetre + low * LEAN.low - high * 0.6, -0.2, LEAN.max);
    const ease = 1 - Math.exp(-14 * dt);
    this.twist += (wantTwist - this.twist) * ease;
    this.lean += (wantLean - this.lean) * ease;
    for (const s of ['spine_01', 'spine_02', 'spine_03']) {
      turn(s, UP, this.twist * w / 3);
      // Negative about the right axis leans forward.
      turn(s, right, -this.lean * w / 3);
    }
    turn('Head', UP, -this.twist * w * 0.6);
    turn('Head', right, this.lean * w * 0.5);

    // The hands are placed against the root, not the chest: the clips hunch
    // and sway the chest, and a seal built on it would sink to the belt. The
    // turn, the lean and the aim carry them explicitly, about the waist. The
    // solver works against the chest it was calibrated on, so the targets
    // are moved from the chest as it stands to that one.
    const lead = new THREE.Quaternion().setFromAxisAngle(UP, this.twist * w).multiply(new THREE.Quaternion().setFromAxisAngle(X, (-this.lean + pitch * AIM_SPINE) * w));
    const chestNow = root.matrixWorld.clone().invert().multiply(this.chest.matrixWorld);
    const toRest = this.chestRest.clone().multiply(chestNow.invert());
    const toRestQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(toRest));
    for (const c of this.chain) c.clip.copy(c.bone.quaternion);
    for (const h of this.hands) {
      const wrist = this.toBody(h.pos.clone()).sub(this.pivot).applyQuaternion(lead).add(this.pivot).applyMatrix4(toRest);
      solveArm(h.arm, { wrist, hand: toRestQ.clone().multiply(lead).multiply(h.rot), curl: h.curl, spread: h.spread });
    }
    if (w < 0.999) for (const c of this.chain) c.bone.quaternion.slerpQuaternions(c.clip, c.bone.quaternion.clone(), w);
    for (const h of this.hands) h.arm.clavicle.bone.updateMatrixWorld(true);
    this.wrote = true;
  }

  // The mixer only writes a bone whose blended value changed, so before it
  // runs, the arms get back the clip pose it wrote last frame.
  restore(): void {
    if (!this.wrote) return;
    for (const c of this.chain) c.bone.quaternion.copy(c.clip);
    this.wrote = false;
  }

  private toBody(p: THREE.Vector3): THREE.Vector3 {
    return p.fromArray(toBodySpace(p.toArray())).multiplyScalar(this.scale).add(this.eye);
  }

  private toPose(p: THREE.Vector3): THREE.Vector3 {
    return p.fromArray(toPoseSpace(p.sub(this.eye).divideScalar(this.scale).toArray()));
  }
}
