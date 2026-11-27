import * as THREE from 'three';
import { CityKit } from './kit';
import { SignAtlas } from './signs';
import { buildStreets } from './streets';
import { buildBuildings } from './buildings';
import { buildPlaces } from './places';
import { buildLife } from './life';
import { registerCityProps } from './props';
import type { RegionDef, RegionContent, MapMark, MapClass, Place, Zone, FreezableWater } from '../region';
import type { Surface } from '../../audio/surfaces';
import {
  BOUNDS, BUILDINGS, ZONES, SPAWNS, LANDMARKS, RAIL, STATION, PED_DECK, PLAZA, EKIMAE, ARCADE, BACK_W, BACK_E, CROSS, ODORI, CANAL, PROMENADE,
  SOUTH_WALK, PARK, SHRINE, KURODA, KURODA_HOUSE, WAREHOUSE, UNDER, CATWALK, BRIDGES, GRAND_STAIR,
} from './plan';

// Shinonome, the city ward, as a region (src/world/region.ts): built from the
// plan (src/world/city/plan.ts) at its origin. The road from the pass comes
// in at the west end of the main road (`entrances`). The ward's pieces
// place themselves in world metres, so they hang from a frame inside the
// region's group that puts the world's origin back where it is; everything
// the region reports is in its own frame, as the interface asks.

const v3 = ([x, y, z]: readonly [number, number, number]): THREE.Vector3 => new THREE.Vector3(x, y, z);

// Spawn names carry the region's name, so the ward's plaza never shadows anywhere else's.
const SPAWN_POINTS = Object.fromEntries(Object.entries(SPAWNS).map(([id, p]) => [`city:${id}`, v3(p).setY(p[1] + 0.04)]));

const BLURB: Partial<Record<(typeof LANDMARKS)[number]['id'], string>> = {
  platform: 'The ward\'s station on its viaduct. Trains stop, wait and go.',
  plaza: 'The square under the station deck, where the grand stair comes down.',
  arcade: 'A covered shopping street. The east roofs along it can be walked.',
  catwalk: 'A steel walk over the arcade between the two rows of roofs.',
  shrine: 'A small Inari shrine in the back alleys, behind its own torii.',
  kuroda: 'The Kuroda family\'s house, behind a gate and two men in black.',
  warehouse: 'The Kuroda warehouse. A steel stair climbs its side to the roof.',
  park: 'A pocket park on the main road, a few trees and a bench.',
  canal: 'A walk along the canal under the south side of the ward.',
};

const PLACES: readonly Place[] = LANDMARKS.map((l) => ({
  id: `city-${l.id}`, name: l.name, jp: l.jp, glyph: [...l.jp][0]!, blurb: BLURB[l.id] ?? '',
  at: new THREE.Vector3(l.at[0], 0, l.at[1]), label: new THREE.Vector3(l.at[0], 4.5, l.at[1]),
}));

const ZONE_LIST: Zone[] = ZONES.map((z) => ({ id: z.id, label: z.label, jp: z.jp, min: v3(z.min), max: v3(z.max), general: z.id === 'city' || z.id === 'city-roofs' }));

// What a foot lands on in the ward: the canal, the park's grass, the
// shrine's and the Kuroda yard's raked gravel, wooden boards where the
// colliders say so, and stone (asphalt, paving, concrete decks and roofs) everywhere else.
function citySurface(p: THREE.Vector3, tag: string): Surface | null {
  if (tag === 'wood') return 'wood';
  const inRect = (r: { x0: number; x1: number; z0: number; z1: number }): boolean => p.x >= r.x0 && p.x <= r.x1 && p.z >= r.z0 && p.z <= r.z1;
  if (p.z > CANAL.z0 && p.z < CANAL.z1 && p.y < CANAL.waterY + 0.35) return 'water';
  if (p.y < 1) {
    if (inRect(PARK)) return 'grass';
    if (inRect(SHRINE) || inRect(KURODA)) return 'gravel';
  }
  return 'stone';
}

// Where the road from the pass meets the ward: the west end of the main road, in the ward's frame.
export const CITY_ENTRANCE = new THREE.Vector3(BOUNDS.x0, 0, (ODORI.z0 + ODORI.z1) / 2);

