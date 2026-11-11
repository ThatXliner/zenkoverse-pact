import * as THREE from 'three';
import { signal } from '@preact/signals';
import type { Game } from '../app/game';
import { appState, setState, type AppState } from '../app/state';
import { settings } from '../app/settings';
import type { Shot } from '../player/camera';

// Cutscenes are data (issue #27). Anchors are relative to the caster or the
// target in their facing frame, so one definition works anywhere in the
// district. The world freezes; the hit resolves on the `resolveHit` beat.
export interface Anchor { rel: 'caster' | 'target' | 'mid'; offset: [number, number, number] }
export type CutEvent =
  | { at: number; kind: 'gesture' }
  | { at: number; kind: 'title' }
  | { at: number; kind: 'impactFrame'; frames?: number }
  | { at: number; kind: 'resolveHit' }
  | { at: number; kind: 'vfx'; id: string }
  | { at: number; kind: 'sfx'; id: string; volume?: number; pitch?: number }
  | { at: number; kind: 'slow'; scale: number }
  | { at: number; kind: 'shake'; amount: number };
export interface CutShot { duration: number; from: Anchor; to?: Anchor; look: Anchor; lookTo?: Anchor; fov?: [number, number]; roll?: [number, number]; events?: CutEvent[] }
export interface CutsceneDef { id: string; title: { jp: string; en: string }; color: number; shots: CutShot[]; timeScale: number; letterbox?: boolean }

export interface CutsceneRun {
  def: CutsceneDef;
  caster: THREE.Object3D;
  casterYaw: number;
  target: THREE.Vector3 | null;
  onGesture: () => void;
  onResolve: () => void;
  onVfx: (id: string) => void;
  onEnd?: () => void;
}

export const cutsceneUi = { title: signal<{ jp: string; en: string; color: number; id: number } | null>(null), active: signal(false) };

export class Cutscenes {
  private run: CutsceneRun | null = null;
  private shotIndex = 0;
  private shotT = 0;
  private fired = new Set<string>();
  private resumeState: AppState | null = null;
  private prevMode: 'first' | 'third' = 'first';
  private resolved = false;
  private registry = new Map<string, (game: Game) => void>();
  private titleN = 0;

  constructor(private game: Game) {}

  register(id: string, start: (game: Game) => void): void { this.registry.set(id, start); }
  playById(id: string): void { this.registry.get(id)?.(this.game); }
  get active(): boolean { return this.run !== null; }

  play(run: CutsceneRun): void {
    if (this.run) return;
    const g = this.game;
    this.run = run;
    this.shotIndex = -1;
    this.shotT = 0;
    this.fired.clear();
    this.resolved = false;
    this.resumeState = appState.value;
    this.prevMode = g.cam.mode;
    g.cam.mode = 'third';
    g.cam.blend = 1;
    g.clock.slowMo = run.def.timeScale;
    cutsceneUi.active.value = true;
    setState({ kind: 'cinematic', resume: this.resumeState });
    this.nextShot();
  }

  skip(): void {
    if (!this.run) return;
    if (!this.resolved) { this.resolved = true; this.run.onResolve(); }
    this.end();
  }

  private anchor(a: Anchor, out: THREE.Vector3): THREE.Vector3 {
    const r = this.run!;
    const base = a.rel === 'target' && r.target ? r.target.clone() : a.rel === 'mid' && r.target ? r.caster.position.clone().lerp(r.target, 0.5) : r.caster.position.clone();
    const yaw = r.casterYaw;
    const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
    return out.copy(base).addScaledVector(right, a.offset[0]).add(new THREE.Vector3(0, a.offset[1], 0)).addScaledVector(fwd, a.offset[2]);
  }

  private nextShot(): void {
    const r = this.run!;
    this.shotIndex++;
    this.shotT = 0;
    const s = r.def.shots[this.shotIndex];
    if (!s) { this.end(); return; }
    const fromA = new THREE.Vector3(), toA = new THREE.Vector3(), lookA = new THREE.Vector3(), lookB = new THREE.Vector3();
    this.anchor(s.from, fromA);
    this.anchor(s.to ?? s.from, toA);
    this.anchor(s.look, lookA);
    this.anchor(s.lookTo ?? s.look, lookB);
    const ease = (t: number) => 1 - Math.pow(1 - t, 2.2);
    const shot: Shot = {
      duration: s.duration,
      position: (t, out) => out.lerpVectors(fromA, toA, ease(t)),
      lookAt: (t, out) => out.lerpVectors(lookA, lookB, ease(t)),
      fov: s.fov ? (t) => THREE.MathUtils.lerp(s.fov![0], s.fov![1], ease(t)) : undefined,
      roll: s.roll ? (t) => THREE.MathUtils.lerp(s.roll![0], s.roll![1], t) : undefined,
    };
    this.game.cam.play(shot);
  }

  update(rawDt: number): void {
    const r = this.run;
    if (!r) return;
    const g = this.game;
    if (g.input.hit('jump') || g.input.hit('pause') || (settings.value.skipCutscenes && this.shotT > 0.2)) { this.skip(); return; }
    const s = r.def.shots[this.shotIndex];
    if (!s) return;
    this.shotT += rawDt;
    for (const e of s.events ?? []) {
      const key = `${this.shotIndex}:${e.at}:${e.kind}`;
      if (this.shotT >= e.at && !this.fired.has(key)) {
        this.fired.add(key);
        this.fire(e);
      }
    }
    if (this.shotT >= s.duration) this.nextShot();
  }

  private fire(e: CutEvent): void {
    const g = this.game, r = this.run!;
    switch (e.kind) {
      case 'gesture': r.onGesture(); break;
      case 'title': cutsceneUi.title.value = { ...r.def.title, color: r.def.color, id: ++this.titleN }; break;
      case 'impactFrame': g.renderer.impactFrame(e.frames ?? 2, new THREE.Color(r.def.color)); break;
      case 'resolveHit': if (!this.resolved) { this.resolved = true; r.onResolve(); } break;
      case 'vfx': r.onVfx(e.id); break;
      case 'sfx': g.audio.play(e.id, e.volume ?? 0.6, e.pitch ?? 1); break;
      case 'slow': g.clock.slowMo = e.scale; break;
      case 'shake': g.cam.shake(e.amount); break;
    }
  }

  private end(): void {
    const g = this.game, r = this.run!;
    this.run = null;
    g.cam.skipRequested = true;
    g.cam.mode = this.prevMode;
    g.clock.slowMo = 1;
    cutsceneUi.active.value = false;
    cutsceneUi.title.value = null;
    if (this.resumeState && appState.value.kind === 'cinematic') setState(this.resumeState);
    r.onEnd?.();
  }
}
