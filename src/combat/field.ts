// An aura field as rules (issue #4): the pool, the open field, and how the
// last one ended. No rendering and no input, so the player, the Master and
// the checks all read the same model.
//
// Expansion commits the whole pool at once. The field then holds for its
// time, or until it is retracted (by choice) or collapsed (by losing a
// clash). Retracting keeps the unused share of the field as pool, so an
// early retract brings the next expansion sooner; a collapsed field keeps a
// little by its density, and a spent one leaves the pool empty. The pool must
// be full before the next expansion. While it is open its shape can change
// (pushed wider and thinner), so `reach` and `density` are the current shape.

// Every number aura uses, in one place. `untrained` is refinement 0 and
// `refined` is refinement 1; the field interpolates between them.
export const AURA = {
  // Seconds an open field holds before it is spent.
  holds: { untrained: 9, refined: 14 },
  // Seconds an empty pool takes to refill.
  recovers: { untrained: 14, refined: 9 },
  // The compact field a tap of F opens: its radius in metres, and how dense
  // it is, 0..1. Density settles tied exchanges in a clash and scales
  // everything below. Refinement raises both, which is the whole budget.
  reach: { untrained: 4, refined: 6 },
  density: { untrained: 0.4, refined: 1 },
  // Holding F pushes the field out: after `tap` seconds held it widens for
  // `seconds`, up to `wide` times the compact reach, and commits on release
  // (or when it is fully out). The budget is fixed, so reach x density stays
  // the same: twice as wide is half as dense. While it is pushed out the
  // player moves at `slow` and cannot cast.
  push: { tap: 0.18, seconds: 1.1, wide: 2, slow: 0.35 },
  // Inside your own field your Techniques are sharper: their wind-ups play
  // `speed` x density faster, and their hits on bodies in the field land
  // `damage` x density harder. A compact refined field: +25% and +35%.
  sharper: { speed: 0.25, damage: 0.35 },
  // Reinforcement: a blow on someone standing in their own settled field
  // lands (1 - reinforce x density) as hard. Not while it is being pushed out.
  reinforce: 0.3,
  // Pressure: a body inside someone else's field, without a field of its own
  // open, moves (1 - base - perDensity x density) as fast, and enemies wind
  // up that much slower. A thin field still presses, so a wide one carries
  // pressure across all of its area.
  hinder: { base: 0.15, perDensity: 0.3 },
  // Sensing: inside your field an enemy's blow shows its mark `lead` seconds
  // before its wind-up begins, and its marks are lit (`glow`, the mark's fill).
  sense: { lead: 0.45, glow: 0.35 },
  // A collapsed field keeps `keeps` x density of its pool: a dense field is
  // crushed but not emptied, so it comes back sooner.
  collapse: { keeps: 0.5 },
  // Losing a clash: the loser is held for `stun` seconds and takes `taken`
  // more damage for `seconds`. The winner gets that opening, not a free hit.
  guardBreak: { stun: 0.9, seconds: 3, taken: 0.2 },
  // Refinement's ceiling: a broader Technique and every inscribed Pact lower it.
  potential: { perBreadth: 0.1, perPact: 0.05, floor: 0.2 },
  // The Ancient Echo Master: a wide field of high density, always open when
  // her pool is full. She knows little of aurabending; she simply has had a
  // very long time. Denser than any field below refinement 2/3, so only a
  // trained compact field takes tied picks from her.
  master: { density: 0.7, recovers: 16, reach: { outdoors: 13, indoors: 7.5 } },
} as const;

const mix = (r: { untrained: number; refined: number }, t: number) => r.untrained + (r.refined - r.untrained) * t;

export interface FieldShape { reach: number; density: number }

// The field a refinement buys, compact.
export function fieldFor(refinement: number): FieldShape & { holds: number; recovers: number } {
  const t = Math.max(0, Math.min(1, refinement));
  return { reach: mix(AURA.reach, t), density: mix(AURA.density, t), holds: mix(AURA.holds, t), recovers: mix(AURA.recovers, t) };
}

