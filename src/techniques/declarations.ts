import * as THREE from 'three';
import { signal } from '@preact/signals';
import type { Game } from '../app/game';
import type { Pact } from '../pacts/schema';
import { KITS } from './techniques';

// A Pact the player named is shouted when it matters, the way a manga
// fighter calls a technique: its name lettered over the caster for a beat.
// It costs no frames. Nothing here touches the clock, the input or the
// camera; the callout is a DOM word over the action that fades on its own.
// It speaks on a Pact's first use in an exchange, on a Wager's declaration,
// and rarely after; Pacts left with a default name stay quiet.

export interface Shout { id: number; text: string; x: number; y: number; color: string; small: boolean; wager: boolean }
export const declareUi = signal<Shout[]>([]);

// How long a callout lives, in seconds of real time.
const LIFE = 1.5;
// A Pact shouts again only after this long, unless a new exchange began.
const AGAIN = 30;
// No cast for this long and the next one opens a new exchange.
const LULL = 10;
// A Wager's declaration shouts unless the same Pact shouted this recently.
const WAGER_AGAIN = 6;
// Two callouts never start closer together than this.
const GAP = 1.2;
const HEAD = new THREE.Vector3(0, 2.25, 0);

interface Live { id: number; text: string; color: string; wager: boolean; t: number; anchor: () => THREE.Vector3 | null; mine: boolean }

// A name the player gave it: not the draft default, not a copy's, and not
// the name a catalogue Ability arrived with.
export function isNamed(p: Pact): boolean {
  const n = p.name.trim();
  if (!n || n === 'New Pact' || /\(copy\)$/.test(n)) return false;
  return KITS[p.technique]?.catalogue.find((c) => c.id === p.id)?.name !== n;
}

export class Declarations {
  private live: Live[] = [];
  private last = new Map<string, number>();
  private lastCast = -Infinity;
  private lastShout = -Infinity;
  private id = 0;
  private v = new THREE.Vector3();

  constructor(private game: Game) {}

  private now(): number { return performance.now() / 1000; }

  // Called on every cast of the player's own. True when it shouted.
  cast(pact: Pact | null, wagered: boolean): boolean {
    const t = this.now();
    const fresh = t - this.lastCast > LULL;
    this.lastCast = t;
    if (!pact || !isNamed(pact) || t - this.lastShout < GAP) return false;
    const since = t - (this.last.get(pact.id) ?? -Infinity);
    if (!(fresh || since > AGAIN || (wagered && since > WAGER_AGAIN))) return false;
    this.last.set(pact.id, t);
    this.lastShout = t;
    const g = this.game;
    this.shout(pact.name, () => g.player.position.clone().add(HEAD), g.techniques.def.color, wagered, true);
    return true;
  }

  // A callout over any body: the player's own, or another player's online.
  shout(text: string, anchor: () => THREE.Vector3 | null, color: number, wager = false, mine = false): void {
    this.live.push({ id: ++this.id, text, color: '#' + new THREE.Color(color).getHexString(), wager, t: 0, anchor, mine });
    if (this.live.length > 3) this.live.shift();
  }

  update(raw: number): void {
    if (!this.live.length) { if (declareUi.value.length) declareUi.value = []; return; }
    const g = this.game, cam = g.renderer.camera;
    const out: Shout[] = [];
    for (const s of this.live) s.t += raw;
    this.live = this.live.filter((s) => s.t < LIFE);
    for (const s of this.live) {
      // In first person the caster is the camera: the call sits low and to the left, smaller, clear of the aim.
      if (s.mine && g.cam.isFirst && !g.cam.inShot) { out.push({ id: s.id, text: s.text, x: 30, y: 70, color: s.color, small: true, wager: s.wager }); continue; }
      const at = s.anchor();
      if (!at) continue;
      this.v.copy(at).project(cam);
      if (this.v.z > 1 || Math.abs(this.v.x) > 1.1 || Math.abs(this.v.y) > 1.1) continue;
      out.push({ id: s.id, text: s.text, x: (this.v.x + 1) * 50, y: (1 - this.v.y) * 50, color: s.color, small: false, wager: s.wager });
    }
    declareUi.value = out;
  }

  clear(): void { this.live = []; declareUi.value = []; }
}
