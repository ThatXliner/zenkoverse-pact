import * as THREE from 'three';
import type { Game } from '../app/game';
import { toast } from '../app/game';
import { KITS } from '../techniques/techniques';
import type { AbilityContext, TechniqueKit, TechniqueId } from '../techniques/kit';
import { pick } from '../hands/gestures';
import { GROUP_ENEMY, GROUP_PROP, GROUP_WORLD } from '../physics/world';
import type { Sight } from './sight';
import { eyeUi } from './ui';

// The Vault Eye is not a way of seeing. It houses one foreign Technique,
// moved into the artifact from its last bearer: not a copy, and never the
// bearer's own. It is cast on its own key, as its raw form, with its own
// cooldown, and draws on nothing of the bearer's: not their resource, not
// their mastery. It is rougher than a native Technique, so it aims loosely.

const COOLDOWN = 2.4;
const POTENCY = 0.6;
// How far the aim can wander either side, in radians.
const LOOSE = 0.1;

export class VaultSight implements Sight {
  private cd = 0;
  private pending: { t: number; at: number } | null = null;
  readonly kit: TechniqueKit;

  constructor(private game: Game, readonly tech: TechniqueId) {
    this.kit = KITS[tech];
    this.publish();
  }

  private publish(): void {
    const v = { tech: this.tech, cd: this.cd / COOLDOWN };
    const cur = eyeUi.vault.value;
    if (!cur || cur.tech !== v.tech || Math.abs(cur.cd - v.cd) > 0.01 || (cur.cd > 0) !== (v.cd > 0)) eyeUi.vault.value = v;
  }

  update(dt: number): void {
    const g = this.game;
    this.cd = Math.max(0, this.cd - dt);
    if (g.input.enabled && !g.cutscenes.active && g.input.hit('vault')) this.begin();
    const p = this.pending;
    if (p) { p.t += dt; if (p.t >= p.at) { this.pending = null; this.fire(); } }
    this.publish();
  }

  begin(): boolean {
    const g = this.game;
    if (this.pending || g.techniques.signing || g.techniques.casting) return false;
    if (g.techniques.sealed > 0) { toast('Your Technique is sealed', 'bad'); return false; }
    if (this.cd > 0) return false;
    const gesture = pick(this.kit.gestures.primary!, 'long');
    g.hands.play(gesture, 1, () => undefined, (k) => g.cam.kick(k));
    g.avatar.perform(gesture, 1);
    g.audio.play(this.kit.audio.primary);
    g.net?.cast('primary', `Vault · ${this.kit.name}`, 'long', 1, this.tech);
    this.pending = { t: 0, at: gesture.impactAt };
    this.cd = COOLDOWN;
    return true;
  }

  // The kit's own effect, run as if it were the Technique in hand for the
  // length of the call: its reserve is the Vault's (half full, always), its
  // sound word and colour its own. Then the bearer's Technique comes back.
  private fire(): void {
    const g = this.game, kit = this.kit;
    const shape = Object.entries(kit.shapes).find(([, s]) => s.kinds.includes('primary'))![0];
    const dir = g.cam.aimDirection().applyAxisAngle(new THREE.Vector3(0, 1, 0), (Math.random() * 2 - 1) * LOOSE);
    const origin = g.player.eye();
    const hit = g.physics.castRay(origin, dir, 60, GROUP_WORLD | GROUP_PROP | GROUP_ENEMY, g.player.body);
    const ctx: AbilityContext = {
      game: g, pact: null, slot: 'primary', kind: 'primary', shape, behaviors: [], potency: POTENCY, variant: 'long',
      origin, dir, aim: hit ? hit.point : origin.clone().addScaledVector(dir, 30), targets: [], wagered: false,
    };
    const t = g.techniques;
    const own = { def: t.def, resource: t.resource };
    t.def = kit;
    t.resource = kit.resource.max * 0.5;
    let r;
    try { r = kit.effects.cast(ctx); } finally { t.def = own.def; t.resource = own.resource; }
    if (!r) return;
    if (r.hitStop) g.clock.hitStop(r.hitStop);
    if (r.impactFrame) g.renderer.impactFrame(r.impactFrame, new THREE.Color(kit.color), ctx.aim ?? undefined);
    if (r.cameraKick) g.cam.kick(r.cameraKick);
    if (r.rooted) g.player.rooted = Math.max(g.player.rooted, r.rooted);
    if (r.moveLock) g.player.moveLock = Math.max(g.player.moveLock, r.moveLock);
  }

  dispose(): void { this.pending = null; eyeUi.vault.value = null; }
}
