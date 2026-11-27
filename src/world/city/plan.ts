// Shinonome (東雲), a ward of the city down the pass from the valley: the
// plan every part of the district reads (the build, the map, the zones, the
// spawn points and the checks). Region metres: north is -z, east +x, the
// origin at the foot of the arcade. Streets are at y 0.
//
// North to south: the railway on its viaduct with the station deck over the
// plaza; the station street (駅前通り); the covered shopping street running
// south between two rows of shops, the back alleys and the Inari shrine to
// the west, the Kuroda house behind its black fence to the east; the main
// road (大通り); a row of shops and the pocket park; the canal walk.

export type Rect = { x0: number; x1: number; z0: number; z1: number };
export type Face = 'n' | 's' | 'e' | 'w';

export const BOUNDS: Rect = { x0: -66, x1: 66, z0: -50, z1: 52 };

// The railway: tracks on a viaduct deck the whole width of the ward.
export const RAIL = { z0: -48, z1: -40, deckY: 6.0, tracks: [-45.6, -42.4] as const };
// The station deck: the platform along the tracks and the forecourt deck over the ticket hall, one level.
export const STATION = { x0: -22, x1: 22, z0: -40, z1: -28, y: 7.1, platformZ: -36.4, hall: { x0: -13, x1: 13, z0: -40, z1: -30 } };
// The grand stair from the forecourt down into the plaza.
export const GRAND_STAIR = { x0: -2.6, x1: 2.6, top: -28 };
// The pedestrian deck: from the station east over the plaza's edge and the station street to the arcade's east roofs.
export const PED_DECK = { x0: 14, x1: 20, z0: -28, z1: -9, y: 7.1 };
export const PLAZA: Rect = { x0: -22, x1: 22, z0: -28, z1: -18 };
export const EKIMAE: Rect = { x0: -66, x1: 66, z0: -18, z1: -14 };
export const UNDER: Rect = { x0: -66, x1: 66, z0: -40, z1: -36 };
// The covered shopping street and its arcade roof.
export const ARCADE = { x0: -4, x1: 4, z0: -14, z1: 18, spring: 5.0, apex: 6.4 };
// The cross alley through both rows of shops.
export const CROSS = { z0: 0, z1: 2.5 };
export const BACK_W: Rect = { x0: -18, x1: -14, z0: -14, z1: 18 };
export const BACK_E: Rect = { x0: 14, x1: 18, z0: -14, z1: 18 };
// The catwalk over the arcade between the two rows' roofs.
export const CATWALK = { z0: -6.2, z1: -5.0, y: 7.0 };
export const ODORI = { z0: 18, z1: 28, road0: 20, road1: 26 };
export const CANAL = { x0: -80, x1: 80, z0: 40, z1: 47, waterY: -1.5, bedY: -2.8 };
export const PROMENADE = { z0: 36, z1: 40 };
export const SOUTH_WALK = { z0: 47, z1: 50 };
export const PARK: Rect = { x0: -8, x1: 8, z0: 28, z1: 36 };
// The landing at the water's edge on the north wall, with steps down to it.
export const LANDING = { x0: -26, x1: -12, z0: 40, z1: 41.4, y: -1.15, steps: { x0: -14, x1: -12.4 } };
export const BRIDGES = [
  { id: 'park', x0: -2.4, x1: 2.4, deckY: 0.42 },
  { id: 'east', x0: 38, x1: 40.6, deckY: 0.42 },
] as const;
export const SHRINE = { x0: -50, x1: -34, z0: -12, z1: 4, toriiX: -42 };
export const KURODA = { x0: 18, x1: 62, z0: -12, z1: 14, gate: { z0: 2, z1: 7 }, back: { x0: 48, x1: 54 }, fenceH: 2.7 };
export const KURODA_HOUSE: Rect & { h: number } = { x0: 21, x1: 34, z0: -10, z1: 0, h: 6.2 };
export const WAREHOUSE: Rect & { h: number; door: { z0: number; z1: number } } = { x0: 44, x1: 60, z0: -10, z1: 12, h: 9.0, door: { z0: 6, z1: 11 } };