// The compact field pushed out by `spread`, 0 (a tap) to 1 (held all the
// way): wider is always thinner, and reach x density never changes.
export function shapeOf(compact: FieldShape, spread: number): FieldShape {
  const reach = compact.reach * (1 + (AURA.push.wide - 1) * Math.max(0, Math.min(1, spread)));
  return { reach, density: compact.density * compact.reach / reach };
}

// What a field's pressure leaves of a body's speed.
export const pressure = (density: number): number => 1 - AURA.hinder.base - AURA.hinder.perDensity * density;
// What reinforcement lets through of a blow.
export const reinforcement = (density: number): number => 1 - AURA.reinforce * density;

// How high refinement can go: the wiki's "broader Technique, lower aura
// aptitude", plus the owner's rule that every inscribed Pact costs some too.
// `breadth` is the Technique's innate possibility space, 1 (narrow) to 5.
export function auraPotential(breadth: number, pacts: number): number {
  const { perBreadth, perPact, floor } = AURA.potential;
  return Math.max(floor, Math.min(1, 1 - perBreadth * (breadth - 1) - perPact * pacts));
}

export type FieldEnd = 'retracted' | 'collapsed' | 'spent';
export type FieldState = 'ready' | 'open' | 'recovering';

export class AuraField {
  state: FieldState = 'ready';
  // 0..1. Full means ready; an open field has spent it all.
  pool = 1;
  // Seconds the open field has left.
  left = 0;
  // What the open field was given when it expanded.
  reach = 0;
  density = 0;
  holds = 0;
  // The drawn radius: it grows to `reach` and shrinks back when the field ends.
  radius = 0;
  ended: FieldEnd | null = null;

  constructor(public recovers: number) {}

  get open(): boolean { return this.state === 'open'; }
  get ready(): boolean { return this.state === 'ready'; }

  expand(reach: number, density: number, holds: number): boolean {
    if (!this.ready) return false;
    this.state = 'open';
    this.pool = 0;
    this.left = this.holds = holds;
    this.reach = reach;
    this.density = density;
    this.ended = null;
    return true;
  }

  // The field ends. A retract keeps the time it did not use as pool, a
  // collapse keeps a share by its density, and a spent field starts from empty.
  end(why: FieldEnd): boolean {
    if (!this.open) return false;
    this.state = 'recovering';
    this.ended = why;
    this.pool = why === 'retracted' && Number.isFinite(this.holds) && this.holds > 0 ? Math.max(0, Math.min(1, this.left / this.holds))
      : why === 'collapsed' ? AURA.collapse.keeps * this.density : 0;
    this.left = 0;
    return true;
  }

  // A Wager's reward: `share` of a pool refills, or an open field holds that
  // share of its time longer (never past what it held when it opened).
  fill(share: number): void {
    if (this.open) { this.left = Math.min(this.holds, this.left + share * this.holds); return; }
    if (this.state !== 'recovering') return;
    this.pool = Math.min(1, this.pool + share);
    if (this.pool >= 1) this.state = 'ready';
  }

  // A Wager's forfeit: `share` of the pool is lost, or of an open field's
  // time; a field with no time left is spent.
  lose(share: number): void {
    if (this.open) {
      this.left -= share * this.holds;
      if (this.left <= 1e-3) this.end('spent');
      return;
    }
    if (this.state === 'ready') { this.state = 'recovering'; this.ended = 'spent'; }
    this.pool = Math.max(0, this.pool - share);
  }

  // Back to a full pool and no field, for a new scene.
  reset(): void {
    this.state = 'ready';
    this.pool = 1;
    this.left = 0;
    this.radius = 0;
    this.ended = null;
  }

  update(dt: number): void {
    if (this.open) {
      this.left -= dt;
      if (this.left <= 0) this.end('spent');
    } else if (this.state === 'recovering') {
      this.pool = Math.min(1, this.pool + dt / this.recovers);
      if (this.pool >= 1) { this.state = 'ready'; }
    }
    // Expanding snaps out; retracting draws in; a collapse is crushed fast.
    const want = this.open ? this.reach : 0;
    const rate = this.open ? 9 : this.ended === 'collapsed' ? 14 : 6;
    this.radius += (want - this.radius) * (1 - Math.exp(-rate * dt));
    if (!this.open && this.radius < 0.02) this.radius = 0;
  }
}
