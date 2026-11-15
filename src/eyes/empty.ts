import * as THREE from 'three';
import type { Game } from '../app/game';
import type { Enemy } from '../combat/enemies';
import { EYES } from './registry';
import { GroundMark, wrapAngle, yawOf } from './draw';
import { near, NO_EFFECT, type Sight } from './sight';

// The Empty Eye sees what is missing. Every guard has a gap: the bearer sees
// each body's guard as an arc on the floor with the gap left out, behind it,
// and the whole guard gone in the moments a body leaves itself open (after
// its own blow, or thrown down). A blow through the gap lands harder and
// staggers. It also sees what is hidden: where the next body will climb onto
// the roof, before it shows.

const RANGE = 14;
const MOST = 10;
// Half the gap behind a guard, in radians.
const GAP = 0.95;
const THROUGH = 1.5;
const COLOR = EYES.empty.color;

interface Guard { mark: GroundMark; open: number }

export class EmptySight implements Sight {
  private guards = new Map<Enemy, Guard>();
  private arrival: GroundMark;

  constructor(private game: Game) {
    this.arrival = new GroundMark(game.renderer.scene, COLOR);
  }

  // Wide open: after its own blow, while it is thrown, or held fast.
  private wideOpen(e: Enemy): boolean {
    return e.state === 'recover' || e.state === 'knocked' || e.frozen > 0 || e.locked > 0;
  }

  // Whether a blow from `from` comes through this body's guard.
  private through(e: Enemy, from: THREE.Vector3): boolean {
    if (this.wideOpen(e)) return true;
    const toward = yawOf(from.x - e.position.x, from.z - e.position.z);
    return Math.abs(wrapAngle(toward - (e.yaw + Math.PI))) < GAP;
  }

  update(dt: number): void {
    const g = this.game;
    const me = g.player.position;
    const bodies = near(g.targets(), me, RANGE).sort((a, b) => a.position.distanceTo(me) - b.position.distanceTo(me)).slice(0, MOST);
    const shown = new Set(bodies);
    for (const e of bodies) {
      let gd = this.guards.get(e);
      if (!gd) { gd = { mark: new GroundMark(g.renderer.scene, COLOR), open: 0 }; this.guards.set(e, gd); }
      // The guard eases open and shut, so a gap that comes and goes reads as one.
      gd.open += ((this.wideOpen(e) ? 1 : 0) - gd.open) * (1 - Math.exp(-14 * dt));
      const r = e.isBoss ? 1.05 : 0.72;
      const seen = this.through(e, me);
      const keep = (Math.PI - GAP) * (1 - gd.open);
      if (keep > 0.05) gd.mark.set(e.position, { inner: r - 0.1, outer: r, fill: 0.7, line: 0.025 }, seen ? 1 : 0.8, e.yaw, keep);
      else {
        // Nothing left of the guard: only its outline, broken.
        gd.mark.set(e.position, { inner: r - 0.02, outer: r, line: 0.015, dash: 9 }, 0.55, 0);
        gd.mark.tick(g.clock.time * 0.4);
      }
    }
    for (const [e, gd] of this.guards) if (!shown.has(e)) { gd.mark.dispose(); this.guards.delete(e); }

    const next = g.rooftop.arriving;
    if (next) {
      const k = THREE.MathUtils.clamp(1 - next.in / 1.6, 0, 1);
      this.arrival.set(next.at, { inner: 1.1 * (1 - k), outer: 1.2, fill: 0.25, line: 0.03, dash: 4 }, 0.35 + 0.5 * k, 0);
      this.arrival.tick(g.clock.time * 0.3);
    } else this.arrival.hide();
  }

  dealt(e: Enemy): { mult: number; stagger?: boolean } {
    if (!this.through(e, this.game.player.position)) return NO_EFFECT;
    this.game.audio.play('eye.empty.through', { at: e.center() });
    return { mult: THROUGH, stagger: !e.isBoss };
  }

  dispose(): void {
    for (const gd of this.guards.values()) gd.mark.dispose();
    this.guards.clear();
    this.arrival.dispose();
  }
}
