import * as THREE from 'three';

// The physical layer under every body: springs for the weight a clip cannot
// know about (leaning into a start, banking into a turn, sinking into a
// landing, rocking back from a blow) and legs that plant their feet, so the
// body can be moved by all of that while the feet stay where they landed.

// A damped spring toward a target. `freq` is the natural frequency in
// radians per second; `damp` 1 settles without overshoot, below it rocks.
export class Spring {
  x = 0;
  v = 0;
  constructor(public freq: number, public damp: number) {}

  step(target: number, dt: number): number {
    // Sub-stepped, so a slow frame never sends a stiff spring unstable.
    const n = Math.max(1, Math.ceil((dt * this.freq) / 0.5));
    const h = dt / n, w = this.freq;
    for (let i = 0; i < n; i++) {
      this.v += (-2 * this.damp * w * this.v - w * w * (this.x - target)) * h;
      this.x += this.v * h;
    }
    return this.x;
  }

  kick(dv: number): void { this.v += dv; }
  reset(): void { this.x = 0; this.v = 0; }
}

const tmpQ = new THREE.Quaternion();
const tmpA = new THREE.Vector3();

// Turns an object about a world-space axis through its own origin.
export function turnWorld(o: THREE.Object3D, axisWorld: THREE.Vector3, angle: number): void {
  if (!o.parent || !Number.isFinite(angle) || Math.abs(angle) < 1e-6) return;
  const axis = tmpA.copy(axisWorld).applyQuaternion(o.parent.getWorldQuaternion(tmpQ).invert()).normalize();
  o.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
  o.updateMatrixWorld(true);
}

const angleBetween = (a: THREE.Vector3, b: THREE.Vector3): number => Math.acos(THREE.MathUtils.clamp(a.dot(b) / (a.length() * b.length() || 1), -1, 1));

// Analytic two-bone IK: turns the hip and the knee so the ankle reaches
// `target`, bending in the plane the leg already bends in.
export function solveTwoBone(hip: THREE.Bone, knee: THREE.Bone, ankle: THREE.Bone, target: THREE.Vector3, bendHint: THREE.Vector3): void {
  const a = hip.getWorldPosition(new THREE.Vector3());
  const b = knee.getWorldPosition(new THREE.Vector3());
  const c = ankle.getWorldPosition(new THREE.Vector3());
  const lab = b.distanceTo(a), lcb = c.distanceTo(b);
  const lat = THREE.MathUtils.clamp(target.distanceTo(a), Math.abs(lab - lcb) + 1e-3, (lab + lcb) * 0.999);
  const ac = c.clone().sub(a), ab = b.clone().sub(a);
  const acab0 = angleBetween(ac, ab);
  const babc0 = angleBetween(a.clone().sub(b), c.clone().sub(b));
  const acab1 = Math.acos(THREE.MathUtils.clamp((lcb * lcb - lab * lab - lat * lat) / (-2 * lab * lat), -1, 1));
  const babc1 = Math.acos(THREE.MathUtils.clamp((lat * lat - lab * lab - lcb * lcb) / (-2 * lab * lcb), -1, 1));
  const axis0 = ac.clone().cross(ab);
  if (axis0.lengthSq() < 1e-8) axis0.copy(bendHint);
  axis0.normalize();
  turnWorld(hip, axis0, acab1 - acab0);
  turnWorld(knee, axis0, babc1 - babc0);
  const c2 = ankle.getWorldPosition(new THREE.Vector3()).sub(a);
  const at = target.clone().sub(a);
  const axis1 = c2.clone().cross(at);
  if (axis1.lengthSq() > 1e-10) turnWorld(hip, axis1.normalize(), angleBetween(c2, at));
}

// How a leg plants. Heights and distances are for a body 1.78 m tall and
// scale with the body.
const PLANT = {
  // Above its standing height, a heel or ball within `enter` touches down
  // and one past `leave` has lifted.
  enter: 0.03, leave: 0.05,
  // A planted foot the body has carried this far from where the clip would
  // put it steps to catch up; `hard` is how far it waits while the other
  // foot is mid-step.
  soft: 0.2, hard: 0.42,
  // A catch-up step: its length in seconds and the lift at its middle.
  step: 0.13, lift: 0.07,
};

type Contact = 'heel' | 'ball';

// One leg. While the clip has a foot on the ground, whichever part of it is
// down (the heel at a walk, the ball at a sprint) stays where it touched,
// and the clip's own roll from heel to toe plays about it. The leg carries
// that as an offset from the clip's ankle; when the body has carried the two
// too far apart, the foot steps to catch up.
export class Leg {
  private anim = new THREE.Vector3();
  private ballAnim = new THREE.Vector3();
  private animQ = new THREE.Quaternion();
  private offset = new THREE.Vector3();
  private contact: Contact | null = null;
  private prevC = new THREE.Vector3();
  private stepFrom = new THREE.Vector3();
  private stepT = -1;
  private lift = 0;
  private weight = 0;
  private target = new THREE.Vector3();

  constructor(readonly hip: THREE.Bone, readonly knee: THREE.Bone, readonly ankle: THREE.Bone, private ball: THREE.Bone, private heelY: number, private ballY: number, private k: number) {}

  get stepping(): boolean { return this.stepT >= 0; }

