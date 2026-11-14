import { signal, effect } from '@preact/signals';
import type { CameraMode } from '../player/camera';

export type Quality = 'low' | 'medium' | 'high';
export type { CameraMode };

export interface Settings {
  sensitivity: number;
  fov: number;
  quality: Quality;
  volume: number;
  music: number;
  camera: CameraMode;
  invertY: boolean;
  showMastery: boolean;
  skipCutscenes: boolean;
}

// v3: the camera gained the top-down view and it became the default.
const KEY = 'zenko.settings.v3';
const defaults: Settings = { sensitivity: 1, fov: 80, quality: 'high', volume: 0.8, music: 0.6, camera: 'top', invertY: false, showMastery: true, skipCutscenes: false };

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults;
    return { ...defaults, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch { return defaults; }
}

export const settings = signal<Settings>(load());

effect(() => {
  try { localStorage.setItem(KEY, JSON.stringify(settings.value)); } catch { /* storage may be unavailable */ }
});

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  settings.value = { ...settings.value, [key]: value };
}
