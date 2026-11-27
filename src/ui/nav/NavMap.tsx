import { useState } from 'preact/hooks';
import type { Game } from '../../app/game';
import { POIS, poiById, type Poi, type PoiId } from '../../nav/poi';
import { HALL, STORE, GATE, POND, SPAWN } from '../../world/compound';
import { VALLEY, ROAD, PATHS, STREAM, FALLS, BRIDGE, FIELD, GROUNDS, GINKGO, TERRACES, MEADOW, SHRINE, STONES, openness, type Pt } from '../../world/valleyPlan';
import type { RegionMap } from '../../world/city/region';
import './nav.css';

// The map is a plan, north up, in world metres, at two scales: the compound
// (the walls, the hall and its roof, the storehouse, the gatehouse, the ring
// and the pond) and the valley round it (the cliffs, the stream and its
// falls, the road and the paths, and the places along them). It opens on
// whichever the player stands in.
// With the city ward loaded (`?debug&region=city`) there is a third scale, its own plan.
type Scope = 'compound' | 'valley' | 'city';
const VIEW: Record<Exclude<Scope, 'city'>, { x: number; z: number; w: number; h: number; icon: number }> = {
  compound: { x: -28, z: -24, w: 56, h: 48, icon: 0.5 },
  valley: { x: -84, z: -64, w: 170, h: 170, icon: 1.25 },
};
const SCOPE_LABEL: Record<Scope, string> = { compound: 'Compound', valley: 'Valley', city: 'City' };
// Places inside the walls: at the valley's scale they keep their glyphs and drop their names.
const IN_WALLS = new Set<PoiId>(['hall', 'ring', 'pond', 'roof', 'store', 'gate']);
const line = (pts: readonly Pt[]): string => pts.map(([x, z], i) => `${i ? 'L' : 'M'}${x} ${z}`).join('');

type Selection = { kind: 'poi'; id: PoiId } | { kind: 'point'; x: number; z: number } | null;