// ------------------------------------------------------------ buildings
// Every building is a box of `h` metres on its footprint, finished by kind:
//  - shop: a shopfront on the street face, flat roof with a parapet;
//  - house: two storeys of plaster and boarding under a tiled gable;
//  - flats: balconies with railings and air-conditioner units on the street face;
//  - office: ribbon windows; tall: a backdrop block, plain windows, no roof access.
// `walk` roofs are part of the rooftop circuit: no parapet along an edge that
// meets another walkable roof, so a run carries on across.
export type Kind = 'shop' | 'house' | 'flats' | 'office' | 'tall' | 'sento';
export interface Building extends Rect {
  id: string;
  kind: Kind;
  h: number;
  front: Face;
  // Facade colour.
  color: number;
  // The cut-away group; houses in a row share one.
  group?: string;
  walk?: boolean;
  // A shop's sign and the colour of its awning.
  sign?: string;
  signStyle?: 'v' | 'h';
  awning?: number;
  // What the shop shows in its window bay.
  goods?: 'books' | 'food' | 'bottles' | 'flowers' | 'cloth' | 'tools' | 'dark';
  // An extra sign along the arcade or street, hung out from the facade.
  blade?: string;
}

// Facade colours: plaster, tile and mortar a few tones apart, all warm.
const C = {
  cream: 0xeadfc8, sand: 0xdcc9a6, rose: 0xe3c5b3, sage: 0xc9d0bb, sky: 0xc0ccd2, tileWhite: 0xe8e6dc,
  brick: 0xa46a52, ochre: 0xd9b778, mortar: 0xbab3a4, grey: 0xa9a9a2, slate: 0x8e98a0, brown: 0x9a7a62,
} as const;

