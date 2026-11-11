import * as THREE from 'three';
import { rainUniforms } from '../render/materials';

const streakVert = /* glsl */ `
uniform float time; uniform vec3 center; uniform float extent; uniform float height; uniform vec3 wind; uniform float strength;
attribute vec3 seed; attribute float tip;
varying float vFade;
void main() {
  float fall = mod(seed.y * height + time * (9.0 + seed.z * 3.0), height);
  vec3 p;
  p.x = mod(seed.x * extent * 2.0 + center.x + wind.x * time * 0.6 + extent, extent * 2.0) - extent + center.x;
  p.z = mod(seed.z * extent * 2.0 + center.z + wind.z * time * 0.6 + extent, extent * 2.0) - extent + center.z;
  p.y = height - fall + center.y - 2.0;
  vec3 dir = normalize(vec3(wind.x * 0.05, -1.0, wind.z * 0.05));
  p += dir * tip * (0.35 + seed.z * 0.3);
  float near = distance(p, cameraPosition);
  vFade = (1.0 - tip * 0.85) * smoothstep(0.4, 2.5, near) * strength * step(seed.x + seed.z * 0.37, strength * 1.37);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const streakFrag = /* glsl */ `
varying float vFade;
void main() { gl_FragColor = vec4(vec3(0.75, 0.82, 0.95), vFade * 0.33); }`;

const splashVert = /* glsl */ `
uniform float time; uniform vec3 center; uniform float extent; uniform float strength;
attribute vec3 seed; attribute vec2 corner;
varying vec2 vUv; varying float vLife;
void main() {
  float cycle = 0.55 + seed.z * 0.4;
  float t = mod(time * 1.3 + seed.y * 11.0, cycle) / cycle;
  vec3 p;
  p.x = mod(seed.x * extent * 2.0 + center.x + extent, extent * 2.0) - extent + center.x;
  p.z = mod(seed.y * extent * 2.0 + center.z + extent, extent * 2.0) - extent + center.z;
  p.y = 0.015;
  float s = 0.05 + t * 0.22;
  p.xz += corner * s;
  vUv = corner;
  vLife = (1.0 - t) * strength * step(seed.z, strength);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const splashFrag = /* glsl */ `
varying vec2 vUv; varying float vLife;
void main() {
  float r = length(vUv);
  float ring = smoothstep(0.55, 0.85, r) * smoothstep(1.0, 0.9, r);
  gl_FragColor = vec4(vec3(0.8, 0.86, 1.0), ring * vLife * 0.5);
}`;

// Rain streaks wrap around the camera in the shader, so one static buffer
// covers the whole district. Splashes are rings on the ground plane at y=0.
export class Rain {
  readonly group = new THREE.Group();
  private streaks: THREE.LineSegments;
  private splashes: THREE.Mesh;
  private uniforms = { time: rainUniforms.time, center: { value: new THREE.Vector3() }, extent: { value: 22 }, height: { value: 24 }, wind: { value: new THREE.Vector3(1.2, 0, 0.4) }, strength: rainUniforms.rainStrength };
  groundY = 0;

  constructor(count = 9000, splashCount = 1800) {
    const pos = new Float32Array(count * 2 * 3);
    const seed = new Float32Array(count * 2 * 3);
    const tip = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const s = [Math.random(), Math.random(), Math.random()];
      for (let k = 0; k < 2; k++) {
        seed.set(s, (i * 2 + k) * 3);
        tip[i * 2 + k] = k;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 3));
    g.setAttribute('tip', new THREE.BufferAttribute(tip, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    const m = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: streakVert, fragmentShader: streakFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.streaks = new THREE.LineSegments(g, m);
    this.streaks.frustumCulled = false;
    this.group.add(this.streaks);

    const sg = new THREE.BufferGeometry();
    const sp = new Float32Array(splashCount * 4 * 3);
    const ss = new Float32Array(splashCount * 4 * 3);
    const sc = new Float32Array(splashCount * 4 * 2);
    const idx: number[] = [];
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let i = 0; i < splashCount; i++) {
      const s = [Math.random(), Math.random(), Math.random()];
      for (let k = 0; k < 4; k++) {
        ss.set(s, (i * 4 + k) * 3);
        sc.set(corners[k]!, (i * 4 + k) * 2);
      }
      idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
    }
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    sg.setAttribute('seed', new THREE.BufferAttribute(ss, 3));
    sg.setAttribute('corner', new THREE.BufferAttribute(sc, 2));
    sg.setIndex(idx);
    sg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    const sm = new THREE.ShaderMaterial({ uniforms: { ...this.uniforms, extent: { value: 9 } }, vertexShader: splashVert, fragmentShader: splashFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.splashes = new THREE.Mesh(sg, sm);
    this.splashes.frustumCulled = false;
    this.group.add(this.splashes);
  }

  update(camera: THREE.Camera, indoors: number): void {
    const p = camera.position;
    this.uniforms.center.value.set(p.x, p.y, p.z);
    const target = 1 - indoors;
    rainUniforms.rainStrength.value += (target - rainUniforms.rainStrength.value) * 0.08;
    this.splashes.position.y = this.groundY;
  }
}
