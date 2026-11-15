import * as THREE from 'three';
import { signal } from '@preact/signals';
import type { TechniqueKit } from '../kit';
import { signGesture, gestureSet, rangeFor, hitCone, propsInCone, shoveProps } from './shared';
import type { Pact } from '../../pacts/schema';
import { opening, blow, type CutsceneDef } from '../../cutscene/cutscene';

const COLOR = 0xc6a8ff;
export const blinkUi = { blind: signal(0), stare: signal(0) };
let stare = 0;

const catalogue: Pact[] = [
  { id: 'blink.flinch', technique: 'blink', name: 'Flinch', slot: 'primary', grant: { shape: 'flinch', behaviors: ['staring'] }, clauses: [
    { kind: 'restrict', restriction: { param: 'direction', value: 'front' } }, { kind: 'restrict', restriction: { param: 'body', value: 'eyes' } }] },
  { id: 'blink.doubletake', technique: 'blink', name: 'Doubletake', slot: 'secondary', grant: { shape: 'doubletake' }, clauses: [
    { kind: 'restrict', restriction: { param: 'direction', value: 'ground' } }, { kind: 'restrict', restriction: { param: 'target', value: 'self' } }] },
  { id: 'blink.eyes-shut', technique: 'blink', name: 'Eyes Shut', slot: 'max', grant: { shape: 'eyesShut' }, clauses: [
    { kind: 'restrict', restriction: { param: 'resource', value: 'all' } }, { kind: 'restrict', restriction: { param: 'trigger', value: 'eyesClosed' } }, { kind: 'restrict', restriction: { param: 'body', value: 'eyes' } }] },
];

// Eyes Shut: an extreme close-up as the hands veil the eyes, over the
// shoulder onto the target, then from in front of the target as the pulse
// comes straight down the lens, and a wide side-on of the aftermath.
const cutscene: CutsceneDef = {
  id: 'max-blink', title: { jp: '閉眼', en: 'Eyes Shut' }, color: COLOR, pull: 4.5, reach: 12,
  shots: [
    { duration: 1.05, timeScale: 0.03, from: { pos: [0.42, 1.55, 1.05], look: [0, 1.5, 0], fov: 34 }, to: { pos: [0.28, 1.53, 0.78], fov: 26, roll: -0.03 }, events: opening('powerUp9', 0.6) },
    { duration: 0.5, timeScale: 0.03, from: { pos: [0.55, 1.8, -1.1], look: [0, 1.35, 0], lookRel: 'target', fov: 50 }, to: { pos: [0.45, 1.75, -0.8], fov: 42 }, ease: 'in', events: [{ at: 0.05, kind: 'sfx', id: 'phaserUp3', pitch: 0.6 }] },
    { duration: 0.95, timeScale: 0.3, from: { rel: 'target', pos: [-1.3, 1.45, 2.6], look: [0, 1.45, 0], lookRel: 'mid', fov: 64 }, to: { pos: [-1.8, 1.6, 3.8], fov: 84, roll: 0.06 }, events: [...blow(0, 'impactBell_heavy_002', 0.5)] },
    { duration: 0.75, timeScale: 0.5, from: { rel: 'mid', pos: [6, 1.8, -0.5], look: [0, 1.0, 0.5], fov: 56 }, to: { pos: [6.6, 2.3, -1], fov: 52 }, ease: 'inOut' },
  ],
};

