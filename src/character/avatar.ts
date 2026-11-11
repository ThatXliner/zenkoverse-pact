import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Assets } from '../app/assets';

// Every character is the one human in human.glb. A look picks hair, skin
// tone and suit colour. The KayKit names stay as aliases until
// src/world/pedestrians.ts is migrated; they are looks now, not models.
export interface Look { hair: string | null; hairColor: number; beard?: boolean; skin: 'light' | 'dark' }
const parted: Look = { hair: 'Hair_SimpleParted', hairColor: 0x1a1412, skin: 'light' };
const buzzed: Look = { hair: 'Hair_Buzzed', hairColor: 0x120d0b, skin: 'dark' };
const long: Look = { hair: 'Hair_Long', hairColor: 0x3a2a1e, skin: 'light' };
const buns: Look = { hair: 'Hair_Buns', hairColor: 0x15100e, skin: 'dark' };
const beard: Look = { hair: 'Hair_Buzzed', hairColor: 0x4a3426, beard: true, skin: 'light' };
const bald: Look = { hair: null, hairColor: 0x000000, skin: 'dark' };
export const LOOKS = {
  player: parted, parted, buzzed, long, buns, beard, bald,
  Knight: parted, Rogue: buzzed, Rogue_Hooded: bald, Mage: long, Barbarian: beard,
} satisfies Record<string, Look>;
export type CharacterModel = keyof typeof LOOKS;

export type Locomotion = 'idle' | 'walk' | 'run' | 'sprint' | 'air' | 'land' | 'dead';

// Backing up is the walk and jog clips played in reverse, not a clip of its own.
const LOCO_CLIP: Record<Locomotion, string> = { idle: 'Idle_Loop', walk: 'Walk_Loop', run: 'Jog_Fwd_Loop', sprint: 'Sprint_Loop', air: 'Jump_Loop', land: 'Jump_Land', dead: 'Death01' };
const LOOPS: Locomotion[] = ['idle', 'walk', 'run', 'sprint', 'air'];
const UPPER_CLIPS = ['Punch_Jab', 'Punch_Cross', 'Spell_Simple_Enter', 'Spell_Simple_Exit', 'Spell_Simple_Shoot', 'Spell_Simple_Idle_Loop', 'Hit_Chest', 'Hit_Head', 'Interact', 'PickUp_Table', 'Sword_Attack'];
const UPPER_BONE = /^(spine_0[1-3]|neck_01|Head|clavicle|upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)/;
const SPINE = ['spine_01', 'spine_02', 'spine_03'];
// Bones the procedural layer turns on top of the clips.
const LAYERED = ['pelvis', ...SPINE, 'Head'];
const UP = new THREE.Vector3(0, 1, 0);
// Beyond this angle from the facing, travel plays the cycle backward.
const BACKING = THREE.MathUtils.degToRad(100);
const MAX_HIP_YAW = 1.2;
const SUIT = 0x1a1d25;
const BODY_BOUNDS = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.5);
const WHITE = new THREE.Color(1, 1, 1);

// Pulls the torso and arm tracks out of a clip so a gesture plays on the
// upper body while the legs keep their locomotion cycle.
function upperBodyClip(clip: THREE.AnimationClip): THREE.AnimationClip {
  return new THREE.AnimationClip(clip.name + '_upper', clip.duration, clip.tracks.filter((t) => UPPER_BONE.test(t.name.split('.')[0] ?? '')));
}

export interface AvatarOptions { hideParts?: string[]; targetHeight?: number; tint?: number; emissive?: number }

export class Avatar {
  readonly root = new THREE.Group();
  readonly model: THREE.Object3D;
  readonly mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private upper = new Map<string, THREE.AnimationAction>();
  private current: Locomotion = 'idle';
  private weights: Partial<Record<Locomotion, number>> = { idle: 1 };
  private clipSpeed: Record<string, number>;
  readonly bones = new Map<string, THREE.Bone>();
  private aimPitch = 0;
  private hipYaw = 0;
  private layered: { bone: THREE.Bone; clip: THREE.Quaternion }[] = [];
  private oneShot: THREE.AnimationAction | null = null;
  readonly height: number;
  private suit: THREE.MeshPhysicalMaterial;
  private suitGlow = new THREE.Color(0);
  private materials: THREE.MeshStandardMaterial[] = [];
  private flashT = 0;

