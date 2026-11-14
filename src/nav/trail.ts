import * as THREE from 'three';
import { GROUP_WORLD, type Physics } from '../physics/world';

const GOLD = 0xffd34d;
const CHEVRONS = 12;
const SPACING = 2.0;
const TRAIL_RANGE = 36;

function gradientTexture(draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, w: number, h: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// The world side of tracking: a soft chevron trail on the ground toward the
// tracked place once the way there is open and close.
export class TrackerFx {
  private readonly group = new THREE.Group();
  private readonly chevrons: THREE.InstancedMesh;
  private readonly chevronMat: THREE.MeshBasicMaterial;
  private readonly dummy = new THREE.Object3D();
  private readonly from = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly down = new THREE.Vector3(0, -1, 0);
  private trailFade = 0;

  constructor(scene: THREE.Scene) {
    const chevronTex = gradientTexture((g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.lineWidth = w * 0.12;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.strokeStyle = '#fff';
      g.beginPath();
      g.moveTo(w * 0.18, h * 0.78);
      g.lineTo(w * 0.5, h * 0.24);
      g.lineTo(w * 0.82, h * 0.78);
      g.stroke();
    }, 64, 64);
    this.chevronMat = new THREE.MeshBasicMaterial({ color: GOLD, map: chevronTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.chevrons = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.9, 0.9), this.chevronMat, CHEVRONS);
    this.chevrons.frustumCulled = false;
    this.chevrons.visible = false;
    this.group.add(this.chevrons);
    scene.add(this.group);
  }

  update(raw: number, time: number, player: THREE.Vector3, target: THREE.Vector3 | null, physics: Physics): void {
    const flat = target ? Math.hypot(target.x - player.x, target.z - player.z) : 0;
    let wantTrail = 0;
    if (target && flat > 4 && flat < TRAIL_RANGE && Math.abs(target.y - player.y) < 4) {
      this.from.set(player.x, player.y + 1, player.z);
      this.dir.set(target.x - player.x, 0, target.z - player.z).normalize();
      const blocked = physics.castRay(this.from, this.dir, flat - 1, GROUP_WORLD);
      if (!blocked) wantTrail = 1;
    }
    this.trailFade += (wantTrail - this.trailFade) * (1 - Math.exp(-6 * raw));
    this.chevrons.visible = this.trailFade > 0.01;
    if (!target || !this.chevrons.visible) return;

    const yaw = Math.atan2(this.dir.x, this.dir.z);
    const flow = (time * 1.6) % SPACING;
    const reach = Math.min(flat - 2.5, SPACING * CHEVRONS);
    for (let i = 0; i < CHEVRONS; i++) {
      const s = 3.4 + i * SPACING + flow;
      const visible = s < reach;
      const px = player.x + this.dir.x * s;
      const pz = player.z + this.dir.z * s;
      const ground = physics.castRay(this.from.set(px, player.y + 1.2, pz), this.down, 3, GROUP_WORLD);
      this.dummy.position.set(px, (ground ? ground.point.y : player.y) + 0.07, pz);
      this.dummy.rotation.set(-Math.PI / 2, 0, yaw + Math.PI, 'YXZ');
      this.dummy.scale.setScalar(visible ? 1 : 0);
      this.dummy.updateMatrix();
      this.chevrons.setMatrixAt(i, this.dummy.matrix);
    }
    this.chevrons.instanceMatrix.needsUpdate = true;
    this.chevronMat.opacity = 0.5 * this.trailFade;
  }
}
