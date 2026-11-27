import * as THREE from 'three';
import type { LightPool, PointSource } from '../render/lightPool';
import { ensoTexture, strokeTexture } from '../render/brush';
import { Mark, kiraTexture, type MarkShape } from './mark';
import { toon, faceted } from '../render/materials';

interface Particle { mesh: THREE.Object3D; vel: THREE.Vector3; spin: THREE.Vector3; life: number; max: number; kind: 'debris' | 'spark' | 'shard' | 'flame' | 'steam'; gravity: number; scaleEnd: number; size?: number }
interface Glint { sprite: THREE.Sprite; life: number; max: number; size: number; follow?: () => THREE.Vector3 }
interface Ring { mesh: THREE.Mesh; life: number; max: number; from: number; to: number; mat: THREE.MeshBasicMaterial; peak: number }
interface Trail { mesh: THREE.Mesh; points: THREE.Vector3[]; life: number; mat: THREE.MeshBasicMaterial; width: number; peak: number; at: THREE.Vector3 }
interface Flash { light: PointSource; life: number; max: number; peak: number }
interface Patch { mesh: THREE.Mesh; life: number; max: number; mat: THREE.MeshPhysicalMaterial; kind: 'frost' | 'burn' | 'fuel'; radius: number }
interface Timer { left: number; fire(): void }
// A bolt: a jagged line from `from` to `to` with forks that split off and
// die out, redrawn on a new path every few frames for as long as it lives.
// Two meshes: a wide additive glow under it, and the bolt itself, an ink
// edge, the colour and a white-hot core drawn over each other in one mesh.
interface Arc { glow: THREE.Mesh; body: THREE.Mesh; glowMat: THREE.MeshBasicMaterial; bodyMat: THREE.MeshBasicMaterial; color: THREE.Color; from: THREE.Vector3; to: THREE.Vector3; life: number; max: number; width: number; jag: number; forks: number; next: number }
interface Held { left: number; end(): void }

