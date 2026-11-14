import * as THREE from 'three';
import { signal } from '@preact/signals';
import type { Game } from '../app/game';
import { banner } from '../app/game';
import { uiBlocksInput } from '../app/state';
import type { Enemy } from './enemies';
import type { RemotePlayer } from '../net/remote';
import { ClashReferee, PICKS, type ClashEvent, type Pick, type Side } from '../net/clash';
import { RULES } from '../net/protocol';
import { AURA } from './field';
import { ClashSeam } from './fieldView';

// The Aura Clash as it plays on this screen (issue #4). Two open fields that
// touch start one. It locks only the two people in it: they stand, cannot
// cast and cannot be hurt, and their camera cuts to a side-on shot of the
// two of them. The world keeps running at full speed for everyone else.
//
// The exchanges are the rules in src/net/clash.js. Against the Master the
// browser runs the referee, and she picks with a tell: she leans in before a
// push, roots before a hold, and her field flickers before a feint. Against
// another player the server runs it, and both screens play the events it
// sends, so they agree on every pick and on the winner.
//
// Nobody loses health to a clash. The loser's field collapses: their aura
// must refill from empty, they are held for a moment, and for a few seconds
// they take more from every blow. That is the winner's opening.

export type ClashResult = 'won' | 'lost' | 'even';
export interface ClashView {
  them: string;
  themColor: number;
  online: boolean;
  stage: 'intro' | 'choose' | 'reveal' | 'over';
  round: number;
  rounds: number;
  score: [number, number];
  mine: Pick | null;
  theirs: Pick | null;
  // What the Master's body shows this exchange, once she has shown it.
  tell: Pick | null;
  // Who took the exchange being revealed.
  took: 'me' | 'them' | 'none' | null;
  result: ClashResult | null;
  // When the open exchange closes, on performance.now(), and how long it is.
  closes: number;
  window: number;
}
export const clashUi = signal<ClashView | null>(null);

export const PICK_WORDS: Record<Pick, { jp: string; en: string }> = {
  push: { jp: '押', en: 'Push' },
  hold: { jp: '守', en: 'Hold' },
  feint: { jp: '虚', en: 'Feint' },
};
// What the Master's body does before each pick, in words for the screen.
export const TELL_WORDS: Record<Pick, string> = {
  push: 'She leans in. Her field swells toward you.',
  hold: 'She roots her stance. Her field draws tight.',
  feint: 'Her far side flickers thin.',
};
const PICK_CLIP: Record<Pick, string> = { push: 'Punch_Cross', hold: 'Spell_Simple_Enter', feint: 'Spell_Simple_Exit' };
// The Master shows her pick this long after an exchange opens; later in the last.
const TELL_AFTER = [0.3, 0.32, 0.45];
const OUTRO = 0.9;

type Opponent = { kind: 'master'; enemy: Enemy } | { kind: 'player'; remote: RemotePlayer };

interface Run {
  opp: Opponent;
  me: Side;
  // The browser's referee against the Master; null when the server runs it.
  referee: ClashReferee | null;
  id: number | null;
  ms: number;
  t: number;
  stage: ClashView['stage'];
  round: number;
  score: [number, number];
  mine: Pick | null;
  theirs: Pick | null;
  tell: Pick | null;
  tellAt: number;
  took: ClashView['took'];
  result: ClashResult | null;
  // Seconds left of the ending, once the clash is decided.
  outro: number;
  closes: number;
  window: number;
  seamShift: number;
  lastMasterPicks: Pick[];
  lostLast: boolean;
}

// A clash between two other players, seen from outside.
interface Watched { a: RemotePlayer; b: RemotePlayer; shift: number }

export interface ClashLogEntry { id: number | null; a: number | string; b: number | string; ev: ClashEvent }

export class Clash {
  private run: Run | null = null;
  private seam: ClashSeam;
  private watched = new Map<number, { w: Watched; seam: ClashSeam }>();
  // Every clash event this screen played, for the checks.
  readonly log: ClashLogEntry[] = [];

  constructor(private game: Game) {
    this.seam = new ClashSeam(game.renderer.scene);
  }

  get active(): boolean { return this.run !== null; }
  get stage(): ClashView['stage'] | null { return this.run?.stage ?? null; }
  // The pick the Master has committed to this exchange, for the checks.
  get masterPick(): Pick | null { return this.run?.opp.kind === 'master' ? this.run.tell : null; }

  // Offline: the player's field touched the Master's.
  startMaster(enemy: Enemy): void {
    if (this.run) return;
    const g = this.game;
    this.begin({ kind: 'master', enemy }, 0, null, new ClashReferee([g.aura.field.density, enemy.field!.density], RULES.clash, 0));
    enemy.hold(Infinity);
  }

