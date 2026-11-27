import * as THREE from 'three';
import { toon, emissive, faceted } from '../../render/materials';
import { kawara, planks, flagstones } from '../textures';
import type { CityKit, PieceOpts } from './kit';
import { rng } from './kit';
import type { SignAtlas, SignStyle } from './signs';
import { INK, gable, house, tank } from './buildings';
import { tree } from './streets';
import {
  RAIL, STATION, GRAND_STAIR, PED_DECK, ARCADE, CATWALK, SHRINE, PARK, KURODA, KURODA_HOUSE, WAREHOUSE, ODORI,
  type Building,
} from './plan';

// The ward's set pieces: the railway and its station, the grand stair, the
// pedestrian deck, the covered arcade and the catwalk over it, the outside
// stairs up to the roofs, the Inari shrine, the pocket park, the bars under
// the tracks, and the Kuroda house with its yard and warehouse.

const W_HOSE = { x: WAREHOUSE.x0 - 0.15, z: -6.4 };
const VERMILION = 0xd2492f, CONCRETE = 0xb8b2a6, CONCRETE_DARK = 0x8f8a80;

export interface Places {
  // The flight a stair takes, as the checks and the map read it.
  stairs: { id: string; top: THREE.Vector3; bottom: THREE.Vector3 }[];
}

