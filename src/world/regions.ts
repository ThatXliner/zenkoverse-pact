import * as THREE from 'three';
import type { Physics } from '../physics/world';
import type { LightPool } from '../render/lightPool';
import { surfaceAt as homeSurface, type Surface } from '../audio/surfaces';
import type { World } from './compound';
import { RegionLights, RegionPhysics, boundsDistance, type FreezableWater, type Pt, type RegionContent, type RegionDef, type Zone } from './region';
import type { PropSystem } from './props';
import type { Assets } from '../app/assets';
import { nearest } from './valleyPlan';

// Streams the world's regions in and out around the player and answers for
// all of them at once: which zone a point is in, what is underfoot, what to
// fade for the top-down camera, where the nearest running water is. The home
// region (the compound and the valley) is built at boot and never taken
// down, only hidden once the pass hides it; the rest build a slice at a time
// within a few milliseconds a frame, starting well before the player can see
// them, and are taken down again once they are far behind.

// Milliseconds of building a frame may spend.
const BUDGET_MS = 3;
// A point this close to a region's bounds counts as inside them.
const EDGE = 2;

type State = 'building' | 'standing' | 'hidden';

interface Standing {
  def: RegionDef;
  state: State;
  group: THREE.Group;
  physics: RegionPhysics;
  lights: RegionLights;
  gen: Generator<void, RegionContent, void> | null;
  content: RegionContent | null;
  zones: Zone[];
  water: { pts: Pt[]; y: number }[];
  waters: FreezableWater[];
  started: number;
  slices: number;
  worstSlice: number;
  phase: string;
  // The longest slice of each phase, in milliseconds.
  phases: Record<string, number>;
}

export interface StreamLog { id: string; event: 'start' | 'stand' | 'hide' | 'show' | 'drop' | 'force'; at: number; ms?: number; slices?: number; worstSlice?: number }

export class Regions {
  private all = new Map<string, Standing>();
  // The stretch of each frame spent building, for the checks: the most recent frames first.
  readonly log: StreamLog[] = [];
  readonly frameBuild: { at: number; ms: number }[] = [];
  private readonly toLocal = new THREE.Vector3();

  constructor(
    readonly home: World,
    private readonly defs: readonly RegionDef[],
    private readonly scene: THREE.Scene,
    private readonly physicsWorld: Physics,
    private readonly lightPool: LightPool,
    private readonly skyline: THREE.Object3D | null,
    private readonly props: PropSystem,
    private readonly assets: Assets,
  ) {}

  // ---------------------------------------------------------------- streaming

  // Once a frame, before the player moves: start what is coming into range,
  // build within the budget, hide or take down what is far behind. A region
  // the player stands in is finished at once (a teleport, a respawn).
  stream(player: THREE.Vector3): void {
    this.ensureAt(player);
    for (const def of this.defs) {
      const d = this.distance(def, player);
      const s = this.all.get(def.id);
      if (!s && d < def.stream.load) this.start(def);
      else if (s && d > def.stream.drop) { if (def.resident) this.hide(s); else this.drop(s); }
      else if (s && s.state === 'hidden' && d < def.stream.drop - 10) this.show(s);
    }
    let spent = 0;
    const t0 = performance.now();
    // The nearest region building first.
    const queue = [...this.all.values()].filter((s) => s.state === 'building').sort((a, b) => this.distance(a.def, player) - this.distance(b.def, player));
    for (const s of queue) {
      while (s.state === 'building' && spent < BUDGET_MS) {
        this.slice(s);
        spent = performance.now() - t0;
      }
      if (spent >= BUDGET_MS) break;
    }
    if (spent > 0.05) { this.frameBuild.push({ at: t0, ms: spent }); if (this.frameBuild.length > 2000) this.frameBuild.shift(); }
    if (this.skyline) this.skyline.visible = ![...this.all.values()].some((s) => s.def.hidesSkyline && s.state === 'standing');
  }

  // Finishes now any region whose land the point is on.
  ensureAt(p: THREE.Vector3): void {
    for (const def of this.defs) {
      if (this.distance(def, p) > EDGE) continue;
      let s = this.all.get(def.id);
      if (s?.state === 'hidden') { this.show(s); continue; }
      if (s?.state === 'standing') continue;
      if (!s) s = this.start(def);
      const t0 = performance.now();
      while (s.state === 'building') this.slice(s);
      this.note({ id: def.id, event: 'force', at: performance.now(), ms: performance.now() - t0 });
    }
  }

