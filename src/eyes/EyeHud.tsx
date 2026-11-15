import { keyLabel } from '../app/keymap';
import { KITS } from '../techniques/techniques';
import { eyeUi } from './ui';
import './eyes.css';

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

// The Vault Eye's key, in the row of extra slots: the foreign Technique's
// glyph in its own colour, its name, and its cooldown. The other Eyes need
// nothing on the HUD; what they show is in the world.
export function VaultSlot() {
  const v = eyeUi.vault.value;
  if (!v) return null;
  const kit = KITS[v.tech];
  return (
    <div class={`x vault ${v.cd <= 0 ? 'ready' : ''}`} data-slot="vault" style={{ '--vc': hex(kit.color) } as never} title={`Vault Eye: ${kit.name}, a Technique not your own`}>
      <kbd>{keyLabel('vault')}</kbd>
      <div class="box"><span class="glyph">{kit.glyph}</span><div class="cool" style={{ height: `${Math.max(0, Math.min(1, v.cd)) * 100}%` }} /></div>
      <span class="name">{kit.name}</span>
    </div>
  );
}
