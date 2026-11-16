import { useEffect, useRef, useState } from 'preact/hooks';
import type { Game } from '../app/game';
import { appState, setState, pause, resume, type PauseTab } from '../app/state';
import { settings, setSetting, type Quality, type CutscenePlay } from '../app/settings';
import { CAMERA_MODES, CAMERA_LABEL, type CameraMode } from '../player/camera';
import { keyLabel } from '../app/keymap';
import { Controls } from './Controls';
import { KITS } from '../techniques/techniques';
import { TECHNIQUE_IDS, type TechniqueId } from '../pacts/schema';
import { EYES } from '../eyes/registry';
import { EyeInstall } from '../eyes/EyeInstall';
import { Workshop } from '../workshop/Workshop';
import { RooftopLayer } from '../rooftop/RooftopUi';
import { NavMap } from './nav/NavMap';
import { OnlineJoin, OnlineMenu } from './Online';
import { roomFromUrl } from '../net/net';
import { Hud } from './hud/Hud';
import { Status } from './Status';
import { useSheetKeys } from './useSheetKeys';

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

export function App({ game }: { game: Game }) {
  const st = appState.value;
  return (
    <>
      {st.kind === 'boot' && <Boot progress={st.progress} label={st.label} />}
      {st.kind === 'title' && <Title game={game} />}
      {(st.kind === 'tutorial' || st.kind === 'explore' || st.kind === 'encounter' || st.kind === 'drill' || st.kind === 'cinematic' || st.kind === 'rooftop' || st.kind === 'paused') && <Hud game={game} />}
      <RooftopLayer game={game} />
      <EyeInstall />
      {st.kind === 'workshop' && <Workshop game={game} />}
      {st.kind === 'paused' && <Pause game={game} tab={st.tab} />}
      {st.kind === 'defeat' && <Defeat game={game} />}
    </>
  );
}

function Boot({ progress, label }: { progress: number; label: string }) {
  return (
    <div class="boot">
      <div class="boot-inner">
        <h1>禅光<small>ZENKOVERSE · PACT</small></h1>
        <div class="bar"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
        <div class="boot-row"><span>{label}</span><span>{Math.round(progress * 100)}%</span></div>
      </div>
    </div>
  );
}