export const BUILDINGS: Building[] = [
  // The west row of the arcade, north to south. Roofs walkable.
  { id: 'w1', kind: 'shop', x0: -14, x1: -4, z0: -14, z1: -8, h: 7.2, front: 'e', color: C.sand, walk: true, sign: '喫茶 灯', awning: 0x3c5a48, goods: 'food', blade: '珈琲' },
  { id: 'w2', kind: 'shop', x0: -14, x1: -4, z0: -8, z1: -3, h: 7.0, front: 'e', color: C.tileWhite, walk: true, sign: '古書', awning: 0x6e4a32, goods: 'books' },
  { id: 'w3', kind: 'shop', x0: -14, x1: -4, z0: -3, z1: 0, h: 7.4, front: 'e', color: C.rose, walk: true, sign: '豆腐', awning: 0xe8e2d0, goods: 'food' },
  { id: 'w4', kind: 'shop', x0: -14, x1: -4, z0: 2.5, z1: 8, h: 7.0, front: 'e', color: C.sage, walk: true, sign: '契約設計', signStyle: 'v', awning: 0x2f4a7a, goods: 'dark', blade: '相談' },
  { id: 'w5', kind: 'shop', x0: -14, x1: -4, z0: 8, z1: 13, h: 8.2, front: 'e', color: C.ochre, walk: true, sign: '焼鳥', awning: 0xb8402f, goods: 'food' },
  { id: 'w6', kind: 'shop', x0: -14, x1: -4, z0: 13, z1: 18, h: 6.6, front: 'e', color: C.mortar, walk: true, sign: '花', awning: 0x5f8a5a, goods: 'flowers' },
  // The east row, north to south.
  { id: 'e1', kind: 'shop', x0: 4, x1: 14, z0: -14, z1: -9, h: 7.1, front: 'w', color: C.sky, walk: true, sign: '薬', awning: 0x2f6a8a, goods: 'bottles', blade: 'くすり' },
  { id: 'e2', kind: 'shop', x0: 4, x1: 14, z0: -9, z1: -4, h: 7.0, front: 'w', color: C.cream, walk: true, sign: '酒', awning: 0x7a2e24, goods: 'bottles' },
  { id: 'e3', kind: 'shop', x0: 4, x1: 14, z0: -4, z1: 0, h: 7.6, front: 'w', color: C.brick, walk: true, sign: '質', awning: 0x2a2528, goods: 'dark' },
  { id: 'e4', kind: 'shop', x0: 4, x1: 14, z0: 2.5, z1: 7, h: 6.8, front: 'w', color: C.sand, walk: true, sign: '理容', awning: 0x2f4a7a, goods: 'cloth' },
  { id: 'e5', kind: 'shop', x0: 4, x1: 14, z0: 7, z1: 12.5, h: 7.4, front: 'w', color: C.sage, walk: true, sign: '金物', awning: 0xd9a040, goods: 'tools' },
  { id: 'e6', kind: 'shop', x0: 4, x1: 14, z0: 12.5, z1: 18, h: 9.8, front: 'w', color: C.tileWhite, sign: 'ラーメン', signStyle: 'v', awning: 0xc8463a, goods: 'food', blade: '中華そば' },

  // North of the station street, under the tracks' shadow.
  { id: 'nw1', kind: 'office', x0: -64, x1: -50, z0: -35, z1: -19, h: 16, front: 's', color: C.slate },
  { id: 'nw2', kind: 'flats', x0: -48, x1: -34, z0: -35, z1: -19, h: 12.8, front: 's', color: C.cream },
  { id: 'nw3', kind: 'shop', x0: -32, x1: -23, z0: -35, z1: -19, h: 10, front: 's', color: C.mortar, sign: '書店', awning: 0x2f4a7a, goods: 'books' },
  { id: 'ne1', kind: 'office', x0: 23, x1: 36, z0: -35, z1: -19, h: 19.5, front: 's', color: C.tileWhite, sign: 'ホテル東雲', signStyle: 'v' },
  { id: 'ne2', kind: 'flats', x0: 38, x1: 50, z0: -35, z1: -19, h: 12.8, front: 's', color: C.rose },
  { id: 'ne3', kind: 'shop', x0: 52, x1: 64, z0: -35, z1: -19, h: 9.6, front: 's', color: C.grey, sign: '損害保険', signStyle: 'h', awning: 0x3d5566, goods: 'dark', blade: '技能危険' },

  // The back alleys west of the arcade: two-storey houses in rows, a bath
  // house with its chimney, a block of flats. Each row fades together.
  { id: 'wa1', kind: 'house', x0: -34, x1: -27.2, z0: -13.6, z1: -5.4, h: 5.6, front: 'e', color: C.cream, group: 'roji-a' },
  { id: 'wa2', kind: 'house', x0: -24.8, x1: -18.4, z0: -13.6, z1: -5.4, h: 5.8, front: 'w', color: C.sand, group: 'roji-a' },
  { id: 'wa3', kind: 'house', x0: -34, x1: -27.2, z0: -3, z1: 3.6, h: 5.4, front: 's', color: C.sage, group: 'roji-b' },
  { id: 'wa4', kind: 'house', x0: -24.8, x1: -18.4, z0: -3, z1: 3.6, h: 5.6, front: 's', color: C.rose, group: 'roji-b' },
  { id: 'wb1', kind: 'sento', x0: -64, x1: -52.5, z0: -13.4, z1: -3.4, h: 6.2, front: 's', color: C.tileWhite, sign: 'ゆ', awning: 0x2f4a7a },
  { id: 'wb2', kind: 'house', x0: -64, x1: -57, z0: -1.2, z1: 3.6, h: 5.4, front: 's', color: C.brown, group: 'roji-c' },
  { id: 'wb3', kind: 'house', x0: -55, x1: -50.6, z0: -1.2, z1: 3.6, h: 5.6, front: 's', color: C.cream, group: 'roji-c' },
  { id: 'wc1', kind: 'house', x0: -64, x1: -56.2, z0: 7.2, z1: 16.8, h: 5.6, front: 'n', color: C.sand, group: 'roji-d' },
  { id: 'wc2', kind: 'house', x0: -54, x1: -46.2, z0: 7.2, z1: 16.8, h: 5.8, front: 'n', color: C.sage, group: 'roji-d' },
  { id: 'wc3', kind: 'flats', x0: -44, x1: -36.2, z0: 7.2, z1: 16.8, h: 9.4, front: 'n', color: C.ochre },
  { id: 'wc4', kind: 'house', x0: -34, x1: -27.2, z0: 7.2, z1: 16.8, h: 5.6, front: 'n', color: C.rose, group: 'roji-e' },
  { id: 'wc5', kind: 'house', x0: -24.8, x1: -18.4, z0: 7.2, z1: 16.8, h: 5.4, front: 'n', color: C.cream, group: 'roji-e' },

  // South of the main road, backing onto the canal walk.
  { id: 's1', kind: 'flats', x0: -64, x1: -50, z0: 28.6, z1: 35.4, h: 12.8, front: 'n', color: C.sky },
  { id: 's2', kind: 'shop', x0: -48, x1: -36, z0: 28.6, z1: 35.4, h: 7.2, front: 'n', color: C.cream, sign: '技能診断 小児科', signStyle: 'h', awning: 0x6a9a8a, goods: 'dark' },
  { id: 's3', kind: 'shop', x0: -34, x1: -22, z0: 28.6, z1: 35.4, h: 6.6, front: 'n', color: C.ochre, sign: 'うどん', awning: 0x2f4a7a, goods: 'food' },
  { id: 's4', kind: 'shop', x0: -20, x1: -10, z0: 28.6, z1: 35.4, h: 9.6, front: 'n', color: C.mortar, sign: '自転車', awning: 0xd9a040, goods: 'tools' },
  { id: 's5', kind: 'shop', x0: 10, x1: 22, z0: 28.6, z1: 35.4, h: 6.4, front: 'n', color: C.tileWhite, sign: 'しののめマート', signStyle: 'h', awning: 0x3f8a5a, goods: 'bottles' },
  { id: 's6', kind: 'office', x0: 24, x1: 36, z0: 28.6, z1: 35.4, h: 13.2, front: 'n', color: C.sky },
  { id: 's7', kind: 'shop', x0: 42, x1: 52, z0: 28.6, z1: 35.4, h: 7.0, front: 'n', color: C.rose, sign: '時計 眼鏡', signStyle: 'h', awning: 0x7a2e24, goods: 'tools' },
  { id: 's8', kind: 'flats', x0: 54, x1: 64, z0: 28.6, z1: 35.4, h: 9.6, front: 'n', color: C.sand },
];

