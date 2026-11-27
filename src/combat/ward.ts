import * as THREE from 'three';
import { signal, effect } from '@preact/signals';
import type { Game } from '../app/game';
import type { EncounterId } from '../app/state';
import type { EncounterDef } from './encounters';
import type { Enemy } from './enemies';
import { CITY_ORIGIN, awayAt } from '../world/atlas';
import { street, noteCast, clearStreet } from '../world/city/street';

// The ward's fights (Shinonome, src/world/city/) and what the street does
// about them. Each is an encounter (src/combat/encounters.ts) that starts on
// its own when the player walks into it, single-player only:
//  - the back alley by the Inari shrine, where three men close the lane from
//    both ends while someone in a grey coat watches from its far end;
//  - the canal walk, three more on the open promenade above the water;
//  - the Kuroda yard: the two men at the gate follow the player in, a third
//    comes off the veranda; won, and pushed on toward the warehouse, the
//    Enforcer comes out to the drums;
//  - the east roofs, where a man bolts as the player comes up off the deck,
//    over the cross alley, down the steel stair and away along the main road.
// The officer at the koban (src/world/city/life.ts) walks over to Technique
// use he sees, and a street fight he reaches breaks up.

// Region metres to world.
const at = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z).add(CITY_ORIGIN);

export const WARD_FIGHTS: EncounterDef[] = [
  { id: 'city-alley', title: 'Back alley', jp: '路地', where: at(-27, 0, 5.4), trigger: 3.2, region: 'city', leash: 30, quiet: true,
    spawns: [{ key: 'thug', offset: [-8, 0, 0.2] }, { key: 'runner', offset: [-11.5, 0, -0.6] }, { key: 'thug', offset: [8, 0, -0.4] }] },
  { id: 'city-canal', title: 'Canal walk', jp: '運河', where: at(-40, 0, 39), trigger: 3.5, region: 'city', leash: 34, quiet: true,
    spawns: [{ key: 'thug', offset: [-10, 0, -0.2] }, { key: 'bruiser', offset: [-7, 0, -0.5] }, { key: 'thug', offset: [11, 0, -0.3] }] },
  { id: 'kuroda-yard', title: 'The Kuroda yard', jp: '黒田', where: at(21.5, 0, 4.5), trigger: 2.2, region: 'city', leash: 32, quiet: true,
    spawns: [{ key: 'hand', offset: [-5.1, 0, -3.7] }, { key: 'hand', offset: [-5.1, 0, 4.3] }, { key: 'hand', offset: [6, 0, -3.2] }] },
  { id: 'kuroda-house', title: 'The Kuroda house', jp: '黒田家', where: at(36, 0, 4), trigger: 4.5, region: 'city', leash: 34, quiet: true, after: 'kuroda-yard',
    spawns: [{ key: 'kuroda', offset: [7, 0, 0.6] }, { key: 'hand', offset: [6, 0, -7] }] },
  { id: 'city-roofs', title: 'The east roofs', jp: '屋上', where: at(9, 7.0, -10), trigger: 5.5, region: 'city', leash: 50, quiet: true,
    spawns: [{ key: 'runner', offset: [0, 0.1, 5.5] }] },
];

// The runner's way off the roofs: south along the east row, a jump over the
// cross alley, east to the steel stair, down it, and away east along the main road.
const ROOF_RUN = [at(9, 7.6, -1.0), at(9, 6.8, 3.8), at(14.6, 6.8, 3.6), at(14.8, 6.6, 5.4), at(14.8, 0, 15.6), at(16.2, 0, 20.5), at(40, 0, 21.5), at(66, 0, 21.5)];
const ROOF_HOPS = [0];
const ROOF_SPEED = 6.0;

