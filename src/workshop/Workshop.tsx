import { useState, useMemo } from 'preact/hooks';
import { signal } from '@preact/signals';
import type { Game } from '../app/game';
import { toast } from '../app/game';
import { type Pact, type Clause, type Param, type Restriction, PARAM_VALUES, PREDICTIONS, RISK_COSTS, validatePact, restrictions } from '../pacts/schema';
import { SLOTS, slotAccepts, slotDef, slotFor, type AbilitySlot } from '../pacts/slots';
import { keyLabel } from '../app/keymap';
import { readback, readbackSegments, slotWords, riskCost, prediction, triggerWords, type Focus as ReadbackFocus } from '../pacts/readback';
import { lineFor, type ResolveEstimate } from '../pacts/resolve';
import { KITS } from '../techniques/techniques';
import { tutorialUi } from '../tutorial/tutorial';
import { TermPicker, PARAM_WORDS, PARAM_COLOR, Worth } from './pickers';

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
  const [moveTo, setMoveTo] = useState<AbilitySlot | null>(null);
  const [hold, setHold] = useState(0);
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
    update({ ...base, id: `${kit.id}.${Date.now().toString(36)}`, inscribed: undefined, inscribedAt: undefined });
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
    game.audio.play('confirmation_002', 0.7);
    toast(`${pact.name} is inscribed and bound to ${slotWords(pact.slot)}.`, 'good');
    setConfirm(false);
  };
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

  return (
    <div class="sheet-wrap" style={{ '--c': `#${kit.color.toString(16).padStart(6, '0')}` } as never}>
      <div class="sheet ws-sheet" role="dialog" aria-label="Pact Workshop">
        <header>
          <h2><span class="jp">契約の工房</span><span class="en">Pact Workshop · {kit.name}</span></h2>
          {tutorial ? <Guide drafts={drafts} pact={pact} /> : <p class="lede">A Pact is a sacrifice written against your Technique. The more it costs you, the more it gives back.</p>}
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
                    {isDraft
                      ? <input value={pact.name} maxLength={48} aria-label="Pact name" onInput={(e) => update({ ...pact, name: (e.target as HTMLInputElement).value })} onFocus={(e) => (e.target as HTMLInputElement).select()} />
                      : <span class="fixed">{pact.name}</span>}
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
                          {!pact.clauses.some((c) => c.kind === 'wager') && <button class="chip" onClick={() => addClause({ kind: 'wager', predict: 'hit' })}>a wager, to bet on the outcome</button>}
                          <button class="chip" onClick={() => addClause({ kind: 'program', when: 'struck', then: 'activate' })}>a program, so it fires itself</button>
                        </div>
                      </>}
                      {focus.kind === 'add' && focus.param && <>
                        <PanelHead title={PARAM_WORDS[focus.param].title} hint={PARAM_WORDS[focus.param].hint} onBack={() => setFocus({ kind: 'add' })} />
                        <TermPicker param={focus.param} technique={game.techniqueId} value={undefined} weigh={weigh(focus.param)} onPick={(v) => setTerm(focus.param!, v)} />
                      </>}
                      {focus.kind === 'clause' && pact.clauses[focus.index] && <ClausePanel c={pact.clauses[focus.index]!} restricted={restrictions(pact).map((r) => r.param)} onChange={(c) => setClause(focus.index, c)} onRemove={() => removeClause(focus.index)} />}
                    </div>
                  )}
                  <ResolveBar est={est} onFocus={(f) => isDraft && setFocus(f)} />
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
              <button class="btn" disabled={!valid.ok} onClick={() => game.tryDraft(pact)}>Try it on the dummies</button>
              <button class="btn primary" disabled={!valid.ok} onClick={() => setConfirm(true)}>Inscribe</button>
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
        <div class="confirm" onMouseUp={() => setHold(0)}>
          <div class="box">
            <h3>Inscribe "{pact.name}"?</h3>
            <p>{readback(pact, shapeLabel, behaviorLabel)}</p>
            <p>This is permanent for this save. Hold the button to confirm.</p>
            <div style="display:flex;gap:8px;justify-content:flex-end">
              <button class="btn" onClick={() => setConfirm(false)}>Not yet</button>
              <button class="btn danger hold" onMouseDown={() => { const t0 = Date.now(); const iv = setInterval(() => { const f = Math.min(1, (Date.now() - t0) / 1100); setHold(f); if (f >= 1) { clearInterval(iv); inscribe(); } }, 30); const stop = () => { clearInterval(iv); setHold(0); window.removeEventListener('mouseup', stop); }; window.addEventListener('mouseup', stop); }}><i style={{ width: `${hold * 100}%` }} />Hold to inscribe</button>
            </div>
          </div>
        </div>
      )}
    </div>
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
  const steps = ['Choose + New Pact', 'Add a term: what you give up', 'Read it, then hold Inscribe'];
  return (
    <ol class="ws-guide" aria-label="Tutorial">
      {steps.map((s, i) => <li key={i} class={i < step ? 'done' : i === step ? 'now' : ''}><b>{i + 1}</b>{s}</li>)}
    </ol>
  );
}

