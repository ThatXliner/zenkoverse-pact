import * as THREE from 'three';
import type { Physics } from '../physics/world';
import type { Vfx } from '../techniques/vfx';
import { toon } from '../render/materials';
import { POIS, type PoiId } from '../nav/poi';

const ICE = new THREE.Color(0x9fdfff);
const DORMANT = new THREE.Color(0x3b4654);

interface Shrine {
  id: PoiId;
  group: THREE.Group;
  crystal: THREE.Mesh;
  ring: THREE.MeshBasicMaterial;
  core: THREE.MeshStandardMaterial;
  gem: THREE.MeshStandardMaterial;
  glow: number;
  want: number;
}

// One small stone shrine with a floating crystal at each point of interest.
// Dormant until the player walks up to it, then it wakes: the place counts as
// visited, and the goal list moves on.
export class Waypoints {
  private readonly shrines = new Map<PoiId, Shrine>();

  constructor(physics: Physics, scene: THREE.Scene, private vfx: Vfx) {
    const stone = toon(0xa3a7a8);
    const group = new THREE.Group();
    scene.add(group);
    for (const poi of POIS) {
      const s = new THREE.Group();
      const add = <T extends THREE.Mesh>(m: T, y: number): T => { m.position.y = y; m.castShadow = true; m.receiveShadow = true; s.add(m); return m; };
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.58, 0.2, 8), stone), 0.1);
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.8, 8), stone), 0.6);
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.1, 6), stone), 1.05);
      const core = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: DORMANT, emissiveIntensity: 0.4, roughness: 0.4 });
      const fire = add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.36, 6), core), 1.28);
      fire.castShadow = false;
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.08, 6), stone), 1.5);
      add(new THREE.Mesh(new THREE.ConeGeometry(0.56, 0.36, 6), stone), 1.72);
      const ring = new THREE.MeshBasicMaterial({ color: DORMANT, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
      const flat = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.06, 56), ring);
      flat.rotation.x = -Math.PI / 2;
      flat.position.y = 0.03;
      s.add(flat);
      const gem = new THREE.MeshStandardMaterial({ color: 0x1a2028, emissive: DORMANT, emissiveIntensity: 0.5, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.85 });
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), gem);
      crystal.scale.y = 1.5;
      crystal.position.y = 2.4;
      s.add(crystal);
      s.position.copy(poi.shrine);
      group.add(s);
      physics.staticBox(new THREE.Vector3(poi.shrine.x, poi.shrine.y + 0.9, poi.shrine.z), new THREE.Vector3(0.4, 0.9, 0.4));
      this.shrines.set(poi.id, { id: poi.id, group: s, crystal, ring, core, gem, glow: 0, want: 0 });
    }
  }

  sync(unlocked: ReadonlySet<PoiId>): void {
    for (const sh of this.shrines.values()) { sh.want = unlocked.has(sh.id) ? 1 : 0; sh.glow = sh.want; this.apply(sh); }
  }

  unlock(id: PoiId): void {
    const sh = this.shrines.get(id);
    if (!sh) return;
    sh.want = 1;
    const p = sh.group.position;
    this.vfx.ring(new THREE.Vector3(p.x, p.y + 0.1, p.z), 0x9fdfff, 0.6, 6, 0.9);
    this.vfx.ring(new THREE.Vector3(p.x, p.y + 0.1, p.z), 0xffffff, 0.3, 3.5, 0.5);
    this.vfx.flash(new THREE.Vector3(p.x, p.y + 1.6, p.z), 0x9fdfff, 50, 0.8, 12);
  }

  update(raw: number, time: number): void {
    for (const sh of this.shrines.values()) {
      sh.glow += (sh.want - sh.glow) * (1 - Math.exp(-3 * raw));
      this.apply(sh);
      sh.crystal.rotation.y = time * (0.5 + sh.glow * 0.7);
      sh.crystal.position.y = 2.4 + Math.sin(time * 1.6 + sh.group.position.x) * 0.08 * (0.4 + sh.glow);
    }
  }

  private apply(sh: Shrine): void {
    sh.ring.color.copy(DORMANT).lerp(ICE, sh.glow);
    sh.ring.opacity = 0.55 + 0.45 * sh.glow;
    sh.core.emissive.copy(DORMANT).lerp(ICE, sh.glow);
    sh.core.emissiveIntensity = 0.4 + 3.6 * sh.glow;
    sh.gem.emissive.copy(DORMANT).lerp(ICE, sh.glow);
    sh.gem.emissiveIntensity = 0.5 + 3.5 * sh.glow;
  }
}