  // Online: the server started a clash. `a` and `b` are player ids.
  serverStart(id: number, a: number, b: number): void {
    const net = this.game.net;
    if (!net) return;
    const mine = a === net.id || b === net.id;
    if (!mine) {
      const ra = net.remotes.get(a), rb = net.remotes.get(b);
      if (ra && rb) this.watched.set(id, { w: { a: ra, b: rb, shift: 0 }, seam: new ClashSeam(this.game.renderer.scene) });
      return;
    }
    const remote = net.remotes.get(a === net.id ? b : a);
    if (!remote || this.run) return;
    this.begin({ kind: 'player', remote }, a === net.id ? 0 : 1, id, null);
  }

  // Online: one step of a clash the server runs.
  serverStep(id: number, a: number, b: number, ev: ClashEvent): void {
    this.log.push({ id, a, b, ev });
    if (this.run?.id === id) { this.apply(ev); return; }
    const w = this.watched.get(id);
    if (!w) return;
    if (ev.kind === 'reveal' && ev.winner !== null) { w.w.shift += ev.winner === 0 ? 0.12 : -0.12; w.seam.burst(); }
    if (ev.kind === 'end') { w.seam.dispose(); this.watched.delete(id); }
  }

  private begin(opp: Opponent, me: Side, id: number | null, referee: ClashReferee | null): void {
    const g = this.game;
    this.run = {
      opp, me, referee, id, ms: 0, t: 0, stage: 'intro', round: 0, score: [0, 0], mine: null, theirs: null, tell: null, tellAt: Infinity,
      took: null, result: null, outro: 0, closes: 0, window: RULES.clash.windowMs, seamShift: 0, lastMasterPicks: [], lostLast: false,
    };
    g.techniques.interrupt();
    g.input.clear();
    g.audio.play('impactBell_heavy_002', 0.7, 0.55);
    g.audio.play('phaserUp3', 0.5, 0.6);
    g.renderer.impactFrame(1, new THREE.Color(0xffffff));
    g.cam.play(this.shot());
    this.seam.burst();
    this.publish();
  }

