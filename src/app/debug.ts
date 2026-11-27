import * as THREE from 'three';
import type { Game } from './game';
import { SPAWN } from '../world/compound';
import { AWAY_SPAWNS, AWAY } from '../world/atlas';
import { ROUTE, walkDistance } from '../world/pass/route';
import type { StreamLog } from '../world/regions';
import type { CameraMode } from '../player/camera';
import { appState, setState } from './state';
import { RULES } from '../net/protocol';
import { combatUi } from '../combat/combat';
import { validatePact } from '../pacts/schema';
import type { KeySlot } from '../pacts/slots';
import type { DrillId, EncounterId } from './state';
import { street } from '../world/city/street';
import { wardWon } from '../combat/ward';
import type { Action } from './keymap';
import { audit as auditOffers } from '../rooftop/offers';
import type { TechniqueId } from '../techniques/kit';
import type { PoseName, HandPose } from '../hands/poses';
import { MASTERY_CONFIG } from '../mastery/mastery';
import { postsView } from '../drills/strikingPosts';
import { heatState, setBodyHeat, quenchView } from '../techniques/kits/heat';
import { freezePond } from '../techniques/kits/rime';
import { lanesView } from '../drills/snareLanes';
import { tensionView } from '../techniques/kits/tension';
import { wetStoneView } from '../drills/wetStone';
import { electroView } from '../techniques/kits/electro';
import { darkView } from '../techniques/kits/dark';
import { kaeshiView } from '../drills/kaeshi';
import { vapourView } from '../techniques/kits/fuelVapour';
import { fuelHands } from '../techniques/kits/fuel';
import { dokasenView } from '../drills/dokasen';
import { netUi } from '../net/net';
import { clashUi } from '../combat/clash';
import { setSetting, type Settings } from './settings';
import { KITS } from '../techniques/techniques';
import { BOSS_ULTIMATES } from '../combat/ultimates';
import { cutsceneTiming, type CutsceneLog } from '../cutscene/cutscene';
import type { AudioView } from '../audio/audio';
import { CUES, isCue } from '../audio/cues';
import type { EyeId } from '../eyes/registry';
import { eyeUi } from '../eyes/ui';
import { meleeUi, type BlowLog } from '../combat/melee';