function Title({ game }: { game: Game }) {
  // A room link opens straight onto the Technique screen with the join form.
  const [online, setOnline] = useState(() => !!roomFromUrl());
  const [select, setSelect] = useState(online);
  const [rooftop, setRooftop] = useState(false);
  const [tech, setTech] = useState<TechniqueId>(game.techniqueId);
  useEffect(() => {
    // Enter begins from anywhere on the title; on a focused button the button decides.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter' && !select && !(e.target instanceof HTMLButtonElement)) { setRooftop(false); setOnline(false); setSelect(true); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [select]);
  const root = useRef<HTMLDivElement>(null);
  useSheetKeys(root, { focusKey: select });
  if (select) {
    return (
      <div class="select" ref={root}>
        <div><div class="kicker">Choose your Technique</div><h2>生まれ持った技</h2></div>
        <div class="cards" data-row>
          {TECHNIQUE_IDS.map((id) => { const k = KITS[id]; return (
            <button key={id} class={`card ${tech === id ? 'active' : ''}`} data-autofocus={tech === id ? '' : undefined} data-glyph={k.glyph} style={{ '--c': hex(k.color) } as never} onClick={() => { setTech(id); game.setTechnique(id); game.audio.play('ui.select'); }} onDblClick={() => { game.setTechnique(id); if (online) return; if (rooftop) game.rooftop.begin(); else game.startRun(); }}>
              <span class="type">{k.type}</span><h3>{k.name}</h3><p>{k.blurb}</p><span class="res">Resource · {k.resource.name}</span>
            </button>); })}
        </div>
        <div class="select-foot">
          <span>{KITS[tech].primitive.description}</span>
          {online ? (
            <OnlineJoin game={game} tech={tech} onBack={() => { setSelect(false); setOnline(false); }} />
          ) : rooftop ? (
            <div style="display:flex;gap:8px">
              <button class="btn" onClick={() => setSelect(false)}>Back</button>
              <button class="btn primary" onClick={() => { game.setTechnique(tech); game.rooftop.begin(); }}>Climb to the rooftop</button>
            </div>
          ) : (
            <div style="display:flex;gap:8px">
              <button class="btn" onClick={() => { game.setTechnique(tech); game.startRun({ skipTutorial: true }); }}>Skip tutorial</button>
              <button class="btn primary" onClick={() => { game.setTechnique(tech); game.startRun(); }}>Begin at the Academy</button>
            </div>
          )}
        </div>
      </div>
    );
  }
  return (
    <div class="title" ref={root}>
      <div class="title-brand">
        <div class="kicker">The Zenkoverse power system</div>
        <div class="jp-big">契<em>約</em></div>
        <div class="sub">A dojo at dusk, one Technique, and the Pacts you write to shape it. Every ability is a sacrifice the universe reads back to you.</div>
        <div class="menu" style="margin-top:18px">
          <button data-autofocus onClick={() => { setRooftop(false); setOnline(false); setSelect(true); game.audio.play('ui.open'); }}>Begin</button>
          <button onClick={() => { setRooftop(false); setOnline(true); setSelect(true); game.audio.play('ui.open'); }}>Play Online</button>
          <button onClick={() => { setRooftop(true); setOnline(false); setSelect(true); game.audio.play('ui.open'); }}>Rooftop</button>
          <button onClick={() => { pause('settings'); setState({ kind: 'paused', resume: { kind: 'title' }, tab: 'settings' }); }}>Settings</button>
          <button onClick={() => setState({ kind: 'paused', resume: { kind: 'title' }, tab: 'codex' })}>Codex</button>
        </div>
      </div>
      <div class="title-foot"><span>↑ ↓ choose · Enter to begin · The cursor aims once inside</span><span>v0.3 · proof of concept</span></div>
    </div>
  );
}

const CUTSCENE_LABEL: Record<CutscenePlay, string> = { always: 'Always', first: 'First time', never: 'Never' };

const CODEX: { id: string; title: string; jp: string; body: string | (() => string); after?: string }[] = [
  { id: 'technique', title: 'Technique', jp: '技', body: 'A person\'s underlying, unique supernatural capability. Everyone has one, usually exactly one. Most are weak, narrow, or useful only outside combat. A Technique is refined by training and shaped by Pacts.' },
  { id: 'pact', title: 'Pact', jp: '契約', body: 'Every application of a Technique is formulated through a Pact, down to the baseline "if I will activation, activate." A Pact is how an Ability exists at all. In the Workshop you write a Pact against the Technique\'s parameters: direction, range, target, trigger, duration, resource, and your body. Pacts are permanent once inscribed; a sunset ends the term, not the Pact.' },
  { id: 'resolve', title: 'Resolve', jp: '覚悟', body: 'The real capability surrendered, judged against your situation and your other Pacts. Restricting something you never use earns almost nothing. A sacrifice already counted by another Pact earns nothing again.' },
  { id: 'risk', title: 'Risk', jp: '危', body: 'An escape clause on a Pact. The enhanced effect continues past its limit and you pay the consequence: health, exhaustion, or a sealed Technique.' },
  { id: 'wager', title: 'Wager', jp: '賭', body: 'A Wager is written inside a Pact. It has three parts, and you tune all three: a Declaration of an outcome you cannot be sure of, and how hard it is; the Rewards a right call pays, sharing the stake; and the Forfeits a wrong call lands, each at a size. Every cast of that Pact declares it, so the key is the bet. Only real doubt and real loss stake anything: a call you nearly always get right, or a forfeit that costs you little, buys almost nothing. A Pact that holds a Wager wears 賭 on its key.' },
  { id: 'programming', title: 'Programming', jp: '式', body: 'A small IF/THEN layer over your own Pacts: triggers, precedence when Pacts conflict, autonomous execution. Pact Architects use it to sustain allies.' },
  { id: 'training', title: 'Training', jp: '修行', body: () => `Drills raise Output, Precision, Efficiency, Range, Speed, Control, Activation, and Tolerance. A beginner needs the full hand sign. As Activation rises the sign shortens until activation is silent. The original sign still enhances the grown baseline: ${keyLabel('fullsign')} performs it deliberately. You are rooted until it completes, and the next cast within a few seconds skips its wind-up and carries the boost, which grows with Activation.` },
  { id: 'max', title: 'Maximum Output', jp: '全力', body: 'The greatest concentrated expression of a Technique: everything you can presently commit, in one formulation. The full sign always plays. The world waits.' },
  { id: 'eyes', title: 'Eyes', jp: '眼', body: 'Five finite physical artifacts. Installing one permanently replaces a natural eye. They are not Techniques, and most people do not know they exist.' },
  { id: 'aura', title: 'Aurabending', jp: '気', body: () => `A separate universal faculty, formalized only twenty years ago despite five thousand years of Technique history. Aura does not fuel Techniques. ${keyLabel('aura')} spends your whole aura at once. Tapped, it is a thin, dense layer over your body: blows on you land softer and your Techniques come back sooner, but it reaches no one. Held, the layer is pushed off your body into a field that grows until you let go, thinner the wider it goes, and while you push you barely move and cannot cast. Inside a field your hits land harder, you see what others are about to do sooner, and they are slowed. ${keyLabel('aura')} again retracts it and keeps the time it did not use, and it must refill completely before the next. A field that reaches another field or a body layer becomes an Aura Clash; two layers alone do not. Push beats hold, hold beats feint, feint beats push, and the denser aura takes a tie. The loser's field collapses and their guard breaks; nobody is hurt by the clash itself. Refinement, trained at the listening stone in the yard, sets how large and dense your field can be. A broader Technique and every Pact you inscribe lower how far it can go.` },
  { id: 'kuroda', title: 'The Kuroda', jp: '黒田', body: 'A fighting lineage that keeps doors for the underworld houses. Their Technique manifests a volatile liquid and sets it alight.', after: 'kuroda' },
  { id: 'views', title: 'Camera', jp: '視点', body: () => `${keyLabel('camera')} cycles the view. Top-down: you move with the screen and aim with the cursor. Over the shoulder: the camera follows the mouse and you aim at the crosshair. First person: the sign is in your own hands.` },
];

const TAB_JP: Record<PauseTab, string> = { menu: '一時停止', settings: '設定', controls: '操作', codex: '事典', map: '地図' };

function Pause({ game, tab }: { game: Game; tab: PauseTab }) {
  const s = settings.value;
  const [entry, setEntry] = useState(CODEX[0]!.id);
  const st = appState.value;
  const fromTitle = st.kind === 'paused' && st.resume.kind === 'title';
  const back = () => { if (fromTitle) setState({ kind: 'title' }); else { resume(); game.requestLock(); } };
  const tabs = fromTitle ? (['settings', 'controls', 'codex'] as const) : (['menu', 'settings', 'controls', 'codex', 'map'] as const);
  const go = (t: PauseTab) => { if (st.kind === 'paused') setState({ ...st, tab: t }); };
  const step = (d: number) => { const i = (tabs as readonly PauseTab[]).indexOf(tab); go(tabs[(i + d + tabs.length) % tabs.length]!); };
  const root = useRef<HTMLDivElement>(null);
  useSheetKeys(root, { tabs: { prev: () => step(-1), next: () => step(1) }, focusKey: tab });
  return (
    <div class="sheet-wrap">
      <div class="sheet pause-sheet" role="dialog" aria-label="Menu" ref={root}>
        <header>
          <div class="title-block"><div class="kicker">{fromTitle ? 'Title' : game.net ? 'Menu · the room keeps going' : 'Paused'}</div><h2 class="brush" key={tab}>{TAB_JP[tab]}</h2></div>
          <div class="tabs" role="tablist" aria-label="Menu pages">
            <kbd class="shoulder" aria-hidden="true">Q</kbd>
            {tabs.map((t) => <button key={t} role="tab" aria-selected={tab === t} class={tab === t ? 'on' : ''} onClick={() => go(t)}>{t}</button>)}
            <kbd class="shoulder" aria-hidden="true">E</kbd>
          </div>
        </header>
        <div class="body" key={tab}>
          {tab === 'menu' && game.net && <OnlineMenu game={game} back={back} />}
          {tab === 'menu' && !game.net && (
            <div class="pause-main">
              <div class="pause-menu">
                <button data-autofocus onClick={back}>Resume</button>
                {(game.book.preview.value || game.encounters.inDummyRoom) && <button onClick={() => { resume(); game.stopTrying(); game.requestLock(); }}>Stop trying the draft</button>}
                <button onClick={() => { resume(); game.tutorial.skip(); game.requestLock(); }}>Skip tutorial</button>
                <button onClick={() => { resume(); game.startRun(); }}>Replay tutorial</button>
                {st.kind === 'paused' && st.resume.kind === 'rooftop' && <button onClick={() => game.rooftop.abandon()}>Leave the rooftop</button>}
                <button onClick={() => { game.rooftop.abandon(); game.book.resetAll(); game.mastery.reset(); setState({ kind: 'title' }); }}>Reset Pacts and mastery</button>
                <button onClick={() => { game.rooftop.abandon(); setState({ kind: 'title' }); }}>Quit to title</button>
              </div>
              <Status game={game} />
            </div>
          )}
          {tab === 'settings' && (
            <div class="settings">
              <Range label="Sensitivity" value={s.sensitivity} min={0.2} max={3} step={0.05} onChange={(v) => setSetting('sensitivity', v)} />
              <Range label="Field of view" value={s.fov} min={60} max={110} step={1} onChange={(v) => setSetting('fov', v)} />
              <Range label="Master volume" value={s.volume} min={0} max={1} step={0.05} onChange={(v) => setSetting('volume', v)} />
              <Range label="Music" value={s.music} min={0} max={1} step={0.05} onChange={(v) => setSetting('music', v)} />
              <Range label="Effects" value={s.effects} min={0} max={1} step={0.05} onChange={(v) => setSetting('effects', v)} />
              <div class="row"><label>Quality</label><Seg value={s.quality} options={['low', 'medium', 'high']} onChange={(v) => { setSetting('quality', v as Quality); game.renderer.setQuality(v as Quality); }} /><span /></div>
              <div class="row"><label>Camera</label><Seg value={s.camera} options={CAMERA_MODES} labels={CAMERA_LABEL} onChange={(v) => game.setCamera(v as CameraMode)} /><span /></div>
              <div class="row"><label>Invert Y</label><Seg value={s.invertY ? 'on' : 'off'} options={['off', 'on']} onChange={(v) => setSetting('invertY', v === 'on')} /><span /></div>
              <div class="row"><label>Key hints when idle</label><Seg value={s.keyHints ? 'on' : 'off'} options={['off', 'on']} onChange={(v) => setSetting('keyHints', v === 'on')} /><span /></div>
              <div class="row"><label>Max Output cutscenes</label><Seg value={s.cutscenes} options={['always', 'first', 'never']} labels={CUTSCENE_LABEL} onChange={(v) => setSetting('cutscenes', v as CutscenePlay)} /><span /></div>
            </div>
          )}
          {tab === 'controls' && <Controls />}
          {tab === 'codex' && (
            <div class="codex">
              <nav>{CODEX.map((c) => <button key={c.id} class={entry === c.id ? 'on' : ''} onClick={() => setEntry(c.id)} onFocus={() => setEntry(c.id)}><span class="jp">{c.jp}</span> {c.title}</button>)}</nav>
              <article key={entry}>{(() => { const c = CODEX.find((x) => x.id === entry)!; return <><h3><span class="jp brush">{c.jp}</span> {c.title}</h3><p>{typeof c.body === 'string' ? c.body : c.body()}</p>{Object.values(EYES).length && c.id === 'eyes' && <p class="locked">{Object.values(EYES).map((e) => `${e.jp} ${e.name}`).join(' · ')}</p>}</>; })()}</article>
            </div>
          )}
          {tab === 'map' && <NavMap game={game} />}
        </div>
        <footer>
          <div class="kbd-hint">
            <span><kbd>↑</kbd><kbd>↓</kbd> choose</span>
            <span><kbd>Enter</kbd> press</span>
            <span><kbd>{keyLabel('pause')}</kbd> {fromTitle ? 'back' : 'resume'}</span>
            {!fromTitle && <span><kbd>{keyLabel('workshop')}</kbd> workshop</span>}
            {!fromTitle && <span><kbd>{keyLabel('map')}</kbd> map</span>}
          </div>
          <button class="btn" onClick={back}>{fromTitle ? 'Back' : 'Resume'}</button>
        </footer>
      </div>
    </div>
  );
}

function Range({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return <div class="row"><label>{label}</label><input type="range" min={min} max={max} step={step} value={value} onInput={(e) => onChange(Number((e.target as HTMLInputElement).value))} /><span class="v">{step < 1 ? value.toFixed(2) : value}</span></div>;
}

function Seg({ value, options, labels, onChange }: { value: string; options: readonly string[]; labels?: Record<string, string>; onChange: (v: string) => void }) {
  return <div class="seg">{options.map((o) => <button key={o} class={o === value ? 'on' : ''} onClick={() => onChange(o)}>{labels?.[o] ?? o}</button>)}</div>;
}

function Defeat({ game }: { game: Game }) {
  return (
    <div class="defeat">
      <div>
        <div class="jp">敗北</div>
        <p>You went down in the yard. The Pacts you inscribed remain.</p>
        <div style="display:flex;gap:10px;justify-content:center;margin-top:18px">
          <button class="btn primary" onClick={() => game.startRun({ skipTutorial: true })}>Back to the yard</button>
          <button class="btn" onClick={() => setState({ kind: 'title' })}>Title</button>
        </div>
      </div>
    </div>
  );
}
