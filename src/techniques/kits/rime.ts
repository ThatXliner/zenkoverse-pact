import * as THREE from 'three';
import type { TechniqueKit } from '../kit';
import { signGesture, gestureSet, rangeFor, hitCone, propsInCone } from './shared';
import { anchored } from './shift';
import type { Pact } from '../../pacts/schema';
import { RAPIER } from '../../physics/world';
import { toon } from '../../render/materials';

const COLOR = 0x9fe8ff;

const catalogue: Pact[] = [
  { id: 'rime.icebreak', technique: 'rime', name: 'Icebreak', slot: 'primary', grant: { shape: 'icebreak', behaviors: ['pin'] }, clauses: [
    { kind: 'restrict', restriction: { param: 'direction', value: 'ground' } }, { kind: 'restrict', restriction: { param: 'target', value: 'water' } }] },
  { id: 'rime.cold-stitch', technique: 'rime', name: 'Cold Stitch', slot: 'secondary', grant: { shape: 'coldStitch', behaviors: ['pin'] }, clauses: [
    { kind: 'restrict', restriction: { param: 'range', value: 'medium' } }, { kind: 'restrict', restriction: { param: 'trigger', value: 'grounded' } }] },
  { id: 'rime.tenfold-glacier', technique: 'rime', name: 'Tenfold Glacier', slot: 'max', grant: { shape: 'tenfold' }, clauses: [
    { kind: 'restrict', restriction: { param: 'body', value: 'noMove' } }, { kind: 'restrict', restriction: { param: 'resource', value: 'all' } }, { kind: 'restrict', restriction: { param: 'trigger', value: 'declared' } }] },
];

const cutscene = anchored({
  id: 'max-rime', title: { jp: '十指氷河', en: 'Tenfold Glacier' }, color: COLOR, timeScale: 0.1, letterbox: true,
  shots: [
    { duration: 1.1, from: [0.5, 1.2, -1.3], to: [0.3, 1.0, -1.0], look: [0, 1.0, 0], fov: [42, 36], events: [{ at: 0, kind: 'gesture' }, { at: 0.25, kind: 'title' }, { at: 0.1, kind: 'sfx', id: 'highUp', pitch: 0.5 }] },
    { duration: 1.3, from: [-1.8, 0.25, 1.2], to: [-2.6, 0.4, 2.4], look: [0, 0.3, 0], lookTo: [0, 0.4, -4], roll: [0.18, 0.04], fov: [64, 78], events: [{ at: 0.45, kind: 'impactFrame', frames: 3 }, { at: 0.5, kind: 'resolveHit' }, { at: 0.5, kind: 'shake', amount: 0.8 }, { at: 0.5, kind: 'sfx', id: 'impactGlass_heavy_000', pitch: 0.6 }, { at: 0.55, kind: 'slow', scale: 0.45 }] },
    { duration: 0.9, from: [4, 3.5, 4], to: [3.5, 3.0, 3], look: [0, 0.5, -1], fov: [70, 60] },
  ],
});

function freezeProp(ctx: { game: import('../../app/game').Game }, p: import('../../world/props').PropInstance, seconds: number): void {
  const g = ctx.game;
  if (!p.def.traits.includes('freezable') && !p.def.traits.includes('porous') && !p.def.traits.includes('wood')) return;
  p.body.setBodyType(RAPIER.RigidBodyType.Fixed, true);
  p.frozen = seconds;
  g.vfx.patch(p.mesh.position.clone().setY(0), p.half.x * 1.6, 'frost', seconds);
}

