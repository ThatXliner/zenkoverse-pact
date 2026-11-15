import { POND } from '../world/compound';
import { FALLS, WATER_Y } from '../world/valleyPlan';
import { SYNTHS, type Noise, type Voice } from './synth';
import type { Library } from './library';

// The compound at dusk, and the score over it. The bed is built from the
// same noise and oscillators as the cues and runs for as long as the game
// does: wind that breathes and gusts through the leaves, a bird now
// and then, the pond lapping where it is (a point source, so it swells as you
// walk up to it), a temple bell far off. Under a roof the outside is heard
// through the walls (low-passed and quieter) and the hall's own room tone
// and creaking boards come up. Out of the gate the valley opens: the wind
// is fuller, the grass hisses under it, birds call more often, the stream
// runs along its bed (heard from its nearest stretch) and the falls roar at
// the north cliff.
//
// The score is sparse on purpose: a low drone, a koto that plays a phrase
// every so often in the In scale while the compound is calm, and taiko that
// come in under a fight and pick up in a clash.

export type MusicMode = 'title' | 'calm' | 'fight' | 'clash';

export interface AmbienceView {
  indoors: number;
  mode: MusicMode;
  open: number;
  layers: Record<'wind' | 'leaves' | 'pond' | 'room' | 'drone' | 'taiko' | 'grass' | 'stream' | 'falls', number>;
  events: { birds: number; bells: number; creaks: number; koto: number; taiko: number };
}

// Writes a per-frame level only when it has moved.
export function put(p: AudioParam, v: number): void {
  if (Math.abs(p.value - v) > Math.abs(v) * 0.002 + 1e-5) p.value = v;
}

// D In scale (D Eb G A Bb), across two octaves.
const KOTO = [293.66, 311.13, 392.0, 440.0, 466.16, 587.33, 622.25, 783.99];

export class Ambience {
  private outside: GainNode;
  private outsideFilter: BiquadFilterNode;
  private wind: GainNode;
  private windFilter: BiquadFilterNode;
  private leaves: GainNode;
  private room: GainNode;
  private pond: GainNode;
  private pondPanner: PannerNode;
  private drone: GainNode;
  private taikoBus: GainNode;
  private grass: GainNode;
  private stream: GainNode;
  private streamPanner: PannerNode;
  private falls: GainNode;
  private fallsPanner: PannerNode;
  private indoors = 0;
  private open = 0;
  private gust = 0;
  private gustTarget = 0;
  private nextGust = 0;
  private nextBird = 0;
  private nextBell = 0;
  private nextCreak = 0;
  private nextBubble = 0;
  private nextKoto = 0;
  private nextTaiko = 0;
  private taikoStep = 0;
  private fight = 0;
  private hush = 0;
  private drone_ = 0;
  mode: MusicMode = 'title';
  readonly counts = { birds: 0, bells: 0, creaks: 0, koto: 0, taiko: 0 };

