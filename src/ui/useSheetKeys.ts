import { useEffect, useRef } from 'preact/hooks';
import { capturing } from '../app/keymap';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select, [tabindex]:not([tabindex="-1"])';

// Keyboard control for a sheet. Tab belongs to the game (it opens the
// Workshop), so sheets move with the arrows instead: Up and Down step
// through what can be pressed, Left and Right step along a row of choices
// (tabs, a segmented switch), Enter presses. With `tabs`, Q and E (or Page
// Up and Page Down) change tab, as shoulder buttons would. Nothing here
// runs while a key is being rebound.
export function useSheetKeys(root: { current: HTMLElement | null }, opts: { tabs?: { prev(): void; next(): void }; focusKey?: unknown } = {}): void {
  const live = useRef(opts);
  live.current = opts;
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    // Opening the sheet or a new tab lands on its first choice, so Enter does something at once.
    const first = el.querySelector<HTMLElement>('[data-autofocus]') ?? el.querySelector<HTMLElement>(`.body ${FOCUSABLE}`);
    first?.focus({ preventScroll: true });
  }, [opts.focusKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = root.current;
      if (!el || capturing.value || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      const typing = target instanceof HTMLInputElement && target.type !== 'range' || target instanceof HTMLTextAreaElement;
      if (typing) return;
      const tabs = live.current.tabs;
      if (tabs && (e.code === 'KeyQ' || e.code === 'PageUp')) { e.preventDefault(); tabs.prev(); return; }
      if (tabs && (e.code === 'KeyE' || e.code === 'PageDown')) { e.preventDefault(); tabs.next(); return; }
      const vertical = e.key === 'ArrowDown' || e.key === 'ArrowUp';
      const horizontal = e.key === 'ArrowLeft' || e.key === 'ArrowRight';
      if (!vertical && !horizontal) return;
      // A slider keeps Left and Right for itself.
      if (horizontal && target instanceof HTMLInputElement && target.type === 'range') return;
      const dir = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1;
      const row = horizontal ? target?.closest('[role="tablist"], .seg, [data-row]') : null;
      if (horizontal && !row) return;
      const scope = row ?? el;
      const items = [...scope.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null && (!vertical || !n.closest('[role="tablist"]')));
      if (!items.length) return;
      e.preventDefault();
      // Up and Down treat a row of choices as one stop: from inside a row
      // they move to the next thing outside it.
      const here = target && el.contains(target) ? target : null;
      const groupOf = (n: HTMLElement) => n.closest('.seg, [data-row]') ?? n;
      let i = here ? items.indexOf(here) : -1;
      if (i < 0) { (dir > 0 ? items[0] : items[items.length - 1])!.focus(); return; }
      // The list wraps, as a menu does.
      const start = groupOf(items[i]!), n = items.length;
      for (let k = 0; k < n; k++) { i = (i + dir + n) % n; if (!vertical || groupOf(items[i]!) !== start) break; }
      const next = items[i]!;
      // Entering a row lands on its chosen item.
      const pick = vertical && groupOf(next) !== next ? groupOf(next).querySelector<HTMLElement>('.on') ?? next : next;
      pick.focus();
      pick.scrollIntoView({ block: 'nearest' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
