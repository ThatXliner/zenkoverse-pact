import { hud } from '../../app/game';
import { appState } from '../../app/state';
import { navUi, type CompassPip, type NavView } from '../../nav/navigation';
import { ZONE_JP } from '../../nav/poi';
import './nav.css';

// Degrees of the horizon the compass strip shows, centred on where you look.
const SPAN = 150;
const TICK_STEP = 15;
const CARDINALS: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };

const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
const metres = (d: number) => `${Math.round(d)} m`;
const pct = (rel: number) => `${50 + (rel / SPAN) * 100}%`;

export function NavHud() {
  const view = navUi.view.value;
  const fade = navUi.travelFade.value;
  const live = appState.value.kind !== 'paused';
  return (
    <>
      <TopCenter view={view} />
      {live && view.marker && view.target && <Marker view={view} />}
      {live && view.labels.map((l) => <div key={l.id} class="nav-label" style={{ left: `${l.x}px`, top: `${l.y}px`, opacity: l.opacity }}><span class="jp">{l.jp}</span><span class="en">{l.name}</span></div>)}
      {fade > 0 && <div class="travel-fade" key={fade} />}
    </>
  );
}

function TopCenter({ view }: { view: NavView }) {
  const zone = hud.zone.value;
  return (
    <div class="top-center">
      <Compass view={view} />
      {zone && <div class="zone-line" key={zone.id}><span class="jp">{ZONE_JP[zone.id] ?? ''}</span><span class="en">{zone.label}</span></div>}
    </div>
  );
}

function Compass({ view }: { view: NavView }) {
  const ticks: { a: number; rel: number }[] = [];
  for (let a = 0; a < 360; a += TICK_STEP) {
    const rel = wrap(a - view.heading);
    if (Math.abs(rel) <= SPAN / 2) ticks.push({ a, rel });
  }
  const tracked = view.pips.find((p) => p.tracked);
  const others = view.pips.filter((p) => !p.tracked);
  return (
    <div class="compass" role="img" aria-label="Compass">
      <div class="strip">
        {ticks.map(({ a, rel }) => {
          const name = CARDINALS[a];
          return name
            ? <span key={a} class={`dir ${name.length === 1 ? 'main' : ''}`} style={{ left: pct(rel) }}>{name}</span>
            : <i key={a} class={a % 45 === 0 ? 'tick long' : 'tick'} style={{ left: pct(rel) }} />;
        })}
        {others.map((p) => <Pip key={p.id} pip={p} />)}
      </div>
      {tracked && <div class="tracked-layer"><TrackedPip pip={tracked} /></div>}
      <span class="caret" />
    </div>
  );
}

function Pip({ pip }: { pip: CompassPip }) {
  if (Math.abs(pip.rel) > SPAN / 2 - 4) return null;
  const near = Math.max(0.5, 1 - pip.dist / 160);
  return <span class={`pip ${pip.unlocked ? 'unlocked' : ''}`} style={{ left: pct(pip.rel), opacity: near }}><b>{pip.glyph}</b></span>;
}

function TrackedPip({ pip }: { pip: CompassPip }) {
  const half = SPAN / 2 - 5;
  const off = Math.abs(pip.rel) > half;
  const rel = Math.max(-half, Math.min(half, pip.rel));
  const side = pip.rel > 0 && (off || pip.rel > 20) ? 'l' : 'r';
  return (
    <span class={`tracked-pip ${off ? 'off' : ''}`} style={{ left: pct(rel) }}>
      {off && pip.rel < 0 && <em class="chev left" />}
      <b class="gem" />
      {off && pip.rel > 0 && <em class="chev right" />}
      <span class={`d ${side}`}>{metres(pip.dist)}</span>
    </span>
  );
}

function Marker({ view }: { view: NavView }) {
  const m = view.marker!;
  const t = view.target!;
  const named = view.labels.some((l) => l.id === t.poi && l.opacity > 0.3);
  const near = !m.edge && t.dist < 40 && (t.source !== 'pin' || !named);
  return (
    <div class={`nav-marker ${m.edge ? 'edge' : ''}`} style={{ left: `${m.x}px`, top: `${m.y}px` }}>
      {m.edge && <i class="arrow" style={{ transform: `rotate(${m.angle}deg) translateY(-30px)` }} />}
      {near && <span class="name">{t.title}</span>}
      <b class="gem" />
      <span class="d">{metres(t.dist)}</span>
    </div>
  );
}
