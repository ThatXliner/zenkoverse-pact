import { signal } from '@preact/signals';
import type { Game } from '../app/game';
import { toast } from '../app/game';
import type { TechniqueKit } from './kit';

// What the HUD shows for the carried tool's key: null when the Technique in
// hand carries none. `cd` is the share of its cooldown still to wait; `off`
// says why it cannot be used here, if it cannot.
export const toolUi = signal<{ name: string; glyph: string; description: string; cd: number; off: string | null } | null>(null);

// Runs the Technique's carried tool (`TechniqueKit.tool`) on its own key: the
// gesture plays, the tool is used on its impact, and its own cooldown runs.
// It is not an Ability: no Pact, no resource, no mastery.
export class CarriedTool {
  private cd = 0;
  private pending: { t: number; at: number } | null = null;

  constructor(private game: Game) {}

  // A gesture still playing up to its impact: the hands are busy.
  get busy(): boolean { return this.pending !== null; }

  reset(): void { this.cd = 0; this.pending = null; }

  // `dt` is game time, which the gesture runs on; `live` the real time cooldowns run on.
  update(kit: TechniqueKit, dt: number, live: number): void {
    const tool = kit.tool;
    this.cd = Math.max(0, this.cd - live);
    const p = this.pending;
    if (p && tool && (p.t += dt) >= p.at) { this.pending = null; tool.use(this.game); }
    const next = tool ? { name: tool.name, glyph: tool.glyph, description: tool.description, cd: this.cd / tool.cooldown, off: tool.refuses?.(this.game) ?? null } : null;
    const cur = toolUi.value;
    if (!next ? cur !== null : !cur || cur.name !== next.name || cur.off !== next.off || Math.abs(cur.cd - next.cd) > 0.01 || (cur.cd > 0) !== (next.cd > 0)) toolUi.value = next;
  }

  use(kit: TechniqueKit): boolean {
    const g = this.game, tool = kit.tool;
    if (!tool || this.pending || this.cd > 0) return false;
    const off = tool.refuses?.(g);
    if (off) { toast(off, 'bad'); return false; }
    const gesture = kit.gestures[tool.gesture]!.long;
    g.hands.play(gesture, 1, () => undefined, (k) => g.cam.kick(k));
    g.avatar.perform(gesture, 1);
    g.net?.cast(tool.gesture, tool.name, 'long', 1);
    this.pending = { t: 0, at: gesture.impactAt };
    this.cd = tool.cooldown;
    return true;
  }
}
