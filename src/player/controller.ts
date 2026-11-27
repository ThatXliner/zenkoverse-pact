import * as THREE from 'three';
import { Physics, RAPIER, GROUP_PLAYER, GROUP_WORLD, GROUP_PROP, SKIN, groups } from '../physics/world';
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
// How fast a shove dies away, per second.
const PUSH_DECAY = 6;
// The deepest drop a body on its feet steps down rather than falls: a stair's
// riser and then some. Rapier's own snap gives up on a stair going down: the
// capsule rolls over each step's edge, the contact there tilts past the
// steepest floor it stands on, and it falls to the next tread.
const STEP_DOWN = 0.36;

// How the body holds what it touches. Ordinary footing is `walk`. A
// Technique that changes the skin's grip sets it each frame (Friction):
// `slide`, the soles let go, so the body keeps its speed, the keys only lean
// it round at `steer` radians a second and the floor drags `drag` of the
// speed away each second; `plant`, it stops dead and a shove does not move
// it; `cling`, the palms hold a wall and the body moves at `climb` (m/s, in
// the world) with nothing pulling it down.
export type Footing =
  | { kind: 'walk' }
  | { kind: 'slide'; steer: number; drag: number }
  | { kind: 'plant' }
  | { kind: 'cling'; climb: THREE.Vector3 };
export const WALK: Footing = { kind: 'walk' };

export class PlayerController {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  private ctrl: RAPIER.KinematicCharacterController;
  private shape = new RAPIER.Capsule(PLAYER_HEIGHT / 2 - PLAYER_RADIUS, PLAYER_RADIUS);
  grounded = true;
  wasGrounded = true;
  // Where the body faces. `moveYaw` is the heading the movement keys are
  // read against: the facing in first and third person, the camera's north
  // in the top-down view, where W is up the screen whichever way you aim.
  yaw = 0;
  moveYaw = 0;
  speedScale = 1;
  // Someone else's aura field bearing down (src/combat/aura.ts).
  fieldScale = 1;
  canDash = true;
  dashCooldown = 0;
  dashTimer = 0;
  private dashDir = new THREE.Vector3();
  private push = new THREE.Vector3();
  // A step driven into a blow (src/combat/melee.ts): this velocity on top of
  // the walk for `left` seconds, so the body arrives as the fist does.
  private drive = { v: new THREE.Vector3(), left: 0 };
  private coyote = 0;
  private stepPhase = 0;
  private mantleT = 0;
  private mantleFrom = new THREE.Vector3();
  private mantleTo = new THREE.Vector3();
  rooted = 0;
  moveLock = 0;
  surface = 'concrete';
  footing: Footing = WALK;
  // The way the keys asked the body to go this frame, flat and at most unit length.
  readonly wish = new THREE.Vector3();
  readonly planarSpeed = { value: 0 };

  constructor(private physics: Physics, start: THREE.Vector3, private events: MoveEvents) {
    this.position.copy(start);
    const desc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(start.x, start.y + PLAYER_HEIGHT / 2, start.z);
    this.body = physics.world.createRigidBody(desc);
    this.collider = physics.world.createCollider(
      RAPIER.ColliderDesc.capsule(PLAYER_HEIGHT / 2 - PLAYER_RADIUS, PLAYER_RADIUS).setCollisionGroups(groups(GROUP_PLAYER, GROUP_WORLD | GROUP_PROP)),
      this.body,
    );
    this.ctrl = physics.world.createCharacterController(SKIN);
    this.ctrl.enableAutostep(0.45, 0.25, true);
    this.ctrl.enableSnapToGround(0.3);
    this.ctrl.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.ctrl.setMinSlopeSlideAngle((60 * Math.PI) / 180);
    this.ctrl.setApplyImpulsesToDynamicBodies(true);
    this.ctrl.setCharacterMass(78);
  }

