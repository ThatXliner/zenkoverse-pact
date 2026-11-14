import * as THREE from 'three';
import type { Game } from '../app/game';
import { RAPIER } from '../physics/world';
import type { PropAuthority, PropInstance } from '../world/props';
import { shatterProp } from '../techniques/kits/shared';
import type { ClientMsg, PropSnapshot, PropWire, Vec3 } from './protocol';
import { PROP_FLAG } from './protocol';

// Online, the compound's physics props are one simulation shared by the room
// (issue #58). Each moving prop has one owner, the screen that last acted on
// it: that screen simulates it and streams its pose; every other screen holds
// it kinematic and follows the stream. A prop at rest belongs to nobody, and
// every screen holds it at the same pose, the one its last owner set it down
// at. The server decides ownership (the last claim it hears wins), keeps
// every prop's health so a break happens once for the room, and remembers
// rest poses for whoever joins later.
//
// Acting on a prop someone else owns takes it over at once, so a blow always
// lands on the screen that dealt it; the old owner hears it and lets go.

const SEND_MS = 1000 / 15;
// A prop this screen simulates is moving when it is awake and faster than
// this, or held (kinematic) or frozen (fixed).
const STIRRED = 0.25;

interface Follow { pos: THREE.Vector3; quat: THREE.Quaternion; vel: THREE.Vector3; frozen: number; at: number }

const r3 = (x: number) => Math.round(x * 1000) / 1000;

export class PropSync implements PropAuthority {
  // Props this screen simulates and streams.
  private mine = new Set<number>();
  // Of those, the ones the server has not confirmed yet: their entries carry the claim flag.
  private claiming = new Set<number>();
  // Props another screen owns, with the latest pose it sent.
  private follow = new Map<number, Follow>();
  private lastSend = 0;
  // What the checks read: breaks heard from the server.
  readonly broken: number[] = [];

  constructor(private game: Game, private send: (m: ClientMsg) => void, private online: () => boolean, private quiet: (fn: () => void) => void) {
    game.props.authority = this;
  }

  // PropAuthority: this screen is about to move `p`.
  touch(p: PropInstance): void {
    if (!this.online() || this.mine.has(p.id)) return;
    this.take(p);
  }

  private take(p: PropInstance): void {
    this.adopt(p);
    this.claiming.add(p.id);
  }

  // This screen simulates `p` from here. If it was following someone else's
  // stream, it carries on from the pose and speed last streamed.
  private adopt(p: PropInstance): void {
    const f = this.follow.get(p.id);
    this.follow.delete(p.id);
    this.mine.add(p.id);
    if (!f) return;
    if (f.frozen > 0) { p.body.setBodyType(RAPIER.RigidBodyType.Fixed, true); p.frozen = f.frozen; return; }
    p.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    p.body.setLinvel(f.vel, true);
  }

  // Someone else simulates `p` now: hold it where it is until their stream arrives.
  private yieldTo(p: PropInstance): void {
    this.mine.delete(p.id);
    this.claiming.delete(p.id);
    p.frozen = 0;
    if (!this.follow.has(p.id)) {
      const t = p.body.translation(), q = p.body.rotation();
      this.follow.set(p.id, { pos: new THREE.Vector3(t.x, t.y, t.z), quat: new THREE.Quaternion(q.x, q.y, q.z, q.w), vel: new THREE.Vector3(), frozen: 0, at: performance.now() });
    }
    p.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
  }

  // Nobody simulates `p`: it falls from where it was drawn.
  private release(p: PropInstance): void {
    const f = this.follow.get(p.id);
    this.follow.delete(p.id);
    if (!f) return;
    p.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    p.body.setLinvel(f.vel, true);
  }

  // A rest pose: exactly here, still, asleep, and nobody's.
  private settle(p: PropInstance, w: PropWire): void {
    this.follow.delete(p.id);
    p.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    p.body.setTranslation({ x: w[1], y: w[2], z: w[3] }, true);
    p.body.setRotation({ x: w[4], y: w[5], z: w[6], w: w[7] }, true);
    p.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    p.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    p.mesh.position.set(w[1], w[2], w[3]);
    p.mesh.quaternion.set(w[4], w[5], w[6], w[7]);
    p.body.sleep();
  }

  // A blow on a prop: the server keeps its health and announces the break.
  hit(p: PropInstance, amount: number, from?: THREE.Vector3): void {
    const max = p.def.breakable?.hp ?? 1;
    const at = from ?? p.mesh.position;
    this.send({ type: 'prop-hit', prop: p.id, amount: Math.min(amount, max), max, from: [r3(at.x), r3(at.y), r3(at.z)] });
  }

  owner(prop: number, owner: number | null, me: number | null): void {
    const p = this.game.props.byId(prop);
    if (!p) return;
    // Claimed by this screen, or handed over from an owner who went quiet.
    if (owner === me) { this.adopt(p); this.claiming.delete(prop); return; }
    if (owner === null) {
      // Set down by its owner, or let go by an owner who went quiet with
      // nobody else playing: it is nobody's, and falls from here.
      this.mine.delete(prop);
      this.claiming.delete(prop);
      this.release(p);
      return;
    }
    this.yieldTo(p);
  }

