import * as THREE from 'three';
import type { TechniqueKit } from '../kit';
import { signGesture, gestureSet, rangeFor, propsInCone, breakProp, targetsAllowed } from './shared';
import type { Pact } from '../../pacts/schema';
import { opening, blow, type CutsceneDef } from '../../cutscene/cutscene';

const COLOR = 0x7dffb2;
let quiet = false;

const catalogue: Pact[] = [
  { id: 'echo.ring', technique: 'echo', name: 'Ring', slot: 'primary', grant: { shape: 'ring', behaviors: ['stack'] }, clauses: [
    { kind: 'restrict', restriction: { param: 'target', value: 'resonant' } }, { kind: 'restrict', restriction: { param: 'body', value: 'palmContact' } }] },
  { id: 'echo.quiet', technique: 'echo', name: 'Quiet', slot: 'secondary', grant: { shape: 'quiet' }, clauses: [
    { kind: 'restrict', restriction: { param: 'duration', value: 'held' } }, { kind: 'restrict', restriction: { param: 'body', value: 'bothHands' } }] },
  { id: 'echo.cathedral', technique: 'echo', name: 'Cathedral Resonance', slot: 'max', grant: { shape: 'cathedral' }, clauses: [
    { kind: 'restrict', restriction: { param: 'body', value: 'palmContact' } }, { kind: 'restrict', restriction: { param: 'resource', value: 'all' } }, { kind: 'restrict', restriction: { param: 'trigger', value: 'grounded' } }] },
];

// Cathedral Resonance: the palms pressed close, a plan view from the vault
// closing on the caster, a low wide as the whole floor rings, and a crane
// up over everything still shaking.
const cutscene: CutsceneDef = {
  id: 'max-echo', title: { jp: '大聖堂共鳴', en: 'Cathedral Resonance' }, color: COLOR, pull: 4, reach: 14, word: 'ゴォォォン',
  shots: [
    { duration: 1.05, timeScale: 0.03, from: { pos: [0.95, 1.4, 1.95], look: [0, 1.3, 0], fov: 38 }, to: { pos: [0.65, 1.38, 1.5], fov: 31, roll: 0.04 }, events: opening('phaserUp3', 0.4) },
    { duration: 0.5, timeScale: 0.03, from: { rel: 'mid', pos: [0, 8, -0.8], look: [0, 0.4, 0], fov: 56 }, to: { pos: [0, 6, -0.6], fov: 50 }, ease: 'in', events: [{ at: 0.05, kind: 'sfx', id: 'impactBell_heavy_000', pitch: 0.3, volume: 0.4 }] , page: { look: 'wash' } },
    { duration: 0.95, timeScale: 0.3, from: { pos: [-4.2, 0.45, 3.2], look: [0, 1.4, 0], lookRel: 'mid', fov: 70, roll: 0.1 }, to: { pos: [-5.2, 0.6, 4.2], fov: 80, roll: 0.04 }, events: [...blow(0, 'impactBell_heavy_000', 0.4, 1)] , page: { look: 'wash', lines: 'focus' } },
    { duration: 0.75, timeScale: 0.5, from: { rel: 'mid', pos: [3, 6, -5], look: [0, 0.5, 0], fov: 60 }, to: { pos: [3.5, 7.6, -6], fov: 62 }, ease: 'inOut' , page: { look: 'wash' } },
  ],
};

function resonate(ctx: Parameters<TechniqueKit['effects']['cast']>[0], e: import('../../combat/enemies').Enemy, amount: number): void {
  const g = ctx.game;
  e.resonance += amount;
  g.vfx.ring(e.center(), COLOR, 0.3, 1.4 + e.resonance * 0.2, 0.3);
  if (e.resonance >= 5) {
    e.resonance = 0;
    g.combat.hitEnemy(e, 60 * ctx.potency, { from: ctx.origin, knock: 6, lift: 3, kind: 'resonance', heavy: true });
    g.vfx.burst(e.center(), 14, 'spark', 6, COLOR);
    g.audio.play('impactGlass_heavy_000', 0.8, 0.8);
  } else g.combat.hitEnemy(e, 7 * ctx.potency, { from: ctx.origin, kind: 'resonance', stagger: false });
}

