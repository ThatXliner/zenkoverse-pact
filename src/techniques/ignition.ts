import type * as THREE from 'three';

// Fire is fire. Whatever is hot enough to light fuel, wherever it comes from
// (a Heat user's heat, an Electro spark, the Kuroda's flame running his line,
// iron striking sparks off stone, a prop already burning), says so here, and
// whatever lies waiting to burn listens: Fuel's vapour (src/techniques/kits/
// fuelVapour.ts). Online the other screens hear it too, through the effect
// wire (src/net/fxwire.ts), so another player's Heat lights vapour laid here.

type Listener = (at: THREE.Vector3, radius: number) => void;

const listeners = new Set<Listener>();
let wire: Listener | null = null;

// Something hot enough to light fuel touched the world within `radius` of
// `at`. `remote` is true for one heard from another screen, which is not
// sent back out.
export function kindle(at: THREE.Vector3, radius: number, remote = false): void {
  for (const l of listeners) l(at, radius);
  if (!remote) wire?.(at, radius);
}

// Hears every kindle from now on; returns the way to stop.
export function onKindle(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

// The effect wire sends each local kindle to the other screens (null when offline).
export function wireKindle(send: Listener | null): void { wire = send; }
