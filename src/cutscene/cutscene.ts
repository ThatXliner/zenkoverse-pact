import * as THREE from 'three';
import { signal } from '@preact/signals';
import type { Game } from '../app/game';
import { appState, setState, worldRuns, type AppState } from '../app/state';
import { settings, type CutscenePlay } from '../app/settings';
import type { Avatar } from '../character/avatar';
import type { Enemy } from '../combat/enemies';
import { GROUP_WORLD } from '../physics/world';
import type { LookId } from '../render/manga';
import type { CueName } from '../audio/cues';

// Maximum Output cutscenes (issue #27), in the manner of a fighting game's
// ultimate: a hard cut to a close-up of the full hand sign, the title card,
// a hard cut to the blow, an impact frame and hit-stop on the beat, an
// aftermath shot, then the camera eases back to the player's own view.
//
// A cutscene is data. Every camera key is placed in the caster's facing
// frame, [right, up, forward] in metres, relative to the caster, the target
// or the point between them, so one definition plays anywhere in the
// compound. One player below runs every Maximum Output, the player's and
// the bosses'; adding one is adding a CutsceneDef.

export type Vec3 = [number, number, number];
export type Rel = 'caster' | 'target' | 'mid';
export type Ease = 'out' | 'inOut' | 'in' | 'linear';

// One end of a camera move. `rel` places the camera, `lookRel` (default
// `rel`) places what it looks at.
export interface CamKey { rel?: Rel; pos: Vec3; look: Vec3; lookRel?: Rel; fov: number; roll?: number }

export type CutEvent =
  // The caster begins the full hand sign. It always plays at full length,
  // timed so its strike lands on the resolveHit beat.
  | { at: number; kind: 'gesture' }
  // The Ability's name card.
  | { at: number; kind: 'title' }
  // The damage lands here, in sync with the shot, not at the button press.
  | { at: number; kind: 'resolveHit' }
  | { at: number; kind: 'impactFrame'; frames: number }
  // The camera and the world stop dead for a moment on the blow.
  | { at: number; kind: 'hitStop'; seconds: number }
  | { at: number; kind: 'shake'; amount: number }
  | { at: number; kind: 'vfx'; id: CutVfx }
  | { at: number; kind: 'sfx'; id: CueName; volume?: number; pitch?: number };

// Effects the player draws itself, in the cutscene's colour, around the caster.
export type CutVfx = 'charge' | 'aura' | 'flash';

// How the page draws a shot (src/render/manga.ts): a whole-frame look (sumi-e
// ink wash, watercolour, a negative) and staging lines held for the shot,
// focus lines converging on the target or lines rushing into the frame.
export interface ShotPage { look?: LookId; lines?: 'focus' | 'rush' }

export interface CutShot {
  // Seconds, real time.
  duration: number;
  // How fast the world runs during the shot when the caster's screen owns
  // the world (single-player): near 0 holds it still, more lets the blow bloom.
  timeScale: number;
  from: CamKey;
  to?: Partial<CamKey>;
  ease?: Ease;
  events?: CutEvent[];
  page?: ShotPage;
}

export interface CutsceneDef {
  id: string;
  title: { jp: string; en: string };
  color: number;
  // How far in front of the caster a target is pulled for the shot; null
  // when the Output takes no one (the frame then uses a point ahead).
  pull: number | null;
  // How far away a target can be and still be pulled in.
  reach: number;
  // The sound word lettered over the blow, as a manga panel would.
  word: string;
  shots: CutShot[];
}

// The beats every Output shares, so a definition reads as its camera work.
// The opening: the sign starts at once and the ground charges; the card
// lands once the hands have met, and leaves just before the blow.
export function opening(sfx: CueName): CutEvent[] {
  return [
    { at: 0, kind: 'gesture' }, { at: 0.02, kind: 'vfx', id: 'charge' }, { at: 0.04, kind: 'sfx', id: sfx },
    { at: 0.5, kind: 'title' }, { at: 0.5, kind: 'sfx', id: 'cutscene.title' }, { at: 0.35, kind: 'vfx', id: 'aura' },
  ];
}
// The blow, `at` seconds into its shot (0: the cut to the blow is the blow,
// and the shot frames where the blow left everyone): an impact frame, the hit,
// a dead stop, the shake and the sound.
export function blow(at: number, sfx: CueName, shake = 0.9): CutEvent[] {
  return [
    { at, kind: 'impactFrame', frames: 3 }, { at, kind: 'resolveHit' }, { at, kind: 'hitStop', seconds: 0.12 },
    { at, kind: 'shake', amount: shake }, { at, kind: 'sfx', id: sfx }, { at, kind: 'vfx', id: 'flash' },
  ];
}

