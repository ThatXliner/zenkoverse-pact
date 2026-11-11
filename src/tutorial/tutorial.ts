import * as THREE from 'three';
import { signal } from '@preact/signals';
import type { Game } from '../app/game';
import { appState, setState, type TutorialStepId } from '../app/state';
import { toast, banner } from '../app/game';

export interface TutorialStep { id: TutorialStepId; title: string; jp: string; body: string; objective(g: Game, ev: Set<string>): boolean }

const STEPS: TutorialStep[] = [
  { id: 'move', title: 'Move', jp: '歩', body: 'WASD to walk, Shift to sprint, Space to jump, C to dash. Walk across the courtyard.', objective: (g) => g.player.position.distanceTo(new THREE.Vector3(-58, 0, -52)) > 6 },
  { id: 'look', title: 'Look', jp: '視', body: 'Look around. The crane to your west is the Academy drill rig.', objective: (_g, ev) => ev.has('looked') },
  { id: 'camera', title: 'Camera', jp: '視点', body: 'Press V to step outside yourself. Third person shows the whole sign.', objective: (_g, ev) => ev.has('camera') },
  { id: 'primary', title: 'Primary', jp: '技', body: 'Left click. Your Technique is raw: one imprecise primitive and the baseline Pact. The sign is long because you are new.', objective: (_g, ev) => ev.has('primary') },
  { id: 'secondary', title: 'Secondary', jp: '構', body: 'Right click. Hold it where it holds. Try it on the crates by the crane.', objective: (_g, ev) => ev.has('secondary') },
  { id: 'pact', title: 'Pact', jp: '契約', body: 'Press Tab to open the Pact Workshop. Inscribe one of the catalogue Pacts, or write your own. Read the terms before you confirm.', objective: (g) => g.book.inscribed.value.length > 0 },
  { id: 'wager', title: 'Wager', jp: '賭', body: 'Press R to declare that your next strike connects. Then make it connect.', objective: (_g, ev) => ev.has('wager') },
  { id: 'max', title: 'Maximum Output', jp: '全力', body: 'The ring fills as you fight. When it is full, press Q. The world will wait for you.', objective: (_g, ev) => ev.has('max') },
  { id: 'done', title: 'Go', jp: '行', body: 'The district is yours. The dojo east of here holds the Workshop and a dummy room. Thugs wait in the alleys south of the market.', objective: () => false },
];

export const tutorialUi = { step: signal<{ index: number; total: number; title: string; jp: string; body: string } | null>(null) };

export class Tutorial {
  private index = -1;
  private events = new Set<string>();
  private yawStart = 0;
  private settleT = 0;

  constructor(private game: Game) {}

  get stepId(): TutorialStepId { return STEPS[Math.max(0, this.index)]?.id ?? 'done'; }
  get active(): boolean { return appState.value.kind === 'tutorial'; }

  start(): void {
    this.index = -1;
    this.events.clear();
    this.yawStart = this.game.cam.yaw;
    this.advance();
    banner('入門', 'Academy courtyard. Begin.');
  }

  skip(): void {
    this.index = STEPS.length - 1;
    tutorialUi.step.value = null;
    if (appState.value.kind === 'tutorial') setState({ kind: 'explore' });
    this.game.techniques.charge = Math.max(this.game.techniques.charge, 0.5);
  }

  jump(step: TutorialStepId): void {
    const i = STEPS.findIndex((s) => s.id === step);
    if (i < 0) return;
    this.index = i - 1;
    this.advance();
    setState({ kind: 'tutorial', step });
  }

  notify(ev: string): void { this.events.add(ev); }

  private advance(): void {
    this.index++;
    const s = STEPS[this.index];
    if (!s) { this.skip(); return; }
    this.events.clear();
    this.settleT = 0.6;
    tutorialUi.step.value = { index: this.index + 1, total: STEPS.length - 1, title: s.title, jp: s.jp, body: s.body };
    setState({ kind: 'tutorial', step: s.id });
    if (s.id === 'max') this.game.techniques.charge = 1;
    if (s.id === 'done') { setTimeout(() => { if (appState.value.kind === 'tutorial') { setState({ kind: 'explore' }); tutorialUi.step.value = null; } }, 9000); }
    this.game.audio.play('select_003', 0.4);
  }

  update(dt: number): void {
    if (!this.active) return;
    const s = STEPS[this.index];
    if (!s) return;
    this.settleT -= dt;
    if (Math.abs(this.game.cam.yaw - this.yawStart) > 1.2) this.events.add('looked');
    if (this.settleT <= 0 && s.objective(this.game, this.events)) {
      toast(`${s.title}: done`, 'good');
      this.game.audio.play('confirmation_001', 0.5);
      this.advance();
    }
  }
}
