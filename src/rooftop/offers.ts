import type { Game } from '../app/game';
import { KITS } from '../techniques/techniques';
import { readback } from '../pacts/readback';
import { sacrificeTag, restrictions, validatePact, type Clause, type Pact, type TechniqueId } from '../pacts/schema';
import { KEY_SLOTS, SLOT_DEFS, EXTRA_SLOTS, slotAccepts, type AbilityKind, type AbilitySlot } from '../pacts/slots';
import type { ResolveEstimate, ResolveRead } from '../pacts/resolve';

// The Pacts offered between waves (issues #34 and #5). Each offer is a real
// Pact in the schema, authored here as data and checked by the same validator
// the Workshop uses. Only restrictions the engine enforces are offered, so a
// sacrifice on a card is a sacrifice the player will feel.

type R = `${'direction' | 'range' | 'target' | 'trigger' | 'duration' | 'resource' | 'body'}:${string}`;

interface Template {
  id: string;
  name: string;
  kinds: AbilityKind[];
  restrict: R[];
  extra?: Clause[];
  only?: TechniqueId;
  shape?: string;
  behaviors?: string[];
}

// Each Pact pairs two or three sacrifices, as a catalogue Ability does, so the
// ones on offer are worth weighing against the Ability they would replace.
const GENERIC: Template[] = [
  { id: 'rooted', name: 'Rooted Vow', kinds: ['primary'], restrict: ['trigger:still', 'direction:front', 'range:short'] },
  { id: 'duelist', name: 'Duelist\'s Vow', kinds: ['primary'], restrict: ['direction:front', 'range:short', 'target:single'] },
  { id: 'footing', name: 'Firm Footing', kinds: ['primary'], restrict: ['trigger:grounded', 'range:medium', 'resource:half'] },
  { id: 'blood', name: 'Blood Price', kinds: ['primary'], restrict: ['resource:health', 'direction:front'] },
  { id: 'winded', name: 'Borrowed Breath', kinds: ['primary'], restrict: ['resource:strain', 'trigger:grounded', 'target:single'] },
  { id: 'gambler', name: 'Gambler\'s Hand', kinds: ['primary'], restrict: ['direction:front', 'range:short'], extra: [{ kind: 'wager', predict: 'hit' }] },
  { id: 'overreach', name: 'Overreach', kinds: ['primary'], restrict: ['range:short', 'trigger:grounded'], extra: [{ kind: 'risk', beyond: 'range', cost: 'health' }] },
  { id: 'stone', name: 'Stone Hands', kinds: ['primary'], restrict: ['body:noMove', 'range:medium', 'direction:front'] },
  { id: 'stillwater', name: 'Stillwater', kinds: ['secondary'], restrict: ['trigger:still', 'resource:half'] },
  { id: 'wall', name: 'Shield Wall', kinds: ['secondary'], restrict: ['direction:front', 'trigger:grounded', 'resource:strain'] },
  { id: 'door', name: 'Narrow Door', kinds: ['secondary'], restrict: ['range:short', 'target:single'] },
  { id: 'bargain', name: 'Hard Bargain', kinds: ['secondary'], restrict: ['resource:health', 'trigger:grounded'] },
  { id: 'lastbreath', name: 'Last Breath', kinds: ['max'], restrict: ['trigger:lowHealth', 'direction:front'] },
  { id: 'counter', name: 'Counterstroke', kinds: ['max'], restrict: ['trigger:struck', 'range:medium'] },
  { id: 'stonefoot', name: 'Stonefoot Oath', kinds: ['max'], restrict: ['body:noMove', 'trigger:grounded'] },
  { id: 'skybreak', name: 'Skybreak', kinds: ['max'], restrict: ['trigger:airborne', 'resource:all'] },
  { id: 'allin', name: 'All In', kinds: ['max'], restrict: ['resource:all', 'direction:front'] },
];

