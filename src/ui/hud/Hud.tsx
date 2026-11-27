import { useEffect, useRef, useState } from 'preact/hooks';
import type { Game } from '../../app/game';
import { hud } from '../../app/game';
import { appState } from '../../app/state';
import { keyLabel } from '../../app/keymap';
import { EXTRA_SLOTS, KEY_SLOTS, KIND_DEFS, slotDef, type AbilityKind, type KeySlot } from '../../pacts/slots';
import { KITS, techUi, type SlotLabel, type SignState } from '../../techniques/techniques';
import { MASTERY_CONFIG } from '../../mastery/mastery';
import { wagerUi, type WagerCall } from '../../techniques/wagers';
import { declareUi } from '../../techniques/declarations';
import { combatUi } from '../../combat/combat';
import { clashUi } from '../../combat/clash';
import { auraUi } from '../../combat/aura';
import { cutsceneUi } from '../../cutscene/cutscene';
import { blinkUi } from '../../techniques/kits/blink';
import { AuraMeter, ClashLayer } from '../Aura';
import { NavHud } from '../nav/NavHud';
import { OnlineHud } from '../Online';
import { Captions } from './Captions';
import { VaultSlot } from '../../eyes/EyeHud';
import './hud.css';

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const MAIN_SLOTS = KEY_SLOTS.filter((s) => slotDef(s).raw !== null);

// The play HUD. It keeps to the edges and says as little as it can: the
// captions in the top-left corner (what you are doing), the compass at the
// top, the vitals bottom-left and the Abilities bottom-right. What is only
// sometimes useful (mastery, the key list, an Ability's description) lives
// in the pause menu or shows when it changes.
export function Hud({ game }: { game: Game }) {
  const kit = KITS[game.techniqueId];
  const c = hex(kit.color);
  const prompt = hud.prompt.value;
  const ban = hud.banner.value;
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
  const root = useRef<HTMLDivElement>(null);
  useBottomBand(root, cut);
  return (
    <div ref={root} class={`hud ${cine ? 'letterbox' : ''} ${boss && !cut ? 'has-boss' : ''}`} style={{ '--c': c } as never}>
      <div class={`damage ${flash ? 'hit' : ''}`} />
      {blind > 0 && !cine && <div style={{ position: 'absolute', inset: 0, background: '#000', opacity: Math.min(1, blind / 1.5) }} />}
      {!cut && view !== 'top' && <div class={`reticle ${techUi.cooldowns.value.primary > 0 ? 'hot' : ''} ${third ? 'third' : ''}`} />}
      {!cut && view === 'top' && <Cursor hot={techUi.cooldowns.value.primary > 0} />}
      {!cut && <Vitals game={game} />}
      {!cut && <Abilities game={game} />}
      {!cut && <NavHud />}
      {!cut && <Captions game={game} />}
      {game.net && !cine && <OnlineHud game={game} />}
      {wagerUi.value && !cut && <WagerTag key={wagerUi.value.id} call={wagerUi.value} />}
      <ClashLayer game={game} />
      {boss && !cut && <div class="boss" style={{ '--c': hex(boss.color) } as never}><span class="n">{boss.name}</span><div class="track"><i style={{ width: `${boss.frac * 100}%` }} /></div></div>}
      {prompt && !cut && <div class="prompt"><kbd>{keyLabel('interact')}</kbd><span>{prompt.text}</span></div>}
      {ban && !cine && <div class="banner" key={ban.id}><div class="big jp">{ban.big}</div><div class="small">{ban.small}</div></div>}
      {title && <CutTitle key={title.id} title={title} />}
      {cine && <div class="skip">{keyLabel('jump').toUpperCase()} · SKIP</div>}
      <div style="position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none">
        {combatUi.numbers.value.map((n) => n.word
          ? <span key={n.id} class={`sfx-word${n.big ? ' big' : ''}`} style={{ left: `${n.x}%`, top: `${n.y}%`, '--tilt': `${n.tilt}deg`, '--word-color': n.color }}>{n.text}</span>
          : <span key={n.id} class={`dmg-num${n.big ? ' big' : ''}`} style={{ left: `${n.x}%`, top: `${n.y}%`, color: n.color }}>{n.text}</span>)}
        {!cut && declareUi.value.map((s) => <span key={s.id} class={`declare${s.small ? ' small' : ''}${s.wager ? ' wager' : ''}`} style={{ left: `${s.x}%`, top: `${s.y}%`, '--word-color': s.color } as never}>「{s.text}」</span>)}
      </div>
    </div>
  );
}