  constructor(assets: Assets, which: CharacterModel, opts: AvatarOptions = {}) {
    const gltf = assets.model('characters/human');
    const look = LOOKS[which];
    this.clipSpeed = (gltf.userData as { clipSpeeds?: Record<string, number> }).clipSpeeds ?? {};
    this.model = cloneSkeleton(gltf.scene);
    const drop: THREE.Object3D[] = [];
    // Tints come from callers that coloured whole KayKit models; at half
    // brightness they read as cloth instead of skin.
    this.suit = new THREE.MeshPhysicalMaterial({ color: opts.tint !== undefined ? new THREE.Color(opts.tint).multiplyScalar(0.5) : SUIT, roughness: 0.88, metalness: 0, envMapIntensity: 0.4, side: THREE.DoubleSide, sheen: 0.6, sheenRoughness: 0.75, sheenColor: new THREE.Color(0x4a5268) });
    if (opts.emissive !== undefined) { this.suitGlow.set(opts.emissive).multiplyScalar(0.35); this.suit.emissive.copy(this.suitGlow); }
    const fabric = assets.texture('textures/Fabric030/normal');
    if (fabric) { this.suit.normalMap = fabric; this.suit.normalScale.set(0.5, 0.5); }
    this.model.traverse((o) => {
      if ((o as THREE.Bone).isBone) this.bones.set(o.name, o as THREE.Bone);
      if (o.name === 'Arms') drop.push(o);
      if (o.name.startsWith('Hair_')) { const keep = o.name === look.hair || (look.beard && o.name === 'Hair_Beard'); if (!keep) drop.push(o); }
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
      // Shared geometry is quantized, so its own bounds mean nothing. A sphere
      // around the whole body lets the renderer cull this mesh from every
      // camera and shadow pass it is outside of.
      if ((m as THREE.SkinnedMesh).isSkinnedMesh) (m as THREE.SkinnedMesh).boundingSphere = BODY_BOUNDS;
      const src = m.material as THREE.MeshStandardMaterial;
      if (src.name === 'Suit') { m.material = this.suit; return; }
      const mat = src.clone();
      mat.envMapIntensity = 0.6;
      if (o.name.startsWith('Hair_')) { mat.color.set(look.hairColor); mat.roughness = 0.7; }
      if (src.name === 'Skin' && look.skin === 'dark') {
        const dark = assets.texture('textures/HumanSkinDark/color');
        if (dark) { const t = dark.clone(); t.repeat.set(1, -1); t.offset.set(0, 1); t.needsUpdate = true; mat.map = t; }
      }
      m.material = mat;
      this.materials.push(mat);
    });
    for (const o of drop) o.removeFromParent();
    // The model is authored facing +Z. Turned inside the root, the root follows
    // the game's convention (yaw 0 looks down -Z, like the camera), so callers
    // set root.rotation.y to their yaw as they would for any other object.
    this.model.rotation.y = Math.PI;
    const box = new THREE.Box3().setFromObject(this.model);
    const h = box.max.y - box.min.y;
    const target = opts.targetHeight ?? 1.78;
    const s = target / h;
    this.model.scale.setScalar(s);
    this.model.position.y = -box.min.y * s;
    this.height = target;
    this.root.add(this.model);

    this.mixer = new THREE.AnimationMixer(this.model);
    for (const clip of gltf.animations) {
      this.actions.set(clip.name, this.mixer.clipAction(clip));
      if (UPPER_CLIPS.includes(clip.name)) {
        const up = this.mixer.clipAction(upperBodyClip(clip));
        up.setLoop(THREE.LoopOnce, 1);
        up.clampWhenFinished = true;
        this.upper.set(clip.name, up);
      }
    }
    for (const l of LOOPS) {
      const a = this.actions.get(LOCO_CLIP[l]);
      if (a) { a.play(); a.setEffectiveWeight(l === 'idle' ? 1 : 0); }
    }
    // Bake the idle pose now: the bind pose is a T-pose, and far-away
    // pedestrians are never updated.
    this.mixer.update(0);
    this.layered = LAYERED.flatMap((n) => { const bone = this.bones.get(n); return bone ? [{ bone, clip: bone.quaternion.clone() }] : []; });
  }

