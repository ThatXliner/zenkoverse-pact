import { signal } from '@preact/signals';
import type { TechniqueId } from '../pacts/schema';

export type MasteryStat = 'output' | 'precision' | 'efficiency' | 'range' | 'speed' | 'control' | 'activation' | 'tolerance';
export const MASTERY_STATS: readonly MasteryStat[] = ['output', 'precision', 'efficiency', 'range', 'speed', 'control', 'activation', 'tolerance'];
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
  diminishing: 2.2,
  strainPerDrill: 0.12,
  strainRecoveryPerSecond: 0.01,
  showNumbers: true,
};

type Stats = Record<MasteryStat, number>;
const zero = (): Stats => ({ output: 0, precision: 0, efficiency: 0, range: 0, speed: 0, control: 0, activation: 0, tolerance: 0 });
const KEY = 'zenko.mastery.v1';

export class Mastery {
  readonly stats = signal<Record<TechniqueId, Stats>>({ recoil: zero(), shift: zero(), rime: zero(), blink: zero(), echo: zero() });
  strain = 0;
  readonly recent = signal<{ stat: MasteryStat; amount: number; id: number } | null>(null);
  private n = 0;

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.stats.value = { ...this.stats.value, ...(JSON.parse(raw) as Record<TechniqueId, Stats>) };
    } catch { /* fresh */ }
  }

  get(t: TechniqueId, s: MasteryStat): number { return this.stats.value[t][s]; }

  // Diminishing returns: gains shrink as a stat approaches 1, and strain
  // taxes the gain so grinding without rest pays less.
  gain(t: TechniqueId, s: MasteryStat, amount: number): number {
    const cur = this.get(t, s);
    const applied = amount * Math.pow(1 - cur, MASTERY_CONFIG.diminishing) * (1 - this.strain * 0.6);
    const next = Math.min(1, cur + applied);
    this.stats.value = { ...this.stats.value, [t]: { ...this.stats.value[t], [s]: next } };
    this.recent.value = { stat: s, amount: applied, id: ++this.n };
    try { localStorage.setItem(KEY, JSON.stringify(this.stats.value)); } catch { /* storage unavailable */ }
    return applied;
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