export function buildPlaces(k: CityKit, signs: SignAtlas): Places {
  const r = rng(23);
  const stairs: Places['stairs'] = [];
  const lantern = k.shared('lantern', () => emissive(0xffa25a, 2.2));
  const redLantern = k.shared('red-lantern', () => emissive(0xff5a3a, 1.8));
  const tile = k.shared('tile', () => toon(0xffffff, { map: kawara(INK.tile, 0x7f92b0, INK.tileEdge) }));
  const flight = (id: string, x: number, y: number, z: number, dx: number, dz: number, width: number, style: 'steel' | 'stone', o: PieceOpts = {}): void => {
    const rise = 0.28, run = 0.42;
    const n = Math.round(y / rise), rr = y / n;
    const mat = style === 'steel' ? INK.steelLight : 0xc9c2b4;
    for (let i = 0; i < n; i++) {
      const top = y - i * rr;
      const cx = x + dx * run * (i + 0.5), cz = z + dz * run * (i + 0.5);
      k.box(mat, cx, top / 2, cz, dx ? run + 0.02 : width, top, dz ? run + 0.02 : width, { ...o, surface: style === 'steel' ? 'metal' : 'stone' });
      if (style === 'steel') k.box(INK.steel, cx + dx * run * 0.45, top - 0.02, cz + dz * run * 0.45, dx ? 0.04 : width, 0.05, dz ? 0.04 : width, { ...o, collide: false, shadow: false });
    }
    const len = n * run;
    const ang = Math.atan2(y, len);
    const mx = x + dx * len / 2, mz = z + dz * len / 2;
    for (const side of [-1, 1]) {
      const sx = dz ? side * (width / 2 + 0.06) : 0, sz = dx ? side * (width / 2 + 0.06) : 0;
      const railLen = Math.hypot(len, y);
      const rot: [number, number, number] = dz ? [dz * ang, 0, 0] : [0, 0, -dx * ang];
      if (style === 'steel') {
        k.box(INK.steel, mx + sx, y / 2 + 1.0, mz + sz, dz ? 0.06 : railLen, 0.06, dz ? railLen : 0.06, { ...o, rot, collide: false });
        k.box(INK.steel, mx + sx, y / 2 + 0.55, mz + sz, dz ? 0.03 : railLen, 0.03, dz ? railLen : 0.03, { ...o, rot, collide: false, shadow: false });
        for (let i = 0; i <= n; i += 4) k.box(INK.steel, x + dx * run * i + sx, (y - i * rr) + 0.5, z + dz * run * i + sz, 0.06, 1.0, 0.06, { ...o, collide: false });
      } else {
        k.box(0xb0a998, mx + sx, y / 2 + 0.35, mz + sz, dz ? 0.3 : railLen, 0.9, dz ? railLen : 0.3, { ...o, rot, collide: false });
        k.box(INK.steel, mx + sx, y / 2 + 1.0, mz + sz, dz ? 0.06 : railLen, 0.06, dz ? railLen : 0.06, { ...o, rot, collide: false });
      }
      // The flight's side is a wall to a body: a rail on each side, tilted with the flight.
      k.solid(mx + sx, y / 2 + 1.1, mz + sz, dz ? 0.06 : railLen / 2, 1.2, dz ? railLen / 2 : 0.06, new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)));
    }
    stairs.push({ id, top: k.w(x, y, z), bottom: k.w(x + dx * len, 0, z + dz * len) });
  };

  // ------------------------------------------------------------ the railway
  // A concrete viaduct the width of the ward: a deck on a solid run of bays
  // (bars and stores under the tracks), parapets either side, two tracks of
  // ballast, sleepers and rails, and catenary masts.
  const V = RAIL;
  const vx = 90;
  for (const [x0, x1] of [[-vx, STATION.x0], [STATION.x1, vx]] as const) {
    k.span(CONCRETE, x0, x1, 0, V.deckY, V.z0, V.z1, { surface: 'stone' });
    k.span(CONCRETE_DARK, x0, x1, V.deckY - 0.8, V.deckY, V.z1, V.z1 + 0.2, { collide: false });
    k.span(CONCRETE, x0, x1, V.deckY, V.deckY + 1.1, V.z1 - 0.3, V.z1, {});
  }
  k.span(CONCRETE, -vx, vx, V.deckY, V.deckY + 1.1, V.z0, V.z0 + 0.3, {});
  k.span(CONCRETE_DARK, -vx, vx, V.deckY + 1.1, V.deckY + 1.16, V.z0 - 0.04, V.z0 + 0.34, { collide: false });
  // Under the station the deck stands on columns.
  k.span(CONCRETE, STATION.x0, STATION.x1, V.deckY - 0.9, V.deckY, V.z0, V.z1, { surface: 'stone' });
  for (let x = STATION.x0 + 2; x <= STATION.x1 - 2; x += 8) for (const z of [V.z0 + 1.2, V.z1 - 1.2]) k.box(CONCRETE, x, (V.deckY - 0.9) / 2, z, 1.0, V.deckY - 0.9, 1.0);
  k.span(0x6e6a66, -vx, vx, V.deckY, V.deckY + 0.18, V.z0 + 0.3, V.z1 - 0.3, { collide: false, shadow: false });
  for (const tz of V.tracks) {
    for (let x = -72; x <= 72; x += 1.1) k.box(0x6b5444, x, V.deckY + 0.22, tz, 0.24, 0.08, 2.4, { collide: false, shadow: false });
    for (const dz of [-0.72, 0.72]) k.span(0x8e949a, -vx, vx, V.deckY + 0.26, V.deckY + 0.36, tz + dz - 0.04, tz + dz + 0.04, { collide: false, shadow: false });
  }
  // Catenary masts on the north parapet with their arms over the tracks, and the wire.
  for (let x = -66; x <= 66; x += 22) {
    k.box(INK.steel, x, V.deckY + 3.5, V.z0 + 0.4, 0.3, 7.0, 0.3, { collide: false });
    k.box(INK.steel, x, V.deckY + 6.4, (V.z0 + V.z1) / 2, 0.14, 0.14, V.z1 - V.z0, { collide: false });
  }
  for (const tz of V.tracks) k.span(INK.black, -vx, vx, V.deckY + 5.6, V.deckY + 5.63, tz - 0.015, tz + 0.015, { collide: false, shadow: false });

  // The bars and stores in the viaduct's bays, facing the walk under the
  // tracks: a lit front behind sliding glass, red lanterns, a noren, a
  // board with the place's name, beer crates and stools out front.
  const barNames = ['焼とん', '立呑み', 'おでん', '酒場', 'もつ焼', '居酒屋', '餃子', '立呑み', '焼鳥', '酒場'];
  let bi = 0;
  for (const [x0, x1] of [[-64, -24], [24, 64]] as const) {
    for (let x = x0; x < x1 - 1; x += 8) {
      const cx = x + 4, z = V.z1;
      const closed = bi % 4 === 3;
      k.span(CONCRETE_DARK, x + 0.1, x + 0.5, 0, V.deckY - 0.8, z, z + 0.3, {});
      if (closed) {
        // A shuttered bay, its shutter rolled down.
        k.span(INK.shutter, x + 0.6, x + 7.6, 0, 3.2, z, z + 0.12, { collide: false });
        for (let y = 0.2; y < 3.2; y += 0.2) k.span(0x8f9391, x + 0.6, x + 7.6, y, y + 0.03, z + 0.12, z + 0.14, { collide: false, shadow: false });
        bi++;
        continue;
      }
      k.span(INK.interiorShade, x + 0.6, x + 7.6, 0, 3.0, z, z + 0.04, { collide: false });
      k.span(k.shared('bar-glow', () => toon(0xf6cf8e, { emissive: 0xffb050, emissiveIntensity: 0.45 })), x + 0.8, x + 7.4, 0.3, 2.6, z + 0.05, z + 0.07, { collide: false, shadow: false });
      for (let dx = 0.8; dx < 7.4; dx += 1.6) k.span(INK.woodDark, x + dx, x + dx + 0.08, 0, 2.7, z + 0.07, z + 0.14, { collide: false, shadow: false });
      k.span(INK.woodDark, x + 0.6, x + 7.6, 2.7, 3.2, z, z + 0.25, { collide: false });
      const name = barNames[bi % barNames.length]!;
      const style: SignStyle = { paper: bi % 2 ? '#f4ead6' : '#c8463a', ink: bi % 2 ? '#2b1d1a' : '#f6eedc', font: 'brush', rule: false };
      const board = k.mesh(signs.face(name, 2.6, 0.7, style), signs.lit, cx, 3.6, z + 0.36, { shadow: false });
      board.rotation.y = 0;
      k.span(INK.frame, cx - 1.4, cx + 1.4, 3.2, 4.0, z + 0.25, z + 0.33, { collide: false });
      for (let i = 0; i < 4; i++) k.span(0x2f4a7a, cx - 1.6 + i * 0.82, cx - 1.6 + (i + 1) * 0.82 - 0.06, 1.7, 2.65, z + 0.3, z + 0.32, { collide: false, shadow: false });
      for (const dx of [-3.0, 3.0]) {
        k.cyl(redLantern, cx + dx, 2.6, z + 0.6, 0.26, 0.26, 0.6, 10, { shadow: false });
        k.cyl(INK.black, cx + dx, 2.96, z + 0.6, 0.18, 0.18, 0.1, 10, { collide: false, shadow: false });
      }
      if (bi % 3 === 0) k.light(0xffa060, 5, 7, cx, 2.4, z + 1.4);
      // What spills out front: a barrel for a table, stools, beer crates.
      if (bi % 2 === 0) {
        k.prop('barrel', cx - 1.2, 0.05, z + 1.5);
        k.prop('stool', cx - 0.2, 0.05, z + 1.4);
        k.prop('stool', cx - 2.2, 0.05, z + 1.8);
      }
      k.prop('beerCrate', x + 6.6, 0.05, z + 0.7);
      if (r() < 0.6) k.prop('beerCrate', x + 6.6, 0.45, z + 0.7);
      bi++;
    }
  }

  // ------------------------------------------------------------ the station
  // One deck at platform level: the platform along the tracks under its
  // canopy, and the forecourt deck over the ticket hall, with the grand stair
  // down to the plaza and the pedestrian deck going east.
  const S = STATION;
  const deckMat = k.shared('deck', () => toon(0xffffff, { map: planks(0xb9b3a6, 0xaea795, 0x8f887a, 8) }));
  k.span(CONCRETE, S.x0, S.x1, S.y - 0.6, S.y, V.z1, S.z1, { surface: 'stone', group: k.group('station-deck', false), uv: 2 });
  const forecourt = k.shared('forecourt', () => toon(0xffffff, { map: flagstones(0xd2ccbf, 0xc8c1b2, 0xa9a194, 3) }));
  k.span(forecourt, S.x0 + 0.2, S.x1 - 0.2, S.y, S.y + 0.02, S.platformZ, S.z1 - 0.2, { collide: false, shadow: false, group: 'station-deck', uv: 3 });
  k.span(deckMat, S.x0, S.x1, S.y, S.y + 0.02, V.z1, S.platformZ, { collide: false, shadow: false, uv: 2 });
  // The tactile line and the white edge along the platform.
  k.span(0xe6c13c, S.x0 + 0.4, S.x1 - 0.4, S.y + 0.02, S.y + 0.04, V.z1 + 0.7, V.z1 + 1.0, { collide: false, shadow: false });
  k.span(0xf1ece0, S.x0, S.x1, S.y - 0.1, S.y + 0.03, V.z1, V.z1 + 0.25, { collide: false, shadow: false });
  // Nobody goes down onto the tracks: a rail along the platform edge.
  k.block(S.x0, S.x1, S.y, S.y + 6, V.z1 - 0.2, V.z1);
  // The ticket hall under the deck: walls, glass doors to the plaza, gates.
  const hall = S.hall;
  k.span(0xd9d3c6, hall.x0, hall.x1, 0, S.y - 0.6, hall.z0, hall.z1, { surface: 'stone', group: k.group('station-hall') });
  k.span(INK.frame, hall.x0 + 1, hall.x1 - 1, 0, 3.2, hall.z1, hall.z1 + 0.06, { collide: false });
  k.span(INK.glassDark, hall.x0 + 1.2, hall.x1 - 1.2, 0.1, 3.0, hall.z1 + 0.06, hall.z1 + 0.1, { collide: false });
  for (let x = hall.x0 + 1.2; x <= hall.x1 - 1.2; x += 2.4) k.span(INK.frame, x - 0.05, x + 0.05, 0, 3.0, hall.z1 + 0.06, hall.z1 + 0.14, { collide: false, shadow: false });
  k.span(0xe9e4d8, hall.x0, hall.x1, 3.3, 5.2, hall.z1, hall.z1 + 0.1, { collide: false });
  for (const x of [-8, 8]) {
    const b = k.mesh(signs.face(x < 0 ? 'きっぷうりば' : '改札口', 3.0, 0.6, { paper: '#1f2b44', ink: '#f4f1e8', font: 'gothic' }), signs.lit, x, 4.2, hall.z1 + 0.12, { shadow: false });
    b.rotation.y = 0;
  }
  // The station's name on a frame over the head of the grand stair, read from the plaza and from above.
  for (const x of [GRAND_STAIR.x0 - 0.5, GRAND_STAIR.x1 + 0.5]) k.box(INK.steel, x, S.y + 1.7, S.z1 - 0.6, 0.26, 3.4, 0.26, { group: 'station-deck' });
  k.box(0x1f2b44, 0, S.y + 3.65, S.z1 - 0.6, GRAND_STAIR.x1 - GRAND_STAIR.x0 + 2.6, 1.3, 0.3, { group: 'station-deck', collide: false });
  const nameBoard = k.mesh(signs.face('東雲駅', 5.6, 1.1, { paper: '#f4f1e8', ink: '#1f2b44', font: 'gothic', sub: 'SHINONOME STATION' }), signs.lit, 0, S.y + 3.65, S.z1 - 0.44, { shadow: false, group: 'station-deck' });
  nameBoard.rotation.y = 0;
  // The ticket gates between the forecourt and the platform: a row of
  // waist-high cabinets with a passage between each pair.
  for (let x = -9; x <= 9; x += 1.5) {
    k.box(0xe6e3da, x, S.y + 0.5, S.platformZ + 0.6, 0.32, 1.0, 1.4);
    k.box(0x2f6a8a, x, S.y + 1.0, S.platformZ + 0.6, 0.34, 0.06, 1.42, { collide: false, shadow: false });
  }
  for (const x of [-15.5, 14.5]) k.box(0xd9d3c6, x, S.y + 0.6, S.platformZ + 0.6, 3.6, 1.2, 0.4);
  // Long planters on the forecourt, low enough to vault, high enough for cover.
  for (const [x, z] of [[-14, -31.4], [11, -31.4]] as const) {
    k.box(0xb0a998, x, S.y + 0.4, z, 5.2, 0.8, 1.2);
    k.box(0x4f7a46, x, S.y + 0.95, z, 5.0, 0.4, 1.0, { collide: false });
  }
  k.prop('crate', -4.6, S.y + 0.05, -32.6);
  k.prop('crate', -4.6, S.y + 0.05, -31.4);
  k.prop('signStand', 5.6, S.y + 0.04, -30.4, 0.4);
  // Columns under the deck either side of the hall.
  for (const x of [-20, -16, 16, 20]) for (const z of [-38, -33, -29.2]) k.box(CONCRETE, x, (S.y - 0.6) / 2, z, 0.9, S.y - 0.6, 0.9);
  // The canopy over the platform, on a row of posts.
  const canopy = k.group('station-canopy', false);
  for (let x = S.x0 + 2; x <= S.x1 - 2; x += 6) {
    k.box(INK.steel, x, S.y + 1.6, -38.2, 0.26, 3.2, 0.26, { group: canopy });
    k.box(INK.steel, x, S.y + 3.25, -38.2, 0.2, 0.2, 4.4, { group: canopy, collide: false });
  }
  k.span(0xe9e6dc, S.x0 - 0.2, S.x1 + 0.2, S.y + 3.3, S.y + 3.5, V.z1 - 0.6, S.platformZ + 0.9, { group: canopy, collide: false });
  for (let x = S.x0 + 2; x <= S.x1 - 2; x += 3) k.span(0xb9bdb8, x - 0.08, x + 0.08, S.y + 3.5, S.y + 3.56, V.z1 - 0.6, S.platformZ + 0.9, { group: canopy, collide: false, shadow: false });
  k.span(0x4f6c8a, S.x0 - 0.3, S.x1 + 0.3, S.y + 3.2, S.y + 3.6, S.platformZ + 0.8, S.platformZ + 1.0, { group: canopy, collide: false });
  // Platform furniture: benches, a machine, the station's name board with its neighbours.
  for (const x of [-14, -4, 8]) { k.box(INK.woodLight, x, S.y + 0.45, -37.2, 1.8, 0.08, 0.45); k.box(INK.steel, x, S.y + 0.22, -37.2, 1.6, 0.44, 0.3, { collide: false }); }
  const sta = k.mesh(signs.face('しののめ', 3.2, 1.2, { paper: '#f6f6f2', ink: '#1f2b44', font: 'gothic', sub: '東雲  ←みなと   かわら→' }), signs.lit, 2, S.y + 2.0, -37.4, { shadow: false });
  sta.rotation.y = 0;
  k.span(INK.steel, 0.3, 0.4, S.y, S.y + 2.6, -37.5, -37.4, { collide: false });
  k.span(INK.steel, 3.6, 3.7, S.y, S.y + 2.6, -37.5, -37.4, { collide: false });
  k.span(0x2f6a8a, 0.3, 3.7, S.y + 1.36, S.y + 1.42, -37.46, -37.38, { collide: false, shadow: false });
  // Railings round the deck, open at the grand stair and the pedestrian deck.
  const deckRail = (x0: number, x1: number, z0: number, z1: number): void => {
    if (Math.abs(x1 - x0) < 0.1 && Math.abs(z1 - z0) < 0.1) return;
    k.span(0xdfe4e2, x0 - 0.03, x1 + 0.03, S.y, S.y + 1.0, z0 - 0.03, z1 + 0.03, { collide: false, shadow: false, group: 'station-deck' });
    k.span(INK.steel, x0 - 0.05, x1 + 0.05, S.y + 1.0, S.y + 1.08, z0 - 0.05, z1 + 0.05, { collide: false, group: 'station-deck' });
    k.block(x0 - 0.05, x1 + 0.05, S.y, S.y + 1.3, z0 - 0.05, z1 + 0.05);
  };
  deckRail(S.x0, S.x0, V.z1, S.z1);
  deckRail(S.x1, S.x1, V.z1, S.z1);
  deckRail(S.x0, GRAND_STAIR.x0 - 0.4, S.z1, S.z1);
  deckRail(GRAND_STAIR.x1 + 0.4, PED_DECK.x0, S.z1, S.z1);
  deckRail(PED_DECK.x1, S.x1, S.z1, S.z1);
  k.light(0xffe2b0, 6, 12, -8, S.y + 2.8, -37.5);
  k.light(0xffe2b0, 6, 12, 10, S.y + 2.8, -37.5);
  // The grand stair from the forecourt down into the plaza, between stone cheeks.
  flight('grand', 0, S.y, S.z1, 0, 1, GRAND_STAIR.x1 - GRAND_STAIR.x0, 'stone');

  // ------------------------------------------------------------ pedestrian deck
  const P = PED_DECK;
  const ped = k.group('ped-deck', false);
  k.span(CONCRETE, P.x0, P.x1, P.y - 0.6, P.y, S.z1, P.z1, { surface: 'stone', group: ped });
  k.span(0xd7d1c4, P.x0 + 0.15, P.x1 - 0.15, P.y, P.y + 0.02, S.z1, P.z1 - 0.15, { collide: false, shadow: false, group: ped });
  for (const z of [-25, -20.5, -11.5]) k.box(CONCRETE, (P.x0 + P.x1) / 2, (P.y - 0.6) / 2, z, 0.9, P.y - 0.6, 0.9);
  const pedRail = (x0: number, x1: number, z0: number, z1: number): void => {
    k.span(0xdfe4e2, x0 - 0.03, x1 + 0.03, P.y, P.y + 1.0, z0 - 0.03, z1 + 0.03, { collide: false, shadow: false, group: ped });
    k.span(INK.steel, x0 - 0.05, x1 + 0.05, P.y + 1.0, P.y + 1.08, z0 - 0.05, z1 + 0.05, { collide: false, group: ped });
    k.block(x0 - 0.05, x1 + 0.05, P.y, P.y + 1.3, z0 - 0.05, z1 + 0.05);
  };
  pedRail(P.x1, P.x1, S.z1, P.z1);
  pedRail(P.x0, P.x0, S.z1, -14);
  pedRail(P.x0, P.x1, P.z1, P.z1);
  // A covered stretch where the deck crosses the station street.
  for (const x of [P.x0 + 0.3, P.x1 - 0.3]) for (const z of [-18.5, -14.5]) k.box(INK.steel, x, P.y + 1.4, z, 0.14, 2.8, 0.14, { group: ped, collide: false });
  k.span(0x4f6c8a, P.x0, P.x1, P.y + 2.8, P.y + 2.95, -19, -14, { group: ped, collide: false });

  // ------------------------------------------------------------ the arcade
  // A barrel roof of pale panels on steel ribs every four metres over the
  // shopping street, red lanterns hung down both sides, and a gate at each
  // end with the street's name.
  const A = ARCADE;
  const arcade = k.group('arcade', false);
  const half = (A.x1 - A.x0) / 2, sag = A.apex - A.spring;
  const R = (half * half + sag * sag) / (2 * sag), cy = A.apex - R, ang = Math.asin(half / R);
  const panels = k.shared('arcade-panel', () => toon(0xe6ebe2, { side: THREE.DoubleSide }));
  const barrel = new THREE.CylinderGeometry(R, R, A.z1 - A.z0, 18, 1, true, Math.PI - ang, ang * 2);
  const roofMesh = k.mesh(barrel, panels, 0, cy, (A.z0 + A.z1) / 2, { group: arcade, rot: [Math.PI / 2, 0, 0] });
  roofMesh.castShadow = true;
  const arcY = (x: number): number => cy + Math.sqrt(R * R - x * x);
  const segs = 4;
  for (let i = 0; i < segs; i++) {
    const xa = A.x0 + (i * (A.x1 - A.x0)) / segs, xb = A.x0 + ((i + 1) * (A.x1 - A.x0)) / segs;
    const ya = arcY(xa), yb = arcY(xb);
    const len = Math.hypot(xb - xa, yb - ya), tilt = Math.atan2(yb - ya, xb - xa);
    // The roof can be walked on (a body that drops from a roof lands on it).
    k.solid((xa + xb) / 2, (ya + yb) / 2 + 0.02, (A.z0 + A.z1) / 2, len / 2, 0.08, (A.z1 - A.z0) / 2, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, tilt)), 'metal');
    for (let z = A.z0; z <= A.z1 + 0.01; z += 4) {
      k.box(INK.steel, (xa + xb) / 2, (ya + yb) / 2 - 0.08, z, len + 0.04, 0.16, 0.14, { group: arcade, rot: [0, 0, tilt], collide: false });
      k.box(0x8a949e, (xa + xb) / 2, (ya + yb) / 2 + 0.05, z, len + 0.04, 0.06, 0.18, { group: arcade, rot: [0, 0, tilt], collide: false, shadow: false });
    }
  }
  for (const x of [A.x0 + 0.1, A.x1 - 0.1, 0]) k.span(INK.steel, x - 0.06, x + 0.06, arcY(x) - 0.2, arcY(x) - 0.06, A.z0, A.z1, { group: arcade, collide: false, shadow: false });
  for (let z = A.z0 + 2; z < A.z1; z += 4) for (const x of [-2.9, 2.9]) {
    if (z > -1 && z < 3.5) continue;
    k.cyl(redLantern, x, 3.9, z, 0.24, 0.24, 0.56, 10, { shadow: false });
    k.cyl(INK.black, x, 4.22, z, 0.16, 0.16, 0.08, 10, { collide: false, shadow: false });
    k.cyl(INK.black, x, 3.58, z, 0.16, 0.16, 0.08, 10, { collide: false, shadow: false });
    k.box(INK.black, x, 4.6, z, 0.02, 0.7, 0.02, { collide: false, shadow: false });
  }
  for (const z of [-8, 6, 14]) k.light(0xffb070, 6, 10, 0, 3.6, z);
  for (const [z, face] of [[A.z0, -1], [A.z1, 1]] as const) {
    for (const x of [A.x0 - 0.3, A.x1 + 0.3]) k.box(INK.steel, x, 3.6, z, 0.4, 7.2, 0.4);
    k.box(0x2f4a7a, 0, 6.7, z, A.x1 - A.x0 + 1.2, 1.4, 0.4, { collide: false, group: arcade });
    const gateSign = k.mesh(signs.face('東雲銀座', 6.6, 1.1, { paper: '#2f4a7a', ink: '#f6eedc', font: 'mincho', sub: 'しののめ商店街' }), signs.lit, 0, 6.7, z + face * 0.21, { group: arcade, shadow: false });
    gateSign.rotation.y = face > 0 ? 0 : Math.PI;
  }

  // ------------------------------------------------------------ catwalk
  // Steel grating over the arcade roof between the two rows' roofs, with rails.
  const C = CATWALK;
  k.span(INK.steelLight, -4.4, 4.4, C.y - 0.12, C.y, C.z0, C.z1, { surface: 'metal' });
  for (let x = -4.2; x < 4.3; x += 0.3) k.span(INK.steel, x, x + 0.04, C.y, C.y + 0.01, C.z0, C.z1, { collide: false, shadow: false });
  for (const z of [C.z0, C.z1]) {
    k.span(INK.steel, -4.4, 4.4, C.y + 0.95, C.y + 1.0, z - 0.03, z + 0.03, { collide: false });
    k.span(INK.steel, -4.4, 4.4, C.y + 0.45, C.y + 0.48, z - 0.02, z + 0.02, { collide: false, shadow: false });
    for (let x = -4.2; x <= 4.2; x += 1.4) k.box(INK.steel, x, C.y + 0.5, z, 0.05, 1.0, 0.05, { collide: false });
    k.block(-4.4, 4.4, C.y, C.y + 1.2, z - 0.04, z + 0.04);
  }
  for (const x of [-2, 2]) k.box(INK.steel, x, (C.y + arcY(x)) / 2, (C.z0 + C.z1) / 2, 0.1, C.y - arcY(x), 0.1, { collide: false });

  // ------------------------------------------------------------ outside stairs
  // Steel flights from the back streets up to the arcade rows' roofs.
  stairLanding(k, -15.6, -14, 14.6, 17.4, 6.6);
  flight('west-roofs', -14.8, 6.6, 14.6, 0, -1, 1.4, 'steel');
  stairLanding(k, 14, 15.6, 2.6, 4.6, 6.8);
  flight('east-roofs', 14.8, 6.8, 4.6, 0, 1, 1.4, 'steel');

  // ------------------------------------------------------------ the plaza
  // A police box on the corner, a clock on a post, a bus shelter, a round
  // planter with a zelkova, the taxi stand's sign, crates by a shop door.
  koban(k, signs);
  k.cyl(INK.steel, 9, 2.4, -24, 0.09, 0.12, 4.8, 8);
  k.solid(9, 2.4, -24, 0.12, 2.4, 0.12);
  k.cyl(0xf4f1e6, 9, 4.9, -24, 0.55, 0.55, 0.14, 20, { rot: [Math.PI / 2, 0, 0], collide: false });
  k.cyl(INK.black, 9, 4.9, -23.92, 0.42, 0.42, 0.02, 20, { rot: [Math.PI / 2, 0, 0], collide: false, shadow: false });
  k.cyl(0xf4f1e6, 9, 4.9, -23.9, 0.38, 0.38, 0.02, 20, { rot: [Math.PI / 2, 0, 0], collide: false, shadow: false });
  k.box(INK.black, 9.12, 4.96, -23.88, 0.04, 0.26, 0.01, { collide: false, shadow: false, rot: [0, 0, -0.5] });
  k.box(INK.black, 8.96, 4.82, -23.88, 0.03, 0.34, 0.01, { collide: false, shadow: false, rot: [0, 0, 2.1] });
  // The round planter.
  k.cyl(0xb0a998, -11, 0.3, -23.2, 2.2, 2.3, 0.6, 20);
  k.solid(-11, 0.3, -23.2, 1.6, 0.3, 1.6);
  k.cyl(0x5a4436, -11, 0.62, -23.2, 2.0, 2.0, 0.06, 20, { collide: false, shadow: false });
  tree(k, -11, -23.2, 'zelkova', 1.15, r, 0.6);
  // The bus shelter on the station street.
  {
    const x = 6, z = -15.2;
    for (const dx of [-2.2, 2.2]) k.box(INK.steel, x + dx, 1.3, z - 0.6, 0.12, 2.6, 0.12);
    k.span(0x4f6c8a, x - 2.6, x + 2.6, 2.6, 2.75, z - 1.4, z + 0.2, { collide: false });
    k.span(0xdfe4e2, x - 2.3, x + 2.3, 0.3, 2.4, z - 1.3, z - 1.24, { collide: false });
    k.box(INK.woodLight, x, 0.45, z - 1.0, 3.2, 0.08, 0.4);
    k.box(INK.steel, x - 3.2, 1.3, z, 0.08, 2.6, 0.08);
    const bus = k.mesh(signs.face('バス', 0.6, 0.6, { paper: '#2f6a8a', ink: '#f6f6f2', font: 'gothic' }), signs.plain, x - 3.2, 2.7, z + 0.05, { shadow: false });
    bus.rotation.y = 0;
  }
  for (const [x, z] of [[18.5, -21], [18.5, -19.8], [19.6, -21]] as const) k.prop('crate', x, 0.05, z);
  k.prop('signStand', -6.4, 0.04, -19.6, 0.3);
  k.prop('cardboard', 19.6, 0.05, -19.6);

  // ------------------------------------------------------------ arcade life
  // Out in front of the shops: crates, stools, a sign on the pavement.
  for (const [key, x, z, rot] of [
    ['beerCrate', -3.4, -10.6, 0], ['beerCrate', -3.4, -10.6, 0.2], ['cardboard', -3.3, -5.2, 0.4], ['signStand', -2.9, -1.4, 1.2],
['stool', 2.4, 14.2, 0], ['stool', 2.4, 16.8, 0], ['crateSmall', 3.3, 9.8, 0.3], ['signStand', 2.9, 4.4, -1.1],
    ['crate', -3.3, 10.2, 0.1], ['cardboard', 3.4, -6.4, 0], ['beerCrate', 3.3, -12.2, 0],
  ] as const) k.prop(key, x, key === 'beerCrate' && rot === 0.2 ? 0.45 : 0.06, z, rot);

  // ------------------------------------------------------------ roofs
  // On the circuit: a water tank and a billboard on the tallest of the west
  // row, a little shrine on the east row, washing poles, and things to throw.
  tank(k, -11.6, 8.2, 11.6, { group: 'w5' });
  billboard(k, signs, -9, 8.2, 8.6);
  roofShrine(k, 11.5, 7.4, 10.6, tile);
  for (const [x, z, y, g] of [[-11, -12.2, 7.2, 'w1'], [11.6, -2.2, 7.6, 'e3']] as const) {
    for (const dz of [-1.2, 1.2]) k.box(INK.steel, x, y + 0.9, z + dz, 0.06, 1.8, 0.06, { group: g });
    k.box(INK.steel, x, y + 1.75, z, 0.04, 0.04, 2.6, { group: g, collide: false });
    k.box([0xe8e4da, 0x8fb0c8][Math.floor(r() * 2)]!, x, y + 1.35, z - 0.5, 0.03, 0.8, 0.9, { group: g, collide: false });
    k.box(0xd9a040, x, y + 1.4, z + 0.5, 0.03, 0.6, 0.7, { group: g, collide: false });
  }
  for (const [key, x, y, z] of [['crate', -7, 7.2, -12.6], ['crate', -7, 7.2, -11.2], ['barrel', 8.6, 7.4, 9.2], ['cardboard', -7.2, 7.0, 4.6], ['crateSmall', 7.4, 7.0, -7], ['beerCrate', -6.6, 6.6, 15.8]] as const) k.prop(key, x, y + 0.05, z);

  // ------------------------------------------------------------ shrine
  shrine(k, signs, tile, r);
  // ------------------------------------------------------------ park
  park(k, r);
  // ------------------------------------------------------------ kuroda
  kuroda(k, signs, tile, lantern, r, flight);
  // ------------------------------------------------------------ the road
  // A few parked things on the main road's kerb: a delivery van, a scooter.
  van(k, -30, ODORI.road1 - 1.1, 0x2f6a8a);
  scooter(k, 22, ODORI.road0 + 0.6);
  return { stairs };
}

