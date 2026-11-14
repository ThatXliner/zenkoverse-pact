import * as THREE from 'three';
import type { Game } from '../app/game';
import { appState, setState, type EncounterId } from '../app/state';
import { banner, toast } from '../app/game';
import { Enemy, NO_SCALE, type EnemyScale } from './enemies';
import { combatUi } from './combat';
import { anchored } from '../techniques/kits/shift';

interface EncounterDef {
  id: EncounterId;
  title: string;
  jp: string;
  where: THREE.Vector3;
  triggerRadius?: number;
  prompt?: string;
  spawns: { key: string; offset: [number, number, number] }[];
  intro?: string;
  reward?: string;
}

// Every fight is in the compound: sparring partners in the ring, the Kuroda
// Enforcer at the gate, the Master on the hall's mat, and the dummies at the
// back of the hall. `where` is where the player stands to start it.
const DEFS: EncounterDef[] = [
  { id: 'sparring', title: 'The Sparring Ring', jp: '稽古場', where: new THREE.Vector3(-8, 0, 8), prompt: 'Call the sparring partners', spawns: [{ key: 'thug', offset: [-4.5, 0, -3] }, { key: 'thug', offset: [4.5, 0, -3] }, { key: 'bruiser', offset: [0, 0, -5] }], intro: 'Underworld hands, paid to spar. They want the Technique, not the lesson.' },
  { id: 'kuroda', title: 'The Gate', jp: '門', where: new THREE.Vector3(0, 0, 12), prompt: 'Challenge the Kuroda Enforcer at the gate', spawns: [{ key: 'kuroda', offset: [0, 0, 5] }, { key: 'thug', offset: [-4, 0, 4] }], intro: 'Watch the ground. Their "fire" is fuel, and the sheen comes before the flame.' },
  { id: 'ancient', title: 'The Hall', jp: '道場', where: new THREE.Vector3(-4, 0.3, -9), prompt: 'Challenge the Master of the hall', spawns: [{ key: 'ancient', offset: [0, 0, -7] }], intro: 'Five thousand years of Technique. Hold F to meet her field with yours.' },
  { id: 'dummy-room', title: 'Dummy Room', jp: '稽古', where: new THREE.Vector3(8, 0.3, -12), prompt: 'Spar with training dummies', spawns: [{ key: 'dummy', offset: [-3, 0, 0] }, { key: 'dummy', offset: [0, 0, -1] }, { key: 'dummy', offset: [3, 0, 0] }] },
];

const bossUltimate = anchored({
  id: 'boss-ancient', title: { jp: '五千年', en: 'Five Thousand Years' }, color: 0x7dffb2, timeScale: 0.1, letterbox: true,
  shots: [
    { duration: 1.0, from: [0.9, 1.5, -1.6], to: [0.6, 1.4, -1.2], look: [0, 1.4, 0], fov: [44, 38], events: [{ at: 0, kind: 'gesture' }, { at: 0.2, kind: 'title' }, { at: 0.1, kind: 'sfx', id: 'phaserUp3', pitch: 0.35 }] },
    { duration: 1.2, from: [-3, 1.2, 2], to: [-4, 1.6, 3], look: [0, 1.2, 0], lookTo: [0, 1, -4], roll: [0.15, 0], fov: [62, 76], events: [{ at: 0.45, kind: 'impactFrame', frames: 3 }, { at: 0.5, kind: 'resolveHit' }, { at: 0.5, kind: 'shake', amount: 1 }, { at: 0.5, kind: 'sfx', id: 'impactBell_heavy_000', pitch: 0.35 }, { at: 0.55, kind: 'slow', scale: 0.5 }] },
  ],
});

export class Encounters {
  readonly enemies: Enemy[] = [];
  private active: EncounterDef | null = null;
  private done = new Set<EncounterId>();
  private cooldown = 0;
  private sinceAttack = 99;

  constructor(private game: Game) {}

  reset(): void {
    for (const e of this.enemies) { e.die(); e.dispose(); }
    this.enemies.length = 0;
    this.active = null;
    this.done.clear();
    combatUi.boss.value = null;
  }

  interactable(p: THREE.Vector3): { text: string; act: () => void } | null {
    if (this.active || this.cooldown > 0) return null;
    for (const d of DEFS) {
      if (!d.prompt) continue;
      if (d.where.distanceTo(p) < 3.5) return { text: this.done.has(d.id) ? `${d.prompt} again` : d.prompt, act: () => this.begin(d.id) };
    }
    return null;
  }

