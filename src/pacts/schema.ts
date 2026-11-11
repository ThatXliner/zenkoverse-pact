// Pacts are serializable data. This file is the single source of truth for
// their shape: the TypeScript types, a runtime validator, and a JSON Schema
// for external authoring surfaces (issue #16). No magnitudes live here; the
// engine derives every number from a parsed Pact.

export type TechniqueId = 'recoil' | 'shift' | 'rime' | 'blink' | 'echo';
export type AbilitySlot = 'primary' | 'secondary' | 'max' | 'passive';
export type Param = 'direction' | 'range' | 'target' | 'trigger' | 'duration' | 'resource' | 'body';

export type Direction = 'front' | 'declared' | 'ground' | 'line' | 'behind';
export type RangeValue = 'touch' | 'short' | 'medium' | 'long';
export type TargetValue = 'single' | 'named' | 'resonant' | 'water' | 'self' | 'props' | 'people';
export type TriggerValue = 'still' | 'grounded' | 'airborne' | 'struck' | 'eyesClosed' | 'declared' | 'lowHealth' | 'fullSign';
export type DurationValue = 'instant' | 'brief' | 'held' | 'sustained';
export type ResourceValue = 'all' | 'half' | 'health' | 'strain';
export type BodyValue = 'bothHands' | 'noMove' | 'noDash' | 'eyes' | 'palmContact' | 'maxHealth' | 'barefoot' | 'voice';

export type Restriction =
  | { param: 'direction'; value: Direction }
  | { param: 'range'; value: RangeValue }
  | { param: 'target'; value: TargetValue }
  | { param: 'trigger'; value: TriggerValue }
  | { param: 'duration'; value: DurationValue }
  | { param: 'resource'; value: ResourceValue }
  | { param: 'body'; value: BodyValue };

export type Prediction = 'hit' | 'kill' | 'untouched' | 'firstStrike';
export type RiskCost = 'health' | 'exhaustion' | 'seal';
export type ProgramThen = 'activate' | 'suppress' | 'prefer';

export type Clause =
  | { kind: 'restrict'; restriction: Restriction }
  | { kind: 'sunset'; term: { seconds: number } | { encounters: number } }
  | { kind: 'risk'; beyond: Param; cost: RiskCost }
  | { kind: 'wager'; predict: Prediction }
  | { kind: 'program'; when: TriggerValue; then: ProgramThen };

// What the Pact grants: a shape for the Ability and optional behaviors. The
// list of valid shapes and behaviors is per Technique (see each kit).
export interface Grant { shape: string; behaviors?: string[] }

export interface Pact {
  id: string;
  technique: TechniqueId;
  name: string;
  slot: AbilitySlot;
  grant: Grant;
  clauses: Clause[];
  inscribed?: boolean;
  inscribedAt?: number;
  note?: string;
}

export const PARAM_VALUES: Record<Param, readonly string[]> = {
  direction: ['front', 'declared', 'ground', 'line', 'behind'],
  range: ['touch', 'short', 'medium', 'long'],
  target: ['single', 'named', 'resonant', 'water', 'self', 'props', 'people'],
  trigger: ['still', 'grounded', 'airborne', 'struck', 'eyesClosed', 'declared', 'lowHealth', 'fullSign'],
  duration: ['instant', 'brief', 'held', 'sustained'],
  resource: ['all', 'half', 'health', 'strain'],
  body: ['bothHands', 'noMove', 'noDash', 'eyes', 'palmContact', 'maxHealth', 'barefoot', 'voice'],
};
export const PREDICTIONS: readonly Prediction[] = ['hit', 'kill', 'untouched', 'firstStrike'];
export const RISK_COSTS: readonly RiskCost[] = ['health', 'exhaustion', 'seal'];
export const TECHNIQUE_IDS: readonly TechniqueId[] = ['recoil', 'shift', 'rime', 'blink', 'echo'];
export const SLOTS: readonly AbilitySlot[] = ['primary', 'secondary', 'max', 'passive'];

export interface Validation { ok: boolean; errors: string[] }

export function validatePact(input: unknown, shapes?: readonly string[]): Validation {
  const errors: string[] = [];
  if (typeof input !== 'object' || input === null) return { ok: false, errors: ['pact must be an object'] };
  const p = input as Record<string, unknown>;
  if (typeof p.id !== 'string' || !p.id) errors.push('id must be a non-empty string');
  if (!TECHNIQUE_IDS.includes(p.technique as TechniqueId)) errors.push(`technique must be one of ${TECHNIQUE_IDS.join(', ')}`);
  if (typeof p.name !== 'string' || p.name.length < 1 || p.name.length > 48) errors.push('name must be 1 to 48 characters');
  if (!SLOTS.includes(p.slot as AbilitySlot)) errors.push(`slot must be one of ${SLOTS.join(', ')}`);
  const grant = p.grant as Record<string, unknown> | undefined;
  if (!grant || typeof grant.shape !== 'string') errors.push('grant.shape must be a string');
  else if (shapes && !shapes.includes(grant.shape)) errors.push(`grant.shape must be one of ${shapes.join(', ')}`);
  if (grant?.behaviors !== undefined && (!Array.isArray(grant.behaviors) || grant.behaviors.some((b) => typeof b !== 'string'))) errors.push('grant.behaviors must be an array of strings');
  if (!Array.isArray(p.clauses)) errors.push('clauses must be an array');
  else {
    if (p.clauses.length > 8) errors.push('a Pact holds at most 8 clauses');
    p.clauses.forEach((c, i) => {
      const e = validateClause(c);
      if (e) errors.push(`clauses[${i}]: ${e}`);
    });
    const restricted = (p.clauses as Clause[]).filter((c): c is Extract<Clause, { kind: 'restrict' }> => c?.kind === 'restrict');
    const seen = new Set<string>();
    for (const r of restricted) {
      if (seen.has(r.restriction.param)) errors.push(`parameter ${r.restriction.param} is restricted twice`);
      seen.add(r.restriction.param);
    }
    if ((p.clauses as Clause[]).filter((c) => c?.kind === 'wager').length > 1) errors.push('a Pact holds at most one Wager');
    if ((p.clauses as Clause[]).filter((c) => c?.kind === 'sunset').length > 1) errors.push('a Pact holds at most one sunset');
    for (const c of p.clauses as Clause[]) if (c?.kind === 'risk' && !restricted.some((r) => r.restriction.param === c.beyond)) errors.push(`risk extends ${c.beyond}, which this Pact does not restrict`);
  }
  return { ok: errors.length === 0, errors };
}