  // Locomotion is a blend over speed bands. Each clip runs at the time scale
  // that matches its measured ground speed, so feet plant instead of sliding.
  // `velocity` is in world space; the avatar reads it against its own facing.
  setLocomotion(velocity: THREE.Vector3, grounded: boolean, dt: number): void {
    const speed = Math.hypot(velocity.x, velocity.z);
    const facing = this.root.getWorldQuaternion(new THREE.Quaternion());
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(facing);
    // Direction of travel as a yaw from the facing, positive to the left.
    const travel = Math.atan2(fwd.z * velocity.x - fwd.x * velocity.z, fwd.x * velocity.x + fwd.z * velocity.z);
    const backing = Math.abs(travel) > BACKING;
    const targets: Partial<Record<Locomotion, number>> = {};
    if (!grounded) targets.air = 1;
    else if (speed < 0.35) targets.idle = 1;
    else {
      const walkRun = THREE.MathUtils.smoothstep(speed, 1.2, 2.6);
      const runSprint = backing ? 0 : THREE.MathUtils.smoothstep(speed, 5.0, 6.2);
      targets.walk = 1 - walkRun;
      targets.run = walkRun * (1 - runSprint);
      targets.sprint = walkRun * runSprint;
    }
    for (const l of LOOPS) {
      const cur = this.weights[l] ?? 0;
      const w = cur + ((targets[l] ?? 0) - cur) * (1 - Math.exp(-10 * dt));
      this.weights[l] = w;
      const a = this.actions.get(LOCO_CLIP[l]);
      if (!a) continue;
      a.setEffectiveWeight(w);
      const natural = this.clipSpeed[LOCO_CLIP[l]];
      if (natural && w > 0.001) a.setEffectiveTimeScale(THREE.MathUtils.clamp(speed / natural, 0.55, 1.6) * (backing ? -1 : 1));
    }
    // Off-axis travel turns the hips so the legs run along it, forward or
    // backward, while the spine twists back so the chest keeps the facing.
    const legs = backing ? Math.atan2(-Math.sin(travel), -Math.cos(travel)) : travel;
    const wantHip = grounded && speed > 0.35 ? THREE.MathUtils.clamp(legs, -MAX_HIP_YAW, MAX_HIP_YAW) : 0;
    this.hipYaw += (wantHip - this.hipYaw) * (1 - Math.exp(-8 * dt));
    this.current = (Object.entries(targets)[0]?.[0] as Locomotion) ?? 'idle';
  }

  playUpper(clipName: string, timeScale = 1): void {
    const a = this.upper.get(clipName);
    if (!a) return;
    a.reset();
    a.setEffectiveTimeScale(timeScale);
    a.setEffectiveWeight(1);
    a.fadeIn(0.06).play();
    for (const [n, other] of this.upper) if (n !== clipName && other.isRunning()) other.fadeOut(0.08);
  }

  playOneShot(clipName: string, opts: { clamp?: boolean; timeScale?: number; fade?: number } = {}): THREE.AnimationAction | null {
    const a = this.actions.get(clipName);
    if (!a) return null;
    a.reset();
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = opts.clamp ?? false;
    a.setEffectiveTimeScale(opts.timeScale ?? 1);
    a.setEffectiveWeight(1);
    a.fadeIn(opts.fade ?? 0.08).play();
    this.oneShot = a;
    return a;
  }

  die(): void {
    for (const a of this.actions.values()) a.fadeOut(0.15);
    const d = this.actions.get(LOCO_CLIP.dead);
    if (d) { d.reset(); d.setLoop(THREE.LoopOnce, 1); d.clampWhenFinished = true; d.setEffectiveWeight(1); d.fadeIn(0.1).play(); }
    this.current = 'dead';
  }

  // Pitch of the aim in radians, positive looking up.
  setAimPitch(p: number): void { this.aimPitch = p; }

  flash(intensity: number): void { this.flashT = intensity; }

  update(dt: number): void {
    // The mixer only writes a bone whose blended value changed since its last
    // write, so a bone held still by its clips (spine_01 in every locomotion
    // clip) would keep last frame's turn and gain another each frame. Hand the
    // mixer back the pose it wrote before layering on top of it again.
    for (const l of this.layered) l.bone.quaternion.copy(l.clip);
    this.mixer.update(dt);
    for (const l of this.layered) l.clip.copy(l.bone.quaternion);
    if (this.oneShot && !this.oneShot.isRunning()) { this.oneShot.fadeOut(0.2); this.oneShot = null; }
    if (this.current !== 'dead') {
      this.model.updateMatrixWorld(true);
      this.rotateAbout('pelvis', UP, this.hipYaw);
      for (const s of SPINE) this.rotateAbout(s, UP, -this.hipYaw / 3);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.root.getWorldQuaternion(new THREE.Quaternion()));
      this.rotateAbout('spine_02', right, this.aimPitch * 0.3);
      this.rotateAbout('spine_03', right, this.aimPitch * 0.25);
      this.rotateAbout('Head', right, this.aimPitch * 0.35);
    }
    this.flashT *= Math.exp(-12 * dt);
    for (const m of this.materials) m.emissive.setScalar(this.flashT);
    this.suit.emissive.copy(this.suitGlow).lerp(WHITE, this.flashT);
  }

  // Turns a bone about a world-space axis on top of its animated pose.
  private rotateAbout(name: string, axisWorld: THREE.Vector3, angle: number): void {
    const b = this.bones.get(name);
    if (!b || !b.parent || Math.abs(angle) < 1e-5) return;
    const parentQ = b.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    const axis = axisWorld.clone().applyQuaternion(parentQ).normalize();
    b.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
    b.updateMatrixWorld(true);
  }

  boneWorld(name: string, out: THREE.Vector3): THREE.Vector3 {
    const b = this.bones.get(name);
    if (!b) return out.copy(this.root.position);
    return b.getWorldPosition(out);
  }
}
