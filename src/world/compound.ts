import * as THREE from 'three';
import type { Assets } from '../app/assets';
import { Physics, RAPIER } from '../physics/world';
import { toon, toonify, emissive, paintedSign, faceted } from '../render/materials';
import type { PropSystem } from './props';
import type { LightPool } from '../render/lightPool';

// One walled dojo compound, 48 by 40 metres inside the walls, every surface
// hand placed. North is -z. The training hall fills the north side and its
// flat roof is the rooftop trial's deck; a stair on its west side climbs to
// it. A plank bridge crosses from the hall roof to the storehouse roof on the
// east; from there a wall walk runs south along the east wall and west along
// the south wall to the gatehouse roof, and a stair comes down beside the
// gate. The courtyard holds the sparring ring, the koi pond and the crane.

export type ZoneId = 'hall' | 'courtyard' | 'ring' | 'storehouse' | 'gate' | 'roof';
export interface Zone { id: ZoneId; min: THREE.Vector3; max: THREE.Vector3; indoors?: boolean; label: string }
export interface Footprint { x: number; z: number; w: number; d: number; y: number }
export interface Plaque { id: string; title: string; body: string; position: THREE.Vector3; mesh: THREE.Object3D; found: boolean }

// Where the player can be put down. Every entry is a place the navigation
// registry and the debug teleport know by name.
export const SPAWN = {
  courtyard: new THREE.Vector3(-3, 0, 6),
  hall: new THREE.Vector3(-6, 0.3, -9),
  ring: new THREE.Vector3(-8, 0, 8),
  pond: new THREE.Vector3(11, 0, 15.5),
  roof: new THREE.Vector3(-10, 4.9, -12),
  store: new THREE.Vector3(20.6, 4.1, -5),
  gate: new THREE.Vector3(0, 0, 14),
  stairs: new THREE.Vector3(-17.0, 0, -2.6),
};

// Palette. Flat fills; the ink and the light ramp do the rest.
export const PALETTE = {
  paving: 0xcdbb9c, pavingLine: 0xb7a486, sand: 0xe6d3ad, grass: 0x8fae58, grassFar: 0x6a8f52, path: 0xc8ad86,
  plaster: 0xf3e9d8, plasterShade: 0xe3d5c0, plinth: 0x6b6f72, stone: 0xa3a7a8, stoneDark: 0x7c8284,
  wood: 0x7a4b34, woodDark: 0x4e3024, woodLight: 0xc49a66, floor: 0xcfa875, deck: 0xb08658, deckLine: 0x8f6a44,
  tile: 0x4b6080, tileEdge: 0x33425a, gateWood: 0x5a3a2a, iron: 0x2a2528, water: 0x3f86b6, waterLight: 0x8ad0ea,
  lantern: 0xffb36b, mark: 0xff9a3c, hill: 0x6f93a4, hillFar: 0x8fb0bf,
} as const;

export interface World {
  group: THREE.Group;
  zones: Zone[];
  // Building outlines for the map.
  footprints: Footprint[];
  plaques: Plaque[];
  craneHook: THREE.Object3D;
  pond: { center: THREE.Vector3; radius: number; surfaceY: number };
  // Meshes that may stand between the top-down camera and the player. A
  // mesh's `userData.cutaway` names the roof it belongs to: when one piece
  // is in the way the whole roof and what stands on it fade together.
  occluders: THREE.Mesh[];
  // Registers a roof-top dressing with the cut-away, so it fades with its roof.
  onRoof(mesh: THREE.Mesh, roof: string, ghost?: boolean): void;
  zoneAt(p: THREE.Vector3): Zone | null;
  indoorsAt(p: THREE.Vector3): number;
  update(time: number): void;
}

// Compound bounds.
const HX = 24, HZ = 20;
const WALL_H = 3.4, WALL_T = 0.6;
// The hall and its roof deck.
export const HALL = { x0: -14, x1: 14, z0: -19.6, z1: -4, floorY: 0.3, wallTop: 4.6, deckY: 4.9, overhang: 0.6 };
export const STORE = { x0: 17.4, x1: 24, z0: -9, z1: -1, wallTop: 3.8, deckY: 4.1 };
export const WALK_Y = 2.6;
export const GATE = { x0: -4.2, x1: 4.2, z0: 17.8, z1: 20.8, roofY: 3.9 };
export const POND = { center: new THREE.Vector3(11, 0, 11), radius: 2.75, surfaceY: -0.15, floorY: -0.9, hole: 2.6 };

