import * as THREE from 'three';
import type { CameraMode } from '../app/settings';
import type { Physics } from '../physics/world';
import { GROUP_WORLD } from '../physics/world';
import { EYE_HEIGHT } from './controller';

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

// Owns the gameplay camera: first-person feel (bob, sway, landing dip, FOV
// kick, strafe tilt), third-person spring arm with collision, the eased
// transition between the two, trauma shake, and cinematic shots.
export class CameraRig {
  yaw = 0;
  pitch = 0;
  mode: CameraMode = 'first';
  blend = 0;
  baseFov = 80;
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
  private shot: Shot | null = null;
  private shotT = 0;
  private shotFrom = new THREE.Vector3();
  private tmpPos = new THREE.Vector3();
  private tmpLook = new THREE.Vector3();
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

  toggleMode(): void { this.mode = this.mode === 'first' ? 'third' : 'first'; }

  play(shot: Shot): void {
    this.shot = shot;
    this.shotT = 0;
    this.shotFrom.copy(this.camera.position);
    this.skipRequested = false;
  }

  get inShot(): boolean { return this.shot !== null; }
  get isFirst(): boolean { return this.blend < 0.5; }

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

    const eye = playerPos.clone();
    eye.y += EYE_HEIGHT + this.dip * 0.08;
    const bobAmp = grounded ? THREE.MathUtils.clamp(speed / 6.6, 0, 1) : 0;
    const bobY = Math.sin(stepCycle * Math.PI * 2) * 0.035 * bobAmp;
    const bobX = Math.cos(stepCycle * Math.PI) * 0.022 * bobAmp;
    const bobRoll = Math.cos(stepCycle * Math.PI) * 0.012 * bobAmp;

    const q = new THREE.Quaternion();
    const euler = new THREE.Euler(this.pitch + this.pitchKick + shakePitch - this.swayY * 0.6, this.yaw + shakeYaw - this.swayX * 0.6, 0, 'YXZ');
    q.setFromEuler(euler);
    const roll = this.rollKick + shakeRoll + bobRoll - strafe * 0.018 - this.swayX * 1.4;
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll));

    const fpPos = eye.clone().add(new THREE.Vector3(bobX, bobY, 0).applyQuaternion(q));

    const pivot = playerPos.clone().add(new THREE.Vector3(0, 1.5, 0));
    const lookQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch + this.pitchKick + shakePitch, this.yaw + shakeYaw, 0, 'YXZ'));
    const shoulder = new THREE.Vector3(0.55, 0.15, 0).applyQuaternion(lookQ);
    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(lookQ);
    const armOrigin = pivot.clone().add(shoulder);
    const desiredDist = 3.1 + Math.max(0, this.pitch) * 1.2;
    const hit = this.physics.castRay(armOrigin, back, desiredDist + 0.3, GROUP_WORLD);
    const wantDist = hit ? Math.max(0.6, hit.toi - 0.3) : desiredDist;
    this.armDist += (wantDist - this.armDist) * (1 - Math.exp(-(wantDist < this.armDist ? 30 : 6) * rawDt));
    const tpPos = armOrigin.clone().addScaledVector(back, this.armDist);
    const tpQ = lookQ.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), shakeRoll + this.rollKick * 0.5));

    const b = ease(this.blend);
    this.camera.position.lerpVectors(fpPos, tpPos, b);
    this.camera.quaternion.slerpQuaternions(q, tpQ, b);
    const fov = this.baseFov + this.fovKick + bobAmp * 2.5 * (speed > 5 ? 1 : 0) - b * 6;
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
}
