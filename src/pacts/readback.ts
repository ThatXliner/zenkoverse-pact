import { type Pact, type Clause } from './schema';
import { describe } from './resolve';

// The terms as the universe reads them: one paragraph in plain words, built
// from the parsed Pact and nothing else, so the player confirms exactly what
// the engine will enforce.
export function readback(pact: Pact, shapeLabel: (shape: string) => string, behaviorLabel: (b: string) => string): string {
  const parts: string[] = [];
  const restrict = pact.clauses.filter((c): c is Extract<Clause, { kind: 'restrict' }> => c.kind === 'restrict');
  const grant = shapeLabel(pact.grant.shape);
  const behaviors = (pact.grant.behaviors ?? []).map(behaviorLabel).filter(Boolean);
  const bound = pact.slot === 'passive' ? 'always, without a key' : `on ${pact.slot === 'max' ? 'Maximum Output' : pact.slot === 'primary' ? 'the primary key' : 'the secondary key'}`;
  parts.push(`"${pact.name}" is bound ${bound}. It ${grant}${behaviors.length ? `, and ${joinAnd(behaviors)}` : ''}.`);
  if (restrict.length) parts.push(`In exchange it works ${joinAnd(restrict.map((c) => describe(c.restriction)))}.`);
  else parts.push('It asks nothing of you, so the universe gives it nothing beyond the raw Technique.');
  for (const c of pact.clauses) {
    if (c.kind === 'sunset') parts.push('seconds' in c.term ? `Invoked, its term runs ${c.term.seconds} seconds; the Pact remains.` : `Its term ends after ${c.term.encounters} ${c.term.encounters === 1 ? 'fight' : 'fights'}; the Pact remains.`);
    if (c.kind === 'risk') parts.push(`Risk: you may push past the ${c.beyond} limit, and ${riskCost(c.cost)}.`);
    if (c.kind === 'wager') parts.push(`Wager: before it fires, you may declare ${prediction(c.predict)}. Correct, the universe pays out; wrong, your Technique seals.`);
    if (c.kind === 'program') parts.push(`Programmed: when ${triggerWords(c.when)}, this Pact ${c.then === 'activate' ? 'fires on its own' : c.then === 'suppress' ? 'refuses to fire' : 'takes precedence over your other Pacts'}.`);
  }
  parts.push('Once inscribed it cannot be unwritten.');
  return parts.join(' ');
}

function joinAnd(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
function riskCost(c: 'health' | 'exhaustion' | 'seal'): string {
  return c === 'health' ? 'every use past it costs health' : c === 'exhaustion' ? 'every use past it leaves you winded and slow' : 'a use past it seals the Technique for a while';
}
function prediction(p: string): string {
  return p === 'hit' ? 'that the next strike connects' : p === 'kill' ? 'that the next strike finishes its target' : p === 'untouched' ? 'that you take no hit for the next ten seconds' : 'that you land the first strike of the fight';
}
export function triggerWords(t: string): string {
  const m: Record<string, string> = { still: 'you stand still', grounded: 'your feet are on the ground', airborne: 'you are in the air', struck: 'you are struck', eyesClosed: 'your eyes are shut', declared: 'you declare it', lowHealth: 'you are near defeat', fullSign: 'you perform the full hand sign' };
  return m[t] ?? t;
}
