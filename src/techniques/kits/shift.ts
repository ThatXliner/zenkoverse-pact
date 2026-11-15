import * as THREE from 'three';
import { toast } from '../../app/game';
import type { TechniqueKit } from '../kit';
import { signGesture, gestureSet, rangeFor, hitCone, propsInCone, shoveProps } from './shared';
import type { Pact } from '../../pacts/schema';
import { opening, blow, type CutsceneDef } from '../../cutscene/cutscene';
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

// Long Translation: the sign in profile, a low look down the line at the
// target, then the cut to the caster already through it, low and side-on
// with the line behind, and a hero shot with the target reeling beyond.
const cutscene: CutsceneDef = {
  id: 'max-shift', title: { jp: '長距離転移', en: 'Long Translation' }, color: COLOR, pull: 7, reach: 20, word: 'シュバッ',
  shots: [
    { duration: 1.05, timeScale: 0.03, from: { pos: [-1.05, 1.5, 1.95], look: [0, 1.38, 0], fov: 36 }, to: { pos: [-0.7, 1.48, 1.5], fov: 30, roll: 0.04 }, events: opening('shift.max.charge') },
    { duration: 0.5, timeScale: 0.03, from: { pos: [0.55, 0.75, -2.0], look: [0, 1.1, 0], lookRel: 'target', fov: 46 }, to: { pos: [0.45, 0.85, -1.4], fov: 38 }, ease: 'in', events: [{ at: 0.1, kind: 'sfx', id: 'shift.max.rush' }] , page: { lines: 'rush' } },
    { duration: 0.95, timeScale: 0.3, from: { pos: [2.4, 0.6, 0.8], look: [0, 1.1, -2], fov: 60, roll: -0.12 }, to: { pos: [2.9, 0.7, 1.2], fov: 70, roll: -0.04 }, events: [...blow(0, 'shift.max.blow', 0.6)] , page: { lines: 'rush' } },
    { duration: 0.75, timeScale: 0.55, from: { pos: [1.3, 1.45, 2.4], look: [0, 1.3, -4], fov: 44 }, to: { pos: [1.1, 1.5, 2.0], fov: 40 }, ease: 'inOut' },
  ],
};