  poses(entries: PropWire[]): void {
    const now = performance.now();
    for (const w of entries) {
      const p = this.game.props.byId(w[0]);
      if (!p || this.mine.has(p.id)) continue;
      if (w[11] & PROP_FLAG.rest) { this.settle(p, w); continue; }
      let f = this.follow.get(p.id);
      if (!f) {
        this.yieldTo(p);
        f = this.follow.get(p.id)!;
      }
      f.pos.set(w[1], w[2], w[3]);
      f.quat.set(w[4], w[5], w[6], w[7]);
      f.vel.set(w[8], w[9], w[10]);
      f.frozen = w[12];
      f.at = now;
    }
  }

  shattered(prop: number, from: Vec3): void {
    const p = this.game.props.byId(prop);
    this.broken.push(prop);
    this.forget(prop);
    if (p) this.quiet(() => shatterProp(this.game, p, new THREE.Vector3(...from)));
  }

  // The room as it stands when this screen joins or rejoins.
  welcome(s: PropSnapshot | undefined, me: number): void {
    // After a server restart nothing is confirmed: claim again what moves here.
    for (const id of this.mine) this.claiming.add(id);
    const owned = new Map(s?.owners ?? []);
    for (const [id] of this.follow) if (!owned.has(id)) { const p = this.game.props.byId(id); if (p) this.release(p); }
    if (!s) return;
    for (const id of s.broken) { const p = this.game.props.byId(id); this.forget(id); if (p) this.game.props.remove(p); }
    for (const w of s.rest) { const p = this.game.props.byId(w[0]); if (p && !this.mine.has(p.id) && !owned.has(p.id)) this.settle(p, w); }
    for (const [id, o] of s.owners) this.owner(id, o, me);
  }

  private forget(id: number): void { this.mine.delete(id); this.claiming.delete(id); this.follow.delete(id); }

  update(raw: number): void {
    if (!this.online()) return;
    const props = this.game.props;
    const k = 1 - Math.exp(-18 * raw);
    const now = performance.now();
    for (const p of props.instances) {
      const f = this.follow.get(p.id);
      if (f) {
        // Where their stream says it is now, a little ahead along its velocity.
        const ahead = Math.min(0.2, (now - f.at) / 1000);
        const t = p.body.translation(), q = p.body.rotation();
        const pos = new THREE.Vector3(t.x, t.y, t.z).lerp(f.pos.clone().addScaledVector(f.vel, ahead), k);
        const quat = new THREE.Quaternion(q.x, q.y, q.z, q.w).slerp(f.quat, k);
        p.body.setNextKinematicTranslation(pos);
        p.body.setNextKinematicRotation(quat);
        continue;
      }
      // Moved here by something no Technique touched (this player's body,
      // another prop): this screen simulates it, so this screen owns it.
      if (!this.mine.has(p.id) && p.body.bodyType() === RAPIER.RigidBodyType.Dynamic && !p.body.isSleeping()) {
        const v = p.body.linvel();
        if (Math.hypot(v.x, v.y, v.z) > STIRRED) this.take(p);
      }
    }
    if (now - this.lastSend < SEND_MS - 2) return;
    this.lastSend = now;
    const out: PropWire[] = [];
    for (const id of [...this.mine]) {
      const p = props.byId(id);
      if (!p) { this.forget(id); continue; }
      const dynamic = p.body.bodyType() === RAPIER.RigidBodyType.Dynamic;
      const resting = dynamic && (p.body.isSleeping() || (Math.hypot(p.body.linvel().x, p.body.linvel().y, p.body.linvel().z) < 0.02 && Math.hypot(p.body.angvel().x, p.body.angvel().y, p.body.angvel().z) < 0.02));
      const t = p.body.translation(), q = p.body.rotation(), v = dynamic ? p.body.linvel() : { x: 0, y: 0, z: 0 };
      const flags = (resting ? PROP_FLAG.rest : 0) | (this.claiming.has(id) ? PROP_FLAG.claim : 0);
      out.push([id, r3(t.x), r3(t.y), r3(t.z), r3(q.x), r3(q.y), r3(q.z), r3(q.w), r3(v.x), r3(v.y), r3(v.z), flags, r3(Math.max(0, p.frozen))]);
      // Set down: nobody's now, at the pose just sent.
      if (resting) { this.mine.delete(id); this.claiming.delete(id); }
      if (out.length >= 64) break;
    }
    if (out.length) this.send({ type: 'props', s: out });
  }

  // Offline again: every prop is this screen's alone.
  dispose(): void {
    for (const id of this.follow.keys()) { const p = this.game.props.byId(id); if (p) p.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true); }
    this.follow.clear();
    this.mine.clear();
    this.claiming.clear();
    if (this.game.props.authority === this) this.game.props.authority = null;
  }

  // For the checks: who simulates each prop as this screen sees it.
  view(): { mine: number[]; following: number[] } { return { mine: [...this.mine], following: [...this.follow.keys()] }; }
}
