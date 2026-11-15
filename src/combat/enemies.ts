import * as THREE from 'three';
import type { Game } from '../app/game';
import { Avatar, type CharacterModel } from '../character/avatar';
import type { CostumeId } from '../character/costume';
import { POSTURES, type Posture } from '../character/posture';
import { RAPIER, GROUP_ENEMY, GROUP_WORLD, GROUP_PROP, groups } from '../physics/world';
import { AURA, AuraField } from './field';
import { BOSS_ULTIMATES } from './ultimates';
import { MOVES } from './moves';
import { ATTACKS, inAttack, markOrigin, reachOf, type AttackDef } from './attacks';
import { DANGER, Echo, Fuse, GHOST } from './bosses';
import type { Mark } from '../techniques/mark';

// 'rival' is another player in an online room (src/net/remote.ts): no AI, its
// body follows the network and its hits go to the server.
export type EnemyAi = 'thug' | 'kuroda' | 'ancient' | 'dummy' | 'rival';
// `tint` is the suit: one flat, saturated colour per role, far from any skin
// tone. `costume` is what the role wears over it (src/character/costume.ts):
// with `height`, `build` (the chest's width) and `posture` (src/character/posture.ts) it gives each role its own
// silhouette from the top-down camera. A rival (another player) wears none.
export interface EnemyDef { name: string; model: CharacterModel; costume?: CostumeId; hp: number; speed: number; dmg: number; ai: EnemyAi; boss?: boolean; tint?: number; emissive?: number; height?: number; build?: number; title?: string; posture?: Posture }

export const ENEMY_DEFS: Record<string, EnemyDef> = {
  thug: { name: 'Underworld Thug', model: 'bald', costume: 'thug', posture: POSTURES.thug, hp: 70, speed: 3.6, dmg: 11, ai: 'thug', tint: 0x5b5560 },
  bruiser: { name: 'Bristle Brawler', model: 'beard', costume: 'bruiser', posture: POSTURES.bruiser, hp: 120, speed: 3.0, dmg: 16, ai: 'thug', tint: 0x9b2335, height: 1.95, build: 1.18 },
  kuroda: { name: 'Kuroda Enforcer', model: 'parted', costume: 'kuroda', posture: POSTURES.kuroda, hp: 620, speed: 3.2, dmg: 15, ai: 'kuroda', boss: true, tint: 0xd4661a, emissive: 0xff3a00, height: 1.9, build: 1.1, title: 'Kuroda Enforcer' },
  ancient: { name: 'The Ancient Echo Master', model: 'long', costume: 'ancient', posture: POSTURES.ancient, hp: 1300, speed: 1.7, dmg: 20, ai: 'ancient', boss: true, tint: 0xeef3ea, emissive: 0x7dffb2, height: 1.7, build: 0.94, title: 'The Ancient Echo Master' },
  dummy: { name: 'Training Dummy', model: 'buzzed', costume: 'dummy', hp: 100000, speed: 0, dmg: 0, ai: 'dummy', tint: 0x8c9a7a },
  // Rooftop-trial roster: the same thug AI at other speeds, weights and hit points.
  runner: { name: 'Spring Leaper', model: 'buzzed', costume: 'runner', posture: POSTURES.runner, hp: 52, speed: 5.2, dmg: 14, ai: 'thug', tint: 0x2f9e5a, height: 1.72, build: 0.92 },
  husk: { name: 'Husk Shell', model: 'beard', costume: 'husk', posture: POSTURES.husk, hp: 190, speed: 2.3, dmg: 20, ai: 'thug', tint: 0x6b2f6e, height: 2.05, build: 1.24 },
  rival: { name: 'Rival', model: 'parted', hp: 100, speed: 0, dmg: 0, ai: 'rival', height: 1.78 },
};

// Seconds from the start of a cast to its effect landing.
export const CAST_SECONDS = 1.1;

export interface EnemyScale { hp: number; dmg: number }
export const NO_SCALE: EnemyScale = { hp: 1, dmg: 1 };

const STILL = new THREE.Vector3();
const CORPSE_SECONDS = 6;
// How hard a thrown body's skid brakes on the ground, in m/s².
const KNOCK_FRICTION = 9;
const CAM_RIGHT = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const INK = 0x17110c;
// A boss shrugs off blows until enough land close together (Sekiro's
// posture): only then does it stagger, so its wind-ups are not chipped away.
const POISE: Partial<Record<EnemyAi, number>> = { kuroda: 70, ancient: 130 };
const POISE_DECAY = 14;
// How far the Enforcer wants to stand from the player when he pours.
const POUR_RANGE = 5;