  // A blow's shove: carried on top of the walk and dying away on its own, so
  // the keys keep control while the body is pushed back a step.
  shove(v: THREE.Vector3): void { if (this.footing.kind !== 'plant' && this.footing.kind !== 'cling') this.push.add(v.clone().setY(0)); }

  // Covers `v` (flat) over `seconds`, against whatever is in the way.
  lunge(v: THREE.Vector3, seconds: number): void {
    if (this.footing.kind === 'plant' || this.footing.kind === 'cling' || seconds <= 0) return;
    this.drive.v.copy(v).setY(0).divideScalar(seconds);
    this.drive.left = seconds;
  }

  teleport(p: THREE.Vector3): void {
    this.position.copy(p);
    this.velocity.set(0, 0, 0);
    this.push.set(0, 0, 0);
    this.drive.left = 0;
    // A mantle under way would carry the body back to its ledge.
    this.mantleT = 0;
    this.body.setNextKinematicTranslation({ x: p.x, y: p.y + PLAYER_HEIGHT / 2, z: p.z });
    this.body.setTranslation({ x: p.x, y: p.y + PLAYER_HEIGHT / 2, z: p.z }, true);
  }

  update(dt: number, input: Input, sprintAllowed: boolean, sprintAnyDirection = false): void {
    if (dt <= 0) return;
    const axis = input.axis();
    const wantsSprint = input.isDown('sprint') && sprintAllowed && (axis.y > 0.1 || (sprintAnyDirection && Math.hypot(axis.x, axis.y) > 0.1));
    const locked = this.rooted > 0 || this.moveLock > 0;
    this.rooted = Math.max(0, this.rooted - dt);
    this.moveLock = Math.max(0, this.moveLock - dt);
    this.dashCooldown = Math.max(0, this.dashCooldown - dt);

    const forward = new THREE.Vector3(-Math.sin(this.moveYaw), 0, -Math.cos(this.moveYaw));
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const facing = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const wish = locked ? new THREE.Vector3() : new THREE.Vector3().addScaledVector(forward, axis.y).addScaledVector(right, axis.x);
    this.wish.copy(wish);
    if (this.wish.lengthSq() > 1) this.wish.normalize();
    const footing = this.footing;
    const targetSpeed = (wantsSprint ? 6.6 : 4.1) * this.speedScale * this.fieldScale;
    const planar = new THREE.Vector3(this.velocity.x, 0, this.velocity.z);
    // Reversing at speed, the body has to brake its own weight first: the
    // pivot takes a beat longer than starting from a standstill.
    const reversing = wish.lengthSq() > 0.01 && planar.lengthSq() > 2.5 * 2.5 && planar.dot(wish) < -0.3 * planar.length() * wish.length();
    const accel = this.grounded ? (reversing ? 12 : 22) : 7;
    if (footing.kind === 'slide' && this.grounded) this.glide(planar, wish, footing.steer, footing.drag, dt);
    else {
      const target = wish.multiplyScalar(targetSpeed);
      planar.lerp(target, 1 - Math.exp(-accel * dt));
      // Planted, the feet stop the body dead.
      if (this.grounded && wish.lengthSq() < 0.01) planar.multiplyScalar(Math.exp(-(footing.kind === 'plant' ? 40 : 14) * dt));
    }
    if (footing.kind === 'cling') planar.set(footing.climb.x, 0, footing.climb.z);

    if (this.dashTimer > 0) {
      this.dashTimer -= dt;
      planar.copy(this.dashDir).multiplyScalar(13.5);
    } else if (input.hit('dash') && this.canDash && this.dashCooldown <= 0 && !locked) {
      this.dashDir.copy(wish.lengthSq() > 0.01 ? wish.clone().normalize() : facing);
      this.dashTimer = 0.17;
      this.dashCooldown = 1.0;
      this.velocity.y = Math.max(this.velocity.y, 0.5);
      this.events.onDash();
    }

    this.velocity.x = planar.x; this.velocity.z = planar.z;
    if (footing.kind === 'cling') this.velocity.y = footing.climb.y;
    else this.velocity.y -= 20 * dt;
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

    const move = this.velocity.clone().add(this.push);
    if (this.drive.left > 0) { move.addScaledVector(this.drive.v, Math.min(dt, this.drive.left) / dt); this.drive.left -= dt; }
    move.multiplyScalar(dt);
    this.push.multiplyScalar(Math.exp(-PUSH_DECAY * dt));
    const stepping = this.grounded && this.velocity.y <= 0 && this.dashTimer <= 0;
    this.ctrl.computeColliderMovement(this.collider, move, undefined, groups(GROUP_PLAYER, GROUP_WORLD | GROUP_PROP));
    const out = this.ctrl.computedMovement();
    this.wasGrounded = this.grounded;
    this.grounded = this.ctrl.computedGrounded();
    const blockedH = Math.hypot(out.x - move.x, out.z - move.z) > Math.hypot(move.x, move.z) * 0.6 && Math.hypot(move.x, move.z) > 0.015;
    this.position.x += out.x; this.position.y += out.y; this.position.z += out.z;
    // On its feet and not rising, a body that has walked out over a lower
    // floor within a step's height goes down onto it, as a foot steps down,
    // and stays on its feet. Over a step's edge the capsule comes down as far
    // as the edge lets it and rolls over it on the frames that follow.
    if (!this.grounded && stepping) {
      const drop = this.dropAt(this.position.x, this.position.z);
      if (drop !== null) {
        this.position.y -= this.clearBelow(drop);
        this.grounded = true;
      }
    }
    if (this.grounded && this.velocity.y < 0) {
      if (!this.wasGrounded) this.events.onLand(-this.velocity.y);
      this.velocity.y = 0;
    } else if (out.y < move.y - 1e-4 && this.velocity.y > 0) {
      this.velocity.y = 0;
    }
    if (blockedH && wish.lengthSq() > 0.1 && !locked) this.tryMantle(wish.clone().normalize());

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

  // On slick footing the speed carries: the keys turn it toward them by at
  // most `steer` radians a second, the floor drags at it, and only a body
  // nearly at rest can shuffle itself up to a walk.
  private glide(planar: THREE.Vector3, wish: THREE.Vector3, steer: number, drag: number, dt: number): void {
    const speed = planar.length();
    if (wish.lengthSq() > 0.01 && speed > 0.2) {
      const have = Math.atan2(planar.x, planar.z), want = Math.atan2(wish.x, wish.z);
      const turn = THREE.MathUtils.clamp(Math.atan2(Math.sin(want - have), Math.cos(want - have)), -steer * dt, steer * dt);
      planar.applyAxisAngle(new THREE.Vector3(0, 1, 0), turn);
    }
    planar.multiplyScalar(Math.exp(-drag * dt));
    if (speed < 1.2 && wish.lengthSq() > 0.01) planar.lerp(wish.clone().normalize().multiplyScalar(1.2), 1 - Math.exp(-2 * dt));
  }

  // How far the body can move straight down, up to `max`, before it touches something.
  private clearBelow(max: number): number {
    const at = { x: this.position.x, y: this.position.y + PLAYER_HEIGHT / 2, z: this.position.z };
    const hit = this.physics.world.castShape(at, { x: 0, y: 0, z: 0, w: 1 }, { x: 0, y: -1, z: 0 }, this.shape, SKIN, max, true, undefined, groups(GROUP_PLAYER, GROUP_WORLD | GROUP_PROP), this.collider, this.body);
    return hit ? Math.max(0, hit.time_of_impact) : max;
  }

  // How far below the root the floor at (x, z) lies, when it is a step down
  // and not a drop.
  private dropAt(x: number, z: number): number | null {
    const floor = this.physics.standingY(x, z, this.position.y, STEP_DOWN);
    if (floor === null) return null;
    const drop = this.position.y - floor;
    return drop > 1e-3 && drop <= STEP_DOWN ? drop : null;
  }

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