// A bar with its name. The kanji stays when the HUD is at rest and the word fades.
function Meter({ label, jp, value, color, cls, text }: { label: string; jp: string; value: number; color?: string; cls?: string; text?: string }) {
  return (
    <div class={`meter ${cls ?? ''}`} style={color ? ({ '--c': color } as never) : undefined}>
      <span class="lbl"><b class="jp">{jp}</b><span class="w">{label}</span></span><span class="val">{text ?? Math.round(value * 100)}</span>
      <div class="track"><i style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} /></div>
    </div>
  );
}

// Bottom-left: health, the Technique's resource, strain when there is any,
// and the aura. At rest (whole, nothing fighting, the aura ready) the words
// fade and only the bars stay, as Death Stranding's HUD does.
function Vitals({ game }: { game: Game }) {
  const kit = KITS[game.techniqueId];
  const hp = combatUi.hp.value;
  const strain = techUi.strain.value;
  const field = auraUi.field.value;
  const st = appState.value.kind;
  const busy = st === 'encounter' || st === 'drill' || st === 'rooftop' || !!combatUi.boss.value;
  const calm = hp >= 0.999 && strain <= 0.02 && (kit.gauge?.value.value ?? 0) <= 0.02 && field.state === 'ready' && !busy && !field.guardBroken;
  return (
    <div class={`vitals ${calm ? 'calm' : ''}`}>
      <Meter label="Health" jp="体" value={hp} cls={`health${hp < 0.3 ? ' low' : ''}${combatUi.mending.value ? ' mend' : ''}`} />
      <Meter label={kit.resource.name} jp={kit.glyph} value={techUi.resource.value} color={hex(kit.color)} cls="resource" />
      {strain > 0.02 && <Meter label="Strain" jp="疲" value={strain} cls="strain" />}
      {kit.gauge && kit.gauge.value.value > 0.02 && <Meter label={kit.gauge.name} jp={kit.gauge.glyph} value={Math.min(1, kit.gauge.value.value)} cls={`gauge${kit.gauge.value.value >= 1 ? ' over' : ''}`} />}
      <AuraMeter />
    </div>
  );
}

function Abilities({ game }: { game: Game }) {
  const kit = KITS[game.techniqueId];
  const slots = techUi.slots.value;
  const cd = techUi.cooldowns.value;
  const glyphs: Record<AbilityKind, string> = { primary: kit.glyph, secondary: '構', max: '全' };
  return (
    <div class={`abilities ${techUi.sign.value.kind}`}>
      <SignRing sign={techUi.sign.value} />
      <div class="xs" role="group" aria-label="Extra Abilities">
        {EXTRA_SLOTS.map((s) => <Extra key={s} slot={s} label={slots[s]} glyph={glyphs[slots[s].kind ?? 'primary']} cd={cooldownOf(s, slots[s].kind, cd)} />)}
        <VaultSlot />
      </div>
      <div class="mains">
        {MAIN_SLOTS.map((s) => { const r = cooldownOf(s, slots[s].kind, cd); return <Ability key={s} slot={s} label={slots[s]} glyph={glyphs[slots[s].kind!]} cd={r.cd} ready={r.ready} />; })}
      </div>
    </div>
  );
}

// The Maximum Output name card, as a fighting game's ultimate: a slash of
// the Output's colour cuts across the frame, speed lines rake it, the name
// slams in huge and slanted with the kanji stamped behind it, and the whole
// card shears away. The keyframes are in styles.css under "Cutscene title".
function CutTitle({ title }: { title: NonNullable<typeof cutsceneUi.title.value> }) {
  return (
    <div class="cut-title" style={{ '--c': hex(title.color) } as never} aria-live="polite">
      <div class="slash" />
      <div class="lines" />
      <div class="kanji jp">{title.jp}</div>
      <div class="name">
        <span class="sub">{title.sub}</span>
        <span class="en">{title.en}</span>
      </div>
    </div>
  );
}

