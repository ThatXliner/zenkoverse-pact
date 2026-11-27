import * as THREE from 'three';
import type { TechniqueKit, AbilityContext, CastResult } from '../kit';
import type { Game } from '../../app/game';
import { signGesture, gestureSet, rangeFor, targetsAllowed, breakProp } from './shared';
import { restriction, type Pact } from '../../pacts/schema';
import { opening, blow, type CutsceneDef } from '../../cutscene/cutscene';
import { GROUP_WORLD, GROUP_PROP, GROUP_ENEMY } from '../../physics/world';
import type { Gesture } from '../../hands/gestures';
import { snareLanes, standStation } from '../../drills/snareLanes';
import {
  COLOR, LINES, lines, lineEvents, nextRelease, handPoint, anchorPoint, strike, lay, passOn, drop, clearLines, updateLines,
  reachTo, haulTo, ghost, endGhosts, movable, holds, inHand, look, type Strand, type Anchor,
} from './tensionLines';

// Tension: the user tightens or loosens the fibres they touch. In the yard
// that is prepared wire from a spool on the wrist, strung by hand. Where
// the other Techniques act the moment they are cast, Tension is laid first
// and used after: lines strung across the ground trip whoever runs over
// them, a line round a body holds it to its length, and a draw tightens
// every line at once and lets go, flinging what they hold, hauling the
// caster up to where one is anchored, and cutting across what they cross.
// Its costs are the material's: a line holds only so much, a pin in open
// ground less, a blow swung through a line cuts it, and a draw held past
// taut gives way in the caster's hand.

const catalogue: Pact[] = [
  { id: 'tension.single-thread', technique: 'tension', name: 'Single Thread', slot: 'primary', grant: { shape: 'thread', behaviors: ['barbed'] }, clauses: [
    { kind: 'restrict', restriction: { param: 'target', value: 'single' } }, { kind: 'restrict', restriction: { param: 'range', value: 'medium' } }] },
  { id: 'tension.recoil', technique: 'tension', name: 'Recoil', slot: 'secondary', grant: { shape: 'draw', behaviors: ['quick'] }, clauses: [
    { kind: 'restrict', restriction: { param: 'duration', value: 'held' } }, { kind: 'restrict', restriction: { param: 'body', value: 'bothHands' } }] },
  // Slack's own key is taken by Recoil, so it binds to the first free extra key.
  { id: 'tension.slack', technique: 'tension', name: 'Slack', slot: 'secondary', grant: { shape: 'slack' }, clauses: [
    { kind: 'restrict', restriction: { param: 'direction', value: 'loosen' } }, { kind: 'restrict', restriction: { param: 'range', value: 'short' } }] },
  { id: 'tension.drawn-world', technique: 'tension', name: 'Drawn World', slot: 'max', grant: { shape: 'drawnWorld' }, clauses: [
    { kind: 'restrict', restriction: { param: 'resource', value: 'all' } }, { kind: 'restrict', restriction: { param: 'trigger', value: 'declared' } }, { kind: 'restrict', restriction: { param: 'body', value: 'noMove' } }] },
];

// Drawn World: the string figure close on the hands, then high over the
// caster as a line leaves every finger for everything in reach, a low cut
// from behind the target as the whole network is drawn in at once, and a
// crane up over where it all met.
const cutscene: CutsceneDef = {
  id: 'max-tension', title: { jp: '張界', en: 'Drawn World' }, color: COLOR, pull: 5, reach: 14, word: 'バヅンッ',
  shots: [
    { duration: 1.05, timeScale: 0.03, from: { pos: [0.95, 1.45, 1.9], look: [0, 1.35, 0], fov: 36 }, to: { pos: [0.6, 1.42, 1.42], fov: 29, roll: 0.04 }, events: opening('tension.max.charge') },
    { duration: 0.5, timeScale: 0.03, from: { rel: 'caster', pos: [-1.4, 6.2, -3.4], look: [0.3, 0.4, 2.6], fov: 60, roll: 0.06 }, to: { pos: [-1.7, 7.4, -4.1], fov: 66, roll: 0.03 }, ease: 'out', events: [{ at: 0.04, kind: 'sfx', id: 'tension.max.spread' }], page: { lines: 'rush' } },
    { duration: 0.95, timeScale: 0.3, from: { rel: 'target', pos: [-1.1, 0.45, 2.3], look: [0, 1.2, 0], lookRel: 'caster', fov: 62, roll: -0.1 }, to: { pos: [-1.5, 0.6, 3.1], fov: 74, roll: -0.03 }, events: [...blow(0, 'tension.max.blow')], page: { lines: 'focus' } },
    { duration: 0.75, timeScale: 0.5, from: { rel: 'caster', pos: [3, 6, -4.5], look: [0, 0.5, 1.5], fov: 58 }, to: { pos: [3.6, 7.6, -5.4], fov: 62 }, ease: 'inOut' },
  ],
};

