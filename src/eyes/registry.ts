import { TECHNIQUE_IDS, type TechniqueId } from '../pacts/schema';

// The Eyes: finite physical artifacts, a separate axis from Techniques.
// Installing one permanently replaces the natural eye on its side, so an
// installed Eye is kept (localStorage) and goes everywhere with the player:
// the yard, the roof and online rooms. What each one lets the bearer see is
// in its sight module (src/eyes/*.ts); this file is the data.

export type EyeId = 'horizon' | 'empty' | 'thread' | 'vault' | 'covenant';
export const EYE_IDS: readonly EyeId[] = ['horizon', 'thread', 'empty', 'vault', 'covenant'];

export interface EyeDef {
  name: string;
  jp: string;
  color: number;
  // What the Eye is, in a line.
  text: string;
  // What it does in a fight.
  rule: string;
  locked?: boolean;
}

// Colours follow the codex plates: Horizon's sunrise gold, Thread's blue
// filaments, Empty's pale violet, Vault's brass.
export const EYES: Record<EyeId, EyeDef> = {
  horizon: { name: 'Horizon Eye', jp: '地平', color: 0xffc94a, text: 'Perceives the futures that can be reached from now.', rule: 'Shows the blows that can come in the next second, before anyone commits to them. A blow you saw coming and stepped out of leaves its thrower open.' },
  thread: { name: 'Thread Eye', jp: '糸', color: 0x7b97ff, text: 'Perceives relationships, dependencies and causes.', rule: 'Shows who leans on whom. A blow to an anchor runs down every thread to the bodies tied to it; while the anchor stands, they are harder to hurt.' },
  empty: { name: 'Empty Eye', jp: '空', color: 0xcdb8ff, text: 'Perceives absence, concealment and what is held back.', rule: 'Shows the gap in each guard, and what is about to arrive before it does. A blow through the gap lands harder and staggers.' },
  vault: { name: 'Vault Eye', jp: '庫', color: 0xd9b25e, text: 'Houses one transferred foreign Technique. Never a copy.', rule: 'Holds another Technique, cast on its own key with its own cooldown. Rougher than your own: it aims loosely.' },
  covenant: { name: 'Covenant Eye', jp: '盟', color: 0xe9e3ff, text: 'A binding vow, enforced by the universe, between several willing people.', rule: 'It cannot be installed alone.', locked: true },
};

// The socket every Eye goes into. The view is drawn from it: in first
// person the frame on this side, on the body a mark over this eye.
export const EYE_SIDE: 'left' | 'right' = 'right';

export interface Installed { id: EyeId; vault: TechniqueId | null }

const KEY = 'zenko.eye.v1';

export function loadInstalled(): Installed | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Installed> | null;
    if (!v || !EYE_IDS.includes(v.id as EyeId) || EYES[v.id as EyeId].locked) return null;
    const vault = TECHNIQUE_IDS.includes(v.vault as TechniqueId) ? v.vault as TechniqueId : null;
    if (v.id === 'vault' && !vault) return null;
    return { id: v.id as EyeId, vault };
  } catch { return null; }
}

export function saveInstalled(v: Installed | null): void {
  try { if (v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}

// The wire carries an Eye as its place in EYE_IDS plus one, 0 for none.
export const eyeCode = (id: EyeId | null): number => (id ? EYE_IDS.indexOf(id) + 1 : 0);
export const eyeFromCode = (n: unknown): EyeId | null => (typeof n === 'number' && n >= 1 && n <= EYE_IDS.length ? EYE_IDS[n - 1]! : null);
