import type * as THREE from 'three';
import type { Pact, AbilitySlot, Param, TechniqueId } from '../pacts/schema';
import type { PropTrait, PropInstance } from '../world/props';
import type { GestureSet } from '../hands/gestures';
import type { CutsceneDef } from '../cutscene/cutscene';
import type { DrillDef } from '../drills/drills';
import type { Game } from '../app/game';
import type { Enemy } from '../combat/enemies';
import type { GestureVariant } from '../mastery/mastery';

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
  resource: { name: string; max: number; regen: number; startsFull: boolean };
  primitive: { name: string; description: string };
  parameters: Param[];
  shapes: Record<string, { label: string; slot: AbilitySlot[]; description: string }>;
  behaviors: Record<string, string>;
  catalogue: Pact[];
  gestures: Record<string, GestureSet>;
  avatarClips: Record<AbilitySlot, string>;
  traits: Partial<Record<PropTrait, (prop: PropInstance, ctx: AbilityContext) => void>>;
  drill?: DrillDef;
  cutscene: CutsceneDef;
  effects: {
    cast(ctx: AbilityContext): CastResult | void;
    hold?(ctx: AbilityContext, dt: number): void;
    release?(ctx: AbilityContext): void;
    passive?(game: Game, dt: number): void;
    onStruck?(game: Game, amount: number, from: THREE.Vector3): number;
  };
  audio: Record<AbilitySlot, { cast: string; pitch?: number; volume?: number }>;
}

export interface AbilityContext {
  game: Game;
  pact: Pact | null;
  slot: AbilitySlot;
  shape: string;
  behaviors: string[];
  potency: number;
  variant: GestureVariant;
  fullSign: boolean;
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
