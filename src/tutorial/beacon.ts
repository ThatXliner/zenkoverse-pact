import * as THREE from 'three';

// The spot a tutorial step happens at: a gold ring on the ground with a faint
// column of light over it, so the place reads from any camera before the
// player reads a word. One beacon moves from step to step.
const COLOR = 0xffc94a;

export class Beacon {
  private root = new THREE.Group();
  private ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private ping: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private beam: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  private t = 0;
  private at = false;

  constructor(scene: THREE.Scene) {
    const flat = (inner: number, outer: number, opacity: number) => {
      const m = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 56), new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, opacity, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.04;
      m.renderOrder = 2;
      return m;
    };
    this.ring = flat(0.95, 1.12, 0.85);
    this.ping = flat(0.98, 1.06, 0.6);
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 2.8, 40, 1, true), new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }));
    this.beam.position.y = 1.4;
    this.root.add(this.ring, this.ping, this.beam);
    this.root.visible = false;
    scene.add(this.root);
  }

  show(at: THREE.Vector3 | null): void {
    this.at = !!at;
    this.root.visible = this.at;
    if (at) this.root.position.copy(at);
  }

  // Hidden while something else holds the scene (a drill at the spot, a fight), without losing the spot.
  set hidden(on: boolean) { this.root.visible = !on && this.at; }

  update(dt: number): void {
    if (!this.root.visible) return;
    this.t += dt;
    // A ring of light leaves the mark once a second and fades as it widens.
    const k = this.t % 1.2 / 1.2;
    this.ping.scale.setScalar(1 + k * 0.9);
    this.ping.material.opacity = 0.6 * (1 - k);
    this.beam.material.opacity = 0.08 + Math.sin(this.t * 3) * 0.03;
  }
}