export function NavMap({ game }: { game: Game }) {
  const nav = game.nav;
  const target = nav.target.value;
  const unlocked = nav.unlocked.value;
  const [sel, setSel] = useState<Selection>(target?.poi ? { kind: 'poi', id: target.poi } : null);
  const p = game.player.position;
  const city = game.city;
  const [scope, setScope] = useState<Scope>(city?.contains(p) ? 'city' : openness(p.x, p.z) > 0 ? 'valley' : 'compound');
  const vb = scope === 'city' && city ? { ...city.map.view, icon: 1.0 } : VIEW[scope === 'city' ? 'compound' : scope], k = vb.icon * 2;
  const scopes: Scope[] = city ? ['compound', 'valley', 'city'] : ['compound', 'valley'];
  const heading = (-game.cam.heading * 180) / Math.PI;

  const dropPoint = (e: MouseEvent) => {
    const m = (e.currentTarget as SVGSVGElement).getScreenCTM();
    if (!m) return;
    const at = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    setSel({ kind: 'point', x: Math.round(at.x), z: Math.round(at.y) });
  };
  const pick = (id: PoiId) => (e: Event) => { e.stopPropagation(); setSel({ kind: 'poi', id }); };
  const dist = (x: number, z: number) => Math.round(Math.hypot(x - p.x, z - p.z));

  return (
    <div class="nav-map">
      <svg viewBox={`${vb.x} ${vb.z} ${vb.w} ${vb.h}`} role="img" aria-label={`${SCOPE_LABEL[scope]} map`} data-scope={scope} onClick={dropPoint}>
        <defs>
          <pattern id="water" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><line x1="0" y1="0" x2="0" y2="3" stroke="rgba(111,211,255,0.28)" stroke-width="0.4" /></pattern>
          <clipPath id="frame"><rect x={vb.x} y={vb.z} width={vb.w} height={vb.h} /></clipPath>
        </defs>
        <rect class="m-bg" x={vb.x} y={vb.z} width={vb.w} height={vb.h} />
        <g clip-path="url(#frame)">
          {scope === 'city' && city && <CityPlan map={city.map} scale={vb.icon} />}
          {scope !== 'city' && <>
          <ValleyPlan />
          {scope === 'compound' && [-20, -10, 0, 10, 20].map((g) => <g key={g} class="m-grid"><line x1={g} y1={vb.z} x2={g} y2={vb.z + vb.h} /><line x1={vb.x} y1={g} x2={vb.x + vb.w} y2={g} /></g>)}
          <rect class="m-yard" x={-24} y={-20} width={48} height={40} />
          <rect class="m-wall" x={-24.6} y={-20.6} width={49.2} height={41.2} />
          <circle class="m-ring" cx={SPAWN.ring.x} cy={SPAWN.ring.z} r={6} />
          <circle class="m-water" cx={POND.center.x} cy={POND.center.z} r={3.3} />
          <rect class="m-building" x={HALL.x0} y={HALL.z0} width={HALL.x1 - HALL.x0} height={HALL.z1 - HALL.z0} />
          <rect class="m-building" x={STORE.x0} y={STORE.z0} width={STORE.x1 - STORE.x0} height={STORE.z1 - STORE.z0} />
          <rect class="m-building" x={GATE.x0} y={GATE.z0} width={GATE.x1 - GATE.x0} height={GATE.z1 - GATE.z0} />
          {scope === 'compound' && <>
            <rect class="m-walk" x={22.4} y={STORE.z1} width={1.6} height={20 - STORE.z1} />
            <rect class="m-walk" x={GATE.x1 + 0.9} y={18.4} width={24 - GATE.x1 - 0.9} height={1.6} />
            <rect class="m-walk" x={-18} y={-13.6} width={3.4} height={2.6} />
            <rect class="m-walk" x={-17.9} y={-11} width={1.8} height={7.6} />
            <rect class="m-walk" x={14.3} y={-6.8} width={3.1} height={1.6} />
            <text class="m-street" x={0} y={-11.2} text-anchor="middle">HALL</text>
            <text class="m-street" x={(STORE.x0 + STORE.x1) / 2} y={(STORE.z0 + STORE.z1) / 2 + 0.6} text-anchor="middle">STORE</text>
            <text class="m-street" x={0} y={23} text-anchor="middle">GATE</text>
          </>}
          </>}
        </g>
        <g transform={`translate(${vb.x + vb.w - 3 * k} ${vb.z + 4 * k}) scale(${k})`}>
          <text class="m-north" x={0} y={0} text-anchor="middle">N</text>
          <path class="m-north-arrow" d="M0 1 l-1.1 2.2 h2.2 z" />
        </g>
        {target && !target.poi && <Gem x={target.position.x} z={target.position.z} s={k} />}
        {sel?.kind === 'point' && <g class="m-point" transform={`translate(${sel.x} ${sel.z}) scale(${k})`}><circle r={1.1} /><path d="M-2 0h1.3M0.7 0h1.3M0 -2v1.3M0 0.7v1.3" /></g>}
        {scope !== 'city' && POIS.map((poi) => <PoiIcon key={poi.id} poi={poi} scale={vb.icon} named={scope === 'compound' || !IN_WALLS.has(poi.id)} view={vb} unlocked={unlocked.has(poi.id)} tracked={target?.poi === poi.id} selected={sel?.kind === 'poi' && sel.id === poi.id} onPick={pick(poi.id)} />)}
        <g class="m-player" transform={`translate(${p.x} ${p.z}) rotate(${heading}) scale(${k})`}><circle r={2.6} class="halo" /><path d="M0 -2.2 L1.5 1.6 L0 0.8 L-1.5 1.6 Z" /></g>
      </svg>
      <aside class="map-side">
        <div class="map-scope" role="group" aria-label="Map scale">
          {scopes.map((id) => <button key={id} class={scope === id ? 'on' : ''} aria-pressed={scope === id} data-scope={id} onClick={() => setScope(id)}>{SCOPE_LABEL[id]}</button>)}
        </div>
        <Detail game={game} sel={sel} onClose={() => setSel(null)} />
        {scope === 'city' && city ? <ul class="map-list">
          {city.map.places.map((pl) => (
            <li key={pl.id}>
              <button class={sel?.kind === 'point' && sel.x === Math.round(pl.x) && sel.z === Math.round(pl.z) ? 'on' : ''} data-place={pl.id} onClick={() => setSel({ kind: 'point', x: Math.round(pl.x), z: Math.round(pl.z) })}>
                <span class="g">{[...pl.jp][0]}</span>
                <span class="n">{pl.name}</span>
                <span class="d">{dist(pl.x, pl.z)} m</span>
              </button>
            </li>
          ))}
        </ul> : <ul class="map-list">
          {POIS.map((poi) => (
            <li key={poi.id}>
              <button class={`${sel?.kind === 'poi' && sel.id === poi.id ? 'on' : ''} ${target?.poi === poi.id ? 'tracked' : ''}`} data-poi={poi.id} onClick={() => setSel({ kind: 'poi', id: poi.id })}>
                <span class={`g ${unlocked.has(poi.id) ? 'unlocked' : ''}`}>{poi.glyph}</span>
                <span class="n">{poi.name}</span>
                <span class="d">{dist(poi.at.x, poi.at.z)} m</span>
              </button>
            </li>
          ))}
        </ul>}
        <div class="map-legend"><span><b class="gem" /> tracked</span><span><b class="ring on" /> visited</span><span><b class="ring" /> not yet</span></div>
      </aside>
    </div>
  );
}

function Gem({ x, z, s }: { x: number; z: number; s: number }) {
  return <g class="m-gem" transform={`translate(${x} ${z}) scale(${s})`}><path d="M0 -2 L1.5 0 L0 2 L-1.5 0 Z" /></g>;
}