// A thin bar above the head that appears once the enemy is hurt. The sprites
// live in the scene, not on the avatar, so the avatar's yaw does not swing them.
class HealthBar {
  private back = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x05060a, transparent: true, opacity: 0.75, depthTest: false }));
  private fill = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xff5a4a, transparent: true, depthTest: false }));
  private static readonly W = 0.8;

  constructor(scene: THREE.Object3D, private lift: number) {
    for (const s of [this.back, this.fill]) { s.renderOrder = 20; s.visible = false; scene.add(s); }
    this.back.scale.set(HealthBar.W + 0.04, 0.09, 1);
  }

  // `right` is the camera's right vector: a shrinking fill keeps its left edge by sliding that way.
  update(at: THREE.Vector3, frac: number, right: THREE.Vector3): void {
    const show = frac < 0.999 && frac > 0;
    this.back.visible = this.fill.visible = show;
    if (!show) return;
    this.back.position.set(at.x, at.y + this.lift, at.z);
    this.fill.position.copy(this.back.position).addScaledVector(right, -HealthBar.W * (1 - frac) / 2);
    this.fill.scale.set(Math.max(0.001, HealthBar.W * frac), 0.06, 1);
  }

  dispose(): void { this.back.removeFromParent(); this.fill.removeFromParent(); }
}

type State = 'idle' | 'chase' | 'windup' | 'strike' | 'recover' | 'stagger' | 'knocked' | 'dead' | 'cast';

export class Enemy {
  readonly avatar: Avatar;
  readonly position: THREE.Vector3;
  readonly velocity = new THREE.Vector3();
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  private ctrl: RAPIER.KinematicCharacterController;
  yaw = 0;
  hp: number;
  readonly maxHp: number;
  state: State = 'idle';
  // Seconds in the current state.
  private t = 0;
  alive = true;
  grounded = true;
  resonance = 0;
  frozen = 0;
  slow = 1;
  readonly def: EnemyDef;
  // The Master's aura field (issue #4), null for everyone without one.
  field: AuraField | null = null;
  // Seconds this body is held in place: a clash (Infinity while it lasts),
  // or the moment after losing one.
  locked = 0;
  // Seconds left of a broken guard after losing a clash: blows land harder.
  guardBroken = 0;
  // Seconds until this body may start its next blow and its next cast. The
  // Horizon Eye reads them to see what a body can do next (src/eyes/horizon.ts).
  attackCd = 1;
  castCd = 4;
  damageTaken = 0;
  // The melee blow this role throws, the wind-up's mark on the ground, and
  // the heading it locked to when it committed.
  readonly attack: AttackDef;
  private mark: Mark | null = null;
  // Inside the player's field a blow is sensed before it starts: its mark
  // lies on the ground, unswept, until the wind-up takes it over.
  private omen: Mark | null = null;
  private committed = false;
  private lungeLeft = 0;
  private poise = 0;
  // Kuroda's pour in flight; the Master's echoes still to land.
  private fuse: Fuse | null = null;
  private echoes: Echo[] = [];
  private castMark: Mark | null = null;
  // The Master's measured step away from a player who closes in.
  private glide = 0;
  private glideDir = new THREE.Vector3();
  private stepCd = 2;
  private phase2 = false;
  private backT = 0;
  private circle = Math.random() < 0.5 ? 1 : -1;
  // A thrown body's smear and the ground it hits.
  private airT = 0;
  private smearT = 0;
  private lastCenter = new THREE.Vector3();
  readonly key: string;
  readonly dmg: number;
  private bar: HealthBar | null = null;
  private deadT = 0;
  disposed = false;

