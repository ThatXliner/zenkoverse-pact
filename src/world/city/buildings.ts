import * as THREE from 'three';
import { toon } from '../../render/materials';
import { kawara } from '../textures';
import type { CityKit, PieceOpts } from './kit';
import { rng } from './kit';
import type { SignAtlas } from './signs';
import { BUILDINGS, BACKDROP, CATWALK, type Building, type Face, type Rect } from './plan';

// Builds every building in the plan from its kind: the mass and its
// collider, windows on every face that is not against a neighbour, a shop's
// front, a house's tiled gable, balconies on flats, the roof and what stands
// on it. Each building (or each row of houses) is one cut-away group.

export const INK = {
  frame: 0x3a3640, glass: 0x8ea7b8, glassWarm: 0xf0d9a6, glassDark: 0x4e5a66, sill: 0xd8d2c4, band: 0x6c6a70,
  roof: 0xb4ab9c, roofDark: 0x8d8579, parapet: 0xcfc6b5, steel: 0x5b6470, steelLight: 0x8a949e, ac: 0xe6e3da, acDark: 0x9a9890,
  wood: 0x7a4b34, woodDark: 0x4e3024, woodLight: 0xc49a66, shutter: 0xa7aba9, interior: 0xf3d7a0, interiorShade: 0x6a5340,
  tile: 0x55688a, tileEdge: 0x33425a, plaster: 0xf3e9d8, black: 0x2a2528, tank: 0x9fb0b4,
} as const;

const STOREY = 3.0;
// The widest gap between two walkable roofs a running jump is meant to clear.
const JUMP_GAP = 3.0;
const GROUND = 3.4;

export interface BuiltRoof { id: string; rect: Rect; y: number; walk: boolean }

export function buildBuildings(k: CityKit, signs: SignAtlas): BuiltRoof[] {
  const roofs: BuiltRoof[] = [];
  const tileMat = toon(0xffffff, { map: kawara(INK.tile, 0x7f92b0, INK.tileEdge) });
  const r = rng(7);
  for (const b of BUILDINGS) {
    const group = k.group(b.group ?? b.id);
    if (b.kind === 'house') house(k, b, group, tileMat, r);
    else if (b.kind === 'sento') sento(k, b, group, tileMat, signs);
    else block(k, b, group, signs, r);
    roofs.push({ id: b.id, rect: b, y: b.h, walk: !!b.walk });
  }
  for (const [i, d] of BACKDROP.entries()) backdrop(k, d, i, r);
  return roofs;
}

// ------------------------------------------------------------ faces
// A face's frame: where it starts, the direction along it, its outward normal.
interface Frame { ox: number; oz: number; ux: number; uz: number; nx: number; nz: number; len: number }
function frame(b: Rect, f: Face): Frame {
  switch (f) {
    case 's': return { ox: b.x0, oz: b.z1, ux: 1, uz: 0, nx: 0, nz: 1, len: b.x1 - b.x0 };
    case 'n': return { ox: b.x1, oz: b.z0, ux: -1, uz: 0, nx: 0, nz: -1, len: b.x1 - b.x0 };
    case 'e': return { ox: b.x1, oz: b.z1, ux: 0, uz: -1, nx: 1, nz: 0, len: b.z1 - b.z0 };
    case 'w': return { ox: b.x0, oz: b.z0, ux: 0, uz: 1, nx: -1, nz: 0, len: b.z1 - b.z0 };
  }
}
const FACES: Face[] = ['n', 's', 'e', 'w'];

// A box laid on a face: `t` along it, `y` up, `off` out from it (the box's
// centre); `w` along the face, `h` tall, `d` deep.
function onFace(k: CityKit, fr: Frame, mat: THREE.Material | number, t: number, y: number, off: number, w: number, h: number, d: number, o: PieceOpts = {}): THREE.Mesh {
  const x = fr.ox + fr.ux * t + fr.nx * off, z = fr.oz + fr.uz * t + fr.nz * off;
  const alongX = fr.ux !== 0;
  return k.box(mat, x, y, z, alongX ? w : d, h, alongX ? d : w, { collide: false, ...o });
}

// The stretches of a face that stand against another building (within 0.6 m),
// as [from, to] along the face. Nothing is drawn on them.
function blocked(b: Building, f: Face): [number, number][] {
  const fr = frame(b, f);
  const out: [number, number][] = [];
  for (const o of BUILDINGS) {
    if (o === b) continue;
    let touch = false, a0 = 0, a1 = 0;
    if (f === 's' || f === 'n') {
      const edge = f === 's' ? b.z1 : b.z0;
      const other = f === 's' ? o.z0 : o.z1;
      touch = Math.abs(edge - other) < 0.6 && o.x1 > b.x0 && o.x0 < b.x1;
      a0 = Math.max(b.x0, o.x0); a1 = Math.min(b.x1, o.x1);
    } else {
      const edge = f === 'e' ? b.x1 : b.x0;
      const other = f === 'e' ? o.x0 : o.x1;
      touch = Math.abs(edge - other) < 0.6 && o.z1 > b.z0 && o.z0 < b.z1;
      a0 = Math.max(b.z0, o.z0); a1 = Math.min(b.z1, o.z1);
    }
    if (!touch) continue;
    out.push(along(fr, a0, a1));
  }
  return out;
}
// A world span along a face's axis as a span of along-face distance.
function along(fr: Frame, a0: number, a1: number): [number, number] {
  const o = fr.ux ? fr.ox : fr.oz, sgn = fr.ux || fr.uz;
  const t0 = (a0 - o) * sgn, t1 = (a1 - o) * sgn;
  return [Math.min(t0, t1), Math.max(t0, t1)];
}
const freeAt = (spans: [number, number][], t: number, half: number): boolean => spans.every(([a, b]) => t + half < a - 0.2 || t - half > b + 0.2);