// How tall the bottom corners stand (the vitals on the left, the Ability
// cards on the right), as --bottom-band on the HUD. The interact prompt sits
// above it.
function useBottomBand(root: { current: HTMLDivElement | null }, cut: boolean): void {
  useEffect(() => {
    const el = root.current;
    if (!el || cut) return;
    const corners = [...el.querySelectorAll<HTMLElement>(':scope > .vitals, :scope > .abilities')];
    const measure = () => el.style.setProperty('--bottom-band', `${Math.max(0, ...corners.map((c) => c.offsetHeight))}px`);
    const watch = new ResizeObserver(measure);
    for (const c of corners) watch.observe(c);
    measure();
    return () => watch.disconnect();
  }, [cut]);
}

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

// True for a few seconds after `key` changes (and after mount): a card that
// just got a new Ability says what it does, then folds back to its name.
function useFresh(key: string, ms = 6000): boolean {
  const [fresh, setFresh] = useState(true);
  useEffect(() => { setFresh(true); const t = setTimeout(() => setFresh(false), ms); return () => clearTimeout(t); }, [key]);
  return fresh;
}

// The compact cell for an extra slot: key, glyph, name. An empty slot folds
// to its key alone, so four empty slots do not read as four empty cards.
function Extra({ slot, label, glyph, cd }: { slot: KeySlot; label: SlotLabel; glyph: string; cd: { cd: number; ready: boolean } }) {
  const fresh = useFresh(label.empty ? '' : label.name);
  return (
    <div class={`x ${label.empty ? 'empty' : ''} ${cd.ready && !label.empty ? 'ready' : ''} ${label.preview ? 'preview' : ''} ${fresh && !label.empty ? 'fresh' : ''} ${label.dark ? 'dark' : ''}`} data-slot={slot} title={label.dark ? `${label.dark} is dark` : label.empty ? `${keyLabel(slot)}: empty. Inscribe a Pact on it in the Workshop.` : undefined}>
      <kbd>{keyLabel(slot)}</kbd>
      {!label.empty && <div class="box"><span class="glyph">{glyph}</span><div class="cool" style={{ height: `${Math.max(0, Math.min(1, cd.cd)) * 100}%` }} /><Bet label={label} /></div>}
      <span class="name">{label.empty ? label.dark ?? 'Empty' : label.name}</span>
    </div>
  );
}

// A key's name small enough to sit under a card on a narrow screen.
const SHORT_MOUSE: Record<string, string> = { 'Left click': 'LMB', 'Middle click': 'MMB', 'Right click': 'RMB', 'Mouse 4': 'M4', 'Mouse 5': 'M5' };
const shortKey = (label: string) => SHORT_MOUSE[label] ?? (label.length > 5 ? label.slice(0, 4) : label);

function Ability({ slot, label, glyph, cd, ready }: { slot: KeySlot; label: SlotLabel; glyph: string; cd: number; ready: boolean }) {
  const fresh = useFresh(`${label.name}|${label.preview ? 1 : 0}`);
  return (
    <div class={`ab ${ready ? 'ready' : ''} ${label.kind === 'max' ? 'max' : ''} ${label.preview ? 'preview' : ''} ${fresh ? 'fresh' : ''} ${label.dark ? 'dark' : ''}`} data-slot={slot} title={label.dark ? `${label.dark} is dark` : undefined}>
      <div class="box"><span class="glyph">{glyph}</span><div class="cool" style={{ height: `${Math.max(0, Math.min(1, cd)) * 100}%` }} /><Bet label={label} /></div>
      <div class="txt">
        <span class="key">{keyLabel(slot)}{label.preview ? ' · trying a draft' : ''}</span>
        <span class="key-short" aria-hidden="true">{shortKey(keyLabel(slot))}</span>
        <span class="name">{label.name}</span>
        <span class="what">{label.what}</span>
      </div>
    </div>
  );
}

// A Pact that holds a Wager wears the mark on its key: each cast is a bet.
function Bet({ label }: { label: SlotLabel }) {
  return label.wager ? <i class="bet jp" title={`Each cast wagers that ${label.wager}`}>賭</i> : null;
}

// The open Wager, under the player: what the cast called and both ends of
// the bet. How it fell is the banner's, with a gold or red ring.
function WagerTag({ call }: { call: WagerCall }) {
  const left = call.left !== null ? ` · ${call.left} s` : '';
  return (
    <div class="wager-call declared">
      <b class="jp">賭</b>
      <span>{call.pact} calls: {call.call}{left}<em><i>right: {call.win}</i><i>wrong: {call.lose}</i></em></span>
    </div>
  );
}
