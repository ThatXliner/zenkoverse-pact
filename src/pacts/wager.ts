import type { Telemetry } from './resolve';
import type { Restriction } from './schema';
import { REACH, FINISH, UNTOUCHED, rateAt, callOdds, type OddsRow } from './odds';

// A Wager is a structure inside a Pact (wiki: Wagers). Every cast of the
// Pact declares an uncertain outcome; a correct call pays the Rewards the
// player wrote, a wrong one lands the Forfeits they wrote. Every part is
// tuned, not only picked: the call has a setting (how many bodies, how many
// seconds), the stake is split between the rewards, and each forfeit has a
// size. What the Wager is worth, its stake, still comes only from real
// uncertainty and real loss: a call the player nearly always gets right or
// wrong, or forfeits that cost this player little, stake almost nothing
// however they are tuned, and the rewards shrink to match.
// `tools/check-wagers.mjs` searches every setting for a way around that.

export type Declaration = 'hit' | 'multi' | 'kill' | 'untouched';
export type Reward = 'output' | 'charge' | 'mend' | 'aura' | 'refill';
export type Forfeit = 'seal' | 'blood' | 'drain' | 'slow' | 'aura' | 'dark';

export interface WagerTerms {
  declare: Declaration;
  // The call's setting, for a call that has one: the bodies "multi" must
  // strike, the seconds "kill" allows, the seconds "untouched" lasts.
  at?: number;
  // What a right call pays: each reward's share of the stake, in parts (1..4).
  pays: Partial<Record<Reward, number>>;
  // What a wrong call lands: each forfeit's size, one of its `steps`.
  risks: Partial<Record<Forfeit, number>>;
}

export const DECLARATIONS: readonly Declaration[] = ['hit', 'multi', 'kill', 'untouched'];
export const REWARDS: readonly Reward[] = ['output', 'charge', 'refill', 'aura', 'mend'];
export const FORFEITS: readonly Forfeit[] = ['seal', 'blood', 'drain', 'slow', 'aura', 'dark'];
// A reward's share runs from one part to this many.
export const MAX_PARTS = 4;
// However much is put up, the stake stops here at even odds, and lower as
// the call grows surer (STAKE_CAP × uncertainty): past it a Wager only costs more.
export const STAKE_CAP = 5;
// A likely call is a small risk however much rides on it. On average a right
// call never pays more than this many times what a wrong call costs on
// average: p·stake ≤ FAIR·(1 − p)·loss. At even odds it does not bite.
export const FAIR = 1.5;

const NUMBER = ['', 'one', 'two', 'three', 'four', 'five'];
const secs = (n: number) => `${n} ${n === 1 ? 'second' : 'seconds'}`;
const pct = (n: number) => `${Math.round(n * 100)}%`;

interface DeclareDef {
  // The settings the call can take, easiest first; null for a call without one.
  steps: readonly number[] | null;
  at: number;
  words: (n: number) => string;
  // The setting alone, in a few words.
  short: (n: number) => string;
  // Which tally row, and where in it, records this call at setting `n`.
  row: OddsRow;
  index: (n: number) => number;
}

export const DECLARE: Record<Declaration, DeclareDef> = {
  hit: { steps: null, at: 1, words: () => 'it lands', short: () => 'lands', row: 'reach', index: () => 0 },
  multi: { steps: REACH.slice(1), at: 2, words: (n) => `it strikes ${NUMBER[n] ?? n} or more`, short: (n) => `${n} bodies`, row: 'reach', index: (n) => REACH.indexOf(n as never) },
  kill: { steps: FINISH, at: 0.9, words: (n) => `it finishes a target within ${n} s`, short: (n) => `within ${n} s`, row: 'finish', index: (n) => FINISH.indexOf(n as never) },
  untouched: { steps: UNTOUCHED, at: 8, words: (n) => `nothing touches you for ${secs(n)}`, short: (n) => `${n} s`, row: 'untouched', index: (n) => UNTOUCHED.indexOf(n as never) },
};

