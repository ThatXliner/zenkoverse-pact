import * as THREE from 'three';
import type { TechniqueKit, AbilityContext } from '../kit';
import { signGesture, gestureSet, rangeFor, hitCone, propsInCone, shoveProps, frontOnly } from './shared';
import type { PropInstance } from '../../world/props';
import { RAPIER } from '../../physics/world';
import type { Pact } from '../../pacts/schema';
import { opening, blow, type CutsceneDef } from '../../cutscene/cutscene';
import type { DrillDef } from '../../drills/drills';

const COLOR = 0xff7a2f;

const catalogue: Pact[] = [
  { id: 'recoil.kinetic-release', technique: 'recoil', name: 'Kinetic Release', slot: 'primary', grant: { shape: 'punch', behaviors: ['store'] }, clauses: [
    { kind: 'restrict', restriction: { param: 'direction', value: 'front' } }, { kind: 'restrict', restriction: { param: 'range', value: 'short' } }] },
  { id: 'recoil.absorption', technique: 'recoil', name: 'Absorption', slot: 'secondary', grant: { shape: 'absorb', behaviors: ['relaunch'] }, clauses: [
    { kind: 'restrict', restriction: { param: 'duration', value: 'held' } }, { kind: 'restrict', restriction: { param: 'body', value: 'bothHands' } }, { kind: 'restrict', restriction: { param: 'direction', value: 'front' } }] },
  { id: 'recoil.zero-hour', technique: 'recoil', name: 'Zero Hour', slot: 'max', grant: { shape: 'zeroHour' }, clauses: [
    { kind: 'restrict', restriction: { param: 'resource', value: 'all' } }, { kind: 'restrict', restriction: { param: 'trigger', value: 'declared' } }, { kind: 'restrict', restriction: { param: 'body', value: 'noMove' } }] },
  { id: 'recoil.shockline', technique: 'recoil', name: 'Shockline', slot: 'primary', grant: { shape: 'line' }, clauses: [
    { kind: 'restrict', restriction: { param: 'direction', value: 'line' } }, { kind: 'restrict', restriction: { param: 'trigger', value: 'grounded' } }, { kind: 'wager', declare: 'hit', reward: 'output', forfeit: 'seal' }] },
];

const held: { prop: PropInstance; offset: THREE.Vector3 }[] = [];
let absorbing = false;

function catchProps(ctx: AbilityContext, dt: number): void {
  const g = ctx.game;
  const eye = g.player.eye();
  const dir = g.cam.aimDirection();
  const range = rangeFor(ctx, 3.4);
  for (const p of propsInCone(g, eye, dir, range, 0.6)) {
    if (held.some((h) => h.prop === p) || held.length >= 3) continue;
    const v = p.body.linvel();
    const speed = Math.hypot(v.x, v.y, v.z);
    if (speed < 1.5) continue;
    g.props.touch(p);
    p.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    held.push({ prop: p, offset: new THREE.Vector3(held.length * 0.9 - 0.9, -0.2, 2.0) });
    g.techniques.resource = Math.min(g.techniques.def.resource.max, g.techniques.resource + p.def.mass * speed * 0.12 * (ctx.behaviors.includes('store') ? 1.4 : 1) * (0.6 + ctx.potency * 0.5));
    g.vfx.ring(p.mesh.position, COLOR, 0.2, 1.4, 0.3);
    g.audio.play('recoil.catch', { at: p.mesh.position });
    g.cam.kick({ fov: 3, pitch: -0.01 });
    g.drills.notify(p, 'caught');
    g.mastery.gain('recoil', 'efficiency', 0.01);
    g.tutorial.notify('absorbed');
  }
  for (const h of held) {
    // Held, it stays this player's to move.
    g.props.touch(h.prop);
    const target = eye.clone().addScaledVector(dir, h.offset.z).add(new THREE.Vector3(0, h.offset.y, 0)).addScaledVector(new THREE.Vector3(dir.z, 0, -dir.x), h.offset.x);
    const cur = h.prop.body.translation();
    const next = new THREE.Vector3(cur.x, cur.y, cur.z).lerp(target, 1 - Math.exp(-12 * dt));
    h.prop.body.setNextKinematicTranslation(next);
  }
}

