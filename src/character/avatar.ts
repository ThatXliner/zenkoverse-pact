import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Assets } from '../app/assets';

export type CharacterModel = 'Knight' | 'Rogue' | 'Rogue_Hooded' | 'Mage' | 'Barbarian';

export type Locomotion = 'idle' | 'walk' | 'run' | 'strafeL' | 'strafeR' | 'back' | 'air' | 'land' | 'dead';

const UPPER_BONES = ['spine', 'chest', 'head', 'upperarm', 'lowerarm', 'wrist', 'hand', 'handslot', 'handIK', 'elbowIK'];

// Pulls the tracks that drive the torso and arms out of a clip, so a gesture
// can play on the upper body while the legs keep their locomotion cycle.
function upperBodyClip(clip: THREE.AnimationClip): THREE.AnimationClip {
  const tracks = clip.tracks.filter((t) => {
    const bone = t.name.split('.')[0]?.toLowerCase() ?? '';
    return UPPER_BONES.some((b) => bone.startsWith(b));
  });
  return new THREE.AnimationClip(clip.name + '_upper', clip.duration, tracks);
}

export class Avatar {
  readonly root = new THREE.Group();
  readonly model: THREE.Object3D;
  readonly mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private upper = new Map<string, THREE.AnimationAction>();
  private current: Locomotion = 'idle';
  private weights: Partial<Record<Locomotion, number>> = { idle: 1 };
  private spine: THREE.Bone | null = null;
  private head: THREE.Bone | null = null;
  readonly bones = new Map<string, THREE.Bone>();
  private aimPitch = 0;
  private oneShot: THREE.AnimationAction | null = null;
  readonly height: number;
  tintColor = new THREE.Color(1, 1, 1);
  private materials: THREE.MeshStandardMaterial[] = [];

  constructor(assets: Assets, which: CharacterModel, opts: { hideWeapons?: boolean; hideParts?: string[]; targetHeight?: number; tint?: number; emissive?: number } = {}) {
    const gltf = assets.model(`characters/${which}`);
    this.model = cloneSkeleton(gltf.scene);
    const hide = opts.hideParts ?? [];
    this.model.traverse((o) => {
      const n = o.name;
      if (opts.hideWeapons !== false && /Sword|Shield|Offhand|Axe|Staff|Dagger|Crossbow|Wand|Spellbook|Arrow|Quiver|Mug/i.test(n) && !(o instanceof THREE.Bone)) o.visible = false;
      if (hide.some((h) => n.includes(h))) o.visible = false;
      if (o instanceof THREE.Bone) this.bones.set(n, o);
      if ((o as THREE.Mesh).isMesh) {
        const m = o as THREE.Mesh;
        m.castShadow = true;
        m.receiveShadow = true;
        m.frustumCulled = false;
        const src = m.material as THREE.MeshStandardMaterial;
        const mat = new THREE.MeshStandardMaterial({ map: src.map ?? null, roughness: 0.62, metalness: 0.04, envMapIntensity: 0.8 });
        if (opts.tint !== undefined) mat.color.set(opts.tint);
        if (opts.emissive !== undefined) { mat.emissive.set(opts.emissive); mat.emissiveIntensity = 0.35; }
        m.material = mat;
        this.materials.push(mat);
      }
    });
    const box = new THREE.Box3().setFromObject(this.model);
    const h = box.max.y - box.min.y;
    const target = opts.targetHeight ?? 1.78;
    const s = target / h;
    this.model.scale.setScalar(s);
    this.model.position.y = -box.min.y * s;
    this.height = target;
    this.root.add(this.model);
    this.spine = this.bones.get('spine') ?? null;
    this.head = this.bones.get('head') ?? null;

    this.mixer = new THREE.AnimationMixer(this.model);
    for (const clip of gltf.animations) {
      const a = this.mixer.clipAction(clip);
      this.actions.set(clip.name, a);
      if (/Spellcast|Punch|Kick|Throw|Hit|Interact|Block|Cheer|Use_Item|PickUp/.test(clip.name)) {
        const up = this.mixer.clipAction(upperBodyClip(clip));
        up.setLoop(THREE.LoopOnce, 1);
        up.clampWhenFinished = true;
        this.upper.set(clip.name, up);
      }
    }
    for (const name of ['Idle', 'Walking_A', 'Running_A', 'Running_Strafe_Left', 'Running_Strafe_Right', 'Walking_Backwards', 'Jump_Idle']) {
      const a = this.actions.get(name);
      if (a) { a.play(); a.setEffectiveWeight(name === 'Idle' ? 1 : 0); }
    }
  }

