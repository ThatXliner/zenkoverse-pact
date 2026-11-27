import * as THREE from 'three';
import { POSES, FINGERS, type Finger, type PoseName, type HandPose } from './poses';
import type { Gesture } from './gestures';
import { GestureClock, handSpring, aimSpring, poseSpring, stepSpring, type HandSpring } from './performer';
import { ArmRig, type Arm } from './rig';
import type { PlayerController } from '../player/controller';
import type { CameraRig } from '../player/camera';
import type { Input } from '../app/input';
import type { TechniqueKit } from '../techniques/kit';
import type { Assets } from '../app/assets';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toon } from '../render/materials';
import { PLAYER_SUIT } from '../character/avatar';

// Each hand is a spring (src/hands/performer.ts) run through its own
// calibrated arm. Poses are authored in view space for the right hand; the
// left hand runs the mirrored pose.
interface HandState extends HandSpring { arm: Arm; claws: THREE.Mesh[] }

// Where the rig sits against the camera. Pose positions are wrist targets
// in camera metres, used as they are; the eye of the model lands on the
// camera plus `eye`.
const VIEW = {
  // Vertical field of view at the 16:9 the poses are framed for.
  fov: 75,
  aspect: 16 / 9,
  scaleRig: 1.1,
  // The furthest a wrist reaches from the shoulder, as a share of the arm.
  reach: 0.93,
  // The rig sits ahead of the eye and a little low, as viewmodels do: the
  // stylized arm is a quarter shorter than a real one, so with the
  // shoulders where a player's are, a hand held in view folds the arm and
  // the elbow swings up beside the hand. From here the shoulders sit below
  // the hands at rest, the elbows hang, and each forearm rises into the
  // frame from a lower corner in line with its hand.
  eye: new THREE.Vector3(0, -0.06, -0.18),
};
const FLIP = new THREE.Quaternion(0, 1, 0, 0);

// The sleeve shell stops a few centimetres short of the wrist with a bare
// cut. A cuff finishes it: a hem turned back over the shell's end, covering
// the forearm to just above the wrist so the hand reads out of a sleeve.
// The profile is radius (fraction of CUFF.r) against distance along the
// forearm, negative toward the elbow from the wrist.
const CUFF = {
  r: 0.043,
  depth: 0.94,
  profile: [[0.9, -0.09], [1, -0.09], [1.02, -0.04], [1.08, -0.034], [1.1, -0.016], [1.07, -0.011], [0.88, -0.011], [0.88, -0.04], [0.9, -0.09]] as const,
};

function addCuff(arm: Arm, material: THREE.Material): void {
  const pts = CUFF.profile.map(([r, y]) => new THREE.Vector2(r * CUFF.r, y));
  const lathe = new THREE.LatheGeometry(pts, 20);
  lathe.deleteAttribute('uv');
  lathe.deleteAttribute('normal');
  const geo = mergeVertices(lathe);
  geo.scale(1, 1, CUFF.depth);
  geo.computeVertexNormals();
  // Lathe +Y runs along the forearm toward the hand; zero sits at the wrist.
  const toWrist = arm.hand.bone.position.clone();
  geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), toWrist.clone().normalize()));
  geo.translate(toWrist.x, toWrist.y, toWrist.z);
  const cuff = new THREE.Mesh(geo, material);
  cuff.name = `cuff_${arm.side}`;
  arm.fore.bone.add(cuff);
}

export class Hands {
  readonly root = new THREE.Group();
  private rigRoot = new THREE.Group();
  private rig: ArmRig;
  private hands: HandState[] = [];
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
  // Heat's body heat, 0 to 1: the skin flushes and the palms glow with it.
  heat = 0;
  private skin: THREE.MeshToonMaterial;
  // A beat of Technique-coloured light on the hands, set by
  // the full sign on its seal and release keys and decaying over a few frames.
  private pulseT = 0;
  // Holds one named pose on both hands, for the capture harness.
  debugPose: PoseName | HandPose | null = null;
  // Orbits the view around the right hand (yaw from its right, negative
  // pitch from above), for judging a pose from the side or above.
  inspect: { yaw: number; pitch: number } | null = null;

