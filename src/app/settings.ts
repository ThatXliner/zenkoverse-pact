import { signal, effect } from '@preact/signals';
import type { CameraMode } from '../player/camera';

export type Quality = 'low' | 'medium' | 'high';
export type { CameraMode };

export interface Settings {
  sensitivity: number;
  fov: number;
  quality: Quality;
  // Master, the score, and everything else (the world, its ambience, the interface).
  volume: number;
  music: number;
  effects: number;
  // The bed under it all: wind, leaves, water, the room.
  ambience: number;
  camera: CameraMode;
  invertY: boolean;
  // The small key reminder that fades in when you stand idle.
  keyHints: boolean;
  // Maximum Output cutscenes: always in full, in full the first time and
  // shortened after, or never (the sign and the blow play from your own view).
  cutscenes: CutscenePlay;
}
export type CutscenePlay = 'always' | 'first' | 'never';

// v3: the camera gained the top-down view and it became the default.
const KEY = 'zenko.settings.v3';
const defaults: Settings = { sensitivity: 1, fov: 80, quality: 'high', volume: 0.8, music: 0.6, effects: 0.9, ambience: 1, camera: 'top', invertY: false, keyHints: true, cutscenes: 'always' };

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults;
    const saved = JSON.parse(raw) as Partial<Settings> & { skipCutscenes?: boolean };
    // The old on/off skip toggle becomes "never".
    if (saved.skipCutscenes && !saved.cutscenes) saved.cutscenes = 'never';
    delete saved.skipCutscenes;
    // The old "mastery numbers" toggle hid the same reminders; the numbers now live in the pause menu.
    const old = saved as { showMastery?: boolean };
    if (old.showMastery === false && saved.keyHints === undefined) saved.keyHints = false;
    delete old.showMastery;
    return { ...defaults, ...saved };
  } catch { return defaults; }
}

export const settings = signal<Settings>(load());

effect(() => {
  try { localStorage.setItem(KEY, JSON.stringify(settings.value)); } catch { /* storage may be unavailable */ }
});

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  settings.value = { ...settings.value, [key]: value };
}
