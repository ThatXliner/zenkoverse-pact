import { signal } from '@preact/signals';
import type { TechniqueId } from '../pacts/schema';

export type MasteryStat = 'output' | 'precision' | 'efficiency' | 'range' | 'speed' | 'control' | 'activation' | 'tolerance' | 'refinement';
export const MASTERY_STATS: readonly MasteryStat[] = ['output', 'precision', 'efficiency', 'range', 'speed', 'control', 'activation', 'tolerance', 'refinement'];
export type GestureVariant = 'long' | 'short' | 'none';

// Open tuning questions (issue #17) live here so they change without code.
export const MASTERY_CONFIG = {
  shortSignAt: 0.35,
  silentSignAt: 0.75,
  // The deliberate full sign (Alt). A completed sign primes the next cast for
  // `window` seconds. Its boost is the old condition applied to the grown
  // baseline, so it rises with Activation: `novice` at 0, `master` at 1,
  // along activation^curve.
  sign: { window: 4, boost: { novice: 0.15, master: 0.75, curve: 1.6 } },
  // Play alone fills a stat only this far. Past it, only a drill's tiers
  // raise the stat (`Mastery.raiseTo`), so a skilled newcomer who clears
  // them matches someone who has played for months. Output uses it now.
  passiveCeiling: 0.4,
  diminishing: 2.2,
  strainPerDrill: 0.12,
  strainRecoveryPerSecond: 0.01,
  showNumbers: true,
};

type Stats = Record<MasteryStat, number>;
const zero = (): Stats => ({ output: 0, precision: 0, efficiency: 0, range: 0, speed: 0, control: 0, activation: 0, tolerance: 0, refinement: 0 });
const KEY = 'zenko.mastery.v1';

export class Mastery {
  readonly stats = signal<Record<TechniqueId, Stats>>({ recoil: zero(), shift: zero(), rime: zero(), blink: zero(), echo: zero() });
  strain = 0;
  readonly recent = signal<{ stat: MasteryStat; amount: number; id: number } | null>(null);
  private n = 0;
  // A stat with a ceiling below 1: aura refinement stops at the potential its Technique and Pacts leave (issue #4).
  private caps = new Map<MasteryStat, (t: TechniqueId) => number>();

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) { const saved = JSON.parse(raw) as Record<TechniqueId, Partial<Stats>>; this.stats.value = Object.fromEntries(Object.entries(this.stats.value).map(([t, s]) => [t, { ...s, ...saved[t as TechniqueId] }])) as Record<TechniqueId, Stats>; }
    } catch { /* fresh */ }
  }

  get(t: TechniqueId, s: MasteryStat): number { return this.stats.value[t][s]; }

  capBy(s: MasteryStat, cap: (t: TechniqueId) => number): void { this.caps.set(s, cap); }
  cap(t: TechniqueId, s: MasteryStat): number { return this.caps.get(s)?.(t) ?? 1; }

  // Diminishing returns: gains shrink as a stat approaches its ceiling (1,
  // or less for a capped stat), and strain taxes the gain so grinding
  // without rest pays less. Nothing grows past the ceiling.
  gain(t: TechniqueId, s: MasteryStat, amount: number): number {
    const cur = this.get(t, s);
    const cap = this.cap(t, s);
    const applied = Math.max(0, amount * cap * Math.pow(Math.max(0, 1 - cur / cap), MASTERY_CONFIG.diminishing) * (1 - this.strain * 0.6));
    this.set(t, s, Math.max(cur, Math.min(cap, cur + applied)), applied);
    return applied;
  }

  // A gain from ordinary play, stopped at the passive ceiling. Below it the
  // usual diminishing returns apply; a stat already above it is untouched.
  gainPassive(t: TechniqueId, s: MasteryStat, amount: number): number {
    const cur = this.get(t, s);
    const ceiling = Math.min(this.cap(t, s), MASTERY_CONFIG.passiveCeiling);
    if (cur >= ceiling) return 0;
    const applied = Math.min(ceiling - cur, Math.max(0, amount * Math.pow(1 - cur, MASTERY_CONFIG.diminishing) * (1 - this.strain * 0.6)));
    this.set(t, s, cur + applied, applied);
    return applied;
  }

  // A skill gate passed: the stat stands at least at `level` (held to its
  // ceiling). Clearing the same gate again adds nothing, so a gate pays for
  // the skill it tests and not for the time spent on it.
  raiseTo(t: TechniqueId, s: MasteryStat, level: number): number {
    const cur = this.get(t, s);
    const next = Math.min(this.cap(t, s), level);
    if (next <= cur) return 0;
    this.set(t, s, next, next - cur);
    return next - cur;
  }

  private set(t: TechniqueId, s: MasteryStat, v: number, applied: number): void {
    this.stats.value = { ...this.stats.value, [t]: { ...this.stats.value[t], [s]: v } };
    this.recent.value = { stat: s, amount: applied, id: ++this.n };
    try { localStorage.setItem(KEY, JSON.stringify(this.stats.value)); } catch { /* storage unavailable */ }
  }

  addStrain(a: number): void { this.strain = Math.min(1, this.strain + a); }

  variant(t: TechniqueId): GestureVariant {
    const a = this.get(t, 'activation');
    return a >= MASTERY_CONFIG.silentSignAt ? 'none' : a >= MASTERY_CONFIG.shortSignAt ? 'short' : 'long';
  }

  // The potency multiplier a primed cast earns, minus one.
  signBoost(t: TechniqueId): number {
    const { novice, master, curve } = MASTERY_CONFIG.sign.boost;
    return novice + (master - novice) * Math.pow(this.get(t, 'activation'), curve);
  }

  update(dt: number): void { this.strain = Math.max(0, this.strain - MASTERY_CONFIG.strainRecoveryPerSecond * dt); }

  reset(): void { this.stats.value = { recoil: zero(), shift: zero(), rime: zero(), blink: zero(), echo: zero() }; try { localStorage.removeItem(KEY); } catch { /* */ } }
}
