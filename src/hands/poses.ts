// Hand poses are data. `pos` is the right wrist in camera metres (x right,
// y up, -z ahead) and `rot` the hand's orientation in camera space (radians,
// Euler YXZ); the left hand mirrors both. Finger values are curls 0..1 per
// joint [knuckle, middle, tip]; spread fans the fingers.
// Rotation identity is fingers straight ahead with the back of the hand up.
// Then, in this order: a positive yaw turns the fingers inward (toward the
// other hand), a positive pitch lifts them, and a negative roll turns the
// back of the right hand outward about its own length (-pi/2 is thumb up,
// -pi is palm up).
// The arm comes from a shoulder about (0.24, -0.31, -0.03) and reaches
// 0.47 (src/hands/hands.ts VIEW): a wrist much nearer than 0.3 to it folds
// the arm, and the forearm can no longer run in line with the hand.
export type Finger = 'thumb' | 'index' | 'middle' | 'ring' | 'pinky';
export const FINGERS: readonly Finger[] = ['thumb', 'index', 'middle', 'ring', 'pinky'];

export interface HandPose {
  pos: [number, number, number];
  rot: [number, number, number];
  fingers: Record<Finger, [number, number, number]>;
  spread: number;
}

const f = (t: [number, number, number], i: [number, number, number], m: [number, number, number], r: [number, number, number], p: [number, number, number]): HandPose['fingers'] => ({ thumb: t, index: i, middle: m, ring: r, pinky: p });
// A hand at rest curls more toward the little finger, so each finger stands
// a little apart from the next and the hand reads as fingers, not a mitten.
const relaxed = f([0.15, 0.1, 0.1], [0.1, 0.18, 0.12], [0.16, 0.24, 0.16], [0.24, 0.32, 0.2], [0.32, 0.4, 0.26]);
const open = f([0.05, 0.05, 0.05], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]);
const fist = f([0.6, 0.9, 0.7], [1, 1, 0.9], [1, 1, 0.9], [1, 1, 0.9], [1, 1, 0.9]);
const claw = f([0.3, 0.5, 0.4], [0.45, 0.75, 0.5], [0.5, 0.8, 0.5], [0.5, 0.8, 0.5], [0.55, 0.8, 0.5]);
// One finger out, the thumb laid over the curled middle finger.
const point1 = f([0.5, 0.7, 0.5], [0, 0, 0], [1, 1, 0.9], [1, 1, 0.9], [1, 1, 0.9]);
// The sword seal: index and middle out together.
const point2 = f([0.5, 0.7, 0.5], [0, 0, 0], [0, 0, 0], [1, 1, 0.9], [1, 1, 0.9]);
// Before a snap the middle fingertip rests on the thumb's pad; after it,
// the middle finger has struck the palm and the thumb stands free.
const snapReady = f([0.7, 0.3, 0.1], [0.3, 0.35, 0.2], [0.6, 0.7, 0.4], [0.9, 1, 0.9], [0.95, 1, 0.9]);
const snapped = f([0.15, 0.1, 0.05], [0.5, 0.55, 0.35], [1, 1, 0.9], [1, 1, 0.9], [1, 1, 0.9]);
const cup = f([0.3, 0.3, 0.2], [0.35, 0.3, 0.2], [0.35, 0.3, 0.2], [0.35, 0.3, 0.2], [0.4, 0.3, 0.2]);
// Fingers half closed over the palm, as if holding something hot.
const ember = f([0.35, 0.25, 0.15], [0.45, 0.5, 0.35], [0.45, 0.55, 0.35], [0.5, 0.55, 0.35], [0.55, 0.55, 0.35]);
// A grip opened to take a head: every finger bent at every joint, spread.
const grip = f([0.3, 0.35, 0.25], [0.3, 0.5, 0.35], [0.3, 0.52, 0.35], [0.32, 0.52, 0.35], [0.36, 0.52, 0.35]);
const sealed = f([0.15, 0.1, 0.05], [0.04, 0.06, 0.04], [0.02, 0.05, 0.04], [0.04, 0.06, 0.04], [0.08, 0.1, 0.06]);