// The hand flies back open as a drawn line is let go: played over the
// draw's held stance the moment it is released.
const RELEASE: Gesture = { duration: 0.36, impactAt: 0.02, keys: [{ t: 0, right: 'drawRelease', left: 'drawFront', snap: true, camera: { fov: 5, pitch: 0.01 } }, { t: 0.22, right: 'rest', left: 'rest' }] };

// ------------------------------------------------------------ what a Pact asks

function words(ctx: AbilityContext) {
  const p = ctx.pact;
  const r = <K extends 'direction' | 'target' | 'duration'>(k: K) => (p ? restriction(p, k) : undefined);
  return { loosen: r('direction') === 'loosen', ground: r('direction') === 'ground', target: r('target'), duration: r('duration') };
}

// How many lines stand at once: one raw, three under a Pact, two braided,
// and one only, far stronger, for a Pact that gives up every other target.
function maxLines(ctx: AbilityContext): number {
  if (!ctx.pact) return 1;
  if (targetsAllowed(ctx).single) return 1;
  return ctx.behaviors.includes('braid') ? 2 : 3;
}

// What the line in hand would strike. Top-down that is whatever is under the
// cursor, a roof or a wall included; under a roof, the floor under it.
// Otherwise whatever the crosshair is on.
function aimFor(g: Game, ctx: AbilityContext): THREE.Vector3 {
  const mask = GROUP_WORLD | GROUP_PROP | GROUP_ENEMY;
  if (g.cam.isTop && !g.cam.inShot) {
    if (g.world.indoorsAt(g.player.position) > 0) return ctx.aim ?? ctx.origin.clone().addScaledVector(ctx.dir, 20);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(g.input.mouse.x, g.input.mouse.y), g.renderer.camera);
    const hit = look(g, rc.ray.origin, rc.ray.direction, 200, mask);
    if (hit) return hit.point;
  }
  const hit = look(g, ctx.origin, ctx.dir, 60, mask);
  return hit ? hit.point : ctx.origin.clone().addScaledVector(ctx.dir, 30);
}

// ------------------------------------------------------------ Thread

let heldLine: Strand | null = null;

