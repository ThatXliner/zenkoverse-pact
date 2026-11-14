import * as THREE from 'three';
import { signal, effect } from '@preact/signals';
import type { Game } from '../app/game';
import { toast } from '../app/game';
import { keyLabel } from '../app/keymap';
import type { TechniqueKit, AbilityContext, CastResult, TechniqueId } from './kit';
import type { Pact, TriggerValue } from '../pacts/schema';
import { KEY_SLOTS, KIND_DEFS, kindOn, slotDef, type AbilityKind, type AbilitySlot, type KeySlot } from '../pacts/slots';
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

interface Cast { slot: KeySlot; ctx: AbilityContext; t: number; impactAt: number; duration: number; fired: boolean; held: boolean; result?: CastResult | void }

// The full hand sign (issue #42). Alt starts it; nothing cancels it. While
// signing the player is rooted and cannot cast, Wager or open the Workshop.
// A finished sign primes the Technique for `MASTERY_CONFIG.sign.window`
// seconds: the next cast skips its wind-up and carries the boost. A cast
// consumes the prime; the window running out drops it.
export type SignState =
  | { kind: 'idle' }
  | { kind: 'signing'; t: number; duration: number }
  | { kind: 'primed'; left: number };
const SIGN_IDLE: SignState = { kind: 'idle' };

// What the HUD shows for a key: the Ability's name, a few words on what it
// does, how it is cast, and whether it is the raw Technique, a draft being
// tried, or nothing yet (an extra slot with no Pact).
export interface SlotLabel { name: string; what: string; kind: AbilityKind | null; raw: boolean; preview: boolean; empty: boolean }
const EMPTY_LABEL: SlotLabel = { name: '', what: '', kind: null, raw: false, preview: false, empty: true };
const perSlot = <T>(make: (s: KeySlot) => T): Record<KeySlot, T> => Object.fromEntries(KEY_SLOTS.map((s) => [s, make(s)])) as Record<KeySlot, T>;

