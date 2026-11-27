import * as THREE from 'three';
import { toon } from '../../render/materials';
import { cliffDistance } from '../valleyPlan';
import type { Kit } from '../kit';
import { ROUTE, SITES, ROAD_HALF, walkDistance, type Node, type Paving } from './route';

// The road surface along the route, the steps, and its edges. Earth is
// packed and rutted; the steep stretches are laid in old stone, irregular
// blocks set close (the way the old highway over Hakone is paved); the
// steps are cut stone; the last stretch to the outskirts is metalled. Every
// edge of the walkable strip gets a wall: in the rock of a cut bank it is
// invisible (the bank is head high there), and over a drop it is a post and
// rail fence you can see.

export type Ground = (x: number, z: number) => number;

export const ROAD = { earth: 0xc8ad86, rut: 0xb2966f, stoneA: 0xa7a199, stoneB: 0x8f8a82, joint: 0x5d5a52, moss: 0x7d8f58, asphalt: 0x5d5c61, line: 0xe9e4d6, step: 0x9d978d, stepDark: 0x7a756d } as const;
const FENCE = { post: 0x5a3a2a, rail: 0x7a4b34 } as const;

// Irregular laid stone, drawn once on a canvas: rounded blocks of a few
// greys with dark joints and moss in some of them.
function stoneTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
  g.fillStyle = hex(ROAD.joint);
  g.fillRect(0, 0, 256, 256);
  let seed = 7;
  const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  // Blocks on a jittered lattice, wrapped so the tile repeats.
  for (let y = 0; y < 6; y++) for (let x = 0; x < 5; x++) {
    const cx = (x + 0.5 + (y % 2) * 0.5) * 51.2 + (r() - 0.5) * 14, cy = (y + 0.5) * 42.7 + (r() - 0.5) * 10;
    const w = 20 + r() * 6, h = 16 + r() * 5, rot = (r() - 0.5) * 0.5;
    g.fillStyle = hex([ROAD.stoneA, ROAD.stoneB, 0x9a958c][Math.floor(r() * 3)]!);
    for (const ox of [-256, 0, 256]) for (const oy of [-256, 0, 256]) {
      g.save(); g.translate(cx + ox, cy + oy); g.rotate(rot);
      g.beginPath();
      for (let k = 0; k < 7; k++) { const a = (k / 7) * Math.PI * 2, rr = 0.86 + ((k * 13 + x * 7 + y * 3) % 5) * 0.035; g.lineTo(Math.cos(a) * w * rr, Math.sin(a) * h * rr); }
      g.closePath(); g.fill();
      g.restore();
    }
  }
  g.fillStyle = hex(ROAD.moss);
  for (let i = 0; i < 26; i++) { g.globalAlpha = 0.55; g.beginPath(); g.ellipse(r() * 256, r() * 256, 4 + r() * 5, 2 + r() * 3, r() * 3, 0, Math.PI * 2); g.fill(); }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// Points along the road about `step` apart, each with its sideways normal,
// the segment it is on and that segment's paving.
interface Sample { x: number; z: number; nx: number; nz: number; seg: number; pave: Paving; s: number }
function samples(step: number): Sample[] {
  const out: Sample[] = [];
  let s = 0;
  for (let i = 0; i < ROUTE.length - 1; i++) {
    const a = ROUTE[i]!, b = ROUTE[i + 1]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(len / step));
    for (let k = i === 0 ? 0 : 1; k <= n; k++) {
      const t = k / n;
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, nx: 0, nz: 0, seg: k === 0 ? i : i, pave: a.pave, s: s + len * t });
    }
    s += len;
  }
  // Normals from the neighbours, so a corner turns smoothly.
  for (let i = 0; i < out.length; i++) {
    const p = out[Math.max(0, i - 1)]!, q = out[Math.min(out.length - 1, i + 1)]!;
    const dx = q.x - p.x, dz = q.z - p.z, l = Math.hypot(dx, dz) || 1;
    out[i]!.nx = -dz / l; out[i]!.nz = dx / l;
  }
  return out;
}