function thread(ctx: AbilityContext): CastResult {
  const g = ctx.game;
  const w = words(ctx);
  const allow = targetsAllowed(ctx);
  const single = allow.single;
  const range = rangeFor(ctx, ctx.pact ? 15 : 7);
  const from = handPoint(g);
  const struck = strike(g, from, aimFor(g, ctx), range, { bodies: allow.people && w.target !== 'self', props: allow.props && w.target !== 'self', assist: 1.1 });
  let anchor: Anchor = struck.anchor;
  // Along the ground only: a line that struck a wall comes down to a pin below it.
  if (w.ground && anchor.kind === 'fixed' && !anchor.pin) {
    const down = g.physics.castRay(anchor.at.clone().add(new THREE.Vector3(0, 0.2, 0)), new THREE.Vector3(0, -1, 0), 12, GROUP_WORLD);
    anchor = { kind: 'fixed', at: (down ? down.point : anchor.at).clone().setY((down ? down.point.y : anchor.at.y) + LINES.pinHeight), pin: true };
  }
  // A Pact that takes only people strings nothing when no one is there.
  if (w.target === 'people' && anchor.kind !== 'body') { g.vfx.trail([from, struck.point], COLOR, 0.04, 0.12); g.audio.play('tension.cast', { pitch: 0.8 }); return { hits: 0 }; }


  const braid = ctx.behaviors.includes('braid'), barbed = ctx.behaviors.includes('barbed');
  const strength = (ctx.pact ? 1 : 0.7) * (braid ? 1.8 : 1) * (single ? 2.2 : 1) * (anchor.kind === 'fixed' && anchor.pin ? 0.85 : 1);
  const cut = (9 + (barbed ? 10 : 0)) * ctx.potency * (single ? 1.6 : 1);
  const life = w.duration === 'instant' ? 1.5 : w.duration === 'brief' ? 5 : LINES.life;
  let hits = 0;
  if (anchor.kind === 'body') {
    const e = anchor.enemy;
    // The snare holds through Enemy.freeze, as every hold does: a body tied
    // again and again is held for less each time, then not at all.
    const held = w.loosen ? 0 : e.freeze(LINES.snareHold);
    if (held > 0 || w.loosen) anchor.until = g.clock.time + (held > 0 ? held * LINES.snarePerHold : 6);
    else anchor = { kind: 'fixed', at: e.position.clone().setY(e.position.y + LINES.pinHeight), pin: true };
    g.combat.hitEnemy(e, cut * 0.6, { from, stagger: false, kind: 'cut' });
    hits = 1;
    if (anchor.kind === 'body') { for (const f of lineEvents) f('snare', e, 0); g.audio.play('tension.snare', { at: e.center() }); }
  }
  // A metal edge frays the line where it is tied.
  const metal = anchor.kind === 'prop' && anchor.prop.def.traits.includes('metal');
  if (metal && anchor.kind === 'prop') tension.traits.metal!(anchor.prop, ctx);
  // The line in hand is passed on to the new anchor, strung between its old
  // one and this, and the hand takes up a fresh line to the new anchor; past
  // the limit the oldest line falls. With a single line there is no fresh
  // one: the line strung between the two is the line.
  const held = inHand();
  const passed = held ? passOn(g, held, anchor) : false;
  if (passed) g.audio.play('tension.pin', { at: anchorPoint(g, anchor) });
  const max = maxLines(ctx);
  while (lines.list.length > max) drop(g, lines.list.find((l) => l !== held) ?? lines.list[0]!, 'slip');
  if (!passed || max > 1) {
    while (lines.list.length >= max) drop(g, lines.list.find((l) => l !== held) ?? lines.list[0]!, 'slip');
    const s = lay(g, { kind: 'hand' }, anchor, { strength: strength * (metal ? 0.6 : 1), cut, power: (single ? 1.6 : 1) * (braid ? 1.25 : 1), life, loose: w.loosen, pinB: !passed });
    if (w.duration === 'held') heldLine = s;
  }
  const to = anchorPoint(g, anchor);
  const arc = from.clone().lerp(to, 0.5).add(new THREE.Vector3(0, 0.25 + from.distanceTo(to) * 0.04, 0));
  g.vfx.trail([from, arc, to], COLOR, 0.07, 0.16);
  g.vfx.ring(to, COLOR, 0.05, 0.45, 0.25);
  g.audio.play('tension.thread', { at: to });
  g.mastery.gainPassive('tension', 'range', 0.003);
  return { hits, cameraKick: { fov: 3, roll: 0.008 } };
}

// ------------------------------------------------------------ Recoil: draw and release

function drawHold(ctx: AbilityContext, dt: number): void {
  const g = ctx.game;
  // Only ever loosening: nothing is drawn tighter than it stands.
  if (words(ctx).loosen || !lines.list.length) return;
  const speed = (ctx.behaviors.includes('quick') ? 1 / 0.55 : 1) * (1 + g.mastery.get('tension', 'speed') * 0.5);
  lines.charge = Math.min(1, lines.charge + (dt / LINES.draw) * speed);
  for (const s of lines.list) {
    if (s.loose > 0 && s.loose !== Infinity) s.loose = 0;
    if (s.loose > 0) continue;
    s.drawn = lines.charge;
    // What a line holds is reeled in as it tightens.
    if (movable(s.a) || movable(s.b)) s.rest = Math.max(1.2, s.rest - dt * 2.2 * lines.charge);
  }
  if (lines.charge >= 1) {
    if (!lines.rang) {
      // Taut: the lines ring, the cue to let go.
      lines.rang = true;
      g.audio.play('tension.taut', { at: handPoint(g) });
      g.vfx.glint(handPoint(g), 0.4, 0.2);
      for (const s of lines.list) s.shiver = 0.25;
    }
    lines.over += dt;
    // A trained hand (Control) holds a line past taut longer before it gives.
    if (lines.over > LINES.overdraw * (1 + g.mastery.get('tension', 'control'))) overdrawn(g);
  }
}

