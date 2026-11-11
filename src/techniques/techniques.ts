import * as THREE from 'three';
import { signal, effect } from '@preact/signals';
import type { Game } from '../app/game';
import { toast } from '../app/game';
import { settings } from '../app/settings';
import type { TechniqueKit, AbilityContext, CastResult, TechniqueId } from './kit';
import type { AbilitySlot, Pact, TriggerValue } from '../pacts/schema';
import { restriction } from '../pacts/schema';
import { describe } from '../pacts/resolve';
import { pick } from '../hands/gestures';
import type { GestureVariant } from '../mastery/mastery';
import { MASTERY_CONFIG } from '../mastery/mastery';
import type { Enemy } from '../combat/enemies';
import { recoil } from './kits/recoil';
import { shift } from './kits/shift';
import { rime } from './kits/rime';
import { blink } from './kits/blink';
import { echo } from './kits/echo';
import { GROUP_PROP, GROUP_WORLD, GROUP_ENEMY } from '../physics/world';

export const KITS: Record<TechniqueId, TechniqueKit> = { recoil, shift, rime, blink, echo };

interface Cast { slot: AbilitySlot; ctx: AbilityContext; t: number; impactAt: number; duration: number; fired: boolean; held: boolean; result?: CastResult | void }

// What the HUD shows for a key: the Ability's name, a few words on what it
// does, and whether it is the raw Technique or a draft being tried.
export interface SlotLabel { name: string; what: string; raw: boolean; preview: boolean }
const NO_LABELS: Record<AbilitySlot, SlotLabel> = { primary: { name: '', what: '', raw: true, preview: false }, secondary: { name: '', what: '', raw: true, preview: false }, max: { name: '', what: '', raw: true, preview: false }, passive: { name: '', what: '', raw: true, preview: false } };

export const techUi = {
  resource: signal(1),
  strain: signal(0),
  charge: signal(0),
  cooldowns: signal<Record<AbilitySlot, number>>({ primary: 0, secondary: 0, max: 0, passive: 0 }),
  slots: signal<Record<AbilitySlot, SlotLabel>>(NO_LABELS),
  variant: signal<GestureVariant>('long'),
  sealed: signal(0),
};

// Runs Abilities: resolves which Pact defines a key, checks its trigger,
// pays its resource, plays the gesture variant Activation allows, and fires
// the kit's effect on the gesture's impact beat.
export class Techniques {
  def: TechniqueKit = recoil;
  resource = 0;
  strain = 0;
  charge = 0;
  private cast_: Cast | null = null;
  private cooldown: Record<AbilitySlot, number> = { primary: 0, secondary: 0, max: 0, passive: 0 };
  private struckRecently = 0;
  sealed = 0;
  readonly limbTrail: THREE.Vector3[] = [];

  constructor(private game: Game) {
    for (const k of Object.values(KITS)) { game.book.registerCatalogue(k.id, k.catalogue); if (k.drill) game.drills.register(k.drill); }
    effect(() => this.refreshSlots());
  }

  select(id: TechniqueId): void {
    this.def = KITS[id];
    this.resource = this.def.resource.startsFull ? this.def.resource.max : 0;
    this.strain = 0;
    this.charge = 0;
    this.cast_ = null;
    this.game.hands.stop();
    this.refreshSlots();
    this.game.cutscenes.register(`max-${id}`, () => this.cast('max', true));
  }

  get casting(): boolean { return this.cast_ !== null; }
  get current(): Cast | null { return this.cast_; }

  private refreshSlots(): void {
    const book = this.game.book;
    const preview = book.preview.value;
    const labels = { ...NO_LABELS };
    for (const s of ['primary', 'secondary', 'max'] as const) {
      const p = preview?.slot === s && preview.technique === this.def.id ? preview : book.bound(s);
      labels[s] = p
        ? { name: p.name, what: this.def.shapes[p.grant.shape]?.short ?? '', raw: false, preview: p === preview }
        : { name: `Raw ${this.def.primitive.name}`, what: this.def.primitive.short, raw: true, preview: false };
    }
    void book.bindings.value;
    void book.inscribed.value;
    techUi.slots.value = labels;
  }

  // A draft being tried defines its key. Otherwise an inscribed Pact that
  // is programmed to take precedence does so while its trigger holds, and
  // the bound Pact defines the key the rest of the time.
  pactFor(slot: AbilitySlot): Pact | null {
    const book = this.game.book;
    const preview = book.preview.value;
    if (preview && preview.slot === slot && preview.technique === this.def.id) return preview;
    for (const p of book.inscribed.value) {
      if (p.technique !== this.def.id || p.slot !== slot || book.expired(p)) continue;
      const prefer = p.clauses.find((c) => c.kind === 'program' && c.then === 'prefer');
      if (prefer?.kind === 'program' && this.triggerHolds(prefer.when)) return p;
    }
    return book.bound(slot);
  }