  constructor(private ctx: AudioContext, bed: AudioNode, private music: AudioNode, private noise: (k: Noise) => AudioBuffer, private library: Library) {
    const now = ctx.currentTime;
    // Everything outdoors goes through one filter the walls close down.
    this.outsideFilter = ctx.createBiquadFilter();
    this.outsideFilter.type = 'lowpass';
    this.outsideFilter.frequency.value = 18000;
    this.outside = ctx.createGain();
    this.outsideFilter.connect(this.outside).connect(bed);

    // Wind: brown noise through a low-pass whose cutoff breathes; gusts open it further.
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 500;
    this.windFilter.Q.value = 0.6;
    this.wind = ctx.createGain();
    this.wind.gain.value = 0.11;
    this.loop('brown', 2).connect(this.windFilter).connect(this.wind).connect(this.outsideFilter);
    this.lfo(0.07, 180, this.windFilter.frequency);

    // Leaves: high pink noise that only speaks in a gust.
    const leafHp = ctx.createBiquadFilter();
    leafHp.type = 'highpass';
    leafHp.frequency.value = 2800;
    this.leaves = ctx.createGain();
    this.leaves.gain.value = 0;
    this.loop('pink', 2).connect(leafHp).connect(this.leaves).connect(this.outsideFilter);

    // The pond: low lapping where the pond is.
    this.pondPanner = ctx.createPanner();
    this.pondPanner.panningModel = 'equalpower';
    this.pondPanner.distanceModel = 'inverse';
    this.pondPanner.refDistance = 2.5;
    this.pondPanner.rolloffFactor = 1.6;
    this.pondPanner.maxDistance = 60;
    this.pondPanner.positionX.value = POND.center.x;
    this.pondPanner.positionY.value = POND.surfaceY;
    this.pondPanner.positionZ.value = POND.center.z;
    this.pondPanner.connect(this.outsideFilter);
    const lapBp = ctx.createBiquadFilter();
    lapBp.type = 'bandpass'; lapBp.frequency.value = 420; lapBp.Q.value = 0.8;
    this.lfo(0.31, 160, lapBp.frequency);
    this.pond = ctx.createGain();
    this.pond.gain.value = 0.16;
    const lapAm = ctx.createGain(); lapAm.gain.value = 0.6;
    this.lfo(0.45, 0.4, lapAm.gain);
    this.loop('pink', 2).connect(lapBp).connect(lapAm).connect(this.pond).connect(this.pondPanner);

    // The valley: grass hissing in the wind, out past the walls only.
    const grassBp = ctx.createBiquadFilter();
    grassBp.type = 'bandpass'; grassBp.frequency.value = 3600; grassBp.Q.value = 0.5;
    this.grass = ctx.createGain();
    this.grass.gain.value = 0;
    this.loop('pink', 2).connect(grassBp).connect(this.grass).connect(this.outsideFilter);
    // The stream: a bright ripple, placed each frame at its nearest stretch.
    this.streamPanner = this.placed(3, 1.3, 70);
    const ripple = ctx.createBiquadFilter();
    ripple.type = 'bandpass'; ripple.frequency.value = 1100; ripple.Q.value = 0.7;
    this.lfo(0.23, 380, ripple.frequency);
    const rippleAm = ctx.createGain(); rippleAm.gain.value = 0.7;
    this.lfo(1.7, 0.3, rippleAm.gain);
    this.stream = ctx.createGain();
    this.stream.gain.value = 0.2;
    this.loop('pink', 2).connect(ripple).connect(rippleAm).connect(this.stream).connect(this.streamPanner);
    // The falls: a steady low roar where the water lands.
    const fallsPanner = this.fallsPanner = this.placed(7, 1.1, 220);
    fallsPanner.positionX.value = FALLS.x; fallsPanner.positionY.value = WATER_Y + 2; fallsPanner.positionZ.value = -51.2;
    const roar = ctx.createBiquadFilter();
    roar.type = 'lowpass'; roar.frequency.value = 1700;
    this.falls = ctx.createGain();
    this.falls.gain.value = 0.42;
    this.loop('pink', 1.4).connect(roar).connect(this.falls).connect(fallsPanner);
    this.loop('brown', 2).connect(this.falls);

    // Indoors: room tone, a little mains hum, and the boards.
    this.room = ctx.createGain();
    this.room.gain.value = 0;
    this.room.connect(bed);
    const roomLp = ctx.createBiquadFilter();
    roomLp.type = 'lowpass'; roomLp.frequency.value = 160;
    this.loop('brown', 2).connect(roomLp).connect(this.room);

    // The score.
    this.drone = ctx.createGain();
    this.drone.gain.value = 0;
    this.drone.connect(music);
    for (const [f, type, level] of [[73.42, 'sine', 1], [110, 'triangle', 0.5], [146.83, 'sine', 0.25]] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      this.lfo(0.05 + Math.random() * 0.05, 5, o.detune);
      const g = ctx.createGain();
      g.gain.value = level * 0.05;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 500;
      o.connect(lp).connect(g).connect(this.drone);
      o.start(now);
    }
    this.taikoBus = ctx.createGain();
    this.taikoBus.gain.value = 0;
    this.taikoBus.connect(music);

    this.nextGust = now + 3;
    this.nextBird = now + 4 + Math.random() * 6;
    this.nextBell = now + 20 + Math.random() * 20;
    this.nextCreak = now + 4;
    this.nextBubble = now + 2;
    this.nextKoto = now + 3;
    this.nextTaiko = now;
  }

