// What this player's casts actually do, measured at every setting a Wager
// can call. Each cast is evidence for every setting at once: how many bodies
// it struck answers "it strikes N or more" for every N, and the seconds after
// its impact answer "nothing touches you for T seconds" and "it finishes a
// target within W seconds" for every T and W. So the odds a Wager reads at a
// setting are this player's own record at that setting, never a curve
// stretched from another one.

// The settings a call can take, smallest to largest.
// Bodies a cast strikes: REACH[i] or more.
export const REACH = [1, 2, 3, 4, 5] as const;
// Seconds after the impact in which a body standing at it falls.
export const FINISH = [0.5, 0.9, 1.5, 2.5, 4] as const;
// Seconds after the impact with no blow landing on you.
export const UNTOUCHED = [3, 5, 8, 12, 20] as const;

// One setting row: for each setting, how many casts were settled there
// (`n`) and how many made the call true (`yes`). Both decay by RATE at every
// impact, so the record follows how the player fights now. Counts, not a
// moving average: a single blow settles every open impact's untouched
// settings at once, and an average nudged by such a burst would swing far
// below the truth; a ratio of counts gives each settled cast the same weight.
export interface Row { yes: number[]; n: number[] }

export interface OddsTally {
  reach: Row;
  finish: Row;
  untouched: Row;
  // How calls actually fell on the casts that were wagered, by call and
  // setting ("untouched:8"). A player can fight differently once a call is
  // open (run from every blow, cast only at a lone dummy), so the casts that
  // carry the bet are the evidence that counts most. Counts decay, so the
  // record follows how the player wagers now.
  called: Record<string, { n: number; won: number }>;
}
export type OddsRow = 'reach' | 'finish' | 'untouched';

// How fast the wagered record forgets, per call (about the last ten), and
// how many wagered calls it takes before they alone set the odds.
export const CALLED = { decay: 0.9, trust: 4 };

// Each impact keeps this share of the record before it: about the last 25 casts.
export const RATE = 0.04;
// What a starting rate weighs, in casts: the first fight moves it.
const PRIOR = 4;

const rowOf = (rates: readonly number[], weight = PRIOR): Row => ({ yes: rates.map((r) => r * weight), n: rates.map(() => weight) });

// Before any play: a fighter who lands a little more than half their casts.
export const SEED_RATES = {
  reach: [0.6, 0.4, 0.22, 0.12, 0.06],
  finish: [0.14, 0.2, 0.27, 0.34, 0.42],
  untouched: [0.8, 0.65, 0.5, 0.35, 0.18],
} as const;

export function seedTally(): OddsTally {
  return { reach: rowOf(SEED_RATES.reach), finish: rowOf(SEED_RATES.finish), untouched: rowOf(SEED_RATES.untouched), called: {} };
}

// A save from before per-setting tallies kept one rate per call, measured at
// its one setting (two bodies, 0.9 s, 8 s). Those carry over where they were
// measured, weighed as the record they were; the other settings start from
// the seed bent by the same ratio, and the player's own casts replace them
// from the first fight on.
export function tallyFrom(old: { hitRate?: number; multiTargetFraction?: number; killRate?: number; untouchedRate?: number }): OddsTally {
  const bend = (seed: readonly number[], at: number, v: number | undefined) => (v === undefined ? [...seed] : seed.map((s) => clamp01(s * (v / seed[at]!))));
  const reach = bend(SEED_RATES.reach, 0, old.hitRate), finish = bend(SEED_RATES.finish, 1, old.killRate), untouched = bend(SEED_RATES.untouched, 2, old.untouchedRate);
  if (old.hitRate !== undefined) reach[0] = old.hitRate;
  if (old.multiTargetFraction !== undefined) reach[1] = old.multiTargetFraction;
  if (old.killRate !== undefined) finish[1] = old.killRate;
  if (old.untouchedRate !== undefined) untouched[2] = old.untouchedRate;
  return { reach: rowOf(reach, 1 / RATE), finish: rowOf(finish, 1 / RATE), untouched: rowOf(untouched, 1 / RATE), called: {} };
}

