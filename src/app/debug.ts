import * as THREE from 'three';
import type { Game } from './game';
import { SPAWN } from '../world/compound';
import type { CameraMode } from '../player/camera';
import { appState } from './state';
import { validatePact } from '../pacts/schema';
import type { KeySlot } from '../pacts/slots';
import type { Action } from './keymap';
import { audit as auditOffers } from '../rooftop/offers';
import type { TechniqueId } from '../techniques/kit';
import type { PoseName } from '../hands/poses';
import { MASTERY_CONFIG } from '../mastery/mastery';

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
  drill(id: 'recoil-crane'): void;
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
    status(): { stage: string; wave: number; alive: number; hp: number; maxHp: number; auraAllowed: boolean; eye: string | null; app: string };
    audit(technique: TechniqueId, rounds: number): string[];
    offers(): { name: string; slot: string; tags: string[]; text: string; valid: boolean; errors: string[] }[];
  };
  stats(): { fps: number; drawCalls: number; triangles: number; props: number; enemies: number };
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
      status() { const r = game.rooftop; return { stage: r.stage, wave: r.wave, alive: r.alive, hp: game.combat.hp, maxHp: game.combat.maxHp, auraAllowed: r.auraAllowed, eye: game.combat.eye, app: appState.value.kind }; },
      audit(technique, rounds) { const was = game.techniqueId; game.setTechnique(technique); const bad = auditOffers(game, rounds); game.setTechnique(was); return bad; },
      offers() {
        const shapes = game.techniques.def.shapes;
        return game.rooftop.offers.map((o) => { const v = validatePact(o.pact, shapes); return { name: o.pact.name, slot: o.pact.slot, tags: o.tags, text: o.text, valid: v.ok, errors: v.errors }; });
      },
    },
    stats() {
      const i = game.renderer.gl.info;
      return { fps: 0, drawCalls: i.render.calls, triangles: i.render.triangles, props: game.props.instances.length, enemies: game.encounters.enemies.length };
    },
  };
  (window as unknown as { game: DebugApi }).game = api;
}
