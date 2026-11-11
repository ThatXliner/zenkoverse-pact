import * as THREE from 'three';
import type { Assets } from '../app/assets';
import { Physics, RAPIER } from '../physics/world';
import { makeSurface, emissive, glass } from '../render/materials';
import { facadeMaterial } from './facade';
import { NeonSign, type NeonDef } from './neon';
import { PropSystem } from './props';
import type { LightPool } from '../render/lightPool';

export type ZoneId = 'academy' | 'dojo' | 'market' | 'alley' | 'rooftop' | 'bridge' | 'kuroda' | 'canal';

export interface Zone { id: ZoneId; min: THREE.Vector3; max: THREE.Vector3; indoors?: boolean; label: string }

export interface Plaque { id: string; title: string; body: string; position: THREE.Vector3; mesh: THREE.Object3D; found: boolean }

export const SPAWN = { academy: new THREE.Vector3(-58, 0, -52), dojo: new THREE.Vector3(-26, 0, -66), market: new THREE.Vector3(-20, 0, 2), alley: new THREE.Vector3(22, 0, 30), bridge: new THREE.Vector3(60, 0, 0), kuroda: new THREE.Vector3(52, 0, 58), roof: new THREE.Vector3(-8, 14.2, -16) };

interface BuildingDef { model: string; x: number; z: number; rot: number; scale?: number; wall: 'Bricks059' | 'Concrete034' | 'PaintedPlaster017' | 'Marble012'; warm?: number }

const BUILDINGS: BuildingDef[] = [
  { model: 'building-j', x: -14, z: -16, rot: 0, scale: 7.5, wall: 'Bricks059' },
  { model: 'building-k', x: -30, z: -16, rot: 0, scale: 7.5, wall: 'Concrete034' },
  { model: 'building-l', x: -46, z: -16, rot: 0, scale: 7.5, wall: 'PaintedPlaster017' },
  { model: 'building-m', x: 12, z: -16, rot: 0, scale: 7.5, wall: 'Bricks059' },
  { model: 'building-n', x: 30, z: -17, rot: 0, scale: 7.5, wall: 'Concrete034' },
  { model: 'building-skyscraper-b', x: 46, z: -22, rot: 0, scale: 7.5, wall: 'Concrete034', warm: 0.3 },
  { model: 'building-i', x: -14, z: 16, rot: Math.PI, scale: 7.5, wall: 'PaintedPlaster017' },
  { model: 'building-h', x: -30, z: 16, rot: Math.PI, scale: 7.5, wall: 'Bricks059' },
  { model: 'building-g', x: -46, z: 16, rot: Math.PI, scale: 7.5, wall: 'Concrete034' },
  { model: 'building-f', x: 12, z: 16, rot: Math.PI, scale: 7.5, wall: 'Bricks059' },
  { model: 'building-e', x: 28, z: 16, rot: Math.PI, scale: 7.5, wall: 'PaintedPlaster017' },
  { model: 'building-d', x: 44, z: 16, rot: Math.PI, scale: 7.5, wall: 'Concrete034' },
  { model: 'building-c', x: 12, z: 46, rot: 0, scale: 7.5, wall: 'Bricks059' },
  { model: 'building-b', x: 28, z: 46, rot: 0, scale: 7.5, wall: 'Concrete034' },
  { model: 'building-a', x: -14, z: 46, rot: 0, scale: 7.5, wall: 'PaintedPlaster017' },
  { model: 'building-skyscraper-a', x: -36, z: 50, rot: 0.2, scale: 7.5, wall: 'Concrete034', warm: 0.4 },
  { model: 'building-skyscraper-d', x: -64, z: 20, rot: Math.PI / 2, scale: 7.5, wall: 'Marble012', warm: 0.2 },
  { model: 'building-skyscraper-c', x: 30, z: -50, rot: 0, scale: 7.5, wall: 'Concrete034', warm: 0.5 },
  { model: 'building-skyscraper-e', x: 8, z: -52, rot: 0.1, scale: 7.5, wall: 'Bricks059' },
  { model: 'building-e', x: -14, z: -48, rot: 0, scale: 7.5, wall: 'PaintedPlaster017' },
  { model: 'building-type-t', x: -42, z: -82, rot: 0, scale: 7, wall: 'PaintedPlaster017', warm: 1 },
  { model: 'building-type-m', x: -70, z: -80, rot: 0.4, scale: 7, wall: 'Concrete034', warm: 1 },
  { model: 'building-type-a', x: 48, z: 76, rot: Math.PI, scale: 7.5, wall: 'PaintedPlaster017', warm: 1 },
  { model: 'building-type-f', x: 72, z: 60, rot: -Math.PI / 2, scale: 7, wall: 'Bricks059', warm: 1 },
];

