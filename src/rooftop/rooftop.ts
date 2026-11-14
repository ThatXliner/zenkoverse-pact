import * as THREE from 'three';
import { signal } from '@preact/signals';
import type { Game } from '../app/game';
import { toast, banner } from '../app/game';
import { appState, setState } from '../app/state';
import { combatUi, EYES, type EyeId } from '../combat/combat';
import type { Enemy } from '../combat/enemies';
import type { Pact } from '../pacts/schema';
import { buildArena, type Arena } from './arena';
import { pickOffers, type Offer } from './offers';
import { slotWords } from '../pacts/readback';
import { keyLabel } from '../app/keymap';
import { WAVES, WAVE_COUNT, SPAWN_GAP, HEAL_BETWEEN, EYE_AFTER, SCORE, CLEAR_BONUS, WAGER_BONUS, VICTORY_BONUS, roster, scaleFor } from './waves';

// The rooftop trial: the classic arena loop (issue #34) on the hall's roof.
// One run is a small state machine. `fight` spawns a wave and waits for it to
// clear; `offer` holds the world still while the player takes an Eye and a
// Pact; `over` is the end screen. Aura works on the roof as it does
// everywhere, from the first wave.

type OfferStep = { kind: 'eye' } | { kind: 'pact'; offers: Offer[] };

type Phase =
  | { kind: 'idle' }
  | { kind: 'fight'; wave: number; queue: string[]; spawnT: number; clearT: number }
  | { kind: 'offer'; wave: number; steps: OfferStep[] }
  | { kind: 'over'; victory: boolean };

export interface RunResult {
  victory: boolean;
  score: number;
  wavesCleared: number;
  kills: number;
  pacts: { name: string; text: string }[];
  wagersWon: number;
  wagersLost: number;
  eye: EyeId | null;
  best: number;
  newBest: boolean;
  seconds: number;
}

export const rooftopUi = {
  run: signal<{ wave: number; total: number; title: string; jp: string; left: number; score: number } | null>(null),
  offer: signal<OfferStep | null>(null),
  result: signal<RunResult | null>(null),
};

const BEST_KEY = 'zenko.rooftop.best.v1';
const BACKUP_KEY = 'zenko.rooftop.book-backup.v1';
const FIRST_SPAWN = 1.7;
const CLEAR_HOLD = 1.1;

function readBest(): number {
  try { return Number(JSON.parse(localStorage.getItem(BEST_KEY) ?? '{}').score) || 0; } catch { return 0; }
}

export class Rooftop {
  readonly arena: Arena;
  private phase: Phase = { kind: 'idle' };
  private tracked: Enemy[] = [];
  private score = 0;
  private kills = 0;
  private cleared = 0;
  private taken: { pact: Pact; text: string }[] = [];
  private takenIds = new Set<string>();
  private eyeTaken: EyeId | null = null;
  private startedAt = 0;
  private wagers0 = { won: 0, lost: 0 };
  private winding = new WeakSet<Enemy>();
  private ending: boolean | null = null;
  private counted = new WeakSet<Enemy>();

  constructor(private game: Game) {
    this.arena = buildArena(game.world, game.physics, game.renderer.scene, game.props, game.renderer.lights);
    // A run that was closed mid-way left its Pacts in the saved book. Put the real ones back.
    this.restorePlayer();
  }

  get active(): boolean { return this.phase.kind === 'fight' || this.phase.kind === 'offer'; }
  // Seconds between any two enemy wind-ups on the roof: the crowd takes turns.
  get attackGap(): number { return this.phase.kind !== 'fight' ? 0 : this.phase.wave === 0 ? 1.5 : this.phase.wave < 3 ? 1.0 : this.phase.wave < 6 ? 0.8 : 0.6; }
  get stage(): string { return this.phase.kind; }
  get wave(): number { return 'wave' in this.phase ? this.phase.wave + 1 : 0; }
  get offers(): Offer[] { const o = rooftopUi.offer.value; return o?.kind === 'pact' ? o.offers : []; }
  get alive(): number { return this.tracked.filter((e) => e.alive).length; }

