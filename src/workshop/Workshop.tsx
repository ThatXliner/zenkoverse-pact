import { useState, useMemo, useRef, useEffect } from 'preact/hooks';
import { useSheetKeys } from '../ui/useSheetKeys';
import { signal } from '@preact/signals';
import type { Game } from '../app/game';
import { toast } from '../app/game';
import { type Pact, type Clause, type Param, type Restriction, PARAM_VALUES, RISK_COSTS, validatePact, restrictions } from '../pacts/schema';
import { SLOTS, slotAccepts, slotDef, slotFor, type AbilitySlot } from '../pacts/slots';
import { keyLabel } from '../app/keymap';
import { readback, readbackSegments, slotWords, riskCost, triggerWords, type Focus as ReadbackFocus } from '../pacts/readback';
import { lineFor, type ResolveEstimate } from '../pacts/resolve';
import { KITS } from '../techniques/techniques';
import { tutorialUi } from '../tutorial/tutorial';
import { TermPicker, PARAM_WORDS, PARAM_COLOR, Worth } from './pickers';
import { DECLARATIONS, REWARDS, FORFEITS, DECLARE, REWARD, FORFEIT, rewardFits, stakeOf, wagerTag, type WagerTerms, type Stake } from '../pacts/wager';

// The readback sentence is the editor (issue #29). Every phrase the universe
// will enforce is a button; the panel under the sentence shows that term's
// alternatives; one Resolve bar reads the whole Pact. Numbers come from the
// engine, this surface only edits the Pact JSON.
type Focus = ReadbackFocus | { kind: 'add'; param?: Param } | null;

const selectedId = signal<string | null>(null);

const SUNSETS: Extract<Clause, { kind: 'sunset' }>[] = [{ kind: 'sunset', term: { encounters: 1 } }, { kind: 'sunset', term: { encounters: 3 } }, { kind: 'sunset', term: { encounters: 10 } }, { kind: 'sunset', term: { seconds: 30 } }, { kind: 'sunset', term: { seconds: 60 } }, { kind: 'sunset', term: { seconds: 180 } }];
const keyTitle = (s: AbilitySlot): string => (s === 'passive' ? 'No key' : slotWords(s).replace(/^./, (c) => c.toUpperCase()));

// What is bound to a slot right now, in the words the key picker shows.
function holder(book: Game['book'], kit: (typeof KITS)[keyof typeof KITS], slot: AbilitySlot): { name: string | null; text: string } {
  if (slot === 'passive') return { name: null, text: 'always on, no key' };
  const p = book.bound(slot);
  if (p) return { name: p.name, text: p.name };
  return { name: null, text: slotDef(slot).raw ? `raw ${kit.name}` : 'empty' };
}

