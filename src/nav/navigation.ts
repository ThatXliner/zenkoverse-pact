import * as THREE from 'three';
import { signal, computed, effect } from '@preact/signals';
import type { Game } from '../app/game';
import { toast } from '../app/game';
import { appState, pause, resume, setState, worldRuns } from '../app/state';
import { tutorialUi } from '../tutorial/tutorial';
import { GROUP_WORLD } from '../physics/world';
import { ARRIVE_RADIUS, GOALS, POIS, TUTORIAL_TARGETS, UNLOCK_RADIUS, poiById, type PoiId } from './poi';
import { TrackerFx } from './trail';

export type Pin = { kind: 'poi'; id: PoiId } | { kind: 'point'; x: number; z: number };

export interface Target {
  source: 'pin' | 'tutorial' | 'goal';
  title: string;
  subtitle: string;
  glyph: string;
  position: THREE.Vector3;
  poi?: PoiId;
}

export interface CompassPip { id: string; glyph: string; rel: number; dist: number; tracked: boolean; unlocked: boolean }
export interface ScreenMarker { x: number; y: number; angle: number; edge: boolean }
export interface LabelView { id: PoiId; jp: string; name: string; x: number; y: number; opacity: number }
export interface NavView {
  heading: number;
  pips: CompassPip[];
  target: (Target & { dist: number }) | null;
  marker: ScreenMarker | null;
  labels: LabelView[];
}

const EMPTY_VIEW: NavView = { heading: 0, pips: [], target: null, marker: null, labels: [] };

export const navUi = {
  view: signal<NavView>(EMPTY_VIEW),
  // Bumped on each fast travel so the fade overlay restarts.
  travelFade: signal(0),
};

const STORE_KEY = 'zenko.nav.v1';
const PIP_RANGE = 120;
const MARKER_LIFT = 3.2;
const LABEL_FAR = 56;
const LABEL_NEAR = 12;
const MAX_LABELS = 3;
const MARKER_INSET = { left: 64, right: 64, top: 150, bottom: 170 };
// Screen areas other HUD pieces own. Edge markers and landmark names stay out of them.
const TOP_LEFT_COLUMN = { w: 380, h: 340 };
const TOP_RIGHT_PANEL = { w: 440, h: 290 };
const COMPASS_BAND = 170;

function loadStore(): { unlocked: PoiId[]; pin: Pin | null } {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as { unlocked?: unknown; pin?: Pin | null } | null;
    const unlocked = (Array.isArray(raw?.unlocked) ? raw.unlocked : []).filter((id): id is PoiId => POIS.some((p) => p.id === id));
    const pin = raw?.pin && (raw.pin.kind === 'point' || (raw.pin.kind === 'poi' && POIS.some((p) => p.id === (raw.pin as { id: PoiId }).id))) ? raw.pin : null;
    return { unlocked, pin };
  } catch { return { unlocked: [], pin: null }; }
}

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const wrapDeg = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

export class Navigation {
  readonly unlocked = signal<ReadonlySet<PoiId>>(new Set());
  readonly pin = signal<Pin | null>(null);
  // Pin beats tutorial step beats the current goal.
  readonly target = computed<Target | null>(() => {
    const pin = this.pin.value;
    if (pin?.kind === 'poi') { const p = poiById(pin.id); return { source: 'pin', title: p.name, subtitle: p.jp, glyph: p.glyph, position: p.at, poi: p.id }; }
    if (pin?.kind === 'point') return { source: 'pin', title: 'Map pin', subtitle: '印', glyph: '印', position: new THREE.Vector3(pin.x, 0, pin.z) };
    const st = appState.value;
    if (st.kind === 'tutorial') {
      const step = tutorialUi.step.value;
      const t = step ? TUTORIAL_TARGETS[step.id] : undefined;
      if (!t) return null;
      if ('poi' in t) { const p = poiById(t.poi); return { source: 'tutorial', title: p.name, subtitle: p.jp, glyph: p.glyph, position: p.at, poi: p.id }; }
      return { source: 'tutorial', title: t.title, subtitle: t.jp, glyph: '標', position: t.at };
    }
    const goal = GOALS.find((g) => !this.unlocked.value.has(g.poi));
    if (!goal) return null;
    const p = poiById(goal.poi);
    return { source: 'goal', title: goal.title, subtitle: `${p.jp} · ${p.name}`, glyph: p.glyph, position: p.at, poi: p.id };
  });

  private readonly fx: TrackerFx;
  private readonly labelFade = new Map<PoiId, number>();
  private readonly tmp = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly cp = new THREE.Vector3();

