import * as THREE from 'three';
import type { Game } from '../app/game';
import { appState, setState, leaveScene, type EncounterId } from '../app/state';
import { banner, toast } from '../app/game';
import { Enemy, NO_SCALE, type EnemyScale } from './enemies';
import { combatUi } from './combat';
import { BOSS_ULTIMATES } from './ultimates';
import { playerActor, enemyActor } from '../cutscene/cutscene';
import { WARD_FIGHTS } from './ward';

export interface EncounterDef {
  id: EncounterId;
  title: string;
  jp: string;
  // Where the player stands to start it, in world metres.
  where: THREE.Vector3;
  prompt?: string;
  // Starts on its own when the player comes within this many metres. It
  // goes off once it starts and is set again when the player has been well
  // away (REARM past its leash), so a street fight is there again on a later visit.
  trigger?: number;
  // The region it stands in: offered only while that region stands, and
  // over at once if the region goes, since its floor goes with it.
  region?: string;
  // How far the player may go before the fight is off (LEASH when unset).
  leash?: number;
  // Starts only once this one has been won on this visit.
  after?: EncounterId;
  // No banner and no intro: it is simply there.
  quiet?: boolean;
  spawns: { key: string; offset: [number, number, number] }[];
  intro?: string;
}

const LEASH = 40;
// How far past its leash a triggered fight must be left before it is set again.
const REARM = 80;
// Seconds a body that walks off a fight has before it goes.
const WALK_OFF = 8;

// The compound's fights: sparring partners in the ring, the Kuroda Enforcer
// at the gate, the Master on the hall's mat, and the dummies at the back of
// the hall. `where` is where the player stands to start it.
const HOME_DEFS: EncounterDef[] = [
  { id: 'sparring', title: 'The Sparring Ring', jp: '稽古場', where: new THREE.Vector3(-8, 0, 8), prompt: 'Call the sparring partners', spawns: [{ key: 'thug', offset: [-4.5, 0, -3] }, { key: 'thug', offset: [4.5, 0, -3] }, { key: 'bruiser', offset: [0, 0, -5] }], intro: 'Underworld hands, paid to spar. They want the Technique, not the lesson.' },
  { id: 'kuroda', title: 'The Gate', jp: '門', where: new THREE.Vector3(0, 0, 12), prompt: 'Challenge the Kuroda Enforcer at the gate', spawns: [{ key: 'kuroda', offset: [0, 0, 5] }, { key: 'thug', offset: [-4, 0, 4] }], intro: 'A Kuroda enforcer holds the gate.' },
  { id: 'ancient', title: 'The Hall', jp: '道場', where: new THREE.Vector3(-4, 0.3, -9), prompt: 'Challenge the Master of the hall', spawns: [{ key: 'ancient', offset: [0, 0, -7] }], intro: 'Five thousand years of Technique. Press F to open your field against hers.' },
  { id: 'dummy-room', title: 'Dummy Room', jp: '稽古', where: new THREE.Vector3(8, 0.3, -12), prompt: 'Spar with training dummies', spawns: [{ key: 'dummy', offset: [-3, 0, 0] }, { key: 'dummy', offset: [0, 0, -1] }, { key: 'dummy', offset: [3, 0, 0] }] },
];
// The city's fights (src/combat/ward.ts) are the same data, placed in the ward.
const DEFS: EncounterDef[] = [...HOME_DEFS, ...WARD_FIGHTS];

export class Encounters {
  readonly enemies: Enemy[] = [];
  private active: EncounterDef | null = null;
  private done = new Set<EncounterId>();
  // Triggered fights not yet set off, and fights won since the player last left their ground.
  private armed = new Set<EncounterId>();
  private visit = new Set<EncounterId>();
  // Bodies walking off a fight that ended without them down, and the seconds they have left.
  private leaving = new Map<Enemy, number>();
  private cooldown = 0;
  private sinceAttack = 99;
  // Told when a fight starts and when it ends (won or not), for the ward's people.
  readonly began: ((d: EncounterDef) => void)[] = [];
  readonly ended: ((d: EncounterDef, won: boolean) => void)[] = [];

  constructor(private game: Game) { this.arm(); }

