import * as THREE from 'three';
import { signal } from '@preact/signals';
import type { Game } from '../app/game';
import { toast } from '../app/game';
import { keyLabel } from '../app/keymap';
import { KITS } from '../techniques/techniques';
import type { TechniqueId } from '../techniques/kit';
import type { Enemy } from './enemies';
import type { RemotePlayer } from '../net/remote';
import { RULES } from '../net/protocol';
import { AURA, AuraField, auraPotential, fieldFor, hasArea, pressure, reinforcement, shapeOf, type FieldBudget, type FieldEnd, type FieldState } from './field';
import { fieldsContest } from '../net/clash';
import { FieldView } from './fieldView';
import { Clash } from './clash';
import { fieldReading } from '../drills/fieldReading';
import { MOVES } from './moves';

export interface AuraReadout { state: FieldState; pool: number; left: number; holds: number; ended: FieldEnd | null; guardBroken: boolean }
export interface AuraTraining { refinement: number; trained: number; potential: number; breadth: number; pacts: number }
export const auraUi = {
  field: signal<AuraReadout>({ state: 'ready', pool: 1, left: 0, holds: 0, ended: null, guardBroken: false }),
  training: signal<AuraTraining>({ refinement: 0, trained: 0, potential: 1, breadth: 1, pacts: 0 }),
};

type Owner = Enemy | RemotePlayer;

// In a clash the side-on shot stands just outside or inside both fields, and
// indoors a dome squashed under the ceiling fills the frame from there. The
// two ground rings carry the boundaries and the tells; the domes keep only a
// trace, and the paint inside each ring thins, so the two bodies read.
const CLASH_DOME = 0.1;
const CLASH_FILL = 0.35;

// The expansion's beat, in seconds: a gather, the release, and the field
// settling out to its reach (with a little overshoot) after it. The field is
// open by the rules from the press, so nothing about it waits online; only
// how it is drawn keeps the beat.
const GATHER = 0.3;
const SETTLE = 0.4;
const DUST = 0x9c8b72;

// Aura Expansion on F (issue #4): the player's field, the fields of the
// Master and of other players, what an open field does to the bodies in it,
// and the clashes where two fields touch. The rules are in field.ts and
// src/net/clash.js; the drawing is in fieldView.ts; the clash itself plays in
// clash.ts.
export class Aura {
  readonly field = new AuraField(AURA.recovers.untrained);
  readonly clash: Clash;
  // Seconds the player's guard stays broken after losing a clash.
  guardBroken = 0;
  private mine: FieldView;
  private views = new Map<Owner, FieldView>();
  private lean = 0;
  private leanTo = new THREE.Vector3();
  private asked = new Map<number, number>();
  private nag = 0;
  // Seconds since the last expansion began; Infinity when none is playing.
  private since = Infinity;
  private shimmer = 0;
  // The shape being chosen: from the press of F until it commits. A tap
  // leaves the layer on the body; held past `AURA.push.tap` it is pushed off
  // it (`pushing`) until F is released or it is fully out.
  private shaping = false;
  pushing = false;
  private heldFor = 0;
  // 0 the body layer .. 1 fully pushed out; and what this expansion can buy.
  spread = 0;
  private budget: FieldBudget = { layer: { reach: 0, density: 0 }, wide: { reach: 0, density: 0 } };
  // Whether this expansion's release (the shockwave) has played.
  private released = true;
  private pushDrawn = 0;

  constructor(private game: Game) {
    this.mine = new FieldView(game.renderer.scene, 0xffffff, game.avatar.model);
    this.clash = new Clash(game);
    game.mastery.capBy('refinement', (t) => this.potential(t));
    game.drills.register(fieldReading(game));
  }

  // Refinement's ceiling for a Technique: its breadth and the Pacts inscribed for it.
  breadth(t: TechniqueId = this.game.techniqueId): number { return KITS[t].breadth; }
  pacts(t: TechniqueId = this.game.techniqueId): number {
    const book = this.game.book;
    return book.inscribed.value.filter((p) => p.technique === t && !book.expired(p)).length;
  }
  potential(t: TechniqueId = this.game.techniqueId): number { return auraPotential(this.breadth(t), this.pacts(t)); }
  // Trained refinement, held to the potential the Technique and its Pacts leave.
  refinement(t: TechniqueId = this.game.techniqueId): number { return Math.min(this.game.mastery.get(t, 'refinement'), this.potential(t)); }