// ------------------------------------------------------------ blocks
// Shops, flats and offices: a plastered box with a plinth, a band at each
// floor, a cornice; windows on every free face; the roof and its parapet.
function block(k: CityKit, b: Building, group: string, signs: SignAtlas, r: () => number): void {
  const o = { group };
  const { x0, x1, z0, z1, h } = b;
  const shade = new THREE.Color(b.color).multiplyScalar(0.82).getHex();
  k.span(b.color, x0, x1, 0, h, z0, z1, { ...o, surface: 'stone' });
  k.span(INK.band, x0 - 0.04, x1 + 0.04, 0, 0.45, z0 - 0.04, z1 + 0.04, { ...o, collide: false });
  // Cornice, a little proud all round.
  k.span(shade, x0 - 0.12, x1 + 0.12, h - 0.3, h, z0 - 0.12, z1 + 0.12, { ...o, collide: false });
  const storeys = Math.max(1, Math.floor((h - GROUND - 0.4) / STOREY) + 1);
  for (const f of FACES) {
    const fr = frame(b, f);
    const spans = blocked(b, f);
    // Floor bands.
    for (let s = 1; s < storeys; s++) {
      const y = GROUND + (s - 1) * STOREY;
      if (freeAt(spans, fr.len / 2, fr.len / 2 - 0.3)) onFace(k, fr, shade, fr.len / 2, y, 0.05, fr.len + 0.08, 0.14, 0.1, o);
    }
    const front = f === b.front;
    if (front && b.kind === 'shop') shopFront(k, b, fr, signs, o, r);
    else if (front && b.kind === 'flats') { balconies(k, b, fr, storeys, o, r); continue; }
    windows(k, b, fr, spans, storeys, front, o, r);
  }
  roof(k, b, o, r);
  if (b.sign && b.kind === 'office') officeSign(k, b, signs, o);
}

function windows(k: CityKit, b: Building, fr: Frame, spans: [number, number][], storeys: number, front: boolean, o: PieceOpts, r: () => number): void {
  const ribbon = b.kind === 'office';
  const pitch = ribbon ? 1.6 : 2.7;
  const n = Math.floor((fr.len - 1.2) / pitch);
  if (n < 1) return;
  const start = (fr.len - (n - 1) * pitch) / 2;
  // Shops keep their ground floor for the shopfront; the arcade covers the
  // lower floors' street face up to its spring, so windows start above it.
  const first = b.kind === 'shop' || (b.kind === 'office' && front) ? 1 : 0;
  for (let s = first; s < storeys; s++) {
    const base = s === 0 ? 0 : GROUND + (s - 1) * STOREY;
    const y = base + (s === 0 ? 1.7 : 1.55);
    if (y + 0.9 > b.h - 0.35) continue;
    if (ribbon) {
      // One long band of glass per floor with thin mullions.
      if (!freeAt(spans, fr.len / 2, fr.len / 2 - 0.6)) continue;
      onFace(k, fr, INK.frame, fr.len / 2, y, 0.04, fr.len - 1.2, 1.5, 0.08, o);
      onFace(k, fr, INK.glass, fr.len / 2, y, 0.07, fr.len - 1.4, 1.32, 0.06, o);
      for (let i = 0; i < n; i++) onFace(k, fr, INK.frame, start + i * pitch, y, 0.11, 0.07, 1.32, 0.05, o);
      onFace(k, fr, INK.sill, fr.len / 2, y - 0.82, 0.08, fr.len - 1.0, 0.1, 0.14, o);
      continue;
    }
    for (let i = 0; i < n; i++) {
      const t = start + i * pitch;
      if (!freeAt(spans, t, 0.8)) continue;
      const warm = r() < 0.16;
      const dark = !warm && r() < 0.2;
      onFace(k, fr, INK.frame, t, y, 0.04, 1.36, 1.46, 0.08, o);
      onFace(k, fr, warm ? INK.glassWarm : dark ? INK.glassDark : INK.glass, t, y, 0.07, 1.18, 1.28, 0.06, o);
      onFace(k, fr, INK.sill, t, y - 0.78, 0.1, 1.5, 0.09, 0.18, o);
      // An outdoor unit under some windows on the side faces.
      if (!front && s > 0 && r() < 0.18) {
        onFace(k, fr, INK.ac, t + 0.2, y - 1.2, 0.2, 0.8, 0.55, 0.34, o);
        onFace(k, fr, INK.acDark, t + 0.2, y - 1.2, 0.38, 0.5, 0.42, 0.02, o);
      }
    }
  }
}

