import * as THREE from 'three';
import { Physics, RAPIER, GROUP_PLAYER, GROUP_WORLD, GROUP_PROP, groups } from '../physics/world';
import type { Input } from '../app/input';

export interface MoveEvents {
  onStep(speed: number, surface: string): void;
  onLand(fallSpeed: number): void;
  onJump(): void;
  onDash(): void;
}

export const PLAYER_RADIUS = 0.34;
export const PLAYER_HEIGHT = 1.78;
export const EYE_HEIGHT = 1.64;

export class PlayerController {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  private ctrl: RAPIER.KinematicCharacterController;
  grounded = true;
  wasGrounded = true;
  yaw = 0;
  speedScale = 1;
  canDash = true;
  dashCooldown = 0;
  dashTimer = 0;
  private dashDir = new THREE.Vector3();
  private coyote = 0;
  private stepPhase = 0;
  private mantleT = 0;
  private mantleFrom = new THREE.Vector3();
  private mantleTo = new THREE.Vector3();
  rooted = 0;
  moveLock = 0;
  surface = 'concrete';
  readonly planarSpeed = { value: 0 };

  constructor(private physics: Physics, start: THREE.Vector3, private events: MoveEvents) {
    this.position.copy(start);
    const desc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(start.x, start.y + PLAYER_HEIGHT / 2, start.z);
    this.body = physics.world.createRigidBody(desc);
    this.collider = physics.world.createCollider(
      RAPIER.ColliderDesc.capsule(PLAYER_HEIGHT / 2 - PLAYER_RADIUS, PLAYER_RADIUS).setCollisionGroups(groups(GROUP_PLAYER, GROUP_WORLD | GROUP_PROP)),
      this.body,
    );
    this.ctrl = physics.world.createCharacterController(0.03);
    this.ctrl.enableAutostep(0.45, 0.25, true);
    this.ctrl.enableSnapToGround(0.3);
    this.ctrl.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.ctrl.setMinSlopeSlideAngle((60 * Math.PI) / 180);
    this.ctrl.setApplyImpulsesToDynamicBodies(true);
    this.ctrl.setCharacterMass(78);
  }

  teleport(p: THREE.Vector3): void {
    this.position.copy(p);
    this.velocity.set(0, 0, 0);
    this.body.setNextKinematicTranslation({ x: p.x, y: p.y + PLAYER_HEIGHT / 2, z: p.z });
    this.body.setTranslation({ x: p.x, y: p.y + PLAYER_HEIGHT / 2, z: p.z }, true);
  }

