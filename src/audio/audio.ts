import * as THREE from 'three';
import { effect } from '@preact/signals';
import type { Game } from '../app/game';
import { appState } from '../app/state';
import { settings } from '../app/settings';
import { HALL, STORE } from '../world/compound';
import { blinkUi } from '../techniques/kits/blink';
import { CUES, isCue, type Cue, type CueName, type Layer } from './cues';
import { SYNTHS, makeNoise, type Noise, type Voice } from './synth';
import { Library } from './library';
import { Ambience, type AmbienceView, type MusicMode } from './ambience';
import { STEP_CUE, surfaceAt, type Surface } from './surfaces';

// The mixer. Nothing exists until the first click or key (browsers refuse to
// play before one, and the game should not try): then the context, the buses,
// the room reverbs and the ambience start, and the recordings begin to load.
//
//   master ── music  (settings.music):  the score
//          ── world  (settings.effects): cues, the ambience bed, both reverbs
//          ── ui     (settings.effects): menus, toasts, the Workshop
//
// Cues placed in the world (`at`) go through a panner; the listener is the
// player's head, facing where the camera faces, so a sound to your left is on
// your left in every view. The bed and the score duck under big moments.

export interface PlayOptions {
  // Where in the world; omitted, the sound is the player's own (or the UI's).
  at?: THREE.Vector3;
  gain?: number;
  pitch?: number;
  // 0 to 1: how much of the cue's weight-scaled layers sound (hit weight).
  weight?: number;
  // Played for another player's cast, not sent on again.
  remote?: boolean;
}

export interface SoundEvent {
  t: number;
  cue: string;
  bus: 'sfx' | 'ui';
  // `running` sounded; `suspended` or `none` was dropped (no gesture yet, or the tab is away).
  ctx: 'none' | 'suspended' | 'running' | 'closed' | 'interrupted';
  at: [number, number, number] | null;
  gain: number;
  layers: number;
}

export interface AudioView {
  unlocked: boolean;
  gestureAt: number | null;
  state: string;
  library: { loaded: number; total: number; failed: number };
  volumes: { master: number; music: number; effects: number };
  muffle: number;
  ambience: AmbienceView | null;
  log: SoundEvent[];
}

const LOG_MAX = 600;
const GESTURES = ['pointerdown', 'mousedown', 'keydown', 'touchend'] as const;