  // `hush` (0 to 1) holds the bed and the drone down while a cutscene plays.
  // `open` (0 to 1) is how far out of the walls the listener stands, and
  // `stream` the nearest point of the stream to them.
  // Every level here is smoothed in JS and written straight to its param
  // (`put`), never scheduled: an automation event a frame piles up.
  update(dt: number, indoors: number, mode: MusicMode, fight: number, hush = 0, open = 0, stream?: { x: number; y: number; z: number }): void {
    const ctx = this.ctx, now = ctx.currentTime;
    const k = (rate: number) => Math.min(1, dt * rate);
    this.mode = mode;
    this.indoors += (indoors - this.indoors) * k(3);
    this.open += (open - this.open) * k(1.5);
    if (stream) { put(this.streamPanner.positionX, stream.x); put(this.streamPanner.positionY, stream.y); put(this.streamPanner.positionZ, stream.z); }
    this.hush += (hush - this.hush) * k(4);
    const i = this.indoors, quiet = 1 - this.hush * 0.75;
    put(this.outsideFilter.frequency, 18000 * Math.pow(650 / 18000, i));
    put(this.outside.gain, (1 - i * 0.62) * quiet);
    put(this.room.gain, i * 0.11 * quiet);

    // Gusts: every few seconds the wind rises for a while and the leaves answer.
    if (now >= this.nextGust) { this.gustTarget = this.gustTarget > 0.2 ? 0 : 0.4 + Math.random() * 0.6; this.nextGust = now + (this.gustTarget > 0 ? 2.5 + Math.random() * 3 : 5 + Math.random() * 9); }
    this.gust += (this.gustTarget - this.gust) * k(0.6);
    const o = this.open;
    put(this.wind.gain, (0.09 + this.gust * 0.11) * (1 + o * 0.35));
    put(this.windFilter.Q, 0.6 + this.gust * 0.5);
    put(this.leaves.gain, this.gust * this.gust * 0.05);
    put(this.grass.gain, o * (0.012 + this.gust * 0.03));

    // The occasional things: a bird (not in a fight), the distant bell, a bubble, a board.
    if (now >= this.nextBird) { if (fight < 0.3) this.bird(now); this.nextBird = now + (6 + Math.random() * 14) * (1 - this.open * 0.5); }
    if (now >= this.nextBell) { this.bell(now); this.nextBell = now + 45 + Math.random() * 40; }
    if (now >= this.nextBubble) { SYNTHS.bubble(this.voice(this.pondPanner, now, 0.4), { f: 350 + Math.random() * 500 }); this.nextBubble = now + 0.6 + Math.random() * 3.5; }
    if (now >= this.nextCreak) { if (i > 0.5) this.creak(now); this.nextCreak = now + 5 + Math.random() * 10; }

    // The score: a drone always (lower in a fight, under the drums), koto when calm, taiko when not.
    this.fight += (fight - this.fight) * k(0.8);
    const f = this.fight;
    this.drone_ += ((mode === 'title' ? 0.9 : 0.7 - f * 0.3) * quiet - this.drone_) * k(2);
    put(this.drone.gain, this.drone_);
    put(this.taikoBus.gain, f);
    if (now >= this.nextKoto) { if (f < 0.4) this.koto(now, mode); this.nextKoto = now + (mode === 'title' ? 5 : 9) + Math.random() * 10; }
    // Taiko: scheduled a little ahead on the audio clock so frame jitter never shows.
    if (f > 0.02) {
      const beat = mode === 'clash' ? 0.33 : 0.42;
      while (this.nextTaiko < now + 0.25) {
        if (this.nextTaiko >= now - 0.05) this.taiko(this.nextTaiko, this.taikoStep, mode);
        this.nextTaiko += beat;
        this.taikoStep = (this.taikoStep + 1) % 16;
      }
    } else this.nextTaiko = now;
  }

  view(): AmbienceView {
    const g = (n: GainNode) => Math.round(n.gain.value * 1000) / 1000;
    return {
      indoors: this.indoors, open: this.open, mode: this.mode,
      layers: { wind: g(this.wind) * g(this.outside), leaves: g(this.leaves) * g(this.outside), pond: g(this.pond) * g(this.outside), room: g(this.room), drone: g(this.drone), taiko: g(this.taikoBus), grass: g(this.grass) * g(this.outside), stream: g(this.stream) * g(this.outside), falls: g(this.falls) * g(this.outside) },
      events: { ...this.counts },
    };
  }

  // What the listener hears of the placed sources, by distance: the stream
  // and the falls (for the checks, which cannot listen).
  heard(listener: { x: number; y: number; z: number }): { stream: number; falls: number } {
    const at = (p: PannerNode) => Math.hypot(p.positionX.value - listener.x, p.positionY.value - listener.y, p.positionZ.value - listener.z);
    const fall = (p: PannerNode, d: number) => p.refDistance / (p.refDistance + p.rolloffFactor * (Math.max(d, p.refDistance) - p.refDistance));
    return { stream: Math.round(this.stream.gain.value * fall(this.streamPanner, at(this.streamPanner)) * 1000) / 1000, falls: Math.round(this.falls.gain.value * fall(this.fallsPanner, at(this.fallsPanner)) * 1000) / 1000 };
  }

