import * as THREE from 'three';

// A telegraph drawn on the ground (issue #11): the exact area a blow will
// cover, ruled in one colour. A front line sweeps out from the attacker
// across the wind-up and reaches the edge on the beat the blow lands, so the
// shape says where and the sweep says when. Read from the top-down camera,
// where a raised arm is a few pixels and the ground is most of the frame.
//
// `sector` is a wedge (or a full disc at half-angle π) from the attacker's
// feet; `rect` is a lane straight ahead of them, for a lunge.
export type MarkShape =
  | { kind: 'sector'; radius: number; arc: number; inner?: number }
  | { kind: 'rect'; length: number; width: number };

const vert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }
`;

// Everything in metres, so the rim reads the same width on a lunge's lane and on a hall-wide wave.
const frag = /* glsl */ `
uniform vec3 color;
uniform float progress;
uniform float opacity;
uniform float fill;
uniform float rect;
uniform vec2 size;
uniform float arc;
uniform float inner;
varying vec2 vUv;
void main() {
  float along, edge;
  if ( rect > 0.5 ) {
    along = vUv.y;
    edge = min( min( vUv.x, 1.0 - vUv.x ) * size.x, ( 1.0 - vUv.y ) * size.y );
  } else {
    vec2 p = ( vUv - 0.5 ) * 2.0;
    float r = length( p );
    float a = abs( atan( p.x, p.y ) );
    if ( r > 1.0 || r < inner || a > arc ) discard;
    along = ( r - inner ) / max( 1e-3, 1.0 - inner );
    float side = arc > 3.1 ? 1e3 : sin( min( arc - a, 1.5 ) ) * r * size.x;
    edge = min( ( 1.0 - r ) * size.x, side );
  }
  float rim = 1.0 - smoothstep( 0.05, 0.09, edge );
  float swept = step( along, progress );
  float front = ( 1.0 - smoothstep( 0.0, 0.06, abs( along * size.y - progress * size.y ) ) ) * step( 0.02, progress );
  float a = max( max( rim * 0.85, front * 0.8 ), mix( 0.05, 0.2, swept ) );
  a = max( a, fill * 0.55 );
  gl_FragColor = vec4( color, a * opacity );
}
`;

export class Mark {
  readonly root = new THREE.Group();
  readonly mat: THREE.ShaderMaterial;
  private plane: THREE.Mesh;
  // 'live' while its owner drives it; 'fired' and 'gone' fade it out on their own.
  state: 'live' | 'fired' | 'gone' = 'live';
  fade = 0;

  constructor(geo: THREE.PlaneGeometry, shape: MarkShape, color: number, readonly peak = 1) {
    const sector = shape.kind === 'sector';
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      uniforms: {
        color: { value: new THREE.Color(color) }, progress: { value: 0 }, opacity: { value: peak }, fill: { value: 0 },
        rect: { value: sector ? 0 : 1 },
        size: { value: sector ? new THREE.Vector2(shape.radius, shape.radius * (1 - (shape.inner ?? 0))) : new THREE.Vector2(shape.width, shape.length) },
        arc: { value: sector ? shape.arc : 0 }, inner: { value: sector ? shape.inner ?? 0 : 0 },
      },
    });
    this.plane = new THREE.Mesh(geo, this.mat);
    this.plane.rotation.x = -Math.PI / 2;
    this.plane.renderOrder = 2;
    if (sector) this.plane.scale.set(shape.radius * 2, shape.radius * 2, 1);
    else { this.plane.scale.set(shape.width, shape.length, 1); this.plane.position.z = -shape.length / 2; }
    this.root.add(this.plane);
  }

  // Where it lies and which way its blow goes (the attacker's yaw: forward is -Z turned by it).
  place(at: THREE.Vector3, yaw: number): void {
    this.root.position.set(at.x, at.y + 0.08, at.z);
    this.root.rotation.y = yaw;
  }

  set progress(v: number) { this.mat.uniforms.progress!.value = THREE.MathUtils.clamp(v, 0, 1); }

  // The blow lands: the whole area flashes once and fades.
  fire(): void { if (this.state !== 'live') return; this.state = 'fired'; this.fade = 0.22; this.mat.uniforms.progress!.value = 1; }
  // The blow will not come (the attacker was hit out of it): it fades fast.
  cancel(): void { if (this.state !== 'live') return; this.state = 'gone'; this.fade = 0.1; }
}

// The glint (kira) a manga panel puts on a blade or an eye the moment before
// it moves: four ink-edged points. Here it marks the instant a wind-up
// commits and the attacker stops turning to follow, so a step aside now works.
let kiraTex: THREE.CanvasTexture | null = null;
export function kiraTexture(): THREE.CanvasTexture {
  if (kiraTex) return kiraTex;
  const s = 128, c = document.createElement('canvas');
  c.width = c.height = s;
  const x = c.getContext('2d')!;
  const star = (r: number, w: number) => {
    x.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
      const rr = i % 2 === 0 ? r : w;
      x.lineTo(s / 2 + Math.cos(a) * rr, s / 2 + Math.sin(a) * rr);
    }
    x.closePath();
  };
  star(60, 11); x.fillStyle = '#17110c'; x.fill();
  star(50, 6); x.fillStyle = '#fffaf0'; x.fill();
  kiraTex = new THREE.CanvasTexture(c);
  kiraTex.colorSpace = THREE.SRGBColorSpace;
  return kiraTex;
}