const NEONS: NeonDef[] = [
  { text: '契約', color: 0xff3a6e, position: [-22, 7.5, -9.6], rotationY: 0, vertical: true, flicker: 0.1 },
  { text: 'ラーメン 夜', color: 0xffb13b, position: [-34, 6.2, -9.6], rotationY: 0, width: 5 },
  { text: '技の店', color: 0x4dd8ff, position: [4, 6.6, -9.6], rotationY: 0, width: 4 },
  { text: '酒', color: 0xff5b2e, position: [20, 8, -9.6], rotationY: 0, vertical: true, flicker: 0.25 },
  { text: 'BLINK', color: 0xc6a8ff, position: [36, 7.2, -10], rotationY: 0, width: 4.4, flicker: 0.05 },
  { text: '無', color: 0x7dffb2, position: [-8, 7.4, 9.6], rotationY: Math.PI, vertical: true },
  { text: 'PACT', color: 0xff3a6e, position: [-28, 6.5, 9.6], rotationY: Math.PI, width: 4 },
  { text: '湯', color: 0xffd34d, position: [14, 6.4, 9.6], rotationY: Math.PI, vertical: true, flicker: 0.3 },
  { text: '氷', color: 0x9fe8ff, position: [30, 6.8, 9.6], rotationY: Math.PI, vertical: true },
  { text: 'ECHO', color: 0x7dffb2, position: [17.6, 9, 30], rotationY: Math.PI / 2, width: 3.6, flicker: 0.4 },
  { text: '黒田', color: 0xff6a1a, position: [52, 4.6, 51.5], rotationY: Math.PI, width: 2.6, light: true },
  { text: '道場', color: 0xffd9a0, position: [-26, 4.4, -59.4], rotationY: 0, width: 2.4 },
];

export interface District {
  group: THREE.Group;
  zones: Zone[];
  plaques: Plaque[];
  neons: NeonSign[];
  craneHook: THREE.Object3D;
  zoneAt(p: THREE.Vector3): Zone | null;
  indoorsAt(p: THREE.Vector3): number;
  update(time: number): void;
}

