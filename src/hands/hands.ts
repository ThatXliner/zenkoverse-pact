import * as THREE from 'three';
import { POSES, FINGERS, type Finger, type PoseName } from './poses';
import type { Gesture } from './gestures';
import { GestureClock, handSpring, aimSpring, poseSpring, stepSpring, type HandSpring } from './performer';
import { ArmRig, type Arm } from './rig';
import type { PlayerController } from '../player/controller';
import type { CameraRig } from '../player/camera';
import type { Input } from '../app/input';
import type { TechniqueKit } from '../techniques/kit';
import type { Assets } from '../app/assets';
import { toon } from '../render/materials';
import { PLAYER_SUIT } from '../character/avatar';

// Each hand is a spring (src/hands/performer.ts) run through its own
// calibrated arm. Poses are authored in view space for the right hand; the
// left hand runs the mirrored pose.
interface HandState extends HandSpring { arm: Arm; claws: THREE.Mesh[] }

// Where the rig sits against the camera and how pose coordinates become
// wrist targets. The eye of the model lands on the camera plus `eye`, so
// shoulders fall where a real player's would.
const VIEW = {
  // Viewmodel arms run slightly under life size, as most shooters do, so
  // the forearms do not crowd the frame at this focal length.
  scaleRig: 0.92,
  eye: new THREE.Vector3(0, -0.015, -0.02),
  scale: new THREE.Vector3(0.95, 0.85, 0.8),
  offset: new THREE.Vector3(0, 0.13, 0),
};
const FLIP = new THREE.Quaternion(0, 1, 0, 0);

export class Hands {
  readonly root = new THREE.Group();
  private rigRoot = new THREE.Group();
  private rig: ArmRig;
  private hands: HandState[] = [];
  private skin: THREE.MeshToonMaterial;
  private clawMat: THREE.MeshStandardMaterial;
  private clock = new GestureClock();
  private onEvent: ((e: string) => void) | null = null;
  private onCamera: ((k: { fov: number; pitch?: number; roll?: number }) => void) | null = null;
  private idleT = 0;
  private landDip = 0;
  private jumpLift = 0;
  private dashT = 0;
  private sway = new THREE.Vector2();
  private swayVel = new THREE.Vector2();
  private prevYaw = 0;
  private prevPitch = 0;
  private idleTwitch: { finger: Finger; side: number; t: number }[] = [];
  private color = new THREE.Color(0xff7a2f);
  private light: THREE.PointLight;
  frost = 0;
  glow = 0;
  // A beat of Technique-coloured light on the skin and the hand light, set by
  // the full sign on its seal and release keys and decaying over a few frames.
  private pulseT = 0;
  // Holds one named pose on both hands, for the capture harness.
  debugPose: PoseName | null = null;
  // Orbits the view around the right hand, for judging a pose from the side or above.
  inspect: { yaw: number; pitch: number } | null = null;

  constructor(scene: THREE.Scene, private camera: THREE.PerspectiveCamera, assets: Assets) {
    this.rig = new ArmRig(assets.model('characters/human'));
    // The same flat skin and suit the third-person body wears, inked by the
    // post effect: the player's own hands are drawn like everyone else's.
    this.skin = toon(0xf7d9bf);
    for (const m of this.rig.skinMeshes) m.material = this.skin;
    const sleeve = toon(PLAYER_SUIT, { side: THREE.DoubleSide });
    for (const m of this.rig.sleeveMeshes) m.material = sleeve;
    this.clawMat = new THREE.MeshStandardMaterial({ color: 0xd8f4ff, roughness: 0.3, emissive: 0x9fe8ff, emissiveIntensity: 0.4 });

    this.rigRoot.quaternion.copy(FLIP);
    this.rigRoot.scale.setScalar(VIEW.scaleRig);
    this.rigRoot.position.set(this.rig.eye.x, -this.rig.eye.y, this.rig.eye.z).multiplyScalar(VIEW.scaleRig).add(VIEW.eye);
    this.rigRoot.add(this.rig.object);
    this.root.add(this.rigRoot);
    for (const [side, arm] of [[1, this.rig.arms.r], [-1, this.rig.arms.l]] as const) this.hands.push({ ...handSpring(side, POSES.rest), arm, claws: this.buildClaws(arm) });

    this.light = new THREE.PointLight(0xffffff, 0, 1.6, 2);
    this.light.position.set(0, -0.1, -0.35);
    // Lit like the world: a warm key from the upper left, sky fill from above.
    const fill = new THREE.HemisphereLight(0x9fb8e6, 0xb08a66, 1.1);
    const key = new THREE.DirectionalLight(0xffd9a6, 2.6);
    key.position.set(-0.7, 0.9, 0.3);
    this.root.add(this.light, fill, key);
    scene.add(this.root);
    camera.add(this.root);
    scene.add(camera);
  }