function releaseHeld(ctx: AbilityContext): number {
  const g = ctx.game;
  const dir = g.cam.aimDirection();
  let n = 0;
  for (const h of held) {
    h.prop.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    if (ctx.behaviors.includes('relaunch')) {
      g.props.launch(h.prop, dir.clone().multiplyScalar(16 + ctx.potency * 14));
      g.vfx.trail([h.prop.mesh.position.clone(), h.prop.mesh.position.clone().addScaledVector(dir, -1.5)], COLOR, 0.3, 0.2);
      n++;
    }
  }
  if (n) { g.audio.play('recoil.release'); g.cam.kick({ fov: 5 }); }
  held.length = 0;
  return n;
}

// Zero Hour: a slow push in on the sign, a worm's-eye look up at the caster
// with the target beyond, a hard cut wide as every stored joule leaves at
// once, and a crane up over the wreck.
const cutscene: CutsceneDef = {
  id: 'max-recoil', title: { jp: '零時', en: 'Zero Hour' }, color: COLOR, pull: 3.4, reach: 12, word: 'ドゴォン',
  shots: [
    { duration: 1.05, timeScale: 0.03, from: { pos: [1.05, 1.5, 2.0], look: [0, 1.38, 0], fov: 36 }, to: { pos: [0.72, 1.48, 1.5], fov: 30, roll: -0.04 }, events: opening('recoil.max.charge') },
    { duration: 0.5, timeScale: 0.03, from: { pos: [-1.3, 0.25, -1.0], look: [0, 1.3, 0], lookRel: 'mid', fov: 60, roll: 0.14 }, to: { pos: [-1.0, 0.3, -0.6], fov: 54, roll: 0.1 }, ease: 'in', events: [{ at: 0.05, kind: 'sfx', id: 'recoil.max.inhale' }] , page: { lines: 'rush' } },
    { duration: 0.95, timeScale: 0.35, from: { rel: 'mid', pos: [5.2, 1.8, 1.0], look: [0, 1.0, 0], fov: 62, roll: -0.1 }, to: { pos: [6.4, 2.4, 1.6], fov: 76, roll: -0.03 }, events: [...blow(0, 'recoil.max.blow')] , page: { lines: 'focus' } },
    { duration: 0.75, timeScale: 0.55, from: { rel: 'mid', pos: [-2.5, 6.5, -5.5], look: [0, 0.4, 0], fov: 58 }, to: { pos: [-3, 8.2, -6.8], fov: 62 }, ease: 'inOut' },
  ],
};

const drill: DrillDef = {
  id: 'recoil-crane', technique: 'recoil', title: 'Crane Catch', jp: '受け身', brief: 'Crates drop from the hoist. Face them and hold Absorption before they land.',
  position: [-20, 0, 10],
  tiers: [
    { name: 'First Catch', count: 4, interval: 3.2, dropHeight: 8, pass: 2, gains: { efficiency: 0.12, activation: 0.08 } },
    { name: 'Rhythm', count: 6, interval: 2.2, dropHeight: 9, pass: 4, gains: { efficiency: 0.14, tolerance: 0.08, activation: 0.08 } },
    { name: 'Hailstorm', count: 9, interval: 1.4, dropHeight: 10, pass: 7, gains: { efficiency: 0.16, output: 0.1, activation: 0.1 } },
  ],
  // Each item is one crate or barrel off the hoist: caught scores, landed does not.
  spawn(game, tier, index) {
    const hook = game.world.craneHook.position;
    const at = new THREE.Vector3(hook.x + (Math.random() - 0.5) * 2.5, tier.dropHeight ?? 8, hook.z + (Math.random() - 0.5) * 2.5 + (index % 2) * 1.5);
    const p = game.props.spawn(index % 3 === 2 ? 'barrel' : 'crate', at);
    p.body.setLinvel({ x: 0, y: -1.5, z: 0 }, true);
    game.audio.play('prop.drop', { at });
    return {
      notify: (prop, event) => (prop === p && event === 'caught' ? 1 : null),
      update: () => {
        if (!p.alive) return 0;
        if (p.body.translation().y >= p.half.y + 0.08 || p.body.linvel().y <= -0.5) return null;
        game.audio.play('prop.land', { at: p.mesh.position });
        game.vfx.until(4, () => game.props.remove(p));
        return 0;
      },
    };
  },
};

