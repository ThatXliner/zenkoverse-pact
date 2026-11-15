import * as THREE from 'three';
import type { Avatar } from '../character/avatar';
import { EYES, EYE_SIDE, type EyeId } from './registry';

// The Eye as others see it on a body: an iris of the Eye's colour in the
// socket it took, and a short glint trailing back from it, as a panel draws
// an eye that is not a natural one. The glint stands off the side of the
// head, so it reads from the top-down camera as a tick on that side.

// Authored in the body's frame at the point between the eyes, in metres:
// +X right, +Y up, -Z forward.
function glint(side: number): THREE.BufferGeometry {
  const pts: number[] = [];
  const idx: number[] = [];
  const N = 8;
  // A tapering stroke from the eye back past the ear, in two crossed
  // ribbons (one flat, one upright) so it keeps its width from any angle.
  for (const upright of [false, true]) {
    const base = pts.length / 3;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const x = side * (0.05 + t * 0.14), y = 0.006 + t * 0.02, z = -0.01 + t * 0.1;
      const w = 0.011 * (1 - t) ** 1.2 + 0.0015;
      if (upright) pts.push(x, y - w, z, x, y + w, z);
      else pts.push(x - side * w * 0.4, y, z - w, x + side * w * 0.4, y, z + w);
      if (i < N) { const a = base + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.setIndex(idx);
  return g;
}

const IRIS = new THREE.CircleGeometry(0.016, 18);
const GLINT = { left: glint(-1), right: glint(1) };

export class EyeMark {
  private group = new THREE.Group();
  private iris: THREE.Mesh;
  private trail: THREE.Mesh;
  private irisMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  private trailMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
  id: EyeId | null = null;

  constructor(private avatar: Avatar) {
    const s = EYE_SIDE === 'right' ? 1 : -1;
    this.iris = new THREE.Mesh(IRIS, this.irisMat);
    this.iris.position.set(s * 0.031, 0.003, -0.016);
    this.iris.rotation.y = Math.PI;
    this.trail = new THREE.Mesh(GLINT[EYE_SIDE], this.trailMat);
    this.trail.renderOrder = 4;
    for (const m of [this.iris, this.trail]) { m.castShadow = false; m.frustumCulled = false; this.group.add(m); }
    this.group.matrixAutoUpdate = false;
    this.group.matrix.copy(avatar.eyeFrame);
    this.group.visible = false;
    avatar.bones.get('Head')?.add(this.group);
  }

  set(id: EyeId | null): void {
    if (id === this.id) return;
    this.id = id;
    this.group.visible = id !== null;
    if (!id) return;
    this.irisMat.color.set(EYES[id].color);
    this.trailMat.color.set(EYES[id].color);
  }

  dispose(): void { this.group.removeFromParent(); this.irisMat.dispose(); this.trailMat.dispose(); }
}
