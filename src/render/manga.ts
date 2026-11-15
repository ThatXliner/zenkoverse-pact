import * as THREE from 'three';
import { Pass, Effect, EffectAttribute, BlendFunction } from 'postprocessing';
import { INK } from './materials';

// The page: everything the post effect draws over the toned frame
// (src/render/tone.ts paints the surfaces).
//
// Ink. A mask pass reads the depth buffers (the world's and the first-person
// arms') and marks every line: a crease where depth bends, a silhouette where
// it breaks. Each line pixel carries the width the brush wants there (heavier
// on a silhouette and nearer the camera), the pressure (a slow swell and
// taper along the line) and the line's direction. The page effect then
// gathers those marks over a small disc, so a line is as wide as its own
// pixel asks, and breaks a light-pressure stretch into dry-brush bristle
// streaks along the stroke. Lines are drawn in one ink over the world, the
// bodies and the arms alike.
//
// Paper. The frame is printed on warm paper with a fibre grain, colours a
// little quieter than the render, and a hand-ruled panel border.
//
// Staging. Focus lines (lines converging on a point) for a big hit, speed
// lines for a dash, an impact frame drawn as two inks, and whole-frame looks
// a cutscene shot can ask for: sumi-e ink wash, watercolour bleed, and a
// negative (white ink on black).

export type LookId = 'manga' | 'wash' | 'watercolor' | 'negative';

export interface InkQuality {
  // Gather radius in 1080p pixels: how wide the heaviest line can be.
  radius: number;
  // Dry-brush breakup, paper fibre and the painted looks.
  detail: boolean;
}

const common = /* glsl */ `
float mhash( vec2 p ) { p = fract( p * vec2( 123.34, 456.21 ) ); p += dot( p, p + 45.32 ); return fract( p.x * p.y ); }
float mnoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mhash( i ), mhash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( mhash( i + vec2( 0.0, 1.0 ) ), mhash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
`;

const maskVert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4( position.xy, 1.0, 1.0 ); }
`;

const maskFrag = /* glsl */ `
uniform sampler2D depthMain;
uniform sampler2D depthOver;
uniform float overOn;
uniform vec2 clipMain;
uniform vec2 clipOver;
uniform vec2 texel;
uniform float stride;
uniform vec2 origin;
uniform float crease;
uniform float silhouette;
varying vec2 vUv;
${common}

float vz( float d, vec2 c ) { return ( c.x * c.y ) / ( c.y - ( c.y - c.x ) * d ); }

// Second difference of view depth across the pixel: zero on any flat
// surface, small at a crease, large at a silhouette. A neighbour off the
// surface (the sky, or no arm there) counts as far behind, so the
// silhouette is drawn on the object's side.
vec4 edge( sampler2D tex, vec2 c, vec2 uv, vec2 px, out float z ) {
  float dc = texture2D( tex, uv ).r;
  z = vz( dc, c );
  float far = z * ( 1.0 + silhouette * 4.0 );
  float dl = texture2D( tex, uv - vec2( px.x, 0.0 ) ).r, dr = texture2D( tex, uv + vec2( px.x, 0.0 ) ).r;
  float dd = texture2D( tex, uv - vec2( 0.0, px.y ) ).r, du = texture2D( tex, uv + vec2( 0.0, px.y ) ).r;
  float l = dl >= 0.9999 ? far : vz( dl, c ), r = dr >= 0.9999 ? far : vz( dr, c );
  float d = dd >= 0.9999 ? far : vz( dd, c ), u = du >= 0.9999 ? far : vz( du, c );
  float dz = max( abs( l + r - 2.0 * z ), abs( d + u - 2.0 * z ) ) / z;
  return vec4( dz, r - l, u - d, 0.0 );
}