// Balconies across the street face of a block of flats: a slab, a solid
// parapet, a partition between each flat, the sliding doors behind, an
// outdoor unit on the floor and, here and there, washing on a pole.
function balconies(k: CityKit, b: Building, fr: Frame, storeys: number, o: PieceOpts, r: () => number): void {
  const bay = 3.4;
  const n = Math.max(1, Math.floor((fr.len - 0.8) / bay));
  const start = (fr.len - n * bay) / 2;
  const wash = [0xe8e4da, 0x8fb0c8, 0xd9a040, 0xc06a5a, 0xf1ece0, 0x6f8a6a];
  // The ground floor: a lobby door and a row of windows.
  onFace(k, fr, INK.frame, fr.len / 2, 1.2, 0.05, 2.0, 2.4, 0.1, o);
  onFace(k, fr, INK.glassDark, fr.len / 2, 1.2, 0.09, 1.8, 2.2, 0.06, o);
  onFace(k, fr, INK.band, fr.len / 2, 2.55, 0.5, 3.0, 0.14, 1.0, o);
  for (let s = 1; s < storeys; s++) {
    const y = GROUND + (s - 1) * STOREY;
    if (y + 2.4 > b.h) break;
    onFace(k, fr, INK.parapet, fr.len / 2, y + 0.06, 0.6, fr.len - 0.4, 0.14, 1.2, o);
    onFace(k, fr, INK.parapet, fr.len / 2, y + 0.62, 1.16, fr.len - 0.4, 1.0, 0.1, o);
    onFace(k, fr, INK.band, fr.len / 2, y + 1.14, 1.18, fr.len - 0.36, 0.06, 0.14, o);
    for (let i = 0; i <= n; i++) onFace(k, fr, INK.parapet, start + i * bay, y + 1.2, 0.62, 0.1, 2.2, 1.12, o);
    for (let i = 0; i < n; i++) {
      const t = start + bay * (i + 0.5);
      onFace(k, fr, INK.frame, t, y + 1.25, 0.04, 2.3, 2.1, 0.08, o);
      onFace(k, fr, r() < 0.2 ? INK.glassWarm : INK.glass, t, y + 1.25, 0.07, 2.1, 1.96, 0.06, o);
      onFace(k, fr, INK.ac, t + 0.95, y + 0.45, 0.45, 0.72, 0.52, 0.3, o);
      if (r() < 0.45) {
        onFace(k, fr, INK.steelLight, t, y + 2.05, 0.75, 2.6, 0.04, 0.04, o);
        const c = wash[Math.floor(r() * wash.length)]!, c2 = wash[Math.floor(r() * wash.length)]!;
        onFace(k, fr, c, t - 0.6, y + 1.72, 0.75, 0.55, 0.62, 0.03, o);
        onFace(k, fr, c2, t + 0.2, y + 1.62, 0.75, 0.7, 0.8, 0.03, o);
      }
    }
  }
}

// A shop's front on the ground floor: the lit bay with its goods, the
// rolled shutter's box over it, an awning, the name board over the awning,
// and a blade sign hung out from the corner so it reads down the street.
function shopFront(k: CityKit, b: Building, fr: Frame, signs: SignAtlas, o: PieceOpts, r: () => number): void {
  const len = fr.len;
  const bayW = len - 1.0, mid = len / 2;
  // Ground-level pieces stay in the static bake, so a shop's front stays
  // drawn while the floors above fade for the top-down camera.
  const s: PieceOpts = {};
  onFace(k, fr, INK.interiorShade, mid, 1.55, 0.02, bayW, 3.1, 0.04, s);
  const lit = toonGlow(k);
  onFace(k, fr, lit, mid, 1.75, 0.05, bayW - 0.3, 2.6, 0.02, s);
  goods(k, fr, b.goods ?? 'food', mid, bayW, r);
  // Pillars at the bay's sides and the shutter box over it.
  for (const t of [0.25, len - 0.25]) onFace(k, fr, INK.frame, t, 1.7, 0.1, 0.5, 3.4, 0.2, s);
  onFace(k, fr, INK.shutter, mid, 3.3, 0.2, bayW + 0.2, 0.36, 0.4, s);
  // The awning: a sloped sheet with a hanging valance.
  if (b.awning !== undefined) {
    const tilt = 0.38;
    const reach = 1.25;
    const ax = fr.ox + fr.ux * mid + fr.nx * (0.25 + Math.cos(tilt) * reach / 2), az = fr.oz + fr.uz * mid + fr.nz * (0.25 + Math.cos(tilt) * reach / 2);
    const alongX = fr.ux !== 0;
    const rot: [number, number, number] = alongX ? [fr.nz * tilt, 0, 0] : [0, 0, -fr.nx * tilt];
    k.box(b.awning, ax, 3.1 - Math.sin(tilt) * reach / 2, az, alongX ? bayW : reach, 0.06, alongX ? reach : bayW, { rot, collide: false });
    onFace(k, fr, b.awning, mid, 2.56, 0.25 + Math.cos(tilt) * reach, bayW, 0.3, 0.04, s);
    onFace(k, fr, INK.plaster, mid, 2.48, 0.27 + Math.cos(tilt) * reach, bayW, 0.04, 0.02, s);
  }
  // The name board over the awning, painted on the facade.
  if (b.sign) {
    const vertical = b.signStyle === 'v';
    const paper = b.awning === undefined ? '#f3ead8' : '#' + new THREE.Color(b.awning).getHexString();
    const dark = b.awning !== undefined && new THREE.Color(b.awning).getHSL({ h: 0, s: 0, l: 0 }).l < 0.5;
    const style = { paper: dark ? paper : '#f4ecd9', ink: dark ? '#f6eedc' : '#2b1d1a', font: (r() < 0.5 ? 'mincho' : 'gothic') as 'mincho' | 'gothic', rule: true };
    if (vertical) {
      const h = Math.min(b.h - 4.2, 4.6);
      const t = len - 0.9;
      signBoard(k, signs, fr, b.sign, t, 3.9 + h / 2, 0.12, 0.9, h, style, o, true);
    } else {
      const w = Math.min(bayW, Math.max(2.4, [...b.sign].length * 0.8));
      signBoard(k, signs, fr, b.sign, mid, 4.05, 0.12, w, 0.8, style, s, false);
    }
  }
  // A blade sign hung out from the corner, lit, read along the street.
  if (b.blade) {
    const t = 0.55, h = 2.2;
    const style = { paper: '#f6efe0', ink: b.awning ? '#' + new THREE.Color(b.awning).getHexString() : '#2b1d1a', font: 'gothic' as const, rule: true };
    const x = fr.ox + fr.ux * t + fr.nx * 0.75, z = fr.oz + fr.uz * t + fr.nz * 0.75;
    const alongX = fr.ux !== 0;
    k.box(INK.frame, x, 4.0, z, alongX ? 0.14 : 1.2, h + 0.16, alongX ? 1.2 : 0.14, { collide: false });
    for (const side of [-1, 1]) {
      const face = k.mesh(signs.face(b.blade, 1.0, h, style), signs.lit, x + (alongX ? side * 0.075 : 0), 4.0, z + (alongX ? 0 : side * 0.075), { shadow: false });
      face.rotation.y = alongX ? (side > 0 ? Math.PI / 2 : -Math.PI / 2) : (side > 0 ? 0 : Math.PI);
    }
    onFace(k, fr, INK.steel, t, 5.05, 0.4, 0.06, 0.06, 0.8, s);
  }
}