// Held too long past taut, the line under the most load gives, and the
// force it held goes back down it: into the caster's hand if they hold it
// or stand at its pin, else into whoever stands nearest the break.
function overdrawn(g: Game): void {
  const s = [...lines.list].filter((l) => l.loose <= 0).sort((a, b) => b.load / b.strength - a.load / a.strength)[0];
  lines.charge = 0.35; lines.over = 0; lines.rang = false;
  if (!s) return;
  const near = anchorPoint(g, s.a);
  const mine = s.a.kind === 'hand' || near.distanceTo(g.player.position) < 2.5 || anchorPoint(g, s.b).distanceTo(g.player.position) < 2.5;
  drop(g, s, 'snap');
  if (mine) {
    g.combat.hurtPlayer(6 * (1 - 0.5 * g.mastery.get('tension', 'control')), { self: true });
    g.cam.kick({ fov: -3, roll: -0.03 });
    g.audio.play('tension.backlash');
    g.vfx.burst(handPoint(g), 5, 'spark', 3, 0xffd0e4);
  } else {
    const e = g.targets().filter((t) => t.alive).sort((a, b) => a.position.distanceTo(near) - b.position.distanceTo(near))[0];
    if (e && e.position.distanceTo(near) < 3) g.combat.hitEnemy(e, s.cut, { from: near, kind: 'cut', stagger: false });
  }
}

// Let go: every set line gives back what the draw put into it.
function release(ctx: AbilityContext): void {
  const g = ctx.game;
  const c = Math.max(0.3, words(ctx).loosen ? 0.35 : lines.charge);
  lines.drawing = false; lines.charge = 0; lines.over = 0; lines.rang = false;
  g.vfx.after(0, () => { g.hands.play(RELEASE, 1, () => undefined, (k) => g.cam.kick(k)); g.avatar.perform(RELEASE, 1); });
  const rel = nextRelease();
  let hits = 0;
  let any = false;
  for (const s of [...lines.list]) {
    if (s.loose > 0) continue;
    any = true;
    hits += discharge(ctx, s, c, rel);
  }
  if (!any) return;
  g.audio.play('tension.snap', { at: handPoint(g), weight: c });
  g.cam.kick({ fov: 3 + 6 * c, pitch: 0.012 });
  if (hits) {
    g.clock.hitStop(0.04 + 0.05 * c);
    if (c > 0.9) g.renderer.impactFrame(1, new THREE.Color(COLOR));
    g.techniques.charge = Math.min(1, g.techniques.charge + 0.08 * hits);
  }
}

// One line let go. It whips across whatever stands on it. What it holds at
// either end is pulled toward the other end: a body yanked off its feet, a
// prop flung along the line and past it (from the hand, out along the aim).
// A line from the hand to an anchor above the caster hauls them up to it.
// A line between two fixed anchors stands, worn by the release.
function discharge(ctx: AbilityContext, s: Strand, c: number, rel: number): number {
  const g = ctx.game;
  const f = c * s.power;
  const pa = anchorPoint(g, s.a), pb = anchorPoint(g, s.b);
  let hits = 0;
  for (const e of g.targets()) {
    if (!e.alive || holds(s, e)) continue;
    const r = reachTo(g, s, e);
    if (r.d > 0.9) continue;
    const dmg = (8 + 22 * f) * ctx.potency;
    g.combat.hitEnemy(e, dmg, { from: r.at, knock: 3 + 3 * f, lift: 1.5, kind: 'cut', heavy: dmg > 32 });
    for (const fn of lineEvents) fn('cut', e, rel);
    hits++;
  }
  g.vfx.trail([pa, pa.clone().lerp(pb, 0.5).add(new THREE.Vector3(0, 0.15, 0)), pb], 0xffffff, 0.1, 0.12);
  g.vfx.after(0.04, () => g.vfx.trail([pa, pb], COLOR, 0.08, 0.18));
  if (s.a.kind === 'hand' && s.b.kind === 'fixed' && pb.y - g.player.position.y > 1.2 && pb.distanceTo(g.player.position) > 2.2) {
    drop(g, s, 'spent');
    haulTo(g, pb);
    g.mastery.gainPassive('tension', 'control', 0.004);
    return hits;
  }
  if (!movable(s.a) && !movable(s.b)) {
    s.drawn = 0;
    s.shiver = 0.4;
    s.load += 0.35;
    if (s.load >= s.strength) drop(g, s, 'snap');
    return hits;
  }
  drop(g, s, 'spent');
  for (const [end, to, other] of [[s.a, pb, s.b], [s.b, pa, s.a]] as const) {
    if (end.kind === 'body') {
      const e = end.enemy;
      const toward = other.kind === 'hand' ? g.player.position : to;
      const away = e.position.clone().sub(toward).setY(0).normalize();
      const dmg = (10 + 18 * f) * ctx.potency;
      g.combat.hitEnemy(e, dmg, { from: e.position.clone().add(away), knock: 5 + 8 * f, lift: 2.5, kind: 'cut', heavy: dmg > 32 });
      for (const fn of lineEvents) fn('yank', e, rel);
      hits++;
    } else if (end.kind === 'prop') {
      const p = end.prop;
      const tr = p.def.traits;
      if (tr.includes('porous') || tr.includes('fragile')) { tension.traits.porous!(p, ctx); continue; }
      const at = p.mesh.position;
      const dir = other.kind === 'hand' ? g.cam.aimDirection().setY(0).normalize() : to.clone().sub(at).setY(0).normalize();
      const speed = (10 + 14 * f) * (tr.includes('metal') ? 1.2 : 1);
      g.props.launch(p, dir.multiplyScalar(speed).add(new THREE.Vector3(0, 3 + 2 * f, 0)));
      lines.slung.push({ prop: p, left: 1.4, dmg: (14 + p.def.mass * 0.5) * f * ctx.potency, hit: new Set(), release: rel });
      g.audio.play('tension.sling', { at });
    }
  }
  return hits;
}