export function* buildRoad(k: Kit, parent: THREE.Object3D, ground: Ground, phase: (name: string) => void): Generator<void, void, void> {
  phase('road:surface');
  const pts = samples(0.8);
  const stone = toon(0xffffff, { map: stoneTexture() });
  for (const m of [stone]) { m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -4; }
  const flat = (c: number): THREE.MeshToonMaterial => { const m = toon(c); m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -4; return m; };
  const earth = flat(ROAD.earth), rut = flat(ROAD.rut), asphalt = flat(ROAD.asphalt), line = flat(ROAD.line);
  const ACROSS = 4;
  // A strip from `off - half` to `off + half` across the line, for the samples whose paving passes `keep`.
  const strip = (half: number, off: number, lift: number, keep: (p: Sample) => boolean, mat: THREE.Material, uv: boolean): void => {
    const pos: number[] = [], uvs: number[] = [];
    const corner = (p: Sample, a: number): [number, number, number] => {
      const x = p.x + p.nx * (off + a * half), z = p.z + p.nz * (off + a * half);
      return [x, ground(x, z) + lift, z];
    };
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i]!, q = pts[i + 1]!;
      if (!keep(p)) continue;
      for (let c = 0; c < ACROSS; c++) {
        const a0 = -1 + (2 * c) / ACROSS, a1 = -1 + (2 * (c + 1)) / ACROSS;
        const p0 = corner(p, a0), p1 = corner(p, a1), q0 = corner(q, a0), q1 = corner(q, a1);
        pos.push(...p0, ...p1, ...q1, ...p0, ...q1, ...q0);
        if (uv) {
          const u0 = (a0 + 1) / 2, u1 = (a1 + 1) / 2, v0 = p.s / 3.1, v1 = q.s / 3.1;
          uvs.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
        }
      }
    }
    if (!pos.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    if (uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    m.castShadow = false;
    m.userData.keep = true;
    parent.add(m);
  };
  const on = (...kinds: Paving[]) => (p: Sample) => kinds.includes(p.pave);
  strip(ROAD_HALF, 0, 0.04, on('earth'), earth, false);
  yield;
  for (const off of [-0.7, 0.7]) { strip(0.18, off, 0.045, on('earth'), rut, false); yield; }
  strip(ROAD_HALF + 0.1, 0, 0.05, on('stone'), stone, true);
  yield;
  strip(ROAD_HALF + 0.3, 0, 0.04, on('asphalt'), asphalt, false);
  for (const off of [-ROAD_HALF, ROAD_HALF]) strip(0.08, off, 0.05, on('asphalt'), line, false);
  yield;
  phase('road:steps');
  yield* steps(k, parent, ground);
  phase('road:edges');
  yield* edges(k, parent, ground);
}

// Cut stone steps up the 'steps' stretches: a tread and riser every 0.2 m
// of rise, stepping between the stretch's two ends, each its own collider.
function* steps(k: Kit, parent: THREE.Object3D, ground: Ground): Generator<void, void, void> {
  const flight = k.stretch('pass:steps', parent);
  for (let i = 0; i < ROUTE.length - 1; i++) {
    const a = ROUTE[i]!, b = ROUTE[i + 1]!;
    if (a.pave !== 'steps') continue;
    const len = Math.hypot(b.x - a.x, b.z - a.z), rise = b.y - a.y, n = Math.max(2, Math.round(rise / 0.2));
    const yaw = Math.atan2(b.x - a.x, b.z - a.z), run = len / n, riser = rise / n;
    for (let s = 0; s < n; s++) {
      const t = (s + 0.5) / n, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t, top = a.y + riser * (s + 1);
      const foot = Math.min(ground(x, z), top - riser) - 0.3;
      const p = k.at(flight, x, 0, z, yaw);
      k.box(p, s % 3 === 1 ? ROAD.stepDark : ROAD.step, 0, (top + foot) / 2, 0, ROAD_HALF * 2 + 0.2, top - foot, run + 0.02);
      // The worn front edge of each tread.
      k.box(p, ROAD.joint, 0, top - 0.02, run / 2 - 0.04, ROAD_HALF * 2 + 0.22, 0.05, 0.09, undefined, false);
      k.solid(p, 0, (top + foot) / 2, 0, ROAD_HALF + 0.1, (top - foot) / 2, run / 2 + 0.01, 'stone');
    }
    // Kerb stones up both sides of the flight.
    for (const side of [-1, 1]) {
      const nx = Math.cos(yaw) * side, nz = -Math.sin(yaw) * side;
      for (let s = 0; s < n; s += 2) {
        const t = (s + 1) / n, x = a.x + (b.x - a.x) * t + nx * (ROAD_HALF + 0.25), z = a.z + (b.z - a.z) * t + nz * (ROAD_HALF + 0.25), top = a.y + riser * (s + 1.5);
        k.rock(k.at(flight, x, top, z, s), s % 4 ? ROAD.stepDark : ROAD.step, 0, 0, 0, 0.36, 0, [1.1, 0.7, 1.4]);
      }
    }
    yield;
  }
  k.bake(flight);
  yield;
}

