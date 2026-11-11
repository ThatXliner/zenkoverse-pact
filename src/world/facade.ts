import * as THREE from 'three';
import type { Assets } from '../app/assets';
import type { MaterialId } from '../render/materials';
import { rainUniforms } from '../render/materials';

export const facadeUniforms = { time: rainUniforms.time };

// Replaces a Kenney palette material with real PBR surfaces projected
// triplanarly in world space. The palette still decides what each face is:
// light bluish cells become lit windows, everything else gets the wall set
// tinted toward the palette color.
export function facadeMaterial(assets: Assets, palette: THREE.Texture | null, wall: MaterialId, trim: MaterialId, opts: { scale?: number; windowWarmth?: number; wet?: number } = {}): THREE.MeshStandardMaterial {
  const color = assets.texture(`textures/${wall}/color`)!;
  const normal = assets.texture(`textures/${wall}/normal`)!;
  const rough = assets.texture(`textures/${wall}/rough`)!;
  const trimColor = assets.texture(`textures/${trim}/color`)!;
  const mat = new THREE.MeshStandardMaterial({ map: palette, roughness: 1, metalness: 0, envMapIntensity: 0.9 });
  const scale = opts.scale ?? 0.28;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tWall = { value: color };
    shader.uniforms.tWallN = { value: normal };
    shader.uniforms.tWallR = { value: rough };
    shader.uniforms.tTrim = { value: trimColor };
    shader.uniforms.uScale = { value: scale };
    shader.uniforms.uWarm = { value: opts.windowWarmth ?? 1 };
    shader.uniforms.uWet = { value: opts.wet ?? 0.5 };
    shader.uniforms.time = facadeUniforms.time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWp;\nvarying vec3 vWn;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vWp = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWn = normalize(mat3(modelMatrix) * objectNormal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tWall; uniform sampler2D tWallN; uniform sampler2D tWallR; uniform sampler2D tTrim;
        uniform float uScale; uniform float uWarm; uniform float uWet; uniform float time;
        varying vec3 vWp; varying vec3 vWn;
        float fhash(vec3 p){ p = fract(p*0.3183099 + vec3(0.1,0.2,0.3)); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
        vec4 tri(sampler2D t, vec3 p, vec3 n){
          vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x+w.y+w.z);
          return texture2D(t, p.zy*uScale)*w.x + texture2D(t, p.xz*uScale)*w.y + texture2D(t, p.xy*uScale)*w.z; }`)
      .replace('#include <map_fragment>', `
        vec4 pal = texture2D(map, vMapUv);
        float lum = dot(pal.rgb, vec3(0.3,0.59,0.11));
        float bluish = pal.b - max(pal.r, pal.g);
        float isWindow = step(0.04, bluish) * step(0.25, lum);
        float isTrim = step(lum, 0.22);
        vec3 wallC = tri(tWall, vWp, vWn).rgb;
        vec3 trimC = tri(tTrim, vWp, vWn).rgb;
        vec3 palTint = mix(vec3(1.0), pal.rgb / max(lum, 0.05) * 0.85, 0.35);
        vec3 wallFinal = mix(wallC * palTint, trimC * 0.8, isTrim) * 0.55;
        vec3 cell = floor(vWp * vec3(0.3, 0.42, 0.3) + vec3(0.5));
        float lit = step(0.78, fhash(cell));
        float flick = 0.9 + 0.1*sin(time*3.0 + fhash(cell+1.0)*40.0);
        vec3 winCol = mix(vec3(0.5,0.72,1.0)*0.9, vec3(1.0,0.78,0.5), uWarm*fhash(cell+2.0)) ;
        vec3 winDark = vec3(0.01,0.015,0.03);
        diffuseColor.rgb = mix(wallFinal, winDark, isWindow);
        vFacadeWindow = isWindow; vFacadeLit = lit*flick; vFacadeWinCol = winCol;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        float wr = tri(tWallR, vWp, vWn).r;
        roughnessFactor = mix(wr * (1.0 - 0.35*uWet*(1.0-clamp(vWn.y,0.0,1.0))), 0.12, vFacadeWindow);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, 0.6, vFacadeWindow);`)
      .replace('#include <normal_fragment_maps>', `
        vec3 tn = tri(tWallN, vWp, vWn).rgb * 2.0 - 1.0;
        vec3 nW = normalize(vWn);
        vec3 tangentW = normalize(abs(nW.y) > 0.9 ? vec3(1.0,0.0,0.0) : cross(vec3(0.0,1.0,0.0), nW));
        vec3 bitW = cross(nW, tangentW);
        vec3 pN = normalize(nW + (tangentW*tn.x + bitW*tn.y) * 0.8 * (1.0 - vFacadeWindow));
        normal = normalize((viewMatrix * vec4(pN, 0.0)).xyz);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vFacadeWinCol * (vFacadeLit * 1.1 + 0.02) * vFacadeWindow;`)
      .replace('void main() {', 'float vFacadeWindow; float vFacadeLit; vec3 vFacadeWinCol;\nvoid main() {');
  };
  mat.customProgramCacheKey = () => `facade-${wall}-${trim}-${scale}`;
  return mat;
}
