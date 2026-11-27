import type { SynthName, SynthParams } from './synth';

// Every sound the game makes, by name. A cue is layers: recordings (one of
// `s`, picked at random, so repeats differ) and synthesized voices (`syn`),
// each with its own gain, pitch and delay. Gameplay asks for a cue by name and
// never for a file, so retuning a sound is an edit here and nowhere else.
//
// Techniques follow one grammar: a cast cue under the wind-up (air, cloth, a
// rise), an impact cue on the frame it lands (the recording, a crack on the
// front edge, a boom underneath), and for a Maximum Output a charge under the
// sign, an inhale (or rush) on the cut before the blow, the blow, and a tail
// the kit plays where its effect lands, the part other players hear.

export type Bus = 'sfx' | 'ui';

export type Layer =
  | { s: readonly string[]; gain?: number; pitch?: number; vary?: number; at?: number; lp?: number; w?: number }
  | { syn: SynthName; p?: SynthParams; gain?: number; pitch?: number; at?: number; w?: number };

export interface Cue {
  bus: Bus;
  layers: readonly Layer[];
  // Online, sent to the other players and played there at the caster.
  net?: boolean;
  // Reverb send; the room decides how much of it comes back.
  wet?: number;
  // Seconds before the same cue may sound again (a burst of hits in one frame is one sound).
  every?: number;
  // Pulls the ambience and the score down for a moment, by this much.
  duck?: number;
}

// `footstep_wood_` and 5 → footstep_wood_000 … footstep_wood_004.
const v = (stem: string, count: number, from = 0): string[] => Array.from({ length: count }, (_, i) => `${stem}${String(from + i).padStart(3, '0')}`);
const S = (names: string | readonly string[], gain = 0.6, o: { pitch?: number; vary?: number; at?: number; lp?: number; w?: number } = {}): Layer => ({ s: typeof names === 'string' ? [names] : names, gain, ...o });
const Y = (syn: SynthName, p: SynthParams = {}, o: { gain?: number; pitch?: number; at?: number; w?: number } = {}): Layer => ({ syn, p, ...o });

const CLOTH = ['cloth1', 'cloth2', 'cloth3', 'cloth4'];
const GRAVEL = ['footstep00', 'footstep01', 'footstep02', 'footstep03', 'footstep04', 'footstep05'];
const PUNCH_H = v('impactPunch_heavy_', 3), PUNCH_M = v('impactPunch_medium_', 3);
const SOFT_H = v('impactSoft_heavy_', 3), SOFT_M = v('impactSoft_medium_', 3);
const GLASS_L = v('impactGlass_light_', 3), GLASS_M = v('impactGlass_medium_', 2), GLASS_H = v('impactGlass_heavy_', 3);
const BELL = v('impactBell_heavy_', 3), MINING = v('impactMining_', 3);

const sfx = (layers: Layer[], o: Omit<Cue, 'bus' | 'layers'> = {}): Cue => ({ bus: 'sfx', layers, wet: 0.25, ...o });
const net = (layers: Layer[], o: Omit<Cue, 'bus' | 'layers' | 'net'> = {}): Cue => sfx(layers, { net: true, ...o });
const ui = (layers: Layer[], o: Omit<Cue, 'bus' | 'layers'> = {}): Cue => ({ bus: 'ui', layers, wet: 0, ...o });

