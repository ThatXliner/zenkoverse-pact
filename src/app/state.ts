import { signal, computed } from '@preact/signals';

export type TutorialStepId = 'move' | 'look' | 'camera' | 'primary' | 'secondary' | 'art' | 'pact' | 'wager' | 'max' | 'done';
export type PauseTab = 'menu' | 'settings' | 'controls' | 'codex' | 'map';
export type EncounterId = 'sparring' | 'kuroda' | 'ancient' | 'dummy-room';
export type DrillId = 'recoil-crane';

export type AppState =
  | { kind: 'boot'; progress: number; label: string }
  | { kind: 'title' }
  | { kind: 'tutorial'; step: TutorialStepId }
  | { kind: 'explore' }
  | { kind: 'workshop'; resume: AppState }
  | { kind: 'drill'; id: DrillId }
  | { kind: 'encounter'; id: EncounterId }
  | { kind: 'cinematic'; resume: AppState }
  | { kind: 'paused'; resume: AppState; tab: PauseTab }
  | { kind: 'defeat' }
  | { kind: 'rooftop' }
  | { kind: 'rooftop-offer' }
  | { kind: 'rooftop-end' };

export const appState = signal<AppState>({ kind: 'boot', progress: 0, label: 'Preparing' });

export const worldRuns = computed(() => {
  const k = appState.value.kind;
  return k === 'tutorial' || k === 'explore' || k === 'encounter' || k === 'drill' || k === 'cinematic' || k === 'rooftop';
});

export const uiBlocksInput = computed(() => {
  const k = appState.value.kind;
  return k === 'boot' || k === 'title' || k === 'workshop' || k === 'paused' || k === 'defeat' || k === 'rooftop-offer' || k === 'rooftop-end';
});

export function setState(next: AppState): void {
  appState.value = next;
}

export function pause(tab: PauseTab = 'menu'): void {
  const cur = appState.value;
  if (cur.kind === 'paused') { appState.value = { ...cur, tab }; return; }
  if (!worldRuns.value) return;
  appState.value = { kind: 'paused', resume: cur, tab };
}

export function resume(): void {
  const cur = appState.value;
  if (cur.kind === 'paused' || cur.kind === 'cinematic' || cur.kind === 'workshop') appState.value = cur.resume;
}

// The Workshop pauses the world and returns to the state it opened from, so
// a tutorial in progress is still in progress after the player closes it.
export function openWorkshop(): void {
  const cur = appState.value;
  if (cur.kind === 'workshop') return;
  appState.value = { kind: 'workshop', resume: cur.kind === 'paused' ? cur.resume : cur };
}