// A repeat under the "first time" setting ends this long after the blow.
export const SHORT_TAIL = 0.6;

export function cutsceneTiming(def: CutsceneDef): { total: number; beat: number | null; starts: number[] } {
  const starts: number[] = [];
  let t = 0, beat: number | null = null;
  for (const s of def.shots) {
    starts.push(t);
    for (const e of s.events ?? []) if (e.kind === 'resolveHit' && beat === null) beat = t + e.at;
    t += s.duration;
  }
  return { total: t, beat, starts };
}

// A body in a cutscene. `place` exists when this screen owns the body and
// can pull it into the shot; `hold` freezes it for the cutscene.
export interface Actor {
  readonly position: THREE.Vector3;
  readonly avatar: Avatar;
  readonly height: number;
  // This screen animates the body (the player, an enemy); a remote player's
  // body follows its owner's screen instead.
  readonly local: boolean;
  place?(at: THREE.Vector3, yaw: number): void;
  hold?(seconds: number): void;
}

export function playerActor(game: Game): Actor {
  return {
    position: game.player.position, avatar: game.avatar, height: 1.78, local: true,
    place(at, yaw) { game.player.teleport(at); game.avatar.root.position.copy(at); game.cam.yaw = yaw; game.avatar.root.rotation.set(0, yaw, 0); },
    // The game roots the player for as long as a cutscene locks them.
    hold() { game.player.velocity.set(0, Math.min(0, game.player.velocity.y), 0); },
  };
}

export function enemyActor(e: Enemy): Actor {
  if (e.def.ai === 'rival') return { position: e.position, avatar: e.avatar, height: e.height, local: false };
  return {
    position: e.position, avatar: e.avatar, height: e.height, local: true,
    place(at, yaw) {
      e.position.copy(at);
      e.velocity.set(0, 0, 0);
      e.yaw = yaw;
      const t = { x: at.x, y: at.y + e.height / 2, z: at.z };
      e.body.setTranslation(t, true);
      e.body.setNextKinematicTranslation(t);
      e.avatar.root.position.copy(at);
      e.avatar.root.rotation.y = yaw;
    },
    hold(s) { e.hold(s); },
  };
}

export interface CutsceneRun {
  def: CutsceneDef;
  caster: Actor;
  target: Actor | null;
  // Which side of it the local player is on.
  role: 'caster' | 'target';
  // The caster's facing for the whole cutscene: at the target, if any.
  yaw: number;
  // Where the caster stands, when it is not where its body is drawn yet
  // (a remote caster, whose position arrives a moment late).
  origin?: THREE.Vector3;
  // The title card's small line: whose Output this is.
  sub: string;
  // Online: the other participant's player id, whose blows still land.
  partner?: number | null;
  // The caster starts the full sign; `beatIn` is how long until the blow.
  gesture(beatIn: number): void;
  // The blow. On the target's screen online it arrives over the network instead.
  resolve(): void;
  end?(resolved: boolean): void;
}

export interface CutsceneLog {
  id: string;
  role: 'caster' | 'target';
  presented: boolean;
  short: boolean;
  skipped: boolean;
  cancelled: boolean;
  // Timeline seconds (real time, hit-stop excluded) of each event, and of the end.
  events: { kind: string; t: number }[];
  end: number | null;
  beat: number | null;
  total: number;
  pulled: Vec3 | null;
}

export const cutsceneUi = {
  title: signal<{ jp: string; en: string; sub: string; color: number; id: number } | null>(null),
  active: signal(false),
};

const SEEN_KEY = 'zenko.cutscenes.seen';
function loadSeen(): Set<string> { try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[]); } catch { return new Set(); } }

const EASE: Record<Ease, (t: number) => number> = {
  out: (t) => 1 - Math.pow(1 - t, 2.2),
  in: (t) => t * t * t,
  inOut: (t) => t * t * (3 - 2 * t),
  linear: (t) => t,
};
const UP = new THREE.Vector3(0, 1, 0);

interface Timed { t: number; e: CutEvent; shot: number; done: boolean }

