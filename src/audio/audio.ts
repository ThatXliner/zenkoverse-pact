import * as THREE from 'three';
import type { Assets } from '../app/assets';
import { settings } from '../app/settings';

// Web Audio mixer: decoded Kenney one-shots, a synthesized rain bed that
// muffles indoors, a low drone, and per-surface footsteps.
export class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private buffers = new Map<string, AudioBuffer>();
  private rainGain!: GainNode;
  private rainFilter!: BiquadFilterNode;
  private pending: Promise<void> | null = null;
  private stepN = 0;

  constructor(private assets: Assets) {}

  resumeContext(): void {
    if (this.ctx) { void this.ctx.resume(); return; }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus.connect(this.master);
    this.pending = (async () => {
      for (const [name, buf] of this.assets.audio) {
        try { this.buffers.set(name, await ctx.decodeAudioData(buf.slice(0))); } catch { /* skip undecodable */ }
      }
    })();
    this.startRain();
    this.startDrone();
  }

  private startRain(): void {
    const ctx = this.ctx!;
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let last = 0;
      for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = last * 0.92 + w * 0.08; d[i] = (w * 0.35 + last * 1.4) * 0.5; }
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    this.rainFilter = ctx.createBiquadFilter();
    this.rainFilter.type = 'lowpass';
    this.rainFilter.frequency.value = 5200;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 350;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0.16;
    src.connect(hp).connect(this.rainFilter).connect(this.rainGain).connect(this.musicBus);
    src.start();
  }

  private startDrone(): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = 0.045;
    g.connect(this.musicBus);
    for (const [f, type] of [[55, 'sine'], [82.4, 'triangle'], [110.5, 'sine']] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.07 + Math.random() * 0.05;
      const lg = ctx.createGain();
      lg.gain.value = 0.6;
      lfo.connect(lg).connect(o.detune);
      const og = ctx.createGain();
      og.gain.value = f > 100 ? 0.3 : 1;
      o.connect(og).connect(g);
      o.start(); lfo.start();
    }
  }

  play(name: string, volume = 0.6, rate = 1, pan = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const b = this.buffers.get(name);
    if (!b) return;
    const s = ctx.createBufferSource();
    s.buffer = b;
    s.playbackRate.value = rate * (0.97 + Math.random() * 0.06);
    const g = ctx.createGain();
    g.gain.value = volume;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    s.connect(g).connect(p).connect(this.sfxBus);
    s.start();
  }

  footstep(surface: string, speed: number): void {
    const set = surface === 'wood' ? ['footstep_wood_000', 'footstep_wood_001', 'footstep_wood_002'] : surface === 'metal' ? ['footstep_snow_000', 'footstep_snow_001'] : ['footstep_concrete_000', 'footstep_concrete_001', 'footstep_concrete_002', 'footstep_concrete_003'];
    this.stepN++;
    this.play(set[this.stepN % set.length]!, 0.18 + Math.min(0.2, speed * 0.03), 0.95 + Math.random() * 0.1, this.stepN % 2 ? 0.15 : -0.15);
    if (Math.random() < 0.5) this.play('footstep_snow_000', 0.05, 1.6);
  }

  land(v: number): void { this.play('impactSoft_medium_000', Math.min(0.7, v * 0.08), 0.8); }

  update(dt: number, indoors: number, camera: THREE.Camera): void {
    void dt; void camera;
    if (!this.ctx) return;
    const s = settings.value;
    this.master.gain.value = s.volume;
    this.musicBus.gain.value = s.music;
    this.rainFilter.frequency.value = THREE.MathUtils.lerp(5200, 700, indoors);
    this.rainGain.gain.value = THREE.MathUtils.lerp(0.16, 0.05, indoors);
  }
}