export function buildDistrict(assets: Assets, physics: Physics, scene: THREE.Scene, props: PropSystem, lights: LightPool): District {
  const g = new THREE.Group();
  scene.add(g);
  const zones: Zone[] = [];
  const plaques: Plaque[] = [];
  const neons: NeonSign[] = [];

  const asphalt = makeSurface(assets, 'Asphalt012', { repeat: 36, wet: 1, puddles: true, roughness: 0.95 });
  const paving = makeSurface(assets, 'PavingStones138', { repeat: 30, wet: 0.9, puddles: true, roughness: 0.9 });
  const courtyard = makeSurface(assets, 'Tiles074', { repeat: 20, wet: 0.9, puddles: true, color: 0xb8b4ae });
  const concrete = makeSurface(assets, 'Concrete034', { repeat: 8, wet: 0.7 });
  const steel = makeSurface(assets, 'MetalPlates006', { repeat: 6, wet: 0.8, metalness: 0.85, roughness: 0.5 });
  const rust = makeSurface(assets, 'Rust004', { repeat: 2, wet: 0.5, metalness: 0.6, roughness: 0.7 });
  const woodFloor = makeSurface(assets, 'WoodFloor051', { repeat: 6, roughness: 0.55 });
  const plaster = makeSurface(assets, 'PaintedPlaster017', { repeat: 3, color: 0xe8dcc8 });
  const planks = makeSurface(assets, 'Planks012', { repeat: 4, wet: 0.6 });
  const corrugated = makeSurface(assets, 'CorrugatedSteel005', { repeat: 4, wet: 0.8, metalness: 0.7, roughness: 0.5 });
  const brick = makeSurface(assets, 'Bricks059', { repeat: 6, wet: 0.5 });

  const pointLight = (color: number, intensity: number, distance: number, x: number, y: number, z: number): void => {
    lights.add({ kind: 'point', position: new THREE.Vector3(x, y, z), color: new THREE.Color(color), intensity, distance, decay: 2 });
  };

  const slab = (mat: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number, rotY = 0, surface = 'concrete', shadow = true): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    m.receiveShadow = true;
    m.castShadow = shadow;
    g.add(m);
    const col = physics.staticBox(new THREE.Vector3(x, y, z), new THREE.Vector3(w / 2, h / 2, d / 2), rotY ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY) : undefined);
    (col as RAPIER.Collider & { surfaceTag?: string }).surfaceTag = surface;
    return m;
  };

  // Ground: asphalt with raised sidewalks along the two main streets.
  slab(asphalt, 0, -0.25, 0, 240, 0.5, 240, 0, 'concrete', false);
  const walk = 0.14;
  for (const z of [-7.5, 7.5]) slab(paving, 0, walk / 2, z, 160, walk, 3.2, 0, 'concrete', false);
  for (const x of [-6.5, 6.5]) { slab(paving, x, walk / 2, -40, 3.2, walk, 56, 0, 'concrete', false); slab(paving, x, walk / 2, 36, 3.2, walk, 48, 0, 'concrete', false); }
  // Academy courtyard and dojo floor.
  slab(courtyard, -58, walk / 2 + 0.02, -58, 44, walk + 0.04, 40, 0, 'concrete', false);
  slab(brick, -58, 0.6, -79, 44, 1.2, 0.6);
  slab(brick, -80, 0.6, -58, 0.6, 1.2, 40);
  slab(brick, -36, 0.6, -70, 0.6, 1.2, 18);
  // Alley floor (east of x=6.5, between the south blocks) and canal edge.
  slab(concrete, 20, walk / 2, 31, 14, walk, 30, 0, 'concrete', false);

  // Canal: a trench with a water plane and a steel bridge across it at z=0.
  const canalX = 70;
  slab(concrete, canalX - 9.5, -1.5, 0, 1, 3, 200);
  slab(concrete, canalX + 9.5, -1.5, 0, 1, 3, 200);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(18, 200), new THREE.MeshPhysicalMaterial({ color: 0x06111a, roughness: 0.05, metalness: 0.1, envMapIntensity: 1.8, transparent: true, opacity: 0.92 }));
  water.rotation.x = -Math.PI / 2;
  water.position.set(canalX, -2.6, 0);
  g.add(water);
  physics.staticBox(new THREE.Vector3(canalX, -3.4, 0), new THREE.Vector3(9, 0.5, 100));
  slab(steel, canalX, -0.15, 0, 22, 0.3, 7, 0, 'metal');
  for (const side of [-1, 1]) {
    slab(rust, canalX, 0.6, side * 3.4, 22, 1.2, 0.12);
    for (let i = -10; i <= 10; i += 2.5) slab(rust, canalX + i, 1.6, side * 3.4, 0.12, 3.2, 0.12);
    slab(rust, canalX, 3.2, side * 3.4, 22, 0.14, 0.14);
  }
  for (const x of [canalX - 6, canalX + 6]) slab(concrete, x, -2, 0, 1.4, 3.2, 7.4);

  // Buildings: Kenney shells re-skinned with the facade shader. Box colliders from their bounds.
  const palette = (assets.model('props/building-a').scene.children[0] as THREE.Mesh | undefined)?.material as THREE.MeshStandardMaterial | undefined;
  const facades = new Map<string, THREE.MeshStandardMaterial>();
  const facadeFor = (wall: BuildingDef['wall'], warm: number): THREE.MeshStandardMaterial => {
    const key = `${wall}-${warm}`;
    let m = facades.get(key);
    if (!m) { m = facadeMaterial(assets, palette?.map ?? null, wall, 'Concrete034', { windowWarmth: warm, scale: 0.34 }); facades.set(key, m); }
    return m;
  };
  const roofTops: { x: number; z: number; y: number; w: number; d: number }[] = [];
  for (const b of BUILDINGS) {
    const src = assets.model(`props/${b.model}`).scene;
    const inst = src.clone(true);
    const s = b.scale ?? 7.5;
    inst.scale.setScalar(s);
    inst.position.set(b.x, 0, b.z);
    inst.rotation.y = b.rot;
    inst.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        const m = o as THREE.Mesh;
        m.castShadow = true;
        m.receiveShadow = true;
        const pal = (m.material as THREE.MeshStandardMaterial).map;
        m.material = facadeFor(b.wall, b.warm ?? 0.8);
        if (pal && !(m.material as THREE.MeshStandardMaterial).map) (m.material as THREE.MeshStandardMaterial).map = pal;
      }
    });
    g.add(inst);
    inst.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(inst);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const col = physics.staticBox(center, size.clone().multiplyScalar(0.5));
    (col as RAPIER.Collider & { surfaceTag?: string }).surfaceTag = 'concrete';
    roofTops.push({ x: center.x, z: center.z, y: box.max.y, w: size.x, d: size.z });
  }

  // Rooftop access: a fire escape of steel landings up the side of building-j.
  const fe = roofTops[0]!;
  const landings = Math.floor(fe.y / 2.2);
  for (let i = 1; i <= landings; i++) {
    const y = i * 2.2;
    const zOff = (i % 2 === 0 ? -1 : 1) * 1.5;
    slab(steel, fe.x - fe.w / 2 - 1.3, y, fe.z + zOff, 2.4, 0.12, 3.2, 0, 'metal');
    slab(rust, fe.x - fe.w / 2 - 2.45, y + 0.55, fe.z + zOff, 0.08, 1.1, 3.2);
  }
  slab(steel, fe.x - fe.w / 2 - 1.3, 1.1, fe.z + 3.6, 2.4, 0.12, 1.4, 0, 'metal');
  props.spawn('crate', new THREE.Vector3(fe.x - fe.w / 2 - 1.3, 0, fe.z + 5.6));
  props.spawn('crate', new THREE.Vector3(fe.x - fe.w / 2 - 3.6, 0, fe.z + 5.4));
  // Rooftop dressing: vents, water tank, parapets.
  for (const r of roofTops.slice(0, 6)) {
    slab(concrete, r.x, r.y + 0.35, r.z - r.d / 2 + 0.2, r.w, 0.7, 0.4);
    slab(concrete, r.x, r.y + 0.35, r.z + r.d / 2 - 0.2, r.w, 0.7, 0.4);
    slab(corrugated, r.x + r.w * 0.25, r.y + 0.6, r.z, 1.6, 1.2, 1.2, 0, 'metal');
  }

  // Street lights with warm sodium spots.
  const lampModel = assets.model('props/light-curved').scene;
  const lampPositions: [number, number, number][] = [];
  for (let x = -70; x <= 50; x += 20) { lampPositions.push([x, -9.4, 0]); lampPositions.push([x + 10, 9.4, Math.PI]); }
  for (let z = -40; z <= 60; z += 25) { lampPositions.push([-8.4, z, Math.PI / 2]); }
  lampPositions.push([-58, -40, 0], [-72, -58, Math.PI / 2], [canalX - 11, 6, -Math.PI / 2], [canalX + 11, -6, Math.PI / 2], [20, 46, 0], [52, 50, Math.PI]);
  lampPositions.forEach(([x, z, rot]) => {
    const l = lampModel.clone(true);
    l.scale.setScalar(7.5);
    l.position.set(x, 0, z);
    l.rotation.y = rot;
    l.traverse((o) => { if ((o as THREE.Mesh).isMesh) { (o as THREE.Mesh).castShadow = true; const mm = (o as THREE.Mesh).material as THREE.MeshStandardMaterial; (o as THREE.Mesh).material = new THREE.MeshStandardMaterial({ map: mm.map, color: 0x3a3d44, roughness: 0.45, metalness: 0.8 }); } });
    g.add(l);
    physics.staticBox(new THREE.Vector3(x, 3, z), new THREE.Vector3(0.18, 3, 0.18));
    const head = new THREE.Vector3(Math.sin(rot) * -1.9, 6.6, Math.cos(rot) * -1.9).add(new THREE.Vector3(x, 0, z));
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), emissive(0xffc36a, 7));
    bulb.position.copy(head);
    g.add(bulb);
    lights.add({ kind: 'spot', position: head, target: head.clone().setY(0), color: new THREE.Color(0xffb45a), intensity: 160, distance: 24, decay: 1.6, angle: 0.95, penumbra: 0.55 });
  });

  // Neon signs over the market street and the alley.
  for (const n of NEONS) { const s = new NeonSign(n); g.add(s.group); neons.push(s); if (s.light) lights.add(s.light); }

  // Market stalls: awning props with goods on crates.
  const awning = assets.model('props/detail-awning-wide').scene;
  const stallX = [-40, -26, -2, 18, 34];
  stallX.forEach((x, i) => {
    const z = i % 2 === 0 ? -7.8 : 7.8;
    const a = awning.clone(true);
    a.scale.setScalar(7.5);
    a.position.set(x, 2.6, z + (z > 0 ? 0.6 : -0.6));
    a.rotation.y = z > 0 ? Math.PI : 0;
    a.traverse((o) => { if ((o as THREE.Mesh).isMesh) { (o as THREE.Mesh).castShadow = true; } });
    g.add(a);
    slab(planks, x, 0.5, z, 3.4, 1, 1.2, 0, 'wood');
    pointLight(0xffc98a, 22, 9, x, 2.3, z);
    const goods = ['steamer', 'pot', 'can', 'sodaCan', 'cardboard'];
    for (let k = 0; k < 3; k++) props.spawn(goods[(i + k) % goods.length]!, new THREE.Vector3(x - 1 + k, 1.02, z));
    props.spawn('crate', new THREE.Vector3(x + 2.6, 0.14, z));
  });

  // Parked cars along the curb, wet paint catching the neon.
  const cars = ['kk-car_sedan', 'kk-car_taxi', 'kk-car_hatchback', 'kk-car_stationwagon'];
  [[-52, -4.6, 0], [-36, 4.6, Math.PI], [-10, -4.6, 0], [6, 4.6, Math.PI], [24, -4.6, 0], [44, 4.6, Math.PI], [-5.2, -30, Math.PI / 2], [5.2, 28, -Math.PI / 2]].forEach(([x, z, rot], i) => {
    const car = assets.model(`props/${cars[i % cars.length]}`).scene.clone(true);
    car.scale.setScalar(4.2);
    car.position.set(x!, 0, z!);
    car.rotation.y = rot!;
    car.traverse((o) => { if ((o as THREE.Mesh).isMesh) { const m = o as THREE.Mesh; m.castShadow = true; m.receiveShadow = true; const mm = (m.material as THREE.MeshStandardMaterial).clone(); mm.roughness = 0.18; mm.metalness = 0.35; mm.envMapIntensity = 1.4; m.material = mm; } });
    g.add(car);
    const along = Math.abs(Math.cos(rot!)) > 0.5 ? [2.1, 1.0] : [1.0, 2.1];
    physics.staticBox(new THREE.Vector3(x!, 0.75, z!), new THREE.Vector3(along[0]!, 0.75, along[1]!));
  });

  // Vending machines: glowing boxes against the north facades.
  for (const x of [-18, 8, 26]) {
    slab(steel, x, 1, -9.3, 1.1, 2, 0.9, 0, 'metal');
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.6), new THREE.MeshStandardMaterial({ color: 0x0b1118, emissive: 0x7fd0ff, emissiveIntensity: 1.8, roughness: 0.2 }));
    face.position.set(x, 1.1, -8.84);
    g.add(face);
    pointLight(0x9fdfff, 10, 6, x, 1.2, -8.2);
  }

  // Alley: dumpsters, crates, puddled concrete, a steam vent.
  const dumpster = assets.model('props/dumpster').scene;
  for (const [x, z] of [[14.5, 24], [25.5, 38]] as const) {
    const d = dumpster.clone(true);
    d.scale.setScalar(7.5);
    d.position.set(x, 0, z);
    d.rotation.y = x < 20 ? Math.PI / 2 : -Math.PI / 2;
    d.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
    g.add(d);
    physics.staticBox(new THREE.Vector3(x, 0.8, z), new THREE.Vector3(1.0, 0.8, 1.8));
  }
  for (let i = 0; i < 8; i++) props.spawn(i % 3 === 0 ? 'crate' : i % 3 === 1 ? 'cardboard' : 'barrel', new THREE.Vector3(15 + (i % 4) * 2.3, 0.1, 27 + Math.floor(i / 4) * 9));
  props.spawn('trashA', new THREE.Vector3(24, 0, 22));
  props.spawn('trashB', new THREE.Vector3(26, 0, 23));

  // Dojo (Pact Workshop): wood floor, plaster walls, an open front toward the courtyard.
  const dx = -26, dz = -66;
  slab(woodFloor, dx, 0.22, dz, 14, 0.44, 12, 0, 'wood');
  slab(plaster, dx, 2.5, dz - 6, 14, 5, 0.3);
  slab(plaster, dx - 7, 2.5, dz, 0.3, 5, 12);
  slab(plaster, dx + 7, 2.5, dz, 0.3, 5, 12);
  slab(plaster, dx - 5, 2.5, dz + 6, 4, 5, 0.3);
  slab(plaster, dx + 5, 2.5, dz + 6, 4, 5, 0.3);
  slab(planks, dx, 5.1, dz, 15, 0.3, 13.5);
  const roofTile = makeSurface(assets, 'RoofingTiles003', { repeat: 5, wet: 0.7 });
  const roof = new THREE.Mesh(new THREE.ConeGeometry(11, 2.6, 4), roofTile);
  roof.rotation.y = Math.PI / 4;
  roof.position.set(dx, 6.5, dz);
  roof.castShadow = true;
  g.add(roof);
  const lanternMat = emissive(0xffb36b, 3.5);
  for (const [lx, lz] of [[dx - 5, dz + 7], [dx + 5, dz + 7], [dx - 4, dz - 4], [dx + 4, dz - 4]] as const) {
    const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.5, 12), lanternMat);
    lantern.position.set(lx, 2.6, lz);
    g.add(lantern);
    pointLight(0xffb36b, 16, 9, lx, 2.5, lz);
  }
  const place = (model: string, x: number, y: number, z: number, rot = 0, s = 1): void => {
    const m = assets.model(model).scene.clone(true);
    m.scale.setScalar(s);
    m.position.set(x, y, z);
    m.rotation.y = rot;
    m.traverse((o) => { if ((o as THREE.Mesh).isMesh) { (o as THREE.Mesh).castShadow = true; (o as THREE.Mesh).receiveShadow = true; } });
    g.add(m);
  };
  place('props/furn-bookcaseOpen', dx - 6.4, 0.44, dz - 3, Math.PI / 2);
  place('props/furn-bookcaseOpen', dx - 6.4, 0.44, dz - 1, Math.PI / 2);
  place('props/furn-desk', dx + 3, 0.44, dz - 4.6, Math.PI);
  place('props/furn-rugRectangle', dx, 0.45, dz - 1, 0, 2.2);
  place('props/furn-lampSquareFloor', dx + 6.2, 0.44, dz - 5.2);
  place('props/furn-pottedPlant', dx - 6.2, 0.44, dz + 5);
  place('props/furn-radio', dx + 4, 1.0, dz - 4.8);
  physics.staticBox(new THREE.Vector3(dx + 3, 0.9, dz - 4.6), new THREE.Vector3(0.9, 0.45, 0.5));
  for (let i = 0; i < 3; i++) props.spawn('dummy', new THREE.Vector3(dx - 3 + i * 3, 0.44, dz + 2.5));
  zones.push({ id: 'dojo', min: new THREE.Vector3(dx - 7, -1, dz - 6), max: new THREE.Vector3(dx + 7, 6, dz + 6), indoors: true, label: 'Pact Workshop' });

  // Academy courtyard: a crane for the Recoil drill, dummies, lanterns.
  const cx = -62, cz = -60;
  slab(steel, cx, 6, cz, 0.6, 12, 0.6, 0, 'metal');
  slab(steel, cx, 12.2, cz + 4, 0.5, 0.5, 9, 0, 'metal');
  const hook = new THREE.Group();
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 3, 6), new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.9, roughness: 0.4 }));
  cable.position.y = 1.5;
  const hookMesh = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.05, 8, 16), new THREE.MeshStandardMaterial({ color: 0x555a60, metalness: 0.9, roughness: 0.35 }));
  hook.add(cable, hookMesh);
  hook.position.set(cx, 9, cz + 7.5);
  g.add(hook);
  for (let i = 0; i < 4; i++) props.spawn('dummy', new THREE.Vector3(cx + 10 + i * 2.5, 0.16, cz + 2));
  for (let i = 0; i < 5; i++) props.spawn('crate', new THREE.Vector3(cx + 6 + i * 1.3, 0.16, cz - 12));
  lights.add({ kind: 'point', position: new THREE.Vector3(cx + 8, 7, cz - 2), color: new THREE.Color(0xdfe8ff), intensity: 40, distance: 30, decay: 1.8 });
  zones.push({ id: 'academy', min: new THREE.Vector3(-80, -1, -79), max: new THREE.Vector3(-36, 20, -38), label: 'Academy courtyard' });

  // Kuroda house: a lit house with a warm fence line and lanterns that burn fuel.
  const kx = 52, kz = 60;
  slab(paving, kx, walk / 2, kz - 4, 24, walk, 14, 0, 'concrete', false);
  const fence = assets.model('props/fence-1x3').scene;
  for (let i = -3; i <= 3; i++) {
    const f = fence.clone(true);
    f.scale.setScalar(7);
    f.position.set(kx + i * 3.4, 0, kz - 11);
    f.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
    g.add(f);
  }
  physics.staticBox(new THREE.Vector3(kx - 10, 0.6, kz - 11), new THREE.Vector3(8.2, 0.6, 0.15));
  physics.staticBox(new THREE.Vector3(kx + 10, 0.6, kz - 11), new THREE.Vector3(8.2, 0.6, 0.15));
  for (const [lx, lz] of [[kx - 5, kz - 10], [kx + 5, kz - 10], [kx - 8, kz - 2], [kx + 8, kz - 2]] as const) {
    const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 0.6, 10), emissive(0xff7a2a, 4));
    lantern.position.set(lx, 1.9, lz);
    g.add(lantern);
    slab(rust, lx, 0.8, lz, 0.14, 1.6, 0.14);
    pointLight(0xff7a2a, 20, 10, lx, 1.9, lz);
  }
  for (let i = 0; i < 4; i++) props.spawn('barrel', new THREE.Vector3(kx - 9 + i * 1.6, 0.14, kz - 7));
  zones.push({ id: 'kuroda', min: new THREE.Vector3(kx - 14, -1, kz - 12), max: new THREE.Vector3(kx + 14, 12, kz + 6), label: 'Kuroda house' });

  zones.push({ id: 'market', min: new THREE.Vector3(-60, -1, -7), max: new THREE.Vector3(56, 12, 7), label: 'Market street' });
  zones.push({ id: 'alley', min: new THREE.Vector3(12, -1, 20), max: new THREE.Vector3(30, 12, 44), label: 'Back alley' });
  zones.push({ id: 'bridge', min: new THREE.Vector3(canalX - 12, -1, -4), max: new THREE.Vector3(canalX + 12, 12, 4), label: 'Canal bridge' });
  zones.push({ id: 'canal', min: new THREE.Vector3(canalX - 9, -4, -100), max: new THREE.Vector3(canalX + 9, -0.5, 100), label: 'Canal' });
  zones.push({ id: 'rooftop', min: new THREE.Vector3(-100, 9, -100), max: new THREE.Vector3(100, 60, 100), label: 'Rooftops' });

  // Lore plaques: glass stands with short wiki excerpts.
  const plaqueDefs: { id: string; title: string; body: string; pos: [number, number, number] }[] = [
    { id: 'technique', title: 'Technique', body: 'A person\'s underlying, unique supernatural capability. Everyone has one, usually exactly one. Most are weak, narrow, or useful only outside combat.', pos: [-50, 0, -42] },
    { id: 'pact', title: 'Pact', body: 'Every application of a Technique is formulated through a Pact, down to "if I will activation, activate." A Pact is how an Ability exists at all.', pos: [dx + 8, 0, dz + 7] },
    { id: 'resolve', title: 'Resolve', body: 'The real capability surrendered, not emotional intensity. The same sacrifice cannot be counted twice.', pos: [-12, 0, 6] },
    { id: 'wager', title: 'Wager', body: 'Declare an uncertain outcome. Success grants an enlarged reward; failure applies the forfeit.', pos: [20, 0, 20] },
    { id: 'aura', title: 'Aurabending', body: 'A separate universal faculty, formalized only twenty years ago despite five thousand years of Technique history. Aura does not fuel Techniques.', pos: [canalX - 11, 0, 5] },
    { id: 'kuroda', title: 'The Kuroda', body: 'Their "fire" is fuel. The lineage manifests a volatile liquid and lights it. Watch for the sheen before the flame.', pos: [kx - 12, 0, kz - 9] },
    { id: 'eyes', title: 'Eyes', body: 'Five finite physical artifacts. Installing one permanently replaces a natural eye. They are not Techniques, and most people do not know they exist.', pos: [-8, 14.4, -16] },
  ];
  for (const p of plaqueDefs) {
    const stand = new THREE.Group();
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.1, 0.08), new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.8, roughness: 0.4 }));
    post.position.y = 0.55;
    const pane = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.03), glass(0xa8d8ff));
    pane.position.set(0, 1.25, 0);
    pane.rotation.x = -0.35;
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.3), emissive(0x9fdfff, 1.6));
    glow.position.set(0, 1.25, 0.02);
    glow.rotation.x = -0.35;
    stand.add(post, pane, glow);
    stand.position.set(...p.pos);
    g.add(stand);
    plaques.push({ id: p.id, title: p.title, body: p.body, position: new THREE.Vector3(...p.pos), mesh: stand, found: false });
  }

  // Distant skyline silhouettes so the horizon is not empty.
  const lowMat = new THREE.MeshStandardMaterial({ color: 0x0c0f16, roughness: 0.9 });
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const r = 150 + Math.sin(i * 3.1) * 25;
    const h = 20 + Math.abs(Math.sin(i * 1.7)) * 45;
    const m = new THREE.Mesh(new THREE.BoxGeometry(14 + (i % 3) * 6, h, 14), lowMat);
    m.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r);
    m.rotation.y = a;
    g.add(m);
    for (let k = 0; k < 12; k++) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.6), emissive(k % 3 === 0 ? 0xffc27a : 0x9fcfff, 1.2));
      w.position.set(Math.cos(a) * (r - 7.5), 3 + (k % 6) * (h / 7), Math.sin(a) * (r - 7.5) + (k > 5 ? 3 : -3));
      w.lookAt(0, w.position.y, 0);
      g.add(w);
    }
  }

  const district: District = {
    group: g, zones, plaques, neons, craneHook: hook,
    zoneAt(p) {
      for (const z of zones) if (z.id !== 'rooftop' && p.x >= z.min.x && p.x <= z.max.x && p.y >= z.min.y && p.y <= z.max.y && p.z >= z.min.z && p.z <= z.max.z) return z;
      const roof = zones.find((z) => z.id === 'rooftop')!;
      return p.y >= roof.min.y ? roof : null;
    },
    indoorsAt(p) {
      for (const z of zones) if (z.indoors && p.x >= z.min.x && p.x <= z.max.x && p.z >= z.min.z && p.z <= z.max.z && p.y < z.max.y) {
        const edge = Math.min(p.x - z.min.x, z.max.x - p.x, p.z - z.min.z, z.max.z - p.z);
        return THREE.MathUtils.clamp(edge / 2, 0, 1);
      }
      return 0;
    },
    update(time) { for (const n of neons) n.update(time); },
  };
  return district;
}