// Whether a saved tally has this version's shape.
export function isTally(t: unknown): t is OddsTally {
  const ok = (r: unknown) => !!r && Array.isArray((r as Row).yes) && Array.isArray((r as Row).n);
  return !!t && typeof t === 'object' && ok((t as OddsTally).reach) && ok((t as OddsTally).finish) && ok((t as OddsTally).untouched);
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const settle = (row: Row, i: number, v: number) => { row.n[i]! += 1; row.yes[i]! += v; };
const fade = (row: Row) => { for (let i = 0; i < row.n.length; i++) { row.n[i]! *= 1 - RATE; row.yes[i]! *= 1 - RATE; } };

// The rate at a setting. A harder setting is never read as likelier than an
// easier one: striking three is no likelier than striking two, and twenty
// untouched seconds no likelier than twelve, whatever the noise in the tallies.
export function rateAt(t: OddsTally, row: OddsRow, i: number): number {
  const r = t[row];
  const at = (k: number) => (r.n[k]! > 1e-6 ? r.yes[k]! / r.n[k]! : 0);
  if (row === 'finish') { let m = 0; for (let k = 0; k <= i; k++) m = Math.max(m, at(k)); return m; }
  let m = 1;
  for (let k = 0; k <= i; k++) m = Math.min(m, at(k));
  return m;
}

// A wagered call fell one way or the other.
export function recordCall(t: OddsTally, key: string, won: boolean): void {
  const r = t.called[key] ?? { n: 0, won: 0 };
  t.called[key] = { n: r.n * CALLED.decay + 1, won: r.won * CALLED.decay + (won ? 1 : 0) };
}

// The odds of a call: every cast's record at its setting, handing over to
// how the wagered casts at that setting actually fell as those add up. Once
// there are a few, they alone set the odds: a player who makes every wagered
// call true however the rest of their casts go has no doubt left to stake.
export function callOdds(t: OddsTally, key: string, every: number): number {
  const r = t.called[key];
  if (!r || r.n <= 0) return every;
  if (r.n >= CALLED.trust) return r.won / r.n;
  return r.won / CALLED.trust + (1 - r.n / CALLED.trust) * every;
}

// One cast's impact. The bodies it struck settle every reach setting now.
// The seconds that follow decide the others as they pass, but an impact
// enters the record only once its longest window has passed, so the record
// takes one cast at a time, in the order they were cast: a blow decides the
// untouched settings of every open impact at once, and entering them all at
// that moment would let one blow outweigh the casts around it. `now` is game
// seconds. `M` is what the caller needs to tell whether a body standing at
// the impact has fallen since (the game passes the bodies themselves).
export class OddsProbes<M = unknown> {
  private open: { t0: number; mark: M; finish: number[]; untouched: number[]; fell: boolean; struck: number }[] = [];

  constructor(private tally: () => OddsTally) {}

  // At most this many impacts are followed at once; past it the oldest is
  // dropped unrecorded. It sits far above what any cooldown allows: ten casts
  // a second for twenty seconds.
  static readonly MAX = 256;

  impact(now: number, hits: number, mark: M): void {
    const t = this.tally();
    fade(t.reach); fade(t.finish); fade(t.untouched);
    REACH.forEach((n, i) => settle(t.reach, i, hits >= n ? 1 : 0));
    if (this.open.length >= OddsProbes.MAX) this.open.shift();
    this.open.push({ t0: now, mark, finish: [], untouched: [], fell: false, struck: Infinity });
  }

  // A blow landed on the player.
  struck(now: number): void {
    for (const p of this.open) p.struck = Math.min(p.struck, now);
  }

  // Decides what the passing seconds decide, and records each impact whose
  // windows have all passed. `fell` says whether a body standing at an
  // impact has fallen since.
  tick(now: number, fell: (mark: M) => boolean = () => false): void {
    const t = this.tally();
    for (const p of this.open) {
      const dt = now - p.t0;
      if (p.finish.length < FINISH.length && !p.fell && fell(p.mark)) p.fell = true;
      // A fall settles every window still open as made; a window that closes first was missed.
      while (p.finish.length < FINISH.length && (p.fell || FINISH[p.finish.length]! < dt)) p.finish.push(p.fell ? 1 : 0);
      while (p.untouched.length < UNTOUCHED.length && (UNTOUCHED[p.untouched.length]! <= dt || p.struck - p.t0 < UNTOUCHED[p.untouched.length]!)) {
        p.untouched.push(p.struck - p.t0 < UNTOUCHED[p.untouched.length]! ? 0 : 1);
      }
    }
    // Recorded in cast order, each once its longest window is behind it.
    const last = UNTOUCHED[UNTOUCHED.length - 1]!;
    while (this.open.length && now - this.open[0]!.t0 >= last && this.open[0]!.untouched.length === UNTOUCHED.length && this.open[0]!.finish.length === FINISH.length) {
      const p = this.open.shift()!;
      p.finish.forEach((v, i) => settle(t.finish, i, v));
      p.untouched.forEach((v, i) => settle(t.untouched, i, v));
    }
  }

  clear(): void { this.open = []; }
}
