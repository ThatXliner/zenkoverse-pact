import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toon } from '../../render/materials';
import { PROPS } from '../props';

// The city's own loose things, built in code and registered with the prop
// system so the Techniques treat them like the compound's crates and
// barrels: a steel fuel drum (rings under Echo, breaks open, frost holds it),
// the plastic beer crates every bar stacks outside, and a shop's sign stand.

let registered = false;
export function registerCityProps(): void {
  if (registered) return;
  registered = true;
  PROPS.drum = { model: 'built/drum', build: () => painted(drum()), mass: 38, scale: 1, traits: ['metal', 'resonant', 'flammable', 'freezable'], breakable: { hp: 55, pieces: 7 } };
  PROPS.beerCrate = { model: 'built/beer-crate', build: () => painted(beerCrate()), mass: 4, scale: 1, traits: ['porous'], breakable: { hp: 14, pieces: 4 } };
  PROPS.signStand = { model: 'built/sign-stand', build: () => painted(signStand()), mass: 7, scale: 1, traits: ['metal', 'resonant'], breakable: { hp: 20, pieces: 3 } };
}

let drumLabel: THREE.CanvasTexture | null = null;
// The hazard label on a drum: an orange diamond with 燃 on a white square.
function label(): THREE.CanvasTexture {
  if (drumLabel) return drumLabel;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f4f1e6';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#e2672a';
  g.beginPath(); g.moveTo(64, 8); g.lineTo(120, 64); g.lineTo(64, 120); g.lineTo(8, 64); g.closePath(); g.fill();
  g.fillStyle = '#1a1416';
  g.font = '800 54px "Zen Kaku Gothic New", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('燃', 64, 68);
  drumLabel = new THREE.CanvasTexture(c);
  drumLabel.colorSpace = THREE.SRGBColorSpace;
  return drumLabel;
}

function drum(): THREE.Object3D {
  const g = new THREE.Group();
  const body = toon(0x3f5560), rib = toon(0x2f414a), lid = toon(0x56707c);
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, y: number): THREE.Mesh => { const m = new THREE.Mesh(geo, mat); m.position.y = y; g.add(m); return m; };
  add(new THREE.CylinderGeometry(0.29, 0.29, 0.88, 14), body, 0.44);
  for (const y of [0.3, 0.6]) add(new THREE.CylinderGeometry(0.305, 0.305, 0.04, 14), rib, y);
  add(new THREE.CylinderGeometry(0.3, 0.3, 0.03, 14), lid, 0.885);
  add(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 8), rib, 0.91).position.x = 0.16;
  const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26), toon(0xffffff, { map: label() }));
  tag.position.set(0, 0.46, 0.292);
  g.add(tag);
  return g;
}

function beerCrate(): THREE.Object3D {
  const g = new THREE.Group();
  const yellow = toon(0xe6b12e), dark = toon(0x9c741a);
  const add = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material): void => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); g.add(m); };
  add(0.46, 0.05, 0.36, 0, 0.025, 0, yellow);
  for (const z of [-0.17, 0.17]) add(0.46, 0.32, 0.03, 0, 0.18, z, yellow);
  for (const x of [-0.22, 0.22]) add(0.03, 0.32, 0.36, x, 0.18, 0, yellow);
  for (const z of [-0.06, 0.06]) add(0.42, 0.02, 0.02, 0, 0.32, z, dark);
  // Bottle caps showing over the rim.
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) add(0.06, 0.03, 0.06, -0.15 + i * 0.1, 0.34, -0.1 + j * 0.1, toon(0x6e4a22));
  return g;
}

function signStand(): THREE.Object3D {
  const g = new THREE.Group();
  const frame = toon(0x5b6470), board = toon(0xf1ece0), ink = toon(0x2f4a7a);
  for (const side of [-1, 1]) {
    const leg = new THREE.Group();
    leg.rotation.x = side * 0.18;
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 0.03), frame);
    b.position.set(0, 0.45, 0);
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.7, 0.01), board);
    p.position.set(0, 0.5, side * 0.02);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.08, 0.012), ink);
    stripe.position.set(0, 0.7, side * 0.022);
    leg.add(b, p, stripe);
    leg.position.z = side * 0.08;
    g.add(leg);
  }
  return g;
}

// A built prop's plain pieces folded into one mesh with their colours in
// the vertices, so a stack of crates is a draw call each and not twenty.
// Textured pieces (a drum's label) stay as they are.
function painted(root: THREE.Object3D): THREE.Object3D {
  root.updateMatrixWorld(true);
  const plain: THREE.Mesh[] = [];
  root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !(m.material as THREE.MeshToonMaterial).map) plain.push(m); });
  const geos = plain.map((m) => {
    const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(m.matrixWorld);
    g.deleteAttribute('uv');
    const c = (m.material as THREE.MeshToonMaterial).color, n = g.getAttribute('position').count;
    const cols = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    return g;
  });
  const out = new THREE.Group();
  const mat = toon(0xffffff);
  mat.vertexColors = true;
  out.add(new THREE.Mesh(mergeGeometries(geos)!, mat));
  root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && (m.material as THREE.MeshToonMaterial).map) { const c = m.clone(); c.applyMatrix4(m.parent!.matrixWorld); out.add(c); } });
  return out;
}
