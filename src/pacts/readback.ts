import { type Pact, type Clause, type Param, type AbilitySlot } from './schema';
import { describe } from './resolve';

// The terms as the universe reads them, built from the parsed Pact and
// nothing else. The Workshop renders the segments as the editor, so what the
// player clicks is exactly what the engine enforces.
export type Focus = { kind: 'key' } | { kind: 'grant' } | { kind: 'term'; param: Param } | { kind: 'clause'; index: number };
export interface Segment { text: string; focus?: Focus }

export const KEY_WORDS: Record<AbilitySlot, string> = { primary: 'left click', secondary: 'right click', max: 'Q, Maximum Output', passive: 'no key, always' };

export function readbackSegments(pact: Pact, shapeLabel: (shape: string) => string, behaviorLabel: (b: string) => string): Segment[] {
  const out: Segment[] = [];
  const restrict = pact.clauses.map((c, index) => ({ c, index })).filter((x): x is { c: Extract<Clause, { kind: 'restrict' }>; index: number } => x.c.kind === 'restrict');
  const behaviors = (pact.grant.behaviors ?? []).map(behaviorLabel).filter(Boolean);
  out.push({ text: `"${pact.name}" on ` }, { text: KEY_WORDS[pact.slot], focus: { kind: 'key' } }, { text: ' ' });
  out.push({ text: shapeLabel(pact.grant.shape) + (behaviors.length ? `, and ${joinAnd(behaviors)}` : ''), focus: { kind: 'grant' } });
  out.push({ text: '. ' });
  if (restrict.length) {
    out.push({ text: 'In exchange it works ' });
    restrict.forEach(({ c, index }, i) => {
      out.push({ text: describe(c.restriction), focus: { kind: 'term', param: c.restriction.param } });
      out.push({ text: i < restrict.length - 2 ? ', ' : i === restrict.length - 2 ? ' and ' : '. ' });
      void index;
    });
  } else out.push({ text: 'It asks nothing of you, so the universe gives it nothing beyond the raw Technique. ' });
  pact.clauses.forEach((c, index) => {
    const focus: Focus = { kind: 'clause', index };
    if (c.kind === 'sunset') out.push({ text: 'seconds' in c.term ? `Invoked, its term runs ${c.term.seconds} seconds; the Pact remains` : `Its term ends after ${c.term.encounters} ${c.term.encounters === 1 ? 'fight' : 'fights'}; the Pact remains`, focus }, { text: '. ' });
    if (c.kind === 'risk') out.push({ text: `Risk: you may push past the ${c.beyond} limit, and ${riskCost(c.cost)}`, focus }, { text: '. ' });
    if (c.kind === 'wager') out.push({ text: `Wager: before it fires, you may declare ${prediction(c.predict)}. Correct, the universe pays out; wrong, your Technique seals`, focus }, { text: '. ' });
    if (c.kind === 'program') out.push({ text: `Programmed: when ${triggerWords(c.when)}, this Pact ${c.then === 'activate' ? 'fires on its own' : c.then === 'suppress' ? 'refuses to fire' : 'takes precedence over your other Pacts'}`, focus }, { text: '. ' });
  });
  out.push({ text: 'Once inscribed it cannot be unwritten.' });
  return out;
}

export function readback(pact: Pact, shapeLabel: (shape: string) => string, behaviorLabel: (b: string) => string): string {
  return readbackSegments(pact, shapeLabel, behaviorLabel).map((s) => s.text).join('');
}

function joinAnd(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
export function riskCost(c: 'health' | 'exhaustion' | 'seal'): string {
  return c === 'health' ? 'every use past it costs health' : c === 'exhaustion' ? 'every use past it leaves you winded and slow' : 'a use past it seals the Technique for a while';
}
export function prediction(p: string): string {
  return p === 'hit' ? 'that the next strike connects' : p === 'kill' ? 'that the next strike finishes its target' : p === 'untouched' ? 'that you take no hit for the next ten seconds' : 'that you land the first strike of the fight';
}
export function triggerWords(t: string): string {
  const m: Record<string, string> = { still: 'you stand still', grounded: 'your feet are on the ground', airborne: 'you are in the air', struck: 'you are struck', eyesClosed: 'your eyes are shut', declared: 'you declare it', lowHealth: 'you are near defeat', fullSign: 'you perform the full hand sign' };
  return m[t] ?? t;
}
