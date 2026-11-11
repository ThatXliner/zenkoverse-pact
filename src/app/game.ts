import * as THREE from 'three';
import { signal } from '@preact/signals';
import { Assets } from './assets';
import { Input } from './input';
import { GameClock } from './clock';
import { appState, setState, worldRuns, uiBlocksInput, pause, resume, type AppState } from './state';
import { settings } from './settings';
import { Renderer } from '../render/renderer';
import { setupEnvironment, type Environment } from '../render/env';
import { rainUniforms } from '../render/materials';
import { Physics } from '../physics/world';
import { PlayerController } from '../player/controller';
import { CameraRig } from '../player/camera';
import { Avatar } from '../character/avatar';
import { buildDistrict, SPAWN, type District, type Zone } from '../world/district';
import { PropSystem } from '../world/props';
import { Rain } from '../world/rain';
import { Hands } from '../hands/hands';
import { Techniques } from '../techniques/techniques';
import { TECHNIQUE_IDS, type TechniqueId } from '../techniques/kit';
import { Combat } from '../combat/combat';
import { Encounters } from '../combat/encounters';
import { Aura } from '../combat/aura';
import { Pedestrians } from '../world/pedestrians';
import { Vfx } from '../techniques/vfx';
import { Audio } from '../audio/audio';
import { Cutscenes } from '../cutscene/cutscene';
import { Tutorial } from '../tutorial/tutorial';
import { Drills } from '../drills/drills';
import { PactBook } from '../pacts/book';
import { Mastery } from '../mastery/mastery';
import { installDebug } from './debug';

