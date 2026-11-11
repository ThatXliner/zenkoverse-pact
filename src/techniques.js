import * as THREE from 'three';
import { sfx } from './audio.js';
import { ARENA_RADIUS } from './world.js';

const tmp = new THREE.Vector3();
const spikeGeo = new THREE.ConeGeometry(0.35, 1.6, 5);
const iceMat = new THREE.MeshStandardMaterial({ color: 0xbfefff, emissive: 0x3aa8d8, emissiveIntensity: 0.8, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.85 });
const orbGeo = new THREE.SphereGeometry(1, 16, 12);

function facingDir(p) { return new THREE.Vector3(Math.sin(p.facing), 0, Math.cos(p.facing)); }

// Projectile helper for the player. `atk` tracks the cast for Wagers.
function shoot(g, atk, opts) {
  atk.pending++;
  const mesh = opts.mesh ?? new THREE.Mesh(orbGeo, new THREE.MeshBasicMaterial({ color: opts.color, transparent: true, opacity: 0.9 }));
  if (!opts.mesh) mesh.scale.setScalar(opts.radius * 0.8);
  mesh.position.copy(opts.pos);
  g.scene.add(mesh);
  g.pProj.push({ hitSet: new Set(), life: 1, pierce: false, ...opts, atk, mesh, pos: opts.pos.clone() });
}

function arcStrike(g, atk, range, halfAngle, dmg, color, opts = {}) {
  const p = g.player;
  const dir = facingDir(p);
  for (const e of g.enemiesInArc(p.pos, dir, range, halfAngle)) {
    g.hitEnemy(e, dmg, atk, { knock: opts.knock ?? 6, dir: tmp.copy(e.pos).sub(p.pos).normalize().clone(), kind: opts.kind ?? 'mechanical' });
  }
  g.slash(p.pos, p.facing, range, halfAngle, color);
}