export interface DebugApi {
  game: Game;
  // A spawn point by name (the compound's, the valley's, or any region's) or a point.
  teleport(where: string | [number, number, number]): void;
  skipTutorial(): void;
  god(on?: boolean): void;
  technique(id: TechniqueId): void;
  camera(mode: CameraMode): void;
  look(yaw: number, pitch: number): void;
  cast(slot: KeySlot): void;
  pose(name: PoseName | HandPose | null): void;
  handsView(yaw: number, pitch: number): void;
  hold(action: Action, held: boolean): void;
  encounter(id: EncounterId): void;
  // The ward's street as the checks read it: the fight, the officer, the gate, the bodies in it, and what has been won.
  ward(): WardView;
  drill(id: DrillId): void;
  // The striking posts as the checks read them: which post is lit, how long it has been, where they stand.
  posts(): ReturnType<typeof postsView>;
  // Tension's lines as the checks read them, and the Snare Lanes' runners.
  tension(): ReturnType<typeof tensionView>;
  lanes(): ReturnType<typeof lanesView>;
  // Electro's pond drill and the kit's own state, as the checks read them.
  wetStone(): ReturnType<typeof wetStoneView>;
  electro(): ReturnType<typeof electroView>;
  // Dark Dimension's storage and its drill, as the checks read them.
  dark(): ReturnType<typeof darkView>;
  kaeshi(): ReturnType<typeof kaeshiView>;
  // Fuel's vapour, what it has burned, the hands' herd or pour, and the Dōkasen posts, as the checks read them.
  fuel(): ReturnType<typeof vapourView> & { hands: ReturnType<typeof fuelHands>; dokasen: ReturnType<typeof dokasenView>; flames: number[][] };
  // Ends a running drill without judging it, back to explore.
  quitDrill(): void;
  // Heat's body heat and what it has burning, as the checks read them; `body`
  // sets the body heat. `quench` is the lit piece in the Quench drill.
  heat(body?: number): ReturnType<typeof heatState> & { quench: ReturnType<typeof quenchView> };
  // Lays Rime's ice on the pond for `seconds`, as another player's Cold Stitch does online.
  ice(seconds: number): void;
  // Regen and the passive ceiling as the checks read them.
  training(): { passiveCeiling: number; regen: typeof RULES.regen; quiet: number; mending: boolean };
  workshop(open: boolean): void;
  tutorialStep(step: string): void;
  // Plays a Maximum Output's cutscene: a Technique's by its cutscene id
  // (max-recoil, ...), with the Technique switched in and the charge full.
  cutscene(id: string): void;
  // The cutscene player as the checks read it.
  cutscenes(): CutsceneView;
  setting<K extends keyof Settings>(key: K, value: Settings[K]): void;
  freezeTime(on: boolean): void;
  loop(on: boolean): void;
  step(frames: number, dt?: number): void;
  state(): string;
  // The full sign as the check scripts read it: its state, how far along the
  // sign or the primed window is, and the boost the next primed cast earns
  // at the current Activation.
  sign(): { kind: 'idle' | 'signing' | 'primed'; duration: number; progress: number; left: number; window: number; boost: number };
  errors: string[];
  // Installs an Eye (null empties the socket). The installation's scene
  // plays only when `scene` is set. `vault` is the Technique a Vault holds.
  eye(id: EyeId | null, opts?: { vault?: TechniqueId; scene?: boolean }): void;
  // Casts the Vault Eye's Technique, as its key does.
  castVault(): boolean;
  rooftop: {
    begin(): void;
    clearWave(): void;
    climb(dir: 'up' | 'down'): void;
    status(): { stage: string; wave: number; alive: number; hp: number; maxHp: number; eye: string | null; app: string };
    audit(technique: TechniqueId, rounds: number): string[];
    offers(): { name: string; slot: string; tags: string[]; text: string; valid: boolean; errors: string[] }[];
  };
  stats(): { fps: number; drawCalls: number; triangles: number; props: number; enemies: number };
  // The regions as the world check reads them: which stand, which build and
  // their slowest slices, the streaming log, the milliseconds spent building
  // in each recent frame, the pass road's line, and every spawn by name.
  // Takes a region down so it streams in again round the player.
  restream(id: string): void;
  // How far inside the pass road's walkable strip a point is (negative inside).
  passRoad(x: number, z: number): number;
  world(): { regions: { id: string; state: string; slices: number; worstSlice: number; phases: Record<string, number> }[]; log: StreamLog[]; build: { at: number; ms: number }[]; route: [number, number, number][]; spawns: Record<string, [number, number, number]>; bounds: Record<string, { x0: number; x1: number; z0: number; z1: number }>; origins: Record<string, [number, number, number]> };
  // The player's aura as the checks read it, and the clash in progress.
  aura(): AuraView;
  // Sets trained refinement for the Technique in hand (the drill raises it in play).
  refinement(v: number): void;
  // Bare hands as the checks read them: the blow in flight, what the next
  // press throws, the aura strike's cost and whether it can fire, and every
  // blow thrown with what it hit. `bodies` reads each enemy's state and flinch chain.
  melee(): MeleeView;
  // Refills the pool at once, so a check need not wait out a recovery.
  auraReady(): void;
  // The online room as the multiplayer check reads it: this player, the
  // others as drawn here, and the hits sent and health changes heard.
  net(): NetView | null;
  // The mixer as the checks read it: whether a gesture unlocked it, what is
  // loaded, the bed and the score, and every cue asked for (played or not).
  audio(): AudioView;
  // Empties the cue log, so a check reads only what its own step played.
  audioClear(): void;
  // Every cue's name, and one cue rendered offline and measured.
  audioCues(): string[];
  audioRender(name: string): Promise<{ peak: number; rms: number; seconds: number; missing: string[] } | null>;
}

export interface WardView {
  current: string | null;
  state: string;
  won: string[];
  log: string[];
  armed: string[];
  fight: { id: string; at: [number, number, number] } | null;
  gateEmpty: boolean;
  casts: number;
  officer: { at: [number, number, number]; mode: string } | null;
  enemies: { key: string; alive: boolean; at: [number, number, number]; running: boolean; escaped: boolean; hp: number }[];
}

