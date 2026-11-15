import * as THREE from 'three';
import { signal } from '@preact/signals';
import type { Game } from '../app/game';
import { banner } from '../app/game';
import { combatUi } from '../combat/combat';
import { type Pact, wagerOf } from '../pacts/schema';
import { DECLARE, REWARD, FORFEIT, KILL_WINDOW, UNTOUCHED_FOR, type WagerTerms, type Stake } from '../pacts/wager';
import type { Enemy } from '../combat/enemies';

// The Wager in play. Casting a Pact that holds a Wager declares it: the
// call shows over the player, the outcome settles on the impact (or a
// moment after, or eight seconds after for "untouched"), and the reward or
// the forfeit lands at once with its own banner. One call is open at a
// time; a cast of the Pact while one is open is an ordinary cast.

export interface WagerCall { id: number; pact: string; call: string; win: string; lose: string; left: number | null }
export const wagerUi = signal<WagerCall | null>(null);

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

  constructor(private game: Game) {}

  get pending(): boolean { return !!this.open; }

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

  // Runs the kit's effect for a cast, with the declared cast's reward in its blows.
  fire<R extends { hits?: number } | void>(ctx: object, run: () => R): R {
    const o = this.open;
    if (!o || o.ctx !== ctx || o.fired) return run();
    o.fired = true;
    o.t = 0;
    if (o.w.declare === 'kill') o.marked = this.game.targets().filter((e) => e.alive);
    if (o.w.reward === 'output') this.boost = o.stake.amount;
    let r: R;
    try { r = run(); } finally { this.boost = 1; }
    const hits = (r as { hits?: number } | undefined)?.hits ?? 0;
    if (o.w.declare === 'hit') this.settle(hits > 0);
    else if (o.w.declare === 'multi') this.settle(hits >= 2);
    else this.show();
    return r;
  }

  // A blow from someone else breaks an "untouched" call.
  struck(): void {
    if (this.open?.fired && this.open.w.declare === 'untouched') this.settle(false);
  }

  update(dt: number): void {
    const o = this.open;
    if (o) {
      o.t += dt;
      if (!o.fired) { if (o.t > LAPSE) { this.open = null; wagerUi.value = null; } }
      else if (o.w.declare === 'kill') {
        if (o.marked.some((e) => !e.alive)) this.settle(true);
        else if (o.t > KILL_WINDOW) this.settle(false);
      } else if (o.w.declare === 'untouched') {
        if (o.t >= UNTOUCHED_FOR) this.settle(true);
        else this.show();
      }
    }
  }

  clear(): void { this.open = null; this.boost = 1; wagerUi.value = null; }

  private settle(won: boolean): void {
    const o = this.open!;
    const g = this.game;
    this.open = null;
    const at = g.player.position.clone().add(new THREE.Vector3(0, 0.08, 0));
    g.vfx.ring(at, won ? GOLD : RED, 0.3, won ? 3.2 : 2.2, 0.45);
    if (o.w.declare === 'kill') g.book.observe('killRate', won ? 1 : 0, 0.1);
    if (o.w.declare === 'untouched') g.book.observe('untouchedRate', won ? 1 : 0, 0.1);
    if (won) {
      g.combat.wagersWon++;
      g.audio.play('wager.won');
      this.reward(o);
      banner('的中', `${o.pact.name}: called right. ${REWARD[o.w.reward].short(o.stake.amount)}`);
    } else {
      g.combat.wagersLost++;
      g.audio.play('wager.lost');
      this.forfeit(o);
      banner('外れ', `${o.pact.name}: called wrong. ${FORFEIT[o.w.forfeit].short}`);
    }
    // The banner and the ring say how it fell; the open-call slip goes.
    wagerUi.value = null;
    g.tutorial.notify(won ? 'wager-won' : 'wager-lost');
  }

  private reward(o: Open): void {
    const g = this.game, n = o.stake.amount;
    if (o.w.reward === 'charge') g.techniques.charge = Math.min(1, g.techniques.charge + n);
    if (o.w.reward === 'mend' && !g.net) {
      g.combat.hp = Math.min(g.combat.maxHp, g.combat.hp + g.combat.maxHp * n);
      combatUi.hp.value = g.combat.hp / g.combat.maxHp;
    }
  }

  private forfeit(o: Open): void {
    const g = this.game;
    switch (o.w.forfeit) {
      case 'seal': g.techniques.seal(5); break;
      case 'blood': g.combat.hurtPlayer(g.combat.maxHp * 0.2, { self: true }); break;
      case 'drain': g.techniques.resource = 0; g.techniques.charge = 0; break;
      case 'slow': g.player.speedScale = 0.6; g.vfx.until(6, () => { g.player.speedScale = 1; }); break;
    }
  }

  // The open call's slip. It re-renders only when the "untouched" count ticks down.
  private show(): void {
    const o = this.open;
    if (!o) return;
    const left = o.fired && o.w.declare === 'untouched' ? Math.max(0, Math.ceil(UNTOUCHED_FOR - o.t)) : null;
    const cur = wagerUi.value;
    if (cur && cur.left === left) return;
    wagerUi.value = { id: cur?.id ?? ++this.id, pact: o.pact.name, call: DECLARE[o.w.declare].words, win: REWARD[o.w.reward].short(o.stake.amount), lose: FORFEIT[o.w.forfeit].short, left };
  }

}