interface Live {
  run: CutsceneRun;
  origin: THREE.Vector3;
  fwd: THREE.Vector3;
  right: THREE.Vector3;
  aim: THREE.Vector3;
  t: number;
  hold: number;
  beat: number | null;
  endAt: number;
  starts: number[];
  shot: number;
  presenting: boolean;
  resolved: boolean;
  confirmed: boolean;
  events: Timed[];
  resume: AppState | null;
  log: CutsceneLog;
}

export class Cutscenes {
  private live: Live | null = null;
  private registry = new Map<string, () => void>();
  private titleN = 0;
  private seen = loadSeen();
  // Every cutscene this screen ran, for the checks.
  readonly log: CutsceneLog[] = [];

  constructor(private game: Game) {}

  register(id: string, start: () => void): void { this.registry.set(id, start); }
  playById(id: string): void { this.registry.get(id)?.(); }
  get ids(): string[] { return [...this.registry.keys()]; }

  get active(): boolean { return this.live !== null; }
  get presenting(): boolean { return !!this.live?.presenting; }
  get role(): 'caster' | 'target' | null { return this.live?.run.role ?? null; }
  get partner(): number | null { return this.live?.run.partner ?? null; }
  // The caster's arms are in the seal: before the blow.
  get sealing(): boolean { const l = this.live; return !!l && l.run.role === 'caster' && (l.beat === null || l.t < l.beat - 0.22); }
  // The local player stands in the cutscene: rooted, deaf to input, and
  // untouchable except by the cutscene's own blow.
  get locksPlayer(): boolean { return this.live !== null; }
  get timeline(): { t: number; beat: number | null; end: number } | null { const l = this.live; return l ? { t: l.t, beat: l.beat, end: l.endAt } : null; }