export const CUES = {
  // ------------------------------------------------------------ footsteps
  'step.stone': sfx([S(v('footstep_concrete_', 5), 0.28, { vary: 0.08 })], { wet: 0.15 }),
  'step.wood': sfx([S(v('footstep_wood_', 5), 0.3, { vary: 0.08 }), Y('thud', { f: 120, dur: 0.06 }, { gain: 0.12 })], { wet: 0.2 }),
  'step.grass': sfx([S(v('footstep_grass_', 5), 0.6, { vary: 0.08 })], { wet: 0.05 }),
  'step.gravel': sfx([S(GRAVEL, 0.33, { vary: 0.1 }), S(v('footstep_snow_', 3), 0.14, { pitch: 1.3, vary: 0.1 })], { wet: 0.1 }),
  'step.water': sfx([Y('splash', { size: 0.7, bubbles: 2 }, { gain: 0.8 }), S(v('footstep_concrete_', 5), 0.12, { lp: 900 })], { wet: 0.15 }),
  'step.wet': sfx([S(v('footstep_concrete_', 5), 0.28, { vary: 0.08 }), Y('splash', { size: 0.4, bubbles: 1 }, { gain: 0.22 })], { wet: 0.15 }),
  'step.ice': sfx([S(v('footstep_concrete_', 5), 0.3, { pitch: 1.25, vary: 0.08 }), S(GLASS_L, 0.1, { pitch: 1.6, vary: 0.15 }), Y('tinkle', { count: 2, spread: 0.05 }, { gain: 0.5 })], { wet: 0.2 }),
  'step.tile': sfx([S(v('footstep_concrete_', 5), 0.27, { pitch: 1.15, vary: 0.1 }), S(v('impactGeneric_light_', 3), 0.08, { pitch: 1.4 })], { wet: 0.1 }),
  'jump': sfx([S(CLOTH, 0.22, { pitch: 1.2, vary: 0.1 }), Y('whoosh', { dur: 0.22, f0: 300, f1: 1400 }, { gain: 0.2 })]),
  'land': sfx([S(SOFT_M, 0.45, { vary: 0.08 }), Y('thud', { f: 80, dur: 0.18 }, { gain: 0.45, w: 1 }), S(CLOTH, 0.15)], { wet: 0.2 }),
  'land.water': sfx([Y('splash', { size: 1.5, bubbles: 4 }, { gain: 0.8 }), Y('thud', { f: 70, dur: 0.2 }, { gain: 0.3 })]),
  'dash': sfx([Y('whoosh', { dur: 0.32, f0: 220, f1: 2600, peak: 0.35 }, { gain: 0.55 }), S(CLOTH, 0.3, { pitch: 1.3 }), Y('thud', { f: 70, dur: 0.1 }, { gain: 0.25 })]),

  // ------------------------------------------------------------ the full hand sign (Alt)
  'sign.begin': sfx([S(CLOTH, 0.35, { pitch: 0.9 }), Y('riser', { dur: 0.9, f0: 160, f1: 1400, tone: 0.2 }, { gain: 0.18 })]),
  'sign.seal': sfx([S(SOFT_H, 0.55, { pitch: 1.3 }), Y('crack', { dur: 0.05, hp: 2600 }, { gain: 0.35 }), Y('thud', { f: 110, dur: 0.12 }, { gain: 0.4 })], { wet: 0.4 }),
  'sign.release': sfx([Y('whoosh', { dur: 0.35, f0: 400, f1: 3200 }, { gain: 0.45 }), Y('shimmer', { f: 660, dur: 1.4 }, { gain: 0.16 }), Y('boom', { f0: 120, f1: 50, dur: 0.4 }, { gain: 0.4 })], { wet: 0.5 }),
  'sign.primed': sfx([S('tick_002', 0.35, { pitch: 0.9 }), Y('shimmer', { f: 1320, dur: 0.9 }, { gain: 0.08 })]),

  // ------------------------------------------------------------ Recoil: kinetic energy, taken in and given back
  'recoil.cast': net([S(CLOTH, 0.35, { pitch: 1.1 }), Y('whoosh', { dur: 0.24, f0: 160, f1: 900, peak: 0.7 }, { gain: 0.45 })]),
  'recoil.punch.hit': net([S(SOFT_H, 0.5, { pitch: 0.75 }), Y('crack', { dur: 0.07 }, { gain: 0.45 }), Y('whoosh', { dur: 0.16, f0: 1600, f1: 400, peak: 0.08, q: 0.6 }, { gain: 0.5 }), Y('boom', { f0: 140, f1: 42, dur: 0.5 }, { gain: 0.55, w: 0.7 })], { wet: 0.35, duck: 0.3 }),
  'recoil.punch.whiff': net([Y('whoosh', { dur: 0.3, f0: 260, f1: 2000, peak: 0.4 }, { gain: 0.5 }), S(SOFT_M, 0.25, { pitch: 1.3 })]),
  'recoil.line': net([S(MINING, 0.7, { pitch: 1.05 }), Y('rumble', { dur: 1.1, lp: 300 }, { gain: 0.8 }), Y('boom', { f0: 120, f1: 38, dur: 0.7 }, { gain: 0.7 }), Y('crack', { dur: 0.09, hp: 1200 }, { gain: 0.35 })], { wet: 0.4, duck: 0.3 }),
  'recoil.absorb': net([S('beltHandle1', 0.35), Y('inhale', { dur: 0.25, f1: 2500 }, { gain: 0.3 }), Y('tone', { f: 82, dur: 0.6, type: 1, lp: 400 }, { gain: 0.4 })]),
  'recoil.absorbed': net([S(v('impactPlate_heavy_', 2), 0.55, { pitch: 1.15 }), Y('thud', { f: 95, dur: 0.2 }, { gain: 0.6 }), Y('shimmer', { f: 220, dur: 0.7 }, { gain: 0.18 })], { wet: 0.35 }),
  'recoil.release': net([Y('whoosh', { dur: 0.35, f0: 180, f1: 1600 }, { gain: 0.55 }), Y('boom', { f0: 100, f1: 40, dur: 0.45 }, { gain: 0.55 })]),
  'recoil.catch': net([S(v('impactWood_medium_', 2), 0.45), Y('thud', { f: 100, dur: 0.12 }, { gain: 0.35 })]),
  'recoil.max.cast': sfx([Y('riser', { dur: 1.2, f0: 90, f1: 1800, tone: 0.5 }, { gain: 0.5 })]),
  'recoil.max.charge': sfx([Y('riser', { dur: 1.0, f0: 80, f1: 2400, tone: 0.5 }, { gain: 0.55 }), Y('boom', { f0: 60, f1: 40, dur: 1.2 }, { gain: 0.35 })], { duck: 0.6 }),
  'recoil.max.inhale': sfx([Y('inhale', { dur: 0.5, f1: 8000 }, { gain: 0.6 }), S(CLOTH, 0.4, { pitch: 0.8 })]),
  'recoil.max.blow': sfx([S(MINING, 1, { pitch: 0.55 }), S(BELL, 0.6, { pitch: 0.6 }), Y('crack', { dur: 0.12, hp: 900 }, { gain: 0.8 }), Y('boom', { f0: 95, f1: 26, dur: 1.8 }, { gain: 1.2 }), Y('rumble', { dur: 2.4, lp: 220 }, { gain: 0.9 })], { wet: 0.6, duck: 1 }),
  'recoil.max.tail': net([Y('rumble', { dur: 1.6, lp: 400 }, { gain: 0.7 }), S(MINING, 0.5, { pitch: 0.7, at: 0.05 }), Y('boom', { f0: 80, f1: 30, dur: 1.2 }, { gain: 0.6 })], { wet: 0.5 }),

  // ------------------------------------------------------------ Rime: water nucleated through the nails
  'rime.cast': net([Y('whoosh', { dur: 0.28, f0: 1400, f1: 6000, q: 0.8 }, { gain: 0.3 }), Y('tinkle', { count: 5, spread: 0.2 }, { gain: 0.8 }), S(CLOTH, 0.2, { pitch: 1.2 })]),
  'rime.stitch.cast': net([Y('inhale', { dur: 0.3, f1: 9000 }, { gain: 0.28 }), Y('tone', { f: 2400, glide: 3600, dur: 0.3 }, { gain: 0.05 })]),
  'rime.spike': net([S(GLASS_L, 0.5, { vary: 0.12 }), Y('crack', { dur: 0.05, hp: 3000 }, { gain: 0.3 }), Y('thud', { f: 140, dur: 0.08 }, { gain: 0.25 })], { wet: 0.3 }),
  'rime.ridge': net([S(GLASS_H, 0.6), Y('rumble', { dur: 0.7, lp: 500 }, { gain: 0.35 }), Y('tinkle', { count: 10, spread: 0.5 }, { gain: 0.7 })], { wet: 0.35 }),
  'rime.stitch': net([S(GLASS_M, 0.65), Y('shimmer', { f: 1760, dur: 1.1 }, { gain: 0.14 }), Y('tinkle', { count: 9, spread: 0.6 }, { gain: 0.8 }), Y('crack', { dur: 0.06, hp: 3500 }, { gain: 0.3 })], { wet: 0.4 }),
  'rime.freeze': net([S(GLASS_M, 0.7, { pitch: 0.8 }), Y('rumble', { dur: 1.5, lp: 240 }, { gain: 0.5 }), Y('tinkle', { count: 18, spread: 1.2, lo: 1800 }, { gain: 0.8 })], { wet: 0.5 }),
  'rime.max.cast': sfx([Y('riser', { dur: 1.2, f0: 600, f1: 9000, q: 1.5, tone: 0.1 }, { gain: 0.6 }), Y('tinkle', { count: 10, spread: 1.1 }, { gain: 0.6 })]),
  'rime.max.charge': sfx([Y('riser', { dur: 1.0, f0: 500, f1: 9000, q: 1.2, tone: 0.15 }, { gain: 0.45 }), Y('tinkle', { count: 14, spread: 0.9 }, { gain: 0.7 }), Y('shimmer', { f: 1100, dur: 1.4 }, { gain: 0.1 })], { duck: 0.6 }),
  'rime.max.inhale': sfx([Y('inhale', { dur: 0.5, f1: 10000 }, { gain: 0.55 }), S(SOFT_H, 0.4, { pitch: 0.6 })]),
  'rime.max.blow': sfx([S(GLASS_H, 1, { pitch: 0.6 }), S(MINING, 0.6, { pitch: 0.7 }), Y('crack', { dur: 0.1, hp: 2500 }, { gain: 0.8 }), Y('boom', { f0: 90, f1: 30, dur: 1.4 }, { gain: 1 }), Y('tinkle', { count: 30, spread: 1.8, lo: 1500 }, { gain: 0.9 }), Y('shimmer', { f: 520, dur: 2.4 }, { gain: 0.2 })], { wet: 0.6, duck: 1 }),
  'rime.max.tail': net([Y('tinkle', { count: 22, spread: 1.6, lo: 1600 }, { gain: 0.8 }), Y('rumble', { dur: 1.4, lp: 300 }, { gain: 0.5 }), S(GLASS_H, 0.5, { pitch: 0.5 })], { wet: 0.5 }),

  // ------------------------------------------------------------ Electro: any energy in, only electricity out
  'electro.cast': net([S(CLOTH, 0.3, { pitch: 1.2 }), Y('buzz', { dur: 0.3, f: 120, band: 900, attack: 0.25 }, { gain: 0.16 }), Y('zap', { dur: 0.12, count: 4, hp: 3200 }, { gain: 0.35 })]),
  'electro.convert.cast': net([S(SOFT_M, 0.3, { pitch: 1.4 }), Y('buzz', { dur: 0.35, f: 60, band: 500 }, { gain: 0.2 }), Y('inhale', { dur: 0.18, f1: 3000 }, { gain: 0.2 })]),
  'electro.discharge': net([S('zapTwoTone', 0.55, { pitch: 0.8, vary: 0.08 }), Y('zap', { dur: 0.3, count: 22 }, { gain: 0.8 }), Y('crack', { dur: 0.05, hp: 3000 }, { gain: 0.6 }), Y('boom', { f0: 150, f1: 60, dur: 0.3 }, { gain: 0.4, w: 0.6 })], { wet: 0.3, duck: 0.2 }),
  'electro.snap': net([Y('zap', { dur: 0.08, count: 5, hp: 4000 }, { gain: 0.45 }), S('tick_001', 0.25, { pitch: 1.6 })]),
  'electro.jump': net([Y('zap', { dur: 0.1, count: 8, hp: 2800 }, { gain: 0.5 }), S('zapTwoTone', 0.18, { pitch: 1.3, vary: 0.1 })], { every: 0.03 }),
  'electro.water': net([Y('splash', { size: 0.8, bubbles: 3 }, { gain: 0.5 }), Y('zap', { dur: 0.45, count: 30, hp: 1800 }, { gain: 0.7 }), Y('buzz', { dur: 0.5, f: 100, band: 1200 }, { gain: 0.25 })], { wet: 0.4 }),
  'electro.metal': net([S(v('impactMetal_light_', 2), 0.45, { pitch: 1.3, vary: 0.1 }), Y('zap', { dur: 0.15, count: 10, hp: 3500 }, { gain: 0.5 }), Y('shimmer', { f: 1320, dur: 0.4 }, { gain: 0.06 })], { every: 0.04 }),
  'electro.crackle': net([Y('zap', { dur: 0.1, count: 4, hp: 5000 }, { gain: 0.22 })], { every: 0.08 }),
  'electro.converted': net([S(v('impactPlate_heavy_', 2), 0.45, { pitch: 1.3 }), Y('buzz', { dur: 0.4, f: 90, band: 1400 }, { gain: 0.3 }), Y('zap', { dur: 0.2, count: 10 }, { gain: 0.45 })], { wet: 0.3 }),
  'electro.backlash': net([S('glitch_001', 0.45, { pitch: 0.9 }), Y('zap', { dur: 0.35, count: 24, hp: 1500 }, { gain: 0.75 }), Y('buzz', { dur: 0.4, f: 55, band: 700 }, { gain: 0.35 })]),
  'electro.supply': net([Y('heartbeat', { gain: 0.55 }), Y('buzz', { dur: 0.7, f: 80, band: 700, attack: 0.5 }, { gain: 0.25 }), S('powerUp9', 0.22, { pitch: 0.6 })]),
  'electro.spent': net([Y('heartbeat', { gain: 0.75 }), S('glitch_001', 0.3, { pitch: 0.7 }), Y('tone', { f: 220, glide: 90, dur: 0.4, lp: 600 }, { gain: 0.18 })]),
  'electro.ignite': net([Y('zap', { dur: 0.1, count: 6 }, { gain: 0.5 }), Y('whoosh', { dur: 0.5, f0: 200, f1: 1200, peak: 0.2 }, { gain: 0.6 }), Y('rumble', { dur: 1.0, lp: 500 }, { gain: 0.45 })], { wet: 0.3 }),
  // A snap with nowhere to go: the air takes it a pace and no further.
  'electro.gap': net([Y('crack', { dur: 0.04, hp: 4200 }, { gain: 0.55 }), Y('zap', { dur: 0.14, count: 9, hp: 3600 }, { gain: 0.5 }), S('tick_001', 0.3, { pitch: 1.2 })]),
  // A heavy discharge landing: the crack in front, the thunder under it.
  'electro.thunder': net([Y('crack', { dur: 0.08, hp: 1800 }, { gain: 0.9 }), S('zapTwoTone', 0.6, { pitch: 0.6, vary: 0.08 }), Y('zap', { dur: 0.5, count: 34, hp: 1400 }, { gain: 0.8 }), Y('boom', { f0: 120, f1: 36, dur: 0.9 }, { gain: 0.8, w: 0.8 })], { wet: 0.5, duck: 0.4, every: 0.06 }),
  // A body locked by the current, and metal still holding it.
  'electro.seize': net([Y('buzz', { dur: 0.5, f: 70, band: 1800 }, { gain: 0.35 }), Y('zap', { dur: 0.45, count: 18, hp: 2600 }, { gain: 0.45 })], { every: 0.15 }),
  'electro.hum': sfx([Y('buzz', { dur: 0.45, f: 100, band: 900 }, { gain: 0.22 }), Y('zap', { dur: 0.2, count: 3, hp: 4500 }, { gain: 0.18 })], { every: 0.4 }),
  'electro.max.cast': sfx([Y('riser', { dur: 1.2, f0: 120, f1: 3600, tone: 0.3 }, { gain: 0.4 }), Y('buzz', { dur: 1.2, f: 50, band: 600, attack: 1.0 }, { gain: 0.3 })]),
  'electro.max.charge': sfx([Y('riser', { dur: 1.0, f0: 120, f1: 4200, tone: 0.35 }, { gain: 0.45 }), Y('buzz', { dur: 1.1, f: 50, band: 900, attack: 0.9 }, { gain: 0.4 }), Y('zap', { dur: 1.0, count: 26, hp: 3000 }, { gain: 0.35 })], { duck: 0.6 }),
  'electro.max.inhale': sfx([Y('inhale', { dur: 0.45, f1: 7000 }, { gain: 0.5 }), Y('buzz', { dur: 0.45, f: 100, band: 2400, attack: 0.4 }, { gain: 0.3 })]),
  'electro.max.blow': sfx([S('zapTwoTone', 0.9, { pitch: 0.45 }), S(MINING, 0.5, { pitch: 0.9 }), Y('crack', { dur: 0.14, hp: 1200 }, { gain: 1 }), Y('zap', { dur: 0.9, count: 70, hp: 1500 }, { gain: 1 }), Y('boom', { f0: 110, f1: 28, dur: 1.6 }, { gain: 1.1 }), Y('buzz', { dur: 1.4, f: 50, band: 500 }, { gain: 0.4 })], { wet: 0.6, duck: 1 }),
  'electro.max.tail': net([Y('zap', { dur: 1.2, count: 40, hp: 2400 }, { gain: 0.6 }), Y('buzz', { dur: 1.6, f: 60, band: 800 }, { gain: 0.35 }), Y('rumble', { dur: 1.2, lp: 300 }, { gain: 0.4 })], { wet: 0.5 }),

  // ------------------------------------------------------------ Shift: translation through what lies between
  'shift.cast': net([Y('warp', { dur: 0.16, f0: 300, f1: 1400 }, { gain: 0.16 }), S(CLOTH, 0.3, { pitch: 1.3 })]),
  'shift.translate.cast': net([Y('warp', { dur: 0.22, f0: 200, f1: 1800 }, { gain: 0.18 }), Y('inhale', { dur: 0.2 }, { gain: 0.25 })]),
  'shift.cut.hit': net([S(['knifeSlice', 'knifeSlice2'], 0.65), Y('tear', { dur: 0.12 }, { gain: 0.5 }), Y('warp', { dur: 0.25, f0: 1400, f1: 120 }, { gain: 0.2 }), Y('boom', { f0: 120, f1: 50, dur: 0.35 }, { gain: 0.45 })], { wet: 0.3 }),
  'shift.cut.whiff': net([S(['knifeSlice', 'knifeSlice2'], 0.45, { pitch: 1.1 }), Y('tear', { dur: 0.14 }, { gain: 0.35 })]),
  'shift.translate': net([S('phaseJump3', 0.18, { pitch: 1.1 }), Y('warp', { dur: 0.35, f0: 1600, f1: 90 }, { gain: 0.3 }), Y('whoosh', { dur: 0.3, f0: 2400, f1: 500, peak: 0.15 }, { gain: 0.4 }), Y('thud', { f: 90, dur: 0.14, }, { gain: 0.45, at: 0.06 })], { wet: 0.3 }),
  'shift.max.cast': sfx([Y('riser', { dur: 1.2, f0: 200, f1: 4000, tone: 0.3 }, { gain: 0.4 }), Y('warp', { dur: 1.1, f0: 80, f1: 900 }, { gain: 0.12 })]),
  'shift.max.charge': sfx([Y('riser', { dur: 1.0, f0: 160, f1: 4800, tone: 0.35 }, { gain: 0.5 }), Y('warp', { dur: 1.0, f0: 60, f1: 1200 }, { gain: 0.14 })], { duck: 0.6 }),
  'shift.max.rush': sfx([Y('whoosh', { dur: 0.5, f0: 200, f1: 5000, peak: 0.85 }, { gain: 0.8 }), Y('warp', { dur: 0.45, f0: 120, f1: 2600 }, { gain: 0.2 })]),
  'shift.max.blow': sfx([S('zapTwoTone', 0.25, { pitch: 0.75 }), S(['knifeSlice', 'knifeSlice2'], 0.8, { pitch: 0.7 }), Y('tear', { dur: 0.25 }, { gain: 0.7 }), Y('crack', { dur: 0.1 }, { gain: 0.7 }), Y('boom', { f0: 110, f1: 30, dur: 1.4 }, { gain: 1.1 }), S(MINING, 0.5, { pitch: 0.8, at: 0.03 })], { wet: 0.6, duck: 1 }),
  'shift.max.tail': net([Y('warp', { dur: 0.6, f0: 2000, f1: 60 }, { gain: 0.4 }), Y('rumble', { dur: 1.0 }, { gain: 0.75 }), Y('tear', { dur: 0.3 }, { gain: 0.6 })], { wet: 0.4 }),

  // ------------------------------------------------------------ Echo: vibration through connected matter
  'echo.cast': net([S('tick_001', 0.4, { pitch: 0.7 }), Y('tone', { f: 220, dur: 0.5, type: 1, lp: 900 }, { gain: 0.2 }), Y('shimmer', { f: 440, dur: 0.6 }, { gain: 0.08 })]),
  'echo.ring': net([S(BELL, 0.45, { pitch: 1.3, vary: 0.06 }), Y('shimmer', { f: 587, dur: 1.4 }, { gain: 0.18 }), Y('thud', { f: 160, dur: 0.1 }, { gain: 0.3 })], { wet: 0.55, every: 0.06 }),
  'echo.shatter': net([S(GLASS_H, 0.8, { pitch: 0.8 }), Y('crack', { dur: 0.1, hp: 2000 }, { gain: 0.6 }), Y('shimmer', { f: 880, dur: 1.8 }, { gain: 0.25 }), Y('boom', { f0: 130, f1: 45, dur: 0.6 }, { gain: 0.6 })], { wet: 0.6, duck: 0.4 }),
  'echo.quiet': net([Y('inhale', { dur: 0.35, f1: 1200 }, { gain: 0.3 }), Y('tone', { f: 110, dur: 0.8, lp: 300 }, { gain: 0.3 })]),
  'echo.damped': net([S(SOFT_M, 0.4, { pitch: 0.6, lp: 700 }), Y('tone', { f: 330, glide: 110, dur: 0.4, lp: 600 }, { gain: 0.25 })]),
  'echo.max.cast': sfx([Y('riser', { dur: 1.2, f0: 110, f1: 2200, tone: 0.4 }, { gain: 0.4 }), Y('shimmer', { f: 220, dur: 1.5 }, { gain: 0.16 })]),
  'echo.max.charge': sfx([Y('riser', { dur: 1.0, f0: 110, f1: 2600, tone: 0.45 }, { gain: 0.45 }), Y('shimmer', { f: 196, dur: 1.6 }, { gain: 0.22 })], { duck: 0.6 }),
  'echo.max.drop': sfx([S(BELL, 0.45, { pitch: 0.3 }), Y('shimmer', { f: 98, dur: 1.2 }, { gain: 0.3 })]),
  'echo.max.blow': sfx([S(BELL, 1, { pitch: 0.4 }), Y('crack', { dur: 0.1, hp: 1500 }, { gain: 0.5 }), Y('boom', { f0: 98, f1: 32, dur: 2 }, { gain: 1.1 }), Y('shimmer', { f: 147, dur: 3.2 }, { gain: 0.4 }), Y('rumble', { dur: 2.2 }, { gain: 0.7 })], { wet: 0.8, duck: 1 }),
  'echo.max.tail': net([S(BELL, 0.6, { pitch: 0.5 }), Y('shimmer', { f: 196, dur: 2.4 }, { gain: 0.3 }), Y('rumble', { dur: 1.5 }, { gain: 0.5 })], { wet: 0.7 }),

  // ------------------------------------------------------------ Tension: lines strung, drawn and let go
  // A wire under load is a plucked string: it rises as it tightens, cracks
  // when it lets go, and falls flat when it goes slack. Rope creaks carry the
  // draw; a blade's slice carries a line cutting across a body.
  'tension.cast': net([S(CLOTH, 0.3, { pitch: 1.15 }), Y('whoosh', { dur: 0.18, f0: 600, f1: 2400, peak: 0.6, q: 2 }, { gain: 0.3 })]),
  'tension.thread': net([Y('tear', { dur: 0.1 }, { gain: 0.22, pitch: 1.3 }), Y('twang', { f: 330, bend: 0.75, bendDur: 0.08, dur: 0.7 }, { gain: 0.55 }), S('tick_002', 0.3, { pitch: 0.8 })], { wet: 0.3 }),
  'tension.pin': sfx([S(v('impactWood_light_', 2), 0.35, { pitch: 1.3 }), Y('thud', { f: 140, dur: 0.06 }, { gain: 0.25 })]),
  'tension.snare': net([S(CLOTH, 0.5, { pitch: 0.85 }), Y('twang', { f: 147, bend: 0.6, bendDur: 0.15, dur: 0.9 }, { gain: 0.6 }), Y('thud', { f: 110, dur: 0.12 }, { gain: 0.35 })], { wet: 0.3 }),
  'tension.trip': net([S(SOFT_M, 0.5, { pitch: 0.9 }), Y('twang', { f: 262, bend: 1.5, bendDur: 0.1, dur: 0.8 }, { gain: 0.6 }), Y('crack', { dur: 0.04, hp: 2400 }, { gain: 0.25 })], { wet: 0.3, every: 0.05 }),
  'tension.draw': net([S(['creak1', 'creak2', 'creak3'], 0.45), Y('tone', { f: 98, glide: 196, dur: 0.9, type: 3, lp: 700 }, { gain: 0.12 }), Y('twang', { f: 110, bend: 0.5, bendDur: 0.8, dur: 1.0, bright: 0.4 }, { gain: 0.35 })], { wet: 0.25 }),
  'tension.taut': sfx([Y('twang', { f: 392, dur: 1.1, bright: 0.9 }, { gain: 0.3 }), S(['creak1', 'creak2', 'creak3'], 0.25, { pitch: 1.3 })], { wet: 0.25 }),
  'tension.snap': net([Y('crack', { dur: 0.07, hp: 1800 }, { gain: 0.6 }), Y('twang', { f: 220, bend: 2.2, bendDur: 0.05, dur: 0.6 }, { gain: 0.6 }), Y('whoosh', { dur: 0.2, f0: 2600, f1: 700, peak: 0.1, q: 1.4 }, { gain: 0.45 }), S('drawKnife1', 0.35, { pitch: 1.2 })], { wet: 0.35, duck: 0.2 }),
  'tension.cut': net([S(['knifeSlice', 'knifeSlice2'], 0.6), S(PUNCH_M, 0.35, { pitch: 1.1 }), Y('crack', { dur: 0.05, hp: 2000 }, { gain: 0.3 })], { wet: 0.3, every: 0.04 }),
  'tension.break': net([Y('crack', { dur: 0.09, hp: 1400 }, { gain: 0.6 }), Y('twang', { f: 523, bend: 1.8, bendDur: 0.04, dur: 0.4, bright: 0.95 }, { gain: 0.4 }), S(v('impactMetal_light_', 2), 0.3, { pitch: 1.4 })], { wet: 0.3 }),
  'tension.backlash': sfx([S(SOFT_M, 0.5, { pitch: 1.2 }), Y('crack', { dur: 0.06, hp: 2200 }, { gain: 0.5 }), Y('twang', { f: 466, bend: 1.6, bendDur: 0.05, dur: 0.35 }, { gain: 0.4 })], { wet: 0.2 }),
  'tension.reel': net([Y('whoosh', { dur: 0.5, f0: 300, f1: 2200, peak: 0.4 }, { gain: 0.5 }), Y('twang', { f: 196, bend: 0.5, bendDur: 0.4, dur: 0.6 }, { gain: 0.4 }), S(CLOTH, 0.4)]),
  'tension.sling': net([Y('whoosh', { dur: 0.35, f0: 200, f1: 1600, peak: 0.3 }, { gain: 0.5 }), Y('twang', { f: 175, bend: 1.6, bendDur: 0.06, dur: 0.5 }, { gain: 0.4 })]),
  'tension.slack.cast': net([S(CLOTH, 0.35, { pitch: 0.9 }), Y('inhale', { dur: 0.2, f1: 1800 }, { gain: 0.2 })]),
  'tension.slack': net([Y('twang', { f: 196, bend: 1.9, bendDur: 0.35, dur: 0.8, bright: 0.5 }, { gain: 0.5 }), S(CLOTH, 0.4, { pitch: 0.75 }), Y('whoosh', { dur: 0.3, f0: 900, f1: 250, peak: 0.2 }, { gain: 0.3 })], { wet: 0.3 }),
  'tension.spoil': net([S(SOFT_H, 0.45, { pitch: 0.8 }), Y('tone', { f: 330, glide: 110, dur: 0.35, lp: 900 }, { gain: 0.2 }), Y('thud', { f: 90, dur: 0.2 }, { gain: 0.5 })], { wet: 0.3 }),
  'tension.max.cast': sfx([Y('riser', { dur: 1.2, f0: 120, f1: 2000, tone: 0.5 }, { gain: 0.4 }), Y('twang', { f: 147, bend: 0.5, bendDur: 1.1, dur: 1.4, bright: 0.5 }, { gain: 0.35 })]),
  'tension.max.charge': sfx([Y('riser', { dur: 1.0, f0: 110, f1: 2400, tone: 0.45 }, { gain: 0.45 }), S(['creak1', 'creak2', 'creak3'], 0.5, { pitch: 0.8 }), Y('twang', { f: 110, bend: 0.5, bendDur: 0.9, dur: 1.4, bright: 0.4 }, { gain: 0.35 })], { duck: 0.6 }),
  'tension.max.spread': sfx([Y('twang', { f: 294, dur: 0.9 }, { gain: 0.35 }), Y('twang', { f: 392, dur: 0.9, bright: 0.9 }, { gain: 0.3, at: 0.07 }), Y('twang', { f: 440, dur: 0.9 }, { gain: 0.3, at: 0.14 }), Y('tear', { dur: 0.3 }, { gain: 0.25 })], { wet: 0.4 }),
  'tension.max.blow': sfx([Y('crack', { dur: 0.12, hp: 1200 }, { gain: 0.8 }), Y('twang', { f: 110, bend: 2.5, bendDur: 0.06, dur: 1.6 }, { gain: 0.8 }), Y('boom', { f0: 110, f1: 30, dur: 1.6 }, { gain: 1.0 }), S(['knifeSlice', 'knifeSlice2'], 0.7, { pitch: 0.8 }), Y('rumble', { dur: 1.8, lp: 260 }, { gain: 0.6 })], { wet: 0.6, duck: 1 }),
  'tension.max.tail': net([Y('twang', { f: 147, bend: 1.4, bendDur: 0.2, dur: 1.8, bright: 0.6 }, { gain: 0.45 }), S(MINING, 0.4, { pitch: 0.8 }), Y('rumble', { dur: 1.4, lp: 360 }, { gain: 0.5 })], { wet: 0.5 }),

  // ------------------------------------------------------------ Dark Dimension: a seam opened in space, things put away and let out
  'dark.cast': net([S(CLOTH, 0.32, { pitch: 1.15 }), Y('tear', { dur: 0.16 }, { gain: 0.22 })]),
  'dark.summon.cast': net([S(CLOTH, 0.3, { pitch: 0.95 }), Y('inhale', { dur: 0.2, f1: 1600 }, { gain: 0.16 })]),
  'dark.arsenal.cast': net([S(CLOTH, 0.25, { pitch: 1.3 }), S('tick_002', 0.3, { pitch: 1.4 }), S('tick_002', 0.25, { pitch: 1.6, at: 0.07 })]),
  'dark.seal': net([Y('hollow', { dur: 0.3 }, { gain: 0.9 }), Y('tear', { dur: 0.1 }, { gain: 0.25 }), S(SOFT_M, 0.3, { pitch: 0.6, at: 0.29 })], { wet: 0.15 }),
  'dark.summon': net([Y('hollow', { dur: 0.36, out: 1 }, { gain: 0.9 }), Y('whoosh', { dur: 0.3, f0: 1400, f1: 260, peak: 0.1 }, { gain: 0.35 })], { wet: 0.3 }),
  'dark.fizzle': net([Y('tear', { dur: 0.08 }, { gain: 0.18, pitch: 0.7 }), Y('hollow', { dur: 0.12, thump: 0.15 }, { gain: 0.25, pitch: 1.5 })]),
  'dark.refuse': net([Y('hollow', { dur: 0.16, out: 1, thump: 0.3 }, { gain: 0.5, pitch: 1.3 }), S(SOFT_M, 0.3, { pitch: 1.4 })]),
  'dark.strike': net([S(v('impactWood_heavy_', 2), 0.55, { pitch: 0.9 }), S(PUNCH_H, 0.45, { pitch: 0.85 }), Y('boom', { f0: 120, f1: 40, dur: 0.45 }, { gain: 0.5 })], { wet: 0.3, every: 0.05 }),
  'dark.water': net([Y('splash', { size: 2.2, bubbles: 6 }, { gain: 0.9 }), Y('thud', { f: 70, dur: 0.25 }, { gain: 0.4 })], { wet: 0.35 }),
  'dark.fire': net([Y('sizzle', { dur: 1.1, hp: 900, pops: 30 }, { gain: 0.45 }), Y('boom', { f0: 90, f1: 40, dur: 0.6 }, { gain: 0.5 }), Y('whoosh', { dur: 0.5, f0: 200, f1: 1200, peak: 0.2 }, { gain: 0.45 })], { wet: 0.35 }),
  'dark.fuel': net([Y('splash', { size: 1.2, bubbles: 2 }, { gain: 0.5, pitch: 0.7 })]),
  'dark.release': net([Y('hollow', { dur: 0.6, out: 1, thump: 0.9 }, { gain: 1, pitch: 0.7 }), Y('rumble', { dur: 1.0, lp: 420 }, { gain: 0.6 })], { wet: 0.45, duck: 0.4 }),
  'dark.max.cast': sfx([Y('riser', { dur: 1.2, f0: 70, f1: 900, tone: 0.6 }, { gain: 0.4 }), Y('hollow', { dur: 1.1, thump: 0.2 }, { gain: 0.25, pitch: 0.6 })]),
  'dark.max.charge': sfx([Y('riser', { dur: 1.0, f0: 60, f1: 1200, tone: 0.6 }, { gain: 0.45 }), Y('hollow', { dur: 1.0, thump: 0.4 }, { gain: 0.4, pitch: 0.5 })], { duck: 0.7 }),
  'dark.max.inhale': sfx([Y('hollow', { dur: 0.45, thump: 0 }, { gain: 0.8, pitch: 0.8 }), Y('inhale', { dur: 0.4, f1: 2200 }, { gain: 0.3 })]),
  'dark.max.blow': sfx([Y('hollow', { dur: 0.7, out: 1, thump: 1 }, { gain: 1.1, pitch: 0.6 }), S(PUNCH_H, 0.8, { pitch: 0.65 }), Y('boom', { f0: 90, f1: 28, dur: 1.6 }, { gain: 1 })], { wet: 0.55, duck: 1 }),
  'dark.max.tail': net([Y('hollow', { dur: 0.5, out: 1, thump: 0.5 }, { gain: 0.7, pitch: 0.8 }), Y('rumble', { dur: 1.4, lp: 400 }, { gain: 0.6 })], { wet: 0.5 }),

  // ------------------------------------------------------------ Friction: the grip of the skin, raised or let go
  'friction.cast': net([S(CLOTH, 0.35, { pitch: 1.05 }), Y('squeak', { f: 1500, glide: 2100, dur: 0.09, rate: 52 }, { gain: 0.16 })]),
  'friction.grip': net([S(SOFT_H, 0.5, { pitch: 1.1 }), Y('squeak', { f: 2300, glide: 1700, dur: 0.12, rate: 60 }, { gain: 0.3 }), Y('thud', { f: 110, dur: 0.1 }, { gain: 0.35 }), S(CLOTH, 0.4, { pitch: 0.8 })], { wet: 0.2 }),
  'friction.grip.whiff': net([Y('whoosh', { dur: 0.22, f0: 300, f1: 1600, peak: 0.5 }, { gain: 0.35 }), S(CLOTH, 0.3, { pitch: 1.2 })]),
  'friction.throw': net([Y('whoosh', { dur: 0.4, f0: 160, f1: 1400, peak: 0.35 }, { gain: 0.6 }), S(CLOTH, 0.45, { pitch: 0.7 }), Y('boom', { f0: 110, f1: 45, dur: 0.35 }, { gain: 0.35 })], { wet: 0.3 }),
  'friction.slam': net([S(PUNCH_H, 0.7, { pitch: 0.8 }), S(v('impactWood_heavy_', 2), 0.5, { pitch: 0.85 }), Y('crack', { dur: 0.08, hp: 1400 }, { gain: 0.45 }), Y('boom', { f0: 120, f1: 36, dur: 0.6 }, { gain: 0.7 })], { wet: 0.4, duck: 0.3 }),
  'friction.slips': net([Y('squeak', { f: 2600, glide: 700, dur: 0.22, rate: 38 }, { gain: 0.3 }), Y('whoosh', { dur: 0.2, f0: 900, f1: 300, peak: 0.2 }, { gain: 0.25 })]),
  'friction.wrist': net([Y('crack', { dur: 0.04, hp: 2200 }, { gain: 0.35 }), S(SOFT_M, 0.3, { pitch: 1.4 })]),
  'friction.slip.cast': net([Y('inhale', { dur: 0.18, f1: 3000 }, { gain: 0.2 }), S(CLOTH, 0.25, { pitch: 1.3 })]),
  'friction.push': net([S(v('footstep_wood_', 5), 0.45, { pitch: 0.8 }), Y('squeak', { f: 1900, glide: 1200, dur: 0.14, rate: 44 }, { gain: 0.32 }), Y('whoosh', { dur: 0.45, f0: 200, f1: 1100, peak: 0.25 }, { gain: 0.45 })]),
  'friction.skid': net([Y('whoosh', { dur: 0.36, f0: 2400, f1: 3200, peak: 0.5, q: 0.6 }, { gain: 0.22 }), Y('squeak', { f: 900, dur: 0.3, rate: 70, q: 3 }, { gain: 0.05 })], { every: 0.12 }),
  'friction.bowl': net([S(SOFT_H, 0.6, { pitch: 0.9 }), Y('thud', { f: 90, dur: 0.16 }, { gain: 0.6 }), Y('squeak', { f: 1400, glide: 900, dur: 0.12 }, { gain: 0.18 })], { wet: 0.25 }),
  'friction.glance': net([Y('squeak', { f: 3000, glide: 1400, dur: 0.1, rate: 64 }, { gain: 0.25 }), Y('whoosh', { dur: 0.18, f0: 1800, f1: 600, peak: 0.15 }, { gain: 0.3 })]),
  'friction.stop': net([Y('squeak', { f: 2100, glide: 2600, dur: 0.11, rate: 72 }, { gain: 0.34 }), Y('thud', { f: 120, dur: 0.07 }, { gain: 0.25 })], { every: 0.1 }),
  'friction.open': net([S(CLOTH, 0.3), Y('inhale', { dur: 0.22, f1: 1800 }, { gain: 0.18 }), Y('squeak', { f: 1200, dur: 0.08, rate: 40 }, { gain: 0.12 })]),
  'friction.climb': net([S(CLOTH, 0.22, { pitch: 1.2, vary: 0.1 }), Y('squeak', { f: 1600, dur: 0.06, rate: 56 }, { gain: 0.16 }), S(v('impactSoft_medium_', 3), 0.18, { pitch: 1.5 })], { every: 0.12 }),
  'friction.kick': net([Y('thud', { f: 100, dur: 0.12 }, { gain: 0.5 }), Y('whoosh', { dur: 0.3, f0: 260, f1: 1800, peak: 0.3 }, { gain: 0.45 }), S(CLOTH, 0.3, { pitch: 1.1 })]),
  'friction.rail': net([S(v('footstep_wood_', 5), 0.5, { pitch: 1.1, vary: 0.06 }), Y('squeak', { f: 2400, glide: 2900, dur: 0.07, rate: 80 }, { gain: 0.3 }), Y('thud', { f: 130, dur: 0.08 }, { gain: 0.35 })], { every: 0.06 }),
  'friction.max.cast': sfx([Y('riser', { dur: 1.2, f0: 140, f1: 2000, tone: 0.35 }, { gain: 0.4 }), Y('squeak', { f: 700, glide: 2600, dur: 1.1, rate: 30, q: 4 }, { gain: 0.06 })]),
  'friction.max.charge': sfx([Y('riser', { dur: 1.0, f0: 120, f1: 2600, tone: 0.4 }, { gain: 0.45 }), Y('squeak', { f: 600, glide: 3000, dur: 1.0, rate: 24, q: 4 }, { gain: 0.1 }), S(CLOTH, 0.35, { pitch: 0.7 })], { duck: 0.6 }),
  'friction.max.inhale': sfx([Y('squeak', { f: 3400, glide: 2200, dur: 0.4, rate: 90, q: 9 }, { gain: 0.3 }), S(CLOTH, 0.5, { pitch: 0.6 }), Y('inhale', { dur: 0.4, f1: 5000 }, { gain: 0.35 })]),
  'friction.max.blow': sfx([S(PUNCH_H, 1, { pitch: 0.6 }), S(MINING, 0.6, { pitch: 0.75 }), Y('crack', { dur: 0.1, hp: 1200 }, { gain: 0.7 }), Y('boom', { f0: 100, f1: 30, dur: 1.5 }, { gain: 1.1 }), Y('whoosh', { dur: 0.9, f0: 120, f1: 900, peak: 0.2 }, { gain: 0.6 })], { wet: 0.55, duck: 1 }),
  'friction.max.tail': net([Y('whoosh', { dur: 1.2, f0: 2600, f1: 3400, peak: 0.15, q: 0.5 }, { gain: 0.4 }), Y('rumble', { dur: 1.2, lp: 500 }, { gain: 0.6 }), Y('squeak', { f: 1100, glide: 500, dur: 0.9, rate: 34 }, { gain: 0.14 })], { wet: 0.45 }),

  // ------------------------------------------------------------ Fuel: vapour laid, herded, and lit by something else
  'fuel.cast': net([S(CLOTH, 0.3, { pitch: 0.95 }), Y('vent', { dur: 0.35, f: 700, glide: 1400, attack: 0.12 }, { gain: 0.3 })]),
  'fuel.lay': net([Y('vent', { dur: 0.7, f: 1100, glide: 500, flutter: 9 }, { gain: 0.45 }), S(CLOTH, 0.25, { pitch: 1.2 })]),
  'fuel.pour': net([Y('vent', { dur: 0.3, f: 800, flutter: 12 }, { gain: 0.22 })], { every: 0.22 }),
  'fuel.herd': net([Y('inhale', { dur: 0.4, f1: 1400 }, { gain: 0.25 }), Y('vent', { dur: 0.5, f: 420, glide: 300, flutter: 4 }, { gain: 0.3 })]),
  'fuel.herding': net([Y('vent', { dur: 0.45, f: 380, flutter: 3 }, { gain: 0.16 })], { every: 0.4 }),
  'fuel.soak': net([Y('vent', { dur: 0.25, f: 1800, glide: 900, attack: 0.02 }, { gain: 0.4 }), Y('splash', { size: 0.35, bubbles: 1 }, { gain: 0.2 })]),
  'fuel.clear': net([Y('whoosh', { dur: 0.45, f0: 900, f1: 260, peak: 0.25 }, { gain: 0.5 }), Y('vent', { dur: 0.4, f: 500 }, { gain: 0.2 })]),
  'fuel.take': net([Y('vent', { dur: 0.8, f: 300, glide: 1200, attack: 0.3 }, { gain: 0.45 }), Y('splash', { size: 0.8, bubbles: 3 }, { gain: 0.25 })]),
  'fuel.drum': net([S(v('impactMetal_light_', 2), 0.4, { pitch: 0.7 }), Y('vent', { dur: 1.2, f: 1400, flutter: 14 }, { gain: 0.45 })]),
  // The lighter: the lid's click, the wheel's rasp on the flint, the flame's soft catch.
  'fuel.lighter': net([Y('crack', { dur: 0.02, hp: 3500 }, { gain: 0.22 }), Y('sizzle', { dur: 0.1, hp: 2800, pops: 5 }, { gain: 0.25, at: 0.03 }), Y('vent', { dur: 0.3, f: 900, attack: 0.03 }, { gain: 0.16, at: 0.06 })]),
  'fuel.catch': net([Y('whump', { size: 0.5 }, { gain: 0.55 }), Y('sizzle', { dur: 0.4, hp: 900, pops: 8 }, { gain: 0.14 })], { every: 0.07 }),
  'fuel.flash': net([Y('whump', { size: 1.3 }, { gain: 0.95 }), Y('rumble', { dur: 1.3, lp: 600, attack: 0.03 }, { gain: 0.5 }), Y('sizzle', { dur: 1.0, hp: 1000, pops: 26 }, { gain: 0.25 })], { wet: 0.4, duck: 0.35, every: 0.2 }),
  'fuel.blast': net([S(MINING, 0.8, { pitch: 0.6 }), S(v('impactMetal_heavy_', 2), 0.5, { pitch: 0.55 }), Y('whump', { size: 2 }, { gain: 1.1 }), Y('crack', { dur: 0.1, hp: 900 }, { gain: 0.6 }), Y('rumble', { dur: 2, lp: 500 }, { gain: 0.8 })], { wet: 0.5, duck: 0.6 }),
  'fuel.alight': sfx([Y('sizzle', { dur: 0.5, hp: 1200, pops: 14 }, { gain: 0.3 }), Y('tone', { f: 180, glide: 120, dur: 0.35, lp: 500 }, { gain: 0.15 })], { every: 0.45 }),
  'fuel.max.cast': sfx([Y('riser', { dur: 1.2, f0: 70, f1: 1200, tone: 0.3 }, { gain: 0.4 }), Y('vent', { dur: 1.2, f: 300, glide: 1500, flutter: 5, attack: 0.9 }, { gain: 0.3 })]),
  'fuel.max.charge': sfx([Y('riser', { dur: 1.0, f0: 60, f1: 1500, tone: 0.3 }, { gain: 0.45 }), Y('vent', { dur: 1.1, f: 250, glide: 1800, flutter: 6, attack: 0.9 }, { gain: 0.45 })], { duck: 0.6 }),
  'fuel.max.inhale': sfx([Y('inhale', { dur: 0.5, f1: 2600 }, { gain: 0.6 }), Y('vent', { dur: 0.5, f: 2200, glide: 400 }, { gain: 0.3 })]),
  'fuel.max.blow': sfx([S(SOFT_H, 1, { pitch: 0.55 }), Y('splash', { size: 3, bubbles: 9 }, { gain: 0.7 }), Y('boom', { f0: 90, f1: 30, dur: 1.4 }, { gain: 1 }), Y('vent', { dur: 1.4, f: 600, glide: 200, flutter: 5 }, { gain: 0.7 })], { wet: 0.5, duck: 1 }),
  'fuel.max.tail': net([Y('vent', { dur: 2.2, f: 450, glide: 250, flutter: 3, attack: 0.2 }, { gain: 0.5 }), Y('rumble', { dur: 1.4, lp: 260 }, { gain: 0.35 })]),

  // ------------------------------------------------------------ Blink: a concussive pulse from the eyes
  'blink.cast': net([Y('tone', { f: 2800, glide: 5200, dur: 0.16 }, { gain: 0.07 }), Y('inhale', { dur: 0.16, f1: 5000 }, { gain: 0.25 })]),
  'blink.flinch': net([S(SOFT_H, 0.6, { pitch: 1.2 }), Y('boom', { f0: 160, f1: 55, dur: 0.35 }, { gain: 0.7 }), Y('whoosh', { dur: 0.22, f0: 900, f1: 300, peak: 0.1, q: 0.6 }, { gain: 0.6 }), Y('crack', { dur: 0.05 }, { gain: 0.35 })], { wet: 0.3 }),
  'blink.doubletake': net([Y('boom', { f0: 140, f1: 50, dur: 0.3 }, { gain: 0.6 }), Y('whoosh', { dur: 0.4, f0: 400, f1: 2200, peak: 0.3 }, { gain: 0.5 }), S(CLOTH, 0.35)]),
  'blink.max.cast': sfx([Y('riser', { dur: 1.2, f0: 300, f1: 5000, tone: 0.2 }, { gain: 0.35 }), Y('tone', { f: 3000, glide: 4200, dur: 1.2, attack: 1.0 }, { gain: 0.05 })]),
  'blink.max.charge': sfx([Y('riser', { dur: 1.0, f0: 300, f1: 6000, tone: 0.25 }, { gain: 0.45 }), Y('tone', { f: 3200, glide: 4400, dur: 1.0, attack: 0.9 }, { gain: 0.06 })], { duck: 0.6 }),
  'blink.max.inhale': sfx([Y('inhale', { dur: 0.5, f1: 9000 }, { gain: 0.5 })]),
  'blink.max.blow': sfx([S(BELL, 0.8, { pitch: 0.5 }), S(SOFT_H, 0.8, { pitch: 0.7 }), Y('crack', { dur: 0.12 }, { gain: 0.8 }), Y('boom', { f0: 120, f1: 30, dur: 1.5 }, { gain: 1.1 }), Y('tone', { f: 4200, dur: 2.8, attack: 0.02 }, { gain: 0.07 })], { wet: 0.6, duck: 1 }),
  'blink.max.tail': net([Y('boom', { f0: 100, f1: 34, dur: 1 }, { gain: 0.7 }), Y('whoosh', { dur: 0.6, f0: 1200, f1: 200, peak: 0.1 }, { gain: 0.6 })], { wet: 0.4 }),

  // ------------------------------------------------------------ Heat: any energy in, only heat out
  'heat.cast': net([S(CLOTH, 0.3), Y('inhale', { dur: 0.24, f1: 1800 }, { gain: 0.32 }), Y('sizzle', { dur: 0.3, hp: 5200 }, { gain: 0.1 })]),
  'heat.sear': net([S(SOFT_H, 0.45, { pitch: 0.9 }), Y('sizzle', { dur: 0.9, hp: 2800 }, { gain: 0.55 }), Y('boom', { f0: 120, f1: 45, dur: 0.4 }, { gain: 0.45 }), Y('whoosh', { dur: 0.22, f0: 500, f1: 1600, peak: 0.15 }, { gain: 0.3 })], { wet: 0.3 }),
  'heat.whiff': net([Y('whoosh', { dur: 0.28, f0: 240, f1: 1200, peak: 0.4 }, { gain: 0.4 }), Y('sizzle', { dur: 0.35, hp: 6000 }, { gain: 0.14 })]),
  'heat.spot': net([Y('sizzle', { dur: 0.55, hp: 4400 }, { gain: 0.32 }), Y('tone', { f: 1600, glide: 700, dur: 0.22 }, { gain: 0.035 }), Y('thud', { f: 130, dur: 0.08 }, { gain: 0.2 })], { every: 0.05 }),
  'heat.steam': net([Y('sizzle', { dur: 1.4, hp: 1600, attack: 0.03 }, { gain: 0.6 }), Y('splash', { size: 0.6, bubbles: 3 }, { gain: 0.3 }), Y('whoosh', { dur: 0.9, f0: 500, f1: 2600, peak: 0.15 }, { gain: 0.35 })], { wet: 0.4, every: 0.15 }),
  'heat.glow': net([S(v('impactMetal_light_', 2), 0.3, { pitch: 0.7 }), Y('tone', { f: 140, dur: 0.8, type: 1, lp: 500 }, { gain: 0.12 }), Y('sizzle', { dur: 0.5, hp: 5000 }, { gain: 0.12 })], { every: 0.08 }),
  'heat.ignite': net([Y('whoosh', { dur: 0.6, f0: 120, f1: 900, peak: 0.3 }, { gain: 0.6 }), Y('rumble', { dur: 1.2, lp: 600, attack: 0.05 }, { gain: 0.5 }), Y('sizzle', { dur: 0.8, hp: 900, pops: 30 }, { gain: 0.3 })], { wet: 0.3, every: 0.1 }),
  'heat.burn': net([Y('sizzle', { dur: 0.5, hp: 900, pops: 20 }, { gain: 0.22 }), Y('rumble', { dur: 0.5, lp: 380 }, { gain: 0.18 })], { every: 0.25 }),
  'heat.convert': net([Y('inhale', { dur: 0.3, f1: 2200 }, { gain: 0.35 }), Y('tone', { f: 70, dur: 0.6, type: 1, lp: 300 }, { gain: 0.35 }), S(CLOTH, 0.3, { pitch: 0.9 })]),
  'heat.converted': net([S(SOFT_H, 0.45, { pitch: 0.8, lp: 1200 }), Y('sizzle', { dur: 0.7, hp: 2600 }, { gain: 0.45 }), Y('thud', { f: 80, dur: 0.2 }, { gain: 0.5 })], { wet: 0.3, every: 0.05 }),
  'heat.overrun': net([S(PUNCH_M, 0.5, { pitch: 0.9 }), Y('sizzle', { dur: 0.4, hp: 1800 }, { gain: 0.35 }), Y('crack', { dur: 0.05 }, { gain: 0.3 })], { every: 0.05 }),
  'heat.drain': net([S(v('impactWood_medium_', 2), 0.35, { pitch: 0.8 }), Y('tone', { f: 300, glide: 80, dur: 0.4, lp: 800 }, { gain: 0.15 }), Y('sizzle', { dur: 0.3 }, { gain: 0.15 })], { every: 0.05 }),
  'heat.vent': sfx([Y('sizzle', { dur: 1.8, hp: 1400, attack: 0.05 }, { gain: 0.45 }), Y('inhale', { dur: 0.8, f1: 900 }, { gain: 0.2 })], { every: 0.6 }),
  'heat.overheat': sfx([Y('sizzle', { dur: 0.5, hp: 2400 }, { gain: 0.25 }), Y('tone', { f: 160, glide: 110, dur: 0.4, lp: 600 }, { gain: 0.2 })], { every: 0.4 }),
  'heat.max.cast': sfx([Y('riser', { dur: 1.2, f0: 90, f1: 1600, tone: 0.6 }, { gain: 0.45 }), Y('sizzle', { dur: 1.2, hp: 3000, attack: 1.0 }, { gain: 0.25 })]),
  'heat.max.charge': sfx([Y('riser', { dur: 1.0, f0: 80, f1: 2000, tone: 0.6 }, { gain: 0.5 }), Y('sizzle', { dur: 1.1, hp: 2400, attack: 0.9 }, { gain: 0.35 }), Y('rumble', { dur: 1.2, lp: 300, attack: 0.8 }, { gain: 0.35 })], { duck: 0.6 }),
  'heat.max.inhale': sfx([Y('inhale', { dur: 0.5, f1: 6000 }, { gain: 0.55 }), Y('sizzle', { dur: 0.5, hp: 6000, attack: 0.45 }, { gain: 0.3 })]),
  'heat.max.blow': sfx([S(SOFT_H, 1, { pitch: 0.6 }), S(MINING, 0.5, { pitch: 0.6 }), Y('crack', { dur: 0.1, hp: 1200 }, { gain: 0.7 }), Y('boom', { f0: 100, f1: 28, dur: 1.6 }, { gain: 1.1 }), Y('sizzle', { dur: 2.4, hp: 1200, attack: 0.02 }, { gain: 0.8 }), Y('rumble', { dur: 2.2, lp: 500 }, { gain: 0.7 })], { wet: 0.6, duck: 1 }),
  'heat.max.tail': net([Y('sizzle', { dur: 2.2, hp: 1500, attack: 0.05 }, { gain: 0.55 }), Y('rumble', { dur: 1.6, lp: 420 }, { gain: 0.6 }), Y('whoosh', { dur: 1.2, f0: 300, f1: 2000, peak: 0.2 }, { gain: 0.35 })], { wet: 0.5 }),

  // ------------------------------------------------------------ props and bodies
  'prop.wood': net([S(v('impactWood_heavy_', 2), 0.6, { vary: 0.1 }), Y('thud', { f: 100, dur: 0.12 }, { gain: 0.3 })], { wet: 0.3, every: 0.05 }),
  'prop.metal': net([S(v('impactMetal_heavy_', 2), 0.55, { vary: 0.1 }), Y('shimmer', { f: 340, dur: 0.6 }, { gain: 0.08 })], { wet: 0.3, every: 0.05 }),
  'prop.drop': sfx([S(v('impactWood_light_', 2), 0.45), S(v('impactMetal_light_', 2), 0.25)], { wet: 0.3 }),
  'prop.land': sfx([S(v('impactWood_heavy_', 2), 0.55), S(v('impactPlank_medium_', 2), 0.35), Y('thud', { f: 85, dur: 0.18 }, { gain: 0.45 })], { wet: 0.3 }),

  // Hit weight: four tiers by damage (Audio.hit picks one and passes the weight).
  'hit.light': sfx([S(PUNCH_M, 0.55, { vary: 0.08 }), Y('thud', { f: 110, dur: 0.1 }, { gain: 0.35 })], { every: 0.03 }),
  'hit.medium': sfx([S(PUNCH_M, 0.6), S(PUNCH_H, 0.4), Y('thud', { f: 95, dur: 0.16 }, { gain: 0.55, w: 0.6 })], { every: 0.03, wet: 0.25 }),
  'hit.heavy': sfx([S(PUNCH_H, 0.8), Y('crack', { dur: 0.07 }, { gain: 0.45 }), Y('boom', { f0: 130, f1: 42, dur: 0.55 }, { gain: 0.8, w: 0.6 })], { every: 0.03, wet: 0.35, duck: 0.35 }),
  'hit.crushing': sfx([S(PUNCH_H, 1, { pitch: 0.8 }), S(MINING, 0.45, { pitch: 0.9 }), Y('crack', { dur: 0.1, hp: 1400 }, { gain: 0.65 }), Y('boom', { f0: 110, f1: 30, dur: 1.1 }, { gain: 0.9 }), Y('rumble', { dur: 0.9 }, { gain: 0.45 })], { every: 0.03, wet: 0.45, duck: 0.6 }),
  'body.down': sfx([S(SOFT_H, 0.6, { pitch: 0.8 }), Y('thud', { f: 70, dur: 0.25 }, { gain: 0.6, at: 0.05 }), S(CLOTH, 0.3, { pitch: 0.8 })], { wet: 0.3 }),
  'hurt': sfx([S(PUNCH_H, 0.75, { vary: 0.08 }), Y('thud', { f: 75, dur: 0.22 }, { gain: 0.7, w: 0.7 }), Y('crack', { dur: 0.05 }, { gain: 0.3, w: 1 })], { every: 0.05, duck: 0.4 }),
  'hurt.self': sfx([S(SOFT_H, 0.5, { pitch: 0.8 }), Y('tone', { f: 180, glide: 90, dur: 0.35, lp: 500 }, { gain: 0.3 })], { every: 0.1 }),
  'heartbeat': sfx([Y('heartbeat', { gain: 0.7 })], { wet: 0 }),

  // ------------------------------------------------------------ the compound's fighters
  'enemy.swing': sfx([S(CLOTH, 0.5, { vary: 0.1 }), Y('whoosh', { dur: 0.22, f0: 220, f1: 1500, peak: 0.6 }, { gain: 0.75 })]),
  'enemy.palm': sfx([S(BELL, 0.55, { pitch: 0.7 }), Y('boom', { f0: 110, f1: 40, dur: 0.7 }, { gain: 0.7 }), Y('shimmer', { f: 392, dur: 1.4 }, { gain: 0.12 })], { wet: 0.5 }),
  'kuroda.fuel': sfx([S('spaceTrash1', 0.25, { pitch: 0.55, lp: 1800 }), Y('splash', { size: 1.3, bubbles: 5 }, { gain: 0.45 })]),
  'kuroda.ignite': sfx([S(MINING, 0.7, { pitch: 0.7 }), Y('riser', { dur: 0.12, f0: 300, f1: 3000, tone: 0 }, { gain: 0.6 }), Y('rumble', { dur: 1.6, lp: 700, attack: 0.02 }, { gain: 0.8 }), Y('boom', { f0: 90, f1: 35, dur: 0.9 }, { gain: 0.8 }), Y('tinkle', { count: 14, spread: 1.0, lo: 700, hi: 2400 }, { gain: 0.5 })], { wet: 0.4, duck: 0.6 }),
  'ancient.charge': sfx([Y('riser', { dur: 1.05, f0: 120, f1: 1600, tone: 0.4 }, { gain: 0.4 }), Y('shimmer', { f: 196, dur: 1.2 }, { gain: 0.15 })]),
  'ancient.wave': sfx([S(BELL, 0.8, { pitch: 0.6 }), Y('boom', { f0: 100, f1: 30, dur: 1.3 }, { gain: 1 }), Y('rumble', { dur: 1.4 }, { gain: 0.6 }), Y('shimmer', { f: 262, dur: 2 }, { gain: 0.2 })], { wet: 0.6, duck: 0.7 }),

  // The bosses' Maximum Outputs, on the same grammar as the player's.
  'ancient.max.charge': sfx([Y('riser', { dur: 1.0, f0: 100, f1: 2000, tone: 0.5 }, { gain: 0.5 }), Y('shimmer', { f: 131, dur: 1.6 }, { gain: 0.25 })], { duck: 0.6 }),
  'ancient.max.drop': sfx([S(BELL, 0.5, { pitch: 0.4 }), Y('inhale', { dur: 0.5 }, { gain: 0.4 })]),
  'ancient.max.blow': sfx([S(BELL, 1, { pitch: 0.35 }), Y('crack', { dur: 0.1, hp: 1400 }, { gain: 0.6 }), Y('boom', { f0: 90, f1: 28, dur: 2 }, { gain: 1.1 }), Y('shimmer', { f: 131, dur: 3 }, { gain: 0.35 }), Y('rumble', { dur: 2 }, { gain: 0.7 })], { wet: 0.8, duck: 1 }),
  'kuroda.max.charge': sfx([Y('riser', { dur: 1.0, f0: 120, f1: 2600, tone: 0.4 }, { gain: 0.5 }), Y('splash', { size: 2, bubbles: 6 }, { gain: 0.4 })], { duck: 0.6 }),
  'kuroda.max.pour': sfx([Y('splash', { size: 2.5, bubbles: 8 }, { gain: 0.6 }), Y('inhale', { dur: 0.5, f1: 5000 }, { gain: 0.45 })]),
  'kuroda.max.blow': sfx([S(MINING, 1, { pitch: 0.65 }), S(v('impactMetal_heavy_', 2), 0.5, { pitch: 0.6 }), Y('crack', { dur: 0.12, hp: 1000 }, { gain: 0.8 }), Y('boom', { f0: 100, f1: 28, dur: 1.8 }, { gain: 1.1 }), Y('rumble', { dur: 2.4, lp: 700 }, { gain: 0.9 }), Y('tinkle', { count: 24, spread: 1.6, lo: 600, hi: 2200 }, { gain: 0.6 })], { wet: 0.6, duck: 1 }),
  // The title card of any Maximum Output, as it lands.
  'cutscene.title': sfx([S(BELL, 0.3, { pitch: 1.6 }), Y('shimmer', { f: 1046.5, dur: 1.2 }, { gain: 0.1 }), Y('taiko', { f: 140, dur: 0.5 }, { gain: 0.35 })], { wet: 0.5 }),

  // ------------------------------------------------------------ aura
  'aura.expand': sfx([Y('inhale', { dur: 0.3, f1: 4000 }, { gain: 0.45 }), Y('boom', { f0: 90, f1: 40, dur: 0.9 }, { gain: 0.85, at: 0.3 }), Y('whoosh', { dur: 0.7, f0: 200, f1: 2600, peak: 0.25 }, { gain: 0.6, at: 0.3 }), Y('shimmer', { f: 392, dur: 1.8 }, { gain: 0.18, at: 0.3 })], { wet: 0.6, net: true, duck: 0.4 }),
  'aura.push': sfx([Y('riser', { dur: 1.1, f0: 70, f1: 520, tone: 0.35 }, { gain: 0.32 }), Y('whoosh', { dur: 1.1, f0: 120, f1: 900, peak: 0.8 }, { gain: 0.3 })], { wet: 0.5, net: true }),
  'aura.release': sfx([Y('boom', { f0: 80, f1: 34, dur: 0.9 }, { gain: 0.75 }), Y('whoosh', { dur: 0.6, f0: 300, f1: 2200, peak: 0.2 }, { gain: 0.5 })], { wet: 0.6, net: true, duck: 0.3 }),
  'aura.retract': sfx([Y('whoosh', { dur: 0.6, f0: 2000, f1: 200, peak: 0.2 }, { gain: 0.85 }), Y('tone', { f: 392, glide: 130, dur: 0.6 }, { gain: 0.16 })], { net: true }),
  'aura.collapse': sfx([S(GLASS_H, 0.85, { pitch: 0.8 }), Y('crack', { dur: 0.12, hp: 1600 }, { gain: 0.6 }), Y('tinkle', { count: 20, spread: 0.9, lo: 1200 }, { gain: 0.8 }), Y('boom', { f0: 100, f1: 34, dur: 0.8 }, { gain: 0.7 })], { wet: 0.5, net: true, duck: 0.6 }),
  'aura.denied': ui([S('error_004', 0.25, { pitch: 0.8 })]),
  // Bare hands (src/combat/melee.ts): a short cut of air and sleeve under each
  // blow, the hit itself is the shared hit tier; the aura strike inhales as
  // the fist fills and lands a low boom with a crack on its front.
  'melee.swing': net([S(CLOTH, 0.4, { pitch: 1.2, vary: 0.12 }), Y('whoosh', { dur: 0.14, f0: 500, f1: 2400, peak: 0.4 }, { gain: 0.45 })], { every: 0.05 }),
  'melee.gather': net([Y('inhale', { dur: 0.4, f1: 3200 }, { gain: 0.4 }), Y('shimmer', { f: 523.25, dur: 0.5 }, { gain: 0.12 })], { wet: 0.4 }),
  'melee.strike': net([S(PUNCH_H, 0.7, { pitch: 0.85 }), Y('crack', { dur: 0.06, hp: 1500 }, { gain: 0.4 }), Y('boom', { f0: 110, f1: 38, dur: 0.6 }, { gain: 0.75 }), Y('whoosh', { dur: 0.35, f0: 260, f1: 1800, peak: 0.15 }, { gain: 0.35 })], { wet: 0.45, duck: 0.35, every: 0.05 }),
  'clash.begin': sfx([S(BELL, 0.7, { pitch: 0.55 }), Y('riser', { dur: 0.6, f0: 200, f1: 3000 }, { gain: 0.4 }), Y('boom', { f0: 80, f1: 30, dur: 1.4 }, { gain: 0.9, at: 0.05 })], { wet: 0.6, duck: 0.8 }),
  'clash.round': sfx([Y('taiko', { f: 110 }, { gain: 0.8 }), S('tick_001', 0.35)]),
  'clash.pick': ui([S('click_003', 0.5), Y('thud', { f: 140, dur: 0.08 }, { gain: 0.3 })]),
  'clash.tell.push': sfx([Y('whoosh', { dur: 0.35, f0: 200, f1: 1600 }, { gain: 0.35 }), Y('boom', { f0: 70, f1: 40, dur: 0.4 }, { gain: 0.35 })]),
  'clash.tell.hold': sfx([S(SOFT_H, 0.4, { pitch: 0.7 }), Y('tone', { f: 98, dur: 0.6, lp: 300 }, { gain: 0.25 })]),
  'clash.tell.feint': sfx([S('glitch_001', 0.3, { pitch: 1.3 }), Y('tear', { dur: 0.08 }, { gain: 0.25 })]),
  'clash.won.round': sfx([S(BELL, 0.6, { pitch: 1.15 }), Y('shimmer', { f: 784, dur: 1 }, { gain: 0.14 })], { wet: 0.5 }),
  'clash.lost.round': sfx([S(BELL, 0.6, { pitch: 0.75 }), Y('boom', { f0: 90, f1: 40, dur: 0.5 }, { gain: 0.5 })], { wet: 0.5 }),
  'clash.even.round': sfx([S(GLASS_L, 0.5), Y('crack', { dur: 0.05 }, { gain: 0.2 })]),
  'clash.won': sfx([S(GLASS_H, 0.85, { pitch: 0.9 }), Y('tinkle', { count: 16, spread: 0.8 }, { gain: 0.8 }), Y('boom', { f0: 100, f1: 36, dur: 0.9 }, { gain: 0.7 })], { wet: 0.5, duck: 0.6 }),

  // ------------------------------------------------------------ fights, wagers, defeat
  'wager.arm': sfx([S('question_002', 0.4), Y('shimmer', { f: 988, dur: 0.8 }, { gain: 0.1 })]),
  'wager.won': sfx([S('confirmation_002', 0.55), Y('shimmer', { f: 1318, dur: 1.2 }, { gain: 0.14 }), Y('pluck', { f: 659.25 }, { gain: 0.6, at: 0.08 })]),
  'wager.lost': sfx([S('glitch_001', 0.5), Y('tone', { f: 220, glide: 70, dur: 0.6, type: 3, lp: 900 }, { gain: 0.15 })]),
  'encounter.start': sfx([Y('taiko', { f: 95, dur: 1 }, { gain: 0.7 }), Y('taiko', { f: 95, dur: 1 }, { gain: 0.55, at: 0.32 })], { wet: 0.5 }),
  'encounter.clear': sfx([S('confirmation_002', 0.55), Y('pluck', { f: 587.33 }, { gain: 0.6 }), Y('pluck', { f: 739.99 }, { gain: 0.55, at: 0.12 }), Y('pluck', { f: 880 }, { gain: 0.6, at: 0.24 })], { wet: 0.4 }),
  // The officer's whistle: two short shrill blasts with a pea's warble.
  'city.whistle': sfx([Y('tone', { f: 2950, dur: 0.22, type: 1 }, { gain: 0.16 }), Y('tone', { f: 3080, dur: 0.5, type: 1, glide: 2900 }, { gain: 0.18, at: 0.3 }), Y('whoosh', { dur: 0.7, f0: 2400, f1: 3600 }, { gain: 0.06, at: 0.05 })], { wet: 0.35, every: 1 }),
  'defeat': sfx([S('lowDown', 0.5, { pitch: 0.6 }), Y('boom', { f0: 70, f1: 28, dur: 2 }, { gain: 0.9 }), Y('tone', { f: 147, glide: 73, dur: 2.2, type: 1, lp: 600 }, { gain: 0.2 })], { wet: 0.6, duck: 1 }),

  // ------------------------------------------------------------ drills
  'drill.ready': sfx([Y('clack', { f: 1900, gap: 0.14 }, { gain: 1.4 })], { wet: 0.5 }),
  'drill.start': sfx([Y('clack', { f: 2100 }, { gain: 1 }), Y('taiko', { f: 120, dur: 0.6 }, { gain: 0.6 })], { wet: 0.5 }),
  'drill.cue': sfx([Y('clack', { f: 1700 }, { gain: 1.1 }), S('tick_002', 0.25, { pitch: 1.2 })], { wet: 0.4 }),
  'drill.hit': sfx([S('confirmation_001', 0.4), Y('pluck', { f: 880, bright: 1 }, { gain: 0.55 })], { wet: 0.3 }),
  'drill.miss': sfx([S('error_006', 0.35), Y('thud', { f: 90, dur: 0.15 }, { gain: 0.35 })]),
  'drill.tier': sfx([S('powerUp9', 0.3), S('bong_001', 0.4, { pitch: 0.9 }), Y('pluck', { f: 587.33 }, { gain: 0.55 }), Y('pluck', { f: 659.25 }, { gain: 0.5, at: 0.1 }), Y('pluck', { f: 880 }, { gain: 0.5, at: 0.2 }), Y('pluck', { f: 1174.66 }, { gain: 0.55, at: 0.3 }), Y('shimmer', { f: 1174.66, dur: 1.6 }, { gain: 0.12, at: 0.3 })], { wet: 0.5 }),
  'drill.fail': sfx([S('lowDown', 0.35), Y('pluck', { f: 293.66, bright: 0 }, { gain: 0.5 }), Y('pluck', { f: 277.18, bright: 0 }, { gain: 0.45, at: 0.18 })], { wet: 0.4 }),

  // ------------------------------------------------------------ Eyes: heard by the bearer alone
  'eye.install': ui([S(CLOTH, 0.25, { pitch: 0.8 }), Y('thud', { f: 70, dur: 0.3 }, { gain: 0.55, at: 0.38 }), Y('tone', { f: 110, dur: 1.1, type: 1, lp: 500 }, { gain: 0.14, at: 0.4 }), Y('pluck', { f: 659.25, dur: 1.2 }, { gain: 0.28, at: 0.95 }), Y('shimmer', { f: 1318.5, dur: 1.6 }, { gain: 0.1, at: 0.95 })], { duck: 0.5 }),
  'eye.horizon.open': sfx([Y('pluck', { f: 987.77, dur: 0.5, bright: 1 }, { gain: 0.25 }), Y('shimmer', { f: 1975.5, dur: 0.5 }, { gain: 0.06 })], { every: 0.2, wet: 0.3 }),
  'eye.thread.carry': sfx([Y('pluck', { f: 392, dur: 0.4 }, { gain: 0.25 }), Y('whoosh', { dur: 0.18, f0: 900, f1: 2400 }, { gain: 0.12 })], { every: 0.1 }),
  'eye.thread.snap': sfx([Y('crack', { dur: 0.04, hp: 3000 }, { gain: 0.3 }), Y('pluck', { f: 196, dur: 0.3, bright: 0 }, { gain: 0.3 })], { every: 0.15 }),
  'eye.empty.through': sfx([Y('thud', { f: 60, dur: 0.12 }, { gain: 0.3 }), Y('whoosh', { dur: 0.12, f0: 1800, f1: 300 }, { gain: 0.15 })], { every: 0.12 }),

  // ------------------------------------------------------------ rooftop trial
  'roof.begin': sfx([Y('taiko', { f: 100, dur: 1 }, { gain: 0.9 }), Y('whoosh', { dur: 0.8, f0: 200, f1: 1200 }, { gain: 0.3 })], { wet: 0.5 }),
  'roof.wave': sfx([Y('taiko', { f: 110 }, { gain: 0.55 }), Y('taiko', { f: 110 }, { gain: 0.4, at: 0.18 }), Y('taiko', { f: 90, dur: 1 }, { gain: 0.6, at: 0.36 })], { wet: 0.4 }),
  'roof.boss': sfx([S(v('impactMetal_heavy_', 2), 0.6, { pitch: 0.6 }), Y('boom', { f0: 80, f1: 30, dur: 1.4 }, { gain: 0.6 }), Y('taiko', { f: 80, dur: 1.2 }, { gain: 0.6 })], { wet: 0.5, duck: 0.6 }),
  'roof.spawn': sfx([S(v('impactMetal_medium_', 1), 0.3, { pitch: 1.1 }), Y('thud', { f: 90, dur: 0.14 }, { gain: 0.3 })]),
  'roof.clear': sfx([S('confirmation_002', 0.6), Y('taiko', { f: 120 }, { gain: 0.6 })]),
  'roof.won': sfx([S('confirmation_002', 0.7), Y('pluck', { f: 587.33 }, { gain: 0.6 }), Y('pluck', { f: 783.99 }, { gain: 0.6, at: 0.14 }), Y('pluck', { f: 1174.66 }, { gain: 0.6, at: 0.28 }), Y('taiko', { f: 100, dur: 1 }, { gain: 0.8, at: 0.28 })], { wet: 0.5 }),
  'roof.lost': sfx([S('lowDown', 0.5, { pitch: 0.6 }), Y('boom', { f0: 70, f1: 30, dur: 1.6 }, { gain: 0.55 })], { wet: 0.5 }),

  // ------------------------------------------------------------ interface
  'ui.hover': ui([S('tick_001', 0.06, { pitch: 1.4, vary: 0.05 })], { every: 0.04 }),
  'ui.click': ui([S('click_002', 0.3, { vary: 0.05 })], { every: 0.03 }),
  'ui.select': ui([S('select_001', 0.4), Y('pluck', { f: 1174.66, dur: 0.6, bright: 1 }, { gain: 0.12 })]),
  'ui.open': ui([S('open_001', 0.4)]),
  'ui.close': ui([S('close_001', 0.4)]),
  'ui.toast': ui([S('pluck_001', 0.35), Y('pluck', { f: 1318.5, dur: 0.8, bright: 1 }, { gain: 0.1 })], { every: 0.1 }),
  'ui.toast.good': ui([S('confirmation_001', 0.3), Y('pluck', { f: 1567.98, dur: 0.8, bright: 1 }, { gain: 0.12 })], { every: 0.1 }),
  'ui.toast.bad': ui([S('error_006', 0.22)], { every: 0.15 }),
  'ui.banner': ui([S('bong_001', 0.4, { pitch: 0.75 }), Y('taiko', { f: 110, dur: 0.6 }, { gain: 0.45 })], { every: 0.3 }),
  'ui.plaque': ui([S('glass_002', 0.3), S(['bookFlip1', 'bookFlip2'], 0.35)]),
  'ui.workshop.open': ui([S(['bookFlip1', 'bookFlip2'], 0.5), S('open_001', 0.25, { pitch: 0.9 })]),
  'ui.workshop.close': ui([S('bookPlace1', 0.5), S('close_001', 0.2, { pitch: 0.9 })]),
  'ui.inscribe': ui([S('drawKnife1', 0.18, { pitch: 1.4 }), Y('shimmer', { f: 784, dur: 1.4 }, { gain: 0.12 }), Y('taiko', { f: 140, dur: 0.5 }, { gain: 0.4 })]),
  'ui.track': ui([S('select_002', 0.35)]),
  'ui.arrive': ui([S('confirmation_001', 0.4), Y('pluck', { f: 987.77, dur: 0.9 }, { gain: 0.25 })]),
  'ui.step': ui([S('select_003', 0.35)]),
  'ui.step.done': ui([S('confirmation_001', 0.45), Y('pluck', { f: 1174.66, dur: 0.8 }, { gain: 0.2 })]),
  'ui.camera': ui([S('switch_002', 0.3)]),
  'ui.pause': ui([S('open_001', 0.3, { pitch: 0.85 }), Y('tone', { f: 392, dur: 0.25, lp: 1200 }, { gain: 0.06 })]),
  'ui.resume': ui([S('close_001', 0.3, { pitch: 0.85 })]),
} satisfies Record<string, Cue>;

export type CueName = keyof typeof CUES;
export const isCue = (name: unknown): name is CueName => typeof name === 'string' && Object.prototype.hasOwnProperty.call(CUES, name);