// A board on a face with its lettering on the outside, its plank behind it.
function signBoard(k: CityKit, signs: SignAtlas, fr: Frame, text: string, t: number, y: number, off: number, w: number, h: number, style: Parameters<SignAtlas['face']>[3], o: PieceOpts, lit: boolean): void {
  onFace(k, fr, INK.frame, t, y, off - 0.03, w + 0.16, h + 0.16, 0.08, o);
  const x = fr.ox + fr.ux * t + fr.nx * (off + 0.015), z = fr.oz + fr.uz * t + fr.nz * (off + 0.015);
  const face = k.mesh(signs.face(text, w, h, style), lit ? signs.lit : signs.plain, x, y, z, { ...o, shadow: false });
  face.rotation.y = Math.atan2(fr.nx, fr.nz);
}

const glowMats = new WeakMap<CityKit, THREE.MeshToonMaterial>();
// A shop's lit interior: warm, a little self-lit, so the bay glows in the shade of the arcade.
function toonGlow(k: CityKit): THREE.MeshToonMaterial {
  let m = glowMats.get(k);
  if (!m) { m = toon(INK.interior, { emissive: 0xffc070, emissiveIntensity: 0.32 }); glowMats.set(k, m); }
  return m;
}

// What a shop shows in its bay, built of small boxes in front of the lit back.
function goods(k: CityKit, fr: Frame, kind: NonNullable<Building['goods']>, mid: number, w: number, r: () => number): void {
  const s: PieceOpts = { shadow: false };
  const shelf = (y: number) => onFace(k, fr, INK.woodDark, mid, y, 0.25, w - 0.5, 0.05, 0.4, s);
  switch (kind) {
    case 'books':
      for (const y of [0.5, 1.15, 1.8, 2.45]) {
        shelf(y);
        for (let t = mid - w / 2 + 0.4; t < mid + w / 2 - 0.4; t += 0.09 + r() * 0.05) onFace(k, fr, [0x8a3b2e, 0x2f4a7a, 0xd9c79e, 0x3f6a4a, 0x6e4a32][Math.floor(r() * 5)]!, t, y + 0.17, 0.25, 0.07, 0.28 + r() * 0.08, 0.3, s);
      }
      // A cart of bargain books out front.
      onFace(k, fr, INK.wood, mid - w / 4, 0.4, 0.85, 1.4, 0.8, 0.6, { collide: true });
      onFace(k, fr, 0xd9c79e, mid - w / 4, 0.85, 0.85, 1.3, 0.1, 0.5, s);
      break;
    case 'bottles':
      for (const y of [0.6, 1.3, 2.0]) {
        shelf(y);
        for (let t = mid - w / 2 + 0.4; t < mid + w / 2 - 0.4; t += 0.22) onFace(k, fr, [0x3f6a4a, 0x8a5a2a, 0xe8e2d0, 0x2f4a7a][Math.floor(r() * 4)]!, t, y + 0.2, 0.25, 0.1, 0.36, 0.1, s);
      }
      break;
    case 'food':
      // A counter across the bay and a steamer on it.
      onFace(k, fr, INK.woodLight, mid, 0.5, 0.45, w - 0.4, 1.0, 0.5, { collide: true });
      onFace(k, fr, INK.woodDark, mid, 1.03, 0.45, w - 0.3, 0.06, 0.6, s);
      for (let t = mid - w / 2 + 0.8; t < mid + w / 2 - 0.6; t += 1.1) onFace(k, fr, [0xe8e2d0, 0xc8463a, 0xd9a040][Math.floor(r() * 3)]!, t, 1.2, 0.45, 0.5, 0.3, 0.4, s);
      // A noren across the top of the bay: cloth panels with gaps.
      for (let t = mid - w / 2 + 0.4; t < mid + w / 2 - 0.3; t += 0.62) onFace(k, fr, 0x2f4a7a, t + 0.28, 2.7, 0.3, 0.52, 0.9, 0.02, s);
      break;
    case 'flowers':
      for (let t = mid - w / 2 + 0.5; t < mid + w / 2 - 0.4; t += 0.7) {
        onFace(k, fr, INK.steelLight, t, 0.3, 0.7, 0.4, 0.6, 0.4, s);
        onFace(k, fr, 0x5f8a5a, t, 0.66, 0.7, 0.42, 0.14, 0.42, s);
        // A bunch: a few round heads of one colour over the leaves.
        const c = [0xe86a6a, 0xf0d060, 0xf1ece0, 0xb070c0, 0xf09a50][Math.floor(r() * 5)]!;
        const x = fr.ox + fr.ux * t + fr.nx * 0.7, z = fr.oz + fr.uz * t + fr.nz * 0.7;
        for (let j = 0; j < 4; j++) k.mesh(new THREE.IcosahedronGeometry(0.11, 0), c, x + Math.cos(j * 1.7) * 0.12, 0.84 + (j % 2) * 0.08, z + Math.sin(j * 1.7) * 0.12, { shadow: false });
      }
      break;
    case 'cloth':
      for (let t = mid - w / 2 + 0.5; t < mid + w / 2 - 0.4; t += 0.5) onFace(k, fr, [0x2f4a7a, 0xe8e2d0, 0x8a3b2e, 0x3d3a44][Math.floor(r() * 4)]!, t, 1.6, 0.3, 0.42, 1.2, 0.08, s);
      onFace(k, fr, INK.steelLight, mid, 2.25, 0.3, w - 0.6, 0.05, 0.05, s);
      break;
    case 'tools':
      for (const y of [0.7, 1.5]) { shelf(y); for (let t = mid - w / 2 + 0.5; t < mid + w / 2 - 0.4; t += 0.35) onFace(k, fr, [0x5b6470, 0x8a4b33, 0xd9a040, 0x3f6a4a][Math.floor(r() * 4)]!, t, y + 0.18, 0.25, 0.25, 0.3, 0.3, s); }
      for (let t = mid - w / 2 + 0.6; t < mid + w / 2 - 0.6; t += 0.9) onFace(k, fr, INK.steel, t, 2.3, 0.25, 0.08, 0.6, 0.08, s);
      break;
    case 'dark':
      // An office or a pawnbroker: frosted glass to waist height, blinds above.
      onFace(k, fr, INK.glassDark, mid, 1.75, 0.07, w - 0.3, 2.6, 0.02, s);
      onFace(k, fr, 0xdfe2df, mid, 0.8, 0.09, w - 0.3, 0.9, 0.02, s);
      for (let y = 1.4; y < 3.0; y += 0.16) onFace(k, fr, 0xb9bcb8, mid, y, 0.1, w - 0.35, 0.05, 0.02, s);
      onFace(k, fr, INK.frame, mid + w / 2 - 0.8, 1.1, 0.12, 0.9, 2.2, 0.04, s);
      break;
  }
}

