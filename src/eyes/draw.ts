import * as THREE from 'three';

// What an Eye shows is drawn only on its bearer's screen. These marks live
// in the scene but never go through the shared effect pool (src/techniques/
// vfx.ts), which online is mirrored to every other screen. None writes
// depth, so the ink pass never outlines them: they read as a second layer
// over the drawing, the way a panel letters a character's sight.

const groundVert = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

// A mark on the floor in polar terms: a band from `inner` to `outer`
// metres, kept between `from` and `to` radians (a gap is the rest), an inked
// edge line, an optional dash, and a faint fill inside the band.
const groundFrag = /* glsl */ `
uniform vec3 color;
uniform float opacity;
uniform float inner;
uniform float outer;
uniform float from;
uniform float span;
uniform float fill;
uniform float line;
uniform float dash;
uniform float time;
varying vec2 vP;
void main() {
  float r = length( vP );
  float a = atan( vP.y, vP.x );
  float rel = mod( a - from, 6.2831853 );
  if ( span < 6.28 && rel > span ) discard;
  if ( r > outer + line || r < inner - line ) discard;
  float aa = fwidth( r ) * 1.2;
  float edgeO = 1.0 - smoothstep( line - aa, line + aa, abs( r - outer ) );
  float edgeI = inner > 0.05 ? 1.0 - smoothstep( line - aa, line + aa, abs( r - inner ) ) : 0.0;
  float band = step( inner, r ) * step( r, outer );
  float k = max( max( edgeO, edgeI ), band * fill );
  // The ends of an arc taper, as a brush lifts.
  if ( span < 6.28 ) {
    float endA = min( rel, span - rel ) * max( r, 0.3 );
    k *= smoothstep( 0.0, 0.35, endA );
  }
  if ( dash > 0.0 ) k *= step( 0.45, fract( a * r * dash / 6.2831853 - time ) );
  if ( k < 0.01 ) discard;
  gl_FragColor = vec4( color, opacity * k );
}
`;

const PLANE = new THREE.PlaneGeometry(2, 2);

export interface GroundShape { inner?: number; outer: number; from?: number; span?: number; fill?: number; line?: number; dash?: number }

// One floor mark. Angles are world yaw around +Y, measured the way the
// game measures a body's facing: 0 looks down -Z.
export class GroundMark {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;

  constructor(scene: THREE.Object3D, color: number) {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: groundVert, fragmentShader: groundFrag, transparent: true, depthWrite: false,
      uniforms: {
        color: { value: new THREE.Color(color) }, opacity: { value: 0 }, inner: { value: 0 }, outer: { value: 1 },
        from: { value: 0 }, span: { value: 7 }, fill: { value: 0 }, line: { value: 0.03 }, dash: { value: 0 }, time: { value: 0 },
      },
    });
    this.mesh = new THREE.Mesh(PLANE, this.mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.renderOrder = 6;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  // `facing` and `half` say which way the kept arc points and how wide it is
  // either side; with no `half` the band is a whole ring.
  set(at: THREE.Vector3, shape: GroundShape, opacity: number, facing = 0, half?: number): void {
    const u = this.mat.uniforms;
    const outer = shape.outer;
    const pad = (shape.line ?? 0.03) * 2;
    this.mesh.position.set(at.x, at.y + 0.04, at.z);
    this.mesh.scale.setScalar(outer + pad);
    u.outer!.value = outer / (outer + pad);
    u.inner!.value = (shape.inner ?? 0) / (outer + pad);
    u.line!.value = (shape.line ?? 0.03) / (outer + pad);
    u.fill!.value = shape.fill ?? 0;
    u.dash!.value = shape.dash ?? 0;
    u.opacity!.value = opacity;
    // The plane lies flat with its +X east and +Y north (-Z); a body facing
    // `yaw` looks along (-sin yaw, -cos yaw), which is polar angle yaw + pi/2.
    if (half === undefined) { u.from!.value = 0; u.span!.value = 7; }
    else { u.from!.value = facing + Math.PI / 2 - half; u.span!.value = half * 2; }
    this.mesh.visible = opacity > 0.01;
  }

  color(c: number): void { (this.mat.uniforms.color!.value as THREE.Color).set(c); }
  tick(t: number): void { this.mat.uniforms.time!.value = t; }
  hide(): void { this.mesh.visible = false; }
  dispose(): void { this.mesh.removeFromParent(); this.mat.dispose(); }
}

// A thread: a ribbon through a slack curve between two points, turned to
// face the camera so it keeps its width from above and from eye height.
const SEG = 14;
export class Strand {
  readonly mesh: THREE.Mesh;
  private geo = new THREE.BufferGeometry();
  private pos = new Float32Array((SEG + 1) * 2 * 3);
  private along = new Float32Array((SEG + 1) * 2 * 2);
  private mat: THREE.ShaderMaterial;
  private pts = Array.from({ length: SEG + 1 }, () => new THREE.Vector3());

