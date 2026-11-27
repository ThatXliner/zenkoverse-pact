import type * as THREE from 'three';
import type { ReadonlySignal } from '@preact/signals';
import type { Pact, Param, TechniqueId } from '../pacts/schema';
import type { AbilityKind, AbilitySlot } from '../pacts/slots';
import type { PropTrait, PropInstance } from '../world/props';
import type { Gesture, GestureSet } from '../hands/gestures';
import type { CutsceneDef } from '../cutscene/cutscene';
import type { DrillDef } from '../drills/drills';
import type { Game } from '../app/game';
import type { Enemy } from '../combat/enemies';
import type { GestureVariant } from '../mastery/mastery';
import type { CueName } from '../audio/cues';

export { TECHNIQUE_IDS } from '../pacts/schema';
export type { TechniqueId };

// Every Technique is one module that exports a TechniqueKit. Adding a
// Technique is adding data plus one effect module; nothing else branches on
// the id. The checklist from the Technique issues maps onto these fields.
export interface TechniqueKit {
  id: TechniqueId;
  name: string;
  glyph: string;
  color: number;
  type: string;
  blurb: string;
  // The Technique's innate possibility space, 1 (narrow) to 5 (vast). A
  // broader Technique leaves less room for aura: it lowers the ceiling on
  // aura refinement (src/combat/field.ts, issue #4). It is not how strong
  // the Technique is.
  breadth: number;
  // The sound word lettered over its heavy hits, as a manga panel would.
  sfx: string;
  resource: { name: string; max: number; regen: number; startsFull: boolean; free?: AbilityKind[] };
  // A cost the Technique keeps in the body, shown under the resource while it
  // reads above nothing (Heat's body heat). 0 to 1; past 1 is too much.
  gauge?: { name: string; glyph: string; value: ReadonlySignal<number> };
  // `short` is the HUD's few words on what a key does, in sentence case.
  primitive: { name: string; short: string; description: string };
  parameters: Param[];
  shapes: Record<string, { label: string; short: string; kinds: AbilityKind[]; description: string }>;
  behaviors: Record<string, string>;
  catalogue: Pact[];
  // Keyed by kind; a shape may have its own, which it plays instead.
  gestures: Record<string, GestureSet>;
  // The signature full hand sign Alt performs: a committed sequence that
  // roots the player and primes the next cast. Its last key is the primed
  // stance the hands hold until that cast.
  sign: Gesture;
  traits: Partial<Record<PropTrait, (prop: PropInstance, ctx: AbilityContext) => void>>;
  drill?: DrillDef;
  cutscene: CutsceneDef;
  effects: {
    cast(ctx: AbilityContext): CastResult | void;
    hold?(ctx: AbilityContext, dt: number): void;
    release?(ctx: AbilityContext): void;
    passive?(game: Game, dt: number): void;
    onStruck?(game: Game, amount: number, from: THREE.Vector3): number;
    // Drops whatever the kit keeps between frames (props held, a stance, a
    // stare), for a new run or a new Technique. Effects in the world belong
    // to Vfx and end with it.
    reset?(game: Game): void;
  };
  // The cue under each kind's wind-up (src/audio/cues.ts), and under any
  // shape's that has one of its own.
  audio: Record<AbilityKind, CueName> & Partial<Record<string, CueName>>;
}

export interface AbilityContext {
  game: Game;
  pact: Pact | null;
  // Where the Ability sits and how it is cast.
  slot: AbilitySlot;
  kind: AbilityKind;
  shape: string;
  behaviors: string[];
  potency: number;
  variant: GestureVariant;
  origin: THREE.Vector3;
  dir: THREE.Vector3;
  aim: THREE.Vector3 | null;
  targets: Enemy[];
  wagered: boolean;
}

export interface CastResult {
  hits?: number;
  rooted?: number;
  moveLock?: number;
  cameraKick?: { fov: number; pitch?: number; roll?: number };
  hitStop?: number;
  impactFrame?: number;
}
