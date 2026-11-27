import * as THREE from 'three';
import type { Assets } from '../app/assets';
import { Physics, RAPIER, GROUP_PROP } from '../physics/world';
import { toon, toonify } from '../render/materials';
import { mangaShading } from '../render/tone';

export type PropTrait = 'freezable' | 'resonant' | 'flammable' | 'porous' | 'kinetic-source' | 'fragile' | 'metal' | 'wood';

export interface PropDef {
  model: string;
  mass: number;
  scale: number;
  traits: PropTrait[];
  breakable?: { hp: number; pieces: number };
  surface?: string;
  yOffset?: number;
  // Built in code instead of loaded (`model` is then only its name).
  build?: () => THREE.Object3D;
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
  dummy: { model: 'built/wooden-dummy', build: woodenDummy, mass: 40, scale: 1.0, traits: ['wood', 'resonant'] },
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
  // How hot it is: 0 cold, about 0.3 a dull red, 0.6 cherry, 1 white. Metal
  // glows with it; it cools at `cools` a second (0.06 when unset).
  heat: number;
  cools?: number;
  // This prop's own copies of its materials, made the first time it is
  // heated so the glow is its alone.
  glow?: THREE.MeshToonMaterial[];
  alive: boolean;
  // Sealed out of the world (Dark Dimension): the motion it went in with,
  // kept unchanged until it comes back. Its heat and its ice wait with it.
  sealed?: { vel: THREE.Vector3; spin: THREE.Vector3 } | null;
}

// The glow of hot metal by its heat: dull red, cherry, orange, straw, white.
const GLOW: [number, number][] = [[0.2, 0x000000], [0.35, 0x6a0c04], [0.55, 0xc0200c], [0.75, 0xff5a10], [0.92, 0xffb040], [1.05, 0xfff2d0]];
const SCORCHED = new THREE.Color(0x1e1614);
const glowAt = (h: number, out: THREE.Color): THREE.Color => {
  if (h <= GLOW[0]![0]) return out.setHex(0);
  for (let i = 1; i < GLOW.length; i++) {
    const [h1, c1] = GLOW[i]!, [h0, c0] = GLOW[i - 1]!;
    if (h <= h1) return out.setHex(c0).lerp(new THREE.Color(c1), (h - h0) / (h1 - h0));
  }
  return out.setHex(GLOW[GLOW.length - 1]![1]);
};

// Online, who simulates which prop is decided across the room
// (src/net/propsync.ts). Before this screen acts on a prop it touches it, so
// a prop another player is moving becomes this player's to move.
export interface PropAuthority { touch(p: PropInstance): void }

export class PropSystem {
  readonly instances: PropInstance[] = [];
  // Props sealed out of the world: not drawn, not simulated, not in
  // `instances`, so nothing in the world can touch them. Each is still the
  // same prop, and comes back as itself.
  readonly sealed: PropInstance[] = [];
  private nextId = 1;
  authority: PropAuthority | null = null;
  private cache = new Map<string, { template: THREE.Object3D; half: THREE.Vector3; center: THREE.Vector3 }>();
  readonly byBody = new Map<number, PropInstance>();
  private glowColor = new THREE.Color();

  constructor(private assets: Assets, private physics: Physics, private scene: THREE.Scene) {}