  colorOf(owner: Owner | null): number {
    if (!owner) return new THREE.Color(this.game.techniques.def.color).lerp(new THREE.Color(0xffffff), 0.12).getHex();
    if (owner.def.ai === 'rival') return new THREE.Color(KITS[(owner as RemotePlayer).info.tech as TechniqueId]?.color ?? 0xffffff).lerp(new THREE.Color(0xffffff), 0.12).getHex();
    return owner.def.emissive ?? 0x7dffb2;
  }

  viewOf(owner: Owner): FieldView | undefined { return this.views.get(owner); }
  // The player's field presses toward whoever it is clashing with.
  leanToward(p: THREE.Vector3): void { this.lean = 0.35; this.leanTo.copy(p).sub(this.game.player.position); }

  get open(): boolean { return this.field.open; }
  // How dense the player's open field is, 0 when it is not open.
  get density(): number { return this.field.open ? this.field.density : 0; }

  // A body layer has no area: nobody stands inside it.
  inField(p: THREE.Vector3): boolean {
    if (!this.field.open || !hasArea(this.field.radius)) return false;
    const me = this.game.player.position;
    return Math.hypot(p.x - me.x, p.z - me.z) < this.field.radius && Math.abs(p.y - me.y) < this.field.radius;
  }
  // An enemy inside the player's field moves and winds up this much slower,
  // unless it holds a field of its own open.
  hinder(e: Enemy): number { return this.inField(e.position) && !e.field?.open ? pressure(this.field.density) : 1; }
  // Whether the player senses what a body at `p` is about to do.
  senses(p: THREE.Vector3): boolean { return this.inField(p); }
  // The player's wind-ups inside their own field: quicker the further it is
  // pushed out, so the body layer, all defence, gives none.
  get castSpeed(): number { return 1 + AURA.sharper.speed * this.density * (this.field.open ? this.spread : 0); }
  // A hit from the player on `e`: harder inside the player's field, softer
  // on a body standing in its own (the Master's reinforcement). Online a
  // player's reinforcement is their own client's, in `reinforce`.
  damageOn(e: Enemy): number {
    let m = this.inField(e.position) ? 1 + AURA.sharper.damage * this.field.density : 1;
    if (e.field?.open) m *= reinforcement(e.field.density);
    return m;
  }
  // How fast the player's Technique cooldowns run: faster in a settled
  // field, most in the body layer.
  get recovery(): number { return this.field.open && !this.pushing ? 1 + AURA.recover * this.field.density : 1; }
  // What the player's own field lets through of a blow: reinforcement, once
  // the field is settled.
  get reinforce(): number { return this.field.open && !this.pushing ? reinforcement(this.field.density) : 1; }

  // F: expand when the pool is full, retract when the field is open.
  toggle(): void {
    if (this.clash.active) return;
    if (this.field.open) { this.retract(); return; }
    if (this.field.ready) { this.expand(); return; }
    if ((this.nag -= 1) <= 0) { toast(`Aura recovering: ${Math.round(this.field.pool * 100)}%. It must refill before you expand again.`); this.nag = 2; }
    this.game.audio.play('aura.denied');
  }

  // Wraps the body in its layer. Held, `shape` pushes it off from here.
  expand(): boolean {
    const g = this.game;
    const f = fieldFor(this.refinement());
    this.field.recovers = f.recovers;
    if (!this.field.expand(f.layer.reach, f.layer.density, f.holds)) return false;
    this.budget = { layer: f.layer, wide: f.wide };
    this.shaping = true;
    this.pushing = false;
    this.heldFor = this.spread = 0;
    this.released = false;
    const color = this.colorOf(null);
    const feet = g.player.position.clone().add(new THREE.Vector3(0, 0.08, 0));
    // The gather: the body draws in, and the air and the dust around it are
    // pulled toward it while the sound inhales.
    this.since = 0;
    g.avatar.perform(MOVES.field, MOVES.field.impactAt / GATHER);
    g.vfx.gather(feet, 2.4, 18, GATHER, DUST);
    g.vfx.ring(feet, color, 1.6, 0.4, GATHER, undefined, 0.5);
    g.audio.play('aura.expand');
    g.cam.kick({ fov: -5, pitch: -0.01 });
    // A tap releases on the beat; a field being pushed out releases when it commits.
    g.vfx.after(GATHER, () => { if (!this.pushing) this.release(); });
    g.tutorial.notify('aura');
    return true;
  }