// ------------------------------------------------------------ Slack

// Slack empties the tension from what it reaches. A body caught in its
// wind-up loses its footing, its blow is spoiled and its guard left open;
// otherwise only its stride falters. A line round a body that was pulling
// against it drops it on its face. The hold goes through Enemy.freeze.
function slack(ctx: AbilityContext): CastResult {
  const g = ctx.game;
  const w = words(ctx);
  const k = w.loosen ? 1.6 : 1;
  const range = rangeFor(ctx, 12);
  const aim = aimFor(g, ctx);
  const allow = targetsAllowed(ctx);
  const cone = g.techniques.enemiesInCone(ctx.origin, ctx.dir, range, w.loosen ? 0.55 : 0.35);
  const near = g.targets().filter((e) => e.alive && Math.hypot(e.position.x - aim.x, e.position.z - aim.z) < 2.4 && e.position.distanceTo(g.player.position) < range + 1);
  let bodies = [...new Set([...cone, ...near])].filter((e) => e.alive);
  if (!allow.people) bodies = [];
  bodies.sort((a, b) => a.position.distanceTo(aim) - b.position.distanceTo(aim));
  // One body, unless the Pact only ever loosens: then all of them.
  if (!w.loosen || allow.single) bodies = bodies.slice(0, 1);
  let hits = 0;
  for (const e of bodies) {
    const winding = e.state === 'windup' || e.state === 'cast';
    const waist = e.position.clone().add(new THREE.Vector3(0, e.height * 0.5, 0));
    if (e.isBoss) {
      e.guardBroken = Math.max(e.guardBroken, 0.8 * k);
      e.slow = Math.min(e.slow, 0.6);
    } else if (winding) {
      e.stagger();
      e.guardBroken = Math.max(e.guardBroken, 1.3 * k);
      if (e.freeze(0.5) > 0) e.slow = Math.min(e.slow, 0.4);
      g.combat.hitEnemy(e, 4 * ctx.potency, { from: g.player.position, stagger: false, kind: 'cut' });
      for (const f of lineEvents) f('spoil', e, 0);
      g.audio.play('tension.spoil', { at: waist });
      g.vfx.burst(waist, 6, 'spark', 2, 0xffd0e4);
      g.mastery.gainPassive('tension', 'precision', 0.006);
    } else {
      e.slow = Math.min(e.slow, 0.45);
    }
    // What held them up falls away: a loop of line drops from the waist.
    g.vfx.trail([waist.clone().add(new THREE.Vector3(-0.35, 0.1, 0)), waist.clone().add(new THREE.Vector3(0, -0.35, 0)), waist.clone().add(new THREE.Vector3(0.35, 0.1, 0))], COLOR, 0.05, 0.4);
    g.vfx.ring(waist, COLOR, 0.6, 0.15, 0.3);
    hits++;
  }
  // The lines it reaches go slack. One that held a body straining against
  // it drops the body forward, the way it was pulling.
  for (const s of [...lines.list]) {
    const tied = [s.a, s.b].flatMap((x) => (x.kind === 'body' ? [x.enemy] : []));
    const reach = reachNear(g, s, aim) < 2.5 * k || tied.some((e) => e.position.distanceTo(aim) < 3 * k || bodies.includes(e));
    if (!reach) continue;
    if (s.strain > 0) for (const e of tied) {
      const other = anchorPoint(g, s.a.kind === 'body' && s.a.enemy === e ? s.b : s.a);
      const pull = e.position.clone().sub(other).setY(0).normalize();
      const held = e.freeze(0.6);
      g.combat.hitEnemy(e, (6 + 6 * k) * ctx.potency, { from: e.position.clone().addScaledVector(pull, -1), knock: held > 0 ? 5 : 2, lift: 1.5, kind: 'cut' });
      for (const f of lineEvents) f('fall', e, 0);
      hits++;
    }
    if (movable(s.a) || movable(s.b)) drop(g, s, 'slip');
    else { s.loose = 4 * k; s.drawn = 0; s.shiver = 0.3; }
  }
  g.audio.play('tension.slack', { at: aim });
  return { hits, hitStop: hits ? 0.03 : 0, cameraKick: { fov: -2, pitch: 0.01 } };
}

