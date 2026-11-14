import { useState } from 'preact/hooks';
import type { Game } from '../../app/game';
import { POIS, poiById, type Poi, type PoiId } from '../../nav/poi';
import { HALL, STORE, GATE, POND, SPAWN } from '../../world/compound';
import './nav.css';

// The map is the compound's plan, north up, in world metres: the walls, the
// hall and its roof, the storehouse, the gatehouse, the ring and the pond.
const HALF_X = 28, HALF_Z = 24;

type Selection = { kind: 'poi'; id: PoiId } | { kind: 'point'; x: number; z: number } | null;

export function NavMap({ game }: { game: Game }) {
  const nav = game.nav;
  const target = nav.target.value;
  const unlocked = nav.unlocked.value;
  const [sel, setSel] = useState<Selection>(target?.poi ? { kind: 'poi', id: target.poi } : null);
  const p = game.player.position;
  const heading = (-game.cam.heading * 180) / Math.PI;

  const dropPoint = (e: MouseEvent) => {
    const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const x = -HALF_X + ((e.clientX - r.left) / r.width) * 2 * HALF_X;
    const z = -HALF_Z + ((e.clientY - r.top) / r.height) * 2 * HALF_Z;
    setSel({ kind: 'point', x: Math.round(x), z: Math.round(z) });
  };
  const pick = (id: PoiId) => (e: Event) => { e.stopPropagation(); setSel({ kind: 'poi', id }); };
  const dist = (x: number, z: number) => Math.round(Math.hypot(x - p.x, z - p.z));

  return (
    <div class="nav-map">
      <svg viewBox={`${-HALF_X} ${-HALF_Z} ${HALF_X * 2} ${HALF_Z * 2}`} role="img" aria-label="Compound map" onClick={dropPoint}>
        <defs>
          <pattern id="water" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><line x1="0" y1="0" x2="0" y2="3" stroke="rgba(111,211,255,0.28)" stroke-width="0.4" /></pattern>
          <clipPath id="frame"><rect x={-HALF_X} y={-HALF_Z} width={HALF_X * 2} height={HALF_Z * 2} /></clipPath>
        </defs>
        <rect class="m-bg" x={-HALF_X} y={-HALF_Z} width={HALF_X * 2} height={HALF_Z * 2} />
        <g clip-path="url(#frame)">
          {[-20, -10, 0, 10, 20].map((g) => <g key={g} class="m-grid"><line x1={g} y1={-HALF_Z} x2={g} y2={HALF_Z} /><line x1={-HALF_X} y1={g} x2={HALF_X} y2={g} /></g>)}
          <rect class="m-yard" x={-24} y={-20} width={48} height={40} />
          <rect class="m-wall" x={-24.6} y={-20.6} width={49.2} height={41.2} />
          <circle class="m-ring" cx={SPAWN.ring.x} cy={SPAWN.ring.z} r={6} />
          <circle class="m-water" cx={POND.center.x} cy={POND.center.z} r={3.3} />
          <rect class="m-building" x={HALL.x0} y={HALL.z0} width={HALL.x1 - HALL.x0} height={HALL.z1 - HALL.z0} />
          <rect class="m-building" x={STORE.x0} y={STORE.z0} width={STORE.x1 - STORE.x0} height={STORE.z1 - STORE.z0} />
          <rect class="m-building" x={GATE.x0} y={GATE.z0} width={GATE.x1 - GATE.x0} height={GATE.z1 - GATE.z0} />
          <rect class="m-walk" x={22.4} y={STORE.z1} width={1.6} height={20 - STORE.z1} />
          <rect class="m-walk" x={GATE.x1 + 0.9} y={18.4} width={24 - GATE.x1 - 0.9} height={1.6} />
          <rect class="m-walk" x={-18} y={-13.6} width={3.4} height={2.6} />
          <rect class="m-walk" x={-17.9} y={-11} width={1.8} height={7.6} />
          <rect class="m-walk" x={14.3} y={-6.8} width={3.1} height={1.6} />
          <text class="m-street" x={0} y={-11.2} text-anchor="middle">HALL</text>
          <text class="m-street" x={(STORE.x0 + STORE.x1) / 2} y={(STORE.z0 + STORE.z1) / 2 + 0.6} text-anchor="middle">STORE</text>
          <text class="m-street" x={0} y={23} text-anchor="middle">GATE</text>
        </g>
        <text class="m-north" x={HALF_X - 3} y={-HALF_Z + 4} text-anchor="middle">N</text>
        <path class="m-north-arrow" d={`M${HALF_X - 3} ${-HALF_Z + 5} l-1.1 2.2 h2.2 z`} />
        {target && !target.poi && <Gem x={target.position.x} z={target.position.z} />}
        {sel?.kind === 'point' && <g class="m-point"><circle cx={sel.x} cy={sel.z} r={1.1} /><path d={`M${sel.x - 2} ${sel.z}h1.3M${sel.x + 0.7} ${sel.z}h1.3M${sel.x} ${sel.z - 2}v1.3M${sel.x} ${sel.z + 0.7}v1.3`} /></g>}
        {POIS.map((poi) => <PoiIcon key={poi.id} poi={poi} unlocked={unlocked.has(poi.id)} tracked={target?.poi === poi.id} selected={sel?.kind === 'poi' && sel.id === poi.id} onPick={pick(poi.id)} />)}
        <g class="m-player" transform={`translate(${p.x} ${p.z}) rotate(${heading})`}><circle r={2.6} class="halo" /><path d="M0 -2.2 L1.5 1.6 L0 0.8 L-1.5 1.6 Z" /></g>
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
        <div class="map-legend"><span><b class="gem" /> tracked</span><span><b class="ring on" /> visited</span><span><b class="ring" /> not yet</span></div>
      </aside>
    </div>
  );
}

function Gem({ x, z }: { x: number; z: number }) {
  return <g class="m-gem" transform={`translate(${x} ${z})`}><path d="M0 -2 L1.5 0 L0 2 L-1.5 0 Z" /></g>;
}

function PoiIcon({ poi, unlocked, tracked, selected, onPick }: { poi: Poi; unlocked: boolean; tracked: boolean; selected: boolean; onPick: (e: Event) => void }) {
  return (
    <g class={`m-poi ${unlocked ? 'unlocked' : ''} ${tracked ? 'tracked' : ''} ${selected ? 'selected' : ''}`} data-map-poi={poi.id} transform={`translate(${poi.at.x} ${poi.at.z}) scale(0.5)`} role="button" tabIndex={0} aria-label={poi.name} onClick={onPick} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onPick(e); }}>
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
  const open = nav.visited(poi.id);
  const tracked = nav.isPinned(poi.id);
  return (
    <div class="map-detail" data-detail={poi.id}>
      <span class="kicker">{open ? 'Visited' : 'Not yet visited'}</span>
      <h3><span class="jp">{poi.jp}</span> {poi.name}</h3>
      <p>{poi.blurb}</p>
      <p class="meta"><span>{Math.round(Math.hypot(poi.at.x - p.x, poi.at.z - p.z))} m away</span></p>
      <div class="actions">
        {tracked
          ? <button class="btn" onClick={() => nav.untrack()}>Stop tracking</button>
          : <button class="btn primary" onClick={() => nav.track({ kind: 'poi', id: poi.id })}>Track</button>}
      </div>
    </div>
  );
}
