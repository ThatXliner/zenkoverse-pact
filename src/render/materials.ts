import * as THREE from 'three';
import { mangaShading } from './tone';

// The material set: a coloured manga page. Everything in the world and on the
// characters is a MeshToonMaterial painted in flat colour and screentone
// (src/render/tone.ts), and the post effect (src/render/manga.ts) draws the
// brush ink, the paper and the panel over the whole frame, the first-person
// arms included. Nothing carries its own outline: the ink comes from the
// depth buffer, so it is one hand for the world, the bodies and the arms.

export const INK = 0x14101c;
export interface ToonOptions {
  map?: THREE.Texture | null;
  emissive?: number;
  emissiveIntensity?: number;
  side?: THREE.Side;
  transparent?: boolean;
  opacity?: number;
  alphaTest?: number;
}

export function toon(color: number | THREE.Color, opts: ToonOptions = {}): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({
    color, map: opts.map ?? null,
    emissive: opts.emissive ?? 0x000000, emissiveIntensity: opts.emissiveIntensity ?? 1,
    side: opts.side ?? THREE.FrontSide, transparent: opts.transparent ?? false, opacity: opts.opacity ?? 1, alphaTest: opts.alphaTest ?? 0,
  });
  mangaShading(m);
  return m;
}

// Faceted: every face its own normal, so a cone or a sphere reads as cut
// planes under the ramp instead of a smooth gradient.
export function faceted(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const flat = geo.index ? geo.toNonIndexed() : geo;
  flat.computeVertexNormals();
  return flat;
}

// Lit surfaces (lanterns, glyphs, markings): no shading, they are the colour.
export function emissive(color: number, intensity = 4): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: intensity, roughness: 0.4, metalness: 0 });
}

// Re-skins a loaded glTF (Kenney palette props, the trees) in toon: the
// palette map stays, so each face keeps its authored flat colour.
export function toonify(root: THREE.Object3D, tint?: number): void {
  const cache = new Map<THREE.Material, THREE.MeshToonMaterial>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const src = m.material as THREE.MeshStandardMaterial;
    let t = cache.get(src);
    if (!t) {
      t = toon(tint ?? src.color?.getHex() ?? 0xffffff, { map: src.map ?? null, side: src.side, transparent: src.transparent, opacity: src.opacity, alphaTest: src.alphaTest });
      cache.set(src, t);
    }
    m.material = t;
  });
}

// A wooden board with brushed kanji. `color` is the paint; the board is the
// wood of the compound.
export function paintedSign(text: string, opts: { width?: number; vertical?: boolean; paint?: string; wood?: number; emissive?: boolean } = {}): THREE.Group {
  const vertical = opts.vertical ?? false;
  const canvas = document.createElement('canvas');
  canvas.width = vertical ? 256 : 1024;
  canvas.height = vertical ? 1024 : 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#' + new THREE.Color(opts.wood ?? 0xd8c39a).getHexString();
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = `800 ${vertical ? 170 : 180}px "Shippori Mincho B1", "Zen Kaku Gothic New", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = opts.paint ?? '#2b1d1a';
  if (vertical) {
    const chars = [...text];
    const step = canvas.height / (chars.length + 0.4);
    chars.forEach((c, i) => ctx.fillText(c, 128, step * (i + 0.7)));
  } else ctx.fillText(text, 512, 134);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const w = opts.width ?? (vertical ? 0.9 : 3.6);
  const h = vertical ? w * 4 : w / 4;
  const g = new THREE.Group();
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), opts.emissive ? new THREE.MeshBasicMaterial({ map: tex }) : toon(0xffffff, { map: tex }));
  // Just proud of the board's face (0.03), or the two fight for the same depth.
  face.position.z = 0.034;
  const board = new THREE.Mesh(new THREE.BoxGeometry(w + 0.12, h + 0.12, 0.06), toon(0x6b4a33));
  board.castShadow = true;
  g.add(board, face);
  return g;
}
