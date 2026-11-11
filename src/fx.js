import * as THREE from 'three';

const MAX = 6000;

export class Particles {
  constructor(scene) {
    this.pos = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    this.size = new Float32Array(MAX);
    this.alpha = new Float32Array(MAX);
    this.life = new Float32Array(MAX);
    this.maxLife = new Float32Array(MAX);
    this.drag = new Float32Array(MAX);
    this.grav = new Float32Array(MAX);
    this.next = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { scale: { value: window.innerHeight / 2 } },
      vertexShader: `
        attribute float size; attribute float alpha; attribute vec3 color;
        varying vec3 vColor; varying float vAlpha; uniform float scale;
        void main() {
          vColor = color; vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vColor; varying float vAlpha;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          if (d > 0.5) discard;
          float a = smoothstep(0.5, 0.0, d) * vAlpha;
          gl_FragColor = vec4(vColor * 1.6, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mat = mat;
    this.geo = geo;
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    window.addEventListener('resize', () => { mat.uniforms.scale.value = window.innerHeight / 2; });
  }

  emit(p, opts = {}) {
    const n = opts.count ?? 12;
    const c = new THREE.Color(opts.color ?? 0xffffff);
    const speed = opts.speed ?? 6;
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX;
      const sp = speed * (0.3 + Math.random() * 0.7);
      let dx, dy, dz;
      if (opts.dir) {
        const spread = opts.spread ?? 0.4;
        dx = opts.dir.x + (Math.random() - 0.5) * spread;
        dy = (opts.dir.y ?? 0) + (Math.random() - 0.5) * spread;
        dz = opts.dir.z + (Math.random() - 0.5) * spread;
      } else {
        dx = Math.random() - 0.5; dy = Math.random() * (opts.up ?? 0.8); dz = Math.random() - 0.5;
      }
      const len = Math.hypot(dx, dy, dz) || 1;
      this.pos[i * 3] = p.x + (Math.random() - 0.5) * (opts.jitter ?? 0.2);
      this.pos[i * 3 + 1] = (p.y ?? 1) + (Math.random() - 0.5) * (opts.jitter ?? 0.2);
      this.pos[i * 3 + 2] = p.z + (Math.random() - 0.5) * (opts.jitter ?? 0.2);
      this.vel[i * 3] = (dx / len) * sp;
      this.vel[i * 3 + 1] = (dy / len) * sp;
      this.vel[i * 3 + 2] = (dz / len) * sp;
      this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
      this.size[i] = (opts.size ?? 0.35) * (0.6 + Math.random() * 0.8);
      this.life[i] = this.maxLife[i] = (opts.life ?? 0.6) * (0.6 + Math.random() * 0.6);
      this.alpha[i] = 1;
      this.drag[i] = opts.drag ?? 2.5;
      this.grav[i] = opts.gravity ?? 6;
    }
  }

  update(dt) {
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= d; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt; this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] = Math.max(0.05, this.pos[i * 3 + 1] + this.vel[i * 3 + 1] * dt);
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.alpha[i] = Math.max(0, this.life[i] / this.maxLife[i]);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
    this.geo.attributes.alpha.needsUpdate = true;
  }
}

// Short-lived meshes: shockwave rings, flashes, telegraphs.
export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
    this.ringGeo = new THREE.RingGeometry(0.9, 1, 64);
  }

  ring(p, { color = 0xffffff, from = 0.5, to = 6, life = 0.4, y = 0.08, opacity = 0.9 } = {}) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    const m = new THREE.Mesh(this.ringGeo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(p.x, y, p.z);
    this.scene.add(m);
    this.list.push({ m, t: 0, life, update: (k) => { const s = from + (to - from) * easeOut(k); m.scale.set(s, s, s); mat.opacity = opacity * (1 - k); } });
  }

  // A transient mesh the caller builds; faded and removed after `life`.
  mesh(m, life, onUpdate) {
    this.scene.add(m);
    this.list.push({ m, t: 0, life, update: onUpdate ?? ((k) => { if (m.material) m.material.opacity = 1 - k; }) });
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      e.t += dt;
      const k = Math.min(1, e.t / e.life);
      e.update(k, dt);
      if (k >= 1) {
        this.scene.remove(e.m);
        e.m.material?.dispose?.();
        this.list.splice(i, 1);
      }
    }
  }
}

export const easeOut = (k) => 1 - (1 - k) * (1 - k);