  private triggerHolds(t: TriggerValue): boolean {
    const g = this.game;
    const still = g.player.planarSpeed.value < 0.3;
    switch (t) {
      case 'still': return still;
      case 'grounded': return g.player.grounded;
      case 'airborne': return !g.player.grounded;
      case 'struck': return this.struckRecently > 0;
      case 'lowHealth': return g.combat.hp / g.combat.maxHp <= 0.35;
      case 'fullSign': return g.input.isDown('fullsign');
      case 'eyesClosed': return true;
      case 'declared': return true;
    }
  }

  private baselineShape(slot: AbilitySlot): string {
    const entry = Object.entries(this.def.shapes).find(([, v]) => v.slot.includes(slot));
    return entry?.[0] ?? Object.keys(this.def.shapes)[0]!;
  }

  triggerMet(pact: Pact | null): { ok: boolean; why?: string } {
    if (!pact) return { ok: true };
    const t = restriction(pact, 'trigger');
    if (t && !this.triggerHolds(t)) return { ok: false, why: t === 'fullSign' ? 'only with the full hand sign (hold Alt)' : describe({ param: 'trigger', value: t }) };
    if (restriction(pact, 'body') === 'noMove' && !this.triggerHolds('still')) return { ok: false, why: 'you vowed never to move for this' };
    return { ok: true };
  }

  costFor(slot: AbilitySlot, pact: Pact | null): { resource: number; health: number; strain: number } {
    if (this.def.resource.free?.includes(slot) && !pact?.clauses.some((c) => c.kind === 'restrict' && c.restriction.param === 'resource')) return { resource: 0, health: 0, strain: 0 };
    const base = slot === 'primary' ? 0.16 : slot === 'secondary' ? 0.22 : 1;
    const eff = 1 - this.game.mastery.get(this.def.id, 'efficiency') * 0.45;
    const r = restriction(pact ?? ({ clauses: [] } as unknown as Pact), 'resource');
    const max = this.def.resource.max;
    if (r === 'all') return { resource: this.resource, health: 0, strain: 0 };
    if (r === 'half') return { resource: this.resource * 0.5, health: 0, strain: 0 };
    if (r === 'health') return { resource: 0, health: 6 * base * eff, strain: 0 };
    if (r === 'strain') return { resource: 0, health: 0, strain: 0.12 * base * eff };
    return { resource: max * base * eff, health: 0, strain: 0 };
  }

  potency(pact: Pact | null): number {
    const g = this.game;
    const mastery = g.mastery.get(this.def.id, 'output');
    const base = pact ? g.book.estimate(pact).potency : 0.22;
    return THREE.MathUtils.clamp(0.25 + base * 0.75 + mastery * 0.35, 0.2, 1.6);
  }