export const settingOf = (w: Pick<WagerTerms, 'declare' | 'at'>): number => w.at ?? DECLARE[w.declare].at;
export const callWords = (w: Pick<WagerTerms, 'declare' | 'at'>): string => DECLARE[w.declare].words(settingOf(w));

// The key a wagered call's record is kept under.
export const callKey = (w: Pick<WagerTerms, 'declare' | 'at'>): string => `${w.declare}:${settingOf(w)}`;

// How often this player's casts make the call true, read from their own
// record at exactly this setting, and moved toward how their wagered casts
// at it fell.
export function oddsOf(w: Pick<WagerTerms, 'declare' | 'at'>, t: Telemetry): number {
  const d = DECLARE[w.declare];
  return callOdds(t.odds, callKey(w), rateAt(t.odds, d.row, Math.max(0, d.index(settingOf(w)))));
}

// How many bodies a cast that lands strikes, on average: the harder strike
// rides on every one of them, so it is spread across them.
export function spreadOf(t: Telemetry): number {
  const first = rateAt(t.odds, 'reach', 0);
  if (first <= 0.01) return 1;
  let sum = 0;
  for (let i = 0; i < REACH.length; i++) sum += rateAt(t.odds, 'reach', i);
  return Math.min(REACH.length, Math.max(1, sum / first));
}

// What the Pact around the Wager does to what a forfeit really takes.
export interface WagerContext {
  telemetry: Telemetry;
  // The Pact's own terms.
  restrictions: Restriction[];
  // The Pact's Resolve potency, 0..1 (resolve.ts).
  potency: number;
  // Whether its key casts the raw Technique while the Pact is dark.
  raw: boolean;
}

// Forfeit weights, one place. A unit of weight is about two seconds of the
// whole Technique sealed.
export const WEIGHT = {
  sealPerSecond: 0.48,
  bloodPerHealth: 10,
  drain: { full: 1.6, resource: 0.6, charge: 0.4, refills: 6 },
  slowPerSecond: 1 / 6,
  // Seconds of a whole Technique a Pact that spends everything (or half) leaves you without anyway.
  spent: { all: 1.7, half: 0.5 },
  aura: 2.5,
  darkPerSecond: 0.05,
  // How strong the raw Technique is next to a Pact of potency p, as the cast reads it (techniques.ts).
  raw: { potency: 0.22 },
  slowFactor: 0.6,
} as const;

interface ForfeitDef {
  title: string;
  steps: readonly number[];
  at: number;
  words: (n: number) => string;
  short: (n: number) => string;
}

export const FORFEIT: Record<Forfeit, ForfeitDef> = {
  seal: { title: 'Seal', steps: [2, 3, 5, 8, 12], at: 5, words: (n) => `your Technique seals for ${secs(n)}`, short: (n) => `sealed ${n} s` },
  blood: { title: 'Blood', steps: [0.05, 0.1, 0.2, 0.3, 0.4], at: 0.2, words: (n) => n === 0.2 ? 'you lose a fifth of your health' : `you lose ${pct(n)} of your health`, short: (n) => `−${pct(n)} health` },
  drain: { title: 'Drain', steps: [0.25, 0.5, 0.75, 1], at: 1, words: (n) => n === 1 ? 'your resource and Maximum Output charge empty' : `you lose ${pct(n)} of your resource and Maximum Output charge`, short: (n) => n === 1 ? 'emptied' : `−${pct(n)} reserves` },
  slow: { title: 'Heavy legs', steps: [2, 4, 6, 9, 12], at: 6, words: (n) => `your legs go heavy for ${secs(n)}`, short: (n) => `slowed ${n} s` },
  aura: { title: 'Aura', steps: [0.25, 0.5, 0.75, 1], at: 1, words: (n) => n === 1 ? 'your aura pool empties, and an open field closes' : `you lose ${pct(n)} of your aura pool, or of an open field's time`, short: (n) => n === 1 ? 'aura emptied' : `−${pct(n)} aura` },
  dark: { title: 'Dark', steps: [10, 20, 30, 60, 90], at: 30, words: (n) => `this Pact goes dark for ${secs(n)}`, short: (n) => `dark ${n} s` },
};