  // Builds everything within reach of `p` now (at boot, behind the loading screen).
  settle(p: THREE.Vector3): void {
    for (const def of this.defs) if (this.distance(def, p) < def.stream.load && !this.all.has(def.id)) this.start(def);
    for (const s of this.all.values()) while (s.state === 'building') this.slice(s);
  }

  private start(def: RegionDef): Standing {
    const group = new THREE.Group();
    group.name = `region:${def.id}`;
    group.position.copy(def.origin);
    // Hidden until it stands, so nothing half built is ever drawn.
    group.visible = false;
    this.scene.add(group);
    const physics = new RegionPhysics(this.physicsWorld, def.origin);
    const lights = new RegionLights(this.lightPool, def.origin);
    const s: Standing = { def, state: 'building', group, physics, lights, gen: null, content: null, zones: [], water: [], waters: [], started: performance.now(), slices: 0, worstSlice: 0, phase: 'start', phases: {} };
    s.gen = def.build({ group, physics, lights, origin: def.origin.clone(), props: this.props, assets: this.assets, phase: (name) => { s.phase = name; } });
    this.all.set(def.id, s);
    this.note({ id: def.id, event: 'start', at: s.started });
    return s;
  }

  private slice(s: Standing): void {
    const t0 = performance.now(), phase = s.phase;
    const r = s.gen!.next();
    const ms = performance.now() - t0;
    s.slices++;
    s.worstSlice = Math.max(s.worstSlice, ms);
    s.phases[phase] = Math.max(s.phases[phase] ?? 0, Math.round(ms * 100) / 100);
    if (!r.done) return;
    const c = r.value, o = s.def.origin;
    s.content = c;
    s.gen = null;
    s.zones = c.zones.map((z) => ({ ...z, min: z.min.clone().add(o), max: z.max.clone().add(o) }));
    s.water = (c.water ?? []).map((w) => ({ pts: w.pts.map(([x, z]) => [x + o.x, z + o.z] as Pt), y: w.y + o.y }));
    s.waters = (c.waters ?? []).map((w): FreezableWater => (w.kind === 'channel'
      ? { ...w, x0: w.x0 + o.x, x1: w.x1 + o.x, z0: w.z0 + o.z, z1: w.z1 + o.z, surfaceY: w.surfaceY + o.y }
      : { ...w, center: w.center.clone().add(o), surfaceY: w.surfaceY + o.y }));
    s.state = 'standing';
    s.group.visible = true;
    this.note({ id: s.def.id, event: 'stand', at: performance.now(), ms: performance.now() - s.started, slices: s.slices, worstSlice: s.worstSlice });
  }

  private hide(s: Standing): void {
    if (s.state !== 'standing') return;
    s.state = 'hidden';
    s.group.visible = false;
    this.note({ id: s.def.id, event: 'hide', at: performance.now() });
  }

  private show(s: Standing): void {
    s.state = 'standing';
    s.group.visible = true;
    this.note({ id: s.def.id, event: 'show', at: performance.now() });
  }

  private drop(s: Standing): void {
    // A build cut short still hands back what it made through its group and scopes.
    s.gen?.return(undefined as never);
    s.content?.dispose?.();
    s.physics.dispose();
    s.lights.dispose();
    this.scene.remove(s.group);
    disposeTree(s.group);
    this.all.delete(s.def.id);
    this.note({ id: s.def.id, event: 'drop', at: performance.now() });
  }

  // Takes a region down now (not the resident one), so it streams in again
  // if the player is in reach: the checks measure a region arriving this way.
  restream(id: string): void {
    const s = this.all.get(id);
    if (s && !s.def.resident) this.drop(s);
  }

  private note(e: StreamLog): void { this.log.push(e); if (this.log.length > 200) this.log.shift(); }

  private distance(def: RegionDef, p: THREE.Vector3): number {
    return boundsDistance(def.bounds, p.x - def.origin.x, p.z - def.origin.z);
  }

  // ---------------------------------------------------------------- queries

  private *standing(): Generator<Standing> { for (const s of this.all.values()) if (s.state === 'standing') yield s; }
  private holding(p: THREE.Vector3): Standing | null {
    for (const s of this.standing()) if (s.def.id !== 'home' && this.distance(s.def, p) === 0) return s;
    return null;
  }

  // Which regions are standing and which are building, for the HUD-free checks.
  status(): { id: string; state: State; slices: number; worstSlice: number; phases: Record<string, number> }[] {
    return [...this.all.values()].map((s) => ({ id: s.def.id, state: s.state, slices: s.slices, worstSlice: Math.round(s.worstSlice * 100) / 100, phases: s.phases }));
  }
  isStanding(id: string): boolean { return this.all.get(id)?.state === 'standing'; }

