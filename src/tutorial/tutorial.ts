import * as THREE from 'three';
import { signal } from '@preact/signals';
import type { Game } from '../app/game';
import { appState, setState, type TutorialStepId } from '../app/state';
import { toast, banner } from '../app/game';
import { techUi } from '../techniques/techniques';
import { keyLabel, keyPhrase, keysLabel } from '../app/keymap';
import { KEY_SLOTS } from '../pacts/slots';
import { STAND } from '../drills/fieldReading';
import type { PropInstance } from '../world/props';
import { Beacon } from './beacon';

// The Academy teaches by doing, one thing at a time (issue #13). Each step
// asks for one action, says so in one line, and marks the spot it happens at
// with a beacon. A step ends when the player has done the thing, never on a
// timer, and the skip key passes any step.

// Where the first walk ends: open paving north-east of the spawn.
export const MOVE_SPOT = new THREE.Vector3(1.5, 0, 2.5);
const ARRIVE = 1.6;

interface Step {
  id: TutorialStepId;
  title: string;
  jp: string;
  // One short line. It is read every time the card renders, so a key rebound mid-step updates it.
  line(g: Game, ev: ReadonlySet<string>): string;
  // The beacon's spot, if the step happens somewhere in particular.
  at?: THREE.Vector3;
  done(g: Game, ev: ReadonlySet<string>): boolean;
  enter?(g: Game): void;
  tick?(g: Game, dt: number, t: Tutorial): void;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const slot = (s: 'primary' | 'secondary') => techUi.slots.value[s];
// The first key whose Pact holds a Wager.
const wagerSlot = () => KEY_SLOTS.find((k) => !!techUi.slots.value[k].wager) ?? null;
// The Technique stores what it absorbs instead of spending what it holds (Recoil).
const stores = (g: Game) => !g.techniques.def.resource.startsFull;

const STEPS: Step[] = [
  {
    id: 'move', title: 'Move', jp: '歩', at: MOVE_SPOT,
    line: () => `${keysLabel(['forward', 'left', 'back', 'right'])} to walk to the gold ring. ${keyLabel('sprint')} sprints.`,
    done: (g) => g.player.position.distanceTo(MOVE_SPOT) < ARRIVE,
  },
  {
    id: 'camera', title: 'View', jp: '視点',
    line: () => `${keyLabel('camera')} changes the view. Keep the one you like.`,
    done: (_g, ev) => ev.has('camera'),
  },
  {
    id: 'primary', title: 'Your Technique', jp: '技',
    line: () => `${cap(keyLabel('primary'))} fires ${slot('primary').name} where you aim.`,
    done: (_g, ev) => ev.has('primary'),
  },
  {
    id: 'reserve', title: 'Reserve', jp: '蓄',
    line: (g) => stores(g)
      ? `Hold ${keyPhrase('secondary')} as the crate falls. ${slot('secondary').name} stores the blow in your ${g.techniques.def.resource.name}.`
      : `${cap(keyLabel('secondary'))} fires ${slot('secondary').name}. It spends your ${g.techniques.def.resource.name}, the bar under your health.`,
    done: (g, ev) => (stores(g) ? ev.has('absorbed') : ev.has('secondary')),
    // Holding the brace drains a little, so a fresh student starts with enough to hold through one fall.
    enter: (g) => { if (stores(g)) g.techniques.resource = Math.max(g.techniques.resource, 0.5 * g.techniques.def.resource.max); },
    tick: (g, dt, t) => { if (stores(g)) t.dropCrates(dt); },
  },
  {
    id: 'sign', title: 'Hand sign', jp: '印',
    line: () => `${keyLabel('fullsign')} performs the full hand sign. Strike while your hands hold it: it lands harder.`,
    done: (_g, ev) => ev.has('signed'),
  },
  {
    id: 'aura', title: 'Aura', jp: '気',
    line: () => `${keyLabel('aura')} opens your aura. Inside it you are quicker and others are slower.`,
    done: (_g, ev) => ev.has('aura'),
  },
  {
    id: 'clash', title: 'Aura Clash', jp: '気読み', at: new THREE.Vector3(...STAND),
    line: (_g, ev) => ev.has('drill-failed')
      ? `Close. ${keyLabel('interact')} at the stone to go again.`
      : `Two auras that touch will clash. Learn to read one: ${keyLabel('interact')} at the listening stone.`,
    done: (_g, ev) => ev.has('drill-passed'),
  },
  {
    id: 'pact', title: 'Write a Pact', jp: '契約',
    line: () => `Give something up and your Technique pays you back. ${keyLabel('workshop')} to write a Pact, then test it.`,
    done: (_g, ev) => ev.has('tried') || ev.has('inscribed'),
  },
  {
    id: 'wager', title: 'Wager', jp: '賭',
    // A Wager lives inside a Pact: the step fires the key whose Pact holds one (Shockline, for Recoil).
    line: (_g, ev) => {
      const s = wagerSlot();
      if (!s) return 'A Wager is written into a Pact. None of yours holds one yet; the Workshop can add it.';
      const l = techUi.slots.value[s];
      if (ev.has('wager-lost')) return `Called wrong, and the forfeit landed. ${cap(keyLabel(s))} again once it clears.`;
      return `${cap(keyLabel(s))} fires ${l.name}, whose Pact bets that ${l.wager}. Make it true.`;
    },
    // A right call ends it; so does a second wrong one, since both ends of the bet have then been felt.
    done: (_g, ev) => ev.has('wager-won') || ev.has('wager-lost-again') || !wagerSlot(),
  },
  {
    id: 'max', title: 'Maximum Output', jp: '全力',
    line: () => `The ring is full. ${keyLabel('max')} unleashes everything at once.`,
    done: (_g, ev) => ev.has('max'),
    enter: (g) => { g.techniques.charge = 1; },
  },
  {
    id: 'done', title: 'Go', jp: '行',
    line: () => 'The compound is yours. Drills, dummies and sparring partners wait in the yard.',
    done: () => false,
  },
];

export interface TutorialCard { id: TutorialStepId; index: number; total: number; title: string; jp: string; body: () => string }
export const tutorialUi = { step: signal<TutorialCard | null>(null) };

// How long the last card stays before the compound is the player's.
const DONE_FOR = 7;
// In the Reserve step a crate falls this long after the last one, from this
// high over the aim, and is cleared away this long after it fell.
const DROP_EVERY = 1.4;
const CRATE_LIFE = 5;
const DROP_HEIGHT = 6.5;

export class Tutorial {
  private index = -1;
  private events = new Set<string>();
  private settleT = 0;
  private doneT = 0;
  private lastSign = 'idle';
  private beacon: Beacon | null = null;
  private crates: { p: PropInstance; t: number }[] = [];
  private dropT = 0;