function stairLanding(k: CityKit, x0: number, x1: number, z0: number, z1: number, y: number): void {
  k.span(INK.steelLight, x0, x1, y - 0.15, y, z0, z1, { surface: 'metal' });
  for (const [x, z] of [[x0 + 0.1, z0 + 0.1], [x0 + 0.1, z1 - 0.1], [x1 - 0.1, z0 + 0.1], [x1 - 0.1, z1 - 0.1]] as const) k.box(INK.steel, x, (y - 0.15) / 2, z, 0.12, y - 0.15, 0.12, { collide: false });
}

// The Kōban: a small police box on the plaza's corner, its red lamp over the door.
function koban(k: CityKit, signs: SignAtlas): void {
  const x0 = -21.6, x1 = -17.4, z0 = -27.8, z1 = -24.6;
  const o = { group: k.group('koban') };
  k.span(0xd9d3c6, x0, x1, 0, 3.2, z0, z1, o);
  k.span(0x5b6470, x0 - 0.3, x1 + 0.3, 3.2, 3.5, z0 - 0.3, z1 + 0.6, { ...o, collide: false });
  k.span(INK.frame, x0 + 1.2, x1 - 1.2, 0, 2.4, z1, z1 + 0.06, { collide: false });
  k.span(INK.glass, x0 + 1.3, x1 - 1.3, 0.1, 2.3, z1 + 0.06, z1 + 0.09, { collide: false });
  k.span(INK.frame, x1, x1 + 0.06, 1.0, 2.2, z0 + 0.6, z1 - 0.6, { collide: false });
  k.span(INK.glass, x1 + 0.06, x1 + 0.09, 1.1, 2.1, z0 + 0.7, z1 - 0.7, { collide: false });
  const sign = k.mesh(signs.face('交番', 1.6, 0.5, { paper: '#f6f6f2', ink: '#1f2b44', font: 'gothic', sub: 'KOBAN' }), signs.plain, (x0 + x1) / 2, 2.85, z1 + 0.62, { shadow: false });
  sign.rotation.y = 0;
  k.cyl(k.shared('koban-lamp', () => emissive(0xff3a2a, 2.6)), (x0 + x1) / 2, 3.75, z1 + 0.2, 0.18, 0.2, 0.36, 10, { shadow: false });
  k.light(0xff5040, 3, 5, (x0 + x1) / 2, 3.4, z1 + 1);
}

