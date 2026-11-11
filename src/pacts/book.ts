import { signal } from '@preact/signals';
import { type Pact, type AbilitySlot, type TechniqueId, validatePact, type Validation } from './schema';
import { estimateResolve, countedBefore, DEFAULT_TELEMETRY, type Telemetry, type ResolveEstimate } from './resolve';

const KEY = 'zenko.pacts.v3';
const LEGACY_KEY = 'zenko.pacts.v2';

// Per Technique, what each key is bound to: an inscribed Pact's id, or null
// for the raw Technique after the player unbinds. A missing entry has never
// been set, so the catalogue may still claim it.
type Bindings = Partial<Record<TechniqueId, Partial<Record<AbilitySlot, string | null>>>>;
interface Saved { inscribed: Pact[]; drafts: Pact[]; bindings: Bindings; telemetry: Telemetry; encounters: number }

// The player's Pacts. Inscribed Pacts are permanent. Each key binds to one
// inscribed Pact of the current Technique or to nothing, which is the raw
// Technique. Every catalogue Ability arrives inscribed and bound (issue #3).
export class PactBook {
  readonly inscribed = signal<Pact[]>([]);
  readonly drafts = signal<Pact[]>([]);
  readonly bindings = signal<Bindings>({});
  readonly preview = signal<Pact | null>(null);
  telemetry: Telemetry = { ...DEFAULT_TELEMETRY };
  technique: TechniqueId = 'recoil';
  encounters = 0;
  private catalogue = new Map<TechniqueId, Pact[]>();

  constructor() { this.load(); }

  registerCatalogue(id: TechniqueId, pacts: Pact[]): void { this.catalogue.set(id, pacts); this.seed(); }
  setTechnique(id: TechniqueId): void { this.technique = id; this.preview.value = null; this.seed(); }

  isCatalogue(id: string): boolean { return [...this.catalogue.values()].some((list) => list.some((p) => p.id === id)); }
  forTechnique(list: Pact[]): Pact[] { return list.filter((p) => p.technique === this.technique); }

  private seed(): void {
    const cat = this.catalogue.get(this.technique) ?? [];
    if (!cat.length) return;
    const have = new Set(this.inscribed.value.map((p) => p.id));
    const add = cat.filter((p) => !have.has(p.id)).map((p) => ({ ...structuredClone(p), inscribed: true, inscribedAt: this.encounters }));
    if (add.length) this.inscribed.value = [...this.inscribed.value, ...add];
    const catalogueIds = new Set(cat.map((p) => p.id));
    if (this.drafts.value.some((d) => catalogueIds.has(d.id))) this.drafts.value = this.drafts.value.filter((d) => !catalogueIds.has(d.id));
    for (const p of cat) if (p.slot !== 'passive' && this.binding(p.slot) === undefined) this.bind(p.slot, p.id);
    this.persist();
  }

  binding(slot: AbilitySlot): string | null | undefined { return this.bindings.value[this.technique]?.[slot]; }

  bound(slot: AbilitySlot): Pact | null {
    const id = this.binding(slot);
    if (!id) return null;
    const p = this.inscribed.value.find((q) => q.id === id);
    return p && !this.expired(p) ? p : null;
  }

  bind(slot: AbilitySlot, id: string | null): void {
    this.bindings.value = { ...this.bindings.value, [this.technique]: { ...(this.bindings.value[this.technique] ?? {}), [slot]: id } };
    this.persist();
  }

  expired(p: Pact): boolean {
    const s = p.clauses.find((c) => c.kind === 'sunset');
    if (!s || s.kind !== 'sunset' || p.inscribedAt === undefined) return false;
    if ('encounters' in s.term) return this.encounters - p.inscribedAt >= s.term.encounters;
    return false;
  }

  // A sacrifice is paid only while the Pact that names it is in use, so
  // Resolve is judged against the bound Pacts, with `p` standing in for
  // whatever holds its key now (inscribing it would bind it there).
  inEffect(p: Pact): Pact[] {
    const holder = p.slot === 'passive' ? undefined : this.binding(p.slot);
    return this.inscribed.value.filter((q) => q.technique === p.technique && (q.id === p.id || ((q.slot === 'passive' || this.binding(q.slot) === q.id) && q.id !== holder)));
  }
  estimate(p: Pact): ResolveEstimate { return estimateResolve(p, this.inEffect(p), this.telemetry); }
  counted(p: Pact): Map<string, string> { return countedBefore(p, this.inEffect(p)); }

  saveDraft(p: Pact): void {
    this.drafts.value = [...this.drafts.value.filter((d) => d.id !== p.id), p];
    this.persist();
  }

  deleteDraft(id: string): void {
    this.drafts.value = this.drafts.value.filter((d) => d.id !== id);
    if (this.preview.value?.id === id) this.preview.value = null;
    this.persist();
  }

  inscribe(p: Pact, shapes: readonly string[]): Validation {
    const v = validatePact(p, shapes);
    if (!v.ok) return v;
    const sealed: Pact = { ...structuredClone(p), inscribed: true, inscribedAt: this.encounters };
    this.inscribed.value = [...this.inscribed.value.filter((q) => q.id !== sealed.id), sealed];
    this.drafts.value = this.drafts.value.filter((d) => d.id !== p.id);
    this.preview.value = null;
    if (sealed.slot !== 'passive') this.bind(sealed.slot, sealed.id);
    this.persist();
    return v;
  }

  endEncounter(): void { this.encounters++; this.persist(); }

  // Telemetry nudges: each is an exponential moving average toward observed play.
  observe(key: keyof Telemetry, value: number, rate = 0.04): void {
    this.telemetry[key] += (value - this.telemetry[key]) * rate;
  }

  resetAll(): void {
    this.inscribed.value = [];
    this.drafts.value = [];
    this.bindings.value = {};
    this.preview.value = null;
    this.telemetry = { ...DEFAULT_TELEMETRY };
    this.encounters = 0;
    this.seed();
    this.persist();
  }

  private persist(): void {
    const data: Saved = { inscribed: this.inscribed.value, drafts: this.drafts.value, bindings: this.bindings.value, telemetry: this.telemetry, encounters: this.encounters };
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* storage unavailable */ }
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(KEY);
      const s = raw ? (JSON.parse(raw) as Partial<Saved>) : this.legacy();
      if (!s) return;
      this.inscribed.value = (s.inscribed ?? []).filter((p) => validatePact(p).ok);
      this.drafts.value = (s.drafts ?? []).filter((p) => validatePact(p).ok);
      this.bindings.value = s.bindings ?? {};
      this.telemetry = { ...DEFAULT_TELEMETRY, ...(s.telemetry ?? {}) };
      this.encounters = s.encounters ?? 0;
    } catch { /* corrupt save: start fresh */ }
  }

  // A v2 save bound each key to the last Pact inscribed for it.
  private legacy(): Partial<Saved> | null {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<Saved>;
    const bindings: Bindings = {};
    for (const p of s.inscribed ?? []) if (p.slot !== 'passive') bindings[p.technique] = { ...(bindings[p.technique] ?? {}), [p.slot]: p.id };
    return { ...s, bindings };
  }
}
