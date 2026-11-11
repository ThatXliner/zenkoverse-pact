import * as THREE from 'three';

const RE_DIRECT = 'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';

// three evaluates the full BRDF for every point and spot light on every
// fragment, even past the light's cutoff distance where its color is zero.
// Skipping those fragments makes far lights and idle pool slots almost free.
export function patchLightLoop(): void {
  const chunk = THREE.ShaderChunk.lights_fragment_begin;
  if (chunk.includes('if ( directLight.visible ) {')) return;
  const dirStart = chunk.indexOf('#if ( NUM_DIR_LIGHTS > 0 )');
  if (dirStart < 0 || !chunk.includes(RE_DIRECT)) throw new Error('lights_fragment_begin changed; update patchLightLoop');
  const punctual = chunk.slice(0, dirStart).split(RE_DIRECT).join(`if ( directLight.visible ) { ${RE_DIRECT} }`);
  THREE.ShaderChunk.lights_fragment_begin = punctual + chunk.slice(dirStart);
}
