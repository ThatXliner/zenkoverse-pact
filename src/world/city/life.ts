import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Assets } from '../../app/assets';
import { Avatar, type CharacterModel } from '../../character/avatar';
import { toon, faceted } from '../../render/materials';
import { RAIL, ODORI, PROMENADE, UNDER, KURODA } from './plan';
import { rng } from './kit';

// What moves in the ward on its own, kept cheap: a commuter train that pulls
// in, waits and leaves, and an express that runs through on the far track
// (one mesh each); crows on the wires and roof edges that lift off when
// someone comes close (two instanced draws); a few people walking their
// pavements, drawn and animated only near the camera; and two men in black
// at the Kuroda gate who turn their heads to watch whoever passes.

export interface Life { group: THREE.Group; update(time: number, dt: number, player: THREE.Vector3, camera: THREE.Camera): void; dispose(): void }

const TRAIN_PERIOD = 52;
const CAR = 19.5;

export function buildLife(origin: THREE.Vector3, assets: Assets, parent: THREE.Object3D): Life {
  const group = new THREE.Group();
  group.name = 'city-life';
  group.userData.keep = true;
  parent.add(group);
  const O = origin;
  const at = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x + O.x, y + O.y, z + O.z);
  const r = rng(31);
  const disposers: (() => void)[] = [];

  // ------------------------------------------------------------ trains
  const mat = toon(0xffffff);
  mat.vertexColors = true;
  const local = makeTrain(4, 0x3f8a5a);
  const express = makeTrain(6, 0x2f4a7a);
  const stopping = new THREE.Mesh(local, mat), through = new THREE.Mesh(express, mat);
  for (const m of [stopping, through]) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = true; group.add(m); }
  const trackY = RAIL.deckY + 0.36;
  disposers.push(() => { local.dispose(); express.dispose(); mat.dispose(); });

  // ------------------------------------------------------------ crows
  const perches: THREE.Vector3[] = [
    at(-49.6, 8.15, 27.5), at(-48.4, 8.15, 27.5), at(-24.8, 8.15, 27.5), at(12.4, 8.15, 27.5), at(13.2, 8.15, 27.5), at(37.4, 8.15, 27.5),
    at(-9, 7.85, -13.95), at(-7.4, 7.85, -13.95), at(6.5, 7.75, -13.95), at(-12.8, 7.65, 17.9), at(-42, 4.95, 4.6), at(-40.6, 4.95, 4.6),
    at(52, 9.75, -9.9), at(56, 9.75, -9.9), at(-32, 6.55, -18.95), at(30, 20.1, -19.1),
  ];
  const CROWS = 11;
  const crowBody = faceted(mergeGeometries([
    new THREE.BoxGeometry(0.16, 0.16, 0.36).translate(0, 0.12, 0),
    new THREE.ConeGeometry(0.07, 0.18, 4).rotateX(-Math.PI / 2).translate(0, 0.2, -0.24),
    new THREE.BoxGeometry(0.12, 0.03, 0.22).translate(0, 0.12, 0.26),
  ])!);
  const crowWing = new THREE.BoxGeometry(0.34, 0.025, 0.2).translate(0.17, 0, 0);
  const crowMat = toon(0x1c1a20);
  const bodies = new THREE.InstancedMesh(crowBody, crowMat, CROWS);
  const wings = new THREE.InstancedMesh(crowWing, crowMat, CROWS * 2);
  for (const m of [bodies, wings]) { m.castShadow = true; m.frustumCulled = false; group.add(m); }
  disposers.push(() => { crowBody.dispose(); crowWing.dispose(); crowMat.dispose(); });
  interface Crow { perch: number; from: THREE.Vector3; to: THREE.Vector3; t: number; flying: boolean; dur: number; yaw: number; rest: number; peck: number }
  const used = new Set<number>();
  const free = (): number => { let i = Math.floor(r() * perches.length); while (used.has(i)) i = (i + 1) % perches.length; return i; };
  const crows: Crow[] = Array.from({ length: CROWS }, () => { const p = free(); used.add(p); return { perch: p, from: perches[p]!.clone(), to: perches[p]!.clone(), t: 1, flying: false, dur: 1, yaw: r() * 6, rest: 0, peck: r() * 5 }; });
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s1 = new THREE.Vector3(1, 1, 1), pos = new THREE.Vector3(), mid = new THREE.Vector3();

  // ------------------------------------------------------------ people
  interface Walker { avatar: Avatar; path: THREE.Vector3[]; i: number; pos: THREE.Vector3; speed: number; yaw: number; pause: number; guard?: THREE.Vector3; vel: THREE.Vector3 }
  const walkers: Walker[] = [];
  const looks: CharacterModel[] = ['buzzed', 'long', 'buns', 'beard', 'bald', 'parted'];
  const coats = [0x4a5566, 0x7a6a58, 0x5f6b4f, 0x8a8478, 0x3d4a5e, 0x6e5a62];
  const paths: [number, number][][] = [
    [[-58, ODORI.z0 + 0.6], [58, ODORI.z0 + 0.6]],
    [[-1.6, -12], [-1.6, 16]],
    [[1.4, 16.5], [1.4, -12.5]],
    [[-58, PROMENADE.z0 + 2.8], [58, PROMENADE.z0 + 2.8]],
    [[-60, UNDER.z1 - 0.9], [-26, UNDER.z1 - 0.9]],
  ];
  paths.forEach((p, i) => {
    const path = p.map(([x, z]) => at(x, 0.12, z));
    const avatar = new Avatar(assets, looks[i % looks.length]!, { targetHeight: 1.66 + r() * 0.16, tint: coats[i % coats.length] });
    const start = path[0]!.clone().lerp(path[1]!, 0.2 + r() * 0.6);
    avatar.root.position.copy(start);
    group.add(avatar.root);
    walkers.push({ avatar, path, i: 1, pos: start, speed: 1.15 + r() * 0.35, yaw: 0, pause: 0, vel: new THREE.Vector3() });
  });
  for (const dz of [-1.2, 6.2]) {
    const avatar = new Avatar(assets, dz < 0 ? 'buzzed' : 'bald', { targetHeight: 1.84, tint: 0x1f1b20, build: 1.12 });
    const p = at(KURODA.x0 - 1.6, 0.12, KURODA.gate.z0 + dz + (dz < 0 ? 0 : 0.6));
    avatar.root.position.copy(p);
    group.add(avatar.root);
    walkers.push({ avatar, path: [p], i: 0, pos: p.clone(), speed: 0, yaw: Math.PI / 2, pause: 0, guard: p.clone(), vel: new THREE.Vector3() });
  }
  disposers.push(() => { for (const w of walkers) w.avatar.root.removeFromParent(); });

  return {
    group,
    update(time, dt, player, camera) {
      // The local pulls in from the east, stands at the platform, and leaves west.
      {
        const t = time % TRAIN_PERIOD;
        let x: number;
        if (t < 9) x = 150 * (1 - t / 9) ** 2;
        else if (t < 21) x = 0;
        else x = -150 * ((t - 21) / 9) ** 2;
        stopping.visible = Math.abs(x) < 160;
        stopping.position.copy(at(x, trackY, RAIL.tracks[1]));
        // The express runs through the other way on the far track.
        const te = (time + 30) % TRAIN_PERIOD;
        const xe = -190 + te * 26;
        through.visible = xe > -190 && xe < 190;
        through.position.copy(at(xe, trackY, RAIL.tracks[0]));
        through.rotation.y = Math.PI;
      }
      // Crows: perched, they turn and peck now and then; anyone within a few
      // metres puts them up, and they glide off to another perch.
      crows.forEach((c, i) => {
        if (!c.flying) {
          c.rest += dt;
          const p = perches[c.perch]!;
          if (c.rest > 1.5 && p.distanceTo(player) < 6.5) {
            used.delete(c.perch);
            const n = free(); used.add(n);
            c.from.copy(p); c.to.copy(perches[n]!); c.perch = n; c.t = 0; c.flying = true; c.dur = 2.4 + c.from.distanceTo(c.to) / 9;
          }
        } else {
          c.t += dt / c.dur;
          if (c.t >= 1) { c.t = 1; c.flying = false; c.rest = 0; }
        }
        const t = c.t;
        mid.copy(c.from).lerp(c.to, 0.5).setY(Math.max(c.from.y, c.to.y) + 6 + c.from.distanceTo(c.to) * 0.15);
        if (c.flying) {
          const a = 1 - t;
          pos.set(0, 0, 0).addScaledVector(c.from, a * a).addScaledVector(mid, 2 * a * t).addScaledVector(c.to, t * t);
          const dx = c.to.x - c.from.x, dz = c.to.z - c.from.z;
          c.yaw = Math.atan2(-dx, -dz);
        } else {
          pos.copy(c.to);
          c.peck -= dt;
          if (c.peck < 0) { c.peck = 2 + r() * 5; c.yaw += (r() - 0.5) * 2; }
        }
        q.setFromEuler(e.set(c.flying ? -0.1 : 0, c.yaw, 0));
        m4.compose(pos, q, s1);
        bodies.setMatrixAt(i, m4);
        const flap = c.flying ? Math.sin(time * 18 + i) * (t > 0.85 ? 0.3 : 0.9) : -1.3;
        for (const side of [-1, 1]) {
          q.setFromEuler(e.set(0, c.yaw, 0)).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, side < 0 ? Math.PI : 0, side * flap * (side < 0 ? -1 : 1))));
          m4.compose(pos.clone().add(new THREE.Vector3(0, 0.15, 0)), q, s1);
          wings.setMatrixAt(i * 2 + (side < 0 ? 0 : 1), m4);
        }
      });
      bodies.instanceMatrix.needsUpdate = true;
      wings.instanceMatrix.needsUpdate = true;
      // People: walk their pavement and back, stop a step short of the
      // player, pause now and then. Far from the camera they neither draw nor animate.
      const cam = camera.position;
      for (const w of walkers) {
        const near = w.pos.distanceTo(cam) < 42;
        w.avatar.root.visible = near;
        if (w.guard) {
          // Watch the player while they are close; otherwise face the street.
          const d = player.distanceTo(w.pos);
          const want = d < 12 ? Math.atan2(-(player.x - w.pos.x), -(player.z - w.pos.z)) : Math.PI / 2;
          w.avatar.turnTo(want, dt, 3);
          if (near) { w.avatar.setLocomotion(w.vel.set(0, 0, 0), true, dt); w.avatar.update(dt); }
          continue;
        }
        const target = w.path[w.i]!;
        const to = target.clone().sub(w.pos).setY(0);
        const d = to.length();
        if (d < 0.4) { w.i = (w.i + 1) % w.path.length; if (w.i === 0) w.path.reverse(), w.i = 1; if (r() < 0.25) w.pause = 1.5 + r() * 3; continue; }
        w.pause = Math.max(0, w.pause - dt);
        const blocked = player.distanceTo(w.pos) < 1.3 && to.dot(player.clone().sub(w.pos)) > 0;
        const speed = w.pause > 0 || blocked ? 0 : w.speed;
        to.normalize();
        w.vel.copy(to).multiplyScalar(speed);
        w.pos.addScaledVector(w.vel, dt);
        w.avatar.root.position.copy(w.pos);
        if (speed > 0) w.yaw = Math.atan2(-to.x, -to.z);
        w.avatar.turnTo(w.yaw, dt, 6);
        if (near) { w.avatar.setLocomotion(w.vel, true, dt); w.avatar.update(dt); }
      }
    },
    dispose() {
      for (const d of disposers) d();
      group.removeFromParent();
    },
  };
}