// What each forfeit, at size `n`, takes from this player with this Pact,
// alongside the other forfeits written with it. `note` says why it is less
// than its size suggests, when it is.
export function forfeitLoss(f: Forfeit, n: number, risks: WagerTerms['risks'], c: WagerContext): { weight: number; note?: string } {
  const t = c.telemetry;
  const sealed = risks.seal ?? 0;
  const spend = c.restrictions.find((r) => r.param === 'resource')?.value;
  switch (f) {
    case 'seal': {
      // A Pact that spends everything leaves you spent for the first seconds
      // after it anyway; a seal over them takes less.
      const spent = spend === 'all' ? WEIGHT.spent.all : spend === 'half' ? WEIGHT.spent.half : 0;
      const lost = n - Math.min(n / 2, spent);
      return { weight: WEIGHT.sealPerSecond * lost, note: spent ? 'this Pact already leaves you spent as the seal begins' : undefined };
    }
    case 'blood': return { weight: WEIGHT.bloodPerHealth * n };
    case 'drain': {
      // A Pact that spends everything leaves little to drain; what a seal
      // keeps you from using refills meanwhile. A little drained refills
      // before it is missed, so the resource's part grows with the square.
      const left = spend === 'all' ? 0.1 : spend === 'half' ? 0.55 : 1;
      const meanwhile = Math.max(0, 1 - sealed / WEIGHT.drain.refills);
      const k = WEIGHT.drain.resource * left * meanwhile * n + WEIGHT.drain.charge;
      return { weight: WEIGHT.drain.full * n * k, note: left < 1 ? 'this Pact already spends what drain would take' : meanwhile < 1 ? 'the seal already holds you while it refills' : undefined };
    }
    case 'slow': {
      // Heavy legs cost a fighter who moves; one who casts standing still loses less.
      const legs = Math.min(1.4, 0.4 + t.movingWhileCasting);
      return { weight: WEIGHT.slowPerSecond * n * legs, note: legs < 0.6 ? 'you rarely move while you cast' : undefined };
    }
    case 'aura': {
      const use = Math.min(1.2, 1.6 * t.auraReliance);
      return { weight: WEIGHT.aura * n * use, note: use < 0.4 ? 'you seldom fight with your field open' : undefined };
    }
    case 'dark': {
      // While sealed the Pact is out of reach anyway. A key that falls back
      // to the raw Technique keeps what the raw Technique can do.
      const after = Math.max(0, n - sealed);
      const p = Math.max(WEIGHT.raw.potency, c.potency);
      const keeps = c.raw ? (0.25 + WEIGHT.raw.potency * 0.75) / (0.25 + p * 0.75) : 0;
      const k = 1 - keeps;
      return { weight: WEIGHT.darkPerSecond * after * k, note: after < n ? 'the seal already holds it for part of that' : k < 0.5 ? 'its key falls back to a raw Technique nearly as strong' : undefined };
    }
  }
}

interface RewardDef {
  title: string;
  plain: string;
  // `spread` is how many bodies a landing cast strikes (spreadOf); only the harder strike reads it.
  amount: (stake: number, spread: number) => number;
  words: (n: number) => string;
  short: (n: number) => string;
}

