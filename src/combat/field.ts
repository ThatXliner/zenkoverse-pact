// An aura field as rules (issue #4): the pool, the open field, and how the
// last one ended. No rendering and no input, so the player, the Master and
// the checks all read the same model.
//
// Expansion commits the whole pool at once. The field then holds for its
// time, or until it is retracted (by choice) or collapsed (by losing a
// clash). Nothing is refunded, and the pool must refill completely before
// the next expansion.

// Every number aura uses, in one place. `untrained` is refinement 0 and
// `refined` is refinement 1; the field interpolates between them.
export const AURA = {
  // Seconds an open field holds before it is spent.
  holds: { untrained: 9, refined: 14 },
  // Seconds an empty pool takes to refill.
  recovers: { untrained: 14, refined: 9 },
  // The field's radius in metres.
  reach: { untrained: 4.5, refined: 7.5 },
  // How dense the field is, 0..1. Density settles tied exchanges in a clash
  // and scales everything below.
  density: { untrained: 0.3, refined: 0.9 },
  // Inside your own field your Techniques are sharper: their wind-ups play
  // `speed` x density faster, and their hits on bodies in the field land
  // `damage` x density harder. At refinement 1 that is +13% and +18%.
  sharper: { speed: 0.15, damage: 0.2 },
  // A body inside someone else's field, without a field of its own open,
  // moves (1 - hinder x density) as fast, and enemies wind up that much slower.
  hinder: 0.5,
  // Losing a clash: the loser is held for `stun` seconds and takes `taken`
  // more damage for `seconds`. The winner gets that opening, not a free hit.
  guardBreak: { stun: 0.9, seconds: 3, taken: 0.2 },
  // Refinement's ceiling: a broader Technique and every inscribed Pact lower it.
  potential: { perBreadth: 0.1, perPact: 0.05, floor: 0.2 },
  // The Ancient Echo Master: a wide field of middling density. She knows
  // little of aurabending; she simply has had a very long time.
  master: { density: 0.6, recovers: 12, reach: { outdoors: 13, indoors: 7.5 } },
} as const;

const mix = (r: { untrained: number; refined: number }, t: number) => r.untrained + (r.refined - r.untrained) * t;

// The field a refinement buys.
export function fieldFor(refinement: number): { reach: number; density: number; holds: number; recovers: number } {
  const t = Math.max(0, Math.min(1, refinement));
  return { reach: mix(AURA.reach, t), density: mix(AURA.density, t), holds: mix(AURA.holds, t), recovers: mix(AURA.recovers, t) };
}

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
    this.left = holds;
    this.reach = reach;
    this.density = density;
    this.ended = null;
    return true;
  }

  // The field ends. Whatever the reason, the pool starts from empty.
  end(why: FieldEnd): boolean {
    if (!this.open) return false;
    this.state = 'recovering';
    this.ended = why;
    this.left = 0;
    this.pool = 0;
    return true;
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