  play(run: CutsceneRun): boolean {
    if (this.live) return false;
    const g = this.game, def = run.def;
    const origin = (run.origin ?? run.caster.position).clone();
    const fwd = new THREE.Vector3(-Math.sin(run.yaw), 0, -Math.cos(run.yaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const { total, beat, starts } = cutsceneTiming(def);
    const mode: CutscenePlay = settings.value.cutscenes;
    const seen = this.seen.has(def.id);
    const short = mode === 'first' && seen && beat !== null;
    if (!seen) { this.seen.add(def.id); try { localStorage.setItem(SEEN_KEY, JSON.stringify([...this.seen])); } catch { /* private mode */ } }

    // The target is pulled in front of the caster, onto the floor, short of
    // any wall between them. With no target the frame looks a few metres ahead.
    let aim = origin.clone().addScaledVector(fwd, 4);
    let pulled: Vec3 | null = null;
    if (run.target) {
      if (def.pull !== null) {
        aim = this.pullPoint(origin, fwd, def.pull);
        run.target.place?.(aim, run.yaw + Math.PI);
        pulled = [aim.x, aim.y, aim.z];
      } else aim = run.target.position.clone();
    }
    run.target?.hold?.(total + 0.1);
    if (run.caster.local) run.caster.hold?.(total + 0.1);

    const events: Timed[] = [];
    def.shots.forEach((s, i) => { for (const e of s.events ?? []) events.push({ t: starts[i]! + e.at, e, shot: i, done: false }); });
    events.sort((a, b) => a.t - b.t);
    const log: CutsceneLog = { id: def.id, role: run.role, presented: mode !== 'never', short, skipped: false, cancelled: false, events: [], end: null, beat, total, pulled };
    this.log.push(log);
    this.live = {
      run, origin, fwd, right, aim, t: 0, hold: 0, beat, endAt: short ? beat! + SHORT_TAIL : total, starts, shot: -1,
      presenting: mode !== 'never', resolved: false, confirmed: !g.net || run.role === 'target', events, resume: null, log,
    };
    if (worldRuns.value && appState.value.kind !== 'cinematic') {
      this.live.resume = appState.value;
      setState({ kind: 'cinematic', resume: appState.value });
    }
    g.input.clear();
    if (this.live.presenting) cutsceneUi.active.value = true;
    this.advance(0);
    return true;
  }

  // Space: back to the player's own camera. The sign and the blow still play
  // out on the timeline, so skipping never lands a hit sooner.
  skip(): void {
    const l = this.live;
    if (!l) return;
    l.log.skipped = true;
    if (l.presenting) this.stopPresenting(l);
    l.endAt = Math.min(l.endAt, l.beat ?? l.t);
  }

  // Ends at once without the blow: the caster went down, the scene ended, or
  // the server refused the Output.
  cancel(): void {
    const l = this.live;
    if (!l) return;
    l.log.cancelled = true;
    this.finish();
  }

  // Online: the server took this screen's Output.
  confirm(): void { if (this.live) this.live.confirmed = true; }
  get confirmed(): boolean { return !!this.live?.confirmed; }

  // Online: the server ended the cutscene (the caster ended it, or it ran out).
  serverEnd(): void { const l = this.live; if (l && (l.run.role === 'target' || l.t >= l.endAt - 0.05)) this.finish(); }

  private pullPoint(origin: THREE.Vector3, fwd: THREE.Vector3, want: number): THREE.Vector3 {
    const ph = this.game.physics;
    const chest = origin.clone().add(new THREE.Vector3(0, 1.1, 0));
    const wall = ph.castRay(chest, fwd, want + 0.6, GROUP_WORLD);
    let d = wall ? Math.max(1.4, wall.toi - 0.6) : want;
    // Keep them on a floor: shorten the pull until one is under the spot.
    for (; d >= 1.4; d -= 0.5) {
      const spot = origin.clone().addScaledVector(fwd, d);
      const floor = ph.castRay(spot.clone().add(new THREE.Vector3(0, 1.6, 0)), new THREE.Vector3(0, -1, 0), 3.4, GROUP_WORLD);
      if (floor) return spot.setY(floor.point.y);
    }
    return origin.clone().addScaledVector(fwd, 1.4);
  }

  // A key's point. The caster is where it stands when the shot cuts in, so a
  // shot after the blow finds a caster the blow moved (Long Translation).
  private anchor(rel: Rel, o: Vec3, out: THREE.Vector3): THREE.Vector3 {
    const l = this.live!;
    if (rel === 'caster') out.copy(l.run.caster.local ? l.run.caster.position : l.origin);
    else if (rel === 'target') out.copy(l.aim);
    else out.copy(l.origin).lerp(l.aim, 0.5);
    return out.addScaledVector(l.right, o[0]).addScaledVector(UP, o[1]).addScaledVector(l.fwd, o[2]);
  }

  // Cuts to shot `i`: the move from its first key to its last, kept out of walls.
  private cutTo(i: number): void {
    const l = this.live!, s = l.run.def.shots[i]!;
    const a = s.from, b = { ...a, ...s.to };
    const ease = EASE[s.ease ?? 'out'];
    const p0 = this.anchor(a.rel ?? 'caster', a.pos, new THREE.Vector3()), p1 = this.anchor(b.rel ?? 'caster', b.pos, new THREE.Vector3());
    const l0 = this.anchor(a.lookRel ?? a.rel ?? 'caster', a.look, new THREE.Vector3()), l1 = this.anchor(b.lookRel ?? b.rel ?? 'caster', b.look, new THREE.Vector3());
    const ph = this.game.physics;
    const look = new THREE.Vector3(), dir = new THREE.Vector3(), from = new THREE.Vector3();
    const start = l.starts[i]!;
    this.game.cam.play({
      duration: s.duration,
      // The timeline drives the shot, so a hit-stop holds the camera too.
      progress: () => THREE.MathUtils.clamp(((this.live?.t ?? start + s.duration) - start) / s.duration, 0, 1),
      position: (t, out) => {
        const u = ease(t);
        out.lerpVectors(p0, p1, u);
        look.lerpVectors(l0, l1, u);
        // From just above the point looked at, so a look at the floor does not start inside it.
        from.copy(look).y += 0.5;
        dir.subVectors(out, from);
        const reach = dir.length();
        const hit = reach > 0.01 ? ph.castRay(from, dir.normalize(), reach, GROUP_WORLD) : null;
        if (hit) out.copy(from).addScaledVector(dir, Math.max(0.3, hit.toi - 0.25));
      },
      lookAt: (t, out) => out.lerpVectors(l0, l1, ease(t)),
      fov: (t) => THREE.MathUtils.lerp(a.fov, b.fov, ease(t)),
      roll: (t) => THREE.MathUtils.lerp(a.roll ?? 0, b.roll ?? 0, ease(t)),
    });
    this.game.cam.showCut();
    this.stagePage(s);
  }

  private stagePage(s: CutShot): void {
    const l = this.live!, r = this.game.renderer, color = new THREE.Color(l.run.def.color);
    r.look(s.page?.look ?? 'manga', color);
    if (s.page?.lines === 'focus') r.focus(l.aim.clone().add(new THREE.Vector3(0, 1.1, 0)), 0.7, s.duration);
    else if (s.page?.lines === 'rush') r.speed(null, 0.8, s.duration);
  }

  private stopPresenting(l: Live): void {
    l.presenting = false;
    this.game.renderer.look('manga');
    this.game.cam.cutBack();
    cutsceneUi.active.value = false;
    cutsceneUi.title.value = null;
  }

  // Real seconds since the last frame. Paused single-player, nothing moves;
  // online the room's clock keeps running under any menu.
  update(raw: number, dt: number): void {
    const l = this.live;
    if (!l) return;
    const g = this.game;
    if (!worldRuns.value && !g.net) return;
    if (l.presenting && g.input.hitAny('jump') && l.t > 0.15) this.skip();
    if (l.hold > 0) l.hold -= raw;
    else this.advance(raw);
    if (!this.live) return;
    // The caster performs its sign at full speed while the world it stands
    // in holds still.
    const c = l.run.caster;
    if (c.local) {
      const own = g.clock.frozen ? raw * 0.04 : raw;
      if (own > dt) c.avatar.update(own - dt);
    }
  }

  private advance(raw: number): void {
    const l = this.live!, g = this.game;
    l.t += raw;
    for (const ev of l.events) {
      if (ev.done || ev.t > l.t) continue;
      ev.done = true;
      this.fire(ev.e);
      if (!this.live) return;
    }
    if (l.presenting) {
      let i = 0;
      while (i + 1 < l.starts.length && l.t >= l.starts[i + 1]!) i++;
      if (i !== l.shot) { l.shot = i; this.cutTo(i); }
    }
    if (!g.net) {
      let i = 0;
      while (i + 1 < l.starts.length && l.t >= l.starts[i + 1]!) i++;
      g.clock.slowMo = l.run.def.shots[i]!.timeScale;
    }
    if (l.t >= l.endAt) this.finish();
  }

  private fire(e: CutEvent): void {
    const g = this.game, l = this.live!, r = l.run, color = r.def.color;
    l.log.events.push({ kind: e.kind, t: l.t });
    switch (e.kind) {
      case 'gesture': r.gesture(l.beat !== null ? Math.max(0.4, l.beat - l.t) : 1.4); break;
      case 'title': if (l.presenting) cutsceneUi.title.value = { ...r.def.title, sub: r.sub, color, id: ++this.titleN }; break;
      case 'resolveHit':
        if (!l.resolved) { l.resolved = true; r.resolve(); }
        if (l.presenting) g.combat.letter(l.aim.clone().add(new THREE.Vector3(0, 2.3, 0)), r.def.word, color, true);
        break;
      case 'impactFrame': g.renderer.impactFrame(e.frames, new THREE.Color(color), l.aim.clone().add(new THREE.Vector3(0, 1.1, 0))); break;
      case 'hitStop': l.hold = e.seconds; if (!g.net) g.clock.hitStop(e.seconds); break;
      case 'shake': g.cam.shake(e.amount); break;
      case 'sfx': g.audio.play(e.id, { gain: e.volume, pitch: e.pitch }); break;
      case 'vfx': {
        const feet = r.caster.position.clone();
        const chest = feet.clone().add(new THREE.Vector3(0, r.caster.height * 0.6, 0));
        if (e.id === 'charge') { g.vfx.ring(feet.add(new THREE.Vector3(0, 0.06, 0)), color, 0.3, 3.4, 0.9); g.vfx.burst(chest, 8, 'spark', 2, color); }
        else if (e.id === 'aura') { for (let i = 0; i < 4; i++) g.vfx.ring(feet.clone().add(new THREE.Vector3(0, 0.2 + i * 0.45, 0)), color, 0.9 - i * 0.1, 0.4, 0.7 + i * 0.12); }
        else g.vfx.flash(chest, color, 70, 0.5, 18);
        break;
      }
    }
  }

  private finish(): void {
    const l = this.live!, g = this.game, r = l.run;
    this.live = null;
    l.log.end = l.t;
    if (l.presenting) this.stopPresenting(l);
    if (!g.net) g.clock.slowMo = 1;
    // Ended before the blow: the sign it was building to breaks off.
    if (!l.resolved) r.caster.avatar.release();
    // The two come out of it a beat apart: whoever took the blow reels first.
    if (r.target?.local) r.target.hold?.(0);
    if (r.caster.local && r.caster !== r.target) r.caster.hold?.(0);
    if (l.resume && appState.value.kind === 'cinematic') setState(l.resume);
    g.input.clear();
    r.end?.(l.resolved);
  }
}
