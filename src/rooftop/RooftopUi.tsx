import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import type { Game } from '../app/game';
import { appState } from '../app/state';
import { combatUi, EYES, type EyeId } from '../combat/combat';
import { slotWords } from '../pacts/readback';
import { keyLabel } from '../app/keymap';
import { slotDef } from '../pacts/slots';
import { rooftopUi, type RunResult } from './rooftop';
import { readFor, type Offer } from './offers';
import { WAVE_COUNT, HEAL_BETWEEN, EYE_AFTER, AURA_AFTER } from './waves';
import './rooftop.css';

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

// What each Eye does in the trial. The codex text is the lore; this is the rule.
const EYE_RULE: Partial<Record<EyeId, string>> = {
  horizon: 'In the trial: every wind-up is ringed on the floor before it lands, and blows land for less.',
  empty: 'In the trial: everything you hit takes more from you.',
  thread: 'In the trial: part of every hit travels to the nearest other enemy.',
};
const EYE_ORDER: EyeId[] = ['horizon', 'empty', 'thread', 'covenant'];

export function RooftopLayer({ game }: { game: Game }) {
  const st = appState.value;
  if (st.kind === 'rooftop') return <RunStrip />;
  if (st.kind === 'paused' && st.resume.kind === 'rooftop') return <RunStrip />;
  if (st.kind === 'rooftop-offer') return <OfferScreen game={game} />;
  if (st.kind === 'rooftop-end') return <EndScreen game={game} />;
  return null;
}

function RunStrip() {
  const run = rooftopUi.run.value;
  const eye = combatUi.eye.value;
  if (!run) return null;
  return (
    <div class="rt-strip" aria-live="polite">
      <span class="kicker">Rooftop · 屋上</span>
      <span class="rt-wave"><b>{run.wave}</b> / {run.total}</span>
      <span class="rt-title jp">{run.jp} · {run.title}</span>
      <span class="rt-row"><i>{run.left} left</i><i>Score {run.score}</i></span>
      {eye && <span class="rt-eye" style={{ '--c': hex(EYES[eye].color) } as never}>{EYES[eye].jp} {EYES[eye].name}</span>}
    </div>
  );
}

// 1, 2 and 3 pick a card, so a fight does not end with a hunt for the mouse.
function useDigits(count: number, pick: (i: number) => void) {
  useLayoutEffect(() => {
    const on = (e: KeyboardEvent) => { const n = Number(e.key); if (n >= 1 && n <= count) pick(n - 1); };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [count, pick]);
}

function OfferScreen({ game }: { game: Game }) {
  const step = rooftopUi.offer.value;
  if (!step) return null;
  if (step.kind === 'eye') return <EyeStep game={game} />;
  if (step.kind === 'aura') return <AuraStep game={game} />;
  return <PactStep game={game} offers={step.offers} />;
}

function Shell({ kicker, title, jp, note, children, foot }: { kicker: string; title: string; jp: string; note?: string; children: preact.ComponentChildren; foot?: preact.ComponentChildren }) {
  return (
    <div class="rt-wrap">
      <div class="rt-sheet" role="dialog" aria-label={title}>
        <header>
          <div class="kicker">{kicker}</div>
          <h2><span class="jp">{jp}</span> {title}</h2>
          {note && <p class="rt-note">{note}</p>}
        </header>
        {children}
        {foot && <footer>{foot}</footer>}
      </div>
    </div>
  );
}

const cleared = () => { const r = rooftopUi.run.value; return r ? r.wave : 0; };

function PactStep({ game, offers }: { game: Game; offers: Offer[] }) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => { first.current?.focus(); }, [offers]);
  const pick = (i: number) => game.rooftop.choose(i);
  useDigits(offers.length, pick);
  const keyName = (p: Offer['pact']) => slotWords(p.slot);
  const gain = (o: Offer) => o.replaces ? (o.stronger ? `Stronger than ${o.replaces}, which it replaces.` : `Replaces ${o.replaces}.`) : o.pact.slot !== 'passive' && slotDef(o.pact.slot).raw === null ? `Adds to ${keyLabel(o.pact.slot)}.` : 'Fills an empty key.';
  return (
    <Shell
      kicker={`Wave ${cleared()} of ${WAVE_COUNT} cleared · health restored by ${Math.round(HEAL_BETWEEN * 100)}%`}
      title="Choose a Pact" jp="契約"
      note="Each one is a sacrifice the universe reads back to you. The one you take is inscribed on its key and is in force when the next wave begins."
      foot={<><span class="rt-hint"><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> or click to inscribe</span><button class="btn" onClick={() => game.rooftop.skipPact()}>Take none</button></>}
    >
      <div class="rt-cards">
        {offers.map((o, i) => (
          <button key={o.pact.id} ref={i === 0 ? first : undefined} class="rt-offer" data-tags={o.tags.join(',')} data-pact={o.pact.id} data-slot={o.pact.slot} onClick={() => pick(i)}>
            <span class="rt-top"><span class="rt-key">{keyName(o.pact)}</span><kbd>{i + 1}</kbd></span>
            <h3 class="jp">{o.pact.name}</h3>
            <p class="rt-read">{o.text}</p>
            <span class="rt-foot">
              <b class={o.stronger ? 'up' : ''}>{readFor(o.after.read)}</b>
              <i>{gain(o)}</i>
            </span>
          </button>
        ))}
      </div>
    </Shell>
  );
}