  cast(slot: AbilitySlot, force = false): boolean {
    const g = this.game;
    if (this.cast_ && !force) return false;
    if (this.sealed > 0) { toast('Your Technique is sealed', 'bad'); return false; }
    if (this.cooldown[slot] > 0 && !force) return false;
    if (slot === 'max' && this.charge < (g.combat.flags.overextension ? 0.5 : 1) && !force) { toast('Maximum Output is not ready', 'bad'); return false; }
    const pact = this.pactFor(slot);
    const met = this.triggerMet(pact);
    if (!met.ok && !force) { toast(`The Pact is not met: ${met.why}`, 'bad'); g.audio.play('error_004', 0.3); return false; }
    const cost = this.costFor(slot, pact);
    if (cost.resource > this.resource + 1e-3 && slot !== 'max') {
      if (g.combat.flags.bloodDraw) cost.health += 5;
      else { toast(`Not enough ${this.def.resource.name}`, 'bad'); g.audio.play('error_004', 0.3); return false; }
    }
    const fullSign = slot === 'max' || g.input.isDown('fullsign') || !settings.value.fullSignHold;
    const variant = slot === 'max' ? 'long' : g.mastery.variant(this.def.id, fullSign);
    const shape = pact?.grant.shape ?? this.baselineShape(slot);
    const behaviors = pact?.grant.behaviors ?? [];
    const dir = g.cam.aimDirection();
    if (!pact) dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), (Math.random() - 0.5) * 0.18 * (1 - g.mastery.get(this.def.id, 'precision')));
    const origin = g.player.eye();
    const aimHit = g.physics.castRay(origin, dir, 60, GROUP_WORLD | GROUP_PROP | GROUP_ENEMY, g.player.body);
    const ctx: AbilityContext = {
      game: g, pact, slot, shape, behaviors, potency: this.potency(pact) * (fullSign && variant === 'long' && g.mastery.get(this.def.id, 'activation') >= MASTERY_CONFIG.shortSignAt ? 1 + MASTERY_CONFIG.fullSignBoost : 1),
      variant, fullSign, origin, dir, aim: aimHit ? aimHit.point : origin.clone().addScaledVector(dir, 30), targets: [], wagered: g.combat.wagerArmed,
    };
    this.resource = Math.max(0, this.resource - cost.resource);
    if (cost.health > 0) g.combat.hurtPlayer(cost.health, { self: true });
    this.strain = Math.min(1, this.strain + cost.strain);
    const gestureSet = this.def.gestures[slot] ?? this.def.gestures.primary!;
    const gesture = pick(gestureSet, variant);
    const speed = (1 + g.mastery.get(this.def.id, 'speed') * 0.7) * (variant === 'long' ? 1 : 1.15);
    const held = restriction(pact ?? ({ clauses: [] } as unknown as Pact), 'duration') === 'held' || !!(!pact && this.def.shapes[shape]?.slot.includes('secondary') && slot === 'secondary' && this.def.effects.hold);
    g.hands.play(gesture, speed, () => undefined, (k) => g.cam.kick(k));
    g.avatar.playUpper(this.def.avatarClips[slot], speed * 1.1);
    this.cast_ = { slot, ctx, t: 0, impactAt: gesture.impactAt / speed, duration: gesture.duration / speed, fired: false, held };
    const a = this.def.audio[slot];
    g.audio.play(a.cast, a.volume ?? 0.6, (a.pitch ?? 1) * (variant === 'none' ? 1.15 : 1));
    this.cooldown[slot] = slot === 'max' ? 2 : slot === 'primary' ? 0.42 : 0.9;
    if (slot === 'max') this.charge = 0;
    if (g.combat.wagerArmed) g.combat.wagerCommitted(slot);
    g.book.observe('movingWhileCasting', g.player.planarSpeed.value > 0.5 ? 1 : 0);
    g.book.observe('airborneFraction', g.player.grounded ? 0 : 1);
    g.mastery.gain(this.def.id, 'activation', 0.004);
    g.tutorial.notify(slot);
    return true;
  }

  private fire(c: Cast): void {
    const g = this.game;
    c.fired = true;
    const r = this.def.effects.cast(c.ctx);
    c.result = r;
    const pact = c.ctx.pact;
    if (r) {
      if (r.hitStop) g.clock.hitStop(r.hitStop);
      if (r.impactFrame) g.renderer.impactFrame(r.impactFrame, new THREE.Color(this.def.color));
      if (r.cameraKick) g.cam.kick(r.cameraKick);
      if (r.rooted) g.player.rooted = Math.max(g.player.rooted, r.rooted);
      if (r.moveLock) g.player.moveLock = Math.max(g.player.moveLock, r.moveLock);
      if (c.ctx.wagered) g.combat.resolveWager((r.hits ?? 0) > 0);
      if ((r.hits ?? 0) > 0) { this.charge = Math.min(1, this.charge + 0.08 * (r.hits ?? 1)); g.mastery.gain(this.def.id, 'precision', 0.006); }
      else if (c.slot !== 'max') g.book.observe('longRangeFraction', c.ctx.aim && c.ctx.aim.distanceTo(c.ctx.origin) > 8 ? 1 : 0);
    }
    const risk = pact?.clauses.find((k) => k.kind === 'risk');
    if (risk && risk.kind === 'risk' && c.ctx.aim && restriction(pact!, 'range') === 'short' && c.ctx.aim.distanceTo(c.ctx.origin) > 6) {
      if (risk.cost === 'health') g.combat.hurtPlayer(8, { self: true });
      if (risk.cost === 'exhaustion') { g.player.speedScale = 0.6; setTimeout(() => { g.player.speedScale = 1; }, 4000); }
      if (risk.cost === 'seal') this.seal(3);
      toast('Risk invoked: you pushed past the limit', 'bad');
    }
  }

  seal(seconds: number): void { this.sealed = seconds; this.cast_ = null; this.game.hands.stop(); }
  struck(): void { this.struckRecently = 2.5; }

  update(dt: number, raw: number): void {
    const g = this.game;
    const inp = g.input;
    for (const k of Object.keys(this.cooldown) as AbilitySlot[]) this.cooldown[k] = Math.max(0, this.cooldown[k] - raw);
    this.sealed = Math.max(0, this.sealed - raw);
    this.struckRecently = Math.max(0, this.struckRecently - dt);
    const regen = this.def.resource.regen * (1 + g.mastery.get(this.def.id, 'efficiency') * 0.5);
    if (!this.cast_?.held) this.resource = Math.min(this.def.resource.max, this.resource + regen * dt);
    this.strain = Math.max(0, this.strain - dt * 0.03 * (1 + g.mastery.get(this.def.id, 'tolerance')));
    this.def.effects.passive?.(g, dt);

    if (!g.cutscenes.active && inp.enabled) {
      if (inp.hit('primary')) this.cast('primary');
      if (inp.hit('secondary')) this.cast('secondary');
      if (inp.hit('max')) {
        if (this.charge >= (g.combat.flags.overextension ? 0.5 : 1) && this.sealed <= 0 && !this.cast_) {
          if (g.combat.flags.overextension && this.charge < 1) g.combat.hurtPlayer(g.combat.maxHp * 0.25, { self: true });
          this.beginMax();
        } else this.cast('max');
      }
      if (inp.hit('wager')) g.combat.armWager();
    }
    for (const p of g.book.inscribed.value) for (const c of p.clauses) if (c.kind === 'program' && c.then === 'activate' && c.when === 'struck' && this.struckRecently > 2.4 && !this.cast_ && p.technique === this.def.id) this.cast(p.slot, true);

    const c = this.cast_;
    if (c) {
      c.t += dt;
      if (!c.fired && c.t >= c.impactAt) this.fire(c);
      if (c.fired && c.held) {
        const down = inp.isDown(c.slot === 'primary' ? 'primary' : 'secondary');
        if (down && this.resource > 0) { this.def.effects.hold?.(c.ctx, dt); this.resource = Math.max(0, this.resource - dt * this.def.resource.max * 0.12); }
        else { this.def.effects.release?.(c.ctx); g.hands.stop(); this.cast_ = null; }
      } else if (c.t >= c.duration) this.cast_ = null;
    }
    techUi.resource.value = this.resource / this.def.resource.max;
    techUi.strain.value = this.strain;
    techUi.charge.value = this.charge;
    techUi.cooldowns.value = { ...this.cooldown };
    techUi.sealed.value = this.sealed;
    techUi.variant.value = g.mastery.variant(this.def.id, false);
  }

  // Maximum Output routes through the cutscene player: the world freezes, the
  // full sign plays regardless of Activation, and the effect fires on the
  // resolveHit beat.
  beginMax(): void {
    const g = this.game;
    const target = g.encounters.nearestEnemy(g.player.position, 30);
    const targetPos = target ? target.position.clone().add(new THREE.Vector3(0, 1.2, 0)) : null;
    g.avatar.root.visible = true;
    g.cutscenes.play({
      def: this.def.cutscene,
      caster: g.avatar.root,
      casterYaw: g.cam.yaw,
      target: targetPos,
      onGesture: () => { g.avatar.playUpper(this.def.avatarClips.max, 0.9); g.hands.play(this.def.gestures.max!.long, 0.9, () => undefined, () => undefined); },
      onResolve: () => { this.cast('max', true); if (this.cast_) this.fire(this.cast_); },
      onVfx: (id) => { if (id === 'charge') g.vfx.ring(g.player.position.clone().add(new THREE.Vector3(0, 0.05, 0)), this.def.color, 0.2, 3, 0.8); if (id === 'flash') g.vfx.flash(g.player.eye(), this.def.color, 60, 0.5, 20); },
      onEnd: () => { this.cast_ = null; },
    });
  }

  // Shared spatial queries for kits.
  enemiesInCone(origin: THREE.Vector3, dir: THREE.Vector3, range: number, halfAngle: number): Enemy[] {
    return this.game.encounters.enemies.filter((e) => {
      if (!e.alive) return false;
      const to = e.position.clone().add(new THREE.Vector3(0, 1, 0)).sub(origin);
      const d = to.length();
      if (d > range) return false;
      return to.normalize().dot(dir) > Math.cos(halfAngle);
    });
  }

  enemiesInSphere(center: THREE.Vector3, radius: number): Enemy[] {
    return this.game.encounters.enemies.filter((e) => e.alive && e.position.distanceTo(center) < radius);
  }
}
