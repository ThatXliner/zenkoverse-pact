import type { Gesture } from '../hands/gestures';

// What enemies and bosses do with their arms (issue #46): the same gesture
// data the player's casts use, played on their bodies by the gesture layer
// (src/character/gesture.ts). Each impact lands on the beat its caller
// times: a melee strike on the end of the wind-up, a cast on its resolve.
export const MOVES = {
  // A straight punch: the fist chambers at the ribs through the wind-up and
  // drives out on the strike (wind-up 0.38 s).
  jab: { duration: 0.8, impactAt: 0.4, keys: [
    { t: 0, right: 'chamber', left: 'guard', slow: true },
    { t: 0.36, right: 'punch', snap: true },
    { t: 0.5, right: 'punchOver' },
    { t: 0.66, right: 'rest', left: 'rest' },
  ] },
  // The Master's palm strike: both hands rise and drive down at the ground,
  // the ring going out on the strike (wind-up 0.5 s).
  palm: { duration: 1.0, impactAt: 0.52, keys: [
    { t: 0, right: 'raiseHigh', left: 'raiseHigh', slow: true },
    { t: 0.48, right: 'slamDown', left: 'slamDown', snap: true },
    { t: 0.8, right: 'rest', left: 'rest' },
  ] },
  // A heavy's overhead slam: both fists climb over the head through a long
  // wind-up and come down together on the ground in front (wind-up 0.7 s).
  slam: { duration: 1.1, impactAt: 0.56, keys: [
    { t: 0, right: 'raiseHigh', left: 'raiseHigh', slow: true },
    { t: 0.5, right: 'slamDown', left: 'slamDown', snap: true },
    { t: 0.9, right: 'rest', left: 'rest' },
  ] },
  // The Enforcer lays the fuel: a palm sweeps low over the ground, the hand
  // reaches after it, and he snaps it alight (resolves at 1.1 s).
  fuel: { duration: 1.35, impactAt: 1.1, keys: [
    { t: 0, right: 'palmSurface', left: 'guard', slow: true },
    { t: 0.45, right: 'clawReach', snap: true },
    { t: 0.8, right: 'snapReady', slow: true },
    { t: 1.06, right: 'snapped', left: 'clawReady', snap: true },
    { t: 1.28, right: 'rest', left: 'rest' },
  ] },
  // The Master's cast: palms seal, part up overhead, and push the wave out
  // (resolves at 1.1 s).
  wave: { duration: 1.35, impactAt: 1.1, keys: [
    { t: 0, right: 'sealGather', left: 'sealGather', slow: true },
    { t: 0.3, right: 'seal', left: 'seal', snap: true },
    { t: 0.65, right: 'raiseHigh', left: 'raiseHigh', slow: true },
    { t: 1.06, right: 'braceWide', left: 'braceWide', snap: true },
    { t: 1.3, right: 'rest', left: 'rest' },
  ] },
  // Bosses' Maximum Output signs, their strike timed to the cutscene's blow.
  // The Master's: the seal, both hands up to the sky, and down on the blow.
  fiveThousandYears: { duration: 2.2, impactAt: 1.6, keys: [
    { t: 0, right: 'sealGather', left: 'sealGather', slow: true },
    { t: 0.45, right: 'seal', left: 'seal', snap: true },
    { t: 0.95, right: 'raiseHigh', left: 'raiseHigh', slow: true },
    { t: 1.55, right: 'slamDown', left: 'slamDown', snap: true },
    { t: 2.0, right: 'rest', left: 'rest' },
  ] },
  // The Enforcer's: fist to palm, the fist drawn back, and driven at the ground.
  flashpoint: { duration: 2.2, impactAt: 1.6, keys: [
    { t: 0, right: 'chamber', left: 'seal', slow: true },
    { t: 0.45, right: 'fistToPalm', snap: true },
    { t: 1.0, right: 'slamUp', left: 'clawReady', slow: true },
    { t: 1.55, right: 'slamDown', snap: true },
    { t: 2.0, right: 'rest', left: 'rest' },
  ] },
  // Opening an aura field: gathered low, then both palms thrown wide.
  field: { duration: 0.8, impactAt: 0.22, keys: [
    { t: 0, right: 'sealGather', left: 'sealGather', slow: true },
    { t: 0.18, right: 'quietSpread', left: 'quietSpread', snap: true },
    { t: 0.6, right: 'rest', left: 'rest' },
  ] },
  // The player's bare hands (src/combat/melee.ts). A jab off the lead (left)
  // hand and a cross off the rear come straight from the guard, quick enough
  // that the fist is out on the next frames; the third blow is a hook, drawn
  // wide first so the body reads it coming. Each lands on `impactAt`.
  punchJab: { duration: 0.32, impactAt: 0.08, keys: [
    { t: 0, left: 'punch', right: 'guard', snap: true, camera: { fov: 2 } },
    { t: 0.13, left: 'guard' },
  ] },
  punchCross: { duration: 0.36, impactAt: 0.1, keys: [
    { t: 0, right: 'punch', left: 'guard', snap: true, camera: { fov: 3, roll: -0.01 } },
    { t: 0.16, right: 'guard' },
  ] },
  punchHook: { duration: 0.62, impactAt: 0.22, keys: [
    { t: 0, right: 'hookDraw', left: 'guard' },
    { t: 0.15, right: 'hook', snap: true, camera: { fov: 6, pitch: 0.012, roll: 0.025 } },
    { t: 0.4, right: 'guard' },
  ] },
  // The aura strike: the fist sinks to the ribs and fills while the lead hand
  // holds the line, then drives straight out as the lead hand pulls back.
  auraStrike: { duration: 0.95, impactAt: 0.42, keys: [
    { t: 0, right: 'chamber', left: 'guard', slow: true },
    { t: 0.36, right: 'punchOver', left: 'chamber', snap: true, camera: { fov: 9, pitch: 0.02 } },
    { t: 0.68, right: 'guard', left: 'guard' },
  ] },
} satisfies Record<string, Gesture>;

// The blows as the wire numbers them (src/net/protocol.ts `blow`).
export const BLOW_MOVES: readonly Gesture[] = [MOVES.punchJab, MOVES.punchCross, MOVES.punchHook, MOVES.auraStrike];
