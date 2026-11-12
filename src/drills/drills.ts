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
export interface DrillTier { name: string; count: number; interval: number; dropHeight: number; pass: number; gains: Partial<Record<MasteryStat, number>> }
export interface DrillDef {
  id: DrillId;
  technique: TechniqueId;
  title: string;
  jp: string;
  brief: string;
  position: [number, number, number];
  tiers: DrillTier[];
  spawn(game: Game, tier: DrillTier, index: number): PropInstance;
  judge(game: Game, prop: PropInstance, event: 'caught' | 'landed' | 'absorbed'): number;
}

export const drillUi = { active: signal<{ title: string; jp: string; tier: string; score: number; needed: number; left: number; best: number } | null>(null) };
const KEY = 'zenko.drills.v1';

export class Drills {
  private defs = new Map<DrillId, DrillDef>();
  private current: { def: DrillDef; tier: number; score: number; spawned: number; timer: number; live: PropInstance[]; resume: 'explore' | 'tutorial' } | null = null;
  progress: Record<string, number> = {};

  constructor(private game: Game) {
    try { this.progress = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, number>; } catch { /* fresh */ }
  }

  register(def: DrillDef): void { this.defs.set(def.id, def); }

  interactable(p: THREE.Vector3): { text: string; act: () => void } | null {
    if (this.current) return null;
    for (const d of this.defs.values()) {
      if (d.technique !== this.game.techniqueId) continue;
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
    drillUi.active.value = { title: c.def.title, jp: c.def.jp, tier: t.name, score: c.score, needed: t.pass, left: t.count - c.spawned + c.live.length, best: this.progress[c.def.id] ?? 0 };
  }

  // Kits call this when a Technique acts on a prop, so the drill can score it.
  notify(prop: PropInstance, event: 'caught' | 'absorbed'): void {
    const c = this.current;
    if (!c) return;
    const i = c.live.indexOf(prop);
    if (i < 0) return;
    c.live.splice(i, 1);
    const pts = c.def.judge(this.game, prop, event);
    c.score += pts;
    this.game.audio.play(pts > 0 ? 'confirmation_001' : 'error_004', 0.5);
    this.refresh();
  }

  update(dt: number): void {
    const c = this.current;
    if (!c) return;
    const t = c.def.tiers[c.tier]!;
    c.timer -= dt;
    if (c.spawned < t.count && c.timer <= 0) {
      const p = c.def.spawn(this.game, t, c.spawned);
      c.live.push(p);
      c.spawned++;
      c.timer = t.interval;
      this.game.audio.play('impactMetal_light_000', 0.3, 0.8);
    }
    for (let i = c.live.length - 1; i >= 0; i--) {
      const p = c.live[i]!;
      if (!p.alive) { c.live.splice(i, 1); continue; }
      if (p.body.translation().y < p.half.y + 0.08 && p.body.linvel().y > -0.5) {
        c.live.splice(i, 1);
        c.score += c.def.judge(this.game, p, 'landed');
        this.game.audio.play('impactWood_heavy_000', 0.5);
      }
    }
    this.refresh();
    if (c.spawned >= t.count && c.live.length === 0) this.finish();
  }

  private finish(): void {
    const c = this.current!;
    const t = c.def.tiers[c.tier]!;
    const g = this.game;
    const passed = c.score >= t.pass;
    if (passed) {
      for (const [stat, amt] of Object.entries(t.gains) as [MasteryStat, number][]) g.mastery.gain(c.def.technique, stat, amt);
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