  // The stair is walked; the board at its top starts the trial.
  interactable(p: THREE.Vector3): { text: string; act: () => void } | null {
    const a = this.arena;
    if (this.active || appState.value.kind === 'rooftop-end') return null;
    if (Math.abs(p.y - a.deckY) < 1.5 && p.distanceTo(a.consoleAt) < 2.4) return { text: 'Begin the Rooftop trial, eight waves', act: () => this.begin() };
    return null;
  }

  // Puts the player at the top or the foot of the stair: how a run ends, and
  // the debug hook's shortcut.
  climbUp(): void {
    const g = this.game;
    g.player.teleport(this.arena.stairTop.clone());
    g.cam.yaw = Math.PI / 2;
    banner('屋上', 'The hall roof. The board by the stair starts the trial.');
  }

  climbDown(): void {
    const g = this.game;
    g.player.teleport(this.arena.stairFoot.clone());
    g.cam.yaw = 0;
  }

  begin(): void {
    const g = this.game;
    this.ending = null;
    this.clearWorld();
    this.restorePlayer();
    try { localStorage.setItem(BACKUP_KEY, g.book.export()); } catch { /* storage unavailable */ }
    g.tutorial.skip();
    g.setTechnique(g.techniqueId);
    g.combat.resetPlayer();
    g.techniques.charge = Math.max(g.techniques.charge, 0.4);
    this.score = 0; this.kills = 0; this.cleared = 0;
    this.taken = []; this.takenIds.clear();
    this.eyeTaken = null;
    this.startedAt = performance.now();
    this.wagers0 = { won: g.combat.wagersWon, lost: g.combat.wagersLost };
    rooftopUi.result.value = null;
    rooftopUi.offer.value = null;
    g.player.teleport(this.arena.start.clone());
    g.cam.yaw = -Math.PI / 2;
    g.cam.pitch = 0;
    setState({ kind: 'rooftop' });
    this.startWave(0);
    g.requestLock();
    g.audio.resumeContext();
  }

  private startWave(i: number): void {
    const w = WAVES[i]!;
    this.phase = { kind: 'fight', wave: i, queue: shuffleBossFirst(roster(i)), spawnT: FIRST_SPAWN, clearT: 0 };
    banner(w.jp, `Wave ${i + 1} of ${WAVE_COUNT} · ${w.title}`);
    this.game.audio.play('bong_001', 0.6, 0.9);
    this.publish();
  }

  private publish(): void {
    const p = this.phase;
    if (p.kind === 'idle') { rooftopUi.run.value = null; return; }
    const wave = 'wave' in p ? p.wave : this.cleared - 1;
    const w = WAVES[Math.max(0, wave)]!;
    const left = p.kind === 'fight' ? p.queue.length + this.alive : 0;
    const cur = rooftopUi.run.value;
    if (cur && cur.wave === wave + 1 && cur.left === left && cur.score === this.score) return;
    rooftopUi.run.value = { wave: wave + 1, total: WAVE_COUNT, title: w.title, jp: w.jp, left, score: this.score };
  }

  update(dt: number): void {
    const g = this.game;
    this.arena.update(g.clock.time);
    if (this.ending !== null) { const victory = this.ending; this.ending = null; this.finish(victory); return; }
    const p = this.phase;
    if (p.kind !== 'fight' || dt <= 0) return;

    p.spawnT -= dt;
    if (p.queue.length && p.spawnT <= 0) { this.spawnOne(p.wave, p.queue.shift()!); p.spawnT = WAVES[p.wave]!.gap ?? SPAWN_GAP; }

    for (const e of this.tracked) if (!e.alive && !this.counted.has(e)) this.credit(e);
    this.telegraph();

    if (!p.queue.length && this.alive === 0 && !g.cutscenes.active) {
      p.clearT += dt;
      if (p.clearT >= CLEAR_HOLD) this.waveCleared(p.wave);
    } else p.clearT = 0;
    this.publish();
  }

  private credit(e: Enemy): void {
    this.counted.add(e);
    this.kills++;
    this.score += SCORE[e.key] ?? 10;
  }

