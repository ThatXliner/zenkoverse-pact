import { signal, computed } from '@preact/signals';

export type TutorialStepId = 'move' | 'look' | 'camera' | 'primary' | 'secondary' | 'pact' | 'wager' | 'max' | 'done';
export type EncounterId = 'alley-thugs' | 'kuroda' | 'ancient-bridge' | 'dummy-room';
export type DrillId = 'recoil-crane';

export type AppState =
  | { kind: 'boot'; progress: number; label: string }
  | { kind: 'title' }
  | { kind: 'tutorial'; step: TutorialStepId }
  | { kind: 'explore' }
  | { kind: 'workshop' }
  | { kind: 'drill'; id: DrillId }
  | { kind: 'encounter'; id: EncounterId }
  | { kind: 'cinematic'; resume: AppState }
  | { kind: 'paused'; resume: AppState; tab: 'menu' | 'settings' | 'codex' | 'map' }
  | { kind: 'defeat' };

export const appState = signal<AppState>({ kind: 'boot', progress: 0, label: 'Preparing' });

export const worldRuns = computed(() => {
  const k = appState.value.kind;
  return k === 'tutorial' || k === 'explore' || k === 'encounter' || k === 'drill' || k === 'cinematic';
});

export const uiBlocksInput = computed(() => {
  const k = appState.value.kind;
  return k === 'boot' || k === 'title' || k === 'workshop' || k === 'paused' || k === 'defeat';
});

export function setState(next: AppState): void {
  appState.value = next;
}

export function pause(tab: 'menu' | 'settings' | 'codex' | 'map' = 'menu'): void {
  const cur = appState.value;
  if (cur.kind === 'paused') { appState.value = { ...cur, tab }; return; }
  if (!worldRuns.value) return;
  appState.value = { kind: 'paused', resume: cur, tab };
}

export function resume(): void {
  const cur = appState.value;
  if (cur.kind === 'paused' || cur.kind === 'cinematic') appState.value = cur.resume;
}
