import * as THREE from 'three';
import type { Assets } from '../app/assets';
import { Physics, RAPIER } from '../physics/world';
import { makeSurface, emissive } from '../render/materials';
import { NeonSign } from '../world/neon';
import type { PropSystem } from '../world/props';
import type { LightPool } from '../render/lightPool';
import { SPAWN } from '../world/district';

// The rooftop that hosts the trial: a tower on the east bank of the canal,
// across the bridge from the Ancient Echo Master's fight. The deck is a
// closed fighting floor, so nobody falls off and every wave stays on screen.

const SIZE = { x: 30, z: 24, h: 15 };
// The street end of the lift is SPAWN.rooftop, which the map and the waypoints read; the tower stands behind it.
const TOWER = new THREE.Vector3(SPAWN.rooftop.x + SIZE.x / 2 + 2.4, 0, SPAWN.rooftop.z);
const DECK_Y = SIZE.h + 0.2;
const PARAPET = { h: 1.15, t: 0.5 };
const WALL_TOP = 7;

export interface Arena {
  group: THREE.Group;
  deckY: number;
  center: THREE.Vector3;
  half: { x: number; z: number };
  start: THREE.Vector3;
  slots: THREE.Vector3[];
  liftBase: THREE.Vector3;
  liftTop: THREE.Vector3;
  consoleAt: THREE.Vector3;
  liftDownAt: THREE.Vector3;
  update(time: number): void;
}

