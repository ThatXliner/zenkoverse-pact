import { useState, useMemo } from 'preact/hooks';
import type { Game } from '../app/game';
import { setState } from '../app/state';
import { toast } from '../app/game';
import { type Pact, type Clause, type Param, type AbilitySlot, PARAM_VALUES, PREDICTIONS, RISK_COSTS, validatePact, restrictions, PACT_SCHEMA } from '../pacts/schema';
import { readback } from '../pacts/readback';
import { KITS } from '../techniques/techniques';
import { describe } from '../pacts/resolve';

// Structured Pact builder: the fallback authoring path (issue #16). All
// Resolve and magnitude numbers come from the engine; this surface only
// edits the Pact JSON and shows the readback before the deliberate confirm.
export function Workshop({ game }: { game: Game }) {
  const kit = KITS[game.techniqueId];
  const book = game.book;
  const inscribed = book.forTechnique(book.inscribed.value);
  const drafts = book.forTechnique(book.drafts.value);
  const [sel, setSel] = useState<string | null>(drafts[0]?.id ?? null);
  const [confirm, setConfirm] = useState(false);
  const [hold, setHold] = useState(0);
  const [tab, setTab] = useState<'write' | 'inscribed' | 'schema'>('write');
  const draft = drafts.find((d) => d.id === sel) ?? null;
  const est = useMemo(() => (draft ? book.estimate(draft) : null), [draft, inscribed.length]);
  const valid = draft ? validatePact(draft, Object.keys(kit.shapes)) : { ok: false, errors: [] };
  const shapeLabel = (s: string) => kit.shapes[s]?.label ?? s;
  const behaviorLabel = (b: string) => kit.behaviors[b] ?? b;

  const update = (p: Pact) => { book.saveDraft(p); setSel(p.id); };
  const newDraft = () => {
    const shape = Object.keys(kit.shapes)[0]!;
    const p: Pact = { id: `${kit.id}.${Date.now().toString(36)}`, technique: kit.id, name: 'Untitled Pact', slot: 'primary', grant: { shape, behaviors: [] }, clauses: [] };
    update(p);
  };
  const addClause = (c: Clause) => { if (!draft) return; update({ ...draft, clauses: [...draft.clauses, c] }); };
  const setClause = (i: number, c: Clause) => { if (!draft) return; const clauses = draft.clauses.slice(); clauses[i] = c; update({ ...draft, clauses }); };
  const removeClause = (i: number) => { if (!draft) return; update({ ...draft, clauses: draft.clauses.filter((_, k) => k !== i) }); };
  const close = () => { setState({ kind: 'explore' }); game.input.requestLock(); game.audio.play('close_001', 0.4); };
  const inscribe = () => {
    if (!draft) return;
    const r = book.inscribe(draft, Object.keys(kit.shapes));
    if (!r.ok) { toast(r.errors[0] ?? 'Invalid Pact', 'bad'); return; }
    game.audio.play('confirmation_002', 0.7);
    toast(`${draft.name} is inscribed. It cannot be unwritten.`, 'good');
    setConfirm(false);
    setSel(book.forTechnique(book.drafts.value)[0]?.id ?? null);
  };
  const usedParams = new Set(draft ? restrictions(draft).map((r) => r.param) : []);
  const counted = new Set(inscribed.flatMap((p) => restrictions(p).map((r) => `${r.param}:${r.value}`)));

  return (
    <div class="sheet-wrap" style={{ '--c': `#${kit.color.toString(16).padStart(6, '0')}` } as never}>
      <div class="sheet" role="dialog" aria-label="Pact Workshop">
        <header>
          <div style="min-width:0">
            <div class="kicker">Pact Workshop · {kit.name}</div>
            <h2>契約の工房</h2>
          </div>
          <div class="tabs" role="tablist">
            {(['write', 'inscribed', 'schema'] as const).map((t) => <button key={t} role="tab" class={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t === 'write' ? 'Write' : t === 'inscribed' ? `Inscribed (${inscribed.length})` : 'Schema'}</button>)}
          </div>
        </header>
        <div class="body">
          {tab === 'write' && (
            <div class="ws">
              <div>
                <h4>Drafts</h4>
                <div class="ws-list">
                  {drafts.map((d) => <button key={d.id} class={d.id === sel ? 'on' : ''} onClick={() => setSel(d.id)}><span class="n">{d.name}</span><span class="s">{d.slot} · {restrictions(d).length} terms</span></button>)}
                  <button onClick={newDraft}><span class="n">+ New Pact</span><span class="s">start from the raw Technique</span></button>
                </div>
                <h4 style="margin-top:18px">The Technique</h4>
                <p style="font-size:12px;line-height:1.6;color:var(--mist);margin:0">{kit.primitive.description}</p>
              </div>
              <div>
                {draft ? (
                  <>
                    <div class="name-row">
                      <input value={draft.name} maxLength={48} aria-label="Pact name" onInput={(e) => update({ ...draft, name: (e.target as HTMLInputElement).value })} />
                      <select value={draft.slot} aria-label="Key" onChange={(e) => update({ ...draft, slot: (e.target as HTMLSelectElement).value as AbilitySlot })}>
                        <option value="primary">LMB</option><option value="secondary">RMB</option><option value="max">Q · Max</option><option value="passive">Passive</option>
                      </select>
                    </div>
                    <h4>Grant</h4>
                    <div class="clauses">
                      <div class="clause">
                        <span class="k">shape</span>
                        <select value={draft.grant.shape} onChange={(e) => update({ ...draft, grant: { ...draft.grant, shape: (e.target as HTMLSelectElement).value } })}>
                          {Object.entries(kit.shapes).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                        </select>
                        <span />
                      </div>
                      <div class="clause">
                        <span class="k">behaviors</span>
                        <div style="display:flex;gap:6px;flex-wrap:wrap">
                          {Object.entries(kit.behaviors).map(([k, v]) => {
                            const on = draft.grant.behaviors?.includes(k);
                            return <button key={k} class="btn" style={{ padding: '4px 8px', fontSize: '10px', opacity: on ? 1 : 0.5, borderColor: on ? 'var(--c)' : undefined }} title={v} onClick={() => update({ ...draft, grant: { ...draft.grant, behaviors: on ? draft.grant.behaviors!.filter((b) => b !== k) : [...(draft.grant.behaviors ?? []), k] } })}>{k}</button>;
                          })}
                        </div>
                        <span />
                      </div>
                    </div>
                    <h4 style="margin-top:18px">Terms</h4>
                    <div class="clauses">
                      {draft.clauses.map((c, i) => <ClauseRow key={i} c={c} onChange={(n) => setClause(i, n)} onRemove={() => removeClause(i)} restricted={restrictions(draft).map((r) => r.param)} />)}
                      {draft.clauses.length === 0 && <p style="font-size:12px;color:var(--dim);margin:0">No terms yet. A Pact with no sacrifice is the baseline: conscious activation and nothing more.</p>}
                    </div>
                    <div class="add-row">
                      {(Object.keys(PARAM_VALUES) as Param[]).filter((p) => !usedParams.has(p) && kit.parameters.includes(p)).map((p) => <button key={p} onClick={() => addClause({ kind: 'restrict', restriction: { param: p, value: PARAM_VALUES[p][0] } as never })}>+ {p}</button>)}
                      {!draft.clauses.some((c) => c.kind === 'sunset') && <button onClick={() => addClause({ kind: 'sunset', term: { encounters: 1 } })}>+ sunset</button>}
                      {restrictions(draft).length > 0 && <button onClick={() => addClause({ kind: 'risk', beyond: restrictions(draft)[0]!.param, cost: 'health' })}>+ risk</button>}
                      {!draft.clauses.some((c) => c.kind === 'wager') && <button onClick={() => addClause({ kind: 'wager', predict: 'hit' })}>+ wager</button>}
                      <button onClick={() => addClause({ kind: 'program', when: 'struck', then: 'activate' })}>+ program</button>
                    </div>
                    <div style="display:flex;gap:8px;margin-top:18px">
                      <button class="btn danger" onClick={() => { book.deleteDraft(draft.id); setSel(null); }}>Discard draft</button>
                    </div>
                  </>
                ) : <p style="color:var(--dim)">Pick a draft or write a new Pact.</p>}
              </div>
              <div>
                {draft && est && (
                  <>
                    <h4>The terms, as the universe reads them</h4>
                    <div class="readback"><span class="q">Readback</span>{readback(draft, shapeLabel, behaviorLabel)}</div>
                    <div class="resolve">
                      <div class="big">{est.total.toFixed(1)}<small>{est.read}</small></div>
                      <ul>
                        {est.lines.map((l, i) => <li key={i} class={l.zero ? 'zero' : l.warn ? 'warn' : ''} title={l.reason}><span>{l.label}</span><span>{l.value > 0 ? '+' : ''}{l.value.toFixed(1)}</span></li>)}
                      </ul>
                      {est.lines.some((l) => l.zero) && <p style="font-size:11px;color:#ffb347;margin:6px 0 0">Anti-loophole: a sacrifice already counted by an inscribed Pact earns nothing again.</p>}
                      {restrictions(draft).some((r) => counted.has(`${r.param}:${r.value}`)) && null}
                    </div>
                    <div class="effect-pre">
                      <span>Potency <b>{Math.round((0.25 + est.potency * 0.75) * 100)}%</b> of a fully committed cast</span>
                      <span>Terms: {restrictions(draft).map(describe).join(', ') || 'none'}</span>
                    </div>
                    {!valid.ok && <p style="font-size:12px;color:var(--accent)">{valid.errors[0]}</p>}
                    <button class="btn primary" disabled={!valid.ok} onClick={() => setConfirm(true)}>Inscribe</button>
                  </>
                )}
              </div>
            </div>
          )}
          {tab === 'inscribed' && (
            <div class="ws-list" style="max-width:720px">
              {inscribed.length === 0 && <p style="color:var(--dim)">Nothing inscribed. You fight with the raw Technique.</p>}
              {inscribed.map((p) => <div key={p.id} class="readback" style="margin-bottom:10px"><span class="q">{p.name} · {p.slot}{book.expired(p) ? ' · term ended' : ''}</span>{readback(p, shapeLabel, behaviorLabel)}</div>)}
            </div>
          )}
          {tab === 'schema' && (
            <pre style="font-size:11px;line-height:1.5;color:var(--mist);white-space:pre-wrap;max-width:860px;margin:0">{JSON.stringify(PACT_SCHEMA, null, 2)}</pre>
          )}
        </div>
        <footer>
          <div class="kbd-hint"><span><kbd>Esc</kbd> close</span><span><kbd>Tab</kbd> toggle</span></div>
          <button class="btn" onClick={close}>Return to the street</button>
        </footer>
      </div>
      {confirm && draft && (
        <div class="confirm" onMouseUp={() => setHold(0)}>
          <div class="box">
            <h3>Inscribe {draft.name}?</h3>
            <p>{readback(draft, shapeLabel, behaviorLabel)}</p>
            <p>This is permanent for this save. Hold to confirm.</p>
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

function ClauseRow({ c, onChange, onRemove, restricted }: { c: Clause; onChange: (c: Clause) => void; onRemove: () => void; restricted: Param[] }) {
  const sel = (value: string, options: readonly string[], set: (v: string) => void, label: (v: string) => string = (v) => v) => (
    <select value={value} onChange={(e) => set((e.target as HTMLSelectElement).value)}>{options.map((o) => <option key={o} value={o}>{label(o)}</option>)}</select>
  );
  let body;
  if (c.kind === 'restrict') body = <>{sel(c.restriction.value, PARAM_VALUES[c.restriction.param], (v) => onChange({ kind: 'restrict', restriction: { param: c.restriction.param, value: v } as never }), (v) => describe({ param: c.restriction.param, value: v } as never))}</>;
  else if (c.kind === 'sunset') body = <div style="display:flex;gap:6px">{sel('seconds' in c.term ? 'seconds' : 'encounters', ['encounters', 'seconds'], (v) => onChange({ kind: 'sunset', term: v === 'seconds' ? { seconds: 60 } : { encounters: 1 } }))}<input type="number" value={'seconds' in c.term ? c.term.seconds : c.term.encounters} min={'seconds' in c.term ? 5 : 1} max={'seconds' in c.term ? 600 : 10} onInput={(e) => { const n = Number((e.target as HTMLInputElement).value); onChange({ kind: 'sunset', term: 'seconds' in c.term ? { seconds: n } : { encounters: n } }); }} /></div>;
  else if (c.kind === 'risk') body = <div style="display:flex;gap:6px">{sel(c.beyond, restricted, (v) => onChange({ ...c, beyond: v as Param }))}{sel(c.cost, RISK_COSTS, (v) => onChange({ ...c, cost: v as never }))}</div>;
  else if (c.kind === 'wager') body = sel(c.predict, PREDICTIONS, (v) => onChange({ kind: 'wager', predict: v as never }));
  else body = <div style="display:flex;gap:6px">{sel(c.when, PARAM_VALUES.trigger, (v) => onChange({ ...c, when: v as never }))}{sel(c.then, ['activate', 'suppress', 'prefer'], (v) => onChange({ ...c, then: v as never }))}</div>;
  const k = c.kind === 'restrict' ? c.restriction.param : c.kind;
  return <div class="clause"><span class="k">{k}</span>{body}<button class="x" aria-label="remove" onClick={onRemove}>×</button></div>;
}