function reachNear(g: Game, s: Strand, p: THREE.Vector3): number {
  const pa = anchorPoint(g, s.a), pb = anchorPoint(g, s.b);
  return new THREE.Line3(pa, pb).closestPointToPoint(p, true, new THREE.Vector3()).distanceTo(p);
}

// ------------------------------------------------------------ Drawn World

// Every line the caster holds, and one from each finger to every body and
// thing in reach, become one network, and the caster draws it all in at
// once. The force runs through every strand of it, the caster's own hands
// included: the more lines, the harder it lands, and the more it costs them.
function drawnWorld(ctx: AbilityContext): CastResult {
  const g = ctx.game;
  const center = g.player.position.clone();
  const hand = handPoint(g);
  const radius = 13 + ctx.potency * 3;
  const bodies = g.techniques.enemiesInSphere(center, radius).slice(0, 10);
  const props = g.props.instances.filter((p) => p.alive && p.mesh.position.distanceTo(center) < radius).slice(0, Math.max(0, 10 - bodies.length));
  const n = bodies.length + props.length + lines.list.length;
  const rel = nextRelease();
  let hits = 0;
  for (const e of bodies) {
    const at = e.center();
    e.freeze(1.2);
    const away = e.position.clone().sub(center).setY(0).normalize();
    g.combat.hitEnemy(e, (50 + 10 * Math.min(n, 10)) * ctx.potency, { from: e.position.clone().add(away), knock: 9, lift: 3, kind: 'cut', heavy: true });
    for (const f of lineEvents) f('yank', e, rel);
    g.vfx.trail([hand, hand.clone().lerp(at, 0.5).add(new THREE.Vector3(0, 0.3, 0)), at], 0xffffff, 0.12, 0.25);
    g.vfx.after(0.05, () => g.vfx.trail([hand, at], COLOR, 0.1, 0.4));
    hits++;
  }
  for (const p of props) {
    const to = center.clone().sub(p.mesh.position).setY(0).normalize();
    g.props.launch(p, to.multiplyScalar(14).add(new THREE.Vector3(0, 4, 0)));
    lines.slung.push({ prop: p, left: 1.2, dmg: 18 + p.def.mass * 0.6, hit: new Set(), release: rel });
    g.vfx.trail([hand, p.mesh.position.clone()], COLOR, 0.08, 0.35);
  }
  for (const s of [...lines.list]) { hits += discharge(ctx, s, 1, rel); if (lines.list.includes(s)) drop(g, s, 'spent'); }
  // The caster is a strand of their own network.
  if (n > 0) g.combat.hurtPlayer(g.combat.maxHp * Math.min(0.25, 0.025 * n), { self: true });
  g.vfx.ring(center.clone().add(new THREE.Vector3(0, 0.1, 0)), COLOR, radius * 1.1, 0.4, 0.6);
  g.vfx.ring(center.clone().add(new THREE.Vector3(0, 1.2, 0)), 0xffffff, 0.2, 4, 0.4);
  g.vfx.flash(center.clone().add(new THREE.Vector3(0, 1.5, 0)), COLOR, 110, 0.6, 24);
  g.vfx.burst(center.clone().add(new THREE.Vector3(0, 1, 0)), 30, 'spark', 9, 0xffc0dc);
  g.audio.play('tension.max.tail');
  return { hits, hitStop: 0.14, impactFrame: 3, rooted: 1.2, cameraKick: { fov: 15, pitch: 0.04, roll: 0.03 } };
}

// ------------------------------------------------------------ what the kit draws each frame

// The bones a string figure is strung between, right fingertip to left.
const FIGURE: readonly [string, string][] = [['thumb', 'index'], ['index', 'thumb'], ['middle', 'middle'], ['ring', 'pinky'], ['pinky', 'ring']];

