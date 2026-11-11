import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export const ARENA_RADIUS = 26;

export function createWorld(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0e1c);
  scene.fog = new THREE.FogExp2(0x0d1122, 0.014);
  // A neon environment so the wet floor and metal have something to reflect.
  scene.environment = buildEnvironment(renderer);
  scene.environmentIntensity = 0.55;

  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 400);
  camera.position.set(0, 24, 18);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.7, 0.5, 0.78);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // Lighting: cool moonlight with shadows, a magenta city fill from the far side,
  // and a low warm rim so silhouettes separate from the floor.
  scene.add(new THREE.HemisphereLight(0x7f8fd0, 0x2a1a2e, 1.6));
  const moon = new THREE.DirectionalLight(0xcfdcff, 2.6);
  moon.position.set(-20, 40, 10);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  moon.shadow.bias = -0.0005;
  const s = moon.shadow.camera;
  s.left = -32; s.right = 32; s.top = 32; s.bottom = -32; s.near = 1; s.far = 100;
  scene.add(moon);
  const fill = new THREE.DirectionalLight(0xff5fa8, 0.9);
  fill.position.set(26, 18, -22);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0x5fd0ff, 1.1);
  rim.position.set(8, 6, 30);
  scene.add(rim);

  const pillars = buildArena(scene);
  buildSkyline(scene);
  const rain = buildRain(scene);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
  });

  return { renderer, scene, camera, composer, bloom, pillars, rain };
}

function buildArena(scene) {
  // Wet rooftop: low roughness so the neon smears across it.
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x2b3048, roughness: 0.28, metalness: 0.25 });
  const floor = new THREE.Mesh(new THREE.CylinderGeometry(ARENA_RADIUS + 2, ARENA_RADIUS + 3, 1.2, 72), floorMat);
  floor.position.y = -0.6;
  floor.receiveShadow = true;
  scene.add(floor);

  // Tile seams.
  const grid = new THREE.PolarGridHelper(ARENA_RADIUS + 1.5, 16, 8, 72, 0x4a5890, 0x343f6c);
  grid.position.y = 0.01;
  grid.material.transparent = true;
  grid.material.opacity = 0.6;
  scene.add(grid);

  // Glowing rim marks the edge of the rooftop.
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(ARENA_RADIUS + 1.6, 0.12, 8, 128),
    new THREE.MeshBasicMaterial({ color: 0xff3d7f }),
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.1;
  scene.add(rim);

  // Inner seal: an old academy crest painted on the roof.
  const seal = new THREE.Mesh(
    new THREE.RingGeometry(4.6, 5.0, 64),
    new THREE.MeshBasicMaterial({ color: 0x3550a8, transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
  );
  seal.rotation.x = -Math.PI / 2;
  seal.position.y = 0.02;
  scene.add(seal);

  // Puddles to sell the rain.
  const puddleMat = new THREE.MeshStandardMaterial({ color: 0x323a5c, roughness: 0.06, metalness: 0.3 });
  for (let i = 0; i < 14; i++) {
    const r = 1 + Math.random() * 2.2;
    const p = new THREE.Mesh(new THREE.CircleGeometry(r, 24), puddleMat);
    const a = Math.random() * Math.PI * 2;
    const d = 6 + Math.random() * (ARENA_RADIUS - 8);
    p.position.set(Math.cos(a) * d, 0.015, Math.sin(a) * d);
    p.rotation.x = -Math.PI / 2;
    p.scale.set(1, 0.6 + Math.random() * 0.6, 1);
    scene.add(p);
  }

  // Pillars: ventilation housings and water towers. Shift passes through them.
  const pillars = [];
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x4a5068, roughness: 0.55, metalness: 0.2 });
  const stripeMat = new THREE.MeshBasicMaterial({ color: 0x48e0ff });
  const spots = [
    [10, 0], [-10, 0], [0, 10], [0, -10],
    [17, 11], [-17, 11], [17, -11], [-17, -11],
  ];
  for (const [x, z] of spots) {
    const tall = 3 + Math.random() * 3;
    const r = 1.3 + Math.random() * 0.4;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.08, tall, 8), pillarMat);
    m.position.set(x, tall / 2, z);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    const stripe = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.02, r * 1.02, 0.12, 8), stripeMat);
    stripe.position.set(x, tall * 0.72, z);
    scene.add(stripe);
    pillars.push({ x, z, r: r + 0.1 });
  }

  // Neon signs at the edge, for colored light on the wet floor.
  const signColors = [0xff3d7f, 0x48e0ff, 0xffb347, 0x9b6bff];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const c = signColors[i];
    const sign = new THREE.Mesh(new THREE.BoxGeometry(5, 1.2, 0.2), new THREE.MeshBasicMaterial({ color: c }));
    const d = ARENA_RADIUS + 3.5;
    sign.position.set(Math.cos(a) * d, 4, Math.sin(a) * d);
    sign.lookAt(0, 4, 0);
    scene.add(sign);
    const light = new THREE.PointLight(c, 260, 34, 1.7);
    light.position.set(Math.cos(a) * (d - 2), 3, Math.sin(a) * (d - 2));
    scene.add(light);
  }
  return pillars;
}

