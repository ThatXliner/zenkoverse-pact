import * as THREE from 'three';
import type { Game } from './game';
import { SPAWN } from '../world/compound';
import type { CameraMode } from '../player/camera';
import { appState } from './state';
import { validatePact } from '../pacts/schema';
import type { KeySlot } from '../pacts/slots';
import type { DrillId } from './state';
import type { Action } from './keymap';
import { audit as auditOffers } from '../rooftop/offers';
import type { TechniqueId } from '../techniques/kit';
import type { PoseName } from '../hands/poses';
import { MASTERY_CONFIG } from '../mastery/mastery';
import { netUi } from '../net/net';
import { clashUi } from '../combat/clash';

export interface DebugApi {
  game: Game;
  teleport(where: keyof typeof SPAWN | [number, number, number]): void;
  skipTutorial(): void;
  god(on?: boolean): void;
  technique(id: TechniqueId): void;
  camera(mode: CameraMode): void;
  look(yaw: number, pitch: number): void;
  cast(slot: KeySlot): void;
  pose(name: PoseName | null): void;
  handsView(yaw: number, pitch: number): void;
  hold(action: Action, held: boolean): void;
  encounter(id: 'sparring' | 'kuroda' | 'ancient' | 'dummy-room'): void;
  drill(id: DrillId): void;
  workshop(open: boolean): void;
  tutorialStep(step: string): void;
  cutscene(id: string): void;
  freezeTime(on: boolean): void;
  loop(on: boolean): void;
  step(frames: number, dt?: number): void;
  state(): string;
  // The full sign as the check scripts read it: its state, how far along the
  // sign or the primed window is, and the boost the next primed cast earns
  // at the current Activation.
  sign(): { kind: 'idle' | 'signing' | 'primed'; duration: number; progress: number; left: number; window: number; boost: number };
  errors: string[];
  rooftop: {
    begin(): void;
    clearWave(): void;
    climb(dir: 'up' | 'down'): void;
    status(): { stage: string; wave: number; alive: number; hp: number; maxHp: number; eye: string | null; app: string };
    audit(technique: TechniqueId, rounds: number): string[];
    offers(): { name: string; slot: string; tags: string[]; text: string; valid: boolean; errors: string[] }[];
  };
  stats(): { fps: number; drawCalls: number; triangles: number; props: number; enemies: number };
  // The player's aura as the checks read it, and the clash in progress.
  aura(): AuraView;
  // Sets trained refinement for the Technique in hand (the drill raises it in play).
  refinement(v: number): void;
  // Refills the pool at once, so a check need not wait out a recovery.
  auraReady(): void;
  // The online room as the multiplayer check reads it: this player, the
  // others as drawn here, and the hits sent and health changes heard.
  net(): NetView | null;
}

export interface AuraView {
  state: string; pool: number; left: number; radius: number; density: number; ended: string | null; guardBroken: number;
  refinement: number; trained: number; potential: number; breadth: number; pacts: number;
  clash: { stage: string | null; masterPick: string | null; view: unknown; log: unknown[] };
  hp: number; master: { hp: number; field: string; radius: number; ended: string | null; locked: number; guardBroken: number } | null;
}

export interface NetView {
  id: number | null;
  status: string;
  room: string;
  hp: number;
  downed: boolean;
  me: { kills: number; downs: number } | null;
  pos: [number, number, number];
  remotes: { id: number; name: string; drawn: [number, number, number] | null; alive: boolean; hp: number; visible: boolean; kills: number; downs: number }[];
  sent: { target: number; amount: number; t: number }[];
  hpLog: { id: number; hp: number; by: number | null; amount: number; t: number }[];
}

