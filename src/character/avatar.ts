import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Assets } from '../app/assets';
import { toon } from '../render/materials';
import { dress, type CostumeId } from './costume';
import { BodyGesture } from './gesture';
import { Leg, Spring, measureGroundSpeeds } from './motion';
import { applyPosture, type Posture } from './posture';
import type { Gesture } from '../hands/gestures';

// Every character is the one rigged human in human.glb, drawn like the rest
// of the page: flat skin and hair fills in screentone, a flat suit in the
// role's colour, brush ink from the post effect, and a larger head and hands than life, so
// the figures read as drawn rather than scanned. A look picks hair and skin.
export interface Look { hair: string | null; hairColor: number; beard?: boolean; skin: 'light' | 'dark' | 'warm' }
const parted: Look = { hair: 'Hair_SimpleParted', hairColor: 0x2a1e2e, skin: 'light' };
const buzzed: Look = { hair: 'Hair_Buzzed', hairColor: 0x1a1216, skin: 'dark' };
const long: Look = { hair: 'Hair_Long', hairColor: 0xe9e4dc, skin: 'light' };
const buns: Look = { hair: 'Hair_Buns', hairColor: 0x3a2322, skin: 'warm' };
const beard: Look = { hair: 'Hair_Buzzed', hairColor: 0x5a3426, beard: true, skin: 'warm' };
const bald: Look = { hair: null, hairColor: 0x000000, skin: 'dark' };
export const LOOKS = { player: parted, parted, buzzed, long, buns, beard, bald } satisfies Record<string, Look>;
export type CharacterModel = keyof typeof LOOKS;

// Anime skin: pale, warm and flat. The shade comes from the ramp, never from a texture.
const SKIN: Record<Look['skin'], number> = { light: 0xf7d9bf, warm: 0xe2b58f, dark: 0x9a6744 };
const EYE_WHITE = 0xf8f6f2;

export type Stance = 'push' | 'hold' | 'feint';
const STANCES: Stance[] = ['push', 'hold', 'feint'];

export type Locomotion = 'idle' | 'walk' | 'run' | 'sprint' | 'air' | 'land' | 'dead';

// Backing up is the walk and jog clips played in reverse, not a clip of its own.
const LOCO_CLIP: Record<Locomotion, string> = { idle: 'Idle_Loop', walk: 'Walk_Loop', run: 'Jog_Fwd_Loop', sprint: 'Sprint_Loop', air: 'Jump_Loop', land: 'Jump_Land', dead: 'Death01' };
const LOOPS: Locomotion[] = ['idle', 'walk', 'run', 'sprint', 'air'];
const UPPER_CLIPS = ['Hit_Chest'];
const UPPER_BONE = /^(spine_0[1-3]|neck_01|Head|clavicle|upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)/;
const SPINE = ['spine_01', 'spine_02', 'spine_03'];
const LEG_BONES = ['thigh', 'calf', 'foot'].flatMap((b) => [`${b}_l`, `${b}_r`]);
// Bones the procedural layers turn or move on top of the clips.
const LAYERED = ['pelvis', ...SPINE, 'neck_01', 'Head', ...LEG_BONES, 'clavicle_l', 'clavicle_r', 'upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r'];
const GAIT: Locomotion[] = ['walk', 'run', 'sprint'];
const UP = new THREE.Vector3(0, 1, 0);
const MODEL_BASE = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI);
// Weight, all in one place. Lean is radians of the whole body about its
// feet: forward per m/s² of acceleration and per m/s of speed, backward
// capped lower than forward because a stop leans back less than a start
// leans in. Bank is radians per (m/s × rad/s) of turning.
const WEIGHT = {
  leanAccel: 0.01, leanSpeed: 0.014, leanFwdMax: 0.16, leanBackMax: 0.12,
  bank: 0.022, bankMax: 0.15,
  // A landing sinks the hips by this many metres per m/s of fall, at most `landMax`.
  land: 0.024, landMax: 0.2,
};
// The phase rate never runs a gait faster than this many cycles a second
// (the walk clip's own cadence is 0.75).
const MAX_CADENCE = 1.6;
// The fastest a body turns, in radians a second: a half turn takes about a quarter second.
const TURN_SPEED = 13;
// Seconds off the ground before a body counts as airborne.
const GROUND_GRACE = 0.1;
// The gait phase a start from standing begins at: the jog has the right foot
// planted and the left passing under the hips there.
const START_PHASE = 0.6;
// Spin, in rad/s, a blow of strength 1 gives the chest.
const ROCK_KICK = 8.5;
// Beyond this angle from the facing, travel plays the cycle backward.
const BACKING = THREE.MathUtils.degToRad(100);
const MAX_HIP_YAW = 1.2;
// The player's suit. Enemy suits are chosen in src/combat/enemies.ts to stay apart from it.
export const PLAYER_SUIT = 0x2a4a9e;
const SUIT = PLAYER_SUIT;
// Stylized proportions: the head and the hands are drawn large.
const HEAD_SCALE = 1.17;
const HAND_SCALE = 1.1;
const BODY_BOUNDS = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.6);
const WHITE = new THREE.Color(1, 1, 1);

