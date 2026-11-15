import * as THREE from 'three';
import type { Game } from '../app/game';
import { blowOf, CAST_SECONDS, type Enemy } from '../combat/enemies';
import { EYES } from './registry';
import { Ghost, GroundMark, Strand, wrapAngle, yawOf } from './draw';
import { near, type Sight } from './sight';

// The Horizon Eye sees the futures that can be reached from now, a second
// or so ahead. For each body that could throw a blow inside that horizon it
// draws a ghost where the body would stand to throw it and the blow's reach
// on the floor, faint while it is only possible and solid once committed.
// Many bodies make too many futures to hold: only the nearest few resolve,
// and the more there are, the fainter they read. A blow the bearer saw
// coming and stepped out of leaves its thrower open for a moment.

const AHEAD = 1.1;
const BRANCHES = 3;
const OPEN_SECONDS = 1.5;
const RANGE = 18;
const COLOR = EYES.horizon.color;
const THROWS = new Set(['thug', 'kuroda', 'ancient']);

interface Watch { ghost: Ghost; path: Strand; wedge: GroundMark; cast: GroundMark; open: GroundMark; was: string; seen: number; openT: number }
interface Future { e: Enemy; tc: number; at: THREE.Vector3; facing: number; committed: boolean }

export class HorizonSight implements Sight {
  private watch = new Map<Enemy, Watch>();

  constructor(private game: Game) {}

  private watchOf(e: Enemy): Watch {
    let w = this.watch.get(e);
    if (w) return w;
    const scene = this.game.renderer.scene;
    w = { ghost: new Ghost(scene, e.avatar.model, COLOR), path: new Strand(scene, COLOR), wedge: new GroundMark(scene, COLOR), cast: new GroundMark(scene, COLOR), open: new GroundMark(scene, COLOR), was: e.state, seen: 99, openT: 0 };
    this.watch.set(e, w);
    return w;
  }

  // The next blow this body can throw, if it can throw one inside the horizon.
  private forecast(e: Enemy, me: THREE.Vector3): Future | null {
    const ai = e.def.ai;
    if (ai === 'dummy' || ai === 'rival' || e.locked > 0 || e.frozen > 0) return null;
    const blow = blowOf(ai);
    const to = me.clone().sub(e.position).setY(0);
    const dist = to.length();
    if (e.state === 'windup') {
      const left = Math.max(0, blow.windup / this.game.aura.hinder(e.position) - e.stateTime);
      return { e, tc: left - 1, at: e.position.clone(), facing: e.yaw, committed: true };
    }
    if (e.state !== 'chase') return null;
    const speed = Math.max(0.5, e.def.speed * e.slow);
    const closing = Math.max(0, dist - blow.close) / speed;
    const tc = Math.max(e.attackCd, closing);
    if (tc > AHEAD) return null;
    const at = e.position.clone().addScaledVector(to.normalize(), Math.max(0, dist - blow.close));
    return { e, tc, at, facing: yawOf(me.x - at.x, me.z - at.z), committed: false };
  }

