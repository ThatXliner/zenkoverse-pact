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
import { AURA, AuraField, auraPotential, fieldFor, type FieldEnd, type FieldState } from './field';
import { FieldView } from './fieldView';
import { Clash } from './clash';
import { fieldReading } from '../drills/fieldReading';

export interface AuraReadout { state: FieldState; pool: number; left: number; holds: number; ended: FieldEnd | null; guardBroken: boolean }
export interface AuraTraining { refinement: number; trained: number; potential: number; breadth: number; pacts: number }
export const auraUi = {
  field: signal<AuraReadout>({ state: 'ready', pool: 1, left: 0, holds: 0, ended: null, guardBroken: false }),
  training: signal<AuraTraining>({ refinement: 0, trained: 0, potential: 1, breadth: 1, pacts: 0 }),
};

type Owner = Enemy | RemotePlayer;

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

  constructor(private game: Game) {
    this.mine = new FieldView(game.renderer.scene, 0xffffff);
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

  inField(p: THREE.Vector3): boolean {
    if (!this.field.open) return false;
    const me = this.game.player.position;
    return Math.hypot(p.x - me.x, p.z - me.z) < this.field.radius && Math.abs(p.y - me.y) < this.field.radius;
  }
  // An enemy inside the player's field moves and winds up this much slower.
  hinder(p: THREE.Vector3): number { return this.inField(p) ? 1 - AURA.hinder * this.field.density : 1; }
  // The player's wind-ups inside their own field.
  get castSpeed(): number { return 1 + AURA.sharper.speed * this.density; }
  // A hit from the player on a body in the player's field.
  damageOn(p: THREE.Vector3): number { return this.inField(p) ? 1 + AURA.sharper.damage * this.field.density : 1; }

  // F: expand when the pool is full, retract when the field is open.
  toggle(): void {
    if (this.clash.active) return;
    if (this.field.open) { this.retract(); return; }
    if (this.field.ready) { this.expand(); return; }
    if ((this.nag -= 1) <= 0) { toast(`Aura recovering: ${Math.round(this.field.pool * 100)}%. It must refill before you expand again.`); this.nag = 2; }
    this.game.audio.play('error_004', 0.25, 0.8);
  }

  expand(): boolean {
    const g = this.game;
    const f = fieldFor(this.refinement());
    this.field.recovers = f.recovers;
    if (!this.field.expand(f.reach, f.density, f.holds)) return false;
    const feet = g.player.position.clone().add(new THREE.Vector3(0, 0.08, 0));
    g.vfx.ring(feet, this.colorOf(null), 0.4, f.reach * 1.15, 0.45);
    g.vfx.ring(feet.clone().add(new THREE.Vector3(0, 1, 0)), 0xffffff, 0.3, f.reach * 0.8, 0.3);
    g.audio.play('phaserUp3', 0.55, 0.45);
    g.audio.play('impactSoft_heavy_001', 0.5, 0.7);
    g.cam.kick({ fov: 6, pitch: 0.01 });
    g.avatar.playUpper('Spell_Simple_Shoot', 1.1);
    g.tutorial.notify('aura');
    return true;
  }

  // By choice: the field draws back in, calmly, and the pool starts from empty.
  retract(): void {
    const g = this.game;
    if (!this.field.end('retracted')) return;
    const feet = g.player.position.clone().add(new THREE.Vector3(0, 0.08, 0));
    g.vfx.ring(feet, this.colorOf(null), this.field.radius, 0.3, 0.5);
    g.audio.play('phaserDown1', 0.4, 0.6);
    toast('Field retracted. Your aura refills from empty.');
  }

  // Forced: a lost clash crushes the field and breaks the guard for `guard` seconds.
  collapse(guard: number): void {
    const g = this.game;
    if (!this.field.end('collapsed')) return;
    this.mine.crack();
    const c = g.player.position.clone().add(new THREE.Vector3(0, 1, 0));
    g.vfx.burst(c, 22, 'shard', 7, this.colorOf(null));
    g.vfx.ring(g.player.position.clone().add(new THREE.Vector3(0, 0.08, 0)), 0xff6a5a, this.field.radius, 0.2, 0.35);
    g.audio.play('impactGlass_heavy_000', 0.8, 0.8);
    g.cam.shake(0.6);
    this.guardBroken = Math.max(this.guardBroken, guard);
  }

  reset(): void {
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
      const inside = d < radius;
      if (inside && !this.field.open) pressed = Math.min(pressed, 1 - AURA.hinder * density);
      this.touch(o, radius, d);
      let view = this.views.get(o);
      if (!view && radius > 0.05) { view = new FieldView(g.renderer.scene, this.colorOf(o)); this.views.set(o, view); }
      if (!view) continue;
      const zone = g.world.zoneAt(o.position);
      view.draw(raw, g.clock.time, o.position, radius, density, { inside, dome: this.clash.active ? 0.3 : inside ? 0.5 : 0.9, ceiling: zone?.indoors ? zone.max.y - o.position.y : undefined });
    }
    for (const [o, v] of this.views) if (!owners.includes(o)) { v.dispose(); this.views.delete(o); }
    g.player.fieldScale = pressed;

    this.clash.update(raw);
    const me = g.player.position;
    const zone = g.world.zoneAt(me);
    this.mine.color = this.colorOf(null);
    if (this.lean > 0) this.mine.tell(null, this.leanTo);
    this.mine.draw(raw, g.clock.time, me, this.field.radius, this.field.open ? this.field.density : 0.4, { inside: true, dome: this.clash.active ? 0.3 : g.cam.isFirst ? 0.5 : g.cam.isTop ? 0.6 : 0.85, ceiling: zone?.indoors ? zone.max.y - me.y : undefined, lean: this.lean });
    this.publish();
  }

  // Two open fields that touch start a clash: against the Master here, and
  // online by asking the server, which decides whether it starts.
  private touch(o: Owner, radius: number, d: number): void {
    const g = this.game;
    if (!this.field.open || this.clash.active || g.cutscenes.active || radius < 0.5 || d >= this.field.radius + radius) return;
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
  if (f.state === 'ready') return { state: 'Ready', detail: `${keyLabel('aura')} expands` };
  if (f.ended === 'collapsed') return { state: 'Collapsed', detail: `${Math.round(f.pool * 100)}% · refilling` };
  return { state: f.ended === 'retracted' ? 'Retracted' : 'Spent', detail: `${Math.round(f.pool * 100)}% · refilling` };
}