  constructor(scene: THREE.Object3D, color: number) {
    const idx: number[] = [];
    for (let i = 0; i < SEG; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    this.geo.setIndex(idx);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('st', new THREE.BufferAttribute(this.along, 2));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { color: { value: new THREE.Color(color) }, opacity: { value: 0 }, pulse: { value: -1 }, pulseColor: { value: new THREE.Color(0xffffff) } },
      vertexShader: /* glsl */ `attribute vec2 st; varying float vA; varying float vT; void main() { vA = st.x; vT = st.y; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
      fragmentShader: /* glsl */ `uniform vec3 color; uniform float opacity; uniform float pulse; uniform vec3 pulseColor; varying float vA; varying float vT;
        void main() {
          float p = pulse >= 0.0 ? exp( -pow( ( vT - pulse ) * 9.0, 2.0 ) ) : 0.0;
          float edge = 1.0 - abs( vA * 2.0 - 1.0 );
          gl_FragColor = vec4( mix( color, pulseColor, p * 0.8 ), opacity * ( 0.55 + 0.45 * edge + p ) );
        }`,
    });
    for (let i = 0; i <= SEG; i++) this.along.set([0, i / SEG, 1, i / SEG], i * 4);
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  // `pulse` 0..1 is a bright bead travelling from `a` to `b`, or -1 for none.
  set(a: THREE.Vector3, b: THREE.Vector3, camera: THREE.Camera, width: number, opacity: number, sag = 0.25, pulse = -1): void {
    const cam = camera.position;
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG;
      this.pts[i]!.lerpVectors(a, b, t).y -= Math.sin(t * Math.PI) * sag;
    }
    const side = new THREE.Vector3(), tan = new THREE.Vector3(), view = new THREE.Vector3();
    for (let i = 0; i <= SEG; i++) {
      const p = this.pts[i]!;
      tan.subVectors(this.pts[Math.min(SEG, i + 1)]!, this.pts[Math.max(0, i - 1)]!);
      view.subVectors(cam, p);
      side.crossVectors(tan, view).normalize().multiplyScalar(width / 2);
      this.pos.set([p.x - side.x, p.y - side.y, p.z - side.z, p.x + side.x, p.y + side.y, p.z + side.z], i * 6);
    }
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.mat.uniforms.opacity!.value = opacity;
    this.mat.uniforms.pulse!.value = pulse;
    this.mesh.visible = opacity > 0.01;
  }

  hide(): void { this.mesh.visible = false; }
  dispose(): void { this.mesh.removeFromParent(); this.geo.dispose(); this.mat.dispose(); }
}

// A ghost of a body: its own skinned meshes drawn again, flat and
// translucent, through the same skeleton, so it holds the live pose, and
// moved by `place` to where the body could be. Costs one draw per mesh and
// no skinning work of its own.
export class Ghost {
  readonly group = new THREE.Group();
  private mat: THREE.MeshBasicMaterial;
  private meshes: THREE.SkinnedMesh[] = [];
  private shift = new THREE.Matrix4();

  constructor(scene: THREE.Object3D, source: THREE.Object3D, color: number) {
    this.mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false });
    source.updateMatrixWorld(true);
    source.traverse((o) => {
      const sm = o as THREE.SkinnedMesh;
      if (!sm.isSkinnedMesh) return;
      const g = new THREE.SkinnedMesh(sm.geometry, this.mat);
      g.bind(sm.skeleton, sm.bindMatrix);
      // With no bind inverse the vertex lands where the skeleton puts it,
      // and the mesh's own matrix (the shift) moves it from there. Three
      // rewrites the inverse on every matrix update, so it is cleared after.
      g.bindMode = THREE.DetachedBindMode;
      const update = g.updateMatrixWorld.bind(g);
      g.updateMatrixWorld = (force?: boolean) => { update(force); g.bindMatrixInverse.identity(); };
      g.matrixAutoUpdate = false;
      g.frustumCulled = false;
      g.renderOrder = 5;
      this.meshes.push(g);
      this.group.add(g);
    });
    this.group.matrixAutoUpdate = false;
    this.group.visible = false;
    scene.add(this.group);
  }

  // Shows the live pose turned by `turn` about the body's feet at `from`
  // and carried to `to`.
  place(from: THREE.Vector3, to: THREE.Vector3, turn: number, opacity: number): void {
    this.shift.makeTranslation(to.x, to.y, to.z).multiply(new THREE.Matrix4().makeRotationY(turn)).multiply(new THREE.Matrix4().makeTranslation(-from.x, -from.y, -from.z));
    for (const m of this.meshes) { m.matrix.copy(this.shift); m.matrixWorldNeedsUpdate = true; }
    this.mat.opacity = opacity;
    this.group.visible = opacity > 0.01;
  }

  hide(): void { this.group.visible = false; }
  dispose(): void { this.group.removeFromParent(); this.mat.dispose(); }
}

export const wrapAngle = (a: number): number => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
// The world yaw of a direction on the floor, as a body's facing is measured.
export const yawOf = (dx: number, dz: number): number => Math.atan2(-dx, -dz);
