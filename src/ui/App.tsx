import { useEffect, useState } from 'preact/hooks';
import type { Game } from '../app/game';
import { hud } from '../app/game';
import { appState, setState, pause, resume, type PauseTab } from '../app/state';
import { settings, setSetting, type Quality } from '../app/settings';
import { CAMERA_MODES, CAMERA_LABEL, type CameraMode } from '../player/camera';
import { keyLabel } from '../app/keymap';
import { KEY_SLOTS, EXTRA_SLOTS, KIND_DEFS, slotDef, type AbilityKind, type KeySlot } from '../pacts/slots';
import { Controls } from './Controls';
import { KITS, techUi, type SlotLabel, type SignState } from '../techniques/techniques';
import { MASTERY_CONFIG } from '../mastery/mastery';
import { TECHNIQUE_IDS, type TechniqueId } from '../pacts/schema';
import { combatUi, EYES } from '../combat/combat';
import { clashUi } from '../combat/clash';
import { AuraMeter, ClashLayer } from './Aura';
import { tutorialUi } from '../tutorial/tutorial';
import { drillUi } from '../drills/drills';
import { cutsceneUi } from '../cutscene/cutscene';
import { blinkUi } from '../techniques/kits/blink';
import { Workshop } from '../workshop/Workshop';
import { RooftopLayer } from '../rooftop/RooftopUi';
import { NavHud } from './nav/NavHud';
import { NavMap } from './nav/NavMap';
import { TopLeft } from './nav/TopLeft';
import { OnlineHud, OnlineJoin, OnlineMenu } from './Online';
import { roomFromUrl } from '../net/net';

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

