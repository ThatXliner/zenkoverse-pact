import * as THREE from 'three';
import type { Game } from '../app/game';
import type { Enemy } from '../combat/enemies';
import { inAttack, markOrigin, reachOf } from '../combat/attacks';
import { Mark } from '../techniques/mark';
import { EYES } from './registry';
import { Ghost, GroundMark, Strand, wrapAngle, yawOf } from './draw';
import { near, type Sight } from './sight';

// The Horizon Eye sees the futures that can be reached from now, a second
// or so ahead. Everyone sees a blow's mark once the wind-up starts; the
// bearer sees it before that, while it is only possible: a ghost of the body
// where it would stand to throw the blow, the path there, and the blow's
// mark in the Eye's gold. Many bodies make too many futures to hold: only
// the nearest few resolve, and the more there are, the fainter they read.
// A blow the bearer saw coming and stood clear of leaves its thrower open.

const AHEAD = 1.2;
const BRANCHES = 3;
const OPEN_SECONDS = 1.5;
const RANGE = 18;
const COLOR = EYES.horizon.color;
const THROWS = new Set(['thug', 'kuroda', 'ancient']);
const MARK_GEO = new THREE.PlaneGeometry(1, 1);

interface Watch { ghost: Ghost; path: Strand; mark: Mark; cast: GroundMark; open: GroundMark; was: string; seen: number; openT: number }
interface Future { e: Enemy; tc: number; at: THREE.Vector3; facing: number }

export class HorizonSight implements Sight {
  private watch = new Map<Enemy, Watch>();

  constructor(private game: Game) {}

  private watchOf(e: Enemy): Watch {
    let w = this.watch.get(e);
    if (w) return w;
    const scene = this.game.renderer.scene;
    const mark = new Mark(MARK_GEO, e.attack.shape, COLOR, 1);
    mark.root.visible = false;
    scene.add(mark.root);
    w = { ghost: new Ghost(scene, e.avatar.model, COLOR), path: new Strand(scene, COLOR), mark, cast: new GroundMark(scene, COLOR), open: new GroundMark(scene, COLOR), was: e.state, seen: 99, openT: 0 };
    this.watch.set(e, w);
    return w;
  }

  // The next blow this body can throw, if it can start it inside the horizon.
  private forecast(e: Enemy, me: THREE.Vector3): Future | null {
    if (!THROWS.has(e.def.ai) || e.locked > 0 || e.frozen > 0 || e.state !== 'chase') return null;
    const to = me.clone().sub(e.position).setY(0);
    const dist = to.length();
    const close = reachOf(e.attack);
    const speed = Math.max(0.5, e.def.speed * e.slow);
    const tc = Math.max(e.attackCd, Math.max(0, dist - close) / speed);
    if (tc > AHEAD) return null;
    const at = e.position.clone().addScaledVector(to.normalize(), Math.max(0, dist - close));
    return { e, tc, at, facing: yawOf(me.x - at.x, me.z - at.z) };
  }

  update(dt: number): void {
    const g = this.game;
    const me = g.player.position;
    const cam = g.renderer.camera;
    const bodies = near(g.targets(), me, RANGE);
    const futures: Future[] = [];
    for (const e of bodies) { const f = this.forecast(e, me); if (f) futures.push(f); }
    futures.sort((a, b) => a.tc - b.tc);
    const shown = new Set(futures.slice(0, BRANCHES));
    // Branch explosion: past what the Eye can hold, every future reads fainter.
    const clarity = Math.min(1, Math.sqrt(BRANCHES / Math.max(1, futures.length)));

    for (const e of bodies) if (THROWS.has(e.def.ai)) this.watchOf(e);
    for (const [e, w] of this.watch) {
      if (e.disposed || (!e.alive && w.openT <= 0)) { this.drop(e, w); continue; }
      const f = futures.find((x) => x.e === e);
      if (f && shown.has(f)) {
        w.seen = 0;
        const sure = THREE.MathUtils.clamp(1 - f.tc / AHEAD, 0, 1) * clarity;
        w.mark.place(markOrigin(e.attack, f.at, f.facing), f.facing);
        w.mark.mat.uniforms.opacity!.value = 0.25 + 0.6 * sure;
        w.mark.progress = 0;
        w.mark.root.visible = true;
        if (f.at.distanceTo(e.position) < 0.3) { w.ghost.hide(); w.path.hide(); }
        else {
          w.ghost.place(e.position, f.at, wrapAngle(f.facing - e.yaw), 0.12 + 0.3 * sure);
          w.path.set(e.position.clone().setY(e.position.y + 0.06), f.at.clone().setY(f.at.y + 0.06), cam, 0.06, 0.35 + 0.4 * sure, 0);
        }
      } else {
        // A wind-up the Eye saw coming is still the one it is watching.
        if (e.state === 'windup') w.seen = Math.min(w.seen, 0.1); else w.seen += dt;
        w.mark.root.visible = false; w.ghost.hide(); w.path.hide();
      }
      this.casts(e, w, me, clarity);
      // The blow fell: one the bearer saw coming and stood clear of leaves its thrower open.
      if (w.was === 'windup' && e.state === 'strike' && w.seen < 0.6 && !inAttack(e.attack, e.position, e.yaw, me)) {
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

  // A cast is a future too, before it starts: where the Kuroda's fuel would
  // land, and how far the Master's wave would reach. Once begun, everyone
  // sees its mark.
  private casts(e: Enemy, w: Watch, me: THREE.Vector3, clarity: number): void {
    const ai = e.def.ai;
    if (e.alive && (ai === 'kuroda' || ai === 'ancient') && e.state === 'chase' && e.castCd < AHEAD && e.position.distanceTo(me) < 22 && e.frozen <= 0) {
      const sure = (1 - Math.max(0, e.castCd) / AHEAD) * clarity;
      w.cast.set(ai === 'kuroda' ? me : e.position, { outer: ai === 'kuroda' ? 2.3 : 14, line: 0.035, dash: ai === 'kuroda' ? 5 : 1.2 }, 0.2 + 0.5 * sure, 0);
      w.cast.tick(this.game.clock.time * 0.5);
    } else w.cast.hide();
  }

  private drop(e: Enemy, w: Watch): void {
    w.ghost.dispose(); w.path.dispose(); w.cast.dispose(); w.open.dispose();
    w.mark.root.removeFromParent(); w.mark.mat.dispose();
    this.watch.delete(e);
  }

  dispose(): void { for (const [e, w] of this.watch) this.drop(e, w); }
}