  // The player is in a fight that keeps its stakes (no regen while it lasts).
  get fighting(): boolean { return this.active !== null; }
  get current(): EncounterDef | null { return this.active; }
  def(id: EncounterId): EncounterDef | undefined { return DEFS.find((d) => d.id === id); }
  // Won on this visit to its ground.
  wonHere(id: EncounterId): boolean { return this.visit.has(id); }
  // Set to start when walked into, as the checks read it.
  isArmed(id: EncounterId): boolean { return this.armed.has(id); }

  private arm(): void { for (const d of DEFS) if (d.trigger) this.armed.add(d.id); }

  reset(): void {
    const was = this.active;
    for (const e of this.enemies) { e.die(); e.dispose(); }
    this.enemies.length = 0;
    this.leaving.clear();
    this.active = null;
    this.done.clear();
    this.visit.clear();
    this.arm();
    this.cooldown = 0;
    combatUi.boss.value = null;
    if (was) for (const f of this.ended) f(was, false);
  }

  // A fight can be had here and now: its region stands, and the one before it was won.
  private open(d: EncounterDef): boolean {
    if (d.region && !this.game.world.isStanding(d.region)) return false;
    return !d.after || this.visit.has(d.after);
  }

  interactable(p: THREE.Vector3): { text: string; act: () => void } | null {
    if (this.active || this.cooldown > 0) return null;
    for (const d of DEFS) {
      if (!d.prompt || !this.open(d)) continue;
      if (d.where.distanceTo(p) < 3.5) return { text: this.done.has(d.id) ? `${d.prompt} again` : d.prompt, act: () => this.begin(d.id) };
    }
    return null;
  }

  begin(id: EncounterId, teleport = false): void {
    const d = DEFS.find((x) => x.id === id);
    if (!d || this.active) return;
    const g = this.game;
    if (teleport) { g.player.teleport(d.where.clone()); g.cam.yaw = Math.atan2(-(d.spawns[0]!.offset[0]), -(d.spawns[0]!.offset[2])); g.world.ensureAt(d.where); }
    // Nobody is put down on a floor that is not there.
    if (d.region && !g.world.isStanding(d.region)) return;
    this.active = d;
    this.armed.delete(d.id);
    for (const s of d.spawns) this.spawn(s.key, d.where.clone().add(new THREE.Vector3(...s.offset)));
    if (appState.value.kind !== 'tutorial') setState({ kind: 'encounter', id });
    if (!d.quiet) {
      banner(d.jp, d.title);
      if (d.intro) toast(d.intro);
    }
    g.audio.play('encounter.start');
    const boss = this.enemies.find((e) => e.isBoss);
    if (boss) combatUi.boss.value = { name: boss.def.title ?? boss.def.name, frac: 1, color: boss.def.emissive ?? 0xff6a1a };
    g.tutorial.notify('encounter');
    for (const f of this.began) f(d);
  }

