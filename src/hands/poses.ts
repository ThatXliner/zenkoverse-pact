// Hand poses are data. Position and rotation are in view space for the RIGHT
// hand (metres, radians, YXZ); the left hand mirrors x. Finger values are
// curls 0..1 per joint [knuckle, middle, tip]; spread fans the fingers.
// Rotation identity is fingers forward with the back of the hand up. Pitch
// lifts the fingers, yaw turns them inward when negative, and a negative
// roll turns the back of the right hand outward (a thumb-up fist).
export type Finger = 'thumb' | 'index' | 'middle' | 'ring' | 'pinky';
export const FINGERS: readonly Finger[] = ['thumb', 'index', 'middle', 'ring', 'pinky'];

export interface HandPose {
  pos: [number, number, number];
  rot: [number, number, number];
  fingers: Record<Finger, [number, number, number]>;
  spread: number;
}

const f = (t: [number, number, number], i: [number, number, number], m: [number, number, number], r: [number, number, number], p: [number, number, number]): HandPose['fingers'] => ({ thumb: t, index: i, middle: m, ring: r, pinky: p });
const relaxed = f([0.2, 0.3, 0.2], [0.25, 0.35, 0.25], [0.3, 0.4, 0.3], [0.35, 0.45, 0.35], [0.4, 0.5, 0.4]);
const open = f([0.05, 0.05, 0.05], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]);
const fist = f([0.6, 0.9, 0.7], [1, 1, 0.9], [1, 1, 0.9], [1, 1, 0.9], [1, 1, 0.9]);
const claw = f([0.3, 0.5, 0.4], [0.45, 0.75, 0.5], [0.5, 0.8, 0.5], [0.5, 0.8, 0.5], [0.55, 0.8, 0.5]);
const point2 = f([0.5, 0.7, 0.5], [0, 0, 0], [0, 0, 0], [1, 1, 0.9], [1, 1, 0.9]);
const snapReady = f([0.35, 0.3, 0.2], [0.3, 0.3, 0.2], [0.55, 0.7, 0.4], [0.9, 1, 0.9], [0.95, 1, 0.9]);
const snapped = f([0.1, 0.1, 0.1], [0.2, 0.2, 0.15], [0.95, 1, 0.9], [1, 1, 0.9], [1, 1, 0.9]);
const cup = f([0.3, 0.3, 0.2], [0.35, 0.3, 0.2], [0.35, 0.3, 0.2], [0.35, 0.3, 0.2], [0.4, 0.3, 0.2]);