// Technique-specific Pacts that use a shape or a behavior the generic ones do not.
const SPECIFIC: Template[] = [
  { id: 'debt', name: 'Debt Collector', only: 'recoil', kinds: ['primary'], shape: 'punch', behaviors: ['store'], restrict: ['resource:half', 'direction:front'] },
  { id: 'thunder', name: 'Stored Thunder', only: 'recoil', kinds: ['secondary'], shape: 'absorb', behaviors: ['store', 'relaunch'], restrict: ['trigger:grounded', 'direction:front'] },
  { id: 'needle', name: 'Needle Step', only: 'shift', kinds: ['secondary'], shape: 'translate', behaviors: ['through'], restrict: ['range:short', 'trigger:grounded'] },
  { id: 'quietcut', name: 'Quiet Cut', only: 'shift', kinds: ['primary'], shape: 'cut', behaviors: ['quiet', 'momentum'], restrict: ['target:single', 'direction:front'] },
  { id: 'hoarfrost', name: 'Hoarfrost', only: 'rime', kinds: ['primary'], shape: 'icebreak', behaviors: ['sharp'], restrict: ['trigger:grounded', 'range:short'] },
  { id: 'deepfreeze', name: 'Deep Freeze', only: 'rime', kinds: ['secondary'], shape: 'coldStitch', behaviors: ['pin'], restrict: ['target:single', 'resource:half'] },
  { id: 'wideeyes', name: 'Wide Eyes', only: 'blink', kinds: ['primary'], shape: 'flinch', behaviors: ['wide'], restrict: ['trigger:still', 'direction:front'] },
  { id: 'lance', name: 'Tear Lance', only: 'blink', kinds: ['primary'], shape: 'flinch', behaviors: ['narrow'], restrict: ['direction:front', 'target:single'] },
  { id: 'fork', name: 'Tuning Fork', only: 'echo', kinds: ['primary'], shape: 'ring', behaviors: ['sharp', 'stack'], restrict: ['target:single', 'range:short'] },
  { id: 'hush', name: 'Hush', only: 'echo', kinds: ['secondary'], shape: 'quiet', restrict: ['duration:held', 'trigger:grounded'] },
];

// Two sacrifices are the same surrender when they name the same tag, or when
// one is a spelling of the other: standing still is one sacrifice whether it
// is written as a trigger or as a vow never to move.
const SAME: Record<string, string> = { 'body:noMove': 'trigger:still' };
export const family = (tag: string): string => SAME[tag] ?? tag;

export interface Offer {
  pact: Pact;
  tags: string[];
  text: string;
  replaces: string | null;
  before: ResolveEstimate | null;
  after: ResolveEstimate;
  stronger: boolean;
}

export const readFor = (read: ResolveRead): string => ({ trivial: 'a trivial sacrifice', slight: 'a slight sacrifice', meaningful: 'a meaningful sacrifice', heavy: 'a heavy sacrifice', grave: 'a grave sacrifice' })[read];

function clausesOf(restrict: R[], extra: Clause[] = []): Clause[] {
  return [...restrict.map((r): Clause => { const [param, value] = r.split(':') as [never, never]; return { kind: 'restrict', restriction: { param, value } }; }), ...extra];
}

function instantiate(t: Template, kind: AbilityKind, slot: AbilitySlot, technique: TechniqueId): Pact {
  const kit = KITS[technique];
  const shape = t.shape ?? Object.entries(kit.shapes).find(([, v]) => v.kinds.includes(kind))![0];
  return { id: `roof.${technique}.${t.id}.${slot}`, technique, name: t.name, slot, grant: { shape, ...(t.behaviors ? { behaviors: t.behaviors } : {}) }, clauses: clausesOf(t.restrict, t.extra) };
}

// Every Pact a template can become: one on the slot that casts its kind
// (replacing what is there), and one on the first of `empty` that takes the
// kind (adding to the keys the player already has).
export function candidates(technique: TechniqueId, empty: readonly AbilitySlot[] = []): Pact[] {
  const kit = KITS[technique];
  const out: Pact[] = [];
  for (const t of [...GENERIC, ...SPECIFIC]) {
    if (t.only && t.only !== technique) continue;
    for (const kind of t.kinds) {
      if (!t.shape && !Object.values(kit.shapes).some((s) => s.kinds.includes(kind))) continue;
      const own = SLOT_DEFS.find((s) => s.raw === kind)!.id;
      const free = empty.find((s) => slotAccepts(s, [kind]));
      for (const slot of new Set<AbilitySlot>(free ? [own, free] : [own])) out.push(instantiate(t, kind, slot, technique));
    }
  }
  for (const p of kit.catalogue) if (p.slot !== 'passive') out.push(structuredClone(p));
  return out;
}

export const tagsOf = (p: Pact): string[] => restrictions(p).map(sacrificeTag);