export const blink: TechniqueKit = {
  id: 'blink', name: 'Blink', glyph: '瞬', color: COLOR, type: 'Manifestation',
  blurb: 'Close both eyes and a concussive pulse leaves your tear ducts. It cannot curve and it cannot fire anywhere but forward.',
  breadth: 1,
  resource: { name: 'Tears', max: 100, regen: 9, startsFull: true },
  primitive: { name: 'Blink', short: 'a weak forward pulse', description: 'A weak pressure pulse from the eyes when they close. Only forward. Only ever forward.' },
  parameters: ['direction', 'range', 'target', 'trigger', 'duration', 'resource', 'body'],
  shapes: {
    flinch: { label: 'fires a forward pressure cone from the eyes', short: 'pressure cone from the eyes', kinds: ['primary'], description: 'A forward cone that shoves people and objects.' },
    doubletake: { label: 'blinks at the ground to launch you backward', short: 'blink to leap backward', kinds: ['secondary'], description: 'A mobility pulse.' },
    eyesShut: { label: 'empties both glands in one pulse and leaves you blind', short: 'empty both eyes, go blind', kinds: ['max'], description: 'Everything in front, and a few seconds of darkness.' },
  },
  behaviors: { staring: 'every second you do not blink strengthens the next pulse', wide: 'a wider, weaker cone', narrow: 'a tight, longer lance' },
  catalogue,
  gestures: {
    primary: gestureSet(0.5, 0.22, [{ t: 0, right: 'cupEyes', left: 'cupEyes', slow: true }, { t: 0.18, right: 'cupFlinch', left: 'cupFlinch', snap: true, camera: { fov: 7, pitch: -0.02 } }, { t: 0.4, right: 'rest', left: 'rest' }]),
    secondary: gestureSet(0.45, 0.18, [{ t: 0, right: 'shieldEyes', left: 'palmDown', slow: true }, { t: 0.14, right: 'cupFlinch', left: 'landCatch', snap: true, camera: { fov: 9, pitch: 0.05 } }, { t: 0.35, right: 'rest', left: 'rest' }]),
    max: gestureSet(2.2, 1.6, [{ t: 0, right: 'cupEyes', left: 'cupEyes', slow: true }, { t: 0.9, right: 'shieldEyes', left: 'shieldEyes', slow: true }, { t: 1.55, right: 'cupFlinch', left: 'cupFlinch', snap: true, camera: { fov: 16, pitch: -0.04 } }, { t: 2.0, right: 'rest', left: 'rest' }]),
  },
  // Hands rise from low and veil the eyes, hold the dark, then tear away. One
  // hand settles by the temple, the other low and open.
  sign: signGesture([
    { t: 0, right: 'palmDown', left: 'palmDown', slow: true },
    { t: 0.5, right: 'veilEyes', left: 'veilEyes', snap: true, camera: { fov: -5 }, event: 'seal' },
    { t: 1.2, right: 'cupFlinch', left: 'cupFlinch', snap: true, camera: { fov: 9, pitch: -0.03 }, event: 'release' },
    { t: 1.42, left: 'flat' },
  ]),
  traits: {},
  cutscene,
  effects: {
    cast(ctx) {
      const g = ctx.game;
      const stareBonus = ctx.behaviors.includes('staring') ? Math.min(1, stare / 6) : 0;
      stare = 0;
      if (ctx.shape === 'flinch') {
        const narrow = ctx.behaviors.includes('narrow');
        const range = rangeFor(ctx, narrow ? 11 : 6.5);
        const half = ctx.behaviors.includes('wide') ? 0.75 : narrow ? 0.18 : 0.42;
        const dmg = (14 + 16 * stareBonus) * ctx.potency;
        const hits = hitCone(ctx, range, half, dmg, { knock: 6 + 6 * stareBonus, lift: 2.5, kind: 'pulse', heavy: stareBonus > 0.7 });
        const n = shoveProps(ctx, propsInCone(g, ctx.origin, ctx.dir, range, half + 0.1), 4 + 5 * stareBonus, 0.5);
        g.vfx.ring(ctx.origin.clone().addScaledVector(ctx.dir, 0.4), COLOR, 0.1, 1.2 + stareBonus, 0.25, ctx.dir);
        g.vfx.ring(ctx.origin.clone().addScaledVector(ctx.dir, range * 0.5), COLOR, 0.3, 2.5, 0.35, ctx.dir);
        g.vfx.flash(ctx.origin.clone().addScaledVector(ctx.dir, 1), COLOR, 20 + 30 * stareBonus, 0.25, 10);
        g.audio.play('impactSoft_heavy_000', 0.6, 1.4 - stareBonus * 0.4);
        return { hits: hits.length + n, hitStop: hits.length ? 0.04 + stareBonus * 0.05 : 0, cameraKick: { fov: 8 + stareBonus * 6, pitch: -0.015 }, impactFrame: stareBonus > 0.7 && hits.length ? 1 : 0 };
      }
      if (ctx.shape === 'doubletake') {
        const back = g.cam.aimDirection().setY(0).normalize().multiplyScalar(-1);
        g.player.velocity.set(back.x * 11 * (0.8 + ctx.potency * 0.4), 6.5, back.z * 11 * (0.8 + ctx.potency * 0.4));
        g.player.grounded = false;
        const ground = g.player.position.clone().add(new THREE.Vector3(0, 0.05, 0));
        g.vfx.ring(ground, COLOR, 0.2, 2.2, 0.35);
        g.vfx.burst(ground, 6, 'spark', 4, COLOR);
        g.audio.play('phaserDown1', 0.5, 1.2);
        for (const e of g.techniques.enemiesInSphere(g.player.position, 2.2)) g.combat.hitEnemy(e, 8 * ctx.potency, { knock: 4, kind: 'pulse' });
        return { hits: 0, cameraKick: { fov: 10, pitch: 0.06 } };
      }
      if (ctx.shape === 'eyesShut') {
        const range = 14;
        const hits = hitCone(ctx, range, 1.1, 110 * ctx.potency, { knock: 16, lift: 7, kind: 'pulse', heavy: true });
        shoveProps(ctx, propsInCone(g, ctx.origin, ctx.dir, range, 1.2), 10, 0.7);
        g.vfx.ring(ctx.origin.clone().addScaledVector(ctx.dir, 0.5), 0xffffff, 0.2, 6, 0.5, ctx.dir);
        g.vfx.ring(ctx.origin.clone().addScaledVector(ctx.dir, 5), COLOR, 0.5, 12, 0.7, ctx.dir);
        g.vfx.flash(ctx.origin.clone().addScaledVector(ctx.dir, 2), COLOR, 160, 0.6, 30);
        g.audio.play('impactBell_heavy_002', 1, 0.5);
        blinkUi.blind.value = 2.6;
        return { hits: hits.length, hitStop: 0.14, impactFrame: 3, cameraKick: { fov: 20, pitch: -0.05 } };
      }
      return undefined;
    },
    passive(_game, dt) {
      stare += dt;
      blinkUi.stare.value = Math.min(1, stare / 6);
      if (blinkUi.blind.value > 0) blinkUi.blind.value = Math.max(0, blinkUi.blind.value - dt);
    },
    // The darkness only lifts in the passive, which runs only while Blink is
    // selected, so a Technique change mid-blind must lift it here.
    reset() { stare = 0; blinkUi.stare.value = 0; blinkUi.blind.value = 0; },
  },
  audio: { primary: { cast: 'lowRandom', volume: 0.35, pitch: 1.2 }, secondary: { cast: 'lowRandom', volume: 0.3, pitch: 0.9 }, max: { cast: 'powerUp3', volume: 0.6, pitch: 0.6 } },
};
