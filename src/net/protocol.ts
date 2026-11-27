// The wire format between the browser and server/realtime.mjs. Messages are
// JSON objects with a `type`. The server is plain JavaScript, so this file is
// the reference for both sides; the numbers both sides share live in
// rules.json, which the server imports too.
import rulesJson from './rules.json';
import type { ClashEvent, ClashRules, FieldRules, Pick } from './clash';
import type { GestureVariant } from '../mastery/mastery';

export const RULES = rulesJson as {
  maxPlayers: number; defaultRoom: string; tickHz: number; sendHz: number; interpMs: number; maxHp: number;
  respawnSeconds: number; spawnProtectSeconds: number; hitTimeoutMs: number; maxHitDamage: number; maxHitRange: number;
  reconnectGraceSeconds: number; spawns: [number, number, number][];
  // The regions past the valley (src/world/atlas.ts): a player downed on one's land ([x0, z0, x1, z1]) gets up at one of its spawns.
  regions: { id: string; bounds: [number, number, number, number]; spawns: [number, number, number][] }[];
  // Health comes back out of a fight: after `quietSeconds` with no blow dealt
  // or taken (and, offline, no enemy standing within `clearRadius` m), at up
  // to `perSecond` health a second, reached over `rampSeconds`.
  regen: { quietSeconds: number; perSecond: number; rampSeconds: number; clearRadius: number };
  // An aura field on the wire is its radius and density. A tap's body layer
  // stands `layer` m from its owner's centre; a field counts as open past
  // `open` m and has area (presses, senses, clashes) past `area` m.
  field: FieldRules & { maxRadius: number; clashSlack: number; clashCooldownMs: number };
  // A Maximum Output cutscene's lock (issue #27): how long it may hold its
  // two people, how often one player may start one, how far the target may
  // stand, and how many blows the caster may land on each body during it.
  max: { minMs: number; maxMs: number; cooldownMs: number; reach: number; slack: number; hitsPerTarget: number };
  clash: ClashRules & { graceMs: number };
};

export type Vec3 = [number, number, number];

// One sample of a player's own simulation, sent at `sendHz`. `ct` is the
// sender's clock in ms: receivers interpolate on the sender's timeline, so
// samples stay evenly spaced however the network bunches them.
export interface PlayerState {
  ct: number;
  p: Vec3;
  v: Vec3;
  yaw: number;
  pitch: number;
  g: boolean;
  // 0 idle, 1 signing (or holding a Maximum Output's seal), 2 primed.
  sign: 0 | 1 | 2;
  // In a Maximum Output cutscene, as caster or target: drawn glowing, held in place.
  cine: boolean;
  // The aura field as drawn: radius in metres (0 when there is none), density
  // 0..1, and while it is being pushed out, the radius it can reach (0 otherwise).
  f?: [radius: number, density: number, limit?: number];
  // The installed Eye, as its place in EYE_IDS plus one (src/eyes/registry.ts), 0 for none.
  e?: number;
  // How hot the body shows, 0..1 (Heat's flush, src/character/avatar.ts `heat`).
  h?: number;
  // The body's kit pose, as STATE_FLAG bits: crouched in a glide, holding a held Ability.
  k?: number;
}
export const STATE_FLAG = { glide: 1, holding: 2 } as const;

// What everyone knows about a player in the room. The server owns hp, down,
// kills and downs.
export interface PlayerInfo {
  id: number;
  name: string;
  tech: string;
  slot: number;
  hp: number;
  down: boolean;
  kills: number;
  downs: number;
}

// One recorded call on the effect pool, replayed on the other screens. Casts
// and effects carry the sender's `ct` too, so they play when the sender's
// interpolated body reaches the moment they happened.
export interface FxCall { f: string; a: unknown[] }

export type HitOpts = { from: Vec3; knock: number; lift: number };

// One physics prop as its owner simulates it (src/net/propsync.ts):
// [id, x, y, z, qx, qy, qz, qw, vx, vy, vz, flags, frozen seconds left].
export type PropWire = [id: number, x: number, y: number, z: number, qx: number, qy: number, qz: number, qw: number, vx: number, vy: number, vz: number, flags: number, frozen: number];
export const PROP_FLAG = { rest: 1, claim: 4 } as const;
// The props as the room holds them, for a screen that joins: where the
// props that have moved came to rest, which are broken, and who owns which.
export interface PropSnapshot { rest: PropWire[]; broken: number[]; owners: [number, number][] }

// Heat a player put into the world (src/net/kitsync.ts): props as
// [id, heat 0..1.25, seconds left on fire], bodies burning as [player id, seconds].
export type HeatWire = { p?: [id: number, heat: number, fire: number][]; b?: [player: number, seconds: number][] };
// One end of a Tension line: a point in the world (`pin` when driven into
// open ground), a point on a prop in its own frame, a player's body, or the
// caster's own hand.
export type AnchorWire = [0, number, number, number, 0 | 1] | [1, number, number, number, number] | [2, number] | [3];
// One line standing: its two ends, LINE_FLAG bits, how far it is drawn 0..1,
// and how strongly it shows 0..1 (fading out).
export type LineWire = [a: AnchorWire, b: AnchorWire, flags: number, drawn: number, shown: number];
export const LINE_FLAG = { loose: 1 } as const;

