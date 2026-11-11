import * as THREE from 'three';
import type { Game } from '../app/game';
import { Avatar, type CharacterModel } from '../character/avatar';
import { RAPIER, GROUP_ENEMY, GROUP_WORLD, GROUP_PROP, groups } from '../physics/world';

export type EnemyAi = 'thug' | 'kuroda' | 'ancient' | 'dummy';
export interface EnemyDef { name: string; model: CharacterModel; hp: number; speed: number; dmg: number; ai: EnemyAi; boss?: boolean; tint?: number; emissive?: number; height?: number; title?: string }

export const ENEMY_DEFS: Record<string, EnemyDef> = {
  thug: { name: 'Underworld Thug', model: 'bald', hp: 70, speed: 3.6, dmg: 11, ai: 'thug', tint: 0x9aa0a8 },
  bruiser: { name: 'Bristle Brawler', model: 'beard', hp: 120, speed: 3.0, dmg: 16, ai: 'thug', tint: 0x7a2c34, height: 1.95 },
  kuroda: { name: 'Kuroda Enforcer', model: 'parted', hp: 620, speed: 3.2, dmg: 15, ai: 'kuroda', boss: true, tint: 0xb04a2a, emissive: 0xff3a00, height: 1.9, title: 'Kuroda Enforcer, whose "fire" is fuel' },
  ancient: { name: 'The Ancient Echo Master', model: 'long', hp: 1300, speed: 2.6, dmg: 20, ai: 'ancient', boss: true, tint: 0xdfe8dc, emissive: 0x7dffb2, height: 1.7, title: 'The Ancient Echo Master' },
  dummy: { name: 'Training Dummy', model: 'buzzed', hp: 100000, speed: 0, dmg: 0, ai: 'dummy', tint: 0x3e5a78 },
};

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
  private t = 0;
  alive = true;
  grounded = true;
  resonance = 0;
  frozen = 0;
  slow = 1;
  readonly def: EnemyDef;
  aura = { active: false, radius: 0, collapsed: false };
  private attackCd = 1;
  private castCd = 4;
  damageTaken = 0;
  fuelPatch: THREE.Mesh | null = null;
  readonly key: string;

  constructor(private game: Game, key: string, pos: THREE.Vector3) {
    const def = ENEMY_DEFS[key]!;
    this.key = key;
    this.def = def;
    this.hp = this.maxHp = def.hp;
    this.position = pos.clone();
    this.avatar = new Avatar(game.assets, def.model, { targetHeight: def.height ?? 1.8, tint: def.tint, emissive: def.emissive });
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
  }

  get height(): number { return this.def.height ?? 1.8; }
  get isBoss(): boolean { return !!this.def.boss; }
  center(): THREE.Vector3 { return this.position.clone().add(new THREE.Vector3(0, this.height * 0.55, 0)); }

  hurt(amount: number, opts: { from?: THREE.Vector3; knock?: number; lift?: number; stagger?: boolean } = {}): void {
    if (!this.alive) return;
    this.hp -= amount;
    this.damageTaken += amount;
    this.avatar.flash(1.2);
    if (this.def.ai === 'dummy') { this.avatar.playOneShot('Hit_Chest'); return; }
    const from = opts.from ?? this.game.player.position;
    const away = this.position.clone().sub(from).setY(0).normalize();
    const knock = (opts.knock ?? 0) * (this.isBoss ? 0.25 : 1);
    if (knock > 0) {
      this.velocity.addScaledVector(away, knock);
      this.velocity.y += (opts.lift ?? knock * 0.35) * (this.isBoss ? 0.3 : 1);
      if (knock > 4 && !this.isBoss) { this.state = 'knocked'; this.t = 0; this.avatar.playOneShot('Hit_Head'); }
      else if (opts.stagger !== false) { this.state = 'stagger'; this.t = 0; this.avatar.playOneShot('Hit_Chest'); }
    } else if (opts.stagger !== false && this.state !== 'knocked') { this.state = 'stagger'; this.t = 0; this.avatar.playOneShot('Hit_Chest'); }
    if (this.hp <= 0) this.die();
  }

  die(): void {
    if (!this.alive) return;
    this.alive = false;
    this.state = 'dead';
    this.avatar.die();
    this.game.physics.world.removeCollider(this.collider, false);
    this.aura.active = false;
    setTimeout(() => { this.game.renderer.scene.remove(this.avatar.root); this.game.physics.world.removeRigidBody(this.body); }, 6000);
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
    const g = this.game;
    const p = g.player.position;
    const toP = p.clone().sub(this.position).setY(0);
    const dist = toP.length();
    const def = this.def;
    this.t += dt;
    this.attackCd -= dt;
    this.castCd -= dt;
    this.frozen = Math.max(0, this.frozen - dt);
    this.resonance = Math.max(0, this.resonance - dt * 0.5);
    this.slow = THREE.MathUtils.lerp(this.slow, 1, 1 - Math.exp(-1.5 * dt));
    const move = new THREE.Vector3();
    const speed = def.speed * this.slow * (g.aura.pressureOn(this.position) ? 0.55 : 1) * (this.frozen > 0 ? 0 : 1);

    if (this.alive && def.ai !== 'dummy') {
      switch (this.state) {
        case 'idle':
          if (dist < 26) this.state = 'chase';
          break;
        case 'chase': {
          this.face(p, dt);
          const reach = def.ai === 'ancient' ? 7 : 1.7;
          if (dist > reach) move.copy(toP).normalize().multiplyScalar(speed);
          if (def.ai === 'ancient' && dist < 5) move.copy(toP).normalize().multiplyScalar(-speed * 0.7);
          if (dist <= reach + 0.3 && this.attackCd <= 0 && this.frozen <= 0) { this.state = 'windup'; this.t = 0; this.avatar.playUpper(def.ai === 'kuroda' ? 'Spell_Simple_Enter' : 'Punch_Jab', 1.1); }
          if (def.ai !== 'thug' && this.castCd <= 0 && dist < 22 && this.frozen <= 0) { this.state = 'cast'; this.t = 0; this.avatar.playUpper('Spell_Simple_Shoot', 1); this.beginCast(); }
          break;
        }
        case 'windup':
          this.face(p, dt, 12);
          if (this.t > (def.ai === 'ancient' ? 0.5 : 0.38)) { this.state = 'strike'; this.t = 0; this.strike(); }
          break;
        case 'strike':
          if (this.t > 0.18) { this.state = 'recover'; this.t = 0; }
          break;
        case 'recover':
          if (this.t > 0.55) { this.state = 'chase'; this.attackCd = def.ai === 'thug' ? 1.4 + Math.random() * 0.8 : 1.8; }
          break;
        case 'stagger':
          if (this.t > 0.45) this.state = 'chase';
          break;
        case 'knocked':
          if (this.grounded && this.t > 0.6) { this.state = 'recover'; this.t = 0; }
          break;
        case 'cast':
          this.face(p, dt, 4);
          if (this.t > 1.1) { this.resolveCast(); this.state = 'recover'; this.t = 0; this.castCd = def.ai === 'kuroda' ? 5 : 6.5; }
          break;
      }
    }

    this.velocity.x = THREE.MathUtils.lerp(this.velocity.x, move.x, 1 - Math.exp(-(this.state === 'knocked' ? 1 : 10) * dt));
    this.velocity.z = THREE.MathUtils.lerp(this.velocity.z, move.z, 1 - Math.exp(-(this.state === 'knocked' ? 1 : 10) * dt));
    this.velocity.y -= 20 * dt;
    const step = this.velocity.clone().multiplyScalar(dt);
    this.ctrl.computeColliderMovement(this.collider, step, undefined, groups(GROUP_ENEMY, GROUP_WORLD | GROUP_PROP | GROUP_ENEMY));
    const out = this.ctrl.computedMovement();
    this.grounded = this.ctrl.computedGrounded();
    this.position.x += out.x; this.position.y += out.y; this.position.z += out.z;
    if (this.grounded && this.velocity.y < 0) this.velocity.y = 0;
    this.body.setNextKinematicTranslation({ x: this.position.x, y: this.position.y + this.height / 2, z: this.position.z });

    this.avatar.root.position.copy(this.position);
    this.avatar.root.rotation.y = this.yaw;
    const planar = Math.hypot(this.velocity.x, this.velocity.z);
    this.avatar.setLocomotion(this.alive ? planar : 0, 0, 1, this.grounded, dt);
    if (this.resonance > 0) this.avatar.root.position.x += (Math.random() - 0.5) * this.resonance * 0.03;
    this.avatar.update(dt);
    if (this.aura.active) this.aura.radius = THREE.MathUtils.lerp(this.aura.radius, 13, 1 - Math.exp(-3 * dt));
    else this.aura.radius = THREE.MathUtils.lerp(this.aura.radius, 0, 1 - Math.exp(-3 * dt));
  }

  private strike(): void {
    const g = this.game;
    const toP = g.player.position.clone().sub(this.position).setY(0);
    const d = toP.length();
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const reach = this.def.ai === 'ancient' ? 8 : 2.2;
    if (d < reach && toP.normalize().dot(fwd) > 0.3) {
      g.combat.hurtPlayer(this.def.dmg, { from: this.center(), kinetic: true });
      g.audio.play('impactPunch_medium_000', 0.6, 0.9 + Math.random() * 0.2);
    }
    if (this.def.ai === 'ancient') { g.vfx.ring(this.position.clone().add(new THREE.Vector3(0, 0.1, 0)), 0x7dffb2, 0.5, 9, 0.6); g.audio.play('impactBell_heavy_002', 0.6, 0.7); }
  }

  private beginCast(): void {
    const g = this.game;
    if (this.def.ai === 'kuroda') {
      const at = g.player.position.clone();
      this.fuelPatch = g.vfx.patch(at, 2.4, 'fuel', 2.2);
      g.audio.play('spaceTrash1', 0.4, 0.6);
      (this as { fuelAt?: THREE.Vector3 }).fuelAt = at;
    } else if (this.def.ai === 'ancient') {
      g.audio.play('phaserUp3', 0.4, 0.5);
      g.vfx.ring(this.center(), 0x7dffb2, 0.2, 2.5, 1.1);
    }
  }

  private resolveCast(): void {
    const g = this.game;
    if (this.def.ai === 'kuroda') {
      const at = (this as { fuelAt?: THREE.Vector3 }).fuelAt ?? g.player.position.clone();
      g.vfx.flash(at.clone().add(new THREE.Vector3(0, 1, 0)), 0xff6a1a, 90, 0.5, 18);
      g.vfx.burst(at.clone().add(new THREE.Vector3(0, 0.3, 0)), 26, 'spark', 7, 0xff8a2a);
      g.vfx.patch(at, 2.6, 'burn', 20);
      g.vfx.ring(at.clone().add(new THREE.Vector3(0, 0.1, 0)), 0xff6a1a, 0.3, 3.2, 0.5);
      g.audio.play('impactMining_000', 0.8, 0.7);
      g.renderer.impactFrame(2, new THREE.Color(0xff6a1a));
      if (g.player.position.distanceTo(at) < 2.6) g.combat.hurtPlayer(this.def.dmg * 1.6, { from: at, kinetic: false });
      for (const e of g.encounters.enemies) if (e !== this && e.alive && e.position.distanceTo(at) < 2.6) e.hurt(20, { from: at, knock: 3 });
    } else if (this.def.ai === 'ancient') {
      if (this.hp < this.maxHp * 0.7 && Math.random() < 0.5) g.encounters.bossUltimate(this);
      else {
        const c = this.center();
        g.vfx.ring(this.position.clone().add(new THREE.Vector3(0, 0.1, 0)), 0x7dffb2, 0.5, 14, 0.9);
        g.audio.play('impactBell_heavy_000', 0.8, 0.6);
        const d = g.player.position.distanceTo(this.position);
        if (d < 14) g.combat.hurtPlayer(this.def.dmg * (1 - d / 16), { from: c, kinetic: true });
        for (const p of g.props.instances) if (p.mesh.position.distanceTo(this.position) < 14) p.body.applyImpulse(p.mesh.position.clone().sub(this.position).normalize().multiplyScalar(p.def.mass * 5).setY(p.def.mass * 3), true);
      }
    }
  }
}
