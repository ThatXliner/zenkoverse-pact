import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { POSES, FINGERS, mirror, type HandPose, type Finger } from './poses';
import { resolvePose, type Gesture } from './gestures';
import type { PlayerController } from '../player/controller';
import type { CameraRig } from '../player/camera';
import type { Input } from '../app/input';
import type { TechniqueKit } from '../techniques/kit';

interface FingerChain { joints: THREE.Bone[]; base: THREE.Quaternion[] }

interface ArmRig {
  side: 1 | -1;
  shoulder: THREE.Bone;
  upper: THREE.Bone;
  fore: THREE.Bone;
  hand: THREE.Bone;
  fingers: Record<Finger, FingerChain>;
  nails: THREE.Mesh[];
  mesh: THREE.SkinnedMesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rot: THREE.Quaternion;
  rotVel: THREE.Vector3;
  fingerCurl: Record<Finger, [number, number, number]>;
  spread: number;
  targetPose: HandPose;
  stiffness: number;
  damping: number;
}

const UPPER_LEN = 0.30;
const FORE_LEN = 0.27;
const SKIN = 0xc99a80;

// A skinned first-person arm pair built in code: shoulder, upper arm,
// forearm, hand, and three-joint fingers with nails. Gestures drive the hand
// target in view space; a two-bone IK solves the elbow. Springs per hand give
// anticipation and overshoot; fingers blend per joint.
export class Hands {
  readonly root = new THREE.Group();
  private arms: ArmRig[] = [];
  private skin: THREE.MeshPhysicalMaterial;
  private sleeve: THREE.MeshStandardMaterial;
  private nailMat: THREE.MeshPhysicalMaterial;
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
  private rainTwitch: { finger: Finger; side: number; t: number }[] = [];
  private color = new THREE.Color(0xff7a2f);
  frost = 0;
  glow = 0;
  private light: THREE.PointLight;
  private fill: THREE.HemisphereLight;

  constructor(scene: THREE.Scene, private camera: THREE.PerspectiveCamera) {
    this.skin = new THREE.MeshPhysicalMaterial({ color: SKIN, roughness: 0.58, metalness: 0, sheen: 0.25, sheenRoughness: 0.7, sheenColor: new THREE.Color(0xd98a74), clearcoat: 0.18, clearcoatRoughness: 0.4, emissive: 0x000000 });
    this.sleeve = new THREE.MeshStandardMaterial({ color: 0x1b1d24, roughness: 0.92, metalness: 0 });
    this.nailMat = new THREE.MeshPhysicalMaterial({ color: 0xe8c9b8, roughness: 0.3, clearcoat: 0.6, transmission: 0, emissive: 0x000000 });
    this.arms.push(this.buildArm(1), this.buildArm(-1));
    this.light = new THREE.PointLight(0xffffff, 0, 1.6, 2);
    this.light.position.set(0, -0.1, -0.35);
    this.fill = new THREE.HemisphereLight(0x6f7fa6, 0x1a110c, 1.0);
    this.root.add(this.light, this.fill);
    const key = new THREE.DirectionalLight(0xdfe6ff, 1.1);
    key.position.set(0.6, 0.8, 0.2);
    this.root.add(key);
    scene.add(this.root);
    camera.add(this.root);
    scene.add(camera);
  }