// A commuter train of `cars` cars in one vertex-coloured mesh, its own
// origin at the middle of the train on the rail head, running along x.
function makeTrain(cars: number, stripe: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, color: number): void => {
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
    g.translate(x, y, z);
    const c = new THREE.Color(color), n = g.getAttribute('position').count;
    const cols = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    g.deleteAttribute('uv');
    parts.push(g);
  };
  const len = cars * (CAR + 0.6);
  for (let i = 0; i < cars; i++) {
    const cx = -len / 2 + (CAR + 0.6) * (i + 0.5);
    box(CAR, 2.9, 2.9, cx, 0.55 + 1.45, 0, 0xd9dcd8);
    box(CAR + 0.02, 0.32, 2.92, cx, 1.4, 0, stripe);
    box(CAR - 0.6, 0.12, 2.6, cx, 3.5, 0, 0xa9aeb0);
    // Windows and doors along both sides.
    for (const side of [-1, 1]) {
      for (let k = 0; k < 4; k++) box(1.3, 2.0, 0.04, cx - CAR / 2 + 2.4 + k * 4.9, 1.65, side * 1.47, 0x5a6670);
      for (let k = 0; k < 3; k++) box(2.4, 0.9, 0.04, cx - CAR / 2 + 4.85 + k * 4.9, 2.4, side * 1.47, 0x8ea7b8);
    }
    for (const dx of [-CAR / 2 + 2.6, CAR / 2 - 2.6]) box(2.6, 0.55, 2.2, cx + dx, 0.3, 0, 0x3a3640);
    for (let k = 0; k < 3; k++) box(1.6, 0.4, 1.4, cx - 4 + k * 4, 3.75, 0, 0x8a949e);
  }
  // Cab ends: a dark face, the headlights.
  for (const end of [-1, 1]) {
    box(0.1, 1.2, 2.4, end * (len / 2 - 0.3), 2.5, 0, 0x2a2f36);
    for (const dz of [-0.9, 0.9]) box(0.08, 0.2, 0.3, end * (len / 2 - 0.27), 1.2, dz, 0xf6f2dc);
  }
  return mergeGeometries(parts)!;
}
