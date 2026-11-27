import * as THREE from 'three';
import { signal } from '@preact/signals';
import type { Game } from '../app/game';
import { hud, banner } from '../app/game';
import { setState } from '../app/state';
import type { Enemy } from './enemies';
import { AURA } from './field';
import { Eyes } from '../eyes/eyes';
import type { EyeId } from '../eyes/registry';
import type { TechniqueId } from '../techniques/kit';
import { RULES } from '../net/protocol';
import { MELEE, type MeleeWeight } from './melee';

export const combatUi = {
  hp: signal(1),
  // Health is coming back on its own (out of a fight).
  mending: signal(false),
  boss: signal<{ name: string; frac: number; color: number } | null>(null),
  // Damage numbers, and sound words lettered over heavy hits (`word`).
  numbers: signal<FloatText[]>([]),
};

export interface FloatText { id: number; x: number; y: number; text: string; color: string; big: boolean; word: boolean; tilt: number }
interface FloatNum { id: number; pos: THREE.Vector3; text: string; color: string; life: number; big: boolean; word: boolean; tilt: number }

// Player vitals, damage exchange, Wagers, Maximum Output charge, Eyes, and
// the feel layer on big hits: hit-stop, impact frames, shake, chroma.
export class Combat {
  hp = 100;
  maxHp = 100;
  god = false;
  invuln = 0;
  flags = { overextension: false, bloodDraw: false };
  // The installed Eye (src/eyes): kept across sessions, as installing one is for good.
  readonly eyes: Eyes;
  private nums: FloatNum[] = [];
  private numId = 0;
  private lastWord = -1;
  private stopAt = -1;
  // Seconds since this player last fought: dealt or took a blow, or stood
  // near an enemy that could fight, or was in an encounter or the rooftop.
  quiet = 0;
  // Counted by src/techniques/wagers.ts, read by the rooftop's score.
  wagersWon = 0;
  wagersLost = 0;

  constructor(private game: Game) { this.eyes = new Eyes(game); }

  get eye(): EyeId | null { return this.eyes.id; }

  resetPlayer(): void {
    this.hp = this.maxHp = 100;
    this.invuln = 0;
    this.quiet = 0;
    combatUi.hp.value = 1;
  }

  chromaAmount(): number {
    const low = 1 - this.hp / this.maxHp;
    return Math.max(0, low - 0.6) * 0.012 + (this.game.clock.frozen ? 0.004 : 0);
  }

  // A bare-hand blow (`melee`, src/combat/melee.ts) sets its own catch
  // (`stop`), may go through a field's reinforcement (`pierce`) and carry
  // extra posture damage to a boss (`poise`), letters its own word and
  // colour on a heavy hit, and trains no Technique.
  hitEnemy(e: Enemy, amount: number, opts: { from?: THREE.Vector3; knock?: number; lift?: number; kind?: 'kinetic' | 'cold' | 'pulse' | 'resonance' | 'cut' | 'heat' | 'shock'; heavy?: boolean; stagger?: boolean; melee?: MeleeWeight; stop?: number; pierce?: boolean; poise?: number; word?: string; color?: number } = {}): number {
    const g = this.game;
    // A Wager's harder strike, on the blows of the cast that declared it (src/techniques/wagers.ts).
    const wager = g.techniques.wagers.boost;
    let m = wager;
    // A body in the player's open field, or one whose guard a clash broke, takes more.
    m *= g.aura.damageOn(e, opts.pierce);
    if (e.guardBroken > 0) m *= 1 + AURA.guardBreak.taken;
    const eye = this.eyes.dealt(e);
    m *= eye.mult;
    const final = Math.round(amount * m);
    e.hurt(final, { from: opts.from, knock: opts.knock, lift: opts.lift, stagger: eye.stagger || opts.stagger, melee: opts.melee, poise: opts.poise });
    this.eyes.landed(e, final);
    g.drills.struck(e, final);
    this.quiet = 0;
    g.audio.hit(final, e.center());
    this.number(e.center(), String(final), wager > 1 ? '#ffd34d' : m > 1.1 ? '#ffb0ff' : '#f3eee4', final >= 40);
    // Hit-stop by the blow's weight: a jab catches for a frame or two, a
    // heavy blow holds long enough to see, and the heaviest holds an inked
    // impact frame as well. Light catches are spaced out so a flurry does
    // not stutter the whole fight.
    const w = Math.min(1, final / 100);
    const heavy = opts.heavy || final >= 40;
    if (heavy || opts.stop || g.clock.time - this.stopAt > 0.15) { g.clock.hitStop(opts.stop ?? (heavy ? 0.05 + 0.08 * w : 0.018 + 0.03 * w)); this.stopAt = g.clock.time; }
    if (heavy) {
      const color = opts.color ?? g.techniques.def.color;
      g.cam.shake(0.25 + 0.2 * w);
      g.renderer.impactFrame(final >= 80 ? 4 : 2, new THREE.Color(color), e.center());
      // A cutscene letters its own word over its blow.
      if (!g.cutscenes.active) this.letter(e.center().add(new THREE.Vector3(0, 0.9, 0)), opts.word ?? g.techniques.def.sfx, color, final >= 80);
    }
    else g.cam.shake(opts.melee ? 0.06 : 0.12);
    if (!opts.melee) g.mastery.gainPassive(g.techniqueId, 'output', 0.0015);
    if (e.isBoss) combatUi.boss.value = { name: e.def.title ?? e.def.name, frac: Math.max(0, e.hp / e.maxHp), color: e.def.emissive ?? 0xff6a1a };
    return final;
  }

