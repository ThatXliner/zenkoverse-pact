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
import { buildCompound, SPAWN, type World, type Zone } from '../world/compound';
import { PropSystem } from '../world/props';
import { Hands } from '../hands/hands';
import { Techniques } from '../techniques/techniques';
import { TECHNIQUE_IDS, type TechniqueId } from '../techniques/kit';
import { Combat } from '../combat/combat';
import { Encounters } from '../combat/encounters';
import { Aura } from '../combat/aura';
import { Vfx } from '../techniques/vfx';
import { Audio } from '../audio/audio';
import { Cutscenes } from '../cutscene/cutscene';
import { Tutorial } from '../tutorial/tutorial';
import { Drills } from '../drills/drills';
import { PactBook } from '../pacts/book';
import type { Pact } from '../pacts/schema';
import { slotWords } from '../pacts/readback';
import { keyLabel } from './keymap';
import { Mastery } from '../mastery/mastery';
import { Rooftop } from '../rooftop/rooftop';
import { Navigation } from '../nav/navigation';
import { Waypoints } from '../world/waypoints';
import { installDebug } from './debug';

export const hud = {
  zone: signal<Zone | null>(null),
  prompt: signal<{ text: string } | null>(null),
  toasts: signal<{ id: number; text: string; tone: 'info' | 'good' | 'bad' }[]>([]),
  banner: signal<{ big: string; small: string; id: number } | null>(null),
  plaque: signal<{ title: string; body: string } | null>(null),
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

// The Architect's desk in the hall, where the Workshop can also be opened by hand.
const ARCHITECT_DESK = new THREE.Vector3(-10, 0.3, -16.4);
const CUTAWAY_OPACITY = 0.1;

export class Game {
  readonly renderer: Renderer;
  readonly input: Input;
  readonly clock = new GameClock();
  readonly assets: Assets;
  readonly physics = new Physics();
  env!: Environment;
  world!: World;
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
  private titleOrbit = 0;
  private fpsAcc = 0;
  private fpsN = 0;
  private raycaster = new THREE.Raycaster();
  private cutaway = new Map<THREE.Mesh, number>();
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
    this.world = buildCompound(this.assets, this.physics, scene, this.props, this.renderer.lights);
    this.audio = new Audio(this.assets);
    this.vfx = new Vfx(scene, this.renderer.lights);
    this.cam = new CameraRig(this.renderer.camera, this.physics);
    this.cam.snap(settings.value.camera);
    hud.camera.value = this.cam.mode;
    this.player = new PlayerController(this.physics, SPAWN.courtyard.clone(), {
      onStep: (speed, surface) => { this.audio.footstep(surface, speed); this.hands.step(speed); },
      onLand: (v) => { this.cam.land(v); this.audio.land(v); this.hands.land(v); },
      onJump: () => this.hands.jump(),
      onDash: () => { this.cam.kick({ fov: 9 }); this.audio.play('phaserUp3', 0.25, 1.4); this.hands.dash(); },
    });
    this.avatar = new Avatar(this.assets, 'player', { targetHeight: 1.78 });
    scene.add(this.avatar.root);
    this.mastery = new Mastery();
    this.book = new PactBook();
    this.hands = new Hands(this.renderer.overlayScene, this.renderer.overlayCamera, this.assets);
    this.drills = new Drills(this);
    this.techniques = new Techniques(this);
    this.combat = new Combat(this);
    this.aura = new Aura(this);
    this.encounters = new Encounters(this);
    this.cutscenes = new Cutscenes(this);
    this.tutorial = new Tutorial(this);
    this.rooftop = new Rooftop(this);
    this.waypoints = new Waypoints(this.physics, scene, this.vfx);
    this.nav = new Navigation(this);
    this.setTechnique('recoil');
    this.cam.yaw = 0;
    installDebug(this);
    this.ready = true;
    setState({ kind: 'title' });
    this.renderer.gl.setAnimationLoop(() => this.frame());
  }

  setTechnique(id: TechniqueId): void {
    if (!TECHNIQUE_IDS.includes(id)) return;
    this.techniqueId = id;
    this.book.setTechnique(id);
    this.techniques.select(id);
    this.hands.setTechnique(this.techniques.def);
  }

  startRun(opts: { skipTutorial?: boolean } = {}): void {
    this.rooftop.abandon();
    this.combat.resetPlayer();
    this.techniques.reset();
    this.encounters.reset();
    this.book.preview.value = null;
    this.player.teleport(SPAWN.courtyard.clone());
    this.cam.yaw = 0;
    if (opts.skipTutorial) {
      this.tutorial.skip();
      setState({ kind: 'explore' });
      toast(`The compound is yours. ${keyLabel('workshop')} opens the Pact Workshop anywhere.`);
    } else {
      this.tutorial.start();
    }
    this.requestLock();
    this.audio.resumeContext();
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

  // The pointer is locked only in the views the mouse turns.
  requestLock(): void { if (!this.cam.isTop) this.input.requestLock(); }

  openWorkshop(): void {
    if (this.techniques.signing) return;
    this.input.releaseLock();
    this.book.preview.value = null;
    openWorkshop();
    this.audio.play('open_001', 0.4);
    this.tutorial.notify('workshop');
  }

  closeWorkshop(): void {
    if (appState.value.kind !== 'workshop') return;
    resume();
    this.requestLock();
    this.audio.play('close_001', 0.4);
  }

  // Try a draft before inscribing it: the draft defines its key until the
  // Workshop opens again, and the dummies are the place to swing it.
  tryDraft(p: Pact): void {
    this.closeWorkshop();
    this.book.preview.value = p;
    if (appState.value.kind !== 'encounter') this.encounters.begin('dummy-room', true);
    toast(`Trying "${p.name}" on ${slotWords(p.slot)}. ${keyLabel('workshop')} returns to the Workshop.`);
  }

  loop(on: boolean): void { this.renderer.gl.setAnimationLoop(on ? () => this.frame() : null); }

  step(frames: number, dt = 1 / 60): void {
    this.clock.forced = dt;
    for (let i = 0; i < frames; i++) this.frame();
    this.clock.forced = null;
  }

  private frame(): void {
    this.clock.tick();
    const st = appState.value;
    const dt = worldRuns.value ? this.clock.dt : 0;
    const raw = this.clock.raw;
    this.input.enabled = !uiBlocksInput.value && !this.cam.inShot;

    if (this.input.hitAny('pause')) {
      if (st.kind === 'paused') { resume(); this.requestLock(); }
      else if (st.kind === 'workshop') this.closeWorkshop();
      else if (worldRuns.value) { pause(); this.input.releaseLock(); }
    }
    if (worldRuns.value && !this.cam.isTop && !this.input.locked && !this.cam.inShot && this.input.canvasPressed) this.input.requestLock();

    if (st.kind === 'title' || st.kind === 'boot') {
      // A slow orbit over the compound, looking down at the courtyard.
      this.titleOrbit += raw * 0.035;
      const r = 36;
      const c = this.renderer.camera;
      c.position.set(Math.cos(this.titleOrbit) * r, 15 + Math.sin(this.titleOrbit * 0.7) * 2, Math.sin(this.titleOrbit) * r);
      c.lookAt(0, 1.5, 0);
      c.fov = 52;
      c.updateProjectionMatrix();
      this.avatar.root.visible = false;
      this.renderer.overlayVisible = false;
      this.fadeCutaway(raw, null);
    } else if (worldRuns.value || st.kind === 'workshop' || st.kind === 'paused' || st.kind === 'rooftop-offer') {
      this.simulate(dt, raw, st);
    }

    this.world.update(this.clock.time);
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
    if (this.input.hit('camera') && !this.cam.inShot) { this.setCamera(this.cam.cycleMode(), true); this.audio.play('toggle_001', 0.3); this.tutorial.notify('camera'); }
    if (this.cam.isTop) {
      if (!this.cam.inShot) this.aimAtCursor();
    } else if (this.input.enabled && !this.cam.inShot) this.cam.look(look.x, look.y, s.sensitivity, s.invertY);
    if (this.input.hit('workshop') && (st.kind === 'explore' || st.kind === 'tutorial' || st.kind === 'encounter')) this.openWorkshop();

    this.player.yaw = this.cam.yaw;
    this.player.moveYaw = this.cam.heading;
    const sprintOk = !this.techniques.casting;
    this.player.update(dt, this.input, sprintOk, this.cam.isTop);
    this.physics.tick(dt);

    const axis = this.input.axis();
    this.avatar.root.position.copy(this.player.position);
    const moving = this.player.planarSpeed.value > 0.5;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.cam.yaw);
    this.avatar.root.quaternion.slerp(q, 1 - Math.exp(-(moving ? 14 : 8) * raw));
    this.avatar.setLocomotion(this.player.velocity, this.player.grounded, raw);
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
    this.aura.update(dt);
    this.encounters.update(dt);
    this.rooftop.update(dt);
    this.props.update(dt);
    this.vfx.update(dt);
    this.cutscenes.update(raw);
    this.tutorial.update(dt);
    this.drills.update(dt);
    this.mastery.update(dt);

    const zone = this.world.zoneAt(this.player.position);
    if (zone?.id !== hud.zone.value?.id) hud.zone.value = zone;
    this.updateInteract();
    this.renderer.setChroma(this.combat.chromaAmount());
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
    if (this.input.enabled) this.cam.aimAt(this.player.eye(), hit);
  }

  // Top-down view: roofs and walls between the camera and the player fade
  // out, so a fight inside the hall is as readable as one in the yard.
  private fadeCutaway(raw: number, player: THREE.Vector3 | null): void {
    const blocked = new Set<THREE.Mesh>();
    if (player) {
      const cam = this.renderer.camera;
      const to = player.clone().add(new THREE.Vector3(0, 1.0, 0)).sub(cam.position);
      const len = to.length();
      this.raycaster.set(cam.position, to.normalize());
      this.raycaster.far = len - 0.5;
      const roofs = new Set<string>();
      for (const h of this.raycaster.intersectObjects(this.world.occluders, false)) { const m = h.object as THREE.Mesh; blocked.add(m); if (m.userData.cutaway) roofs.add(m.userData.cutaway as string); }
      if (roofs.size) for (const m of this.world.occluders) if (roofs.has(m.userData.cutaway as string)) blocked.add(m);
    }
    for (const m of this.world.occluders) {
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
      if (p.position.distanceTo(this.player.position) < 2.2) { best = { text: p.found ? `Reread: ${p.title}` : `Read plaque: ${p.title}`, act: () => { p.found = true; hud.plaque.value = { title: p.title, body: p.body }; this.audio.play('glass_002', 0.4); setTimeout(() => { hud.plaque.value = null; }, 7000); } }; break; }
    }
    if (!best && ARCHITECT_DESK.distanceTo(this.player.position) < 3.0) best = { text: 'Speak with the Pact Architect', act: () => this.openWorkshop() };
    const enc = this.encounters.interactable(this.player.position);
    if (!best && enc) best = enc;
    const roof = this.rooftop.interactable(this.player.position);
    if (!best && roof) best = roof;
    const drill = this.drills.interactable(this.player.position);
    if (!best && drill) best = drill;
    hud.prompt.value = best ? { text: best.text } : null;
    if (best && this.input.hit('interact')) best.act();
  }
}
