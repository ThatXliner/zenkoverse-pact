import * as THREE from 'three';
import type { Assets } from '../app/assets';
import { Physics, RAPIER, GROUP_PROP } from '../physics/world';

export type PropTrait = 'freezable' | 'resonant' | 'flammable' | 'porous' | 'kinetic-source' | 'fragile' | 'metal' | 'wood';

export interface PropDef {
  model: string;
  mass: number;
  scale: number;
  traits: PropTrait[];
  breakable?: { hp: number; pieces: number };
  surface?: string;
  yOffset?: number;
}

export const PROPS: Record<string, PropDef> = {
  crate: { model: 'props/kk-box_A', mass: 18, scale: 1.0, traits: ['wood', 'flammable', 'resonant'], breakable: { hp: 40, pieces: 6 } },
  crateSmall: { model: 'props/kk-box_B', mass: 9, scale: 0.9, traits: ['wood', 'flammable'], breakable: { hp: 25, pieces: 4 } },
  barrel: { model: 'props/barrel', mass: 32, scale: 1.1, traits: ['wood', 'porous', 'resonant'], breakable: { hp: 60, pieces: 8 } },
  trashA: { model: 'props/kk-trash_A', mass: 6, scale: 1.0, traits: ['metal', 'resonant'] },
  trashB: { model: 'props/kk-trash_B', mass: 5, scale: 1.0, traits: ['metal'] },
  cone: { model: 'props/construction-cone', mass: 2, scale: 1.0, traits: [] },
  barrier: { model: 'props/construction-barrier', mass: 14, scale: 1.0, traits: ['wood'] },
  can: { model: 'props/can', mass: 0.4, scale: 3.0, traits: ['metal', 'resonant'] },
  sodaCan: { model: 'props/soda-can', mass: 0.3, scale: 3.0, traits: ['metal'] },
  cardboard: { model: 'props/furn-cardboardBoxClosed', mass: 3, scale: 1.0, traits: ['porous', 'flammable'], breakable: { hp: 12, pieces: 3 } },
  cardboardOpen: { model: 'props/furn-cardboardBoxOpen', mass: 2, scale: 1.0, traits: ['porous', 'flammable'] },
  steamer: { model: 'props/steamer', mass: 4, scale: 2.4, traits: ['metal', 'resonant'] },
  pot: { model: 'props/pot-stew', mass: 5, scale: 2.4, traits: ['metal', 'resonant'] },
  stool: { model: 'props/furn-stoolBar', mass: 5, scale: 1.0, traits: ['wood'] },
  chair: { model: 'props/furn-chair', mass: 6, scale: 1.0, traits: ['wood', 'flammable'] },
  dummy: { model: 'props/furn-coatRackStanding', mass: 40, scale: 1.1, traits: ['wood', 'resonant'] },
};

export interface PropInstance {
  id: number;
  def: PropDef;
  key: string;
  mesh: THREE.Object3D;
  body: RAPIER.RigidBody;
  half: THREE.Vector3;
  hp: number;
  resonance: number;
  frozen: number;
  alive: boolean;
}

export class PropSystem {
  readonly instances: PropInstance[] = [];
  private nextId = 1;
  private cache = new Map<string, { template: THREE.Object3D; half: THREE.Vector3; center: THREE.Vector3 }>();
  readonly byBody = new Map<number, PropInstance>();

  constructor(private assets: Assets, private physics: Physics, private scene: THREE.Scene) {}

  private template(key: string): { template: THREE.Object3D; half: THREE.Vector3; center: THREE.Vector3 } {
    const c = this.cache.get(key);
    if (c) return c;
    const def = PROPS[key]!;
    const src = this.assets.model(def.model).scene;
    const t = src.clone(true);
    t.scale.setScalar(def.scale);
    t.updateMatrixWorld(true);
    t.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        const m = o as THREE.Mesh;
        m.castShadow = true;
        m.receiveShadow = true;
        const mat = (m.material as THREE.MeshStandardMaterial).clone();
        mat.roughness = Math.min(mat.roughness, 0.7);
        mat.envMapIntensity = 0.7;
        m.material = mat;
      }
    });
    const box = new THREE.Box3().setFromObject(t);
    const half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    const center = box.getCenter(new THREE.Vector3());
    const entry = { template: t, half, center };
    this.cache.set(key, entry);
    return entry;
  }

  spawn(key: string, position: THREE.Vector3, rotationY = 0): PropInstance {
    const def = PROPS[key];
    if (!def) throw new Error(`unknown prop ${key}`);
    const { template, half, center } = this.template(key);
    const visual = template.clone(true);
    visual.position.copy(center).negate();
    const holder = new THREE.Group();
    holder.add(visual);
    holder.position.copy(position).add(new THREE.Vector3(0, half.y, 0));
    holder.rotation.y = rotationY;
    this.scene.add(holder);
    const body = this.physics.dynamicBox(holder, half, def.mass, GROUP_PROP);
    const inst: PropInstance = { id: this.nextId++, def, key, mesh: holder, body, half: half.clone(), hp: def.breakable?.hp ?? Infinity, resonance: 0, frozen: 0, alive: true };
    this.instances.push(inst);
    this.byBody.set(body.handle, inst);
    (body.collider(0) as RAPIER.Collider & { surfaceTag?: string }).surfaceTag = def.surface ?? (def.traits.includes('wood') ? 'wood' : 'concrete');
    return inst;
  }

  remove(inst: PropInstance): void {
    if (!inst.alive) return;
    inst.alive = false;
    this.scene.remove(inst.mesh);
    this.byBody.delete(inst.body.handle);
    this.physics.remove(inst.body);
    const i = this.instances.indexOf(inst);
    if (i >= 0) this.instances.splice(i, 1);
  }

  // Frees every frozen prop at once, when the effects that froze them end.
  thaw(): void {
    for (const p of this.instances) if (p.frozen > 0) { p.frozen = 0; p.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true); }
  }

  update(dt: number): void {
    for (const p of this.instances) {
      if (p.resonance > 0) {
        p.resonance = Math.max(0, p.resonance - dt * 0.7);
        const s = p.resonance * 0.012;
        p.mesh.children[0]!.position.x = (Math.random() - 0.5) * s;
        p.mesh.children[0]!.position.z = (Math.random() - 0.5) * s;
      }
      if (p.frozen > 0) {
        p.frozen -= dt;
        if (p.frozen <= 0) p.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      }
    }
  }

  find(body: RAPIER.RigidBody): PropInstance | undefined { return this.byBody.get(body.handle); }
}