  constructor(private game: Game) {
    const s = loadStore();
    this.unlocked.value = new Set(s.unlocked);
    this.pin.value = s.pin;
    effect(() => {
      try { localStorage.setItem(STORE_KEY, JSON.stringify({ unlocked: [...this.unlocked.value], pin: this.pin.value })); } catch { /* storage may be unavailable */ }
    });
    this.fx = new TrackerFx(game.renderer.scene);
    game.waypoints.sync(this.unlocked.value);
  }

  track(pin: Pin): void { this.pin.value = pin; this.game.audio.play('select_001', 0.35); }
  untrack(): void { this.pin.value = null; }
  isPinned(id: PoiId): boolean { const p = this.pin.value; return p?.kind === 'poi' && p.id === id; }

  // Fast travel is for calm moments: the player is in the open world and the waypoint has been visited.
  canTravel(id: PoiId): { ok: true } | { ok: false; reason: string } {
    if (!this.unlocked.value.has(id)) return { ok: false, reason: 'Visit its shrine once to unlock this waypoint.' };
    const st = appState.value;
    const from = st.kind === 'paused' ? st.resume.kind : st.kind;
    if (from === 'encounter') return { ok: false, reason: 'Not during a fight.' };
    if (from === 'tutorial') return { ok: false, reason: 'Finish the tutorial first.' };
    if (from !== 'explore') return { ok: false, reason: 'Not right now.' };
    const poi = poiById(id);
    if (this.game.player.position.distanceTo(poi.arrive) < 4) return { ok: false, reason: 'You are already here.' };
    return { ok: true };
  }

  travel(id: PoiId): boolean {
    if (!this.canTravel(id).ok) return false;
    const g = this.game;
    const poi = poiById(id);
    resume();
    g.player.teleport(poi.arrive);
    g.cam.yaw = poi.yaw;
    g.cam.pitch = 0;
    g.input.requestLock();
    navUi.travelFade.value++;
    toast(`Fast travel: ${poi.name}`);
    g.audio.play('confirmation_002', 0.5, 0.8);
    return true;
  }

  update(raw: number): void {
    if (this.game.input.hitAny('map')) this.toggleMap();
    if (!worldRuns.value) return;
    const g = this.game;
    const p = g.player.position;
    this.checkUnlocks(p);
    this.checkArrival(p);

    const cam = g.renderer.camera;
    cam.updateMatrixWorld();
    const heading = THREE.MathUtils.radToDeg(-g.cam.yaw);
    const target = this.target.value;
    const targetDist = target ? p.distanceTo(target.position) : 0;

    const pips: CompassPip[] = [];
    for (const poi of POIS) {
      const d = p.distanceTo(poi.at);
      if (d > PIP_RANGE) continue;
      pips.push({ id: poi.id, glyph: poi.glyph, rel: this.relative(p, poi.at, heading), dist: d, tracked: target?.poi === poi.id, unlocked: this.unlocked.value.has(poi.id) });
    }
    if (target && !target.poi) pips.push({ id: 'target', glyph: target.glyph, rel: this.relative(p, target.position, heading), dist: targetDist, tracked: true, unlocked: false });

    navUi.view.value = {
      heading,
      pips,
      target: target ? { ...target, dist: targetDist } : null,
      marker: target ? this.screenMarker(cam, target.position) : null,
      labels: this.labels(cam, p, raw),
    };
    this.fx.update(raw, g.clock.time, p, target?.position ?? null, g.physics);
  }

  private toggleMap(): void {
    const g = this.game;
    const st = appState.value;
    if (st.kind === 'paused') {
      if (st.resume.kind === 'title') return;
      if (st.tab === 'map') { resume(); g.input.requestLock(); } else setState({ ...st, tab: 'map' });
    } else if (worldRuns.value && st.kind !== 'cinematic' && !g.cam.inShot) {
      pause('map');
      g.input.releaseLock();
    }
  }

  private checkUnlocks(p: THREE.Vector3): void {
    for (const poi of POIS) {
      if (this.unlocked.value.has(poi.id)) continue;
      if (Math.abs(p.y - poi.shrine.y) > 4 || Math.hypot(p.x - poi.shrine.x, p.z - poi.shrine.z) > UNLOCK_RADIUS) continue;
      this.unlocked.value = new Set([...this.unlocked.value, poi.id]);
      this.game.waypoints.unlock(poi.id);
      toast(`Waypoint unlocked: ${poi.name}. Fast travel from the map (M).`, 'good');
      this.game.audio.play('confirmation_001', 0.5);
    }
  }

  private checkArrival(p: THREE.Vector3): void {
    const pin = this.pin.value;
    const t = this.target.value;
    if (!pin || !t || t.source !== 'pin') return;
    if (Math.abs(p.y - t.position.y) > 6 || Math.hypot(p.x - t.position.x, p.z - t.position.z) > ARRIVE_RADIUS) return;
    this.pin.value = null;
    toast(`Arrived: ${t.title}`, 'good');
  }