  update(dt: number, input: Input, sprintAllowed: boolean): void {
    if (dt <= 0) return;
    const axis = input.axis();
    const wantsSprint = input.isDown('sprint') && sprintAllowed && axis.y > 0.1;
    const locked = this.rooted > 0 || this.moveLock > 0;
    this.rooted = Math.max(0, this.rooted - dt);
    this.moveLock = Math.max(0, this.moveLock - dt);
    this.dashCooldown = Math.max(0, this.dashCooldown - dt);

    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(forward.z, 0, -forward.x);
    const wish = locked ? new THREE.Vector3() : new THREE.Vector3().addScaledVector(forward, axis.y).addScaledVector(right, axis.x);
    const targetSpeed = (wantsSprint ? 6.6 : 4.1) * this.speedScale;
    const accel = this.grounded ? 22 : 7;
    const planar = new THREE.Vector3(this.velocity.x, 0, this.velocity.z);
    const target = wish.multiplyScalar(targetSpeed);
    planar.lerp(target, 1 - Math.exp(-accel * dt));
    if (this.grounded && wish.lengthSq() < 0.01) planar.multiplyScalar(Math.exp(-14 * dt));

    if (this.dashTimer > 0) {
      this.dashTimer -= dt;
      planar.copy(this.dashDir).multiplyScalar(13.5);
    } else if (input.hit('dash') && this.canDash && this.dashCooldown <= 0 && !locked) {
      this.dashDir.copy(wish.lengthSq() > 0.01 ? wish.normalize() : forward);
      this.dashTimer = 0.17;
      this.dashCooldown = 1.0;
      this.velocity.y = Math.max(this.velocity.y, 0.5);
      this.events.onDash();
    }

    this.velocity.x = planar.x; this.velocity.z = planar.z;
    this.velocity.y -= 20 * dt;
    if (this.grounded) this.coyote = 0.12; else this.coyote -= dt;
    if (input.hit('jump') && this.coyote > 0 && !locked && this.mantleT <= 0) {
      this.velocity.y = 6.6;
      this.coyote = 0;
      this.grounded = false;
      this.events.onJump();
    }

    if (this.mantleT > 0) {
      this.mantleT -= dt * 3.2;
      const t = 1 - Math.max(0, this.mantleT);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      this.position.lerpVectors(this.mantleFrom, this.mantleTo, e);
      this.position.y = THREE.MathUtils.lerp(this.mantleFrom.y, this.mantleTo.y, Math.min(1, e * 1.4));
      this.velocity.set(0, 0, 0);
      this.body.setNextKinematicTranslation({ x: this.position.x, y: this.position.y + PLAYER_HEIGHT / 2, z: this.position.z });
      return;
    }

    const move = this.velocity.clone().multiplyScalar(dt);
    this.ctrl.computeColliderMovement(this.collider, move, undefined, groups(GROUP_PLAYER, GROUP_WORLD | GROUP_PROP));
    const out = this.ctrl.computedMovement();
    this.wasGrounded = this.grounded;
    this.grounded = this.ctrl.computedGrounded();
    const blockedH = Math.hypot(out.x - move.x, out.z - move.z) > Math.hypot(move.x, move.z) * 0.6 && Math.hypot(move.x, move.z) > 0.015;
    this.position.x += out.x; this.position.y += out.y; this.position.z += out.z;
    if (this.grounded && this.velocity.y < 0) {
      if (!this.wasGrounded) this.events.onLand(-this.velocity.y);
      this.velocity.y = 0;
    } else if (out.y < move.y - 1e-4 && this.velocity.y > 0) {
      this.velocity.y = 0;
    }
    if (blockedH && axis.y > 0.3 && !locked) this.tryMantle(forward);

    this.body.setNextKinematicTranslation({ x: this.position.x, y: this.position.y + PLAYER_HEIGHT / 2, z: this.position.z });

    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    this.planarSpeed.value = speed;
    if (this.grounded && speed > 0.6) {
      const prev = this.stepPhase;
      this.stepPhase += dt * speed * 0.62;
      if (Math.floor(prev) !== Math.floor(this.stepPhase)) this.events.onStep(speed, this.surface);
    } else if (speed < 0.3) this.stepPhase = 0.25;
    this.updateSurface();
  }

  get stepCycle(): number { return this.stepPhase; }

  private updateSurface(): void {
    const hit = this.physics.castRay(this.position.clone().add(new THREE.Vector3(0, 0.3, 0)), new THREE.Vector3(0, -1, 0), 0.8, GROUP_WORLD | GROUP_PROP, this.body);
    if (!hit) return;
    const s = (hit.collider as RAPIER.Collider & { surfaceTag?: string }).surfaceTag;
    if (s) this.surface = s;
  }

  private tryMantle(forward: THREE.Vector3): void {
    const probe = this.position.clone().add(new THREE.Vector3(0, 1.9, 0)).addScaledVector(forward, 0.9);
    const hit = this.physics.castRay(probe, new THREE.Vector3(0, -1, 0), 1.75, GROUP_WORLD | GROUP_PROP, this.body);
    if (!hit) return;
    const ledgeY = hit.point.y;
    const rise = ledgeY - this.position.y;
    if (rise < 0.5 || rise > 1.45) return;
    const head = this.physics.castRay(hit.point.clone().add(new THREE.Vector3(0, 0.1, 0)), new THREE.Vector3(0, 1, 0), PLAYER_HEIGHT, GROUP_WORLD, this.body);
    if (head) return;
    this.mantleFrom.copy(this.position);
    this.mantleTo.copy(hit.point).addScaledVector(forward, 0.15);
    this.mantleT = 1;
  }

  // Techniques use this for displacement: moves the body and keeps controller state coherent.
  displace(delta: THREE.Vector3): void {
    this.position.add(delta);
    this.body.setNextKinematicTranslation({ x: this.position.x, y: this.position.y + PLAYER_HEIGHT / 2, z: this.position.z });
    this.body.setTranslation({ x: this.position.x, y: this.position.y + PLAYER_HEIGHT / 2, z: this.position.z }, true);
  }

  eye(): THREE.Vector3 { return this.position.clone().add(new THREE.Vector3(0, EYE_HEIGHT, 0)); }
}