  // Runs this player's defences on a blow and returns what got through.
  // Online the server owns health: a blow from another player (`pvp`) is
  // reported back by the caller, and health this player spends on itself goes
  // to the server here; the new value arrives through `setHp`.
  // A Maximum Output cutscene shields both people in it from everything but
  // its own blow (`cutscene`), for the cutscene's length and no longer.
  // A bare-hand blow from another player (`melee`) is too light to need the
  // moment of protection after a blow, and gives none, so a combo lands
  // whole; an aura strike (`pierce`) goes through this player's
  // reinforcement and breaks the guard of a settled field.
  hurtPlayer(amount: number, opts: { from?: THREE.Vector3; kinetic?: boolean; self?: boolean; pvp?: boolean; cutscene?: boolean; melee?: boolean; pierce?: boolean } = {}): number {
    const g = this.game;
    if (this.god) return 0;
    if (!opts.self && !opts.cutscene && ((this.invuln > 0 && !opts.melee) || g.cutscenes.locksPlayer)) return 0;
    let a = amount;
    if (!opts.self) a = g.techniques.def.effects.onStruck?.(g, a, opts.from ?? g.player.position) ?? a;
    if (g.aura.guardBroken > 0 && !opts.self) a *= 1 + AURA.guardBreak.taken;
    if (!opts.self && !opts.pierce) a *= g.aura.reinforce;
    if (a <= 0) return 0;
    if (opts.pierce && g.aura.reinforce < 1) g.aura.guardBroken = Math.max(g.aura.guardBroken, MELEE.aura.guard);
    // A blow taken before the player's own lands knocks it aside.
    if (!opts.self) g.melee.struck();
    this.quiet = 0;
    if (g.net) { if (!opts.pvp) g.net.selfDamage(a); }
    else { this.hp = Math.max(0, this.hp - a); combatUi.hp.value = this.hp / this.maxHp; }
    hud.hurt.value = Date.now();
    // The body takes the blow: it rocks away from it, and a physical one shoves it back a step.
    if (opts.from && !opts.self) {
      const away = g.player.position.clone().sub(opts.from).setY(0);
      g.avatar.impact(away, 0.4 + Math.min(1, a / 30) * 0.6);
      if (opts.kinetic) g.player.shove(away.normalize().multiplyScalar(Math.min(5, 1.5 + a / 8)));
    }
    g.cam.shake(Math.min(0.8, a / 30));
    // Taking a blow catches too, and a heavy one holds a frame in red ink.
    if (!opts.self && !opts.cutscene) {
      g.clock.hitStop(Math.min(0.09, 0.03 + a * 0.002));
      if (a >= 20 && opts.kinetic) g.renderer.impactFrame(2, new THREE.Color(0xd8342a), g.player.position.clone().add(new THREE.Vector3(0, 1.1, 0)));
    }
    g.cam.kick({ fov: -4, pitch: opts.from ? 0.02 : 0 });
    if (opts.self) g.audio.play('hurt.self'); else g.audio.play('hurt', { weight: Math.min(1, a / 40) });
    if (!opts.self) { if (!opts.melee) this.invuln = 0.35; g.techniques.struck(); g.techniques.charge = Math.min(1, g.techniques.charge + a / 220); }
    g.book.observe('lowHealthFraction', this.hp / this.maxHp < 0.35 ? 1 : 0);
    if (this.hp <= 0 && !g.net) this.defeat();
    return a;
  }

