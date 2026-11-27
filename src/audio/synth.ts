// The synthesized layers: what no recording in the library has. Each voice
// schedules its own nodes at `t` into `out` and lets them stop themselves.
// The recordings carry the physical part of a sound (a fist, a board, ice);
// these carry the energy around it: the air a swing moves, the rise before a
// Maximum Output, the weight under a blow, the ring after it.

export type Noise = 'white' | 'pink' | 'brown';

export interface Voice {
  ctx: AudioContext;
  out: AudioNode;
  t: number;
  gain: number;
  pitch: number;
  noise(kind: Noise): AudioBuffer;
}

export type SynthName = keyof typeof SYNTHS;
export type SynthParams = Partial<Record<string, number>>;

// Two seconds of each colour of noise, made once per context.
export function makeNoise(ctx: AudioContext): Record<Noise, AudioBuffer> {
  const len = ctx.sampleRate * 2;
  const make = (fill: (d: Float32Array) => void): AudioBuffer => { const b = ctx.createBuffer(1, len, ctx.sampleRate); fill(b.getChannelData(0)); return b; };
  return {
    white: make((d) => { for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }),
    pink: make((d) => {
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
    }),
    brown: make((d) => { let last = 0; for (let i = 0; i < d.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; } }),
  };
}

const EPS = 0.0001;

function noiseSource(v: Voice, kind: Noise, dur: number): AudioBufferSourceNode {
  const s = v.ctx.createBufferSource();
  s.buffer = v.noise(kind);
  s.loop = true;
  s.start(v.t, Math.random() * 1.5);
  s.stop(v.t + dur + 0.05);
  return s;
}

function osc(v: Voice, type: OscillatorType, f: number, dur: number): OscillatorNode {
  const o = v.ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f * v.pitch, v.t);
  o.start(v.t);
  o.stop(v.t + dur + 0.05);
  return o;
}

function filter(v: Voice, type: BiquadFilterType, f: number, q = 0.7): BiquadFilterNode {
  const b = v.ctx.createBiquadFilter();
  b.type = type;
  b.frequency.setValueAtTime(f, v.t);
  b.Q.value = q;
  return b;
}

// A percussive envelope: up in `attack`, down exponentially by `t + dur`.
function hit(v: Voice, peak: number, attack: number, dur: number): GainNode {
  const g = v.ctx.createGain();
  g.gain.setValueAtTime(EPS, v.t);
  g.gain.linearRampToValueAtTime(peak * v.gain, v.t + attack);
  g.gain.exponentialRampToValueAtTime(EPS, v.t + Math.max(attack + 0.01, dur));
  g.connect(v.out);
  return g;
}

// A swell: rises the whole length and cuts at the end, the shape of anticipation.
function swell(v: Voice, peak: number, dur: number, cut = 0.04): GainNode {
  const g = v.ctx.createGain();
  g.gain.setValueAtTime(EPS, v.t);
  g.gain.exponentialRampToValueAtTime(peak * v.gain, v.t + dur);
  g.gain.linearRampToValueAtTime(0, v.t + dur + cut);
  g.connect(v.out);
  return g;
}

const n = (p: SynthParams, k: string, d: number): number => p[k] ?? d;

