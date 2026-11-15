import { useEffect, useState } from 'preact/hooks';
import type { Game } from '../../app/game';
import { hud } from '../../app/game';
import { appState } from '../../app/state';
import { settings } from '../../app/settings';
import { keyLabel, type Action } from '../../app/keymap';
import { navUi } from '../../nav/navigation';
import { tutorialUi } from '../../tutorial/tutorial';
import { drillUi } from '../../drills/drills';
import type { MasteryStat } from '../../mastery/mastery';
import { STAT_WORDS } from '../Status';

const SOURCE = { goal: 'Goal', tutorial: 'Tutorial', pin: 'Pin' } as const;
// The keys worth a reminder while you stand about. Movement and the
// Abilities are on the cards and in the tutorial; the full list is in the
// pause menu.
const AT_HAND: readonly [Action, string][] = [['pause', 'menu'], ['map', 'map'], ['workshop', 'workshop'], ['camera', 'view'], ['aura', 'aura'], ['wager', 'wager']];
// How long the player stands idle before the key reminder fades in.
const IDLE_MS = 6000;

// The top-left column, lettered like a manga page's narration boxes: what
// you are doing now (a drill, a tutorial step or the goal), a plaque you
// stand at, the passing messages, and a key reminder when you stop to think.
// Everything sits in the flow of this one column, so nothing in it overlaps.
export function Captions({ game }: { game: Game }) {
  const t = navUi.view.value.target;
  const tut = tutorialUi.step.value;
  const drill = drillUi.active.value;
  const pl = hud.plaque.value;
  const toasts = hud.toasts.value.slice(-3);
  const idle = useIdle(IDLE_MS);
  const gain = useGain(game);
  const st = appState.value.kind;
  const calm = st === 'explore' && !game.net;
  // In a fight the goal steps aside; it comes back when the fight ends.
  const fighting = st === 'encounter' || st === 'rooftop' || !!drill;
  return (
    <div class="captions">
      {drill && <DrillCaption drill={drill} />}
      {tut && !drill && (
        <div class="cap objective" key={tut.id}>
          <span class="step">{tut.id !== 'done' && <><b>{tut.index}</b> / {tut.total} · </>}<span class="jp">{tut.jp}</span> · {tut.title}</span>
          <span class="b">{tut.body()}</span>
          {tut.id !== 'done' && <button class="foot skip-step" onClick={() => game.tutorial.skipStep()}><kbd>{keyLabel('skip')}</kbd> skip this step · {keyLabel('pause')} menu</button>}
        </div>
      )}
      {t && !fighting && !tut && (
        <div class="cap tracker" key={t.title}>
          <span class="kicker"><b class="gem" />{SOURCE[t.source]}</span>
          <span class="tr-title">{t.title}</span>
          <span class="tr-sub">{t.subtitle}</span>
        </div>
      )}
      {pl && (
        <div class="cap plaque">
          <span class="step">{pl.kicker ?? 'Lore plaque'}</span>
          <span class="t">{pl.title}</span>
          <span class="b">{pl.body}</span>
        </div>
      )}
      {(toasts.length > 0 || gain) && (
        <div class="toasts">
          {gain && <div key={`gain${gain.id}`} class="toast good gain">{STAT_WORDS[gain.stat]} rises to <b>{gain.now}</b></div>}
          {toasts.map((x) => <div key={x.id} class={`toast ${x.tone}`}>{x.text}</div>)}
        </div>
      )}
      {settings.value.keyHints && calm && !tut && !pl && (
        <div class={`at-hand ${idle ? 'on' : ''}`} aria-hidden={!idle}>
          {AT_HAND.map(([a, what]) => <span key={a}><kbd>{keyLabel(a)}</kbd>{what}</span>)}
        </div>
      )}
    </div>
  );
}

// A drill: its name and score, the live cue, and the rules. Before the
// first item the rules are written out in full; once it runs, the opening
// line folds away and the answers stay, small, under the cue.
function DrillCaption({ drill }: { drill: NonNullable<typeof drillUi.active.value> }) {
  return (
    <div class={`cap drill-hud ${drill.waiting ? 'waiting' : 'running'}`}>
      <span class="s"><span class="jp">{drill.jp}</span> · {drill.title} · {drill.tier}</span>
      <span class="big">{drill.score} / {drill.needed}<small>{drill.left} left</small></span>
      {(drill.cue || drill.waiting) && <span class="cue" key={drill.waiting ? 'wait' : drill.cue}>{drill.waiting ? `Press ${keyLabel('interact')} when ready` : drill.cue}</span>}
      <ul>{drill.howTo.map((l, i) => <li key={i}>{l}</li>)}</ul>
    </div>
  );
}

// A mastery stat that just rose, for a few seconds. The numbers themselves
// live in the pause menu; play only says when one moves. Refinement is
// said by the aura meter, under the bar it changes.
function useGain(game: Game): { id: number; stat: MasteryStat; now: number } | null {
  const recent = game.mastery.recent.value;
  const [shown, setShown] = useState<number | null>(null);
  useEffect(() => {
    if (!recent || recent.amount < 0.005 || recent.stat === 'refinement') return;
    setShown(recent.id);
    const t = setTimeout(() => setShown((id) => (id === recent.id ? null : id)), 3200);
    return () => clearTimeout(t);
  }, [recent?.id]);
  if (!recent || shown !== recent.id) return null;
  return { id: recent.id, stat: recent.stat, now: Math.round(game.mastery.get(game.techniqueId, recent.stat) * 100) };
}

// True once no key or button has been pressed for `ms`. It starts true, so
// a fresh run shows the reminder until the first press.
function useIdle(ms: number): boolean {
  const [idle, setIdle] = useState(true);
  useEffect(() => {
    let timer = 0;
    const poke = () => { setIdle(false); clearTimeout(timer); timer = window.setTimeout(() => setIdle(true), ms); };
    window.addEventListener('keydown', poke);
    window.addEventListener('mousedown', poke);
    return () => { window.removeEventListener('keydown', poke); window.removeEventListener('mousedown', poke); clearTimeout(timer); };
  }, [ms]);
  return idle;
}