// The roof: a concrete deck inside a parapet, and the things that stand on a
// city roof: outdoor units, a water tank, a stair house. A walkable roof
// drops its parapet where it meets another walkable roof, faces one across a
// gap a running jump clears, or the catwalk lands, so a run carries on across.
function roof(k: CityKit, b: Building, o: PieceOpts, r: () => number): void {
  const { x0, x1, z0, z1, h } = b;
  // Roofs are waterproofed in a few paints (grey, the city's pale green, a
  // slate blue), so from above one roof reads apart from the next.
  const paint = ROOF_PAINTS[[...b.id].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) % ROOF_PAINTS.length]!;
  k.span(paint, x0 + 0.2, x1 - 0.2, h, h + 0.04, z0 + 0.2, z1 - 0.2, { ...o, collide: false, shadow: false });
  const walkers = BUILDINGS.filter((n) => n !== b && n.walk && b.walk);
  const gaps = (f: Face): [number, number][] => {
    const out: [number, number][] = [];
    for (const n of walkers) {
      // Touching, or across a gap a running jump clears.
      const near = (d: number): boolean => d > -0.6 && d < JUMP_GAP;
      if (f === 'n' && near(z0 - n.z1) && n.x1 > x0 && n.x0 < x1) out.push([Math.max(x0, n.x0), Math.min(x1, n.x1)]);
      if (f === 's' && near(n.z0 - z1) && n.x1 > x0 && n.x0 < x1) out.push([Math.max(x0, n.x0), Math.min(x1, n.x1)]);
      if (f === 'e' && near(n.x0 - x1) && n.z1 > z0 && n.z0 < z1) out.push([Math.max(z0, n.z0), Math.min(z1, n.z1)]);
      if (f === 'w' && near(x0 - n.x1) && n.z1 > z0 && n.z0 < z1) out.push([Math.max(z0, n.z0), Math.min(z1, n.z1)]);
    }
    // The catwalk lands on the two rows' facing edges.
    if (b.walk && ((f === 'e' && x1 === -4) || (f === 'w' && x0 === 4)) && z0 <= CATWALK.z0 && z1 >= CATWALK.z1) out.push([CATWALK.z0 - 0.1, CATWALK.z1 + 0.1]);
    for (const extra of ROOF_GAPS[b.id] ?? []) if (extra.f === f) out.push([extra.a, extra.b]);
    return out;
  };
  const ph = 0.6, t = 0.22;
  const run = (f: Face, a: number, bnd: number): void => {
    if (bnd - a < 0.05) return;
    if (f === 'n' || f === 's') { const z = f === 'n' ? z0 + t / 2 : z1 - t / 2; k.span(INK.parapet, a, bnd, h, h + ph, z - t / 2, z + t / 2, o); k.span(INK.roofDark, a, bnd, h + ph, h + ph + 0.06, z - t / 2 - 0.03, z + t / 2 + 0.03, { ...o, collide: false }); }
    else { const x = f === 'w' ? x0 + t / 2 : x1 - t / 2; k.span(INK.parapet, x - t / 2, x + t / 2, h, h + ph, a, bnd, o); k.span(INK.roofDark, x - t / 2 - 0.03, x + t / 2 + 0.03, h + ph, h + ph + 0.06, a, bnd, { ...o, collide: false }); }
  };
  for (const f of FACES) {
    const [lo, hi] = f === 'n' || f === 's' ? [x0, x1] : [z0, z1];
    const cuts = gaps(f).sort((p, q) => p[0] - q[0]);
    let at = lo;
    for (const [a, bnd] of cuts) { run(f, at, Math.max(at, a)); at = Math.max(at, bnd); }
    run(f, at, hi);
  }
  // What stands on the roof. Walkable roofs keep their middle clear for a
  // fight and put the units along an edge, where they are cover.
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
  const unit = (x: number, z: number, rotY = 0): void => {
    k.box(INK.ac, x, h + 0.36, z, 0.9, 0.68, 0.42, { ...o, rot: [0, rotY, 0] });
    k.box(INK.acDark, x + Math.sin(rotY) * 0.22, h + 0.38, z + Math.cos(rotY) * 0.22, 0.5, 0.5, 0.02, { ...o, rot: [0, rotY, 0], collide: false });
  };
  const back = b.front === 'e' ? x0 + 1.0 : b.front === 'w' ? x1 - 1.0 : cx;
  // A television aerial on most roofs: a mast and its crossed elements.
  if (r() < 0.7) {
    const ax = back, az = z1 - 0.8;
    k.box(INK.steel, ax, h + 1.2, az, 0.05, 2.4, 0.05, { ...o, collide: false });
    for (const [y, w] of [[2.2, 1.2], [1.9, 0.9], [1.6, 0.7]] as const) k.box(INK.steel, ax, h + y, az, 0.03, 0.03, w, { ...o, collide: false, shadow: false, rot: [0, 0.6, 0] });
  }
  // A roof whose back edge a deck or a stair lands on keeps that edge clear.
  const backOpen = (ROOF_GAPS[b.id] ?? []).some((g) => g.f === (b.front === 'e' ? 'w' : b.front === 'w' ? 'e' : g.f));
  if (b.kind === 'shop' && b.walk && !backOpen) {
    const n = Math.max(1, Math.floor(d / 2.4) - 1);
    for (let i = 0; i < n; i++) unit(back, z0 + 1.4 + i * 1.3, b.front === 'e' ? Math.PI / 2 : -Math.PI / 2);
  } else if (b.kind !== 'shop' || !b.walk) {
    // A stair house and a water tank on taller blocks.
    if (h > 9) {
      const sx = cx + w * 0.25, sz = cz - d * 0.2;
      k.span(INK.parapet, sx - 1.3, sx + 1.3, h, h + 2.6, sz - 1.4, sz + 1.4, o);
      k.span(INK.roofDark, sx - 1.45, sx + 1.45, h + 2.6, h + 2.75, sz - 1.55, sz + 1.55, { ...o, collide: false });
      k.span(INK.frame, sx - 0.5, sx + 0.5, h + 0.1, h + 2.1, sz + 1.4, sz + 1.44, { ...o, collide: false });
      tank(k, cx - w * 0.22, h, cz + d * 0.15, o);
    }
    for (let i = 0; i < Math.min(4, Math.floor(w / 3)); i++) unit(x0 + 1.4 + i * 1.5, z1 - 1.0, Math.PI);
  }
}

