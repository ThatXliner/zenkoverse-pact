import * as THREE from 'three';
import { signal } from '@preact/signals';
import type { TechniqueKit } from '../kit';
import { gestureSet, rangeFor, hitCone, propsInCone, shoveProps } from './shared';
import { anchored } from './shift';
import type { Pact } from '../../pacts/schema';

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

const cutscene = anchored({
  id: 'max-blink', title: { jp: '閉眼', en: 'Eyes Shut' }, color: COLOR, timeScale: 0.1, letterbox: true,
  shots: [
    { duration: 1.2, from: [0.35, 1.62, -0.9], to: [0.2, 1.6, -0.6], look: [0, 1.58, 0], fov: [38, 30], events: [{ at: 0, kind: 'gesture' }, { at: 0.3, kind: 'title' }, { at: 0.1, kind: 'sfx', id: 'lowRandom', pitch: 0.6 }] },
    { duration: 1.2, from: [0, 1.4, 3.2], to: [0, 1.6, 4.5], look: [0, 1.5, 0], lookTo: [0, 1.3, -6], fov: [60, 84], roll: [0, 0.06], events: [{ at: 0.4, kind: 'impactFrame', frames: 3 }, { at: 0.45, kind: 'resolveHit' }, { at: 0.45, kind: 'shake', amount: 1 }, { at: 0.45, kind: 'sfx', id: 'impactBell_heavy_002', pitch: 0.5 }, { at: 0.5, kind: 'slow', scale: 0.4 }] },
    { duration: 0.7, from: [-3, 2, -5], to: [-3.5, 2.2, -6], look: [0, 1, -3], fov: [66, 60] },
  ],
});

export const blink: TechniqueKit = {
  id: 'blink', name: 'Blink', glyph: '瞬', color: COLOR, type: 'Manifestation',
  blurb: 'Close both eyes and a concussive pulse leaves your tear ducts. It cannot curve and it cannot fire anywhere but forward.',
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
  avatarClips: { primary: 'Spell_Simple_Shoot', secondary: 'Hit_Chest', max: 'Spell_Simple_Enter' },
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
  },
  audio: { primary: { cast: 'lowRandom', volume: 0.35, pitch: 1.2 }, secondary: { cast: 'lowRandom', volume: 0.3, pitch: 0.9 }, max: { cast: 'powerUp3', volume: 0.6, pitch: 0.6 } },
};