// Pulls the torso and arm tracks out of a clip so a gesture plays on the
// upper body while the legs keep their locomotion cycle.
function upperBodyClip(clip: THREE.AnimationClip): THREE.AnimationClip {
  return new THREE.AnimationClip(clip.name + '_upper', clip.duration, clip.tracks.filter((t) => UPPER_BONE.test(t.name.split('.')[0] ?? '')));
}

export interface AvatarOptions { targetHeight?: number; tint?: number; emissive?: number; build?: number; costume?: CostumeId; posture?: Posture }

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
  private layered: { bone: THREE.Bone; clip: THREE.Quaternion; pos: THREE.Vector3 }[] = [];
  // Walk, run and sprint share one phase, so a blend between them keeps a
  // single footfall; it advances at the rate that matches the ground speed.
  private phase = 0;
  private phaseRate = 0;
  private grounded = true;
  private airT = 0;
  private fallSpeed = 0;
  private lastVel = new THREE.Vector3();
  private accel = new THREE.Vector3();
  private lastYaw: number | null = null;
  private yawRate = 0;
  private speed = 0;
  private lean = new Spring(11, 0.6);
  private bank = new Spring(15, 0.8);
  private sink = new Spring(13, 0.55);
  // A blow's rock, as the chest's lean in the root's frame: x to the right, z back.
  private rockX = new Spring(12, 0.32);
  private rockZ = new Spring(12, 0.32);
  private legs: Leg[] = [];
  private posture: Posture | null;

  private oneShot: THREE.AnimationAction | null = null;
  readonly height: number;
  private suit: THREE.MeshToonMaterial;
  private suitGlow = new THREE.Color(0);
  private materials: THREE.MeshToonMaterial[] = [];
  private flashT = 0;
  private gesture: BodyGesture;

  constructor(assets: Assets, which: CharacterModel, opts: AvatarOptions = {}) {
    const gltf = assets.model('characters/human');
    const look = LOOKS[which];
    this.posture = opts.posture ?? null;
    this.clipSpeed = { ...(gltf.userData as { clipSpeeds?: Record<string, number> }).clipSpeeds };
    this.model = cloneSkeleton(gltf.scene);
    const drop: THREE.Object3D[] = [];
    this.suit = toon(opts.tint ?? SUIT, { side: THREE.DoubleSide });
    if (opts.emissive !== undefined) { this.suitGlow.set(opts.emissive).multiplyScalar(0.45); this.suit.emissive.copy(this.suitGlow); }
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
      let mat: THREE.MeshToonMaterial;
      if (o.name.startsWith('Hair_')) mat = toon(look.hairColor);
      else if (o.name === 'Eyes') mat = toon(EYE_WHITE, { map: src.map ?? null });
      else if (o.name === 'Eyebrows') mat = toon(look.hairColor, { map: src.map ?? null, alphaTest: 0.5, transparent: true });
      else mat = toon(SKIN[look.skin]);
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
    // Proportions: the clips never write bone scale, so these hold.
    this.bones.get('Head')?.scale.setScalar(HEAD_SCALE);
    for (const side of ['l', 'r']) this.bones.get(`hand_${side}`)?.scale.setScalar(HAND_SCALE);
    const build = opts.build ?? 1;
    if (build !== 1) for (const n of ['spine_02', 'spine_03']) this.bones.get(n)?.scale.set(build, 1, build);
    // The arms are measured for the gesture layer here, in the T-pose the
    // file binds to, before any clip has posed them.
    this.root.updateMatrixWorld(true);
    const eye = (gltf.userData as { eye?: [number, number, number] }).eye ?? [0, 1.7, 0.07];
    this.gesture = new BodyGesture(this.bones, this.model.localToWorld(new THREE.Vector3(...eye)), target / 1.78);
    // The file's clip speeds come from the library's own skeleton; this body's
    // legs are another length, so each cycle's ground speed is measured on it.
    const gaitClips = GAIT.map((l) => gltf.animations.find((c) => c.name === LOCO_CLIP[l])).filter((c): c is THREE.AnimationClip => !!c);
    Object.assign(this.clipSpeed, measureGroundSpeeds(this.model, this.root, gaitClips, this.bones));

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
    // Bake the idle pose now: the bind pose is a T-pose.
    this.mixer.update(0);
    this.layered = LAYERED.flatMap((n) => { const bone = this.bones.get(n); return bone ? [{ bone, clip: bone.quaternion.clone(), pos: bone.position.clone() }] : []; });
    for (const l of GAIT) this.actions.get(LOCO_CLIP[l])?.setEffectiveTimeScale(0);
    // The legs plant from the heights of the ankle and the ball in the idle stance.
    this.root.updateMatrixWorld(true);
    const k = target / 1.78;
    const above = (b: THREE.Bone) => b.getWorldPosition(new THREE.Vector3()).y - this.root.position.y;
    for (const s of ['l', 'r']) {
      const [hip, knee, ankle, ball] = ['thigh', 'calf', 'foot', 'ball'].map((b) => this.bones.get(`${b}_${s}`));
      if (hip && knee && ankle && ball) this.legs.push(new Leg(hip, knee, ankle, ball, above(ankle), above(ball), k));
    }
    // The costume is placed in this idle pose, before the root ever moves.
    if (opts.costume) this.materials.push(dress(this.model, this.bones, opts.costume, target, build));
  }

  // Locomotion is a blend over speed bands. Walk, run and sprint share one
  // phase, which advances at the rate their blended stride covers the ground
  // speed, so the feet plant instead of sliding, and the legs pin each foot
  // where it lands. `velocity` is in world space; the avatar reads it
  // against its own facing. It also carries the body's weight: acceleration
  // leans it, turning banks it, a landing sinks it.
  setLocomotion(velocity: THREE.Vector3, grounded: boolean, dt: number): void {
    // A body that has fallen keeps the death clip alone.
    if (this.current === 'dead') return;
    const speed = Math.hypot(velocity.x, velocity.z);
    const facing = this.root.getWorldQuaternion(new THREE.Quaternion());
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(facing);
    // Direction of travel as a yaw from the facing, positive to the left.
    const travel = Math.atan2(fwd.z * velocity.x - fwd.x * velocity.z, fwd.x * velocity.x + fwd.z * velocity.z);
    const backing = Math.abs(travel) > BACKING;
    // The physics loses the ground for a frame or two at a sprint; a body
    // that is not rising counts as on its feet until it has been off them
    // for a moment, so a blip neither lifts the planted feet nor blends
    // toward the jump.
    if (!grounded) { this.airT += dt; this.fallSpeed = Math.max(0, -velocity.y); }
    const footed = grounded || (this.airT < GROUND_GRACE && velocity.y < 1);
    const targets: Partial<Record<Locomotion, number>> = {};
    if (!footed) targets.air = 1;
    else if (speed < 0.12) targets.idle = 1;
    else {
      // From a standstill the walk comes in with the speed, so the first
      // steps are short ones rather than a slow-motion stride.
      const move = THREE.MathUtils.smoothstep(speed, 0.12, 0.9);
      const walkRun = THREE.MathUtils.smoothstep(speed, 1.2, 2.6);
      const runSprint = backing ? 0 : THREE.MathUtils.smoothstep(speed, 5.0, 6.2);
      targets.idle = 1 - move;
      targets.walk = move * (1 - walkRun);
      targets.run = move * walkRun * (1 - runSprint);
      targets.sprint = move * walkRun * runSprint;
    }
    // Setting off from a standstill, the stride starts where the clips have
    // both feet under the hips, so blending them in does not swing a foot.
    const gaitNow = GAIT.reduce((s, l) => s + (this.weights[l] ?? 0), 0);
    if (gaitNow < 0.02 && GAIT.some((l) => (targets[l] ?? 0) > 0)) this.phase = START_PHASE;
    let stride = 0, best = 0;
    for (const l of LOOPS) {
      const cur = this.weights[l] ?? 0;
      const w = cur + ((targets[l] ?? 0) - cur) * (1 - Math.exp(-10 * dt));
      this.weights[l] = w;
      if (w > best) { best = w; this.current = l; }
      this.actions.get(LOCO_CLIP[l])?.setEffectiveWeight(w);
      const clip = this.actions.get(LOCO_CLIP[l])?.getClip();
      if (GAIT.includes(l) && clip) stride += w * (this.clipSpeed[clip.name] ?? 1) * clip.duration;
    }
    const walk = this.actions.get(LOCO_CLIP.walk)?.getClip();
    const minStride = walk ? 0.3 * (this.clipSpeed[walk.name] ?? 1) * walk.duration : 0.3;
    this.phaseRate = footed ? Math.min(MAX_CADENCE, speed / Math.max(stride, minStride)) * (backing ? -1 : 1) : 0;
    // Off-axis travel turns the hips so the legs run along it, forward or
    // backward, while the spine twists back so the chest keeps the facing.
    const legs = backing ? Math.atan2(-Math.sin(travel), -Math.cos(travel)) : travel;
    const wantHip = footed && speed > 0.35 ? THREE.MathUtils.clamp(legs, -MAX_HIP_YAW, MAX_HIP_YAW) : 0;
    this.hipYaw += (wantHip - this.hipYaw) * (1 - Math.exp(-8 * dt));

    if (dt > 1e-4) {
      // Acceleration, smoothed so a single uneven frame does not jolt the lean.
      const a = velocity.clone().sub(this.lastVel).divideScalar(dt).setY(0);
      if (a.length() > 80) a.setLength(80);
      this.accel.lerp(a, 1 - Math.exp(-14 * dt));
    }
    this.lastVel.copy(velocity);
    this.speed = speed;
    // A landing: the hips sink by the speed of the fall and spring back.
    if (grounded && this.airT > GROUND_GRACE) this.land(this.fallSpeed);
    if (grounded) this.airT = 0;
    this.grounded = footed;
  }

  // Sinks the hips into a landing from a fall of `speed` m/s; the legs bend under it.
  land(speed: number): void {
    const depth = Math.min(WEIGHT.landMax, speed * WEIGHT.land);
    this.sink.kick(-depth * this.sink.freq * 1.6);
  }

  // A blow arriving along `dir` (world space, the way it travels) with
  // `strength` about 1 for a solid hit: the chest rocks away and back, the
  // hips give, the planted feet hold.
  impact(dir: THREE.Vector3, strength: number): void {
    const q = this.root.getWorldQuaternion(new THREE.Quaternion()).invert();
    const local = dir.clone().setY(0).normalize().applyQuaternion(q);
    // The rock peaks near 0.5 rad per unit of strength: a jab tips the chest a
    // hand's width, a heavy blow throws it back on its heels.
    const s = Math.min(1.1, strength) * ROCK_KICK;
    this.rockX.kick(local.x * s);
    this.rockZ.kick(local.z * s);
  }

  // Turns the body toward `yaw` the way a body turns: quickly, but at a
  // speed it can reach, so a reversal swings round instead of snapping.
  // `rate` is how briskly (about 14 on the move, 8 standing).
  turnTo(yaw: number, dt: number, rate: number): void {
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(this.root.quaternion);
    const facing = Math.atan2(-f.x, -f.z);
    const d = Math.atan2(Math.sin(yaw - facing), Math.cos(yaw - facing));
    const max = TURN_SPEED * dt;
    this.root.rotation.set(0, facing + THREE.MathUtils.clamp(d * (1 - Math.exp(-rate * dt)), -max, max), 0);
  }

  // The locomotion loops also write the upper bones, and the mixer shares a
  // bone by weight, so `weight` is this clip's share against theirs: 1 is
  // an even blend, 3 lets the clip own three quarters of the pose.
  playUpper(clipName: string, timeScale = 1, weight = 1): void {
    const a = this.upper.get(clipName);
    if (!a) return;
    a.reset();
    a.setEffectiveTimeScale(timeScale);
    a.setEffectiveWeight(weight);
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
    this.gesture.release();
    for (const a of this.actions.values()) a.fadeOut(0.15);
    const d = this.actions.get(LOCO_CLIP.dead);
    if (d) { d.reset(); d.setLoop(THREE.LoopOnce, 1); d.clampWhenFinished = true; d.setEffectiveWeight(1); d.fadeIn(0.1).play(); }
    this.current = 'dead';
  }

  // Back on its feet after a down in an online room: the death pose fades
  // and the locomotion loops take the body again from idle.
  revive(): void {
    this.actions.get(LOCO_CLIP.dead)?.fadeOut(0.2);
    for (const l of LOOPS) {
      const a = this.actions.get(LOCO_CLIP[l]);
      if (!a) continue;
      a.reset().play();
      this.weights[l] = l === 'idle' ? 1 : 0;
      a.setEffectiveWeight(this.weights[l]!);
    }
    this.current = 'idle';
  }

  // Online, each player wears their seat's suit colour on every screen.
  setSuit(color: number): void { this.suit.color.set(color); }

  // Pitch of the aim in radians, positive looking up.
  setAimPitch(p: number): void { this.aimPitch = p; }

  // Plays a gesture on the arms and chest (src/character/gesture.ts): a
  // cast, the full sign, an enemy's wind-up. A gesture that holds keeps its
  // last pose until `release`.
  perform(g: Gesture, speed = 1): void {
    if (this.current === 'dead') return;
    for (const a of this.upper.values()) if (a.isRunning()) a.fadeOut(0.08);
    this.root.updateMatrixWorld(true);
    this.gesture.play(g, speed, this.root);
  }

  release(only?: Gesture): void { this.gesture.release(only); }
  get performing(): boolean { return this.gesture.playing; }

  // A clash stance (src/combat/clash.ts), read from the whole body because a
  // robe hides the legs, and shaped to read in profile from the side-on clash
  // shot: a push leans in with both palms driven out level at the opponent;
  // a hold settles back and low with the forearms crossed before the chest;
  // a feint darts half in and out again, the chest turned away and the rear
  // arm swept back. Null is the clip's own pose.
  stance: Stance | null = null;
  private stanceAmt: Record<Stance, number> = { push: 0, hold: 0, feint: 0 };
  private stanceT = 0;

  private applyStance(dt: number): void {
    this.stanceT += dt;
    let any = false;
    for (const k of STANCES) {
      const want = this.stance === k ? 1 : 0;
      this.stanceAmt[k] += (want - this.stanceAmt[k]) * (1 - Math.exp(-(want ? 10 : 7) * dt));
      if (this.stanceAmt[k] > 0.002) any = true;
    }
    if (!any) return;
    const { push, hold, feint } = this.stanceAmt;
    const rootQ = this.root.getWorldQuaternion(new THREE.Quaternion());
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(rootQ);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(rootQ);
    // The feint's dart: in toward the opponent and straight back out.
    const dart = Math.max(0, Math.sin(this.stanceT * 9));
    this.root.position.addScaledVector(fwd, push * 0.3 - hold * 0.08 + feint * (dart * 0.26 - 0.06));
    this.root.position.y -= hold * 0.07;
    this.model.updateMatrixWorld(true);
    for (const sp of SPINE) {
      // Negative about the right axis leans forward.
      this.rotateAbout(sp, right, -push * 0.11 + hold * 0.06 + feint * (0.08 - dart * 0.1));
      this.rotateAbout(sp, UP, feint * 0.16);
    }
    this.rotateAbout('Head', right, push * 0.3 - hold * 0.2);
    this.rotateAbout('Head', UP, -feint * 0.35);
    for (const [side, m] of [['r', 1], ['l', -1]] as const) {
      const arm = `upperarm_${side}`, fore = `lowerarm_${side}`;
      // Both palms driven out level at the opponent.
      this.rotateAbout(arm, right, push * 1.2);
      this.rotateAbout(arm, UP, m * push * 0.2);
      this.rotateAbout(fore, UP, m * push * -0.2);
      this.rotateAbout(fore, right, push * -0.35);
      // Forearms crossed in an X before the chest.
      this.rotateAbout(arm, right, hold * 0.55);
      this.rotateAbout(arm, UP, m * hold * 0.75);
      this.rotateAbout(fore, UP, m * hold * 1.7);
      this.rotateAbout(fore, right, hold * 0.6);
    }
    // The rear arm swept back behind her, the lead hand up as a lure.
    this.rotateAbout('upperarm_l', right, -feint * 0.6);
    this.rotateAbout('upperarm_l', fwd, feint * 0.35);
    this.rotateAbout('upperarm_r', right, feint * 1.1);
    this.rotateAbout('lowerarm_r', right, feint * 0.6);
  }

  flash(intensity: number): void { this.flashT = intensity; }

  // The body's weight over the clip: the legs read where the clip puts the
  // feet, then the body leans, banks, sinks and rocks about them, and the
  // legs put the planted feet back on the ground where they landed.
  private applyWeight(dt: number): void {
    const rootQ = this.root.getWorldQuaternion(new THREE.Quaternion());
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(rootQ);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(rootQ);
    const yaw = Math.atan2(-fwd.x, -fwd.z);
    if (this.lastYaw !== null && dt > 1e-4) {
      const d = Math.atan2(Math.sin(yaw - this.lastYaw), Math.cos(yaw - this.lastYaw));
      this.yawRate += (THREE.MathUtils.clamp(d / dt, -20, 20) - this.yawRate) * (1 - Math.exp(-12 * dt));
    }
    this.lastYaw = yaw;

    const ground = this.root.position.y;
    const posing = this.stance !== null || STANCES.some((k) => this.stanceAmt[k] > 0.01);
    const canPlant = this.grounded && !posing;
    const [a, b] = this.legs;
    if (a && b) { a.sample(ground, canPlant, b.stepping, dt); b.sample(ground, canPlant, a.stepping, dt); }

    const W = WEIGHT;
    const leanTo = this.grounded ? THREE.MathUtils.clamp(this.accel.dot(fwd) * W.leanAccel + this.speed * W.leanSpeed, -W.leanBackMax, W.leanFwdMax) : this.speed * W.leanSpeed;
    const bankTo = THREE.MathUtils.clamp(this.yawRate * this.speed * W.bank, -W.bankMax, W.bankMax);
    const lean = this.lean.step(posing ? 0 : leanTo, dt);
    const bank = this.bank.step(posing ? 0 : bankTo, dt);
    const sink = this.sink.step(0, dt);
    const rx = this.rockX.step(0, dt), rz = this.rockZ.step(0, dt);

    // The whole body tips about its feet: forward into a start, back out of a stop, in toward a turn.
    this.model.quaternion.premultiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-lean, 0, bank)));
    this.model.updateMatrixWorld(true);
    // A blow rocks the chest away from it and shoves the hips after it; a landing sinks the hips and folds the chest over them.
    const rock = right.clone().multiplyScalar(rx).addScaledVector(fwd, -rz);
    const amt = rock.length();
    const pelvis = this.bones.get('pelvis');
    if (pelvis?.parent && (Math.abs(sink) > 1e-4 || amt > 1e-4)) {
      const at = pelvis.getWorldPosition(new THREE.Vector3()).addScaledVector(rock, 0.12 * this.height / 1.78);
      at.y += sink - amt * 0.05;
      pelvis.position.copy(pelvis.parent.worldToLocal(at));
      pelvis.updateMatrixWorld(true);
    }
    if (amt > 1e-4) {
      const axis = new THREE.Vector3().crossVectors(UP, rock).normalize();
      this.rotateAbout('spine_01', axis, amt * 0.25);
      this.rotateAbout('spine_02', axis, amt * 0.3);
      this.rotateAbout('spine_03', axis, amt * 0.3);
      this.rotateAbout('Head', axis, amt * 0.4);
    }
    for (const s of SPINE) this.rotateAbout(s, right, sink * 0.6);
    for (const leg of this.legs) leg.solve(right);
  }

  update(dt: number): void {
    // The mixer only writes a bone whose blended value changed since its last
    // write, so a bone held still by its clips (spine_01 in every locomotion
    // clip) would keep last frame's turn and gain another each frame. Hand the
    // mixer back the pose it wrote before layering on top of it again.
    this.gesture.restore();
    for (const l of this.layered) { l.bone.quaternion.copy(l.clip); l.bone.position.copy(l.pos); }
    this.model.quaternion.copy(MODEL_BASE);
    this.phase = (((this.phase + this.phaseRate * dt) % 1) + 1) % 1;
    for (const l of GAIT) { const a = this.actions.get(LOCO_CLIP[l]); if (a) a.time = this.phase * a.getClip().duration; }
    this.mixer.update(dt);
    for (const l of this.layered) { l.clip.copy(l.bone.quaternion); l.pos.copy(l.bone.position); }
    if (this.oneShot && !this.oneShot.isRunning()) { this.oneShot.fadeOut(0.2); this.oneShot = null; }
    if (this.current === 'dead') for (const leg of this.legs) leg.release();
    if (this.current !== 'dead') {
      this.root.updateMatrixWorld(true);
      this.rotateAbout('pelvis', UP, this.hipYaw);
      for (const s of SPINE) this.rotateAbout(s, UP, -this.hipYaw / 3);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.root.getWorldQuaternion(new THREE.Quaternion()));
      this.rotateAbout('spine_02', right, this.aimPitch * 0.3);
      this.rotateAbout('spine_03', right, this.aimPitch * 0.25);
      this.rotateAbout('Head', right, this.aimPitch * 0.35);
      if (this.posture) {
        // A clash stance takes the whole body; otherwise the role's carriage
        // sits under everything, and a gesture blends its arms from it.
        const stance = Math.max(...STANCES.map((k) => this.stanceAmt[k]));
        const rootQ = this.root.getWorldQuaternion(new THREE.Quaternion());
        const moving = (this.weights.run ?? 0) + (this.weights.sprint ?? 0);
        applyPosture(this.posture, (b, axis, angle) => this.rotateAbout(b, axis, angle), right, new THREE.Vector3(0, 0, -1).applyQuaternion(rootQ), UP, 1 - stance, Math.min(1, moving));
      }
      this.gesture.apply(dt, this.root, (b, axis, angle) => this.rotateAbout(b, axis, angle), right, this.aimPitch);
      this.applyStance(dt);
      this.applyWeight(dt);
    }
    this.flashT *= Math.exp(-12 * dt);
    for (const m of this.materials) m.emissive.setScalar(this.flashT * 0.8);
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