export class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private worldBus!: GainNode;
  private uiBus!: GainNode;
  private duckBed!: GainNode;
  private duckMusic!: GainNode;
  private muffleFilter!: BiquadFilterNode;
  private dry!: GainNode;
  private send!: GainNode;
  private hallVerb!: GainNode;
  private yardVerb!: GainNode;
  private noise!: Record<Noise, AudioBuffer>;
  private ambience: Ambience | null = null;
  private readonly library = new Library(import.meta.env.BASE_URL);
  private last = new Map<string, number>();
  private steps = new WeakMap<object, number>();
  private heartAt = 0;
  private muffle = 0;
  private gestureAt: number | null = null;
  private hum!: { gain: GainNode; tone: ConstantSourceNode; filter: BiquadFilterNode };
  // A cue a kit plays is offered here first; online, the room's wire sends it on.
  mirror: ((cue: CueName, at: THREE.Vector3 | null, gain: number, pitch: number) => void) | null = null;
  readonly log: SoundEvent[] = [];

  constructor(private game: Game) {
    const onGesture = (): void => {
      this.gestureAt ??= performance.now();
      this.unlock();
      if (this.ctx?.state === 'running') for (const e of GESTURES) window.removeEventListener(e, onGesture, true);
    };
    for (const e of GESTURES) window.addEventListener(e, onGesture, true);
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend(); else void this.ctx.resume();
    });
  }

  // Only ever called from inside a user gesture (the listeners above, or a button's handler).
  unlock(): void {
    if (this.ctx) { if (this.ctx.state !== 'running' && !document.hidden) void this.ctx.resume(); return; }
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.noise = makeNoise(ctx);
    this.master = ctx.createGain();
    // A gentle limiter on the master, so a Maximum Output on top of a fight never clips.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10; limiter.knee.value = 8; limiter.ratio.value = 6; limiter.attack.value = 0.003; limiter.release.value = 0.25;
    this.master.connect(limiter).connect(ctx.destination);

    this.musicBus = ctx.createGain();
    this.duckMusic = ctx.createGain();
    this.duckMusic.connect(this.musicBus).connect(this.master);

    this.worldBus = ctx.createGain();
    this.muffleFilter = ctx.createBiquadFilter();
    this.muffleFilter.type = 'lowpass';
    this.muffleFilter.frequency.value = 20000;
    this.muffleFilter.connect(this.worldBus).connect(this.master);
    this.uiBus = ctx.createGain();
    this.uiBus.connect(this.master);

    this.dry = ctx.createGain();
    this.dry.connect(this.muffleFilter);
    this.duckBed = ctx.createGain();
    this.duckBed.connect(this.muffleFilter);

    // Two rooms: the hall (long, wooden) and the walled yard (short slap off the walls).
    this.send = ctx.createGain();
    this.hallVerb = ctx.createGain();
    this.yardVerb = ctx.createGain();
    this.hallVerb.gain.value = 0;
    this.yardVerb.gain.value = 0.35;
    for (const [out, secs, decay, pre] of [[this.hallVerb, 1.9, 2.6, 0.012], [this.yardVerb, 0.9, 4.5, 0.035]] as const) {
      const c = ctx.createConvolver();
      c.buffer = impulse(ctx, secs, decay, pre);
      this.send.connect(c).connect(out).connect(this.muffleFilter);
    }

    // The open aura field: a low chord that hums while it holds and climbs with its density.
    const humGain = ctx.createGain();
    humGain.gain.value = 0;
    const humFilter = ctx.createBiquadFilter();
    humFilter.type = 'lowpass'; humFilter.frequency.value = 400; humFilter.Q.value = 3;
    humFilter.connect(humGain).connect(this.dry);
    // One root everything follows, so the chord can be retuned at once.
    const tone = ctx.createConstantSource();
    tone.offset.value = 98;
    tone.start();
    for (const [ratio, det] of [[1, 0], [1.5, 4], [2, -6]] as const) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth'; o.detune.value = det;
      const m = ctx.createGain(); m.gain.value = ratio;
      tone.connect(m).connect(o.frequency);
      const og = ctx.createGain(); og.gain.value = 0.3 / ratio;
      o.frequency.value = 0;
      o.connect(og).connect(humFilter);
      o.start();
    }
    this.hum = { gain: humGain, tone, filter: humFilter };

    this.ambience = new Ambience(ctx, this.duckBed, this.duckMusic, (k) => this.noise[k], this.library);
    this.library.load(ctx);
    this.applyVolumes();
    effect(() => { void settings.value; this.applyVolumes(); });
    void ctx.resume();
  }

  get unlocked(): boolean { return this.ctx !== null; }

  play(name: CueName, opts: PlayOptions = {}): void {
    const cue: Cue = CUES[name];
    const ctx = this.ctx;
    const now = performance.now();
    const gain = opts.gain ?? 1;
    this.record({ t: now, cue: name, bus: cue.bus, ctx: ctx ? ctx.state as SoundEvent['ctx'] : 'none', at: opts.at ? [round(opts.at.x), round(opts.at.y), round(opts.at.z)] : null, gain: round(gain), layers: cue.layers.length });
    if (cue.net && !opts.remote) this.mirror?.(name, opts.at ?? null, gain, opts.pitch ?? 1);
    if (!ctx || ctx.state !== 'running') return;
    if (cue.every) {
      const prev = this.last.get(name) ?? -Infinity;
      if (now - prev < cue.every * 1000) return;
      this.last.set(name, now);
    }
    const t = ctx.currentTime + 0.005;
    const out = ctx.createGain();
    out.gain.value = gain;
    let tail: AudioNode = out;
    if (opts.at) tail = tail.connect(this.panner(opts.at));
    if (cue.bus === 'ui') tail.connect(this.uiBus);
    else {
      tail.connect(this.dry);
      if (cue.wet) { const s = ctx.createGain(); s.gain.value = cue.wet; tail.connect(s).connect(this.send); }
    }
    const pitch = opts.pitch ?? 1, weight = opts.weight ?? 1;
    let longest = 0;
    for (const layer of cue.layers) longest = Math.max(longest, this.layer(ctx, out, t, layer, pitch, weight));
    // Let the graph go once the last layer and its reverb have died.
    window.setTimeout(() => out.disconnect(), (longest + 3) * 1000);
    if (cue.duck) this.duck(cue.duck);
  }

  // A blow on a body: the tier and the weight inside it scale with the damage.
  hit(amount: number, at?: THREE.Vector3): void {
    const name: CueName = amount >= 80 ? 'hit.crushing' : amount >= 40 ? 'hit.heavy' : amount >= 15 ? 'hit.medium' : 'hit.light';
    const weight = THREE.MathUtils.clamp(amount / 100, 0.1, 1);
    this.play(name, { at, weight, pitch: 1.08 - weight * 0.16 });
  }

  // The player's own step, on what the controller says is underfoot.
  footstep(tag: string, speed: number): void {
    const s = surfaceAt(this.game.player.position, tag);
    this.play(STEP_CUE[s], { gain: THREE.MathUtils.clamp(0.55 + speed * 0.06, 0.6, 1.1), pitch: 0.96 + Math.random() * 0.08 });
  }

  land(v: number): void {
    const s = surfaceAt(this.game.player.position, this.game.player.surface);
    if (s === 'water') { this.play('land.water'); return; }
    this.play('land', { weight: THREE.MathUtils.clamp(v / 12, 0.1, 1), gain: THREE.MathUtils.clamp(v / 8, 0.35, 1.2) });
    this.play(STEP_CUE[s], { gain: 0.7 });
  }

  // Pulls the bed and the score down by `amount` and lets them back over a second.
  duck(amount: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const g of [this.duckBed.gain, this.duckMusic.gain]) {
      const floor = Math.max(0.15, 1 - amount * 0.7);
      g.cancelScheduledValues(t);
      g.setValueAtTime(Math.min(g.value, 1), t);
      g.linearRampToValueAtTime(floor, t + 0.03);
      g.setTargetAtTime(1, t + 0.25 + amount * 0.6, 0.45);
    }
  }

  // Every frame: the listener follows the player, the rooms and the score follow the scene,
  // the other bodies in the compound step where they walk.
  update(raw: number): void {
    const ctx = this.ctx, g = this.game;
    if (!ctx || ctx.state !== 'running' || !this.ambience) return;
    const t = ctx.currentTime;
    const st = appState.value.kind;
    const inWorld = st !== 'title' && st !== 'boot';
    const cam = g.renderer.camera;
    const L = ctx.listener;
    const fwd = new THREE.Vector3();
    let pos: THREE.Vector3;
    if (inWorld) {
      pos = g.player.position.clone().add(new THREE.Vector3(0, 1.6, 0));
      fwd.set(-Math.sin(g.cam.yaw), 0, -Math.cos(g.cam.yaw));
    } else { pos = cam.position.clone(); cam.getWorldDirection(fwd); }
    if (L.positionX) {
      L.positionX.setTargetAtTime(pos.x, t, 0.02); L.positionY.setTargetAtTime(pos.y, t, 0.02); L.positionZ.setTargetAtTime(pos.z, t, 0.02);
      L.forwardX.setTargetAtTime(fwd.x, t, 0.02); L.forwardY.setTargetAtTime(fwd.y, t, 0.02); L.forwardZ.setTargetAtTime(fwd.z, t, 0.02);
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else { L.setPosition(pos.x, pos.y, pos.z); L.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0); }

    const indoors = inWorld ? g.world.indoorsAt(g.player.position) : 0;
    this.hallVerb.gain.setTargetAtTime(indoors * 0.9, t, 0.2);
    this.yardVerb.gain.setTargetAtTime((1 - indoors) * 0.35, t, 0.2);

    const enemies = g.encounters.enemies.some((e) => e.alive && e.def.ai !== 'dummy');
    const clash = g.aura.clash.active;
    const mode: MusicMode = !inWorld ? 'title' : clash ? 'clash' : enemies || st === 'rooftop' ? 'fight' : 'calm';
    this.ambience.update(raw, indoors, mode, mode === 'clash' ? 1 : mode === 'fight' ? 0.75 : 0, g.cutscenes.active ? 1 : 0);

    // The aura field hums while it is open.
    const f = g.aura.field;
    const open = inWorld && f.open;
    this.hum.gain.gain.setTargetAtTime(open ? 0.05 + f.density * 0.06 : 0, t, open ? 0.15 : 0.3);
    this.hum.filter.frequency.setTargetAtTime(open ? 260 + f.density * 900 + Math.sin(t * 2.1) * 60 : 200, t, 0.1);
    this.hum.tone.offset.setTargetAtTime(open ? 92 + f.density * 18 : 92, t, 0.3);

    // Blind (Blink's Maximum Output) or low on health: the world closes in.
    const hpFrac = g.combat.hp / g.combat.maxHp;
    const low = inWorld && hpFrac > 0 && hpFrac < 0.3;
    const want = blinkUi.blind.value > 0 ? 1 : low ? 0.35 : 0;
    this.muffle += (want - this.muffle) * Math.min(1, raw * (want > this.muffle ? 12 : 2));
    this.muffleFilter.frequency.setTargetAtTime(20000 * Math.pow(500 / 20000, this.muffle), t, 0.05);
    if (low && worldRunning() && t >= this.heartAt) { this.play('heartbeat', { gain: 0.6 + (0.3 - hpFrac) * 2 }); this.heartAt = t + 0.6 + hpFrac * 1.6; }

    // The others' footsteps: the same cadence the player's controller uses.
    if (inWorld && worldRunning()) for (const e of g.targets()) {
      if (!e.alive || !e.grounded || e.disposed) continue;
      const speed = Math.hypot(e.velocity.x, e.velocity.z);
      if (speed < 0.6) { this.steps.set(e, 0.25); continue; }
      const prev = this.steps.get(e) ?? 0.25, next = prev + raw * speed * 0.62;
      this.steps.set(e, next);
      if (Math.floor(prev) !== Math.floor(next)) this.play(STEP_CUE[this.bodySurface(e.position)], { at: e.position, gain: 0.8 });
    }
  }

  view(): AudioView {
    const s = settings.value;
    return {
      unlocked: this.unlocked, gestureAt: this.gestureAt, state: this.ctx?.state ?? 'none',
      library: { loaded: this.library.loaded, total: this.library.total, failed: this.library.failed },
      volumes: { master: s.volume, music: s.music, effects: s.effects }, muffle: this.muffle,
      ambience: this.ambience?.view() ?? null, log: this.log.map((e) => ({ ...e })),
    };
  }

  // Renders one cue offline, dry and unplaced, and measures it: how a check
  // hears a cue it cannot listen to (silent means a layer is missing).
  async render(name: CueName): Promise<{ peak: number; rms: number; seconds: number; missing: string[] }> {
    const cue: Cue = CUES[name];
    const rate = 24000, off = new OfflineAudioContext(1, rate * 6, rate);
    const out = off.createGain();
    out.connect(off.destination);
    const missing = cue.layers.flatMap((l) => ('s' in l ? l.s.filter((n) => !this.library.has(n)) : []));
    let seconds = 0;
    for (const layer of cue.layers) seconds = Math.max(seconds, this.layer(off as unknown as AudioContext, out, 0, layer, 1, 1));
    const d = (await off.startRendering()).getChannelData(0);
    const n = Math.min(d.length, Math.max(1, Math.ceil(seconds * rate)));
    let peak = 0, sum = 0;
    for (let i = 0; i < n; i++) { const x = Math.abs(d[i]!); peak = Math.max(peak, x); sum += x * x; }
    return { peak: Math.round(peak * 1000) / 1000, rms: Math.round(Math.sqrt(sum / n) * 10000) / 10000, seconds: round(seconds), missing };
  }

  // A cue another player's wire sent: played at their body unless it names a place.
  replay(name: unknown, at: THREE.Vector3 | null, gain: unknown, pitch: unknown, body: THREE.Vector3): void {
    if (!isCue(name)) return;
    const n = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? THREE.MathUtils.clamp(x, 0, 4) : d);
    this.play(name, { at: at ?? body, gain: n(gain, 1), pitch: n(pitch, 1) || 1, remote: true });
  }

  private bodySurface(p: THREE.Vector3): Surface {
    const inside = (b: { x0: number; x1: number; z0: number; z1: number }) => p.x > b.x0 && p.x < b.x1 && p.z > b.z0 && p.z < b.z1 && p.y < 1.5;
    return surfaceAt(p, inside(HALL) || inside(STORE) ? 'wood' : 'stone');
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const s = settings.value, t = this.ctx.currentTime;
    // Faders are heard logarithmically: a squared slider feels even.
    this.master.gain.setTargetAtTime(s.volume * s.volume, t, 0.03);
    this.musicBus.gain.setTargetAtTime(s.music * s.music, t, 0.03);
    this.worldBus.gain.setTargetAtTime(s.effects * s.effects, t, 0.03);
    this.uiBus.gain.setTargetAtTime(s.effects * s.effects, t, 0.03);
  }

  private panner(at: THREE.Vector3): PannerNode {
    const p = this.ctx!.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = 3;
    p.rolloffFactor = 1.1;
    p.maxDistance = 80;
    p.positionX.value = at.x; p.positionY.value = at.y; p.positionZ.value = at.z;
    return p;
  }

  private layer(ctx: AudioContext, out: AudioNode, t0: number, layer: Layer, pitch: number, weight: number): number {
    const t = t0 + (layer.at ?? 0);
    const scale = layer.w ? 1 - layer.w + layer.w * weight : 1;
    const gain = (layer.gain ?? 1) * scale;
    if (gain <= 0.001) return 0;
    if ('syn' in layer) {
      const v: Voice = { ctx, out, t, gain, pitch: pitch * (layer.pitch ?? 1), noise: (k) => this.noise[k] };
      return (layer.at ?? 0) + SYNTHS[layer.syn](v, layer.p ?? {});
    }
    const ready = layer.s.filter((n) => this.library.has(n));
    const buf = this.library.get(ready[Math.floor(Math.random() * ready.length)] ?? '');
    if (!buf) return 0;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = pitch * (layer.pitch ?? 1) * (1 + (Math.random() * 2 - 1) * (layer.vary ?? 0.03));
    const g = ctx.createGain();
    g.gain.value = gain;
    let node: AudioNode = src;
    if (layer.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = layer.lp; node = node.connect(f); }
    node.connect(g).connect(out);
    src.start(t);
    return (layer.at ?? 0) + buf.duration / src.playbackRate.value;
  }

  private record(e: SoundEvent): void {
    this.log.push(e);
    if (this.log.length > LOG_MAX) this.log.splice(0, this.log.length - LOG_MAX);
  }
}

function worldRunning(): boolean {
  const k = appState.value.kind;
  return k !== 'paused' && k !== 'workshop' && k !== 'title' && k !== 'boot';
}

const round = (x: number): number => Math.round(x * 100) / 100;

// A room's impulse response: a few early reflections, then a noise tail that
// darkens as it dies (high frequencies die first in a real room).
function impulse(ctx: AudioContext, seconds: number, decay: number, pre: number): AudioBuffer {
  const rate = ctx.sampleRate, len = Math.floor(rate * seconds);
  const b = ctx.createBuffer(2, len, rate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const x = i / len;
      const tone = 0.15 + 0.85 * (1 - x);
      lp += ((Math.random() * 2 - 1) - lp) * tone;
      d[i] = i < pre * rate ? 0 : lp * Math.pow(1 - x, decay);
    }
    for (let k = 0; k < 6; k++) {
      const at = Math.floor((pre + 0.008 + k * 0.011 + Math.random() * 0.006) * rate);
      if (at < len) d[at] = (d[at] ?? 0) + (Math.random() < 0.5 ? -1 : 1) * (0.5 - k * 0.06);
    }
  }
  return b;
}
