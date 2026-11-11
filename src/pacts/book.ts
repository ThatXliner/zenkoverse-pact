import { signal } from '@preact/signals';
import { type Pact, type AbilitySlot, type TechniqueId, validatePact } from './schema';
import { estimateResolve, DEFAULT_TELEMETRY, type Telemetry, type ResolveEstimate } from './resolve';

const KEY = 'zenko.pacts.v2';

interface Saved { inscribed: Pact[]; drafts: Pact[]; telemetry: Telemetry; encounters: number }

// The player's Pacts: inscribed (permanent), drafts, and the telemetry that
// Resolve is judged against. Techniques read `bound(slot)` to find the Pact
// that currently defines an Ability key.
export class PactBook {
  readonly inscribed = signal<Pact[]>([]);
  readonly drafts = signal<Pact[]>([]);
  telemetry: Telemetry = { ...DEFAULT_TELEMETRY };
  technique: TechniqueId = 'recoil';
  encounters = 0;
  private catalogue = new Map<TechniqueId, Pact[]>();

  constructor() { this.load(); }

  registerCatalogue(id: TechniqueId, pacts: Pact[]): void {
    this.catalogue.set(id, pacts);
    this.seedDrafts();
  }

  setTechnique(id: TechniqueId): void { this.technique = id; this.seedDrafts(); }

  private seedDrafts(): void {
    const cat = this.catalogue.get(this.technique) ?? [];
    const have = new Set([...this.drafts.value, ...this.inscribed.value].map((p) => p.id));
    const add = cat.filter((p) => !have.has(p.id)).map((p) => structuredClone(p));
    if (add.length) this.drafts.value = [...this.drafts.value, ...add];
  }

  forTechnique(list: Pact[]): Pact[] { return list.filter((p) => p.technique === this.technique); }

  bound(slot: AbilitySlot): Pact | null {
    const list = this.inscribed.value.filter((p) => p.technique === this.technique && p.slot === slot && !this.expired(p));
    const preferred = list.find((p) => p.clauses.some((c) => c.kind === 'program' && c.then === 'prefer'));
    return preferred ?? list[list.length - 1] ?? null;
  }

  expired(p: Pact): boolean {
    const s = p.clauses.find((c) => c.kind === 'sunset');
    if (!s || s.kind !== 'sunset' || p.inscribedAt === undefined) return false;
    if ('encounters' in s.term) return this.encounters - p.inscribedAt >= s.term.encounters;
    return false;
  }

  estimate(p: Pact): ResolveEstimate { return estimateResolve(p, this.inscribed.value, this.telemetry); }

  saveDraft(p: Pact): void {
    const rest = this.drafts.value.filter((d) => d.id !== p.id);
    this.drafts.value = [...rest, p];
    this.persist();
  }

  deleteDraft(id: string): void { this.drafts.value = this.drafts.value.filter((d) => d.id !== id); this.persist(); }

  inscribe(p: Pact, shapes: readonly string[]): { ok: boolean; errors: string[] } {
    const v = validatePact(p, shapes);
    if (!v.ok) return v;
    const sealed: Pact = { ...structuredClone(p), inscribed: true, inscribedAt: this.encounters };
    const replaced = this.inscribed.value.filter((q) => !(q.technique === sealed.technique && q.slot === sealed.slot && sealed.slot !== 'passive'));
    this.inscribed.value = [...replaced, sealed];
    this.drafts.value = this.drafts.value.filter((d) => d.id !== p.id);
    this.persist();
    return { ok: true, errors: [] };
  }

  endEncounter(): void { this.encounters++; this.persist(); }

  // Telemetry nudges: each is an exponential moving average toward observed play.
  observe(key: keyof Telemetry, value: number, rate = 0.04): void {
    this.telemetry[key] += (value - this.telemetry[key]) * rate;
  }

  resetAll(): void {
    this.inscribed.value = [];
    this.drafts.value = [];
    this.telemetry = { ...DEFAULT_TELEMETRY };
    this.encounters = 0;
    this.seedDrafts();
    this.persist();
  }

  private persist(): void {
    const data: Saved = { inscribed: this.inscribed.value, drafts: this.drafts.value, telemetry: this.telemetry, encounters: this.encounters };
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* storage unavailable */ }
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const s = JSON.parse(raw) as Partial<Saved>;
      this.inscribed.value = (s.inscribed ?? []).filter((p) => validatePact(p).ok);
      this.drafts.value = (s.drafts ?? []).filter((p) => validatePact(p).ok);
      this.telemetry = { ...DEFAULT_TELEMETRY, ...(s.telemetry ?? {}) };
      this.encounters = s.encounters ?? 0;
    } catch { /* corrupt save: start fresh */ }
  }
}
