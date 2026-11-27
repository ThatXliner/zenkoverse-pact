import * as THREE from 'three';
import { CityKit } from './kit';
import { SignAtlas } from './signs';
import { buildStreets } from './streets';
import { buildBuildings } from './buildings';
import { buildPlaces } from './places';
import { buildLife } from './life';
import { registerCityProps } from './props';
import type { Region, RegionContext, MapShape, FreezableWater } from './region';
import type { Zone } from '../compound';
import {
  BOUNDS, BUILDINGS, ZONES, SPAWNS, LANDMARKS, RAIL, STATION, PED_DECK, PLAZA, EKIMAE, ARCADE, BACK_W, BACK_E, CROSS, ODORI, CANAL, PROMENADE,
  SOUTH_WALK, PARK, SHRINE, KURODA, KURODA_HOUSE, WAREHOUSE, UNDER, CATWALK, BRIDGES, GRAND_STAIR,
} from './plan';

// Shinonome, the city ward: built from the plan (src/world/city/plan.ts) at
// the region's origin. See region.ts for the shape every region reports.

export function buildCity(ctx: RegionContext): Region {
  registerCityProps();
  const O = ctx.origin.clone();
  const k = new CityKit(ctx.parent, ctx.physics, ctx.lights, ctx.props, O);
  const signs = new SignAtlas();
  const streets = buildStreets(k);
  buildBuildings(k, signs);
  buildPlaces(k, signs);
  k.finish();
  const life = buildLife(O, ctx.assets, k.root);

  const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x + O.x, y + O.y, z + O.z);
  const zones: Zone[] = ZONES.map((z) => ({ id: z.id, label: z.label, min: v(...z.min), max: v(...z.max) }));
  const general = new Set(['city-roofs', 'city']);
  const inside = (z: Zone, p: THREE.Vector3): boolean => p.x >= z.min.x && p.x <= z.max.x && p.y >= z.min.y && p.y <= z.max.y && p.z >= z.min.z && p.z <= z.max.z;
  const roofs = zones.find((z) => z.id === 'city-roofs')!, ward = zones.find((z) => z.id === 'city')!;
  const spawns = Object.fromEntries(Object.entries(SPAWNS).map(([id, [x, y, z]]) => [id, v(x, y + 0.04, z)]));
  const waters: FreezableWater[] = [{ kind: 'channel', x0: O.x + BOUNDS.x0 - 10, x1: O.x + BOUNDS.x1 + 10, z0: O.z + CANAL.z0, z1: O.z + CANAL.z1, surfaceY: O.y + CANAL.waterY }];

  return {
    id: 'city',
    name: 'Shinonome',
    origin: O,
    bounds: new THREE.Box3(v(BOUNDS.x0, -4, BOUNDS.z0), v(BOUNDS.x1, 40, BOUNDS.z1)),
    zones,
    spawns,
    entrances: [{ id: 'pass', at: v(BOUNDS.x0, 0.1, (ODORI.z0 + ODORI.z1) / 2), heading: Math.PI / 2 }],
    occluders: k.occluders,
    waters,
    map: cityMap(O),
    zoneAt(p) {
      if (!inside(ward, p)) return null;
      for (const z of zones) if (!general.has(z.id) && inside(z, p)) return z;
      return inside(roofs, p) ? roofs : ward;
    },
    contains(p) { return inside(ward, p); },
    update(time, dt, player, camera) {
      streets.water.uniforms.time!.value = time;
      life.update(time, dt, player, camera);
    },
    dispose() {
      life.dispose();
      k.dispose();
      signs.texture.dispose();
    },
  };
}

// The plan as the map draws it, in world metres.
function cityMap(O: THREE.Vector3): Region['map'] {
  const shapes: MapShape[] = [];
  const rect = (kind: MapShape['kind'], x0: number, x1: number, z0: number, z1: number): void => { shapes.push({ kind, x: O.x + Math.min(x0, x1), z: O.z + Math.min(z0, z1), w: Math.abs(x1 - x0), h: Math.abs(z1 - z0) }); };
  rect('street', BOUNDS.x0, BOUNDS.x1, ODORI.road0, ODORI.road1);
  rect('paving', BOUNDS.x0, BOUNDS.x1, ODORI.z0, ODORI.road0);
  rect('paving', BOUNDS.x0, BOUNDS.x1, ODORI.road1, PROMENADE.z1);
  rect('street', BOUNDS.x0, BOUNDS.x1, EKIMAE.z0, EKIMAE.z1);
  rect('street', BACK_W.x0, BACK_W.x1, BACK_W.z0, BACK_W.z1);
  rect('street', BACK_E.x0, BACK_E.x1, BACK_E.z0, BACK_E.z1);
  rect('paving', PLAZA.x0, PLAZA.x1, PLAZA.z0, PLAZA.z1);
  rect('paving', BOUNDS.x0, BOUNDS.x1, UNDER.z0, UNDER.z1);
  rect('paving', ARCADE.x0, ARCADE.x1, ARCADE.z0, ARCADE.z1);
  rect('paving', -14, 14, CROSS.z0, CROSS.z1);
  rect('paving', BOUNDS.x0, BOUNDS.x1, SOUTH_WALK.z0, SOUTH_WALK.z1);
  rect('water', BOUNDS.x0, BOUNDS.x1, CANAL.z0, CANAL.z1);
  for (const b of BRIDGES) rect('paving', b.x0, b.x1, CANAL.z0 - 0.8, CANAL.z1 + 0.8);
  rect('green', PARK.x0, PARK.x1, PARK.z0, PARK.z1);
  rect('green', SHRINE.x0, SHRINE.x1, SHRINE.z0, SHRINE.z1);
  rect('paving', KURODA.x0, KURODA.x1, KURODA.z0, KURODA.z1);
  rect('rail', BOUNDS.x0, BOUNDS.x1, RAIL.z0, RAIL.z1);
  for (const b of BUILDINGS) rect(b.walk ? 'roof' : 'building', b.x0, b.x1, b.z0, b.z1);
  rect('building', KURODA_HOUSE.x0, KURODA_HOUSE.x1, KURODA_HOUSE.z0, KURODA_HOUSE.z1);
  rect('roof', WAREHOUSE.x0, WAREHOUSE.x1, WAREHOUSE.z0, WAREHOUSE.z1);
  rect('building', SHRINE.toriiX - 4, SHRINE.toriiX + 4, SHRINE.z0 + 1, -5.5);
  rect('deck', STATION.x0, STATION.x1, RAIL.z1, STATION.z1);
  rect('deck', PED_DECK.x0, PED_DECK.x1, STATION.z1, PED_DECK.z1);
  rect('deck', -4.4, 4.4, CATWALK.z0, CATWALK.z1);
  rect('stair', GRAND_STAIR.x0, GRAND_STAIR.x1, STATION.z1, STATION.z1 + 10.5);
  rect('stair', -15.6, -14.2, 4.7, 17.4);
  rect('stair', 14.1, 15.5, 2.6, 14.7);
  rect('stair', WAREHOUSE.x0 - 1.5, WAREHOUSE.x0 - 0.1, WAREHOUSE.z0, WAREHOUSE.z0 + 15.2);
  return {
    view: { x: O.x + BOUNDS.x0 - 4, z: O.z + BOUNDS.z0 - 4, w: BOUNDS.x1 - BOUNDS.x0 + 8, h: BOUNDS.z1 - BOUNDS.z0 + 8 },
    shapes,
    places: LANDMARKS.map((l) => ({ id: l.id, name: l.name, jp: l.jp, x: O.x + l.at[0], z: O.z + l.at[1] })),
  };
}