function ClausePanel({ c, restricted, onChange, onRemove }: { c: Clause; restricted: Param[]; onChange: (c: Clause) => void; onRemove: () => void }) {
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
  if (c.kind === 'wager') return <>
    <PanelHead title="Wager" hint="declare it before the cast; wrong seals your Technique" onRemove={onRemove} />
    <div class="opts tiles four">{PREDICTIONS.map((p) => <button key={p} class={`opt ${c.predict === p ? 'on' : ''}`} onClick={() => onChange({ kind: 'wager', predict: p })}><span class="l">{prediction(p)}</span></button>)}</div>
  </>;
  if (c.kind !== 'program') return null;
  return <>
    <PanelHead title="Program" hint="an IF/THEN rule over this Pact" onRemove={onRemove} />
    <div class="chips"><span class="chips-l">When</span>{PARAM_VALUES.trigger.map((t) => <button key={t} class={`chip ${c.when === t ? 'on' : ''}`} onClick={() => onChange({ ...c, when: t as never })}>{triggerWords(t)}</button>)}</div>
    <div class="chips"><span class="chips-l">Then</span>{(['activate', 'suppress', 'prefer'] as const).map((t) => <button key={t} class={`chip ${c.then === t ? 'on' : ''}`} onClick={() => onChange({ ...c, then: t })}>{t === 'activate' ? 'it fires on its own' : t === 'suppress' ? 'it refuses to fire' : 'it takes precedence'}</button>)}</div>
  </>;
}

// One read of the whole Pact: a bar whose length is what the universe gives
// back, split by what each term paid for it.
function ResolveBar({ est, onFocus }: { est: ResolveEstimate; onFocus: (f: ReadbackFocus) => void }) {
  const paid = est.lines.reduce((a, l) => a + Math.max(0, l.value), 0) || 1;
  return (
    <div class="ws-resolve">
      <div class="top">
        <span class="t">Resolve</span>
        <div class="rbar" role="img" aria-label={`Resolve ${est.read}, ${est.total.toFixed(1)}`}>
          {est.lines.map((l, i) => l.value > 0 && <i key={i} style={{ width: `${(l.value / paid) * est.potency * 100}%`, background: PARAM_COLOR[l.param ?? 'clause'] }} title={`${l.label} +${l.value.toFixed(1)}: ${l.reason}`} />)}
        </div>
        <span class="read">{est.read}</span>
      </div>
      <div class="legend">
        {est.lines.length === 0 && <span class="none">No sacrifice yet, so the universe gives nothing beyond the raw Technique.</span>}
        {est.lines.map((l, i) => (
          <button key={i} class={`lg ${l.zero ? 'zero' : ''}`} disabled={!l.param} onClick={() => l.param && onFocus({ kind: 'term', param: l.param })} title={l.reason}>
            <i style={{ background: PARAM_COLOR[l.param ?? 'clause'] }} /><span>{l.label}</span>{l.value < 0 ? <span class="w">{l.value.toFixed(1)}</span> : <Worth line={l} />}
          </button>
        ))}
      </div>
    </div>
  );
}
