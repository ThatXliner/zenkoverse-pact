// The Ability slots, as data. A slot is a place an Ability can sit and a key
// that fires it. An Ability also has a kind, which says how it is cast:
// the gesture, the cooldown and the base cost come from the kind, never from
// the slot. A kit's shape lists the kinds it can take, and a slot lists the
// kinds it accepts, so an extra slot needs no code beyond its row here.

export type AbilityKind = 'primary' | 'secondary' | 'max';

export interface SlotDef {
  id: string;
  name: string;
  // Kinds this slot can fire. Empty for a Pact that is always on.
  accepts: readonly AbilityKind[];
  // The kind the raw Technique casts here, or null when an empty slot does nothing.
  raw: AbilityKind | null;
  // KeyboardEvent.code, or Mouse0 to Mouse4. Null for a slot with no key.
  defaultKey: string | null;
  // A word added after the key where a sentence names it.
  role?: string;
}

export const SLOT_DEFS = [
  { id: 'primary', name: 'Primary', accepts: ['primary'], raw: 'primary', defaultKey: 'Mouse0' },
  { id: 'secondary', name: 'Secondary', accepts: ['secondary'], raw: 'secondary', defaultKey: 'Mouse2' },
  { id: 'max', name: 'Maximum Output', accepts: ['max'], raw: 'max', defaultKey: 'KeyQ', role: 'Maximum Output' },
  { id: 'art1', name: 'Slot 1', accepts: ['primary', 'secondary'], raw: null, defaultKey: 'Digit1' },
  { id: 'art2', name: 'Slot 2', accepts: ['primary', 'secondary'], raw: null, defaultKey: 'Digit2' },
  { id: 'art3', name: 'Slot 3', accepts: ['primary', 'secondary'], raw: null, defaultKey: 'Digit3' },
  { id: 'art4', name: 'Slot 4', accepts: ['primary', 'secondary'], raw: null, defaultKey: 'Digit4' },
  { id: 'passive', name: 'Always on', accepts: [], raw: null, defaultKey: null },
] as const satisfies readonly SlotDef[];

export type AbilitySlot = typeof SLOT_DEFS[number]['id'];
export type KeySlot = Exclude<AbilitySlot, 'passive'>;
export type ExtraSlot = Extract<KeySlot, `art${number}`>;

export const SLOTS: readonly AbilitySlot[] = SLOT_DEFS.map((s) => s.id);
export const KEY_SLOTS: readonly KeySlot[] = SLOT_DEFS.filter((s) => s.defaultKey !== null).map((s) => s.id as KeySlot);
export const EXTRA_SLOTS: readonly ExtraSlot[] = KEY_SLOTS.filter((s): s is ExtraSlot => SLOT_DEFS.find((d) => d.id === s)!.raw === null);

const BY_ID = new Map<string, SlotDef>(SLOT_DEFS.map((s) => [s.id, s]));
export const slotDef = (id: AbilitySlot): SlotDef => BY_ID.get(id)!;

export const slotAccepts = (slot: AbilitySlot, kinds: readonly AbilityKind[]): boolean => slotDef(slot).accepts.some((k) => kinds.includes(k));

// The first slot in registry order that takes one of these kinds, preferring `current`.
export function slotFor(kinds: readonly AbilityKind[], current?: AbilitySlot): AbilitySlot {
  if (current && slotAccepts(current, kinds)) return current;
  return SLOTS.find((s) => slotAccepts(s, kinds)) ?? 'primary';
}

// How an Ability of each kind is cast. `cost` is the share of the Technique's
// resource one cast takes.
export const KIND_DEFS: Record<AbilityKind, { cooldown: number; cost: number }> = {
  primary: { cooldown: 0.42, cost: 0.16 },
  secondary: { cooldown: 0.9, cost: 0.22 },
  max: { cooldown: 2, cost: 1 },
};

// The kind a Pact casts as when it sits on `slot`, given the kinds its shape allows.
export function kindOn(slot: AbilitySlot, kinds: readonly AbilityKind[] | undefined): AbilityKind | null {
  const def = slotDef(slot);
  if (kinds) return def.accepts.find((k) => kinds.includes(k)) ?? null;
  return def.raw;
}