export function installDebug(game: Game): void {
  if (!new URLSearchParams(location.search).has('debug')) return;
  const errors: string[] = [];
  window.addEventListener('error', (e) => errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => errors.push(String((e as PromiseRejectionEvent).reason)));
  const api: DebugApi = {
    game,
    errors,
    teleport(where) {
      const p = Array.isArray(where) ? new THREE.Vector3(...where) : SPAWN[where].clone();
      game.player.teleport(p);
    },
    skipTutorial() { game.tutorial.skip(); },
    god(on = true) { game.combat.god = on; },
    technique(id) { game.setTechnique(id); },
    camera(mode) { game.cam.snap(mode); game.setCamera(mode); },
    look(yaw, pitch) { game.cam.yaw = yaw; game.cam.pitch = pitch; },
    cast(slot) { game.techniques.cast(slot, true); },
    pose(name) { game.hands.debugPose = name; },
    handsView(yaw, pitch) { game.hands.inspect = yaw === 0 && pitch === 0 ? null : { yaw, pitch }; },
    hold(action, held) { game.input.inject(action, held); },
    encounter(id) { game.encounters.begin(id, true); },
    drill(id) { game.drills.begin(id); },
    workshop(open) { if (open) game.openWorkshop(); else game.closeWorkshop(); },
    tutorialStep(step) { game.tutorial.jump(step as never); },
    cutscene(id) { game.cutscenes.playById(id); },
    freezeTime(on) { game.clock.slowMo = on ? 0 : 1; },
    loop(on) { game.loop(on); },
    step(frames, dt) { game.step(frames, dt); },
    state() { return appState.value.kind; },
    sign() {
      const t = game.techniques, s = t.sign;
      const duration = t.def.sign.duration, window = MASTERY_CONFIG.sign.window;
      return { kind: s.kind, duration, window, progress: s.kind === 'signing' ? s.t / s.duration : s.kind === 'primed' ? 1 : 0, left: s.kind === 'primed' ? s.left : 0, boost: game.mastery.signBoost(game.techniqueId) };
    },
    rooftop: {
      begin() { game.rooftop.begin(); },
      clearWave() { game.rooftop.clearWave(); },
      climb(dir) { if (dir === 'up') game.rooftop.climbUp(); else game.rooftop.climbDown(); },
      status() { const r = game.rooftop; return { stage: r.stage, wave: r.wave, alive: r.alive, hp: game.combat.hp, maxHp: game.combat.maxHp, eye: game.combat.eye, app: appState.value.kind }; },
      audit(technique, rounds) { const was = game.techniqueId; game.setTechnique(technique); const bad = auditOffers(game, rounds); game.setTechnique(was); return bad; },
      offers() {
        const shapes = game.techniques.def.shapes;
        return game.rooftop.offers.map((o) => { const v = validatePact(o.pact, shapes); return { name: o.pact.name, slot: o.pact.slot, tags: o.tags, text: o.text, valid: v.ok, errors: v.errors }; });
      },
    },
    net() {
      const n = game.net;
      if (!n) return null;
      const me = netUi.me.value;
      const p = game.player.position;
      return {
        id: n.id, status: netUi.status.value, room: netUi.room.value, hp: game.combat.hp, downed: n.downed,
        me: me ? { kills: me.kills, downs: me.downs } : null,
        pos: [p.x, p.y, p.z],
        remotes: [...n.remotes.values()].map((r) => ({ id: r.id, name: r.info.name, drawn: r.drawn ? [r.drawn.x, r.drawn.y, r.drawn.z] as [number, number, number] : null, alive: r.alive, hp: r.hp, visible: r.avatar.root.visible && !r.disposed, kills: r.info.kills, downs: r.info.downs })),
        sent: [...n.log.sent], hpLog: [...n.log.hp],
      };
    },
    aura() {
      const a = game.aura, f = a.field, t = game.techniqueId;
      const m = game.encounters.enemies.find((e) => e.field && !e.disposed);
      return {
        state: f.state, pool: f.pool, left: f.left, radius: f.radius, density: f.density, ended: f.ended, guardBroken: a.guardBroken,
        refinement: a.refinement(t), trained: game.mastery.get(t, 'refinement'), potential: a.potential(t), breadth: a.breadth(t), pacts: a.pacts(t),
        clash: { stage: a.clash.stage, masterPick: a.clash.masterPick, view: clashUi.value, log: a.clash.log.map((l) => ({ ...l })) },
        hp: game.combat.hp,
        master: m ? { hp: m.hp, field: m.field!.state, radius: m.field!.radius, ended: m.field!.ended, locked: m.locked, guardBroken: m.guardBroken } : null,
      };
    },
    refinement(v) {
      const t = game.techniqueId;
      game.mastery.stats.value = { ...game.mastery.stats.value, [t]: { ...game.mastery.stats.value[t], refinement: v } };
    },
    auraReady() { if (!game.aura.field.open) game.aura.field.reset(); },
    stats() {
      const i = game.renderer.gl.info;
      return { fps: 0, drawCalls: i.render.calls, triangles: i.render.triangles, props: game.props.instances.length, enemies: game.encounters.enemies.length };
    },
  };
  (window as unknown as { game: DebugApi }).game = api;
}
