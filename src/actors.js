import * as THREE from 'three';

const bodyGeo = new THREE.CapsuleGeometry(0.4, 0.75, 6, 14);
const headGeo = new THREE.SphereGeometry(0.3, 18, 14);
const legGeo = new THREE.CapsuleGeometry(0.13, 0.45, 4, 10);
const shoulderGeo = new THREE.SphereGeometry(0.2, 12, 10);
const bandGeo = new THREE.TorusGeometry(0.44, 0.045, 6, 24);
const ringGeo = new THREE.RingGeometry(0.72, 0.86, 40);
const visorGeo = new THREE.BoxGeometry(0.34, 0.09, 0.08);
const spikeGeo = new THREE.ConeGeometry(0.09, 0.5, 6);
const barGeo = new THREE.PlaneGeometry(1, 0.1);
const skirtGeo = new THREE.CylinderGeometry(0.42, 0.7, 0.8, 12, 1, true);
const haloGeo = new THREE.TorusGeometry(0.42, 0.03, 6, 32);
const tankGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.7, 10);

const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.25, emissive: 0x000000, ...extra });

// A stylized fighter built from primitives: legs, torso, shoulders, head, an
// emissive visor that shows facing, glow bands in the Technique's color, and
// a ground ring. `kind` picks extra silhouette pieces per enemy type.
export function buildFighter(color, { scale = 1, suit = 0x3a4160, kind = 'player', skin = 0xd8b49a } = {}) {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  inner.scale.setScalar(scale);
  g.add(inner);

  const suitMat = std(suit);
  const trimMat = std(0xb9c3e6, { roughness: 0.35, metalness: 0.45 });
  const glowMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.7, roughness: 0.4 });
  const skinMat = std(skin, { roughness: 0.65, metalness: 0 });
  const hairMat = std(0x14141c, { roughness: 0.8, metalness: 0 });
  const mats = [suitMat, trimMat, skinMat, hairMat];
  const add = (mesh, x, y, z) => { mesh.position.set(x, y, z); mesh.castShadow = true; inner.add(mesh); return mesh; };

  for (const sx of [-0.17, 0.17]) add(new THREE.Mesh(legGeo, suitMat), sx, 0.38, 0);
  const body = add(new THREE.Mesh(bodyGeo, suitMat), 0, 1.05, 0);
  for (const sx of [-0.42, 0.42]) add(new THREE.Mesh(shoulderGeo, trimMat), sx, 1.42, 0);
  const head = add(new THREE.Mesh(headGeo, skinMat), 0, 1.92, 0);
  const hair = add(new THREE.Mesh(new THREE.SphereGeometry(0.33, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat), 0, 1.96, -0.03);
  hair.rotation.x = -0.3;
  add(new THREE.Mesh(visorGeo, glowMat), 0, 1.9, 0.27);

  for (const y of [0.78, 1.3]) {
    const band = add(new THREE.Mesh(bandGeo, glowMat), 0, y, 0);
    band.rotation.x = Math.PI / 2;
  }

  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;
  inner.add(ring);

  const orbiters = [];
  switch (kind) {
    case 'player': {
      // A long coat and a bright sash: the protagonist reads lighter than everyone else.
      const coatMat = std(0x5a6389, { roughness: 0.6 });
      mats.push(coatMat);
      const skirt = add(new THREE.Mesh(skirtGeo, coatMat), 0, 0.55, 0);
      skirt.material.side = THREE.DoubleSide;
      const sash = add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 0.06), glowMat), -0.18, 1.1, 0.4);
      sash.rotation.z = 0.35;
      break;
    }
    case 'bristle':
      for (const sx of [-0.45, 0.45]) for (const k of [0, 1]) {
        const s = add(new THREE.Mesh(spikeGeo, trimMat), sx, 1.55 + k * 0.12, -0.1 + k * 0.18);
        s.rotation.z = -sx * 1.2;
      }
      break;
    case 'quill': {
      const quiver = add(new THREE.Mesh(tankGeo, trimMat), 0.2, 1.25, -0.42);
      quiver.rotation.z = 0.4;
      for (let i = 0; i < 4; i++) add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.9, 4), glowMat), 0.1 + i * 0.08, 1.7, -0.45).rotation.z = 0.4;
      break;
    }
    case 'soot': {
      const hood = add(new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.9, 10, 1, true), suitMat), 0, 2.05, -0.02);
      hood.material.side = THREE.DoubleSide;
      hair.visible = false;
      break;
    }
    case 'husk':
      add(new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), trimMat), -0.55, 1.45, 0);
      add(new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), trimMat), 0.55, 1.45, 0);
      break;
    case 'spring':
      for (const sx of [-0.17, 0.17]) {
        const coil = add(new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.035, 6, 14), glowMat), sx, 0.18, 0);
        coil.rotation.x = Math.PI / 2;
      }
      break;
    case 'architect': {
      const halo = add(new THREE.Mesh(haloGeo, glowMat), 0, 2.5, 0);
      halo.rotation.x = Math.PI / 2;
      orbiters.push({ mesh: halo, r: 0, speed: 1.2, y: 2.5, spin: true });
      break;
    }
    case 'kuroda': {
      for (const sx of [-0.5, 0.5]) add(new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.18, 0.4), trimMat), sx, 1.5, 0);
      add(new THREE.Mesh(tankGeo, trimMat), -0.22, 1.2, -0.45);
      add(new THREE.Mesh(tankGeo, trimMat), 0.22, 1.2, -0.45);
      const crest = add(new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.5, 6), glowMat), 0, 2.45, 0);
      crest.rotation.x = 0.1;
      break;
    }
    case 'ancient': {
      const robeMat = std(0x1f3a33, { roughness: 0.7 });
      mats.push(robeMat);
      const robe = add(new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.95, 1.4, 14, 1, true), robeMat), 0, 0.7, 0);
      robe.material.side = THREE.DoubleSide;
      hairMat.color.setHex(0xe8e6dc);
      for (let i = 0; i < 3; i++) {
        const orb = add(new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.02, 6, 20), glowMat), 0, 1.6, 0);
        orbiters.push({ mesh: orb, r: 1.1, speed: 1.4 + i * 0.3, phase: (i / 3) * Math.PI * 2, y: 1.2 + i * 0.4 });
      }
      break;
    }
  }

  return { group: g, inner, body, head, ring, glowMat, suitMat, mats, orbiters };
}

