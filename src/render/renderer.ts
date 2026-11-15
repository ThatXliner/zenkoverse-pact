import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, SMAAEffect, ToneMappingEffect, ToneMappingMode, ChromaticAberrationEffect, KernelSize } from 'postprocessing';
import type { Quality } from '../app/settings';
import { patchLightLoop } from './lightLoop';
import { LightPool, type PoolSize } from './lightPool';
import { InkMaskPass, OverlayPass, PageEffect, type InkQuality, type LookId } from './manga';
import { MANGA } from './tone';

const POOL: Record<Quality, PoolSize> = {
  high: { points: 8, spots: 4, spotShadows: 1 },
  medium: { points: 6, spots: 3, spotShadows: 0 },
  low: { points: 4, spots: 2, spotShadows: 0 },
};

// What each preset spends on the page: the brush's reach (how heavy a line can
// get) and the dry-brush, paper fibre and painted looks. Low keeps the tones
// and a plain ink line.
const INK: Record<Quality, InkQuality> = {
  high: { radius: 2, detail: true },
  medium: { radius: 2, detail: true },
  low: { radius: 1, detail: false },
};

// The whole-frame looks a cutscene shot can ask for, as the page's mix.
const LOOKS: Record<LookId, { wash: number; water: number; negative: number }> = {
  manga: { wash: 0, water: 0, negative: 0 },
  wash: { wash: 1, water: 0, negative: 0 },
  watercolor: { wash: 0, water: 1, negative: 0 },
  negative: { wash: 0.85, water: 0, negative: 1 },
};

const v3 = new THREE.Vector3();