// A billboard frame on a roof: steel legs, a catwalk, and the poster.
function billboard(k: CityKit, signs: SignAtlas, x: number, y: number, z: number): void {
  const o = { group: 'w5' };
  for (const dx of [-2.4, 2.4]) { k.box(INK.steel, x + dx, y + 2.2, z, 0.2, 4.4, 0.2, o); k.box(INK.steel, x + dx, y + 1.6, z + 0.9, 0.08, 3.4, 0.08, { ...o, collide: false, rot: [-0.5, 0, 0] }); }
  k.box(0xf1ece0, x, y + 3.6, z - 0.05, 6.0, 2.8, 0.2, o);
  const poster = k.mesh(signs.face('もしもに 技能保険', 5.8, 2.6, { paper: '#e8eef0', ink: '#1f3a5a', font: 'gothic', sub: '発現の届出から 補償まで  東雲損保' }), signs.plain, x, y + 3.6, z + 0.06, { ...o, shadow: false });
  poster.rotation.y = 0;
  k.span(INK.steel, x - 3.0, x + 3.0, y + 2.1, y + 2.16, z, z + 0.7, { ...o, collide: false });
}

// A little shrine on a roof, as offices keep: a red fence, a box shrine on a stand.
function roofShrine(k: CityKit, x: number, y: number, z: number, tile: THREE.Material): void {
  const o = { group: 'e5' };
  k.box(0x9a948a, x, y + 0.3, z, 1.4, 0.6, 1.2, o);
  k.box(INK.woodLight, x, y + 1.0, z, 0.9, 0.8, 0.7, { ...o, collide: false });
  const roof = k.box(tile, x, y + 1.5, z, 1.2, 0.12, 1.0, { ...o, collide: false, uv: 1.2 });
  roof.rotation.z = 0.05;
  k.box(VERMILION, x, y + 1.0, z + 0.36, 0.3, 0.5, 0.02, { ...o, collide: false, shadow: false });
  for (const dx of [-1, 1]) k.box(VERMILION, x + dx, y + 0.5, z + 0.9, 0.08, 1.0, 0.08, { ...o, collide: false });
  k.box(VERMILION, x, y + 1.0, z + 0.9, 2.3, 0.08, 0.1, { ...o, collide: false });
}