  private buildArm(side: 1 | -1): ArmRig {
    const bones: THREE.Bone[] = [];
    const geos: THREE.BufferGeometry[] = [];
    const bone = (parent: THREE.Bone | null, x: number, y: number, z: number): THREE.Bone => {
      const b = new THREE.Bone();
      b.position.set(x, y, z);
      parent?.add(b);
      bones.push(b);
      return b;
    };
    const shoulder = bone(null, side * 0.19, -0.19, -0.02);
    const upper = bone(shoulder, 0, 0, 0);
    const fore = bone(upper, 0, 0, -UPPER_LEN);
    const hand = bone(fore, 0, 0, -FORE_LEN);
    const idx = (b: THREE.Bone) => bones.indexOf(b);

    const segment = (a: THREE.Bone, b: THREE.Bone, r0: number, r1: number, len: number, mat = 0): void => {
      const g = new THREE.CylinderGeometry(r1, r0, len, 14, 6, true);
      g.rotateX(-Math.PI / 2);
      g.translate(0, 0, -len / 2);
      const n = g.getAttribute('position').count;
      const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
      const pos = g.getAttribute('position');
      for (let i = 0; i < n; i++) {
        const t = THREE.MathUtils.clamp(-pos.getZ(i) / len, 0, 1);
        const wB = THREE.MathUtils.smoothstep(t, 0.72, 1.0);
        si[i * 4] = idx(a); sw[i * 4] = 1 - wB;
        si[i * 4 + 1] = idx(b); sw[i * 4 + 1] = wB;
      }
      g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
      g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
      const mi = new Float32Array(n).fill(mat);
      g.setAttribute('matId', new THREE.BufferAttribute(mi, 1));
      geos.push(g.clone());
      void a;
    };
    const jointSphere = (b: THREE.Bone, r: number, mat = 0, scaleY = 1): void => {
      const g = new THREE.SphereGeometry(r, 14, 10);
      g.scale(1, scaleY, 1);
      const n = g.getAttribute('position').count;
      const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) { si[i * 4] = idx(b); sw[i * 4] = 1; }
      g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
      g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
      g.setAttribute('matId', new THREE.BufferAttribute(new Float32Array(n).fill(mat), 1));
      geos.push(g);
    };