function buildEnvironment(renderer) {
  // Tiny synthetic environment: a dark sky with neon slabs around the horizon.
  const env = new THREE.Scene();
  env.background = new THREE.Color(0x05060c);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(50, 16, 8), new THREE.MeshBasicMaterial({ color: 0x1a2240, side: THREE.BackSide }));
  env.add(sky);
  const colors = [0xff3d7f, 0x48e0ff, 0xffb347, 0x9b6bff, 0xff3d7f, 0x48e0ff];
  colors.forEach((c, i) => {
    const a = (i / colors.length) * Math.PI * 2;
    const slab = new THREE.Mesh(new THREE.PlaneGeometry(14, 4), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
    slab.position.set(Math.cos(a) * 30, 3 + (i % 2) * 3, Math.sin(a) * 30);
    slab.lookAt(0, slab.position.y, 0);
    env.add(slab);
  });
  const top = new THREE.Mesh(new THREE.CircleGeometry(12, 24), new THREE.MeshBasicMaterial({ color: 0x9fb4ff, side: THREE.DoubleSide }));
  top.position.y = 40;
  top.rotation.x = Math.PI / 2;
  env.add(top);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.04).texture;
  pmrem.dispose();
  return tex;
}

function buildSkyline(scene) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x141a2e, roughness: 0.9 });
  const count = 140;
  const bodies = new THREE.InstancedMesh(geo, bodyMat, count);
  const windows = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }), count * 3);
  const m = new THREE.Matrix4();
  const col = new THREE.Color();
  const palette = [0xffc27a, 0x7ad8ff, 0xff7ab8, 0xfff0c2];
  let w = 0;
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = 55 + Math.random() * 90;
    const h = 15 + Math.random() * 60;
    const wd = 5 + Math.random() * 9;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    m.compose(new THREE.Vector3(x, h / 2 - 25, z), new THREE.Quaternion(), new THREE.Vector3(wd, h, wd));
    bodies.setMatrixAt(i, m);
    for (let k = 0; k < 3; k++) {
      const wy = -25 + Math.random() * h;
      m.compose(
        new THREE.Vector3(x * 0.985, wy, z * 0.985),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a),
        new THREE.Vector3(0.2, 0.25 + Math.random() * 0.3, wd * (0.3 + Math.random() * 0.6)),
      );
      windows.setMatrixAt(w, m);
      col.setHex(palette[(Math.random() * palette.length) | 0]).multiplyScalar(0.5 + Math.random());
      windows.setColorAt(w, col);
      w++;
    }
  }
  scene.add(bodies, windows);
}

function buildRain(scene) {
  const count = 2600;
  const pos = new Float32Array(count * 6);
  const area = 60;
  for (let i = 0; i < count; i++) {
    const x = (Math.random() - 0.5) * area, y = Math.random() * 30, z = (Math.random() - 0.5) * area;
    pos.set([x, y, z, x - 0.08, y + 0.7, z + 0.04], i * 6);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.LineBasicMaterial({ color: 0x8aa6d6, transparent: true, opacity: 0.35 });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  scene.add(lines);
  return {
    update(dt, center) {
      const p = geo.attributes.position.array;
      for (let i = 0; i < count; i++) {
        const o = i * 6;
        let y = p[o + 1] - dt * 32;
        if (y < 0) {
          y += 30;
          const x = center.x + (Math.random() - 0.5) * area, z = center.z + (Math.random() - 0.5) * area;
          p[o] = x; p[o + 2] = z; p[o + 3] = x - 0.08; p[o + 5] = z + 0.04;
        }
        p[o + 1] = y; p[o + 4] = y + 0.7;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}