export interface CutsceneView {
  ids: string[];
  active: boolean;
  presenting: boolean;
  role: string | null;
  timeline: { t: number; beat: number | null; end: number } | null;
  log: CutsceneLog[];
  defs: Record<string, { total: number; beat: number | null; shots: number; pull: number | null; reach: number }>;
  cam: { mode: string; inShot: boolean; pos: [number, number, number] };
  slowMo: number;
  inputEnabled: boolean;
}

export interface AuraView {
  state: string; pool: number; left: number; holds: number; radius: number; reach: number; density: number; ended: string | null; guardBroken: number;
  pushing: boolean; spread: number; reinforce: number; recovery: number; castSpeed: number;
  refinement: number; trained: number; potential: number; breadth: number; pacts: number;
  clash: { stage: string | null; masterPick: string | null; view: unknown; log: unknown[] };
  hp: number; master: { hp: number; field: string; radius: number; density: number; pool: number; recovers: number; ended: string | null; locked: number; guardBroken: number; taken: number } | null;
}

export interface MeleeView {
  blow: { name: string; t: number; landed: boolean } | null;
  next: string;
  thrown: number;
  strike: { cost: number; ok: boolean; pool: number; state: string; left: number };
  log: BlowLog[];
  denied: number;
  bodies: { key: string; state: string; hp: number; at: [number, number, number]; guardBroken: number }[];
  remotes: { id: number; gesture: string | null; performing: boolean }[];
}

export interface NetView {
  id: number | null;
  status: string;
  room: string;
  hp: number;
  downed: boolean;
  me: { kills: number; downs: number } | null;
  pos: [number, number, number];
  remotes: { id: number; name: string; drawn: [number, number, number] | null; alive: boolean; hp: number; visible: boolean; kills: number; downs: number }[];
  sent: { target: number; amount: number; t: number }[];
  hpLog: { id: number; hp: number; by: number | null; amount: number; t: number }[];
}