  // While F stays down the layer is pushed off the body into a field, wider
  // and thinner the further it goes, and the player is slowed and cannot
  // cast. Letting go, or reaching the full push, commits the shape; so does a
  // clash, which takes the field as it is.
  private shape(raw: number): void {
    if (!this.shaping) return;
    const f = this.field;
    if (!f.open || this.clash.active) { this.commit(); return; }
    const down = this.game.input.isDown('aura');
    this.heldFor += raw;
    if (!this.pushing) {
      if (!down) { this.shaping = false; return; }
      if (this.heldFor < AURA.push.tap) return;
      this.pushing = true;
      this.game.avatar.stance = 'push';
      this.game.audio.play('aura.push');
    }
    if (down) this.spread = Math.min(1, this.spread + raw / AURA.push.seconds);
    const s = shapeOf(this.budget, this.spread);
    f.reach = s.reach;
    f.density = s.density;
    if (!down || this.spread >= 1) this.commit();
  }

  private commit(): void {
    const was = this.pushing;
    this.shaping = this.pushing = false;
    if (!was) return;
    if (!this.clash.active) this.game.avatar.stance = null;
    // The release plays now, with the settle after it.
    this.since = GATHER;
    this.release();
    this.game.audio.play('aura.release');
  }

  // The release: one held inked frame and a catch, then a shockwave that
  // raises the dust, shoves loose props and throws back the bodies near.
  // Other players are never moved or held by it: online the clock ignores
  // the catch, and the shove only reaches props and this screen's enemies.
  private release(): void {
    const g = this.game;
    if (!this.field.open || this.released) return;
    this.released = true;
    const reach = this.field.reach;
    const me = g.player.position;
    const color = this.colorOf(null);
    const feet = me.clone().add(new THREE.Vector3(0, 0.08, 0));
    g.renderer.impactFrame(2, new THREE.Color(color), me.clone().add(new THREE.Vector3(0, 1, 0)));
    // A clash that began as the fields touched runs on the real clock.
    if (!this.clash.active) g.clock.hitStop(0.07);
    // A body layer snaps tight to the body: one small ring and a catch. A
    // field pushed out throws its shockwave out to its edge.
    const out = Math.min(1, Math.max(0, (reach - this.budget.layer.reach) / 4));
    g.vfx.ring(feet, color, 0.4, Math.max(1.2, reach * 1.15), 0.45);
    g.vfx.ring(feet.clone().add(new THREE.Vector3(0, 1, 0)), 0xffffff, 0.3, Math.max(0.9, reach * 0.8), 0.3);
    if (out > 0) {
      g.vfx.ring(feet, DUST, 0.6, reach * 0.95, 0.6, undefined, 0.6);
      g.vfx.burst(feet.clone().add(new THREE.Vector3(0, 0.1, 0)), Math.round(4 + 6 * out), 'debris', 4);
    }
    g.cam.shake(0.15 + 0.2 * out);
    g.cam.kick({ fov: 4 + 6 * out, pitch: 0.02 });
    for (const p of g.props.instances) {
      const d = p.mesh.position.clone().sub(me);
      const dist = d.length();
      if (dist > reach || dist < 0.01) continue;
      g.props.push(p, d.setY(0).normalize().setY(0.5).multiplyScalar(p.def.mass * 4 * (1 - dist / reach * 0.6)));
    }
    for (const e of g.encounters.enemies) {
      // A boss stands its ground, and a body held in a clash is not to be moved.
      if (!e.alive || e.def.ai === 'dummy' || e.isBoss || e.locked > 0) continue;
      const dist = e.position.distanceTo(me);
      if (dist < reach * 0.6) e.hurt(0, { from: me, knock: 6 * (1 - dist / (reach * 0.6)) + 2, lift: 1.5 });
    }
  }