  // Online the server's word on this player's health. `tick` marks the
  // steady value in the room's snapshot, where a rise is the server's regen.
  setHp(hp: number, tick = false): void {
    const next = Math.max(0, Math.min(this.maxHp, hp));
    if (tick) combatUi.mending.value = next > this.hp && next < this.maxHp;
    this.hp = next;
    combatUi.hp.value = this.hp / this.maxHp;
  }

  // Out-of-combat regen, offline. The rooftop's waves have their own heal
  // between waves, and an encounter keeps its stakes, so neither regens.
  // Online the server runs the same rule (server/realtime.mjs).
  private regen(dt: number): void {
    const g = this.game;
    const R = RULES.regen;
    const me = g.player.position;
    const fighting = g.rooftop.active || g.encounters.fighting || g.cutscenes.active
      || g.encounters.enemies.some((e) => e.alive && e.def.ai !== 'dummy' && e.def.ai !== 'rival' && e.position.distanceTo(me) < R.clearRadius);
    this.quiet = fighting ? 0 : this.quiet + dt;
    const rate = R.perSecond * Math.min(1, Math.max(0, (this.quiet - R.quietSeconds) / R.rampSeconds));
    const mending = rate > 0 && this.hp > 0 && this.hp < this.maxHp;
    if (mending) { this.hp = Math.min(this.maxHp, this.hp + rate * dt); combatUi.hp.value = this.hp / this.maxHp; }
    if (combatUi.mending.value !== mending) combatUi.mending.value = mending;
  }

  private defeat(): void {
    const g = this.game;
    if (g.rooftop.active) { g.rooftop.lose(); return; }
    g.input.releaseLock();
    setState({ kind: 'defeat' });
  }

  installEye(id: EyeId, vault: TechniqueId | null = null): boolean { return this.eyes.install(id, vault); }

  number(pos: THREE.Vector3, text: string, color: string, big: boolean): void {
    this.nums.push({ id: ++this.numId, pos: pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.4, 0)), text, color, life: 0.9, big, word: false, tilt: 0 });
  }

  // A sound word over a hit, as a manga panel letters it: one at a time, so a
  // flurry of hits reads as one word and not a pile of them.
  letter(pos: THREE.Vector3, text: string, color: number, big: boolean): void {
    const now = this.game.clock.time;
    if (!big && now - this.lastWord < 0.45) return;
    this.lastWord = now;
    const css = '#' + new THREE.Color(color).getHexString();
    this.nums.push({ id: ++this.numId, pos: pos.clone(), text, color: css, life: big ? 1.1 : 0.7, big, word: true, tilt: (Math.random() - 0.5) * 22 });
  }

  update(dt: number): void {
    this.eyes.update(dt, this.game.clock.raw);
    this.invuln = Math.max(0, this.invuln - dt);
    if (!this.game.net) this.regen(dt);
    const cam = this.game.renderer.camera;
    const out: FloatText[] = [];
    for (let i = this.nums.length - 1; i >= 0; i--) {
      const n = this.nums[i]!;
      n.life -= dt;
      if (!n.word) n.pos.y += dt * 0.9;
      if (n.life <= 0) { this.nums.splice(i, 1); continue; }
      const v = n.pos.clone().project(cam);
      if (v.z > 1) continue;
      out.push({ id: n.id, x: (v.x * 0.5 + 0.5) * 100, y: (-v.y * 0.5 + 0.5) * 100, text: n.text, color: n.color, big: n.big, word: n.word, tilt: n.tilt });
    }
    if (out.length || combatUi.numbers.value.length) combatUi.numbers.value = out;
    const boss = this.game.encounters.enemies.find((e) => e.isBoss && e.alive);
    if (!boss && combatUi.boss.value) combatUi.boss.value = null;
  }
}
