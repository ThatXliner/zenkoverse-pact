import { POSES, type PoseName, type HandPose } from './poses';
import type { GestureVariant } from '../mastery/mastery';

// A gesture is a timeline of keys. Each key names a pose per hand and the
// spring the hands use to reach it: `snap` keys are stiff and underdamped,
// which gives the anticipation-then-overshoot read of key animation instead
// of a tween. `camera` kicks fire when the key is reached.
export interface GestureKey {
  t: number;
  left?: PoseName | HandPose;
  right?: PoseName | HandPose;
  snap?: boolean;
  slow?: boolean;
  camera?: { fov: number; pitch?: number; roll?: number };
  event?: string;
}

export interface Gesture {
  duration: number;
  keys: GestureKey[];
  impactAt: number;
  hold?: boolean;
}

export interface GestureSet { long: Gesture; short: Gesture; none: Gesture }

export function resolvePose(p: PoseName | HandPose | undefined, fallback: HandPose): HandPose {
  if (!p) return fallback;
  return typeof p === 'string' ? POSES[p] : p;
}

// Shortens a long gesture by compressing time and dropping anticipation keys,
// so trained activation reads as the same sign done faster and smaller.
export function shorten(long: Gesture, factor = 0.5): Gesture {
  const keys = long.keys.filter((k, i) => i === 0 || i >= long.keys.length - 2 || !k.slow).map((k) => ({ ...k, t: k.t * factor }));
  return { duration: long.duration * factor, keys, impactAt: long.impactAt * factor, hold: long.hold };
}

export function flick(long: Gesture): Gesture {
  const last = long.keys[long.keys.length - 1];
  const impactKey = long.keys.reduce((best, k) => (Math.abs(k.t - long.impactAt) < Math.abs(best.t - long.impactAt) ? k : best), long.keys[0]!);
  return { duration: 0.22, impactAt: 0.06, hold: long.hold, keys: [{ t: 0, left: impactKey.left, right: impactKey.right, snap: true, camera: impactKey.camera, event: impactKey.event }, { t: 0.16, left: last?.left, right: last?.right }] };
}

export function variants(long: Gesture): GestureSet {
  return { long, short: shorten(long), none: flick(long) };
}

export function pick(set: GestureSet, v: GestureVariant): Gesture { return set[v]; }