export function city(origin: THREE.Vector3): RegionDef {
  return {
    id: 'city',
    name: 'Shinonome',
    origin: origin.clone(),
    bounds: { x0: BOUNDS.x0, x1: BOUNDS.x1, z0: BOUNDS.z0, z1: BOUNDS.z1 },
    // Starts building once the player is down off the pass, well before the outskirts' bend shows it.
    stream: { load: 200, drop: 280 },
    hidesSkyline: true,
    spawns: SPAWN_POINTS,
    places: PLACES,
    map: { scope: { id: 'city', label: 'City', view: { x: BOUNDS.x0 - 4, z: BOUNDS.z0 - 4, w: BOUNDS.x1 - BOUNDS.x0 + 8, h: BOUNDS.z1 - BOUNDS.z0 + 8 } }, marks: cityMap() },
    entrances: [{ id: 'pass', at: CITY_ENTRANCE.clone(), heading: Math.PI / 2 }],
    *build(ctx): Generator<void, RegionContent, void> {
      registerCityProps();
      const O = ctx.origin;
      // The ward places itself in world metres: a frame that undoes the group's offset.
      const world = new THREE.Group();
      world.name = 'city:world-frame';
      world.position.copy(O).negate();
      ctx.group.add(world);
      const k = new CityKit(world, ctx.physics.physics, ctx.lights.pool, ctx.props, O);
      const signs = new SignAtlas();
      ctx.phase('streets');
      const streets = yield* buildStreets(k);
      yield;
      ctx.phase('buildings');
      yield* buildBuildings(k, signs);
      yield;
      ctx.phase('places');
      yield* buildPlaces(k, signs);
      yield;
      ctx.phase('bake');
      yield* k.finishing();
      ctx.phase('life');
      const life = yield* buildLife(O, ctx.assets, k.root);
      yield;
      const waters: FreezableWater[] = [{ kind: 'channel', x0: BOUNDS.x0 - 2, x1: BOUNDS.x1 + 10, z0: CANAL.z0, z1: CANAL.z1, surfaceY: CANAL.waterY }];
      return {
        zones: ZONE_LIST.map((z) => ({ ...z, min: z.min.clone(), max: z.max.clone() })),
        occluders: k.occluders,
        waters,
        water: [{ pts: [[BOUNDS.x0, (CANAL.z0 + CANAL.z1) / 2], [BOUNDS.x1, (CANAL.z0 + CANAL.z1) / 2]], y: CANAL.waterY }],
        groundAt: () => 0,
        surfaceAt: citySurface,
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
    },
  };
}

// The plan as the map draws it, in the ward's own metres.
function cityMap(): MapMark[] {
  const marks: MapMark[] = [];
  const rect = (cls: MapClass, x0: number, x1: number, z0: number, z1: number): void => { marks.push({ kind: 'box', class: cls, x: Math.min(x0, x1), z: Math.min(z0, z1), w: Math.abs(x1 - x0), d: Math.abs(z1 - z0) }); };
  rect('city-street', BOUNDS.x0, BOUNDS.x1, ODORI.road0, ODORI.road1);
  rect('city-paving', BOUNDS.x0, BOUNDS.x1, ODORI.z0, ODORI.road0);
  rect('city-paving', BOUNDS.x0, BOUNDS.x1, ODORI.road1, PROMENADE.z1);
  rect('city-street', BOUNDS.x0, BOUNDS.x1, EKIMAE.z0, EKIMAE.z1);
  rect('city-street', BACK_W.x0, BACK_W.x1, BACK_W.z0, BACK_W.z1);
  rect('city-street', BACK_E.x0, BACK_E.x1, BACK_E.z0, BACK_E.z1);
  rect('city-paving', PLAZA.x0, PLAZA.x1, PLAZA.z0, PLAZA.z1);
  rect('city-paving', BOUNDS.x0, BOUNDS.x1, UNDER.z0, UNDER.z1);
  rect('city-paving', ARCADE.x0, ARCADE.x1, ARCADE.z0, ARCADE.z1);
  rect('city-paving', -14, 14, CROSS.z0, CROSS.z1);
  rect('city-paving', BOUNDS.x0, BOUNDS.x1, SOUTH_WALK.z0, SOUTH_WALK.z1);
  rect('water', BOUNDS.x0, BOUNDS.x1, CANAL.z0, CANAL.z1);
  for (const b of BRIDGES) rect('city-paving', b.x0, b.x1, CANAL.z0 - 0.8, CANAL.z1 + 0.8);
  rect('floor', PARK.x0, PARK.x1, PARK.z0, PARK.z1);
  rect('floor', SHRINE.x0, SHRINE.x1, SHRINE.z0, SHRINE.z1);
  rect('city-paving', KURODA.x0, KURODA.x1, KURODA.z0, KURODA.z1);
  rect('city-rail', BOUNDS.x0, BOUNDS.x1, RAIL.z0, RAIL.z1);
  for (const b of BUILDINGS) rect(b.walk ? 'walk' : 'structure', b.x0, b.x1, b.z0, b.z1);
  rect('structure', KURODA_HOUSE.x0, KURODA_HOUSE.x1, KURODA_HOUSE.z0, KURODA_HOUSE.z1);
  rect('walk', WAREHOUSE.x0, WAREHOUSE.x1, WAREHOUSE.z0, WAREHOUSE.z1);
  rect('structure', SHRINE.toriiX - 4, SHRINE.toriiX + 4, SHRINE.z0 + 1, -5.5);
  rect('walk', STATION.x0, STATION.x1, RAIL.z1, STATION.z1);
  rect('walk', PED_DECK.x0, PED_DECK.x1, STATION.z1, PED_DECK.z1);
  rect('walk', -4.4, 4.4, CATWALK.z0, CATWALK.z1);
  rect('city-stair', GRAND_STAIR.x0, GRAND_STAIR.x1, STATION.z1, STATION.z1 + 10.5);
  rect('city-stair', -15.6, -14.2, 4.7, 17.4);
  rect('city-stair', 14.1, 15.5, 2.6, 14.7);
  rect('city-stair', WAREHOUSE.x0 - 1.5, WAREHOUSE.x0 - 0.1, WAREHOUSE.z0, WAREHOUSE.z0 + 15.2);
  return marks;
}