// A canvas of flagstones: flat cells of two close tones with a thin dark joint.
function flagstones(a: number, b: number, line: number, cells = 4): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const ca = new THREE.Color(a), cb = new THREE.Color(b);
  const size = 256 / cells;
  for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++) {
    const t = ((x * 7 + y * 13) % 5) / 5;
    g.fillStyle = '#' + ca.clone().lerp(cb, t).getHexString();
    g.fillRect(x * size, y * size, size, size);
  }
  g.strokeStyle = '#' + new THREE.Color(line).getHexString();
  g.lineWidth = 3;
  for (let i = 0; i <= cells; i++) { g.beginPath(); g.moveTo(i * size, 0); g.lineTo(i * size, 256); g.stroke(); g.beginPath(); g.moveTo(0, i * size); g.lineTo(256, i * size); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// Planks: long boards with a dark seam, for the hall floor and the roof decks.
function planks(a: number, b: number, line: number, boards = 6): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const ca = new THREE.Color(a), cb = new THREE.Color(b);
  const w = 256 / boards;
  for (let i = 0; i < boards; i++) {
    g.fillStyle = '#' + ca.clone().lerp(cb, ((i * 5) % 4) / 4).getHexString();
    g.fillRect(i * w, 0, w, 256);
    g.fillStyle = '#' + new THREE.Color(line).getHexString();
    g.fillRect(i * w, 0, 2, 256);
    g.fillRect(i * w, (i * 97) % 256, w, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

const waterVert = /* glsl */ `varying vec2 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const waterFrag = /* glsl */ `uniform float time; uniform vec3 deep; uniform vec3 light; varying vec2 vW;
  float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
  float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y); }
  void main(){
    float n = n2(vW * 1.6 + vec2(time * 0.12, time * 0.07)) * 0.6 + n2(vW * 3.3 - vec2(time * 0.09, 0.0)) * 0.4;
    float band = step(0.58, n) * 0.55 + step(0.68, n) * 0.45;
    gl_FragColor = vec4(mix(deep, light, band), 0.9);
  }`;

export function buildCompound(assets: Assets, physics: Physics, scene: THREE.Scene, props: PropSystem, lights: LightPool): World {
  const g = new THREE.Group();
  scene.add(g);
  const zones: Zone[] = [];
  const plaques: Plaque[] = [];
  const occluders: THREE.Mesh[] = [];
  const footprints: Footprint[] = [];
  const animated: { update(time: number): void }[] = [];

  const paving = toon(0xffffff, { map: flagstones(PALETTE.paving, PALETTE.pavingLine, 0xa08d70) });
  paving.map!.repeat.set(12, 10);
  const floorMat = toon(0xffffff, { map: planks(PALETTE.floor, 0xbd9765, 0x9a7a4e, 8) });
  floorMat.map!.repeat.set(7, 4);
  const deckMat = toon(0xffffff, { map: planks(PALETTE.deck, 0xa37a50, PALETTE.deckLine) });
  deckMat.map!.repeat.set(7, 4);
  const plaster = toon(PALETTE.plaster);
  const plinth = toon(PALETTE.plinth);
  const stone = toon(PALETTE.stone);
  const stoneDark = toon(PALETTE.stoneDark);
  const wood = toon(PALETTE.wood);
  const woodDark = toon(PALETTE.woodDark);
  const woodLight = toon(PALETTE.woodLight);
  const tile = toon(PALETTE.tile);
  const tileEdge = toon(PALETTE.tileEdge);
  const gateWood = toon(PALETTE.gateWood);
  const iron = toon(PALETTE.iron);
  const sand = toon(PALETTE.sand);
  const grass = toon(PALETTE.grass);
  const grassFar = toon(PALETTE.grassFar);
  const path = toon(PALETTE.path);
  const lanternMat = emissive(PALETTE.lantern, 2.4);
  const markMat = emissive(PALETTE.mark, 1.0);

  const tag = (col: RAPIER.Collider, surface: string): RAPIER.Collider => { (col as RAPIER.Collider & { surfaceTag?: string }).surfaceTag = surface; return col; };
  // A box with a matching collider. `y` is the centre.
  const slab = (mat: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number, opts: { rotY?: number; rotX?: number; rotZ?: number; surface?: string; shadow?: boolean; collide?: boolean; occluder?: boolean | string; receive?: boolean } = {}): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.rotation.set(opts.rotX ?? 0, opts.rotY ?? 0, opts.rotZ ?? 0);
    m.receiveShadow = opts.receive ?? true;
    m.castShadow = opts.shadow ?? true;
    g.add(m);
    if (opts.collide !== false) {
      const q = (opts.rotX || opts.rotY || opts.rotZ) ? new THREE.Quaternion().setFromEuler(m.rotation) : undefined;
      tag(physics.staticBox(new THREE.Vector3(x, y, z), new THREE.Vector3(w / 2, h / 2, d / 2), q), opts.surface ?? 'stone');
    }
    if (opts.occluder) onRoof(m, typeof opts.occluder === 'string' ? opts.occluder : '', true);
    return m;
  };
  // A roof slab stays as a ghost when faded; the dressing on it hides outright, so nothing floats over the room below.
  const onRoof = (m: THREE.Mesh, roof: string, ghost = false): void => { m.material = (m.material as THREE.Material).clone(); m.userData.cutaway = roof; m.userData.ghost = ghost; occluders.push(m); };
  // Collision only: the tall rails that keep everyone on the roofs and inside the walls.
  const rail = (x: number, y: number, z: number, w: number, h: number, d: number): void => { physics.staticBox(new THREE.Vector3(x, y, z), new THREE.Vector3(w / 2, h / 2, d / 2)); };
  // A box spanning two corners.
  const span = (mat: THREE.Material, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, opts: Parameters<typeof slab>[7] = {}): THREE.Mesh => slab(mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), opts);
  const point = (color: number, intensity: number, distance: number, x: number, y: number, z: number): void => { lights.add({ kind: 'point', position: new THREE.Vector3(x, y, z), color: new THREE.Color(color), intensity, distance, decay: 2 }); };
  const place = (model: string, x: number, y: number, z: number, rot = 0, s = 1, tint?: number): THREE.Object3D => {
    const m = assets.model(model).scene.clone(true);
    m.scale.setScalar(s);
    m.position.set(x, y, z);
    m.rotation.y = rot;
    toonify(m, tint);
    m.traverse((o) => { if ((o as THREE.Mesh).isMesh) { (o as THREE.Mesh).castShadow = true; (o as THREE.Mesh).receiveShadow = true; } });
    g.add(m);
    return m;
  };

  // ---------------------------------------------------------------- ground
  // The courtyard paving leaves a square hole for the pond. Outside the walls
  // the ground is grass, with a dirt path from the gate.
  const P = POND, ph = P.hole;
  span(paving, -HX - 1, HX + 1, -0.3, 0, -HZ - 1, P.center.z - ph, { shadow: false });
  span(paving, -HX - 1, HX + 1, -0.3, 0, P.center.z + ph, HZ + 1, { shadow: false });
  span(paving, -HX - 1, P.center.x - ph, -0.3, 0, P.center.z - ph, P.center.z + ph, { shadow: false });
  span(paving, P.center.x + ph, HX + 1, -0.3, 0, P.center.z - ph, P.center.z + ph, { shadow: false });
  const far = 260;
  span(grass, -far, far, -0.3, -0.02, -far, -HZ - 1, { shadow: false, receive: true });
  span(grass, -far, far, -0.3, -0.02, HZ + 1, far, { shadow: false });
  span(grass, -far, -HX - 1, -0.3, -0.02, -HZ - 1, HZ + 1, { shadow: false });
  span(grass, HX + 1, far, -0.3, -0.02, -HZ - 1, HZ + 1, { shadow: false });
  span(path, -2.4, 2.4, -0.3, 0.0, HZ + 1, 70, { shadow: false, collide: false });
  // Hills: low flat cones in two rings, bluer the farther they stand.
  const hillNear = toon(PALETTE.hill), hillFar = toon(PALETTE.hillFar);
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + (i % 2) * 0.1;
    const near = i % 3 !== 0;
    const r = near ? 150 + Math.sin(i * 2.3) * 20 : 230 + Math.sin(i * 1.7) * 30;
    const h = near ? 16 + Math.abs(Math.sin(i * 1.3)) * 14 : 34 + Math.abs(Math.cos(i * 2.1)) * 26;
    const hill = new THREE.Mesh(faceted(new THREE.ConeGeometry(near ? 40 + (i % 4) * 8 : 70 + (i % 3) * 20, h, 7)), near ? hillNear : hillFar);
    hill.position.set(Math.cos(a) * r, h / 2 - 1, Math.sin(a) * r);
    hill.rotation.y = i;
    g.add(hill);
  }
  // A tree line beyond the walls, seen from the roofs.
  for (let i = 0; i < 34; i++) {
    const a = (i / 34) * Math.PI * 2;
    const r = 44 + ((i * 7) % 5) * 6;
    tree(Math.cos(a) * r * 1.15, Math.sin(a) * r, i % 4 === 0 ? 'maple' : i % 4 === 1 ? 'gold' : 'pine', 1.1 + (i % 3) * 0.25, i);
  }
  void grassFar;

  // ---------------------------------------------------------------- walls
  // Plaster walls on a dark plinth, capped with tile. An invisible rail
  // above each wall keeps a jump or a knock-back inside.
  const wallRun = (x0: number, x1: number, z0: number, z1: number, occluder: boolean): void => {
    span(plinth, x0, x1, 0, 0.55, z0, z1, { collide: false });
    span(plaster, x0 + 0.05, x1 - 0.05, 0.55, WALL_H, z0 + 0.05, z1 - 0.05, { occluder });
    const alongX = x1 - x0 > z1 - z0;
    span(tile, x0 - (alongX ? 0 : 0.25), x1 + (alongX ? 0 : 0.25), WALL_H, WALL_H + 0.34, z0 - (alongX ? 0.25 : 0), z1 + (alongX ? 0.25 : 0), { collide: false, occluder });
    span(tileEdge, x0 - (alongX ? 0 : 0.3), x1 + (alongX ? 0 : 0.3), WALL_H + 0.3, WALL_H + 0.42, z0 - (alongX ? 0.3 : 0), z1 + (alongX ? 0.3 : 0), { collide: false, shadow: false });
    rail((x0 + x1) / 2, WALL_H + 5, (z0 + z1) / 2, x1 - x0, 10, z1 - z0);
  };
  const wx0 = -HX - WALL_T, wx1 = HX + WALL_T, wz0 = -HZ - WALL_T, wz1 = HZ + WALL_T;
  wallRun(wx0, wx1, wz0, -HZ, false);
  wallRun(wx0, -HX, -HZ, HZ, true);
  wallRun(HX, wx1, -HZ, HZ, true);
  wallRun(wx0, GATE.x0, HZ, wz1, true);
  wallRun(GATE.x1, wx1, HZ, wz1, true);
  // Corner posts, a little taller than the wall.
  for (const [cx, cz] of [[wx0 + 0.3, wz0 + 0.3], [wx1 - 0.3, wz0 + 0.3], [wx0 + 0.3, wz1 - 0.3], [wx1 - 0.3, wz1 - 0.3]]) {
    slab(plinth, cx!, WALL_H / 2 + 0.1, cz!, 1.0, WALL_H + 0.2, 1.0, { collide: false });
    slab(tile, cx!, WALL_H + 0.55, cz!, 1.4, 0.3, 1.4, { collide: false });
  }

  // ---------------------------------------------------------------- gate
  // Two pillars, a lintel, closed double doors and a tiled roof over them.
  const G = GATE;
  for (const px of [G.x0 + 0.4, G.x1 - 0.4]) slab(woodDark, px, 2.0, HZ + 0.3, 0.7, 4.0, 0.9);
  slab(woodDark, 0, 3.55, HZ + 0.3, G.x1 - G.x0, 0.35, 1.0, { collide: false });
  for (const side of [-1, 1]) {
    const door = slab(gateWood, side * (G.x1 - 0.8) / 2, 1.65, HZ + 0.3, (G.x1 - 0.8) - 0.05, 3.3, 0.22, { surface: 'wood' });
    door.castShadow = true;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) slab(iron, side * (G.x1 - 0.8) / 2 - 1.2 + c * 1.2, 0.6 + r * 1.0, HZ + 0.17, 0.14, 0.14, 0.06, { collide: false, shadow: false });
  }
  span(tile, G.x0 - 0.9, G.x1 + 0.9, G.roofY - 0.3, G.roofY, G.z0 - 0.9, G.z1 + 0.9, { occluder: 'gate' });
  span(tileEdge, G.x0 - 1.0, G.x1 + 1.0, G.roofY - 0.3, G.roofY - 0.18, G.z0 - 1.0, G.z1 + 1.0, { collide: false, shadow: false });
  slab(tileEdge, 0, G.roofY + 0.25, (G.z0 + G.z1) / 2, G.x1 - G.x0 - 1.5, 0.5, 0.5, { collide: false });
  // Low rail around the gate roof; the tall rail is on the outer edge only.
  for (const [x0, x1, z0, z1] of [[G.x0 - 0.9, G.x1 + 0.9, G.z0 - 0.9, G.z0 - 0.78], [G.x0 - 0.9, G.x0 - 0.78, G.z0 - 0.9, G.z1 + 0.9]] as const) span(woodDark, x0, x1, G.roofY, G.roofY + 0.9, z0, z1);
  rail(0, G.roofY + 5, G.z1 + 0.9, G.x1 - G.x0 + 2, 10, 0.2);
  lanternAt(G.x0 - 1.3, 2.4, HZ - 0.9);
  lanternAt(G.x1 + 1.3, 2.4, HZ - 0.9);
  point(PALETTE.lantern, 9, 8, G.x0 - 1.3, 2.4, HZ - 1.4);
  point(PALETTE.lantern, 9, 8, G.x1 + 1.3, 2.4, HZ - 1.4);
  // Stairs down from the gate roof, west along the south wall.
  stairs(G.x0 - 0.9, G.roofY, HZ - 0.9, -1, 0, 1.3, 'inner');
  zones.push({ id: 'gate', min: new THREE.Vector3(G.x0 - 1.5, -1, G.z0 - 3), max: new THREE.Vector3(G.x1 + 1.5, 6, G.z1), label: 'The gate' });

  // ---------------------------------------------------------------- wall walk
  // A ledge along the inside of the east and south walls, chest high to the
  // courtyard, with a low wooden rail on its inner edge.
  span(stoneDark, HX - 1.6, HX, 0, WALK_Y, STORE.z1, HZ, { surface: 'stone' });
  span(stoneDark, G.x1 + 0.9, HX, 0, WALK_Y, HZ - 1.6, HZ, { surface: 'stone' });
  span(woodDark, HX - 1.65, HX - 1.55, WALK_Y, WALK_Y + 0.9, STORE.z1, HZ - 1.6);
  span(woodDark, G.x1 + 0.9, HX - 1.55, WALK_Y, WALK_Y + 0.9, HZ - 1.65, HZ - 1.55);
  for (let z = STORE.z1 + 1; z < HZ - 1.6; z += 2) slab(woodDark, HX - 1.6, WALK_Y + 0.45, z, 0.16, 0.9, 0.16, { collide: false });
  for (let x = G.x1 + 1.5; x < HX - 1.6; x += 2) slab(woodDark, x, WALK_Y + 0.45, HZ - 1.6, 0.16, 0.9, 0.16, { collide: false });

  // ---------------------------------------------------------------- hall
  const H = HALL;
  const hallW = H.x1 - H.x0;
  // Raised floor and the front step.
  span(floorMat, H.x0, H.x1, 0, H.floorY, H.z0, H.z1, { surface: 'wood', shadow: false });
  span(woodLight, H.x0 - 0.3, H.x1 + 0.3, 0, H.floorY / 2, H.z1, H.z1 + 0.6, { surface: 'wood' });
  span(stoneDark, H.x0 - 0.3, H.x1 + 0.3, 0, 0.08, H.z1 + 0.6, H.z1 + 1.4, { shadow: false });
  // Back and side walls, with timber framing on the inside.
  span(plaster, H.x0, H.x1, H.floorY, H.wallTop, H.z0, H.z0 + 0.3);
  span(plaster, H.x0, H.x0 + 0.3, H.floorY, H.wallTop, H.z0, H.z1, { occluder: true });
  span(plaster, H.x1 - 0.3, H.x1, H.floorY, H.wallTop, H.z0, H.z1, { occluder: true });
  const frame = (x0: number, x1: number, y: number, z0: number, z1: number): void => { span(woodDark, x0, x1, y - 0.06, y + 0.06, z0, z1, { collide: false, shadow: false }); };
  frame(H.x0 + 0.3, H.x1 - 0.3, H.floorY + 1.1, H.z0 + 0.3, H.z0 + 0.4);
  frame(H.x0 + 0.3, H.x1 - 0.3, H.floorY + 3.0, H.z0 + 0.3, H.z0 + 0.4);
  for (const x of [-10.5, -7, -3.5, 0, 3.5, 7, 10.5]) span(woodDark, x - 0.08, x + 0.08, H.floorY, H.wallTop, H.z0 + 0.3, H.z0 + 0.42, { collide: false, shadow: false });
  for (const side of [H.x0 + 0.3, H.x1 - 0.42]) { frame(side, side + 0.12, H.floorY + 1.1, H.z0 + 0.3, H.z1 - 0.3); frame(side, side + 0.12, H.floorY + 3.0, H.z0 + 0.3, H.z1 - 0.3); for (const z of [-16, -12, -8]) span(woodDark, side, side + 0.12, H.floorY, H.wallTop, z - 0.08, z + 0.08, { collide: false, shadow: false }); }
  // The open front: pillars every seven metres, solid bays at the ends, two
  // wide doorways in the middle with their sliding doors drawn to the sides.
  for (const x of [H.x0, -7, 0, 7, H.x1]) slab(wood, x, (H.wallTop + 0.3) / 2, H.z1 - 0.25, 0.5, H.wallTop + 0.3, 0.5);
  span(plaster, H.x0, -7, H.floorY, H.wallTop, H.z1 - 0.4, H.z1 - 0.1, { occluder: true });
  span(plaster, 7, H.x1, H.floorY, H.wallTop, H.z1 - 0.4, H.z1 - 0.1, { occluder: true });
  // Paper windows in the solid bays, seen from inside and out as a lattice over a light panel.
  const shoji = toon(0xfbf4e6, { emissive: 0xffe6c0, emissiveIntensity: 0.25 });
  for (const x of [-10.5, 10.5]) for (const [z0, z1] of [[H.z1 - 0.48, H.z1 - 0.4], [H.z1 - 0.1, H.z1 - 0.02]] as const) {
    span(shoji, x - 1.0, x + 1.0, H.floorY + 1.5, H.floorY + 2.8, z0, z1, { collide: false, shadow: false, occluder: true });
    span(woodDark, x - 1.1, x + 1.1, H.floorY + 1.44, H.floorY + 1.5, z0 - 0.02, z1 + 0.02, { collide: false, shadow: false });
    span(woodDark, x - 1.1, x + 1.1, H.floorY + 2.8, H.floorY + 2.86, z0 - 0.02, z1 + 0.02, { collide: false, shadow: false });
    for (const lx of [-1.1, -0.35, 0.35, 1.1]) span(woodDark, x + lx - 0.03, x + lx + 0.03, H.floorY + 1.44, H.floorY + 2.86, z0 - 0.02, z1 + 0.02, { collide: false, shadow: false });
    span(woodDark, x - 1.1, x + 1.1, H.floorY + 2.14, H.floorY + 2.18, z0 - 0.02, z1 + 0.02, { collide: false, shadow: false });
  }
  // The sliding doors drawn open against the pillars: a lattice panel each.
  for (const x of [-6.75, -0.25, 0.25, 6.75]) {
    span(shoji, x - 0.75, x + 0.75, H.floorY + 0.1, H.wallTop - 0.4, H.z1 - 0.34, H.z1 - 0.3, { occluder: true });
    for (const lx of [-0.75, -0.25, 0.25, 0.75]) span(woodDark, x + lx - 0.03, x + lx + 0.03, H.floorY, H.wallTop - 0.3, H.z1 - 0.37, H.z1 - 0.27, { collide: false, shadow: false });
    for (let y = H.floorY; y <= H.wallTop - 0.3; y += 0.7) span(woodDark, x - 0.78, x + 0.78, y, y + 0.05, H.z1 - 0.37, H.z1 - 0.27, { collide: false, shadow: false });
  }
  span(woodDark, H.x0, H.x1, H.wallTop - 0.3, H.wallTop + 0.3, H.z1 - 0.5, H.z1, { collide: false });
  // The roof deck with tile eaves on three sides (the back sits on the wall).
  const dx0 = H.x0 - H.overhang, dx1 = H.x1 + H.overhang, dz0 = H.z0 - 0.5, dz1 = H.z1 + H.overhang;
  span(deckMat, dx0, dx1, H.deckY - 0.3, H.deckY, dz0, dz1, { surface: 'wood', occluder: 'hall' });
  eaves(dx0, dx1, dz0, dz1, H.deckY - 0.3, 1.5, true, [[dx0, -13.8, -10.8]], 'hall');
  deckRail(dx0, dx1, dz0, dz1, H.deckY, [[dx0, 'x', -13.6, -11.0], [dx1, 'x', -6.9, -5.1]], 'hall');
  // Hanging lanterns and the name board over the entrance.
  for (const [lx, lz] of [[-9, -8], [9, -8], [-9, -16], [9, -16]] as const) { lanternAt(lx, H.wallTop - 0.6, lz, true); point(PALETTE.lantern, 12, 9, lx, H.wallTop - 0.9, lz); }
  const name = paintedSign('道場', { width: 2.6 });
  name.position.set(0, H.wallTop - 0.1, H.z1 + 0.15);
  g.add(name);
  // Furniture: the Architect's desk, bookcases, a rug, lamps, and dummies at the back.
  place('props/furn-desk', -10, H.floorY, -17.6, Math.PI);
  physics.staticBox(new THREE.Vector3(-10, H.floorY + 0.45, -17.6), new THREE.Vector3(0.9, 0.45, 0.5));
  place('props/furn-radio', -9.2, H.floorY + 0.56, -17.8);
  place('props/furn-lampSquareFloor', -12.6, H.floorY, -18.4);
  place('props/furn-bookcaseOpen', -13.1, H.floorY, -14, Math.PI / 2);
  place('props/furn-bookcaseOpen', -13.1, H.floorY, -11.6, Math.PI / 2);
  place('props/furn-rugRectangle', -6, H.floorY + 0.01, -12, 0, 2.6);
  place('props/furn-pottedPlant', 12.8, H.floorY, -6.2);
  place('props/furn-pottedPlant', -12.8, H.floorY, -6.2);
  for (let i = 0; i < 3; i++) props.spawn('dummy', new THREE.Vector3(5 + i * 3, H.floorY, -18));
  zones.push({ id: 'hall', min: new THREE.Vector3(H.x0, -1, H.z0), max: new THREE.Vector3(H.x1, H.wallTop, H.z1), indoors: true, label: 'Training hall' });
  footprints.push({ x: 0, z: (H.z0 + H.z1) / 2, w: hallW, d: H.z1 - H.z0, y: H.deckY });

  // ---------------------------------------------------------------- hall stair
  // Eighteen steps up the hall's west side to a landing on the deck.
  stairs(-17.0, H.deckY, -11.0, 0, 1, 1.8, 'both');
  span(deckMat, -18.2, dx0, H.deckY - 0.3, H.deckY, -13.6, -11.0, { surface: 'wood' });
  span(woodDark, -18.3, -18.15, H.deckY, H.deckY + 0.9, -13.6, -11.0);
  span(woodDark, -18.3, dx0, H.deckY, H.deckY + 0.9, -13.6, -13.45);
  span(woodDark, -16.1, dx0, H.deckY, H.deckY + 0.9, -11.05, -10.9);
  rail(-18.2, H.deckY + 5, -12.3, 0.2, 10, 2.6);
  rail(-16.4, H.deckY + 5, -13.6, 3.6, 10, 0.2);
  rail(-15.35, H.deckY + 5, -11.0, 1.5, 10, 0.2);

  // ---------------------------------------------------------------- storehouse
  const S = STORE;
  span(plinth, S.x0, S.x1, 0, 0.6, S.z0, S.z1, { collide: false });
  span(plaster, S.x0, S.x1, 0, S.wallTop, S.z0, S.z1, { occluder: true });
  span(woodDark, S.x0 - 0.04, S.x0 + 0.04, 0.6, S.wallTop - 0.4, S.z0 + 0.3, S.z1 - 0.3, { collide: false, shadow: false });
  span(gateWood, S.x0 - 0.08, S.x0, 0.6, 2.9, -6.0, -4.0, { collide: false });
  span(iron, S.x0 - 0.1, S.x0 - 0.08, 1.2, 1.3, -5.6, -4.4, { collide: false, shadow: false });
  span(deckMat, S.x0 - 0.4, S.x1 + 0.4, S.deckY - 0.3, S.deckY, S.z0 - 0.4, S.z1 + 0.4, { surface: 'wood', occluder: 'store' });
  eaves(S.x0 - 0.4, S.x1 + 0.4, S.z0 - 0.4, S.z1 + 0.4, S.deckY - 0.3, 1.2, false, [], 'store');
  deckRail(S.x0 - 0.4, S.x1 + 0.4, S.z0 - 0.4, S.z1 + 0.4, S.deckY, [[S.x0 - 0.4, 'x', -6.9, -5.1], [S.z1 + 0.4, 'z', HX - 1.6, HX]], 'store');
  lanternAt(S.x0 - 0.6, 3.0, -6.6);
  point(PALETTE.lantern, 8, 7, S.x0 - 1.0, 3.0, -6.6);
  for (const [x, z] of [[15.2, 1.8], [16.4, 2.0], [15.8, 3.1]] as const) props.spawn('crate', new THREE.Vector3(x, 0.05, z));
  props.spawn('barrel', new THREE.Vector3(14.2, 0.05, 2.6));
  props.spawn('barrel', new THREE.Vector3(15.6, 0.05, -10.6));
  zones.push({ id: 'storehouse', min: new THREE.Vector3(S.x0 - 1, S.deckY - 1, S.z0 - 1), max: new THREE.Vector3(S.x1 + 1, S.deckY + 4, S.z1 + 1), label: 'Storehouse roof' });
  footprints.push({ x: (S.x0 + S.x1) / 2, z: (S.z0 + S.z1) / 2, w: S.x1 - S.x0, d: S.z1 - S.z0, y: S.deckY });

  // ---------------------------------------------------------------- bridge
  // Planks from the hall deck down to the storehouse roof, with rope rails.
  const bx0 = dx1 - 0.3, bx1 = S.x0 - 0.2, by0 = H.deckY, by1 = S.deckY;
  const blen = Math.hypot(bx1 - bx0, by1 - by0), bang = Math.atan2(by1 - by0, bx1 - bx0);
  slab(deckMat, (bx0 + bx1) / 2, (by0 + by1) / 2 - 0.1, -6, blen + 0.2, 0.2, 1.7, { rotZ: bang, surface: 'wood' });
  for (const side of [-1, 1]) {
    slab(woodDark, (bx0 + bx1) / 2, (by0 + by1) / 2 + 0.95, -6 + side * 0.9, blen, 0.08, 0.08, { rotZ: bang, collide: false });
    rail((bx0 + bx1) / 2, (by0 + by1) / 2 + 2.5, -6 + side * 0.95, blen, 5, 0.1);
    for (const t of [0.1, 0.5, 0.9]) slab(woodDark, bx0 + (bx1 - bx0) * t, by0 + (by1 - by0) * t + 0.5, -6 + side * 0.9, 0.1, 1.0, 0.1, { collide: false });
  }

  // ---------------------------------------------------------------- courtyard
  // The sparring ring: a raked sand circle, a stone kerb, a painted boundary.
  const R = SPAWN.ring;
  const ringFloor = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 0.08, 48), sand);
  ringFloor.position.set(R.x, 0.04, R.z);
  ringFloor.receiveShadow = true;
  g.add(ringFloor);
  for (let i = 0; i < 28; i++) { const a = (i / 28) * Math.PI * 2; slab(stone, R.x + Math.cos(a) * 6.3, 0.09, R.z + Math.sin(a) * 6.3, 1.5, 0.18, 0.55, { rotY: -a, collide: false }); }
  const boundary = new THREE.Mesh(new THREE.RingGeometry(5.5, 5.62, 72), markMat);
  boundary.rotation.x = -Math.PI / 2;
  boundary.position.set(R.x, 0.095, R.z);
  g.add(boundary);
  const ringSign = paintedSign('稽古', { width: 0.6, vertical: true });
  ringSign.position.set(R.x - 7.6, 1.9, R.z + 0.0);
  ringSign.rotation.y = Math.PI / 2;
  g.add(ringSign);
  slab(woodDark, R.x - 7.65, 1.0, R.z, 0.14, 2.0, 0.14);
  zones.push({ id: 'ring', min: new THREE.Vector3(R.x - 6.5, -1, R.z - 6.5), max: new THREE.Vector3(R.x + 6.5, 2.3, R.z + 6.5), label: 'Sparring ring' });

  // The koi pond: a sunken square under a round stone rim, water a little
  // below the paving. Rime freezes it into a platform you can stand on.
  span(stoneDark, P.center.x - ph, P.center.x + ph, P.floorY - 0.3, P.floorY, P.center.z - ph, P.center.z + ph, { shadow: false });
  for (const [x0, x1, z0, z1] of [[P.center.x - ph - 0.3, P.center.x - ph, P.center.z - ph - 0.3, P.center.z + ph + 0.3], [P.center.x + ph, P.center.x + ph + 0.3, P.center.z - ph - 0.3, P.center.z + ph + 0.3], [P.center.x - ph, P.center.x + ph, P.center.z - ph - 0.3, P.center.z - ph], [P.center.x - ph, P.center.x + ph, P.center.z + ph, P.center.z + ph + 0.3]] as const) span(stoneDark, x0, x1, P.floorY, 0.25, z0, z1, { shadow: false });
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; slab(stone, P.center.x + Math.cos(a) * 3.3, 0.125, P.center.z + Math.sin(a) * 3.3, 1.5, 0.25, 1.4, { rotY: -a }); }
  const waterMat = new THREE.ShaderMaterial({ vertexShader: waterVert, fragmentShader: waterFrag, uniforms: { time: { value: 0 }, deep: { value: new THREE.Color(PALETTE.water) }, light: { value: new THREE.Color(PALETTE.waterLight) } }, transparent: true });
  const water = new THREE.Mesh(new THREE.CircleGeometry(P.radius + 0.5, 48), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.set(P.center.x, P.surfaceY, P.center.z);
  g.add(water);
  animated.push({ update: (t) => { waterMat.uniforms.time!.value = t; } });
  for (const [x, z, s] of [[P.center.x - 1.2, P.center.z + 0.6, 0.5], [P.center.x + 0.9, P.center.z - 1.1, 0.4]] as const) { const koi = new THREE.Mesh(new THREE.SphereGeometry(0.22 * s * 2, 8, 6), toon(0xff7a4a)); koi.scale.set(1.6, 0.4, 0.8); koi.position.set(x, P.surfaceY - 0.08, z); g.add(koi); }
  tree(P.center.x + 4.8, P.center.z + 3.4, 'maple', 1.1, 3);
  tree(-20, 13.5, 'gold', 1.25, 5);
  tree(20.6, 16.2, 'pine', 1.0, 9);
  place('props/planter', -21.6, 0, -16, 0, 5);
  place('props/planter', -21.6, 0, -13.2, 0, 5);
  place('props/furn-bench', -22.6, 0, 6, Math.PI / 2, 1.2);
  place('props/furn-bench', -22.6, 0, 2, Math.PI / 2, 1.2);
  physics.staticBox(new THREE.Vector3(-22.6, 0.3, 4), new THREE.Vector3(0.5, 0.3, 3));
  for (let i = 0; i < 4; i++) props.spawn('crate', new THREE.Vector3(-21 + (i % 2) * 1.2, 0.05, 17.5 + Math.floor(i / 2) * 1.2));
  props.spawn('dummy', new THREE.Vector3(-21.5, 0, 0));
  props.spawn('dummy', new THREE.Vector3(-21.5, 0, 9.5));
  for (const [x, z] of [[-4.6, H.z1 + 2.2], [4.6, H.z1 + 2.2]] as const) { stoneLantern(x, z); point(PALETTE.lantern, 7, 7, x, 1.7, z); }
  stoneLantern(R.x + 7.4, R.z + 5.2);
  // Weapon rack against the west wall.
  span(woodDark, -23.7, -23.4, 0, 1.9, -8, -3);
  for (let i = 0; i < 6; i++) slab(woodLight, -23.3, 1.0, -7.6 + i * 0.85, 0.08, 1.9, 0.08, { collide: false, rotZ: 0.12 });
  zones.push({ id: 'courtyard', min: new THREE.Vector3(-HX, -2, -HZ), max: new THREE.Vector3(HX, 2.3, HZ), label: 'Courtyard' });

  // ---------------------------------------------------------------- crane
  // A wooden hoist in the north-west corner for the Recoil crane drill.
  const cx = -20, cz = 3;
  for (const px of [cx - 1.6, cx + 1.6]) slab(woodDark, px, 4.5, cz, 0.4, 9, 0.4);
  slab(woodDark, cx, 9.0, cz, 3.8, 0.4, 0.4, { collide: false });
  slab(woodDark, cx, 9.0, cz + 2.4, 0.3, 0.3, 5.0, { collide: false });
  for (const px of [cx - 1.6, cx + 1.6]) slab(woodDark, px, 6.6, cz + 1.4, 0.16, 0.16, 3.6, { collide: false, rotX: -0.75 });
  const hook = new THREE.Group();
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 3, 6), iron);
  cable.position.y = 1.5;
  const hookMesh = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.05, 8, 16), iron);
  hook.add(cable, hookMesh);
  hook.position.set(cx, 6, cz + 4.6);
  g.add(hook);
  for (let i = 0; i < 4; i++) props.spawn('crate', new THREE.Vector3(cx - 3.2 + (i % 2) * 1.2, 0.05, cz + 7 + Math.floor(i / 2) * 1.2));

  // ---------------------------------------------------------------- lore plaques
  const plaqueDefs: { id: string; title: string; body: string; pos: [number, number, number]; rot?: number }[] = [
    { id: 'technique', title: 'Technique', body: 'A person\'s underlying, unique supernatural capability. Everyone has one, usually exactly one. Most are weak, narrow, or useful only outside combat.', pos: [-5.5, 0, 1.5], rot: 0.3 },
    { id: 'pact', title: 'Pact', body: 'Every application of a Technique is formulated through a Pact, down to "if I will activation, activate." A Pact is how an Ability exists at all.', pos: [-12.6, H.floorY, -8.6], rot: Math.PI / 2 },
    { id: 'resolve', title: 'Resolve', body: 'The real capability surrendered, not emotional intensity. The same sacrifice cannot be counted twice.', pos: [R.x + 2, 0, R.z + 7.4], rot: Math.PI },
    { id: 'wager', title: 'Wager', body: 'Declare an uncertain outcome. Success grants an enlarged reward; failure applies the forfeit.', pos: [6.8, 0, 16.2], rot: Math.PI },
    { id: 'aura', title: 'Aurabending', body: 'A separate universal faculty, formalized only twenty years ago despite five thousand years of Technique history. Aura does not fuel Techniques.', pos: [19.6, S.deckY, -2.4], rot: Math.PI },
    { id: 'kuroda', title: 'The Kuroda', body: 'Their "fire" is fuel. The lineage manifests a volatile liquid and lights it. Watch for the sheen before the flame.', pos: [-2.4, G.roofY, 18.8], rot: 0 },
    { id: 'eyes', title: 'Eyes', body: 'Five finite physical artifacts. Installing one permanently replaces a natural eye. They are not Techniques, and most people do not know they exist.', pos: [-12.6, H.deckY, -18.2], rot: 0.7 },
  ];
  for (const p of plaqueDefs) {
    const stand = new THREE.Group();
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.1, 0.12), woodDark);
    post.position.y = 0.55;
    post.castShadow = true;
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.46, 0.05), woodLight);
    board.position.set(0, 1.28, 0);
    board.rotation.x = -0.4;
    board.castShadow = true;
    const glyph = paintedSign('書', { width: 0.3, vertical: true, wood: PALETTE.woodLight });
    glyph.scale.set(0.3, 0.3, 1);
    glyph.position.set(0, 1.28, 0.035);
    glyph.rotation.x = -0.4;
    stand.add(post, board, glyph);
    stand.position.set(...p.pos);
    stand.rotation.y = p.rot ?? 0;
    g.add(stand);
    plaques.push({ id: p.id, title: p.title, body: p.body, position: new THREE.Vector3(...p.pos), mesh: stand, found: false });
  }

  // ---------------------------------------------------------------- helpers
  function lanternAt(x: number, y: number, z: number, hanging = false): void {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.5, 10), lanternMat);
    body.position.set(x, y, z);
    g.add(body);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.3, 0.14, 10), woodDark);
    cap.position.set(x, y + 0.32, z);
    g.add(cap);
    if (hanging) { const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.5, 4), iron); cord.position.set(x, y + 0.64, z); g.add(cord); }
    else { const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.7), woodDark); arm.position.set(x, y + 0.42, z + 0.3); g.add(arm); }
  }
  function stoneLantern(x: number, z: number): void {
    const add = (geo: THREE.BufferGeometry, y: number, mat: THREE.Material = stone): void => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m); };
    add(new THREE.CylinderGeometry(0.5, 0.6, 0.22, 8), 0.11);
    add(new THREE.CylinderGeometry(0.16, 0.22, 0.9, 8), 0.67);
    add(new THREE.CylinderGeometry(0.4, 0.4, 0.12, 6), 1.18);
    add(new THREE.CylinderGeometry(0.26, 0.26, 0.42, 6), 1.45, lanternMat);
    add(new THREE.ConeGeometry(0.62, 0.4, 6), 1.86, stoneDark);
    physics.staticBox(new THREE.Vector3(x, 1, z), new THREE.Vector3(0.4, 1, 0.4));
  }
  // A flight of 0.28 m steps from (x, y, z) along `dx`/`dz` (one of them ±1)
  // down to the ground, with a handrail on the open side.
  function stairs(x: number, y: number, z: number, dx: number, dz: number, width: number, sides: 'inner' | 'both'): void {
    const rise = 0.28, run = 0.42;
    const n = Math.round(y / rise);
    for (let i = 0; i < n; i++) {
      const top = y - i * rise;
      const cx2 = x + dx * (run * (i + 0.5)), cz2 = z + dz * (run * (i + 0.5));
      slab(woodLight, cx2, top / 2, cz2, dx ? run + 0.02 : width, top, dz ? run + 0.02 : width, { surface: 'wood' });
    }
    const len = n * run;
    const mx = x + dx * len / 2, mz = z + dz * len / 2;
    const side = dz ? width / 2 + 0.08 : 0, sidez = dx ? width / 2 + 0.08 : 0;
    const ang = Math.atan2(y, len);
    const railLen = Math.hypot(len, y);
    const railY = y / 2 + 1.0;
    const flanks = sides === 'both' ? [-1, 1] : [-1];
    for (const f of flanks) {
      if (dz) { slab(woodDark, mx + f * side, railY, mz, 0.08, 0.08, railLen, { rotX: dz * ang, collide: false }); physics.staticBox(new THREE.Vector3(mx + f * side, railY + 1, mz), new THREE.Vector3(0.05, 2.5, railLen / 2), new THREE.Quaternion().setFromEuler(new THREE.Euler(dz * ang, 0, 0))); for (let i = 0; i <= n; i += 4) slab(woodDark, mx + f * side, (y - i * rise) / 2 + 0.5, z + dz * run * i, 0.1, (y - i * rise) + 1.0, 0.1, { collide: false }); }
      else { slab(woodDark, mx, railY, mz + f * sidez, railLen, 0.08, 0.08, { rotZ: -dx * ang, collide: false }); physics.staticBox(new THREE.Vector3(mx, railY + 1, mz + f * sidez), new THREE.Vector3(railLen / 2, 2.5, 0.05), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -dx * ang))); for (let i = 0; i <= n; i += 4) slab(woodDark, x + dx * run * i, (y - i * rise) / 2 + 0.5, mz + f * sidez, 0.1, (y - i * rise) + 1.0, 0.1, { collide: false }); }
    }
  }
  // Sloped tile eaves around a deck, hanging from its edge.
  function eaves(x0: number, x1: number, z0: number, z1: number, y: number, reach: number, openBack: boolean, gaps: [number, number, number][] = [], roof = ''): void {
    const tilt = 0.5, drop = Math.sin(tilt) * reach, out = Math.cos(tilt) * reach;
    const e = (cx2: number, cz2: number, len: number, alongX: boolean, sign: number): void => {
      if (len < 0.05) return;
      const m = new THREE.Mesh(new THREE.BoxGeometry(alongX ? len : reach, 0.14, alongX ? reach : len), tile);
      m.position.set(cx2, y - drop / 2 + 0.02, cz2);
      if (alongX) m.rotation.x = sign * tilt; else m.rotation.z = -sign * tilt;
      m.castShadow = true;
      g.add(m);
      onRoof(m, roof);
      const edge = new THREE.Mesh(new THREE.BoxGeometry(alongX ? len : 0.18, 0.22, alongX ? 0.18 : len), tileEdge);
      edge.position.set(alongX ? cx2 : cx2 + sign * out, y - drop + 0.02, alongX ? cz2 + sign * out : cz2);
      g.add(edge);
      onRoof(edge, roof);
    };
    e((x0 + x1) / 2, z1 + out / 2, x1 - x0 + reach * 2, true, 1);
    if (!openBack) e((x0 + x1) / 2, z0 - out / 2, x1 - x0 + reach * 2, true, -1);
    for (const [fixed, sign] of [[x0 - out / 2, -1], [x1 + out / 2, 1]] as const) {
      const edgeX = sign < 0 ? x0 : x1;
      const cuts = [z0, ...gaps.filter((gp) => Math.abs(gp[0] - edgeX) < 0.01).flatMap((gp) => [gp[1], gp[2]]).sort((p, q) => p - q), z1];
      for (let i = 0; i < cuts.length; i += 2) e(fixed, (cuts[i]! + cuts[i + 1]!) / 2, cuts[i + 1]! - cuts[i]!, false, sign);
    }
  }
  // A knee-high wooden rail at a deck's edge with a tall invisible rail
  // above it. `gaps` are [edge coordinate, axis of the edge, from, to] runs
  // left open for a stair or a bridge.
  function deckRail(x0: number, x1: number, z0: number, z1: number, y: number, gaps: [number, 'x' | 'z', number, number][], roof = ''): void {
    const post = (x: number, z: number): void => { slab(woodDark, x, y + 0.45, z, 0.14, 0.9, 0.14, { collide: false, occluder: roof }); };
    const edges: { fixed: number; axis: 'x' | 'z'; a: number; b: number }[] = [{ fixed: z0, axis: 'z', a: x0, b: x1 }, { fixed: z1, axis: 'z', a: x0, b: x1 }, { fixed: x0, axis: 'x', a: z0, b: z1 }, { fixed: x1, axis: 'x', a: z0, b: z1 }];
    for (const ed of edges) {
      const mine = gaps.filter((gp) => gp[1] === ed.axis && Math.abs(gp[0] - ed.fixed) < 0.01);
      const cuts = [ed.a, ...mine.flatMap((gp) => [gp[2], gp[3]]).sort((p, q) => p - q), ed.b];
      for (let i = 0; i < cuts.length; i += 2) {
        const a = cuts[i]!, b = cuts[i + 1]!;
        if (b - a < 0.05) continue;
        if (ed.axis === 'z') { span(woodDark, a, b, y + 0.84, y + 0.92, ed.fixed - 0.05, ed.fixed + 0.05, { collide: false, occluder: roof }); rail((a + b) / 2, y + 5, ed.fixed, b - a, 10, 0.12); for (let p = a + 0.07; p <= b - 0.07; p += Math.max(1.5, (b - a) / Math.ceil((b - a) / 2.2))) post(p, ed.fixed); post(b - 0.07, ed.fixed); }
        else { span(woodDark, ed.fixed - 0.05, ed.fixed + 0.05, y + 0.84, y + 0.92, a, b, { collide: false, occluder: roof }); rail(ed.fixed, y + 5, (a + b) / 2, 0.12, 10, b - a); for (let p = a + 0.07; p <= b - 0.07; p += Math.max(1.5, (b - a) / Math.ceil((b - a) / 2.2))) post(ed.fixed, p); post(ed.fixed, b - 0.07); }
      }
    }
  }

  // A stylized tree: a trunk and a faceted crown. Maples are orange, golds
  // yellow, pines a stack of green cones. `seed` varies the lean and the crown.
  function tree(x: number, z: number, kind: 'maple' | 'gold' | 'pine', scale: number, seed: number): void {
    const t = new THREE.Group();
    const trunkH = (kind === 'pine' ? 1.6 : 2.4) * scale;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * scale, 0.26 * scale, trunkH, 7), woodDark);
    trunk.position.y = trunkH / 2;
    trunk.castShadow = true;
    t.add(trunk);
    if (kind === 'pine') {
      const green = toon(0x3e7d4a);
      for (let i = 0; i < 3; i++) {
        const c = new THREE.Mesh(faceted(new THREE.ConeGeometry((2.0 - i * 0.45) * scale, 2.2 * scale, 7)), green);
        c.position.y = trunkH + (0.6 + i * 1.3) * scale;
        c.rotation.y = seed + i;
        c.castShadow = true;
        t.add(c);
      }
    } else {
      const crown = toon(kind === 'maple' ? 0xe8713a : 0xe6b83c);
      for (let i = 0; i < 4; i++) {
        const r = (1.5 + ((seed * 7 + i * 3) % 4) * 0.2) * scale;
        const c = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), crown);
        const a = seed * 1.3 + i * 1.7;
        c.position.set(Math.cos(a) * 0.9 * scale, trunkH + (0.6 + (i % 2) * 0.9) * scale, Math.sin(a) * 0.9 * scale);
        c.castShadow = true;
        t.add(c);
      }
    }
    t.position.set(x, 0, z);
    t.rotation.set(0, seed, (seed % 3 - 1) * 0.03);
    g.add(t);
    physics.staticBox(new THREE.Vector3(x, trunkH / 2, z), new THREE.Vector3(0.3 * scale, trunkH / 2, 0.3 * scale));
  }

  const roofZone: Zone = { id: 'roof', min: new THREE.Vector3(-HX - 2, 2.3, -HZ - 2), max: new THREE.Vector3(HX + 2, 40, HZ + 2), label: 'Rooftops' };
  zones.push(roofZone);
  return {
    group: g, zones, footprints, plaques, craneHook: hook, occluders, onRoof,
    pond: { center: P.center, radius: P.radius, surfaceY: P.surfaceY },
    zoneAt(p) {
      // Specific places first, the courtyard as the ground floor's default, the roofs by height.
      for (const z of zones) if (z.id !== 'courtyard' && z.id !== 'roof' && inside(z, p)) return z;
      if (p.y >= roofZone.min.y) return roofZone;
      const yard = zones.find((z) => z.id === 'courtyard')!;
      return inside(yard, p) ? yard : null;
    },
    indoorsAt(p) {
      for (const z of zones) if (z.indoors && inside(z, p)) {
        const edge = Math.min(p.x - z.min.x, z.max.x - p.x, p.z - z.min.z, z.max.z - p.z);
        return THREE.MathUtils.clamp(edge / 2, 0, 1);
      }
      return 0;
    },
    update(time) { for (const a of animated) a.update(time); },
  };
}

function inside(z: Zone, p: THREE.Vector3): boolean {
  return p.x >= z.min.x && p.x <= z.max.x && p.y >= z.min.y && p.y <= z.max.y && p.z >= z.min.z && p.z <= z.max.z;
}
