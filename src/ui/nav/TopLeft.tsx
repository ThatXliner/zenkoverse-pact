import type { Game } from '../../app/game';
import { settings } from '../../app/settings';
import { KITS, techUi } from '../../techniques/techniques';
import { MASTERY_STATS, MASTERY_CONFIG } from '../../mastery/mastery';
import { navUi } from '../../nav/navigation';
import { keyLabel } from '../../app/keymap';

const KEYS = [['camera', 'camera'], ['workshop', 'workshop'], ['map', 'map'], ['wager', 'wager'], ['aura', 'aura'], ['pause', 'menu']] as const;
const SOURCE = { goal: 'Goal', tutorial: 'Tutorial', pin: 'Pin' } as const;

// The one column in the top-left corner: what you are tracking, then the
// dim reminders. Everything sits in the flow of this column, so its margin
// is the HUD margin at every window size.
export function TopLeft({ game }: { game: Game }) {
  const t = navUi.view.value.target;
  const s = settings.value;
  const kit = KITS[game.techniqueId];
  const mast = game.mastery.stats.value[game.techniqueId];
  const sign = techUi.variant.value === 'none' ? 'silent activation' : techUi.variant.value === 'short' ? 'short sign' : 'full sign';
  return (
    <div class="top-left">
      {t && (
        <div class="tracker">
          <span class="kicker"><b class="gem" />{SOURCE[t.source]} · tracking</span>
          <span class="tr-title">{t.title}</span>
          <span class="tr-sub"><span>{t.subtitle}</span><span class="tr-dist">{Math.round(t.dist)} m</span></span>
        </div>
      )}
      {s.showMastery && (
        <div class="hint">
          <span>{kit.name} · {sign}{s.fullSignHold ? ` · ${keyLabel('fullsign')} holds the full sign` : ''}</span>
          <span class="keys">{KEYS.map(([action, what]) => <span key={action}><b>{keyLabel(action)}</b> {what}</span>)}</span>
          {MASTERY_CONFIG.showNumbers && <div class="mastery">{MASTERY_STATS.map((st) => <span key={st}>{st} <b>{Math.round(mast[st] * 100)}</b></span>)}</div>}
        </div>
      )}
    </div>
  );
}