  // Reads the clip's pose. Call after the clip and the hip turn, before
  // anything that moves the body over its feet.
  sample(groundY: number, canPlant: boolean, otherStepping: boolean, dt: number): void {
    this.ankle.getWorldPosition(this.anim);
    this.ankle.getWorldQuaternion(this.animQ);
    this.ball.getWorldPosition(this.ballAnim);
    const thr = (this.contact ? PLANT.leave : PLANT.enter) * this.k;
    const hHeel = this.anim.y - groundY - this.heelY, hBall = this.ballAnim.y - groundY - this.ballY;
    const down = canPlant && !this.stepping && Math.min(hHeel, hBall) < thr;
    if (down) {
      const kind: Contact = hBall < hHeel ? 'ball' : 'heel';
      const c = kind === 'ball' ? this.ballAnim : this.anim;
      // The part on the ground stays put: whatever the clip and the body
      // move it by goes into the offset that cancels it.
      if (this.contact === kind) { this.offset.x -= c.x - this.prevC.x; this.offset.z -= c.z - this.prevC.z; }
      this.contact = kind;
      this.prevC.copy(c);
      const drift = Math.hypot(this.offset.x, this.offset.z);
      if (drift > (otherStepping ? PLANT.hard : PLANT.soft) * this.k) this.beginStep(true);
    } else if (this.contact) this.beginStep(false);
    if (this.stepping) {
      this.stepT += dt;
      const u = Math.min(1, this.stepT / PLANT.step);
      const e = u * u * (3 - 2 * u);
      this.offset.copy(this.stepFrom).multiplyScalar(1 - e);
      this.lift = Math.sin(Math.PI * u) * this.liftHeight;
      if (u >= 1) { this.stepT = -1; this.offset.set(0, 0, 0); this.lift = 0; }
    }
    if (!canPlant) { this.offset.set(0, 0, 0); this.contact = null; this.stepT = -1; this.lift = 0; }
    this.target.copy(this.anim).add(this.offset);
    this.target.y += this.lift;
    this.weight += ((canPlant ? 1 : 0) - this.weight) * (1 - Math.exp(-20 * dt));
  }

  private liftHeight = 0;
  // A foot still on the ground lifts to step; one the clip has already
  // lifted is carried to where the clip has it.
  private beginStep(lift: boolean): void {
    this.contact = null;
    if (Math.hypot(this.offset.x, this.offset.z) < 0.01 * this.k) { this.offset.set(0, 0, 0); return; }
    this.stepFrom.copy(this.offset);
    this.stepT = 0;
    this.liftHeight = lift ? PLANT.lift * this.k * Math.min(1, Math.hypot(this.offset.x, this.offset.z) / (0.12 * this.k)) : 0;
  }

  // Puts the ankle on its target, whatever the body layers did to the hips.
  solve(bendHint: THREE.Vector3): void {
    if (this.weight < 0.002) return;
    const free = this.ankle.getWorldPosition(new THREE.Vector3());
    solveTwoBone(this.hip, this.knee, this.ankle, free.lerp(this.target, this.weight), bendHint);
    // The foot keeps the angle the clip gave it to the ground.
    const parentQ = this.ankle.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
    const now = this.ankle.getWorldQuaternion(new THREE.Quaternion()).slerp(this.animQ, this.weight);
    this.ankle.quaternion.copy(parentQ.multiply(now));
    this.ankle.updateMatrixWorld(true);
  }

  release(): void { this.offset.set(0, 0, 0); this.contact = null; this.stepT = -1; this.lift = 0; this.weight = 0; }
}

// Ground speed of each locomotion clip on a body of this rig, measured from
// the clip: how fast the planted foot travels back under the hips. Read per
// unit of model scale, so one measurement serves every height.
const strideCache = new Map<string, number>();

export function measureGroundSpeeds(model: THREE.Object3D, root: THREE.Object3D, clips: THREE.AnimationClip[], bones: Map<string, THREE.Bone>): Record<string, number> {
  const scale = model.scale.x;
  const out: Record<string, number> = {};
  const todo = clips.filter((c) => !strideCache.has(c.name));
  if (todo.length) {
    const mixer = new THREE.AnimationMixer(model);
    const feet = ['l', 'r'].map((s) => bones.get(`ball_${s}`)!);
    const p = new THREE.Vector3();
    for (const clip of todo) {
      const a = mixer.clipAction(clip);
      a.play();
      const N = 120, speeds: number[] = [];
      let prev: { i: number; z: number } | null = null;
      for (let i = 0; i <= N; i++) {
        a.time = (clip.duration * i) / N;
        mixer.update(0);
        root.updateMatrixWorld(true);
        const ys = feet.map((f) => root.worldToLocal(f.getWorldPosition(p)).clone());
        const low = ys[0]!.y < ys[1]!.y ? 0 : 1;
        const foot = ys[low]!;
        if (prev && prev.i === low && foot.y < 0.045 * scale) speeds.push((foot.z - prev.z) / (clip.duration / N));
        prev = { i: low, z: foot.z };
      }
      a.stop();
      speeds.sort((x, y) => x - y);
      if (speeds.length > 5) strideCache.set(clip.name, speeds[Math.floor(speeds.length / 2)]! / scale);
    }
    mixer.stopAllAction();
    mixer.uncacheRoot(model);
  }
  for (const c of clips) { const s = strideCache.get(c.name); if (s) out[c.name] = s * scale; }
  return out;
}
