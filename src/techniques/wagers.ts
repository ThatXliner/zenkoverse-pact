import * as THREE from 'three';
import { signal } from '@preact/signals';
import type { Game } from '../app/game';
import { banner } from '../app/game';
import { combatUi } from '../combat/combat';
import { type Pact, wagerOf } from '../pacts/schema';
import { WEIGHT, callKey, callWords, paysShort, risksShort, riskList, settingOf, type Stake, type WagerTerms } from '../pacts/wager';
import { OddsProbes, recordCall } from '../pacts/odds';
import type { Enemy } from '../combat/enemies';
import type { AbilityKind } from '../pacts/slots';

// The Wager in play. Casting a Pact that holds a Wager declares it: the
// call shows over the player, the outcome settles on the impact (or within
// the call's seconds after it), and the rewards or the forfeits land at once
// with their own banner. One call is open at a time; a cast of the Pact
// while one is open is an ordinary cast.
//
// Every cast, wagered or not, is also measured at every setting a call can
// take (src/pacts/odds.ts), so the odds a Wager is written against are this
// player's own.

export interface WagerCall { id: number; pact: string; call: string; win: string; lose: string; left: number | null }
export const wagerUi = signal<WagerCall | null>(null);
// The Pacts a lost Wager has put out, by id, with the seconds they stay dark.
export const darkUi = signal<ReadonlyMap<string, number>>(new Map());

const GOLD = 0xffd34d;
const RED = 0xff5a4a;
// A declared cast that never reaches its impact (interrupted, sealed) lapses after this.
const LAPSE = 3;

interface Open { pact: Pact; w: WagerTerms; stake: Stake; ctx: object; fired: boolean; t: number; marked: Enemy[] }

export class Wagers {
  // The damage multiplier on blows the declared cast deals as it lands.
  boost = 1;
  private open: Open | null = null;
  private id = 0;
  private now = 0;
  private dark = new Map<string, number>();
  private probes: OddsProbes<Enemy[]>;

  constructor(private game: Game) {
    this.probes = new OddsProbes(() => game.book.telemetry.odds);
  }

  get pending(): boolean { return !!this.open; }
  isDark(id: string): boolean { return this.dark.has(id); }

  // Called as a cast starts. True when this cast declares its Pact's Wager.
  declare(pact: Pact | null, ctx: object): boolean {
    const w = pact ? wagerOf(pact) : null;
    if (!pact || !w || this.open) return false;
    const stake = this.game.book.estimate(pact).wager!;
    this.open = { pact, w, stake, ctx, fired: false, t: 0, marked: [] };
    this.game.audio.play('wager.arm');
    this.show();
    return true;
  }

  // Runs the kit's effect for a cast, with the declared cast's reward in its
  // blows, and measures what the cast did.
  fire<R extends { hits?: number } | void>(ctx: { kind: AbilityKind }, run: () => R): R {
    const o = this.open?.ctx === ctx && !this.open.fired ? this.open : null;
    const standing = () => this.game.targets().filter((e) => e.alive);
    if (o) {
      o.fired = true;
      o.t = 0;
      if (o.w.declare === 'kill') o.marked = standing();
      this.boost = o.stake.payouts.find((p) => p.reward === 'output')?.amount ?? 1;
    }
    const before = ctx.kind !== 'max' ? standing() : null;
    let r: R;
    try { r = run(); } finally { this.boost = 1; }
    const hits = (r as { hits?: number } | undefined)?.hits ?? 0;
    if (before) this.probes.impact(this.now, hits, before);
    if (o?.w.declare === 'hit') this.settle(hits > 0);
    else if (o?.w.declare === 'multi') this.settle(hits >= settingOf(o.w));
    else if (o) this.show();
    return r;
  }

  // A blow from someone else breaks an "untouched" call.
  struck(): void {
    this.probes.struck(this.now);
    if (this.open?.fired && this.open.w.declare === 'untouched') this.settle(false);
  }