// Who watches the alley fight from the lane's west end, and where the street gives a fight room.
const ALLEY_WATCHER = at(-41.5, 0, 6.3);
const FIGHT_ROOM = 20;
// The officer breaks up a street fight once he is this close to it.
const BREAK_UP = 10;
const PRIVATE: ReadonlySet<EncounterId> = new Set(['kuroda-yard', 'kuroda-house', 'city-roofs']);

// Which of the ward's fights have been won, kept across runs: the goals read it.
const STORE_KEY = 'zenko.ward.v1';
function load(): Set<EncounterId> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]') as unknown;
    return new Set((Array.isArray(raw) ? raw : []).filter((id): id is EncounterId => WARD_FIGHTS.some((d) => d.id === id)));
  } catch { return new Set(); }
}
export const wardWon = signal<ReadonlySet<EncounterId>>(load());
effect(() => { try { localStorage.setItem(STORE_KEY, JSON.stringify([...wardWon.value])); } catch { /* storage may be unavailable */ } });

export class Ward {
  private casting = false;
  private copWas: string | null = null;
  private runner: Enemy | null = null;
  // Every start and end of a fight in the ward, for the checks.
  readonly log: { id: EncounterId; event: string; t: number }[] = [];

  constructor(private game: Game) {
    game.encounters.began.push((d) => this.began(d));
    game.encounters.ended.push((d, won) => this.ended(d, won));
  }

  private began(d: EncounterDef): void {
    if (!WARD_FIGHTS.includes(d)) return;
    this.log.push({ id: d.id, event: 'began', t: this.game.clock.time });
    street.fight = { id: d.id, at: d.where.clone(), radius: FIGHT_ROOM, private: PRIVATE.has(d.id), watcher: d.id === 'city-alley' ? ALLEY_WATCHER.clone() : null };
    if (d.id === 'kuroda-yard') street.gateEmpty = true;
    if (d.id === 'city-roofs') {
      this.runner = this.game.encounters.enemies.find((e) => e.key === 'runner' && e.alive) ?? null;
      this.runner?.flee(ROOF_RUN.map((p) => p.clone()), ROOF_SPEED, { hops: ROOF_HOPS, stops: true });
    }
  }

  private ended(d: EncounterDef, won: boolean): void {
    if (!WARD_FIGHTS.includes(d)) return;
    this.log.push({ id: d.id, event: won ? 'won' : 'ended', t: this.game.clock.time });
    if (street.fight?.id === d.id) street.fight = null;
    this.runner = null;
    if (won && !wardWon.value.has(d.id)) wardWon.value = new Set([...wardWon.value, d.id]);
  }

  reset(): void {
    clearStreet();
    this.runner = null;
    this.casting = false;
  }

  // Whether the player stands in the ward.
  private inWard(p: THREE.Vector3): boolean { return awayAt(p.x, p.z)?.id === 'city' && this.game.world.isStanding('city'); }

  update(): void {
    const g = this.game;
    const p = g.player.position;
    // Every Technique cast in the ward is seen by whoever is looking.
    const casting = g.techniques.casting;
    if (casting && !this.casting && this.inWard(p)) noteCast(p, g.clock.time);
    this.casting = casting;
    // The gate stands empty from the yard fight until the yard is set again.
    street.gateEmpty = !g.encounters.isArmed('kuroda-yard');
    // The whistle, where the officer stands.
    const cop = street.officer;
    if (cop?.mode === 'whistle' && this.copWas !== 'whistle') g.audio.play('city.whistle', { at: cop.at.clone().setY(cop.at.y + 1.6) });
    this.copWas = cop?.mode ?? null;
    const d = g.encounters.current;
    if (!d || !WARD_FIGHTS.includes(d)) return;
    // The runner got away down the main road.
    if (this.runner?.escaped) { g.encounters.end({ gone: true }); return; }
    // An officer who reaches a street fight breaks it up: they walk off.
    const o = street.officer;
    if (!PRIVATE.has(d.id) && o && o.mode === 'approach' && o.at.distanceTo(p) < BREAK_UP) g.encounters.end({ from: o.at });
  }
}
