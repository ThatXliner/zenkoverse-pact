import * as THREE from 'three';
import { signal } from '@preact/signals';
import type { Game } from '../app/game';
import { setState, appState, type DrillId } from '../app/state';
import { toast, banner } from '../app/game';
import type { TechniqueId } from '../pacts/schema';
import type { MasteryStat } from '../mastery/mastery';
import type { PropInstance } from '../world/props';

// A drill is data: where it lives, what it trains, and its tiers. Tiers are
// skill gates (issue #17): the next unlocks when the current is executed.
// A drill hands out items at a rhythm (a crate to catch, a tell to answer),
// and each item scores once when it is decided.
export interface DrillTier { name: string; count: number; interval: number; pass: number; gains: Partial<Record<MasteryStat, number>>; dropHeight?: number; window?: number }
export interface DrillItem {
  // Points once the item is decided, null while it is still live.
  update(dt: number): number | null;
  // A Technique acted on a prop: the item's points, or null when it is not about this item.
  notify?(prop: PropInstance, event: 'caught' | 'absorbed'): number | null;
  // Anything the item drew, for when the drill ends early.
  dispose?(): void;
}
export interface DrillDef {
  id: DrillId;
  // The Technique it trains, or null for one any Technique can run (aura).
  technique: TechniqueId | null;
  title: string;
  jp: string;
  brief: string;
  // A line under the score while the drill runs, if the drill has one.
  cue?: () => string;
  position: [number, number, number];
  tiers: DrillTier[];
  spawn(game: Game, tier: DrillTier, index: number): DrillItem;
  // Called every frame the drill runs, before its items.
  hold?(game: Game): void;
  // Called when the drill ends, passed or not, to put away what it drew.
  end?(game: Game): void;
}

export const drillUi = { active: signal<{ title: string; jp: string; tier: string; score: number; needed: number; left: number; best: number; cue: string } | null>(null) };
const KEY = 'zenko.drills.v1';

export class Drills {
  private defs = new Map<DrillId, DrillDef>();
  private current: { def: DrillDef; tier: number; score: number; spawned: number; timer: number; live: DrillItem[]; resume: 'explore' | 'tutorial' } | null = null;
  progress: Record<string, number> = {};

  constructor(private game: Game) {
    try { this.progress = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, number>; } catch { /* fresh */ }
  }

  register(def: DrillDef): void { this.defs.set(def.id, def); }

  get running(): DrillId | null { return this.current?.def.id ?? null; }

  // The Technique a drill's gains go to: its own, or the one in hand.
  private trains(def: DrillDef): TechniqueId { return def.technique ?? this.game.techniqueId; }

  interactable(p: THREE.Vector3): { text: string; act: () => void } | null {
    if (this.current) return null;
    for (const d of this.defs.values()) {
      if (d.technique && d.technique !== this.game.techniqueId) continue;
      const pos = new THREE.Vector3(...d.position);
      if (pos.distanceTo(p) < 3) {
        const tier = Math.min(this.progress[d.id] ?? 0, d.tiers.length - 1);
        return { text: `Begin drill: ${d.title} (${d.tiers[tier]!.name})`, act: () => this.begin(d.id) };
      }
    }
    return null;
  }

  begin(id: DrillId): void {
    const def = this.defs.get(id);
    if (!def || this.current) return;
    const tier = Math.min(this.progress[id] ?? 0, def.tiers.length - 1);
    const st = appState.value;
    this.current = { def, tier, score: 0, spawned: 0, timer: 1.2, live: [], resume: st.kind === 'tutorial' ? 'tutorial' : 'explore' };
    setState({ kind: 'drill', id });
    banner(def.jp, def.title);
    toast(def.brief);
    this.refresh();
  }

  private refresh(): void {
    const c = this.current;
    if (!c) { drillUi.active.value = null; return; }
    const t = c.def.tiers[c.tier]!;
    drillUi.active.value = { title: c.def.title, jp: c.def.jp, tier: t.name, score: c.score, needed: t.pass, left: t.count - c.spawned + c.live.length, best: this.progress[c.def.id] ?? 0, cue: c.def.cue?.() ?? '' };
  }

  // Kits call this when a Technique acts on a prop, so the drill can score it.
  notify(prop: PropInstance, event: 'caught' | 'absorbed'): void {
    const c = this.current;
    if (!c) return;
    for (let i = 0; i < c.live.length; i++) {
      const pts = c.live[i]!.notify?.(prop, event);
      if (pts === null || pts === undefined) continue;
      c.live.splice(i, 1);
      this.score(pts);
      return;
    }
  }

  private score(pts: number): void {
    this.current!.score += pts;
    this.game.audio.play(pts > 0 ? 'confirmation_001' : 'error_004', 0.5);
    this.refresh();
  }

  update(dt: number): void {
    const c = this.current;
    if (!c) return;
    const t = c.def.tiers[c.tier]!;
    c.def.hold?.(this.game);
    c.timer -= dt;
    if (c.spawned < t.count && c.timer <= 0) {
      c.live.push(c.def.spawn(this.game, t, c.spawned));
      c.spawned++;
      c.timer = t.interval;
    }
    for (let i = c.live.length - 1; i >= 0; i--) {
      const pts = c.live[i]!.update(dt);
      if (pts === null) continue;
      c.live.splice(i, 1);
      this.score(pts);
    }
    this.refresh();
    if (c.spawned >= t.count && c.live.length === 0) this.finish();
  }

  // Ends a drill without judging it, for a new scene.
  abandon(): void {
    const c = this.current;
    if (!c) return;
    for (const item of c.live) item.dispose?.();
    c.def.end?.(this.game);
    this.current = null;
    drillUi.active.value = null;
  }

  private finish(): void {
    const c = this.current!;
    const t = c.def.tiers[c.tier]!;
    const g = this.game;
    const passed = c.score >= t.pass;
    c.def.end?.(g);
    if (passed) {
      for (const [stat, amt] of Object.entries(t.gains) as [MasteryStat, number][]) g.mastery.gain(this.trains(c.def), stat, amt);
      g.mastery.addStrain(0.12);
      if (c.tier === (this.progress[c.def.id] ?? 0) && c.tier < c.def.tiers.length - 1) this.progress[c.def.id] = c.tier + 1;
      banner('合格', `${t.name} cleared. Mastery grows.`);
      g.audio.play('powerUp9', 0.6);
    } else {
      banner('未熟', `${c.score} of ${t.pass}. Again.`);
      g.audio.play('lowDown', 0.5);
    }
    try { localStorage.setItem(KEY, JSON.stringify(this.progress)); } catch { /* */ }
    this.current = null;
    drillUi.active.value = null;
    setState({ kind: c.resume === 'tutorial' ? 'tutorial' : 'explore', ...(c.resume === 'tutorial' ? { step: g.tutorial.stepId } : {}) } as never);
  }
}