// True when no two Pacts share a sacrifice (issue #5).
export function distinct(pacts: Pact[]): boolean {
  const seen = new Set<string>();
  for (const p of pacts) {
    const mine = new Set(tagsOf(p).map(family));
    for (const f of mine) { if (seen.has(f)) return false; }
    for (const f of mine) seen.add(f);
  }
  return true;
}

// Three offers for the player's Technique: distinct sacrifices, spread over
// the keys, preferring Pacts that would raise Resolve on the key they take.
export function pickOffers(game: Game, taken: ReadonlySet<string>, rng: () => number = Math.random): Offer[] {
  const book = game.book;
  const kit = KITS[game.techniqueId];
  const shapes = kit.shapes;
  const label = (s: string) => kit.shapes[s]?.label ?? s;
  const behavior = (b: string) => kit.behaviors[b] ?? b;
  const boundIds = new Set(KEY_SLOTS.map((s) => book.bound(s)?.id));
  const empty = EXTRA_SLOTS.filter((s) => !book.bound(s));
  const pool = candidates(game.techniqueId, empty).filter((p) => validatePact(p, shapes).ok);

  const offersFor = (strict: boolean): Offer[] => {
    const all: Offer[] = [];
    for (const pact of pool) {
      if (strict && (taken.has(pact.id) || boundIds.has(pact.id))) continue;
      const after = book.estimate(pact);
      if (strict && after.total < 1) continue;
      const current = pact.slot === 'passive' ? null : book.bound(pact.slot);
      const before = current ? book.estimate(current) : null;
      all.push({ pact, tags: tagsOf(pact), text: readback(pact, label, behavior), replaces: current?.name ?? null, before, after, stronger: !before || after.total > before.total + 0.25 });
    }
    const shuffled = all.map((o) => ({ o, k: rng() })).sort((a, b) => a.k - b.k).map((x) => x.o);
    return [...shuffled.filter((o) => o.stronger), ...shuffled.filter((o) => !o.stronger)];
  };

  let chosen: Offer[] = [];
  for (const strict of [true, false]) {
    const ordered = offersFor(strict);
    chosen = [];
    const fits = (o: Offer, spread: boolean): boolean => {
      if (chosen.includes(o) || !distinct([...chosen.map((c) => c.pact), o.pact])) return false;
      return !spread || !chosen.some((c) => c.pact.slot === o.pact.slot);
    };
    for (const spread of [true, false]) for (const o of ordered) if (chosen.length < 3 && fits(o, spread)) chosen.push(o);
    if (chosen.length >= 3) break;
  }
  return chosen;
}

// Rolls offers `rounds` times for the current Technique, taking a random one
// each round so the book changes, and returns every rule it saw broken. The
// book is put back afterwards. The scripted check drives this for all five
// Techniques.
export function audit(game: Game, rounds: number, rng: () => number = Math.random): string[] {
  const bad: string[] = [];
  const saved = game.book.export();
  const shapes = KITS[game.techniqueId].shapes;
  const taken = new Set<string>();
  for (let i = 0; i < rounds; i++) {
    const offers = pickOffers(game, i % 7 === 6 ? new Set() : taken, rng);
    const tags = offers.flatMap((o) => [...new Set(tagsOf(o.pact).map(family))]);
    const raw = offers.flatMap((o) => tagsOf(o.pact));
    if (offers.length !== 3) bad.push(`round ${i}: ${offers.length} offers`);
    if (new Set(tags).size !== tags.length || new Set(raw).size !== raw.length) bad.push(`round ${i}: shared sacrifice in ${offers.map((o) => o.pact.name).join(', ')}`);
    for (const o of offers) {
      if (!validatePact(o.pact, shapes).ok) bad.push(`round ${i}: ${o.pact.name} is not a valid Pact`);
      if (!/^"[^"]+" on .*unwritten\.$/.test(o.text) || /%/.test(o.text)) bad.push(`round ${i}: ${o.pact.name} reads wrong: ${o.text}`);
      if (o.tags.length === 0) bad.push(`round ${i}: ${o.pact.name} pays no sacrifice`);
    }
    const pick = offers[Math.floor(rng() * offers.length)];
    if (pick) { game.book.inscribe(pick.pact, shapes); taken.add(pick.pact.id); }
    if (i % 7 === 6) { game.book.import(saved); taken.clear(); }
  }
  game.book.import(saved);
  return bad;
}
