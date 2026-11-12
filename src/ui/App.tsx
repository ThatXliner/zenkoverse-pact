import { useEffect, useState } from 'preact/hooks';
import type { Game } from '../app/game';
import { hud } from '../app/game';
import { appState, setState, pause, resume } from '../app/state';
import { settings, setSetting, type Quality } from '../app/settings';
import { KITS, techUi, type SlotLabel } from '../techniques/techniques';
import { TECHNIQUE_IDS, type TechniqueId } from '../pacts/schema';
import { combatUi, EYES } from '../combat/combat';
import { auraUi } from '../combat/aura';
import { tutorialUi } from '../tutorial/tutorial';
import { drillUi } from '../drills/drills';
import { cutsceneUi } from '../cutscene/cutscene';
import { blinkUi } from '../techniques/kits/blink';
import { MASTERY_STATS, MASTERY_CONFIG } from '../mastery/mastery';
import { Workshop } from '../workshop/Workshop';
import { RooftopLayer } from '../rooftop/RooftopUi';

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
  const [select, setSelect] = useState(false);
  const [rooftop, setRooftop] = useState(false);
  const [tech, setTech] = useState<TechniqueId>(game.techniqueId);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter' && !select) { setRooftop(false); setSelect(true); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [select]);
  if (select) {
    return (
      <div class="select">
        <div><div class="kicker">Choose your Technique</div><h2>生まれ持った技</h2></div>
        <div class="cards">
          {TECHNIQUE_IDS.map((id) => { const k = KITS[id]; return (
            <button key={id} class={`card ${tech === id ? 'active' : ''}`} data-glyph={k.glyph} style={{ '--c': hex(k.color) } as never} onClick={() => { setTech(id); game.setTechnique(id); game.audio.play('select_001', 0.4); }} onDblClick={() => { game.setTechnique(id); if (rooftop) game.rooftop.begin(); else game.startRun(); }}>
              <span class="type">{k.type}</span><h3>{k.name}</h3><p>{k.blurb}</p><span class="res">Resource · {k.resource.name}</span>
            </button>); })}
        </div>
        <div class="select-foot">
          <span>{KITS[tech].primitive.description}</span>
          {rooftop ? (
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
        <div class="sub">A rainy district, one Technique, and the Pacts you write to shape it. Every ability is a sacrifice the universe reads back to you.</div>
        <div class="menu" style="margin-top:18px">
          <button onClick={() => { setRooftop(false); setSelect(true); game.audio.resumeContext(); game.audio.play('open_001', 0.4); }}>Begin</button>
          <button onClick={() => { setRooftop(true); setSelect(true); game.audio.resumeContext(); game.audio.play('open_001', 0.4); }}>Rooftop</button>
          <button onClick={() => { game.audio.resumeContext(); pause('settings'); setState({ kind: 'paused', resume: { kind: 'title' }, tab: 'settings' }); }}>Settings</button>
          <button onClick={() => setState({ kind: 'paused', resume: { kind: 'title' }, tab: 'codex' })}>Codex</button>
        </div>
      </div>
      <div class="title-foot"><span>Enter to begin · Mouse to look once inside</span><span>v0.2 · rebuild</span></div>
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
  const zone = hud.zone.value;
  const prompt = hud.prompt.value;
  const ban = hud.banner.value;
  const tut = tutorialUi.step.value;
  const drill = drillUi.active.value;
  const boss = combatUi.boss.value;
  const cut = cutsceneUi.active.value;
  const title = cutsceneUi.title.value;
  const hurt = hud.hurt.value;
  const [flash, setFlash] = useState(false);
  useEffect(() => { if (!hurt) return; setFlash(true); const t = setTimeout(() => setFlash(false), 220); return () => clearTimeout(t); }, [hurt]);
  const third = !game.cam.isFirst;
  const s = settings.value;
  const blind = blinkUi.blind.value;
  const pl = hud.plaque.value;
  const mast = game.mastery.stats.value[game.techniqueId];
  return (
    <div class={`hud ${cut ? 'letterbox' : ''}`} style={{ '--c': c } as never}>
      <div class={`damage ${flash ? 'hit' : ''}`} />
      {blind > 0 && <div style={{ position: 'absolute', inset: 0, background: '#000', opacity: Math.min(1, blind / 1.5) }} />}
      {!cut && <div class={`reticle ${techUi.cooldowns.value.primary > 0 ? 'hot' : ''} ${third ? 'third' : ''}`} />}
      {!cut && (
        <div class="vitals">
          <Meter label="Health" value={combatUi.hp.value} />
          <Meter label={kit.resource.name} value={techUi.resource.value} color={c} cls="resource" />
          {techUi.strain.value > 0.02 && <Meter label="Strain" value={techUi.strain.value} cls="strain" />}
          {auraUi.active.value && <Meter label="Aura" value={auraUi.energy.value} />}
        </div>
      )}
      {!cut && (
        <div class="abilities">
          <Ability k="Left click" label={slots.primary} glyph={kit.glyph} cd={cd.primary / 0.42} ready={cd.primary <= 0} />
          <Ability k="Right click" label={slots.secondary} glyph="構" cd={cd.secondary / 0.9} ready={cd.secondary <= 0} />
          <Ability k="Q" label={slots.max} glyph="全" cd={1 - techUi.charge.value} ready={techUi.charge.value >= 1} max />
        </div>
      )}
      {!cut && s.showMastery && (
        <div class="hint">
          <span>{kit.name} · {techUi.variant.value === 'none' ? 'silent activation' : techUi.variant.value === 'short' ? 'short sign' : 'full sign'}{s.fullSignHold ? ' · Alt holds the full sign' : ''}</span>
          <span>V camera · Tab workshop · R wager · F aura · Esc menu</span>
          {MASTERY_CONFIG.showNumbers && <div class="mastery">{MASTERY_STATS.map((st) => <span key={st}>{st} <b>{Math.round(mast[st] * 100)}</b></span>)}</div>}
        </div>
      )}
      {combatUi.wagerArmed.value && !cut && <div class="wager-arm">WAGER DECLARED · THE NEXT STRIKE CONNECTS</div>}
      {auraUi.active.value && !cut && <div class="aura-ring" />}
      {auraUi.clash.value !== null && !cut && <div class="clash"><span class="kicker">Aura clash · hold F</span><div class="track"><i style={{ left: `${50 + auraUi.clash.value * 50}%`, width: '3px' }} /></div></div>}
      {boss && !cut && <div class="boss" style={{ '--c': hex(boss.color) } as never}><span class="n">{boss.name}</span><div class="track"><i style={{ width: `${boss.frac * 100}%` }} /></div></div>}
      {zone && !cut && <div class="zone" key={zone.id}><span class="jp">{zoneJp(zone.id)}</span><span class="en">{zone.label}</span></div>}
      {prompt && !cut && <div class="prompt"><kbd>{prompt.key}</kbd><span>{prompt.text}</span></div>}
      {tut && !cut && <div class="objective"><span class="step">Tutorial {tut.index} / {tut.total} · {tut.jp}</span><span class="t">{tut.title}</span><span class="b">{tut.body}</span><span class="step">Esc pauses · Skip tutorial is in the pause menu</span></div>}
      {drill && !cut && <div class="drill-hud"><span class="big">{drill.score} / {drill.needed}</span><span class="s">{drill.jp} · {drill.tier} · {drill.left} left</span></div>}
      {pl && !cut && <div class="objective" style="top:auto;bottom:140px;right:36px;border-color:#9fdfff"><span class="step">Lore plaque</span><span class="t">{pl.title}</span><span class="b">{pl.body}</span></div>}
      <div class="toasts">{hud.toasts.value.map((t) => <div key={t.id} class={`toast ${t.tone}`}>{t.text}</div>)}</div>
      {ban && <div class="banner" key={ban.id}><div class="big jp">{ban.big}</div><div class="small">{ban.small}</div></div>}
      {title && <div class="cut-title" key={title.id} style={{ '--c': hex(title.color) } as never}><div class="jp">{title.jp}</div><div class="en">{title.en}</div></div>}
      {cut && <div class="skip">SPACE · SKIP</div>}
      <div style="position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none">
        {combatUi.numbers.value.map((n) => <span key={n.id} style={{ position: 'absolute', left: `${n.x}%`, top: `${n.y}%`, transform: 'translate(-50%,-50%)', color: n.color, fontFamily: 'var(--serif)', fontSize: n.big ? '34px' : '20px', fontWeight: 700, textShadow: '0 2px 10px rgba(0,0,0,0.8)' }}>{n.text}</span>)}
      </div>
    </div>
  );
}

function zoneJp(id: string): string {
  return ({ academy: '学院', dojo: '道場', market: '市場', alley: '路地', rooftop: '屋上', bridge: '橋', kuroda: '黒田', canal: '運河' } as Record<string, string>)[id] ?? '';
}

function Ability({ k, label, glyph, cd, ready, max }: { k: string; label: SlotLabel; glyph: string; cd: number; ready: boolean; max?: boolean }) {
  return (
    <div class={`ab ${ready ? 'ready' : ''} ${max ? 'max' : ''} ${label.preview ? 'preview' : ''}`}>
      <div class="box"><span class="glyph">{glyph}</span><div class="cool" style={{ height: `${Math.max(0, Math.min(1, cd)) * 100}%` }} /></div>
      <div class="txt">
        <span class="key">{k}{label.preview ? ' · trying a draft' : ''}</span>
        <span class="name">{label.name}</span>
        <span class="what">{label.what}</span>
      </div>
    </div>
  );
}

const CODEX: { id: string; title: string; jp: string; body: string; after?: string }[] = [
  { id: 'technique', title: 'Technique', jp: '技', body: 'A person\'s underlying, unique supernatural capability. Everyone has one, usually exactly one. Most are weak, narrow, or useful only outside combat. A Technique is refined by training and shaped by Pacts.' },
  { id: 'pact', title: 'Pact', jp: '契約', body: 'Every application of a Technique is formulated through a Pact, down to the baseline "if I will activation, activate." A Pact is how an Ability exists at all. In the Workshop you write a Pact against the Technique\'s parameters: direction, range, target, trigger, duration, resource, and your body. Pacts are permanent once inscribed; a sunset ends the term, not the Pact.' },
  { id: 'resolve', title: 'Resolve', jp: '覚悟', body: 'The real capability surrendered, judged against your situation and your other Pacts. Restricting something you never use earns almost nothing. A sacrifice already counted by another Pact earns nothing again.' },
  { id: 'risk', title: 'Risk', jp: '危', body: 'An escape clause on a Pact. The enhanced effect continues past its limit and you pay the consequence: health, exhaustion, or a sealed Technique.' },
  { id: 'wager', title: 'Wager', jp: '賭', body: 'A declared prediction with a reward and a forfeit. Press R to declare that the next strike connects. Correct, the universe pays out. Wrong, your Technique seals.' },
  { id: 'programming', title: 'Programming', jp: '式', body: 'A small IF/THEN layer over your own Pacts: triggers, precedence when Pacts conflict, autonomous execution. Pact Architects use it to sustain allies.' },
  { id: 'training', title: 'Training', jp: '修行', body: 'Drills raise Output, Precision, Efficiency, Range, Speed, Control, Activation, and Tolerance. A beginner needs the full hand sign. As Activation rises the sign shortens until activation is silent. The original sign still enhances the grown baseline: hold Alt to perform it deliberately.' },
  { id: 'max', title: 'Maximum Output', jp: '全力', body: 'The greatest concentrated expression of a Technique: everything you can presently commit, in one formulation. The full sign always plays. The world waits.' },
  { id: 'eyes', title: 'Eyes', jp: '眼', body: 'Five finite physical artifacts. Installing one permanently replaces a natural eye. They are not Techniques, and most people do not know they exist.' },
  { id: 'aura', title: 'Aurabending', jp: '気', body: 'A separate universal faculty, formalized only twenty years ago despite five thousand years of Technique history. Aura does not fuel Techniques. Hold F to expand your field; two fields meeting become an Aura Clash.' },
  { id: 'kuroda', title: 'The Kuroda', jp: '黒田', body: 'A lineage whose "fire" is fuel. They manifest a volatile liquid and light it. The sheen on the ground comes before the flame.', after: 'kuroda' },
];

function Pause({ game, tab }: { game: Game; tab: 'menu' | 'settings' | 'codex' | 'map' }) {
  const s = settings.value;
  const [entry, setEntry] = useState(CODEX[0]!.id);
  const st = appState.value;
  const fromTitle = st.kind === 'paused' && st.resume.kind === 'title';
  const back = () => { if (fromTitle) setState({ kind: 'title' }); else { resume(); game.input.requestLock(); } };
  const tabs = fromTitle ? (['settings', 'codex'] as const) : (['menu', 'settings', 'codex', 'map'] as const);
  return (
    <div class="sheet-wrap">
      <div class="sheet" role="dialog" aria-label="Menu">
        <header>
          <div><div class="kicker">{fromTitle ? 'Title' : 'Paused'}</div><h2>{tab === 'menu' ? '一時停止' : tab === 'settings' ? '設定' : tab === 'codex' ? '事典' : '地図'}</h2></div>
          <div class="tabs" role="tablist">{tabs.map((t) => <button key={t} role="tab" class={tab === t ? 'on' : ''} onClick={() => setState({ ...(st as Extract<typeof st, { kind: 'paused' }>), tab: t })}>{t}</button>)}</div>
        </header>
        <div class="body">
          {tab === 'menu' && (
            <div class="pause-menu">
              <button onClick={back}>Resume</button>
              <button onClick={() => { resume(); game.tutorial.skip(); game.input.requestLock(); }}>Skip tutorial</button>
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
              <div class="row"><label>Camera</label><Seg value={s.camera} options={['first', 'third']} onChange={(v) => { setSetting('camera', v as 'first'); game.cam.mode = v as 'first'; }} /><span /></div>
              <div class="row"><label>Invert Y</label><Seg value={s.invertY ? 'on' : 'off'} options={['off', 'on']} onChange={(v) => setSetting('invertY', v === 'on')} /><span /></div>
              <div class="row"><label>Mastery numbers</label><Seg value={s.showMastery ? 'on' : 'off'} options={['off', 'on']} onChange={(v) => setSetting('showMastery', v === 'on')} /><span /></div>
              <div class="row"><label>Alt holds full sign</label><Seg value={s.fullSignHold ? 'on' : 'off'} options={['off', 'on']} onChange={(v) => setSetting('fullSignHold', v === 'on')} /><span /></div>
              <div class="row"><label>Skip cutscenes</label><Seg value={s.skipCutscenes ? 'on' : 'off'} options={['off', 'on']} onChange={(v) => setSetting('skipCutscenes', v === 'on')} /><span /></div>
            </div>
          )}
          {tab === 'codex' && (
            <div class="codex">
              <nav>{CODEX.map((c) => <button key={c.id} class={entry === c.id ? 'on' : ''} onClick={() => setEntry(c.id)}>{c.jp} · {c.title}</button>)}</nav>
              <article>{(() => { const c = CODEX.find((x) => x.id === entry)!; return <><h3>{c.jp} · {c.title}</h3><p>{c.body}</p>{Object.values(EYES).length && c.id === 'eyes' && <p class="locked">{Object.values(EYES).map((e) => `${e.jp} ${e.name}`).join(' · ')}</p>}</>; })()}</article>
            </div>
          )}
          {tab === 'map' && <div class="map"><DistrictMap game={game} /></div>}
        </div>
        <footer><div class="kbd-hint"><span><kbd>Esc</kbd> resume</span><span><kbd>Tab</kbd> workshop</span></div><button class="btn" onClick={back}>{fromTitle ? 'Back' : 'Resume'}</button></footer>
      </div>
    </div>
  );
}

function DistrictMap({ game }: { game: Game }) {
  const p = game.player.position;
  const toMap = (x: number, z: number) => [((x + 100) / 200) * 560, ((z + 100) / 200) * 560] as const;
  const [px, pz] = toMap(p.x, p.z);
  const spots: [string, number, number][] = [['Academy', -58, -58], ['Workshop', -26, -66], ['Market', 0, 0], ['Alley', 21, 32], ['Bridge', 70, 0], ['Kuroda', 52, 56]];
  return (
    <svg viewBox="0 0 560 560" role="img" aria-label="District map">
      <rect width="560" height="560" fill="rgba(243,238,228,0.04)" />
      <rect x="0" y={toMap(0, -7)[1]} width="560" height="40" fill="rgba(243,238,228,0.08)" />
      <rect x={toMap(-7, 0)[0]} y="0" width="40" height="560" fill="rgba(243,238,228,0.08)" />
      <rect x={toMap(61, 0)[0]} y="0" width="50" height="560" fill="rgba(111,211,255,0.12)" />
      {spots.map(([n, x, z]) => { const [mx, mz] = toMap(x, z); return <g key={n}><circle cx={mx} cy={mz} r="5" fill="rgba(243,238,228,0.5)" /><text x={mx + 10} y={mz + 4} fill="#f3eee4" font-size="12" font-family="var(--sans)" letter-spacing="0.1em">{n}</text></g>; })}
      <circle cx={px} cy={pz} r="7" fill="#ff3a6e" />
      <circle cx={px} cy={pz} r="12" fill="none" stroke="#ff3a6e" stroke-width="1" />
    </svg>
  );
}

function Range({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return <div class="row"><label>{label}</label><input type="range" min={min} max={max} step={step} value={value} onInput={(e) => onChange(Number((e.target as HTMLInputElement).value))} /><span class="v">{step < 1 ? value.toFixed(2) : value}</span></div>;
}

function Seg({ value, options, onChange }: { value: string; options: readonly string[]; onChange: (v: string) => void }) {
  return <div class="seg">{options.map((o) => <button key={o} class={o === value ? 'on' : ''} onClick={() => onChange(o)}>{o}</button>)}</div>;
}

function Defeat({ game }: { game: Game }) {
  return (
    <div class="defeat">
      <div>
        <div class="jp">敗北</div>
        <p>You went down in the rain. The Pacts you inscribed remain.</p>
        <div style="display:flex;gap:10px;justify-content:center;margin-top:18px">
          <button class="btn primary" onClick={() => game.startRun({ skipTutorial: true })}>Back to the street</button>
          <button class="btn" onClick={() => setState({ kind: 'title' })}>Title</button>
        </div>
      </div>
    </div>
  );
}
