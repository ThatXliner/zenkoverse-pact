import { signal } from '@preact/signals';
import type { TechniqueId } from '../techniques/kit';
import type { EyeId } from './registry';

export const eyeUi = {
  id: signal<EyeId | null>(null),
  // The Vault's Technique and how much of its cooldown is left (0..1).
  vault: signal<{ tech: TechniqueId; cd: number } | null>(null),
  // The installation, while it plays: `n` tells one from the next.
  installing: signal<{ id: EyeId; n: number } | null>(null),
};