  private template(key: string): { template: THREE.Object3D; half: THREE.Vector3; center: THREE.Vector3 } {
    const c = this.cache.get(key);
    if (c) return c;
    const def = PROPS[key]!;
    const t = def.build ? def.build() : this.assets.model(def.model).scene.clone(true);
    t.scale.setScalar(def.scale);
    // Painted like the rest of the compound: flat toon colour and screentone.
    if (!def.build) toonify(t);
    t.updateMatrixWorld(true);
    t.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) { (o as THREE.Mesh).castShadow = true; (o as THREE.Mesh).receiveShadow = true; }
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
    const inst: PropInstance = { id: this.nextId++, def, key, mesh: holder, body, half: half.clone(), hp: def.breakable?.hp ?? Infinity, resonance: 0, frozen: 0, heat: 0, alive: true };
    this.instances.push(inst);
    this.byBody.set(body.handle, inst);
    (body.collider(0) as RAPIER.Collider & { surfaceTag?: string }).surfaceTag = def.surface ?? (def.traits.includes('wood') ? 'wood' : 'concrete');
    return inst;
  }

  remove(inst: PropInstance): void {
    if (!inst.alive) return;
    inst.alive = false;
    inst.sealed = null;
    this.scene.remove(inst.mesh);
    this.byBody.delete(inst.body.handle);
    this.physics.remove(inst.body);
    const i = this.instances.indexOf(inst);
    if (i >= 0) this.instances.splice(i, 1);
    const j = this.sealed.indexOf(inst);
    if (j >= 0) this.sealed.splice(j, 1);
  }

  // Out of the world, as it is: its motion is kept, the body stops
  // simulating, the mesh leaves the scene. Nothing is copied.
  seal(p: PropInstance, vel?: THREE.Vector3, spin?: THREE.Vector3): boolean {
    if (!p.alive || p.sealed) return false;
    const v = p.body.linvel(), w = p.body.angvel();
    p.sealed = { vel: vel?.clone() ?? new THREE.Vector3(v.x, v.y, v.z), spin: spin?.clone() ?? new THREE.Vector3(w.x, w.y, w.z) };
    p.resonance = 0;
    this.scene.remove(p.mesh);
    p.body.setEnabled(false);
    const i = this.instances.indexOf(p);
    if (i >= 0) this.instances.splice(i, 1);
    this.sealed.push(p);
    return true;
  }

  // Back into the world at `at`, moving as it went in (or as `vel` says).
  // Still in Rime's ice, it comes back held where it appears.
  unseal(p: PropInstance, at: THREE.Vector3, vel?: THREE.Vector3, spin?: THREE.Vector3): boolean {
    if (!p.alive || !p.sealed) return false;
    const v = vel ?? p.sealed.vel, w = spin ?? p.sealed.spin;
    p.sealed = null;
    const j = this.sealed.indexOf(p);
    if (j >= 0) this.sealed.splice(j, 1);
    p.body.setEnabled(true);
    p.body.setBodyType(p.frozen > 0 ? RAPIER.RigidBodyType.Fixed : RAPIER.RigidBodyType.Dynamic, true);
    p.body.setTranslation(at, true);
    if (p.frozen <= 0) { p.body.setLinvel(v, true); p.body.setAngvel(w, true); }
    p.mesh.position.copy(at);
    this.scene.add(p.mesh);
    this.instances.push(p);
    p.body.wakeUp();
    return true;
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
      if (p.heat > 0) {
        p.heat = Math.max(0, p.heat - dt * (p.cools ?? 0.06));
        this.paintHeat(p);
      }
    }
  }

  // Hot metal glows; wood and paper only smoulder.
  private paintHeat(p: PropInstance): void {
    if (!p.glow) return;
    const metal = p.def.traits.includes('metal');
    glowAt(p.heat, this.glowColor);
    // The paint darkens as the glow comes up, so the glow reads as the colour.
    const dark = metal ? Math.min(1, p.heat * 1.6) : Math.min(0.6, p.heat * 0.8);
    for (const m of p.glow) {
      m.color.copy(m.userData.base as THREE.Color).lerp(SCORCHED, dark);
      m.emissive.copy(this.glowColor);
      m.emissiveIntensity = metal ? 1.6 : 0.5;
    }
  }

  // Heats a prop by `amount`, up to a little past white.
  warm(p: PropInstance, amount: number): void {
    if (!p.alive || p.sealed) return;
    p.heat = THREE.MathUtils.clamp(p.heat + amount, 0, 1.25);
    if (!p.glow) {
      p.glow = [];
      p.mesh.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const c = (m.material as THREE.MeshToonMaterial).clone();
        c.userData.base = c.color.clone();
        mangaShading(c);
        m.material = c;
        p.glow!.push(c);
      });
    }
    this.paintHeat(p);
  }

  // Lets every hot prop go cold at once, when the effects that heated them end.
  cool(): void { for (const p of this.instances) { p.heat = 0; this.paintHeat(p); } }

  // Out of the ice now: the heat has melted it.
  unfreeze(p: PropInstance): boolean {
    if (!p.alive || p.sealed || p.frozen <= 0) return false;
    p.frozen = 0;
    p.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    return true;
  }

  find(body: RAPIER.RigidBody): PropInstance | undefined { return this.byBody.get(body.handle); }
  byId(id: number): PropInstance | undefined { return this.instances.find((p) => p.id === id) ?? this.sealed.find((p) => p.id === id); }

  // This screen is about to move the prop. A sealed prop is out of reach.
  touch(p: PropInstance): void { if (!p.sealed) this.authority?.touch(p); }

  // Every push a Technique or a blow gives a prop goes through here.
  push(p: PropInstance, impulse: THREE.Vector3, torque?: THREE.Vector3): void {
    if (!p.alive || p.sealed) return;
    this.touch(p);
    p.body.wakeUp();
    p.body.applyImpulse(impulse, true);
    if (torque) p.body.applyTorqueImpulse(torque, true);
  }

  launch(p: PropInstance, velocity: THREE.Vector3): void {
    if (!p.alive || p.sealed) return;
    this.touch(p);
    p.body.setLinvel(velocity, true);
  }

  // Frozen in place for `seconds`: the ice holds it, then lets it fall.
  freeze(p: PropInstance, seconds: number): void {
    if (!p.alive || p.sealed) return;
    this.touch(p);
    p.body.setBodyType(RAPIER.RigidBodyType.Fixed, true);
    p.frozen = seconds;
  }
}

// A wooden training dummy (mook jong): a post on a low foot with two arms
// at chest height, one lower arm and a bent leg, worn pale where it is struck.
function woodenDummy(): THREE.Object3D {
  const g = new THREE.Group();
  const wood = toon(0x8a5a3a), worn = toon(0xc49a66), dark = toon(0x4e3024);
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, rz = 0): void => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, 0, rz);
    g.add(m);
  };
  add(new THREE.BoxGeometry(0.7, 0.12, 0.7), dark, 0, 0.06, 0);
  add(new THREE.CylinderGeometry(0.17, 0.19, 1.55, 10), wood, 0, 0.9, 0);
  add(new THREE.CylinderGeometry(0.175, 0.175, 0.4, 10), worn, 0, 1.25, 0);
  for (const side of [-1, 1]) add(new THREE.CylinderGeometry(0.035, 0.045, 0.5, 6), worn, side * 0.12, 1.38, 0.3, Math.PI / 2 - 0.15, side * 0.35);
  add(new THREE.CylinderGeometry(0.035, 0.045, 0.5, 6), worn, 0, 1.06, 0.3, Math.PI / 2 + 0.15);
  add(new THREE.CylinderGeometry(0.04, 0.05, 0.6, 6), wood, 0, 0.45, 0.28, Math.PI / 2 - 0.7);
  add(new THREE.CylinderGeometry(0.19, 0.17, 0.08, 10), dark, 0, 1.69, 0);
  return g;
}