void main() {
  vec2 px = texel * max( 1.0, stride * 0.85 );
  float z;
  vec4 e;
  bool arm = overOn > 0.5 && texture2D( depthOver, vUv ).r < 0.9999;
  if ( arm ) {
    e = edge( depthOver, clipOver, vUv, px, z );
    // The arms are a hand's length away: draw them as if at a metre and a half.
    z = 1.5;
  } else {
    if ( texture2D( depthMain, vUv ).r >= 0.9999 ) { gl_FragColor = vec4( 0.0 ); return; }
    e = edge( depthMain, clipMain, vUv, px, z );
  }
  float fine = smoothstep( crease, crease * 2.2, e.x ) * 0.85;
  float full = smoothstep( silhouette, silhouette * 2.0, e.x );
  float fade = arm ? 1.0 : 1.0 - smoothstep( 45.0, 120.0, z );
  float strength = max( fine, full ) * fade;
  if ( strength < 0.01 ) { gl_FragColor = vec4( 0.0 ); return; }
  // Pressure: a slow swell and taper along every line, fixed to the world.
  vec2 q = ( gl_FragCoord.xy - origin ) / stride;
  float pressure = smoothstep( 0.15, 0.85, mnoise( q / 46.0 ) * 0.7 + mnoise( q / 13.0 ) * 0.3 );
  // Heavier toward the camera, and heavier the deeper the break behind the
  // edge, so a figure against the floor outweighs a step in it; a silhouette
  // keeps its weight however far it is.
  float near = clamp( 7.5 / z, mix( 0.65, 0.8, full ), 1.8 );
  float deep = smoothstep( silhouette * 2.0, silhouette * 7.0, e.x );
  float width = mix( 0.95, 1.75 + 0.45 * deep, full ) * near * ( 0.5 + 0.8 * pressure );
  vec2 n = normalize( e.yz + 1e-6 );
  float angle = fract( atan( n.y, n.x ) / 3.14159265 + 1.0 );
  gl_FragColor = vec4( strength, width / 6.0, angle, pressure );
}
`;

// Marks every ink line, from the world's depth and the arms' depth.
export class InkMaskPass extends Pass {
  readonly target: THREE.WebGLRenderTarget;
  private mat: THREE.ShaderMaterial;

  constructor(private view: THREE.PerspectiveCamera, private overlay: OverlayPass) {
    super('InkMaskPass');
    this.needsSwap = false;
    this.needsDepthTexture = true;
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.UnsignedByteType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
    this.mat = new THREE.ShaderMaterial({
      vertexShader: maskVert, fragmentShader: maskFrag, depthTest: false, depthWrite: false,
      uniforms: {
        depthMain: { value: null }, depthOver: { value: overlay.target.depthTexture }, overOn: { value: 0 },
        clipMain: { value: new THREE.Vector2() }, clipOver: { value: new THREE.Vector2() },
        texel: { value: new THREE.Vector2() }, stride: { value: 1 }, origin: { value: new THREE.Vector2() },
        crease: { value: 0.0022 }, silhouette: { value: 0.016 },
      },
    });
    this.fullscreenMaterial = this.mat;
  }

  override setDepthTexture(depthTexture: THREE.Texture): void { this.mat.uniforms.depthMain!.value = depthTexture; }

  set stride(v: number) { this.mat.uniforms.stride!.value = v; }
  set origin(v: THREE.Vector2) { (this.mat.uniforms.origin!.value as THREE.Vector2).copy(v); }

  override setSize(w: number, h: number): void {
    this.target.setSize(w, h);
    (this.mat.uniforms.texel!.value as THREE.Vector2).set(1 / w, 1 / h);
  }

  override render(renderer: THREE.WebGLRenderer): void {
    const u = this.mat.uniforms;
    (u.clipMain!.value as THREE.Vector2).set(this.view.near, this.view.far);
    (u.clipOver!.value as THREE.Vector2).set(this.overlay.eye.near, this.overlay.eye.far);
    u.overOn!.value = this.overlay.drawn ? 1 : 0;
    renderer.setRenderTarget(this.target);
    renderer.render(this.scene!, this.view);
  }
}

// The first-person arms, drawn into their own target so the page effect can
// lay them over the world and ink them like everything else.
export class OverlayPass extends Pass {
  readonly target: THREE.WebGLRenderTarget;
  visible = true;
  drawn = false;
  private clear = new THREE.Color();

  constructor(private overlayScene: THREE.Scene, readonly eye: THREE.PerspectiveCamera) {
    super('OverlayPass');
    this.needsSwap = false;
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(1, 1, THREE.UnsignedIntType) });
  }

  override setSize(w: number, h: number): void { this.target.setSize(w, h); }

  override render(renderer: THREE.WebGLRenderer): void {
    this.drawn = this.visible;
    if (!this.visible) return;
    const alpha = renderer.getClearAlpha();
    renderer.getClearColor(this.clear);
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(this.target);
    renderer.clear(true, true, false);
    renderer.render(this.overlayScene, this.eye);
    renderer.setClearColor(this.clear, alpha);
  }
}

const pageFrag = /* glsl */ `
uniform sampler2D overColor;
uniform float overOn;
uniform sampler2D inkMask;
uniform vec2 maskTexel;
uniform float stride;
uniform vec2 origin;
uniform vec3 ink;
uniform vec3 paper;
uniform float inkScale;
uniform float wash;
uniform float water;
uniform float negative;
uniform vec3 accent;
uniform float impact;
uniform float impactFlip;
uniform float focus;
uniform vec2 focusAt;
uniform float speed;
uniform vec2 speedDir;
uniform float radial;
uniform float panel;
uniform float seed;
${common}

