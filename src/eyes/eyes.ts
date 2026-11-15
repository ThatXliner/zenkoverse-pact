import type { Game } from '../app/game';
import type { Enemy } from '../combat/enemies';
import type { TechniqueId } from '../techniques/kit';
import { EYES, EYE_SIDE, loadInstalled, saveInstalled, type EyeId, type Installed } from './registry';
import { EyeMark } from './mark';
import { HorizonSight } from './horizon';
import { ThreadSight } from './thread';
import { EmptySight } from './empty';
import { VaultSight } from './vault';
import { NO_EFFECT, type Sight } from './sight';
import { eyeUi } from './ui';

// The installed Eye: which one, kept across sessions since an installed Eye
// is permanent; its sight while the world runs; its mark on the player's
// body, which every screen draws (online it rides the player's state); and
// in first person the frame on the side whose natural eye was given up.
export class Eyes {
  private installed: Installed | null;
  private sight: Sight | null = null;
  private mark: EyeMark;
  private frame = 0;
  private installs = 0;

  constructor(private game: Game) {
    this.mark = new EyeMark(game.avatar);
    this.installed = loadInstalled();
    this.apply();
  }

  get id(): EyeId | null { return this.installed?.id ?? null; }
  get vault(): TechniqueId | null { return this.installed?.vault ?? null; }

  // Takes out whatever Eye is in the socket and puts `id` in. The natural
  // eye is already gone, or goes now.
  install(id: EyeId, vault: TechniqueId | null = null): boolean {
    if (EYES[id].locked || (id === 'vault' && !vault)) return false;
    this.installed = { id, vault: id === 'vault' ? vault : null };
    saveInstalled(this.installed);
    this.apply();
    this.frame = 0;
    eyeUi.installing.value = { id, n: ++this.installs };
    this.game.audio.play('eye.install');
    return true;
  }

  // For the checks and the debug hook: the socket emptied, as if never filled.
  remove(): void {
    this.installed = null;
    saveInstalled(null);
    this.apply();
  }

  private apply(): void {
    this.sight?.dispose();
    const g = this.game, it = this.installed;
    this.sight = !it ? null
      : it.id === 'horizon' ? new HorizonSight(g)
      : it.id === 'thread' ? new ThreadSight(g)
      : it.id === 'empty' ? new EmptySight(g)
      : it.id === 'vault' && it.vault ? new VaultSight(g, it.vault)
      : null;
    this.mark.set(this.id);
    eyeUi.id.value = this.id;
  }

  update(dt: number, raw: number): void {
    const g = this.game;
    this.sight?.update(dt);
    // First person: the side the Eye looks from is framed apart. It eases in
    // once the installation has played.
    const want = this.id && g.cam.isFirst && !g.cam.inShot && !eyeUi.installing.value ? 1 : 0;
    this.frame += (want - this.frame) * (1 - Math.exp(-(want ? 2.2 : 8) * raw));
    g.renderer.eyeView(EYE_SIDE === 'right' ? 1 : -1, this.id ? EYES[this.id].color : 0, this.frame);
  }

  dealt(e: Enemy): { mult: number; stagger?: boolean } { return this.sight?.dealt?.(e) ?? NO_EFFECT; }
  landed(e: Enemy, amount: number): void { this.sight?.landed?.(e, amount); }

  // The Vault's cast, for the debug hook and the checks.
  castVault(): boolean { return this.sight instanceof VaultSight ? this.sight.begin() : false; }
}