  update(dt: number): void {
    this.now += dt;
    this.probes.tick(this.now, (marked) => marked.some((e) => !e.alive));
    if (this.dark.size) {
      for (const [id, left] of this.dark) if (left - dt <= 0) this.dark.delete(id); else this.dark.set(id, left - dt);
      if (this.dark.size !== darkUi.value.size) darkUi.value = new Map(this.dark);
    }
    const o = this.open;
    if (!o) return;
    o.t += dt;
    if (!o.fired) { if (o.t > LAPSE) { this.open = null; wagerUi.value = null; } }
    else if (o.w.declare === 'kill') {
      if (o.marked.some((e) => !e.alive)) this.settle(true);
      else if (o.t > settingOf(o.w)) this.settle(false);
    } else if (o.w.declare === 'untouched') {
      if (o.t >= settingOf(o.w)) this.settle(true);
      else this.show();
    }
  }

  clear(): void {
    this.open = null;
    this.boost = 1;
    wagerUi.value = null;
    this.probes.clear();
    this.dark.clear();
    if (darkUi.value.size) darkUi.value = new Map();
  }

  private settle(won: boolean): void {
    const o = this.open!;
    const g = this.game;
    this.open = null;
    const at = g.player.position.clone().add(new THREE.Vector3(0, 0.08, 0));
    g.vfx.ring(at, won ? GOLD : RED, 0.3, won ? 3.2 : 2.2, 0.45);
    recordCall(g.book.telemetry.odds, callKey(o.w), won);
    if (won) {
      g.combat.wagersWon++;
      g.audio.play('wager.won');
      this.reward(o);
      banner('的中', `${o.pact.name}: called right. ${this.paid(o.stake)}`);
    } else {
      g.combat.wagersLost++;
      g.audio.play('wager.lost');
      this.forfeit(o);
      banner('外れ', `${o.pact.name}: called wrong. ${risksShort(o.w)}`);
    }
    // The banner and the ring say how it fell; the open-call slip goes.
    wagerUi.value = null;
    g.tutorial.notify(won ? 'wager-won' : 'wager-lost');
  }

  // What a right call pays here. Online the server owns health, so a share
  // given to mending pays nothing there.
  private paid(stake: Stake): string {
    return paysShort({ payouts: stake.payouts.filter((p) => !(this.game.net && p.reward === 'mend')) });
  }

  private reward(o: Open): void {
    const g = this.game, t = g.techniques;
    for (const { reward, amount: n } of o.stake.payouts) {
      if (reward === 'charge') t.charge = Math.min(1, t.charge + n);
      if (reward === 'refill') t.resource = Math.min(t.def.resource.max, t.resource + n * t.def.resource.max);
      if (reward === 'aura') g.aura.field.fill(n);
      if (reward === 'mend' && !g.net) {
        g.combat.hp = Math.min(g.combat.maxHp, g.combat.hp + g.combat.maxHp * n);
        combatUi.hp.value = g.combat.hp / g.combat.maxHp;
      }
    }
  }

  private forfeit(o: Open): void {
    const g = this.game, t = g.techniques;
    for (const [f, n] of riskList(o.w)) {
      switch (f) {
        case 'seal': t.seal(n); break;
        case 'blood': g.combat.hurtPlayer(g.combat.maxHp * n, { self: true }); break;
        case 'drain': t.resource *= 1 - n; t.charge *= 1 - n; break;
        case 'slow': g.player.speedScale = WEIGHT.slowFactor; g.vfx.until(n, () => { g.player.speedScale = 1; }); break;
        case 'aura': g.aura.field.lose(n); break;
        case 'dark': this.dark.set(o.pact.id, n); darkUi.value = new Map(this.dark); break;
      }
    }
  }

  // The open call's slip. It re-renders only when the "untouched" count ticks down.
  private show(): void {
    const o = this.open;
    if (!o) return;
    const left = o.fired && o.w.declare === 'untouched' ? Math.max(0, Math.ceil(settingOf(o.w) - o.t)) : null;
    const cur = wagerUi.value;
    if (cur && cur.left === left) return;
    wagerUi.value = { id: cur?.id ?? ++this.id, pact: o.pact.name, call: callWords(o.w), win: this.paid(o.stake), lose: risksShort(o.w), left };
  }
}