export const recoil: TechniqueKit = {
  id: 'recoil', name: 'Recoil', glyph: '反', color: COLOR, type: 'Manipulation, Energy family', sfx: 'ドンッ',
  blurb: 'Take in kinetic energy, store it, release it later as motion. Energy never disappears: every softened blow is a debt.',
  breadth: 2,
  resource: { name: 'Reserve', max: 100, regen: 7, startsFull: false, free: ['primary', 'secondary'] },
  primitive: { name: 'Recoil', short: 'a weak shove', description: 'Absorb a little kinetic energy from any direction and leak most of it. Release what is left as a shove.' },
  parameters: ['direction', 'range', 'target', 'trigger', 'duration', 'resource', 'body'],
  shapes: {
    punch: { label: 'releases stored energy as a strike', short: 'strike with stored energy', kinds: ['primary'], description: 'A close strike powered by the Reserve.' },
    line: { label: 'releases stored energy as a shock along the ground', short: 'shock along the ground', kinds: ['primary'], description: 'A ground wave that throws props and people along one line.' },
    absorb: { label: 'takes incoming motion into the Reserve', short: 'hold to take in blows', kinds: ['secondary'], description: 'Hold to brace. Blows and falling objects fill the Reserve instead of hurting you.' },
    zeroHour: { label: 'dumps every stored joule in one declared motion', short: 'release everything at once', kinds: ['max'], description: 'Everything at once, in every direction.' },
  },
  behaviors: { store: 'stores more of each absorbed blow', relaunch: 'relaunches caught objects at the aim', anchor: 'the release does not move you' },
  catalogue,
  gestures: {
    primary: gestureSet(0.62, 0.3, [
      { t: 0, right: 'chamber', left: 'guard', slow: true }, { t: 0.2, right: 'chamber' }, { t: 0.26, right: 'punch', snap: true, camera: { fov: 4, pitch: 0.012 } }, { t: 0.36, right: 'punchOver' }, { t: 0.5, right: 'rest', left: 'rest' }]),
    secondary: gestureSet(0.5, 0.2, [{ t: 0, right: 'bracePalm', left: 'bracePalm', snap: true, camera: { fov: -3 } }, { t: 0.3, right: 'braceWide', left: 'braceWide' }], true),
    max: gestureSet(2.2, 1.6, [{ t: 0, right: 'crossChest', left: 'crossChest', slow: true }, { t: 0.8, right: 'raiseHigh', left: 'raiseHigh', slow: true }, { t: 1.55, right: 'punch', left: 'punch', snap: true, camera: { fov: 12, pitch: 0.04 } }, { t: 2.0, right: 'rest', left: 'rest' }]),
  },
  // The martial salute: the left palm presents at the sternum, the right fist
  // draws back, then drives into it. The hands break to a guard on release.
  sign: signGesture([
    { t: 0, right: 'sealGather', left: 'sealGather', slow: true },
    { t: 0.3, right: 'chamber', left: 'seal', slow: true },
    { t: 0.55, right: 'fistToPalm', snap: true, camera: { fov: -4, pitch: 0.012 }, event: 'seal' },
    { t: 1.2, right: 'guard', left: 'guard', snap: true, camera: { fov: 6, roll: 0.02 }, event: 'release' },
  ]),
  traits: {
    'kinetic-source': (prop, ctx) => { ctx.game.techniques.resource += prop.def.mass * 0.1; },
  },
  drill,
  cutscene,
  effects: {
    cast(ctx) {
      const g = ctx.game;
      const reserveFrac = g.techniques.resource / 100;
      if (ctx.shape === 'punch') {
        const range = rangeFor(ctx, 3.0);
        const dmg = (14 + 36 * reserveFrac) * ctx.potency;
        const hits = hitCone(ctx, range, frontOnly(ctx) ? 0.45 : 0.9, dmg, { knock: 3 + 9 * reserveFrac * ctx.potency, lift: 2, kind: 'kinetic', heavy: dmg > 30 });
        const props = propsInCone(g, ctx.origin, ctx.dir, range + 0.5, 0.6);
        shoveProps(ctx, props, 3 + 8 * reserveFrac * ctx.potency);
        g.techniques.resource *= 0.4;
        const fist = ctx.origin.clone().addScaledVector(ctx.dir, 0.9).add(new THREE.Vector3(0, -0.25, 0));
        g.vfx.ring(fist, COLOR, 0.15, 1.6 + reserveFrac * 2, 0.35, ctx.dir);
        g.vfx.trail([ctx.origin.clone().add(new THREE.Vector3(0.2, -0.3, 0)), fist, fist.clone().addScaledVector(ctx.dir, 0.6)], COLOR, 0.22, 0.14);
        if (hits.length || props.length) { g.vfx.burst(fist.clone().addScaledVector(ctx.dir, 0.5), 10, 'spark', 5, 0xffb070, ctx.dir); g.audio.play('recoil.punch.hit', { weight: reserveFrac }); }
        else g.audio.play('recoil.punch.whiff');
        return { hits: hits.length + props.length, hitStop: hits.length ? 0.05 + reserveFrac * 0.06 : 0, impactFrame: dmg > 30 && hits.length ? 2 : 0, cameraKick: { fov: 6 + reserveFrac * 8, pitch: 0.02 } };
      }
      if (ctx.shape === 'line') {
        const range = rangeFor(ctx, 11);
        const dmg = (10 + 30 * reserveFrac) * ctx.potency;
        const hits = hitCone(ctx, range, 0.18, dmg, { knock: 5 + 8 * reserveFrac, lift: 3, kind: 'kinetic' });
        shoveProps(ctx, propsInCone(g, ctx.origin, ctx.dir, range, 0.2), 4 + 8 * reserveFrac, 0.8);
        g.techniques.resource *= 0.35;
        for (let i = 1; i <= 6; i++) { const at = g.player.position.clone().addScaledVector(ctx.dir.clone().setY(0).normalize(), i * range / 6); at.y = 0.05; g.vfx.after(i * 0.045, () => { g.vfx.ring(at, COLOR, 0.3, 1.6, 0.35); g.vfx.burst(at, 3, 'debris', 3); }); }
        g.audio.play('recoil.line');
        return { hits: hits.length, hitStop: hits.length ? 0.05 : 0, cameraKick: { fov: 7, pitch: 0.025 } };
      }
      if (ctx.shape === 'absorb') {
        absorbing = true;
        g.tutorial.notify('absorb');
        return { moveLock: 0, cameraKick: { fov: -4 } };
      }
      if (ctx.shape === 'zeroHour') {
        const center = g.player.position.clone();
        const radius = 9 + ctx.potency * 4;
        const dmg = (60 + 140 * reserveFrac) * ctx.potency;
        let hits = 0;
        for (const e of g.techniques.enemiesInSphere(center, radius)) { g.combat.hitEnemy(e, dmg * (1 - e.position.distanceTo(center) / (radius * 1.5)), { from: center, knock: 14, lift: 6, kind: 'kinetic', heavy: true }); hits++; }
        for (const p of g.props.instances) if (p.mesh.position.distanceTo(center) < radius) g.props.push(p, p.mesh.position.clone().sub(center).setY(0.6).normalize().multiplyScalar(p.def.mass * (8 + 10 * reserveFrac)));
        g.techniques.resource = 0;
        g.vfx.ring(center.clone().add(new THREE.Vector3(0, 0.1, 0)), COLOR, 0.5, radius * 1.3, 0.7);
        g.vfx.ring(center.clone().add(new THREE.Vector3(0, 1.2, 0)), 0xffffff, 0.2, radius, 0.5, new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), g.cam.yaw));
        g.vfx.burst(center.clone().add(new THREE.Vector3(0, 1, 0)), 40, 'spark', 12, 0xffc090);
        g.vfx.burst(center, 18, 'debris', 8);
        g.vfx.flash(center.clone().add(new THREE.Vector3(0, 1.5, 0)), COLOR, 120, 0.6, 26);
        g.audio.play('recoil.max.tail');
        return { hits, hitStop: 0.14, impactFrame: 3, rooted: 1.2, cameraKick: { fov: 16, pitch: 0.05, roll: 0.03 } };
      }
      return undefined;
    },
    hold(ctx, dt) { catchProps(ctx, dt); },
    release(ctx) { absorbing = false; releaseHeld(ctx); },
    passive(game) { if (!game.techniques.casting && absorbing) { absorbing = false; releaseHeld({ game, behaviors: [], potency: 0.5 } as unknown as AbilityContext); } },
    // Whatever was caught drops where it is.
    reset() {
      absorbing = false;
      for (const h of held) if (h.prop.alive) h.prop.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      held.length = 0;
    },
    onStruck(game, amount, from) {
      if (!absorbing) return amount;
      const dir = from.clone().sub(game.player.position).setY(0).normalize();
      const facing = game.cam.aimDirection().setY(0).normalize().dot(dir) > 0.3;
      if (!facing) return amount;
      game.techniques.resource = Math.min(100, game.techniques.resource + amount * 1.3);
      game.vfx.ring(game.player.eye().addScaledVector(dir, 0.6), COLOR, 0.2, 1.3, 0.3, dir);
      game.audio.play('recoil.absorbed');
      game.cam.kick({ fov: 3 });
      game.tutorial.notify('absorbed');
      return 0;
    },
  },
  audio: { primary: 'recoil.cast', secondary: 'recoil.absorb', max: 'recoil.max.cast' },
};