  // Whether `p` is on land drawn on this screen: a body there can be seen and hit.
  present(p: THREE.Vector3): boolean {
    for (const s of this.standing()) if (this.distance(s.def, p) <= EDGE) return true;
    return false;
  }

  // Specific places first, in any region; then the home region's own answer
  // (the hall, the yard, the roofs); then a region's catch-all.
  zoneAt(p: THREE.Vector3): Zone | null {
    for (const s of this.standing()) if (s.def.id !== 'home') for (const z of s.zones) if (!z.general && inside(z, p)) return z;
    const h = this.isStanding('home') ? this.home.zoneAt(p) : null;
    if (h && !h.general) return h;
    for (const s of this.standing()) if (s.def.id !== 'home') for (const z of s.zones) if (z.general && inside(z, p)) return z;
    return h;
  }

  indoorsAt(p: THREE.Vector3): number {
    const s = this.holding(p);
    if (s) return s.content!.indoorsAt?.(this.local(s, p)) ?? 0;
    return this.home.indoorsAt(p);
  }

  // How far out of the walls: 1 anywhere past the valley.
  openAt(p: THREE.Vector3): number { return this.holding(p) ? 1 : this.home.openAt(p); }

  groundAt(x: number, z: number): number {
    for (const s of this.standing()) {
      if (s.def.id === 'home' || !s.content!.groundAt) continue;
      const o = s.def.origin;
      if (this.distance(s.def, this.toLocal.set(x, 0, z)) > 0) continue;
      const h = s.content!.groundAt(x - o.x, z - o.z);
      if (h !== null) return h + o.y;
    }
    return this.home.groundAt(x, z);
  }

  surfaceAt(p: THREE.Vector3, tag: string): Surface {
    const s = this.holding(p);
    if (s?.content!.surfaceAt) { const got = s.content!.surfaceAt(this.local(s, p), tag); if (got) return got; }
    if (s) return tag === 'wood' ? 'wood' : tag === 'ground' ? 'grass' : 'stone';
    return homeSurface(p, tag);
  }

  // The nearest point of running water to (x, z): the valley's stream or a region's.
  waterNear(x: number, z: number, out: THREE.Vector3, stream: readonly Pt[], streamY: number): THREE.Vector3 {
    const at = { x: 0, z: 0 };
    let best = nearest(x, z, stream, at);
    out.set(at.x, streamY, at.z);
    for (const s of this.standing()) for (const w of s.water) {
      const d = nearest(x, z, w.pts, at);
      if (d < best) { best = d; out.set(at.x, w.y, at.z); }
    }
    return out;
  }

  // Everything that may fade for the top-down camera, in every region drawn now.
  get occluders(): THREE.Mesh[] {
    const out: THREE.Mesh[] = this.isStanding('home') ? [...this.home.occluders] : [];
    for (const s of this.standing()) if (s.def.id !== 'home' && s.content!.occluders) out.push(...s.content!.occluders);
    return out;
  }

  // Per frame, for every region standing: animated materials and what moves on its own.
  update(time: number, dt: number, player: THREE.Vector3, camera: THREE.Camera): void {
    for (const s of this.standing()) s.content!.update?.(time, dt, player, camera);
  }

  // Water Rime can freeze, in every region drawn now (the koi pond is the compound's own).
  get waters(): FreezableWater[] {
    const out = this.isStanding('home') ? [...this.home.waters] : [];
    for (const s of this.standing()) if (s.def.id !== 'home') out.push(...s.waters);
    return out;
  }

  private local(s: Standing, p: THREE.Vector3): THREE.Vector3 { return this.toLocal.copy(p).sub(s.def.origin); }

  // The home region's own things, as the rest of the game knows them.
  get plaques(): World['plaques'] { return this.home.plaques; }
  get pond(): World['pond'] { return this.home.pond; }
  get craneHook(): World['craneHook'] { return this.home.craneHook; }
}

function inside(z: Zone, p: THREE.Vector3): boolean {
  return p.x >= z.min.x && p.x <= z.max.x && p.y >= z.min.y && p.y <= z.max.y && p.z >= z.min.z && p.z <= z.max.z;
}

// Frees every geometry, material and texture under `root`.
function disposeTree(root: THREE.Object3D): void {
  const mats = new Set<THREE.Material>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mats.add(mat);
  });
  for (const mat of mats) {
    for (const v of Object.values(mat)) if ((v as THREE.Texture)?.isTexture) (v as THREE.Texture).dispose();
    mat.dispose();
  }
}