  // Rime grows ice claws from the fingertips; they live on the last joint
  // and scale with frost.
  private buildClaws(arm: Arm): THREE.Mesh[] {
    const claws: THREE.Mesh[] = [];
    for (const f of FINGERS) {
      const last = arm.fingers[f][2]!.bone;
      const tip = arm.tips[f].position;
      const dir = tip.clone().normalize();
      const claw = new THREE.Mesh(new THREE.ConeGeometry(0.0042, 0.032, 10), this.clawMat);
      claw.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      claw.position.copy(tip).multiplyScalar(0.8).addScaledVector(dir, 0.016);
      claw.visible = false;
      last.add(claw);
      claws.push(claw);
    }
    return claws;
  }

  setTechnique(def: TechniqueKit): void {
    this.color.set(def.color);
    this.light.color.copy(this.color);
    this.frost = def.id === 'rime' ? 0.6 : 0;
  }

  play(g: Gesture, speed: number, onEvent: (e: string) => void, onCamera: (k: { fov: number; pitch?: number; roll?: number }) => void): void {
    this.clock.play(g, speed);
    this.onEvent = onEvent;
    this.onCamera = onCamera;
  }

  stop(): void { this.clock.stop(); }
  get playing(): boolean { return this.clock.gesture !== null; }

  step(speed: number): void { this.landDip = Math.min(this.landDip + 0.004 * Math.min(1, speed / 6), 0.02); }
  land(v: number): void { this.landDip += Math.min(0.09, v * 0.012); }
  jump(): void { this.jumpLift = 0.05; }
  dash(): void { this.dashT = 0.3; }
  pulse(amount: number): void { this.pulseT = Math.max(this.pulseT, amount); }
  // A small idle flex of one finger now and then, so the hands stay alive.
  twitch(): void { this.idleTwitch.push({ finger: FINGERS[Math.floor(Math.random() * 5)]!, side: Math.random() < 0.5 ? 1 : -1, t: 0.3 }); }