  constructor(scene: THREE.Scene, private camera: THREE.PerspectiveCamera, assets: Assets) {
    this.rig = new ArmRig(assets.model('characters/human'));
    // The same flat skin and suit the third-person body wears, inked by the
    // post effect: the player's own hands are drawn like everyone else's.
    const skin = this.skin = toon(0xf7d9bf);
    for (const m of this.rig.skinMeshes) m.material = skin;
    const sleeve = toon(PLAYER_SUIT, { side: THREE.DoubleSide });
    for (const m of this.rig.sleeveMeshes) m.material = sleeve;
    for (const arm of [this.rig.arms.r, this.rig.arms.l]) addCuff(arm, sleeve);
    this.clawMat = new THREE.MeshStandardMaterial({ color: 0xd8f4ff, roughness: 0.3, emissive: 0x9fe8ff, emissiveIntensity: 0.4 });

    this.rigRoot.quaternion.copy(FLIP);
    this.rigRoot.scale.setScalar(VIEW.scaleRig);
    this.rigRoot.position.set(this.rig.eye.x, -this.rig.eye.y, this.rig.eye.z).multiplyScalar(VIEW.scaleRig).add(VIEW.eye);
    this.rigRoot.add(this.rig.object);
    this.root.add(this.rigRoot);
    for (const [side, arm] of [[1, this.rig.arms.r], [-1, this.rig.arms.l]] as const) this.hands.push({ ...handSpring(side, POSES.rest), arm, claws: this.buildClaws(arm) });

    // The Technique's light on the hands, in front of the chest. No falloff:
    // with it, palms sealed a hand's width from the light took hundreds of
    // times its strength and blew out to a white shape with no form. Flat,
    // it tints the skin through the same light bands as the key.
    this.light = new THREE.PointLight(0xffffff, 0, 1.6, 0);
    this.light.position.set(0, -0.1, -0.35);
    // Lit like the world: a warm key and sky fill. The key comes from the
    // upper left and ahead, so it rakes across the backs of the hands and
    // the terminator falls between the knuckles and down the fingers'
    // sides; from behind the camera it lit every face we see the same.
    const fill = new THREE.HemisphereLight(0x9fb8e6, 0xb08a66, 0.8);
    const key = new THREE.DirectionalLight(0xffd9a6, 2.8);
    key.position.set(-0.5, 0.8, -0.9);
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
    this.fitView();
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
      const base = this.debugPose ? (typeof this.debugPose === 'string' ? POSES[this.debugPose] : this.debugPose) : sprinting ? POSES.sprint : this.dashT > 0 ? POSES.guard : speed > 1 ? POSES.rest : POSES.restLow;
      for (const h of this.hands) poseSpring(h, base, this.debugPose ? 400 : 70, this.debugPose ? 30 : 13);
    }

    for (const h of this.hands) {
      const tp = h.targetPose;
      const target = new THREE.Vector3(tp.pos[0], tp.pos[1], tp.pos[2]).add(bob);
      target.y += breathe;
      target.x += this.sway.x * (h.side === 1 ? 1.2 : 0.9);
      target.y += this.sway.y;
      const tq = new THREE.Quaternion().setFromEuler(new THREE.Euler(tp.rot[0] - this.sway.y * 1.5, tp.rot[1] + this.sway.x * (h.side === 1 ? -1.5 : 1.5), tp.rot[2], 'YXZ'));
      stepSpring(h, target, tq, dtc);

      const twitch = this.idleTwitch.find((t) => t.side === h.side);
      this.rig.solve(h.arm, {
        wrist: this.withinReach(h.arm, this.toModel(h.pos)),
        hand: FLIP.clone().multiply(h.rot),
        curl: h.curl, spread: h.spread,
        twitch: twitch ? { finger: twitch.finger, amount: Math.sin(twitch.t * 20) * 0.06 } : undefined,
      });
      for (const c of h.claws) { c.visible = this.frost > 0.02; c.scale.setScalar(0.2 + this.frost * (0.8 + this.glow * 0.6)); }
    }

    if (this.inspect) {
      // The camera orbits the right hand at a fixed distance: positive yaw
      // from its right, negative pitch from above. Moving the hands the
      // other way stands in for moving the camera.
      const pivot = this.hands[0]!.pos.clone();
      this.root.quaternion.setFromEuler(new THREE.Euler(this.inspect.pitch, this.inspect.yaw, 0, 'YXZ')).invert();
      this.root.position.set(0, 0, -0.5).sub(pivot.applyQuaternion(this.root.quaternion));
    } else { this.root.quaternion.identity(); this.root.position.set(0, 0, 0); }

    const glowTarget = this.playing ? 1 : 0;
    this.glow += (glowTarget - this.glow) * (1 - Math.exp(-8 * dtc));
    this.pulseT *= Math.exp(-5 * dtc);
    this.light.intensity = this.glow * 0.25 + this.pulseT * 1.1;
    this.clawMat.emissiveIntensity = 0.3 + this.glow * 0.8 + this.pulseT;
    const h = Math.min(1, this.heat);
    this.skin.emissive.setRGB(h * 0.7, h * 0.12, h * 0.02);
  }

  // The arms are framed for a 16:9 window. A narrower window keeps that
  // horizontal field and widens the vertical one, so the hands stay the
  // same share of the width instead of swelling toward the middle.
  private fitView(): void {
    const c = this.camera;
    const halfV = THREE.MathUtils.degToRad(VIEW.fov / 2);
    const fov = c.aspect >= VIEW.aspect ? VIEW.fov : THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(halfV) * VIEW.aspect / c.aspect));
    if (Math.abs(c.fov - fov) < 1e-3) return;
    c.fov = fov;
    c.updateProjectionMatrix();
  }

  // A wrist past arm's length locks the arm straight along the line of
  // sight, and the near sleeve hides the hand at its end. Pulled back toward
  // the shoulder inside the reach, the elbow keeps a bend and the forearm
  // rises into the hand from below, so the fist or open hand sits on top.
  // (Pulled back toward the eye instead, it swells toward the lens.)
  private withinReach(arm: Arm, wrist: THREE.Vector3): THREE.Vector3 {
    const max = (arm.upperLen + arm.foreLen) * VIEW.reach;
    const d = wrist.distanceTo(arm.shoulder);
    return d <= max ? wrist : arm.shoulder.clone().lerp(wrist, max / d);
  }

  // Camera space to the rig's model space (character faces +Z).
  private toModel(p: THREE.Vector3): THREE.Vector3 {
    return p.clone().sub(this.rigRoot.position).applyQuaternion(FLIP).divideScalar(VIEW.scaleRig);
  }
}
