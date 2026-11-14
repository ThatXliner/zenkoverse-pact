// The wire format between the browser and server/realtime.mjs. Messages are
// JSON objects with a `type`. The server is plain JavaScript, so this file is
// the reference for both sides; the numbers both sides share live in
// rules.json, which the server imports too.
import rulesJson from './rules.json';

export const RULES = rulesJson as {
  maxPlayers: number; defaultRoom: string; tickHz: number; sendHz: number; interpMs: number; maxHp: number;
  respawnSeconds: number; spawnProtectSeconds: number; hitTimeoutMs: number; maxHitDamage: number; maxHitRange: number;
  reconnectGraceSeconds: number; spawns: [number, number, number][];
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
  // 0 idle, 1 signing, 2 primed.
  sign: 0 | 1 | 2;
  // In a Maximum Output cutscene: invulnerable, signing in place.
  cine: boolean;
}

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

export type ClientMsg =
  | { type: 'hello'; room: string; name: string; token: string; tech: string }
  | { type: 'state'; s: PlayerState }
  | { type: 'tech'; tech: string }
  | { type: 'cast'; ct: number; kind: string; tech: string; name: string; dir: Vec3 }
  | { type: 'fx'; ct: number; calls: FxCall[] }
  | ({ type: 'hit'; seq: number; target: number; amount: number } & HitOpts)
  | { type: 'resolve'; hit: number; taken: number }
  | { type: 'self'; amount: number }
  | { type: 'status'; target: number; frozen: number; slow: number }
  | { type: 'ping'; t: number }
  | { type: 'bye' };

export type ServerMsg =
  | { type: 'welcome'; id: number; room: string; you: PlayerInfo; players: PlayerInfo[]; spawn: Vec3; t: number }
  | { type: 'full'; room: string; max: number }
  | { type: 'join'; player: PlayerInfo }
  | { type: 'leave'; id: number }
  | { type: 'info'; player: PlayerInfo }
  | { type: 'snap'; t: number; players: { id: number; hp: number; down: boolean; away: boolean; st: PlayerState[] }[] }
  | { type: 'cast'; id: number; ct: number; kind: string; tech: string; name: string; dir: Vec3 }
  | { type: 'fx'; id: number; ct: number; calls: FxCall[] }
  | ({ type: 'struck'; hit: number; by: number; amount: number } & HitOpts)
  | { type: 'hp'; id: number; hp: number; by: number | null; amount: number }
  | { type: 'down'; id: number; by: number | null }
  | { type: 'respawn'; id: number; p: Vec3; hp: number }
  | { type: 'status'; by: number; frozen: number; slow: number }
  | { type: 'pong'; t: number; s: number };