// The one owner of every effect's lifetime. It holds the pooled effects every
// Technique and enemy shares (shock rings, debris, sparks, ice shards, smear
// trails, flashes, frost and burn patches, afterimages), the beats an effect
// schedules for later (`after`), and anything else an effect puts into the
// world for a while (`until`: a frozen pond's floor, a slowed stride). All of
// it runs on game time, so it waits out a pause and a hit-stop, and `clear`
// ends all of it at once when a run, a Technique or a scene ends.
export class Vfx {
  private particles: Particle[] = [];
  private rings: Ring[] = [];
  private trails: Trail[] = [];
  private flashes: Flash[] = [];
  private patches: Patch[] = [];
  private marks: Mark[] = [];
  private glints: Glint[] = [];
  private arcs: Arc[] = [];
  private markGeo = new THREE.PlaneGeometry(1, 1);
  private flameGeo = new THREE.ConeGeometry(0.16, 0.7, 5).translate(0, 0.35, 0);
  // Steam is drawn as a manga panel draws it: solid puffs the brush inks round,
  // swelling as they rise and pinching off, not a soft glow.
  private steamGeo = faceted(new THREE.IcosahedronGeometry(0.24, 1));
  private steamMat = toon(0xfaf6f0, { emissive: 0x58524a });
  private flameMats = [0xff6a1a, 0xffa53a, 0xffd27a].map((color) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.92, depthWrite: false }));
  // The camera the frame is drawn from. Smears and rings fade as they reach
  // it, and in first person a ring is held to a small part of the view, so a
  // strike at arm's length never fills the screen (the old Recoil ring did).
  viewer: { camera: THREE.Camera; first(): boolean } | null = null;
  private debrisGeo = new THREE.BoxGeometry(0.12, 0.08, 0.1);
  private shardGeo = new THREE.ConeGeometry(0.05, 0.28, 5);
  private sparkGeo = new THREE.SphereGeometry(0.03, 6, 4);
  // A shock ring is an ensō, a smear is a dry-brush stroke (src/render/brush.ts).
  private ringGeo = new THREE.PlaneGeometry(2.2, 2.2);
  private patchGeo = new THREE.CircleGeometry(1, 32);
  private debrisMat = new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 0.9 });
  private metalMat = new THREE.MeshStandardMaterial({ color: 0x888c92, roughness: 0.4, metalness: 0.9 });
  // No transmission: it makes three render the whole scene a second time
  // whenever a shard or spike is on screen, which doubles the frame.
  private iceMat = new THREE.MeshPhysicalMaterial({ color: 0xcfefff, roughness: 0.12, emissive: 0x6fd3ff, emissiveIntensity: 0.3, transparent: true, opacity: 0.75 });
  private iceSpikeGeo = new THREE.ConeGeometry(0.22, 1.4, 6);
  readonly spikes: { mesh: THREE.Mesh; life: number; floor: number }[] = [];
  private timers: Timer[] = [];
  private held: Held[] = [];

  constructor(private scene: THREE.Scene, private lights: LightPool) {}

  // A later beat of an effect: a ridge that grows spike by spike, rings that
  // follow each other out. Dropped, not fired, if the scene ends first.
  after(seconds: number, fire: () => void): void { this.timers.push({ left: seconds, fire }); }

  // Something an effect puts into the world for `seconds`. `end` takes it
  // out again, when the time is up or when the scene ends, whichever is first.
  until(seconds: number, end: () => void): void { this.held.push({ left: seconds, end }); }

  // How many effects are alive, for the checks that prove a restart leaves none.
  get live(): number {
    return this.particles.length + this.rings.length + this.trails.length + this.flashes.length + this.patches.length + this.spikes.length + this.timers.length + this.held.length + this.marks.length + this.glints.length + this.arcs.length;
  }

  // Ends every effect now: a new run, a new Technique, or leaving a scene
  // starts with nothing left over from the last one.
  clear(): void {
    this.timers.length = 0;
    for (const h of this.held.splice(0)) h.end();
    for (const p of this.particles.splice(0)) { this.scene.remove(p.mesh); if (p.kind === 'spark') ((p.mesh as THREE.Mesh).material as THREE.Material).dispose(); }
    for (const r of this.rings.splice(0)) { this.scene.remove(r.mesh); r.mat.dispose(); }
    for (const t of this.trails.splice(0)) this.dropTrail(t);
    for (const f of this.flashes.splice(0)) this.lights.remove(f.light);
    for (const p of this.patches.splice(0)) { this.scene.remove(p.mesh); p.mat.dispose(); }
    for (const s of this.spikes.splice(0)) this.scene.remove(s.mesh);
    for (const m of this.marks.splice(0)) this.dropMark(m);
    for (const g of this.glints.splice(0)) { this.scene.remove(g.sprite); g.sprite.material.dispose(); }
    for (const a of this.arcs.splice(0)) this.dropArc(a);
  }

  private dropArc(a: Arc): void {
    for (const m of [a.glow, a.body]) { this.scene.remove(m); m.geometry.dispose(); }
    a.glowMat.dispose(); a.bodyMat.dispose();
  }

  // An electric arc between two points: `jag` is how far the path wanders
  // from the straight line, as a share of its length, and `forks` how many
  // branches split off it (by its length when left out). It takes a new path
  // every few frames while it lives. Drawn as the page draws lightning: an
  // ink edge, the colour, a white core, and a glow that lights what it crosses.
  arc(from: THREE.Vector3, to: THREE.Vector3, color: number, life = 0.2, width = 0.08, jag = 0.18, forks?: number): void {
    // The oldest go first when a set piece asks for more than the frame can hold.
    while (this.arcs.length >= MAX_ARCS) this.dropArc(this.arcs.shift()!);
    const mesh = (mat: THREE.MeshBasicMaterial, order: number): THREE.Mesh => {
      const m = new THREE.Mesh(new THREE.BufferGeometry(), mat);
      m.renderOrder = order;
      m.frustumCulled = false;
      this.scene.add(m);
      return m;
    };
    // Light drawn over what it runs past, as the page inks a bolt over a figure.
    const glowMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: GLOW_PEAK, side: THREE.DoubleSide, depthWrite: false, depthTest: false, toneMapped: false, blending: THREE.AdditiveBlending });
    const bodyMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, side: THREE.DoubleSide, depthWrite: false, depthTest: false, toneMapped: false });
    const len = from.distanceTo(to);
    const a: Arc = { glow: mesh(glowMat, 23), body: mesh(bodyMat, 24), glowMat, bodyMat, color: new THREE.Color(color), from: from.clone(), to: to.clone(), life, max: life, width, jag, forks: forks ?? (len > 2.5 ? 3 : len > 1.2 ? 2 : len > 0.5 ? 1 : 0), next: 0 };
    this.redrawArc(a);
    this.arcs.push(a);
  }

  private redrawArc(a: Arc): void {
    const eye = this.viewer?.camera.position ?? a.from.clone().add(new THREE.Vector3(0, 10, 0));
    const paths = boltPaths(a.from, a.to, a.jag, a.forks);
    a.glow.geometry.dispose();
    a.glow.geometry = boltGeometry(paths, [{ width: a.width * 3.4, color: a.color, alpha: 1 }], eye);
    a.body.geometry.dispose();
    a.body.geometry = boltGeometry(paths, [{ width: a.width * 2.1, color: INK, alpha: 1 }, { width: a.width * 1.35, color: a.color, alpha: 1 }, { width: a.width * 0.55, color: WHITE, alpha: 1 }], eye);
  }

  private dropMark(m: Mark): void { this.scene.remove(m.root); m.mat.dispose(); m.state = 'gone'; }

  // A telegraph on the ground (src/techniques/mark.ts). Its owner places it,
  // drives its sweep, and fires or cancels it; it then fades out on its own.
  mark(shape: MarkShape, color: number, at: THREE.Vector3, yaw: number, peak = 1): Mark {
    const m = new Mark(this.markGeo, shape, color, peak);
    m.place(at, yaw);
    this.scene.add(m.root);
    this.marks.push(m);
    return m;
  }

  // A glint at `at` (or following `follow`), drawn over everything for a beat.
  glint(at: THREE.Vector3, size = 0.55, life = 0.22, follow?: () => THREE.Vector3): void {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: kiraTexture(), transparent: true, depthTest: false, depthWrite: false }));
    sprite.position.copy(at);
    sprite.renderOrder = 30;
    sprite.scale.setScalar(0.01);
    this.scene.add(sprite);
    this.glints.push({ sprite, life, max: life, size, follow });
  }

  // Motes drawn in to `center` from a circle of `radius`, arriving together
  // after `seconds`: the air and the dust pulled toward a gathering body.
  gather(center: THREE.Vector3, radius: number, count: number, seconds: number, color: number): void {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.4, r = radius * (0.7 + Math.random() * 0.3);
      const from = new THREE.Vector3(center.x + Math.cos(a) * r, center.y + 0.1 + Math.random() * 1.4, center.z + Math.sin(a) * r);
      const m = new THREE.Mesh(this.sparkGeo, new THREE.MeshBasicMaterial({ color }));
      m.position.copy(from);
      m.scale.setScalar(1.2 + Math.random());
      this.scene.add(m);
      const to = center.clone().setY(center.y + 0.9);
      this.particles.push({ mesh: m, vel: to.sub(from).divideScalar(seconds), spin: new THREE.Vector3(), life: seconds, max: seconds, kind: 'spark', gravity: 0, scaleEnd: 0 });
    }
  }

  // Flame tongues licking up off `center`, spread over a disc of `radius`:
  // fire only where there is something to burn.
  flames(center: THREE.Vector3, radius: number, count: number, height = 1): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * radius;
      const m = new THREE.Mesh(this.flameGeo, this.flameMats[i % 3]!);
      m.position.set(center.x + Math.cos(a) * r, center.y + 0.02, center.z + Math.sin(a) * r);
      const size = (0.6 + Math.random() * 0.8) * height;
      m.scale.set(size * 0.8, 0.01, size * 0.8);
      m.rotation.set((Math.random() - 0.5) * 0.4, Math.random() * 6, (Math.random() - 0.5) * 0.4);
      this.scene.add(m);
      const max = 0.45 + Math.random() * 0.4;
      this.particles.push({ mesh: m, vel: new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.6 + Math.random() * 0.8, (Math.random() - 0.5) * 0.4), spin: new THREE.Vector3(0, (Math.random() - 0.5) * 4, 0), life: max, max, kind: 'flame', gravity: -1.5, scaleEnd: 0, size });
    }
  }

  // Steam rising off `center` over a disc of `radius`: water meeting heat, or
  // a hot body venting. `rise` is how high it climbs, in metres, and `size`
  // scales the puffs.
  steam(center: THREE.Vector3, radius: number, count: number, rise = 1.6, size = 1): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * radius;
      const m = new THREE.Mesh(this.steamGeo, this.steamMat);
      m.position.set(center.x + Math.cos(a) * r, center.y + Math.random() * 0.2, center.z + Math.sin(a) * r);
      m.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      m.scale.setScalar(0.01);
      this.scene.add(m);
      const max = 0.6 + Math.random() * 0.5;
      const puff = (0.5 + Math.random() * 0.7) * size;
      // Up fast at first, then drag slows it, so it climbs about `rise`.
      this.particles.push({ mesh: m, vel: new THREE.Vector3((Math.random() - 0.5) * 0.35, rise * (1.8 + Math.random() * 0.9), (Math.random() - 0.5) * 0.35), spin: new THREE.Vector3(Math.random(), Math.random() * 2, Math.random()), life: max, max, kind: 'steam', gravity: 0, scaleEnd: 0, size: puff });
    }
  }

  // Heat reaching ice: the spikes and frost within `radius` of `center` go
  // now. Returns how many pieces it melted.
  melt(center: THREE.Vector3, radius: number): number {
    let n = 0;
    for (const s of this.spikes) {
      if (s.life > 0.6 && Math.hypot(s.mesh.position.x - center.x, s.mesh.position.z - center.z) < radius) { s.life = 0.6; n++; }
    }
    for (const p of this.patches) {
      if (p.kind === 'frost' && p.life > 0.5 && Math.hypot(p.mesh.position.x - center.x, p.mesh.position.z - center.z) < radius + p.mesh.scale.x * 0.5) { p.life = 0.5; p.max = Math.max(p.max, 0.5); n++; }
    }
    return n;
  }

  private dropTrail(t: Trail): void {
    this.scene.remove(t.mesh);
    if (t.mesh instanceof THREE.Group) for (const c of t.mesh.children) { (c as THREE.Mesh).geometry.dispose(); ((c as THREE.Mesh).material as THREE.Material).dispose(); }
    else t.mesh.geometry.dispose();
    t.mat.dispose();
  }

  ring(center: THREE.Vector3, color: number, from: number, to: number, life = 0.45, normal?: THREE.Vector3, peak = 0.95): void {
    const mat = new THREE.MeshBasicMaterial({ color, map: ensoTexture(), transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false });
    const mesh = new THREE.Mesh(this.ringGeo, mat);
    mesh.position.copy(center);
    if (normal) mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal); else mesh.rotation.x = -Math.PI / 2;
    // Each ring is its own stroke: the brush starts somewhere else round it.
    mesh.rotateZ(Math.random() * Math.PI * 2);
    mesh.scale.setScalar(from);
    this.scene.add(mesh);
    this.rings.push({ mesh, life, max: life, from, to, mat, peak });
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
    const light = this.lights.add<PointSource>({ kind: 'point', urgent: true, position: center.clone(), color: new THREE.Color(color), intensity, distance, decay: 2 });
    this.flashes.push({ light, life, max: life, peak: intensity });
  }

  // Smear: a ribbon through the recent positions of a fast limb or projectile.
  trail(points: THREE.Vector3[], color: number, width = 0.25, life = 0.18): void {
    if (points.length < 2) return;
    const geo = ribbon(points, width);
    const mat = new THREE.MeshBasicMaterial({ color, map: strokeTexture(), transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    this.scene.add(mesh);
    const at = new THREE.Vector3();
    for (const p of points) at.add(p);
    this.trails.push({ mesh, points, life, mat, width, peak: 0.9, at: at.divideScalar(points.length) });
  }

  // Ends a patch early: it fades over `seconds` from now.
  endPatch(mesh: THREE.Mesh, seconds = 0.3): void {
    const p = this.patches.find((x) => x.mesh === mesh);
    if (p) { p.life = Math.min(p.life, seconds); p.max = Math.max(p.max, seconds); }
  }

  // The patches of `kind` lying under `at` (within `margin` of one's edge),
  // for what reads the ground: frost thawing on stone is meltwater, and
  // meltwater carries a current.
  patchesUnder(at: THREE.Vector3, kind: Patch['kind'], margin = 0): { at: THREE.Vector3; radius: number }[] {
    return this.patches.filter((p) => p.kind === kind && p.life > 0.3 && Math.abs(at.y - p.mesh.position.y) < 1.2 && Math.hypot(at.x - p.mesh.position.x, at.z - p.mesh.position.z) < p.radius + margin).map((p) => ({ at: p.mesh.position.clone(), radius: p.radius }));
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
    this.patches.push({ mesh, life, max: life, mat, kind, radius });
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
    this.spikes.push({ mesh: m, life, floor: pos.y });
  }

  // A copy of a body's pose left behind for a moment. Additive reads as
  // light (a blink, a dash); without, it reads as a pale ghost on a bright floor.
  afterimage(source: THREE.Object3D, color: number, life = 0.35, additive = true): void {
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
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
      m.applyMatrix4(sm.matrixWorld);
      group.add(m);
    });
    this.scene.add(group);
    const mat = (group.children[0] as THREE.Mesh | undefined)?.material as THREE.MeshBasicMaterial | undefined;
    if (!mat) return;
    this.trails.push({ mesh: group as unknown as THREE.Mesh, points: [], life, mat, width: 0, peak: 0.55, at: source.getWorldPosition(new THREE.Vector3()) });
  }

  update(dt: number): void {
    // A beat may schedule another, so fire from a snapshot.
    const due = this.timers.filter((t) => (t.left -= dt) <= 0);
    if (due.length) { this.timers = this.timers.filter((t) => t.left > 0); for (const t of due) t.fire(); }
    for (let i = this.held.length - 1; i >= 0; i--) {
      const h = this.held[i]!;
      if ((h.left -= dt) <= 0) { this.held.splice(i, 1); h.end(); }
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.life -= dt;
      p.vel.y -= p.gravity * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      if (p.kind === 'steam') {
        p.vel.multiplyScalar(Math.exp(-1.8 * dt));
        // Swells fast, holds, and pinches off at the top.
        const left = p.life / p.max;
        p.mesh.rotation.y += p.spin.y * dt;
        const k = p.size! * Math.min(1, (1 - left) * 4) * Math.min(1, left * 2.5);
        p.mesh.scale.set(Math.max(0.01, k), Math.max(0.01, k * (1 + (1 - left) * 0.5)), Math.max(0.01, k));
        if (p.life <= 0) { this.scene.remove(p.mesh); this.particles.splice(i, 1); }
        continue;
      }
      if (p.mesh.position.y < 0.03 && p.kind !== 'spark' && p.kind !== 'flame') { p.mesh.position.y = 0.03; p.vel.y *= -0.3; p.vel.x *= 0.7; p.vel.z *= 0.7; p.spin.multiplyScalar(0.5); }
      p.mesh.rotation.x += p.spin.x * dt; p.mesh.rotation.y += p.spin.y * dt;
      const u = p.life / p.max;
      if (p.kind === 'flame') {
        // Up fast, then thinning as it burns off.
        const k = p.size! * Math.sin(Math.min(1, (1 - u) * 1.6) * Math.PI * 0.5) * Math.min(1, u * 2.2);
        p.mesh.scale.set(p.size! * 0.8 * Math.min(1, u * 1.6), Math.max(0.01, k), p.size! * 0.8 * Math.min(1, u * 1.6));
      } else if (u < 0.3) p.mesh.scale.multiplyScalar(Math.max(0, 1 - dt * 4));
      if (p.life <= 0) { this.scene.remove(p.mesh); if (p.kind === 'spark') (p.mesh as THREE.Mesh).material && ((p.mesh as THREE.Mesh).material as THREE.Material).dispose(); this.particles.splice(i, 1); }
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]!;
      r.life -= dt;
      const u = 1 - r.life / r.max;
      const e = 1 - Math.pow(1 - u, 3);
      r.mesh.scale.setScalar(Math.min(THREE.MathUtils.lerp(r.from, r.to, e), this.nearCap(r.mesh.position)));
      r.mat.opacity = Math.min(1, (1 - u) * 1.6) * r.peak * this.nearFade(r.mesh.position);
      if (r.life <= 0) { this.scene.remove(r.mesh); r.mat.dispose(); this.rings.splice(i, 1); }
    }
    for (let i = this.trails.length - 1; i >= 0; i--) {
      const t = this.trails[i]!;
      t.life -= dt;
      t.mat.opacity = Math.min(1, Math.max(0, t.life * 4)) * t.peak * this.nearFade(t.at);
      if (t.mesh instanceof THREE.Group) for (const c of t.mesh.children) ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = t.mat.opacity;
      if (t.life <= 0) { this.dropTrail(t); this.trails.splice(i, 1); }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i]!;
      f.life -= dt;
      f.light.intensity = f.peak * Math.max(0, f.life / f.max);
      if (f.life <= 0) { this.lights.remove(f.light); this.flashes.splice(i, 1); }
    }
    for (let i = this.patches.length - 1; i >= 0; i--) {
      const p = this.patches[i]!;
      p.life -= dt;
      const target = (p.mesh as unknown as { targetRadius: number }).targetRadius;
      p.mesh.scale.setScalar(THREE.MathUtils.lerp(p.mesh.scale.x, target, 1 - Math.exp(-6 * dt)));
      if (p.life < 2) p.mat.opacity = Math.max(0, p.life / 2) * 0.85;
      if (p.life <= 0) { this.scene.remove(p.mesh); p.mat.dispose(); this.patches.splice(i, 1); }
    }
    for (let i = this.marks.length - 1; i >= 0; i--) {
      const m = this.marks[i]!;
      if (m.state === 'live') continue;
      m.fade -= dt;
      const u = Math.max(0, m.fade) / (m.state === 'fired' ? 0.22 : 0.1);
      m.mat.uniforms.opacity!.value = u * m.peak;
      m.mat.uniforms.fill!.value = m.state === 'fired' ? u : 0;
      if (m.fade <= 0) { this.dropMark(m); this.marks.splice(i, 1); }
    }
    for (let i = this.glints.length - 1; i >= 0; i--) {
      const g = this.glints[i]!;
      g.life -= dt;
      const u = 1 - g.life / g.max;
      if (g.follow) g.sprite.position.copy(g.follow());
      // Pops open, holds, and pinches shut.
      g.sprite.scale.setScalar(g.size * Math.max(0.01, (0.45 + 0.55 * Math.min(1, u * 5)) * Math.min(1, (1 - u) * 3)));
      g.sprite.material.rotation = u * 0.6;
      if (g.life <= 0) { this.scene.remove(g.sprite); g.sprite.material.dispose(); this.glints.splice(i, 1); }
    }
    for (let i = this.arcs.length - 1; i >= 0; i--) {
      const a = this.arcs[i]!;
      a.life -= dt;
      if (a.life <= 0) { this.dropArc(a); this.arcs.splice(i, 1); continue; }
      // A bolt is light: it holds full, then gutters out in flickers.
      const u = a.life / a.max;
      const flicker = (u > 0.5 ? 1 : (Math.random() < 0.3 ? 0.25 : 1) * u * 2) * this.nearFade(a.from.clone().lerp(a.to, 0.5));
      a.bodyMat.opacity = flicker;
      a.glowMat.opacity = GLOW_PEAK * flicker;
      if ((a.next -= dt) <= 0) { a.next = 0.045; this.redrawArc(a); }
    }
    for (let i = this.spikes.length - 1; i >= 0; i--) {
      const s = this.spikes[i]!;
      s.life -= dt;
      const th = (s.mesh as unknown as { targetH: number }).targetH;
      s.mesh.scale.y = THREE.MathUtils.lerp(s.mesh.scale.y, s.life < 1 ? 0.01 : th, 1 - Math.exp(-(s.life < 1 ? 5 : 14) * dt));
      s.mesh.position.y = s.floor + Math.max(0, s.mesh.scale.y * 0.7 - 0.2);
      if (s.life <= 0) { this.scene.remove(s.mesh); this.spikes.splice(i, 1); }
    }
  }
  // The largest scale a ring at `at` may reach in first person: a radius of
  // no more than about 14 degrees of the view.
  private nearCap(at: THREE.Vector3): number {
    if (!this.viewer?.first()) return Infinity;
    return Math.max(0.05, at.distanceTo(this.viewer.camera.position) * 0.25 / 1.1);
  }

  // Fades an effect out as it comes within two metres of the camera.
  private nearFade(at: THREE.Vector3): number {
    if (!this.viewer) return 1;
    return THREE.MathUtils.smoothstep(at.distanceTo(this.viewer.camera.position), 0.7, 2.2);
  }
}