// ------------------------------------------------------------ the shrine
// An Inari shrine among the houses: a vermilion torii on the lane, a path of
// stepping stones up to a small worship hall on a stone platform, two
// foxes on plinths, a row of small torii down the east side to a hokora, a
// great camphor tree bound with a rope, a water basin, and the ema rack.
function shrine(k: CityKit, signs: SignAtlas, tile: THREE.Material, r: () => number): void {
  const S = SHRINE;
  const gravel = k.shared('gravel', () => toon(0xdcd3c0));
  k.span(gravel, S.x0, S.x1, 0, 0.06, S.z0, S.z1, { shadow: false, surface: 'stone' });
  // A low stone wall with a clipped hedge, open at the torii and the side gate.
  const wall = (x0: number, x1: number, z0: number, z1: number): void => {
    if (Math.max(x1 - x0, z1 - z0) < 0.2) return;
    k.span(0xa3a7a8, x0, x1, 0, 0.55, z0, z1);
    k.span(0x4f7a46, x0 + (x1 - x0 > 1 ? 0 : -0.15), x1 + (x1 - x0 > 1 ? 0 : 0.15), 0.55, 1.15, z0 + (z1 - z0 > 1 ? 0 : -0.15), z1 + (z1 - z0 > 1 ? 0 : 0.15), { collide: false });
  };
  wall(S.x0, S.x1, S.z0, S.z0 + 0.3);
  wall(S.x0, S.x0 + 0.3, S.z0, S.z1);
  wall(S.x1 - 0.3, S.x1, S.z0, -5.2);
  wall(S.x1 - 0.3, S.x1, -3.2, S.z1);
  wall(S.x0, S.toriiX - 2.2, S.z1 - 0.3, S.z1);
  wall(S.toriiX + 2.2, S.x1, S.z1 - 0.3, S.z1);
  // The torii on the lane.
  torii(k, S.toriiX, S.z1 + 0.6, 4.2, 4.6, 0.26);
  // Stepping stones up to the hall.
  for (let z = S.z1 - 1; z > -4.6; z -= 1.15) k.cyl(0xb9b2a5, S.toriiX + (r() - 0.5) * 0.3, 0.08, z, 0.48, 0.52, 0.1, 7, { collide: false, shadow: false });
  // The worship hall on its platform.
  const hx0 = S.toriiX - 4, hx1 = S.toriiX + 4, hz0 = S.z0 + 1, hz1 = -5.5;
  const o = { group: k.group('shrine-hall') };
  k.span(0xa3a7a8, hx0 - 0.6, hx1 + 0.6, 0, 0.6, hz0 - 0.6, hz1 + 0.6, { surface: 'stone' });
  for (let i = 0; i < 2; i++) k.span(0xb0a998, S.toriiX - 1.4, S.toriiX + 1.4, 0, 0.2 + i * 0.2, hz1 + 0.6, hz1 + 1.2 - i * 0.3, { surface: 'stone' });
  k.span(0xe6dfcf, hx0, hx1, 0.6, 3.8, hz0, hz1, { ...o, surface: 'wood' });
  k.span(INK.woodDark, hx0 - 0.05, hx1 + 0.05, 0.6, 1.4, hz0 - 0.05, hz1 + 0.05, { ...o, collide: false });
  for (const x of [hx0, hx0 + 2.6, hx1 - 2.6, hx1]) k.box(VERMILION, x, 2.2, hz1 + 0.05, 0.26, 3.2, 0.26, { ...o, collide: false });
  k.span(VERMILION, hx0, hx1, 3.5, 3.8, hz1, hz1 + 0.2, { ...o, collide: false });
  // A lattice front, the offering box, the bell rope.
  for (let x = hx0 + 2.8; x < hx1 - 2.7; x += 0.3) k.span(INK.woodDark, x, x + 0.04, 0.7, 3.4, hz1 + 0.02, hz1 + 0.06, { ...o, collide: false, shadow: false });
  k.span(INK.wood, S.toriiX - 0.8, S.toriiX + 0.8, 0.6, 1.3, hz1 + 0.4, hz1 + 1.0, {});
  k.cyl(0xd9a640, S.toriiX, 3.1, hz1 + 0.5, 0.22, 0.26, 0.36, 10, { collide: false });
  k.box(0xd8bf86, S.toriiX, 2.0, hz1 + 0.52, 0.08, 2.1, 0.08, { collide: false });
  // The rope across the front with its paper streamers.
  k.box(0xd8bf86, S.toriiX, 3.1, hz1 + 0.35, hx1 - hx0 - 1, 0.18, 0.18, { collide: false });
  for (let x = hx0 + 1.2; x < hx1 - 1; x += 1.1) k.box(0xf6eedc, x, 2.8, hz1 + 0.42, 0.14, 0.42, 0.02, { collide: false, shadow: false, rot: [0, 0, (x % 2) * 0.2] });
  gable(k, { x0: hx0 - 0.4, x1: hx1 + 0.4, z0: hz0 - 0.4, z1: hz1 + 0.4 }, 3.8, 'x', tile, o, 0.6);
  const plate = k.mesh(signs.face('稲荷', 0.5, 1.3, { paper: '#2b1d1a', ink: '#e8c36a', font: 'mincho', rule: true }), signs.plain, S.toriiX, 3.9, hz1 + 0.62, { shadow: false });
  plate.rotation.y = 0;
  // The foxes on their plinths either side of the path.
  for (const side of [-1, 1]) fox(k, S.toriiX + side * 2.2, -1.2, side);
  // A row of small torii down the east side to a hokora.
  for (let i = 0; i < 9; i++) torii(k, S.x1 - 1.6, 2.6 - i * 1.15, 1.4, 2.3, 0.09, true);
  const hk = { group: k.group('shrine-hall') };
  k.span(0xa3a7a8, S.x1 - 2.4, S.x1 - 0.8, 0, 0.5, S.z0 + 0.5, S.z0 + 1.6);
  k.span(INK.woodLight, S.x1 - 2.1, S.x1 - 1.1, 0.5, 1.3, S.z0 + 0.6, S.z0 + 1.4, { ...hk, collide: false });
  k.span(tile, S.x1 - 2.3, S.x1 - 0.9, 1.3, 1.42, S.z0 + 0.45, S.z0 + 1.6, { ...hk, collide: false, uv: 1.2 });
  // The camphor tree bound with rope.
  {
    const x = S.x0 + 3.2, z = -1;
    k.cyl(0x5a4030, x, 2.2, z, 0.55, 0.85, 4.4, 9);
    k.solid(x, 2.2, z, 0.75, 2.2, 0.75);
    k.cyl(0xd8bf86, x, 1.8, z, 0.82, 0.82, 0.2, 12, { collide: false });
    for (let i = 0; i < 4; i++) k.box(0xf6eedc, x + Math.cos(i * 1.6) * 0.84, 1.55, z + Math.sin(i * 1.6) * 0.84, 0.14, 0.4, 0.02, { collide: false, shadow: false, rot: [0, -i * 1.6 + Math.PI / 2, 0] });
    for (let i = 0; i < 7; i++) {
      const a = i * 0.9 + r() * 0.4, rad = 1.6 + r() * 1.4;
      k.mesh(new THREE.IcosahedronGeometry(2.0 + r() * 0.8, 1), i % 2 ? 0x3e6b45 : 0x4c7d4c, x + Math.cos(a) * rad, 5.4 + (i % 3) * 1.0, z + Math.sin(a) * rad, { group: 'shrine-tree' });
    }
    k.group('shrine-tree', true);
  }
  // The water basin under its roof by the path.
  {
    const x = S.toriiX + 3.6, z = 1.4;
    for (const [dx, dz] of [[-0.7, -0.5], [0.7, -0.5], [-0.7, 0.5], [0.7, 0.5]] as const) k.box(INK.woodDark, x + dx, 1.1, z + dz, 0.12, 2.2, 0.12, { collide: false });
    k.span(tile, x - 1.0, x + 1.0, 2.2, 2.32, z - 0.8, z + 0.8, { collide: false, uv: 1.2 });
    k.span(0x9a948a, x - 0.6, x + 0.6, 0, 0.7, z - 0.35, z + 0.35, {});
    k.span(0x3f7f96, x - 0.5, x + 0.5, 0.7, 0.72, z - 0.25, z + 0.25, { collide: false, shadow: false });
  }
  // The ema rack: small wooden plaques hung on a frame.
  {
    const x = S.toriiX - 4.2, z = 1.6;
    for (const dx of [-1, 1]) k.box(INK.woodDark, x + dx, 0.8, z, 0.08, 1.6, 0.08, { collide: false });
    k.box(INK.woodDark, x, 1.5, z, 2.2, 0.06, 0.06, { collide: false });
    k.box(INK.woodDark, x, 1.05, z, 2.2, 0.06, 0.06, { collide: false });
    for (let i = 0; i < 12; i++) k.box(INK.woodLight, x - 0.9 + (i % 6) * 0.36, i < 6 ? 1.34 : 0.9, z + 0.04, 0.26, 0.18, 0.02, { collide: false, shadow: false, rot: [0, 0, (r() - 0.5) * 0.2] });
    k.solid(x, 0.8, z, 1.1, 0.8, 0.1);
  }
  // Stone lanterns at the hall's steps, lit.
  for (const side of [-1, 1]) stoneLantern(k, S.toriiX + side * 3.6, -3.6);
  k.light(0xffb36b, 5, 7, S.toriiX, 1.8, -3);
}