export const TECH_IMPL = {
  recoil: {
    init(p) { p.res = 0; p.resMax = 100; },
    regen(g, p, dt) { p.res = Math.max(0, p.res - dt * 1.5); },
    // RMB is a held guard, checked by the damage pipeline.
    guarding(g, p) { return g.input.rmb && !p.sealed; },
    primary(g, power = 1, vault = false) {
      const p = g.player;
      const atk = g.beginAttack();
      const spent = vault ? 25 : Math.min(p.res, 35);
      if (!vault) p.res -= spent;
      if (spent < 6) {
        const before = atk.hits;
        arcStrike(g, atk, 2.8, 0.95, 14 * power, 0xff7a2f);
        if (atk.hits > before && !vault) p.res = Math.min(p.resMax, p.res + 9 * (atk.hits - before));
        sfx.swing();
      } else {
        const dir = facingDir(p);
        const r = 0.5 + spent / 40;
        shoot(g, atk, {
          pos: p.pos.clone().setY(1.1).addScaledVector(dir, 0.8), vel: dir.multiplyScalar(30), radius: r,
          dmg: (12 + spent * 1.7) * power, color: 0xff9a4a, life: 0.6, pierce: spent > 25, knock: 4 + spent / 5,
          trail: 0xff7a2f,
        });
        sfx.heavy();
        g.shake(0.15 + spent / 200);
      }
      g.endAttack(atk);
      return 0.33;
    },
    secondary() { return 0; },
    max(g) {
      const p = g.player;
      const atk = g.beginAttack();
      const stored = p.res;
      p.res = 0;
      const dmg = 60 + stored * 2.6;
      for (const e of g.enemiesNear(p.pos, 10)) g.hitEnemy(e, dmg, atk, { knock: 22, dir: tmp.copy(e.pos).sub(p.pos).normalize().clone() });
      g.fx.ring(p.pos, { color: 0xff7a2f, to: 11, life: 0.6 });
      g.fx.ring(p.pos, { color: 0xffe0a0, to: 7, life: 0.4 });
      g.particles.emit(p.pos.clone().setY(1), { count: 220, color: 0xff7a2f, speed: 26, size: 0.6, life: 0.9 });
      g.banner('ZERO HOUR', `${Math.round(stored)} stored energy released in one motion`);
      g.shake(1.2);
      g.endAttack(atk);
    },
  },

  shift: {
    init(p) { p.res = 100; p.resMax = 100; p.momentum = 0; },
    regen(g, p, dt) { p.res = Math.min(p.resMax, p.res + dt * 24); p.momentum = Math.max(0, p.momentum - dt); },
    primary(g, power = 1) {
      const p = g.player;
      const atk = g.beginAttack();
      const carried = p.momentum > 0 ? 1.5 : 1;
      arcStrike(g, atk, 3.4, 1.05, 18 * power * carried, carried > 1 ? 0xffffff : 0x6fd3ff, { knock: carried > 1 ? 14 : 6 });
      if (carried > 1) g.number(p.pos, 'MOMENTUM', '#bff4ff');
      p.momentum = 0;
      sfx.swing();
      g.endAttack(atk);
      return 0.3;
    },
    secondary(g) {
      const p = g.player;
      if (!g.spend(30)) return 0;
      const atk = g.beginAttack();
      const from = p.pos.clone();
      const to = g.input.aim.clone().setY(0);
      const d = to.clone().sub(from);
      if (d.length() > 11) d.setLength(11);
      to.copy(from).add(d);
      clampArena(to);
      this.translate(g, from, to, atk, 10);
      p.momentum = 0.7;
      g.endAttack(atk);
      return 0.25;
    },
    translate(g, from, to, atk, dmg) {
      const p = g.player;
      for (const e of g.enemies) {
        if (distToSegment(e.pos, from, to) < e.radius + 0.8) g.hitEnemy(e, dmg, atk, { knock: 3, dir: to.clone().sub(from).normalize(), kind: 'spatial' });
      }
      g.particles.emit(from.clone().setY(1), { count: 40, color: 0x6fd3ff, speed: 5, size: 0.4 });
      for (let k = 0; k <= 10; k++) {
        const q = from.clone().lerp(to, k / 10).setY(1);
        g.particles.emit(q, { count: 3, color: 0xbff4ff, speed: 1, size: 0.3, life: 0.35, gravity: 0 });
      }
      p.pos.copy(to);
      // An occupied arrival point is a real Shift hazard.
      for (const pl of g.pillars) {
        const dx = p.pos.x - pl.x, dz = p.pos.z - pl.z;
        const dist = Math.hypot(dx, dz);
        if (dist < pl.r + p.radius) {
          const s = (pl.r + p.radius + 0.05) / (dist || 1);
          p.pos.x = pl.x + dx * s; p.pos.z = pl.z + dz * s;
          g.hurtPlayer(6, { kind: 'self', label: 'OCCUPIED ARRIVAL' });
        }
      }
      p.invuln = Math.max(p.invuln, 0.2);
      g.fx.ring(p.pos, { color: 0x6fd3ff, from: 2, to: 0.3, life: 0.25 });
      sfx.shift();
    },
    max(g) {
      const p = g.player;
      const atk = g.beginAttack();
      const from = p.pos.clone();
      const d = g.input.aim.clone().setY(0).sub(from);
      d.setLength(30);
      const to = from.clone().add(d);
      clampArena(to);
      this.translate(g, from, to, atk, 95);
      const line = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 0.4, from.distanceTo(to)),
        new THREE.MeshBasicMaterial({ color: 0xbff4ff, transparent: true }),
      );
      line.position.copy(from.clone().lerp(to, 0.5).setY(1));
      line.lookAt(to.clone().setY(1));
      g.fx.mesh(line, 0.5, (k) => { line.material.opacity = 1 - k; line.scale.x = line.scale.y = 1 + k * 4; });
      p.momentum = 1.2;
      g.banner('LONG TRANSLATION', 'No correction once movement begins');
      g.shake(0.8);
      g.endAttack(atk);
    },
  },

  rime: {
    init(p) { p.res = 0; p.resMax = 100; p.strainT = 0; },
    regen(g, p, dt) { p.strainT -= dt; if (p.strainT < 0) p.res = Math.max(0, p.res - dt * 22); },
    strain(g, amt) {
      const p = g.player;
      if (p.res >= 100) g.hurtPlayer(3, { kind: 'self', label: 'FROSTBITE' });
      p.res = Math.min(100, p.res + amt);
      p.strainT = 0.7;
    },
    primary(g, power = 1, vault = false) {
      const p = g.player;
      if (!vault) this.strain(g, 11);
      const atk = g.beginAttack();
      const dir = facingDir(p);
      let lastSpike = 0;
      let travelled = 0;
      shoot(g, atk, {
        pos: p.pos.clone().setY(0.6).addScaledVector(dir, 1), vel: dir.clone().multiplyScalar(22), radius: 1.3,
        dmg: 22 * power, life: 0.65, pierce: true, color: 0x9fe8ff, freeze: 0.5, slow: 2,
        mesh: new THREE.Object3D(),
        update(pr, dt) {
          travelled += 22 * dt;
          if (travelled - lastSpike > 0.6) {
            lastSpike = travelled;
            spawnSpike(g, pr.pos, 0.8 + Math.random() * 0.6, 1.4);
          }
        },
      });
      sfx.ice();
      g.endAttack(atk);
      return 0.4;
    },
    secondary(g) {
      const p = g.player;
      const atk = g.beginAttack();
      this.strain(g, 22);
      const c = g.input.aim.clone().setY(0);
      const d = c.clone().sub(p.pos);
      if (d.length() > 14) c.copy(p.pos).add(d.setLength(14));
      for (const e of g.enemiesNear(c, 3.2)) {
        g.hitEnemy(e, 10, atk, { knock: 0 });
        e.frozen = Math.max(e.frozen, 2.2);
      }
      for (let i = 0; i < 9; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * 2.6;
        spawnSpike(g, c.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)), 0.6 + Math.random() * 0.5, 2.2);
      }
      g.fx.ring(c, { color: 0x9fe8ff, from: 0.3, to: 3.4, life: 0.35 });
      sfx.ice();
      g.endAttack(atk);
      return 1.1;
    },
    max(g) {
      const p = g.player;
      const atk = g.beginAttack();
      p.rooted = 2.6;
      g.banner('TENFOLD GLACIER', 'Hands locked. Every nail bed at once');
      let r = 0;
      const hit = new Set();
      const holder = new THREE.Object3D();
      g.fx.mesh(holder, 1.6, (k) => {
        const nr = 2 + k * 20;
        for (; r < nr; r += 0.9) {
          const n = Math.floor(r * 1.2);
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 + Math.random() * 0.2;
            spawnSpike(g, p.pos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)), 0.9 + Math.random() * 1.2, 3.2);
          }
        }
        for (const e of g.enemies) {
          if (!hit.has(e) && e.pos.distanceTo(p.pos) < nr) {
            hit.add(e);
            g.hitEnemy(e, 55, atk, { knock: 0 });
            e.frozen = Math.max(e.frozen, 4);
          }
        }
        if (k >= 1) g.endAttack(atk);
      });
      this.strain(g, 40);
      g.shake(0.7);
      sfx.max();
    },
  },

  blink: {
    init(p) { p.res = 100; p.resMax = 100; p.stare = 0; },
    regen(g, p, dt) { p.res = Math.min(p.resMax, p.res + dt * 16); p.stare = Math.min(4, p.stare + dt); },
    stareMult(p) { return 1 + p.stare * 0.5; },
    pulse(g, atk, range, half, dmg, knock, color) {
      const p = g.player;
      const dir = facingDir(p);
      for (const e of g.enemiesInArc(p.pos, dir, range, half)) {
        g.hitEnemy(e, dmg, atk, { knock, dir: tmp.copy(e.pos).sub(p.pos).normalize().clone() });
      }
      g.slash(p.pos, p.facing, range, half, color, 0.06);
      const eye = p.pos.clone().setY(1.85);
      for (const side of [-0.12, 0.12]) {
        const off = new THREE.Vector3(Math.cos(p.facing) * side, 0, -Math.sin(p.facing) * side);
        g.particles.emit(eye.clone().add(off), { count: 30, color, speed: range * 3, dir, spread: half, size: 0.35, life: 0.35, gravity: 0, drag: 1 });
      }
    },
    primary(g, power = 1, vault = false) {
      const p = g.player;
      const atk = g.beginAttack();
      const m = vault ? 1.5 : this.stareMult(p);
      if (!vault) { p.stare = 0; }
      this.pulse(g, atk, 8.5, 0.58, 18 * power * m, 6 + m * 3, 0xc6a8ff);
      if (m >= 2.5) g.number(p.pos, `STARING ×${m.toFixed(1)}`, '#e2d4ff');
      sfx.pulse();
      g.shake(0.1 * m);
      g.endAttack(atk);
      return 0.42;
    },
    secondary(g) {
      const p = g.player;
      if (!g.spend(15)) return 0;
      const atk = g.beginAttack();
      const back = facingDir(p).multiplyScalar(-20);
      p.vel.copy(back);
      p.dashT = 0.2;
      this.pulse(g, atk, 4, 0.4, 8, 10, 0xe2d4ff);
      p.stare = 0;
      sfx.pulse();
      g.endAttack(atk);
      return 0.7;
    },
    max(g) {
      const p = g.player;
      const atk = g.beginAttack();
      const m = this.stareMult(p);
      this.pulse(g, atk, 17, 0.8, 110 * m, 30, 0xffffff);
      p.stare = 0;
      p.blind = 1.6;
      g.banner('EYES SHUT', 'Both glands emptied. You are blind');
      g.shake(1.3);
      sfx.max();
      g.endAttack(atk);
    },
  },

  echo: {
    init(p) { p.res = 100; p.resMax = 100; },
    regen(g, p, dt) {
      const quiet = this.quieting(g, p);
      p.res = quiet ? Math.max(0, p.res - dt * 26) : Math.min(p.resMax, p.res + dt * 20);
      if (quiet && !p.quietFx) { p.quietFx = true; }
      if (!quiet) p.quietFx = false;
    },
    quieting(g, p) { return g.input.rmb && p.res > 1 && !p.sealed; },
    primary(g, power = 1, vault = false) {
      const p = g.player;
      if (!vault && !g.spend(9)) return 0;
      const atk = g.beginAttack();
      const dir = facingDir(p);
      const arc = new THREE.Mesh(
        new THREE.RingGeometry(1.0, 1.25, 24, 1, -0.7, 1.4),
        new THREE.MeshBasicMaterial({ color: 0x7dffb2, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      arc.rotation.order = 'YXZ';
      arc.rotation.y = p.facing - Math.PI / 2;
      arc.rotation.x = -Math.PI / 2;
      shoot(g, atk, {
        pos: p.pos.clone().setY(1).addScaledVector(dir, 0.8), vel: dir.clone().multiplyScalar(20), radius: 1.5,
        dmg: 8 * power, life: 0.7, pierce: true, color: 0x7dffb2, mesh: arc, resonance: 1,
        update(pr, dt) { pr.mesh.scale.setScalar(1 + (0.7 - pr.life) * 2.4); pr.mesh.material.opacity = pr.life / 0.7; },
      });
      sfx.ring(0);
      g.endAttack(atk);
      return 0.26;
    },
    secondary() { return 0; },
    max(g) {
      const p = g.player;
      const atk = g.beginAttack();
      let shattered = 0;
      for (const e of g.enemiesNear(p.pos, 24)) {
        g.hitEnemy(e, 40 + 28 * e.res, atk, { knock: 4, dir: tmp.copy(e.pos).sub(p.pos).normalize().clone() });
        if (e.res) shattered++;
        e.res = 0;
      }
      g.hurtPlayer(10, { kind: 'self', label: 'SHARED VIBRATION' });
      for (let i = 0; i < 4; i++) setTimeout(() => g.fx.ring(p.pos, { color: 0x7dffb2, from: 1, to: 24, life: 0.8 }), i * 120);
      for (const pl of g.pillars) g.particles.emit({ x: pl.x, y: 2, z: pl.z }, { count: 40, color: 0x7dffb2, speed: 8, size: 0.4 });
      g.banner('CATHEDRAL RESONANCE', `${shattered} resonating bodies forced into one mode`);
      g.shake(1.5);
      sfx.max();
      g.endAttack(atk);
    },
  },
};

export function spawnSpike(g, pos, scale, life) {
  const s = new THREE.Mesh(spikeGeo, iceMat);
  s.position.set(pos.x, 0, pos.z);
  s.rotation.set((Math.random() - 0.5) * 0.6, Math.random() * 6, (Math.random() - 0.5) * 0.6);
  s.castShadow = true;
  g.fx.mesh(s, life, (k) => {
    const grow = Math.min(1, k * 10);
    const melt = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
    const sc = scale * grow * melt;
    s.scale.set(sc, sc, sc);
    s.position.y = 0.8 * sc - 0.2;
  });
}

export function clampArena(v) {
  const d = Math.hypot(v.x, v.z);
  const max = ARENA_RADIUS - 0.8;
  if (d > max) { v.x *= max / d; v.z *= max / d; }
  return v;
}

export function distToSegment(p, a, b) {
  const abx = b.x - a.x, abz = b.z - a.z;
  const len2 = abx * abx + abz * abz || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / len2));
  return Math.hypot(p.x - (a.x + abx * t), p.z - (a.z + abz * t));
}