function EyeStep({ game }: { game: Game }) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  const open = EYE_ORDER.filter((id) => !EYES[id].locked);
  useDigits(open.length, (i) => game.rooftop.chooseEye(open[i]!));
  return (
    <Shell
      kicker={`Wave ${EYE_AFTER} cleared · an Eye is on offer`} title="Take an Eye" jp="眼"
      note="An Eye is a finite physical artifact. Installing one permanently replaces a natural eye. You may take only one."
      foot={<span class="rt-hint"><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> or click to install</span>}
    >
      <div class="rt-cards four">
        {EYE_ORDER.map((id) => {
          const e = EYES[id];
          const i = open.indexOf(id);
          return (
            <button key={id} ref={i === 0 ? first : undefined} class={`rt-offer eye ${e.locked ? 'locked' : ''}`} disabled={!!e.locked} style={{ '--c': hex(e.color) } as never} data-eye={id} onClick={() => game.rooftop.chooseEye(id)}>
              <span class="rt-top"><span class="rt-key jp">{e.jp}</span>{!e.locked && <kbd>{i + 1}</kbd>}</span>
              <h3 class="jp">{e.name}</h3>
              <p class="rt-read">{e.text}</p>
              <span class="rt-foot"><i>{e.locked ? 'It cannot be installed alone.' : EYE_RULE[id]}</i></span>
            </button>
          );
        })}
      </div>
    </Shell>
  );
}

function AuraStep({ game }: { game: Game }) {
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => { btn.current?.focus(); }, []);
  return (
    <Shell kicker={`Wave ${AURA_AFTER} cleared · something new`} title="Aura Expansion" jp="気"
      note="Aura is a separate faculty from your Technique, formalized only twenty years ago despite five thousand years of Technique history.">
      <div class="rt-aura">
        <p>Hold <kbd>{keyLabel('aura')}</kbd> to expand a field around you. Enemies inside it move slower. It drains your Aura while it is open and refills when you let go.</p>
        <p>The strongest opponents carry fields of their own. Where two fields meet you are in an Aura Clash. Keep your health high and keep holding {keyLabel('aura')} to push her field back.</p>
        <button ref={btn} class="btn primary" onClick={() => game.rooftop.acceptAura()}>Continue</button>
      </div>
    </Shell>
  );
}

function EndScreen({ game }: { game: Game }) {
  const r = rooftopUi.result.value;
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  if (!r) return null;
  const mm = Math.floor(r.seconds / 60), ss = String(r.seconds % 60).padStart(2, '0');
  return (
    <div class="rt-wrap">
      <div class={`rt-sheet end ${r.victory ? 'win' : 'lose'}`} role="dialog" aria-label={r.victory ? 'Victory' : 'Defeat'}>
        <header>
          <div class="kicker">Rooftop trial · {r.victory ? 'complete' : 'ended'}</div>
          <h2><span class="jp big">{r.victory ? '勝利' : '敗北'}</span></h2>
          <p class="rt-note">{r.victory ? 'Five thousand years, and she still bowed.' : 'You went down on the roof. The Pacts you took here stay up here.'}</p>
        </header>
        <Stats r={r} time={`${mm}:${ss}`} />
        <footer>
          <button ref={first} class="btn primary" onClick={() => game.rooftop.begin()}>Climb again</button>
          <button class="btn" onClick={() => game.rooftop.leave('street')}>Back to the street</button>
          <button class="btn" onClick={() => game.rooftop.leave('title')}>Title</button>
        </footer>
      </div>
    </div>
  );
}

function Stats({ r, time }: { r: RunResult; time: string }) {
  return (
    <div class="rt-stats">
      <div class="rt-score"><span class="kicker">Score</span><b data-stat="score">{r.score}</b><i data-stat="best">{r.newBest ? 'New best' : `Best ${r.best}`}</i></div>
      <dl>
        <div><dt>Waves cleared</dt><dd data-stat="waves">{r.wavesCleared} / {WAVE_COUNT}</dd></div>
        <div><dt>Wagers won</dt><dd data-stat="wagers-won">{r.wagersWon}</dd></div>
        <div><dt>Wagers lost</dt><dd data-stat="wagers-lost">{r.wagersLost}</dd></div>
        <div><dt>Defeated</dt><dd>{r.kills}</dd></div>
        <div><dt>Time</dt><dd>{time}</dd></div>
        <div><dt>Eye</dt><dd>{r.eye ? EYES[r.eye].name : 'none'}</dd></div>
      </dl>
      <div class="rt-pacts">
        <span class="kicker">Pacts taken · <span data-stat="pacts">{r.pacts.length}</span></span>
        {r.pacts.length === 0 ? <p class="rt-none">None. You fought on your catalogue Pacts alone.</p> : <ul>{r.pacts.map((p, i) => <li key={i} title={p.text}><b class="jp">{p.name}</b></li>)}</ul>}
      </div>
    </div>
  );
}