const ROOF_PAINTS = [0xb4ab9c, 0x9fb09f, 0x9aa5ae, 0xa99f8c, 0x8fa797, 0xbab3a6] as const;

// Openings in walkable roofs' parapets for a stair that lands there.
export const ROOF_GAPS: Record<string, { f: Face; a: number; b: number }[]> = {
  e1: [{ f: 'e', a: -14, b: -9 }],
  w6: [{ f: 'w', a: 14.6, b: 17.4 }],
  e4: [{ f: 'e', a: 2.6, b: 4.6 }],
};

// A steel water tank on four legs.
export function tank(k: CityKit, x: number, y: number, z: number, o: PieceOpts): void {
  for (const [dx, dz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]] as const) k.box(INK.steel, x + dx, y + 0.7, z + dz, 0.12, 1.4, 0.12, { ...o, collide: false });
  k.span(INK.steel, x - 1.0, x + 1.0, y + 1.3, y + 1.42, z - 1.0, z + 1.0, { ...o, collide: false });
  k.cyl(INK.tank, x, y + 2.3, z, 1.05, 1.05, 1.8, 14, o);
  k.cyl(INK.steelLight, x, y + 3.25, z, 0.4, 1.06, 0.2, 14, o);
  k.solid(x, y + 1.6, z, 1.0, 1.6, 1.0);
}

// An office's name in tall letters down the corner, lit.
function officeSign(k: CityKit, b: Building, signs: SignAtlas, o: PieceOpts): void {
  const fr = frame(b, b.front);
  const h = Math.min(b.h - 4, 9);
  signBoard(k, signs, fr, b.sign!, fr.len - 1.0, b.h - 1.2 - h / 2, 0.4, 1.3, h, { paper: '#2b3a52', ink: '#f6eedc', font: 'gothic' }, o, true);
  onFace(k, fr, INK.steel, fr.len - 1.0, b.h - 1.2 - h / 2, 0.18, 0.2, h - 0.4, 0.3, o);
}

// ------------------------------------------------------------ houses
// Two storeys: dark boarding to the first floor's sill, plaster above, a
// sliding lattice door and a little tiled hood over it on the lane side,
// windows with wooden rails upstairs, and a tiled gable roof over it all
// that a body can stand on.
export function house(k: CityKit, b: Building, group: string, tileMat: THREE.Material, r: () => number): void {
  const o = { group };
  const { x0, x1, z0, z1, h } = b;
  k.span(INK.plaster, x0, x1, 0, h, z0, z1, { ...o, surface: 'wood' });
  k.span(b.color, x0 - 0.02, x1 + 0.02, 2.9, h, z0 - 0.02, z1 + 0.02, { ...o, collide: false });
  k.span(INK.woodDark, x0 - 0.05, x1 + 0.05, 0, 2.9, z0 - 0.05, z1 + 0.05, { ...o, collide: false });
  k.span(INK.band, x0 - 0.06, x1 + 0.06, 0, 0.3, z0 - 0.06, z1 + 0.06, { ...o, collide: false });
  k.span(INK.woodDark, x0 - 0.08, x1 + 0.08, 2.84, 2.96, z0 - 0.08, z1 + 0.08, { ...o, collide: false });
  for (const f of FACES) {
    const fr = frame(b, f);
    const spans = blocked(b, f);
    // Battens on the boarding.
    for (let t = 0.4; t < fr.len - 0.2; t += 0.45) if (freeAt(spans, t, 0.05)) onFace(k, fr, 0x3a241b, t, 1.45, 0.07, 0.05, 2.8, 0.04, o);
    // Upstairs windows with a wooden rail.
    const n = Math.max(1, Math.floor((fr.len - 1) / 2.8));
    for (let i = 0; i < n; i++) {
      const t = (fr.len / n) * (i + 0.5);
      if (!freeAt(spans, t, 0.8)) continue;
      onFace(k, fr, INK.woodDark, t, 4.05, 0.04, 1.5, 1.2, 0.08, o);
      onFace(k, fr, r() < 0.25 ? INK.glassWarm : 0xe9e2cf, t, 4.05, 0.07, 1.32, 1.04, 0.05, o);
      for (const dt of [-0.33, 0, 0.33]) onFace(k, fr, INK.woodDark, t + dt, 4.05, 0.1, 0.04, 1.04, 0.03, o);
      onFace(k, fr, INK.wood, t, 3.55, 0.28, 1.6, 0.06, 0.06, o);
      for (const dt of [-0.7, -0.35, 0, 0.35, 0.7]) onFace(k, fr, INK.wood, t + dt, 3.4, 0.28, 0.05, 0.36, 0.05, o);
    }
    if (f !== b.front) continue;
    // The door on the lane: a lattice slider under a small tiled hood, a
    // potted plant either side, a bicycle against the wall.
    const t = fr.len * 0.35;
    onFace(k, fr, INK.woodLight, t, 1.0, 0.06, 1.7, 2.0, 0.06, o);
    for (const dt of [-0.6, -0.2, 0.2, 0.6]) onFace(k, fr, INK.woodDark, t + dt, 1.0, 0.1, 0.04, 2.0, 0.03, o);
    for (let y = 0.3; y < 2.0; y += 0.35) onFace(k, fr, INK.woodDark, t, y, 0.1, 1.7, 0.03, 0.03, o);
    const hood = onFace(k, fr, tileMat, t, 2.35, 0.45, 2.3, 0.08, 0.8, o);
    hood.rotation.set(fr.nz * 0.3, 0, -fr.nx * 0.3);
    for (const dt of [-1.25, 1.25]) {
      onFace(k, fr, 0x9a5a3a, t + dt, 0.22, 0.4, 0.42, 0.44, 0.42, {});
      onFace(k, fr, 0x5d8b47, t + dt, 0.68, 0.4, 0.55, 0.5, 0.55, {});
    }
    if (r() < 0.6) bicycle(k, fr, fr.len * 0.75, 0.45);
  }
  // The gable: the ridge runs along the longer side.
  const along = x1 - x0 >= z1 - z0 ? 'x' : 'z';
  gable(k, { x0, x1, z0, z1 }, h, along, tileMat, o);
}

