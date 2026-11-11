import * as THREE from 'three';
import type { Assets } from '../app/assets';

export type MaterialId = 'Asphalt012' | 'PavingStones138' | 'Concrete034' | 'Bricks059' | 'Metal032' | 'MetalPlates006' | 'WoodFloor051' | 'Planks012' | 'Wood051' | 'Fabric030' | 'Ground037' | 'Tiles074' | 'Rust004' | 'Marble012' | 'RoofingTiles003' | 'CorrugatedSteel005' | 'PaintedPlaster017';

export interface SurfaceOptions {
  repeat?: number;
  wet?: number;
  color?: number;
  roughness?: number;
  metalness?: number;
  puddles?: boolean;
}

export const rainUniforms = { time: { value: 0 }, rainStrength: { value: 1 } };

// Wet-surface shader: darkens albedo, lowers roughness, adds a puddle mask
// from low-frequency noise and animated ripple normals inside the puddles.
const wetChunk = /* glsl */ `
uniform float uWet;
uniform float uPuddles;
uniform float time;
uniform float rainStrength;
varying vec3 vWorldPos;
float hash21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f);
  float a=hash21(i), b=hash21(i+vec2(1,0)), c=hash21(i+vec2(0,1)), d=hash21(i+vec2(1,1));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y); }
float puddleMask(vec2 p){ float n = vnoise(p*0.55)*0.55 + vnoise(p*1.7+3.1)*0.45; return smoothstep(0.56, 0.68, n) * uPuddles; }
vec3 ripple(vec2 p, float t){
  vec3 n = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    vec2 cell = floor(p*1.6 + float(i)*7.3);
    vec2 c = fract(p*1.6 + float(i)*7.3) - 0.5;
    float seed = hash21(cell + float(i));
    float phase = fract(t*0.9 + seed);
    float r = length(c) - phase*0.5;
    float ring = smoothstep(0.03, 0.0, abs(r)) * (1.0-phase) * step(seed, rainStrength*0.9);
    n.xy += normalize(c + 1e-4) * ring * 0.8;
  }
  return n;
}`;

export function makeSurface(assets: Assets, id: MaterialId, opts: SurfaceOptions = {}): THREE.MeshStandardMaterial {
  const repeat = opts.repeat ?? 1;
  const color = assets.texture(`textures/${id}/color`);
  const normal = assets.texture(`textures/${id}/normal`);
  const rough = assets.texture(`textures/${id}/rough`);
  for (const t of [color, normal, rough]) if (t) t.repeat.set(repeat, repeat);
  const mat = new THREE.MeshStandardMaterial({
    map: color ?? null, normalMap: normal ?? null, roughnessMap: rough ?? null,
    color: opts.color ?? 0xffffff, roughness: opts.roughness ?? 1, metalness: opts.metalness ?? 0,
    envMapIntensity: 1,
  });
  const wet = opts.wet ?? 0;
  if (wet > 0) {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uWet = { value: wet };
      shader.uniforms.uPuddles = { value: opts.puddles ? 1 : 0 };
      shader.uniforms.time = rainUniforms.time;
      shader.uniforms.rainStrength = rainUniforms.rainStrength;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + wetChunk)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          float pm = puddleMask(vWorldPos.xz);
          roughnessFactor = mix(roughnessFactor, roughnessFactor * (1.0 - 0.55*uWet), 1.0);
          roughnessFactor = mix(roughnessFactor, 0.06, pm);`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          float pm2 = puddleMask(vWorldPos.xz);
          vec3 rip = ripple(vWorldPos.xz, time);
          normal = normalize(mix(normal, vec3(0.0, 0.0, 1.0) * 0.0 + normalize(vec3(rip.xy*0.6, 1.0)), pm2 * 0.9));`)
        .replace('#include <map_fragment>', `#include <map_fragment>
          float pm3 = puddleMask(vWorldPos.xz);
          diffuseColor.rgb *= mix(1.0, 0.62, uWet);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb*0.35 + vec3(0.01,0.012,0.02), pm3);`);
    };
    mat.customProgramCacheKey = () => `wet${wet}${opts.puddles ? 'p' : ''}`;
  }
  return mat;
}

export function emissive(color: number, intensity = 4): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: intensity, roughness: 0.4, metalness: 0 });
}

export function glass(tint = 0x8fb4cf): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ color: tint, roughness: 0.08, metalness: 0, transmission: 0, transparent: true, opacity: 0.35, envMapIntensity: 1.6, reflectivity: 0.9 });
}
