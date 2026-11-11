import { type Pact, type Param, type Restriction, restrictions, sacrificeTag } from './schema';

// Play telemetry the Resolve estimate reads. Fractions are 0..1 and decay
// toward what the player actually does, so a restriction on something they
// never use is worth almost nothing.
export interface Telemetry {
  movingWhileCasting: number;
  dashesPerMinute: number;
  airborneFraction: number;
  hitsFromBehind: number;
  longRangeFraction: number;
  multiTargetFraction: number;
  propUse: number;
  waterNearby: number;
  lowHealthFraction: number;
  eyesOpenReliance: number;
}

export const DEFAULT_TELEMETRY: Telemetry = {
  movingWhileCasting: 0.6, dashesPerMinute: 4, airborneFraction: 0.12, hitsFromBehind: 0.25, longRangeFraction: 0.35,
  multiTargetFraction: 0.4, propUse: 0.3, waterNearby: 0.5, lowHealthFraction: 0.15, eyesOpenReliance: 0.9,
};

export type ResolveRead = 'trivial' | 'slight' | 'meaningful' | 'heavy' | 'grave';

export interface ResolveLine { label: string; value: number; reason: string; zero?: boolean; warn?: boolean; param?: Param; by?: string }
export interface ResolveEstimate { total: number; read: ResolveRead; lines: ResolveLine[]; potency: number }

// Base weight: how much capability the restriction surrenders for a typical
// fighter. The usage function scales it by what this player does.
const WEIGHTS: Record<string, { base: number; usage: (t: Telemetry) => number; why: string }> = {
  'direction:front': { base: 2.2, usage: (t) => 0.5 + t.hitsFromBehind * 2, why: 'gives up every angle but the one you face' },
  'direction:declared': { base: 2.6, usage: () => 1, why: 'you must say where before it happens' },
  'direction:ground': { base: 1.8, usage: (t) => 0.6 + t.airborneFraction, why: 'nothing happens above the ground plane' },
  'direction:line': { base: 2.0, usage: (t) => 0.5 + t.multiTargetFraction, why: 'a single line, nothing beside it' },
  'direction:behind': { base: 2.4, usage: () => 1, why: 'only what you cannot see' },
  'range:touch': { base: 3.0, usage: (t) => 0.4 + t.longRangeFraction * 1.6, why: 'you have to be touching it' },
  'range:short': { base: 2.0, usage: (t) => 0.4 + t.longRangeFraction * 1.4, why: 'nothing past a few steps' },
  'range:medium': { base: 0.9, usage: (t) => 0.3 + t.longRangeFraction, why: 'the far end of the street is out of reach' },
  'range:long': { base: 0.2, usage: () => 1, why: 'barely a restriction' },
  'target:single': { base: 1.8, usage: (t) => 0.4 + t.multiTargetFraction * 1.5, why: 'one target at a time' },
  'target:named': { base: 2.6, usage: () => 1, why: 'you must name the target first, out loud' },
  'target:resonant': { base: 1.6, usage: (t) => 0.5 + (1 - t.propUse), why: 'only things that ring' },
  'target:water': { base: 1.4, usage: (t) => 0.4 + (1 - t.waterNearby), why: 'only through water' },
  'target:self': { base: 1.2, usage: () => 1, why: 'only your own body' },
  'target:props': { base: 1.5, usage: () => 1, why: 'never a person' },
  'target:people': { base: 1.1, usage: (t) => 0.5 + t.propUse, why: 'never an object' },
  'trigger:still': { base: 2.4, usage: (t) => 0.3 + t.movingWhileCasting * 1.4, why: 'you give up casting on the move' },
  'trigger:grounded': { base: 1.2, usage: (t) => 0.4 + t.airborneFraction * 3, why: 'nothing in the air' },
  'trigger:airborne': { base: 2.2, usage: (t) => 1.4 - t.airborneFraction, why: 'only while your feet are off the ground' },
  'trigger:struck': { base: 2.0, usage: () => 1, why: 'only after you have been hit' },
  'trigger:eyesClosed': { base: 2.0, usage: (t) => 0.5 + t.eyesOpenReliance, why: 'you fight blind for it' },
  'trigger:declared': { base: 1.6, usage: () => 1, why: 'you have to announce it' },
  'trigger:lowHealth': { base: 1.8, usage: (t) => 1.3 - t.lowHealthFraction, why: 'only when you are nearly beaten' },
  'trigger:fullSign': { base: 1.0, usage: () => 1, why: 'the whole hand sign, every time' },
  'duration:instant': { base: 0.8, usage: () => 1, why: 'a single moment' },
  'duration:brief': { base: 0.5, usage: () => 1, why: 'it fades fast' },
  'duration:held': { base: 1.0, usage: () => 1, why: 'you hold it or lose it' },
  'duration:sustained': { base: 0.1, usage: () => 1, why: 'hardly a cost' },
  'resource:all': { base: 2.6, usage: () => 1, why: 'everything you have, every time' },
  'resource:half': { base: 1.2, usage: () => 1, why: 'half of what you hold' },
  'resource:health': { base: 3.0, usage: () => 1, why: 'paid in blood' },
  'resource:strain': { base: 1.4, usage: () => 1, why: 'paid in strain you must rest off' },
  'body:bothHands': { base: 1.6, usage: () => 1, why: 'no free hand' },
  'body:noMove': { base: 2.8, usage: (t) => 0.3 + t.movingWhileCasting * 1.4, why: 'rooted to the spot' },
  'body:noDash': { base: 2.2, usage: (t) => 0.3 + Math.min(1.4, t.dashesPerMinute / 4), why: 'you surrender the dash' },
  'body:eyes': { base: 2.4, usage: () => 1, why: 'your eyes close for it' },
  'body:palmContact': { base: 2.0, usage: (t) => 0.5 + t.longRangeFraction, why: 'palm flat on the surface' },
  'body:maxHealth': { base: 3.2, usage: () => 1, why: 'a piece of your body, permanently' },
  'body:barefoot': { base: 0.6, usage: () => 1, why: 'small, unless you fight in boots' },
  'body:voice': { base: 1.0, usage: () => 1, why: 'you say the words' },
};

