import * as THREE from 'three';
import { signal, effect } from '@preact/signals';
import type { Game } from '../app/game';
import { toast } from '../app/game';
import { worldRuns } from '../app/state';
import { keyLabel } from '../app/keymap';
import type { TechniqueKit, AbilityContext, CastResult, TechniqueId } from './kit';
import type { Pact, TriggerValue } from '../pacts/schema';
import { KEY_SLOTS, KIND_DEFS, kindOn, slotDef, type AbilityKind, type AbilitySlot, type KeySlot } from '../pacts/slots';
import { restriction, wagerOf } from '../pacts/schema';
import { callWords } from '../pacts/wager';
import { triggerWords } from '../pacts/readback';
import { describe } from '../pacts/resolve';
import { pick, type Gesture } from '../hands/gestures';
import type { CameraKick } from '../player/camera';
import type { GestureVariant } from '../mastery/mastery';
import { MASTERY_CONFIG } from '../mastery/mastery';
import type { Enemy } from '../combat/enemies';
import { recoil } from './kits/recoil';
import { shift } from './kits/shift';
import { rime } from './kits/rime';
import { blink } from './kits/blink';
import { echo } from './kits/echo';
import { heat } from './kits/heat';
import { tension } from './kits/tension';
import { electro } from './kits/electro';
import { friction } from './kits/friction';
import { dark } from './kits/dark';
import { fuel } from './kits/fuel';
import { GROUP_PROP, GROUP_WORLD, GROUP_ENEMY } from '../physics/world';
import { playerActor, enemyActor } from '../cutscene/cutscene';
import { RULES } from '../net/protocol';
import { Wagers, darkUi } from './wagers';
import { Declarations } from './declarations';

export const KITS: Record<TechniqueId, TechniqueKit> = { recoil, shift, rime, blink, echo, heat, tension, electro, friction, dark, fuel };

interface Cast { slot: KeySlot; ctx: AbilityContext; t: number; impactAt: number; duration: number; fired: boolean; held: boolean; result?: CastResult | void }

// The full hand sign (issue #42). Alt starts it; nothing cancels it. While
// signing the player is rooted and cannot cast or open the Workshop.
// A finished sign primes the Technique for `MASTERY_CONFIG.sign.window`
// seconds: the next cast skips its wind-up and carries the boost. A cast
// consumes the prime; the window running out drops it.
export type SignState =
  | { kind: 'idle' }
  | { kind: 'signing'; t: number; duration: number }
  | { kind: 'primed'; left: number };
const SIGN_IDLE: SignState = { kind: 'idle' };
// The Resolve-driven potency of the raw Technique: "if I will activation, activate."
const RAW_POTENCY = 0.22;

