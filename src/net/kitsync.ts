import * as THREE from 'three';
import type { Game } from '../app/game';
import type { Enemy } from '../combat/enemies';
import { heatWorld, heardFire, burningGround } from '../techniques/kits/heat';
import { lines, anchorPoint, LINES, showLine, paintLine, hideLine, type Anchor, type ShownLine } from '../techniques/kits/tensionLines';
import type { RemotePlayer } from './remote';
import { LINE_FLAG, type AnchorWire, type ClientMsg, type HeatWire, type LineWire } from './protocol';

// What the Techniques leave in the world that the effect wire cannot carry,
// because it lasts: the heat in props and bodies (Heat), and the lines a
// player has standing (Tension). Each screen reads its own kits' state and
// sends what changed; the others draw it. Nothing here decides a hit: the
// caster's screen keeps doing that, as it does for every Ability.

const HEAT_MS = 200;
const LINES_MS = 150;
// A standing line set is sent again this often even unchanged, so a screen
// that joins, or missed one, catches up.
const LINES_AGAIN_MS = 1000;

const r2 = (x: number) => Math.round(x * 100) / 100;
const r1 = (x: number) => Math.round(x * 10) / 10;

// `lit` when the fire is this screen's own: only the screen that lit a fire says when it is out.
interface Sent { heat: number; fire: number; at: number; lit: boolean }
interface Shown { wire: LineWire; line: ShownLine }

export class KitSync {
  // Per prop id, the heat and fire this screen last sent or heard, and when:
  // every screen cools a prop at the same rate, so only a rise is news.
  private sent = new Map<number, Sent>();
  private burnSent = new Map<number, { left: number; at: number }>();
  private heatAt = 0;
  private linesAt = 0;
  private linesKey = '[]';
  // Another player's lines, by their id, as their screen last sent them.
  private shown = new Map<number, Shown[]>();
  // When this player's own body stops burning, by another player's Heat (performance.now ms).
  private burnUntil = 0;

  constructor(private game: Game, private send: (m: ClientMsg) => void, private me: () => number | null, private remotes: Map<number, RemotePlayer>) {}

  // ---------------------------------------------------------------- sending

  update(now: number, connected: boolean): void {
    if (connected) {
      if (now - this.heatAt >= HEAT_MS) { this.heatAt = now; this.sendHeat(now); }
      if (now - this.linesAt >= LINES_MS) this.sendLines(now);
    }
    this.drawLines();
    const g = this.game;
    // A body another player's Heat is burning glows here too, as it does on theirs.
    if (g.techniqueId !== 'heat') g.avatar.heat = Math.max(0, Math.min(1, (this.burnUntil - now) / 1000)) * 0.9;
  }

  private sendHeat(now: number): void {
    const { fires, burns } = heatWorld();
    const p: [number, number, number][] = [];
    for (const prop of this.game.props.instances) {
      if (!prop.alive) continue;
      const s = this.sent.get(prop.id);
      const dt = s ? (now - s.at) / 1000 : 0;
      const expect = s ? Math.max(0, s.heat - (prop.cools ?? 0.06) * dt) : 0;
      const expectFire = s ? Math.max(0, s.fire - dt) : 0;
      const fire = fires.get(prop) ?? 0;
      // A rise is news; a fall is the cooling every screen runs, or a reset
      // here. A fire lit here is news, and so is its going out.
      const lit = fire > 0 && (!s?.lit || Math.abs(fire - expectFire) > 0.5);
      const out = fire <= 0 && !!s?.lit && expectFire > 0;
      if (prop.heat > expect + 0.05 || lit || out) {
        const shown = fire > 0 || out ? fire : expectFire;
        p.push([prop.id, r2(prop.heat), r1(shown)]);
        this.sent.set(prop.id, { heat: prop.heat, fire: shown, at: now, lit: fire > 0 || (!!s?.lit && !out) });
      }
      if (p.length >= 64) break;
    }
    const b: [number, number][] = [];
    for (const [e, left] of burns) {
      const id = this.playerOf(e);
      if (id === null) continue;
      const s = this.burnSent.get(id);
      if (s && left <= s.left - (now - s.at) / 1000 + 0.2) continue;
      b.push([id, r1(left)]);
      this.burnSent.set(id, { left, at: now });
    }
    if (p.length || b.length) this.send({ type: 'heat', ...(p.length ? { p } : {}), ...(b.length ? { b } : {}) });
  }

  private playerOf(e: Enemy): number | null {
    const id = (e as RemotePlayer).id;
    return typeof id === 'number' && this.remotes.get(id) === e ? id : null;
  }

  private anchorWire(a: Anchor): AnchorWire {
    const g = this.game;
    switch (a.kind) {
      case 'fixed': return [0, r2(a.at.x), r2(a.at.y), r2(a.at.z), a.pin ? 1 : 0];
      case 'prop': return [1, a.prop.id, r2(a.local.x), r2(a.local.y), r2(a.local.z)];
      case 'body': {
        const id = this.playerOf(a.enemy);
        if (id !== null) return [2, id];
        const p = anchorPoint(g, a);
        return [0, r2(p.x), r2(p.y), r2(p.z), 0];
      }
      case 'hand': return [3];
    }
  }