// A sacrifice counts once, for the Pact that paid it first. Pacts inscribed
// earlier come first, and a draft comes after everything inscribed.
export function countedBefore(pact: Pact, inscribed: Pact[]): Map<string, string> {
  const at = inscribed.findIndex((p) => p.id === pact.id);
  const counted = new Map<string, string>();
  for (const other of at < 0 ? inscribed : inscribed.slice(0, at)) for (const r of restrictions(other)) if (!counted.has(sacrificeTag(r))) counted.set(sacrificeTag(r), other.name);
  return counted;
}

export function lineFor(r: Restriction, counted: Map<string, string>, telemetry: Telemetry): ResolveLine {
  const tag = sacrificeTag(r);
  const w = WEIGHTS[tag]!;
  const by = counted.get(tag);
  if (by) return { label: describe(r), value: 0, reason: `"${by}" already pays this sacrifice while it is in use, so it earns nothing again`, zero: true, param: r.param, by };
  const usage = Math.min(1.6, Math.max(0.05, w.usage(telemetry)));
  const warn = usage < 0.5;
  return { label: describe(r), value: round(w.base * usage), reason: warn ? `${w.why}, but you rarely do otherwise` : w.why, warn, param: r.param };
}

export function estimateResolve(pact: Pact, inscribed: Pact[], telemetry: Telemetry): ResolveEstimate {
  const counted = countedBefore(pact, inscribed);
  const lines: ResolveLine[] = [];
  let total = 0;
  for (const r of restrictions(pact)) {
    if (!WEIGHTS[sacrificeTag(r)]) continue;
    const line = lineFor(r, counted, telemetry);
    lines.push(line);
    total += line.value;
  }
  for (const c of pact.clauses) {
    if (c.kind === 'sunset') { const f = 'seconds' in c.term ? 0.55 : 0.7; lines.push({ label: 'sunset clause', value: round(-total * (1 - f)), reason: 'a term that ends is worth less than one that does not' }); total *= f; }
    if (c.kind === 'risk') { lines.push({ label: `risk: past ${c.beyond} for ${c.cost}`, value: 0.4, reason: 'the escape clause is itself a cost' }); total += 0.4; }
    if (c.kind === 'wager') { lines.push({ label: `wager: ${c.predict}`, value: 0, reason: 'paid at the moment of declaration, not here' }); }
    if (c.kind === 'program') { lines.push({ label: `program: when ${c.when}, ${c.then}`, value: 0.2, reason: 'automation removes a choice' }); total += 0.2; }
  }
  total = round(total);
  const read: ResolveRead = total < 0.8 ? 'trivial' : total < 2.2 ? 'slight' : total < 4.5 ? 'meaningful' : total < 7.5 ? 'heavy' : 'grave';
  const potency = 1 - Math.exp(-total / 4.2);
  return { total, read, lines, potency };
}

export function describe(r: Restriction): string {
  const map: Record<string, string> = {
    'direction:front': 'only from the front', 'direction:declared': 'only in a declared direction', 'direction:ground': 'only along the ground', 'direction:line': 'only along one line', 'direction:behind': 'only from behind',
    'range:touch': 'only on touch', 'range:short': 'within a few steps', 'range:medium': 'within the street', 'range:long': 'anywhere in sight',
    'target:single': 'one target', 'target:named': 'a named target', 'target:resonant': 'only what resonates', 'target:water': 'only through water', 'target:self': 'only yourself', 'target:props': 'only objects', 'target:people': 'only people',
    'trigger:still': 'only while standing still', 'trigger:grounded': 'only with feet on the ground', 'trigger:airborne': 'only in the air', 'trigger:struck': 'only after being struck', 'trigger:eyesClosed': 'only with eyes shut', 'trigger:declared': 'only when declared aloud', 'trigger:lowHealth': 'only near defeat', 'trigger:fullSign': 'only with the full hand sign',
    'duration:instant': 'for an instant', 'duration:brief': 'for a breath', 'duration:held': 'while held', 'duration:sustained': 'for as long as it lasts',
    'resource:all': 'spending everything', 'resource:half': 'spending half', 'resource:health': 'paid in health', 'resource:strain': 'paid in strain',
    'body:bothHands': 'with both hands', 'body:noMove': 'never moving', 'body:noDash': 'never dashing again', 'body:eyes': 'with eyes closed', 'body:palmContact': 'palm against the surface', 'body:maxHealth': 'a permanent piece of your health', 'body:barefoot': 'barefoot', 'body:voice': 'spoken aloud',
  };
  return map[sacrificeTag(r)] ?? sacrificeTag(r);
}

const round = (n: number): number => Math.round(n * 10) / 10;