// The brush: the strongest mark within reach whose own width covers this pixel.
float brush( vec2 uv, out float angle, out float pressure ) {
  float best = 0.0;
  angle = 0.0; pressure = 1.0;
  for ( int y = -INK_R; y <= INK_R; y ++ ) {
    for ( int x = -INK_R; x <= INK_R; x ++ ) {
      vec2 o = vec2( float( x ), float( y ) );
      float d = length( o );
      if ( d > float( INK_R ) + 0.5 ) continue;
      vec4 m = texture2D( inkMask, uv + o * maskTexel * stride );
      if ( m.r < 0.01 ) continue;
      float w = m.g * 6.0 * inkScale;
      float a = m.r * ( 1.0 - smoothstep( w - 0.55, w + 0.55, d ) );
      if ( a > best ) { best = a; angle = m.b; pressure = m.a; }
    }
  }
  #ifdef DETAIL
  // Dry brush: where the pressure is light, the stroke splits into bristle
  // streaks that run along it.
  float th = angle * 3.14159265;
  vec2 n = vec2( cos( th ), sin( th ) );
  vec2 q = ( gl_FragCoord.xy - origin ) / stride;
  float streak = mnoise( vec2( dot( q, n ) * 0.85, dot( q, vec2( -n.y, n.x ) ) * 0.05 ) );
  best *= 1.0 - smoothstep( 0.42, 0.62, streak ) * smoothstep( 0.55, 0.05, pressure ) * 0.9;
  #endif
  return best;
}

#ifdef DETAIL
// A painted reading of the frame: colour smeared along brush strokes that
// follow a slow field, with bristle texture across them.
vec3 strokes( vec2 uv, float len ) {
  vec2 q = ( gl_FragCoord.xy - origin ) / stride;
  float a = mnoise( q / 90.0 ) * 6.2832 * 1.4 + mnoise( q / 31.0 ) * 1.2;
  vec2 dir = vec2( cos( a ), sin( a ) );
  vec2 stepUv = dir * texelSize * stride * len;
  vec3 acc = vec3( 0.0 );
  for ( int i = -5; i <= 5; i ++ ) acc += texture2D( inputBuffer, uv + stepUv * float( i ) ).rgb;
  acc /= 11.0;
  float bristle = mnoise( vec2( dot( q, vec2( -dir.y, dir.x ) ) * 0.9, dot( q, dir ) * 0.06 ) );
  return acc * ( 0.88 + 0.24 * bristle );
}
#endif

// How much a colour is the Technique's own: same hue, and saturated. The
// painted looks keep it as their one accent and let everything else go to ink.
float accentMatch( vec3 c ) {
  vec3 pc = c - vec3( luminance( c ) ), ac = accent - vec3( luminance( accent ) );
  float sat = max( c.r, max( c.g, c.b ) ) - min( c.r, min( c.g, c.b ) );
  return smoothstep( 0.8, 0.96, dot( normalize( pc + 1e-5 ), normalize( ac + 1e-5 ) ) ) * smoothstep( 0.12, 0.3, sat );
}

// Lines converging on a point, thick at the frame's edge and tapering in.
float focusLines( vec2 frag, vec2 at, float k ) {
  vec2 d = frag - at;
  float r = length( d ) / ( 0.5 * min( resolution.x, resolution.y ) );
  float a = atan( d.y, d.x ) / 6.2832 * 150.0;
  float cell = floor( a );
  float h = mhash( vec2( cell, seed ) ), h2 = mhash( vec2( cell * 1.7, seed + 3.0 ) );
  float inner = mix( 1.05, 0.38, k ) + h * 0.45;
  float w = ( 0.1 + 0.32 * h2 ) * smoothstep( inner, inner + 0.6, r );
  float u = abs( fract( a ) - 0.5 );
  float aa = fwidth( a ) * 0.8;
  return ( 1.0 - smoothstep( w - aa, w + aa, u ) ) * step( 0.22, h2 ) * k;
}