// Edges: walk each side of every stretch (and round each site) at its edge
// distance and keep the points that are not inside another stretch; a run
// of kept points is one straight wall. A run over a drop gets a fence.
function* edges(k: Kit, parent: THREE.Object3D, ground: Ground): Generator<void, void, void> {
  const fences = k.stretch('pass:fences', parent);
  const STEP = 0.7;
  const kept = (x: number, z: number): boolean => walkDistance(x, z) > -0.08 && cliffDistance(x, z) > -0.6 && !nearBridge(x, z);
  const roadY = (n0: Node, n1: Node, t: number) => n0.y + (n1.y - n0.y) * t;
  let made = 0;
  const run = (line: { x: number; z: number; y: number }[]): void => {
    if (line.length < 2) return;
    const a = line[0]!, b = line[line.length - 1]!;
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || 1, ux = dx / len, uz = dz / len;
    const lo = Math.min(...line.map((p) => p.y)) - 3, hi = Math.max(...line.map((p) => p.y)) + 30;
    // The wall's inner face on the edge line: its body stands outside the strip.
    let ox = -uz * 0.35, oz = ux * 0.35;
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    if (walkDistance(mx + ox, mz + oz) < walkDistance(mx - ox, mz - oz)) { ox = -ox; oz = -oz; }
    k.wall(a.x - ux * 0.35 + ox, a.z - uz * 0.35 + oz, b.x + ux * 0.35 + ox, b.z + uz * 0.35 + oz, lo, hi, 0.35);
    made++;
    // Over a drop, a post and rail fence along the line.
    const drop = line.filter((p) => ground(p.x, p.z) < p.y - 0.5).length > line.length * 0.5;
    if (!drop) return;
    const posts = Math.max(1, Math.round(len / 2.2));
    let prev: THREE.Vector3 | null = null;
    for (let i = 0; i <= posts; i++) {
      const x = a.x + dx * (i / posts), z = a.z + dz * (i / posts), y = Math.max(ground(x, z), roadY2(line, i / posts) - 0.6);
      k.box(k.at(fences, x, y, z, Math.atan2(dx, dz)), FENCE.post, 0, 0.55, 0, 0.14, 1.3, 0.14);
      const top = new THREE.Vector3(x, y + 1.0, z);
      if (prev) for (const off of [0, -0.42]) {
        const mid = prev.clone().add(top).multiplyScalar(0.5), l = prev.distanceTo(top);
        const r = k.box(fences, FENCE.rail, mid.x, mid.y + off, mid.z, 0.08, 0.09, l);
        r.lookAt(top.x, top.y + off, top.z);
      }
      prev = top;
    }
  };
  // Each stretch's two sides.
  for (let i = 0; i < ROUTE.length - 1; i++) {
    const a = ROUTE[i]!, b = ROUTE[i + 1]!;
    if (a.pave === 'rope') continue;
    const len = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(2, Math.ceil(len / STEP));
    const nx = -(b.z - a.z) / len, nz = (b.x - a.x) / len;
    for (const side of [-1, 1]) {
      let cur: { x: number; z: number; y: number }[] = [];
      for (let s = 0; s <= n; s++) {
        const t = s / n, e = a.edge + (b.edge - a.edge) * t;
        const x = a.x + (b.x - a.x) * t + nx * side * e, z = a.z + (b.z - a.z) * t + nz * side * e;
        if (kept(x, z)) cur.push({ x, z, y: roadY(a, b, t) });
        else { run(cur); cur = []; }
      }
      run(cur);
    }
    // The outside of the turn at the next node: an arc between the two stretches' sides.
    const c = ROUTE[i + 2];
    if (c && b.pave !== 'rope') {
      const a0 = Math.atan2(nz, nx), l2 = Math.hypot(c.x - b.x, c.z - b.z), a1 = Math.atan2((c.x - b.x) / l2, -(c.z - b.z) / l2);
      for (const side of [0, Math.PI]) {
        const da = ((a1 - a0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        const arcPts: { x: number; z: number; y: number }[] = [];
        const steps2 = Math.max(2, Math.ceil(Math.abs(da) * b.edge / 0.5));
        for (let s = 0; s <= steps2; s++) {
          const ang = a0 + side + (da * s) / steps2, x = b.x + Math.cos(ang) * b.edge, z = b.z + Math.sin(ang) * b.edge;
          if (kept(x, z)) arcPts.push({ x, z, y: b.y }); else if (arcPts.length) break;
        }
        for (let s = 0; s < arcPts.length - 1; s++) run([arcPts[s]!, arcPts[s + 1]!]);
      }
    }
    yield;
  }
  // Round each site, a short wall between each two kept points.
  for (const st of SITES) {
    const n = Math.ceil((Math.PI * 2 * st.edge) / STEP);
    let prev: { x: number; z: number; y: number } | null = null;
    for (let s = 0; s <= n; s++) {
      const ang = (s / n) * Math.PI * 2, x = st.x + Math.cos(ang) * st.edge, z = st.z + Math.sin(ang) * st.edge;
      const p = kept(x, z) ? { x, z, y: st.y } : null;
      if (p && prev) run([prev, p]);
      prev = p;
    }
    yield;
  }
  yield;
  k.bake(fences);
  fences.userData.walls = made;
}

function roadY2(line: { y: number }[], t: number): number {
  const i = Math.min(line.length - 1, Math.round(t * (line.length - 1)));
  return line[i]!.y;
}

const BRIDGE_AT = ROUTE.findIndex((n) => n.pave === 'rope');
function nearBridge(x: number, z: number): boolean {
  if (BRIDGE_AT < 0) return false;
  const a = ROUTE[BRIDGE_AT]!, b = ROUTE[BRIDGE_AT + 1]!;
  const dx = b.x - a.x, dz = b.z - a.z, t = ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz);
  if (t < -0.02 || t > 1.02) return false;
  return Math.hypot(x - a.x - dx * t, z - a.z - dz * t) < 1.6;
}