function figure(g: Game, amount: number): void {
  g.hands.string(amount);
  if (amount < 0.05 || (g.cam.isFirst && !g.cam.inShot)) return;
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  for (const [r, l] of FIGURE) ghost(g, g.avatar.boneWorld(`${r}_04_leaf_r`, a), g.avatar.boneWorld(`${l}_04_leaf_l`, b), amount, 0.45);
}

// In Drawn World's high shot a line leaves the hand for each body and thing
// it will draw in, before the blow; on the blow they go white and stay on
// what they hold as it is drawn in, then fade.
let netEnds: (() => THREE.Vector3)[] = [];
function network(g: Game): void {
  const tl = g.cutscenes.timeline;
  if (!tl || tl.beat === null || g.cutscenes.role !== 'caster' || g.techniqueId !== 'tension') { netEnds = []; return; }
  const k = THREE.MathUtils.clamp((tl.t - 1.06) / 0.3, 0, 1);
  const after = tl.t - tl.beat;
  if (k <= 0 || after > 0.5) return;
  const hand = handPoint(g), center = g.player.position;
  if (!netEnds.length) {
    netEnds = [
      ...g.techniques.enemiesInSphere(center, 15).map((e) => () => e.center()),
      ...g.props.instances.filter((p) => p.alive && p.mesh.position.distanceTo(center) < 15).map((p) => () => p.mesh.position.clone()),
      ...lines.list.map((s) => () => anchorPoint(g, s.b)),
    ].slice(0, 12);
  }
  netEnds.forEach((end, i) => {
    const t = THREE.MathUtils.clamp(k * 1.6 - i * 0.06, 0, 1);
    if (t > 0) ghost(g, hand, hand.clone().lerp(end(), t), after > 0 ? Math.max(0, 1 - after / 0.5) : 0.95, after > 0 ? 1.3 : 0.9);
  });
}

// ------------------------------------------------------------ the kit

