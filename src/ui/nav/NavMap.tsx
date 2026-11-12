import { useState } from 'preact/hooks';
import type { Game } from '../../app/game';
import { POIS, poiById, type Poi, type PoiId } from '../../nav/poi';
import './nav.css';

// The map shows the district as a 180 m square, north up, in world metres.
const HALF = 90;

// Street bands, from the sidewalk lines laid out in world/district.ts.
const ROADS: { x: number; z: number; w: number; d: number }[] = [
  { x: -80, z: -9, w: 144, d: 18 },
  { x: -8, z: -68, w: 16, d: 56 },
  { x: -8, z: 12, w: 16, d: 48 },
];

type Selection = { kind: 'poi'; id: PoiId } | { kind: 'point'; x: number; z: number } | null;

export function NavMap({ game }: { game: Game }) {
  const nav = game.nav;
  const target = nav.target.value;
  const unlocked = nav.unlocked.value;
  const [sel, setSel] = useState<Selection>(target?.poi ? { kind: 'poi', id: target.poi } : null);
  const p = game.player.position;
  const heading = (-game.cam.yaw * 180) / Math.PI;
  const zones = game.district.zones;

  const dropPoint = (e: MouseEvent) => {
    const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const x = -HALF + ((e.clientX - r.left) / r.width) * 2 * HALF;
    const z = -HALF + ((e.clientY - r.top) / r.height) * 2 * HALF;
    setSel({ kind: 'point', x: Math.round(x), z: Math.round(z) });
  };
  const pick = (id: PoiId) => (e: Event) => { e.stopPropagation(); setSel({ kind: 'poi', id }); };
  const dist = (x: number, z: number) => Math.round(Math.hypot(x - p.x, z - p.z));

  return (
    <div class="nav-map">
      <svg viewBox={`${-HALF} ${-HALF} ${HALF * 2} ${HALF * 2}`} role="img" aria-label="District map" onClick={dropPoint}>
        <defs>
          <pattern id="water" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><line x1="0" y1="0" x2="0" y2="3" stroke="rgba(111,211,255,0.28)" stroke-width="0.4" /></pattern>
          <pattern id="tiles" width="4" height="4" patternUnits="userSpaceOnUse"><path d="M4 0H0V4" fill="none" stroke="rgba(243,238,228,0.1)" stroke-width="0.25" /></pattern>
          <clipPath id="frame"><rect x={-HALF} y={-HALF} width={HALF * 2} height={HALF * 2} /></clipPath>
        </defs>
        <rect class="m-bg" x={-HALF} y={-HALF} width={HALF * 2} height={HALF * 2} />
        <g clip-path="url(#frame)">
          {[-60, -30, 0, 30, 60].map((g) => <g key={g} class="m-grid"><line x1={g} y1={-HALF} x2={g} y2={HALF} /><line x1={-HALF} y1={g} x2={HALF} y2={g} /></g>)}
          {ROADS.map((r, i) => <rect key={i} class="m-road" x={r.x} y={r.z} width={r.w} height={r.d} />)}
          <line class="m-lane" x1={-80} y1={0} x2={64} y2={0} />
          {zones.filter((z) => z.id === 'academy').map((z) => <rect key={z.id} class="m-yard" x={z.min.x} y={z.min.z} width={z.max.x - z.min.x} height={z.max.z - z.min.z} />)}
          {zones.filter((z) => z.id === 'kuroda' || z.id === 'alley').map((z) => <rect key={z.id} class="m-yard thin" x={z.min.x} y={z.min.z} width={z.max.x - z.min.x} height={z.max.z - z.min.z} />)}
          {zones.filter((z) => z.id === 'canal').map((z) => <rect key={z.id} class="m-water" x={z.min.x} y={-HALF} width={z.max.x - z.min.x} height={HALF * 2} />)}
          {zones.filter((z) => z.id === 'bridge').map((z) => <rect key={z.id} class="m-bridge" x={z.min.x + 1} y={-3.5} width={z.max.x - z.min.x - 2} height={7} />)}
          {game.district.footprints.map((f, i) => <rect key={i} class="m-building" x={f.x - f.w / 2} y={f.z - f.d / 2} width={f.w} height={f.d} />)}
          {zones.filter((z) => z.id === 'dojo').map((z) => <rect key={z.id} class="m-building dojo" x={z.min.x} y={z.min.z} width={z.max.x - z.min.x} height={z.max.z - z.min.z} />)}
          <text class="m-street" x={-26} y={-11.5} text-anchor="middle">MARKET STREET</text>
          <text class="m-street" x={72} y={-80} text-anchor="middle">CANAL</text>
        </g>
        <text class="m-north" x={HALF - 6} y={-HALF + 9} text-anchor="middle">N</text>
        <path class="m-north-arrow" d={`M${HALF - 6} ${-HALF + 11} l-2.2 4.4 h4.4 z`} />
        {target && !target.poi && <Gem x={target.position.x} z={target.position.z} />}
        {sel?.kind === 'point' && <g class="m-point"><circle cx={sel.x} cy={sel.z} r={2.2} /><path d={`M${sel.x - 4} ${sel.z}h2.6M${sel.x + 1.4} ${sel.z}h2.6M${sel.x} ${sel.z - 4}v2.6M${sel.x} ${sel.z + 1.4}v2.6`} /></g>}
        {POIS.map((poi) => <PoiIcon key={poi.id} poi={poi} unlocked={unlocked.has(poi.id)} tracked={target?.poi === poi.id} selected={sel?.kind === 'poi' && sel.id === poi.id} onPick={pick(poi.id)} />)}
        <g class="m-player" transform={`translate(${p.x} ${p.z}) rotate(${heading})`}><circle r={5.5} class="halo" /><path d="M0 -4.6 L3.2 3.4 L0 1.6 L-3.2 3.4 Z" /></g>
      </svg>
      <aside class="map-side">
        <Detail game={game} sel={sel} onClose={() => setSel(null)} />
        <ul class="map-list">
          {POIS.map((poi) => (
            <li key={poi.id}>
              <button class={`${sel?.kind === 'poi' && sel.id === poi.id ? 'on' : ''} ${target?.poi === poi.id ? 'tracked' : ''}`} data-poi={poi.id} onClick={() => setSel({ kind: 'poi', id: poi.id })}>
                <span class={`g ${unlocked.has(poi.id) ? 'unlocked' : ''}`}>{poi.glyph}</span>
                <span class="n">{poi.name}</span>
                <span class="d">{dist(poi.at.x, poi.at.z)} m</span>
              </button>
            </li>
          ))}
        </ul>
        <div class="map-legend"><span><b class="gem" /> tracked</span><span><b class="ring on" /> waypoint</span><span><b class="ring" /> locked</span></div>
      </aside>
    </div>
  );
}