export function App({ game }: { game: Game }) {
  const st = appState.value;
  return (
    <>
      {st.kind === 'boot' && <Boot progress={st.progress} label={st.label} />}
      {st.kind === 'title' && <Title game={game} />}
      {(st.kind === 'tutorial' || st.kind === 'explore' || st.kind === 'encounter' || st.kind === 'drill' || st.kind === 'cinematic' || st.kind === 'rooftop' || st.kind === 'paused') && <Hud game={game} />}
      <RooftopLayer game={game} />
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
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter' && !select) { setRooftop(false); setOnline(false); setSelect(true); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [select]);
  if (select) {
    return (
      <div class="select">
        <div><div class="kicker">Choose your Technique</div><h2>生まれ持った技</h2></div>
        <div class="cards">
          {TECHNIQUE_IDS.map((id) => { const k = KITS[id]; return (
            <button key={id} class={`card ${tech === id ? 'active' : ''}`} data-glyph={k.glyph} style={{ '--c': hex(k.color) } as never} onClick={() => { setTech(id); game.setTechnique(id); game.audio.play('select_001', 0.4); }} onDblClick={() => { game.setTechnique(id); if (online) return; if (rooftop) game.rooftop.begin(); else game.startRun(); }}>
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
    <div class="title">
      <div class="title-brand">
        <div class="kicker">The Zenkoverse power system</div>
        <div class="jp-big">契<em>約</em></div>
        <div class="sub">A dojo at dusk, one Technique, and the Pacts you write to shape it. Every ability is a sacrifice the universe reads back to you.</div>
        <div class="menu" style="margin-top:18px">
          <button onClick={() => { setRooftop(false); setOnline(false); setSelect(true); game.audio.resumeContext(); game.audio.play('open_001', 0.4); }}>Begin</button>
          <button onClick={() => { setRooftop(false); setOnline(true); setSelect(true); game.audio.resumeContext(); game.audio.play('open_001', 0.4); }}>Play Online</button>
          <button onClick={() => { setRooftop(true); setOnline(false); setSelect(true); game.audio.resumeContext(); game.audio.play('open_001', 0.4); }}>Rooftop</button>
          <button onClick={() => { game.audio.resumeContext(); pause('settings'); setState({ kind: 'paused', resume: { kind: 'title' }, tab: 'settings' }); }}>Settings</button>
          <button onClick={() => setState({ kind: 'paused', resume: { kind: 'title' }, tab: 'codex' })}>Codex</button>
        </div>
      </div>
      <div class="title-foot"><span>Enter to begin · The cursor aims once inside</span><span>v0.3 · proof of concept</span></div>
    </div>
  );
}

function Meter({ label, value, color, cls, text }: { label: string; value: number; color?: string; cls?: string; text?: string }) {
  return (
    <div class={`meter ${cls ?? ''}`} style={color ? ({ '--c': color } as never) : undefined}>
      <span class="lbl">{label}</span><span class="val">{text ?? Math.round(value * 100)}</span>
      <div class="track"><i style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} /></div>
    </div>
  );
}

function Hud({ game }: { game: Game }) {
  const kit = KITS[game.techniqueId];
  const c = hex(kit.color);
  const slots = techUi.slots.value;
  const cd = techUi.cooldowns.value;
  const glyphs: Record<AbilityKind, string> = { primary: kit.glyph, secondary: '構', max: '全' };
  const prompt = hud.prompt.value;
  const ban = hud.banner.value;
  const tut = tutorialUi.step.value;
  const drill = drillUi.active.value;
  const boss = combatUi.boss.value;
  const cine = cutsceneUi.active.value;
  // A Maximum Output cutscene or an Aura Clash: the HUD steps aside.
  const cut = cine || clashUi.value !== null;
  const title = cutsceneUi.title.value;
  const hurt = hud.hurt.value;
  const [flash, setFlash] = useState(false);
  useEffect(() => { if (!hurt) return; setFlash(true); const t = setTimeout(() => setFlash(false), 220); return () => clearTimeout(t); }, [hurt]);
  const view = hud.camera.value;
  const third = view !== 'first';
  const blind = blinkUi.blind.value;
  const pl = hud.plaque.value;
  return (
    <div class={`hud ${cine ? 'letterbox' : ''}`} style={{ '--c': c } as never}>
      <div class={`damage ${flash ? 'hit' : ''}`} />
      {blind > 0 && <div style={{ position: 'absolute', inset: 0, background: '#000', opacity: Math.min(1, blind / 1.5) }} />}
      {!cut && view !== 'top' && <div class={`reticle ${techUi.cooldowns.value.primary > 0 ? 'hot' : ''} ${third ? 'third' : ''}`} />}
      {!cut && view === 'top' && <Cursor hot={techUi.cooldowns.value.primary > 0} />}
      {!cut && (
        <div class="vitals">
          <Meter label="Health" value={combatUi.hp.value} />
          <Meter label={kit.resource.name} value={techUi.resource.value} color={c} cls="resource" />
          {techUi.strain.value > 0.02 && <Meter label="Strain" value={techUi.strain.value} cls="strain" />}
          <AuraMeter />
        </div>
      )}
      {!cut && (
        <div class={`abilities ${techUi.sign.value.kind}`}>
          <SignRing sign={techUi.sign.value} />
          <div class="xs" role="group" aria-label="Extra Abilities">
            {EXTRA_SLOTS.map((s) => <Extra key={s} slot={s} label={slots[s]} glyph={glyphs[slots[s].kind ?? 'primary']} cd={cooldownOf(s, slots[s].kind, cd)} />)}
          </div>
          <div class="mains">
            {MAIN_SLOTS.map((s) => { const r = cooldownOf(s, slots[s].kind, cd); return <Ability key={s} slot={s} label={slots[s]} glyph={glyphs[slots[s].kind!]} cd={r.cd} ready={r.ready} />; })}
          </div>
        </div>
      )}
      {!cut && <NavHud />}
      {!cut && <TopLeft game={game} />}
      {game.net && <OnlineHud game={game} />}
      {combatUi.wagerArmed.value && !cut && <div class="wager-arm">WAGER DECLARED · THE NEXT STRIKE CONNECTS</div>}
      <ClashLayer game={game} />
      {boss && !cut && <div class="boss" style={{ '--c': hex(boss.color) } as never}><span class="n">{boss.name}</span><div class="track"><i style={{ width: `${boss.frac * 100}%` }} /></div></div>}
      {prompt && !cut && <div class="prompt"><kbd>{keyLabel('interact')}</kbd><span>{prompt.text}</span></div>}
      {tut && !cut && <div class="objective"><span class="step">Tutorial {tut.index} / {tut.total} · {tut.jp}</span><span class="t">{tut.title}</span><span class="b">{tut.body()}</span><span class="step">{keyLabel('pause')} pauses · Skip tutorial is in the pause menu</span></div>}
      {drill && !cut && <div class="drill-hud"><span class="big">{drill.score} / {drill.needed}</span><span class="s">{drill.jp} · {drill.tier} · {drill.left} left</span>{drill.cue && <span class="cue">{drill.cue}</span>}</div>}
      {pl && !cut && <div class="objective" style="top:auto;bottom:calc(var(--hud-pad) + 120px);right:var(--hud-pad);border-color:#9fdfff"><span class="step">Lore plaque</span><span class="t">{pl.title}</span><span class="b">{pl.body}</span></div>}
      {!clashUi.value && <div class="toasts">{hud.toasts.value.map((t) => <div key={t.id} class={`toast ${t.tone}`}>{t.text}</div>)}</div>}
      {ban && <div class="banner" key={ban.id}><div class="big jp">{ban.big}</div><div class="small">{ban.small}</div></div>}
      {title && <div class="cut-title" key={title.id} style={{ '--c': hex(title.color) } as never}><div class="jp">{title.jp}</div><div class="en">{title.en}</div></div>}
      {cine && <div class="skip">{keyLabel('jump').toUpperCase()} · SKIP</div>}
      <div style="position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none">
        {combatUi.numbers.value.map((n) => <span key={n.id} style={{ position: 'absolute', left: `${n.x}%`, top: `${n.y}%`, transform: 'translate(-50%,-50%)', color: n.color, fontFamily: 'var(--serif)', fontSize: n.big ? '34px' : '20px', fontWeight: 700, textShadow: '0 2px 10px rgba(0,0,0,0.8)' }}>{n.text}</span>)}
      </div>
    </div>
  );
}

const MAIN_SLOTS = KEY_SLOTS.filter((s) => slotDef(s).raw !== null);

// The top-down aim: a ring that rides the mouse. It is drawn here, not as a
// CSS cursor, so it can take the Technique's colour and swell on a cast.
function Cursor({ hot }: { hot: boolean }) {
  const [at, setAt] = useState({ x: -100, y: -100 });
  useEffect(() => {
    const on = (e: MouseEvent) => setAt({ x: e.clientX, y: e.clientY });
    window.addEventListener('mousemove', on);
    return () => window.removeEventListener('mousemove', on);
  }, []);
  return <div class={`cursor ${hot ? 'hot' : ''}`} style={{ left: `${at.x}px`, top: `${at.y}px` }} />;
}

// The full sign above the cards: a ring that fills while the sign plays,
// then drains over the primed window while the label reads the time left.
const RING = 2 * Math.PI * 20;
function SignRing({ sign }: { sign: SignState }) {
  if (sign.kind === 'idle') return null;
  const signing = sign.kind === 'signing';
  const fill = sign.kind === 'signing' ? sign.t / sign.duration : sign.left / MASTERY_CONFIG.sign.window;
  return (
    <div class={`sign ${sign.kind}`} data-sign={sign.kind}>
      <div class="txt">
        <span class="k">{signing ? 'Full sign' : 'Primed'}</span>
        <span class="v">{signing ? 'committed' : `${Math.max(0, sign.left).toFixed(1)} s`}</span>
      </div>
      <div class="ring">
        <svg viewBox="0 0 48 48" aria-hidden="true"><circle class="trk" cx="24" cy="24" r="20" /><circle class="arc" cx="24" cy="24" r="20" style={{ strokeDasharray: RING, strokeDashoffset: RING * (1 - Math.max(0, Math.min(1, fill))) }} /></svg>
        <span class="glyph">印</span>
      </div>
    </div>
  );
}

// How far a slot is from ready: Maximum Output waits on the charge ring, the
// rest on their cooldown. `cd` is the share still to wait.
function cooldownOf(slot: KeySlot, kind: AbilityKind | null, cooldowns: Record<KeySlot, number>): { cd: number; ready: boolean } {
  if (kind === 'max') return { cd: 1 - techUi.charge.value, ready: techUi.charge.value >= 1 };
  return { cd: kind ? cooldowns[slot] / KIND_DEFS[kind].cooldown : 0, ready: kind !== null && cooldowns[slot] <= 0 };
}

// The compact cell for an extra slot: key, glyph, name. An empty slot shows
// its key and stays dim.
function Extra({ slot, label, glyph, cd }: { slot: KeySlot; label: SlotLabel; glyph: string; cd: { cd: number; ready: boolean } }) {
  return (
    <div class={`x ${label.empty ? 'empty' : ''} ${cd.ready && !label.empty ? 'ready' : ''} ${label.preview ? 'preview' : ''}`} data-slot={slot}>
      <kbd>{keyLabel(slot)}</kbd>
      <div class="box"><span class="glyph">{label.empty ? '' : glyph}</span><div class="cool" style={{ height: `${Math.max(0, Math.min(1, cd.cd)) * 100}%` }} /></div>
      <span class="name">{label.empty ? 'Empty' : label.name}</span>
    </div>
  );
}

function Ability({ slot, label, glyph, cd, ready }: { slot: KeySlot; label: SlotLabel; glyph: string; cd: number; ready: boolean }) {
  return (
    <div class={`ab ${ready ? 'ready' : ''} ${label.kind === 'max' ? 'max' : ''} ${label.preview ? 'preview' : ''}`} data-slot={slot}>
      <div class="box"><span class="glyph">{glyph}</span><div class="cool" style={{ height: `${Math.max(0, Math.min(1, cd)) * 100}%` }} /></div>
      <div class="txt">
        <span class="key">{keyLabel(slot)}{label.preview ? ' · trying a draft' : ''}</span>
        <span class="name">{label.name}</span>
        <span class="what">{label.what}</span>
      </div>
    </div>
  );
}

const CODEX: { id: string; title: string; jp: string; body: string | (() => string); after?: string }[] = [
  { id: 'technique', title: 'Technique', jp: '技', body: 'A person\'s underlying, unique supernatural capability. Everyone has one, usually exactly one. Most are weak, narrow, or useful only outside combat. A Technique is refined by training and shaped by Pacts.' },
  { id: 'pact', title: 'Pact', jp: '契約', body: 'Every application of a Technique is formulated through a Pact, down to the baseline "if I will activation, activate." A Pact is how an Ability exists at all. In the Workshop you write a Pact against the Technique\'s parameters: direction, range, target, trigger, duration, resource, and your body. Pacts are permanent once inscribed; a sunset ends the term, not the Pact.' },
  { id: 'resolve', title: 'Resolve', jp: '覚悟', body: 'The real capability surrendered, judged against your situation and your other Pacts. Restricting something you never use earns almost nothing. A sacrifice already counted by another Pact earns nothing again.' },
  { id: 'risk', title: 'Risk', jp: '危', body: 'An escape clause on a Pact. The enhanced effect continues past its limit and you pay the consequence: health, exhaustion, or a sealed Technique.' },
  { id: 'wager', title: 'Wager', jp: '賭', body: () => `A declared prediction with a reward and a forfeit. Press ${keyLabel('wager')} to declare that the next strike connects. Correct, the universe pays out. Wrong, your Technique seals.` },
  { id: 'programming', title: 'Programming', jp: '式', body: 'A small IF/THEN layer over your own Pacts: triggers, precedence when Pacts conflict, autonomous execution. Pact Architects use it to sustain allies.' },
  { id: 'training', title: 'Training', jp: '修行', body: () => `Drills raise Output, Precision, Efficiency, Range, Speed, Control, Activation, and Tolerance. A beginner needs the full hand sign. As Activation rises the sign shortens until activation is silent. The original sign still enhances the grown baseline: ${keyLabel('fullsign')} performs it deliberately. You are rooted until it completes, and the next cast within a few seconds skips its wind-up and carries the boost, which grows with Activation.` },
  { id: 'max', title: 'Maximum Output', jp: '全力', body: 'The greatest concentrated expression of a Technique: everything you can presently commit, in one formulation. The full sign always plays. The world waits.' },
  { id: 'eyes', title: 'Eyes', jp: '眼', body: 'Five finite physical artifacts. Installing one permanently replaces a natural eye. They are not Techniques, and most people do not know they exist.' },
  { id: 'aura', title: 'Aurabending', jp: '気', body: () => `A separate universal faculty, formalized only twenty years ago despite five thousand years of Technique history. Aura does not fuel Techniques. ${keyLabel('aura')} expands your field and spends your whole aura on it; ${keyLabel('aura')} again retracts it, with nothing refunded, and it must refill completely before the next. Inside your field your Techniques are sharper and others are slowed. Two fields that touch become an Aura Clash: push beats hold, hold beats feint, feint beats push, and the denser field takes a tie. The loser's field collapses and their guard breaks; nobody is hurt by the clash itself. Refinement, trained at the listening stone in the yard, sets how dense your field is. A broader Technique and every Pact you inscribe lower how far it can go.` },
  { id: 'kuroda', title: 'The Kuroda', jp: '黒田', body: 'A lineage whose "fire" is fuel. They manifest a volatile liquid and light it. The sheen on the ground comes before the flame.', after: 'kuroda' },
  { id: 'views', title: 'Camera', jp: '視点', body: () => `${keyLabel('camera')} cycles the view. Top-down: you move with the screen and aim with the cursor. Over the shoulder: the camera follows the mouse and you aim at the crosshair. First person: the sign is in your own hands.` },
];

function Pause({ game, tab }: { game: Game; tab: PauseTab }) {
  const s = settings.value;
  const [entry, setEntry] = useState(CODEX[0]!.id);
  const st = appState.value;
  const fromTitle = st.kind === 'paused' && st.resume.kind === 'title';
  const back = () => { if (fromTitle) setState({ kind: 'title' }); else { resume(); game.requestLock(); } };
  const tabs = fromTitle ? (['settings', 'controls', 'codex'] as const) : (['menu', 'settings', 'controls', 'codex', 'map'] as const);
  return (
    <div class="sheet-wrap">
      <div class="sheet" role="dialog" aria-label="Menu">
        <header>
          <div><div class="kicker">{fromTitle ? 'Title' : game.net ? 'Menu · the room keeps going' : 'Paused'}</div><h2>{tab === 'menu' ? '一時停止' : tab === 'settings' ? '設定' : tab === 'controls' ? '操作' : tab === 'codex' ? '事典' : '地図'}</h2></div>
          <div class="tabs" role="tablist">{tabs.map((t) => <button key={t} role="tab" class={tab === t ? 'on' : ''} onClick={() => setState({ ...(st as Extract<typeof st, { kind: 'paused' }>), tab: t })}>{t}</button>)}</div>
        </header>
        <div class="body">
          {tab === 'menu' && game.net && <OnlineMenu game={game} back={back} />}
          {tab === 'menu' && !game.net && (
            <div class="pause-menu">
              <button onClick={back}>Resume</button>
              <button onClick={() => { resume(); game.tutorial.skip(); game.requestLock(); }}>Skip tutorial</button>
              <button onClick={() => { resume(); game.startRun(); }}>Replay tutorial</button>
              {st.kind === 'paused' && st.resume.kind === 'rooftop' && <button onClick={() => game.rooftop.abandon()}>Leave the rooftop</button>}
              <button onClick={() => { game.rooftop.abandon(); game.book.resetAll(); game.mastery.reset(); setState({ kind: 'title' }); }}>Reset Pacts and mastery</button>
              <button onClick={() => { game.rooftop.abandon(); setState({ kind: 'title' }); }}>Quit to title</button>
            </div>
          )}
          {tab === 'settings' && (
            <div class="settings">
              <Range label="Sensitivity" value={s.sensitivity} min={0.2} max={3} step={0.05} onChange={(v) => setSetting('sensitivity', v)} />
              <Range label="Field of view" value={s.fov} min={60} max={110} step={1} onChange={(v) => setSetting('fov', v)} />
              <Range label="Volume" value={s.volume} min={0} max={1} step={0.05} onChange={(v) => setSetting('volume', v)} />
              <Range label="Ambience" value={s.music} min={0} max={1} step={0.05} onChange={(v) => setSetting('music', v)} />
              <div class="row"><label>Quality</label><Seg value={s.quality} options={['low', 'medium', 'high']} onChange={(v) => { setSetting('quality', v as Quality); game.renderer.setQuality(v as Quality); }} /><span /></div>
              <div class="row"><label>Camera</label><Seg value={s.camera} options={CAMERA_MODES} labels={CAMERA_LABEL} onChange={(v) => game.setCamera(v as CameraMode)} /><span /></div>
              <div class="row"><label>Invert Y</label><Seg value={s.invertY ? 'on' : 'off'} options={['off', 'on']} onChange={(v) => setSetting('invertY', v === 'on')} /><span /></div>
              <div class="row"><label>Mastery numbers</label><Seg value={s.showMastery ? 'on' : 'off'} options={['off', 'on']} onChange={(v) => setSetting('showMastery', v === 'on')} /><span /></div>
              <div class="row"><label>Skip cutscenes</label><Seg value={s.skipCutscenes ? 'on' : 'off'} options={['off', 'on']} onChange={(v) => setSetting('skipCutscenes', v === 'on')} /><span /></div>
            </div>
          )}
          {tab === 'controls' && <Controls />}
          {tab === 'codex' && (
            <div class="codex">
              <nav>{CODEX.map((c) => <button key={c.id} class={entry === c.id ? 'on' : ''} onClick={() => setEntry(c.id)}>{c.jp} · {c.title}</button>)}</nav>
              <article>{(() => { const c = CODEX.find((x) => x.id === entry)!; return <><h3>{c.jp} · {c.title}</h3><p>{typeof c.body === 'string' ? c.body : c.body()}</p>{Object.values(EYES).length && c.id === 'eyes' && <p class="locked">{Object.values(EYES).map((e) => `${e.jp} ${e.name}`).join(' · ')}</p>}</>; })()}</article>
            </div>
          )}
          {tab === 'map' && <NavMap game={game} />}
        </div>
        <footer><div class="kbd-hint"><span><kbd>{keyLabel('pause')}</kbd> resume</span><span><kbd>{keyLabel('workshop')}</kbd> workshop</span><span><kbd>{keyLabel('map')}</kbd> map</span></div><button class="btn" onClick={back}>{fromTitle ? 'Back' : 'Resume'}</button></footer>
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
