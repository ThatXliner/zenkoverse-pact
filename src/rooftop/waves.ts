import type { EnemyScale } from '../combat/enemies';

// The eight waves of the classic arena (commit 88f0e81), on the new roster.
// The Architect has no counterpart in the rebuild, so its slots are Husks.
export interface WaveDef { title: string; jp: string; spawns: Record<string, number>; bossHp?: number; bossDmg?: number; gap?: number; soften?: number }

export const WAVES: readonly WaveDef[] = [
  { title: 'Academy Exam', jp: '試験', spawns: { thug: 4 }, gap: 1.8, soften: 0.7 },
  { title: 'Rooftop Ambush', jp: '奇襲', spawns: { thug: 3, runner: 3 }, gap: 1.1, soften: 0.85 },
  { title: 'Ledger Contract', jp: '契約書', spawns: { runner: 3, bruiser: 2, thug: 2 }, gap: 0.8 },
  { title: 'The Kuroda Lineage', jp: '黒田', spawns: { kuroda: 1, thug: 3 }, bossHp: 0.6, bossDmg: 0.7 },
  { title: 'Programmed Assault', jp: '襲撃', spawns: { husk: 2, bruiser: 2, thug: 3, runner: 2 } },
  { title: 'Underworld Crew', jp: '裏社会', spawns: { runner: 3, bruiser: 3, husk: 1, thug: 3 } },
  { title: 'Clan Retaliation', jp: '報復', spawns: { husk: 2, bruiser: 3, runner: 3, thug: 4 } },
  { title: 'Five Thousand Years', jp: '五千年', spawns: { ancient: 1 }, bossHp: 0.5, bossDmg: 0.55 },
];

export const WAVE_COUNT = WAVES.length;
export const HEAL_BETWEEN = 0.35;
export const EYE_AFTER = 3;

export const SPAWN_GAP = 0.45;

// The yard's thugs are built for one-on-one fights. A wave puts a dozen on
// the roof, so every regular enemy carries TRIAL's share of its yard health
// and damage, and then hardens by 6% health and 6.5% damage per wave, as in the
// classic arena. Bosses keep their encounter moves with a trimmed health pool
// and a softer hand.
const TRIAL = { hp: 0.5, dmg: 0.65 };
export function scaleFor(wave: number, key: string): EnemyScale {
  if (key === 'kuroda' || key === 'ancient') return { hp: WAVES[wave]!.bossHp ?? 1, dmg: WAVES[wave]!.bossDmg ?? 1 };
  return { hp: TRIAL.hp * (1 + wave * 0.06), dmg: TRIAL.dmg * (1 + wave * 0.065) * (WAVES[wave]!.soften ?? 1) };
}

export const SCORE: Record<string, number> = { thug: 10, runner: 15, bruiser: 15, husk: 20, kuroda: 120, ancient: 400 };
export const CLEAR_BONUS = 50;
export const WAGER_BONUS = 25;
export const VICTORY_BONUS = 500;

export function roster(wave: number): string[] {
  const out: string[] = [];
  for (const [key, n] of Object.entries(WAVES[wave]!.spawns)) for (let i = 0; i < n; i++) out.push(key);
  return out;
}
