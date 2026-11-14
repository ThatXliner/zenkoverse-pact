import { useEffect, useState } from 'preact/hooks';
import type { Game } from '../app/game';
import { keyLabel } from '../app/keymap';
import { auraUi, fieldWords } from '../combat/aura';
import { clashUi, PICK_WORDS, TELL_WORDS, type ClashView } from '../combat/clash';
import { PICKS, type Pick } from '../net/clash';
import './aura.css';

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const pct = (x: number) => Math.round(x * 100);

// The aura meter under the vitals: the pool or the open field's time, the
// state in words, and refinement against its potential.
export function AuraMeter() {
  const f = auraUi.field.value;
  const tr = auraUi.training.value;
  const w = fieldWords(f);
  const fill = f.state === 'open' ? f.left / Math.max(0.1, f.holds) : f.pool;
  const capped = tr.trained > tr.potential + 0.004;
  return (
    <div class={`aura-meter ${f.state} ${f.ended ?? ''}`} data-aura={f.state}>
      <span class="lbl"><b class="jp">気</b> Aura · {w.state}</span>
      <span class="val">{w.detail}</span>
      <div class="track"><i style={{ width: `${Math.max(0, Math.min(1, fill)) * 100}%` }} /><s style={{ left: `${pct(tr.potential)}%` }} /></div>
      <span class="sub" title="Refinement sets how dense and strong your field is. Its potential falls as your Technique is broader and as you inscribe more Pacts.">
        Refinement <b>{pct(tr.refinement)}</b> of potential <b>{pct(tr.potential)}</b>{capped ? ` · trained ${pct(tr.trained)}, held by potential` : ''}
      </span>
      {f.guardBroken && <span class="broken">Guard broken: blows land harder</span>}
    </div>
  );
}

const KEYS: Record<Pick, () => string> = {
  push: () => keyLabel('forward'),
  hold: () => keyLabel('back'),
  feint: () => `${keyLabel('left')} ${keyLabel('right')}`,
};
const BEATS: Record<Pick, Pick> = { push: 'hold', hold: 'feint', feint: 'push' };

// The clash sheet: letterbox bars, the two names and their exchanges won,
// the three picks with their keys, the Master's tell, and each reveal.
export function ClashLayer({ game }: { game: Game }) {
  const c = clashUi.value;
  if (!c) return null;
  return (
    <div class={`clash-layer ${c.stage}`} data-clash={c.stage} style={{ '--them': hex(c.themColor) } as never}>
      <div class="bars"><i /><i /></div>
      <header>
        <div class="side me"><span class="who">You</span><Pips n={c.score[0]} of={2} /></div>
        <div class="mid"><span class="jp">気合</span><span class="kicker">Aura Clash{c.round ? ` · exchange ${c.round} of ${c.rounds}` : ''}</span></div>
        <div class="side them"><Pips n={c.score[1]} of={2} /><span class="who">{c.them}</span></div>
      </header>
      {c.stage === 'choose' && <Timer c={c} />}
      {c.stage === 'choose' && <p class="tell" data-tell={c.tell ?? ''}>{c.tell ? TELL_WORDS[c.tell] : c.online ? `${c.them} is choosing.` : 'Watch her body and her field.'}</p>}
      {(c.stage === 'reveal' || c.stage === 'over') && c.theirs && c.mine && <Reveal c={c} />}
      {c.stage === 'over' && <p class={`result ${c.result}`}>{c.result === 'won' ? 'Their field collapses. Your opening.' : c.result === 'lost' ? 'Your field collapses. Guard broken.' : 'Both fields break.'}</p>}
      <div class="picks" role="group" aria-label="Clash picks">
        {PICKS.map((p) => (
          <button key={p} class={`pick ${c.mine === p ? 'on' : ''}`} data-pick={p} disabled={c.stage !== 'choose' || !!c.mine} onClick={() => game.aura.clash.choose(p)}>
            <kbd>{KEYS[p]()}</kbd>
            <span class="g jp">{PICK_WORDS[p].jp}</span>
            <span class="n">{PICK_WORDS[p].en}</span>
            <span class="b">beats {PICK_WORDS[BEATS[p]].en.toLowerCase()}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Pips({ n, of }: { n: number; of: number }) {
  return <span class="pips">{Array.from({ length: of }, (_, i) => <i key={i} class={i < n ? 'on' : ''} />)}</span>;
}

function Timer({ c }: { c: ClashView }) {
  const [now, setNow] = useState(performance.now());
  useEffect(() => { let id = 0; const tick = () => { setNow(performance.now()); id = requestAnimationFrame(tick); }; id = requestAnimationFrame(tick); return () => cancelAnimationFrame(id); }, []);
  const left = Math.max(0, Math.min(1, (c.closes - now) / c.window));
  return <div class="timer"><i style={{ transform: `scaleX(${c.mine ? 1 : left})` }} class={c.mine ? 'done' : ''} /></div>;
}

function Reveal({ c }: { c: ClashView }) {
  const mine = c.mine!, theirs = c.theirs!;
  return (
    <div class={`reveal took-${c.took}`}>
      <span class="r me"><b class="jp">{PICK_WORDS[mine].jp}</b>{PICK_WORDS[mine].en}</span>
      <span class="vs">{c.took === 'me' ? '>' : c.took === 'them' ? '<' : '='}</span>
      <span class="r them"><b class="jp">{PICK_WORDS[theirs].jp}</b>{PICK_WORDS[theirs].en}</span>
      <span class="why">{c.took === 'none' ? 'Even: neither field gives' : mine === theirs ? `Same pick: the denser field ${c.took === 'me' ? '(yours)' : '(theirs)'} holds` : `${PICK_WORDS[c.took === 'me' ? mine : theirs].en} beats ${PICK_WORDS[c.took === 'me' ? theirs : mine].en.toLowerCase()}`}</span>
    </div>
  );
}