export const hud = {
  zone: signal<Zone | null>(null),
  prompt: signal<{ key: string; text: string } | null>(null),
  toasts: signal<{ id: number; text: string; tone: 'info' | 'good' | 'bad' }[]>([]),
  banner: signal<{ big: string; small: string; id: number } | null>(null),
  plaque: signal<{ title: string; body: string } | null>(null),
  hurt: signal(0),
  fps: signal(0),
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

export class Game {
  readonly renderer: Renderer;
  readonly input: Input;
  readonly clock = new GameClock();
  readonly assets: Assets;
  readonly physics = new Physics();
  env!: Environment;
  district!: District;
  props!: PropSystem;
  rain!: Rain;
  player!: PlayerController;
  cam!: CameraRig;
  avatar!: Avatar;
  hands!: Hands;
  techniques!: Techniques;
  combat!: Combat;
  encounters!: Encounters;
  aura!: Aura;
  pedestrians!: Pedestrians;
  vfx!: Vfx;
  audio!: Audio;
  cutscenes!: Cutscenes;
  tutorial!: Tutorial;
  drills!: Drills;
  book!: PactBook;
  mastery!: Mastery;
  techniqueId: TechniqueId = 'recoil';
  private titleOrbit = 0;
  private fpsAcc = 0;
  private fpsN = 0;
  ready = false;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas);
    this.input = new Input(canvas);
    this.assets = new Assets(import.meta.env.BASE_URL, (p, label) => setState({ kind: 'boot', progress: p, label }));
    window.addEventListener('resize', () => this.renderer.resize());
    this.renderer.resize();
  }

  async boot(): Promise<void> {
    await Promise.all([this.assets.loadAll(), this.physics.init()]);
    const scene = this.renderer.scene;
    this.env = setupEnvironment(scene, this.renderer.gl, this.assets);
    this.props = new PropSystem(this.assets, this.physics, scene);
    this.district = buildDistrict(this.assets, this.physics, scene, this.props, this.renderer.lights);
    this.rain = new Rain();
    scene.add(this.rain.group);
    this.audio = new Audio(this.assets);
    this.vfx = new Vfx(scene, this.renderer.lights);
    this.cam = new CameraRig(this.renderer.camera, this.physics);
    this.player = new PlayerController(this.physics, SPAWN.academy.clone(), {
      onStep: (speed, surface) => { this.audio.footstep(surface, speed); this.hands.step(speed); },
      onLand: (v) => { this.cam.land(v); this.audio.land(v); this.hands.land(v); },
      onJump: () => this.hands.jump(),
      onDash: () => { this.cam.kick({ fov: 9 }); this.audio.play('phaserUp3', 0.25, 1.4); this.hands.dash(); },
    });
    this.avatar = new Avatar(this.assets, 'Rogue', { targetHeight: 1.78, hideParts: ['Cape'] });
    scene.add(this.avatar.root);
    this.mastery = new Mastery();
    this.book = new PactBook();
    this.hands = new Hands(this.renderer.overlayScene, this.renderer.overlayCamera);
    this.drills = new Drills(this);
    this.techniques = new Techniques(this);
    this.combat = new Combat(this);
    this.aura = new Aura(this);
    this.encounters = new Encounters(this);
    this.pedestrians = new Pedestrians(this);
    this.cutscenes = new Cutscenes(this);
    this.tutorial = new Tutorial(this);
    this.setTechnique('recoil');
    this.cam.yaw = Math.PI * 0.9;
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
    this.combat.resetPlayer();
    this.encounters.reset();
    if (opts.skipTutorial) {
      this.player.teleport(SPAWN.market.clone());
      this.cam.yaw = Math.PI / 2;
      setState({ kind: 'explore' });
      toast('Explore the district. Tab opens the Pact Workshop anywhere.');
    } else {
      this.player.teleport(SPAWN.academy.clone());
      this.cam.yaw = -Math.PI / 2;
      this.tutorial.start();
    }
    this.input.requestLock();
    this.audio.resumeContext();
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
    rainUniforms.time.value += raw;
    this.input.enabled = !uiBlocksInput.value && !this.cam.inShot;

    if (this.input.hit('pause')) {
      if (st.kind === 'paused') { resume(); this.input.requestLock(); }
      else if (st.kind === 'workshop') { setState({ kind: 'explore' }); this.input.requestLock(); }
      else if (worldRuns.value) { pause(); this.input.releaseLock(); }
    }
    if (worldRuns.value && !this.input.locked && !this.cam.inShot && this.input.hit('primary')) this.input.requestLock();

    if (st.kind === 'title' || st.kind === 'boot') {
      this.titleOrbit += raw * 0.045;
      const r = 26;
      const c = this.renderer.camera;
      c.position.set(-20 + Math.cos(this.titleOrbit) * r, 6.5 + Math.sin(this.titleOrbit * 0.7) * 1.5, Math.sin(this.titleOrbit) * r * 0.5);
      c.lookAt(-18, 4, 0);
      c.fov = 58;
      c.updateProjectionMatrix();
      this.avatar.root.visible = false;
      this.renderer.overlayVisible = false;
    } else if (worldRuns.value || st.kind === 'workshop' || st.kind === 'paused') {
      this.simulate(dt, raw, st);
    }

    this.district.update(this.clock.time);
    this.env.update(this.renderer.camera);
    this.rain.update(this.renderer.camera, this.district.indoorsAt(this.renderer.camera.position));
    this.audio.update(this.district.indoorsAt(this.player.position));
    this.renderer.render(raw);
    this.input.endFrame();

    this.fpsAcc += raw; this.fpsN++;
    if (this.fpsAcc >= 0.5) { hud.fps.value = Math.round(this.fpsN / this.fpsAcc); this.fpsAcc = 0; this.fpsN = 0; }
  }

  private simulate(dt: number, raw: number, st: AppState): void {
    const s = settings.value;
    this.cam.baseFov = s.fov;
    const look = this.input.consumeLook();
    if (this.input.enabled && !this.cam.inShot) this.cam.look(look.x, look.y, s.sensitivity, s.invertY);
    if (this.input.hit('camera') && !this.cam.inShot) { this.cam.toggleMode(); this.audio.play('toggle_001', 0.3); this.tutorial.notify('camera'); }
    if (this.input.hit('workshop') && (st.kind === 'explore' || st.kind === 'tutorial')) { this.input.releaseLock(); setState({ kind: 'workshop' }); this.audio.play('open_001', 0.4); }

    this.player.yaw = this.cam.yaw;
    const sprintOk = !this.techniques.casting;
    this.player.update(dt, this.input, sprintOk);
    this.physics.tick(dt);

    const axis = this.input.axis();
    this.avatar.root.position.copy(this.player.position);
    const moving = this.player.planarSpeed.value > 0.5;
    const faceYaw = this.cam.yaw;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), faceYaw + Math.PI);
    this.avatar.root.quaternion.slerp(q, 1 - Math.exp(-(moving ? 14 : 8) * raw));
    this.avatar.setLocomotion(this.player.planarSpeed.value, axis.x, axis.y, this.player.grounded, raw);
    this.avatar.setAimPitch(-this.cam.pitch);
    this.avatar.update(dt);
    this.avatar.root.visible = !this.cam.isFirst || this.cam.inShot;

    this.cam.update(raw, dt, this.player.position, this.player.stepCycle, this.player.planarSpeed.value, this.player.grounded, axis.x, this.clock.time);
    this.renderer.overlayVisible = this.cam.isFirst && !this.cam.inShot && st.kind !== 'workshop';

    this.techniques.update(dt, raw);
    this.hands.update(raw, dt, this.player, this.cam, this.input);
    this.combat.update(dt);
    this.aura.update(dt);
    this.encounters.update(dt);
    this.pedestrians.update(dt);
    this.props.update(dt);
    this.vfx.update(dt);
    this.cutscenes.update(raw);
    this.tutorial.update(dt);
    this.drills.update(dt);
    this.mastery.update(dt);

    const zone = this.district.zoneAt(this.player.position);
    if (zone?.id !== hud.zone.value?.id) hud.zone.value = zone;
    this.updateInteract();
    this.renderer.setChroma(this.combat.chromaAmount());
  }

  private updateInteract(): void {
    let best: { key: string; text: string; act: () => void } | null = null;
    for (const p of this.district.plaques) {
      if (p.position.distanceTo(this.player.position) < 2.2) { best = { key: 'E', text: p.found ? `Reread: ${p.title}` : `Read plaque: ${p.title}`, act: () => { p.found = true; hud.plaque.value = { title: p.title, body: p.body }; this.audio.play('glass_002', 0.4); setTimeout(() => { hud.plaque.value = null; }, 7000); } }; break; }
    }
    const dojoDesk = new THREE.Vector3(-23, 0, -70.6);
    if (!best && dojoDesk.distanceTo(this.player.position) < 3.2) best = { key: 'E', text: 'Speak with the Pact Architect', act: () => { this.input.releaseLock(); setState({ kind: 'workshop' }); this.audio.play('open_001', 0.4); } };
    const enc = this.encounters.interactable(this.player.position);
    if (!best && enc) best = enc;
    const drill = this.drills.interactable(this.player.position);
    if (!best && drill) best = drill;
    hud.prompt.value = best ? { key: best.key, text: best.text } : null;
    if (best && this.input.hit('interact')) best.act();
  }
}
