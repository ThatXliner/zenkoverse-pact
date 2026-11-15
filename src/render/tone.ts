import * as THREE from 'three';

// Screentone: how every lit surface is painted. The toon material's lighting
// is rewritten so the shader knows how much of the sun reaches a point
// (shadow included), and paints it like a coloured manga page:
//   - full sun: the flat colour;
//   - where the light turns away: a halftone screen, dots that grow until
//     they close into the shade colour;
//   - over a shadow: the shade colour under a fine dot screen of a deeper shade;
//   - in the core of a form shadow (the side turned from the sun): hatching
//     toward ink, crossed where it is darkest.
// The patterns are in screen pixels, as a printed tone is on the page, but
// slide with the world (`origin`), so a pan does not drag the world under
// fixed dots.

// Shared by every manga material: one object per uniform, so a change here
// reaches every compiled program.
export const MANGA = {
  // The screen's cell size in device pixels.
  pitch: { value: 5 },
  // Where the pattern's origin is on screen, in device pixels.
  origin: { value: new THREE.Vector2() },
  // How strongly the tones print (0 flat cel, 1 full).
  tone: { value: 1 },
};

export const mangaToneGlsl = /* glsl */ `
uniform float mangaPitch;
uniform vec2 mangaOrigin;
uniform float mangaTone;

// Coverage of a round-dot halftone screen at 45 degrees: dots grow with
// cover and, past half, the paper between them shrinks to holes.
float mangaDots( vec2 px, float cover, float pitch ) {
  vec2 p = mat2( 0.7071, 0.7071, -0.7071, 0.7071 ) * px / pitch;
  float aa = 0.9 / pitch;
  // A dot thinner than a pixel fades out instead of printing a speck.
  if ( cover <= 0.5 ) {
    float d = length( fract( p ) - 0.5 );
    float r = sqrt( cover / 3.14159 );
    return clamp( ( r - d ) / ( 2.0 * aa ) + 0.5, 0.0, 1.0 ) * min( 1.0, r / aa );
  }
  float d = length( fract( p + 0.5 ) - 0.5 );
  float r = sqrt( ( 1.0 - cover ) / 3.14159 );
  return 1.0 - clamp( ( r - d ) / ( 2.0 * aa ) + 0.5, 0.0, 1.0 ) * min( 1.0, r / aa );
}

// Parallel pen lines, a little uneven, as drawn with a ruler-less hand.
float mangaHatch( vec2 px, float cover, float pitch, float angle ) {
  vec2 dir = vec2( cos( angle ), sin( angle ) );
  float along = dot( px, vec2( -dir.y, dir.x ) );
  float t = dot( px, dir ) / pitch + 0.18 * sin( along * 0.045 + floor( dot( px, dir ) / pitch ) * 1.7 );
  float d = abs( fract( t ) - 0.5 );
  float w = cover * 0.5 * ( 0.8 + 0.2 * sin( along * 0.11 + t * 3.1 ) );
  float aa = 0.8 / pitch;
  return clamp( ( w - d ) / ( 2.0 * aa ) + 0.5, 0.0, 1.0 ) * min( 1.0, w / aa );
}

// lit: the colour in full sun. shade: the colour in shade. v: the sun's reach,
// 0 to 1. facing: N.L toward the sun, for the form shadow's core.
vec3 mangaPaint( vec3 lit, vec3 shade, float v, float facing ) {
  vec2 px = gl_FragCoord.xy - mangaOrigin;
  float pitch = mangaPitch;
  // The turn: a graded halftone between lit and shade.
  float turn = 1.0 - smoothstep( 0.1, 0.9, v );
  float dots = mangaDots( px, turn, pitch );
  vec3 col = mix( lit, shade, mix( step( 0.5, turn ), dots, mangaTone ) );
  // The shadow's own screen: fine dots of a deeper shade.
  float inShade = smoothstep( 0.55, 0.95, turn );
  float screen = mangaDots( px + vec2( pitch * 0.25 ), 0.22, pitch * 0.72 );
  col = mix( col, shade * vec3( 0.7, 0.72, 0.82 ), screen * inShade * 0.85 * mangaTone );
  // The core of the form shadow: hatching toward ink, crossed where darkest.
  float core = smoothstep( -0.12, -0.55, facing ) * inShade;
  float hatch = mangaHatch( px, 0.36 * core, pitch * 1.25, 1.05 );
  hatch = max( hatch, mangaHatch( px, 0.26 * smoothstep( 0.85, 1.0, core ), pitch * 1.25, -0.6 ) );
  col = mix( col, shade * vec3( 0.5, 0.48, 0.58 ), hatch * 0.85 * mangaTone );
  return col;
}
`;

