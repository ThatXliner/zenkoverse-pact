import * as THREE from 'three';
import { Effect, EffectAttribute, BlendFunction } from 'postprocessing';
import { INK } from './materials';

// Ink lines over the whole frame, from the depth buffer alone. The second
// difference of view depth across a pixel is zero on a flat surface however
// it is tilted, small at a crease (a wall meeting a roof, the edge of a box)
// and large at a silhouette. Creases draw as a fine line, silhouettes as a
// full one. Both are measured relative to depth, so a line keeps its weight
// near and far, and lines thin out toward the horizon so the hills stay clean.
const frag = /* glsl */ `
uniform float crease;
uniform float silhouette;
uniform float weight;
uniform float farZ;
uniform vec3 ink;

float viewZ(const in float d) { return -getViewZ(d); }

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  if (depth >= 0.9999) { outputColor = inputColor; return; }
  vec2 px = texelSize * weight;
  float z = viewZ(depth);
  float l = viewZ(readDepth(uv - vec2(px.x, 0.0))), r = viewZ(readDepth(uv + vec2(px.x, 0.0)));
  float d = viewZ(readDepth(uv - vec2(0.0, px.y))), u = viewZ(readDepth(uv + vec2(0.0, px.y)));
  // A neighbour on the sky has no depth of its own: treat it as the centre's,
  // so the silhouette against the sky is drawn once, on the object's side.
  float far = farZ * 0.98;
  l = l > far ? z + silhouette * z * 4.0 : l;
  r = r > far ? z + silhouette * z * 4.0 : r;
  d = d > far ? z + silhouette * z * 4.0 : d;
  u = u > far ? z + silhouette * z * 4.0 : u;
  float ddx = abs(l + r - 2.0 * z), ddy = abs(d + u - 2.0 * z);
  float dz = max(ddx, ddy) / z;
  float fine = smoothstep(crease, crease * 2.2, dz) * 0.62;
  float full = smoothstep(silhouette, silhouette * 2.0, dz);
  float fade = 1.0 - smoothstep(55.0, 130.0, z);
  float e = max(fine, full) * fade;
  outputColor = vec4(mix(inputColor.rgb, ink, e), inputColor.a);
}`;

export class InkEffect extends Effect {
  constructor(farZ: number) {
    super('InkEffect', frag, {
      blendFunction: BlendFunction.NORMAL,
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, THREE.Uniform>([
        ['crease', new THREE.Uniform(0.0022)],
        ['silhouette', new THREE.Uniform(0.016)],
        ['weight', new THREE.Uniform(1.0)],
        ['farZ', new THREE.Uniform(farZ)],
        ['ink', new THREE.Uniform(new THREE.Color(INK))],
      ]),
    });
  }

  // Line weight in device pixels: thicker on a dense screen, so the drawing
  // reads the same at DPR 1 and 2.
  set weight(v: number) { this.uniforms.get('weight')!.value = v; }
}
