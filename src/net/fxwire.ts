import * as THREE from 'three';
import type { Vfx } from '../techniques/vfx';
import type { Audio } from '../audio/audio';
import type { FxCall } from './protocol';

// Online, everything a player's Techniques draw through the shared effect
// pool is drawn on the other screens too: the same rings, sparks, ice and
// afterimages, from the same calls. The pool is wrapped, not changed, so a
// kit never knows whether anyone is watching. The Techniques' sounds travel
// the same way (`sfx`) and play on the other screens at the caster.
const MIRRORED = ['ring', 'burst', 'flash', 'trail', 'patch', 'iceSpike', 'afterimage', 'steam', 'melt', 'flames'] as const;
type Mirrored = (typeof MIRRORED)[number];

type Wire = { v: [number, number, number] } | { self: 1 } | number | string | null | Wire[];

const r2 = (x: number) => Math.round(x * 100) / 100;

function encode(a: unknown): Wire {
  if (a instanceof THREE.Vector3) return { v: [r2(a.x), r2(a.y), r2(a.z)] };
  // The only object an effect takes is the caster's own body (afterimage).
  if (a instanceof THREE.Object3D) return { self: 1 };
  if (Array.isArray(a)) return a.map(encode);
  if (typeof a === 'number') return Number.isInteger(a) ? a : Math.round(a * 1000) / 1000;
  if (typeof a === 'string') return a;
  return null;
}

function decode(w: unknown, self: THREE.Object3D): unknown {
  if (Array.isArray(w)) return w.map((x) => decode(x, self));
  if (w && typeof w === 'object') {
    if ('v' in w && Array.isArray(w.v) && w.v.length === 3) return new THREE.Vector3(Number(w.v[0]), Number(w.v[1]), Number(w.v[2]));
    if ('self' in w) return self;
    return undefined;
  }
  if (typeof w === 'number' || typeof w === 'string') return w;
  return undefined;
}

export class FxWire {
  private calls: FxCall[] = [];
  private replaying = false;
  private originals = new Map<Mirrored, (...a: unknown[]) => unknown>();

  constructor(private vfx: Vfx, private audio: Audio) {
    audio.mirror = (cue, at, gain, pitch) => {
      if (!this.replaying && this.calls.length < 64) this.calls.push({ f: 'sfx', a: [cue, at ? encode(at) : null, r2(gain), r2(pitch)] });
    };
    const pool = vfx as unknown as Record<Mirrored, (...a: unknown[]) => unknown>;
    for (const f of MIRRORED) {
      const original = pool[f].bind(vfx);
      this.originals.set(f, original);
      pool[f] = (...a: unknown[]) => {
        if (!this.replaying && this.calls.length < 64) this.calls.push({ f, a: a.map(encode) });
        return original(...a);
      };
    }
  }

  // The calls recorded since the last take.
  take(): FxCall[] | null {
    if (!this.calls.length) return null;
    const c = this.calls;
    this.calls = [];
    return c;
  }

  replay(calls: FxCall[], self: THREE.Object3D): void {
    this.replaying = true;
    try {
      for (const c of calls) {
        if (c.f === 'sfx' && Array.isArray(c.a)) {
          const at = decode(c.a[1], self);
          this.audio.replay(c.a[0], at instanceof THREE.Vector3 ? at : null, c.a[2], c.a[3], self.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 1.2, 0)));
          continue;
        }
        const fn = this.originals.get(c.f as Mirrored);
        if (!fn || !Array.isArray(c.a)) continue;
        fn(...c.a.map((w) => decode(w, self)));
      }
    } finally { this.replaying = false; }
  }

  // Effects this screen draws for something the whole room already sees
  // (a prop the server broke), so they are not sent on again.
  quiet(fn: () => void): void {
    const was = this.replaying;
    this.replaying = true;
    try { fn(); } finally { this.replaying = was; }
  }

  // Offline again: the pool goes back to its own methods.
  dispose(): void {
    const pool = this.vfx as unknown as Record<Mirrored, (...a: unknown[]) => unknown>;
    for (const f of MIRRORED) delete (pool as Partial<typeof pool>)[f];
    this.audio.mirror = null;
    this.calls = [];
  }
}
