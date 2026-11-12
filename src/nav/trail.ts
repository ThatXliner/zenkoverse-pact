import * as THREE from 'three';
import { GROUP_WORLD, type Physics } from '../physics/world';

const GOLD = 0xffd34d;
const CHEVRONS = 16;
const SPACING = 2.2;
const TRAIL_RANGE = 42;
const BEAM_HEIGHT = 70;

function gradientTexture(draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, w: number, h: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// The world side of tracking: a light column over the tracked place that
// reads from across the district, and a soft chevron trail on the ground
// once the way there is open and close.
export class TrackerFx {
  private readonly group = new THREE.Group();
  private readonly beam: THREE.Group;
  private readonly beamMats: THREE.MeshBasicMaterial[] = [];
  private readonly chevrons: THREE.InstancedMesh;
  private readonly chevronMat: THREE.MeshBasicMaterial;
  private readonly dummy = new THREE.Object3D();
  private readonly from = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly down = new THREE.Vector3(0, -1, 0);
  private beamFade = 0;
  private trailFade = 0;

  constructor(scene: THREE.Scene) {
    const column = gradientTexture((g, w, h) => {
      const grad = g.createLinearGradient(0, h, 0, 0);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    }, 4, 128);
    this.beam = new THREE.Group();
    for (const [radius, opacity] of [[0.9, 0.16], [0.16, 0.7]] as const) {
      const mat = new THREE.MeshBasicMaterial({ color: GOLD, map: column, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false, fog: false });
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.15, BEAM_HEIGHT, 16, 1, true), mat);
      mesh.position.y = BEAM_HEIGHT / 2;
      mesh.frustumCulled = false;
      this.beam.add(mesh);
      this.beamMats.push(mat);
    }
    this.beam.visible = false;
    this.group.add(this.beam);

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
    const wantBeam = target && flat > 14 ? 1 : 0;
    this.beamFade += (wantBeam - this.beamFade) * (1 - Math.exp(-5 * raw));
    this.beam.visible = target !== null && this.beamFade > 0.01;
    if (target && this.beam.visible) {
      this.beam.position.set(target.x, target.y, target.z);
      this.beamMats[0]!.opacity = 0.16 * this.beamFade * (0.85 + 0.15 * Math.sin(time * 2.1));
      this.beamMats[1]!.opacity = 0.7 * this.beamFade;
    }

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