// One flank of the tower: a 3 m grid of framed windows, each lit or dark on
// its own, with floor bands and piers between them. The glow map drives bloom.
function flank(cols: number, rows: number): { map: THREE.CanvasTexture; glow: THREE.CanvasTexture } {
  const cell = 64;
  const w = cols * cell, h = rows * cell;
  const wall = document.createElement('canvas');
  const glow = document.createElement('canvas');
  wall.width = glow.width = w;
  wall.height = glow.height = h;
  const c = wall.getContext('2d')!;
  const e = glow.getContext('2d')!;
  c.fillStyle = '#25272d';
  c.fillRect(0, 0, w, h);
  e.fillStyle = '#000';
  e.fillRect(0, 0, w, h);
  for (let i = 0; i < w * h / 90; i++) { const v = 30 + Math.random() * 22; c.fillStyle = `rgba(${v},${v + 1},${v + 6},0.35)`; c.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  const tints = ['#ffb877', '#ffd3a1', '#ffc48a', '#9ec9ff', '#7fb4ff', '#ffe9c9'];
  for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
    const x = k * cell, y = (rows - 1 - r) * cell;
    c.fillStyle = '#17181d';
    c.fillRect(x, y + cell - 7, cell, 7);
    if (k % 2 === 0) { c.fillStyle = '#1d1f25'; c.fillRect(x, y, 4, cell); }
    const lobby = r === 0;
    const wx = x + 11, wy = y + (lobby ? 12 : 9), ww = cell - 22, wh = lobby ? cell - 24 : cell - 28;
    c.fillStyle = '#3a3d45';
    c.fillRect(wx - 2, wy - 2, ww + 4, wh + 4);
    c.fillStyle = '#06080d';
    c.fillRect(wx, wy, ww, wh);
    const lit = lobby ? Math.random() < 0.8 : Math.random() < 0.34;
    if (lit) {
      const a = lobby ? 0.55 : 0.35 + Math.random() * 0.65;
      const tint = tints[(Math.random() * tints.length) | 0]!;
      const g = e.createLinearGradient(wx, wy, wx, wy + wh);
      g.addColorStop(0, tint); g.addColorStop(1, '#000');
      e.globalAlpha = a;
      e.fillStyle = g;
      e.fillRect(wx, wy, ww, wh);
      if (Math.random() < 0.5) { e.globalAlpha = a * 0.9; e.fillStyle = '#000'; e.fillRect(wx, wy, ww, 4 + Math.random() * (wh * 0.5)); }
      e.globalAlpha = 1;
    }
    c.fillStyle = '#2c2f37';
    c.fillRect(wx + ww / 2 - 1, wy, 2, wh);
    c.fillRect(wx, wy + wh * 0.42, ww, 2);
    e.fillStyle = '#000';
    e.fillRect(wx + ww / 2 - 1, wy, 2, wh);
    e.fillRect(wx, wy + wh * 0.42, ww, 2);
  }
  const tex = (cv: HTMLCanvasElement) => { const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
  return { map: tex(wall), glow: tex(glow) };
}

export function buildArena(assets: Assets, physics: Physics, scene: THREE.Scene, props: PropSystem, lights: LightPool): Arena {
  const g = new THREE.Group();
  scene.add(g);
  const neons: NeonSign[] = [];

  const concrete = makeSurface(assets, 'Concrete034', { repeat: 6, wet: 0.85, puddles: true, color: 0x9b9da4 });
  const steel = makeSurface(assets, 'MetalPlates006', { repeat: 4, wet: 0.8, metalness: 0.85, roughness: 0.5 });
  const corrugated = makeSurface(assets, 'CorrugatedSteel005', { repeat: 2, wet: 0.8, metalness: 0.7, roughness: 0.5 });
  const rust = makeSurface(assets, 'Rust004', { repeat: 2, wet: 0.5, metalness: 0.6, roughness: 0.7 });
  const pt = (color: number, intensity: number, distance: number, p: THREE.Vector3): void => {
    lights.add({ kind: 'point', position: p, color: new THREE.Color(color), intensity, distance, decay: 2 });
  };

  const box = (mat: THREE.Material, c: THREE.Vector3, w: number, h: number, d: number, collide = true, surface = 'concrete'): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.copy(c);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    if (collide) (physics.staticBox(c, new THREE.Vector3(w / 2, h / 2, d / 2)) as RAPIER.Collider & { surfaceTag?: string }).surfaceTag = surface;
    return m;
  };

  // Tower body.
  const side = (width: number): THREE.MeshStandardMaterial => {
    const t = flank(Math.round(width / 3), Math.round(SIZE.h / 3));
    return new THREE.MeshStandardMaterial({ map: t.map, emissiveMap: t.glow, emissive: 0xffffff, emissiveIntensity: 1.25, roughness: 0.7, metalness: 0.15 });
  };
  const body = new THREE.Mesh(new THREE.BoxGeometry(SIZE.x, SIZE.h, SIZE.z), [side(SIZE.z), side(SIZE.z), concrete, concrete, side(SIZE.x), side(SIZE.x)]);
  body.position.set(TOWER.x, SIZE.h / 2, TOWER.z);
  body.castShadow = body.receiveShadow = true;
  g.add(body);
  physics.staticBox(body.position, new THREE.Vector3(SIZE.x / 2, SIZE.h / 2, SIZE.z / 2));

  // Deck.
  const hx = SIZE.x / 2 + 0.3, hz = SIZE.z / 2 + 0.3;
  const deckC = new THREE.Vector3(TOWER.x, DECK_Y - 0.1, TOWER.z);
  box(concrete, deckC, hx * 2, 0.2, hz * 2, true);
  const center = new THREE.Vector3(TOWER.x, DECK_Y, TOWER.z);

  // Floor markings: a fighting ring and the hatches enemies climb out of.
  const ringMat = emissive(0xffb36b, 1.1);
  for (const [r0, r1] of [[10.9, 11.05], [5.4, 5.5]] as const) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 96), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(center.x, DECK_Y + 0.015, center.z);
    g.add(ring);
  }
  const rel = (x: number, z: number, y = 0): THREE.Vector3 => new THREE.Vector3(center.x + x, DECK_Y + y, center.z + z);
  const slots = [[-8.5, -9.2], [-8.5, 9.2], [8.5, -9.2], [8.5, 9.2], [13.2, -3.2], [13.2, 3.2], [2, -9.8], [2, 9.8]].map(([x, z]) => rel(x!, z!));
  const hatchMat = new THREE.MeshStandardMaterial({ color: 0x0b0c10, roughness: 0.5, metalness: 0.7 });
  for (const s of slots) {
    const hatch = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.05, 2.2), hatchMat);
    hatch.position.set(s.x, DECK_Y + 0.02, s.z);
    hatch.receiveShadow = true;
    g.add(hatch);
    const edge = new THREE.Mesh(new THREE.RingGeometry(1.05, 1.14, 4, 1, Math.PI / 4), ringMat);
    edge.rotation.x = -Math.PI / 2;
    edge.position.set(s.x, DECK_Y + 0.05, s.z);
    g.add(edge);
  }

  // Parapet with a tall invisible rail above it, so a knocked-back body stays in.
  const px = hx - PARAPET.t / 2, pz = hz - PARAPET.t / 2;
  const wallSpecs: [number, number, number, number][] = [[0, -pz, hx * 2, PARAPET.t], [0, pz, hx * 2, PARAPET.t], [-px, 0, PARAPET.t, hz * 2 - PARAPET.t * 2], [px, 0, PARAPET.t, hz * 2 - PARAPET.t * 2]];
  const ledMat = emissive(0xff3a6e, 1.6);
  for (const [x, z, w, d] of wallSpecs) {
    box(concrete, rel(x, z, PARAPET.h / 2), w, PARAPET.h, d, false);
    physics.staticBox(rel(x, z, WALL_TOP / 2), new THREE.Vector3(w / 2, WALL_TOP / 2, d / 2));
    box(steel, rel(x, z, PARAPET.h + 0.04), w + 0.06, 0.08, d + 0.06, false, 'metal');
    const led = new THREE.Mesh(new THREE.BoxGeometry(w > d ? w - 0.4 : 0.05, 0.05, w > d ? 0.05 : d - 0.4), ledMat);
    led.position.copy(rel(x + (w > d ? 0 : Math.sign(-x) * (PARAPET.t / 2 + 0.03)), z + (w > d ? Math.sign(-z) * (PARAPET.t / 2 + 0.03) : 0), 0.12));
    g.add(led);
  }
  pt(0xff3a6e, 30, 16, rel(0, 0, 3));

  // Cover: two air-handling units and a water tank, all low and chunky so
  // the chase AI does not snag.
  for (const [x, z, rot] of [[-4.5, 6.2, 0], [5.5, -6.4, 0]] as const) {
    const unit = box(corrugated, rel(x, z, 0.8), 3.4, 1.6, 1.7, true, 'metal');
    unit.rotation.y = rot;
    const fan = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.08, 20), new THREE.MeshStandardMaterial({ color: 0x0c0d11, roughness: 0.4, metalness: 0.8 }));
    fan.position.copy(rel(x - 0.7, z, 1.64));
    g.add(fan);
    const vent = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.04), emissive(0x7fd0ff, 1.2));
    vent.position.copy(rel(x + 0.8, z + 0.88, 0.9));
    g.add(vent);
  }
  const tank = new THREE.Group();
  const tankBody = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 2.3, 28), rust);
  tankBody.position.y = 1.95;
  const lid = new THREE.Mesh(new THREE.ConeGeometry(1.4, 0.5, 28), rust);
  lid.position.y = 3.35;
  tank.add(tankBody, lid);
  for (const [lx, lz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.0, 0.14), steel);
    leg.position.set(lx!, 0.5, lz!);
    tank.add(leg);
  }
  tank.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
  tank.position.copy(rel(6.5, 5.5));
  g.add(tank);
  physics.staticBox(rel(6.5, 5.5, 1.5), new THREE.Vector3(1.2, 1.5, 1.2));
  for (const [x, z] of [[-10, -5.8], [-10, -4.5], [-9.8, -5.15]] as const) props.spawn('crate', rel(x, z, 0.05));
  for (const [x, z] of [[10.6, 0.6], [10.8, -0.7]] as const) props.spawn('barrel', rel(x, z, 0.05));

  // Floodlights on the four corners.
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.8, roughness: 0.4 });
  for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) {
    const foot = rel(sx * 13.6, sz * 10.6);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 4.4, 8), poleMat);
    pole.position.copy(foot).add(new THREE.Vector3(0, 2.2, 0));
    pole.castShadow = true;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.34), emissive(0xffe2b0, 6));
    head.position.copy(foot).add(new THREE.Vector3(-sx * 0.2, 4.5, -sz * 0.2));
    g.add(pole, head);
    physics.staticBox(foot.clone().add(new THREE.Vector3(0, 2.2, 0)), new THREE.Vector3(0.12, 2.2, 0.12));
    lights.add({ kind: 'spot', position: head.position.clone(), target: rel(sx * 2, sz * 2), color: new THREE.Color(0xffd7a0), intensity: 150, distance: 30, decay: 1.5, angle: 0.95, penumbra: 0.6 });
  }

  // The lift head: a penthouse on the west edge, with the trial's board beside it.
  const house = rel(-13.2, 0, 1.75);
  box(concrete, house, 3.2, 3.5, 4.4, true);
  box(steel, house.clone().add(new THREE.Vector3(0, 1.8, 0)), 3.5, 0.14, 4.7, false, 'metal');
  const door = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 2.5), emissive(0x7fd0ff, 1.4));
  door.position.copy(rel(-11.58, 0, 1.3));
  door.rotation.y = Math.PI / 2;
  g.add(door);
  pt(0x7fd0ff, 22, 9, rel(-10.2, 0, 2));
  const sign = new NeonSign({ text: '屋上', color: 0xff3a6e, position: [center.x - 11.55, DECK_Y + 2.1, center.z + 1.45], rotationY: Math.PI / 2, vertical: true, width: 0.7, flicker: 0.1, light: false });
  neons.push(sign);
  g.add(sign.group);

  const stand = new THREE.Group();
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.2, 0.1), poleMat);
  post.position.y = 0.6;
  const pane = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.7, 0.05), new THREE.MeshStandardMaterial({ color: 0x06090f, roughness: 0.15, metalness: 0.6 }));
  pane.position.set(0, 1.4, 0);
  pane.rotation.x = -0.4;
  const glowPane = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.6), emissive(0xffb36b, 2.2));
  glowPane.position.set(0, 1.4, 0.03);
  glowPane.rotation.x = -0.4;
  stand.add(post, pane, glowPane);
  stand.position.copy(rel(-9.4, 4.6));
  stand.rotation.y = Math.PI / 2;
  g.add(stand);
  pt(0xffb36b, 14, 7, rel(-9.4, 4.6, 2));

  // Street level: the lift door on the tower's west face and its sign.
  const doorway = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.0, 2.6), steel);
  doorway.position.set(TOWER.x - SIZE.x / 2 - 0.1, 1.5, TOWER.z);
  doorway.castShadow = true;
  g.add(doorway);
  const lit = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 2.6), emissive(0x7fd0ff, 1.6));
  lit.position.set(TOWER.x - SIZE.x / 2 - 0.27, 1.4, TOWER.z);
  lit.rotation.y = -Math.PI / 2;
  g.add(lit);
  const street = new NeonSign({ text: '屋上', color: 0xff3a6e, position: [TOWER.x - SIZE.x / 2 - 0.3, 6.4, TOWER.z], rotationY: -Math.PI / 2, vertical: true, width: 1.1, flicker: 0.12 });
  neons.push(street);
  g.add(street.group);
  if (street.light) lights.add(street.light);
  const wide = new NeonSign({ text: 'ROOFTOP', color: 0xffb36b, position: [TOWER.x - SIZE.x / 2 - 0.3, 10.8, TOWER.z - 7], rotationY: -Math.PI / 2, width: 5 });
  neons.push(wide);
  g.add(wide.group);
  pt(0x7fd0ff, 26, 11, new THREE.Vector3(TOWER.x - SIZE.x / 2 - 1.5, 2.2, TOWER.z));
  const forecourt = box(steel, new THREE.Vector3(TOWER.x - SIZE.x / 2 - 2.2, 0.06, TOWER.z), 4.4, 0.12, 6, true, 'metal');
  forecourt.receiveShadow = true;

  return {
    group: g, deckY: DECK_Y, center, half: { x: hx - PARAPET.t, z: hz - PARAPET.t },
    start: rel(-8.5, 0), slots,
    liftBase: SPAWN.rooftop.clone(),
    liftTop: rel(-10, -1.2),
    consoleAt: rel(-9.4, 4.6), liftDownAt: rel(-10.4, 0),
    update(time) { for (const n of neons) n.update(time); },
  };
}
