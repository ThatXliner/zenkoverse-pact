import { signal, computed, effect } from '@preact/signals';
import { KEY_SLOTS, slotDef, type KeySlot } from '../pacts/slots';

// Every input action and the keys bound to it. An action is a row in ACTIONS;
// an Ability slot with a key is one too, so adding a slot adds a rebindable
// action. Each action has COLUMNS cells (a main key and an alternate), a cell
// holds a KeyboardEvent.code or Mouse0 to Mouse4, and no code sits in two cells.

export type Action =
  | 'forward' | 'back' | 'left' | 'right' | 'sprint' | 'jump' | 'dash'
  | 'wager' | 'aura' | 'fullsign' | 'interact' | 'camera' | 'map' | 'workshop' | 'pause'
  | KeySlot;
export type Code = string;
export type Group = 'move' | 'ability' | 'combat' | 'interface';

export interface ActionDef { id: Action; label: string; group: Group; defaults: readonly Code[]; fixed?: boolean }

export const COLUMNS = 2;
export const GROUPS: Record<Group, string> = { move: 'Movement', ability: 'Abilities', combat: 'Combat', interface: 'Interface' };

export const ACTIONS: readonly ActionDef[] = [
  { id: 'forward', label: 'Move forward', group: 'move', defaults: ['KeyW', 'ArrowUp'] },
  { id: 'back', label: 'Move back', group: 'move', defaults: ['KeyS', 'ArrowDown'] },
  { id: 'left', label: 'Move left', group: 'move', defaults: ['KeyA', 'ArrowLeft'] },
  { id: 'right', label: 'Move right', group: 'move', defaults: ['KeyD', 'ArrowRight'] },
  { id: 'sprint', label: 'Sprint', group: 'move', defaults: ['ShiftLeft', 'ShiftRight'] },
  { id: 'jump', label: 'Jump', group: 'move', defaults: ['Space'] },
  { id: 'dash', label: 'Dash', group: 'move', defaults: ['KeyC'] },
  ...KEY_SLOTS.map((s): ActionDef => ({ id: s, label: slotDef(s).name, group: 'ability', defaults: [slotDef(s).defaultKey!] })),
  { id: 'wager', label: 'Declare a Wager', group: 'combat', defaults: ['KeyR'] },
  { id: 'aura', label: 'Aura Expansion', group: 'combat', defaults: ['KeyF'] },
  { id: 'fullsign', label: 'Hold the full sign', group: 'combat', defaults: ['AltLeft'] },
  { id: 'interact', label: 'Interact', group: 'interface', defaults: ['KeyE'] },
  { id: 'camera', label: 'First or third person', group: 'interface', defaults: ['KeyV'] },
  { id: 'map', label: 'Map', group: 'interface', defaults: ['KeyM'] },
  { id: 'workshop', label: 'Pact Workshop', group: 'interface', defaults: ['Tab'] },
  { id: 'pause', label: 'Pause and close', group: 'interface', defaults: ['Escape'], fixed: true },
];
const DEF = new Map<Action, ActionDef>(ACTIONS.map((a) => [a.id, a]));
export const actionDef = (a: Action): ActionDef => DEF.get(a)!;

type Cells = (Code | null)[];
type Bindings = Record<Action, Cells>;

const KEY = 'zenko.keys.v1';
// Escape closes things and leaves pointer lock, so no action may take it.
const RESERVED: ReadonlySet<Code> = new Set(['Escape']);

const defaultCells = (a: ActionDef): Cells => Array.from({ length: COLUMNS }, (_, i) => a.defaults[i] ?? null);
const defaultBindings = (): Bindings => Object.fromEntries(ACTIONS.map((a) => [a.id, defaultCells(a)])) as Bindings;

// A saved map may predate an action, or hold a code a newer default now
// claims. Saved cells win; a default that collides with one is dropped.
function load(): Bindings {
  const out = defaultBindings();
  let saved: Partial<Record<string, unknown>> = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as typeof saved; } catch { /* unreadable: use defaults */ }
  const claimed = new Set<Code>();
  const own = ACTIONS.filter((a) => !a.fixed && Array.isArray(saved[a.id]));
  for (const a of own) {
    const cells = saved[a.id] as unknown[];
    out[a.id] = Array.from({ length: COLUMNS }, (_, i) => {
      const c = cells[i];
      if (typeof c !== 'string' || RESERVED.has(c) || claimed.has(c)) return null;
      claimed.add(c);
      return c;
    });
  }
  for (const a of ACTIONS) {
    if (own.includes(a)) continue;
    out[a.id] = defaultCells(a).map((c) => (c && !claimed.has(c) ? (claimed.add(c), c) : null));
  }
  return out;
}

