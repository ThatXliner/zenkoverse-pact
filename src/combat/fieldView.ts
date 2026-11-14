import * as THREE from 'three';
import { INK } from '../render/materials';
import type { Pick } from '../net/clash';

// How an aura field is drawn: a painted boundary on the ground and a dome
// over it, both in flat bands like the rest of the frame. The ground ring is
// what reads from the top-down camera: a solid band in the field's colour,
// an ink line just inside it, a dashed edge outside it, and pressure rings
// that drift in toward the owner, faster the denser the field. The dome's
// rim is a hard band, so from above it adds a second outline, and from
// inside its far wall is a tint, not a wash.
//
// A field can also show a clash tell (src/combat/clash.ts): a push bulges the
// boundary toward the opponent, a hold draws it in and thickens the band,
// and a feint thins and flickers the far side.

const domeVert = /* glsl */ `
uniform float bulge; uniform vec3 toward; uniform float squeeze;
varying vec3 vN; varying vec3 vV; varying vec3 vLocal; varying float vSide;
void main(){
  vec3 p = position;
  vec3 flat_ = normalize(vec3(p.x, 0.0, p.z) + vec3(1e-5, 0.0, 0.0));
  float side = dot(flat_, toward);
  p.xz *= (1.0 + bulge * pow(max(0.0, side), 3.0) * 0.3) * (1.0 - squeeze * 0.1);
  vLocal = p; vSide = side;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const domeFrag = /* glsl */ `
uniform vec3 color; uniform float time; uniform float strength; uniform float density;
uniform float crack; uniform float squeeze; uniform float flicker;
varying vec3 vN; varying vec3 vV; varying vec3 vLocal; varying float vSide;
void main(){
  float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  float rim = step(0.8 - squeeze * 0.14, f);
  float mid = step(0.52, f);
  float band = step(0.86, fract(vLocal.y * 6.0 + time * (0.3 + density * 0.5)));
  float foot = step(vLocal.y, 0.035);
  float a;
  if (gl_FrontFacing) {
    // From outside: a hard rim band, a softer one inside it, and contour lines.
    a = 0.025 + 0.03 * density + mid * 0.07 + rim * (0.34 + 0.24 * density) + band * (0.04 + 0.07 * density) * (1.0 - rim) + foot * 0.35;
  } else {
    // From inside, the far wall: a low painted curtain, contour lines over a
    // bright foot where it meets the ground, fading out above head height.
    float low = 1.0 - smoothstep(0.05, 0.45, vLocal.y);
    float stripes = step(0.7, fract(vLocal.y * 16.0 + time * (0.4 + density * 0.6)));
    a = low * (0.06 + stripes * (0.22 + 0.18 * density)) + step(vLocal.y, 0.05) * 0.55;
  }
  a *= 1.0 - flicker * step(vSide, -0.25) * (0.6 + 0.4 * sin(time * 42.0));
  vec3 c = mix(color, vec3(1.0), rim * 0.3 + crack);
  gl_FragColor = vec4(c, clamp(a + crack * 0.3, 0.0, 1.0) * strength);
}`;

const ringVert = /* glsl */ `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const ringFrag = /* glsl */ `
uniform vec3 color; uniform vec3 ink; uniform float time; uniform float strength; uniform float density;
uniform float radius; uniform float outer; uniform float crack; uniform float bulge; uniform vec2 toward;
uniform float squeeze; uniform float flicker;
varying vec2 vP;
void main(){
  float d = length(vP) * outer;
  vec2 dir = normalize(vP + vec2(1e-5, 0.0));
  float side = dot(dir, toward);
  float r = radius * (1.0 + bulge * pow(max(0.0, side), 3.0) * 0.3) * (1.0 - squeeze * 0.1);
  if (d > r + 0.3) discard;
  float w = 0.22 + squeeze * 0.14;
  float edge = step(r - w, d) * step(d, r);
  float inkLine = step(r - w - 0.12, d) * step(d, r - w);
  float ang = atan(vP.y, vP.x);
  float dash = step(r + 0.08, d) * step(d, r + 0.24) * step(0.5, fract(ang / 6.2831853 * 56.0 - time * 0.04));
  float rings = step(0.9, fract((r - d) * 0.65 + time * (0.3 + 0.5 * density)));
  float inside = step(d, r - w - 0.12);
  float a = inside * (0.05 + 0.06 * density + rings * (0.08 + 0.12 * density)) + edge * 0.92 + dash * 0.6;
  vec3 c = mix(color, vec3(1.0), edge * 0.18 + crack);
  c = mix(c, ink, inkLine);
  a = max(a, inkLine * 0.75);
  a *= 1.0 - flicker * step(side, -0.25) * (0.55 + 0.45 * sin(time * 38.0));
  gl_FragColor = vec4(c, clamp(a + crack * 0.4 * step(d, r), 0.0, 1.0) * strength);
}`;