// Streaks along the direction of motion, gathered at the frame's edges.
float speedLines( vec2 frag, vec2 dir, float k ) {
  vec2 n = vec2( -dir.y, dir.x );
  float across = dot( frag, n ) / ( 7.0 * stride );
  float cell = floor( across );
  float h = mhash( vec2( cell, seed ) ), h2 = mhash( vec2( cell, seed + 9.0 ) );
  float along = dot( frag, dir ) / ( resolution.y * ( 0.25 + 0.5 * h ) ) + h2 * 7.0;
  float seg = smoothstep( 0.0, 0.25, fract( along ) ) * smoothstep( 1.0, 0.55, fract( along ) );
  float u = abs( fract( across ) - 0.5 );
  float w = ( 0.06 + 0.16 * h2 ) * seg;
  vec2 c = ( frag / resolution - 0.5 ) * vec2( resolution.x / resolution.y, 1.0 );
  float edge = smoothstep( 0.18, 0.62, length( c ) );
  return ( 1.0 - smoothstep( w - 0.05, w + 0.05, u ) ) * step( 0.35, h ) * edge * k;
}

void mainImage( const in vec4 inputColor, const in vec2 uv, out vec4 outputColor ) {
  vec3 col = inputColor.rgb;
  vec2 frag = uv * resolution;
  if ( overOn > 0.5 ) { vec4 o = texture2D( overColor, uv ); col = mix( col, o.rgb, o.a ); }

  float lineScale = 1.0;
  #ifdef DETAIL
  if ( wash > 0.001 ) {
    // Sumi-e: the frame as ink wash on paper, three wet tones with the
    // brush's direction in them, and the Technique's colour as the one accent.
    vec3 p = strokes( uv, 2.4 );
    float v = luminance( p );
    float dens = 1.0 - smoothstep( 0.06, 0.8, v );
    float lv = floor( dens * 3.0 + 0.35 ) / 3.0;
    dens = mix( dens, lv, 0.75 );
    vec3 w = mix( paper, ink, dens * 0.92 );
    w = mix( w, accent, accentMatch( p ) * 0.7 );
    col = mix( col, w, wash );
    lineScale += wash * 0.7;
  }
  if ( water > 0.001 ) {
    // Watercolour: colour bled along strokes, pooled darker at its edges,
    // lifted toward the paper, the paper's tooth showing through.
    vec3 b = col * 0.2;
    for ( int k = 0; k < 8; k ++ ) {
      float a = float( k ) * 0.7854 + 0.4;
      b += texture2D( inputBuffer, uv + vec2( cos( a ), sin( a ) ) * texelSize * stride * 3.5 ).rgb * 0.1;
    }
    vec3 p = mix( b, strokes( uv, 1.3 ), 0.5 );
    // Pigment pools darker where one colour meets another.
    float pool = smoothstep( 0.03, 0.25, length( col - b ) );
    vec3 w = p * ( 1.0 - 0.32 * pool );
    // It settles in the paper's tooth, and the lightest washes are the paper.
    float tooth = mnoise( frag / ( 1.8 * stride ) ) * 0.6 + mnoise( frag / ( 7.0 * stride ) ) * 0.4;
    w *= 0.88 + 0.16 * tooth;
    w = mix( w, paper, smoothstep( 0.62, 0.95, luminance( w ) ) * 0.6 );
    // A wash of the Technique's colour over everything.
    w = mix( w, w * ( 0.5 + 0.65 * accent ), 0.4 );
    col = mix( col, w, water );
    lineScale -= water * 0.35;
  }
  #endif

  float angle, pressure;
  float line = brush( uv, angle, pressure ) * lineScale;
  line = clamp( line, 0.0, 1.0 );

  // A coloured page: colours a touch quieter than the render, printed on paper.
  float l = luminance( col );
  col = mix( vec3( l ), col, 0.9 );
  col *= paper;
  #ifdef DETAIL
  float fibre = mnoise( frag / ( 1.6 * stride ) ) * 0.6 + mnoise( frag * vec2( 0.08, 0.6 ) / stride ) * 0.4;
  col *= 0.97 + 0.05 * fibre;
  #endif
  col = mix( col, ink, line );

  col = mix( col, ink, max( focusLines( frag, focusAt * resolution, focus ), speedLines( frag, speedDir, speed ) ) );
  col = mix( col, ink, focusLines( frag, resolution * 0.5, radial ) );

  // The impact frame: the page in two inks for a frame or three, flipping
  // between positive and negative, the Technique's colour in the paper.
  if ( impact > 0.0 ) {
    float hard = step( 0.32, luminance( col ) );
    vec3 two = mix( ink, mix( paper, accent, 0.35 ), hard );
    if ( impactFlip > 0.5 ) two = paper + ink - two;
    col = mix( col, two, impact );
  }
  // The negative: light goes to ink and dark to paper, the accent kept.
  if ( negative > 0.0 ) {
    vec3 neg = mix( paper, ink, smoothstep( 0.08, 0.8, luminance( col ) ) );
    neg = mix( neg, accent, accentMatch( col ) * 0.8 );
    col = mix( col, neg, negative );
  }

  // The panel: paper margin and a hand-ruled border.
  if ( panel > 0.0 ) {
    float m = panel * stride;
    float d = min( min( frag.x, resolution.x - frag.x ), min( frag.y, resolution.y - frag.y ) );
    float wob = ( mnoise( vec2( frag.x + frag.y, 3.0 ) / ( 40.0 * stride ) ) - 0.5 ) * 1.6 * stride;
    float t = 1.6 * stride * ( 0.75 + 0.5 * mnoise( vec2( frag.x - frag.y, 9.0 ) / ( 90.0 * stride ) ) );
    col = mix( col, paper, step( d, m + wob - t ) );
    col = mix( col, ink, 1.0 - smoothstep( t - 0.8, t + 0.8, abs( d - ( m + wob ) ) ) );
  }
  outputColor = vec4( col, inputColor.a );
}
`;

// The page effect: arms, brush ink, the painted looks, staging lines, paper,
// the impact frame and the panel.
export class PageEffect extends Effect {
  constructor(mask: InkMaskPass, overlay: OverlayPass) {
    super('PageEffect', pageFrag, {
      blendFunction: BlendFunction.NORMAL,
      attributes: EffectAttribute.CONVOLUTION,
      defines: new Map([['INK_R', '3'], ['DETAIL', '1']]),
      uniforms: new Map<string, THREE.Uniform>([
        ['overColor', new THREE.Uniform(overlay.target.texture)],
        ['overOn', new THREE.Uniform(0)],
        ['inkMask', new THREE.Uniform(mask.target.texture)],
        ['maskTexel', new THREE.Uniform(new THREE.Vector2())],
        ['stride', new THREE.Uniform(1)],
        ['origin', new THREE.Uniform(new THREE.Vector2())],
        ['ink', new THREE.Uniform(new THREE.Color(INK))],
        ['paper', new THREE.Uniform(new THREE.Color(0.985, 0.955, 0.885))],
        ['inkScale', new THREE.Uniform(1)],
        ['wash', new THREE.Uniform(0)],
        ['water', new THREE.Uniform(0)],
        ['negative', new THREE.Uniform(0)],
        ['accent', new THREE.Uniform(new THREE.Color(1, 0.4, 0.2))],
        ['impact', new THREE.Uniform(0)],
        ['impactFlip', new THREE.Uniform(0)],
        ['focus', new THREE.Uniform(0)],
        ['focusAt', new THREE.Uniform(new THREE.Vector2(0.5, 0.5))],
        ['speed', new THREE.Uniform(0)],
        ['speedDir', new THREE.Uniform(new THREE.Vector2(1, 0))],
        ['radial', new THREE.Uniform(0)],
        ['panel', new THREE.Uniform(9)],
        ['seed', new THREE.Uniform(0)],
      ]),
    });
  }

  u(name: string): THREE.Uniform { return this.uniforms.get(name)!; }

  setQuality(q: InkQuality): void {
    this.defines.set('INK_R', String(q.radius));
    if (q.detail) this.defines.set('DETAIL', '1'); else this.defines.delete('DETAIL');
    this.setChanged();
  }

  override setSize(w: number, h: number): void { (this.u('maskTexel').value as THREE.Vector2).set(1 / w, 1 / h); }
}