// What the HUD shows for a key: the Ability's name, a few words on what it
// does, how it is cast, and whether it is the raw Technique, a draft being
// tried, or nothing yet (an extra slot with no Pact).
// `wager` is what the Pact on the key bets on each cast, when it holds a Wager.
// `dark` names the Pact a lost Wager has put out, while the key falls back.
export interface SlotLabel { name: string; what: string; kind: AbilityKind | null; raw: boolean; preview: boolean; empty: boolean; wager: string | null; dark?: string }
const EMPTY_LABEL: SlotLabel = { name: '', what: '', kind: null, raw: false, preview: false, empty: true, wager: null };
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
  // A blow landed on the player this frame, for Pacts programmed to fire when struck.
  private struckNow = false;
  // Whether each programmed Pact's trigger held last frame: it fires as the trigger begins to hold.
  private programWas = new Map<string, boolean>();
  sealed = 0;
  sign: SignState = SIGN_IDLE;
  // The latest cast, so what its blows land on can tell a signed blow from a
  // plain one (the striking posts score only signed blows). `at` is game time.
  lastCast: { kind: AbilityKind; primed: boolean; at: number } = { kind: 'primary', primed: false, at: -Infinity };
  // When this player last began a Maximum Output (performance.now()).
  private maxAt = -Infinity;
  readonly limbTrail: THREE.Vector3[] = [];
  // The Wagers written into Pacts, declared by casting them.
  readonly wagers: Wagers;
  // Named Pacts called out over the caster as they are cast.
  readonly declarations: Declarations;

  constructor(private game: Game) {
    this.wagers = new Wagers(game);
    this.declarations = new Declarations(game);
    for (const k of Object.values(KITS)) {
      game.book.registerCatalogue(k.id, k.catalogue);
      if (k.drill) game.drills.register(k.drill);
      game.cutscenes.register(k.cutscene.id, () => { if (game.techniqueId !== k.id) game.setTechnique(k.id); this.charge = 1; this.beginMax(); });
    }
    effect(() => this.refreshSlots());
  }

  select(id: TechniqueId): void {
    this.def = KITS[id];
    this.resource = this.def.resource.startsFull ? this.def.resource.max : 0;
    this.strain = 0;
    this.charge = 0;
    this.reset();
    this.refreshSlots();
  }

  // Drops any cast in flight, the sign state and every kit's own state, for
  // a new run or Technique. Every kit resets, not only the selected one: a
  // kit's passive only runs while it is selected, so nothing else would.
  reset(): void {
    this.cast_ = null;
    this.sign = SIGN_IDLE;
    // A blow taken as the last scene ended (a defeat) is not one in the next:
    // a Pact programmed to fire when struck would fire on the first frame.
    this.struckNow = false;
    this.struckRecently = 0;
    for (const k of Object.values(KITS)) k.effects.reset?.(this.game);
    this.wagers.clear();
    this.declarations.clear();
    this.stopGesture();
  }

  // The first-person hands and the body play every gesture together.
  private perform(gesture: Gesture, speed: number, onEvent: (e: string) => void = () => undefined, onCamera: (k: CameraKick) => void = (k) => this.game.cam.kick(k)): void {
    this.game.hands.play(gesture, speed, onEvent, onCamera);
    this.game.avatar.perform(gesture, speed);
  }

  private stopGesture(): void {
    this.game.hands.stop();
    this.game.avatar.release();
  }

  // Drops the cast in flight, for an Aura Clash that locks the player. The
  // sign and the kits' own state stay.
  interrupt(): void {
    if (!this.cast_) return;
    if (this.cast_.held) this.def.effects.release?.(this.cast_.ctx);
    this.cast_ = null;
    this.stopGesture();
  }

  get casting(): boolean { return this.cast_ !== null; }
  get current(): Cast | null { return this.cast_; }
  get signing(): boolean { return this.sign.kind === 'signing'; }

  private refreshSlots(): void {
    const book = this.game.book;
    const preview = book.preview.value;
    const dark = darkUi.value;
    techUi.slots.value = perSlot((s): SlotLabel => {
      const held = preview?.slot === s && preview.technique === this.def.id ? preview : book.bound(s);
      const p = held && !dark.has(held.id) ? held : null;
      if (p) {
        const shape = this.def.shapes[p.grant.shape];
        const w = wagerOf(p);
        return { name: p.name, what: shape?.short ?? '', kind: kindOn(s, shape?.kinds), raw: false, preview: p === preview, empty: false, wager: w ? callWords(w) : null };
      }
      const raw = slotDef(s).raw;
      const out = held?.name;
      return raw ? { name: `Raw ${this.def.primitive.name}`, what: this.def.primitive.short, kind: raw, raw: true, preview: false, empty: false, wager: null, dark: out } : out ? { ...EMPTY_LABEL, dark: out } : EMPTY_LABEL;
    });
  }

  // A draft being tried defines its key. Otherwise an inscribed Pact that
  // is programmed to take precedence does so while its trigger holds, and
  // the bound Pact defines the key the rest of the time. A Pact a lost
  // Wager has put out defines nothing until it comes back.
  pactFor(slot: KeySlot): Pact | null {
    const p = this.definer(slot);
    return p && !this.wagers.isDark(p.id) ? p : null;
  }

  private definer(slot: KeySlot): Pact | null {
    const book = this.game.book;
    const preview = book.preview.value;
    if (preview && preview.slot === slot && preview.technique === this.def.id) return preview;
    for (const p of book.inscribed.value) {
      if (p.technique !== this.def.id || p.slot !== slot || book.expired(p) || this.wagers.isDark(p.id)) continue;
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

  // How hard a cast hits, from the Pact's Resolve and trained Output. The raw
  // Technique runs on the conscious-will Pact; a Pact that gives up less than
  // that is no weaker than it, since it still asks for at least as much.
  potency(pact: Pact | null): number {
    const g = this.game;
    const mastery = g.mastery.get(this.def.id, 'output');
    const base = Math.max(RAW_POTENCY, pact ? g.book.estimate(pact).potency : 0);
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
    const refusal = this.refuses(pact);
    if (refusal && !force) { toast(refusal, 'bad'); return false; }
    const met = this.triggerMet(pact);
    if (!met.ok && !force) { toast(`The Pact is not met: ${met.why}`, 'bad'); return false; }
    const cost = this.costFor(kind, pact);
    if (cost.resource > this.resource + 1e-3 && kind !== 'max') {
      if (g.combat.flags.bloodDraw) cost.health += 5;
      else { toast(`Not enough ${this.def.resource.name}`, 'bad'); return false; }
    }
    // A primed cast skips its wind-up and carries the sign's boost. Maximum
    // Output always plays its full sign in the cutscene, boosted or not.
    const primed = this.sign.kind === 'primed';
    const variant = kind === 'max' ? 'long' : primed ? 'none' : g.mastery.variant(this.def.id);
    const shape = pact?.grant.shape ?? this.baselineShape(kind);
    const behaviors = pact?.grant.behaviors ?? [];
    const dir = g.cam.aimDirection();
    const up = new THREE.Vector3(0, 1, 0);
    const wobble = pact ? 0 : (Math.random() - 0.5) * 0.18 * (1 - g.mastery.get(this.def.id, 'precision'));
    dir.applyAxisAngle(up, wobble);
    const origin = g.player.eye();
    // Top-down, the aim is the floor under the cursor. A ray from the eye
    // toward the cursor's chest-height point runs on past it to the ground,
    // landing well beyond where the player pointed.
    const cursor = g.cam.isTop ? g.cam.floorPoint : null;
    let aim: THREE.Vector3;
    if (cursor) {
      const at = cursor.clone().sub(origin).applyAxisAngle(up, wobble).add(origin);
      const floor = g.physics.castRay(new THREE.Vector3(at.x, g.player.position.y + 2.5, at.z), new THREE.Vector3(0, -1, 0), 8, GROUP_WORLD | GROUP_PROP, g.player.body);
      aim = floor ? floor.point : at;
    } else {
      const aimHit = g.physics.castRay(origin, dir, 60, GROUP_WORLD | GROUP_PROP | GROUP_ENEMY, g.player.body);
      aim = aimHit ? aimHit.point : origin.clone().addScaledVector(dir, 30);
    }
    const ctx: AbilityContext = {
      game: g, pact, slot, kind, shape, behaviors, potency: this.potency(pact) * (primed ? 1 + g.mastery.signBoost(this.def.id) : 1),
      variant, origin, dir, aim, targets: [], wagered: false,
    };
    if (primed) this.sign = SIGN_IDLE;
    this.lastCast = { kind, primed, at: g.clock.time };
    this.resource = Math.max(0, this.resource - cost.resource);
    if (cost.health > 0) g.combat.hurtPlayer(cost.health, { self: true });
    this.strain = Math.min(1, this.strain + cost.strain);
    // A shape with a gesture or a wind-up cue of its own plays it; the rest play their kind's.
    const gestureSet = this.def.gestures[shape] ?? this.def.gestures[kind] ?? this.def.gestures.primary!;
    const gesture = pick(gestureSet, variant);
    // Inside an open aura field the player senses and acts faster (issue #4).
    const speed = (1 + g.mastery.get(this.def.id, 'speed') * 0.7) * (variant === 'long' ? 1 : 1.15) * g.aura.castSpeed;
    const held = restriction(pact ?? ({ clauses: [] } as unknown as Pact), 'duration') === 'held' || !!(!pact && kind === 'secondary' && this.def.effects.hold);
    // A Maximum Output's sign is already playing in its cutscene, timed to this beat.
    const cut = kind === 'max' && g.cutscenes.active;
    if (!cut) this.perform(gesture, speed);
    this.cast_ = { slot, ctx, t: 0, impactAt: gesture.impactAt / speed, duration: gesture.duration / speed, fired: false, held };
    if (!cut) g.audio.play(this.def.audio[shape] ?? this.def.audio[kind], { pitch: variant === 'none' ? 1.15 : 1 });
    this.cooldown[slot] = KIND_DEFS[kind].cooldown;
    if (kind === 'max') this.charge = 0;
    ctx.wagered = this.wagers.declare(pact, ctx);
    // A Maximum Output's cutscene letters its own title.
    const shout = kind !== 'max' && this.declarations.cast(pact, ctx.wagered);
    // The others play the gesture by its key: the shape's own, else the kind's.
    g.net?.cast(kind !== 'max' && this.def.gestures[shape] ? shape : kind, kind === 'max' ? this.def.cutscene.title.en : pact?.name ?? `Raw ${this.def.primitive.name}`, variant, speed, shout);
    g.book.observe('movingWhileCasting', g.player.planarSpeed.value > 0.5 ? 1 : 0);
    g.book.observe('airborneFraction', g.player.grounded ? 0 : 1);
    g.book.observe('auraReliance', g.aura.open ? 1 : 0);
    g.mastery.gainPassive(this.def.id, 'activation', 0.004);
    g.tutorial.notify(slot);
    return true;
  }

  private fire(c: Cast): void {
    const g = this.game;
    c.fired = true;
    const r = this.wagers.fire(c.ctx, () => this.def.effects.cast(c.ctx));
    c.result = r;
    const pact = c.ctx.pact;
    if (r) {
      if (r.hitStop) g.clock.hitStop(r.hitStop);
      if (r.impactFrame) g.renderer.impactFrame(r.impactFrame, new THREE.Color(this.def.color), c.ctx.aim ?? undefined);
      if (r.cameraKick) g.cam.kick(r.cameraKick);
      if (r.rooted) g.player.rooted = Math.max(g.player.rooted, r.rooted);
      if (r.moveLock) g.player.moveLock = Math.max(g.player.moveLock, r.moveLock);
      // The odds a Wager is called against are measured in `wagers.fire`.
      if (c.ctx.kind !== 'max') g.book.observe('multiTargetFraction', (r.hits ?? 0) >= 2 ? 1 : 0, 0.02);
      if ((r.hits ?? 0) > 0) { this.charge = Math.min(1, this.charge + 0.08 * (r.hits ?? 1)); g.mastery.gainPassive(this.def.id, 'precision', 0.006); }
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

  seal(seconds: number): void { this.sealed = seconds; this.cast_ = null; this.stopGesture(); }
  struck(): void { this.struckRecently = 2.5; this.struckNow = true; this.wagers.struck(); }

  // A Pact programmed to refuse while its trigger holds says why; null when it may fire.
  private refuses(pact: Pact | null): string | null {
    const prog = pact?.clauses.find((c) => c.kind === 'program' && c.then === 'suppress');
    return prog?.kind === 'program' && this.triggerHolds(prog.when) ? `"${pact!.name}" refuses to fire while ${triggerWords(prog.when)}` : null;
  }

  // A key press, or a program pressing it: a Maximum Output plays its
  // cutscene when the ring is full; anything else is cast. A program never
  // reaches for a Maximum Output that is not ready.
  private press(s: KeySlot, auto = false): void {
    const g = this.game;
    if (this.kindOf(s) !== 'max') { this.cast(s); return; }
    if (g.net && performance.now() - this.maxAt < RULES.max.cooldownMs) { if (!auto) toast('Maximum Output is not ready', 'bad'); return; }
    const ready = this.charge >= (g.combat.flags.overextension ? 0.5 : 1) && this.sealed <= 0 && !this.cast_;
    if (ready && this.refuses(this.pactFor(s))) { if (!auto) toast(this.refuses(this.pactFor(s))!, 'bad'); return; }
    if (ready) {
      if (g.combat.flags.overextension && this.charge < 1) g.combat.hurtPlayer(g.combat.maxHp * 0.25, { self: true });
      this.beginMax();
    } else if (!auto) this.cast(s);
  }

  // Pacts programmed to fire themselves do, as their trigger begins to hold
  // (when struck: on each blow), through the same checks as their key: its
  // cooldown, its cost, its own trigger, a full ring for a Maximum Output.
  // Only the Pact that defines its key runs its program.
  private runPrograms(): void {
    for (const s of KEY_SLOTS) {
      const p = this.pactFor(s);
      const prog = p?.clauses.find((c) => c.kind === 'program' && c.then === 'activate');
      if (!p || prog?.kind !== 'program') continue;
      const holds = prog.when === 'struck' ? this.struckNow : this.triggerHolds(prog.when);
      const was = this.programWas.get(p.id) ?? holds;
      this.programWas.set(p.id, holds);
      if (holds && (prog.when === 'struck' || !was)) this.press(s, true);
    }
  }

  update(dt: number, raw: number): void {
    const g = this.game;
    const inp = g.input;
    // Cooldowns and a seal run on real time, so a hit-stop does not stretch
    // them, but not under a menu offline: the world waits there, and a lost
    // Wager's seal would otherwise run out on the pause screen.
    const live = worldRuns.value || g.net ? raw : 0;
    for (const k of KEY_SLOTS) this.cooldown[k] = Math.max(0, this.cooldown[k] - live * g.aura.recovery);
    this.sealed = Math.max(0, this.sealed - live);
    this.struckRecently = Math.max(0, this.struckRecently - dt);
    const regen = this.def.resource.regen * (1 + g.mastery.get(this.def.id, 'efficiency') * 0.5);
    if (!this.cast_?.held) this.resource = Math.min(this.def.resource.max, this.resource + regen * dt);
    this.strain = Math.max(0, this.strain - dt * 0.03 * (1 + g.mastery.get(this.def.id, 'tolerance')));
    this.def.effects.passive?.(g, dt);
    this.wagers.update(dt);
    this.declarations.update(raw);

    if (!g.cutscenes.active && inp.enabled) {
      if (inp.hit('fullsign')) this.beginSign();
      if (!this.signing && !g.aura.pushing) {
        for (const s of KEY_SLOTS) if (inp.hit(s)) this.press(s);
        this.runPrograms();
      }
    }
    this.struckNow = false;
    this.tickSign(dt);

    const c = this.cast_;
    if (c) {
      c.t += dt;
      if (!c.fired && c.t >= c.impactAt) this.fire(c);
      if (c.fired && c.held) {
        const down = inp.isDown(c.slot);
        if (down && this.resource > 0) { this.def.effects.hold?.(c.ctx, dt); this.resource = Math.max(0, this.resource - dt * this.def.resource.max * 0.12); }
        else { this.def.effects.release?.(c.ctx); this.stopGesture(); this.cast_ = null; }
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
    this.perform(gesture, 1, (e) => this.onSignBeat(e));
    if (!g.cam.isFirst) this.signShot(gesture.impactAt + 0.1);
    g.audio.play('sign.begin');
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
      g.audio.play('sign.seal');
    } else if (beat === 'release') {
      g.hands.pulse(0.8);
      g.renderer.impactFrame(1, new THREE.Color(this.def.color));
      const aim = g.cam.aimDirection();
      g.vfx.ring(g.player.eye().add(new THREE.Vector3(0, -0.35, 0)).addScaledVector(aim, 1.3), this.def.color, 0.1, 0.5, 0.25, aim);
      g.audio.play('sign.release');
    }
  }

  private tickSign(dt: number): void {
    const s = this.sign, g = this.game;
    if (s.kind === 'signing') {
      s.t += dt;
      if (s.t >= s.duration) { this.sign = { kind: 'primed', left: MASTERY_CONFIG.sign.window }; g.audio.play('sign.primed'); }
    } else if (s.kind === 'primed') {
      s.left -= dt;
      if (s.left <= 0) { this.sign = SIGN_IDLE; this.stopGesture(); }
    }
  }

  // Maximum Output plays through the cutscene player (issue #27): the
  // nearest body within the Output's reach is pulled into the shot, the full
  // sign plays whatever the Activation, timed so its strike lands on the
  // beat, and the kit's effect fires on that beat, aimed at the target.
  beginMax(): boolean {
    const g = this.game, def = this.def.cutscene;
    if (g.cutscenes.active) return false;
    const me = g.player.position;
    const target = g.targets()
      .filter((e) => e.alive && e.position.distanceTo(me) < def.reach && !g.aura.clash.involves(e))
      .sort((a, b) => a.position.distanceTo(me) - b.position.distanceTo(me))[0] ?? null;
    let yaw = g.cam.yaw;
    if (target) { const d = target.position.clone().sub(me); yaw = Math.atan2(-d.x, -d.z); }
    g.cam.yaw = yaw;
    const partner = target?.def.ai === 'rival' ? (target as Enemy & { id: number }).id : null;
    const charge = this.charge;
    const ok = g.cutscenes.play({
      def, caster: playerActor(g), target: target ? enemyActor(target) : null, role: 'caster', yaw, partner,
      sub: `Maximum Output · ${this.def.name}`,
      gesture: (beatIn) => {
        const gesture = this.def.gestures.max!.long;
        this.perform(gesture, gesture.impactAt / beatIn, undefined, () => undefined);
      },
      resolve: () => {
        g.cam.yaw = yaw;
        g.cam.pitch = 0;
        this.cast('max', true);
        if (this.cast_) this.fire(this.cast_);
      },
      end: (resolved) => {
        this.cast_ = null;
        // Ended before the blow (the server refused it, the scene ended): the charge comes back.
        if (!resolved) this.charge = Math.max(this.charge, charge);
        g.net?.endMax();
      },
    });
    if (!ok) return false;
    this.charge = 0;
    this.maxAt = performance.now();
    g.net?.beginMax(def, partner, yaw);
    return true;
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
