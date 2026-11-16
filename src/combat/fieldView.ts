import * as THREE from 'three';
import { INK } from '../render/materials';
import type { Pick } from '../net/clash';
import { RULES } from '../net/protocol';

// How an aura field is drawn. A tap's body layer is an inked rim that
// follows the owner's silhouette (`BodyLayer`, below): a band of the field's
// colour a few pixels wide round the body with a thin ink line outside it,
// the way a manga panel draws aura. As the layer is pushed off the body it
// thickens and fades, and the field grows out of it: a painted boundary on
// the ground and a dome over it, both in flat bands like the rest of the
// frame. The ground ring is
// what reads from the top-down camera: a solid band in the field's colour,
// an ink line just inside it, a dashed edge outside it, and pressure rings
// that drift in toward the owner, faster the denser the field. The band is
// as thick as the field is dense, so a field just off the body is a heavy
// ring and a wide one a thin line. While a field is pushed out (`push`) its rings run
// outward instead, its band pulses, and a dashed line on the ground shows
// how far it can go (`limit`). The dome's
// rim is a hard band, so from above it adds a second outline, and from
// inside its far wall is a tint, not a wash.
//
// A field can also show a clash tell (src/combat/clash.ts): a push bulges the
// boundary toward the opponent, a hold draws it in and thickens the band,
// and a feint thins and flickers the far side.

const domeVert = /* glsl */ `
uniform float bulge; uniform vec3 toward; uniform float squeeze;
varying vec3 vN; varying vec3 vV; varying vec3 vLocal; varying float vSide; varying float vDist;
void main(){
  vec3 p = position;
  vec3 flat_ = normalize(vec3(p.x, 0.0, p.z) + vec3(1e-5, 0.0, 0.0));
  float side = dot(flat_, toward);
  p.xz *= (1.0 + bulge * pow(max(0.0, side), 3.0) * 0.3) * (1.0 - squeeze * 0.1);
  vLocal = p; vSide = side;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vDist = length(mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const domeFrag = /* glsl */ `
uniform vec3 color; uniform float time; uniform float strength; uniform float density;
uniform float crack; uniform float squeeze; uniform float flicker; uniform float push;
varying vec3 vN; varying vec3 vV; varying vec3 vLocal; varying float vSide; varying float vDist;
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
  // Pushed out, its foot is a low wall that reads from behind the shoulder.
  a += push * (0.45 * step(vLocal.y, 0.09) + 0.1 * (1.0 - smoothstep(0.09, 0.3, vLocal.y)));
  a *= 1.0 - flicker * step(vSide, -0.25) * (0.6 + 0.4 * sin(time * 42.0));
  // A wall the camera is about to pass through would fill the frame: it
  // fades out in the last few metres before the lens.
  a *= smoothstep(1.0, 4.0, vDist);
  vec3 c = mix(color, vec3(1.0), rim * 0.3 + crack);
  gl_FragColor = vec4(c, clamp(a + crack * 0.3, 0.0, 1.0) * strength);
}`;

const ringVert = /* glsl */ `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const ringFrag = /* glsl */ `
uniform vec3 color; uniform vec3 ink; uniform float time; uniform float strength; uniform float density;
uniform float radius; uniform float outer; uniform float crack; uniform float bulge; uniform vec2 toward;
uniform float squeeze; uniform float flicker; uniform float fill; uniform float push; uniform float limit;
varying vec2 vP;
void main(){
  float d = length(vP) * outer;
  vec2 dir = normalize(vP + vec2(1e-5, 0.0));
  float side = dot(dir, toward);
  float r = radius * (1.0 + bulge * pow(max(0.0, side), 3.0) * 0.3) * (1.0 - squeeze * 0.1);
  if (d > max(r + 0.3, limit + 0.1)) discard;
  float w = 0.14 + 0.18 * density + squeeze * 0.14;
  float edge = step(r - w, d) * step(d, r);
  float inkLine = step(r - w - 0.12, d) * step(d, r - w);
  float ang = atan(vP.y, vP.x);
  float dash = step(r + 0.08, d) * step(d, r + 0.24) * step(0.5, fract(ang / 6.2831853 * 56.0 - time * 0.04));
  float rings = step(0.9, fract((r - d) * 0.65 - time * mix(0.3 + 0.5 * density, -2.2, push)));
  float inside = step(d, r - w - 0.12);
  float pulse = push * (0.5 + 0.5 * sin(time * 18.0));
  float lim = limit > 0.0 ? step(abs(d - limit), 0.09) * step(0.45, fract(ang / 6.2831853 * 96.0 + time * 0.2)) * step(r + 0.3, d) : 0.0;
  float a = inside * (0.05 + 0.06 * density + rings * (0.08 + 0.12 * density + 0.2 * push)) * fill + edge * 0.92 + dash * 0.6 + lim * 0.7 * push;
  vec3 c = mix(color, vec3(1.0), edge * (0.18 + 0.5 * pulse) + crack + lim * 0.4);
  c = mix(c, ink, inkLine);
  a = max(a, inkLine * 0.75);
  a *= 1.0 - flicker * step(side, -0.25) * (0.55 + 0.45 * sin(time * 38.0));
  gl_FragColor = vec4(c, clamp(a + crack * 0.4 * step(d, r), 0.0, 1.0) * strength);
}`;