  // Adds one enemy to the shared list, facing the player. Bosses raise their
  // health bar; the Ancient opens her field on her own.
  spawn(key: string, pos: THREE.Vector3, scale: EnemyScale = NO_SCALE, showBar = false): Enemy {
    const g = this.game;
    const e = new Enemy(g, key, pos, scale, showBar);
    e.yaw = Math.atan2(-(g.player.position.x - pos.x), -(g.player.position.z - pos.z));
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

  // A boss's Maximum Output: the same cutscene player as the player's, with
  // the boss as the caster and the player pulled into the shot. False when
  // the boss has none or another cutscene is running.
  bossUltimate(boss: Enemy): boolean {
    const g = this.game;
    const ult = BOSS_ULTIMATES[boss.def.ai];
    if (!ult || g.cutscenes.active || !boss.alive) return false;
    const d = g.player.position.clone().sub(boss.position);
    const yaw = Math.atan2(-d.x, -d.z);
    boss.yaw = yaw;
    return g.cutscenes.play({
      def: ult.cutscene, caster: enemyActor(boss), target: playerActor(g), role: 'target', yaw, sub: boss.def.name,
      gesture: (beatIn) => boss.avatar.perform(ult.sign, ult.sign.impactAt / beatIn),
      resolve: () => ult.resolve(g, boss),
    });
  }

  update(dt: number): void {
    const g = this.game;
    const p = g.player.position;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.sinceAttack += dt;
    // A fight left far behind is set again, and its ground forgets what was won there.
    for (const d of DEFS) {
      if (d.trigger && this.active !== d && d.where.distanceTo(p) > (d.leash ?? LEASH) + REARM) { this.armed.add(d.id); this.visit.delete(d.id); }
    }
    // Fights start on their own only in plain play: never online, never in
    // another scene, a cutscene or the tutorial.
    if (!this.active && appState.value.kind === 'explore' && !g.net && !g.inScene && !g.cutscenes.active && this.cooldown <= 0) {
      const d = DEFS.find((x) => x.trigger && this.armed.has(x.id) && this.open(x) && x.where.distanceTo(p) < x.trigger);
      if (d) this.begin(d.id);
    }
    for (const e of this.enemies) e.update(dt);
    const d = this.active;
    if (d) {
      const standing = this.enemies.filter((e) => e.alive && e.def.ai !== 'dummy' && !this.leaving.has(e));
      if (d.region && !g.world.isStanding(d.region)) this.end({ gone: true });
      else if (d.id === 'dummy-room') { if (p.distanceTo(d.where) > 12) this.finish(false); }
      else if (standing.length === 0) this.finish(true);
      else if (p.distanceTo(d.where) > (d.leash ?? LEASH)) {
        if (!d.quiet) toast('You left the fight. It will wait.');
        this.end({ from: p });
      }
    }
    // Bodies walking off go once they are well away, reach the end of their way, or run out of time.
    for (const [e, left] of this.leaving) {
      if (left - dt <= 0 || e.escaped || e.position.distanceTo(p) > 34) { this.leaving.delete(e); e.dispose(); }
      else this.leaving.set(e, left - dt);
    }
    for (let i = this.enemies.length - 1; i >= 0; i--) if (this.enemies[i]!.disposed) this.enemies.splice(i, 1);
  }

  // The dummy room has no winner: the player leaves it, by walking out or from the menu.
  get inDummyRoom(): boolean { return this.active?.id === 'dummy-room'; }
  leaveDummyRoom(): void { if (this.inDummyRoom) this.finish(false); }

  // Ends the fight without a win. In the ward, the bodies still standing walk
  // off away from `from` (the player who left, an officer who came) and go;
  // when the ground under them is going (`gone`) they go at once. The
  // compound's fall where they stand, as before.
  end(opts: { from?: THREE.Vector3; gone?: boolean } = {}): void {
    const d = this.active;
    if (!d) return;
    const standing = this.enemies.filter((e) => e.alive && e.def.ai !== 'dummy');
    if (opts.gone) {
      for (const e of standing) { this.leaving.delete(e); e.dispose(); }
      for (let i = this.enemies.length - 1; i >= 0; i--) if (this.enemies[i]!.disposed) this.enemies.splice(i, 1);
    }
    else if (d.region) {
      for (const e of standing) {
        const away = e.position.clone().sub(opts.from ?? this.game.player.position).setY(0);
        if (away.lengthSq() < 0.01) away.set(1, 0, 0);
        e.flee([e.position.clone().addScaledVector(away.normalize(), 40)], e.def.speed * 1.5);
        this.leaving.set(e, WALK_OFF);
      }
    }
    this.finish(false);
  }

  private finish(victory: boolean): void {
    const g = this.game;
    const d = this.active!;
    this.active = null;
    this.cooldown = 3;
    for (const e of this.enemies) if (e.alive && !this.leaving.has(e)) e.die();
    combatUi.boss.value = null;
    g.book.endEncounter();
    // A draft is only ever tried on the dummies: leaving the room takes it off its key.
    if (d.id === 'dummy-room') g.book.preview.value = null;
    const won = victory && d.id !== 'dummy-room';
    if (won) {
      this.done.add(d.id);
      this.visit.add(d.id);
      if (!d.quiet) banner('勝利', `${d.title} cleared.`);
      g.audio.play('encounter.clear');
      g.mastery.gainPassive(g.techniqueId, 'tolerance', 0.05);
      g.mastery.gainPassive(g.techniqueId, 'control', 0.04);
      if (d.id === 'ancient') toast('Five thousand years, and she still bowed. Aurabending unlocked in the codex.', 'good');
    }
    leaveScene('encounter', { kind: 'explore' });
    for (const f of this.ended) f(d, won);
  }
}