function freezeArea(g: import('../../app/game').Game, center: THREE.Vector3, radius: number, potency: number, pin: boolean, seconds: number): number {
  let hits = 0;
  g.vfx.patch(center.clone().setY(Math.max(0, center.y)), radius, 'frost', seconds + 3);
  for (let i = 0; i < Math.round(radius * 1.6); i++) {
    const a = Math.random() * Math.PI * 2, r = Math.random() * radius;
    g.vfx.iceSpike(center.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)), 0.5 + Math.random() * 1.2 * potency, seconds + 1);
  }
  for (const e of g.techniques.enemiesInSphere(center, radius)) {
    g.combat.hitEnemy(e, 16 * potency, { from: center, kind: 'cold', stagger: true });
    if (pin) { e.frozen = seconds * 0.6; e.slow = 0.3; }
    hits++;
  }
  for (const p of g.props.instances) if (p.mesh.position.distanceTo(center) < radius) freezeProp({ game: g }, p, seconds);
  // Over the koi pond the frost is a floor: the whole surface freezes into
  // a platform you can stand on until it thaws.
  const pond = g.world.pond;
  if (Math.hypot(center.x - pond.center.x, center.z - pond.center.z) < pond.radius + radius * 0.5 && center.y < pond.surfaceY + 1) {
    const body = g.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(pond.center.x, pond.surfaceY - 0.1, pond.center.z));
    g.physics.world.createCollider(RAPIER.ColliderDesc.cylinder(0.1, pond.radius + 0.4), body);
    const slab = new THREE.Mesh(new THREE.CylinderGeometry(pond.radius + 0.4, pond.radius + 0.2, 0.2, 32), toon(0xdff6ff, { transparent: true, opacity: 0.9 }));
    slab.position.set(pond.center.x, pond.surfaceY - 0.1, pond.center.z);
    g.renderer.scene.add(slab);
    g.vfx.until(seconds + 4, () => {
      g.renderer.scene.remove(slab);
      slab.geometry.dispose();
      (slab.material as THREE.Material).dispose();
      g.physics.world.removeRigidBody(body);
    });
  }
  g.vfx.burst(center.clone().add(new THREE.Vector3(0, 0.3, 0)), 12, 'shard', 5);
  g.audio.play('impactGlass_medium_000', 0.7, 0.9);
  return hits;
}