  // By choice: the field draws back in, calmly, and keeps its unused time as pool.
  retract(): void {
    const g = this.game;
    if (!this.field.end('retracted')) return;
    const feet = g.player.position.clone().add(new THREE.Vector3(0, 0.08, 0));
    g.vfx.ring(feet, this.colorOf(null), this.field.radius, 0.3, 0.5);
    g.audio.play('aura.retract');
    toast(`Field retracted. Your aura refills from ${Math.round(this.field.pool * 100)}%.`);
  }

  // Forced: a lost clash crushes the field and breaks the guard for `guard` seconds.
  collapse(guard: number): void {
    const g = this.game;
    if (!this.field.end('collapsed')) return;
    this.mine.crack();
    const c = g.player.position.clone().add(new THREE.Vector3(0, 1, 0));
    g.vfx.burst(c, 22, 'shard', 7, this.colorOf(null));
    g.vfx.ring(g.player.position.clone().add(new THREE.Vector3(0, 0.08, 0)), 0xff6a5a, this.field.radius, 0.2, 0.35);
    g.audio.play('aura.collapse');
    g.cam.shake(0.6);
    this.guardBroken = Math.max(this.guardBroken, guard);
  }

  reset(): void {
    if (this.pushing) this.game.avatar.stance = null;
    this.shaping = this.pushing = false;
    this.released = true;
    this.clash.cancel();
    this.field.reset();
    this.guardBroken = 0;
    this.game.player.fieldScale = 1;
    for (const v of this.views.values()) v.dispose();
    this.views.clear();
    this.mine.hide();
  }

  update(dt: number, raw: number): void {
    const g = this.game;
    if (g.input.hit('aura') && !g.cutscenes.active) this.toggle();
    this.shape(raw);
    this.field.update(dt);
    this.guardBroken = Math.max(0, this.guardBroken - dt);
    this.lean = Math.max(0, this.lean - raw * 2);

    // Foreign fields: the Master's and, online, other players'.
    const owners: Owner[] = g.encounters.enemies.filter((e) => e.field && !e.disposed);
    if (g.net) for (const r of g.net.remotes.values()) if (!r.disposed) owners.push(r);
    let pressed = 1;
    for (const o of owners) {
      const radius = o.def.ai === 'rival' ? (o as RemotePlayer).fieldRadius : o.field!.radius;
      const density = o.def.ai === 'rival' ? (o as RemotePlayer).fieldDensity : o.field!.density;
      const d = Math.hypot(o.position.x - g.player.position.x, o.position.z - g.player.position.z);
      const inside = d < radius && hasArea(radius);
      if (inside && !this.field.open) pressed = Math.min(pressed, pressure(density));
      this.touch(o, radius, d);
      let view = this.views.get(o);
      if (!view && radius > 0.05) { view = new FieldView(g.renderer.scene, this.colorOf(o), o.def.ai === 'rival' ? (o as RemotePlayer).avatar.model : undefined); this.views.set(o, view); }
      if (!view) continue;
      const zone = g.world.zoneAt(o.position);
      view.draw(raw, g.clock.time, o.position, radius, density, { inside, dome: this.clash.active ? CLASH_DOME : inside ? 0.5 : 0.9, fill: this.clash.active ? CLASH_FILL : 1, ceiling: zone?.indoors ? zone.max.y - o.position.y : undefined });
    }
    for (const [o, v] of this.views) if (!owners.includes(o)) { v.dispose(); this.views.delete(o); }
    // Pushing a field out takes the body's attention: it barely walks.
    g.player.fieldScale = this.pushing ? Math.min(pressed, AURA.push.slow) : pressed;

    this.clash.update(raw);
    const me = g.player.position;
    const zone = g.world.zoneAt(me);
    this.mine.color = this.colorOf(null);
    if (this.lean > 0) this.mine.tell(null, this.leanTo);
    // The drawn field: held tight through the gather, then out past its reach
    // and back (the layer flares off the body and settles onto it).
    this.since += raw;
    const u = (this.since - GATHER) / SETTLE;
    const drawn = this.pushing ? 1 : this.since < GATHER ? 0.12 : u < 1 ? 1 + 0.08 * Math.sin(Math.min(1, u) * Math.PI) : 1;
    this.pushDrawn += ((this.pushing ? 1 : 0) - this.pushDrawn) * (1 - Math.exp(-(this.pushing ? 14 : 5) * raw));
    // While it stays open, a faint ripple runs out across it now and then.
    if (this.field.open && this.since > GATHER + SETTLE && (this.shimmer -= dt) <= 0) {
      this.shimmer = 1.4;
      g.vfx.ring(me.clone().add(new THREE.Vector3(0, 0.08, 0)), this.colorOf(null), this.field.radius * 0.2, this.field.radius * 0.95, 1.2, undefined, 0.35);
    }
    this.mine.draw(raw, g.clock.time, me, this.field.radius * drawn, this.field.open ? this.field.density : 0.4, { inside: true, dome: this.clash.active ? CLASH_DOME : g.cam.isFirst ? 0.5 : g.cam.isTop ? 0.6 : 0.85, fill: this.clash.active ? CLASH_FILL : 1, ceiling: zone?.indoors ? zone.max.y - me.y : undefined, lean: this.lean, push: this.pushDrawn, limit: this.pushDrawn > 0.01 ? this.budget.wide.reach : 0 });
    this.publish();
  }