// Shift must handle an occupied destination: walk back along the line until a
// standing capsule fits, and displace anything that stood where you arrive.
// Shift translates horizontally toward the aim and lands on whatever ground is
// below the arrival point, so aiming at the horizon or the sky still moves you.
// An occupied or groundless arrival walks back along the line until a standing
// capsule fits. So does one far below the start: Shift crosses walls, not
// drops, so it cannot carry you off a roof.
const MAX_DROP = 2.0;
function freeDestination(ctx: { game: import('../../app/game').Game }, from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3 {
  const g = ctx.game;
  const down = new THREE.Vector3(0, -1, 0);
  const steps = 24;
  const top = Math.max(from.y, to.y) + 3;
  for (let i = 0; i < steps; i++) {
    const p = to.clone().lerp(from, i / steps);
    const ground = g.physics.castRay(new THREE.Vector3(p.x, top, p.z), down, top - from.y + 6, GROUP_WORLD);
    if (!ground || ground.point.y > from.y + 3.5 || ground.point.y < from.y - MAX_DROP) continue;
    const feet = ground.point;
    const clear = !g.physics.castRay(feet.clone().add(new THREE.Vector3(0, 0.05, 0)), new THREE.Vector3(0, 1, 0), 1.8, GROUP_WORLD)
      && !g.physics.castRay(feet.clone().add(new THREE.Vector3(0, 0.5, 0)), new THREE.Vector3(1, 0, 0), 0.35, GROUP_WORLD)
      && !g.physics.castRay(feet.clone().add(new THREE.Vector3(0, 0.5, 0)), new THREE.Vector3(-1, 0, 0), 0.35, GROUP_WORLD)
      && !g.physics.castRay(feet.clone().add(new THREE.Vector3(0, 0.5, 0)), new THREE.Vector3(0, 0, 1), 0.35, GROUP_WORLD)
      && !g.physics.castRay(feet.clone().add(new THREE.Vector3(0, 0.5, 0)), new THREE.Vector3(0, 0, -1), 0.35, GROUP_WORLD);
    if (clear) return feet.clone();
  }
  return from.clone();
}

export const shift: TechniqueKit = {
  id: 'shift', name: 'Shift', glyph: '転', color: COLOR, type: 'Spatial', sfx: 'シュン',
  blurb: 'Translate your body through whatever lies between. Momentum and orientation are preserved, so every use is geometry.',
  breadth: 3,
  resource: { name: 'Focus', max: 100, regen: 14, startsFull: true },
  primitive: { name: 'Shift', short: 'a short hop forward', description: 'Translate a short, imprecise distance in roughly the direction you face.' },
  parameters: ['direction', 'range', 'target', 'trigger', 'duration', 'resource', 'body'],
  shapes: {
    cut: { label: 'translates a step forward and strikes with the arriving momentum', short: 'step in and strike', kinds: ['primary'], description: 'A close arc coated in displacement.' },
    translate: { label: 'translates you to the declared point, through what lies between', short: 'translate to your aim', kinds: ['secondary'], description: 'Shift to the aim point. Occupied destinations displace what stood there.' },
    longTranslation: { label: 'crosses a long line and cuts through everything on it', short: 'cross a long line, cutting', kinds: ['max'], description: 'A line-crossing displacement.' },
  },
  behaviors: { momentum: 'arriving at speed carries into the next strike', through: 'passes through walls and people', quiet: 'leaves no afterimage' },
  catalogue,
  gestures: {
    primary: gestureSet(0.5, 0.18, [{ t: 0, right: 'pointPull', left: 'guard', slow: true }, { t: 0.12, right: 'point', snap: true, camera: { fov: 5 } }, { t: 0.22, right: 'pointFar', snap: true }, { t: 0.4, right: 'rest', left: 'rest' }]),
    secondary: gestureSet(0.55, 0.22, [{ t: 0, right: 'point', left: 'crossChest', slow: true }, { t: 0.18, right: 'pointFar', snap: true, camera: { fov: 10, roll: 0.03 } }, { t: 0.4, right: 'rest', left: 'rest' }]),
    max: gestureSet(2.0, 1.5, [{ t: 0, right: 'crossChest', left: 'crossChest', slow: true }, { t: 0.7, right: 'point', left: 'point', slow: true }, { t: 1.45, right: 'pointFar', left: 'pointFar', snap: true, camera: { fov: 14 } }, { t: 1.9, right: 'rest', left: 'rest' }]),
  },
  // Arms crossed, then both hands snap into the two-finger seal. The right
  // hand breaks it to point at the horizon and settles to a near point.
  sign: signGesture([
    { t: 0, right: 'crossChest', left: 'crossChest', slow: true },
    { t: 0.5, right: 'kuji', left: 'kuji', snap: true, camera: { fov: -4 }, event: 'seal' },
    { t: 1.2, right: 'pointFar', left: 'guard', snap: true, camera: { fov: 8, roll: 0.03 }, event: 'release' },
    { t: 1.42, right: 'point' },
  ]),
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
        g.renderer.speed(flat, 0.7, 0.22);
        g.player.displace(dest.clone().sub(from));
        const momentum = ctx.behaviors.includes('momentum') ? 1 + g.player.planarSpeed.value / 6 : 1;
        const hits = hitCone({ ...ctx, origin: g.player.eye() }, 3.0, 1.0, 34 * ctx.potency * momentum, { knock: 4, lift: 1.5, kind: 'cut', heavy: momentum > 1.5 });
        shoveProps(ctx, propsInCone(g, g.player.eye(), flat, 2.6, 0.8), 3);
        g.vfx.ring(g.player.eye().addScaledVector(flat, 0.8), COLOR, 0.2, 1.8, 0.3, new THREE.Vector3(0, 1, 0).cross(flat).normalize());
        g.vfx.trail([from.clone().add(new THREE.Vector3(0, 1.2, 0)), dest.clone().add(new THREE.Vector3(0, 1.2, 0))], COLOR, 0.5, 0.25);
        g.audio.play(hits.length ? 'shift.cut.hit' : 'shift.cut.whiff');
        return { hits: hits.length, hitStop: hits.length ? 0.05 : 0, cameraKick: { fov: 8, roll: 0.02 } };
      }
      if (ctx.shape === 'translate') {
        const range = rangeFor(ctx, 14);
        const from = g.player.position.clone();
        // Aiming at ground nearer than full range lands there; aiming level, at the
        // sky, or at a wall (which 'through' passes) takes the full range.
        const aimFlat = ctx.aim ? ctx.aim.clone().sub(ctx.origin).setY(0).length() : range;
        const onGround = !!ctx.aim && ctx.aim.y < from.y + 0.6 && ctx.dir.y < -0.05;
        const blockedByWall = !!ctx.aim && !onGround && aimFlat < range;
        const dist = onGround ? THREE.MathUtils.clamp(aimFlat, 4, range) : blockedByWall && !ctx.behaviors.includes('through') ? Math.max(0, aimFlat - 0.8) : range;
        const dest = freeDestination(ctx, from, from.clone().addScaledVector(flat, dist));
        if (dest.distanceTo(from) < 1) { toast('No room to Shift there', 'bad'); return { hits: 0 }; }
        let hits = 0;
        for (const e of g.techniques.enemiesInSphere(dest, 2.0)) { g.combat.hitEnemy(e, 30 * ctx.potency, { from: dest, knock: 7, lift: 3, kind: 'cut' }); hits++; }
        for (const p of g.props.instances) if (p.mesh.position.distanceTo(dest) < 1.4) g.props.push(p, p.mesh.position.clone().sub(dest).setY(0.5).normalize().multiplyScalar(p.def.mass * 5));
        g.vfx.afterimage(g.avatar.model, COLOR, 0.45);
        g.renderer.speed(flat, 0.9, 0.3);
        g.vfx.ring(from.clone().add(new THREE.Vector3(0, 1, 0)), COLOR, 0.3, 1.6, 0.35, flat);
        g.player.displace(dest.clone().sub(from));
        g.vfx.ring(dest.clone().add(new THREE.Vector3(0, 1, 0)), COLOR, 1.6, 0.2, 0.3, flat);
        g.vfx.flash(dest.clone().add(new THREE.Vector3(0, 1.4, 0)), COLOR, 30, 0.3, 10);
        g.audio.play('shift.translate');
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
        for (let i = 0; i < 6; i++) g.vfx.after(i * 0.03, () => g.vfx.afterimage(g.avatar.model, COLOR, 0.6));
        g.vfx.trail([from.clone().add(new THREE.Vector3(0, 1.2, 0)), dest.clone().add(new THREE.Vector3(0, 1.2, 0))], 0xffffff, 0.9, 0.5);
        g.player.displace(dest.clone().sub(from));
        g.vfx.flash(dest.clone().add(new THREE.Vector3(0, 1.4, 0)), COLOR, 90, 0.5, 20);
        g.audio.play('shift.max.tail');
        return { hits, hitStop: 0.12, impactFrame: 3, cameraKick: { fov: 18, roll: 0.05 } };
      }
      return undefined;
    },
  },
  audio: { primary: 'shift.cast', secondary: 'shift.translate.cast', max: 'shift.max.cast' },
};
