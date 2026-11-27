import * as THREE from 'three';
import { toon } from '../render/materials';

// Low growth painted as unlined strokes, the way the valley's meadow is
// (src/world/valley.ts): tufts, wild flowers, red spider lilies, reeds and
// silver grass. Each leaf or petal is one triangle shaded from a dark foot to
// a pale tip. They write no depth, so the ink pass never outlines them and a
// field of them stays light at a distance; they draw after everything solid,
// still hidden behind whatever stands in front.

type Tone = readonly [THREE.Color, THREE.Color];
const C = (c: number): THREE.Color => new THREE.Color(c);
export const TONES = {
  tuft: [C(0x6f8e48), C(0xa9c46c)],
  dryTuft: [C(0x8d8a4c), C(0xcfc488)],
  lily: [C(0xb8322a), C(0xe8503a)],
  white: [C(0xe9e4d2), C(0xfffbef)],
  yellow: [C(0xd9b53c), C(0xf3da6a)],
  violet: [C(0x7d6aa8), C(0xb7a6d8)],
  gold: [C(0x9c8f4e), C(0xeedb96)],
  green: [C(0x76884a), C(0xcdd38c)],
  plume: [C(0xe2d6b8), C(0xfbf5e6)],
  reed: [C(0x7d8a4a), C(0xc9c27a)],
  stubble: [C(0x9a8452), C(0xe0cc8e)],
} as const satisfies Record<string, Tone>;

let shared: THREE.MeshToonMaterial | null = null;
function material(): THREE.MeshToonMaterial {
  if (shared) return shared;
  shared = toon(0xffffff, { side: THREE.DoubleSide, transparent: true });
  shared.vertexColors = true;
  shared.depthWrite = false;
  return shared;
}

export class Strokes {
  private pos: number[] = [];
  private clr: number[] = [];

  constructor(private rand: () => number, private ground: (x: number, z: number) => number) {}

  get count(): number { return this.pos.length / 9; }

  // One stroke: a triangle (nine numbers), toned by height within it.
  stroke(tone: Tone, ...v: number[]): void {
    this.pos.push(...v);
    const ys = [v[1]!, v[4]!, v[7]!], lo = Math.min(...ys), hi = Math.max(...ys);
    for (const y of ys) { const c = tone[0].clone().lerp(tone[1], hi > lo ? (y - lo) / (hi - lo) : 1); this.clr.push(c.r, c.g, c.b); }
  }

  // A low tuft: three short blades.
  tuft(x: number, z: number, h: number, tone: Tone = TONES.tuft): void {
    const y = this.ground(x, z), spin = this.rand() * 6;
    for (let i = 0; i < 3; i++) {
      const a = spin + i * 2.1, lean = 0.12 + this.rand() * 0.1, w = 0.06;
      const px = -Math.sin(a) * w, pz = Math.cos(a) * w;
      this.stroke(tone, x - px, y, z - pz, x + px, y, z + pz, x + Math.cos(a) * lean, y + h * (0.7 + this.rand() * 0.5), z + Math.sin(a) * lean);
    }
  }

  // A spider lily: a bare stem and a head of thin red petals curling up and out.
  lily(x: number, z: number, h: number): void {
    const y = this.ground(x, z) + h, spin = this.rand() * 6;
    this.stroke(TONES.tuft, x - 0.015, y - h, z, x + 0.015, y - h, z, x, y, z);
    for (let i = 0; i < 6; i++) {
      const a = spin + i * 1.05, ca = Math.cos(a), sa = Math.sin(a), w = 0.012;
      this.stroke(TONES.lily, x - sa * w, y, z + ca * w, x + sa * w, y, z - ca * w, x + ca * 0.1, y + 0.07, z + sa * 0.1);
    }
  }

  // A small wild flower on a stem: three petals.
  flower(x: number, z: number, tone: Tone, h: number, r: number): void {
    const y = this.ground(x, z) + h;
    this.stroke(TONES.tuft, x - 0.02, y - h, z, x + 0.02, y - h, z, x, y, z);
    for (let i = 0; i < 3; i++) {
      const a = this.rand() * 6 + i * 2.1;
      this.stroke(tone, x, y, z, x + Math.cos(a) * r, y + 0.03, z + Math.sin(a) * r, x + Math.cos(a + 0.9) * r, y - 0.02, z + Math.sin(a + 0.9) * r);
    }
  }

  // A clump of long leaves (silver grass), each a flat diamond, some with a plume.
  clump(x: number, z: number, tall: number, plumes = 0.4): void {
    const y = this.ground(x, z), n = 3 + Math.floor(this.rand() * 3), spin = this.rand() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const a = spin + (i / n) * Math.PI * 2 + this.rand() * 0.5, lean = 0.18 + this.rand() * 0.22, h = tall * (0.75 + this.rand() * 0.5), w = 0.13 + this.rand() * 0.06;
      const tx = x + Math.cos(a) * lean * h, tz = z + Math.sin(a) * lean * h;
      const mx = x + Math.cos(a) * lean * h * 0.45, mz = z + Math.sin(a) * lean * h * 0.45, my = y + h * 0.45;
      const px = -Math.sin(a) * w, pz = Math.cos(a) * w;
      const leaf = this.rand() < 0.55 ? TONES.gold : TONES.green;
      this.stroke(leaf, x, y, z, mx + px, my, mz + pz, tx, y + h, tz);
      this.stroke(leaf, x, y, z, tx, y + h, tz, mx - px, my, mz - pz);
      if (this.rand() < plumes) this.stroke(TONES.plume, tx - px * 0.8, y + h - 0.5, tz - pz * 0.8, tx + px * 0.8, y + h - 0.5, tz + pz * 0.8, tx + Math.cos(a) * 0.12, y + h + 0.12, tz + Math.sin(a) * 0.12);
    }
  }

  // Reeds at a waterline: thin upright blades, a few with a dark head.
  reeds(x: number, z: number, h: number, y = this.ground(x, z)): void {
    const n = 4 + Math.floor(this.rand() * 3);
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2, lean = 0.08 + this.rand() * 0.2, w = 0.035, hh = h * (0.7 + this.rand() * 0.5);
      const bx = x + Math.cos(a) * this.rand() * 0.25, bz = z + Math.sin(a) * this.rand() * 0.25;
      const tx = bx + Math.cos(a) * lean, tz = bz + Math.sin(a) * lean;
      this.stroke(TONES.reed, bx - Math.sin(a) * w, y, bz + Math.cos(a) * w, bx + Math.sin(a) * w, y, bz - Math.cos(a) * w, tx, y + hh, tz);
    }
  }

  // The strokes so far as one mesh under `parent`, drawn after everything solid.
  mesh(parent: THREE.Object3D, name: string): THREE.Mesh | null {
    if (!this.pos.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.clr, 3));
    // Lit as the ground under them is, so a blade turned from the sun is no black sliver.
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(this.pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, material());
    m.name = name;
    m.castShadow = false;
    m.receiveShadow = true;
    m.renderOrder = 2;
    m.userData.keep = true;
    parent.add(m);
    this.pos = [];
    this.clr = [];
    return m;
  }
}
