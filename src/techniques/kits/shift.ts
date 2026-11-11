import * as THREE from 'three';
import type { TechniqueKit } from '../kit';
import { gestureSet, rangeFor, hitCone, propsInCone, shoveProps } from './shared';
import type { Pact } from '../../pacts/schema';
import type { CutsceneDef } from '../../cutscene/cutscene';
import { GROUP_WORLD } from '../../physics/world';

const COLOR = 0x6fd3ff;

const catalogue: Pact[] = [
  { id: 'shift.displacement-strike', technique: 'shift', name: 'Displacement Strike', slot: 'primary', grant: { shape: 'cut', behaviors: ['momentum'] }, clauses: [
    { kind: 'restrict', restriction: { param: 'range', value: 'touch' } }, { kind: 'restrict', restriction: { param: 'direction', value: 'front' } }] },
  { id: 'shift.shift', technique: 'shift', name: 'Shift', slot: 'secondary', grant: { shape: 'translate', behaviors: ['through'] }, clauses: [
    { kind: 'restrict', restriction: { param: 'direction', value: 'declared' } }, { kind: 'restrict', restriction: { param: 'range', value: 'medium' } }] },
  { id: 'shift.long-translation', technique: 'shift', name: 'Long Translation', slot: 'max', grant: { shape: 'longTranslation' }, clauses: [
    { kind: 'restrict', restriction: { param: 'direction', value: 'line' } }, { kind: 'restrict', restriction: { param: 'resource', value: 'all' } }, { kind: 'restrict', restriction: { param: 'trigger', value: 'declared' } }] },
];

function anchored(def: Omit<CutsceneDef, 'shots'> & { shots: { duration: number; from: [number, number, number]; to?: [number, number, number]; look: [number, number, number]; lookTo?: [number, number, number]; fov?: [number, number]; roll?: [number, number]; events?: CutsceneDef['shots'][number]['events']; rel?: 'caster' | 'target' | 'mid' }[] }): CutsceneDef {
  return { ...def, shots: def.shots.map((s) => ({ duration: s.duration, fov: s.fov, roll: s.roll, events: s.events, from: { rel: s.rel ?? 'caster', offset: s.from }, to: s.to ? { rel: s.rel ?? 'caster', offset: s.to } : undefined, look: { rel: s.rel ?? 'caster', offset: s.look }, lookTo: s.lookTo ? { rel: s.rel ?? 'caster', offset: s.lookTo } : undefined })) };
}
export { anchored };

const cutscene = anchored({
  id: 'max-shift', title: { jp: '長距離転移', en: 'Long Translation' }, color: COLOR, timeScale: 0.1, letterbox: true,
  shots: [
    { duration: 1.0, from: [-0.7, 1.5, -1.4], to: [-0.5, 1.45, -1.1], look: [0, 1.45, 0], fov: [44, 38], events: [{ at: 0, kind: 'gesture' }, { at: 0.2, kind: 'title' }, { at: 0.15, kind: 'sfx', id: 'phaseJump3', pitch: 0.6 }] },
    { duration: 1.3, from: [2.2, 0.4, 0.6], to: [2.6, 0.6, -4], look: [0, 1.2, -2], lookTo: [0, 1.0, -14], roll: [-0.2, -0.05], fov: [66, 80], events: [{ at: 0.4, kind: 'impactFrame', frames: 2 }, { at: 0.45, kind: 'resolveHit' }, { at: 0.45, kind: 'shake', amount: 0.6 }, { at: 0.45, kind: 'sfx', id: 'zapTwoTone', pitch: 0.8 }, { at: 0.5, kind: 'slow', scale: 0.4 }] },
    { duration: 0.8, from: [-3, 2.2, -16], to: [-2.5, 1.8, -17], look: [0, 1.2, -18], fov: [62, 56] },
  ],
});