export const POSES = {
  // Idle: low in the corners, thumb side up and turned in a little, the
  // wrist in line with the forearm rising out of the frame.
  rest: { pos: [0.24, -0.24, -0.36], rot: [0.3, 0.3, -1.0], fingers: relaxed, spread: 0.2 },
  restLow: { pos: [0.24, -0.26, -0.35], rot: [0.25, 0.3, -1.1], fingers: relaxed, spread: 0.2 },
  sprint: { pos: [0.23, -0.25, -0.35], rot: [0.35, 0.35, -1.35], fingers: fist, spread: 0 },
  bracePalm: { pos: [0.16, -0.17, -0.42], rot: [1.35, 0.1, -0.05], fingers: open, spread: 0.35 },
  braceWide: { pos: [0.27, -0.15, -0.41], rot: [1.3, 0.25, -0.1], fingers: open, spread: 0.4 },
  // A karate chamber: the fist drawn back to the ribs, palm up, mostly out
  // of the frame's lower edge.
  chamber: { pos: [0.26, -0.31, -0.28], rot: [0.3, 0.2, -2.8], fingers: fist, spread: 0 },
  punch: { pos: [0.09, -0.2, -0.45], rot: [0.15, 0.3, -0.8], fingers: fist, spread: 0 },
  punchOver: { pos: [0.07, -0.19, -0.48], rot: [0.12, 0.25, -0.75], fingers: fist, spread: 0 },
  palmDown: { pos: [0.16, -0.24, -0.42], rot: [0.1, 0.15, 0.1], fingers: open, spread: 0.3 },
  slamUp: { pos: [0.2, -0.05, -0.34], rot: [1.0, 0.15, -0.3], fingers: claw, spread: 0.35 },
  slamDown: { pos: [0.17, -0.27, -0.45], rot: [-0.6, 0.05, 0.1], fingers: open, spread: 0.45 },
  clawReady: { pos: [0.24, -0.21, -0.38], rot: [0.45, 0.4, -0.3], fingers: claw, spread: 0.4 },
  clawReach: { pos: [0.12, -0.17, -0.46], rot: [0.3, 0.2, -0.2], fingers: claw, spread: 0.45 },
  // Pointing turns the hand thumb up and the finger across the view, so the
  // finger shows its length instead of hiding behind the knuckles.
  point: { pos: [0.17, -0.21, -0.4], rot: [0.2, 0.45, -1.4], fingers: point1, spread: 0.05 },
  pointFar: { pos: [0.12, -0.19, -0.46], rot: [0.15, 0.3, -1.4], fingers: point1, spread: 0.05 },
  pointPull: { pos: [0.23, -0.27, -0.32], rot: [0.3, 0.5, -1.3], fingers: point1, spread: 0.05 },
  cupEyes: { pos: [0.11, -0.15, -0.3], rot: [0.5, 0.15, -1.4], fingers: cup, spread: 0.1 },
  cupFlinch: { pos: [0.28, -0.12, -0.36], rot: [0.7, -0.3, -1.0], fingers: open, spread: 0.35 },
  shieldEyes: { pos: [0.1, -0.1, -0.3], rot: [1.15, 0.3, 3.0], fingers: open, spread: 0.2 },
  palmSurface: { pos: [0.14, -0.21, -0.43], rot: [0.0, 0.15, 0.05], fingers: open, spread: 0.25 },
  palmPress: { pos: [0.12, -0.25, -0.45], rot: [-0.15, 0.1, 0.05], fingers: open, spread: 0.3 },
  // Snaps are seen side on, thumb up: the thumb and middle finger meet,
  // then the middle finger strikes the palm and the thumb springs free.
  snapReady: { pos: [0.2, -0.18, -0.37], rot: [0.5, 0.15, -1.7], fingers: snapReady, spread: 0.1 },
  snapped: { pos: [0.19, -0.19, -0.39], rot: [0.45, 0.15, -1.75], fingers: snapped, spread: 0.05 },
  quietSpread: { pos: [0.26, -0.17, -0.42], rot: [1.05, 0.4, -0.25], fingers: open, spread: 0.5 },
  guard: { pos: [0.17, -0.19, -0.37], rot: [0.55, 0.35, -1.2], fingers: fist, spread: 0 },
  raiseHigh: { pos: [0.24, -0.04, -0.36], rot: [1.1, 0.4, -0.2], fingers: open, spread: 0.45 },
  crossChest: { pos: [-0.04, -0.21, -0.34], rot: [0.2, 1.2, -1.2], fingers: fist, spread: 0 },
  flat: { pos: [0.2, -0.22, -0.42], rot: [0.1, 0.2, 0.15], fingers: open, spread: 0.2 },
  landCatch: { pos: [0.26, -0.27, -0.4], rot: [-0.15, 0.2, 0.3], fingers: open, spread: 0.3 },
  // The full hand sign. `sealGather` is the anticipation: both hands sink and
  // open, palms starting to turn toward each other. `seal` presses the palms
  // together at the sternum, fingers up and in frame. `kuji` is the same seal
  // with the index and middle fingers raised. `fistToPalm` drives the right
  // fist into the left palm, knuckles inward, thumb up. `veilEyes` raises the
  // palms before the eyes, far enough out to stay in view.
  sealGather: { pos: [0.15, -0.27, -0.4], rot: [0.55, 0.25, -0.85], fingers: open, spread: 0.25 },
  seal: { pos: [0.035, -0.24, -0.4], rot: [1.35, 0.04, -1.55], fingers: sealed, spread: 0.03 },
  kuji: { pos: [0.03, -0.22, -0.4], rot: [1.4, 0.04, -1.55], fingers: point2, spread: 0 },
  fistToPalm: { pos: [0.11, -0.17, -0.42], rot: [0.1, 1.35, -1.5], fingers: fist, spread: 0 },
  veilEyes: { pos: [0.085, -0.2, -0.36], rot: [1.0, 0.25, 3.0], fingers: cup, spread: 0.12 },
  // Heat. `emberCup` holds the heat drawn in: palm up below the chest, the
  // fingers closing over it. `seize` drives an open grip out at head height,
  // palm first, to put the heat into what it takes. `crossBlock` crosses the
  // open hands before the face to take a blow in. `kilnRaise` opens both
  // hands out and up to draw from all round; `twinPalm` drives both palm
  // heels out together, fingers turned out. The sign rubs the sealed palms
  // (`sealRubUp`, `sealRubDown`) as cold hands are warmed.
  emberCup: { pos: [0.15, -0.25, -0.37], rot: [0.35, 0.45, -2.9], fingers: ember, spread: 0.2 },
  seize: { pos: [0.1, -0.17, -0.47], rot: [1.3, 0.25, -0.35], fingers: grip, spread: 0.55 },
  crossBlock: { pos: [-0.02, -0.13, -0.36], rot: [1.25, 0.5, -0.25], fingers: open, spread: 0.4 },
  kilnRaise: { pos: [0.3, -0.16, -0.36], rot: [0.4, -0.2, -2.6], fingers: ember, spread: 0.4 },
  twinPalm: { pos: [0.055, -0.19, -0.47], rot: [1.35, -0.3, -0.55], fingers: open, spread: 0.35 },
  sealRubUp: { pos: [0.035, -0.215, -0.4], rot: [1.35, 0.04, -1.55], fingers: sealed, spread: 0.03 },
  sealRubDown: { pos: [0.035, -0.265, -0.4], rot: [1.35, 0.04, -1.55], fingers: sealed, spread: 0.03 },
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
