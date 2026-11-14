import * as THREE from 'three';

export interface Environment {
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  update(camera: THREE.Camera, time: number): void;
}

// Late afternoon over the compound. The sun sits low in the west, so every
// wall throws a long shadow across the courtyard; the shade is blue, the lit
// side is warm. The sky is a painted gradient with a few flat cloud bands
// and a soft sun glow, drawn on a dome behind everything.
const SUN_DIR = new THREE.Vector3(-0.72, 0.42, 0.26).normalize();

function skyDome(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { time: { value: 0 }, sunDir: { value: SUN_DIR.clone() } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w; }',
    fragmentShader: `varying vec3 vDir; uniform float time; uniform vec3 sunDir;
      float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
      float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y); }
      void main(){
        float y = clamp(vDir.y, -0.05, 1.0);
        vec3 zenith = vec3(0.30, 0.47, 0.78);
        vec3 mid = vec3(0.62, 0.72, 0.86);
        vec3 horizon = vec3(0.98, 0.78, 0.58);
        vec3 col = mix(horizon, mid, smoothstep(0.0, 0.22, y));
        col = mix(col, zenith, smoothstep(0.2, 0.75, y));
        // Sun: a hard disc and a warm bloom around it.
        float s = dot(normalize(vDir), sunDir);
        col += vec3(1.0, 0.72, 0.42) * smoothstep(0.988, 0.995, s) * 0.55;
        col += vec3(1.0, 0.62, 0.3) * pow(max(0.0, s), 14.0) * 0.3;
        // Cloud bands: flat shapes with a lit top edge and a lilac underside.
        vec2 uv = vDir.xz / max(0.1, vDir.y + 0.18);
        float c = n2(uv * 1.5 + vec2(time * 0.006, 0.0)) * 0.6 + n2(uv * 3.2 + vec2(time * 0.011, 7.0)) * 0.4;
        float cloud = smoothstep(0.56, 0.6, c) * smoothstep(0.02, 0.2, y) * (1.0 - smoothstep(0.55, 0.9, y));
        float lit = smoothstep(0.6, 0.66, c + 0.03 * sunDir.y);
        vec3 cloudCol = mix(vec3(0.74, 0.66, 0.82), vec3(1.0, 0.95, 0.9), lit);
        col = mix(col, cloudCol, cloud * 0.92);
        gl_FragColor = vec4(min(col, vec3(1.0)), 1.0);
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), mat);
  m.frustumCulled = false;
  m.renderOrder = -10;
  (m as unknown as { skyMat: THREE.ShaderMaterial }).skyMat = mat;
  return m;
}

export function setupEnvironment(scene: THREE.Scene): Environment {
  scene.background = new THREE.Color(0xf1c79b);
  scene.add(skyDome());
  // A little warm haze, enough to lift the far hills off the sky.
  scene.fog = new THREE.FogExp2(0xe9c2a0, 0.0032);

  const sun = new THREE.DirectionalLight(0xffd9a6, 3.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 160;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.05;
  const sc = sun.shadow.camera;
  sc.left = -40; sc.right = 40; sc.top = 40; sc.bottom = -40;
  scene.add(sun, sun.target);

  // Sky blue from above, warm ground bounce from below: the shade reads cool.
  const hemi = new THREE.HemisphereLight(0x9fb8e6, 0xb08a66, 1.15);
  scene.add(hemi);

  const offset = SUN_DIR.clone().multiplyScalar(70);
  return {
    sun, hemi,
    update(camera, time) {
      for (const c of scene.children) { const sm = (c as THREE.Mesh & { skyMat?: THREE.ShaderMaterial }).skyMat; if (sm) sm.uniforms.time!.value = time; }
      // The compound is small enough for one shadow frustum; it follows the
      // camera in steps so the shadow texels never swim.
      const p = camera.position;
      sun.target.position.set(Math.round(p.x / 4) * 4, 0, Math.round(p.z / 4) * 4);
      sun.position.copy(sun.target.position).add(offset);
      sun.target.updateMatrixWorld();
    },
  };
}