export const tension: TechniqueKit = {
  id: 'tension', name: 'Tension', glyph: '張', color: COLOR, type: 'Manipulation', sfx: 'ピィン',
  blurb: 'Tighten or loosen any fibre you touch. String the ground before the fight, and every line betrays whoever crosses it.',
  breadth: 3,
  resource: { name: 'Line', max: 100, regen: 10, startsFull: true },
  primitive: { name: 'Tension', short: 'a short line', description: 'Pull a short line taut from your hand. One at a time, and it holds little.' },
  parameters: ['direction', 'range', 'target', 'trigger', 'duration', 'resource', 'body'],
  shapes: {
    thread: { label: 'strings a prepared line from your hand to what you aim at', short: 'string a line', kinds: ['primary'], description: 'It ties off where you stand when you string the next. A body it reaches is snared; a body that runs into it trips.' },
    draw: { label: 'draws every line taut and lets them go on release', short: 'hold to draw, let go', kinds: ['secondary'], description: 'Release flings what the lines hold, hauls you to where one is anchored, and cuts across what they cross. Held too long past taut, a line gives.' },
    slack: { label: 'empties the tension from the body or line you aim at', short: 'let a line go slack', kinds: ['secondary'], description: 'Caught mid wind-up, a body loses its footing and its blow. A line drops what it held.' },
    drawnWorld: { label: 'ties everything in reach into one network and draws it in', short: 'draw everything in at once', kinds: ['max'], description: 'One line from each finger to every body and thing in reach. You are part of the network.' },
  },
  behaviors: { braid: 'braided: fewer lines, each far stronger', barbed: 'cuts whatever crosses it', quick: 'draws taut in half the time' },
  catalogue,
  gestures: {
    // The line pinched at the chest, drawn back past the shoulder, thrown.
    primary: gestureSet(0.55, 0.22, [
      { t: 0, right: 'threadPinch', left: 'guard', slow: true }, { t: 0.13, right: 'threadWind' }, { t: 0.2, right: 'threadCast', snap: true, camera: { fov: 4, roll: 0.01 } }, { t: 0.36, right: 'threadCast' }, { t: 0.48, right: 'rest', left: 'rest' }]),
    // The archer's draw: the far hand out along the lines, the near hand
    // pulling to the shoulder, held until release.
    secondary: gestureSet(0.5, 0.16, [
      { t: 0, right: 'threadPinch', left: 'drawFront', snap: true, camera: { fov: -2 } }, { t: 0.14, right: 'drawBack', slow: true }], true),
    // Both hands pinch a line between them and let it fall.
    slack: gestureSet(0.5, 0.2, [
      { t: 0, right: 'threadPinch', left: 'threadPinch', slow: true }, { t: 0.18, right: 'slackDrop', left: 'slackDrop', snap: true, camera: { fov: -3, pitch: 0.015 } }, { t: 0.42, right: 'rest', left: 'rest' }]),
    max: gestureSet(2.3, 1.7, [
      { t: 0, right: 'sealGather', left: 'sealGather', slow: true }, { t: 0.55, right: 'cradle', left: 'cradle', snap: true, camera: { fov: -3 } },
      { t: 0.95, right: 'cradleWide', left: 'cradleWide', slow: true }, { t: 1.65, right: 'drawYank', left: 'drawYank', snap: true, camera: { fov: 14, pitch: 0.05 } }, { t: 2.1, right: 'rest', left: 'rest' }]),
  },
  // A string figure: the hands meet at the sternum with a loop between their
  // fingers, pull it out wide on the release, and hold it, ready.
  sign: signGesture([
    { t: 0, right: 'sealGather', left: 'sealGather', slow: true },
    { t: 0.5, right: 'cradle', left: 'cradle', snap: true, camera: { fov: -4 }, event: 'seal' },
    { t: 1.2, right: 'cradleWide', left: 'cradleWide', snap: true, camera: { fov: 6, roll: 0.02 }, event: 'release' },
    { t: 1.42, right: 'cradle', left: 'cradle' },
  ]),
  traits: {
    // Paper and pasteboard tear through before a line can fling them.
    porous: (prop, ctx) => { ctx.game.vfx.burst(prop.mesh.position, 6, 'debris', 3); breakProp(ctx.game, prop, ctx.origin); },
    fragile: (prop, ctx) => breakProp(ctx.game, prop, ctx.origin),
    // A metal edge bites into a line tied to it.
    metal: (prop, ctx) => ctx.game.vfx.burst(prop.mesh.position, 3, 'spark', 2, 0xfff0c0),
  },
  drill: snareLanes,
  cutscene,
  effects: {
    cast(ctx) {
      if (ctx.shape === 'thread') return thread(ctx);
      if (ctx.shape === 'draw') {
        lines.drawing = true; lines.charge = 0; lines.over = 0; lines.rang = false;
        if (lines.list.length) ctx.game.audio.play('tension.draw', { at: handPoint(ctx.game) });
        return { cameraKick: { fov: -2 } };
      }
      if (ctx.shape === 'slack') return slack(ctx);
      if (ctx.shape === 'drawnWorld') return drawnWorld(ctx);
      return undefined;
    },
    hold(ctx, dt) { if (ctx.shape === 'draw') drawHold(ctx, dt); },
    release(ctx) {
      if (ctx.shape === 'draw') release(ctx);
      else if (heldLine) { drop(ctx.game, heldLine, 'slip'); heldLine = null; }
    },
    passive(game, dt) {
      standStation(game);
      updateLines(game, dt);
      if (heldLine && !lines.list.includes(heldLine)) heldLine = null;
      if (!lines.drawing) for (const s of lines.list) s.drawn = Math.max(0, s.drawn - dt * 3);
      if (lines.drawing && !game.techniques.casting) { lines.drawing = false; lines.charge = 0; lines.over = 0; }
      const sign = game.techniques.sign;
      const signing = sign.kind === 'signing' && sign.t > 0.42 && sign.t < 1.35;
      const cut = game.cutscenes.active && game.cutscenes.role === 'caster' && game.cutscenes.sealing;
      figure(game, signing || sign.kind === 'primed' || cut ? 1 : 0);
      network(game);
      endGhosts();
    },
    reset(game) { clearLines(game); heldLine = null; endGhosts(); game.hands.string(0); },
  },
  audio: { primary: 'tension.cast', secondary: 'tension.cast', max: 'tension.max.cast', slack: 'tension.slack.cast' },
};

// For the checks: the lines standing now, as plain data.
export function tensionView(g: Game): { lines: { a: string; b: string; rest: number; load: number; strength: number; loose: boolean; drawn: number; at: number[][] }[]; charge: number; drawing: boolean; hauling: boolean } {
  return {
    lines: lines.list.map((s) => ({ a: s.a.kind, b: s.b.kind, rest: s.rest, load: s.load, strength: s.strength, loose: s.loose > 0, drawn: s.drawn, at: [anchorPoint(g, s.a).toArray(), anchorPoint(g, s.b).toArray()] })),
    charge: lines.charge, drawing: lines.drawing, hauling: !!lines.haul,
  };
}

