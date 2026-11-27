import * as THREE from 'three';
import { signal } from '@preact/signals';
import { Assets } from './assets';
import { Input } from './input';
import { GameClock } from './clock';
import { appState, setState, worldRuns, uiBlocksInput, pause, resume, openWorkshop, type AppState } from './state';
import { settings, setSetting } from './settings';
import { Renderer } from '../render/renderer';
import { setupEnvironment, type Environment } from '../render/env';
import { Physics } from '../physics/world';
import { PlayerController } from '../player/controller';
import { CameraRig, CAMERA_LABEL, type CameraMode } from '../player/camera';
import { Avatar } from '../character/avatar';
import { buildCompound, SPAWN, type Zone } from '../world/compound';
import { Regions } from '../world/regions';
import { homeRegion } from '../world/home';
import { AWAY } from '../world/atlas';
import { buildSkyline } from '../world/skyline';
import { PropSystem } from '../world/props';
import { Hands } from '../hands/hands';
import { Techniques } from '../techniques/techniques';
import { TECHNIQUE_IDS, type TechniqueId } from '../techniques/kit';
import { Combat } from '../combat/combat';
import { Encounters } from '../combat/encounters';
import { Aura } from '../combat/aura';
import { Vfx } from '../techniques/vfx';
import { Audio } from '../audio/audio';
import { bindUiSounds } from '../audio/ui';
import { Cutscenes } from '../cutscene/cutscene';
import { Tutorial } from '../tutorial/tutorial';
import { Drills } from '../drills/drills';
import { strikingPosts } from '../drills/strikingPosts';
import { PactBook } from '../pacts/book';
import type { Pact } from '../pacts/schema';
import { slotWords } from '../pacts/readback';
import { keyLabel } from './keymap';
import { Mastery } from '../mastery/mastery';
import { Rooftop } from '../rooftop/rooftop';
import { Navigation } from '../nav/navigation';
import { Waypoints } from '../world/waypoints';
import { installDebug } from './debug';
import { Net } from '../net/net';
import type { Enemy } from '../combat/enemies';
import { AWAY_SPAWNS, CITY_ORIGIN } from '../world/atlas';

// `?debug&region=city` starts a run in the city ward, at the station plaza,
// past the end of the pass road; the ward builds at once round the player.
const DEBUG_REGION = (() => { const q = new URLSearchParams(location.search); return q.has('debug') ? q.get('region') : null; })();

export const hud = {
  zone: signal<Zone | null>(null),
  prompt: signal<{ text: string } | null>(null),
  toasts: signal<{ id: number; text: string; tone: 'info' | 'good' | 'bad' }[]>([]),
  banner: signal<{ big: string; small: string; id: number } | null>(null),
  plaque: signal<{ title: string; body: string; kicker?: string } | null>(null),
  hurt: signal(0),
  fps: signal(0),
  camera: signal<CameraMode>('top'),
};
let toastId = 0;
export function toast(text: string, tone: 'info' | 'good' | 'bad' = 'info'): void {
  const id = ++toastId;
  hud.toasts.value = [...hud.toasts.value, { id, text, tone }].slice(-4);
  setTimeout(() => { hud.toasts.value = hud.toasts.value.filter((t) => t.id !== id); }, 3200);
}
export function banner(big: string, small: string): void {
  hud.banner.value = { big, small, id: ++toastId };
  setTimeout(() => { if (hud.banner.value?.big === big) hud.banner.value = null; }, 2500);
}
// Toasts and banners speak about the scene they were raised in, so a new
// scene starts with none: a run restarted inside a toast's few seconds would
// otherwise show the last run's message above its own copy of it.
function clearMessages(): void {
  hud.toasts.value = [];
  hud.banner.value = null;
}

// Where Tab opens the Workshop from: play, or the pause menu over it.
const WORKSHOP_FROM: ReadonlySet<AppState['kind']> = new Set(['explore', 'tutorial', 'encounter']);

// The Architect's desk in the hall, where the Workshop can also be opened by hand.
const ARCHITECT_DESK = new THREE.Vector3(-10, 0.3, -16.4);
const CUTAWAY_OPACITY = 0.28;
const ARCHITECT = {
  title: 'The Pact Architect',
  kicker: 'Workshop desk',
  body: 'A Pact is a restriction you write onto a Technique: a condition, a cost, a limit you choose to live with. The tighter the Pact, the more the Technique gives back. I keep the Workshop here, where you draft them, see what each one costs and buys, and inscribe the ones you want. Press E again to open it, or Tab from anywhere.',
};

