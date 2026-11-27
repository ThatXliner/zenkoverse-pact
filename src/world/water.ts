import * as THREE from 'three';

// Painted water: two or three flat bands of colour that drift, read in world
// space so one material covers the pond, the stream and the paddies without
// seams. `time` is driven by the world's update.

const NOISE = /* glsl */ `
  float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
  float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y); }`;

const surfaceVert = /* glsl */ `varying vec2 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const surfaceFrag = /* glsl */ `uniform float time; uniform vec3 deep; uniform vec3 light; varying vec2 vW;
  ${NOISE}
  void main(){
    float n = n2(vW * 1.6 + vec2(time * 0.12, time * 0.07)) * 0.6 + n2(vW * 3.3 - vec2(time * 0.09, 0.0)) * 0.4;
    float band = step(0.58, n) * 0.55 + step(0.68, n) * 0.45;
    // Far off, where one pixel spans a band or more, the bands settle into
    // one even tint instead of breaking into speckle.
    float far = smoothstep(0.1, 0.4, length(fwidth(vW)));
    gl_FragColor = vec4(mix(mix(deep, light, band), mix(deep, light, 0.28), far), 0.9);
  }`;

export function waterMaterial(deep: number, light: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({ vertexShader: surfaceVert, fragmentShader: surfaceFrag, uniforms: { time: { value: 0 }, deep: { value: new THREE.Color(deep) }, light: { value: new THREE.Color(light) } }, transparent: true });
}

// A falling sheet: streaks that run down the uv's v, white where they bunch.
const fallVert = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const fallFrag = /* glsl */ `uniform float time; uniform vec3 deep; uniform vec3 light; varying vec2 vUv;
  ${NOISE}
  void main(){
    float n = n2(vec2(vUv.x * 15.0, vUv.y * 2.2 + time * 1.7)) * 0.62 + n2(vec2(vUv.x * 33.0, vUv.y * 4.6 + time * 2.5)) * 0.38;
    vec3 col = mix(deep, light, step(0.47, n));
    col = mix(col, vec3(0.98, 0.99, 1.0), step(0.7, n));
    gl_FragColor = vec4(col, 1.0);
  }`;

export function fallMaterial(deep: number, light: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({ vertexShader: fallVert, fragmentShader: fallFrag, uniforms: { time: { value: 0 }, deep: { value: new THREE.Color(deep) }, light: { value: new THREE.Color(light) } }, side: THREE.DoubleSide });
}

// Foam: white blotches that boil where the falls land, clear between them.
const foamFrag = /* glsl */ `uniform float time; varying vec2 vW; uniform vec2 centre; uniform float radius;
  ${NOISE}
  void main(){
    float r = length(vW - centre) / radius;
    float n = n2(vW * 2.4 + vec2(0.0, time * 0.9)) * 0.6 + n2(vW * 5.1 - vec2(time * 0.7, 0.0)) * 0.4;
    float foam = step(0.35 + r * 0.45, n);
    if (foam < 0.5 || r > 1.0) discard;
    gl_FragColor = vec4(0.97, 0.98, 1.0, 1.0);
  }`;

export function foamMaterial(cx: number, cz: number, radius: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({ vertexShader: surfaceVert, fragmentShader: foamFrag, uniforms: { time: { value: 0 }, centre: { value: new THREE.Vector2(cx, cz) }, radius: { value: radius } } });
}
