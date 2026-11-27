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
// A spear hand: four fingers straight and pressed together, the thumb tucked along them.
const spear = f([0.45, 0.25, 0.1], [0, 0, 0], [0, 0.02, 0], [0.02, 0.04, 0], [0.05, 0.08, 0.02]);
// Fingers splayed and stiff, as a current locks them.
const splay = f([0.05, 0, 0], [0.12, 0.05, 0], [0.1, 0.05, 0], [0.12, 0.06, 0], [0.15, 0.08, 0]);
// Fingertips meeting fingertips, the palms apart.
const tented = f([0.15, 0.15, 0.1], [0.12, 0.15, 0.1], [0.12, 0.15, 0.1], [0.15, 0.18, 0.1], [0.18, 0.2, 0.12]);
const sealed = f([0.15, 0.1, 0.05], [0.04, 0.06, 0.04], [0.02, 0.05, 0.04], [0.04, 0.06, 0.04], [0.08, 0.1, 0.06]);
// A thread held between the thumb and the side of the index, the other
// fingers tucked; and the hand thrown open after it, the index leading.
const pinch = f([0.5, 0.45, 0.35], [0.5, 0.6, 0.4], [0.85, 0.95, 0.8], [0.9, 1, 0.85], [0.95, 1, 0.85]);
const fling = f([0.08, 0.05, 0.05], [0, 0, 0], [0.12, 0.08, 0.05], [0.22, 0.16, 0.1], [0.32, 0.26, 0.14]);
// String figures: every finger out and apart, a little hooked at the tips.
const cradle = f([0.05, 0.05, 0.12], [0.02, 0.06, 0.18], [0.02, 0.06, 0.18], [0.04, 0.08, 0.2], [0.06, 0.1, 0.22]);
// A hand closed on cloth: the fingers wrap a collar, the thumb locks over them.
const clutch = f([0.55, 0.6, 0.45], [0.7, 0.85, 0.6], [0.72, 0.88, 0.62], [0.74, 0.9, 0.62], [0.78, 0.9, 0.6]);
// Fingers pressed out flat and wide, as on a wall: the whole palm and every pad in contact.
// Every fingertip drawn in to meet the thumb's, as if pinching a pinch of salt.
const bunch = f([0.45, 0.4, 0.3], [0.55, 0.55, 0.4], [0.55, 0.6, 0.4], [0.6, 0.6, 0.4], [0.62, 0.6, 0.4]);
const flatSplay = f([0.0, -0.05, -0.05], [-0.05, 0, 0], [-0.05, 0, 0], [-0.05, 0, 0], [-0.05, 0, 0]);
// Thumb and index out at a right angle, the rest curled: one corner of a frame.
const corner = f([0, 0, 0], [0, 0, 0], [1, 1, 0.9], [1, 1, 0.9], [1, 1, 0.95]);
// A lighter held in the fist, the thumb up on its wheel; and the thumb rolled down over it.
const lighterGrip = f([0.05, 0.1, 0.05], [0.8, 0.95, 0.7], [0.85, 1, 0.8], [0.9, 1, 0.8], [0.95, 1, 0.8]);
const lighterRolled = f([0.55, 0.6, 0.4], [0.8, 0.95, 0.7], [0.85, 1, 0.8], [0.9, 1, 0.8], [0.95, 1, 0.8]);

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
  // A hook: drawn back wide of the shoulder, then swept across the line of
  // sight with the knuckles leading and the palm turned down.
  hookDraw: { pos: [0.3, -0.22, -0.3], rot: [0.35, -0.2, -1.3], fingers: fist, spread: 0 },
  hook: { pos: [0.02, -0.18, -0.42], rot: [0.2, 1.05, -0.35], fingers: fist, spread: 0 },
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
  // Tension. `threadPinch` holds the end of a line at the chest, `threadWind`
  // draws it back past the shoulder, and `threadCast` throws it, the arm out
  // and the hand flung open. Drawing a line is an archer's draw: `drawFront`
  // is the far hand out along it, `drawBack` the near hand pulled to the
  // shoulder, and `drawRelease` that hand thrown open behind. `slackDrop`
  // lets a line go, the wrist falling limp. `cradle` and `cradleWide` are a
  // string figure held between the hands at the sternum and spread wide;
  // `drawYank` hauls both fists in to the hips.
  threadPinch: { pos: [0.2, -0.2, -0.37], rot: [0.45, 0.35, -1.3], fingers: pinch, spread: 0.05 },
  threadWind: { pos: [0.28, -0.17, -0.3], rot: [0.7, 0.15, -1.55], fingers: pinch, spread: 0.05 },
  threadCast: { pos: [0.1, -0.17, -0.47], rot: [0.2, 0.2, -0.85], fingers: fling, spread: 0.35 },
  drawFront: { pos: [0.12, -0.18, -0.46], rot: [0.25, 0.3, -1.45], fingers: pinch, spread: 0.05 },
  drawBack: { pos: [0.3, -0.18, -0.26], rot: [0.55, -0.1, -1.6], fingers: pinch, spread: 0.05 },
  drawRelease: { pos: [0.33, -0.13, -0.24], rot: [0.9, -0.3, -1.1], fingers: fling, spread: 0.55 },
  slackDrop: { pos: [0.22, -0.3, -0.42], rot: [-0.55, 0.25, -0.45], fingers: relaxed, spread: 0.35 },
  cradle: { pos: [0.11, -0.21, -0.4], rot: [1.25, -0.04, -1.5], fingers: cradle, spread: 0.6 },
  cradleWide: { pos: [0.24, -0.19, -0.42], rot: [1.15, 0.3, -1.35], fingers: cradle, spread: 0.65 },
  drawYank: { pos: [0.24, -0.3, -0.3], rot: [0.35, 0.3, -2.4], fingers: fist, spread: 0 },
  // Electro. A spear hand drawn back by the ear, then driven out thumb up so
  // the fingers show their length: a discharge needs a touch to go through.
  spearDraw: { pos: [0.27, -0.11, -0.3], rot: [0.45, 0.4, -1.5], fingers: spear, spread: 0 },
  spear: { pos: [0.08, -0.2, -0.48], rot: [0.1, 0.3, -1.45], fingers: spear, spread: 0 },
  // Impact Conversion meets the blow with one splayed palm and sends the
  // rest to the ground with the other, palm down at the hip.
  catchPalm: { pos: [0.12, -0.17, -0.44], rot: [1.25, 0.2, -0.2], fingers: splay, spread: 0.5 },
  groundPalm: { pos: [0.3, -0.33, -0.3], rot: [-0.9, 0.3, 0.25], fingers: splay, spread: 0.45 },
  // Self-Supply: the hands open wide, then the fists clench down by the
  // hips, the body burning its own fuel.
  gripOpen: { pos: [0.29, -0.13, -0.36], rot: [0.9, 0.5, -0.6], fingers: splay, spread: 0.55 },
  gripDown: { pos: [0.3, -0.33, -0.3], rot: [0.3, 0.3, -1.4], fingers: fist, spread: 0 },
  // The sign: fingertips tented before the sternum, then torn apart.
  tent: { pos: [0.045, -0.21, -0.4], rot: [1.2, 0.35, -1.5], fingers: tented, spread: 0.35 },
  arcSpread: { pos: [0.3, -0.17, -0.4], rot: [0.95, 0.5, -0.55], fingers: splay, spread: 0.6 },
  // Friction. `collar` closes on a collar at arm's length; `wrench` hauls it
  // in and across past the other hip, the throw. `glideOut` holds the arm
  // out low to the side, palm down, for balance on a slide. `wallPress`
  // lays both palms flat and high, fingers splayed. `skateFwd` and
  // `skateBack` are a skater's arm swing, across the body and back past the
  // hip. `heave` draws both gripping hands up over the shoulder. `hookLock`
  // hooks the curled fingers of each hand into the other's at the sternum;
  // `hookPull` hauls the elbows apart against the lock, which does not slip.
  collar: { pos: [0.1, -0.2, -0.47], rot: [0.05, 0.25, -0.4], fingers: clutch, spread: 0.08 },
  wrench: { pos: [0.02, -0.29, -0.3], rot: [0.45, 0.95, -1.05], fingers: clutch, spread: 0.05 },
  glideOut: { pos: [0.34, -0.27, -0.33], rot: [-0.1, -0.35, 0.25], fingers: open, spread: 0.4 },
  wallPress: { pos: [0.16, -0.08, -0.43], rot: [1.45, 0.15, -0.05], fingers: flatSplay, spread: 0.6 },
  skateFwd: { pos: [0.03, -0.24, -0.43], rot: [0.2, 0.75, -1.15], fingers: relaxed, spread: 0.1 },
  skateBack: { pos: [0.31, -0.33, -0.22], rot: [0.4, -0.2, -1.4], fingers: relaxed, spread: 0.1 },
  heave: { pos: [0.17, -0.02, -0.33], rot: [1.1, 0.5, -0.85], fingers: clutch, spread: 0.05 },
  hookLock: { pos: [0.03, -0.24, -0.38], rot: [1.3, 0.1, -1.55], fingers: clutch, spread: 0.02 },
  hookPull: { pos: [0.075, -0.235, -0.38], rot: [1.25, 0.2, -1.5], fingers: clutch, spread: 0.02 },
  // Dark Dimension. `seamDraw` raises the sword seal high and out to the
  // right; `seamCut` draws it down and across, cutting a seam in the air;
  // `keyTurn` closes the fist on it and turns it palm up, as a key turns.
  // `pocketReach` pinches at nothing beside the head; `unveil` throws the
  // hand out palm down and open, letting go. `ledger` holds the left palm up
  // like an open book and `tally` points down into it. `doorsGrip` sets the
  // backs of the curled hands together at the sternum; `doorsWide` throws
  // them apart, palms out, as double doors open. The sign makes a frame of
  // thumbs and forefingers (`frame`), and turns it a quarter (`frameTurn`).
  seamDraw: { pos: [0.24, -0.04, -0.42], rot: [0.95, 0.15, -1.45], fingers: point2, spread: 0 },
  seamCut: { pos: [-0.02, -0.31, -0.45], rot: [0.25, 0.65, -1.3], fingers: point2, spread: 0 },
  keyTurn: { pos: [0.07, -0.21, -0.48], rot: [0.2, 0.3, -3.0], fingers: fist, spread: 0 },
  pocketReach: { pos: [0.26, -0.07, -0.29], rot: [1.0, -0.2, -1.0], fingers: pinch, spread: 0.05 },
  unveil: { pos: [0.1, -0.2, -0.5], rot: [-0.25, 0.25, 0.1], fingers: open, spread: 0.55 },
  ledger: { pos: [0.13, -0.28, -0.38], rot: [0.25, 0.35, -2.95], fingers: open, spread: 0.15 },
  tally: { pos: [0.06, -0.2, -0.4], rot: [-0.9, 0.4, -1.5], fingers: point1, spread: 0 },
  doorsGrip: { pos: [0.05, -0.23, -0.4], rot: [1.2, -0.35, -0.1], fingers: claw, spread: 0.2 },
  doorsWide: { pos: [0.36, -0.13, -0.37], rot: [1.3, -0.5, 0.3], fingers: open, spread: 0.5 },
  frame: { pos: [0.08, -0.17, -0.42], rot: [1.3, 0.1, -0.3], fingers: corner, spread: 0.6 },
  frameTurn: { pos: [0.09, -0.2, -0.42], rot: [1.3, 0.1, -1.6], fingers: corner, spread: 0.6 },
  // Fuel. `fanGather` cups the vapour palm up at the hip; `fanSweep` strews
  // it, the arm out low and wide, palm down, fingers trailing. `flickReady`
  // bunches the fingertips at the shoulder and `flickOpen` springs them open
  // at arm's length, a fine spray. `herdCup` holds both hands out cupped to
  // the air and `herdDraw` draws them in. `condense` cups the hands together
  // on what they hold; `parting` throws them out wide. The sign stretches
  // something clinging between the parted palms (`stretch`, `stretchWide`).
  fanGather: { pos: [0.2, -0.29, -0.33], rot: [0.3, 0.4, -2.75], fingers: cup, spread: 0.25 },
  fanSweep: { pos: [0.27, -0.24, -0.45], rot: [-0.25, -0.4, 0.15], fingers: fling, spread: 0.6 },
  flickReady: { pos: [0.25, -0.15, -0.3], rot: [0.6, 0.2, -1.5], fingers: bunch, spread: 0 },
  flickOpen: { pos: [0.12, -0.18, -0.47], rot: [0.35, 0.25, -0.6], fingers: fling, spread: 0.65 },
  herdCup: { pos: [0.2, -0.21, -0.43], rot: [1.1, 0.55, -0.9], fingers: cup, spread: 0.3 },
  herdDraw: { pos: [0.13, -0.23, -0.34], rot: [1.0, 0.8, -1.15], fingers: cup, spread: 0.25 },
  condense: { pos: [0.05, -0.23, -0.39], rot: [1.15, 0.3, -1.95], fingers: cup, spread: 0.15 },
  parting: { pos: [0.34, -0.19, -0.33], rot: [1.2, -0.55, -0.3], fingers: open, spread: 0.5 },
  stretch: { pos: [0.075, -0.23, -0.4], rot: [1.3, 0.1, -1.5], fingers: cradle, spread: 0.45 },
  stretchWide: { pos: [0.19, -0.22, -0.41], rot: [1.25, 0.2, -1.45], fingers: cradle, spread: 0.6 },
  // Fuel's lighter, which is not the Technique: `lighterUp` brings it up
  // thumb first, `lighterStrike` rolls the thumb down the wheel, and
  // `lighterToss` flicks the wrist out at the aim.
  lighterUp: { pos: [0.15, -0.17, -0.36], rot: [0.5, 0.25, -1.55], fingers: lighterGrip, spread: 0 },
  lighterStrike: { pos: [0.14, -0.18, -0.39], rot: [0.42, 0.25, -1.6], fingers: lighterRolled, spread: 0 },
  lighterToss: { pos: [0.11, -0.15, -0.46], rot: [0.75, 0.2, -1.5], fingers: lighterRolled, spread: 0 },
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