// What a right call pays from the share of the stake it is given.
export const REWARD: Record<Reward, RewardDef> = {
  output: { title: 'Harder strike', plain: 'the strike hits harder', amount: (s, k) => 1 + (0.8 * s) / k, words: (n) => `the strike hits ×${n.toFixed(1)} as hard`, short: (n) => `×${n.toFixed(1)} damage` },
  charge: { title: 'Output ring', plain: 'your Maximum Output ring fills', amount: (s) => Math.min(1, 0.22 * s), words: (n) => `your Maximum Output ring fills by ${pct(n)}`, short: (n) => `+${pct(n)} ring` },
  refill: { title: 'Resource', plain: 'your resource refills', amount: (s) => Math.min(1, 0.3 * s), words: (n) => `your resource refills by ${pct(n)}`, short: (n) => `+${pct(n)} resource` },
  aura: { title: 'Aura', plain: 'your aura pool fills', amount: (s) => Math.min(1, 0.25 * s), words: (n) => `your aura pool fills by ${pct(n)}, or an open field holds longer`, short: (n) => `+${pct(n)} aura` },
  mend: { title: 'Mend', plain: 'you heal', amount: (s) => Math.min(0.5, 0.1 * s), words: (n) => `you heal ${pct(n)} of your health`, short: (n) => `+${pct(n)} health` },
};

// The harder strike is this cast's own damage, and it rides on the blows as
// they land, so it pays only on a call the impact settles and that every
// landing blow makes true. A later outcome cannot reach back into a blow
// already dealt, and a blow that lands short of "strikes three" would be
// paid on a lost call.
export function rewardFits(declare: Declaration, reward: Reward): boolean {
  return reward !== 'output' || declare === 'hit';
}

export interface Payout { reward: Reward; share: number; amount: number }