  constructor(private game: Game) {}

  get stepId(): TutorialStepId { return STEPS[Math.max(0, this.index)]?.id ?? 'done'; }
  get active(): boolean { return appState.value.kind === 'tutorial'; }

  start(): void {
    this.index = -1;
    this.advance();
    banner('入門', 'The Academy. Begin.');
  }

  skip(): void {
    this.leave();
    this.index = STEPS.length - 1;
    tutorialUi.step.value = null;
    if (appState.value.kind === 'tutorial') setState({ kind: 'explore' });
    this.game.techniques.charge = Math.max(this.game.techniques.charge, 0.5);
  }

  // The skip key: past this one step, not the whole tutorial.
  skipStep(): void {
    if (!this.active || this.stepId === 'done') return;
    toast(`${STEPS[this.index]!.title}: skipped`);
    this.advance();
  }

  jump(step: TutorialStepId): void {
    const i = STEPS.findIndex((s) => s.id === step);
    if (i < 0) return;
    this.index = i - 1;
    this.advance();
  }

  notify(ev: string): void {
    if (ev === 'wager-lost' && this.events.has(ev)) this.events.add('wager-lost-again');
    this.events.add(ev);
  }

  private advance(): void {
    this.leave();
    this.index++;
    const s = STEPS[this.index];
    if (!s) { this.skip(); return; }
    this.events.clear();
    this.settleT = 0.6;
    const ev = this.events;
    tutorialUi.step.value = { id: s.id, index: this.index + 1, total: STEPS.length - 1, title: s.title, jp: s.jp, body: () => s.line(this.game, ev) };
    setState({ kind: 'tutorial', step: s.id });
    this.beacon ??= new Beacon(this.game.renderer.scene);
    this.beacon.show(s.at ?? null);
    s.enter?.(this.game);
    if (s.id === 'done') this.doneT = DONE_FOR;
    this.game.audio.play('ui.step');
  }

  // What a step put in the world goes when the step ends. A crate the
  // player still holds stays theirs until they let it go.
  private leave(): void {
    this.beacon?.show(null);
    for (const c of this.crates) c.t = Math.max(c.t, CRATE_LIFE - 2);
    this.dropT = 1.5;
  }

  // Clears the crates that have had their turn. One held by Absorption is
  // kinematic and still in the kit's hands, so it waits until released.
  private sweep(dt: number): void {
    const g = this.game;
    for (const c of this.crates) c.t += dt;
    const gone = this.crates.filter((c) => !c.p.alive || (c.t > CRATE_LIFE && !c.p.body.isKinematic()));
    for (const c of gone) g.props.remove(c.p);
    if (gone.length) this.crates = this.crates.filter((c) => !gone.includes(c));
  }

  // The Reserve step's crates: one at a time, over where the player aims, so
  // the catch is about timing and facing and never about walking to a spot.
  dropCrates(dt: number): void {
    const g = this.game;
    const falling = this.crates.some((c) => c.t < CRATE_LIFE - 2 && c.p.body.translation().y > c.p.half.y + 0.3);
    if (falling || (this.dropT -= dt) > 0) return;
    const dir = g.cam.aimDirection().setY(0);
    if (dir.lengthSq() < 1e-4) dir.set(0, 0, -1);
    const at = g.player.position.clone().addScaledVector(dir.normalize(), 2.4).setY(g.player.position.y + DROP_HEIGHT);
    const p = g.props.spawn('crate', at);
    p.body.setLinvel({ x: 0, y: -1.5, z: 0 }, true);
    g.audio.play('prop.drop', { at });
    this.crates.push({ p, t: 0 });
    this.dropT = DROP_EVERY;
    // From above, a falling crate is a speck: the beacon marks where it will land.
    this.beacon?.show(at.clone().setY(g.player.position.y));
  }

  update(dt: number): void {
    if (this.beacon) { this.beacon.hidden = !this.active; this.beacon.update(dt); }
    this.sweep(dt);
    if (!this.active) return;
    const s = STEPS[this.index];
    if (!s) return;
    const g = this.game;
    if (g.input.hit('skip')) { this.skipStep(); return; }
    if (s.id === 'done') {
      if ((this.doneT -= dt) <= 0) { setState({ kind: 'explore' }); tutorialUi.step.value = null; }
      return;
    }
    // A cast that spends a prime is a signed strike.
    const sign = g.techniques.sign.kind;
    if (this.lastSign === 'primed' && sign === 'idle' && g.techniques.casting) this.events.add('signed');
    this.lastSign = sign;
    s.tick?.(g, dt, this);
    this.settleT -= dt;
    if (this.settleT <= 0 && s.done(g, this.events)) {
      toast(`${s.title}: done`, 'good');
      this.advance();
    }
  }
}