function torii(k: CityKit, x: number, z: number, w: number, h: number, t: number, small = false): void {
  for (const dx of [-w / 2, w / 2]) {
    k.cyl(VERMILION, x + dx, h / 2, z, t, t * 1.08, h, 10, { collide: !small });
    if (!small) k.solid(x + dx, h / 2, z, t, h / 2, t);
    k.cyl(INK.black, x + dx, 0.18, z, t * 1.15, t * 1.2, 0.36, 10, { collide: false });
  }
  k.box(VERMILION, x, h * 0.78, z, w + t * 2.6, t * 0.9, t * 1.1, { collide: false });
  k.box(VERMILION, x, h + t * 0.4, z, w + t * 6, t * 1.1, t * 1.6, { collide: false });
  k.box(INK.black, x, h + t * 1.05, z, w + t * 7, t * 0.4, t * 1.9, { collide: false });
  for (const side of [-1, 1]) k.box(INK.black, x + side * (w / 2 + t * 3.4), h + t * 1.25, z, t * 1.6, t * 0.35, t * 1.9, { collide: false, rot: [0, 0, side * 0.25] });
}

// A fox on a plinth: a sitting body, a pointed head and ears, a tail up
// behind it, a red bib.
function fox(k: CityKit, x: number, z: number, side: number): void {
  k.span(0xa3a7a8, x - 0.45, x + 0.45, 0, 1.1, z - 0.45, z + 0.45);
  k.mesh(faceted(new THREE.ConeGeometry(0.3, 0.9, 6)), 0xf1ece0, x, 1.55, z);
  k.mesh(faceted(new THREE.ConeGeometry(0.16, 0.42, 5)), 0xf1ece0, x, 2.12, z + 0.12, { rot: [Math.PI / 2.4, 0, 0] });
  for (const dx of [-0.09, 0.09]) k.mesh(faceted(new THREE.ConeGeometry(0.05, 0.2, 4)), 0xf1ece0, x + dx, 2.3, z - 0.02);
  k.mesh(faceted(new THREE.ConeGeometry(0.12, 0.8, 5)), 0xf1ece0, x - side * 0.25, 1.6, z - 0.28, { rot: [-0.6, 0, side * 0.5] });
  k.mesh(faceted(new THREE.ConeGeometry(0.26, 0.24, 6)), VERMILION, x, 1.82, z + 0.05, { rot: [Math.PI, 0, 0] });
}

function stoneLantern(k: CityKit, x: number, z: number): void {
  const stone = 0xa3a7a8, dark = 0x7c8284;
  k.cyl(stone, x, 0.11, z, 0.5, 0.6, 0.22, 8);
  k.cyl(stone, x, 0.67, z, 0.16, 0.22, 0.9, 8);
  k.cyl(stone, x, 1.18, z, 0.4, 0.4, 0.12, 6);
  k.cyl(k.shared('lantern', () => emissive(0xffa25a, 2.2)), x, 1.45, z, 0.26, 0.26, 0.42, 6);
  k.mesh(new THREE.ConeGeometry(0.62, 0.4, 6), dark, x, 1.86, z);
  k.solid(x, 1, z, 0.4, 1, 0.4);
}