  update(dt: number): void {
    const g = this.game;
    const me = g.player.position;
    const cam = g.renderer.camera;
    const bodies = near(g.targets(), me, RANGE);
    const futures: Future[] = [];
    for (const e of bodies) { const f = this.forecast(e, me); if (f) futures.push(f); }
    futures.sort((a, b) => a.tc - b.tc);
    const open = futures.filter((f) => !f.committed);
    const shown = new Set([...futures.filter((f) => f.committed), ...open.slice(0, BRANCHES)]);
    // Branch explosion: past what the Eye can hold, every future reads fainter.
    const clarity = Math.min(1, Math.sqrt(BRANCHES / Math.max(1, open.length)));

    for (const e of bodies) if (THROWS.has(e.def.ai)) this.watchOf(e);
    for (const [e, w] of this.watch) {
      if (e.disposed || (!e.alive && w.openT <= 0)) { this.drop(e, w); continue; }
      const f = futures.find((x) => x.e === e);
      const on = f && shown.has(f);
      w.seen = on ? 0 : w.seen + dt;
      if (on && f) {
        const blow = blowOf(e.def.ai);
        const sure = f.committed ? 1 : THREE.MathUtils.clamp(1 - f.tc / AHEAD, 0, 1) * clarity;
        // Possible: only the edge of where the blow would reach. Committed: the whole of it.
        if (f.committed) w.wedge.set(f.at, { inner: 0.35, outer: blow.reach, fill: 0.3, line: 0.05 }, 0.95, f.facing, Math.acos(blow.cone));
        else w.wedge.set(f.at, { inner: blow.reach - 0.08, outer: blow.reach, fill: 0.6, line: 0.02 }, 0.3 + 0.6 * sure, f.facing, Math.acos(blow.cone) * 0.8);
        if (f.committed || f.at.distanceTo(e.position) < 0.3) { w.ghost.hide(); w.path.hide(); }
        else {
          w.ghost.place(e.position, f.at, wrapAngle(f.facing - e.yaw), 0.12 + 0.3 * sure);
          w.path.set(e.position.clone().setY(e.position.y + 0.06), f.at.clone().setY(f.at.y + 0.06), cam, 0.06, 0.35 + 0.4 * sure, 0);
        }
      } else { w.wedge.hide(); w.ghost.hide(); w.path.hide(); }
      this.casts(e, w, me, clarity);
      // The blow fell: one the bearer saw and stood clear of leaves its thrower open.
      if (w.was === 'windup' && e.state === 'strike' && w.seen < 0.6 && !inBlow(e, me)) {
        e.guardBroken = Math.max(e.guardBroken, OPEN_SECONDS);
        w.openT = OPEN_SECONDS;
        g.audio.play('eye.horizon.open', { at: e.center() });
      }
      w.was = e.state;
      if (w.openT > 0) {
        w.openT = Math.max(0, w.openT - dt);
        const k = w.openT / OPEN_SECONDS;
        w.open.set(e.position, { inner: 0.55, outer: 0.75, fill: 0.5, line: 0.025, dash: 7 }, 0.9 * Math.min(1, k * 3), 0);
        w.open.tick(g.clock.time * 0.6);
      } else w.open.hide();
    }
  }

  // A cast is a future too: where the Kuroda's fuel will land and burn, and
  // how far the Master's wave will reach.
  private casts(e: Enemy, w: Watch, me: THREE.Vector3, clarity: number): void {
    const ai = e.def.ai;
    if (!e.alive || (ai !== 'kuroda' && ai !== 'ancient')) { w.cast.hide(); return; }
    const radius = ai === 'kuroda' ? 2.6 : 14;
    if (e.state === 'cast') {
      const at = ai === 'kuroda' ? (e as Enemy & { fuelAt?: THREE.Vector3 }).fuelAt ?? me : e.position;
      const k = Math.min(1, e.stateTime / CAST_SECONDS);
      w.cast.set(at, { inner: radius * (1 - k), outer: radius, fill: 0.22, line: 0.05 }, 0.9, 0);
      return;
    }
    if (e.state === 'chase' && e.castCd < AHEAD && e.position.distanceTo(me) < 22 && e.frozen <= 0) {
      const sure = (1 - e.castCd / AHEAD) * clarity;
      w.cast.set(ai === 'kuroda' ? me : e.position, { outer: radius, line: 0.035, dash: ai === 'kuroda' ? 5 : 1.2 }, 0.2 + 0.5 * sure, 0);
      w.cast.tick(this.game.clock.time * 0.5);
      return;
    }
    w.cast.hide();
  }

  private drop(e: Enemy, w: Watch): void {
    w.ghost.dispose(); w.path.dispose(); w.wedge.dispose(); w.cast.dispose(); w.open.dispose();
    this.watch.delete(e);
  }

  dispose(): void { for (const [e, w] of this.watch) this.drop(e, w); }
}

// Whether `at` stands where this body's blow lands, by the rule the blow itself uses.
function inBlow(e: Enemy, at: THREE.Vector3): boolean {
  const blow = blowOf(e.def.ai);
  const to = at.clone().sub(e.position).setY(0);
  const d = to.length();
  const fwd = new THREE.Vector3(-Math.sin(e.yaw), 0, -Math.cos(e.yaw));
  return d < blow.reach && to.normalize().dot(fwd) > blow.cone;
}
