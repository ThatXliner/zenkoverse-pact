import * as THREE from 'three';
import type { Game } from './game';
import { SPAWN } from '../world/district';
import { setState, appState } from './state';
import type { TechniqueId } from '../techniques/kit';

export interface DebugApi {
  game: Game;
  teleport(where: keyof typeof SPAWN | [number, number, number]): void;
  skipTutorial(): void;
  god(on?: boolean): void;
  technique(id: TechniqueId): void;
  camera(mode: 'first' | 'third'): void;
  look(yaw: number, pitch: number): void;
  cast(slot: 'primary' | 'secondary' | 'max'): void;
  hold(action: 'primary' | 'secondary' | 'aura' | 'forward' | 'sprint', held: boolean): void;
  encounter(id: 'alley-thugs' | 'kuroda' | 'ancient-bridge' | 'dummy-room'): void;
  drill(id: 'recoil-crane'): void;
  workshop(open: boolean): void;
  tutorialStep(step: string): void;
  cutscene(id: string): void;
  freezeTime(on: boolean): void;
  loop(on: boolean): void;
  step(frames: number, dt?: number): void;
  state(): string;
  errors: string[];
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
    camera(mode) { game.cam.mode = mode; game.cam.blend = mode === 'first' ? 0 : 1; },
    look(yaw, pitch) { game.cam.yaw = yaw; game.cam.pitch = pitch; },
    cast(slot) { game.techniques.cast(slot, true); },
    hold(action, held) { game.input.inject(action, held); },
    encounter(id) { game.encounters.begin(id, true); },
    drill(id) { game.drills.begin(id); },
    workshop(open) { setState(open ? { kind: 'workshop' } : { kind: 'explore' }); },
    tutorialStep(step) { game.tutorial.jump(step as never); },
    cutscene(id) { game.cutscenes.playById(id); },
    freezeTime(on) { game.clock.slowMo = on ? 0 : 1; },
    loop(on) { game.loop(on); },
    step(frames, dt) { game.step(frames, dt); },
    state() { return appState.value.kind; },
    stats() {
      const i = game.renderer.gl.info;
      return { fps: 0, drawCalls: i.render.calls, triangles: i.render.triangles, props: game.props.instances.length, enemies: game.encounters.enemies.length };
    },
  };
  (window as unknown as { game: DebugApi }).game = api;
}
