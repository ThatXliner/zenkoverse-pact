import { effect } from '@preact/signals';
import type { hud as Hud } from '../app/game';
import { appState, type AppState } from '../app/state';
import type { Audio } from './audio';

// The interface's sounds, from what it shows rather than from each widget:
// any button, card or option sounds on hover and click; a toast, a banner and
// a plaque sound as they appear; the pause menu, the Workshop and defeat
// sound as the game enters and leaves them. A screen added later sounds
// without being told to.
const CLICKABLE = 'button, [role="button"], .card, .opt, .bk, .ph, summary, select, input[type="checkbox"]';

export function bindUiSounds(audio: Audio, hud: typeof Hud): void {
  let hovered: Element | null = null;
  document.addEventListener('pointerover', (e) => {
    const el = (e.target as Element | null)?.closest?.(CLICKABLE) ?? null;
    if (el && el !== hovered && !(el as HTMLButtonElement).disabled) audio.play('ui.hover');
    hovered = el;
  }, true);
  document.addEventListener('click', (e) => {
    const el = (e.target as Element | null)?.closest?.(CLICKABLE);
    if (el && !(el as HTMLButtonElement).disabled) audio.play('ui.click');
  }, true);
  // A slider sounds where it was let go, at the level it now sets.
  document.addEventListener('change', (e) => { if ((e.target as HTMLInputElement | null)?.type === 'range') audio.play('ui.select'); }, true);

  let lastToast = 0;
  effect(() => {
    for (const t of hud.toasts.value) {
      if (t.id <= lastToast) continue;
      lastToast = t.id;
      audio.play(t.tone === 'good' ? 'ui.toast.good' : t.tone === 'bad' ? 'ui.toast.bad' : 'ui.toast');
    }
  });
  let lastBanner = 0;
  effect(() => { const b = hud.banner.value; if (b && b.id !== lastBanner) { lastBanner = b.id; audio.play('ui.banner'); } });
  let plaque: string | null = null;
  effect(() => { const p = hud.plaque.value?.title ?? null; if (p && p !== plaque) audio.play('ui.plaque'); plaque = p; });

  let was: AppState['kind'] = appState.value.kind;
  effect(() => {
    const now = appState.value.kind;
    if (now === was) return;
    if (now === 'workshop') audio.play('ui.workshop.open');
    else if (was === 'workshop') audio.play('ui.workshop.close');
    else if (now === 'paused') audio.play('ui.pause');
    else if (was === 'paused' && now !== 'title') audio.play('ui.resume');
    if (now === 'defeat') audio.play('defeat');
    was = now;
  });
}
