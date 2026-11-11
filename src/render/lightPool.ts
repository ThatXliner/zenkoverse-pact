import * as THREE from 'three';

interface SourceBase { position: THREE.Vector3; color: THREE.Color; intensity: number; distance: number; decay: number }
export interface PointSource extends SourceBase { kind: 'point'; urgent?: boolean }
export interface SpotSource extends SourceBase { kind: 'spot'; target: THREE.Vector3; angle: number; penumbra: number }
export type LightSource = PointSource | SpotSource;

export interface PoolSize { points: number; spots: number; spotShadows: number }

interface Slot<L extends THREE.Light, S extends LightSource> { light: L; source: S | null; weight: number }

const FADE_PER_SECOND = 3.5;
const KEEP_BIAS = 1.4;

// The world declares any number of light sources; a fixed set of three.js
// lights (the slots) shows the most relevant ones each frame. Slot counts
// only change with the quality preset, so shaders never recompile in play.
// The most relevant spots go to the shadow-casting slots.
export class LightPool {
  private points: Slot<THREE.PointLight, PointSource>[] = [];
  private shadowSpots: Slot<THREE.SpotLight, SpotSource>[] = [];
  private spots: Slot<THREE.SpotLight, SpotSource>[] = [];
  private pointSources = new Set<PointSource>();
  private spotSources = new Set<SpotSource>();
  private frustum = new THREE.Frustum();
  private viewProj = new THREE.Matrix4();
  private sphere = new THREE.Sphere();
  private group = new THREE.Group();

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
  }

  add<S extends LightSource>(source: S): S {
    if (source.kind === 'point') this.pointSources.add(source); else this.spotSources.add(source);
    return source;
  }

  remove(source: LightSource): void {
    if (source.kind === 'point') this.pointSources.delete(source); else this.spotSources.delete(source);
  }

  setSize(size: PoolSize): void {
    this.group.clear();
    for (const s of [...this.points, ...this.shadowSpots, ...this.spots]) s.light.dispose();
    const slot = <L extends THREE.Light>(light: L): Slot<L, never> => { this.group.add(light); return { light, source: null, weight: 0 }; };
    const spot = (shadow: boolean): THREE.SpotLight => {
      const light = new THREE.SpotLight(0xffffff, 0);
      light.castShadow = shadow;
      light.shadow.mapSize.set(512, 512);
      light.shadow.bias = -0.002;
      this.group.add(light.target);
      return light;
    };
    this.points = Array.from({ length: size.points }, () => slot(new THREE.PointLight(0xffffff, 0)));
    this.shadowSpots = Array.from({ length: size.spotShadows }, () => slot(spot(true)));
    this.spots = Array.from({ length: size.spots - size.spotShadows }, () => slot(spot(false)));
  }

  update(camera: THREE.Camera, dt: number): void {
    this.viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProj);
    const step = FADE_PER_SECOND * dt;
    const points = this.ranked(this.pointSources, this.points, camera.position);
    fill(this.points, points.slice(0, this.points.length), this.pointSources, step);
    const spots = this.ranked(this.spotSources, [...this.shadowSpots, ...this.spots], camera.position);
    const shadowed = this.shadowSpots.length;
    fill(this.shadowSpots, spots.slice(0, shadowed), this.spotSources, step);
    fill(this.spots, spots.slice(shadowed, shadowed + this.spots.length), this.spotSources, step);
    for (const s of this.points) apply(s);
    for (const s of [...this.shadowSpots, ...this.spots]) {
      apply(s);
      if (s.source) { s.light.target.position.copy(s.source.target); s.light.angle = s.source.angle; s.light.penumbra = s.source.penumbra; }
    }
  }

  // Sources that can touch the screen, most relevant first. Relevance is the
  // distance from the eye in units of the light's reach; sources already in a
  // slot get a bonus so two similar lights do not trade places every frame.
  private ranked<S extends LightSource>(sources: Set<S>, slots: Slot<THREE.Light, S>[], eye: THREE.Vector3): S[] {
    const held = new Set(slots.map((s) => s.source));
    const out: { source: S; rank: number }[] = [];
    for (const source of sources) {
      if (source.kind === 'point' && source.urgent) { out.push({ source, rank: -1 }); continue; }
      const reach = source.kind === 'spot' ? coneBounds(source, this.sphere) : this.sphere.set(source.position, source.distance);
      if (!this.frustum.intersectsSphere(reach)) continue;
      const rank = reach.center.distanceTo(eye) / reach.radius;
      out.push({ source, rank: held.has(source) ? rank / KEEP_BIAS : rank });
    }
    return out.sort((a, b) => a.rank - b.rank).map((r) => r.source);
  }
}

// Fades out slots whose source is no longer wanted, fades in wanted sources
// as slots free up. An urgent source (a flash) takes a slot at full strength
// at once, evicting an unwanted occupant if none is free.
function fill<S extends LightSource>(slots: Slot<THREE.Light, S>[], wanted: S[], live: Set<S>, step: number): void {
  const want = new Set(wanted);
  const urgent = (s: S | null): boolean => s?.kind === 'point' && !!s.urgent;
  for (const slot of slots) {
    if (!slot.source) continue;
    if (want.has(slot.source)) slot.weight = urgent(slot.source) ? 1 : Math.min(1, slot.weight + step);
    else if (!live.has(slot.source) || (slot.weight -= step) <= 0) { slot.source = null; slot.weight = 0; }
  }
  for (const source of wanted) {
    if (slots.some((s) => s.source === source)) continue;
    const free = slots.find((s) => !s.source) ?? (urgent(source) ? slots.find((s) => !want.has(s.source!)) : undefined);
    if (!free) continue;
    free.source = source;
    free.weight = urgent(source) ? 1 : 0;
  }
}

function apply(slot: Slot<THREE.PointLight | THREE.SpotLight, LightSource>): void {
  const { light, source } = slot;
  if (!source) { light.intensity = 0; return; }
  light.position.copy(source.position);
  light.color.copy(source.color);
  light.intensity = source.intensity * slot.weight;
  light.distance = source.distance;
  light.decay = source.decay;
}

// Bounding sphere of the lit cone. The cone ends at the spot's target (the
// ground under a lamp) or at the cutoff distance, whichever is nearer.
function coneBounds(spot: SpotSource, out: THREE.Sphere): THREE.Sphere {
  const axis = out.center.subVectors(spot.target, spot.position);
  const length = Math.min(axis.length(), spot.distance);
  axis.normalize();
  const cos = Math.cos(spot.angle);
  out.radius = spot.angle >= Math.PI / 4 ? length * Math.tan(spot.angle) : length / (2 * cos * cos);
  out.center.multiplyScalar(spot.angle >= Math.PI / 4 ? length : out.radius).add(spot.position);
  return out;
}