  private sendLines(now: number): void {
    // Tension's lines live only while Tension is in hand; otherwise there are none.
    const list = this.game.techniqueId === 'tension' ? lines.list : [];
    const l: LineWire[] = list.slice(0, 32).map((s) => [this.anchorWire(s.a), this.anchorWire(s.b), s.loose > 0 ? LINE_FLAG.loose : 0, r1(s.drawn), r1(Math.min(1, s.life / LINES.fade))]);
    const key = JSON.stringify(l);
    if (key === this.linesKey && (!l.length || now - this.linesAt < LINES_AGAIN_MS)) return;
    this.linesAt = now;
    this.linesKey = key;
    this.send({ type: 'lines', ct: now, l });
  }

  // ---------------------------------------------------------------- hearing

  heat(m: HeatWire): void {
    const g = this.game, now = performance.now();
    for (const [id, heat, fire] of m.p ?? []) {
      const p = g.props.byId(id);
      if (!p?.alive) continue;
      g.props.warm(p, heat - p.heat);
      heardFire(g, p, fire);
      // Heard is as good as sent: this screen does not pass it back.
      this.sent.set(id, { heat, fire, at: now, lit: false });
    }
    for (const [id, seconds] of m.b ?? []) {
      if (id === this.me()) this.burnUntil = Math.max(this.burnUntil, now + seconds * 1000);
      else { const r = this.remotes.get(id); if (r) r.burnUntil = Math.max(r.burnUntil, now + seconds * 1000); }
    }
  }

  lines(id: number, l: LineWire[]): void {
    const g = this.game;
    const had = this.shown.get(id) ?? [];
    const next: Shown[] = l.map((wire, i) => {
      // Pins and knots stand at the fixed ends: kept while those ends stay put.
      const ends = [wire[0], wire[1]].filter((a): a is Extract<AnchorWire, [0, ...number[]]> => a[0] === 0).map((a) => ({ at: new THREE.Vector3(a[1], a[2], a[3]), pin: a[4] === 1 }));
      const key = JSON.stringify(ends);
      const old = had[i];
      if (old && old.line.key === key) return { wire, line: old.line };
      if (old) hideLine(g, old.line);
      return { wire, line: showLine(g, ends, key) };
    });
    for (const s of had.slice(l.length)) hideLine(g, s.line);
    if (next.length) this.shown.set(id, next); else this.shown.delete(id);
  }

  private point(owner: RemotePlayer, a: AnchorWire, out: THREE.Vector3): THREE.Vector3 | null {
    const g = this.game;
    switch (a[0]) {
      case 0: return out.set(a[1], a[2], a[3]);
      case 1: { const p = g.props.byId(a[1]); return p?.alive ? p.mesh.localToWorld(out.set(a[2], a[3], a[4])) : null; }
      case 2: {
        if (a[1] === this.me()) return out.copy(g.player.position).add(new THREE.Vector3(0, 0.94, 0));
        const r = this.remotes.get(a[1]);
        return r && r.alive && !r.elsewhere ? out.copy(r.position).add(new THREE.Vector3(0, Math.min(1.0, r.height * 0.52), 0)) : null;
      }
      case 3: return owner.avatar.boneWorld('index_04_leaf_r', out);
    }
  }

  private drawLines(): void {
    const pa = new THREE.Vector3(), pb = new THREE.Vector3();
    for (const [id, list] of this.shown) {
      const owner = this.remotes.get(id);
      for (const { wire, line } of list) {
        const a = owner && !owner.elsewhere ? this.point(owner, wire[0], pa) : null;
        const b = a && owner ? this.point(owner, wire[1], pb) : null;
        if (!a || !b) { line.mesh.visible = false; continue; }
        paintLine(this.game, line, a, b, (wire[2] & LINE_FLAG.loose) !== 0, wire[3], wire[4]);
      }
    }
  }

  // A player left: their lines go with them.
  forget(id: number): void { this.lines(id, []); this.burnSent.delete(id); }

  clear(): void { for (const id of [...this.shown.keys()]) this.forget(id); }

  dispose(): void {
    this.clear();
    this.sent.clear();
    this.burnUntil = 0;
    if (this.game.techniqueId !== 'heat') this.game.avatar.heat = 0;
  }

  // For the checks: what this screen shows of the others' kits.
  view(): { lines: Record<number, { ends: ([number, number, number] | null)[]; loose: boolean; drawn: number; visible: boolean }[]>; burning: number; fires: number } {
    const out: Record<number, { ends: ([number, number, number] | null)[]; loose: boolean; drawn: number; visible: boolean }[]> = {};
    for (const [id, list] of this.shown) {
      const owner = this.remotes.get(id);
      out[id] = list.map(({ wire, line }) => ({
        ends: [wire[0], wire[1]].map((w) => { const p = owner ? this.point(owner, w, new THREE.Vector3()) : null; return p ? [p.x, p.y, p.z] as [number, number, number] : null; }),
        loose: (wire[2] & LINE_FLAG.loose) !== 0, drawn: wire[3], visible: line.mesh.visible,
      }));
    }
    return { lines: out, burning: Math.max(0, this.burnUntil - performance.now()) / 1000, fires: burningGround(this.game).length };
  }
}