  begin(id: EncounterId, teleport = false): void {
    const d = DEFS.find((x) => x.id === id);
    if (!d || this.active) return;
    const g = this.game;
    if (teleport) { g.player.teleport(d.where.clone()); g.cam.yaw = Math.atan2(-(d.spawns[0]!.offset[0]), -(d.spawns[0]!.offset[2])); }
    this.active = d;
    for (const s of d.spawns) this.spawn(s.key, d.where.clone().add(new THREE.Vector3(...s.offset)));
    if (appState.value.kind !== 'tutorial') setState({ kind: 'encounter', id });
    banner(d.jp, d.title);
    if (d.intro) toast(d.intro);
    g.audio.play('bong_001', 0.7, 0.8);
    const boss = this.enemies.find((e) => e.isBoss);
    if (boss) combatUi.boss.value = { name: boss.def.title ?? boss.def.name, frac: 1, color: boss.def.emissive ?? 0xff6a1a };
    g.tutorial.notify('encounter');
  }

  // Adds one enemy to the shared list, facing the player. Bosses raise their
  // health bar and the Ancient opens its field, as in the compound fights.
  spawn(key: string, pos: THREE.Vector3, scale: EnemyScale = NO_SCALE, showBar = false): Enemy {
    const g = this.game;
    const e = new Enemy(g, key, pos, scale, showBar);
    e.yaw = Math.atan2(-(g.player.position.x - pos.x), -(g.player.position.z - pos.z));
    if (key === 'ancient') e.aura.active = true;
    this.enemies.push(e);
    if (e.isBoss) combatUi.boss.value = { name: e.def.title ?? e.def.name, frac: 1, color: e.def.emissive ?? 0xff6a1a };
    return e;
  }

  // A crowd that all swings at once is unreadable, so the rooftop spaces out
  // the wind-ups of the whole crowd. An enemy that is not granted the claim
  // keeps circling and asks again next frame.
  claimAttack(): boolean {
    const gap = this.game.rooftop.attackGap;
    if (gap === 0) return true;
    if (this.sinceAttack < gap) return false;
    this.sinceAttack = 0;
    return true;
  }

  bossUltimate(boss: Enemy): void {
    const g = this.game;
    g.cutscenes.play({
      def: bossUltimate, caster: boss.avatar.root, casterYaw: boss.yaw, target: g.player.position.clone().add(new THREE.Vector3(0, 1.2, 0)),
      onGesture: () => boss.avatar.playUpper('Spell_Simple_Enter', 0.8),
      onResolve: () => {
        const c = boss.position.clone();
        for (let i = 1; i <= 4; i++) g.vfx.after(i * 0.06, () => g.vfx.ring(c.clone().add(new THREE.Vector3(0, 0.1 + i * 0.2, 0)), 0x7dffb2, 0.5, 6 * i, 0.7));
        g.vfx.flash(boss.center(), 0x7dffb2, 120, 0.7, 30);
        const d = g.player.position.distanceTo(c);
        const shielded = g.aura.active && g.aura.clashing;
        if (d < 22 && !shielded) g.combat.hurtPlayer(34 * (1 - d / 30), { from: c, kinetic: true });
        for (const p of g.props.instances) if (p.mesh.position.distanceTo(c) < 22) { p.body.wakeUp(); p.body.applyImpulse(p.mesh.position.clone().sub(c).setY(0.8).normalize().multiplyScalar(p.def.mass * 9), true); }
      },
      onVfx: () => undefined,
    });
  }

  update(dt: number): void {
    const g = this.game;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.sinceAttack += dt;
    if (!this.active && appState.value.kind === 'explore') {
      for (const d of DEFS) if (d.triggerRadius && !this.done.has(d.id) && d.where.distanceTo(g.player.position) < d.triggerRadius) this.begin(d.id);
    }
    for (const e of this.enemies) e.update(dt);
    if (this.active) {
      const alive = this.enemies.filter((e) => e.alive && e.def.ai !== 'dummy');
      const d = this.active;
      if (alive.length === 0 && d.id !== 'dummy-room') this.finish();
      else if (d.id === 'dummy-room' && g.player.position.distanceTo(d.where) > 12) this.finish();
      else if (d.id !== 'dummy-room' && g.player.position.distanceTo(d.where) > 40) { toast('You left the fight. It will wait.'); this.finish(false); }
    }
    for (let i = this.enemies.length - 1; i >= 0; i--) if (this.enemies[i]!.disposed) this.enemies.splice(i, 1);
  }

  private finish(victory = true): void {
    const g = this.game;
    const d = this.active!;
    this.active = null;
    this.cooldown = 3;
    for (const e of this.enemies) if (e.alive) e.die();
    combatUi.boss.value = null;
    g.book.endEncounter();
    if (victory && d.id !== 'dummy-room') {
      this.done.add(d.id);
      banner('勝利', `${d.title} cleared.`);
      g.audio.play('confirmation_002', 0.8);
      g.mastery.gain(g.techniqueId, 'tolerance', 0.05);
      g.mastery.gain(g.techniqueId, 'control', 0.04);
      if (d.id === 'kuroda') toast('The Kuroda "fire" was fuel all along. The codex remembers.', 'good');
      if (d.id === 'ancient') toast('Five thousand years, and she still bowed. Aurabending unlocked in the codex.', 'good');
    }
    if (appState.value.kind === 'encounter') setState({ kind: 'explore' });
  }
}