const OUTER = 0.35;

export class FieldView {
  private dome: THREE.Mesh;
  private ring: THREE.Mesh;
  private domeMat: THREE.ShaderMaterial;
  private ringMat: THREE.ShaderMaterial;
  private tellKind: Pick | null = null;
  private tellAmt = { push: 0, hold: 0, feint: 0 };
  private crackT = 0;
  private toward = new THREE.Vector3(0, 0, -1);

  constructor(scene: THREE.Object3D, color: number) {
    const shared = () => ({ color: { value: new THREE.Color(color) }, time: { value: 0 }, strength: { value: 1 }, density: { value: 0.5 }, crack: { value: 0 }, bulge: { value: 0 }, squeeze: { value: 0 }, flicker: { value: 0 } });
    this.domeMat = new THREE.ShaderMaterial({ uniforms: { ...shared(), toward: { value: new THREE.Vector3(0, 0, -1) } }, vertexShader: domeVert, fragmentShader: domeFrag, transparent: true, depthWrite: false, side: THREE.FrontSide });
    this.ringMat = new THREE.ShaderMaterial({
      uniforms: { ...shared(), ink: { value: new THREE.Color(INK) }, radius: { value: 1 }, outer: { value: 1 }, toward: { value: new THREE.Vector2(0, -1) } },
      vertexShader: ringVert, fragmentShader: ringFrag, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 20, 0, Math.PI * 2, 0, Math.PI / 2), this.domeMat);
    this.ring = new THREE.Mesh(new THREE.CircleGeometry(1, 128), this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.dome.renderOrder = 6;
    this.ring.renderOrder = 5;
    this.dome.visible = this.ring.visible = false;
    this.dome.frustumCulled = this.ring.frustumCulled = false;
    scene.add(this.dome, this.ring);
  }

  // The far wall tints the frame only for someone standing inside the field.
  get side(): THREE.Side { return this.domeMat.side; }

  set color(c: number) { this.domeMat.uniforms.color!.value.set(c); this.ringMat.uniforms.color!.value.set(c); }

  // A clash tell, held until cleared. `toward` is where the opponent stands.
  tell(kind: Pick | null, toward?: THREE.Vector3): void {
    this.tellKind = kind;
    if (toward) this.toward.copy(toward).setY(0).normalize();
  }

  // The field breaks: a white flash through the band as it is crushed in.
  crack(): void { this.crackT = 1; }

  hide(): void { this.dome.visible = this.ring.visible = false; this.tellKind = null; }

  // `feet` is the owner's ground point. `ceiling` is how far the dome may
  // rise (indoors it stops at the room's ceiling). `inside` is whether the
  // viewer's player stands in it. `dome` scales the dome against the ground
  // ring, which always draws at full strength: the ring is the boundary.
  draw(dt: number, time: number, feet: THREE.Vector3, radius: number, density: number, opts: { ceiling?: number; inside: boolean; dome?: number; lean?: number }): void {
    this.crackT = Math.max(0, this.crackT - dt * 3);
    for (const k of ['push', 'hold', 'feint'] as const) this.tellAmt[k] += ((this.tellKind === k ? 1 : 0) - this.tellAmt[k]) * (1 - Math.exp(-12 * dt));
    const show = radius > 0.05;
    this.dome.visible = this.ring.visible = show;
    if (!show) return;
    // A field leans toward an opponent it is pressing on, more on a push.
    const bulge = Math.min(1.2, (opts.lean ?? 0) + this.tellAmt.push);
    for (const m of [this.domeMat, this.ringMat]) {
      const u = m.uniforms;
      u.time!.value = time;
      u.density!.value = density;
      u.strength!.value = m === this.domeMat ? opts.dome ?? 1 : 1;
      u.crack!.value = this.crackT * this.crackT;
      u.bulge!.value = bulge;
      u.squeeze!.value = this.tellAmt.hold;
      u.flicker!.value = this.tellAmt.feint;
    }
    this.domeMat.uniforms.toward!.value.copy(this.toward);
    this.ringMat.uniforms.toward!.value.set(this.toward.x, -this.toward.z);
    this.ringMat.uniforms.radius!.value = radius;
    this.ringMat.uniforms.outer!.value = radius * 1.32 + OUTER;
    this.ring.position.set(feet.x, feet.y + 0.035, feet.z);
    this.ring.scale.setScalar(radius * 1.32 + OUTER);
    const tall = Math.max(0.4, Math.min(radius, opts.ceiling ?? radius));
    this.dome.position.copy(feet);
    this.dome.scale.set(radius, tall, radius);
    const side = opts.inside ? THREE.DoubleSide : THREE.FrontSide;
    if (this.domeMat.side !== side) { this.domeMat.side = side; this.domeMat.needsUpdate = true; }
  }

  dispose(): void {
    this.dome.removeFromParent();
    this.ring.removeFromParent();
    this.dome.geometry.dispose();
    this.ring.geometry.dispose();
    this.domeMat.dispose();
    this.ringMat.dispose();
  }
}

// Where two fields meet in a clash: a starburst of the two colours that
// faces the camera, so it reads from the side shot and from above.
const seamFrag = /* glsl */ `
uniform vec3 a; uniform vec3 b; uniform float time; uniform float flare;
varying vec2 vUv;
void main(){
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float ang = atan(p.y, p.x);
  float rays = 0.55 + 0.45 * step(0.5, fract(ang * 2.2 + time * 1.7)) * step(0.4, fract(ang * 3.7 - time * 2.3));
  float body = step(r, (0.35 + 0.5 * flare) * rays);
  float core = step(r, 0.18 + 0.15 * flare);
  if (body < 0.5) discard;
  vec3 c = p.x < 0.0 ? a : b;
  c = mix(c, vec3(1.0), core * 0.85 + 0.15);
  gl_FragColor = vec4(c, 0.92);
}`;

export class ClashSeam {
  private mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private flare = 0;

  constructor(scene: THREE.Object3D) {
    this.mat = new THREE.ShaderMaterial({
      uniforms: { a: { value: new THREE.Color() }, b: { value: new THREE.Color() }, time: { value: 0 }, flare: { value: 0 } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: seamFrag, transparent: true, depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mat);
    this.mesh.renderOrder = 8;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  burst(): void { this.flare = 1; }

  // `left` and `right` are the colours on either side as the camera sees them.
  draw(dt: number, time: number, at: THREE.Vector3, camera: THREE.Camera, left: THREE.Color, right: THREE.Color, size: number): void {
    this.flare = Math.max(0, this.flare - dt * 2.5);
    this.mesh.visible = true;
    this.mesh.position.copy(at);
    this.mesh.quaternion.copy(camera.quaternion);
    this.mesh.scale.setScalar(size * (1 + this.flare * 0.6));
    this.mat.uniforms.a!.value.copy(left);
    this.mat.uniforms.b!.value.copy(right);
    this.mat.uniforms.time!.value = time;
    this.mat.uniforms.flare!.value = this.flare;
  }

  hide(): void { this.mesh.visible = false; }

  dispose(): void { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mat.dispose(); }
}
