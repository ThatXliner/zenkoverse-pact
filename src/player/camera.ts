import * as THREE from 'three';
import type { Physics } from '../physics/world';
import { GROUP_WORLD } from '../physics/world';
import { EYE_HEIGHT } from './controller';

export type CameraMode = 'top' | 'third' | 'first';
export const CAMERA_MODES: readonly CameraMode[] = ['top', 'third', 'first'];
export const CAMERA_LABEL: Record<CameraMode, string> = { top: 'Top-down', third: 'Over the shoulder', first: 'First person' };

export interface CameraKick { fov: number; pitch?: number; roll?: number; duration?: number }

export interface Shot {
  duration: number;
  // Both receive normalized time 0..1 and write into the vectors.
  position(t: number, out: THREE.Vector3): void;
  lookAt(t: number, out: THREE.Vector3): void;
  fov?: (t: number) => number;
  roll?: (t: number) => number;
}

const ease = (t: number): number => t * t * (3 - 2 * t);
// The top-down view: the classic arena's high angle. The camera hangs this
// far above and behind a point between the player and the cursor, and looks
// north, so up on the screen is up on the map.
const TOP_OFFSET = new THREE.Vector3(0, 17.5, 11.5);
const TOP_FOV = 46;
const TOP_LEAD = 0.16;
const SWITCH_SECONDS = 0.45;

// Owns the gameplay camera in its three views: the top-down view with its
// cursor aim, the over-the-shoulder spring arm with collision, and first
// person with bob, sway, landing dip, FOV kick and strafe tilt. Changing
// view eases the camera from where it was to where the new view wants it.
// Trauma shake and cinematic shots sit on top of every view.
export class CameraRig {
  // The direction the player faces and aims. In the top-down view the game
  // sets them from the cursor each frame; in the others the mouse turns them.
  yaw = 0;
  pitch = 0;
  mode: CameraMode = 'top';
  // 0 in first person, 1 in the views that show the body. Kept for the HUD
  // and the hands, which only care whether the body is on screen.
  blend = 1;
  baseFov = 80;
  // Where the cursor points on the ground in the top-down view.
  aimPoint: THREE.Vector3 | null = null;
  private fovKick = 0;
  private fovKickTarget = 0;
  private rollKick = 0;
  private pitchKick = 0;
  private dip = 0;
  private dipVel = 0;
  private trauma = 0;
  private swayX = 0;
  private swayY = 0;
  private armDist = 3.0;
  private topTarget = new THREE.Vector3();
  private topSettled = false;
  private shot: Shot | null = null;
  private shotT = 0;
  private tmpPos = new THREE.Vector3();
  private tmpLook = new THREE.Vector3();
  private switchFrom: { pos: THREE.Vector3; quat: THREE.Quaternion; fov: number } | null = null;
  private switchT = 0;
  readonly forward = new THREE.Vector3(0, 0, -1);
  skipRequested = false;

  constructor(readonly camera: THREE.PerspectiveCamera, private physics: Physics) {}