// The sun (every directional light) is split out of three's light loop so the
// shader knows how lit a point is relative to the sun, shadow included; point
// and spot lights (lanterns, flashes) add on top as one hard cel band.
const SUN_START = '#if ( NUM_DIR_LIGHTS > 0 )';
const SUN_END = '#if ( NUM_RECT_AREA_LIGHTS > 0 )';
function sunLoop(): string {
  const chunk = THREE.ShaderChunk.lights_fragment_begin;
  const a = chunk.indexOf(SUN_START), b = chunk.indexOf(SUN_END);
  if (a < 0 || b < a) throw new Error('lights_fragment_begin changed; update sunLoop');
  return chunk.slice(0, a) + chunk.slice(a, b).split('RE_Direct(').join('RE_Direct_Sun(') + chunk.slice(b);
}

const toonPars = /* glsl */ `
varying vec3 vViewPosition;
struct ToonMaterial { vec3 diffuseColor; };
float mangaSun = 0.0;
float mangaFacing = -1.0;
void RE_Direct_Sun( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
  float nl = dot( geometryNormal, directLight.direction );
  mangaSun += luminance( directLight.color ) * smoothstep( -0.02, 0.24, nl );
  mangaFacing = max( mangaFacing, nl );
}
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
  float nl = dot( geometryNormal, directLight.direction );
  float w = fwidth( nl ) + 0.02;
  reflectedLight.directDiffuse += directLight.color * smoothstep( 0.05 - w, 0.05 + w, nl ) * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
  reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct RE_Direct_Toon
#define RE_IndirectDiffuse RE_IndirectDiffuse_Toon
`;

// Lit is the colour in full sun; shade is the sky's fill plus a little of the
// sun, so the shade stays a colour and does not go muddy.
const toonCompose = /* glsl */ `
  vec3 mangaFull = vec3( 0.0 );
  #if NUM_DIR_LIGHTS > 0
  #pragma unroll_loop_start
  for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) { mangaFull += directionalLights[ i ].color; }
  #pragma unroll_loop_end
  #endif
  float mangaV = clamp( mangaSun / max( luminance( mangaFull ), 1e-4 ), 0.0, 1.0 );
  vec3 mangaAlbedo = BRDF_Lambert( diffuseColor.rgb );
  vec3 mangaLit = reflectedLight.indirectDiffuse + mangaAlbedo * mangaFull * 0.92;
  vec3 mangaShade = reflectedLight.indirectDiffuse * 0.95 + mangaAlbedo * mangaFull * 0.2;
  vec3 outgoingLight = mangaPaint( mangaLit, mangaShade, mangaV, mangaFacing ) + reflectedLight.directDiffuse + totalEmissiveRadiance;
`;

const OUTGOING = 'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;';

// Rewrites a MeshToonMaterial's lighting into the manga paint above. Shadow
// maps come out soft; each is snapped to a hard band first, so a cast shadow
// is a shape.
export function mangaShading(mat: THREE.MeshToonMaterial): void {
  mat.onBeforeCompile = (shader) => {
    if (!shader.fragmentShader.includes(OUTGOING)) throw new Error('meshtoon fragment changed; update mangaShading');
    shader.uniforms.mangaPitch = MANGA.pitch;
    shader.uniforms.mangaOrigin = MANGA.origin;
    shader.uniforms.mangaTone = MANGA.tone;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${mangaToneGlsl}`)
      .replace('#include <lights_toon_pars_fragment>', toonPars)
      .replace('#include <lights_fragment_begin>', sunLoop())
      .replace('#include <shadowmap_pars_fragment>', '#include <shadowmap_pars_fragment>\n#define getShadowStep(a,b,c,d,e,f) smoothstep(0.42, 0.58, getShadow(a,b,c,d,e,f))')
      .replace(/\? getShadow\( directionalShadowMap/g, '? getShadowStep( directionalShadowMap')
      .replace(/\? getShadow\( spotShadowMap/g, '? getShadowStep( spotShadowMap')
      .replace(OUTGOING, toonCompose);
  };
  mat.customProgramCacheKey = () => 'manga-toon';
}