  private locoClip(l: Locomotion): string {
    switch (l) {
      case 'idle': return 'Idle';
      case 'walk': return 'Walking_A';
      case 'run': return 'Running_A';
      case 'strafeL': return 'Running_Strafe_Left';
      case 'strafeR': return 'Running_Strafe_Right';
      case 'back': return 'Walking_Backwards';
      case 'air': return 'Jump_Idle';
      case 'land': return 'Jump_Land';
      case 'dead': return 'Death_A';
    }
  }

  // Locomotion blends by target weights so transitions never pop.
  setLocomotion(speed: number, strafe: number, forwardAmt: number, grounded: boolean, dt: number): void {
    const targets: Partial<Record<Locomotion, number>> = {};
    if (!grounded) targets.air = 1;
    else if (speed < 0.35) targets.idle = 1;
    else {
      const run = THREE.MathUtils.clamp((speed - 3.5) / 2.6, 0, 1);
      if (forwardAmt < -0.4) targets.back = 1;
      else if (Math.abs(strafe) > 0.6 && forwardAmt < 0.4) { if (strafe > 0) targets.strafeR = 1; else targets.strafeL = 1; }
      else { targets.walk = 1 - run; targets.run = run; }
    }
    const all: Locomotion[] = ['idle', 'walk', 'run', 'strafeL', 'strafeR', 'back', 'air'];
    for (const l of all) {
      const cur = this.weights[l] ?? 0;
      const tgt = targets[l] ?? 0;
      const w = cur + (tgt - cur) * (1 - Math.exp(-10 * dt));
      this.weights[l] = w;
      const a = this.actions.get(this.locoClip(l));
      if (a) {
        a.setEffectiveWeight(w);
        if (l === 'walk' || l === 'run') a.setEffectiveTimeScale(THREE.MathUtils.clamp(speed / (l === 'walk' ? 2.6 : 5.6), 0.6, 1.5));
      }
    }
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
    const d = this.actions.get('Death_A');
    if (d) { d.reset(); d.setLoop(THREE.LoopOnce, 1); d.clampWhenFinished = true; d.setEffectiveWeight(1); d.fadeIn(0.1).play(); }
    this.current = 'dead';
  }

  setAimPitch(p: number): void { this.aimPitch = p; }

  flash(intensity: number): void {
    for (const m of this.materials) { m.emissive.set(0xffffff); m.emissiveIntensity = intensity; }
  }

  update(dt: number): void {
    this.mixer.update(dt);
    if (this.oneShot && !this.oneShot.isRunning()) { this.oneShot.fadeOut(0.2); this.oneShot = null; }
    if (this.spine && this.current !== 'dead') this.spine.rotation.x += this.aimPitch * 0.45;
    if (this.head && this.current !== 'dead') this.head.rotation.x += this.aimPitch * 0.4;
    for (const m of this.materials) if (m.emissiveIntensity > 0.001 && m.emissive.r > 0.9) m.emissiveIntensity *= Math.exp(-12 * dt);
  }

  boneWorld(name: string, out: THREE.Vector3): THREE.Vector3 {
    const b = this.bones.get(name);
    if (!b) return out.copy(this.root.position);
    return b.getWorldPosition(out);
  }
}
