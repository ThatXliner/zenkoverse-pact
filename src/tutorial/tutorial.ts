import * as THREE from 'three';
import { signal } from '@preact/signals';
import type { Game } from '../app/game';
import { appState, setState, type TutorialStepId } from '../app/state';
import { toast, banner } from '../app/game';
import { techUi } from '../techniques/techniques';
import { keyLabel, keysLabel } from '../app/keymap';
import { EXTRA_SLOTS } from '../pacts/slots';
import { SPAWN } from '../world/compound';

export interface TutorialStep { id: TutorialStepId; title: string; jp: string; body: string | ((g: Game) => string); objective(g: Game, ev: Set<string>): boolean }

const STEPS: TutorialStep[] = [
  { id: 'move', title: 'Move', jp: '歩', body: () => `${keysLabel(['forward', 'left', 'back', 'right'])} to walk, ${keyLabel('sprint')} to sprint, ${keyLabel('jump')} to jump, ${keyLabel('dash')} to dash. Walk across the yard.`, objective: (g) => g.player.position.distanceTo(SPAWN.courtyard) > 6 },
  { id: 'look', title: 'Aim', jp: '視', body: (g) => g.cam.isTop ? 'Move the mouse. You face the cursor, and your Technique fires at it. The hoist in the north-west corner is the drill rig.' : 'Look around. The hoist in the north-west corner is the drill rig.', objective: (_g, ev) => ev.has('looked') },
  { id: 'camera', title: 'Camera', jp: '視点', body: () => `Press ${keyLabel('camera')} to change the view: top-down, over the shoulder, first person. Try one and come back to the one you like.`, objective: (_g, ev) => ev.has('camera') },
  { id: 'primary', title: 'Primary', jp: '技', body: () => { const s = techUi.slots.value.primary; return `${cap(keyLabel('primary'))} fires ${s.name}: ${s.what}. The sign is long because you are new.`; }, objective: (_g, ev) => ev.has('primary') },
  { id: 'secondary', title: 'Secondary', jp: '構', body: () => { const s = techUi.slots.value.secondary; return `${cap(keyLabel('secondary'))} fires ${s.name}: ${s.what}. Try it on the crates by the hoist.`; }, objective: (_g, ev) => ev.has('secondary') },
  { id: 'art', title: 'More Abilities', jp: '術', body: () => {
    const slots = techUi.slots.value;
    const first = EXTRA_SLOTS.find((s) => !slots[s].empty);
    const row = `The row above your cards holds more Abilities, on ${EXTRA_SLOTS.map(keyLabel).join(', ')}.`;
    return first ? `${row} ${cap(keyLabel(first))} fires ${slots[first].name}: ${slots[first].what}. Press it once.` : `${row} Yours are empty. The Workshop can put a Pact on any of them.`;
  }, objective: (_g, ev) => EXTRA_SLOTS.some((s) => ev.has(s)) || EXTRA_SLOTS.every((s) => techUi.slots.value[s].empty) },
  { id: 'pact', title: 'Your Pacts', jp: '契約', body: () => `Your Abilities are Pacts already written for you. Press ${keyLabel('workshop')} to open the Workshop and read them, then press ${keyLabel('pause')} to come back. Writing your own Pact is optional.`, objective: (_g, ev) => ev.has('workshop') },
  { id: 'wager', title: 'Wager', jp: '賭', body: () => `Press ${keyLabel('wager')} to declare that your next strike connects. Then make it connect.`, objective: (_g, ev) => ev.has('wager') },
  { id: 'max', title: 'Maximum Output', jp: '全力', body: () => `The ring fills as you fight. When it is full, press ${keyLabel('max')}. The world will wait for you.`, objective: (_g, ev) => ev.has('max') },
  { id: 'done', title: 'Go', jp: '行', body: 'The compound is yours. The hall to the north holds the Workshop and the dummies. Sparring partners wait in the ring, and the stair beside the hall climbs to the roof.', objective: () => false },
];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// `body` is read while the card renders, so a key rebound mid-tutorial updates it.
export const tutorialUi = { step: signal<{ id: TutorialStepId; index: number; total: number; title: string; jp: string; body: () => string } | null>(null) };

export class Tutorial {
  private index = -1;
  private events = new Set<string>();
  private yawStart = 0;
  private settleT = 0;
  // The last card stays up this long, then the compound is the player's.
  private doneT = 0;

  constructor(private game: Game) {}

  get stepId(): TutorialStepId { return STEPS[Math.max(0, this.index)]?.id ?? 'done'; }
  get active(): boolean { return appState.value.kind === 'tutorial'; }

  start(): void {
    this.index = -1;
    this.events.clear();
    this.yawStart = this.game.cam.yaw;
    this.advance();
    banner('入門', 'The compound. Begin.');
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
    tutorialUi.step.value = { id: s.id, index: this.index + 1, total: STEPS.length - 1, title: s.title, jp: s.jp, body: () => (typeof s.body === 'string' ? s.body : s.body(this.game)) };
    setState({ kind: 'tutorial', step: s.id });
    if (s.id === 'max') this.game.techniques.charge = 1;
    if (s.id === 'done') this.doneT = 9;
    this.game.audio.play('select_003', 0.4);
  }

  update(dt: number): void {
    if (!this.active) return;
    const s = STEPS[this.index];
    if (!s) return;
    this.settleT -= dt;
    if (s.id === 'done') {
      if ((this.doneT -= dt) <= 0) { setState({ kind: 'explore' }); tutorialUi.step.value = null; }
      return;
    }
    const turned = Math.atan2(Math.sin(this.game.cam.yaw - this.yawStart), Math.cos(this.game.cam.yaw - this.yawStart));
    if (Math.abs(turned) > 1.2) this.events.add('looked');
    if (this.settleT <= 0 && s.objective(this.game, this.events)) {
      toast(`${s.title}: done`, 'good');
      this.game.audio.play('confirmation_001', 0.5);
      this.advance();
    }
  }
}
