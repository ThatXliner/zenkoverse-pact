import * as THREE from 'three';
import { signal } from '@preact/signals';
import type { Game } from '../app/game';
import { hud, toast, banner } from '../app/game';
import { setState } from '../app/state';
import { KEY_SLOTS } from '../pacts/slots';
import type { Enemy } from './enemies';
import { AURA } from './field';

export type EyeId = 'horizon' | 'empty' | 'thread' | 'vault' | 'covenant';
export const EYES: Record<EyeId, { name: string; jp: string; color: number; text: string; locked?: boolean }> = {
  horizon: { name: 'Horizon Eye', jp: '地平', color: 0xffb347, text: 'Perceive reachable futures. Enemy wind-ups are shown before the blow arrives.' },
  empty: { name: 'Empty Eye', jp: '空', color: 0xb7c3d6, text: 'Perceive absence and concealment. Veiled enemies are revealed and take more from you.' },
  thread: { name: 'Thread Eye', jp: '糸', color: 0xff5fa2, text: 'Perceive dependencies. Damage to an anchor travels down every thread.' },
  vault: { name: 'Vault Eye', jp: '庫', color: 0x8affd6, text: 'House one transferred foreign Technique, never a copy.' },
  covenant: { name: 'Covenant Eye', jp: '盟', color: 0xe9e3ff, text: 'A universe-enforced binding vow between multiple willing people. You are fighting alone tonight.', locked: true },
};

export const combatUi = {
  hp: signal(1),
  wagerArmed: signal(false),
  eye: signal<EyeId | null>(null),
  boss: signal<{ name: string; frac: number; color: number } | null>(null),
  numbers: signal<{ id: number; x: number; y: number; text: string; color: string; big: boolean }[]>([]),
};

interface FloatNum { id: number; pos: THREE.Vector3; text: string; color: string; life: number; big: boolean }

// Player vitals, damage exchange, Wagers, Maximum Output charge, Eyes, and
// the feel layer on big hits: hit-stop, impact frames, shake, chroma.
export class Combat {
  hp = 100;
  maxHp = 100;
  god = false;
  wagerArmed = false;
  private wagerCd = 0;
  private wagerSlot: string | null = null;
  invuln = 0;
  flags = { overextension: false, bloodDraw: false };
  eye: EyeId | null = null;
  private nums: FloatNum[] = [];
  private numId = 0;
  wagersWon = 0;
  wagersLost = 0;

  constructor(private game: Game) {}

  resetPlayer(): void {
    this.hp = this.maxHp = 100;
    this.wagerArmed = false;
    this.invuln = 0;
    combatUi.hp.value = 1;
    combatUi.wagerArmed.value = false;
  }

  chromaAmount(): number {
    const low = 1 - this.hp / this.maxHp;
    return Math.max(0, low - 0.6) * 0.012 + (this.game.clock.frozen ? 0.004 : 0);
  }

  armWager(): void {
    if (this.wagerArmed || this.wagerCd > 0 || this.game.techniques.sealed > 0 || this.game.techniques.signing) return;
    const pact = KEY_SLOTS.map((s) => this.game.book.bound(s)).find((p) => p?.clauses.some((c) => c.kind === 'wager'));
    this.wagerArmed = true;
    combatUi.wagerArmed.value = true;
    this.game.audio.play('question_002', 0.5);
    toast(pact ? `Wager declared: ${pact.name} will connect` : 'Wager declared: the next strike connects', 'info');
    this.game.tutorial.notify('wager');
  }

  wagerCommitted(slot: string): void { this.wagerSlot = slot; this.wagerArmed = false; combatUi.wagerArmed.value = false; this.wagerCd = 4; }

  resolveWager(hit: boolean): void {
    this.wagerSlot = null;
    if (hit) { this.wagersWon++; banner('的中', 'Wager won. The universe pays out.'); this.game.audio.play('confirmation_002', 0.7); this.game.techniques.charge = Math.min(1, this.game.techniques.charge + 0.35); }
    else { this.wagersLost++; banner('外れ', 'Wager lost. Your Technique seals.'); this.game.audio.play('glitch_001', 0.7); this.game.techniques.seal(4); }
  }

  get wagerMultiplier(): number { return this.wagerSlot ? 3 : 1; }

  hitEnemy(e: Enemy, amount: number, opts: { from?: THREE.Vector3; knock?: number; lift?: number; kind?: 'kinetic' | 'cold' | 'pulse' | 'resonance' | 'cut'; heavy?: boolean; stagger?: boolean } = {}): number {
    const g = this.game;
    let m = this.wagerMultiplier;
    // A body in the player's open field, or one whose guard a clash broke, takes more.
    m *= g.aura.damageOn(e.position);
    if (e.guardBroken > 0) m *= 1 + AURA.guardBreak.taken;
    if (this.eye === 'empty') m *= 1.2;
    const final = Math.round(amount * m);
    if (this.eye === 'thread') this.threadSplash(e, final * 0.35);
    e.hurt(final, { from: opts.from, knock: opts.knock, lift: opts.lift, stagger: opts.stagger });
    this.number(e.center(), String(final), this.wagerSlot ? '#ffd34d' : m > 1.1 ? '#ffb0ff' : '#f3eee4', final >= 40);
    if (opts.heavy || final >= 40) { g.clock.hitStop(final >= 80 ? 0.11 : 0.06); g.cam.shake(0.35); g.renderer.impactFrame(final >= 80 ? 3 : 1, new THREE.Color(g.techniques.def.color)); }
    else g.cam.shake(0.12);
    g.mastery.gain(g.techniqueId, 'output', 0.0015);
    if (e.isBoss) combatUi.boss.value = { name: e.def.title ?? e.def.name, frac: Math.max(0, e.hp / e.maxHp), color: e.def.emissive ?? 0xff6a1a };
    return final;
  }

