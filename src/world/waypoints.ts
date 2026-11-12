import * as THREE from 'three';
import type { Assets } from '../app/assets';
import type { Physics } from '../physics/world';
import type { Vfx } from '../techniques/vfx';
import { makeSurface } from '../render/materials';
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

// One stone lantern with a floating crystal at each point of interest.
// Dormant until the player walks up to it, then it wakes and the map
// offers fast travel to it.
export class Waypoints {
  private readonly shrines = new Map<PoiId, Shrine>();

  constructor(assets: Assets, physics: Physics, scene: THREE.Scene, private vfx: Vfx) {
    const stone = makeSurface(assets, 'Concrete034', { repeat: 1, wet: 0.7, color: 0xb9b4ac, roughness: 0.9 });
    const group = new THREE.Group();
    scene.add(group);
    for (const poi of POIS) {
      const s = new THREE.Group();
      const add = <T extends THREE.Mesh>(m: T, y: number): T => { m.position.y = y; m.castShadow = true; m.receiveShadow = true; s.add(m); return m; };
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.72, 0.22, 8), stone), 0.11);
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.26, 0.95, 8), stone), 0.7);
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.12, 6), stone), 1.24);
      const core = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: DORMANT, emissiveIntensity: 0.4, roughness: 0.4 });
      const fire = add(new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.44, 6), core), 1.52);
      fire.castShadow = false;
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.1, 6), stone), 1.79);
      add(new THREE.Mesh(new THREE.ConeGeometry(0.66, 0.42, 6), stone), 2.05);
      const ring = new THREE.MeshBasicMaterial({ color: DORMANT, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
      const flat = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.24, 56), ring);
      flat.rotation.x = -Math.PI / 2;
      flat.position.y = 0.04;
      s.add(flat);
      const gem = new THREE.MeshStandardMaterial({ color: 0x1a2028, emissive: DORMANT, emissiveIntensity: 0.5, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.85 });
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.27, 0), gem);
      crystal.scale.y = 1.5;
      crystal.position.y = 2.9;
      s.add(crystal);
      s.position.copy(poi.shrine);
      group.add(s);
      physics.staticBox(new THREE.Vector3(poi.shrine.x, poi.shrine.y + 1, poi.shrine.z), new THREE.Vector3(0.45, 1, 0.45));
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
    this.vfx.ring(new THREE.Vector3(p.x, p.y + 0.1, p.z), 0x9fdfff, 0.6, 7, 0.9);
    this.vfx.ring(new THREE.Vector3(p.x, p.y + 0.1, p.z), 0xffffff, 0.3, 4, 0.5);
    this.vfx.flash(new THREE.Vector3(p.x, p.y + 1.8, p.z), 0x9fdfff, 60, 0.8, 14);
  }

  update(raw: number, time: number): void {
    for (const sh of this.shrines.values()) {
      sh.glow += (sh.want - sh.glow) * (1 - Math.exp(-3 * raw));
      this.apply(sh);
      sh.crystal.rotation.y = time * (0.5 + sh.glow * 0.7);
      sh.crystal.position.y = 2.9 + Math.sin(time * 1.6 + sh.group.position.x) * 0.08 * (0.4 + sh.glow);
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