// The frame: the toned scene (src/render/tone.ts), a little bloom for the
// lanterns and the Technique glow, a hue-preserving tone curve, then the page
// (src/render/manga.ts): the first-person arms laid in, brush ink over
// everything, paper, staging lines and the panel.
export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly composer: EffectComposer;
  readonly scene = new THREE.Scene();
  readonly overlayScene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(80, 1, 0.08, 600);
  readonly overlayCamera = new THREE.PerspectiveCamera(75, 1, 0.01, 10);
  readonly lights = new LightPool(this.scene);
  private page: PageEffect;
  private mask: InkMaskPass;
  private overlay: OverlayPass;
  private bloom: BloomEffect;
  private chroma: ChromaticAberrationEffect;
  private impactFrames = 0;
  private impactN = 0;
  private focusT = 0;
  private focusMax = 1;
  private focusPeak = 0;
  private focusWorld: THREE.Vector3 | null = null;
  private speedT = 0;
  private speedMax = 1;
  private speedPeak = 0;
  // Null: straight into the frame.
  private speedWorld: THREE.Vector3 | null = null;
  private lookId: LookId = 'manga';
  // A world point the screen patterns are pinned to, so they slide with the
  // world rather than stay on the glass. Re-pinned when it leaves the view.
  private anchor: THREE.Vector3 | null = null;
  // The camera's facing last frame and how strongly the tones print now.
  private lastDir = new THREE.Vector3();
  private toneK = 1;
  private size = new THREE.Vector2();
  overlayVisible = true;

  constructor(canvas: HTMLCanvasElement) {
    patchLightLoop();
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true });
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.NoToneMapping;
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.gl.autoClear = false;
    this.gl.info.autoReset = false;

    this.composer = new EffectComposer(this.gl, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.overlay = new OverlayPass(this.overlayScene, this.overlayCamera);
    this.composer.addPass(this.overlay);
    this.mask = new InkMaskPass(this.camera, this.overlay);
    this.composer.addPass(this.mask);
    this.bloom = new BloomEffect({ intensity: 0.4, luminanceThreshold: 0.9, luminanceSmoothing: 0.2, mipmapBlur: true, kernelSize: KernelSize.MEDIUM, radius: 0.55 });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL });
    this.composer.addPass(new EffectPass(this.camera, this.bloom, tone, new SMAAEffect()));
    this.page = new PageEffect(this.mask, this.overlay);
    this.composer.addPass(new EffectPass(this.camera, this.page));
    this.chroma = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0, 0), radialModulation: true, modulationOffset: 0.4 });
    this.composer.addPass(new EffectPass(this.camera, this.chroma));
    this.setQuality('high');
  }

  setQuality(q: Quality): void {
    const dpr = Math.min(window.devicePixelRatio, q === 'low' ? 1 : q === 'medium' ? 1.25 : 2);
    this.gl.setPixelRatio(dpr);
    this.lights.setSize(POOL[q]);
    this.gl.shadowMap.enabled = q !== 'low';
    this.page.setQuality(INK[q]);
    this.resize();
  }

  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.gl.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.overlayCamera.aspect = w / h;
    this.overlayCamera.updateProjectionMatrix();
    this.gl.getDrawingBufferSize(this.size);
    // Pattern and line sizes are authored at 1080 lines; a denser screen
    // scales them so the drawing reads the same.
    const stride = Math.max(0.6, this.size.y / 1080);
    MANGA.pitch.value = Math.max(3.6, 5.2 * stride);
    this.mask.stride = stride;
    this.page.u('stride').value = stride;
  }

  // A big hit: a frame or three drawn in two inks, focus lines on the point
  // hit (or the frame's centre), in the colour of whoever landed it.
  impactFrame(frames: number, tint: THREE.Color, at?: THREE.Vector3): void {
    this.impactFrames = Math.max(this.impactFrames, frames);
    (this.page.u('accent').value as THREE.Color).copy(tint);
    this.focus(at ?? null, Math.min(1, 0.55 + frames * 0.15), 0.18 + frames * 0.06);
  }

  // Focus lines converging on a world point (null: the frame's centre).
  focus(at: THREE.Vector3 | null, strength: number, seconds: number): void {
    this.focusWorld = at ? at.clone() : null;
    this.focusPeak = strength;
    this.focusT = this.focusMax = seconds;
    this.page.u('seed').value = Math.floor(Math.random() * 97);
  }

  // Speed lines for a body moving fast along `dir`: streaks across the frame,
  // lines rushing in when it moves into the screen (or `dir` is null).
  speed(dir: THREE.Vector3 | null, strength: number, seconds: number): void {
    this.speedWorld = dir ? dir.clone() : null;
    this.speedPeak = strength;
    this.speedT = this.speedMax = seconds;
  }

  // A whole-frame look; 'manga' is the page itself.
  look(id: LookId, accent?: THREE.Color): void {
    this.lookId = id;
    if (accent) (this.page.u('accent').value as THREE.Color).copy(accent);
  }
  get currentLook(): LookId { return this.lookId; }

  // An installed Eye's side of the first-person frame (src/eyes/eyes.ts):
  // `side` 1 right or -1 left, `k` 0 (none) to 1.
  eyeView(side: number, color: number, k: number): void {
    const p = this.page;
    p.u('eyeSide').value = side;
    p.u('eyeK').value = k < 0.002 ? 0 : k;
    (p.u('eyeTint').value as THREE.Color).set(color);
  }

  setChroma(amount: number): void {
    (this.chroma.offset as THREE.Vector2).set(amount, amount * 0.6);
  }

  private stage(dt: number): void {
    const p = this.page, cam = this.camera;
    const look = LOOKS[this.lookId];
    p.u('wash').value = look.wash;
    p.u('water').value = look.water;
    p.u('negative').value = look.negative;
    p.u('impact').value = this.impactFrames > 0 ? 1 : 0;
    p.u('impactFlip').value = this.impactN % 2;
    if (this.impactFrames > 0) { this.impactFrames--; this.impactN++; } else this.impactN = 0;

    this.focusT = Math.max(0, this.focusT - dt);
    p.u('focus').value = this.focusPeak * Math.min(1, (this.focusT / this.focusMax) * 1.6);
    const at = p.u('focusAt').value as THREE.Vector2;
    if (this.focusWorld) {
      v3.copy(this.focusWorld).project(cam);
      at.set(THREE.MathUtils.clamp(v3.x * 0.5 + 0.5, 0.1, 0.9), THREE.MathUtils.clamp(v3.y * 0.5 + 0.5, 0.1, 0.9));
    } else at.set(0.5, 0.5);

    this.speedT = Math.max(0, this.speedT - dt);
    const k = this.speedPeak * Math.min(1, (this.speedT / this.speedMax) * 2);
    // The motion seen from the camera: across the frame streaks, into it converges.
    if (this.speedWorld) v3.copy(this.speedWorld).transformDirection(cam.matrixWorldInverse); else v3.set(0, 0, -1);
    const across = Math.hypot(v3.x, v3.y), into = Math.max(0, -v3.z);
    const total = across + into + 1e-6;
    (p.u('speedDir').value as THREE.Vector2).set(v3.x, v3.y).normalize();
    p.u('speed').value = k * (across / total);
    p.u('radial').value = k * 0.8 * (into / total);

    // Pin the screen patterns to the world.
    cam.getWorldDirection(v3);
    // The dots are a screen pattern pinned to one point; a sharp turn drags
    // them across surfaces at other depths and they crawl. While the camera
    // swings fast the tones ease off to flat cel colour, and come back as it
    // settles (and a pattern re-pinned off screen jumps unseen).
    const turn = dt > 0 && this.lastDir.lengthSq() > 0 ? this.lastDir.angleTo(v3) / dt : 0;
    this.lastDir.copy(v3);
    const want = 1 - 0.85 * THREE.MathUtils.smoothstep(turn, 0.9, 3.0);
    this.toneK += (want - this.toneK) * (1 - Math.exp(-(want < this.toneK ? 22 : 5) * dt));
    MANGA.tone.value = this.toneK;
    if (this.anchor) {
      const s = this.anchor.clone().project(cam);
      const behind = this.anchor.clone().sub(cam.position).dot(v3) < 1;
      if (behind || Math.abs(s.x) > 1.6 || Math.abs(s.y) > 1.6) this.anchor = null;
    }
    if (!this.anchor) this.anchor = cam.position.clone().addScaledVector(v3, 12);
    const s = this.anchor.clone().project(cam);
    MANGA.origin.value.set((s.x * 0.5 + 0.5) * this.size.x, (s.y * 0.5 + 0.5) * this.size.y);
    (p.u('origin').value as THREE.Vector2).copy(MANGA.origin.value);
    this.mask.origin = MANGA.origin.value;
  }

  render(dt: number): void {
    this.camera.updateMatrixWorld();
    this.lights.update(this.camera, dt);
    this.overlay.visible = this.overlayVisible;
    this.page.u('overOn').value = this.overlayVisible ? 1 : 0;
    this.stage(dt);
    this.gl.info.reset();
    this.gl.clear(true, true, true);
    this.composer.render(dt);
  }
}