export interface Stake {
  odds: number;
  // 0 when the outcome is certain either way, 1 at even odds.
  uncertainty: number;
  // What the forfeits take, added up.
  loss: number;
  stake: number;
  // What each reward pays from its share of the stake.
  payouts: Payout[];
  // Who already wagers on this outcome, when the stake is not counted again.
  by?: string;
  reason: string;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function payoutsOf(pays: WagerTerms['pays'], stake: number, spread = 1): Payout[] {
  const list = REWARDS.filter((r) => (pays[r] ?? 0) > 0);
  const parts = list.reduce((a, r) => a + pays[r]!, 0);
  return list.map((r) => ({ reward: r, share: pays[r]! / parts, amount: REWARD[r].amount((stake * pays[r]!) / parts, spread) }));
}

export const riskList = (w: Pick<WagerTerms, 'risks'>): [Forfeit, number][] => FORFEITS.filter((f) => (w.risks[f] ?? 0) > 0).map((f) => [f, w.risks[f]!]);

export function stakeOf(w: WagerTerms, c: WagerContext, by?: string): Stake {
  const odds = Math.min(0.99, Math.max(0.01, oddsOf(w, c.telemetry)));
  const uncertainty = 4 * odds * (1 - odds);
  const losses = riskList(w).map(([f, n]) => ({ f, n, ...forfeitLoss(f, n, w.risks, c) }));
  const loss = losses.reduce((a, l) => a + l.weight, 0);
  // Doubt times loss; never more than a fair bet on a likely call, and never
  // more than doubt allows (STAKE_CAP at even odds) however much is put up.
  const fair = (FAIR * (1 - odds) * loss) / odds;
  const most = STAKE_CAP * uncertainty;
  const raw = Math.min(uncertainty * loss, fair, most);
  const stake = by ? 0 : round1(raw);
  const p = Math.round(odds * 100);
  const on = joinAnd(losses.map((l) => FORFEIT[l.f].short(l.n)));
  const cheap = losses.filter((l) => l.note).sort((a, b) => b.weight - a.weight)[0];
  const reason = by
    ? `"${by}" already wagers on this outcome, so it stakes nothing again`
    : !losses.length
      ? 'nothing is on the line, so nothing is at stake'
      : uncertainty < 0.35
        ? `you call this right or wrong almost every time (${p}%), so little is at stake`
        : loss < 0.8 && cheap
          ? `a ${p}% call, but ${cheap.note}, so little is at stake`
          : raw === most && most < uncertainty * loss
            ? `a ${p}% call with ${on} on the line; doubt this ${odds > 0.5 ? 'small' : 'one-sided'} stakes no more than ${round1(most).toFixed(1)}`
            : raw === fair && fair < uncertainty * loss
              ? `a ${p}% call with ${on} on the line; a likely call stakes only what its misses cost`
              : `a ${p}% call with ${on} on the line${cheap ? `; ${cheap.note}` : ''}`;
  return { odds, uncertainty, loss: round1(loss), stake, payouts: payoutsOf(w.pays, stake, spreadOf(c.telemetry)), by, reason };
}

export function joinAnd(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

// A right call's rewards and a wrong call's forfeits, in the few words a slip or a banner has.
export const paysShort = (s: Pick<Stake, 'payouts'>): string => s.payouts.length ? s.payouts.map((p) => REWARD[p.reward].short(p.amount)).join(', ') : 'nothing';
export const risksShort = (w: Pick<WagerTerms, 'risks'>): string => riskList(w).map(([f, n]) => FORFEIT[f].short(n)).join(', ') || 'nothing';

// The anti-loophole tag: a second Pact betting the same kind of outcome, at any setting, stakes nothing.
export const wagerTag = (w: Pick<WagerTerms, 'declare'>): string => `wager:${w.declare}`;

// A fresh Wager, as the Workshop adds one.
export const NEW_WAGER: WagerTerms = { declare: 'hit', pays: { output: 1 }, risks: { seal: FORFEIT.seal.at } };

// The checks every saved Wager passes (schema.ts calls this).
export function wagerError(w: Partial<WagerTerms>): string | null {
  if (!DECLARATIONS.includes(w.declare!)) return 'wager.declare is unknown';
  const steps = DECLARE[w.declare!].steps;
  if (w.at !== undefined && !(steps ?? []).includes(w.at)) return `wager.at ${String(w.at)} is not a setting of "${w.declare}"`;
  if (typeof w.pays !== 'object' || w.pays === null) return 'wager.pays is required';
  if (typeof w.risks !== 'object' || w.risks === null) return 'wager.risks is required';
  for (const [r, n] of Object.entries(w.pays)) {
    if (!REWARDS.includes(r as Reward)) return `wager.pays ${r} is unknown`;
    if (!Number.isInteger(n) || n! < 1 || n! > MAX_PARTS) return `wager.pays ${r} must be 1..${MAX_PARTS} parts`;
    if (!rewardFits(w.declare!, r as Reward)) return 'a harder strike pays only on a wager that the strike lands';
  }
  for (const [f, n] of Object.entries(w.risks)) {
    if (!FORFEITS.includes(f as Forfeit)) return `wager.risks ${f} is unknown`;
    if (!FORFEIT[f as Forfeit].steps.includes(n!)) return `wager.risks ${f} must be one of ${FORFEIT[f as Forfeit].steps.join(', ')}`;
  }
  return null;
}

// A Wager saved before its parts were tuned named one reward and one
// forfeit, each at the one size there was. It keeps exactly those: the same
// call at the setting it had, the whole stake to its reward, and its forfeit
// at the size it always was.
export function upgradeWager(c: { declare?: string; reward?: string; forfeit?: string; predict?: string; [k: string]: unknown }): unknown {
  if ('predict' in c) {
    // Older still: a prediction alone, which carried a tripled strike and a sealed Technique.
    const declare = c.predict === 'kill' || c.predict === 'untouched' ? c.predict : 'hit';
    return upgradeWager({ kind: 'wager', declare, reward: declare === 'hit' ? 'output' : 'charge', forfeit: 'seal' });
  }
  if (!('reward' in c) && !('forfeit' in c)) return c;
  const { reward, forfeit, ...rest } = c;
  const declare = c.declare as Declaration;
  const at = DECLARE[declare]?.steps ? DECLARE[declare].at : undefined;
  return {
    ...rest,
    ...(at !== undefined ? { at } : {}),
    pays: reward ? { [reward]: 1 } : {},
    risks: forfeit && FORFEIT[forfeit as Forfeit] ? { [forfeit]: FORFEIT[forfeit as Forfeit].at } : {},
  };
}