// The backdrop: tall blocks past the edges of the ward, never reached, so
// the district reads as one corner of a city from the roofs.
export const BACKDROP: { x0: number; x1: number; z0: number; z1: number; h: number; color: number }[] = [
  // North of the tracks.
  { x0: -70, x1: -48, z0: -66, z1: -51, h: 24, color: C.slate }, { x0: -46, x1: -30, z0: -64, z1: -51, h: 15, color: C.mortar },
  { x0: -28, x1: -8, z0: -70, z1: -51, h: 30, color: C.sky }, { x0: -6, x1: 10, z0: -64, z1: -51, h: 18, color: C.cream },
  { x0: 12, x1: 30, z0: -68, z1: -51, h: 26, color: C.grey }, { x0: 32, x1: 46, z0: -63, z1: -51, h: 14, color: C.rose },
  { x0: 48, x1: 70, z0: -70, z1: -51, h: 34, color: C.slate },
  // South of the canal.
  { x0: -70, x1: -52, z0: 51, z1: 64, h: 14, color: C.sand }, { x0: -50, x1: -32, z0: 51, z1: 62, h: 9, color: C.rose },
  { x0: -30, x1: -12, z0: 51, z1: 66, h: 20, color: C.sky }, { x0: -10, x1: 6, z0: 51, z1: 60, h: 8, color: C.cream },
  { x0: 8, x1: 26, z0: 51, z1: 64, h: 16, color: C.mortar }, { x0: 28, x1: 48, z0: 51, z1: 62, h: 11, color: C.sage },
  { x0: 50, x1: 70, z0: 51, z1: 68, h: 22, color: C.grey },
  // West and east, between the road and the tracks.
  { x0: -82, x1: -68, z0: -36, z1: -20, h: 18, color: C.sand }, { x0: -82, x1: -68, z0: -12, z1: 16, h: 12, color: C.sage },
  { x0: -82, x1: -68, z0: 29, z1: 36, h: 10, color: C.cream },
  { x0: 68, x1: 82, z0: -36, z1: -20, h: 21, color: C.rose }, { x0: 64, x1: 80, z0: -12, z1: 16, h: 15, color: C.slate },
  { x0: 68, x1: 82, z0: 29, z1: 36, h: 12, color: C.mortar },
];

// ------------------------------------------------------------ places
export type CityZoneId = 'city' | 'city-station' | 'city-plaza' | 'city-arcade' | 'city-alleys' | 'city-shrine' | 'city-kuroda'
  | 'city-canal' | 'city-park' | 'city-under' | 'city-road' | 'city-roofs';

export interface CityZoneDef { id: CityZoneId; label: string; jp: string; min: [number, number, number]; max: [number, number, number] }

