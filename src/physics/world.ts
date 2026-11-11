import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

export const GROUP_WORLD = 0x0001;
export const GROUP_PLAYER = 0x0002;
export const GROUP_PROP = 0x0004;
export const GROUP_ENEMY = 0x0008;
export const GROUP_SENSOR = 0x0010;

export interface BodyLink { body: RAPIER.RigidBody; mesh: THREE.Object3D; }

export class Physics {
  world!: RAPIER.World;
  readonly links: BodyLink[] = [];
  readonly events!: RAPIER.EventQueue;
  private accumulator = 0;
  readonly step = 1 / 60;

  async init(): Promise<void> {
    await RAPIER.init();
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.integrationParameters.numSolverIterations = 6;
    (this as { events: RAPIER.EventQueue }).events = new RAPIER.EventQueue(true);
  }

  tick(dt: number): number {
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= this.step && steps < 4) {
      this.world.step(this.events);
      this.accumulator -= this.step;
      steps++;
    }
    if (steps === 4) this.accumulator = 0;
    this.sync();
    return steps;
  }

  private sync(): void {
    for (const l of this.links) {
      if (l.body.isSleeping() && l.body.bodyType() === RAPIER.RigidBodyType.Dynamic) continue;
      const t = l.body.translation();
      const r = l.body.rotation();
      l.mesh.position.set(t.x, t.y, t.z);
      l.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  staticBox(center: THREE.Vector3, half: THREE.Vector3, quat?: THREE.Quaternion): RAPIER.Collider {
    const desc = RAPIER.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z);
    if (quat) desc.setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w });
    const body = this.world.createRigidBody(desc);
    return this.world.createCollider(RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setCollisionGroups(groups(GROUP_WORLD, 0xffff)), body);
  }

  staticTrimesh(mesh: THREE.Mesh): RAPIER.Collider | null {
    const geo = mesh.geometry;
    const pos = geo.getAttribute('position');
    if (!pos) return null;
    mesh.updateWorldMatrix(true, false);
    const verts = new Float32Array(pos.count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      verts[i * 3] = v.x; verts[i * 3 + 1] = v.y; verts[i * 3 + 2] = v.z;
    }
    const idx = geo.index ? new Uint32Array(geo.index.array) : Uint32Array.from({ length: pos.count }, (_, i) => i);
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    return this.world.createCollider(RAPIER.ColliderDesc.trimesh(verts, idx).setCollisionGroups(groups(GROUP_WORLD, 0xffff)), body);
  }

  dynamicBox(mesh: THREE.Object3D, half: THREE.Vector3, mass: number, group = GROUP_PROP): RAPIER.RigidBody {
    const desc = RAPIER.RigidBodyDesc.dynamic().setTranslation(mesh.position.x, mesh.position.y, mesh.position.z)
      .setRotation({ x: mesh.quaternion.x, y: mesh.quaternion.y, z: mesh.quaternion.z, w: mesh.quaternion.w })
      .setLinearDamping(0.15).setAngularDamping(0.4).setCcdEnabled(true);
    const body = this.world.createRigidBody(desc);
    const col = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setMass(mass).setFriction(0.8).setRestitution(0.15)
      .setCollisionGroups(groups(group, 0xffff)).setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(mass * 25);
    this.world.createCollider(col, body);
    this.links.push({ body, mesh });
    return body;
  }

  remove(body: RAPIER.RigidBody): void {
    const i = this.links.findIndex((l) => l.body === body);
    if (i >= 0) this.links.splice(i, 1);
    this.world.removeRigidBody(body);
  }

  castRay(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, filterGroups = 0xffff, exclude?: RAPIER.RigidBody): { point: THREE.Vector3; normal: THREE.Vector3; collider: RAPIER.Collider; toi: number } | null {
    const ray = new RAPIER.Ray(origin, dir);
    const hit = this.world.castRayAndGetNormal(ray, maxDist, true, undefined, groups(0xffff, filterGroups), undefined, exclude);
    if (!hit) return null;
    const p = ray.pointAt(hit.timeOfImpact);
    return { point: new THREE.Vector3(p.x, p.y, p.z), normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z), collider: hit.collider, toi: hit.timeOfImpact };
  }

  bodiesInSphere(center: THREE.Vector3, radius: number, filterGroups = 0xffff): RAPIER.RigidBody[] {
    const out: RAPIER.RigidBody[] = [];
    const seen = new Set<number>();
    this.world.intersectionsWithShape(center, { x: 0, y: 0, z: 0, w: 1 }, new RAPIER.Ball(radius), (col) => {
      const b = col.parent();
      if (b && !seen.has(b.handle)) { seen.add(b.handle); out.push(b); }
      return true;
    }, undefined, groups(0xffff, filterGroups));
    return out;
  }
}

export function groups(membership: number, filter: number): number {
  return ((membership & 0xffff) << 16) | (filter & 0xffff);
}

export { RAPIER };