export const echo: TechniqueKit = {
  id: 'echo', name: 'Echo', glyph: '響', color: COLOR, type: 'Manipulation', sfx: 'ゴォン',
  blurb: 'Manipulate mechanical vibration through connected matter. Air is matter too. The strongest effects come from resonance.',
  breadth: 4,
  resource: { name: 'Phase', max: 100, regen: 12, startsFull: true },
  primitive: { name: 'Echo', short: 'a faint vibration', description: 'Add a little vibration to whatever you touch. Keep the phase or lose the build-up.' },
  parameters: ['direction', 'range', 'target', 'trigger', 'duration', 'resource', 'body'],
  shapes: {
    ring: { label: 'sends a wave that adds Resonance to what it touches', short: 'add resonance by touch', kinds: ['primary'], description: 'Five stacks shatters.' },
    quiet: { label: 'cancels incoming vibration while held', short: 'hold to cancel vibration', kinds: ['secondary'], description: 'Active cancellation. Blows land soft; enemy rings die.' },
    cathedral: { label: 'forces the whole street into one mode', short: 'break everything resonant', kinds: ['max'], description: 'Everything resonant breaks. You share the vibration.' },
  },
  behaviors: { stack: 'stacks hold longer between hits', sharp: 'the fifth stack hits harder', air: 'travels through air, not only contact' },
  catalogue,
  gestures: {
    primary: gestureSet(0.55, 0.24, [{ t: 0, right: 'snapReady', left: 'palmSurface', slow: true }, { t: 0.2, right: 'snapped', snap: true, camera: { fov: 4 } }, { t: 0.28, left: 'palmPress' }, { t: 0.45, right: 'rest', left: 'rest' }]),
    secondary: gestureSet(0.5, 0.2, [{ t: 0, right: 'quietSpread', left: 'quietSpread', snap: true, camera: { fov: -3 } }], true),
    max: gestureSet(2.3, 1.7, [{ t: 0, right: 'raiseHigh', left: 'raiseHigh', slow: true }, { t: 0.9, right: 'flat', left: 'flat', slow: true }, { t: 1.65, right: 'palmPress', left: 'palmPress', snap: true, camera: { fov: 14, pitch: 0.08 } }, { t: 2.1, right: 'rest', left: 'rest' }]),
  },
  // Palms press, then the right hand draws up to the ear while the left opens
  // flat. The snap is the release; the stance keeps the fingers ready.
  sign: signGesture([
    { t: 0, right: 'sealGather', left: 'sealGather', slow: true },
    { t: 0.45, right: 'seal', left: 'seal', snap: true, camera: { fov: -3 }, event: 'seal' },
    { t: 0.85, right: 'snapReady', left: 'flat', slow: true },
    { t: 1.2, right: 'snapped', snap: true, camera: { fov: 6 }, event: 'release' },
    { t: 1.42, right: 'snapReady', left: 'palmSurface' },
  ]),
  traits: {
    resonant: (prop, ctx) => {
      prop.resonance += 1.2 * ctx.potency + 0.3;
      ctx.game.vfx.ring(prop.mesh.position, COLOR, 0.2, 0.9, 0.25);
      if (prop.resonance >= 3) breakProp(ctx.game, prop, ctx.origin);
    },
  },
  cutscene,
  effects: {
    cast(ctx) {
      const g = ctx.game;
      if (ctx.shape === 'ring') {
        const range = rangeFor(ctx, ctx.behaviors.includes('air') ? 12 : 7);
        const allow = targetsAllowed(ctx);
        let hits = 0;
        if (allow.people) for (const e of g.techniques.enemiesInCone(ctx.origin, ctx.dir, range, 0.5)) { resonate(ctx, e, ctx.behaviors.includes('stack') ? 1.4 : 1); hits++; }
        if (allow.props) for (const p of propsInCone(g, ctx.origin, ctx.dir, range, 0.55)) { if (p.def.traits.includes('resonant')) { echo.traits.resonant!(p, ctx); hits++; } else g.props.push(p, ctx.dir.clone().multiplyScalar(p.def.mass * 1.5)); }
        for (let i = 1; i <= 4; i++) g.vfx.after(i * 0.04, () => g.vfx.ring(ctx.origin.clone().addScaledVector(ctx.dir, i * range / 4), COLOR, 0.4, 1.2 + i * 0.6, 0.3, ctx.dir));
        g.audio.play('impactBell_heavy_000', 0.45, 1.3);
        g.mastery.gain('echo', 'precision', 0.003);
        return { hits, hitStop: hits ? 0.03 : 0, cameraKick: { fov: 4 } };
      }
      if (ctx.shape === 'quiet') { quiet = true; return { cameraKick: { fov: -4 } }; }
      if (ctx.shape === 'cathedral') {
        const center = g.player.position.clone();
        const radius = 13 + ctx.potency * 3;
        let hits = 0;
        for (const e of g.techniques.enemiesInSphere(center, radius)) { e.resonance = 5; resonate(ctx, e, 1); g.combat.hitEnemy(e, 70 * ctx.potency, { from: center, knock: 8, lift: 4, kind: 'resonance', heavy: true }); hits++; }
        for (const p of [...g.props.instances]) if (p.mesh.position.distanceTo(center) < radius) { if (p.def.breakable) breakProp(g, p, center); else g.props.push(p, new THREE.Vector3(0, p.def.mass * 4, 0)); }
        for (let i = 1; i <= 5; i++) g.vfx.after(i * 0.07, () => { g.vfx.ring(center.clone().add(new THREE.Vector3(0, 0.1 + i * 0.3, 0)), COLOR, 0.5, radius * (0.5 + i * 0.15), 0.6); g.cam.shake(0.25); });
        g.vfx.flash(center.clone().add(new THREE.Vector3(0, 1.5, 0)), COLOR, 120, 0.7, 28);
        g.audio.play('impactBell_heavy_000', 1, 0.4);
        g.combat.hurtPlayer(g.combat.maxHp * 0.1, { self: true });
        return { hits, hitStop: 0.14, impactFrame: 3, rooted: 1.0, cameraKick: { fov: 14, pitch: 0.06 } };
      }
      return undefined;
    },
    hold(ctx, dt) {
      const g = ctx.game;
      if (Math.random() < dt * 6) g.vfx.ring(g.player.eye().addScaledVector(ctx.game.cam.aimDirection(), 0.8), COLOR, 1.6, 0.3, 0.3, g.cam.aimDirection());
      for (const e of g.techniques.enemiesInSphere(g.player.position, 5)) e.resonance = Math.max(0, e.resonance - dt * 2);
    },
    release() { quiet = false; },
    reset() { quiet = false; },
    passive(game) { if (!game.techniques.casting) quiet = false; },
    onStruck(game, amount) {
      if (!quiet) return amount;
      game.vfx.ring(game.player.eye(), COLOR, 1.4, 0.2, 0.25, game.cam.aimDirection());
      game.audio.play('lowDown', 0.4, 1.4);
      return amount * 0.3;
    },
  },
  audio: { primary: { cast: 'tick_001', volume: 0.5, pitch: 0.8 }, secondary: { cast: 'lowThreeTone', volume: 0.3, pitch: 0.8 }, max: { cast: 'powerUp3', volume: 0.6, pitch: 0.5 } },
};