export function installDebug(game: Game): void {
  if (!new URLSearchParams(location.search).has('debug')) return;
  const errors: string[] = [];
  window.addEventListener('error', (e) => errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => errors.push(String((e as PromiseRejectionEvent).reason)));
  const api: DebugApi = {
    game,
    errors,
    teleport(where) {
      const named = Array.isArray(where) ? null : (SPAWN as Record<string, THREE.Vector3>)[where] ?? AWAY_SPAWNS[where];
      if (!Array.isArray(where) && !named) throw new Error(`no spawn point named ${where}`);
      const p = Array.isArray(where) ? new THREE.Vector3(...where) : named!.clone();
      game.player.teleport(p);
    },
    skipTutorial() { game.tutorial.skip(); },
    god(on = true) { game.combat.god = on; },
    technique(id) { game.setTechnique(id); },
    camera(mode) { game.cam.snap(mode); game.setCamera(mode); },
    look(yaw, pitch) { game.cam.yaw = yaw; game.cam.pitch = pitch; },
    cast(slot) { game.techniques.cast(slot, true); },
    eye(id, opts = {}) {
      if (!id) { game.combat.eyes.remove(); return; }
      game.combat.installEye(id, opts.vault ?? (id === 'vault' ? (game.techniqueId === 'rime' ? 'shift' : 'rime') : null));
      if (!opts.scene) eyeUi.installing.value = null;
    },
    castVault() { return game.combat.eyes.castVault(); },
    pose(name) { game.hands.debugPose = name; },
    handsView(yaw, pitch) { game.hands.inspect = yaw === 0 && pitch === 0 ? null : { yaw, pitch }; },
    hold(action, held) { game.input.inject(action, held); },
    encounter(id) { game.encounters.begin(id, true); },
    ward() {
      const e = game.encounters, o = street.officer, v = (p: THREE.Vector3): [number, number, number] => [p.x, p.y, p.z];
      return {
        current: e.current?.id ?? null, state: appState.value.kind, won: [...wardWon.value], log: game.ward.log.map((l) => `${l.event} ${l.id}`),
        armed: (['city-alley', 'city-canal', 'kuroda-yard', 'kuroda-house', 'city-roofs'] as const).filter((id) => e.isArmed(id)),
        fight: street.fight ? { id: street.fight.id, at: v(street.fight.at) } : null, gateEmpty: street.gateEmpty, casts: street.casts.length,
        officer: o ? { at: v(o.at), mode: o.mode } : null,
        enemies: e.enemies.map((x) => ({ key: x.key, alive: x.alive, at: v(x.position), running: !!x.run, escaped: x.escaped, hp: x.hp })),
      };
    },
    drill(id) { game.drills.begin(id, true); },
    posts() { return postsView(); },
    ice(seconds) { freezePond(game, seconds); },
    heat(body) { if (body !== undefined) setBodyHeat(body); return { ...heatState(), quench: quenchView() }; },
    tension() { return tensionView(game); },
    lanes() { return lanesView(); },
    wetStone() { return wetStoneView(); },
    electro() { return electroView(game); },
    dark() { return darkView(game); },
    kaeshi() { return kaeshiView(); },
    fuel() { return { ...vapourView(), hands: fuelHands(), dokasen: dokasenView(), flames: game.world.flames.map((f) => [f.x, f.y, f.z]) }; },
    quitDrill() { game.drills.abandon(); if (appState.value.kind === 'drill') setState({ kind: 'explore' }); },
    training() { return { passiveCeiling: MASTERY_CONFIG.passiveCeiling, regen: RULES.regen, quiet: game.combat.quiet, mending: combatUi.mending.value }; },
    workshop(open) { if (open) game.openWorkshop(); else game.closeWorkshop(); },
    tutorialStep(step) { game.tutorial.jump(step as never); },
    cutscene(id) { game.cutscenes.playById(id); },
    setting(key, value) { setSetting(key, value); },
    cutscenes() {
      const c = game.cutscenes, cam = game.renderer.camera.position;
      const defs: CutsceneView['defs'] = {};
      for (const d of [...Object.values(KITS).map((k) => k.cutscene), ...Object.values(BOSS_ULTIMATES).map((u) => u!.cutscene)]) {
        const t = cutsceneTiming(d);
        defs[d.id] = { total: t.total, beat: t.beat, shots: d.shots.length, pull: d.pull, reach: d.reach };
      }
      return {
        ids: c.ids, active: c.active, presenting: c.presenting, role: c.role, timeline: c.timeline, log: c.log.map((l) => ({ ...l, events: [...l.events] })), defs,
        cam: { mode: game.cam.mode, inShot: game.cam.inShot, pos: [cam.x, cam.y, cam.z] }, slowMo: game.clock.slowMo, inputEnabled: game.input.enabled,
      };
    },
    freezeTime(on) { game.clock.slowMo = on ? 0 : 1; },
    loop(on) { game.loop(on); },
    step(frames, dt) { game.step(frames, dt); },
    state() { return appState.value.kind; },
    sign() {
      const t = game.techniques, s = t.sign;
      const duration = t.def.sign.duration, window = MASTERY_CONFIG.sign.window;
      return { kind: s.kind, duration, window, progress: s.kind === 'signing' ? s.t / s.duration : s.kind === 'primed' ? 1 : 0, left: s.kind === 'primed' ? s.left : 0, boost: game.mastery.signBoost(game.techniqueId) };
    },
    rooftop: {
      begin() { game.rooftop.begin(); },
      clearWave() { game.rooftop.clearWave(); },
      climb(dir) { if (dir === 'up') game.rooftop.climbUp(); else game.rooftop.climbDown(); },
      status() { const r = game.rooftop; return { stage: r.stage, wave: r.wave, alive: r.alive, hp: game.combat.hp, maxHp: game.combat.maxHp, eye: game.combat.eye, app: appState.value.kind }; },
      audit(technique, rounds) { const was = game.techniqueId; game.setTechnique(technique); const bad = auditOffers(game, rounds); game.setTechnique(was); return bad; },
      offers() {
        const shapes = game.techniques.def.shapes;
        return game.rooftop.offers.map((o) => { const v = validatePact(o.pact, shapes); return { name: o.pact.name, slot: o.pact.slot, tags: o.tags, text: o.text, valid: v.ok, errors: v.errors }; });
      },
    },
    net() {
      const n = game.net;
      if (!n) return null;
      const me = netUi.me.value;
      const p = game.player.position;
      return {
        id: n.id, status: netUi.status.value, room: netUi.room.value, hp: game.combat.hp, downed: n.downed,
        me: me ? { kills: me.kills, downs: me.downs } : null,
        pos: [p.x, p.y, p.z],
        remotes: [...n.remotes.values()].map((r) => ({ id: r.id, name: r.info.name, drawn: r.drawn ? [r.drawn.x, r.drawn.y, r.drawn.z] as [number, number, number] : null, alive: r.alive, hp: r.hp, visible: r.avatar.root.visible && !r.disposed, kills: r.info.kills, downs: r.info.downs })),
        sent: [...n.log.sent], hpLog: [...n.log.hp],
      };
    },
    aura() {
      const a = game.aura, f = a.field, t = game.techniqueId;
      const m = game.encounters.enemies.find((e) => e.field && !e.disposed);
      return {
        state: f.state, pool: f.pool, left: f.left, holds: f.holds, radius: f.radius, reach: f.reach, density: f.density, ended: f.ended, guardBroken: a.guardBroken,
        pushing: a.pushing, spread: a.spread, reinforce: a.reinforce, recovery: a.recovery, castSpeed: a.castSpeed,
        refinement: a.refinement(t), trained: game.mastery.get(t, 'refinement'), potential: a.potential(t), breadth: a.breadth(t), pacts: a.pacts(t),
        clash: { stage: a.clash.stage, masterPick: a.clash.masterPick, view: clashUi.value, log: a.clash.log.map((l) => ({ ...l })) },
        hp: game.combat.hp,
        master: m ? { hp: m.hp, field: m.field!.state, radius: m.field!.radius, density: m.field!.density, pool: m.field!.pool, recovers: m.field!.recovers, ended: m.field!.ended, locked: m.locked, guardBroken: m.guardBroken, taken: a.damageOn(m) } : null,
      };
    },
    refinement(v) {
      const t = game.techniqueId;
      game.mastery.stats.value = { ...game.mastery.stats.value, [t]: { ...game.mastery.stats.value[t], refinement: v } };
    },
    audio() { return game.audio.view(); },
    passRoad: (x, z) => walkDistance(x, z),
    restream: (id) => game.world.restream(id),
    world() {
      const w = game.world;
      const all = { ...(SPAWN as Record<string, THREE.Vector3>), ...AWAY_SPAWNS };
      return {
        regions: w.status(), log: [...w.log], build: [...w.frameBuild],
        route: ROUTE.map((n) => [n.x, n.y, n.z] as [number, number, number]),
        spawns: Object.fromEntries(Object.entries(all).map(([k, v]) => [k, [v.x, v.y, v.z] as [number, number, number]])),
        bounds: Object.fromEntries(AWAY.map((d) => [d.id, { x0: d.bounds.x0 + d.origin.x, x1: d.bounds.x1 + d.origin.x, z0: d.bounds.z0 + d.origin.z, z1: d.bounds.z1 + d.origin.z }])),
        origins: Object.fromEntries(AWAY.map((d) => [d.id, [d.origin.x, d.origin.y, d.origin.z] as [number, number, number]])),
      };
    },
    audioClear() { game.audio.log.length = 0; },
    audioCues() { return Object.keys(CUES); },
    audioRender(name) { return isCue(name) && game.audio.unlocked ? game.audio.render(name) : Promise.resolve(null); },
    auraReady() { if (!game.aura.field.open) game.aura.field.reset(); },
    melee() {
      const m = game.melee, f = game.aura.field;
      return {
        blow: m.current, next: m.nextBlow, thrown: m.thrown,
        strike: { cost: m.strikeCost, ok: m.canStrike, pool: f.pool, state: f.state, left: f.left },
        log: m.log.map((l) => ({ ...l })), denied: meleeUi.denied.value,
        bodies: game.encounters.enemies.map((e) => ({ key: e.key, state: e.state, hp: e.hp, at: [e.position.x, e.position.y, e.position.z] as [number, number, number], guardBroken: e.guardBroken })),
        remotes: game.net ? [...game.net.remotes.values()].map((r) => ({ id: r.id, gesture: r.gestureKey, performing: r.avatar.performing })) : [],
      };
    },
    stats() {
      const i = game.renderer.gl.info;
      return { fps: 0, drawCalls: i.render.calls, triangles: i.render.triangles, props: game.props.instances.length, enemies: game.encounters.enemies.length };
    },
  };
  (window as unknown as { game: DebugApi }).game = api;
}