export function animateFighter(f, time) {
  for (const o of f.orbiters) {
    if (o.spin) { o.mesh.rotation.z = time * o.speed; continue; }
    const a = time * o.speed + o.phase;
    o.mesh.position.set(Math.cos(a) * o.r, o.y + Math.sin(a * 2) * 0.1, Math.sin(a) * o.r);
    o.mesh.rotation.set(a, a * 0.7, 0);
  }
}

export function setFlash(fighter, amount) {
  const c = amount > 0 ? new THREE.Color(1, 1, 1).multiplyScalar(amount) : new THREE.Color(0, 0, 0);
  for (const m of fighter.mats) m.emissive.copy(c);
}

export function setOpacity(fighter, o) {
  fighter.group.traverse((ch) => {
    if (!ch.material) return;
    ch.material.transparent = o < 1 || ch.material.transparent;
    if (ch.userData.baseOpacity === undefined) ch.userData.baseOpacity = ch.material.opacity;
    ch.material.opacity = ch.userData.baseOpacity * o;
    ch.castShadow = o > 0.5;
  });
}

export class HealthBar {
  constructor(parent, width = 1.4, y = 2.6) {
    this.width = width;
    this.root = new THREE.Group();
    this.root.position.y = y;
    const bg = new THREE.Mesh(barGeo, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6, depthTest: false }));
    bg.scale.x = width;
    this.fill = new THREE.Mesh(barGeo, new THREE.MeshBasicMaterial({ color: 0xff4d5e, depthTest: false }));
    this.fill.position.z = 0.001;
    this.root.add(bg, this.fill);
    this.root.renderOrder = 10;
    bg.renderOrder = 10;
    this.fill.renderOrder = 11;
    parent.add(this.root);
    this.set(1);
  }

  set(f) {
    f = Math.max(0, Math.min(1, f));
    this.fill.scale.x = this.width * f;
    this.fill.position.x = -(this.width * (1 - f)) / 2;
    this.root.visible = f < 0.999;
  }

  face(camera) { this.root.quaternion.copy(camera.quaternion); }
}

// Fresnel shell used for Aura Expansion fields.
export function buildAuraShell(color) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, strength: { value: 1 }, time: { value: 0 } },
    vertexShader: `
      varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      uniform vec3 color; uniform float strength; uniform float time;
      varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main() {
        float f = pow(1.0 - abs(dot(vN, vV)), 3.0);
        float bands = 0.5 + 0.5 * sin(vW.y * 6.0 - time * 4.0 + length(vW.xz) * 1.5);
        float edge = smoothstep(0.0, 0.6, vW.y) ;
        gl_FragColor = vec4(color, (f * 0.32 + bands * 0.025) * strength * (0.4 + 0.6 * edge));
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), mat);
  m.visible = false;
  return m;
}