export function Workshop({ game }: { game: Game }) {
  const kit = KITS[game.techniqueId];
  const book = game.book;
  const inscribed = book.forTechnique(book.inscribed.value);
  const drafts = book.forTechnique(book.drafts.value);
  const all = [...inscribed, ...drafts];
  const sel = selectedId.value && all.some((p) => p.id === selectedId.value) ? selectedId.value : (drafts[0] ?? book.bound('primary') ?? all[0])?.id ?? null;
  const pact = all.find((p) => p.id === sel) ?? null;
  const isDraft = !!pact && !pact.inscribed;
  const [focus, setFocus] = useState<Focus>(null);
  const [confirm, setConfirm] = useState(false);
  // A draft just made asks for its name: the field opens focused, its placeholder text selected.
  const [nameNew, setNameNew] = useState<string | null>(null);
  const [moveTo, setMoveTo] = useState<AbilitySlot | null>(null);
  const est = useMemo(() => (pact ? book.estimate(pact) : null), [pact, inscribed.length, book.bindings.value]);
  const valid = pact ? validatePact(pact, kit.shapes) : { ok: false, errors: [] };
  const shapeLabel = (s: string) => kit.shapes[s]?.label ?? s;
  const behaviorLabel = (b: string) => kit.behaviors[b] ?? b;
  const tutorial = tutorialUi.step.value?.id === 'pact';

  const select = (id: string) => { selectedId.value = id; setFocus(null); setConfirm(false); setMoveTo(null); };
  const update = (p: Pact) => { book.saveDraft(p); selectedId.value = p.id; };
  const newDraft = (from?: Pact) => {
    const shape = Object.keys(kit.shapes)[0]!;
    const base: Pact = from ? { ...structuredClone(from), name: `${from.name} (copy)` } : { id: '', technique: kit.id, name: 'New Pact', slot: 'primary', grant: { shape, behaviors: [] }, clauses: [] };
    const id = `${kit.id}.${Date.now().toString(36)}`;
    update({ ...base, id, inscribed: undefined, inscribedAt: undefined });
    setNameNew(id);
    setFocus(from ? null : { kind: 'add' });
    setConfirm(false);
  };
  const setClauses = (clauses: Clause[]) => { if (pact) update({ ...pact, clauses }); };
  const setTerm = (param: Param, value: string) => {
    if (!pact) return;
    const r = { param, value } as Restriction;
    const i = pact.clauses.findIndex((c) => c.kind === 'restrict' && c.restriction.param === param);
    const clauses = pact.clauses.slice();
    if (i < 0) clauses.push({ kind: 'restrict', restriction: r }); else clauses[i] = { kind: 'restrict', restriction: r };
    setClauses(clauses);
    setFocus({ kind: 'term', param });
  };
  const removeTerm = (param: Param) => { setClauses(pact!.clauses.filter((c) => !(c.kind === 'restrict' && c.restriction.param === param))); setFocus(null); };
  const addClause = (c: Clause) => { setClauses([...pact!.clauses, c]); setFocus({ kind: 'clause', index: pact!.clauses.length }); };
  const setClause = (index: number, c: Clause) => { const clauses = pact!.clauses.slice(); clauses[index] = c; setClauses(clauses); };
  const removeClause = (index: number) => { setClauses(pact!.clauses.filter((_, k) => k !== index)); setFocus(null); };
  const inscribe = () => {
    if (!pact) return;
    const r = book.inscribe(pact, kit.shapes);
    if (!r.ok) { toast(r.errors[0] ?? 'Invalid Pact', 'bad'); return; }
    game.tutorial.notify('inscribed');
    game.audio.play('ui.inscribe');
    toast(`${pact.name} is inscribed and bound to ${slotWords(pact.slot)}.`, 'good');
    setConfirm(false);
  };
  // Trying a draft that gives something up is the tutorial's Pact step.
  const tryIt = (p: Pact) => { if (restrictions(p).length) game.tutorial.notify('tried'); game.tryDraft(p); };
  const counted = pact ? book.counted(pact) : new Map<string, string>();
  const weigh = (param: Param) => (value: string) => lineFor({ param, value } as Restriction, counted, book.telemetry);
  const boundTo = (p: Pact) => p.slot !== 'passive' && book.binding(p.slot) === p.id;
  const kindsOf = (p: Pact) => kit.shapes[p.grant.shape]?.kinds ?? [];
  // A bound Pact moves to a slot that holds another Pact either by swapping
  // places, when the other fits where this one sits, or by replacing it.
  const pickSlot = (s: AbilitySlot) => {
    if (!pact) return;
    if (isDraft) { update({ ...pact, slot: s }); return; }
    const occupant = s !== 'passive' ? book.bound(s) : null;
    if (occupant && occupant.id !== pact.id) { setMoveTo(s); return; }
    book.place(pact.id, s, 'replace');
    setMoveTo(null);
  };
  const move = (how: 'replace' | 'swap') => { if (pact && moveTo) book.place(pact.id, moveTo, how); setMoveTo(null); };
  const focusKey = focus ? focusId(focus) : '';

  const sheet = useRef<HTMLDivElement>(null);
  useSheetKeys(sheet);
  return (
    <div class="sheet-wrap" style={{ '--c': `#${kit.color.toString(16).padStart(6, '0')}` } as never}>
      <div class="sheet ws-sheet" role="dialog" aria-label="Pact Workshop" ref={sheet}>
        <header>
          <h2><span class="jp">契約の工房</span><span class="en">Pact Workshop · {kit.name}</span></h2>
          {tutorial ? <Guide drafts={drafts} pact={pact} /> : <p class="lede">A Pact is a restriction you write onto your Technique. What it costs you, it pays back.</p>}
        </header>
        <div class="body">
          <div class="ws">
            <nav class="ws-book" aria-label="Your Pacts">
              {all.map((p) => (
                <button key={p.id} class={`bk ${p.id === sel ? 'on' : ''} ${boundTo(p) ? 'bound' : ''}`} onClick={() => select(p.id)}>
                  <span class="n">{p.name}</span>
                  <span class="s">{p.inscribed ? `${keyTitle(p.slot)} · ${boundTo(p) ? 'in use' : book.expired(p) ? 'term ended' : 'inscribed, not in use'}` : `Draft · ${restrictions(p).length} ${restrictions(p).length === 1 ? 'term' : 'terms'}`}</span>
                </button>
              ))}
              <button class={`bk new ${tutorial && !drafts.length ? 'pulse' : ''}`} onClick={() => newDraft()}><span class="n">+ New Pact</span><span class="s">start from the raw Technique</span></button>
            </nav>
            <div class="ws-edit">
              {pact && est ? (
                <>
                  <div class="ws-name">
                    <NameField key={pact.id} name={pact.name} invite={nameNew === pact.id} onName={(name) => (isDraft ? update({ ...pact, name }) : book.rename(pact.id, name))} />
                    <span class={`pill ${isDraft ? '' : 'sealed'}`}>{isDraft ? 'Draft' : boundTo(pact) ? `Inscribed · on ${slotWords(pact.slot)}` : 'Inscribed'}</span>
                  </div>
                  <p class="ws-sentence" aria-label="The terms, as the universe reads them">
                    {readbackSegments(pact, shapeLabel, behaviorLabel).map((s, i) => s.focus && (isDraft || s.focus.kind === 'key')
                      ? <button key={i} class={`ph ${focusKey === focusId(s.focus) ? 'on' : ''}`} onClick={() => { setFocus(s.focus!); setMoveTo(null); }}>{s.text}</button>
                      : s.focus ? <em key={i} class="ph ro">{s.text}</em> : <span key={i}>{s.text}</span>)}
                    {isDraft && <button class={`ph add ${focus?.kind === 'add' ? 'on' : ''}`} onClick={() => setFocus({ kind: 'add' })}>+ add a term</button>}
                  </p>
                  {focus && (isDraft || focus.kind === 'key') && (
                    <div class="ws-panel" key={focusKey}>
                      {focus.kind === 'key' && <>
                        <PanelHead title="Key" hint={isDraft ? 'which button fires it' : 'move it to another key'} />
                        <div class="opts tiles four slots">{SLOTS.filter((s) => s !== 'passive' || isDraft).map((s) => {
                          const h = holder(book, kit, s);
                          const fits = s === 'passive' || slotAccepts(s, kindsOf(pact));
                          const here = pact.slot === s;
                          return (
                            <button key={s} class={`opt ${here ? 'on' : ''}`} data-slot={s} disabled={!fits} onClick={() => pickSlot(s)}>
                              <span class="l">{s === 'passive' ? 'No key' : keyLabel(s)}{s !== 'passive' && <small>{slotDef(s).name}</small>}</span>
                              <span class="w">{!fits ? 'not for this shape' : isDraft ? (h.name ? `replaces ${h.name}` : h.text) : here ? 'where it sits' : h.text}</span>
                            </button>
                          );
                        })}</div>
                        {moveTo && (() => {
                          const other = book.bound(moveTo);
                          const from = book.slotOf(pact.id);
                          const canSwap = !!other && !!from && slotAccepts(from, kindsOf(other));
                          return (
                            <div class="ws-swap" role="alert" data-swap={moveTo}>
                              <span><b>{keyLabel(moveTo as never)}</b> holds <b>{other?.name}</b>.</span>
                              <span class="acts">
                                {canSwap && <button class="btn primary" onClick={() => move('swap')}>Swap · {other?.name} moves to {keyLabel(from as never)}</button>}
                                <button class="btn" onClick={() => move('replace')}>Replace · {other?.name} stays inscribed, unbound</button>
                                <button class="btn quiet" onClick={() => setMoveTo(null)}>Cancel</button>
                              </span>
                            </div>
                          );
                        })()}
                      </>}
                      {focus.kind === 'grant' && <>
                        <PanelHead title="What it does" hint="the shape the Technique takes" />
                        <div class="opts tiles four">{Object.entries(kit.shapes).map(([k, v]) => <button key={k} class={`opt ${pact.grant.shape === k ? 'on' : ''}`} onClick={() => update({ ...pact, grant: { ...pact.grant, shape: k }, slot: slotFor(v.kinds, pact.slot) })}><span class="l">{v.label}</span><span class="w">{v.description}</span></button>)}</div>
                        <div class="chips">
                          <span class="chips-l">And it also</span>
                          {Object.entries(kit.behaviors).map(([k, v]) => { const on = pact.grant.behaviors?.includes(k); return <button key={k} class={`chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => update({ ...pact, grant: { ...pact.grant, behaviors: on ? pact.grant.behaviors!.filter((b) => b !== k) : [...(pact.grant.behaviors ?? []), k] } })}>{v}</button>; })}
                        </div>
                      </>}
                      {focus.kind === 'term' && <>
                        <PanelHead title={PARAM_WORDS[focus.param].title} hint={PARAM_WORDS[focus.param].hint} onRemove={() => removeTerm(focus.param)} />
                        <TermPicker param={focus.param} technique={game.techniqueId} value={restrictions(pact).find((r) => r.param === focus.param)?.value} weigh={weigh(focus.param)} onPick={(v) => setTerm(focus.param, v)} />
                      </>}
                      {focus.kind === 'add' && !focus.param && <>
                        <PanelHead title="Add a term" hint="what will you give up?" />
                        <div class="opts tiles four">
                          {(Object.keys(PARAM_VALUES) as Param[]).filter((p) => kit.parameters.includes(p) && !restrictions(pact).some((r) => r.param === p)).map((p) => (
                            <button key={p} class="opt line" style={{ '--k': PARAM_COLOR[p] } as never} onClick={() => setFocus({ kind: 'add', param: p })}><span class="l dot">{PARAM_WORDS[p].title}</span><span class="w">{PARAM_WORDS[p].hint}</span></button>
                          ))}
                        </div>
                        <div class="chips">
                          <span class="chips-l">Or attach a clause</span>
                          {!pact.clauses.some((c) => c.kind === 'sunset') && <button class="chip" onClick={() => addClause(SUNSETS[0]!)}>a sunset, so the term ends</button>}
                          {restrictions(pact).length > 0 && <button class="chip" onClick={() => addClause({ kind: 'risk', beyond: restrictions(pact)[0]!.param, cost: 'health' })}>a risk, to push past a limit</button>}
                          {!pact.clauses.some((c) => c.kind === 'wager') && <button class="chip" onClick={() => addClause({ kind: 'wager', declare: 'hit', reward: 'output', forfeit: 'seal' })}>a wager, to bet on each cast</button>}
                          <button class="chip" onClick={() => addClause({ kind: 'program', when: 'struck', then: 'activate' })}>a program, so it fires itself</button>
                        </div>
                      </>}
                      {focus.kind === 'add' && focus.param && <>
                        <PanelHead title={PARAM_WORDS[focus.param].title} hint={PARAM_WORDS[focus.param].hint} onBack={() => setFocus({ kind: 'add' })} />
                        <TermPicker param={focus.param} technique={game.techniqueId} value={undefined} weigh={weigh(focus.param)} onPick={(v) => setTerm(focus.param!, v)} />
                      </>}
                      {focus.kind === 'clause' && pact.clauses[focus.index] && <ClausePanel c={pact.clauses[focus.index]!} stake={(w) => stakeOf(w, book.telemetry, counted.get(wagerTag(w)))} restricted={restrictions(pact).map((r) => r.param)} onChange={(c) => setClause(focus.index, c)} onRemove={() => removeClause(focus.index)} />}
                    </div>
                  )}
                  <Trade est={est} power={power(game, pact)} kit={kit.name} onFocus={(f) => isDraft && setFocus(f)} />
                  {!valid.ok && <p class="ws-error">{valid.errors[0]}</p>}
                </>
              ) : <p class="ws-empty">Pick a Pact from the list, or write a new one.</p>}
            </div>
          </div>
        </div>
        <footer>
          <div class="kbd-hint"><button class="btn quiet" onClick={() => game.closeWorkshop()}>Close</button><span><kbd>{keyLabel('pause')}</kbd> closes</span></div>
          {pact && isDraft && (
            <div class="actions">
              <button class="btn quiet" onClick={() => { book.deleteDraft(pact.id); selectedId.value = null; }}>Discard draft</button>
              <button class={`btn ${tutorial && restrictions(pact).length ? 'primary pulse' : ''}`} disabled={!valid.ok} onClick={() => tryIt(pact)}>Try it on the dummies</button>
              <button class={`btn ${tutorial ? '' : 'primary'}`} disabled={!valid.ok} onClick={() => setConfirm(true)}>Inscribe</button>
            </div>
          )}
          {pact && !isDraft && (
            <div class="actions">
              <button class="btn quiet" onClick={() => newDraft(pact)}>Copy to a new draft</button>
              {pact.slot !== 'passive' && (boundTo(pact)
                ? <button class="btn" onClick={() => book.bind(pact.slot, null)} title={kit.primitive.description}>Unbind · fight with the raw {kit.name}</button>
                : <button class="btn primary" disabled={book.expired(pact)} onClick={() => book.bind(pact.slot, pact.id)}>Bind to {slotWords(pact.slot)}</button>)}
            </div>
          )}
        </footer>
      </div>
      {confirm && pact && (
        <div class="confirm">
          <div class="box" role="alertdialog" aria-label={`Inscribe ${pact.name}`}>
            <h3>Inscribe "{pact.name}"?</h3>
            <p>{readback(pact, shapeLabel, behaviorLabel)}</p>
            <p>This is permanent for this save. Hold the button, or hold Enter on it, to confirm.</p>
            <div class="acts">
              <button class="btn" onClick={() => setConfirm(false)}>Not yet</button>
              <HoldButton label="Hold to inscribe" onDone={inscribe} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// The Pact's name, which is only what the player calls it: a draft's or an
// inscribed Pact's, renamed in place. It reads as a field (a box, a pen,
// a placeholder), commits as it is typed, and keeps every key to itself so
// Q, E, the arrows and Enter edit text; Enter or Esc only leave the field.
function NameField({ name, invite, onName }: { name: string; invite: boolean; onName: (name: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(name);
  useEffect(() => { if (document.activeElement !== ref.current) setText(name); }, [name]);
  useEffect(() => { if (invite) { ref.current?.focus({ preventScroll: true }); ref.current?.select(); } }, [invite]);
  return (
    <label class="ws-name-field" title="Rename this Pact">
      <span class="pen" aria-hidden="true">✎</span>
      <input ref={ref} value={text} maxLength={48} placeholder="Name this Pact" aria-label="Pact name" spellcheck={false}
        onInput={(e) => { const v = (e.target as HTMLInputElement).value; setText(v); if (v.trim()) onName(v.trim()); }}
        onBlur={() => setText(name)}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); ref.current?.blur(); } }} />
    </label>
  );
}

function focusId(f: NonNullable<Focus>): string { return f.kind === 'term' ? `term:${f.param}` : f.kind === 'clause' ? `clause:${f.index}` : f.kind === 'add' ? `add:${f.param ?? ''}` : f.kind; }

function PanelHead({ title, hint, onRemove, onBack }: { title: string; hint: string; onRemove?: () => void; onBack?: () => void }) {
  return (
    <div class="panel-head">
      {onBack && <button class="link" onClick={onBack}>← other terms</button>}
      <span class="t">{title}</span><span class="h">{hint}</span>
      {onRemove && <button class="link remove" onClick={onRemove}>Remove this term</button>}
    </div>
  );
}

// The tutorial's Pact step, told from inside the Workshop so the card the
// player was following does not vanish when the sheet opens.
function Guide({ drafts, pact }: { drafts: Pact[]; pact: Pact | null }) {
  const draft = pact && !pact.inscribed ? pact : drafts[0] ?? null;
  const step = !draft ? 0 : restrictions(draft).length === 0 ? 1 : 2;
  const steps = ['+ New Pact', 'Add a term: what you give up', 'Try it on the dummies'];
  return (
    <ol class="ws-guide" aria-label="Tutorial">
      {steps.map((s, i) => <li key={i} class={i < step ? 'done' : i === step ? 'now' : ''}><b>{i + 1}</b>{s}</li>)}
    </ol>
  );
}

function ClausePanel({ c, stake, restricted, onChange, onRemove }: { c: Clause; stake: (w: WagerTerms) => Stake; restricted: Param[]; onChange: (c: Clause) => void; onRemove: () => void }) {
  if (c.kind === 'sunset') {
    const same = (a: Extract<Clause, { kind: 'sunset' }>) => JSON.stringify(a.term) === JSON.stringify(c.term);
    return <>
      <PanelHead title="Sunset" hint="the term ends, the Pact remains" onRemove={onRemove} />
      <div class="opts tiles six">{SUNSETS.map((s, i) => <button key={i} class={`opt ${same(s) ? 'on' : ''}`} onClick={() => onChange(s)}><span class="l">{'seconds' in s.term ? `${s.term.seconds} seconds` : `${s.term.encounters} ${s.term.encounters === 1 ? 'fight' : 'fights'}`}</span><span class="w">{'seconds' in s.term ? 'from when it is invoked' : 'then it rests'}</span></button>)}</div>
    </>;
  }
  if (c.kind === 'risk') return <>
    <PanelHead title="Risk" hint="push past a limit and pay for it" onRemove={onRemove} />
    <div class="chips"><span class="chips-l">Past the</span>{restricted.map((p) => <button key={p} class={`chip ${c.beyond === p ? 'on' : ''}`} onClick={() => onChange({ ...c, beyond: p })}>{PARAM_WORDS[p].title.toLowerCase()} limit</button>)}</div>
    <div class="opts tiles four">{RISK_COSTS.map((k) => <button key={k} class={`opt ${c.cost === k ? 'on' : ''}`} onClick={() => onChange({ ...c, cost: k })}><span class="l">{k === 'health' ? 'Pay in health' : k === 'exhaustion' ? 'Pay in exhaustion' : 'Pay with a seal'}</span><span class="w">{riskCost(k)}</span></button>)}</div>
  </>;
  if (c.kind === 'wager') return <WagerPanel c={c} stake={stake} onChange={onChange} onRemove={onRemove} />;
  if (c.kind !== 'program') return null;
  return <>
    <PanelHead title="Program" hint="an IF/THEN rule over this Pact" onRemove={onRemove} />
    <div class="chips"><span class="chips-l">When</span>{PARAM_VALUES.trigger.map((t) => <button key={t} class={`chip ${c.when === t ? 'on' : ''}`} onClick={() => onChange({ ...c, when: t as never })}>{triggerWords(t)}</button>)}</div>
    <div class="chips"><span class="chips-l">Then</span>{(['activate', 'suppress', 'prefer'] as const).map((t) => <button key={t} class={`chip ${c.then === t ? 'on' : ''}`} onClick={() => onChange({ ...c, then: t })}>{t === 'activate' ? 'it fires on its own' : t === 'suppress' ? 'it refuses to fire' : 'it takes precedence'}</button>)}</div>
  </>;
}

// A Wager's three parts, each chosen against what it does to the stake: the
// Declaration (and how often this player calls it right), the Reward a right
// call pays, and the Forfeit a wrong one lands. The stake only grows with
// real doubt and real loss, and the reward is sized by it.
function WagerPanel({ c, stake, onChange, onRemove }: { c: Extract<Clause, { kind: 'wager' }>; stake: (w: WagerTerms) => Stake; onChange: (c: Clause) => void; onRemove: () => void }) {
  const now = stake(c);
  const set = (w: Partial<WagerTerms>) => {
    const next = { ...c, ...w };
    if (!rewardFits(next.declare, next.reward)) next.reward = 'charge';
    onChange(next);
  };
  return <>
    <PanelHead title="Wager" hint="every cast declares it; you write what a right call pays and a wrong one costs" onRemove={onRemove} />
    <div class="chips" data-row><span class="chips-l">Each cast declares that</span>{DECLARATIONS.map((d) => (
      <button key={d} class={`chip ${c.declare === d ? 'on' : ''}`} aria-pressed={c.declare === d} onClick={() => set({ declare: d })}>{DECLARE[d].words} <small>· true {Math.round(stake({ ...c, declare: d }).odds * 100)}% of the time</small></button>
    ))}</div>
    <div class="wg-cols">
      <div class="wg-col">
        <span class="chips-l">Called right, it pays</span>
        <div class="opts list">{REWARDS.map((r) => (
          <button key={r} class={`opt line ${c.reward === r ? 'on' : ''}`} aria-pressed={c.reward === r} disabled={!rewardFits(c.declare, r)} onClick={() => set({ reward: r })}>
            <span class="l">{REWARD[r].title}</span><span class="w">{rewardFits(c.declare, r) ? REWARD[r].short(REWARD[r].amount(now.stake)) : 'only on "it lands"'}</span>
          </button>
        ))}</div>
      </div>
      <div class="wg-col">
        <span class="chips-l">Called wrong, it costs</span>
        <div class="opts list">{FORFEITS.map((f) => (
          <button key={f} class={`opt line ${c.forfeit === f ? 'on' : ''}`} aria-pressed={c.forfeit === f} onClick={() => set({ forfeit: f })}>
            <span class="l">{FORFEIT[f].short}</span><span class="w">stake {stake({ ...c, forfeit: f }).stake.toFixed(1)}</span>
          </button>
        ))}</div>
      </div>
    </div>
    <p class={`wg-read ${now.stake < 0.5 ? 'warn' : ''}`}>Stake {now.stake.toFixed(1)}: {now.reason}.</p>
  </>;
}

// What the Pact would hit with, against the raw Technique and against the
// Pact it would replace on its key. `potency` is the engine's own number.
interface Power { pact: number; raw: number; holder: { name: string; value: number } | null }
function power(game: Game, pact: Pact): Power {
  const t = game.techniques;
  const held = pact.slot !== 'passive' ? game.book.bound(pact.slot) : null;
  return { pact: t.potency(pact), raw: t.potency(null), holder: held && held.id !== pact.id ? { name: held.name, value: t.potency(held) } : null };
}

// The trade, both sides at once: what each term takes from you, in the
// words of what you can no longer do, and what the whole Pact pays back.
// The Resolve bar on the left is split by term; the bars on the right are
// the strength of a cast with this Pact, the raw Technique, and whatever
// holds the key now.
function Trade({ est, power: p, kit, onFocus }: { est: ResolveEstimate; power: Power; kit: string; onFocus: (f: ReadbackFocus) => void }) {
  const paid = est.lines.reduce((a, l) => a + Math.max(0, l.value), 0) || 1;
  const top = Math.max(p.pact, p.raw, p.holder?.value ?? 0);
  const w = est.wager;
  const times = (v: number) => `×${(v / p.raw).toFixed(1)}`;
  const rows: { label: string; value: number; me?: boolean }[] = [
    { label: 'This Pact', value: p.pact, me: true },
    ...(p.holder ? [{ label: `${p.holder.name} (on that key now)`, value: p.holder.value }] : []),
    { label: `Raw ${kit}`, value: p.raw },
  ];
  return (
    <div class="ws-trade">
      <section class="give" aria-label="What it costs you">
        <header><span class="t">It costs you</span><span class="read">{est.read}</span></header>
        <div class="rbar" role="img" aria-label={`Resolve ${est.read}, ${est.total.toFixed(1)}`}>
          {est.lines.map((l, i) => l.value > 0 && <i key={i} style={{ width: `${(l.value / paid) * est.potency * 100}%`, background: PARAM_COLOR[l.param ?? 'clause'] }} />)}
        </div>
        {est.lines.length === 0
          ? <p class="none">Nothing yet, so it pays back nothing. Add a term: what will you give up?</p>
          : <ul class="legend">{est.lines.map((l, i) => (
            <li key={i}>
              <button class={`lg ${l.zero ? 'zero' : ''}`} disabled={!l.param} onClick={() => l.param && onFocus({ kind: 'term', param: l.param })}>
                <i style={{ background: PARAM_COLOR[l.param ?? 'clause'] }} /><span class="l">{l.label}</span>{l.value < 0 ? <span class="w">{l.value.toFixed(1)}</span> : <Worth line={l} />}
              </button>
              <span class="why">{l.reason}</span>
            </li>
          ))}</ul>}
        {w && <div class="wg-line">
          <span class="l">賭 Wager: {DECLARE[w.declare].words}</span>
          <span class="why">Called wrong, {FORFEIT[w.forfeit].words}. {cap(w.reason)}.</span>
        </div>}
      </section>
      <section class="get" aria-label="What it pays back">
        <header><span class="t">It pays back</span><span class="read">{times(p.pact)}</span></header>
        <ul class="power">{rows.map((r) => (
          <li key={r.label} class={r.me ? 'me' : ''}>
            <span class="l">{r.label}</span>
            <span class="bar"><i style={{ width: `${(r.value / top) * 100}%` }} /></span>
            <span class="v">{times(r.value)}</span>
          </li>
        ))}</ul>
        <p class="note">Every hit, push and catch this key makes scales with it.</p>
        {w && <div class="wg-line pay">
          <span class="l">賭 Called right: {REWARD[w.reward].short(w.amount)}</span>
          <span class="why">{w.stake > 0 ? `About ${Math.round(w.odds * 100)}% of casts, at stake ${w.stake.toFixed(1)}.` : 'Nothing is at stake, so a right call pays nothing.'}</span>
        </div>}
      </section>
    </div>
  );
}

// A button that acts only once it has been held down: by pointer, by touch,
// or by Enter or Space while it has focus. Letting go early cancels.
function HoldButton({ label, onDone, ms = 1100 }: { label: string; onDone: () => void; ms?: number }) {
  const [f, setF] = useState(0);
  const run = useRef<{ t0: number; raf: number } | null>(null);
  const stop = () => { if (run.current) cancelAnimationFrame(run.current.raf); run.current = null; setF(0); };
  const start = () => {
    if (run.current) return;
    const t0 = performance.now();
    const tick = () => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      setF(k);
      if (k >= 1) { run.current = null; onDone(); return; }
      run.current = { t0, raf: requestAnimationFrame(tick) };
    };
    run.current = { t0, raf: requestAnimationFrame(tick) };
  };
  const el = useRef<HTMLButtonElement>(null);
  // The dialog opens on this button, so Enter can be held at once.
  useEffect(() => { el.current?.focus({ preventScroll: true }); return stop; }, []);
  const key = (e: KeyboardEvent) => e.key === 'Enter' || e.key === ' ';
  return (
    <button class="btn danger hold" ref={el}
      onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); start(); }}
      onPointerUp={stop} onPointerCancel={stop} onPointerLeave={stop}
      onKeyDown={(e) => { if (key(e)) { e.preventDefault(); if (!e.repeat) start(); } }}
      onKeyUp={(e) => { if (key(e)) stop(); }}
      onBlur={stop}
      onClick={(e) => e.preventDefault()}>
      <i style={{ width: `${f * 100}%` }} />{label}
    </button>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
