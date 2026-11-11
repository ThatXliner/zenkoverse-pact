import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, SMAAEffect, VignetteEffect, ToneMappingEffect, ToneMappingMode, BlendFunction, Effect, ChromaticAberrationEffect, KernelSize } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import type { Quality } from '../app/settings';
import { patchLightLoop } from './lightLoop';
import { LightPool, type PoolSize } from './lightPool';

const POOL: Record<Quality, PoolSize> = {
  high: { points: 8, spots: 6, spotShadows: 1 },
  medium: { points: 6, spots: 4, spotShadows: 0 },
  low: { points: 4, spots: 3, spotShadows: 0 },
};

const impactShader = /* glsl */ `
uniform float amount;
uniform vec3 tint;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  float l = dot(inputColor.rgb, vec3(0.299, 0.587, 0.114));
  float hard = step(0.42, l);
  vec3 frame = mix(vec3(0.02, 0.01, 0.03), tint, hard);
  frame = mix(frame, 1.0 - inputColor.rgb, 0.35);
  outputColor = vec4(mix(inputColor.rgb, frame, amount), inputColor.a);
}`;

// One to three frames of inverted, high-contrast color on a big hit.
class ImpactFrameEffect extends Effect {
  constructor() {
    super('ImpactFrameEffect', impactShader, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, THREE.Uniform>([['amount', new THREE.Uniform(0)], ['tint', new THREE.Uniform(new THREE.Color(1, 1, 1))]]),
    });
  }
  set amount(v: number) { this.uniforms.get('amount')!.value = v; }
  set tint(c: THREE.Color) { (this.uniforms.get('tint')!.value as THREE.Color).copy(c); }
}

export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly composer: EffectComposer;
  readonly scene = new THREE.Scene();
  readonly overlayScene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(80, 1, 0.08, 400);
  readonly overlayCamera = new THREE.PerspectiveCamera(75, 1, 0.01, 10);
  readonly lights = new LightPool(this.scene);
  private impact: ImpactFrameEffect;
  private bloom: BloomEffect;
  private chroma: ChromaticAberrationEffect;
  private ao: N8AOPostPass;
  private impactFrames = 0;
  private impactTint = new THREE.Color(1, 1, 1);
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
    this.ao = new N8AOPostPass(this.scene, this.camera, 1, 1);
    this.ao.configuration.aoRadius = 1.6;
    this.ao.configuration.distanceFalloff = 1.2;
    this.ao.configuration.intensity = 2.2;
    this.ao.configuration.halfRes = true;
    this.ao.configuration.color = new THREE.Color(0x060810);
    this.composer.addPass(this.ao);

    this.bloom = new BloomEffect({ intensity: 0.75, luminanceThreshold: 0.78, luminanceSmoothing: 0.25, mipmapBlur: true, kernelSize: KernelSize.LARGE, radius: 0.72 });
    this.impact = new ImpactFrameEffect();
    this.chroma = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0, 0), radialModulation: true, modulationOffset: 0.4 });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    const vignette = new VignetteEffect({ darkness: 0.55, offset: 0.28 });
    const smaa = new SMAAEffect();
    this.composer.addPass(new EffectPass(this.camera, this.bloom, tone, this.impact, vignette, smaa));
    this.composer.addPass(new EffectPass(this.camera, this.chroma));
    this.setQuality('high');
  }

  setQuality(q: Quality): void {
    const dpr = Math.min(window.devicePixelRatio, q === 'low' ? 1 : q === 'medium' ? 1.25 : 2);
    this.gl.setPixelRatio(dpr);
    this.lights.setSize(POOL[q]);
    this.gl.shadowMap.enabled = q !== 'low';
    this.ao.enabled = q !== 'low';
    this.ao.configuration.halfRes = q !== 'high';
    this.ao.configuration.aoSamples = q === 'high' ? 16 : 8;
    this.ao.configuration.denoiseSamples = q === 'high' ? 8 : 4;
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
  }

  impactFrame(frames: number, tint: THREE.Color): void {
    this.impactFrames = Math.max(this.impactFrames, frames);
    this.impactTint.copy(tint);
  }

  setChroma(amount: number): void {
    (this.chroma.offset as THREE.Vector2).set(amount, amount * 0.6);
  }

  render(dt: number): void {
    this.impact.amount = this.impactFrames > 0 ? 1 : 0;
    this.impact.tint = this.impactTint;
    if (this.impactFrames > 0) this.impactFrames--;
    this.camera.updateMatrixWorld();
    this.lights.update(this.camera, dt);
    this.gl.info.reset();
    this.gl.clear(true, true, true);
    this.composer.render(dt);
    if (this.overlayVisible) {
      this.gl.clearDepth();
      this.gl.render(this.overlayScene, this.overlayCamera);
    }
  }
}