// A tiled gable roof over a rect, ridge along `along`, with 0.5 m eaves. The
// two slopes are walkable colliders.
export function gable(k: CityKit, rect: Rect, h: number, along: 'x' | 'z', tileMat: THREE.Material, o: PieceOpts, pitch = 0.5): void {
  const { x0, x1, z0, z1 } = rect;
  const eave = 0.55;
  const span = (along === 'x' ? z1 - z0 : x1 - x0) / 2 + eave;
  const len = (along === 'x' ? x1 - x0 : z1 - z0) + eave * 2;
  const rise = Math.tan(pitch) * span;
  const slope = span / Math.cos(pitch);
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  for (const side of [-1, 1]) {
    const off = side * span / 2;
    const y = h - eave * Math.tan(pitch) + rise / 2 + 0.08;
    const rot: [number, number, number] = along === 'x' ? [side * pitch, 0, 0] : [0, 0, -side * pitch];
    k.box(tileMat, along === 'x' ? cx : cx + off, y, along === 'x' ? cz + off : cz, along === 'x' ? len : slope, 0.16, along === 'x' ? slope : len, { ...o, rot, uv: 1.2, uvSwap: along === 'z', surface: 'tile' });
    // The eave's edge tiles.
    const ex = along === 'x' ? cx : cx + side * span, ez = along === 'x' ? cz + side * span : cz;
    k.box(INK.tileEdge, ex, h - eave * Math.tan(pitch) + 0.02, ez, along === 'x' ? len : 0.18, 0.2, along === 'x' ? 0.18 : len, { ...o, collide: false });
  }
  const ry = h - eave * Math.tan(pitch) + rise + 0.12;
  k.box(INK.tileEdge, cx, ry, cz, along === 'x' ? len - 0.3 : 0.4, 0.3, along === 'x' ? 0.4 : len - 0.3, { ...o, collide: false });
  k.box(INK.plaster, cx, ry + 0.16, cz, along === 'x' ? len - 0.3 : 0.42, 0.04, along === 'x' ? 0.42 : len - 0.3, { ...o, collide: false, shadow: false });
  // Gable ends closed in plaster, a triangle under each verge.
  const tri = new THREE.BufferGeometry();
  const hs = span - eave;
  tri.setAttribute('position', new THREE.Float32BufferAttribute([-hs, 0, 0, hs, 0, 0, 0, Math.tan(pitch) * hs, 0, hs, 0, 0, -hs, 0, 0, 0, Math.tan(pitch) * hs, 0], 3));
  tri.computeVertexNormals();
  for (const end of [-1, 1]) {
    const gx = along === 'x' ? (end < 0 ? x0 : x1) : cx, gz = along === 'x' ? cz : (end < 0 ? z0 : z1);
    const m = k.mesh(tri.clone(), INK.plaster, gx, h, gz, { ...o });
    m.rotation.y = along === 'x' ? Math.PI / 2 : 0;
  }
}

function bicycle(k: CityKit, fr: Frame, t: number, off: number): void {
  const x = fr.ox + fr.ux * t + fr.nx * off, z = fr.oz + fr.uz * t + fr.nz * off;
  const rotY = Math.atan2(fr.ux, fr.uz);
  const g = new THREE.Group();
  g.position.copy(k.w(x, 0, z));
  g.rotation.y = rotY;
  k.root.add(g);
  const add = (geo: THREE.BufferGeometry, color: number, px: number, py: number, pz: number, rx = 0, rz = 0): void => {
    const m = new THREE.Mesh(geo, k.paint(color));
    m.position.set(px, py, pz);
    m.rotation.set(rx, 0, rz);
    m.castShadow = true;
    g.add(m);
  };
  for (const dz of [-0.5, 0.5]) add(new THREE.TorusGeometry(0.3, 0.03, 4, 14), INK.black, 0, 0.32, dz, 0, 0);
  g.children.forEach((c) => { c.rotation.y = Math.PI / 2; });
  add(new THREE.BoxGeometry(0.04, 0.04, 0.9), 0x7a9ab0, 0, 0.55, 0);
  add(new THREE.BoxGeometry(0.04, 0.5, 0.04), 0x7a9ab0, 0, 0.5, -0.25);
  add(new THREE.BoxGeometry(0.2, 0.06, 0.26), INK.black, 0, 0.78, -0.25);
  add(new THREE.BoxGeometry(0.5, 0.04, 0.04), INK.steel, 0, 0.88, 0.42);
  add(new THREE.BoxGeometry(0.34, 0.2, 0.28), INK.steelLight, 0, 0.82, 0.62);
  k.solid(x, 0.5, z, fr.ux ? 0.55 : 0.2, 0.5, fr.ux ? 0.2 : 0.55);
}