    const attachTo = (b: THREE.Bone, g: THREE.BufferGeometry, mat = 0): void => {
      b.updateMatrixWorld(true);
      const n = g.getAttribute('position').count;
      const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) { si[i * 4] = idx(b); sw[i * 4] = 1; }
      g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
      g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
      g.setAttribute('matId', new THREE.BufferAttribute(new Float32Array(n).fill(mat), 1));
      geos.push(g);
    };

    // Geometry is authored in each bone's local frame, then baked through the
    // rest-pose bind matrices so the skin binds cleanly.
    const local: { g: THREE.BufferGeometry; b: THREE.Bone }[] = [];
    const pushLocal = (b: THREE.Bone, g: THREE.BufferGeometry) => local.push({ g, b });

    segment(upper, fore, 0.052, 0.045, UPPER_LEN, 1);
    pushLocal(upper, geos.pop()!);
    segment(fore, hand, 0.047, 0.036, FORE_LEN, 1);
    pushLocal(fore, geos.pop()!);
    jointSphere(fore, 0.047, 1); pushLocal(fore, geos.pop()!);
    const cuff = new THREE.CylinderGeometry(0.052, 0.047, 0.055, 16, 1, false); cuff.rotateX(-Math.PI / 2); cuff.translate(0, 0, 0.03);
    attachTo(hand, cuff, 1); pushLocal(hand, geos.pop()!);
    const wristSkin = new THREE.CylinderGeometry(0.034, 0.038, 0.05, 14, 1, true); wristSkin.rotateX(-Math.PI / 2); wristSkin.translate(0, 0, 0.02);
    attachTo(hand, wristSkin, 0); pushLocal(hand, geos.pop()!);
    const palm = new THREE.BoxGeometry(0.084, 0.036, 0.092, 3, 2, 3);
    roundBox(palm, 0.012);
    palm.translate(side * 0.004, 0, -0.052);
    attachTo(hand, palm, 0); pushLocal(hand, geos.pop()!);
    const heel = new THREE.SphereGeometry(0.03, 12, 8); heel.scale(1.4, 0.8, 1); heel.translate(side * -0.02, -0.004, -0.02);
    attachTo(hand, heel, 0); pushLocal(hand, geos.pop()!);

    const fingers = {} as Record<Finger, FingerChain>;
    const nails: THREE.Mesh[] = [];
    const defs: { f: Finger; x: number; z: number; len: number[]; r: number; yaw: number; thumb?: boolean }[] = [
      { f: 'index', x: -0.031, z: -0.098, len: [0.036, 0.024, 0.02], r: 0.0118, yaw: -0.05 },
      { f: 'middle', x: -0.010, z: -0.102, len: [0.04, 0.027, 0.021], r: 0.012, yaw: 0 },
      { f: 'ring', x: 0.011, z: -0.098, len: [0.036, 0.025, 0.02], r: 0.0112, yaw: 0.04 },
      { f: 'pinky', x: 0.031, z: -0.088, len: [0.028, 0.019, 0.017], r: 0.0098, yaw: 0.1 },
      { f: 'thumb', x: -0.046, z: -0.035, len: [0.038, 0.028, 0.024], r: 0.013, yaw: -0.9, thumb: true },
    ];
    for (const d of defs) {
      const joints: THREE.Bone[] = [];
      let parent: THREE.Bone = hand;
      let px = side * d.x, pz = d.z, py = d.thumb ? -0.008 : 0.003;
      for (let j = 0; j < 3; j++) {
        const b = bone(parent, px, py, pz);
        if (j === 0) { b.rotation.y = side * d.yaw; if (d.thumb) { b.rotation.z = side * 0.9; b.rotation.x = -0.35; } }
        joints.push(b);
        const len = d.len[j]!;
        const r0 = d.r * (1 - j * 0.1);
        const r1 = d.r * (1 - (j + 1) * 0.12);
        const seg = new THREE.CylinderGeometry(r1, r0, len, 10, 2, true);
        seg.rotateX(-Math.PI / 2);
        seg.translate(0, 0, -len / 2);
        const knuckle = new THREE.SphereGeometry(r0 * 1.05, 10, 8);
        const tipG = j === 2 ? new THREE.SphereGeometry(r1 * 1.05, 10, 8) : null;
        if (tipG) tipG.translate(0, 0, -len);
        attachTo(b, seg, 0); pushLocal(b, geos.pop()!);
        attachTo(b, knuckle, 0); pushLocal(b, geos.pop()!);
        if (tipG) { attachTo(b, tipG, 0); pushLocal(b, geos.pop()!); }
        if (j === 2) {
          const nail = new THREE.Mesh(new THREE.SphereGeometry(r1 * 0.9, 10, 6), this.nailMat);
          nail.scale.set(0.9, 0.35, 1.3);
          nail.position.set(0, r1 * 0.55, -len * 0.72);
          b.add(nail);
          nails.push(nail);
        }
        parent = b;
        px = 0; py = 0; pz = -len;
      }
      fingers[d.f] = { joints, base: joints.map((j) => j.quaternion.clone()) };
    }

    shoulder.updateMatrixWorld(true);
    for (const { g, b } of local) {
      g.applyMatrix4(b.matrixWorld);
      geos.push(g);
    }
    const merged = mergeGeometries(geos, false)!;
    merged.computeVertexNormals();
    const mesh = new THREE.SkinnedMesh(merged, this.skin);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    const matId = merged.getAttribute('matId') as THREE.BufferAttribute;
    const colors = new Float32Array(matId.count * 3);
    const skinC = new THREE.Color(SKIN), sleeveC = new THREE.Color(0x1b1d24);
    for (let i = 0; i < matId.count; i++) { const c = matId.getX(i) === 1 ? sleeveC : skinC; colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b; }
    merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.skin.vertexColors = true;
    const skeleton = new THREE.Skeleton(bones);
    mesh.add(shoulder);
    mesh.bind(skeleton);
    this.root.add(mesh);
    const rest = side === 1 ? POSES.rest : mirror(POSES.rest);
    return {
      side, shoulder, upper, fore, hand, fingers, nails, mesh,
      pos: new THREE.Vector3(...rest.pos), vel: new THREE.Vector3(), rot: new THREE.Quaternion().setFromEuler(new THREE.Euler(...rest.rot, 'YXZ')), rotVel: new THREE.Vector3(),
      fingerCurl: { thumb: [0.2, 0.3, 0.2], index: [0.25, 0.35, 0.25], middle: [0.3, 0.4, 0.3], ring: [0.35, 0.45, 0.35], pinky: [0.4, 0.5, 0.4] }, spread: 0.1,
      targetPose: rest, stiffness: 140, damping: 18,
    };
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
  twitch(): void { this.rainTwitch.push({ finger: FINGERS[Math.floor(Math.random() * 5)]!, side: Math.random() < 0.5 ? 1 : -1, t: 0.3 }); }

  update(rawDt: number, dt: number, player: PlayerController, cam: CameraRig, input: Input): void {
    const dtc = Math.min(rawDt, 1 / 30);
    this.idleT += dtc;
    this.landDip *= Math.exp(-7 * dtc);
    this.jumpLift *= Math.exp(-6 * dtc);
    this.dashT = Math.max(0, this.dashT - dtc);
    if (Math.random() < dtc * 0.35 && !this.gesture) this.twitch();
    for (const t of this.rainTwitch) t.t -= dtc;
    this.rainTwitch = this.rainTwitch.filter((t) => t.t > 0);

    const look = { x: cam.yaw, y: cam.pitch };
    const swayTarget = new THREE.Vector2(THREE.MathUtils.clamp((this.prevYaw - look.x) * 2.2, -0.08, 0.08), THREE.MathUtils.clamp((look.y - this.prevPitch) * 1.6, -0.06, 0.06));
    this.prevYaw = look.x; this.prevPitch = look.y;
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
        for (const arm of this.arms) {
          const pose = resolvePose(arm.side === 1 ? key.right : key.left, arm.targetPose);
          arm.targetPose = arm.side === 1 ? pose : mirrorIfNamed(key.left, pose);
          arm.stiffness = key.snap ? 520 : key.slow ? 60 : 180;
          arm.damping = key.snap ? 16 : key.slow ? 14 : 20;
        }
        if (key.camera) this.onCamera?.(key.camera);
        if (key.event) this.onEvent?.(key.event);
      }
      this.gestureKey = k;
      if (this.gestureT >= g.duration && !g.hold) { this.gesture = null; this.onEvent?.('end'); }
    }
    if (!this.gesture) {
      for (const arm of this.arms) {
        const base = sprinting ? POSES.sprint : this.dashT > 0 ? POSES.guard : speed > 1 ? POSES.rest : POSES.restLow;
        arm.targetPose = arm.side === 1 ? base : mirror(base);
        arm.stiffness = 70; arm.damping = 13;
      }
    }

    for (const arm of this.arms) {
      const tp = arm.targetPose;
      const target = new THREE.Vector3(tp.pos[0] * 0.9, tp.pos[1] * 0.85 + 0.12 + breathe, tp.pos[2] * 0.82).add(bob);
      target.x += this.sway.x * (arm.side === 1 ? 1.2 : 0.9);
      target.y += this.sway.y;
      const acc = target.clone().sub(arm.pos).multiplyScalar(arm.stiffness).addScaledVector(arm.vel, -arm.damping);
      arm.vel.addScaledVector(acc, dtc);
      arm.pos.addScaledVector(arm.vel, dtc);
      const tq = new THREE.Quaternion().setFromEuler(new THREE.Euler(tp.rot[0] - this.sway.y * 1.5, tp.rot[1] + this.sway.x * (arm.side === 1 ? -1.5 : 1.5), tp.rot[2], 'YXZ'));
      const err = new THREE.Quaternion().copy(arm.rot).invert().multiply(tq);
      const axisAngle = new THREE.Vector3(err.x, err.y, err.z);
      const angle = 2 * Math.atan2(axisAngle.length(), err.w);
      if (axisAngle.lengthSq() > 1e-9) axisAngle.normalize().multiplyScalar(angle > Math.PI ? angle - 2 * Math.PI : angle);
      arm.rotVel.addScaledVector(axisAngle.multiplyScalar(arm.stiffness * 0.9).addScaledVector(arm.rotVel, -arm.damping), dtc);
      const dq = new THREE.Quaternion().setFromAxisAngle(arm.rotVel.clone().normalize(), arm.rotVel.length() * dtc);
      if (arm.rotVel.lengthSq() > 1e-10) arm.rot.multiply(dq).normalize();

      const curlRate = arm.stiffness > 300 ? 40 : 16;
      for (const f of FINGERS) {
        const c = arm.fingerCurl[f];
        const t = tp.fingers[f];
        for (let j = 0; j < 3; j++) c[j] = THREE.MathUtils.lerp(c[j]!, t[j]!, 1 - Math.exp(-curlRate * dtc));
      }
      arm.spread = THREE.MathUtils.lerp(arm.spread, tp.spread, 1 - Math.exp(-14 * dtc));
      this.solveArm(arm);
      this.poseFingers(arm);
    }

    const glowTarget = this.gesture ? 1 : 0;
    this.glow += (glowTarget - this.glow) * (1 - Math.exp(-8 * dtc));
    this.light.intensity = this.glow * 0.22;
    this.skin.emissive.copy(this.color).multiplyScalar(this.glow * 0.015);
    this.nailMat.emissive.copy(this.frost > 0 ? new THREE.Color(0x9fe8ff) : this.color).multiplyScalar(this.frost * 0.5 + this.glow * 0.25);
    this.nailMat.color.lerp(this.frost > 0 ? new THREE.Color(0xd8f4ff) : new THREE.Color(0xe8c9b8), 0.1);
    for (const arm of this.arms) for (const n of arm.nails) n.scale.z = 1.3 + this.frost * 1.6 * (0.6 + this.glow);
    void dt;
  }
  private prevYaw = 0;
  private prevPitch = 0;

  // Two-bone IK: place the hand bone at the view-space target and bend the
  // elbow down and outward, the way a forearm sits in front of a chest.
  private solveArm(arm: ArmRig): void {
    const shoulderPos = arm.shoulder.position;
    const target = arm.pos.clone();
    const toT = target.clone().sub(shoulderPos);
    const d = THREE.MathUtils.clamp(toT.length(), 0.08, UPPER_LEN + FORE_LEN - 0.005);
    const dirT = toT.normalize();
    const cosA = (UPPER_LEN * UPPER_LEN + d * d - FORE_LEN * FORE_LEN) / (2 * UPPER_LEN * d);
    const a = Math.acos(THREE.MathUtils.clamp(cosA, -1, 1));
    const hint = new THREE.Vector3(arm.side * 0.7, -1, 0.25).normalize();
    const bend = hint.clone().sub(dirT.clone().multiplyScalar(hint.dot(dirT))).normalize();
    const elbow = shoulderPos.clone().addScaledVector(dirT, Math.cos(a) * UPPER_LEN).addScaledVector(bend, Math.sin(a) * UPPER_LEN);
    const look = (b: THREE.Bone, from: THREE.Vector3, to: THREE.Vector3, parentQ: THREE.Quaternion): THREE.Quaternion => {
      const m = new THREE.Matrix4().lookAt(from, to, new THREE.Vector3(0, 1, 0));
      const q = new THREE.Quaternion().setFromRotationMatrix(m);
      const local = parentQ.clone().invert().multiply(q);
      b.quaternion.copy(local);
      return q;
    };
    const id = new THREE.Quaternion();
    arm.shoulder.quaternion.identity();
    const qU = look(arm.upper, shoulderPos, elbow, id);
    const qF = look(arm.fore, elbow, target, qU);
    arm.hand.quaternion.copy(qF.clone().invert().multiply(arm.rot));
  }

  private poseFingers(arm: ArmRig): void {
    const maxCurl = [1.45, 1.6, 1.1];
    for (const f of FINGERS) {
      const ch = arm.fingers[f];
      const curl = arm.fingerCurl[f];
      const twitch = this.rainTwitch.find((t) => t.finger === f && t.side === arm.side);
      for (let j = 0; j < 3; j++) {
        const b = ch.joints[j]!;
        b.quaternion.copy(ch.base[j]!);
        let c = curl[j]! * maxCurl[j]!;
        if (twitch) c += Math.sin(twitch.t * 20) * 0.08;
        const axis = f === 'thumb' ? new THREE.Vector3(-1, -arm.side * 0.5, 0).normalize() : new THREE.Vector3(-1, 0, 0);
        b.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(axis, c));
        if (j === 0 && f !== 'thumb') {
          const spreadAmt = (f === 'index' ? -1 : f === 'middle' ? -0.2 : f === 'ring' ? 0.5 : 1.2) * arm.spread * 0.35;
          b.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spreadAmt * arm.side));
        }
      }
    }
  }
}

function mirrorIfNamed(p: unknown, resolved: HandPose): HandPose {
  return typeof p === 'string' ? mirror(resolved) : resolved;
}

function roundBox(g: THREE.BoxGeometry, r: number): void {
  const p = g.getAttribute('position');
  const box = new THREE.Box3().setFromBufferAttribute(p as THREE.BufferAttribute);
  const half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const inner = new THREE.Vector3(THREE.MathUtils.clamp(v.x, -half.x + r, half.x - r), THREE.MathUtils.clamp(v.y, -half.y + r, half.y - r), THREE.MathUtils.clamp(v.z, -half.z + r, half.z - r));
    const d = v.clone().sub(inner);
    if (d.lengthSq() > 1e-12) v.copy(inner.add(d.normalize().multiplyScalar(r)));
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
}