export const bindings = signal<Bindings>(load());

effect(() => {
  try { localStorage.setItem(KEY, JSON.stringify(bindings.value)); } catch { /* storage may be unavailable */ }
});

const lookup = computed(() => {
  const m = new Map<Code, Action>();
  for (const a of ACTIONS) for (const c of bindings.value[a.id]) if (c) m.set(c, a.id);
  return m;
});

export const actionFor = (code: Code): Action | undefined => lookup.value.get(code);
export const codesOf = (a: Action): Code[] => bindings.value[a].filter((c): c is Code => !!c);

const MOUSE = ['Left click', 'Middle click', 'Right click', 'Mouse 4', 'Mouse 5'];
const SHORT: Record<string, string> = { Space: 'Space', Escape: 'Esc', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Enter: 'Enter', Backspace: 'Backspace', CapsLock: 'Caps' };

// The name a player knows a key by. `side` keeps Left and Right apart for the
// controls screen, where two cells of one action must read differently.
export function codeLabel(code: Code, side = false): string {
  if (code.startsWith('Mouse')) return MOUSE[Number(code.slice(5))] ?? code;
  if (code in SHORT) return SHORT[code]!;
  const m = /^(Shift|Control|Alt|Meta)(Left|Right)$/.exec(code);
  if (m) return `${side ? `${m[2]} ` : ''}${m[1] === 'Control' ? 'Ctrl' : m[1] === 'Meta' ? 'Cmd' : m[1]}`;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad/.test(code)) return `Num ${code.slice(6)}`;
  return code;
}

export const UNBOUND = 'Unbound';

// What the HUD and the cards print for an action: its main key, else the alternate.
export function keyLabel(a: Action): string {
  const c = codesOf(a)[0];
  return c ? codeLabel(c) : UNBOUND;
}

// The same key inside a sentence: mouse buttons read as lower case words.
export function keyPhrase(a: Action): string {
  const c = codesOf(a)[0];
  if (!c) return 'an unbound key';
  const l = codeLabel(c);
  return c.startsWith('Mouse') ? l.toLowerCase() : l;
}

// Four movement keys read as WASD when each is one character.
export function keysLabel(actions: readonly Action[]): string {
  const labels = actions.map(keyLabel);
  return labels.every((l) => l.length === 1) ? labels.join('') : labels.join(' / ');
}

export interface Cell { action: Action; col: number }

export function ownerOf(code: Code, except?: Cell): Cell | null {
  for (const a of ACTIONS) {
    const col = bindings.value[a.id].findIndex((c, i) => c === code && !(except && except.action === a.id && except.col === i));
    if (col >= 0) return { action: a.id, col };
  }
  return null;
}

export const bindable = (a: Action): boolean => !actionDef(a).fixed;
export const canTake = (code: Code): boolean => !RESERVED.has(code);

function put(b: Bindings, cell: Cell, code: Code | null): Bindings {
  const cells = b[cell.action].slice();
  cells[cell.col] = code;
  return { ...b, [cell.action]: cells };
}

// Puts `code` in `cell`. When another cell holds it, `how` decides: 'swap' sends
// this cell's old code there, 'unbind' empties that cell.
export function assign(cell: Cell, code: Code | null, how: 'swap' | 'unbind' = 'unbind'): void {
  if (!bindable(cell.action) || (code && !canTake(code))) return;
  let next = bindings.value;
  const old = next[cell.action][cell.col] ?? null;
  const other = code ? ownerOf(code, cell) : null;
  if (other) next = put(next, other, how === 'swap' ? old : null);
  bindings.value = put(next, cell, code);
}

export function resetBindings(): void { bindings.value = defaultBindings(); }

// The cell being captured in the controls screen. While it is set the game
// reads no input, so the next press names a key instead of firing an Ability.
export const capturing = signal<Cell | null>(null);