export type ClientMsg =
  | { type: 'hello'; room: string; name: string; token: string; tech: string }
  | { type: 'state'; s: PlayerState }
  | { type: 'tech'; tech: string }
  // `variant` and `speed` are the gesture the cast plays, so every screen draws the same one.
  | { type: 'cast'; ct: number; kind: string; tech: string; name: string; dir: Vec3; variant: GestureVariant; speed: number; shout?: boolean }
  | { type: 'fx'; ct: number; calls: FxCall[] }
  | ({ type: 'hit'; seq: number; target: number; amount: number } & HitOpts)
  | { type: 'resolve'; hit: number; taken: number }
  | { type: 'self'; amount: number }
  | { type: 'status'; target: number; frozen: number; slow: number }
  | { type: 'ping'; t: number }
  // This player's open field touches the target's: the server starts a clash if both check out.
  | { type: 'clash'; target: number }
  | { type: 'clash-pick'; id: number; round: number; pick: Pick }
  // The props this player simulates; an entry with the claim flag takes one over.
  | { type: 'props'; s: PropWire[] }
  // A blow on a breakable prop; `max` is its full health.
  | { type: 'prop-hit'; prop: number; amount: number; max: number; from: Vec3 }
  // Rime froze the koi pond into a floor for `s` seconds.
  // The pond's floor for `s` seconds; with `at` (x, z) and `r`, a canal frozen across there instead.
  | { type: 'ice'; s: number; at?: [number, number]; r?: number }
  // Heat melted the pond's floor.
  | { type: 'melt' }
  // Props this player heated or set burning, and players it burned.
  | ({ type: 'heat' } & HeatWire)
  // Every Tension line this player has standing, on its clock; empty when none are left.
  | { type: 'lines'; ct: number; l: LineWire[] }
  // This player began a Maximum Output: `cut` names the cutscene, `target`
  // the player pulled into it, `ms` its length, `p` and `yaw` where the
  // caster stands and faces. The server locks the two for `ms` at most.
  | { type: 'max'; cut: string; target: number | null; ms: number; p: Vec3; yaw: number }
  // The caster's cutscene ended: the lock lifts for both.
  | { type: 'max-end' }
  | { type: 'bye' };

export type ServerMsg =
  | { type: 'welcome'; id: number; room: string; you: PlayerInfo; players: PlayerInfo[]; spawn: Vec3; t: number; props?: PropSnapshot }
  | { type: 'full'; room: string; max: number }
  | { type: 'join'; player: PlayerInfo }
  | { type: 'leave'; id: number }
  | { type: 'info'; player: PlayerInfo }
  | { type: 'snap'; t: number; players: { id: number; hp: number; down: boolean; away: boolean; st: PlayerState[] }[] }
  | { type: 'cast'; id: number; ct: number; kind: string; tech: string; name: string; dir: Vec3; variant: GestureVariant; speed: number; shout?: boolean }
  | { type: 'fx'; id: number; ct: number; calls: FxCall[] }
  | ({ type: 'struck'; hit: number; by: number; amount: number } & HitOpts)
  | { type: 'hp'; id: number; hp: number; by: number | null; amount: number }
  | { type: 'down'; id: number; by: number | null }
  | { type: 'respawn'; id: number; p: Vec3; hp: number }
  | { type: 'status'; by: number; frozen: number; slow: number }
  | { type: 'pong'; t: number; s: number }
  // A clash between players a and b started, then each step of it, sent to the
  // whole room. The server runs the referee in clash.js; picks and the winner
  // are in a, b order.
  | { type: 'clash'; id: number; a: number; b: number }
  | { type: 'clash-step'; id: number; a: number; b: number; ev: ClashEvent }
  | { type: 'props'; id: number; s: PropWire[] }
  | { type: 'prop-owner'; prop: number; owner: number | null }
  | { type: 'prop-break'; prop: number; by: number; from: Vec3 }
  | { type: 'ice'; id: number; s: number; at?: [number, number]; r?: number }
  | { type: 'melt'; id: number }
  | ({ type: 'heat'; id: number } & HeatWire)
  | { type: 'lines'; id: number; ct: number; l: LineWire[] }
  // A Maximum Output started, to the whole room: the caster and the target
  // (null when the server dropped it) are locked until max-end. Until then
  // neither can be hit by anyone else, and the target cannot act.
  | { type: 'max'; id: number; caster: number; target: number | null; cut: string; ms: number; p: Vec3; yaw: number }
  | { type: 'max-end'; id: number; caster: number; target: number | null }
  // The server refused this player's Maximum Output (too soon, or locked).
  | { type: 'max-denied' };