export const techUi = {
  resource: signal(1),
  strain: signal(0),
  charge: signal(0),
  cooldowns: signal<Record<KeySlot, number>>(perSlot(() => 0)),
  slots: signal<Record<KeySlot, SlotLabel>>(perSlot(() => EMPTY_LABEL)),
  variant: signal<GestureVariant>('long'),
  sealed: signal(0),
  sign: signal<SignState>(SIGN_IDLE),
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
  private cooldown: Record<KeySlot, number> = perSlot(() => 0);
  private struckRecently = 0;
  sealed = 0;
  sign: SignState = SIGN_IDLE;
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
    this.reset();
    this.refreshSlots();
    this.game.cutscenes.register(`max-${id}`, () => this.cast('max', true));
  }

  // Drops any cast in flight, the sign state and every kit's own state, for
  // a new run or Technique. Every kit resets, not only the selected one: a
  // kit's passive only runs while it is selected, so nothing else would.
  reset(): void {
    this.cast_ = null;
    this.sign = SIGN_IDLE;
    for (const k of Object.values(KITS)) k.effects.reset?.(this.game);
    this.game.hands.stop();
  }

  get casting(): boolean { return this.cast_ !== null; }
  get current(): Cast | null { return this.cast_; }
  get signing(): boolean { return this.sign.kind === 'signing'; }

  private refreshSlots(): void {
    const book = this.game.book;
    const preview = book.preview.value;
    techUi.slots.value = perSlot((s): SlotLabel => {
      const p = preview?.slot === s && preview.technique === this.def.id ? preview : book.bound(s);
      if (p) {
        const shape = this.def.shapes[p.grant.shape];
        return { name: p.name, what: shape?.short ?? '', kind: kindOn(s, shape?.kinds), raw: false, preview: p === preview, empty: false };
      }
      const raw = slotDef(s).raw;
      return raw ? { name: `Raw ${this.def.primitive.name}`, what: this.def.primitive.short, kind: raw, raw: true, preview: false, empty: false } : EMPTY_LABEL;
    });
  }

  // A draft being tried defines its key. Otherwise an inscribed Pact that
  // is programmed to take precedence does so while its trigger holds, and
  // the bound Pact defines the key the rest of the time.
  pactFor(slot: KeySlot): Pact | null {
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
      case 'fullSign': return this.sign.kind === 'primed';
      case 'eyesClosed': return true;
      case 'declared': return true;
    }
  }

  private baselineShape(kind: AbilityKind): string {
    const entry = Object.entries(this.def.shapes).find(([, v]) => v.kinds.includes(kind));
    return entry?.[0] ?? Object.keys(this.def.shapes)[0]!;
  }

  // How the Pact or raw Technique on `slot` is cast; null on an empty extra slot.
  kindOf(slot: KeySlot): AbilityKind | null {
    const pact = this.pactFor(slot);
    return kindOn(slot, pact ? this.def.shapes[pact.grant.shape]?.kinds : undefined);
  }

  triggerMet(pact: Pact | null): { ok: boolean; why?: string } {
    if (!pact) return { ok: true };
    const t = restriction(pact, 'trigger');
    if (t && !this.triggerHolds(t)) return { ok: false, why: t === 'fullSign' ? `only with the full hand sign (${keyLabel('fullsign')} performs it first)` : describe({ param: 'trigger', value: t }) };
    if (restriction(pact, 'body') === 'noMove' && !this.triggerHolds('still')) return { ok: false, why: 'you vowed never to move for this' };
    return { ok: true };
  }

  costFor(kind: AbilityKind, pact: Pact | null): { resource: number; health: number; strain: number } {
    if (this.def.resource.free?.includes(kind) && !pact?.clauses.some((c) => c.kind === 'restrict' && c.restriction.param === 'resource')) return { resource: 0, health: 0, strain: 0 };
    const base = KIND_DEFS[kind].cost;
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

  cast(slot: KeySlot, force = false): boolean {
    const g = this.game;
    if (this.signing) return false;
    if (this.cast_ && !force) return false;
    if (this.sealed > 0) { toast('Your Technique is sealed', 'bad'); return false; }
    if (this.cooldown[slot] > 0 && !force) return false;
    const pact = this.pactFor(slot);
    const kind = kindOn(slot, pact ? this.def.shapes[pact.grant.shape]?.kinds : undefined);
    if (!kind) return false;
    if (kind === 'max' && this.charge < (g.combat.flags.overextension ? 0.5 : 1) && !force) { toast('Maximum Output is not ready', 'bad'); return false; }
    const met = this.triggerMet(pact);
    if (!met.ok && !force) { toast(`The Pact is not met: ${met.why}`, 'bad'); g.audio.play('error_004', 0.3); return false; }
    const cost = this.costFor(kind, pact);
    if (cost.resource > this.resource + 1e-3 && kind !== 'max') {
      if (g.combat.flags.bloodDraw) cost.health += 5;
      else { toast(`Not enough ${this.def.resource.name}`, 'bad'); g.audio.play('error_004', 0.3); return false; }
    }
    // A primed cast skips its wind-up and carries the sign's boost. Maximum
    // Output always plays its full sign in the cutscene, boosted or not.
    const primed = this.sign.kind === 'primed';
    const variant = kind === 'max' ? 'long' : primed ? 'none' : g.mastery.variant(this.def.id);
    const shape = pact?.grant.shape ?? this.baselineShape(kind);
    const behaviors = pact?.grant.behaviors ?? [];
    const dir = g.cam.aimDirection();
    if (!pact) dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), (Math.random() - 0.5) * 0.18 * (1 - g.mastery.get(this.def.id, 'precision')));
    const origin = g.player.eye();
    const aimHit = g.physics.castRay(origin, dir, 60, GROUP_WORLD | GROUP_PROP | GROUP_ENEMY, g.player.body);
    const ctx: AbilityContext = {
      game: g, pact, slot, kind, shape, behaviors, potency: this.potency(pact) * (primed ? 1 + g.mastery.signBoost(this.def.id) : 1),
      variant, origin, dir, aim: aimHit ? aimHit.point : origin.clone().addScaledVector(dir, 30), targets: [], wagered: g.combat.wagerArmed,
    };
    if (primed) this.sign = SIGN_IDLE;
    this.resource = Math.max(0, this.resource - cost.resource);
    if (cost.health > 0) g.combat.hurtPlayer(cost.health, { self: true });
    this.strain = Math.min(1, this.strain + cost.strain);
    const gestureSet = this.def.gestures[kind] ?? this.def.gestures.primary!;
    const gesture = pick(gestureSet, variant);
    const speed = (1 + g.mastery.get(this.def.id, 'speed') * 0.7) * (variant === 'long' ? 1 : 1.15);
    const held = restriction(pact ?? ({ clauses: [] } as unknown as Pact), 'duration') === 'held' || !!(!pact && kind === 'secondary' && this.def.effects.hold);
    g.hands.play(gesture, speed, () => undefined, (k) => g.cam.kick(k));
    g.avatar.playUpper(this.def.avatarClips[kind], speed * 1.1);
    this.cast_ = { slot, ctx, t: 0, impactAt: gesture.impactAt / speed, duration: gesture.duration / speed, fired: false, held };
    const a = this.def.audio[kind];
    g.audio.play(a.cast, a.volume ?? 0.6, (a.pitch ?? 1) * (variant === 'none' ? 1.15 : 1));
    if (kind !== 'max') g.net?.cast(kind, pact?.name ?? `Raw ${this.def.primitive.name}`);
    this.cooldown[slot] = KIND_DEFS[kind].cooldown;
    if (kind === 'max') this.charge = 0;
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
      else if (c.ctx.kind !== 'max') g.book.observe('longRangeFraction', c.ctx.aim && c.ctx.aim.distanceTo(c.ctx.origin) > 8 ? 1 : 0);
    }
    const risk = pact?.clauses.find((k) => k.kind === 'risk');
    if (risk && risk.kind === 'risk' && c.ctx.aim && restriction(pact!, 'range') === 'short' && c.ctx.aim.distanceTo(c.ctx.origin) > 6) {
      if (risk.cost === 'health') g.combat.hurtPlayer(8, { self: true });
      if (risk.cost === 'exhaustion') { g.player.speedScale = 0.6; g.vfx.until(4, () => { g.player.speedScale = 1; }); }
      if (risk.cost === 'seal') this.seal(3);
      toast('Risk invoked: you pushed past the limit', 'bad');
    }
  }

  seal(seconds: number): void { this.sealed = seconds; this.cast_ = null; this.game.hands.stop(); }
  struck(): void { this.struckRecently = 2.5; }

  update(dt: number, raw: number): void {
    const g = this.game;
    const inp = g.input;
    for (const k of KEY_SLOTS) this.cooldown[k] = Math.max(0, this.cooldown[k] - raw);
    this.sealed = Math.max(0, this.sealed - raw);
    this.struckRecently = Math.max(0, this.struckRecently - dt);
    const regen = this.def.resource.regen * (1 + g.mastery.get(this.def.id, 'efficiency') * 0.5);
    if (!this.cast_?.held) this.resource = Math.min(this.def.resource.max, this.resource + regen * dt);
    this.strain = Math.max(0, this.strain - dt * 0.03 * (1 + g.mastery.get(this.def.id, 'tolerance')));
    this.def.effects.passive?.(g, dt);

    if (!g.cutscenes.active && inp.enabled) {
      if (inp.hit('fullsign')) this.beginSign();
      if (!this.signing) {
        for (const s of KEY_SLOTS) {
          if (!inp.hit(s)) continue;
          if (this.kindOf(s) !== 'max') { this.cast(s); continue; }
          if (this.charge >= (g.combat.flags.overextension ? 0.5 : 1) && this.sealed <= 0 && !this.cast_) {
            if (g.combat.flags.overextension && this.charge < 1) g.combat.hurtPlayer(g.combat.maxHp * 0.25, { self: true });
            this.beginMax();
          } else this.cast(s);
        }
        if (inp.hit('wager')) g.combat.armWager();
      }
    }
    this.tickSign(dt);
    for (const p of g.book.inscribed.value) for (const c of p.clauses) if (c.kind === 'program' && c.then === 'activate' && c.when === 'struck' && this.struckRecently > 2.4 && !this.cast_ && p.technique === this.def.id && p.slot !== 'passive') this.cast(p.slot, true);

    const c = this.cast_;
    if (c) {
      c.t += dt;
      if (!c.fired && c.t >= c.impactAt) this.fire(c);
      if (c.fired && c.held) {
        const down = inp.isDown(c.slot);
        if (down && this.resource > 0) { this.def.effects.hold?.(c.ctx, dt); this.resource = Math.max(0, this.resource - dt * this.def.resource.max * 0.12); }
        else { this.def.effects.release?.(c.ctx); g.hands.stop(); this.cast_ = null; }
      } else if (c.t >= c.duration) this.cast_ = null;
    }
    techUi.resource.value = this.resource / this.def.resource.max;
    techUi.strain.value = this.strain;
    techUi.charge.value = this.charge;
    techUi.cooldowns.value = { ...this.cooldown };
    techUi.sealed.value = this.sealed;
    techUi.variant.value = g.mastery.variant(this.def.id);
    techUi.sign.value = { ...this.sign };
  }

  // Alt. The sign is a commitment: once begun it runs to its end, with the
  // player rooted for its length. The hands play the kit's sign and hold its
  // last key as the primed stance; the avatar raises its hands for the seal.
  beginSign(): boolean {
    const g = this.game;
    if (this.sign.kind !== 'idle' || this.cast_) return false;
    if (this.sealed > 0) { toast('Your Technique is sealed', 'bad'); return false; }
    const gesture = this.def.sign;
    this.sign = { kind: 'signing', t: 0, duration: gesture.duration };
    g.player.rooted = Math.max(g.player.rooted, gesture.duration);
    g.hands.play(gesture, 1, (e) => this.onSignBeat(e), (k) => g.cam.kick(k));
    if (!g.cam.isFirst) this.signShot(gesture.impactAt + 0.1);
    g.audio.play('minimize_006', 0.3, 0.8);
    return true;
  }

  // Third person: the camera swings to a front three-quarter close-up for the
  // sign and dollies in on the seal, then blends back on the release.
  private signShot(duration: number): void {
    const g = this.game;
    const p = g.player.position.clone(), yaw = g.cam.yaw;
    const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)), right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const from = p.clone().addScaledVector(right, 1.05).addScaledVector(fwd, 2.4).add(new THREE.Vector3(0, 1.6, 0));
    const to = p.clone().addScaledVector(right, 0.75).addScaledVector(fwd, 1.7).add(new THREE.Vector3(0, 1.45, 0));
    const look = p.clone().add(new THREE.Vector3(0, 1.3, 0));
    const ease = (t: number) => 1 - Math.pow(1 - t, 2.4);
    g.cam.play({ duration, position: (t, out) => out.lerpVectors(from, to, ease(t)), lookAt: (_t, out) => out.copy(look), fov: (t) => THREE.MathUtils.lerp(44, 36, ease(t)), roll: (t) => -0.035 * t });
  }

  private onSignBeat(beat: string): void {
    const g = this.game;
    if (beat === 'seal') {
      g.hands.pulse(0.7);
      g.audio.play('impactSoft_heavy_001', 0.5, 1.25);
    } else if (beat === 'release') {
      g.hands.pulse(0.8);
      g.avatar.playUpper('Spell_Simple_Shoot', 1.2);
      g.renderer.impactFrame(1, new THREE.Color(this.def.color));
      const aim = g.cam.aimDirection();
      g.vfx.ring(g.player.eye().add(new THREE.Vector3(0, -0.35, 0)).addScaledVector(aim, 1.3), this.def.color, 0.1, 0.5, 0.25, aim);
      g.audio.play('phaserUp3', 0.45, 0.9);
    }
  }

  private tickSign(dt: number): void {
    const s = this.sign, g = this.game;
    if (s.kind === 'signing') {
      s.t += dt;
      // The avatar's arms gather to the seal through the anticipation, hold it, and break on the release.
      g.avatar.seal = s.t < this.def.sign.impactAt ? Math.min(1, s.t / 0.45) : 0.3;
      if (s.t >= s.duration) { this.sign = { kind: 'primed', left: MASTERY_CONFIG.sign.window }; g.audio.play('tick_001', 0.35, 1.1); }
    } else if (s.kind === 'primed') {
      s.left -= dt;
      if (s.left <= 0) { this.sign = SIGN_IDLE; g.hands.stop(); g.avatar.playUpper('Spell_Simple_Exit', 1); }
    } else g.avatar.seal = 0;
  }

  // Maximum Output routes through the cutscene player: the world freezes, the
  // full sign plays regardless of Activation, and the effect fires on the
  // resolveHit beat.
  beginMax(): void {
    const g = this.game;
    const target = g.targets().filter((e) => e.alive && e.position.distanceTo(g.player.position) < 30).sort((a, b) => a.position.distanceTo(g.player.position) - b.position.distanceTo(g.player.position))[0];
    const targetPos = target ? target.position.clone().add(new THREE.Vector3(0, 1.2, 0)) : null;
    g.avatar.root.visible = true;
    // Online the world does not wait for the cutscene: the caster is untouchable
    // for its length instead, and glows on the other screens.
    if (g.net) { g.combat.invuln = Math.max(g.combat.invuln, this.def.cutscene.shots.reduce((t, s) => t + s.duration, 0) + 0.2); g.net.cast('max', this.def.cutscene.title.en); }
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
    return this.game.targets().filter((e) => {
      if (!e.alive) return false;
      const to = e.position.clone().add(new THREE.Vector3(0, 1, 0)).sub(origin);
      const d = to.length();
      if (d > range) return false;
      return to.normalize().dot(dir) > Math.cos(halfAngle);
    });
  }

  enemiesInSphere(center: THREE.Vector3, radius: number): Enemy[] {
    return this.game.targets().filter((e) => e.alive && e.position.distanceTo(center) < radius);
  }
}