function validateClause(c: unknown): string | null {
  if (typeof c !== 'object' || c === null) return 'clause must be an object';
  const k = (c as { kind?: unknown }).kind;
  switch (k) {
    case 'restrict': {
      const r = (c as { restriction?: { param?: Param; value?: string } }).restriction;
      if (!r || !(r.param! in PARAM_VALUES)) return 'restriction.param is unknown';
      if (!PARAM_VALUES[r.param!].includes(r.value as string)) return `restriction.value ${String(r.value)} is not valid for ${r.param}`;
      return null;
    }
    case 'sunset': {
      const t = (c as { term?: { seconds?: unknown; encounters?: unknown } }).term;
      if (!t) return 'sunset.term is required';
      if (typeof t.seconds === 'number' && t.seconds >= 5 && t.seconds <= 600) return null;
      if (typeof t.encounters === 'number' && Number.isInteger(t.encounters) && t.encounters >= 1 && t.encounters <= 10) return null;
      return 'sunset.term must be {seconds: 5..600} or {encounters: 1..10}';
    }
    case 'risk': {
      const r = c as { beyond?: Param; cost?: RiskCost };
      if (!(r.beyond! in PARAM_VALUES)) return 'risk.beyond must be a parameter';
      if (!RISK_COSTS.includes(r.cost!)) return 'risk.cost must be health, exhaustion or seal';
      return null;
    }
    case 'wager': return PREDICTIONS.includes((c as { predict?: Prediction }).predict!) ? null : 'wager.predict is unknown';
    case 'program': {
      const pr = c as { when?: TriggerValue; then?: ProgramThen };
      if (!PARAM_VALUES.trigger.includes(pr.when!)) return 'program.when must be a trigger';
      if (!['activate', 'suppress', 'prefer'].includes(pr.then!)) return 'program.then must be activate, suppress or prefer';
      return null;
    }
    default: return `unknown clause kind ${String(k)}`;
  }
}

const enumOf = (values: readonly string[]) => ({ type: 'string', enum: [...values] });

export const PACT_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://zenkoverse.dev/pact.schema.json',
  title: 'Pact',
  type: 'object',
  required: ['id', 'technique', 'name', 'slot', 'grant', 'clauses'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', minLength: 1 },
    technique: enumOf(TECHNIQUE_IDS),
    name: { type: 'string', minLength: 1, maxLength: 48 },
    slot: enumOf(SLOTS),
    grant: { type: 'object', required: ['shape'], additionalProperties: false, properties: { shape: { type: 'string' }, behaviors: { type: 'array', items: { type: 'string' } } } },
    clauses: { type: 'array', maxItems: 8, items: { $ref: '#/$defs/clause' } },
    inscribed: { type: 'boolean' },
    inscribedAt: { type: 'number' },
    note: { type: 'string' },
  },
  $defs: {
    restriction: { oneOf: (Object.keys(PARAM_VALUES) as Param[]).map((param) => ({ type: 'object', required: ['param', 'value'], additionalProperties: false, properties: { param: { const: param }, value: enumOf(PARAM_VALUES[param]) } })) },
    clause: {
      oneOf: [
        { type: 'object', required: ['kind', 'restriction'], additionalProperties: false, properties: { kind: { const: 'restrict' }, restriction: { $ref: '#/$defs/restriction' } } },
        { type: 'object', required: ['kind', 'term'], additionalProperties: false, properties: { kind: { const: 'sunset' }, term: { oneOf: [{ type: 'object', required: ['seconds'], properties: { seconds: { type: 'number', minimum: 5, maximum: 600 } } }, { type: 'object', required: ['encounters'], properties: { encounters: { type: 'integer', minimum: 1, maximum: 10 } } }] } } },
        { type: 'object', required: ['kind', 'beyond', 'cost'], additionalProperties: false, properties: { kind: { const: 'risk' }, beyond: enumOf(Object.keys(PARAM_VALUES)), cost: enumOf(RISK_COSTS) } },
        { type: 'object', required: ['kind', 'predict'], additionalProperties: false, properties: { kind: { const: 'wager' }, predict: enumOf(PREDICTIONS) } },
        { type: 'object', required: ['kind', 'when', 'then'], additionalProperties: false, properties: { kind: { const: 'program' }, when: enumOf(PARAM_VALUES.trigger), then: enumOf(['activate', 'suppress', 'prefer']) } },
      ],
    },
  },
} as const;

export function restrictions(p: Pact): Restriction[] {
  return p.clauses.filter((c): c is Extract<Clause, { kind: 'restrict' }> => c.kind === 'restrict').map((c) => c.restriction);
}
export function restriction<P extends Param>(p: Pact, param: P): Extract<Restriction, { param: P }>['value'] | undefined {
  return restrictions(p).find((r) => r.param === param)?.value as never;
}
export function sacrificeTag(r: Restriction): string { return `${r.param}:${r.value}`; }