  // The side-on two-shot: the camera stands off the line between the two,
  // on the side it already looks from, low, and eases in through the clash.
  private shot(): { duration: number; position: (t: number, out: THREE.Vector3) => void; lookAt: (t: number, out: THREE.Vector3) => void; fov: (t: number) => number; roll: (t: number) => number } {
    const g = this.game, r = this.run!;
    const me = g.player.position.clone(), them = this.opponentFeet(r.opp).clone();
    const mid = me.clone().lerp(them, 0.5);
    const line = them.clone().sub(me).setY(0);
    const dist = Math.max(2, line.length());
    line.normalize();
    // The camera stands on the side that puts the player on the left of the
    // frame, where the sheet names them.
    let side = new THREE.Vector3(line.z, 0, -line.x);
    const right = new THREE.Vector3().crossVectors(side.clone().negate(), new THREE.Vector3(0, 1, 0));
    if (line.dot(right) < 0) side = side.negate();
    const far = dist * 0.62 + 3.4;
    const at = (out: THREE.Vector3, k: number) => out.copy(mid).addScaledVector(side, far * k).addScaledVector(line, -0.6).add(new THREE.Vector3(0, 1.35 + k * 0.4, 0));
    const look = mid.clone().add(new THREE.Vector3(0, 1.15, 0));
    const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, t), 2);
    return {
      duration: 60,
      position: (_t, out) => at(out, 1.12 - 0.18 * ease((this.run?.t ?? 6) / 6)),
      lookAt: (_t, out) => out.copy(look),
      fov: () => 46 - 4 * ease((this.run?.t ?? 6) / 6),
      roll: () => 0.04,
    };
  }

  private opponentFeet(o: Opponent): THREE.Vector3 { return o.kind === 'master' ? o.enemy.position : o.remote.position; }
  private opponentField(o: Opponent): { radius: number; color: THREE.Color } {
    if (o.kind === 'master') return { radius: o.enemy.field?.radius ?? 0, color: new THREE.Color(o.enemy.def.emissive ?? 0x7dffb2) };
    return { radius: o.remote.fieldRadius, color: new THREE.Color(this.game.aura.colorOf(o.remote)) };
  }

  // The player's pick, from the keys or the buttons on the clash sheet.
  choose(pick: Pick): void {
    const r = this.run, g = this.game;
    if (!r || r.stage !== 'choose' || r.mine) return;
    if (r.referee) { if (!r.referee.pick(r.me, pick, r.ms)) return; }
    else g.net?.clashPick(r.id!, r.round, pick);
    r.mine = pick;
    g.avatar.playUpper(PICK_CLIP[pick], 1.4);
    g.audio.play('click_003', 0.5, pick === 'push' ? 0.8 : pick === 'hold' ? 0.6 : 1.1);
    this.publish();
  }

  private apply(ev: ClashEvent): void {
    const r = this.run!, g = this.game;
    if (r.referee) this.log.push({ id: null, a: r.me === 0 ? 'player' : 'master', b: r.me === 0 ? 'master' : 'player', ev });
    if (ev.kind === 'round') {
      r.stage = 'choose';
      r.round = ev.round;
      r.mine = r.theirs = r.tell = null;
      r.took = null;
      r.window = ev.ms;
      r.closes = performance.now() + ev.ms;
      r.tellAt = r.opp.kind === 'master' ? r.t + (TELL_AFTER[ev.round - 1] ?? 0.4) : Infinity;
      g.audio.play('tick_001', 0.45, 0.9 + ev.round * 0.08);
    } else if (ev.kind === 'reveal') {
      const them: Side = r.me === 0 ? 1 : 0;
      r.stage = 'reveal';
      r.mine = ev.picks[r.me];
      r.theirs = ev.picks[them];
      r.score = [ev.score[r.me], ev.score[them]];
      r.took = ev.winner === null ? 'none' : ev.winner === r.me ? 'me' : 'them';
      if (r.took !== 'none') r.seamShift += r.took === 'me' ? 0.12 : -0.12;
      r.lostLast = r.took === 'me';
      this.seam.burst();
      g.cam.shake(r.took === 'none' ? 0.15 : 0.35);
      g.cam.kick({ fov: r.took === 'me' ? -5 : 4 });
      g.audio.play(r.took === 'none' ? 'impactGlass_light_000' : 'impactBell_heavy_000', 0.6, r.took === 'me' ? 1.15 : 0.75);
      if (r.opp.kind === 'player') r.opp.remote.avatar.playUpper(PICK_CLIP[r.theirs], 1.4);
      this.showTell(null);
    } else {
      const winner = ev.winner === null ? null : ev.winner === r.me ? 'me' : 'them';
      r.stage = 'over';
      r.result = winner === 'me' ? 'won' : winner === 'them' ? 'lost' : 'even';
      r.outro = OUTRO;
      this.settle(r, winner, ev.reason);
    }
    this.publish();
  }

  // The fields answer the result. The loser's collapses; nobody's health moves.
  private settle(r: Run, winner: 'me' | 'them' | null, reason: string): void {
    const g = this.game;
    const name = r.opp.kind === 'master' ? 'Her' : `${r.opp.remote.info.name}'s`;
    g.renderer.impactFrame(2, new THREE.Color(winner === 'them' ? 0xff6a5a : 0xffffff));
    if (winner !== 'me') g.aura.collapse(winner === 'them' ? AURA.guardBreak.seconds + OUTRO : 0);
    if (winner !== 'them' && r.opp.kind === 'master') {
      const e = r.opp.enemy;
      if (e.field?.end('collapsed')) g.aura.viewOf(e)?.crack();
      if (winner === 'me') e.guardBroken = AURA.guardBreak.seconds + OUTRO;
    }
    if (winner === 'me') {
      g.audio.play('impactGlass_heavy_001', 0.8, 0.9);
      banner('崩壊', reason === 'forfeit' ? 'They left the clash. Their field broke.' : `${name} field collapsed. The opening is yours.`);
    } else if (winner === 'them') banner('乱れ', 'Your field collapsed. Guard broken: recover.');
    else banner('相殺', 'Both fields break.');
  }

  private showTell(kind: Pick | null): void {
    const r = this.run;
    if (!r || r.opp.kind !== 'master') return;
    const view = this.game.aura.viewOf(r.opp.enemy);
    view?.tell(kind, this.game.player.position.clone().sub(r.opp.enemy.position));
  }

  // The Master's choice for this exchange. She favours pushing, presses
  // harder after losing one, and never makes the same pick three times running.
  private masterChooses(r: Run): Pick {
    const w: Record<Pick, number> = { push: r.lostLast ? 0.55 : 0.4, hold: 0.35, feint: 0.25 };
    const [p1, p2] = r.lastMasterPicks.slice(-2);
    if (p1 && p1 === p2) w[p1] = 0;
    const total = PICKS.reduce((s, p) => s + w[p], 0);
    let x = Math.random() * total;
    for (const p of PICKS) { x -= w[p]; if (x <= 0) return p; }
    return 'hold';
  }

  cancel(): void {
    const r = this.run;
    if (!r) return;
    this.run = null;
    this.release(r);
    for (const { seam } of this.watched.values()) seam.dispose();
    this.watched.clear();
  }

  private release(r: Run): void {
    const g = this.game;
    g.cam.release(0.45);
    this.seam.hide();
    if (r.opp.kind === 'master') {
      const e = r.opp.enemy;
      e.hold(r.result === 'won' ? AURA.guardBreak.stun * 1.5 : 0);
      this.showTell(null);
      if (r.result === 'won') e.avatar.playOneShot('Hit_Head');
    }
    if (r.result === 'lost') g.player.rooted = Math.max(g.player.rooted, AURA.guardBreak.stun);
    clashUi.value = null;
  }

  update(raw: number): void {
    const g = this.game;
    for (const { w, seam } of this.watched.values()) {
      if (w.a.disposed || w.b.disposed) continue;
      const at = this.seamPoint(w.a.position, w.a.fieldRadius, w.b.position, w.b.fieldRadius, w.shift);
      seam.draw(raw, g.clock.time, at, g.renderer.camera, new THREE.Color(g.aura.colorOf(w.a)), new THREE.Color(g.aura.colorOf(w.b)), 1.6);
    }
    const r = this.run;
    if (!r) return;
    r.t += raw;
    r.ms += raw * 1000;
    // The two stand where they are and nothing touches them.
    g.player.rooted = Math.max(g.player.rooted, 0.1);
    g.player.velocity.set(0, Math.min(0, g.player.velocity.y), 0);
    g.combat.invuln = Math.max(g.combat.invuln, 0.25);
    if (r.opp.kind === 'master' && !r.opp.enemy.alive) { this.cancel(); return; }
    if (r.opp.kind === 'player' && r.opp.remote.disposed && r.stage !== 'over') { this.cancel(); return; }

    if (r.stage === 'choose' && !r.mine && !uiBlocksInput.value) {
      const inp = g.input;
      if (inp.hitAny('forward')) this.choose('push');
      else if (inp.hitAny('back')) this.choose('hold');
      else if (inp.hitAny('left') || inp.hitAny('right')) this.choose('feint');
    }
    if (r.opp.kind === 'master' && r.stage === 'choose' && r.tell === null && r.t >= r.tellAt) {
      const pick = this.masterChooses(r);
      r.tell = pick;
      r.lastMasterPicks.push(pick);
      r.referee!.pick(r.me === 0 ? 1 : 0, pick, r.ms);
      r.opp.enemy.avatar.playUpper(PICK_CLIP[pick], 1.2);
      this.showTell(pick);
      g.audio.play(pick === 'push' ? 'phaserUp3' : pick === 'hold' ? 'impactSoft_heavy_001' : 'glitch_001', 0.35, pick === 'feint' ? 1.4 : 0.7);
      this.publish();
    }
    if (r.referee && r.stage !== 'over') for (const ev of r.referee.step(r.ms)) this.apply(ev);
    if (r.stage === 'over') {
      r.outro -= raw;
      if (r.outro <= 0) { this.run = null; this.release(r); return; }
    }
    this.drawSeam(r, raw);
  }

  private seamPoint(a: THREE.Vector3, ra: number, b: THREE.Vector3, rb: number, shift: number): THREE.Vector3 {
    // Where the two boundaries meet, pushed toward whoever is losing ground.
    const k = THREE.MathUtils.clamp(ra / Math.max(0.1, ra + rb) + shift, 0.15, 0.85);
    return a.clone().lerp(b, k).add(new THREE.Vector3(0, 1.2, 0));
  }

  private drawSeam(r: Run, raw: number): void {
    const g = this.game;
    const of = this.opponentField(r.opp);
    const me = g.player.position, them = this.opponentFeet(r.opp);
    const at = this.seamPoint(me, g.aura.field.radius, them, of.radius, r.seamShift);
    // Left and right as the camera sees them.
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(g.renderer.camera.quaternion);
    const mineLeft = me.clone().sub(them).dot(right) < 0;
    const mineC = new THREE.Color(g.aura.colorOf(null));
    g.aura.leanToward(them);
    if (r.opp.kind === 'master') g.aura.viewOf(r.opp.enemy)?.tell(r.stage === 'choose' ? r.tell : null, me.clone().sub(them));
    this.seam.draw(raw, g.clock.time, at, g.renderer.camera, mineLeft ? mineC : of.color, mineLeft ? of.color : mineC, r.stage === 'intro' ? 2.2 : 1.7);
  }

  private publish(): void {
    const r = this.run;
    if (!r) { clashUi.value = null; return; }
    const o = r.opp;
    clashUi.value = {
      them: o.kind === 'master' ? o.enemy.def.name : o.remote.info.name,
      themColor: o.kind === 'master' ? o.enemy.def.emissive ?? 0x7dffb2 : this.game.aura.colorOf(o.remote),
      online: o.kind === 'player', stage: r.stage, round: r.round, rounds: RULES.clash.rounds, score: [...r.score],
      mine: r.mine, theirs: r.stage === 'reveal' || r.stage === 'over' ? r.theirs : null, tell: r.tell, took: r.took, result: r.result,
      closes: r.closes, window: r.window,
    };
  }
}