const INK = new THREE.Color(0x17110c);
const WHITE = new THREE.Color(0xffffff);
const GLOW_PEAK = 0.22;
// Bolts alive at once, at most: a Closed Circuit through a crowd asks for many.
const MAX_ARCS = 180;

interface BoltPath { pts: THREE.Vector3[]; w: number }

// The paths of one bolt: the main line from `a` to `b`, kinked at random
// points off the straight line, and `forks` branches off it that die out,
// some splitting once more.
function boltPaths(a: THREE.Vector3, b: THREE.Vector3, jag: number, forks: number): BoltPath[] {
  const len = a.distanceTo(b);
  const n = Math.max(4, Math.min(28, Math.round(len / 0.16)));
  const dir = b.clone().sub(a).normalize();
  const side = new THREE.Vector3().crossVectors(dir, Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(side, dir).normalize();
  const kink = (p: THREE.Vector3, amount: number) => p.addScaledVector(side, (Math.random() - 0.5) * 2 * amount).addScaledVector(up, (Math.random() - 0.5) * 2 * amount);
  const main = [a.clone()];
  // Lightning zigzags: each kink swings to the other side of the line from
  // the last, by a random share of the most it may wander there.
  let swing = Math.random() < 0.5 ? 1 : -1;
  for (let i = 1; i < n; i++) {
    const amount = len * jag * Math.sin((i / n) * Math.PI) * 0.5;
    swing = -swing;
    main.push(kink(a.clone().lerp(b, i / n), amount * 0.35).addScaledVector(side, swing * amount * (0.4 + Math.random() * 0.6)));
  }
  main.push(b.clone());
  const paths: BoltPath[] = [{ pts: main, w: 1 }];
  const branch = (from: THREE.Vector3, heading: THREE.Vector3, length: number, w: number, depth: number): void => {
    const steps = 4;
    const pts = [from.clone()];
    for (let k = 1; k <= steps; k++) pts.push(kink(pts[k - 1]!.clone().addScaledVector(heading, length / steps), length * 0.18));
    paths.push({ pts, w });
    if (depth > 0 && Math.random() < 0.6) {
      const turn = heading.clone().addScaledVector(side, (Math.random() - 0.5) * 1.8).addScaledVector(up, (Math.random() - 0.5) * 1.2).normalize();
      branch(pts[2]!, turn, length * 0.5, w * 0.6, depth - 1);
    }
  };
  for (let f = 0; f < forks; f++) {
    const at = 1 + Math.floor(Math.random() * (n - 2));
    const heading = dir.clone().addScaledVector(side, (Math.random() - 0.5) * 2.2).addScaledVector(up, (Math.random() - 0.5) * 1.6).normalize();
    branch(main[at]!, heading, len * (0.22 + Math.random() * 0.25), 0.55, 1);
  }
  return paths;
}

// Quads along each path, turned to face the eye, thinning toward a fork's
// end, once per layer in the order given (the last is drawn on top).
function boltGeometry(paths: BoltPath[], layers: { width: number; color: THREE.Color; alpha: number }[], eye: THREE.Vector3): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const s = new THREE.Vector3(), d = new THREE.Vector3(), to = new THREE.Vector3();
  for (const layer of layers) {
    for (const { pts, w: pw } of paths) {
      const base = pos.length / 3;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i]!;
        if (i < pts.length - 1) d.subVectors(pts[i + 1]!, p); else d.subVectors(p, pts[i - 1]!);
        d.normalize();
        // Seen from far off (the top-down camera) a bolt keeps a readable width; up close (a cutscene) it thins.
        const far = THREE.MathUtils.clamp(eye.distanceTo(p) / 6, 0.45, 2.6);
        const w = layer.width * 0.5 * far * pw * (pw === 1 ? 1 - 0.35 * (i / pts.length) : 1 - i / pts.length);
        s.crossVectors(d, to.subVectors(eye, p)).normalize().multiplyScalar(w);
        pos.push(p.x + s.x, p.y + s.y, p.z + s.z, p.x - s.x, p.y - s.y, p.z - s.z);
        for (let k = 0; k < 2; k++) col.push(layer.color.r, layer.color.g, layer.color.b, layer.alpha);
      }
      for (let i = 0; i < pts.length - 1; i++) { const k = base + i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  return g;
}

function ribbon(points: THREE.Vector3[], width: number): THREE.BufferGeometry {
  const n = points.length;
  const pos = new Float32Array(n * 2 * 3);
  const uv = new Float32Array(n * 2 * 2);
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < n; i++) {
    const p = points[i]!;
    const dir = (i < n - 1 ? points[i + 1]!.clone().sub(p) : p.clone().sub(points[i - 1]!)).normalize();
    const side = new THREE.Vector3().crossVectors(dir, up).normalize().multiplyScalar(width * 0.5 * (1 - i / n));
    pos.set([p.x + side.x, p.y + side.y, p.z + side.z, p.x - side.x, p.y - side.y, p.z - side.z], i * 6);
    uv.set([i / (n - 1), 0, i / (n - 1), 1], i * 4);
  }
  const idx: number[] = [];
  for (let i = 0; i < n - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