export const rime: TechniqueKit = {
  id: 'rime', name: 'Rime', glyph: '霜', color: COLOR, type: 'Generation, Manipulation',
  blurb: 'Nucleate water through your fingernails. The koi pond in the yard is a great deal of water.',
  resource: { name: 'Warmth', max: 100, regen: 9, startsFull: true },
  primitive: { name: 'Rime', short: 'frost what you touch', description: 'Frost whatever water your nails touch. Imprecise, and it takes the heat out of your hands.' },
  parameters: ['direction', 'range', 'target', 'trigger', 'duration', 'resource', 'body'],
  shapes: {
    icebreak: { label: 'drives a ridge of ice spikes along the wet ground', short: 'ice ridge along the ground', kinds: ['primary'], description: 'A growing ridge that advances along the ground.' },
    coldStitch: { label: 'freezes the area at the aim and pins what stands in it', short: 'freeze the area you aim at', kinds: ['secondary'], description: 'Freeze a patch at distance.' },
    tenfold: { label: 'opens all ten nail beds at once into a glacier', short: 'a wide glacier around you', kinds: ['max'], description: 'A wide frost field. You cannot move while it spreads.' },
  },
  behaviors: { pin: 'what it freezes stays frozen in place', bridge: 'freezes the pond into a floor you can stand on', sharp: 'spikes cut deeper' },
  catalogue,
  gestures: {
    primary: gestureSet(0.7, 0.34, [{ t: 0, right: 'clawReady', left: 'clawReady', slow: true }, { t: 0.18, right: 'slamUp', slow: true }, { t: 0.3, right: 'slamDown', snap: true, camera: { fov: 5, pitch: 0.03 } }, { t: 0.5, right: 'clawReady' }, { t: 0.62, right: 'rest', left: 'rest' }]),
    secondary: gestureSet(0.6, 0.26, [{ t: 0, right: 'clawReady', slow: true }, { t: 0.2, right: 'clawReach', snap: true, camera: { fov: 4 } }, { t: 0.45, right: 'rest' }]),
    max: gestureSet(2.3, 1.7, [{ t: 0, right: 'clawReady', left: 'clawReady', slow: true }, { t: 0.8, right: 'raiseHigh', left: 'raiseHigh', slow: true }, { t: 1.6, right: 'slamDown', left: 'slamDown', snap: true, camera: { fov: 14, pitch: 0.06 } }, { t: 2.1, right: 'rest', left: 'rest' }]),
  },
  // Claws out, then the palms press together and frost over. They fan open
  // on release and settle back to claws.
  sign: signGesture([
    { t: 0, right: 'clawReady', left: 'clawReady', slow: true },
    { t: 0.5, right: 'seal', left: 'seal', snap: true, camera: { fov: -4 }, event: 'seal' },
    { t: 1.2, right: 'quietSpread', left: 'quietSpread', snap: true, camera: { fov: 7, pitch: -0.01 }, event: 'release' },
    { t: 1.42, right: 'clawReady', left: 'clawReady' },
  ]),
  avatarClips: { primary: 'Sword_Attack', secondary: 'Spell_Simple_Shoot', max: 'Spell_Simple_Enter' },
  traits: {
    freezable: (prop, ctx) => freezeProp(ctx, prop, 6),
  },
  cutscene,
  effects: {
    cast(ctx) {
      const g = ctx.game;
      const flat = ctx.dir.clone().setY(0).normalize();
      if (ctx.shape === 'icebreak') {
        const range = rangeFor(ctx, 9);
        const hits = hitCone(ctx, range, 0.22, 22 * ctx.potency, { knock: 3, lift: 4, kind: 'cold' });
        for (const e of hits) if (ctx.behaviors.includes('pin')) { e.frozen = 1.6; e.slow = 0.4; }
        const start = g.player.position.clone();
        for (let i = 1; i <= 7; i++) {
          const at = start.clone().addScaledVector(flat, i * range / 7);
          at.y = 0;
          g.vfx.after(i * 0.055, () => { g.vfx.iceSpike(at, 0.8 + i * 0.25 * ctx.potency, 7); g.vfx.patch(at, 0.9, 'frost', 8); if (i % 2 === 0) g.audio.play('impactGlass_light_000', 0.4, 1.1 - i * 0.05); });
        }
        for (const p of propsInCone(g, ctx.origin, flat, range, 0.3)) { p.body.wakeUp(); p.body.applyImpulse(new THREE.Vector3(flat.x, 1.5, flat.z).multiplyScalar(p.def.mass * 3), true); if (ctx.behaviors.includes('pin')) freezeProp(ctx, p, 5); }
        g.audio.play('impactGlass_heavy_001', 0.6, 1);
        g.mastery.gain('rime', 'control', 0.004);
        return { hits: hits.length, hitStop: hits.length ? 0.05 : 0, cameraKick: { fov: 6, pitch: 0.03 } };
      }
      if (ctx.shape === 'coldStitch') {
        const range = rangeFor(ctx, 16);
        const aim = ctx.aim ?? ctx.origin.clone().addScaledVector(ctx.dir, range);
        const at = ctx.origin.clone().add(aim.clone().sub(ctx.origin).clampLength(0, range));
        const ground = g.physics.castRay(at.clone().add(new THREE.Vector3(0, 2, 0)), new THREE.Vector3(0, -1, 0), 8);
        const center = ground ? ground.point : at;
        const hits = freezeArea(g, center, 2.4 + ctx.potency, ctx.potency, ctx.behaviors.includes('pin'), 4);
        g.tutorial.notify('froze');
        return { hits, hitStop: hits ? 0.04 : 0, cameraKick: { fov: 4 } };
      }
      if (ctx.shape === 'tenfold') {
        const center = g.player.position.clone();
        let hits = 0;
        for (let ring = 1; ring <= 3; ring++) g.vfx.after(ring * 0.09, () => { hits += freezeArea(g, center, 4 * ring * (0.8 + ctx.potency * 0.4), ctx.potency * 1.4, true, 9); g.cam.shake(0.3); });
        g.vfx.flash(center.clone().add(new THREE.Vector3(0, 1.5, 0)), COLOR, 100, 0.6, 24);
        g.vfx.ring(center.clone().add(new THREE.Vector3(0, 0.1, 0)), COLOR, 0.5, 16, 0.8);
        g.audio.play('impactGlass_heavy_000', 1, 0.5);
        return { hits: 1, hitStop: 0.12, impactFrame: 3, rooted: 2.0, cameraKick: { fov: 14, pitch: 0.05 } };
      }
      return undefined;
    },
    passive(game, dt) {
      if (game.techniques.resource < 1 && game.techniques.casting) game.combat.hurtPlayer(dt * 6, { self: true });
    },
  },
  audio: { primary: { cast: 'impactGlass_light_000', volume: 0.4, pitch: 0.8 }, secondary: { cast: 'highUp', volume: 0.3, pitch: 1.3 }, max: { cast: 'powerUp3', volume: 0.6, pitch: 1.1 } },
};
