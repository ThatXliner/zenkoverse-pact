import * as THREE from 'three';
import { signal } from '@preact/signals';
import type { Game } from '../app/game';
import { toast } from '../app/game';
import { settings } from '../app/settings';
import type { TechniqueKit, AbilityContext, CastResult, TechniqueId } from './kit';
import type { AbilitySlot, Pact } from '../pacts/schema';
import { restriction } from '../pacts/schema';
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

export const techUi = {
  resource: signal(1),
  strain: signal(0),
  charge: signal(0),
  cooldowns: signal<Record<AbilitySlot, number>>({ primary: 0, secondary: 0, max: 0, passive: 0 }),
  names: signal<Record<AbilitySlot, string>>({ primary: '', secondary: '', max: '', passive: '' }),
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
  }

  select(id: TechniqueId): void {
    this.def = KITS[id];
    this.resource = this.def.resource.startsFull ? this.def.resource.max : 0;
    this.strain = 0;
    this.charge = 0;
    this.cast_ = null;
    this.game.hands.stop();
    this.refreshNames();
    this.game.cutscenes.register(`max-${id}`, () => this.cast('max', true));
  }

  get casting(): boolean { return this.cast_ !== null; }
  get current(): Cast | null { return this.cast_; }

  private refreshNames(): void {
    const n = { primary: '', secondary: '', max: '', passive: '' } as Record<AbilitySlot, string>;
    for (const s of ['primary', 'secondary', 'max'] as const) n[s] = this.game.book.bound(s)?.name ?? `Raw ${this.def.primitive.name}`;
    techUi.names.value = n;
  }

  pactFor(slot: AbilitySlot): Pact | null { return this.game.book.bound(slot); }

  private baselineShape(slot: AbilitySlot): string {
    const entry = Object.entries(this.def.shapes).find(([, v]) => v.slot.includes(slot));
    return entry?.[0] ?? Object.keys(this.def.shapes)[0]!;
  }

  triggerMet(pact: Pact | null): { ok: boolean; why?: string } {
    if (!pact) return { ok: true };
    const g = this.game;
    const t = restriction(pact, 'trigger');
    const body = restriction(pact, 'body');
    const still = g.player.planarSpeed.value < 0.3;
    if (t === 'still' && !still) return { ok: false, why: 'only while standing still' };
    if (t === 'grounded' && !g.player.grounded) return { ok: false, why: 'only with feet on the ground' };
    if (t === 'airborne' && g.player.grounded) return { ok: false, why: 'only in the air' };
    if (t === 'struck' && this.struckRecently <= 0) return { ok: false, why: 'only after being struck' };
    if (t === 'lowHealth' && g.combat.hp / g.combat.maxHp > 0.35) return { ok: false, why: 'only near defeat' };
    if (t === 'fullSign' && !g.input.isDown('fullsign')) return { ok: false, why: 'only with the full hand sign (hold Alt)' };
    if (body === 'noMove' && !still) return { ok: false, why: 'you vowed never to move for this' };
    return { ok: true };
  }

  costFor(slot: AbilitySlot, pact: Pact | null): { resource: number; health: number; strain: number } {
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
      if (c.ctx.wagered) g.combat.resolveWager((r.hits ?? 0) > 0, pact);
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
    if (g.book.inscribed.value.length !== this.lastInscribed) { this.lastInscribed = g.book.inscribed.value.length; this.refreshNames(); }
  }
  private lastInscribed = -1;

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