  private spawnOne(wave: number, key: string): void {
    const g = this.game;
    const at = this.pickSlot();
    const e = g.encounters.spawn(key, at, scaleFor(wave, key), true);
    e.state = 'chase';
    this.tracked.push(e);
    const boss = key === 'kuroda' || key === 'ancient';
    g.vfx.ring(at.clone().add(new THREE.Vector3(0, 0.08, 0)), boss ? (e.def.emissive ?? 0xff6a1a) : 0xffb36b, 0.3, boss ? 5 : 2.4, 0.5);
    g.vfx.burst(at.clone().add(new THREE.Vector3(0, 0.2, 0)), boss ? 24 : 8, 'spark', boss ? 7 : 4, 0xffb36b);
    g.audio.play('impactMetal_heavy_000', boss ? 0.7 : 0.35, boss ? 0.6 : 1.1);
    if (boss) {
      banner(e.def.title ?? e.def.name, key === 'ancient' ? 'Ancient. Not assumed to know expansion. She does.' : 'The Kuroda do not control fire. They control what burns.');
      g.vfx.flash(at.clone().add(new THREE.Vector3(0, 1.4, 0)), e.def.emissive ?? 0xff6a1a, 90, 0.5, 20);
    }
  }

  // A hatch far from the player and from the bodies already out.
  private pickSlot(): THREE.Vector3 {
    const g = this.game;
    const alive = this.tracked.filter((e) => e.alive);
    let best = this.arena.slots[0]!, bestScore = -Infinity;
    for (const s of this.arena.slots) {
      const toPlayer = s.distanceTo(g.player.position);
      const crowd = alive.reduce((m, e) => Math.min(m, e.position.distanceTo(s)), 99);
      const score = Math.min(toPlayer, 16) + Math.min(crowd, 4) * 1.5 + Math.random() * 3;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    return best.clone();
  }

  // A ring at the foot of whoever starts a wind-up. The Horizon Eye draws it
  // wider and holds it longer, so a crowd's blows can be read before they land.
  private telegraph(): void {
    const horizon = this.game.combat.eye === 'horizon';
    for (const e of this.tracked) {
      const winding = e.alive && (e.state === 'windup' || e.state === 'cast');
      if (winding && !this.winding.has(e)) {
        this.winding.add(e);
        const reach = e.def.ai === 'ancient' ? 9 : horizon ? 2.8 : 1.9;
        this.game.vfx.ring(e.position.clone().add(new THREE.Vector3(0, 0.08, 0)), horizon ? EYES.horizon.color : 0xff5a4a, 0.5, reach, horizon ? 0.6 : 0.35);
      } else if (!winding) this.winding.delete(e);
    }
  }

  private waveCleared(wave: number): void {
    const g = this.game;
    this.cleared = wave + 1;
    this.score += CLEAR_BONUS * (wave + 1);
    this.tracked = [];
    g.combat.hp = Math.min(g.combat.maxHp, g.combat.hp + g.combat.maxHp * HEAL_BETWEEN);
    combatUi.hp.value = g.combat.hp / g.combat.maxHp;
    g.techniques.sealed = 0;
    g.combat.wagerArmed = false;
    combatUi.wagerArmed.value = false;
    g.audio.play('confirmation_002', 0.7);
    if (wave + 1 >= WAVE_COUNT) { this.finish(true); return; }
    const steps: OfferStep[] = [];
    if (wave + 1 === EYE_AFTER) steps.push({ kind: 'eye' });
    steps.push({ kind: 'pact', offers: pickOffers(g, this.takenIds) });
    this.phase = { kind: 'offer', wave, steps };
    this.publish();
    this.showStep();
    setState({ kind: 'rooftop-offer' });
    g.input.releaseLock();
  }

  private showStep(): void {
    const p = this.phase;
    rooftopUi.offer.value = p.kind === 'offer' ? p.steps[0] ?? null : null;
  }

  private advance(): void {
    const p = this.phase;
    if (p.kind !== 'offer') return;
    p.steps.shift();
    if (p.steps.length) { this.showStep(); return; }
    rooftopUi.offer.value = null;
    setState({ kind: 'rooftop' });
    this.startWave(p.wave + 1);
    this.game.requestLock();
  }

  chooseEye(id: EyeId): void {
    if (rooftopUi.offer.value?.kind !== 'eye' || EYES[id].locked) return;
    this.game.combat.installEye(id);
    this.eyeTaken = id;
    this.advance();
  }

  // Inscribing binds the Pact to its key, so it is in force when the next wave opens.
  choose(index: number): void {
    const step = rooftopUi.offer.value;
    const offer = step?.kind === 'pact' ? step.offers[index] : undefined;
    if (!offer) return;
    const g = this.game;
    const kit = g.techniques.def;
    const v = g.book.inscribe(offer.pact, kit.shapes);
    if (!v.ok) { toast(`The universe refused: ${v.errors[0]}`, 'bad'); return; }
    this.taken.push({ pact: offer.pact, text: offer.text });
    this.takenIds.add(offer.pact.id);
    g.audio.play('select_001', 0.6);
    toast(`"${offer.pact.name}" is inscribed on ${slotWords(offer.pact.slot)}.`, 'good');
    this.advance();
  }

  skipPact(): void {
    if (rooftopUi.offer.value?.kind === 'pact') this.advance();
  }

  private finish(victory: boolean): void {
    const g = this.game;
    this.score += victory ? VICTORY_BONUS : 0;
    const wagersWon = g.combat.wagersWon - this.wagers0.won;
    const wagersLost = g.combat.wagersLost - this.wagers0.lost;
    this.score += WAGER_BONUS * wagersWon;
    const prior = readBest();
    const newBest = this.score > prior;
    if (newBest) { try { localStorage.setItem(BEST_KEY, JSON.stringify({ score: this.score, waves: this.cleared, technique: g.techniqueId })); } catch { /* storage unavailable */ } }
    rooftopUi.result.value = {
      victory, score: this.score, wavesCleared: this.cleared, kills: this.kills,
      pacts: this.taken.map((t) => ({ name: t.pact.name, text: t.text })),
      wagersWon, wagersLost, eye: this.eyeTaken, best: Math.max(prior, this.score), newBest,
      seconds: Math.round((performance.now() - this.startedAt) / 1000),
    };
    this.phase = { kind: 'over', victory };
    rooftopUi.run.value = null;
    rooftopUi.offer.value = null;
    this.clearWorld();
    this.restorePlayer();
    g.input.releaseLock();
    g.audio.play(victory ? 'confirmation_002' : 'lowDown', 0.8, victory ? 1 : 0.6);
    setState({ kind: 'rooftop-end' });
  }

  // Defeat arrives from inside an enemy's update, which still has to touch
  // its body, so the run ends at the top of the next update.
  lose(): void { if (this.active && this.ending === null) this.ending = false; }

  // Leaves a run that is still going: nothing is scored, nothing is kept.
  abandon(): void {
    if (!this.active) return;
    this.phase = { kind: 'idle' };
    rooftopUi.run.value = null;
    rooftopUi.offer.value = null;
    this.clearWorld();
    this.restorePlayer();
    this.game.combat.resetPlayer();
    this.climbDown();
    setState({ kind: 'explore' });
    this.game.requestLock();
  }

  // From the end screen back to the street, or out to the title.
  leave(to: 'street' | 'title'): void {
    this.phase = { kind: 'idle' };
    rooftopUi.result.value = null;
    this.game.combat.resetPlayer();
    this.climbDown();
    if (to === 'title') { setState({ kind: 'title' }); return; }
    setState({ kind: 'explore' });
    this.game.requestLock();
  }

  // The trial is its own scene: it starts, and ends, with nothing left over.
  private clearWorld(): void {
    this.game.endScene();
    this.tracked = [];
  }

  // What the trial gave stays on the rooftop: the real Pacts come back, and so does the natural eye.
  private restorePlayer(): void {
    const g = this.game;
    g.combat.eye = null;
    combatUi.eye.value = null;
    try {
      const backup = localStorage.getItem(BACKUP_KEY);
      if (backup) { g.book.import(backup); localStorage.removeItem(BACKUP_KEY); }
    } catch { /* storage unavailable */ }
  }

  // Debug helper: every enemy of the current wave falls at once.
  clearWave(): void {
    const p = this.phase;
    if (p.kind !== 'fight') return;
    p.queue.length = 0;
    for (const e of this.tracked) if (e.alive) e.hurt(1e9, { stagger: false });
  }
}

function shuffleBossFirst(list: string[]): string[] {
  const a = list.map((k) => ({ k, r: Math.random() })).sort((x, y) => x.r - y.r).map((x) => x.k);
  return [...a.filter((k) => k === 'kuroda' || k === 'ancient'), ...a.filter((k) => k !== 'kuroda' && k !== 'ancient')];
}