  // Two open fields that contest (src/net/clash.js: they touch, and at
  // least one has left its body) start a clash: against the Master here,
  // and online by asking the server, which asks the same rule again.
  private touch(o: Owner, radius: number, d: number): void {
    const g = this.game;
    if (!this.field.open || this.clash.active || g.cutscenes.active || !fieldsContest(d, this.field.radius, radius, RULES.field)) return;
    if (o.def.ai !== 'rival') { if (o.alive && o.field?.open) this.clash.startMaster(o); return; }
    const r = o as RemotePlayer;
    const now = performance.now();
    if (now - (this.asked.get(r.id) ?? -1e9) < RULES.field.clashCooldownMs) return;
    this.asked.set(r.id, now);
    g.net?.askClash(r.id);
  }

  private publish(): void {
    const f = this.field, g = this.game;
    const holds = fieldFor(this.refinement()).holds;
    const cur = auraUi.field.value;
    const broken = this.guardBroken > 0;
    if (cur.state !== f.state || Math.abs(cur.pool - f.pool) > 0.004 || Math.abs(cur.left - f.left) > 0.05 || cur.ended !== f.ended || cur.guardBroken !== broken || cur.holds !== holds) {
      auraUi.field.value = { state: f.state, pool: f.pool, left: Math.max(0, f.left), holds, ended: f.ended, guardBroken: broken };
    }
    const t = g.techniqueId;
    const tr = { refinement: this.refinement(t), trained: g.mastery.get(t, 'refinement'), potential: this.potential(t), breadth: this.breadth(t), pacts: this.pacts(t) };
    const c = auraUi.training.value;
    if (c.refinement !== tr.refinement || c.potential !== tr.potential || c.pacts !== tr.pacts || c.breadth !== tr.breadth || c.trained !== tr.trained) auraUi.training.value = tr;
  }
}

// What the HUD and the codex say about the field state.
export function fieldWords(f: AuraReadout): { state: string; detail: string } {
  if (f.state === 'open') return { state: 'Field open', detail: `${f.left.toFixed(1)} s · ${keyLabel('aura')} retracts` };
  if (f.state === 'ready') return { state: 'Ready', detail: `${keyLabel('aura')} wraps, hold to widen` };
  if (f.ended === 'collapsed') return { state: 'Collapsed', detail: `${Math.round(f.pool * 100)}% · refilling` };
  return { state: f.ended === 'retracted' ? 'Retracted' : 'Spent', detail: `${Math.round(f.pool * 100)}% · refilling` };
}