// ------------------------------------------------------------ the bath house
// A sentō: a broad tiled roof with a gabled porch, a navy noren at the door,
// and its tall chimney, which the whole ward can see.
function sento(k: CityKit, b: Building, group: string, tileMat: THREE.Material, signs: SignAtlas): void {
  const o = { group };
  const { x0, x1, z0, z1, h } = b;
  k.span(b.color, x0, x1, 0, h, z0, z1, { ...o, surface: 'stone' });
  k.span(INK.woodDark, x0 - 0.05, x1 + 0.05, 0, 1.2, z0 - 0.05, z1 + 0.05, { ...o, collide: false });
  k.span(0x8fb0bf, x0 - 0.04, x1 + 0.04, 1.2, 1.5, z0 - 0.04, z1 + 0.04, { ...o, collide: false });
  const fr = frame(b, 's');
  for (let i = 0; i < 4; i++) onFace(k, fr, INK.frame, 1.6 + i * 2.6, 4.2, 0.04, 1.6, 0.9, 0.08, o);
  for (let i = 0; i < 4; i++) onFace(k, fr, 0xe9e2cf, 1.6 + i * 2.6, 4.2, 0.07, 1.44, 0.74, 0.05, o);
  gable(k, { x0, x1, z0, z1 }, h, 'x', tileMat, o, 0.42);
  // The porch: a gabled hood on posts over the door, the noren hanging in it.
  const px = (x0 + x1) / 2 - 1;
  for (const dx of [-1.4, 1.4]) k.box(INK.woodDark, px + dx, 1.5, z1 + 1.6, 0.22, 3.0, 0.22);
  gable(k, { x0: px - 1.7, x1: px + 1.7, z0: z1 - 0.2, z1: z1 + 2.0 }, 3.0, 'z', tileMat, o, 0.55);
  k.span(0xf1ece0, px - 1.0, px + 1.0, 0, 2.3, z1 - 0.02, z1 + 0.02, { collide: false });
  for (let i = 0; i < 3; i++) k.span(0x2f4a7a, px - 1.0 + i * 0.68 + 0.02, px - 1.0 + (i + 1) * 0.68 - 0.02, 1.4, 2.4, z1 + 0.06, z1 + 0.09, { collide: false });
  const noren = k.mesh(signs.face('ゆ', 0.6, 0.6, { paper: '#2f4a7a', ink: '#f6eedc', font: 'mincho' }), signs.plain, px, 1.9, z1 + 0.1, { shadow: false });
  noren.rotation.y = 0;
  // The chimney, round brick narrowing to the top, the bath's name down it.
  const cx = x0 + 2.2, cz = z0 + 2.2, ch = 19;
  k.cyl(0x9a5a44, cx, ch / 2, cz, 0.62, 0.95, ch, 12, o);
  for (const y of [ch * 0.35, ch * 0.7, ch - 0.4]) k.cyl(0x6e3e30, cx, y, cz, 0.7 - y * 0.012, 0.72 - y * 0.012, 0.3, 12, o);
  k.solid(cx, ch / 2, cz, 0.8, ch / 2, 0.8);
  const sign = k.mesh(signs.face('松の湯', 0.8, 3.6, { paper: '#f6eedc', ink: '#2b1d1a', font: 'mincho', rule: true }), signs.plain, cx, ch * 0.6, cz + 0.83, { ...o, shadow: false });
  sign.rotation.y = 0;
}

// ------------------------------------------------------------ backdrop
// Plain tall blocks beyond the edges: a mass, rows of windows on the two
// faces the ward sees, a roof line. The ones south of the canal stand where
// the top-down camera hangs, so they fade like any building.
function backdrop(k: CityKit, d: (typeof BACKDROP)[number], i: number, r: () => number): void {
  const south = d.z0 > 40;
  const o: PieceOpts = south ? { group: k.group(`backdrop-${i}`) } : {};
  k.span(d.color, d.x0, d.x1, 0, d.h, d.z0, d.z1, { ...o, collide: false, shadow: south });
  const shade = new THREE.Color(d.color).multiplyScalar(0.8).getHex();
  k.span(shade, d.x0 - 0.15, d.x1 + 0.15, d.h - 0.4, d.h, d.z0 - 0.15, d.z1 + 0.15, { ...o, collide: false, shadow: false });
  for (const f of ['s', 'n', 'e', 'w'] as Face[]) {
    const fr = frame(d, f);
    const facing = f === 's' ? d.z0 < 0 : f === 'n' ? d.z0 > 0 : f === 'e' ? d.x0 < 0 : d.x0 > 0;
    if (!facing) continue;
    for (let y = 2.2; y < d.h - 1.6; y += 3.2) {
      onFace(k, fr, INK.glassDark, fr.len / 2, y, 0.04, fr.len - 1.6, 1.3, 0.06, { ...o, shadow: false });
      for (let t = 1.6; t < fr.len - 1.2; t += 2.2) onFace(k, fr, r() < 0.12 ? INK.glassWarm : shade, t, y, 0.08, 0.16, 1.3, 0.04, { ...o, shadow: false });
    }
  }
}