  // Runs this player's defences on a blow and returns what got through.
  // Online the server owns health: a blow from another player (`pvp`) is
  // reported back by the caller, and health this player spends on itself goes
  // to the server here; the new value arrives through `setHp`.
  hurtPlayer(amount: number, opts: { from?: THREE.Vector3; kinetic?: boolean; self?: boolean; pvp?: boolean } = {}): number {
    const g = this.game;
    if (this.god || (this.invuln > 0 && !opts.self)) return 0;
    let a = amount;
    if (!opts.self) a = g.techniques.def.effects.onStruck?.(g, a, opts.from ?? g.player.position) ?? a;
    if (this.eye === 'horizon' && !opts.self) a *= 0.7;
    if (g.aura.guardBroken > 0 && !opts.self) a *= 1 + AURA.guardBreak.taken;
    if (a <= 0) return 0;
    if (g.net) { if (!opts.pvp) g.net.selfDamage(a); }
    else { this.hp = Math.max(0, this.hp - a); combatUi.hp.value = this.hp / this.maxHp; }
    hud.hurt.value = Date.now();
    g.cam.shake(Math.min(0.8, a / 30));
    g.cam.kick({ fov: -4, pitch: opts.from ? 0.02 : 0 });
    g.audio.play(opts.self ? 'impactSoft_heavy_000' : 'impactPunch_heavy_000', 0.6, 1);
    if (!opts.self) { this.invuln = 0.35; g.techniques.struck(); g.techniques.charge = Math.min(1, g.techniques.charge + a / 220); }
    g.book.observe('lowHealthFraction', this.hp / this.maxHp < 0.35 ? 1 : 0);
    if (this.hp <= 0 && !g.net) this.defeat();
    return a;
  }

  setHp(hp: number): void {
    this.hp = Math.max(0, Math.min(this.maxHp, hp));
    combatUi.hp.value = this.hp / this.maxHp;
  }

  // Thread Eye: damage to one body travels down the thread to its nearest neighbour.
  private threadSplash(from: Enemy, amount: number): void {
    const other = this.game.targets().filter((o) => o !== from && o.alive && o.def.ai !== 'dummy' && o.position.distanceTo(from.position) < 7)
      .sort((a, b) => a.position.distanceTo(from.position) - b.position.distanceTo(from.position))[0];
    if (!other) return;
    other.hurt(Math.round(amount), { from: from.position, stagger: false });
    this.game.vfx.trail([from.center(), other.center()], EYES.thread.color, 0.08, 0.25);
  }

  private defeat(): void {
    const g = this.game;
    if (g.rooftop.active) { g.rooftop.lose(); return; }
    g.input.releaseLock();
    g.audio.play('lowDown', 0.8, 0.6);
    setState({ kind: 'defeat' });
  }

  installEye(id: EyeId): void {
    if (EYES[id].locked) return;
    this.eye = id;
    combatUi.eye.value = id;
    banner(EYES[id].jp, `${EYES[id].name} installed. A natural eye is gone for good.`);
  }

  number(pos: THREE.Vector3, text: string, color: string, big: boolean): void {
    this.nums.push({ id: ++this.numId, pos: pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.4, 0)), text, color, life: 0.9, big });
  }

  update(dt: number): void {
    this.invuln = Math.max(0, this.invuln - dt);
    this.wagerCd = Math.max(0, this.wagerCd - dt);
    const cam = this.game.renderer.camera;
    const out: { id: number; x: number; y: number; text: string; color: string; big: boolean }[] = [];
    for (let i = this.nums.length - 1; i >= 0; i--) {
      const n = this.nums[i]!;
      n.life -= dt;
      n.pos.y += dt * 0.9;
      if (n.life <= 0) { this.nums.splice(i, 1); continue; }
      const v = n.pos.clone().project(cam);
      if (v.z > 1) continue;
      out.push({ id: n.id, x: (v.x * 0.5 + 0.5) * 100, y: (-v.y * 0.5 + 0.5) * 100, text: n.text, color: n.color, big: n.big });
    }
    if (out.length || combatUi.numbers.value.length) combatUi.numbers.value = out;
    const boss = this.game.encounters.enemies.find((e) => e.isBoss && e.alive);
    if (!boss && combatUi.boss.value) combatUi.boss.value = null;
  }
}