  look(dx: number, dy: number, sensitivity: number, invertY: boolean): void {
    const s = 0.0022 * sensitivity;
    this.yaw -= dx * s;
    this.pitch -= dy * s * (invertY ? -1 : 1);
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.45, 1.45);
    this.swayX += dx * 0.00045;
    this.swayY += dy * 0.00045;
  }

  kick(k: CameraKick): void {
    this.fovKickTarget = Math.max(this.fovKickTarget, k.fov);
    if (k.pitch) this.pitchKick += k.pitch;
    if (k.roll) this.rollKick += k.roll;
  }

  land(fallSpeed: number): void { this.dipVel -= Math.min(4.5, fallSpeed * 0.55); }
  shake(amount: number): void { this.trauma = Math.min(1, this.trauma + amount); }

  // Eases into `mode` from wherever the camera is now.
  setMode(mode: CameraMode): void {
    if (mode === this.mode) return;
    this.switchFrom = { pos: this.camera.position.clone(), quat: this.camera.quaternion.clone(), fov: this.camera.fov };
    this.switchT = 0;
    this.mode = mode;
    if (mode === 'top') this.pitch = 0;
  }
  // Jumps straight to `mode`, for the debug hooks and the cutscene player.
  snap(mode: CameraMode): void { this.mode = mode; this.switchFrom = null; this.blend = mode === 'first' ? 0 : 1; this.topSettled = false; }
  cycleMode(): CameraMode { const next = CAMERA_MODES[(CAMERA_MODES.indexOf(this.mode) + 1) % CAMERA_MODES.length]!; this.setMode(next); return next; }

  play(shot: Shot): void {
    this.shot = shot;
    this.shotT = 0;
    this.skipRequested = false;
  }

  // Ends the shot playing now with a short blend back to the view, for a
  // shot whose length was not known when it began (an Aura Clash).
  release(seconds: number): void { if (this.shot) this.shot.duration = Math.min(this.shot.duration, this.shotT + seconds); }

  get inShot(): boolean { return this.shot !== null; }
  get isFirst(): boolean { return this.blend < 0.5; }
  get isTop(): boolean { return this.mode === 'top'; }
  // Yaw of the camera's forward on the ground: what W moves along.
  get heading(): number { return this.mode === 'top' ? 0 : this.yaw; }

  update(rawDt: number, dt: number, playerPos: THREE.Vector3, stepCycle: number, speed: number, grounded: boolean, strafe: number, time: number): void {
    const targetBlend = this.mode === 'first' ? 0 : 1;
    this.blend += (targetBlend - this.blend) * (1 - Math.exp(-7 * rawDt));
    if (Math.abs(this.blend - targetBlend) < 0.002) this.blend = targetBlend;

    this.fovKick += (this.fovKickTarget - this.fovKick) * (1 - Math.exp(-18 * rawDt));
    this.fovKickTarget *= Math.exp(-5 * rawDt);
    this.rollKick *= Math.exp(-6 * rawDt);
    this.pitchKick *= Math.exp(-7 * rawDt);
    this.dipVel += -this.dip * 140 * rawDt;
    this.dipVel *= Math.exp(-9 * rawDt);
    this.dip += this.dipVel * rawDt;
    this.trauma = Math.max(0, this.trauma - rawDt * 1.6);
    this.swayX *= Math.exp(-9 * rawDt);
    this.swayY *= Math.exp(-9 * rawDt);

    const t2 = this.trauma * this.trauma;
    const n = (f: number, o: number) => Math.sin(time * f + o) * Math.cos(time * f * 0.73 + o * 2.1);
    const shakeYaw = n(31, 1) * 0.045 * t2;
    const shakePitch = n(27, 7) * 0.035 * t2;
    const shakeRoll = n(23, 3) * 0.05 * t2;

    const pos = new THREE.Vector3(), quat = new THREE.Quaternion();
    let fov = this.baseFov;
    if (this.mode === 'first') {
      const eye = playerPos.clone();
      eye.y += EYE_HEIGHT + this.dip * 0.08;
      const bobAmp = grounded ? THREE.MathUtils.clamp(speed / 6.6, 0, 1) : 0;
      const bobY = Math.sin(stepCycle * Math.PI * 2) * 0.035 * bobAmp;
      const bobX = Math.cos(stepCycle * Math.PI) * 0.022 * bobAmp;
      const bobRoll = Math.cos(stepCycle * Math.PI) * 0.012 * bobAmp;
      quat.setFromEuler(new THREE.Euler(this.pitch + this.pitchKick + shakePitch - this.swayY * 0.6, this.yaw + shakeYaw - this.swayX * 0.6, 0, 'YXZ'));
      const roll = this.rollKick + shakeRoll + bobRoll - strafe * 0.018 - this.swayX * 1.4;
      quat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll));
      pos.copy(eye).add(new THREE.Vector3(bobX, bobY, 0).applyQuaternion(quat));
      fov = this.baseFov + this.fovKick + bobAmp * 2.5 * (speed > 5 ? 1 : 0);
    } else if (this.mode === 'third') {
      const pivot = playerPos.clone().add(new THREE.Vector3(0, 1.62, 0));
      const lookQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch + this.pitchKick + shakePitch, this.yaw + shakeYaw, 0, 'YXZ'));
      const shoulder = new THREE.Vector3(0.55, 0.15, 0).applyQuaternion(lookQ);
      const back = new THREE.Vector3(0, 0, 1).applyQuaternion(lookQ);
      const armOrigin = pivot.clone().add(shoulder);
      const desiredDist = 3.6 + Math.max(0, this.pitch) * 1.2;
      const hit = this.physics.castRay(armOrigin, back, desiredDist + 0.3, GROUP_WORLD);
      const wantDist = hit ? Math.max(0.6, hit.toi - 0.3) : desiredDist;
      this.armDist += (wantDist - this.armDist) * (1 - Math.exp(-(wantDist < this.armDist ? 30 : 6) * rawDt));
      pos.copy(armOrigin).addScaledVector(back, this.armDist);
      quat.copy(lookQ).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), shakeRoll + this.rollKick * 0.5));
      fov = this.baseFov + this.fovKick - 6;
    } else {
      // Top-down: the target sits a little toward the cursor, so the view
      // leads where the player is looking, and settles with a soft spring.
      const want = playerPos.clone();
      if (this.aimPoint) want.lerp(new THREE.Vector3(this.aimPoint.x, playerPos.y, this.aimPoint.z), TOP_LEAD);
      if (!this.topSettled) { this.topTarget.copy(want); this.topSettled = true; }
      this.topTarget.lerp(want, 1 - Math.exp(-6 * rawDt));
      pos.copy(this.topTarget).add(TOP_OFFSET);
      const look = this.topTarget.clone().add(new THREE.Vector3(0, 1.0, 0));
      quat.setFromRotationMatrix(new THREE.Matrix4().lookAt(pos, look, new THREE.Vector3(0, 1, 0)));
      quat.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(shakePitch * 0.6, shakeYaw * 0.6, shakeRoll * 0.5, 'YXZ')));
      fov = TOP_FOV + this.fovKick * 0.5;
    }

    // The switch between views: ease from the pose the camera had.
    if (this.switchFrom) {
      this.switchT += rawDt;
      const u = ease(Math.min(1, this.switchT / SWITCH_SECONDS));
      pos.lerpVectors(this.switchFrom.pos, pos, u);
      quat.slerpQuaternions(this.switchFrom.quat, quat, u);
      fov = THREE.MathUtils.lerp(this.switchFrom.fov, fov, u);
      if (this.switchT >= SWITCH_SECONDS) this.switchFrom = null;
    }
    this.camera.position.copy(pos);
    this.camera.quaternion.copy(quat);
    this.camera.fov = fov;

    if (this.shot) {
      this.shotT += rawDt;
      const u = Math.min(1, this.shotT / this.shot.duration);
      this.shot.position(u, this.tmpPos);
      this.shot.lookAt(u, this.tmpLook);
      const inT = Math.min(1, this.shotT / 0.25);
      const outT = Math.max(0, (this.shotT - (this.shot.duration - 0.3)) / 0.3);
      const w = ease(inT) * (1 - ease(outT));
      this.camera.position.lerp(this.tmpPos, w);
      const lookQ2 = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(this.tmpPos, this.tmpLook, new THREE.Vector3(0, 1, 0)));
      if (this.shot.roll) lookQ2.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.shot.roll(u)));
      this.camera.quaternion.slerp(lookQ2, w);
      if (this.shot.fov) this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, this.shot.fov(u), w);
      if (u >= 1 || this.skipRequested) { this.shot = null; this.skipRequested = false; }
    }

    this.camera.updateProjectionMatrix();
    this.forward.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    void dt;
  }

  // Direction the player aims, independent of camera shake and third-person offset.
  aimDirection(): THREE.Vector3 {
    return new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
  }

  // Points yaw and pitch from `eye` at `target`: the top-down cursor aim.
  aimAt(eye: THREE.Vector3, target: THREE.Vector3): void {
    const d = target.clone().sub(eye);
    const flat = Math.hypot(d.x, d.z);
    if (flat > 0.05) this.yaw = Math.atan2(-d.x, -d.z);
    this.pitch = THREE.MathUtils.clamp(Math.atan2(d.y, Math.max(flat, 0.5)), -1.2, 0.6);
  }
}
