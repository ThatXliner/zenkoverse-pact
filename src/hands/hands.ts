import * as THREE from 'three';
import { POSES, FINGERS, mirror, type HandPose, type Finger, type PoseName } from './poses';
import { resolvePose, type Gesture } from './gestures';
import { ArmRig, type Arm } from './rig';
import type { PlayerController } from '../player/controller';
import type { CameraRig } from '../player/camera';
import type { Input } from '../app/input';
import type { TechniqueKit } from '../techniques/kit';
import type { Assets } from '../app/assets';

// Spring state per hand. Poses are authored in view space for the right
// hand; the left hand runs the mirrored pose through its own calibrated arm.
interface HandState {
  side: 1 | -1;
  arm: Arm;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rot: THREE.Quaternion;
  rotVel: THREE.Vector3;
  curl: Record<Finger, [number, number, number]>;
  spread: number;
  targetPose: HandPose;
  stiffness: number;
  damping: number;
  claws: THREE.Mesh[];
}

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
  private skin: THREE.MeshPhysicalMaterial;
  private clawMat: THREE.MeshPhysicalMaterial;
  private gesture: Gesture | null = null;
  private gestureT = 0;
  private gestureKey = -1;
  private gestureSpeed = 1;
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
  private rainTwitch: { finger: Finger; side: number; t: number }[] = [];
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

  constructor(scene: THREE.Scene, private camera: THREE.PerspectiveCamera, assets: Assets, environment: THREE.Texture | null) {
    this.rig = new ArmRig(assets.model('characters/human'));
    const src = this.rig.skinMeshes[0]!.material as THREE.MeshStandardMaterial;
    this.skin = new THREE.MeshPhysicalMaterial({
      map: src.map, normalMap: src.normalMap, roughnessMap: src.roughnessMap, metalnessMap: src.metalnessMap, color: src.color,
      roughness: 1, metalness: 0, normalScale: new THREE.Vector2(0.9, 0.9), envMapIntensity: 0.5,
      sheen: 0.35, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xd98a74), clearcoat: 0.12, clearcoatRoughness: 0.4,
    });
    for (const m of this.rig.skinMeshes) m.material = this.skin;
    const fabric = assets.texture('textures/Fabric030/normal')?.clone() ?? null;
    if (fabric) { fabric.repeat.set(7, 7); fabric.needsUpdate = true; }
    const sleeve = new THREE.MeshPhysicalMaterial({ color: 0x1a1d25, roughness: 0.9, metalness: 0, normalMap: fabric, normalScale: new THREE.Vector2(0.5, 0.5), side: THREE.DoubleSide, envMapIntensity: 0.3, sheen: 0.6, sheenRoughness: 0.75, sheenColor: new THREE.Color(0x4a5268) });
    for (const m of this.rig.sleeveMeshes) m.material = sleeve;
    this.clawMat = new THREE.MeshPhysicalMaterial({ color: 0xd8f4ff, roughness: 0.2, transmission: 0.35, thickness: 0.01, emissive: 0x9fe8ff, emissiveIntensity: 0.4 });

    this.rigRoot.quaternion.copy(FLIP);
    this.rigRoot.scale.setScalar(VIEW.scaleRig);
    this.rigRoot.position.set(this.rig.eye.x, -this.rig.eye.y, this.rig.eye.z).multiplyScalar(VIEW.scaleRig).add(VIEW.eye);
    this.rigRoot.add(this.rig.object);
    this.root.add(this.rigRoot);
    for (const [side, arm] of [[1, this.rig.arms.r], [-1, this.rig.arms.l]] as const) {
      const rest = side === 1 ? POSES.rest : mirror(POSES.rest);
      this.hands.push({
        side, arm,
        pos: new THREE.Vector3(...rest.pos), vel: new THREE.Vector3(),
        rot: new THREE.Quaternion().setFromEuler(new THREE.Euler(...rest.rot, 'YXZ')), rotVel: new THREE.Vector3(),
        curl: structuredClone(rest.fingers) as HandState['curl'], spread: rest.spread,
        targetPose: rest, stiffness: 140, damping: 18,
        claws: this.buildClaws(arm),
      });
    }

    this.light = new THREE.PointLight(0xffffff, 0, 1.6, 2);
    this.light.position.set(0, -0.1, -0.35);
    const fill = new THREE.HemisphereLight(0x6f7fa6, 0x1a110c, 0.55);
    const key = new THREE.DirectionalLight(0xdfe6ff, 0.7);
    key.position.set(0.6, 0.8, 0.2);
    this.root.add(this.light, fill, key);
    scene.environment = environment;
    scene.environmentIntensity = 0.4;
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
    this.gesture = g;
    this.gestureT = 0;
    this.gestureKey = -1;
    this.gestureSpeed = speed;
    this.onEvent = onEvent;
    this.onCamera = onCamera;
  }

  stop(): void { this.gesture = null; }
  get playing(): boolean { return this.gesture !== null; }

  step(speed: number): void { this.landDip = Math.min(this.landDip + 0.004 * Math.min(1, speed / 6), 0.02); }
  land(v: number): void { this.landDip += Math.min(0.09, v * 0.012); }
  jump(): void { this.jumpLift = 0.05; }
  dash(): void { this.dashT = 0.3; }
  pulse(amount: number): void { this.pulseT = Math.max(this.pulseT, amount); }
  twitch(): void { this.rainTwitch.push({ finger: FINGERS[Math.floor(Math.random() * 5)]!, side: Math.random() < 0.5 ? 1 : -1, t: 0.3 }); }

  update(rawDt: number, player: PlayerController, cam: CameraRig, input: Input): void {
    const dtc = Math.min(rawDt, 1 / 30);
    this.idleT += dtc;
    this.landDip *= Math.exp(-7 * dtc);
    this.jumpLift *= Math.exp(-6 * dtc);
    this.dashT = Math.max(0, this.dashT - dtc);
    if (Math.random() < dtc * 0.35 && !this.gesture) this.twitch();
    for (const t of this.rainTwitch) t.t -= dtc;
    this.rainTwitch = this.rainTwitch.filter((t) => t.t > 0);

    const swayTarget = new THREE.Vector2(THREE.MathUtils.clamp((this.prevYaw - cam.yaw) * 2.2, -0.08, 0.08), THREE.MathUtils.clamp((cam.pitch - this.prevPitch) * 1.6, -0.06, 0.06));
    this.prevYaw = cam.yaw; this.prevPitch = cam.pitch;
    this.swayVel.addScaledVector(swayTarget.clone().sub(this.sway), 90 * dtc).multiplyScalar(Math.exp(-11 * dtc));
    this.sway.addScaledVector(this.swayVel, dtc);

    const speed = player.planarSpeed.value;
    const sprinting = input.isDown('sprint') && speed > 5 && !this.gesture;
    const bobAmp = player.grounded ? THREE.MathUtils.clamp(speed / 6.6, 0, 1) : 0;
    const cyc = player.stepCycle * Math.PI * 2;
    const bob = new THREE.Vector3(Math.cos(cyc * 0.5) * 0.012 * bobAmp, Math.abs(Math.sin(cyc * 0.5)) * -0.016 * bobAmp + this.landDip * -1.2 + this.jumpLift, 0);
    const breathe = Math.sin(this.idleT * 1.3) * 0.004;

    if (this.gesture) {
      this.gestureT += dtc * this.gestureSpeed;
      const g = this.gesture;
      let k = this.gestureKey;
      while (k + 1 < g.keys.length && g.keys[k + 1]!.t <= this.gestureT) {
        k++;
        const key = g.keys[k]!;
        for (const h of this.hands) {
          const named = h.side === 1 ? key.right : key.left;
          const pose = resolvePose(named, h.targetPose);
          h.targetPose = h.side === 1 || typeof named !== 'string' ? pose : mirror(pose);
          h.stiffness = key.snap ? 520 : key.slow ? 60 : 180;
          h.damping = key.snap ? 16 : key.slow ? 14 : 20;
        }
        if (key.camera) this.onCamera?.(key.camera);
        if (key.event) this.onEvent?.(key.event);
      }
      this.gestureKey = k;
      if (this.gestureT >= g.duration && !g.hold) { this.gesture = null; this.onEvent?.('end'); }
    }
    if (!this.gesture) {
      for (const h of this.hands) {
        const base = this.debugPose ? POSES[this.debugPose] : sprinting ? POSES.sprint : this.dashT > 0 ? POSES.guard : speed > 1 ? POSES.rest : POSES.restLow;
        h.targetPose = h.side === 1 ? base : mirror(base);
        h.stiffness = this.debugPose ? 400 : 70; h.damping = this.debugPose ? 30 : 13;
      }
    }

    for (const h of this.hands) {
      const tp = h.targetPose;
      const target = new THREE.Vector3(tp.pos[0], tp.pos[1], tp.pos[2]).multiply(VIEW.scale).add(VIEW.offset).add(bob);
      target.y += breathe;
      target.x += this.sway.x * (h.side === 1 ? 1.2 : 0.9);
      target.y += this.sway.y;
      const acc = target.clone().sub(h.pos).multiplyScalar(h.stiffness).addScaledVector(h.vel, -h.damping);
      h.vel.addScaledVector(acc, dtc);
      h.pos.addScaledVector(h.vel, dtc);
      const tq = new THREE.Quaternion().setFromEuler(new THREE.Euler(tp.rot[0] - this.sway.y * 1.5, tp.rot[1] + this.sway.x * (h.side === 1 ? -1.5 : 1.5), tp.rot[2], 'YXZ'));
      const err = new THREE.Quaternion().copy(h.rot).invert().multiply(tq);
      const axis = new THREE.Vector3(err.x, err.y, err.z);
      const angle = 2 * Math.atan2(axis.length(), err.w);
      if (axis.lengthSq() > 1e-9) axis.normalize().multiplyScalar(angle > Math.PI ? angle - 2 * Math.PI : angle);
      h.rotVel.addScaledVector(axis.multiplyScalar(h.stiffness * 0.9).addScaledVector(h.rotVel, -h.damping), dtc);
      if (h.rotVel.lengthSq() > 1e-10) h.rot.multiply(new THREE.Quaternion().setFromAxisAngle(h.rotVel.clone().normalize(), h.rotVel.length() * dtc)).normalize();

      const curlRate = h.stiffness > 300 ? 40 : 16;
      for (const f of FINGERS) for (let j = 0; j < 3; j++) h.curl[f][j] = THREE.MathUtils.lerp(h.curl[f][j]!, tp.fingers[f][j]!, 1 - Math.exp(-curlRate * dtc));
      h.spread = THREE.MathUtils.lerp(h.spread, tp.spread, 1 - Math.exp(-14 * dtc));

      const twitch = this.rainTwitch.find((t) => t.side === h.side);
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

    const glowTarget = this.gesture ? 1 : 0;
    this.glow += (glowTarget - this.glow) * (1 - Math.exp(-8 * dtc));
    this.pulseT *= Math.exp(-5 * dtc);
    this.light.intensity = this.glow * 0.03 + this.pulseT * 2.5;
    this.skin.emissive.copy(this.color).multiplyScalar(this.pulseT * 0.26);
    this.clawMat.emissiveIntensity = 0.3 + this.glow * 0.8 + this.pulseT;
  }

  // Camera space to the rig's model space (character faces +Z).
  private toModel(p: THREE.Vector3): THREE.Vector3 {
    return p.clone().sub(this.rigRoot.position).applyQuaternion(FLIP).divideScalar(VIEW.scaleRig);
  }
}