export const POSES = {
  rest: { pos: [0.21, -0.24, -0.46], rot: [-0.2, -0.3, 0.3], fingers: relaxed, spread: 0.1 },
  restLow: { pos: [0.23, -0.29, -0.47], rot: [-0.3, -0.35, 0.35], fingers: relaxed, spread: 0.08 },
  sprint: { pos: [0.19, -0.22, -0.36], rot: [-0.1, -0.9, -0.6], fingers: fist, spread: 0 },
  bracePalm: { pos: [0.16, -0.12, -0.38], rot: [1.35, -0.1, 0.05], fingers: open, spread: 0.35 },
  braceWide: { pos: [0.26, -0.10, -0.40], rot: [1.3, -0.25, 0.1], fingers: open, spread: 0.4 },
  chamber: { pos: [0.26, -0.24, -0.26], rot: [-0.2, -0.3, 2.8], fingers: fist, spread: 0 },
  punch: { pos: [0.05, -0.08, -0.62], rot: [-0.15, -0.1, -1.55], fingers: fist, spread: 0 },
  punchOver: { pos: [0.02, -0.06, -0.66], rot: [-0.1, -0.05, -1.6], fingers: fist, spread: 0 },
  palmDown: { pos: [0.14, -0.30, -0.44], rot: [-0.15, 0, 0.2], fingers: open, spread: 0.3 },
  slamUp: { pos: [0.18, 0.02, -0.40], rot: [0.9, -0.1, 0.3], fingers: claw, spread: 0.35 },
  slamDown: { pos: [0.14, -0.42, -0.46], rot: [-1.1, 0, 0.1], fingers: open, spread: 0.45 },
  clawReady: { pos: [0.22, -0.18, -0.40], rot: [0.35, -0.5, 0.2], fingers: claw, spread: 0.4 },
  clawReach: { pos: [0.12, -0.10, -0.58], rot: [0.2, -0.2, 0.1], fingers: claw, spread: 0.45 },
  point: { pos: [0.15, -0.17, -0.48], rot: [-0.08, -0.4, 0.4], fingers: point2, spread: 0.05 },
  pointFar: { pos: [0.10, -0.13, -0.60], rot: [0.0, -0.35, 0.35], fingers: point2, spread: 0.05 },
  pointPull: { pos: [0.22, -0.22, -0.32], rot: [-0.3, -0.4, 0.3], fingers: point2, spread: 0.05 },
  cupEyes: { pos: [0.1, -0.01, -0.17], rot: [0.5, -0.1, -1.4], fingers: cup, spread: 0.1 },
  cupFlinch: { pos: [0.19, 0.0, -0.27], rot: [0.6, -0.4, -1.2], fingers: open, spread: 0.3 },
  shieldEyes: { pos: [0.07, 0.05, -0.16], rot: [1.3, -0.3, 3.0], fingers: open, spread: 0.2 },
  palmSurface: { pos: [0.12, -0.28, -0.50], rot: [-0.7, -0.1, 0.1], fingers: open, spread: 0.25 },
  palmPress: { pos: [0.10, -0.33, -0.54], rot: [-0.85, -0.05, 0.05], fingers: open, spread: 0.3 },
  snapReady: { pos: [0.20, -0.14, -0.38], rot: [0.5, -0.6, 0.4], fingers: snapReady, spread: 0.1 },
  snapped: { pos: [0.18, -0.16, -0.40], rot: [0.45, -0.55, 0.5], fingers: snapped, spread: 0.05 },
  quietSpread: { pos: [0.24, -0.16, -0.44], rot: [1.05, -0.4, 0.25], fingers: open, spread: 0.5 },
  guard: { pos: [0.19, -0.13, -0.40], rot: [-0.35, -0.65, -0.7], fingers: fist, spread: 0 },
  raiseHigh: { pos: [0.20, 0.16, -0.36], rot: [1.25, -0.4, 0.4], fingers: open, spread: 0.45 },
  crossChest: { pos: [-0.06, -0.14, -0.30], rot: [-0.5, -0.9, -0.9], fingers: fist, spread: 0 },
  flat: { pos: [0.18, -0.24, -0.46], rot: [-0.25, -0.3, 0.2], fingers: open, spread: 0.2 },
  landCatch: { pos: [0.22, -0.36, -0.42], rot: [-0.45, -0.3, 0.3], fingers: open, spread: 0.3 },
} satisfies Record<string, HandPose>;

export type PoseName = keyof typeof POSES;

export function mirror(p: HandPose): HandPose {
  return { pos: [-p.pos[0], p.pos[1], p.pos[2]], rot: [p.rot[0], -p.rot[1], -p.rot[2]], fingers: p.fingers, spread: p.spread };
}

export function lerpPose(a: HandPose, b: HandPose, t: number): HandPose {
  const l = (x: number, y: number) => x + (y - x) * t;
  const fingers = {} as HandPose['fingers'];
  for (const k of FINGERS) fingers[k] = [l(a.fingers[k][0], b.fingers[k][0]), l(a.fingers[k][1], b.fingers[k][1]), l(a.fingers[k][2], b.fingers[k][2])];
  return { pos: [l(a.pos[0], b.pos[0]), l(a.pos[1], b.pos[1]), l(a.pos[2], b.pos[2])], rot: [l(a.rot[0], b.rot[0]), l(a.rot[1], b.rot[1]), l(a.rot[2], b.rot[2])], fingers, spread: l(a.spread, b.spread) };
}
