// Types for clash.js, the clash rules the client and the server share.
export type Pick = 'push' | 'hold' | 'feint';
export type Side = 0 | 1;
export interface ClashRules { introMs: number; windowMs: number; revealMs: number; rounds: number; winAt: number; tieMargin: number; closeMargin: number }
export type EndReason = 'rounds' | 'density' | 'even' | 'forfeit';
export type ClashEvent =
  | { kind: 'round'; round: number; ms: number }
  | { kind: 'reveal'; round: number; picks: [Pick, Pick]; winner: Side | null; score: [number, number] }
  | { kind: 'end'; winner: Side | null; reason: EndReason };

export const PICKS: readonly Pick[];
export function isPick(p: unknown): p is Pick;
export function counterTo(p: Pick): Pick;
export function roundWinner(a: Pick, b: Pick, densityA: number, densityB: number, rules: ClashRules): Side | null;

export class ClashReferee {
  constructor(density: [number, number], rules: ClashRules, now: number);
  readonly stage: 'intro' | 'choose' | 'reveal' | 'over';
  readonly round: number;
  readonly score: [number, number];
  readonly picks: [Pick | null, Pick | null];
  readonly winner: Side | null | undefined;
  readonly until: number;
  readonly over: boolean;
  pick(side: Side, pick: Pick, now: number): boolean;
  step(now: number): ClashEvent[];
  forfeit(side: Side): ClashEvent[];
}
