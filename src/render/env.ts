import * as THREE from 'three';
import type { Assets } from '../app/assets';

export interface Environment {
  moon: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  update(camera: THREE.Camera): void;
}

// Overcast night sky: near-black zenith, a faint warm city glow at the
// horizon, and slow cloud motion. The HDR stays for reflections only.
function skyDome(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { time: { value: 0 } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w; }',
    fragmentShader: `varying vec3 vDir; uniform float time;
      float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
      float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y); }
      void main(){
        float y = clamp(vDir.y, -0.1, 1.0);
        vec3 zenith = vec3(0.012, 0.016, 0.03);
        vec3 horizon = vec3(0.10, 0.075, 0.07);
        vec3 col = mix(horizon, zenith, pow(smoothstep(0.0, 0.45, y), 0.6));
        vec2 uv = vDir.xz / max(0.08, vDir.y + 0.15);
        float c = n2(uv*1.6 + time*0.012) * 0.6 + n2(uv*3.7 - time*0.02) * 0.4;
        col += vec3(0.05, 0.045, 0.05) * smoothstep(0.35, 0.8, c) * smoothstep(0.0, 0.3, y);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(380, 32, 16), mat);
  m.frustumCulled = false;
  m.renderOrder = -10;
  (m as unknown as { skyMat: THREE.ShaderMaterial }).skyMat = mat;
  return m;
}

export function setupEnvironment(scene: THREE.Scene, gl: THREE.WebGLRenderer, assets: Assets): Environment {
  if (assets.hdr) {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromEquirectangular(assets.hdr).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.22;
    pmrem.dispose();
  }
  scene.background = new THREE.Color(0x05070d);
  scene.add(skyDome());
  scene.fog = new THREE.FogExp2(0x070a12, 0.016);

  const moon = new THREE.DirectionalLight(0x8fa6d6, 0.32);
  moon.position.set(-40, 60, 30);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  moon.shadow.camera.near = 1;
  moon.shadow.camera.far = 180;
  moon.shadow.bias = -0.0006;
  moon.shadow.normalBias = 0.03;
  const sc = moon.shadow.camera;
  sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45;
  scene.add(moon, moon.target);

  const hemi = new THREE.HemisphereLight(0x27344f, 0x0a0a0d, 0.28);
  scene.add(hemi);

  const offset = new THREE.Vector3(-40, 60, 30);
  return {
    moon, hemi,
    update(camera) {
      for (const c of scene.children) { const sm = (c as THREE.Mesh & { skyMat?: THREE.ShaderMaterial }).skyMat; if (sm) sm.uniforms.time!.value = performance.now() / 1000; }
      // Keep the shadow frustum centered on the player so the district stays lit.
      const p = camera.position;
      moon.target.position.set(Math.round(p.x / 4) * 4, 0, Math.round(p.z / 4) * 4);
      moon.position.copy(moon.target.position).add(offset);
      moon.target.updateMatrixWorld();
    },
  };
}