  // Degrees from the view direction to a point, positive to the right.
  private relative(from: THREE.Vector3, to: THREE.Vector3, heading: number): number {
    const bearing = THREE.MathUtils.radToDeg(Math.atan2(to.x - from.x, -(to.z - from.z)));
    return wrapDeg(bearing - heading);
  }

  // Where the tracked marker sits on screen. Off-screen or behind the camera it clamps to the screen edge and turns into an arrow.
  private screenMarker(cam: THREE.PerspectiveCamera, at: THREE.Vector3): ScreenMarker {
    const w = window.innerWidth, h = window.innerHeight;
    const cp = this.cp.copy(at).setY(at.y + MARKER_LIFT).applyMatrix4(cam.matrixWorldInverse);
    const behind = cp.z > -0.05;
    const ndc = this.tmp.copy(cp).applyMatrix4(cam.projectionMatrix);
    const sx = (ndc.x * 0.5 + 0.5) * w, sy = (0.5 - ndc.y * 0.5) * h;
    const { left, right, top, bottom } = MARKER_INSET;
    if (!behind && sx >= left && sx <= w - right && sy >= top && sy <= h - bottom) return { x: sx, y: sy, angle: 0, edge: false };
    let dx = cp.x, dy = -cp.y;
    if (Math.hypot(dx, dy) < 1e-4) { dx = 0; dy = 1; }
    if (behind && Math.abs(dx) < 0.02) dy = Math.max(dy, 0.5);
    const cx = w / 2, cy = h / 2;
    const kx = dx === 0 ? Infinity : (dx > 0 ? w - right - cx : cx - left) / Math.abs(dx);
    const ky = dy === 0 ? Infinity : (dy < 0 ? cy - top : h - bottom - cy) / Math.abs(dy);
    const s = Math.min(kx, ky);
    let x = cx + dx * s, y = cy + dy * s;
    if (x < TOP_LEFT_COLUMN.w && y < TOP_LEFT_COLUMN.h) { if (x < left + 1) y = TOP_LEFT_COLUMN.h; else x = TOP_LEFT_COLUMN.w; }
    if (x > w - TOP_RIGHT_PANEL.w && y < TOP_RIGHT_PANEL.h) { if (x > w - right - 1) y = TOP_RIGHT_PANEL.h; else x = w - TOP_RIGHT_PANEL.w; }
    return { x, y, angle: THREE.MathUtils.radToDeg(Math.atan2(dx, -dy)), edge: true };
  }

  private labels(cam: THREE.PerspectiveCamera, p: THREE.Vector3, raw: number): LabelView[] {
    const w = window.innerWidth, h = window.innerHeight;
    const out: LabelView[] = [];
    const eye = cam.position;
    for (const poi of POIS) {
      const d = Math.hypot(poi.at.x - p.x, poi.at.z - p.z);
      let want = smooth(LABEL_FAR, LABEL_FAR - 18, d) * smooth(LABEL_NEAR, LABEL_NEAR + 6, d);
      const cp = this.cp.copy(poi.label).applyMatrix4(cam.matrixWorldInverse);
      const ndc = this.tmp.copy(cp).applyMatrix4(cam.projectionMatrix);
      const sx = (ndc.x * 0.5 + 0.5) * w, sy = (0.5 - ndc.y * 0.5) * h;
      if (want > 0 && cp.z < -0.5 && sx > 0 && sx < w && sy > 0 && sy < h) {
        const dir = this.dir.copy(poi.label).sub(eye);
        const len = dir.length();
        if (this.game.physics.castRay(eye, dir.normalize(), len - 0.5, GROUP_WORLD)) want = 0;
      } else want = 0;
      const cur = this.labelFade.get(poi.id) ?? 0;
      const next = cur + (want - cur) * (1 - Math.exp(-7 * raw));
      this.labelFade.set(poi.id, next);
      const opacity = next * clearOfHud(sx, sy, w, h);
      if (opacity < 0.02) continue;
      out.push({ id: poi.id, jp: poi.jp, name: poi.name, x: sx, y: sy, opacity });
    }
    out.sort((a, b) => b.opacity - a.opacity);
    return out.slice(0, MAX_LABELS);
  }
}

// 0 over the compass, the top-left column, and the top-right panel; 1 in the open world.
function clearOfHud(x: number, y: number, w: number, h: number): number {
  const away = (v: number, edge: number) => smooth(edge, edge + 60, v);
  const top = smooth(COMPASS_BAND - 40, COMPASS_BAND + 30, y);
  const left = Math.max(away(x, TOP_LEFT_COLUMN.w), away(y, TOP_LEFT_COLUMN.h));
  const right = Math.max(away(w - x, TOP_RIGHT_PANEL.w), away(y, TOP_RIGHT_PANEL.h));
  const bottom = 1 - smooth(h - 190, h - 90, y);
  return top * left * right * bottom;
}
