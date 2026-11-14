import * as THREE from 'three';
import type { Physics } from '../physics/world';
import { toon, emissive, paintedSign } from '../render/materials';
import type { PropSystem } from '../world/props';
import type { LightPool } from '../render/lightPool';
import { HALL, SPAWN, PALETTE, type World } from '../world/compound';

// The rooftop trial fights on the training hall's roof deck. The compound
// builds the deck, its rail and the stair; this adds the trial's dressing:
// the fighting ring painted on the boards, the marks where each wave climbs
// over the eaves, the lanterns at the corners and the board that starts it.

const DECK_Y = HALL.deckY;
const CENTER = new THREE.Vector3(0, DECK_Y, (HALL.z0 + HALL.z1) / 2);
const HALF = { x: HALL.x1 + HALL.overhang - 0.5, z: (HALL.z1 - HALL.z0) / 2 + 0.3 };

export interface Arena {
  group: THREE.Group;
  deckY: number;
  center: THREE.Vector3;
  half: { x: number; z: number };
  start: THREE.Vector3;
  slots: THREE.Vector3[];
  // Foot of the stair in the yard, and the landing at its top.
  stairFoot: THREE.Vector3;
  stairTop: THREE.Vector3;
  consoleAt: THREE.Vector3;
  update(time: number): void;
}

export function buildArena(world: World, physics: Physics, scene: THREE.Scene, props: PropSystem, lights: LightPool): Arena {
  const g = new THREE.Group();
  scene.add(g);
  const add = <T extends THREE.Object3D>(o: T): T => { g.add(o); o.traverse((c) => { if ((c as THREE.Mesh).isMesh) world.onRoof(c as THREE.Mesh, 'hall'); }); return o; };
  const rel = (x: number, z: number, y = 0): THREE.Vector3 => new THREE.Vector3(CENTER.x + x, DECK_Y + y, CENTER.z + z);

  // The ring on the boards, and the inner circle where the waves meet you.
  const ringMat = emissive(PALETTE.mark, 1.1);
  for (const [r0, r1] of [[6.4, 6.52], [3.0, 3.08]] as const) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 96), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(rel(0, 0, 0.012));
    add(ring);
  }
  // Where each wave climbs onto the deck: a painted square at the edge.
  const slots = [[-10.5, -6.2], [-10.5, 6.2], [10.5, -6.2], [10.5, 6.2], [-4, -6.8], [4, -6.8], [-4, 6.8], [4, 6.8]].map(([x, z]) => rel(x!, z!));
  for (const s of slots) {
    const edge = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.04, 4, 1, Math.PI / 4), ringMat);
    edge.rotation.x = -Math.PI / 2;
    edge.position.set(s.x, DECK_Y + 0.012, s.z);
    add(edge);
  }

  // Lanterns on tall posts at the four corners, lit for the evening.
  const post = toon(PALETTE.woodDark);
  const paper = emissive(PALETTE.lantern, 2.6);
  for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) {
    const foot = rel(sx * (HALF.x - 1.2), sz * (HALF.z - 1.0));
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 3.2, 8), post);
    pole.position.copy(foot).add(new THREE.Vector3(0, 1.6, 0));
    pole.castShadow = true;
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.6, 10), paper);
    lamp.position.copy(foot).add(new THREE.Vector3(0, 3.0, 0));
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.22, 10), post);
    cap.position.copy(foot).add(new THREE.Vector3(0, 3.4, 0));
    add(pole); add(lamp); add(cap);
    physics.staticBox(pole.position, new THREE.Vector3(0.12, 1.6, 0.12));
    lights.add({ kind: 'point', position: lamp.position.clone(), color: new THREE.Color(PALETTE.lantern), intensity: 14, distance: 12, decay: 2 });
  }

  // Cover: a water cask and a low shrine, so a wave can be split.
  const cask = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 1.6, 20), toon(PALETTE.wood));
  body.position.y = 0.8;
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(1.08, 1.08, 0.14, 20), toon(PALETTE.woodDark));
  lid.position.y = 1.65;
  cask.add(body, lid);
  cask.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
  cask.position.copy(rel(6.5, 3.8));
  add(cask);
  physics.staticBox(rel(6.5, 3.8, 0.85), new THREE.Vector3(1.0, 0.85, 1.0));
  const shrine = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.1, 1.0), toon(PALETTE.woodDark));
  shrine.position.copy(rel(-6, -4.2, 0.55));
  shrine.castShadow = true;
  const shrineRoof = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.16, 1.4), toon(PALETTE.tile));
  shrineRoof.position.copy(rel(-6, -4.2, 1.18));
  add(shrine); add(shrineRoof);
  physics.staticBox(rel(-6, -4.2, 0.6), new THREE.Vector3(0.8, 0.6, 0.5));
  for (const [x, z] of [[-9, 2.6], [-9, 4.0], [-8.4, 3.3]] as const) props.spawn('crate', rel(x, z, 0.05));
  for (const [x, z] of [[9.4, -3.6], [9.6, -5.0]] as const) props.spawn('barrel', rel(x, z, 0.05));

  // The trial's board by the stair landing.
  const board = paintedSign('屋上試験', { width: 0.55, vertical: true, paint: '#a8231e' });
  board.position.copy(rel(-11.6, 4.0, 1.75));
  board.rotation.y = Math.PI / 2;
  add(board);
  const boardPost = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.9, 0.14), post);
  boardPost.position.copy(rel(-11.7, 4.0, 1.45));
  boardPost.castShadow = true;
  add(boardPost);
  physics.staticBox(boardPost.position, new THREE.Vector3(0.1, 1.45, 0.1));
  lights.add({ kind: 'point', position: rel(-10.8, 4.0, 2.2), color: new THREE.Color(PALETTE.lantern), intensity: 6, distance: 6, decay: 2 });

  return {
    group: g, deckY: DECK_Y, center: CENTER, half: HALF,
    start: rel(-7, 0), slots,
    stairFoot: SPAWN.stairs.clone(),
    stairTop: SPAWN.roof.clone().set(-16.2, DECK_Y, -12.3),
    consoleAt: rel(-11.0, 4.0),
    update() { /* nothing moves on the roof between waves */ },
  };
}
