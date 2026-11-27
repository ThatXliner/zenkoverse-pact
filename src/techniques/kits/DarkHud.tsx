import type { Game } from '../../app/game';
import { darkUi } from './dark';

// What Dark Dimension keeps, as the HUD shows it under the resource: one
// tile per thing in the order it went in, the next out at the right end and
// raised. Each tile carries the thing's mark, an arrow for the way it is
// still moving (turned to the view) and its speed, red if it is hot, pale if
// it is in ice. Nothing is written about it: the tiles are the list.
export interface DarkStore { glyph: string; name: string; heading: number | null; speed: number; hot: boolean; cold: boolean }

export function DarkPanel(_: { game: Game }) {
  const list = darkUi.store.value;
  if (!list.length) return null;
  const next = darkUi.next.value;
  return (
    <div class="dark-store" aria-label={`Kept: ${list.map((k) => k.name).join(', ')}`}>
      {list.map((k, i) => (
        <span key={i} class={`kept${i === next ? ' next' : ''}${k.hot ? ' hot' : ''}${k.cold ? ' cold' : ''}`} title={k.name}>
          <b class="jp">{k.glyph}</b>
          {k.heading !== null && <i class="arrow" style={{ transform: `rotate(${k.heading}rad)` }} />}
          {k.speed > 0 && <small>{k.speed}</small>}
        </span>
      ))}
    </div>
  );
}
