import * as THREE from 'three';

interface Particle { mesh: THREE.Object3D; vel: THREE.Vector3; spin: THREE.Vector3; life: number; max: number; kind: 'debris' | 'spark' | 'shard'; gravity: number; scaleEnd: number }
interface Ring { mesh: THREE.Mesh; life: number; max: number; from: number; to: number; mat: THREE.MeshBasicMaterial }
interface Trail { mesh: THREE.Mesh; points: THREE.Vector3[]; life: number; mat: THREE.MeshBasicMaterial; width: number }
interface Flash { light: THREE.PointLight; life: number; max: number; peak: number }
interface Patch { mesh: THREE.Mesh; life: number; max: number; mat: THREE.MeshPhysicalMaterial }

// Pooled effects shared by every Technique: shock rings, debris, sparks,
// ice shards, smear trails, flashes, frost and burn patches, afterimages.
export class Vfx {
  private particles: Particle[] = [];
  private rings: Ring[] = [];
  private trails: Trail[] = [];
  private flashes: Flash[] = [];
  private patches: Patch[] = [];
  private debrisGeo = new THREE.BoxGeometry(0.12, 0.08, 0.1);
  private shardGeo = new THREE.ConeGeometry(0.05, 0.28, 5);
  private sparkGeo = new THREE.SphereGeometry(0.03, 6, 4);
  private ringGeo = new THREE.RingGeometry(0.9, 1, 64);
  private patchGeo = new THREE.CircleGeometry(1, 32);
  private debrisMat = new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 0.9 });
  private metalMat = new THREE.MeshStandardMaterial({ color: 0x888c92, roughness: 0.4, metalness: 0.9 });
  private iceMat = new THREE.MeshPhysicalMaterial({ color: 0xcfefff, roughness: 0.12, transmission: 0.4, thickness: 0.3, emissive: 0x6fd3ff, emissiveIntensity: 0.3, transparent: true, opacity: 0.9 });
  private iceSpikeGeo = new THREE.ConeGeometry(0.22, 1.4, 6);
  readonly spikes: { mesh: THREE.Mesh; life: number }[] = [];

  constructor(private scene: THREE.Scene) {}

  ring(center: THREE.Vector3, color: number, from: number, to: number, life = 0.45, normal?: THREE.Vector3): void {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    const mesh = new THREE.Mesh(this.ringGeo, mat);
    mesh.position.copy(center);
    if (normal) mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal); else mesh.rotation.x = -Math.PI / 2;
    mesh.scale.setScalar(from);
    this.scene.add(mesh);
    this.rings.push({ mesh, life, max: life, from, to, mat });
  }

  burst(center: THREE.Vector3, count: number, kind: 'debris' | 'spark' | 'shard', speed: number, color?: number, dir?: THREE.Vector3): void {
    for (let i = 0; i < count; i++) {
      const geo = kind === 'debris' ? this.debrisGeo : kind === 'shard' ? this.shardGeo : this.sparkGeo;
      const mat = kind === 'spark' ? new THREE.MeshBasicMaterial({ color: color ?? 0xffd27a }) : kind === 'shard' ? this.iceMat : (color === 0x888c92 ? this.metalMat : this.debrisMat);
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(center);
      m.castShadow = kind !== 'spark';
      const v = new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 1.2 + 0.2, (Math.random() - 0.5) * 2).normalize();
      if (dir) v.lerp(dir, 0.6).normalize();
      v.multiplyScalar(speed * (0.5 + Math.random()));
      const s = 0.5 + Math.random() * 0.9;
      m.scale.setScalar(s);
      m.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      this.scene.add(m);
      const max = kind === 'spark' ? 0.35 + Math.random() * 0.3 : 1.6 + Math.random() * 1.4;
      this.particles.push({ mesh: m, vel: v, spin: new THREE.Vector3(Math.random() * 10, Math.random() * 10, Math.random() * 10), life: max, max, kind, gravity: kind === 'spark' ? 4 : 18, scaleEnd: kind === 'spark' ? 0 : 0.9 });
    }
  }

  flash(center: THREE.Vector3, color: number, intensity: number, life = 0.25, distance = 12): void {
    const light = new THREE.PointLight(color, intensity, distance, 2);
    light.position.copy(center);
    this.scene.add(light);
    this.flashes.push({ light, life, max: life, peak: intensity });
  }

  // Smear: a ribbon through the recent positions of a fast limb or projectile.
  trail(points: THREE.Vector3[], color: number, width = 0.25, life = 0.18): void {
    if (points.length < 2) return;
    const geo = ribbon(points, width);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    const mesh = new THREE.Mesh(geo, mat);
    this.scene.add(mesh);
    this.trails.push({ mesh, points, life, mat, width });
  }

  patch(center: THREE.Vector3, radius: number, kind: 'frost' | 'burn' | 'fuel', life = 12): THREE.Mesh {
    const mat = new THREE.MeshPhysicalMaterial(kind === 'frost'
      ? { color: 0xdff6ff, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.85, emissive: 0x6fd3ff, emissiveIntensity: 0.12, clearcoat: 1 }
      : kind === 'burn' ? { color: 0x0a0806, roughness: 0.95, transparent: true, opacity: 0.9 }
      : { color: 0x3a2a10, roughness: 0.02, metalness: 0.3, transparent: true, opacity: 0.8, iridescence: 1, iridescenceIOR: 1.4, emissive: 0xff5a1a, emissiveIntensity: 0.05 });
    const mesh = new THREE.Mesh(this.patchGeo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(center).add(new THREE.Vector3(0, 0.012 + Math.random() * 0.004, 0));
    mesh.scale.setScalar(0.01);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.patches.push({ mesh, life, max: life, mat });
    (mesh as unknown as { targetRadius: number }).targetRadius = radius;
    return mesh;
  }

  iceSpike(pos: THREE.Vector3, height: number, life = 9): void {
    const m = new THREE.Mesh(this.iceSpikeGeo, this.iceMat);
    m.position.copy(pos);
    m.scale.set(0.6 + Math.random() * 0.6, 0.01, 0.6 + Math.random() * 0.6);
    m.rotation.set((Math.random() - 0.5) * 0.5, Math.random() * 6, (Math.random() - 0.5) * 0.5);
    m.castShadow = true;
    this.scene.add(m);
    (m as unknown as { targetH: number }).targetH = height;
    this.spikes.push({ mesh: m, life });
  }

  afterimage(source: THREE.Object3D, color: number, life = 0.35): void {
    source.updateWorldMatrix(true, true);
    const group = new THREE.Group();
    source.traverse((o) => {
      const sm = o as THREE.SkinnedMesh;
      if (!sm.isSkinnedMesh) return;
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(sm.geometry.getAttribute('position').count * 3);
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.length / 3; i++) { sm.getVertexPosition(i, v); pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z; }
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      if (sm.geometry.index) geo.setIndex(sm.geometry.index);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.applyMatrix4(sm.matrixWorld);
      group.add(m);
    });
    this.scene.add(group);
    const mat = (group.children[0] as THREE.Mesh | undefined)?.material as THREE.MeshBasicMaterial | undefined;
    if (!mat) return;
    this.trails.push({ mesh: group as unknown as THREE.Mesh, points: [], life, mat, width: 0 });
  }

  update(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.life -= dt;
      p.vel.y -= p.gravity * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      if (p.mesh.position.y < 0.03 && p.kind !== 'spark') { p.mesh.position.y = 0.03; p.vel.y *= -0.3; p.vel.x *= 0.7; p.vel.z *= 0.7; p.spin.multiplyScalar(0.5); }
      p.mesh.rotation.x += p.spin.x * dt; p.mesh.rotation.y += p.spin.y * dt;
      const u = p.life / p.max;
      if (u < 0.3) p.mesh.scale.multiplyScalar(Math.max(0, 1 - dt * 4));
      if (p.life <= 0) { this.scene.remove(p.mesh); if (p.kind === 'spark') (p.mesh as THREE.Mesh).material && ((p.mesh as THREE.Mesh).material as THREE.Material).dispose(); this.particles.splice(i, 1); }
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]!;
      r.life -= dt;
      const u = 1 - r.life / r.max;
      const e = 1 - Math.pow(1 - u, 3);
      r.mesh.scale.setScalar(THREE.MathUtils.lerp(r.from, r.to, e));
      r.mat.opacity = (1 - u) * 0.9;
      if (r.life <= 0) { this.scene.remove(r.mesh); r.mat.dispose(); this.rings.splice(i, 1); }
    }
    for (let i = this.trails.length - 1; i >= 0; i--) {
      const t = this.trails[i]!;
      t.life -= dt;
      t.mat.opacity = Math.max(0, t.life * 4) * 0.75;
      if (t.mesh instanceof THREE.Group) for (const c of t.mesh.children) ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = t.mat.opacity;
      if (t.life <= 0) { this.scene.remove(t.mesh); if (t.mesh.geometry) t.mesh.geometry.dispose(); t.mat.dispose(); this.trails.splice(i, 1); }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i]!;
      f.life -= dt;
      f.light.intensity = f.peak * Math.max(0, f.life / f.max);
      if (f.life <= 0) { this.scene.remove(f.light); this.flashes.splice(i, 1); }
    }
    for (let i = this.patches.length - 1; i >= 0; i--) {
      const p = this.patches[i]!;
      p.life -= dt;
      const target = (p.mesh as unknown as { targetRadius: number }).targetRadius;
      p.mesh.scale.setScalar(THREE.MathUtils.lerp(p.mesh.scale.x, target, 1 - Math.exp(-6 * dt)));
      if (p.life < 2) p.mat.opacity = Math.max(0, p.life / 2) * 0.85;
      if (p.life <= 0) { this.scene.remove(p.mesh); p.mat.dispose(); this.patches.splice(i, 1); }
    }
    for (let i = this.spikes.length - 1; i >= 0; i--) {
      const s = this.spikes[i]!;
      s.life -= dt;
      const th = (s.mesh as unknown as { targetH: number }).targetH;
      s.mesh.scale.y = THREE.MathUtils.lerp(s.mesh.scale.y, s.life < 1 ? 0.01 : th, 1 - Math.exp(-(s.life < 1 ? 5 : 14) * dt));
      s.mesh.position.y = Math.max(0, s.mesh.scale.y * 0.7 - 0.2);
      if (s.life <= 0) { this.scene.remove(s.mesh); this.spikes.splice(i, 1); }
    }
  }
}

function ribbon(points: THREE.Vector3[], width: number): THREE.BufferGeometry {
  const n = points.length;
  const pos = new Float32Array(n * 2 * 3);
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < n; i++) {
    const p = points[i]!;
    const dir = (i < n - 1 ? points[i + 1]!.clone().sub(p) : p.clone().sub(points[i - 1]!)).normalize();
    const side = new THREE.Vector3().crossVectors(dir, up).normalize().multiplyScalar(width * 0.5 * (1 - i / n));
    pos.set([p.x + side.x, p.y + side.y, p.z + side.z, p.x - side.x, p.y - side.y, p.z - side.z], i * 6);
  }
  const idx: number[] = [];
  for (let i = 0; i < n - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}