export const SYNTHS = {
  // Air moved by a limb or a body: band-passed noise sweeping up and back.
  whoosh(v: Voice, p: SynthParams): number {
    const dur = n(p, 'dur', 0.3), f0 = n(p, 'f0', 300) * v.pitch, f1 = n(p, 'f1', 1800) * v.pitch, peakAt = n(p, 'peak', 0.55);
    const src = noiseSource(v, 'pink', dur);
    const bp = filter(v, 'bandpass', f0, n(p, 'q', 1.1));
    bp.frequency.exponentialRampToValueAtTime(f1, v.t + dur * peakAt);
    bp.frequency.exponentialRampToValueAtTime(Math.max(80, f0 * 0.7), v.t + dur);
    const g = v.ctx.createGain();
    g.gain.setValueAtTime(EPS, v.t);
    g.gain.exponentialRampToValueAtTime(n(p, 'gain', 0.8) * v.gain, v.t + dur * peakAt);
    g.gain.exponentialRampToValueAtTime(EPS, v.t + dur);
    g.connect(v.out);
    src.connect(bp).connect(g);
    return dur;
  },
  // The weight under a blow: a sine that drops in pitch as it dies.
  boom(v: Voice, p: SynthParams): number {
    const dur = n(p, 'dur', 0.7);
    const o = osc(v, 'sine', n(p, 'f0', 110), dur);
    o.frequency.exponentialRampToValueAtTime(n(p, 'f1', 36) * v.pitch, v.t + dur * 0.6);
    o.connect(hit(v, n(p, 'gain', 1), 0.004, dur));
    // A little second harmonic so it reads on small speakers.
    const o2 = osc(v, 'triangle', n(p, 'f0', 110) * 2, dur * 0.4);
    o2.frequency.exponentialRampToValueAtTime(n(p, 'f1', 36) * 2 * v.pitch, v.t + dur * 0.3);
    o2.connect(hit(v, n(p, 'gain', 1) * 0.25, 0.004, dur * 0.4));
    return dur;
  },
  // The front edge of an impact: a bright noise snap.
  crack(v: Voice, p: SynthParams): number {
    const dur = n(p, 'dur', 0.08);
    const src = noiseSource(v, 'white', dur);
    src.connect(filter(v, 'highpass', n(p, 'hp', 1800) * v.pitch, 0.8)).connect(hit(v, n(p, 'gain', 0.7), 0.001, dur));
    return dur;
  },
  // Debris and the ground answering: low brown noise with a long tail.
  rumble(v: Voice, p: SynthParams): number {
    const dur = n(p, 'dur', 1.2);
    const src = noiseSource(v, 'brown', dur);
    const lp = filter(v, 'lowpass', n(p, 'lp', 260) * v.pitch, 0.9);
    lp.frequency.exponentialRampToValueAtTime(Math.max(40, n(p, 'lp', 260) * 0.35), v.t + dur);
    src.connect(lp).connect(hit(v, n(p, 'gain', 0.9), n(p, 'attack', 0.01), dur));
    return dur;
  },
  // Anticipation: noise and a low saw climbing through a filter, cut at the top.
  riser(v: Voice, p: SynthParams): number {
    const dur = n(p, 'dur', 1), f0 = n(p, 'f0', 180) * v.pitch, f1 = n(p, 'f1', 3200) * v.pitch;
    const src = noiseSource(v, 'pink', dur);
    const bp = filter(v, 'bandpass', f0, n(p, 'q', 3));
    bp.frequency.exponentialRampToValueAtTime(f1, v.t + dur);
    const g = swell(v, n(p, 'gain', 0.7), dur, n(p, 'cut', 0.05));
    src.connect(bp).connect(g);
    const tone = n(p, 'tone', 0.35);
    if (tone > 0) {
      const o = osc(v, 'sawtooth', f0 / 2, dur);
      o.frequency.exponentialRampToValueAtTime(f1 / 6, v.t + dur);
      const lp = filter(v, 'lowpass', f0 * 2, 2);
      lp.frequency.exponentialRampToValueAtTime(f1, v.t + dur);
      const og = v.ctx.createGain();
      og.gain.value = tone;
      o.connect(lp).connect(og).connect(g);
    }
    return dur + 0.05;
  },
  // A breath drawn in before the blow: a short reversed swell, dark to bright.
  inhale(v: Voice, p: SynthParams): number {
    const dur = n(p, 'dur', 0.45);
    const src = noiseSource(v, 'white', dur);
    const lp = filter(v, 'lowpass', 300 * v.pitch, 1.4);
    lp.frequency.exponentialRampToValueAtTime(n(p, 'f1', 7000) * v.pitch, v.t + dur);
    src.connect(lp).connect(swell(v, n(p, 'gain', 0.6), dur, 0.02));
    return dur;
  },
  // A struck bell or a ringing body: inharmonic sine partials, each dying at its own rate.
  shimmer(v: Voice, p: SynthParams): number {
    const dur = n(p, 'dur', 1.6), f = n(p, 'f', 880);
    const ratios = [1, 2.76, 5.4, 8.93];
    ratios.forEach((r, i) => {
      const o = osc(v, 'sine', f * r * (1 + (Math.random() - 0.5) * 0.004), dur);
      o.connect(hit(v, n(p, 'gain', 0.4) / (i + 1), 0.003, dur / (1 + i * 0.6)));
    });
    return dur;
  },
  // Ice forming: a scatter of tiny high pings.
  tinkle(v: Voice, p: SynthParams): number {
    const count = n(p, 'count', 7), spread = n(p, 'spread', 0.3), lo = n(p, 'lo', 2600), hi = n(p, 'hi', 7200);
    for (let i = 0; i < count; i++) {
      const t = v.t + Math.random() * spread;
      const o = v.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = (lo + Math.random() * (hi - lo)) * v.pitch;
      const g = v.ctx.createGain();
      const peak = n(p, 'gain', 0.18) * v.gain * (0.4 + Math.random() * 0.6);
      g.gain.setValueAtTime(EPS, t);
      g.gain.linearRampToValueAtTime(peak, t + 0.002);
      g.gain.exponentialRampToValueAtTime(EPS, t + 0.05 + Math.random() * 0.12);
      o.connect(g).connect(v.out);
      o.start(t);
      o.stop(t + 0.2);
    }
    return spread + 0.2;
  },
  // A plain tone with an optional glide, for chimes, whines and stings.
  tone(v: Voice, p: SynthParams): number {
    const dur = n(p, 'dur', 0.4);
    const types: OscillatorType[] = ['sine', 'triangle', 'square', 'sawtooth'];
    const o = osc(v, types[n(p, 'type', 0)] ?? 'sine', n(p, 'f', 440), dur);
    if (p.glide) o.frequency.exponentialRampToValueAtTime(p.glide * v.pitch, v.t + dur);
    const out = hit(v, n(p, 'gain', 0.3), n(p, 'attack', 0.005), dur);
    if (p.lp) o.connect(filter(v, 'lowpass', p.lp, 0.7)).connect(out); else o.connect(out);
    return dur;
  },
  // A body hitting the ground or a fist landing: a short low thump.
  thud(v: Voice, p: SynthParams): number {
    const dur = n(p, 'dur', 0.16);
    const o = osc(v, 'sine', n(p, 'f', 90), dur);
    o.frequency.exponentialRampToValueAtTime(n(p, 'f', 90) * 0.5 * v.pitch, v.t + dur);
    o.connect(hit(v, n(p, 'gain', 0.8), 0.002, dur));
    const src = noiseSource(v, 'brown', 0.05);
    src.connect(filter(v, 'lowpass', 900, 0.7)).connect(hit(v, n(p, 'gain', 0.8) * 0.5, 0.001, 0.05));
    return dur;
  },
  // Space folding: an FM sweep, for Shift's translations.
  warp(v: Voice, p: SynthParams): number {
    const dur = n(p, 'dur', 0.3), f0 = n(p, 'f0', 900), f1 = n(p, 'f1', 160);
    const car = osc(v, 'sine', f0, dur);
    car.frequency.exponentialRampToValueAtTime(f1 * v.pitch, v.t + dur);
    const mod = osc(v, 'sine', f0 * 1.5, dur);
    mod.frequency.exponentialRampToValueAtTime(f1 * 1.5 * v.pitch, v.t + dur);
    const mg = v.ctx.createGain();
    mg.gain.setValueAtTime(f0 * 1.2, v.t);
    mg.gain.exponentialRampToValueAtTime(Math.max(1, f1 * 0.3), v.t + dur);
    mod.connect(mg).connect(car.frequency);
    car.connect(hit(v, n(p, 'gain', 0.3), 0.004, dur));
    return dur;
  },
  // A blade or a displacement opening the air: a fast bright tear.
  tear(v: Voice, p: SynthParams): number {
    const dur = n(p, 'dur', 0.14);
    const src = noiseSource(v, 'white', dur);
    const bp = filter(v, 'bandpass', 1800 * v.pitch, 2.5);
    bp.frequency.exponentialRampToValueAtTime(9000 * v.pitch, v.t + dur * 0.7);
    src.connect(bp).connect(hit(v, n(p, 'gain', 0.6), 0.004, dur));
    return dur;
  },
  // Heat meeting water or skin: a high hiss with a crackle of pops in it.
  // `hp` sets how high it hisses (lower is a fire's roar), `pops` how many pops.
  sizzle(v: Voice, p: SynthParams): number {
    const dur = n(p, 'dur', 0.8);
    const src = noiseSource(v, 'white', dur);
    const hp = filter(v, 'highpass', n(p, 'hp', 3500) * v.pitch, 0.7);
    const crackle = v.ctx.createGain();
    crackle.gain.setValueAtTime(0.55, v.t);
    const pops = Math.round(n(p, 'pops', dur * 28));
    const times = Array.from({ length: pops }, () => v.t + Math.random() * dur).sort((a, b) => a - b);
    for (const t of times) { crackle.gain.setValueAtTime(0.55 + Math.random() * 1.4, t); crackle.gain.setTargetAtTime(0.5, t + 0.001, 0.005); }
    src.connect(hp).connect(crackle).connect(hit(v, n(p, 'gain', 0.4), n(p, 'attack', 0.015), dur));
    return dur;
  },
  // Water: a slap of noise and a couple of bubbles.
  splash(v: Voice, p: SynthParams): number {
    const size = n(p, 'size', 1);
    const src = noiseSource(v, 'white', 0.25 * size);
    const bp = filter(v, 'bandpass', (700 + Math.random() * 600) * v.pitch, 1.2);
    bp.frequency.exponentialRampToValueAtTime(300, v.t + 0.22 * size);
    src.connect(bp).connect(hit(v, n(p, 'gain', 0.6), 0.004, 0.22 * size));
    const bubbles = Math.round(n(p, 'bubbles', 2));
    for (let i = 0; i < bubbles; i++) SYNTHS.bubble({ ...v, t: v.t + 0.03 + Math.random() * 0.15 * size, gain: v.gain * 0.5 }, { f: 500 + Math.random() * 700 });
    return 0.3 * size;
  },
  // One bubble: a sine that rises as it rings, the way a bubble's pitch does.
  bubble(v: Voice, p: SynthParams): number {
    const f = n(p, 'f', 700), dur = n(p, 'dur', 0.06 + Math.random() * 0.04);
    const o = osc(v, 'sine', f, dur);
    o.frequency.exponentialRampToValueAtTime(f * 2.4 * v.pitch, v.t + dur);
    o.connect(hit(v, n(p, 'gain', 0.25), 0.003, dur));
    return dur;
  },
  // The hyoshigi: two wooden clappers, the drill's cue.
  clack(v: Voice, p: SynthParams): number {
    const f = n(p, 'f', 1900), gap = n(p, 'gap', 0);
    const strikes: [number, number][] = gap > 0 ? [[0, 1], [gap, 0.6]] : [[0, 1]];
    for (const [dt, k] of strikes) {
      const t = v.t + dt;
      const src = v.ctx.createBufferSource();
      src.buffer = v.noise('white');
      const bp = v.ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = f * v.pitch; bp.Q.value = 9;
      const g = v.ctx.createGain();
      g.gain.setValueAtTime(EPS, t);
      g.gain.linearRampToValueAtTime(n(p, 'gain', 1.4) * k * v.gain, t + 0.001);
      g.gain.exponentialRampToValueAtTime(EPS, t + 0.07);
      src.connect(bp).connect(g).connect(v.out);
      src.start(t, Math.random()); src.stop(t + 0.1);
    }
    return gap + 0.1;
  },
  // A taiko: a skin's pitch drop and a stick's slap.
  taiko(v: Voice, p: SynthParams): number {
    const dur = n(p, 'dur', 0.7), f = n(p, 'f', 120);
    const o = osc(v, 'sine', f * 1.5, dur);
    o.frequency.exponentialRampToValueAtTime(f * 0.6 * v.pitch, v.t + 0.12);
    o.connect(hit(v, n(p, 'gain', 0.9), 0.002, dur));
    const src = noiseSource(v, 'pink', 0.12);
    src.connect(filter(v, 'lowpass', 1400, 0.7)).connect(hit(v, n(p, 'gain', 0.9) * 0.35, 0.001, 0.1));
    return dur;
  },
  // A plucked string (Karplus-Strong), for the koto in the score and the chimes.
  pluck(v: Voice, p: SynthParams): number {
    const f = n(p, 'f', 293.66) * v.pitch, dur = n(p, 'dur', 2.2);
    const s = v.ctx.createBufferSource();
    s.buffer = pluckBuffer(v.ctx, f, dur, n(p, 'bright', 0.5));
    s.connect(hit(v, n(p, 'gain', 0.35), 0.001, dur));
    s.start(v.t);
    return dur;
  },
  // A current jumping a gap: a burst of hard white clicks at uneven
  // intervals, each a few milliseconds, bright and dry, thinning out.
  zap(v: Voice, p: SynthParams): number {
    const dur = n(p, 'dur', 0.25), count = n(p, 'count', 14), hp = n(p, 'hp', 2400);
    for (let i = 0; i < count; i++) {
      // Bunched at the front, the way a spark's crackle is.
      const t = v.t + dur * Math.pow(Math.random(), 1.8);
      const src = v.ctx.createBufferSource();
      src.buffer = v.noise('white');
      const f = v.ctx.createBiquadFilter();
      f.type = 'highpass'; f.frequency.value = hp * v.pitch * (0.7 + Math.random() * 0.8);
      const g = v.ctx.createGain();
      const peak = n(p, 'gain', 0.6) * v.gain * (0.3 + Math.random() * 0.7) * (1 - (t - v.t) / (dur * 1.4));
      g.gain.setValueAtTime(EPS, t);
      g.gain.linearRampToValueAtTime(Math.max(EPS * 2, peak), t + 0.0008);
      g.gain.exponentialRampToValueAtTime(EPS, t + 0.004 + Math.random() * 0.012);
      src.connect(f).connect(g).connect(v.out);
      src.start(t, Math.random() * 1.5); src.stop(t + 0.03);
    }
    return dur + 0.03;
  },
  // A live current held: a buzzing square at a low hum, rasped through a
  // narrow band that wanders, the sound a charged wire makes.
  buzz(v: Voice, p: SynthParams): number {
    const dur = n(p, 'dur', 0.6), f = n(p, 'f', 100);
    const o = osc(v, 'square', f, dur);
    const o2 = osc(v, 'sawtooth', f * 1.505, dur);
    const bp = filter(v, 'bandpass', n(p, 'band', 1600) * v.pitch, 3);
    bp.frequency.linearRampToValueAtTime(n(p, 'band', 1600) * v.pitch * (0.6 + Math.random() * 0.8), v.t + dur);
    const out = hit(v, n(p, 'gain', 0.3), n(p, 'attack', 0.02), dur);
    o.connect(bp); o2.connect(bp);
    bp.connect(out);
    return dur;
  },
  // A heartbeat, under the mix when health runs low.
  heartbeat(v: Voice, p: SynthParams): number {
    SYNTHS.thud(v, { f: 62, dur: 0.14, gain: n(p, 'gain', 0.7) });
    SYNTHS.thud({ ...v, t: v.t + 0.2 }, { f: 52, dur: 0.18, gain: n(p, 'gain', 0.7) * 0.75 });
    return 0.45;
  },
  // A wire plucked under load, Tension's voice: a plucked string whose pitch
  // bends as the load comes on (`bend` below 1 rises to the note) or goes
  // off (above 1 falls to it) over `bendDur`.
  twang(v: Voice, p: SynthParams): number {
    const f = n(p, 'f', 196) * v.pitch, dur = n(p, 'dur', 0.9);
    const s = v.ctx.createBufferSource();
    s.buffer = pluckBuffer(v.ctx, f, dur, n(p, 'bright', 0.8));
    s.playbackRate.setValueAtTime(n(p, 'bend', 1), v.t);
    s.playbackRate.exponentialRampToValueAtTime(1, v.t + n(p, 'bendDur', 0.12));
    s.connect(hit(v, n(p, 'gain', 0.5), 0.001, dur));
    s.start(v.t);
    return dur;
  },
} satisfies Record<string, (v: Voice, p: SynthParams) => number>;

const plucks = new Map<string, AudioBuffer>();
function pluckBuffer(ctx: AudioContext, f: number, dur: number, bright: number): AudioBuffer {
  const key = `${Math.round(f * 10)}:${dur}:${bright}`;
  const hitBuf = plucks.get(key);
  if (hitBuf) return hitBuf;
  const len = Math.floor(ctx.sampleRate * dur);
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  const period = Math.max(2, Math.round(ctx.sampleRate / f));
  const ring = new Float32Array(period);
  for (let i = 0; i < period; i++) ring[i] = Math.random() * 2 - 1;
  const damp = 0.4985 + bright * 0.0013;
  for (let i = 0; i < len; i++) {
    const j = i % period;
    const next = ring[(j + 1) % period]!;
    const out = ring[j]!;
    ring[j] = (out + next) * damp;
    d[i] = out;
  }
  if (plucks.size > 64) plucks.clear();
  plucks.set(key, b);
  return b;
}