  update(rawDt: number, player: PlayerController, cam: CameraRig, input: Input): void {
    const dtc = Math.min(rawDt, 1 / 30);
    this.idleT += dtc;
    this.landDip *= Math.exp(-7 * dtc);
    this.jumpLift *= Math.exp(-6 * dtc);
    this.dashT = Math.max(0, this.dashT - dtc);
    if (Math.random() < dtc * 0.2 && !this.playing) this.twitch();
    for (const t of this.idleTwitch) t.t -= dtc;
    this.idleTwitch = this.idleTwitch.filter((t) => t.t > 0);

    const swayTarget = new THREE.Vector2(THREE.MathUtils.clamp((this.prevYaw - cam.yaw) * 2.2, -0.08, 0.08), THREE.MathUtils.clamp((cam.pitch - this.prevPitch) * 1.6, -0.06, 0.06));
    this.prevYaw = cam.yaw; this.prevPitch = cam.pitch;
    this.swayVel.addScaledVector(swayTarget.clone().sub(this.sway), 90 * dtc).multiplyScalar(Math.exp(-11 * dtc));
    this.sway.addScaledVector(this.swayVel, dtc);

    const speed = player.planarSpeed.value;
    const sprinting = input.isDown('sprint') && speed > 5 && !this.playing;
    const bobAmp = player.grounded ? THREE.MathUtils.clamp(speed / 6.6, 0, 1) : 0;
    const cyc = player.stepCycle * Math.PI * 2;
    const bob = new THREE.Vector3(Math.cos(cyc * 0.5) * 0.012 * bobAmp, Math.abs(Math.sin(cyc * 0.5)) * -0.016 * bobAmp + this.landDip * -1.2 + this.jumpLift, 0);
    const breathe = Math.sin(this.idleT * 1.3) * 0.004;

    const ended = this.clock.advance(dtc, (key) => {
      for (const h of this.hands) aimSpring(h, key);
      if (key.camera) this.onCamera?.(key.camera);
      if (key.event) this.onEvent?.(key.event);
    });
    if (ended) this.onEvent?.('end');
    if (!this.playing) {
      const base = this.debugPose ? POSES[this.debugPose] : sprinting ? POSES.sprint : this.dashT > 0 ? POSES.guard : speed > 1 ? POSES.rest : POSES.restLow;
      for (const h of this.hands) poseSpring(h, base, this.debugPose ? 400 : 70, this.debugPose ? 30 : 13);
    }

    for (const h of this.hands) {
      const tp = h.targetPose;
      const target = new THREE.Vector3(tp.pos[0], tp.pos[1], tp.pos[2]).multiply(VIEW.scale).add(VIEW.offset).add(bob);
      target.y += breathe;
      target.x += this.sway.x * (h.side === 1 ? 1.2 : 0.9);
      target.y += this.sway.y;
      const tq = new THREE.Quaternion().setFromEuler(new THREE.Euler(tp.rot[0] - this.sway.y * 1.5, tp.rot[1] + this.sway.x * (h.side === 1 ? -1.5 : 1.5), tp.rot[2], 'YXZ'));
      stepSpring(h, target, tq, dtc);

      const twitch = this.idleTwitch.find((t) => t.side === h.side);
      this.rig.solve(h.arm, {
        wrist: this.toModel(h.pos),
        hand: FLIP.clone().multiply(h.rot),
        curl: h.curl, spread: h.spread,
        twitch: twitch ? { finger: twitch.finger, amount: Math.sin(twitch.t * 20) * 0.06 } : undefined,
      });
      for (const c of h.claws) { c.visible = this.frost > 0.02; c.scale.setScalar(0.2 + this.frost * (0.8 + this.glow * 0.6)); }
    }

    if (this.inspect) {
      const pivot = this.hands[0]!.pos.clone();
      this.root.quaternion.setFromEuler(new THREE.Euler(this.inspect.pitch, this.inspect.yaw, 0, 'YXZ'));
      this.root.position.copy(pivot).sub(pivot.clone().applyQuaternion(this.root.quaternion));
    } else { this.root.quaternion.identity(); this.root.position.set(0, 0, 0); }

    const glowTarget = this.playing ? 1 : 0;
    this.glow += (glowTarget - this.glow) * (1 - Math.exp(-8 * dtc));
    this.pulseT *= Math.exp(-5 * dtc);
    this.light.intensity = this.glow * 0.03 + this.pulseT * 2.5;
    this.skin.emissive.copy(this.color).multiplyScalar(this.pulseT * 0.3);
    this.clawMat.emissiveIntensity = 0.3 + this.glow * 0.8 + this.pulseT;
  }

  // Camera space to the rig's model space (character faces +Z).
  private toModel(p: THREE.Vector3): THREE.Vector3 {
    return p.clone().sub(this.rigRoot.position).applyQuaternion(FLIP).divideScalar(VIEW.scaleRig);
  }
}
