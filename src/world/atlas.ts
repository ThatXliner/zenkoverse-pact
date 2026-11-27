import * as THREE from 'three';
import type { Place, RegionDef, MapLayer } from './region';
import { PASS } from './pass';
import { OUTSKIRTS } from './outskirts';
import { city, CITY_ENTRANCE } from './city/city';
import { CITY_ATTACH } from './outskirts';

// Every region past the compound and the valley, in the order the road
// reaches them: the pass road, the outskirts at its foot, and the city ward,
// placed so its entrance (the west end of its main road) meets the end of
// the outskirts' road (`CITY_ATTACH`).
export const CITY_ORIGIN = CITY_ATTACH.clone().sub(CITY_ENTRANCE);

export const AWAY: readonly RegionDef[] = [PASS, OUTSKIRTS, city(CITY_ORIGIN)];

const toWorld = (def: RegionDef, v: THREE.Vector3): THREE.Vector3 => v.clone().add(def.origin);

// Spawn points in every away region, in world space, by name.
export const AWAY_SPAWNS: Readonly<Record<string, THREE.Vector3>> = Object.fromEntries(
  AWAY.flatMap((def) => Object.entries(def.spawns).map(([name, v]) => [name, toWorld(def, v)])),
);

// Places in every away region, in world space.
export const AWAY_PLACES: readonly (Place & { region: string })[] = AWAY.flatMap((def) => def.places.map((p) => ({
  ...p, region: def.id, at: toWorld(def, p.at), label: toWorld(def, p.label), shrine: p.shrine && toWorld(def, p.shrine),
})));

// Map layers in world space: each region's marks shifted by its origin, and the scale tabs they share.
export interface WorldLayer { region: string; scope: MapLayer['scope']; marks: MapLayer['marks'] }
export const AWAY_LAYERS: readonly WorldLayer[] = AWAY.map((def) => {
  const { x: ox, z: oz } = def.origin;
  const shift = ([x, z]: readonly [number, number]) => [x + ox, z + oz] as const;
  const s = def.map.scope;
  return {
    region: def.id,
    scope: { ...s, view: { ...s.view, x: s.view.x + ox, z: s.view.z + oz } },
    marks: def.map.marks.map((m) => {
      switch (m.kind) {
        case 'area': case 'line': return { ...m, pts: m.pts.map(shift) };
        case 'box': case 'circle': case 'text': return { ...m, x: m.x + ox, z: m.z + oz };
      }
    }),
  };
});

// Which away region's land a point is on, if any.
export function awayAt(x: number, z: number): RegionDef | null {
  for (const def of AWAY) {
    const b = def.bounds, lx = x - def.origin.x, lz = z - def.origin.z;
    if (lx >= b.x0 && lx <= b.x1 && lz >= b.z0 && lz <= b.z1) return def;
  }
  return null;
}
