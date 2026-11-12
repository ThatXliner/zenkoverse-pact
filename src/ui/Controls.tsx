import { useEffect, useLayoutEffect, useState } from 'preact/hooks';
import { ACTIONS, GROUPS, COLUMNS, bindings, capturing, assign, resetBindings, ownerOf, codeLabel, actionDef, bindable, type Cell, type Code, type Group } from '../app/keymap';
import { techUi } from '../techniques/techniques';
import type { KeySlot } from '../pacts/slots';

// Every action and its keys. Click a cell, press the new key or mouse button.
// A key another action holds is not taken until the player picks swap or
// unbind, so no key ever fires two things.
const SIDES: Group[][] = [['move', 'combat'], ['ability', 'interface']];

interface Clash { cell: Cell; code: Code; other: Cell }

const same = (a: Cell | null, b: Cell): boolean => !!a && a.action === b.action && a.col === b.col;

export function Controls() {
  const [clash, setClash] = useState<Clash | null>(null);
  const listening = capturing.value;
  const b = bindings.value;
  const slots = techUi.slots.value;

  const choose = (cell: Cell, code: Code | null): void => {
    capturing.value = null;
    const other = code ? ownerOf(code, cell) : null;
    if (code && other) { setClash({ cell, code, other }); return; }
    setClash(null);
    assign(cell, code);
  };
  const resolve = (how: 'swap' | 'unbind' | null): void => {
    if (clash && how) assign(clash.cell, clash.code, how);
    setClash(null);
  };

  // Layout effect, so the listeners exist by the time the cell reads "Press a key".
  useLayoutEffect(() => {
    if (!listening) return;
    const eat = (e: Event): void => { e.preventDefault(); e.stopImmediatePropagation(); };
    const key = (e: KeyboardEvent): void => {
      eat(e);
      if (e.repeat) return;
      if (e.code === 'Escape') capturing.value = null;
      else if (e.code === 'Backspace' || e.code === 'Delete') choose(listening, null);
      else choose(listening, e.code);
    };
    // The left button keeps working the menu. Every other button is a candidate.
    const down = (e: MouseEvent): void => {
      if (e.button === 0) { if (!(e.target as HTMLElement).closest('.kcell')) capturing.value = null; return; }
      eat(e);
      choose(listening, `Mouse${e.button}`);
    };
    const swallow = (e: Event): void => { if ((e as MouseEvent).button !== 0) eat(e); };
    window.addEventListener('keydown', key, true);
    window.addEventListener('mousedown', down, true);
    window.addEventListener('mouseup', swallow, true);
    window.addEventListener('auxclick', swallow, true);
    window.addEventListener('contextmenu', eat, true);
    return () => {
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('mousedown', down, true);
      window.removeEventListener('mouseup', swallow, true);
      window.removeEventListener('auxclick', swallow, true);
      window.removeEventListener('contextmenu', eat, true);
    };
  }, [listening]);
  useEffect(() => () => { capturing.value = null; }, []);

  const label = (c: Cell) => actionDef(c.action).label;

  return (
    <div class="binds">
      <div class="binds-top">
        {clash ? (
          <div class="binds-clash" role="alert" data-conflict={`${clash.cell.action}:${clash.other.action}`}>
            <span><b>{codeLabel(clash.code)}</b> already belongs to <b>{label(clash.other)}</b>.</span>
            <span class="acts">
              {b[clash.cell.action][clash.cell.col] && <button class="btn" onClick={() => resolve('swap')}>Swap</button>}
              <button class="btn" onClick={() => resolve('unbind')}>Unbind {label(clash.other)}</button>
              <button class="btn quiet" onClick={() => resolve(null)}>Cancel</button>
            </span>
          </div>
        ) : <p>Click a key, then press the new one. Middle, right and side mouse buttons work too. <kbd>Esc</kbd> cancels and <kbd>Backspace</kbd> clears.</p>}
        <button class="btn" onClick={() => { resetBindings(); setClash(null); }}>Reset to defaults</button>
      </div>
      <div class="binds-cols">
        {SIDES.map((groups, i) => (
          <div key={i} class="binds-col">
            {groups.map((g) => (
              <section key={g}>
                <h3>{GROUPS[g]}</h3>
                {ACTIONS.filter((a) => a.group === g).map((a) => {
                  const slot = a.group === 'ability' ? slots[a.id as KeySlot] : null;
                  return (
                    <div key={a.id} class="krow" data-action={a.id}>
                      <span class="kl">{a.label}{slot && <small>{slot.empty ? 'empty' : slot.name}</small>}</span>
                      {Array.from({ length: COLUMNS }, (_, col) => {
                        const cell: Cell = { action: a.id, col };
                        const code = b[a.id][col];
                        const on = same(listening, cell);
                        const hot = !!clash && (same(clash.cell, cell) || same(clash.other, cell));
                        return bindable(a.id)
                          ? <button key={col} class={`kcell ${on ? 'listening' : ''} ${hot ? 'conflict' : ''} ${code ? '' : 'none'}`} data-cell={`${a.id}:${col}`} aria-label={`${a.label}, ${col ? 'alternate' : 'main'} key`} onClick={() => { setClash(null); capturing.value = on ? null : cell; }}>{on ? 'Press a key' : code ? codeLabel(code, true) : col ? '—' : 'Unbound'}</button>
                          : <span key={col} class="kcell fixed">{code ? codeLabel(code, true) : ''}</span>;
                      })}
                    </div>
                  );
                })}
              </section>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