// ------------------------------------------------------------ the park
// A pocket park off the main road: packed earth, a great zelkova, benches
// round it, a slide, a drinking fountain, and the bridge over the canal.
function park(k: CityKit, r: () => number): void {
  const P = PARK;
  k.span(k.shared('earth', () => toon(0xcdb88f)), P.x0, P.x1, 0.04, 0.1, P.z0, P.z1, { shadow: false });
  for (const [x0, x1, z0, z1] of [[P.x0, -2.6, P.z0, P.z0 + 0.25], [2.6, P.x1, P.z0, P.z0 + 0.25], [P.x0, P.x0 + 0.25, P.z0, P.z1], [P.x1 - 0.25, P.x1, P.z0, P.z1]] as const) {
    k.span(0x7d9a5a, x0, x1, 0.1, 0.75, z0, z1, { collide: true });
  }
  tree(k, -3.8, 32.6, 'zelkova', 1.45, r, 0.1);
  tree(k, 5.4, 30.4, 'cherry', 0.9, r, 0.1);
  for (const [x, z, rot] of [[-3.8, 29.6, 0], [-1.6, 32.6, -Math.PI / 2], [4.2, 34.4, Math.PI]] as const) {
    const g = new THREE.Group(); g.position.copy(k.w(x, 0.1, z)); g.rotation.y = rot; k.root.add(g);
    const add = (c: number, w: number, h: number, d: number, px: number, py: number, pz: number): void => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), k.paint(c)); m.position.set(px, py, pz); m.castShadow = true; g.add(m); };
    add(INK.woodLight, 1.8, 0.06, 0.45, 0, 0.45, 0); add(INK.woodLight, 1.8, 0.3, 0.05, 0, 0.72, -0.22);
    for (const dx of [-0.75, 0.75]) add(0x6a6f72, 0.1, 0.45, 0.45, dx, 0.22, 0);
    k.solid(x, 0.5, z, rot ? 0.3 : 0.9, 0.4, rot ? 0.9 : 0.3);
  }
  // The slide: a ladder up to a little deck, the chute down.
  {
    const x = 5.6, z = 33.6;
    for (const [dx, dz] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]] as const) k.box(0xd9a040, x + dx, 0.85, z + dz, 0.08, 1.5, 0.08, { collide: false });
    k.box(0x2f6a8a, x, 1.6, z, 1.1, 0.08, 1.1);
    k.box(0xc8463a, x - 1.3, 0.95, z, 2.3, 0.06, 0.7, { rot: [0, 0, 0.55] });
    k.box(0xd9a040, x + 0.8, 0.8, z, 0.06, 1.6, 0.6, { rot: [0, 0, -0.35], collide: false });
  }
  k.cyl(0xb0a998, -6.4, 0.5, 34.8, 0.18, 0.22, 0.9, 8);
  k.cyl(0x9fb0b4, -6.4, 1.0, 34.8, 0.26, 0.2, 0.1, 10, { collide: false });
}

// ------------------------------------------------------------ the Kuroda house
// Behind a fence of charred cedar: the main house in black plaster, a yard
// of oil-stained concrete, a black truck, fuel drums by the warehouse, and
// the warehouse itself with its stair to the roof. The gate on the back
// street has two lanterns with the house's crest and a name plate; nothing
// else says whose it is.
function kuroda(k: CityKit, signs: SignAtlas, tile: THREE.Material, lantern: THREE.Material, r: () => number, flight: (id: string, x: number, y: number, z: number, dx: number, dz: number, width: number, style: 'steel' | 'stone', o?: PieceOpts) => void): void {
  const K = KURODA;
  const yakisugi = k.shared('yakisugi', () => toon(0xffffff, { map: planks(0x3d3337, 0x2e2629, 0x141012, 10) }));
  k.span(k.shared('yard', () => toon(0x9d978c)), K.x0, K.x1, 0, 0.04, K.z0, K.z1, { shadow: false, collide: false });
  for (const [x, z, s] of [[40.5, 4, 1.1], [37.5, 11.5, 0.7], [47, -1.5, 0.8]] as const) k.cyl(0x8d877c, x, 0.045, z, s, s * 0.9, 0.012, 9, { collide: false, shadow: false });
  const fence = (x0: number, x1: number, z0: number, z1: number): void => {
    if (Math.max(x1 - x0, z1 - z0) < 0.2) return;
    k.span(yakisugi, x0, x1, 0, K.fenceH, z0, z1, { uv: 1.4, surface: 'wood' });
    k.span(INK.tileEdge, x0 - 0.12, x1 + 0.12, K.fenceH, K.fenceH + 0.16, z0 - 0.12, z1 + 0.12, { collide: false });
  };
  const t = 0.3;
  fence(K.x0, K.x0 + t, K.z0, K.gate.z0 - 0.3);
  fence(K.x0, K.x0 + t, K.gate.z1 + 0.3, K.z1);
  fence(K.x0, K.x1, K.z0, K.z0 + t);
  fence(K.x1 - t, K.x1, K.z0, K.z1);
  fence(K.x0, K.back.x0, K.z1 - t, K.z1);
  fence(K.back.x1, K.x1, K.z1 - t, K.z1);
  // The gate: two posts, a beam, a tiled hood; the doors stand open inward.
  const gz0 = K.gate.z0 - 0.3, gz1 = K.gate.z1 + 0.3, gx = K.x0 + t / 2;
  for (const z of [gz0, gz1]) k.box(0x2a2326, gx, 1.8, z, 0.4, 3.6, 0.4);
  k.box(0x2a2326, gx, 3.3, (gz0 + gz1) / 2, 0.36, 0.3, gz1 - gz0 + 0.4, { collide: false });
  gable(k, { x0: gx - 0.9, x1: gx + 0.9, z0: gz0 - 0.4, z1: gz1 + 0.4 }, 3.6, 'z', tile, {}, 0.5);
  for (const [z, s] of [[K.gate.z0 + 0.1, 1], [K.gate.z1 - 0.1, -1]] as const) k.box(0x3a3034, gx + 1.25, 1.45, z + s * 0.06, 2.3, 2.9, 0.12, { rot: [0, s * 0.15, 0] });
  for (const z of [gz0 - 0.55, gz1 + 0.55]) {
    k.box(INK.black, gx - 0.4, 3.0, z, 0.3, 0.08, 0.08, { collide: false });
    k.cyl(lantern, gx - 0.55, 2.55, z, 0.32, 0.32, 0.7, 12, { shadow: false });
    for (const dz of [-1, 1]) {
      const crest = k.mesh(signs.face('', 0.42, 0.42, { paper: '#f2e4c8', ink: '#1a1416', mark: 'crest' }), signs.lit, gx - 0.55, 2.55, z + dz * 0.33, { shadow: false });
      crest.rotation.y = dz > 0 ? 0 : Math.PI;
    }
    k.cyl(INK.black, gx - 0.55, 2.94, z, 0.22, 0.22, 0.08, 12, { collide: false, shadow: false });
    k.cyl(INK.black, gx - 0.55, 2.16, z, 0.22, 0.22, 0.08, 12, { collide: false, shadow: false });
  }
  k.light(0xffa060, 6, 7, K.x0 - 1.2, 2.5, (K.gate.z0 + K.gate.z1) / 2);
  const plate = k.mesh(signs.face('黒田', 0.24, 0.8, { paper: '#d9c9a6', ink: '#1a1416', font: 'mincho', rule: true }), signs.plain, gx - 0.21, 1.7, gz0, { shadow: false });
  plate.rotation.y = -Math.PI / 2;

  // The main house: black plaster over dark boarding, a tiled gable.
  const KH = KURODA_HOUSE;
  const hb: Building = { id: 'kuroda-house', kind: 'house', x0: KH.x0, x1: KH.x1, z0: KH.z0, z1: KH.z1, h: KH.h, front: 's', color: 0x2f2a2d, group: 'kuroda-house' };
  house(k, hb, k.group('kuroda-house'), tile, r);
  // A veranda along the yard side.
  k.span(INK.woodLight, KH.x0 + 0.5, KH.x1 - 0.5, 0, 0.45, KH.z1, KH.z1 + 1.0, { surface: 'wood' });

  // The warehouse: ribbed steel walls, a sliding door, a flat roof with a
  // parapet; a steel stair up its west side.
  const W = WAREHOUSE;
  const wo = { group: k.group('warehouse') };
  const ribs = k.shared('ribs', () => toon(0xffffff, { map: planks(0x7f8b84, 0x76827b, 0x5c6862, 12) }));
  k.span(ribs, W.x0, W.x1, 0, W.h, W.z0, W.z1, { ...wo, uv: 1.6, surface: 'metal' });
  k.span(INK.band, W.x0 - 0.04, W.x1 + 0.04, 0, 0.5, W.z0 - 0.04, W.z1 + 0.04, { ...wo, collide: false });
  k.span(0x5c6862, W.x0 - 0.15, W.x1 + 0.15, W.h - 0.3, W.h, W.z0 - 0.15, W.z1 + 0.15, { ...wo, collide: false });
  k.span(INK.roof, W.x0 + 0.2, W.x1 - 0.2, W.h, W.h + 0.04, W.z0 + 0.2, W.z1 - 0.2, { ...wo, collide: false, shadow: false });
  // The sliding door, its leaf drawn half across, the dark beyond it, and its rail.
  const leaf = W.door.z0 + (W.door.z1 - W.door.z0) * 0.45;
  k.span(0x2a2f2c, W.x0 - 0.06, W.x0, 0, 4.4, leaf, W.door.z1, { collide: false });
  k.span(0x5b6470, W.x0 - 0.16, W.x0 - 0.04, 0, 4.5, W.door.z0, leaf + 0.1, { collide: false });
  for (let z = W.door.z0 + 0.4; z < leaf; z += 0.6) k.span(0x4c545e, W.x0 - 0.2, W.x0 - 0.16, 0.2, 4.3, z, z + 0.08, { collide: false, shadow: false });
  k.span(INK.steel, W.x0 - 0.24, W.x0, 4.5, 4.7, W.door.z0 - 0.2, W.door.z1 + 0.2, { collide: false });
  const placard = k.mesh(signs.face('危険物', 1.3, 0.7, { paper: '#f6f2e6', ink: '#b8402f', font: 'gothic', rule: true, sub: '第四類  火気厳禁' }), signs.plain, W.x0 - 0.04, 5.4, (W.door.z0 + W.door.z1) / 2, { shadow: false });
  placard.rotation.y = -Math.PI / 2;
  // The roof: a parapet open where the stair lands, skylights, a tank, the crest painted big.
  const wp = (x0: number, x1: number, z0: number, z1: number): void => {
    k.span(INK.parapet, x0, x1, W.h, W.h + 0.7, z0, z1, wo);
    k.span(INK.roofDark, x0 - 0.03, x1 + 0.03, W.h + 0.7, W.h + 0.76, z0 - 0.03, z1 + 0.03, { ...wo, collide: false });
  };
  wp(W.x0, W.x1, W.z0, W.z0 + 0.22);
  wp(W.x0, W.x1, W.z1 - 0.22, W.z1);
  wp(W.x1 - 0.22, W.x1, W.z0, W.z1);
  wp(W.x0, W.x0 + 0.22, W.z0 + 1.8, W.z1);
  for (const z of [-4, 6]) k.span(0xc9d6da, W.x0 + 9, W.x1 - 1.6, W.h + 0.04, W.h + 0.3, z - 0.8, z + 0.8, { ...wo });
  tank(k, W.x1 - 2.4, W.h, W.z1 - 2.6, wo);
  const crest = k.mesh(signs.face('', 5, 5, { paper: '#8c8579', ink: '#2a2326', mark: 'crest' }), signs.plain, W.x0 + 5, W.h + 0.05, 1, { ...wo, shadow: false });
  crest.rotation.x = -Math.PI / 2;
  for (const [x, z] of [[W.x0 + 2, 9], [W.x0 + 3.3, 9], [W.x1 - 2, -7.6]] as const) k.box(INK.ac, x, W.h + 0.36, z, 0.9, 0.68, 0.42, wo);
  k.span(INK.steelLight, W.x0 - 1.6, W.x0, W.h - 0.15, W.h, W.z0, W.z0 + 1.8, { surface: 'metal' });
  flight('warehouse', W.x0 - 0.8, W.h, W.z0 + 1.8, 0, 1, 1.4, 'steel');

  // The drums, stacked by the warehouse door and along the fence; crates.
  const drums: [number, number][] = [[40.2, 7.6], [41.0, 8.2], [40.2, 8.8], [41.0, 9.4], [40.2, 10.2], [41.2, 10.8], [42.4, 11.5], [57.8, 13.0], [56.8, 13.0], [59, -11]];
  for (const [x, z] of drums) k.prop('drum', x, 0.05, z, r() * 3);
  k.prop('drum', 40.6, 1.05, 8.5);
  for (const [x, z] of [[35.2, -10.6], [36.4, -10.6], [35.8, -9.4]] as const) k.prop('crate', x, 0.05, z);
  // Pallets against the house wall, a hose reel on the warehouse, the lines
  // where the truck parks.
  for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) k.box(i % 2 ? INK.woodLight : 0xb08a5a, 35.2, 0.07 + i * 0.14, -4.4 + j * 0.32, 1.2, 0.1, 0.12, { collide: false });
  k.block(34.6, 35.8, 0, 0.42, -4.6, -3.2);
  k.cyl(0x8a2e24, W_HOSE.x, 1.2, W_HOSE.z, 0.45, 0.45, 0.25, 14, { rot: [0, 0, Math.PI / 2], collide: false });
  k.cyl(INK.steel, W_HOSE.x + 0.05, 1.2, W_HOSE.z, 0.12, 0.12, 0.3, 8, { rot: [0, 0, Math.PI / 2], collide: false });
  for (const z of [7.6, 11.2]) k.span(0xe9e4d8, 27, 34, 0.04, 0.05, z - 0.06, z + 0.06, { collide: false, shadow: false });
  // A corner of garden inside the gate: raked gravel, a trained pine, rocks, a stone lantern.
  k.span(k.shared('gravel', () => toon(0xdcd3c0)), K.x0 + 0.3, 24.5, 0, 0.05, 10.2, K.z1 - 0.3, { collide: false, shadow: false });
  k.span(0x8d9392, 24.5, 24.7, 0, 0.18, 10.2, K.z1 - 0.3);
  pine(k, 21.2, 12.0);
  for (const [x, z, s] of [[23.2, 11.2, 0.5], [19.6, 10.9, 0.35], [23.6, 12.8, 0.3]] as const) k.mesh(faceted(new THREE.DodecahedronGeometry(s, 0)), 0x7c8284, x, s * 0.5, z);
  stoneLantern(k, 19.4, 12.8);
  // The black truck by the house, its bed loaded and roped.
  truck(k, 30.5, 9.4);
}