  constructor(protected game: Game, key: string, pos: THREE.Vector3, scale: EnemyScale = NO_SCALE, showBar = false, def: EnemyDef = ENEMY_DEFS[key]!) {
    this.key = key;
    this.def = def;
    this.hp = this.maxHp = def.hp * scale.hp;
    this.dmg = def.dmg * scale.dmg;
    this.position = pos.clone();
    this.avatar = new Avatar(game.assets, def.model, { targetHeight: def.height ?? 1.8, tint: def.tint, emissive: def.emissive, build: def.build, costume: def.costume, posture: def.posture });
    this.avatar.root.position.copy(pos);
    game.renderer.scene.add(this.avatar.root);
    const h = def.height ?? 1.8, r = 0.36;
    this.body = game.physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y + h / 2, pos.z));
    this.collider = game.physics.world.createCollider(RAPIER.ColliderDesc.capsule(h / 2 - r, r).setCollisionGroups(groups(GROUP_ENEMY, GROUP_WORLD | GROUP_PROP | GROUP_ENEMY)), this.body);
    this.ctrl = game.physics.world.createCharacterController(0.03);
    this.ctrl.enableAutostep(0.4, 0.2, true);
    this.ctrl.enableSnapToGround(0.3);
    this.ctrl.setApplyImpulsesToDynamicBodies(true);
    this.ctrl.setCharacterMass(90);
    (this.collider as RAPIER.Collider & { enemy?: Enemy }).enemy = this;
    if (showBar && !def.boss && def.ai !== 'dummy') this.bar = new HealthBar(game.renderer.scene, h + 0.35);
    if (def.ai === 'ancient') this.field = new AuraField(AURA.master.recovers);
    this.attack = ATTACKS[key] ?? ATTACKS[def.ai] ?? ATTACKS.thug!;
  }

  get height(): number { return this.def.height ?? 1.8; }
  get isBoss(): boolean { return !!this.def.boss; }
  center(): THREE.Vector3 { return this.position.clone().add(new THREE.Vector3(0, this.height * 0.55, 0)); }

  hurt(amount: number, opts: { from?: THREE.Vector3; knock?: number; lift?: number; stagger?: boolean } = {}): void {
    if (!this.alive) return;
    this.hp -= amount;
    this.damageTaken += amount;
    this.avatar.flash(1.2);
    const from = opts.from ?? this.game.player.position;
    const away = this.position.clone().sub(from).setY(0).normalize();
    const knock = (opts.knock ?? 0) * (this.isBoss ? 0.25 : 1);
    // The body rocks away from the blow, by its weight and the blow's: a jab
    // jolts the chest, a heavy blow throws it back on its heels.
    this.avatar.impact(away, (0.35 + Math.min(1, amount / 40) * 0.5 + knock * 0.12) * (this.def.ai === 'ancient' ? 0.35 : this.isBoss ? 0.6 : 1));
    if (this.def.ai === 'dummy') { this.avatar.playOneShot('Hit_Chest'); return; }
    const poise = POISE[this.def.ai];
    if (poise !== undefined) {
      // Under its posture the boss takes the blow and carries on with what it was doing.
      this.poise += amount;
      if (knock > 0) this.velocity.addScaledVector(away, knock);
      if (this.hp <= 0) { this.die(); return; }
      if (this.poise < poise) return;
      this.poise = 0;
      this.setState('stagger');
      this.avatar.playOneShot('Hit_Chest');
      this.game.vfx.glint(this.center().add(new THREE.Vector3(0, 0.5, 0)), 0.7, 0.3);
      return;
    }
    if (knock > 0) {
      this.velocity.addScaledVector(away, knock);
      this.velocity.y += (opts.lift ?? knock * 0.35) * (this.isBoss ? 0.3 : 1);
      if (knock > 4 && !this.isBoss) { this.setState('knocked'); this.airT = 0; this.lastCenter.copy(this.center()); this.avatar.playOneShot('Hit_Head'); }
      else if (opts.stagger !== false) { this.setState('stagger'); this.avatar.playOneShot('Hit_Chest'); }
    } else if (opts.stagger !== false && this.state !== 'knocked') { this.setState('stagger'); this.avatar.playOneShot('Hit_Chest'); }
    if (this.hp <= 0) this.die();
  }

  die(): void {
    if (!this.alive) return;
    this.alive = false;
    this.setState('dead');
    this.game.audio.play('body.down', { at: this.position });
    this.avatar.die();
    this.game.physics.world.removeCollider(this.collider, false);
    this.field?.end('spent');
    this.bar?.dispose();
  }

  // The body lies where it fell for a few seconds, still animating, then goes.
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.fuse?.end();
    for (const e of this.echoes) e.end();
    this.echoes.length = 0;
    this.game.renderer.scene.remove(this.avatar.root);
    this.game.physics.world.removeRigidBody(this.body);
  }

  // Holds the body where it stands for `seconds`, dropping whatever it was doing.
  hold(seconds: number): void {
    this.locked = seconds;
    if (this.alive && this.def.ai !== 'dummy' && this.def.ai !== 'rival') { this.setState('chase'); this.attackCd = Math.max(this.attackCd, 0.6); }
  }

  // Every change of state goes through here, so a wind-up or a cast that is
  // cut short always takes its mark off the ground with it.
  get stateTime(): number { return this.t; }
  // Where the Kuroda's pour lies while it waits to burn, for the Thread Eye.
  get pour(): THREE.Vector3[] { return this.fuse && !this.fuse.done ? this.fuse.waiting : []; }

  // Drops whatever the body was doing for a moment, as a blow does.
  stagger(): void {
    if (!this.alive || this.def.ai === 'dummy' || this.def.ai === 'rival' || this.state === 'knocked') return;
    this.setState('stagger'); this.avatar.playOneShot('Hit_Chest');
  }

  private setState(next: State): void {
    if (this.state === 'windup' && next !== 'strike') { this.mark?.cancel(); this.mark = null; }
    if (next !== 'chase' && next !== 'windup') this.foresee(false);
    if (this.state === 'cast' && next !== 'recover') { this.castMark?.cancel(); this.castMark = null; this.fuse?.fizzle(); }
    this.state = next;
    this.t = 0;
  }

  private face(target: THREE.Vector3, dt: number, rate = 8): void {
    const d = target.clone().sub(this.position);
    const want = Math.atan2(-d.x, -d.z);
    let diff = want - this.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.yaw += diff * (1 - Math.exp(-rate * dt));
  }

  update(dt: number): void {
    if (this.disposed) return;
    if (!this.alive && (this.deadT += dt) > CORPSE_SECONDS) { this.dispose(); return; }
    const g = this.game;
    const p = g.player.position;
    const toP = p.clone().sub(this.position).setY(0);
    const dist = toP.length();
    const def = this.def;
    this.t += dt;
    this.attackCd -= dt;
    this.castCd -= dt;
    this.frozen = Math.max(0, this.frozen - dt);
    this.locked = Math.max(0, this.locked - dt);
    this.guardBroken = Math.max(0, this.guardBroken - dt);
    this.resonance = Math.max(0, this.resonance - dt * 0.5);
    this.slow = THREE.MathUtils.lerp(this.slow, 1, 1 - Math.exp(-1.5 * dt));
    const move = new THREE.Vector3();
    const hindered = g.aura.hinder(this);
    const sensed = this.alive && g.aura.senses(this.position);
    const speed = def.speed * this.slow * hindered * (this.frozen > 0 ? 0 : 1);

    this.poise = Math.max(0, this.poise - POISE_DECAY * dt);
    this.stepCd -= dt;
    if (this.fuse) { this.fuse.update(dt); if (this.fuse.done) this.fuse = null; }
    for (let i = this.echoes.length - 1; i >= 0; i--) { this.echoes[i]!.update(dt); if (this.echoes[i]!.done) this.echoes.splice(i, 1); }
    const atk = this.attack;

    if (this.alive && def.ai !== 'dummy' && this.locked <= 0) {
      switch (this.state) {
        case 'idle':
          if (dist < 26) this.setState('chase');
          break;
        case 'chase': {
          this.chase(move, toP, dist, speed, dt);
          if (dist <= reachOf(atk) + 0.3 && this.attackCd <= 0 && this.frozen <= 0 && this.glide <= 0 && g.encounters.claimAttack()) this.beginWindup();
          else if (def.ai !== 'thug' && this.castCd <= 0 && dist < 22 && this.frozen <= 0 && this.glide <= 0 && (def.ai !== 'kuroda' || dist > POUR_RANGE || this.backT > 1.5)) {
            // A boss with a Maximum Output reaches for it in place of a cast when it is ready.
            const ult = BOSS_ULTIMATES[def.ai];
            if (ult && dist < ult.cutscene.reach && ult.ready(this) && g.encounters.bossUltimate(this)) { this.setState('recover'); this.castCd = 8; }
            else { this.setState('cast'); this.avatar.perform(def.ai === 'ancient' ? MOVES.wave : MOVES.fuel); this.beginCast(); }
          }
          break;
        }
        case 'windup': {
          const windup = atk.windup / hindered;
          // It tracks the player until it commits; from then on a step aside is a dodge.
          if (!this.committed) this.face(p, dt, 12);
          if (!this.committed && this.t > windup * atk.commit) {
            this.committed = true;
            g.vfx.glint(this.center().add(new THREE.Vector3(0, this.height * 0.45, 0)), 0.5, 0.2, () => this.center().add(new THREE.Vector3(0, this.height * 0.45, 0)));
          }
          if (this.mark) { this.mark.place(markOrigin(atk, this.position, this.yaw), this.yaw); this.mark.progress = this.t / windup; this.mark.glow = sensed ? AURA.sense.glow : 0; }
          if (this.t > windup) { this.setState('strike'); this.strike(); }
          break;
        }
        case 'strike':
          if (this.lungeLeft > 0) {
            const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
            move.copy(fwd).multiplyScalar(atk.lunge! / 0.16);
            this.lungeLeft -= dt;
          }
          if (this.t > 0.18) { this.lungeLeft = 0; this.setState('recover'); }
          break;
        case 'recover':
          if (this.t > atk.recover) { this.setState('chase'); this.attackCd = def.ai === 'thug' ? 1.2 + Math.random() * 0.8 : 1.8; }
          break;
        case 'stagger':
          if (this.t > 0.45) this.setState('chase');
          break;
        case 'knocked':
          if (this.grounded && this.t > 0.6 && Math.hypot(this.velocity.x, this.velocity.z) < 1) this.setState('recover');
          break;
        case 'cast':
          this.face(p, dt, def.ai === 'ancient' ? 2.5 : 4);
          if (this.castMark) { this.castMark.progress = this.t / CAST_SECONDS; this.castMark.glow = sensed ? AURA.sense.glow * 0.5 : 0; }
          if (this.t > CAST_SECONDS) { this.resolveCast(); this.setState('recover'); this.castCd = def.ai === 'kuroda' ? (this.phase2 ? 4 : 5) : 6.5; }
          break;
      }
    }
    this.foresee(sensed && this.state === 'chase' && this.locked <= 0 && def.ai !== 'dummy' && this.attackCd < AURA.sense.lead && dist <= reachOf(atk) + 1.5);
    if (this.state === 'knocked') {
      // Thrown: no footing in the air, and on the ground a skid that the
      // feet fight with steps until it stops, rather than a glide.
      const v = Math.hypot(this.velocity.x, this.velocity.z);
      const slow = this.grounded ? Math.max(0, v - KNOCK_FRICTION * dt) / (v || 1) : Math.exp(-0.4 * dt);
      this.velocity.x *= slow; this.velocity.z *= slow;
    } else {
      this.velocity.x = THREE.MathUtils.lerp(this.velocity.x, move.x, 1 - Math.exp(-10 * dt));
      this.velocity.z = THREE.MathUtils.lerp(this.velocity.z, move.z, 1 - Math.exp(-10 * dt));
    }
    this.velocity.y -= 20 * dt;
    const step = this.velocity.clone().multiplyScalar(dt);
    this.ctrl.computeColliderMovement(this.collider, step, undefined, groups(GROUP_ENEMY, GROUP_WORLD | GROUP_PROP | GROUP_ENEMY));
    const out = this.ctrl.computedMovement();
    this.grounded = this.ctrl.computedGrounded();
    this.position.x += out.x; this.position.y += out.y; this.position.z += out.z;
    if (this.grounded && this.velocity.y < 0) this.velocity.y = 0;
    if (this.alive && (this.state === 'knocked' || this.airT > 0)) this.thrown(dt);
    this.body.setNextKinematicTranslation({ x: this.position.x, y: this.position.y + this.height / 2, z: this.position.z });

    this.avatar.root.position.copy(this.position);
    this.avatar.root.rotation.y = this.yaw;
    this.avatar.setLocomotion(this.alive ? this.velocity : STILL, this.grounded, dt);
    if (this.resonance > 0) this.avatar.root.position.x += (Math.random() - 0.5) * this.resonance * 0.03;
    this.avatar.update(dt);
    if (this.bar) this.bar.update(this.position, this.alive ? this.hp / this.maxHp : 0, CAM_RIGHT.set(1, 0, 0).applyQuaternion(this.game.renderer.camera.quaternion));
    // Her field opens whenever her aura is full, and under a roof it closes in
    // to fit the room it fills: the hall is 28 by 16 m, and a field of the
    // yard's reach would cover all of it and pass out through its walls.
    const f = this.field;
    if (f) {
      f.reach = g.world.indoorsAt(this.position) > 0 ? AURA.master.reach.indoors : AURA.master.reach.outdoors;
      if (this.alive && f.ready && this.locked <= 0) f.expand(f.reach, AURA.master.density, Infinity);
      f.update(dt);
    }
  }

  // Walks in to its reach. The Master does not walk to anyone: she turns
  // slowly to face them, lets them come, and takes one measured step away
  // from a player who crowds her, leaving an echo of where she stood.
  private chase(move: THREE.Vector3, toP: THREE.Vector3, dist: number, speed: number, dt: number): void {
    const g = this.game, p = g.player.position;
    if (this.def.ai === 'kuroda' && this.castCd < 1.2 && dist < POUR_RANGE) {
      // He gives ground before a pour, circling off at an angle: the fuel needs a line to run along.
      this.face(p, dt);
      this.backT += dt;
      move.copy(toP).normalize().negate().applyAxisAngle(UP, this.circle * 0.9).multiplyScalar(speed * 0.85);
      return;
    }
    this.backT = 0;
    if (this.def.ai !== 'ancient') {
      this.face(p, dt);
      if (dist > reachOf(this.attack)) move.copy(toP).normalize().multiplyScalar(speed);
      return;
    }
    this.face(p, dt, 2.5);
    if (this.glide > 0) {
      this.glide -= dt;
      move.copy(this.glideDir).multiplyScalar(7.5);
      return;
    }
    if (dist < 3.6 && this.stepCd <= 0 && this.frozen <= 0) {
      const side = Math.random() < 0.5 ? 1 : -1;
      this.glideDir.copy(toP).normalize().negate().applyAxisAngle(new THREE.Vector3(0, 1, 0), side * 0.7);
      this.glide = 0.3;
      this.stepCd = 3.2;
      g.vfx.afterimage(this.avatar.root, GHOST, 0.7, false);
      return;
    }
    if (dist > reachOf(this.attack)) move.copy(toP).normalize().multiplyScalar(speed);
  }

  // The sensed blow: while `want` holds, its mark lies where it will land,
  // faint and unswept.
  private foresee(want: boolean): void {
    if (!want) { this.omen?.cancel(); this.omen = null; return; }
    const a = this.attack;
    this.omen ??= this.game.vfx.mark(a.shape, DANGER, markOrigin(a, this.position, this.yaw), this.yaw);
    this.omen.place(markOrigin(a, this.position, this.yaw), this.yaw);
    this.omen.mat.uniforms.opacity!.value = 0.6;
    this.omen.glow = AURA.sense.glow;
  }

  private beginWindup(): void {
    const g = this.game, a = this.attack;
    this.setState('windup');
    this.committed = false;
    this.avatar.perform(a.move, a.move.impactAt / a.windup);
    this.mark = this.omen ?? g.vfx.mark(a.shape, DANGER, markOrigin(a, this.position, this.yaw), this.yaw);
    this.mark.mat.uniforms.opacity!.value = this.mark.peak;
    this.omen = null;
    g.audio.play('enemy.swing', { at: this.center(), pitch: a.pitch });
  }

  private strike(): void {
    const g = this.game, a = this.attack;
    this.mark?.fire();
    this.mark = null;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const c = this.center();
    if (inAttack(a, this.position, this.yaw, g.player.position)) {
      const dealt = g.combat.hurtPlayer(this.dmg * a.dmg, { from: c, kinetic: true });
      if (dealt > 0) g.vfx.burst(g.player.position.clone().add(new THREE.Vector3(0, 1.1, 0)), a.heavy ? 10 : 5, 'spark', a.heavy ? 5 : 3.5, 0xfff0d0, fwd);
    }
    if (a.lunge) {
      this.lungeLeft = 0.16;
      g.vfx.trail([c.clone().addScaledVector(fwd, -0.4), c.clone().addScaledVector(fwd, a.lunge * 0.6), c.clone().addScaledVector(fwd, a.lunge + 0.6)], INK, 0.55, 0.2);
    } else if (a.heavy) {
      // Both fists come down: a stroke from over the head to the ground ahead,
      // and the ground answers with a dust ring and chips of it.
      const hit = markOrigin(a, this.position, this.yaw);
      const top = c.clone().add(new THREE.Vector3(0, this.height * 0.6, 0)).addScaledVector(fwd, 0.2);
      g.vfx.trail([top, top.clone().lerp(hit, 0.5).addScaledVector(fwd, 0.5).setY(top.y * 0.7), hit.clone().setY(hit.y + 0.15)], INK, 0.5, 0.2);
      g.vfx.ring(hit.clone().setY(hit.y + 0.06), 0x9c8b72, 0.3, a.shape.kind === 'sector' ? a.shape.radius * 1.15 : 2, 0.4);
      g.vfx.burst(hit.clone().setY(hit.y + 0.1), 7, 'debris', 4.5);
      g.cam.shake(0.18);
      g.audio.play('prop.land', { at: hit, pitch: 0.7 });
    } else if (this.def.ai !== 'ancient') {
      // A jab's smear: the fist's path from the shoulder out to its reach.
      const reach = a.shape.kind === 'sector' ? a.shape.radius : 2;
      const from = c.clone().addScaledVector(right, 0.22).addScaledVector(fwd, 0.25);
      g.vfx.trail([from, from.clone().addScaledVector(fwd, reach * 0.5), from.clone().addScaledVector(fwd, reach * 0.9).addScaledVector(right, -0.15)], INK, 0.26, 0.14);
    }
    if (this.def.ai === 'ancient') {
      g.vfx.ring(this.position.clone().add(new THREE.Vector3(0, 0.1, 0)), 0x7dffb2, 0.5, 9, 0.6);
      g.audio.play('enemy.palm', { at: c });
      if (a.echo) this.echoes.push(new Echo(g, this, a, this.position.clone(), this.yaw));
    }
  }

  private beginCast(): void {
    const g = this.game;
    if (this.def.ai === 'kuroda') {
      if (this.hp < this.maxHp * 0.5) this.phase2 = true;
      this.fuse?.end();
      this.fuse = new Fuse(g, this, g.player.position.clone(), this.phase2 ? 3 : 1);
    } else if (this.def.ai === 'ancient') {
      g.audio.play('ancient.charge', { at: this.center() });
      g.vfx.ring(this.center(), 0x7dffb2, 0.2, 2.5, 1.1);
      // The wave's reach, ruled faintly: it will cover all of this.
      this.castMark = g.vfx.mark({ kind: 'sector', radius: 14, arc: Math.PI, inner: 0.05 }, DANGER, this.position, 0, 0.7);
    }
  }

  private resolveCast(): void {
    const g = this.game;
    if (this.def.ai === 'kuroda') {
      this.fuse?.snap();
    } else if (this.def.ai === 'ancient') {
      this.castMark?.fire();
      this.castMark = null;
      const c = this.center();
      g.vfx.ring(this.position.clone().add(new THREE.Vector3(0, 0.1, 0)), 0x7dffb2, 0.5, 14, 0.9);
      g.audio.play('ancient.wave', { at: c });
      const d = g.player.position.distanceTo(this.position);
      if (d < 14) g.combat.hurtPlayer(this.dmg * (1 - d / 16), { from: c, kinetic: true });
      for (const p of g.props.instances) if (p.mesh.position.distanceTo(this.position) < 14) g.props.push(p, p.mesh.position.clone().sub(this.position).normalize().multiplyScalar(p.def.mass * 5).setY(p.def.mass * 3));
    }
  }

  // A thrown body: an ink smear behind it while it flies fast, chips of the
  // ground where it lands, and a scuff of them as it skids.
  private thrown(dt: number): void {
    const g = this.game, c = this.center();
    const v = Math.hypot(this.velocity.x, this.velocity.z);
    if (!this.grounded) this.airT += dt;
    this.smearT += dt;
    if (v > 5 && this.smearT > 0.05) {
      g.vfx.trail([this.lastCenter.clone(), this.lastCenter.clone().lerp(c, 0.5), c.clone()], INK, 0.55, 0.12);
      this.smearT = 0;
    }
    if (this.grounded && this.airT > 0.2) {
      g.vfx.burst(this.position.clone().add(new THREE.Vector3(0, 0.1, 0)), 5, 'debris', 3);
      g.vfx.ring(this.position.clone().add(new THREE.Vector3(0, 0.06, 0)), 0x9c8b72, 0.3, 1.4, 0.35);
      this.airT = 0;
    } else if (this.grounded) {
      this.airT = 0;
      if (v > 3 && this.smearT > 0.03) g.vfx.burst(this.position.clone().add(new THREE.Vector3(0, 0.05, 0)), 1, 'debris', 1.5);
    }
    this.lastCenter.copy(c);
  }
}