// The valley under the compound: the cliffs, the woods, the stream, the road
// and the paths, and the places along them, all from the plan the world is built from.
function ValleyPlan() {
  const V = VALLEY, T = TERRACES, tw = (T.x1 - T.x0) / T.tiers;
  return (
    <g class="m-valley">
      <rect class="m-ground" x={V.x0 - 60} y={V.z0 - 60} width={V.x1 - V.x0 + 120} height={V.z1 - V.z0 + 120} />
      <rect class="m-floor" x={V.x0} y={V.z0} width={V.x1 - V.x0} height={V.z1 - V.z0} rx={V.r} />
      <rect class="m-cliff" x={V.x0 - 3} y={V.z0 - 3} width={V.x1 - V.x0 + 6} height={V.z1 - V.z0 + 6} rx={V.r + 3} />
      <rect class="m-wood" x={-56} y={V.z0 + 1} width={116} height={18} rx={6} />
      <rect class="m-wood" x={V.x0 + 1} y={-40} width={20} height={86} rx={6} />
      <ellipse class="m-meadow" cx={(MEADOW.x0 + MEADOW.x1) / 2} cy={(MEADOW.z0 + MEADOW.z1) / 2 + 1} rx={(MEADOW.x1 - MEADOW.x0) / 2 - 2} ry={(MEADOW.z1 - MEADOW.z0) / 2 - 3.5} />
      {Array.from({ length: T.tiers }, (_, i) => <rect key={i} class="m-paddy" x={T.x1 - (i + 1) * tw + 0.3} y={T.z0} width={tw - 0.6} height={T.z1 - T.z0} />)}
      <path class="m-stream" d={line(STREAM)} />
      <circle class="m-water" cx={FALLS.x} cy={FALLS.z} r={FALLS.pool + 1} />
      <path class="m-path" d={PATHS.map(line).join('')} />
      <path class="m-road" d={line(ROAD)} />
      <rect class="m-field" x={FIELD.x - FIELD.half} y={FIELD.z - FIELD.half} width={FIELD.half * 2} height={FIELD.half * 2} />
      <circle class="m-field" cx={GROUNDS.x} cy={GROUNDS.z} r={GROUNDS.r} />
      <circle class="m-ginkgo" cx={GINKGO.x} cy={GINKGO.z} r={5.5} />
      <rect class="m-bridge" x={BRIDGE.x - BRIDGE.half} y={BRIDGE.z0} width={BRIDGE.half * 2} height={BRIDGE.z1 - BRIDGE.z0} />
      <line class="m-stones" x1={STONES.x} y1={STONES.z0} x2={STONES.x} y2={STONES.z1} />
      <rect class="m-structure" x={SHRINE.x0} y={SHRINE.z0} width={SHRINE.x1 - SHRINE.x0} height={SHRINE.z1 - SHRINE.z0} />
      <line class="m-torii" x1={SHRINE.x - 3} y1={SHRINE.toriiZ} x2={SHRINE.x + 3} y2={SHRINE.toriiZ} />
    </g>
  );
}

// The city ward from its plan: streets, paving, water and the tracks under
// the buildings, roofs that can be walked a shade lighter, decks and stairs,
// and the places named.
function CityPlan({ map, scale }: { map: RegionMap; scale: number }) {
  const cls: Record<RegionMap['shapes'][number]['kind'], string> = { building: 'm-building', roof: 'm-walk', street: 'm-city-street', paving: 'm-city-paving', water: 'm-water', rail: 'm-city-rail', green: 'm-floor', deck: 'm-walk', stair: 'm-city-stair' };
  return (
    <g class="m-city">
      {map.shapes.map((s, i) => <rect key={i} class={cls[s.kind]} x={s.x} y={s.z} width={s.w} height={s.h} />)}
      {map.places.map((pl) => <text key={pl.id} class="m-street" x={pl.x} y={pl.z} text-anchor="middle" style={{ fontSize: `${2.2 * scale}px` }}>{pl.name.toUpperCase()}</text>)}
    </g>
  );
}

// A name near the map's side reads inward, so it is not cut off at the edge.
function nameAnchor(x: number, view: { x: number; w: number }, scale: number): { x: number; 'text-anchor': 'start' | 'middle' | 'end' } {
  const edge = 24 * scale;
  if (x > view.x + view.w - edge) return { x: 8, 'text-anchor': 'end' };
  if (x < view.x + edge) return { x: -8, 'text-anchor': 'start' };
  return { x: 0, 'text-anchor': 'middle' };
}

function PoiIcon({ poi, scale, named, view, unlocked, tracked, selected, onPick }: { poi: Poi; scale: number; named: boolean; view: { x: number; w: number }; unlocked: boolean; tracked: boolean; selected: boolean; onPick: (e: Event) => void }) {
  return (
    <g class={`m-poi ${unlocked ? 'unlocked' : ''} ${tracked ? 'tracked' : ''} ${selected ? 'selected' : ''}`} data-map-poi={poi.id} transform={`translate(${poi.at.x} ${poi.at.z}) scale(${scale})`} role="button" tabIndex={0} aria-label={poi.name} onClick={onPick} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onPick(e); }}>
      <circle class="hit" r={8} />
      <circle class="ring" r={5.6} />
      <circle class="face" r={4.4} />
      <text class="glyph" y={1.9} text-anchor="middle">{poi.glyph}</text>
      {named && <text class="name" y={10.6} {...nameAnchor(poi.at.x, view, scale)}>{poi.name}</text>}
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