export class Game {
  readonly renderer: Renderer;
  readonly input: Input;
  readonly clock = new GameClock();
  readonly assets: Assets;
  readonly physics = new Physics();
  env!: Environment;
  // Every region of the world, streamed round the player; the compound and the valley are `world.home`.
  world!: Regions;
  props!: PropSystem;
  player!: PlayerController;
  cam!: CameraRig;
  avatar!: Avatar;
  hands!: Hands;
  techniques!: Techniques;
  combat!: Combat;
  encounters!: Encounters;
  aura!: Aura;
  vfx!: Vfx;
  audio!: Audio;
  cutscenes!: Cutscenes;
  tutorial!: Tutorial;
  drills!: Drills;
  book!: PactBook;
  mastery!: Mastery;
  rooftop!: Rooftop;
  waypoints!: Waypoints;
  nav!: Navigation;
  techniqueId: TechniqueId = 'recoil';
  // The online room, while the player is in one.
  net: Net | null = null;
  private titleOrbit = 0;
  private fpsAcc = 0;
  private fpsN = 0;
  private raycaster = new THREE.Raycaster();
  private cutaway = new Map<THREE.Mesh, number>();
  // Where the body faces, which can differ from the aim (`cam.yaw`).
  bodyYaw = 0;
  private aimHold = 0;
  ready = false;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas);
    this.input = new Input(canvas);
    this.input.onLockLost = () => { if (worldRuns.value && !this.cam.inShot && !this.cam.isTop) pause(); };
    this.assets = new Assets(import.meta.env.BASE_URL, (p, label) => setState({ kind: 'boot', progress: p, label }));
    window.addEventListener('resize', () => this.renderer.resize());
    this.renderer.resize();
  }

  async boot(): Promise<void> {
    await Promise.all([this.assets.loadAll(), this.physics.init()]);
    const scene = this.renderer.scene;
    this.env = setupEnvironment(scene);
    this.props = new PropSystem(this.assets, this.physics, scene);
    const home = buildCompound(this.assets, this.physics, scene, this.props, this.renderer.lights);
    const skyline = buildSkyline();
    scene.add(skyline);
    this.world = new Regions(home, [homeRegion(home), ...AWAY], scene, this.physics, this.renderer.lights, skyline, this.props, this.assets);
    this.world.ensureAt(this.home());
    this.audio = new Audio(this);
    bindUiSounds(this.audio, hud);
    this.vfx = new Vfx(scene, this.renderer.lights);
    this.cam = new CameraRig(this.renderer.camera, this.physics);
    this.cam.snap(settings.value.camera);
    this.vfx.viewer = { camera: this.renderer.camera, first: () => this.cam.isFirst && !this.cam.inShot };
    hud.camera.value = this.cam.mode;
    this.player = new PlayerController(this.physics, this.home(), {
      onStep: (speed, surface) => { this.audio.footstep(surface, speed); this.hands.step(speed); },
      onLand: (v) => { this.cam.land(v); this.audio.land(v); this.hands.land(v); },
      onJump: () => { this.audio.play('jump'); this.hands.jump(); },
      onDash: () => { this.cam.kick({ fov: 9 }); this.audio.play('dash'); this.hands.dash(); },
    });
    this.avatar = new Avatar(this.assets, 'player', { targetHeight: 1.78 });
    this.avatar.floorAt = (x, z, y) => this.physics.standingY(x, z, y);
    scene.add(this.avatar.root);
    this.mastery = new Mastery();
    this.book = new PactBook();
    this.hands = new Hands(this.renderer.overlayScene, this.renderer.overlayCamera, this.assets);
    this.drills = new Drills(this);
    this.cutscenes = new Cutscenes(this);
    this.techniques = new Techniques(this);
    this.combat = new Combat(this);
    this.aura = new Aura(this);
    this.encounters = new Encounters(this);
    this.drills.register(strikingPosts(this));
    this.tutorial = new Tutorial(this);
    this.rooftop = new Rooftop(this);
    this.waypoints = new Waypoints(this.physics, scene, this.vfx, (p) => this.world.present(p));
    this.nav = new Navigation(this);
    this.setTechnique('recoil');
    this.cam.yaw = 0;
    installDebug(this);
    this.ready = true;
    setState({ kind: 'title' });
    this.renderer.gl.setAnimationLoop(() => this.frame());
  }

  // Where a run starts: the courtyard, or the station plaza for `?debug&region=city`.
  private home(): THREE.Vector3 { return DEBUG_REGION === 'city' ? AWAY_SPAWNS['city:plaza']!.clone() : SPAWN.courtyard.clone(); }

  setTechnique(id: TechniqueId): void {
    if (!TECHNIQUE_IDS.includes(id)) return;
    this.techniqueId = id;
    this.book.setTechnique(id);
    this.techniques.select(id);
    this.endEffects();
    this.hands.setTechnique(this.techniques.def);
    this.net?.setTechnique(id);
  }

  // Everything a Technique can hit: the compound's enemies and, online, the other players.
  targets(): Enemy[] {
    // A player out on land this screen has not built is somewhere else: not drawn and not hit.
    return this.net ? [...this.encounters.enemies, ...[...this.net.remotes.values()].filter((r) => !r.elsewhere)] : this.encounters.enemies;
  }

  // Into an online room: the compound with other players, no tutorial and no
  // fights against the compound's own enemies, which are single-player.
  startOnline(room: string, name: string): void {
    this.cutscenes.cancel();
    this.net?.leave();
    this.rooftop.abandon();
    this.drills.abandon();
    this.combat.resetPlayer();
    this.techniques.reset();
    this.encounters.reset();
    this.book.preview.value = null;
    this.tutorial.skip();
    this.aura.reset();
    this.clock.shared = true;
    setState({ kind: 'explore' });
    this.net = new Net(this);
    this.net.connect(room, name);
    this.requestLock();
  }

  leaveOnline(): void {
    if (!this.net) return;
    this.cutscenes.cancel();
    this.net.leave();
    this.net = null;
    this.aura.reset();
    this.clock.shared = false;
    const url = new URL(location.href);
    url.searchParams.delete('room');
    history.replaceState(null, '', url);
    this.input.releaseLock();
    setState({ kind: 'title' });
  }

  // Every effect in the world ends with the Technique, run or scene that
  // made it: Vfx owns them all, props come out of the ice, and each kit
  // drops what it holds.
  private endEffects(): void {
    this.cutscenes.cancel();
    this.vfx.clear();
    this.props.thaw();
    this.techniques.reset();
    this.aura.reset();
    this.player.speedScale = 1;
  }

  // A scene ends: a run restarts, the rooftop trial begins or ends. Its
  // effects, its enemies and its messages go with it.
  endScene(): void {
    this.endEffects();
    this.drills.abandon();
    this.encounters.reset();
    clearMessages();
  }

  startRun(opts: { skipTutorial?: boolean } = {}): void {
    this.rooftop.abandon();
    this.combat.resetPlayer();
    this.endScene();
    this.book.preview.value = null;
    this.player.teleport(this.home());
    this.cam.yaw = 0;
    if (opts.skipTutorial || DEBUG_REGION === 'city') {
      this.tutorial.skip();
      setState({ kind: 'explore' });
      toast(`The compound is yours. ${keyLabel('workshop')} opens the Pact Workshop anywhere.`);
    } else {
      this.tutorial.start();
    }
    this.requestLock();
  }

  // Changes the camera view, from the key, the settings sheet or a check.
  setCamera(mode: CameraMode, announce = false): void {
    if (mode !== this.cam.mode) this.cam.setMode(mode);
    hud.camera.value = mode;
    if (settings.value.camera !== mode) setSetting('camera', mode);
    if (mode === 'top') this.input.releaseLock(); else if (worldRuns.value) this.requestLock();
    document.body.classList.toggle('top-view', mode === 'top');
    if (announce) toast(`Camera: ${CAMERA_LABEL[mode]}`);
  }

  // A fight, a drill or the rooftop trial is running.
  get inScene(): boolean { return this.encounters.fighting || this.drills.running !== null || this.rooftop.active; }

  // A real fight, which a draft never goes into; the dummy room is where drafts are tried.
  get inRealFight(): boolean { return this.encounters.fighting && !this.encounters.inDummyRoom; }

  // The pointer is locked only in the views the mouse turns.
  requestLock(): void { if (!this.cam.isTop) this.input.requestLock(); }

  openWorkshop(): void {
    if (this.techniques.signing) return;
    this.input.releaseLock();
    this.book.preview.value = null;
    openWorkshop();
    this.tutorial.notify('workshop');
  }

  closeWorkshop(): void {
    if (appState.value.kind !== 'workshop') return;
    resume();
    this.requestLock();
  }

  // Try a draft before inscribing it: the draft defines its key in the dummy
  // room, until the Workshop opens again or the player leaves the room.
  tryDraft(p: Pact): void {
    // Only on the dummies: a draft never goes into a real fight.
    if (this.inRealFight) { toast('Finish this fight before trying a draft.', 'bad'); return; }
    this.closeWorkshop();
    this.book.preview.value = p;
    if (appState.value.kind !== 'encounter') this.encounters.begin('dummy-room', true);
    toast(`Trying "${p.name}" on ${slotWords(p.slot)}. ${keyLabel('workshop')} returns to the Workshop. To stop, walk out of the room, or choose Stop trying the draft in the ${keyLabel('pause')} menu.`);
  }

  // Ends a try: the draft leaves its key and the dummy room closes.
  stopTrying(): void {
    this.book.preview.value = null;
    this.encounters.leaveDummyRoom();
  }

  loop(on: boolean): void { this.renderer.gl.setAnimationLoop(on ? () => this.frame() : null); }

  step(frames: number, dt = 1 / 60): void {
    this.clock.forced = dt;
    for (let i = 0; i < frames; i++) this.frame();
    this.clock.forced = null;
  }

  private frame(): void {
    this.clock.tick();
    // The regions round the player: what comes into reach builds a slice at a time, what is far behind goes.
    this.world.stream(this.player.position);
    const st = appState.value;
    // Online, menus are overlays: the shared world keeps running under them.
    const dt = worldRuns.value || this.net ? this.clock.dt : 0;
    const raw = this.clock.raw;
    this.input.enabled = !uiBlocksInput.value && !this.cam.inShot && !this.net?.downed && !this.cutscenes.locksPlayer;

    if (this.input.hitAny('pause')) {
      if (st.kind === 'paused') { resume(); this.requestLock(); }
      else if (st.kind === 'workshop') this.closeWorkshop();
      else if (worldRuns.value) { pause(); this.input.releaseLock(); }
    }
    // The key that opens the Workshop closes it too, and opens it from the pause menu, as its footer says.
    else if (st.kind === 'workshop' && this.input.hitAny('workshop')) this.closeWorkshop();
    else if (st.kind === 'paused' && this.input.hitAny('workshop') && WORKSHOP_FROM.has(st.resume.kind)) this.openWorkshop();
    if (worldRuns.value && !this.cam.isTop && !this.input.locked && !this.cam.inShot && this.input.canvasPressed) this.input.requestLock();

    if (st.kind === 'title' || st.kind === 'boot') {
      // A slow orbit over the compound, looking down at the courtyard.
      this.titleOrbit += raw * 0.035;
      const inCity = DEBUG_REGION === 'city', r = inCity ? 52 : 36, o = inCity ? CITY_ORIGIN : new THREE.Vector3();
      const c = this.renderer.camera;
      c.position.set(o.x + Math.cos(this.titleOrbit) * r, o.y + (inCity ? 30 : 15) + Math.sin(this.titleOrbit * 0.7) * 2, o.z + Math.sin(this.titleOrbit) * r);
      c.lookAt(o.x, o.y + 1.5, o.z);
      c.fov = 52;
      c.updateProjectionMatrix();
      this.avatar.root.visible = false;
      this.renderer.overlayVisible = false;
      this.fadeCutaway(raw, null);
    } else if (worldRuns.value || st.kind === 'workshop' || st.kind === 'paused' || st.kind === 'rooftop-offer') {
      this.simulate(dt, raw, st);
    }
    this.net?.update(raw);
    this.audio.update(raw);

    this.world.update(this.clock.time, raw, this.player.position, this.renderer.camera);
    this.waypoints.update(raw, this.clock.time);
    this.env.update(this.renderer.camera, this.clock.time);
    this.renderer.render(raw);
    this.input.endFrame();

    this.fpsAcc += raw; this.fpsN++;
    if (this.fpsAcc >= 0.5) { hud.fps.value = Math.round(this.fpsN / this.fpsAcc); this.fpsAcc = 0; this.fpsN = 0; }
  }

  private simulate(dt: number, raw: number, st: AppState): void {
    const s = settings.value;
    this.cam.baseFov = s.fov;
    const look = this.input.consumeLook();
    if (this.input.hit('camera') && !this.cam.inShot) { this.setCamera(this.cam.cycleMode(), true); this.audio.play('ui.camera'); this.tutorial.notify('camera'); }
    if (this.input.wheel && !this.cam.inShot) { const to = this.cam.zoom(-this.input.wheel); if (to) { this.setCamera(to, true); this.tutorial.notify('camera'); } }
    if (this.cam.isTop) {
      if (!this.cam.inShot) this.aimAtCursor();
    } else if (this.input.enabled && !this.cam.inShot) this.cam.look(look.x, look.y, s.sensitivity, s.invertY);
    if (this.input.hit('workshop') && WORKSHOP_FROM.has(st.kind)) this.openWorkshop();

    this.player.yaw = this.cam.yaw;
    this.player.moveYaw = this.cam.heading;
    const sprintOk = !this.techniques.casting;
    // A Maximum Output cutscene holds both people in it where they stand.
    if (this.cutscenes.locksPlayer) this.player.rooted = Math.max(this.player.rooted, 0.05);
    this.player.update(dt, this.input, sprintOk, this.cam.isTop);
    this.physics.tick(dt);

    const axis = this.input.axis();
    this.avatar.root.position.copy(this.player.position);
    const moving = this.player.planarSpeed.value > 0.5;
    // Outside first person the body runs the way it goes, like a twin-stick
    // or GTA hero, and turns back to the aim to sign, cast, and a beat after.
    this.aimHold = this.techniques.casting || this.techniques.sign.kind !== 'idle' || this.cam.inShot || this.cam.isFirst ? 0.6 : Math.max(0, this.aimHold - raw);
    const v = this.player.velocity;
    if (this.aimHold > 0) this.bodyYaw = this.cam.yaw;
    else if (moving && this.player.grounded) this.bodyYaw = Math.atan2(-v.x, -v.z);
    this.avatar.turnTo(this.bodyYaw, raw, moving ? 14 : 8);
    if (!this.net?.downed) this.avatar.setLocomotion(this.player.velocity, this.player.grounded, raw);
    this.avatar.setAimPitch(this.cam.isTop ? 0 : this.cam.pitch);
    this.avatar.update(dt);
    this.avatar.root.visible = !this.cam.isFirst || this.cam.inShot;

    this.cam.update(raw, dt, this.player.position, this.player.stepCycle, this.player.planarSpeed.value, this.player.grounded, axis.x, this.clock.time);
    this.renderer.overlayVisible = this.cam.isFirst && !this.cam.inShot && st.kind !== 'workshop';
    this.fadeCutaway(raw, this.cam.isTop && !this.cam.inShot ? this.player.position : null);
    this.nav.update(raw);

    this.techniques.update(dt, raw);
    this.hands.update(raw, this.player, this.cam, this.input);
    this.combat.update(dt);
    this.aura.update(dt, raw);
    this.encounters.update(dt);
    this.rooftop.update(dt);
    this.props.update(dt);
    // In a cutscene the effects bloom at half speed while the world holds still.
    this.vfx.update(this.cutscenes.active && !this.clock.frozen ? Math.max(dt, raw * 0.5) : dt);
    this.cutscenes.update(raw, dt);
    this.tutorial.update(dt);
    this.drills.update(dt);
    this.mastery.update(dt);

    const zone = this.world.zoneAt(this.player.position);
    if (zone?.id !== hud.zone.value?.id) hud.zone.value = zone;
    this.updateInteract();
    this.renderer.setChroma(this.combat.chromaAmount());
    // A dash draws speed lines along it, as a panel would.
    if (this.player.dashTimer > 0) this.renderer.speed(this.player.velocity, 0.75, 0.18);
  }

  // Top-down aim: the cursor cast onto a plane at the player's chest height,
  // so the body turns to the cursor and the Techniques fire toward it.
  private aimAtCursor(): void {
    const cam = this.renderer.camera;
    cam.updateMatrixWorld();
    this.raycaster.setFromCamera(new THREE.Vector2(this.input.mouse.x, this.input.mouse.y), cam);
    const planeY = this.player.position.y + 1.0;
    const hit = this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY), new THREE.Vector3());
    if (!hit) return;
    this.cam.aimPoint = hit;
    const floorY = this.player.position.y;
    this.cam.floorPoint = this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -floorY), new THREE.Vector3());
    if (this.input.enabled) this.cam.aimAt(this.player.eye(), hit);
  }

  // Top-down view: roofs and walls between the camera and the player fade
  // out, so a fight inside the hall is as readable as one in the yard.
  private fadeCutaway(raw: number, player: THREE.Vector3 | null): void {
    const blocked = new Set<THREE.Mesh>();
    const occluders = this.world.occluders;
    // A region taken down takes its meshes with it.
    if (this.cutaway.size) { const live = new Set(occluders); for (const m of this.cutaway.keys()) if (!live.has(m)) this.cutaway.delete(m); }
    if (player) {
      const cam = this.renderer.camera;
      const to = player.clone().add(new THREE.Vector3(0, 1.0, 0)).sub(cam.position);
      const len = to.length();
      this.raycaster.set(cam.position, to.normalize());
      this.raycaster.far = len - 0.5;
      const roofs = new Set<string>();
      for (const h of this.raycaster.intersectObjects(occluders, false)) { const m = h.object as THREE.Mesh; blocked.add(m); if (m.userData.cutaway) roofs.add(m.userData.cutaway as string); }
      if (roofs.size) for (const m of occluders) if (roofs.has(m.userData.cutaway as string)) blocked.add(m);
    }
    for (const m of occluders) {
      const cur = this.cutaway.get(m) ?? 1;
      const want = blocked.has(m) ? CUTAWAY_OPACITY : 1;
      const next = Math.abs(want - cur) < 0.005 ? want : cur + (want - cur) * (1 - Math.exp(-9 * raw));
      if (next === cur && next === 1) { this.cutaway.delete(m); continue; }
      this.cutaway.set(m, next);
      const mat = m.material as THREE.Material & { opacity: number };
      mat.opacity = next;
      mat.transparent = next < 0.999;
      mat.depthWrite = next >= 0.5;
      m.castShadow = next > 0.5;
      m.visible = m.userData.ghost ? true : next > 0.5;
    }
  }

  private updateInteract(): void {
    let best: { text: string; act: () => void } | null = null;
    for (const p of this.world.plaques) {
      // A plaque's text goes after a while, unless something else has taken its place by then.
      if (p.position.distanceTo(this.player.position) < 2.2) { best = { text: p.found ? `Reread: ${p.title}` : `Read plaque: ${p.title}`, act: () => { p.found = true; const shown = { title: p.title, body: p.body }; hud.plaque.value = shown; setTimeout(() => { if (hud.plaque.value === shown) hud.plaque.value = null; }, 7000); } }; break; }
    }
    // The Architect explains first; after that, the desk opens the Workshop.
    if (!best && ARCHITECT_DESK.distanceTo(this.player.position) < 3.0) best = hud.plaque.value?.title === ARCHITECT.title
      ? { text: 'Open the Pact Workshop', act: () => { hud.plaque.value = null; this.openWorkshop(); } }
      : { text: 'Speak with the Pact Architect', act: () => { hud.plaque.value = ARCHITECT; } };
    else if (hud.plaque.value?.title === ARCHITECT.title && ARCHITECT_DESK.distanceTo(this.player.position) > 4.5) hud.plaque.value = null;
    // The fights, the rooftop trial and the drills are single-player, and
    // one at a time: none is offered while another is running.
    if (!this.net && !this.inScene) {
      const enc = this.encounters.interactable(this.player.position);
      if (!best && enc) best = enc;
      const roof = this.rooftop.interactable(this.player.position);
      if (!best && roof) best = roof;
      const drill = this.drills.interactable(this.player.position);
      if (!best && drill) best = drill;
    }
    hud.prompt.value = best ? { text: best.text } : null;
    if (best && this.input.hit('interact')) best.act();
  }
}
