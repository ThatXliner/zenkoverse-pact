import * as THREE from 'three';

// The cel-shaded material set. Everything in the world and on the characters
// is a MeshToonMaterial over one shared light ramp, so the whole frame reads
// as one drawing: flat fills, a hard terminator, stepped shadows, and ink
// lines from the post effect (src/render/ink.ts) plus an inverted hull on the
// characters (inkHull below).

export const INK = 0x14101c;

// Four light bands: core shadow, half tone, lit, and a hot highlight.
const RAMP_STEPS = [0.36, 0.62, 0.9, 1.0];
let ramp: THREE.DataTexture | null = null;
export function toonRamp(): THREE.DataTexture {
  if (ramp) return ramp;
  const data = new Uint8Array(RAMP_STEPS.length * 4);
  RAMP_STEPS.forEach((v, i) => { data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = Math.round(v * 255); data[i * 4 + 3] = 255; });
  ramp = new THREE.DataTexture(data, RAMP_STEPS.length, 1, THREE.RGBAFormat);
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
  ramp.needsUpdate = true;
  return ramp;
}

// Shadow maps come out soft; the ramp wants them as a hard band. Each
// shadowed light's term is snapped to lit or shaded before the ramp sees it.
function hardShadows(mat: THREE.Material): void {
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <shadowmap_pars_fragment>', '#include <shadowmap_pars_fragment>\n#define getShadowStep(a,b,c,d,e,f) smoothstep(0.42, 0.58, getShadow(a,b,c,d,e,f))')
      .replace(/\? getShadow\( directionalShadowMap/g, '? getShadowStep( directionalShadowMap')
      .replace(/\? getShadow\( spotShadowMap/g, '? getShadowStep( spotShadowMap');
  };
  mat.customProgramCacheKey = () => 'toon-hard-shadow';
}

export interface ToonOptions {
  map?: THREE.Texture | null;
  emissive?: number;
  emissiveIntensity?: number;
  side?: THREE.Side;
  transparent?: boolean;
  opacity?: number;
  alphaTest?: number;
}

export function toon(color: number | THREE.Color, opts: ToonOptions = {}): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({
    color, gradientMap: toonRamp(), map: opts.map ?? null,
    emissive: opts.emissive ?? 0x000000, emissiveIntensity: opts.emissiveIntensity ?? 1,
    side: opts.side ?? THREE.FrontSide, transparent: opts.transparent ?? false, opacity: opts.opacity ?? 1, alphaTest: opts.alphaTest ?? 0,
  });
  hardShadows(m);
  return m;
}

// Faceted: every face its own normal, so a cone or a sphere reads as cut
// planes under the ramp instead of a smooth gradient.
export function faceted(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const flat = geo.index ? geo.toNonIndexed() : geo;
  flat.computeVertexNormals();
  return flat;
}

// Lit surfaces (lanterns, glyphs, markings): no shading, they are the colour.
export function emissive(color: number, intensity = 4): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: intensity, roughness: 0.4, metalness: 0 });
}

// Re-skins a loaded glTF (Kenney palette props, the trees) in toon: the
// palette map stays, so each face keeps its authored flat colour.
export function toonify(root: THREE.Object3D, tint?: number): void {
  const cache = new Map<THREE.Material, THREE.MeshToonMaterial>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const src = m.material as THREE.MeshStandardMaterial;
    let t = cache.get(src);
    if (!t) {
      t = toon(tint ?? src.color?.getHex() ?? 0xffffff, { map: src.map ?? null, side: src.side, transparent: src.transparent, opacity: src.opacity, alphaTest: src.alphaTest });
      cache.set(src, t);
    }
    m.material = t;
  });
}

// Inverted hull: the same skinned mesh drawn again, back faces only, pushed
// out along the normal, in ink. `width` is in metres at one metre; it grows
// with distance so the line keeps its weight on screen.
const hullVert = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
uniform float width;
void main() {
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
  float w = width * clamp(-mv.z * 0.09, 0.45, 2.6);
  transformed += normalize(objectNormal) * w;
  #include <project_vertex>
}`;
const hullFrag = /* glsl */ `uniform vec3 ink; void main() { gl_FragColor = vec4(ink, 1.0); }`;

export function inkHullMaterial(width: number, ink = INK): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({ vertexShader: hullVert, fragmentShader: hullFrag, uniforms: { width: { value: width }, ink: { value: new THREE.Color(ink) } }, side: THREE.BackSide });
}

// Adds a hull sibling for every skinned mesh under `root` and returns them,
// so a caller can hide or recolour the outline with the body.
export function addInkHulls(root: THREE.Object3D, width: number, ink = INK): THREE.SkinnedMesh[] {
  const mat = inkHullMaterial(width, ink);
  const out: THREE.SkinnedMesh[] = [];
  const targets: THREE.SkinnedMesh[] = [];
  root.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) targets.push(o as THREE.SkinnedMesh); });
  for (const m of targets) {
    const hull = new THREE.SkinnedMesh(m.geometry, mat);
    hull.bind(m.skeleton, m.bindMatrix);
    hull.bindMode = m.bindMode;
    hull.frustumCulled = m.frustumCulled;
    hull.boundingSphere = m.boundingSphere;
    hull.castShadow = false;
    hull.receiveShadow = false;
    hull.name = `${m.name}_ink`;
    hull.renderOrder = m.renderOrder;
    m.parent!.add(hull);
    hull.position.copy(m.position); hull.quaternion.copy(m.quaternion); hull.scale.copy(m.scale);
    out.push(hull);
  }
  return out;
}

// A wooden board with brushed kanji. `color` is the paint; the board is the
// wood of the compound.
export function paintedSign(text: string, opts: { width?: number; vertical?: boolean; paint?: string; wood?: number; emissive?: boolean } = {}): THREE.Group {
  const vertical = opts.vertical ?? false;
  const canvas = document.createElement('canvas');
  canvas.width = vertical ? 256 : 1024;
  canvas.height = vertical ? 1024 : 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#' + new THREE.Color(opts.wood ?? 0xd8c39a).getHexString();
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = `800 ${vertical ? 170 : 180}px "Shippori Mincho B1", "Zen Kaku Gothic New", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = opts.paint ?? '#2b1d1a';
  if (vertical) {
    const chars = [...text];
    const step = canvas.height / (chars.length + 0.4);
    chars.forEach((c, i) => ctx.fillText(c, 128, step * (i + 0.7)));
  } else ctx.fillText(text, 512, 134);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const w = opts.width ?? (vertical ? 0.9 : 3.6);
  const h = vertical ? w * 4 : w / 4;
  const g = new THREE.Group();
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), opts.emissive ? new THREE.MeshBasicMaterial({ map: tex }) : toon(0xffffff, { map: tex }));
  face.position.z = 0.03;
  const board = new THREE.Mesh(new THREE.BoxGeometry(w + 0.12, h + 0.12, 0.06), toon(0x6b4a33));
  board.castShadow = true;
  g.add(board, face);
  return g;
}
