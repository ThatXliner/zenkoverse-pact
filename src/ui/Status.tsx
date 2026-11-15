import type { Game } from '../app/game';
import { hud } from '../app/game';
import { keyLabel } from '../app/keymap';
import { KITS, techUi } from '../techniques/techniques';
import { MASTERY_STATS, MASTERY_CONFIG, type MasteryStat } from '../mastery/mastery';
import { auraUi } from '../combat/aura';
import { CAMERA_LABEL } from '../player/camera';

const SIGN_WORDS = { long: 'Full sign', short: 'Short sign', none: 'Silent activation' } as const;
export const STAT_WORDS: Record<MasteryStat, string> = {
  output: 'Output', precision: 'Precision', efficiency: 'Efficiency', range: 'Range', speed: 'Speed',
  control: 'Control', activation: 'Activation', tolerance: 'Tolerance', refinement: 'Refinement',
};
const pct = (x: number) => Math.round(x * 100);

// The status page beside the pause menu: the Technique in hand, how it is
// signed and seen, and the eight mastery stats with aura refinement. This is
// where the numbers live; the play HUD only says when one of them rises.
export function Status({ game }: { game: Game }) {
  const kit = KITS[game.techniqueId];
  const mast = game.mastery.stats.value[game.techniqueId];
  const aura = auraUi.training.value;
  const sign = SIGN_WORDS[techUi.variant.value];
  return (
    <aside class="status" aria-label="Status">
      <header>
        <span class="glyph jp" style={{ color: `#${kit.color.toString(16).padStart(6, '0')}` }}>{kit.glyph}</span>
        <div>
          <span class="kicker">{kit.type}</span>
          <h3>{kit.name}</h3>
        </div>
      </header>
      <dl class="facts">
        <div><dt>Sign</dt><dd>{sign}<small>{keyLabel('fullsign')} performs the full sign</small></dd></div>
        <div><dt>View</dt><dd>{CAMERA_LABEL[hud.camera.value]}<small>{keyLabel('camera')} changes it</small></dd></div>
        <div><dt>Resource</dt><dd>{kit.resource.name}</dd></div>
      </dl>
      {MASTERY_CONFIG.showNumbers && (
        <div class="mastery">
          <span class="kicker">Training · 修行</span>
          <ul>
            {MASTERY_STATS.map((st) => {
              const v = st === 'refinement' ? aura.refinement : mast[st];
              return (
                <li key={st} data-stat={st}>
                  <span class="n">{STAT_WORDS[st]}</span>
                  <span class="v">{pct(v)}{st === 'refinement' && <small> / {pct(aura.potential)}</small>}</span>
                  <span class="bar"><i style={{ width: `${pct(v)}%` }} />{st === 'refinement' && <s style={{ left: `${pct(aura.potential)}%` }} />}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </aside>
  );
}