function Gem({ x, z }: { x: number; z: number }) {
  return <g class="m-gem" transform={`translate(${x} ${z})`}><path d="M0 -4.2 L3.2 0 L0 4.2 L-3.2 0 Z" /></g>;
}

function PoiIcon({ poi, unlocked, tracked, selected, onPick }: { poi: Poi; unlocked: boolean; tracked: boolean; selected: boolean; onPick: (e: Event) => void }) {
  return (
    <g class={`m-poi ${unlocked ? 'unlocked' : ''} ${tracked ? 'tracked' : ''} ${selected ? 'selected' : ''}`} data-map-poi={poi.id} transform={`translate(${poi.at.x} ${poi.at.z})`} role="button" tabIndex={0} aria-label={poi.name} onClick={onPick} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onPick(e); }}>
      <circle class="hit" r={8} />
      <circle class="ring" r={5.6} />
      <circle class="face" r={4.4} />
      <text class="glyph" y={1.9} text-anchor="middle">{poi.glyph}</text>
      <text class="name" y={10.6} text-anchor="middle">{poi.name}</text>
      {tracked && <path class="gem" d="M0 -9 L2.6 -6.4 L0 -3.8 L-2.6 -6.4 Z" />}
    </g>
  );
}

function Detail({ game, sel, onClose }: { game: Game; sel: Selection; onClose: () => void }) {
  const nav = game.nav;
  const p = game.player.position;
  if (!sel) {
    return <div class="map-detail empty"><span class="kicker">Map</span><p>Choose a place to read about it and track it. Click open ground to drop a pin.</p></div>;
  }
  if (sel.kind === 'point') {
    const pinned = nav.pin.value?.kind === 'point' && nav.pin.value.x === sel.x && nav.pin.value.z === sel.z;
    return (
      <div class="map-detail">
        <span class="kicker">Map pin</span>
        <h3>Dropped pin</h3>
        <p class="meta"><span>{Math.round(Math.hypot(sel.x - p.x, sel.z - p.z))} m away</span></p>
        <div class="actions">
          {pinned ? <button class="btn" onClick={() => { nav.untrack(); onClose(); }}>Stop tracking</button> : <button class="btn primary" onClick={() => nav.track({ kind: 'point', x: sel.x, z: sel.z })}>Track</button>}
        </div>
      </div>
    );
  }
  const poi = poiById(sel.id);
  const open = nav.unlocked.value.has(poi.id);
  const tracked = nav.isPinned(poi.id);
  const can = nav.canTravel(poi.id);
  return (
    <div class="map-detail" data-detail={poi.id}>
      <span class="kicker">{open ? 'Waypoint unlocked' : 'Waypoint not yet found'}</span>
      <h3><span class="jp">{poi.jp}</span> {poi.name}</h3>
      <p>{poi.blurb}</p>
      <p class="meta"><span>{Math.round(Math.hypot(poi.at.x - p.x, poi.at.z - p.z))} m away</span></p>
      <div class="actions">
        {tracked
          ? <button class="btn" onClick={() => nav.untrack()}>Stop tracking</button>
          : <button class="btn primary" onClick={() => nav.track({ kind: 'poi', id: poi.id })}>Track</button>}
        <button class="btn" disabled={!can.ok} onClick={() => nav.travel(poi.id)}>Fast travel</button>
      </div>
      {!can.ok && <p class="why">{can.reason}</p>}
    </div>
  );
}