// The body layer: the owner's own meshes drawn again from behind, each
// vertex pushed out along its normal on screen and sunk a little behind the
// body, so only a rim of even width shows round the outer silhouette, from
// any camera and at any distance. Two
// passes: an ink rim `ink` pixels wider, then the colour over it, which
// leaves a hard ink line on the outside of the band. Widths are in 1080p
// pixels; the band wavers along the body like a brushed line.
const layerVert = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
uniform float width; uniform vec2 res; uniform float time;
void main(){
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  // Sunk a hand's depth behind the body along the line of sight, so where
  // one limb crosses another the body in front hides the rim: only the
  // outer silhouette keeps it.
  mvPosition.xyz += normalize(mvPosition.xyz) * 0.35;
  gl_Position = projectionMatrix * mvPosition;
  vec3 wp = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vec4 cn = projectionMatrix * vec4(normalize(normalMatrix * objectNormal), 0.0);
  vec2 d = cn.xy * res;
  d = length(d) > 1e-5 ? normalize(d) : vec2(0.0);
  // Tongues that rise up the body: wider where a slow wave running upward
  // crests, so the rim licks upward like a brushed flame, never a glow.
  float rise = sin(wp.y * 7.0 - time * 4.2 + sin(wp.x * 3.1 + wp.z * 2.3) * 2.5);
  float waver = 0.78 + 0.34 * max(0.0, rise) * (0.6 + 0.4 * sin(wp.x * 5.0 - wp.z * 4.0 + time * 1.7));
  gl_Position.xy += d * width * waver * (res.y / 1080.0) * 2.0 / res * gl_Position.w;
}`;
const layerFrag = /* glsl */ `
uniform vec3 color; uniform float strength; uniform float flash;
void main(){ gl_FragColor = vec4(mix(color, vec3(1.0), flash), strength); }`;

const WHITE = new THREE.Color(1, 1, 1);

export class BodyLayer {
  private hulls: THREE.Mesh[] = [];
  private ink: THREE.ShaderMaterial;
  private paint: THREE.ShaderMaterial;
  private res = new THREE.Vector2(1920, 1080);
  private built = false;

  constructor(private body: THREE.Object3D, color: number) {
    const make = (c: number, order: number) => new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(c) }, strength: { value: 1 }, flash: { value: 0 }, width: { value: 4 }, res: { value: this.res }, time: { value: 0 } },
      vertexShader: layerVert, fragmentShader: layerFrag, side: THREE.BackSide, transparent: true, depthWrite: false,
      userData: { order },
    });
    this.ink = make(INK, 4);
    this.paint = make(color, 5);
    this.color = color;
  }

  // The band is the field's colour lifted a little toward white, so it
  // stands off the ground behind it; the ink line outside it is the contrast.
  set color(c: number) { this.paint.uniforms.color!.value.set(c).lerp(WHITE, 0.15); }

  // The owner's meshes, wrapped once they are first drawn. The eyes and
  // brows sit inside the head and add nothing to the outline.
  private build(): void {
    this.built = true;
    const meshes: THREE.Mesh[] = [];
    this.body.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !m.userData.auraField && o.name !== 'Eyes' && o.name !== 'Eyebrows') meshes.push(m);
    });
    for (const m of meshes) for (const mat of [this.ink, this.paint]) {
      const skinned = m as THREE.SkinnedMesh;
      let hull: THREE.Mesh;
      if (skinned.isSkinnedMesh) {
        const h = new THREE.SkinnedMesh(m.geometry, mat);
        h.bindMode = skinned.bindMode;
        h.bind(skinned.skeleton, skinned.bindMatrix);
        hull = h;
      } else hull = new THREE.Mesh(m.geometry, mat);
      hull.frustumCulled = false;
      hull.castShadow = hull.receiveShadow = false;
      hull.renderOrder = mat.userData.order as number;
      hull.userData.auraField = true;
      if (mat === this.paint) hull.onBeforeRender = (r) => { r.getDrawingBufferSize(this.res); };
      m.add(hull);
      this.hulls.push(hull);
    }
  }

  // `strength` 0..1 fades it; `width` is the colour band in 1080p pixels;
  // `flash` 0..1 whitens the colour (the release, a crack).
  draw(time: number, strength: number, width: number, flash: number): void {
    const show = strength > 0.01;
    if (show && !this.built) this.build();
    for (const h of this.hulls) h.visible = show;
    if (!show) return;
    this.ink.uniforms.strength!.value = Math.min(1, strength * 1.15);
    this.paint.uniforms.strength!.value = strength;
    this.ink.uniforms.width!.value = width + 2.2;
    this.paint.uniforms.width!.value = width;
    this.ink.uniforms.time!.value = this.paint.uniforms.time!.value = time;
    this.paint.uniforms.flash!.value = flash;
  }

  dispose(): void {
    for (const h of this.hulls) h.removeFromParent();
    this.hulls = [];
    this.ink.dispose();
    this.paint.dispose();
  }
}

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
  // The owner's body layer, for a field that belongs to a body (the player's
  // and other players'); the Master never wears one.
  private layer: BodyLayer | null;

  // `body` is the owner's model, to draw a body layer round.
  constructor(scene: THREE.Object3D, color: number, body?: THREE.Object3D) {
    this.layer = body ? new BodyLayer(body, color) : null;
    const shared = () => ({ color: { value: new THREE.Color(color) }, time: { value: 0 }, strength: { value: 1 }, density: { value: 0.5 }, crack: { value: 0 }, bulge: { value: 0 }, squeeze: { value: 0 }, flicker: { value: 0 }, push: { value: 0 } });
    this.domeMat = new THREE.ShaderMaterial({ uniforms: { ...shared(), toward: { value: new THREE.Vector3(0, 0, -1) } }, vertexShader: domeVert, fragmentShader: domeFrag, transparent: true, depthWrite: false, side: THREE.FrontSide });
    this.ringMat = new THREE.ShaderMaterial({
      uniforms: { ...shared(), ink: { value: new THREE.Color(INK) }, fill: { value: 1 }, radius: { value: 1 }, outer: { value: 1 }, toward: { value: new THREE.Vector2(0, -1) }, push: { value: 0 }, limit: { value: 0 } },
      vertexShader: ringVert, fragmentShader: ringFrag, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 20, 0, Math.PI * 2, 0, Math.PI / 2), this.domeMat);
    this.ring = new THREE.Mesh(new THREE.CircleGeometry(1, 128), this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.dome.renderOrder = 6;
    this.ring.renderOrder = 5;
    this.dome.visible = this.ring.visible = false;
    this.dome.frustumCulled = this.ring.frustumCulled = false;
    this.dome.userData.auraField = this.ring.userData.auraField = true;
    scene.add(this.dome, this.ring);
  }

  // The far wall tints the frame only for someone standing inside the field.
  get side(): THREE.Side { return this.domeMat.side; }

  set color(c: number) { this.domeMat.uniforms.color!.value.set(c); this.ringMat.uniforms.color!.value.set(c); if (this.layer) this.layer.color = c; }

  // A clash tell, held until cleared. `toward` is where the opponent stands.
  tell(kind: Pick | null, toward?: THREE.Vector3): void {
    this.tellKind = kind;
    if (toward) this.toward.copy(toward).setY(0).normalize();
  }

  // The field breaks: a white flash through the band as it is crushed in.
  crack(): void { this.crackT = 1; }

  hide(): void { this.dome.visible = this.ring.visible = false; this.layer?.draw(0, 0, 0, 0); this.tellKind = null; }

  // `feet` is the owner's ground point. `ceiling` is how far the dome may
  // rise (indoors it stops at the room's ceiling). `inside` is whether the
  // viewer's player stands in it. `dome` scales the dome against the ground
  // ring, whose edge always draws at full strength: the ring is the
  // boundary. `fill` scales the paint and pressure rings inside the edge.
  // `push` (0..1) is how far into being pushed out it is, and `limit` the
  // radius it can be pushed to. A field the size of the body layer is drawn
  // as the layer; pushed out past it, the layer thickens and fades as the
  // ring and the dome come up out of it, so the growth reads as one shape.
  draw(dt: number, time: number, feet: THREE.Vector3, radius: number, density: number, opts: { ceiling?: number; inside: boolean; dome?: number; fill?: number; lean?: number; push?: number; limit?: number }): void {
    this.crackT = Math.max(0, this.crackT - dt * 3);
    for (const k of ['push', 'hold', 'feint'] as const) this.tellAmt[k] += ((this.tellKind === k ? 1 : 0) - this.tellAmt[k]) * (1 - Math.exp(-12 * dt));
    const layer = RULES.field.layer;
    const worn = this.layer ? THREE.MathUtils.smoothstep(radius, 0.1, layer * 0.9) * (1 - THREE.MathUtils.smoothstep(radius, layer * 1.05, layer + 1.6)) : 0;
    const peel = THREE.MathUtils.clamp((radius - layer) / 1.6, 0, 1);
    this.layer?.draw(time, worn, (5 + 4 * density) * (1 + 1.5 * peel) * (1 + 0.5 * this.tellAmt.hold), Math.max(this.crackT * this.crackT, 0.35 * (opts.push ?? 0)));
    // The ground ring and the dome grow out of the layer: a body owner's
    // field shows them only once it has left the body.
    const grown = this.layer ? THREE.MathUtils.smoothstep(radius, layer, layer + 1) : 1;
    const show = radius > 0.05 && grown > 0.01;
    this.dome.visible = this.ring.visible = show;
    if (!show) return;
    // A field leans toward an opponent it is pressing on, more on a push.
    const bulge = Math.min(1.2, (opts.lean ?? 0) + this.tellAmt.push);
    for (const m of [this.domeMat, this.ringMat]) {
      const u = m.uniforms;
      u.time!.value = time;
      u.density!.value = density;
      u.strength!.value = (m === this.domeMat ? (opts.dome ?? 1) * THREE.MathUtils.smoothstep(radius, 1.2, 3) : 1) * grown;
      u.crack!.value = this.crackT * this.crackT;
      u.bulge!.value = bulge;
      u.squeeze!.value = this.tellAmt.hold;
      u.flicker!.value = this.tellAmt.feint;
      u.push!.value = opts.push ?? 0;
    }
    this.domeMat.uniforms.toward!.value.copy(this.toward);
    this.ringMat.uniforms.toward!.value.set(this.toward.x, -this.toward.z);
    this.ringMat.uniforms.fill!.value = opts.fill ?? 1;
    this.ringMat.uniforms.radius!.value = radius;
    const limit = opts.limit ?? 0;
    const outer = Math.max(radius * 1.32 + OUTER, limit + 0.4);
    this.ringMat.uniforms.limit!.value = limit;
    this.ringMat.uniforms.outer!.value = outer;
    this.ring.position.set(feet.x, feet.y + 0.035, feet.z);
    this.ring.scale.setScalar(outer);
    // A small field rises round the whole body as it leaves it, then settles
    // into a dome as wide as it is tall.
    const tall = Math.max(0.4, Math.min(Math.max(radius, 2.2), opts.ceiling ?? Infinity));
    this.dome.position.copy(feet);
    this.dome.scale.set(radius, tall, radius);
    const side = opts.inside ? THREE.DoubleSide : THREE.FrontSide;
    if (this.domeMat.side !== side) { this.domeMat.side = side; this.domeMat.needsUpdate = true; }
  }

  dispose(): void {
    this.layer?.dispose();
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