// A trained black pine: a leaning trunk and flat cloud-pruned pads.
function pine(k: CityKit, x: number, z: number): void {
  k.cyl(INK.woodDark, x, 1.2, z, 0.14, 0.22, 2.4, 6, { rot: [0, 0, 0.18] });
  k.solid(x, 1.2, z, 0.22, 1.2, 0.22);
  for (const [dx, y, dz, r] of [[-0.3, 2.3, 0.1, 1.2], [0.5, 1.7, -0.3, 0.9], [-0.1, 2.9, 0.2, 0.8], [0.9, 2.5, 0.4, 0.7]] as const) {
    const m = k.mesh(faceted(new THREE.IcosahedronGeometry(r, 0)), 0x3e6b45, x + dx, y, z + dz);
    m.scale.set(1.3, 0.42, 1.1);
  }
}

// A small black truck: cab, flat bed with a load under a tarp, wheels.
function truck(k: CityKit, x: number, z: number): void {
  const o: PieceOpts = { group: k.group('kuroda-truck') };
  k.span(0x1f1b1e, x - 2.2, x - 0.6, 0.5, 2.0, z - 0.85, z + 0.85, o);
  k.span(INK.glassDark, x - 2.24, x - 1.0, 1.25, 1.85, z - 0.8, z + 0.8, { ...o, collide: false });
  k.span(0x2a2528, x - 0.6, x + 2.4, 0.5, 0.9, z - 0.85, z + 0.85, o);
  k.span(0x3a3a34, x - 0.4, x + 2.3, 0.9, 1.7, z - 0.8, z + 0.8, o);
  for (const dz of [-0.81, 0.81]) for (const dx of [-0.2, 1.0, 2.2]) k.box(0xd8bf86, x + dx, 1.3, z + dz, 0.04, 0.84, 0.03, { ...o, collide: false, shadow: false });
  for (const dx of [-1.6, 1.6]) for (const dz of [-0.85, 0.85]) k.cyl(INK.black, x + dx, 0.34, z + dz, 0.34, 0.34, 0.24, 10, { ...o, rot: [Math.PI / 2, 0, 0], collide: false });
}

function van(k: CityKit, x: number, z: number, color: number): void {
  const o: PieceOpts = { group: k.group('van') };
  k.span(color, x - 2.3, x + 2.3, 0.45, 2.0, z - 0.85, z + 0.85, o);
  k.span(0xf1ece0, x - 2.3, x + 2.3, 1.0, 1.3, z - 0.86, z + 0.86, { ...o, collide: false });
  k.span(INK.glassDark, x + 1.4, x + 2.34, 1.35, 1.85, z - 0.8, z + 0.8, { ...o, collide: false });
  for (const dx of [-1.5, 1.5]) for (const dz of [-0.85, 0.85]) k.cyl(INK.black, x + dx, 0.34, z + dz, 0.34, 0.34, 0.24, 10, { ...o, rot: [Math.PI / 2, 0, 0], collide: false });
}

function scooter(k: CityKit, x: number, z: number): void {
  k.box(0xe8e2d0, x, 0.55, z, 1.4, 0.5, 0.4, {});
  k.box(0xe8e2d0, x + 0.55, 0.95, z, 0.2, 0.7, 0.3, { collide: false });
  k.box(INK.black, x - 0.2, 0.86, z, 0.7, 0.12, 0.34, { collide: false });
  for (const dx of [-0.55, 0.55]) k.cyl(INK.black, x + dx, 0.24, z, 0.24, 0.24, 0.12, 10, { rot: [Math.PI / 2, 0, 0], collide: false });
}
