import type { Telemetry } from './resolve';

// A Wager is a structure inside a Pact (wiki: Wagers). Every cast of the
// Pact declares an uncertain outcome; a correct call pays the Reward the
// player wrote, a wrong one lands the Forfeit they wrote. What the Wager is
// worth, its stake, comes only from real uncertainty and real loss: a call
// the player nearly always gets right or wrong, or a forfeit that costs
// little, stakes almost nothing, and the reward shrinks to match.

export type Declaration = 'hit' | 'multi' | 'kill' | 'untouched';
export type Reward = 'output' | 'charge' | 'mend';
export type Forfeit = 'seal' | 'blood' | 'drain' | 'slow';
export interface WagerTerms { declare: Declaration; reward: Reward; forfeit: Forfeit }

export const DECLARATIONS: readonly Declaration[] = ['hit', 'multi', 'kill', 'untouched'];
export const REWARDS: readonly Reward[] = ['output', 'charge', 'mend'];
export const FORFEITS: readonly Forfeit[] = ['seal', 'blood', 'drain', 'slow'];

// How long after the cast an outcome is settled, in seconds. `hit` and
// `multi` settle on the impact beat itself.
export const UNTOUCHED_FOR = 8;
export const KILL_WINDOW = 0.9;

export const DECLARE: Record<Declaration, { words: string; short: string; odds: (t: Telemetry) => number }> = {
  hit: { words: 'it lands', short: 'lands', odds: (t) => t.hitRate },
  multi: { words: 'it strikes two or more', short: 'hits two', odds: (t) => t.multiTargetFraction },
  kill: { words: 'it finishes a target', short: 'finishes', odds: (t) => t.killRate },
  untouched: { words: `nothing touches you for ${UNTOUCHED_FOR} seconds`, short: 'untouched', odds: (t) => t.untouchedRate },
};

// What a wrong call takes. `weight` is how much capability it puts at stake.
export const FORFEIT: Record<Forfeit, { words: string; short: string; weight: number }> = {
  seal: { words: 'your Technique seals for 5 seconds', short: 'sealed 5 s', weight: 2.4 },
  blood: { words: 'you lose a fifth of your health', short: '−20% health', weight: 2.0 },
  drain: { words: 'your resource and Maximum Output charge empty', short: 'emptied', weight: 1.6 },
  slow: { words: 'your legs go heavy for 6 seconds', short: 'slowed 6 s', weight: 1.0 },
};

// What a correct call pays, scaled by the stake.
export const REWARD: Record<Reward, { title: string; plain: string; amount: (stake: number) => number; words: (n: number) => string; short: (n: number) => string }> = {
  output: { title: 'Harder strike', plain: 'the strike hits harder', amount: (s) => 1 + 0.8 * s, words: (n) => `the strike hits ×${n.toFixed(1)} as hard`, short: (n) => `×${n.toFixed(1)} damage` },
  charge: { title: 'Maximum Output', plain: 'your Maximum Output ring fills', amount: (s) => Math.min(1, 0.22 * s), words: (n) => `your Maximum Output ring fills by ${Math.round(n * 100)}%`, short: (n) => `+${Math.round(n * 100)}% ring` },
  mend: { title: 'Mend', plain: 'you heal', amount: (s) => Math.min(0.5, 0.1 * s), words: (n) => `you heal ${Math.round(n * 100)}% of your health`, short: (n) => `+${Math.round(n * 100)}% health` },
};

// The harder strike is this cast's own damage, so it pays only on a call the
// impact settles; a later outcome cannot reach back into a blow already dealt.
export function rewardFits(declare: Declaration, reward: Reward): boolean {
  return reward !== 'output' || declare === 'hit';
}

export interface Stake {
  odds: number;
  // 0 when the outcome is certain either way, 1 at even odds.
  uncertainty: number;
  stake: number;
  amount: number;
  // Who already wagers on this outcome, when the stake is not counted again.
  by?: string;
  reason: string;
}

export function stakeOf(w: WagerTerms, t: Telemetry, by?: string): Stake {
  const odds = Math.min(0.99, Math.max(0.01, DECLARE[w.declare].odds(t)));
  const uncertainty = 4 * odds * (1 - odds);
  const stake = by ? 0 : Math.round(FORFEIT[w.forfeit].weight * uncertainty * 10) / 10;
  const pct = Math.round(odds * 100);
  const reason = by
    ? `"${by}" already wagers on this outcome, so it stakes nothing again`
    : uncertainty < 0.35
      ? `you call this right or wrong almost every time (${pct}%), so little is at stake`
      : `a ${pct}% call with ${FORFEIT[w.forfeit].short} on the line`;
  return { odds, uncertainty, stake, amount: REWARD[w.reward].amount(stake), by, reason };
}

export const wagerTag = (w: WagerTerms): string => `wager:${w.declare}`;