  // A point source on the outdoor bus that fades with distance.
  private placed(ref: number, rolloff: number, max: number): PannerNode {
    const p = this.ctx.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.rolloffFactor = rolloff;
    p.maxDistance = max;
    p.connect(this.outsideFilter);
    return p;
  }

  private voice(out: AudioNode, t: number, gain: number, pitch = 1): Voice {
    return { ctx: this.ctx, out, t, gain, pitch, noise: this.noise };
  }

  private loop(kind: Noise, rate: number): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise(kind);
    s.loop = true;
    s.playbackRate.value = rate / 2 + 0.5;
    s.start(this.ctx.currentTime, Math.random());
    return s;
  }

  private lfo(freq: number, depth: number, target: AudioParam, type: OscillatorType = 'sine'): void {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.value = depth;
    o.connect(g).connect(target);
    o.start(this.ctx.currentTime);
  }

  // A small bird somewhere in the trees: two to four quick falling-rising notes.
  private bird(now: number): void {
    this.counts.birds++;
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.random() * 1.6 - 0.8;
    p.connect(this.outsideFilter);
    const base = 2600 + Math.random() * 1800;
    const notes = 2 + Math.floor(Math.random() * 3);
    for (let k = 0; k < notes; k++) {
      const t = now + k * (0.09 + Math.random() * 0.05);
      SYNTHS.tone(this.voice(p, t, 1), { f: base * (1 + Math.random() * 0.2), glide: base * (k % 2 ? 1.35 : 0.8), dur: 0.07 + Math.random() * 0.05, gain: 0.025, attack: 0.01 });
    }
  }

  private bell(now: number): void {
    this.counts.bells++;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 1400;
    lp.connect(this.outsideFilter);
    const b = this.library.get('impactBell_heavy_000');
    if (b) {
      const s = this.ctx.createBufferSource();
      s.buffer = b; s.playbackRate.value = 0.32;
      const g = this.ctx.createGain(); g.gain.value = 0.08;
      s.connect(g).connect(lp); s.start(now);
    }
    SYNTHS.shimmer(this.voice(lp, now, 1), { f: 146.83, dur: 6, gain: 0.05 });
  }

  private creak(now: number): void {
    const names = ['creak1', 'creak2', 'creak3'].filter((n) => this.library.has(n));
    const b = this.library.get(names[Math.floor(Math.random() * names.length)] ?? '');
    if (!b) return;
    this.counts.creaks++;
    const s = this.ctx.createBufferSource();
    s.buffer = b; s.playbackRate.value = 0.8 + Math.random() * 0.3;
    const g = this.ctx.createGain(); g.gain.value = 0.05 + Math.random() * 0.05;
    const p = this.ctx.createStereoPanner(); p.pan.value = Math.random() * 1.4 - 0.7;
    s.connect(g).connect(p).connect(this.room); s.start(now);
  }

  // A short koto phrase: three to five notes of the scale, walking, with a long last one.
  private koto(now: number, mode: MusicMode): void {
    this.counts.koto++;
    const n = 3 + Math.floor(Math.random() * 3);
    let k = Math.floor(Math.random() * 5);
    let t = now;
    for (let j = 0; j < n; j++) {
      const last = j === n - 1;
      SYNTHS.pluck(this.voice(this.music, t, 1), { f: KOTO[k]!, dur: last ? 3 : 1.6, gain: mode === 'title' ? 0.12 : 0.085, bright: 0.6 });
      t += last ? 0 : [0.28, 0.42, 0.56][Math.floor(Math.random() * 3)]!;
      k = Math.max(0, Math.min(KOTO.length - 1, k + (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 2))));
    }
  }

  // Sixteen steps: the big drum on the downbeats, the small one between, busier in a clash.
  private taiko(t: number, step: number, mode: MusicMode): void {
    const big = step % 8 === 0 || step % 8 === 3 || step % 8 === 6;
    const small = mode === 'clash' ? step % 2 === 1 : step === 14 || step === 15 || step === 11;
    if (!big && !small) return;
    this.counts.taiko++;
    if (big) SYNTHS.taiko(this.voice(this.taikoBus, t, 1), { f: 78, dur: 0.9, gain: 0.32 });
    if (small) SYNTHS.taiko(this.voice(this.taikoBus, t, 1), { f: 190, dur: 0.25, gain: 0.12 });
  }
}
