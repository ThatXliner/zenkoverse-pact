import * as THREE from 'three';

export class Input {
  constructor(canvas, camera) {
    this.camera = camera;
    this.keys = new Set();
    this.pressed = new Set();
    this.mouse = new THREE.Vector2();
    this.lmb = false;
    this.rmb = false;
    this.lmbPressed = false;
    this.rmbPressed = false;
    this.aim = new THREE.Vector3();
    this.ray = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1);

    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (!this.keys.has(k)) this.pressed.add(k);
      this.keys.add(k);
      if ([' ', 'tab'].includes(k)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => { this.keys.clear(); this.lmb = this.rmb = false; });
    canvas.addEventListener('mousemove', (e) => {
      this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) { this.lmb = true; this.lmbPressed = true; }
      if (e.button === 2) { this.rmb = true; this.rmbPressed = true; }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.lmb = false;
      if (e.button === 2) this.rmb = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  updateAim() {
    this.ray.setFromCamera(this.mouse, this.camera);
    this.ray.ray.intersectPlane(this.plane, this.aim);
  }

  down(k) { return this.keys.has(k); }
  hit(k) { return this.pressed.has(k); }

  endFrame() {
    this.pressed.clear();
    this.lmbPressed = false;
    this.rmbPressed = false;
  }
}