// Shift must handle an occupied destination: walk back along the line until a
// standing capsule fits, and displace anything that stood where you arrive.
function freeDestination(ctx: { game: import('../../app/game').Game }, from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3 {
  const g = ctx.game;
  const steps = 16;
  for (let i = 0; i <= steps; i++) {
    const p = to.clone().lerp(from, i / steps);
    const feet = p.clone();
    const blocked = g.physics.castRay(feet.clone().add(new THREE.Vector3(0, 1.0, 0)), new THREE.Vector3(0, -1, 0), 1.0, GROUP_WORLD)
      && !g.physics.castRay(feet.clone().add(new THREE.Vector3(0, 0.95, 0)), new THREE.Vector3(0, 1, 0), 0.9, GROUP_WORLD)
      && !g.physics.castRay(feet.clone().add(new THREE.Vector3(0, 0.3, 0)), new THREE.Vector3(1, 0, 0), 0.35, GROUP_WORLD)
      && !g.physics.castRay(feet.clone().add(new THREE.Vector3(0, 0.3, 0)), new THREE.Vector3(-1, 0, 0), 0.35, GROUP_WORLD);
    if (blocked) {
      const ground = g.physics.castRay(feet.clone().add(new THREE.Vector3(0, 1.0, 0)), new THREE.Vector3(0, -1, 0), 1.0, GROUP_WORLD)!;
      return ground.point;
    }
  }
  return from.clone();
}

export const shift: TechniqueKit = {
  id: 'shift', name: 'Shift', glyph: '転', color: COLOR, type: 'Spatial',
  blurb: 'Translate your body through whatever lies between. Momentum and orientation are preserved, so every use is geometry.',
  resource: { name: 'Focus', max: 100, regen: 14, startsFull: true },
  primitive: { name: 'Shift', description: 'Translate a short, imprecise distance in roughly the direction you face.' },
  parameters: ['direction', 'range', 'target', 'trigger', 'duration', 'resource', 'body'],
  shapes: {
    cut: { label: 'translates a step forward and strikes with the arriving momentum', slot: ['primary'], description: 'A close arc coated in displacement.' },
    translate: { label: 'translates you to the declared point, through what lies between', slot: ['secondary'], description: 'Shift to the aim point. Occupied destinations displace what stood there.' },
    longTranslation: { label: 'crosses a long line and cuts through everything on it', slot: ['max'], description: 'A line-crossing displacement.' },
  },
  behaviors: { momentum: 'arriving at speed carries into the next strike', through: 'passes through walls and people', quiet: 'leaves no afterimage' },
  catalogue,
  gestures: {
    primary: gestureSet(0.5, 0.18, [{ t: 0, right: 'pointPull', left: 'guard', slow: true }, { t: 0.12, right: 'point', snap: true, camera: { fov: 5 } }, { t: 0.22, right: 'pointFar', snap: true }, { t: 0.4, right: 'rest', left: 'rest' }]),
    secondary: gestureSet(0.55, 0.22, [{ t: 0, right: 'point', left: 'crossChest', slow: true }, { t: 0.18, right: 'pointFar', snap: true, camera: { fov: 10, roll: 0.03 } }, { t: 0.4, right: 'rest', left: 'rest' }]),
    max: gestureSet(2.0, 1.5, [{ t: 0, right: 'crossChest', left: 'crossChest', slow: true }, { t: 0.7, right: 'point', left: 'point', slow: true }, { t: 1.45, right: 'pointFar', left: 'pointFar', snap: true, camera: { fov: 14 } }, { t: 1.9, right: 'rest', left: 'rest' }]),
  },
  avatarClips: { primary: 'Punch_Jab', secondary: 'Spell_Simple_Shoot', max: 'Sword_Attack', passive: 'Idle_Loop' },
  traits: {},
  cutscene,
  effects: {
    cast(ctx) {
      const g = ctx.game;
      const flat = ctx.dir.clone().setY(0).normalize();
      if (ctx.shape === 'cut') {
        const step = rangeFor(ctx, 2.2);
        const from = g.player.position.clone();
        const dest = freeDestination(ctx, from, from.clone().addScaledVector(flat, step));
        g.vfx.afterimage(g.avatar.model, COLOR, 0.4);
        g.player.displace(dest.clone().sub(from));
        const momentum = ctx.behaviors.includes('momentum') ? 1 + g.player.planarSpeed.value / 6 : 1;
        const hits = hitCone({ ...ctx, origin: g.player.eye() }, 2.4, 0.9, 24 * ctx.potency * momentum, { knock: 4, lift: 1.5, kind: 'cut', heavy: momentum > 1.5 });
        shoveProps(ctx, propsInCone(g, g.player.eye(), flat, 2.6, 0.8), 3);
        g.vfx.ring(g.player.eye().addScaledVector(flat, 0.8), COLOR, 0.2, 1.8, 0.3, new THREE.Vector3(0, 1, 0).cross(flat).normalize());
        g.vfx.trail([from.clone().add(new THREE.Vector3(0, 1.2, 0)), dest.clone().add(new THREE.Vector3(0, 1.2, 0))], COLOR, 0.5, 0.25);
        g.audio.play(hits.length ? 'zap1' : 'phaseJump1', 0.6, 1.3);
        return { hits: hits.length, hitStop: hits.length ? 0.05 : 0, cameraKick: { fov: 8, roll: 0.02 } };
      }
      if (ctx.shape === 'translate') {
        const range = rangeFor(ctx, 14);
        const from = g.player.position.clone();
        const aim = ctx.aim ?? from.clone().addScaledVector(flat, range);
        const want = from.clone().add(aim.clone().sub(ctx.origin).setY(0).clampLength(0, range));
        want.y = Math.max(0, aim.y - 0.1 > from.y + 0.5 ? aim.y : from.y);
        const dest = ctx.behaviors.includes('through') ? freeDestination(ctx, from, want) : freeDestination(ctx, from, from.clone().lerp(want, 0.6));
        let hits = 0;
        for (const e of g.techniques.enemiesInSphere(dest, 1.2)) { g.combat.hitEnemy(e, 20 * ctx.potency, { from: dest, knock: 7, lift: 3, kind: 'cut' }); hits++; }
        for (const p of g.props.instances) if (p.mesh.position.distanceTo(dest) < 1.4) { p.body.wakeUp(); p.body.applyImpulse(p.mesh.position.clone().sub(dest).setY(0.5).normalize().multiplyScalar(p.def.mass * 5), true); }
        g.vfx.afterimage(g.avatar.model, COLOR, 0.45);
        g.vfx.ring(from.clone().add(new THREE.Vector3(0, 1, 0)), COLOR, 0.3, 1.6, 0.35, flat);
        g.player.displace(dest.clone().sub(from));
        g.vfx.ring(dest.clone().add(new THREE.Vector3(0, 1, 0)), COLOR, 1.6, 0.2, 0.3, flat);
        g.vfx.flash(dest.clone().add(new THREE.Vector3(0, 1.4, 0)), COLOR, 30, 0.3, 10);
        g.audio.play('phaseJump3', 0.6, 1.1);
        g.mastery.gain('shift', 'range', 0.004);
        g.tutorial.notify('shifted');
        return { hits, cameraKick: { fov: 12, roll: 0.04 }, hitStop: hits ? 0.04 : 0 };
      }
      if (ctx.shape === 'longTranslation') {
        const range = 26;
        const from = g.player.position.clone();
        const dest = freeDestination(ctx, from, from.clone().addScaledVector(flat, range));
        let hits = 0;
        for (const e of g.techniques.enemiesInCone(ctx.origin, flat, range, 0.12)) { g.combat.hitEnemy(e, 150 * ctx.potency, { from: ctx.origin, knock: 10, lift: 5, kind: 'cut', heavy: true }); hits++; }
        shoveProps(ctx, propsInCone(g, ctx.origin, flat, range, 0.14), 9, 0.7);
        for (let i = 0; i < 6; i++) setTimeout(() => g.vfx.afterimage(g.avatar.model, COLOR, 0.6), i * 30);
        g.vfx.trail([from.clone().add(new THREE.Vector3(0, 1.2, 0)), dest.clone().add(new THREE.Vector3(0, 1.2, 0))], 0xffffff, 0.9, 0.5);
        g.player.displace(dest.clone().sub(from));
        g.vfx.flash(dest.clone().add(new THREE.Vector3(0, 1.4, 0)), COLOR, 90, 0.5, 20);
        g.audio.play('zapTwoTone', 0.9, 0.7);
        return { hits, hitStop: 0.12, impactFrame: 3, cameraKick: { fov: 18, roll: 0.05 } };
      }
      return undefined;
    },
  },
  audio: { primary: { cast: 'phaserUp3', volume: 0.3, pitch: 1.4 }, secondary: { cast: 'phaseJump1', volume: 0.3, pitch: 1.2 }, max: { cast: 'powerUp3', volume: 0.6, pitch: 0.8 }, passive: { cast: 'tick_001' } },
};