// Specific places first; the roofs by height; the ward as the default.
export const ZONES: CityZoneDef[] = [
  { id: 'city-station', label: 'Shinonome Station', jp: '東雲駅', min: [STATION.x0, 5, RAIL.z0], max: [STATION.x1, 14, STATION.z1] },
  { id: 'city-shrine', label: 'Inari shrine', jp: '稲荷神社', min: [SHRINE.x0, -1, SHRINE.z0], max: [SHRINE.x1, 3, SHRINE.z1 + 2.4] },
  { id: 'city-kuroda', label: 'The Kuroda house', jp: '黒田', min: [KURODA.x0, -1, KURODA.z0], max: [KURODA.x1, 3, KURODA.z1] },
  { id: 'city-park', label: 'Pocket park', jp: '公園', min: [PARK.x0, -1, PARK.z0], max: [PARK.x1, 3, PARK.z1 + 1] },
  { id: 'city-arcade', label: 'Shinonome Ginza', jp: '東雲銀座', min: [ARCADE.x0, -1, ARCADE.z0], max: [ARCADE.x1, ARCADE.spring, ARCADE.z1] },
  { id: 'city-plaza', label: 'Station plaza', jp: '駅前広場', min: [PLAZA.x0, -1, PLAZA.z0], max: [PLAZA.x1, 4, EKIMAE.z1] },
  { id: 'city-under', label: 'Under the tracks', jp: 'ガード下', min: [BOUNDS.x0, -1, RAIL.z0], max: [BOUNDS.x1, 4, UNDER.z1] },
  { id: 'city-canal', label: 'Canal walk', jp: '運河', min: [BOUNDS.x0, -4, PROMENADE.z0], max: [BOUNDS.x1, 3, BOUNDS.z1] },
  { id: 'city-alleys', label: 'Back alleys', jp: '路地', min: [-66, -1, -14], max: [BACK_W.x0, 3, ODORI.z0] },
  { id: 'city-road', label: 'Ōdōri', jp: '大通り', min: [BOUNDS.x0, -1, ODORI.z0], max: [BOUNDS.x1, 3, ODORI.z1] },
  { id: 'city-roofs', label: 'Rooftops', jp: '屋上', min: [BOUNDS.x0, 3, BOUNDS.z0], max: [BOUNDS.x1, 40, BOUNDS.z1] },
  { id: 'city', label: 'Shinonome', jp: '東雲', min: [BOUNDS.x0 - 4, -6, BOUNDS.z0 - 4], max: [BOUNDS.x1 + 4, 40, BOUNDS.z1 + 4] },
];

// Where a player can be put down, in region metres (feet on the floor).
export const SPAWNS = {
  plaza: [-7, 0, -20.6],
  arcade: [0, 0, 4],
  platform: [-12, STATION.y, -37.6],
  roof: [-9, 7.0, -5.6],
  kuroda: [36, 0, 3],
  shrine: [-42, 0, 6.2],
  canal: [-16.5, 0, 38.4],
  park: [0, 0, 32],
  // Where the road from the pass comes in, at the west end of the main road.
  entrance: [-62, 0, 23],
} as const satisfies Record<string, readonly [number, number, number]>;
export type CitySpawn = keyof typeof SPAWNS;

// Places worth going to, as the map names them.
export const LANDMARKS: { id: CitySpawn | 'warehouse' | 'catwalk'; name: string; jp: string; at: [number, number] }[] = [
  { id: 'platform', name: 'Shinonome Station', jp: '東雲駅', at: [0, -36] },
  { id: 'plaza', name: 'Station plaza', jp: '駅前', at: [-12, -23] },
  { id: 'arcade', name: 'Shinonome Ginza', jp: '銀座', at: [0, 2] },
  { id: 'catwalk', name: 'Catwalk', jp: '渡り', at: [0, -5.6] },
  { id: 'shrine', name: 'Inari shrine', jp: '稲荷', at: [-42, -4] },
  { id: 'kuroda', name: 'Kuroda house', jp: '黒田', at: [30, 4] },
  { id: 'warehouse', name: 'Kuroda warehouse', jp: '倉庫', at: [52, 1] },
  { id: 'park', name: 'Pocket park', jp: '公園', at: [0, 32] },
  { id: 'canal', name: 'Canal walk', jp: '運河', at: [-20, 43.5] },
];
