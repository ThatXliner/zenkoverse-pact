// Synthesized sound: no audio files to load.
let ctx = null;
let master = null;
let noiseBuf = null;

export function initAudio() {
  if (ctx) { ctx.resume(); return; }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  startRain();
}

export function setMuted(m) { if (master) master.gain.value = m ? 0 : 0.5; }

function startRain() {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 0.4;
  const g = ctx.createGain();
  g.gain.value = 0.07;
  src.connect(f).connect(g).connect(master);
  src.start();
  // Low city drone.
  const o = ctx.createOscillator();
  o.type = 'sawtooth'; o.frequency.value = 55;
  const lf = ctx.createBiquadFilter(); lf.type = 'lowpass'; lf.frequency.value = 180;
  const og = ctx.createGain(); og.gain.value = 0.025;
  o.connect(lf).connect(og).connect(master);
  o.start();
}

function noise(dur, freq, q, vol, type = 'bandpass') {
  if (!ctx) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random());
  src.stop(t + dur);
  return f;
}

function tone(freq, dur, vol, type = 'sine', slide = 0) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur);
}

export const sfx = {
  hit: () => { noise(0.12, 900, 1.2, 0.5); tone(140, 0.12, 0.25, 'square', 0.5); },
  heavy: () => { noise(0.4, 300, 0.8, 0.8); tone(70, 0.5, 0.5, 'sine', 0.4); },
  swing: () => noise(0.15, 2200, 2, 0.25, 'highpass'),
  shift: () => { tone(900, 0.18, 0.18, 'sine', 0.2); noise(0.2, 4000, 1, 0.2); },
  ice: () => { noise(0.3, 6000, 4, 0.3); tone(1800, 0.2, 0.08, 'triangle', 1.5); },
  pulse: () => { noise(0.25, 500, 0.7, 0.6); tone(110, 0.25, 0.4, 'sine', 0.5); },
  ring: (n = 0) => tone(440 * Math.pow(1.26, n), 0.6, 0.18, 'sine'),
  shatter: () => { noise(0.6, 3000, 0.6, 0.6); tone(880, 0.6, 0.15, 'triangle', 0.3); },
  absorb: () => tone(220, 0.15, 0.2, 'sawtooth', 2),
  hurt: () => { noise(0.2, 400, 1, 0.5); tone(90, 0.2, 0.3, 'square', 0.6); },
  pact: () => { tone(220, 1.2, 0.2, 'sine'); tone(330, 1.2, 0.15, 'sine'); tone(495, 1.4, 0.1, 'sine'); },
  wager: () => { tone(660, 0.12, 0.2, 'square'); setTimeout(() => tone(990, 0.2, 0.2, 'square'), 90); },
  win: () => { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.3, 0.2, 'triangle'), i * 80)); },
  lose: () => tone(300, 0.6, 0.3, 'sawtooth', 0.3),
  max: () => { noise(1.2, 200, 0.5, 1); tone(55, 1.4, 0.7, 'sine', 0.5); tone(880, 0.8, 0.15, 'triangle', 0.25); },
  aura: () => tone(80, 0.8, 0.3, 'sine', 1.5),
  fire: () => noise(0.8, 700, 0.5, 0.5, 'lowpass'),
};
