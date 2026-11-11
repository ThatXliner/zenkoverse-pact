import * as THREE from 'three';
import { ENEMIES } from './data.js';
import { buildFighter, HealthBar, buildAuraShell, setOpacity, animateFighter } from './actors.js';
import { sfx } from './audio.js';
import { clampArena } from './techniques.js';

const quillGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.1, 5);
const orbGeo = new THREE.SphereGeometry(1, 14, 10);
const v = new THREE.Vector3();

export function spawnEnemy(g, type, pos) {
  const def = ENEMIES[type];
  const scale = def.boss ? 1.6 : type === 'husk' ? 1.35 : 1;
  const f = buildFighter(def.color, { scale, kind: type, suit: def.suit ?? 0x3a3f58, skin: def.skin ?? 0xd8b49a });
  f.group.position.copy(pos);
  g.scene.add(f.group);
  const hpScale = 1 + g.waveIndex * 0.06;
  const e = {
    type, def, fighter: f, pos: f.group.position, vel: new THREE.Vector3(),
    radius: def.radius * scale, hp: def.hp * hpScale, maxHp: def.hp * hpScale,
    facing: 0, state: 'idle', t: 0, cd: 1 + Math.random(), slow: 0, frozen: 0, stun: 0,
    res: 0, resT: 0, flash: 0, alive: true, links: [], linkedTo: null, named: false, spawnT: 0.6,
  };
  if (!def.boss) e.bar = new HealthBar(f.group, 1.3, 2.6 * scale);
  if (type === 'husk') {
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(0.75, 16, 10, -Math.PI / 2.2, Math.PI / 1.1, 0.3, Math.PI * 0.6),
      new THREE.MeshStandardMaterial({ color: 0xe0d8c4, roughness: 0.7, side: THREE.DoubleSide, transparent: true, opacity: 0.95 }),
    );
    shell.position.set(0, 1.1, 0.15);
    shell.rotation.y = 0;
    f.inner.add(shell);
    e.shellMesh = shell;
  }
  if (def.veiled) setOpacity(f, 0.12);
  if (def.boss) {
    e.aura = { active: false, radius: 0, shell: buildAuraShell(def.color) };
    g.scene.add(e.aura.shell);
    e.phaseT = 0;
  }
  // Spawn flash.
  g.fx.ring(pos, { color: def.color, from: 3, to: 0.4, life: 0.5 });
  g.particles.emit(pos.clone().setY(1), { count: 30, color: def.color, speed: 4, size: 0.4 });
  g.enemies.push(e);
  return e;
}

function faceTo(e, target, dt, rate = 10) {
  const want = Math.atan2(target.x - e.pos.x, target.z - e.pos.z);
  let d = want - e.facing;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  e.facing += d * Math.min(1, rate * dt);
}

function enemyShoot(g, e, opts) {
  const mesh = opts.mesh ?? new THREE.Mesh(orbGeo, new THREE.MeshBasicMaterial({ color: opts.color }));
  if (!opts.mesh) mesh.scale.setScalar(opts.radius);
  mesh.position.copy(opts.pos);
  g.scene.add(mesh);
  g.eProj.push({ life: 3, kinetic: true, ...opts, mesh, pos: opts.pos.clone(), src: e });
}

function windup(g, e, time, next, tele) {
  e.state = 'windup';
  e.t = time;
  e.next = next;
  if (tele) g.telegraph(tele.pos, tele.radius, time, tele.color ?? 0xff3355, tele.arc);
}

export function updateEnemy(g, e, dt) {
  const p = g.player;
  const def = e.def;
  e.flash = Math.max(0, e.flash - dt * 6);
  animateFighter(e.fighter, g.time);
  if (e.resT > 0) { e.resT -= dt; if (e.resT <= 0) e.res = 0; }
  if (e.spawnT > 0) { e.spawnT -= dt; return; }

  const frozen = e.frozen > 0;
  if (frozen) e.frozen -= dt;
  if (e.stun > 0) e.stun -= dt;
  if (e.slow > 0) e.slow -= dt;
  let speedMul = e.slow > 0 ? 0.5 : 1;
  const pressure = g.playerAuraPressure(e);
  if (pressure) speedMul *= 0.45;
  const timeMul = pressure ? 0.6 : 1;

  // Knockback velocity decays regardless of state.
  e.pos.addScaledVector(e.vel, dt);
  e.vel.multiplyScalar(Math.exp(-6 * dt));

  if (frozen || e.stun > 0) {
    e.fighter.inner.rotation.z = Math.sin(performance.now() * 0.05) * (e.stun > 0 ? 0.08 : 0);
    return;
  }
  e.fighter.inner.rotation.z = 0;

  const toP = v.copy(p.pos).sub(e.pos);
  const dist = toP.length();
  const dir = toP.clone().normalize();
  e.cd -= dt * timeMul;

  const ai = AI[def.ai];
  ai(g, e, dt, { dist, dir, speedMul, timeMul });

  if (e.state === 'windup') {
    e.t -= dt * timeMul;
    e.fighter.inner.scale.setScalar((def.boss ? 1.6 : e.type === 'husk' ? 1.35 : 1) * (1 + Math.sin(e.t * 40) * 0.03));
    if (e.t <= 0) { e.state = 'idle'; e.next?.(); }
  }
  e.fighter.group.rotation.y = e.facing;
}

function chase(e, dir, dt, speed) {
  e.pos.x += dir.x * speed * dt;
  e.pos.z += dir.z * speed * dt;
}

const AI = {
  melee(g, e, dt, { dist, dir, speedMul }) {
    if (e.state !== 'windup') faceTo(e, g.player.pos, dt);
    if (e.state === 'idle') {
      if (dist > 1.9) chase(e, dir, dt, e.def.speed * speedMul);
      else if (e.cd <= 0) {
        windup(g, e, 0.45, () => {
          if (e.pos.distanceTo(g.player.pos) < 2.5) g.hurtPlayer(e.def.dmg * g.dmgScale(), { from: e.pos, kinetic: true, src: e });
          g.slash(e.pos, e.facing, 2.4, 0.9, e.def.color, 0.05);
          e.cd = 1.2;
        }, { pos: e.pos.clone(), radius: 2.4, arc: e.facing });
      }
    }
  },

  ranged(g, e, dt, { dist, dir, speedMul }) {
    faceTo(e, g.player.pos, dt);
    if (e.state !== 'idle') return;
    e.strafe = e.strafe ?? (Math.random() < 0.5 ? 1 : -1);
    const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(e.strafe);
    const want = dist < 9 ? dir.clone().negate() : dist > 15 ? dir.clone() : side;
    chase(e, want, dt, e.def.speed * speedMul);
    if (e.cd <= 0 && dist < 22) {
      windup(g, e, 0.35, () => {
        const d = g.player.pos.clone().sub(e.pos).setY(0).normalize();
        const mesh = new THREE.Mesh(quillGeo, new THREE.MeshBasicMaterial({ color: 0xffe28a }));
        mesh.lookAt(d);
        mesh.rotateX(Math.PI / 2);
        enemyShoot(g, e, { pos: e.pos.clone().setY(1.1), vel: d.multiplyScalar(19), radius: 0.35, dmg: e.def.dmg * g.dmgScale(), mesh, color: 0xffe28a });
        sfx.swing();
        e.cd = 1.6 + Math.random() * 0.6;
        if (Math.random() < 0.3) e.strafe *= -1;
      });
    }
  },

  lurker(g, e, dt, ctx) {
    // Concealed until it commits to an attack.
    const reveal = g.player.eye === 'empty' || e.state === 'windup' || e.flash > 0.1;
    setOpacity(e.fighter, reveal ? 1 : 0.12);
    if (e.state === 'idle' && e.cd <= 0 && ctx.dist < 6) {
      windup(g, e, 0.5, () => {
        g.addHazard('soot', e.pos.clone().addScaledVector(ctx.dir, 2), 3.2, 3);
        e.cd = 3;
      });
      return;
    }
    AI.melee(g, e, dt, ctx);
  },

  tank(g, e, dt, { dist, dir, speedMul }) {
    faceTo(e, g.player.pos, dt, 2.5);
    if (e.state !== 'idle') return;
    if (dist > 2.6) chase(e, dir, dt, e.def.speed * speedMul);
    else if (e.cd <= 0) {
      windup(g, e, 0.85, () => {
        if (e.pos.distanceTo(g.player.pos) < 3.4) g.hurtPlayer(e.def.dmg * g.dmgScale(), { from: e.pos, kinetic: true, src: e });
        g.fx.ring(e.pos, { color: 0xc9c0ad, to: 3.4, life: 0.35 });
        g.particles.emit(e.pos.clone().setY(0.3), { count: 40, color: 0x9a907d, speed: 9, size: 0.4 });
        g.shake(0.25);
        sfx.heavy();
        e.cd = 1.8;
      }, { pos: e.pos.clone(), radius: 3.4 });
    }
  },

  leaper(g, e, dt, { dist, dir, speedMul }) {
    faceTo(e, g.player.pos, dt);
    if (e.state === 'leap') {
      e.t += dt;
      const k = Math.min(1, e.t / 0.7);
      e.pos.lerpVectors(e.leapFrom, e.leapTo, k);
      e.pos.y = Math.sin(k * Math.PI) * 4;
      if (k >= 1) {
        e.pos.y = 0;
        e.state = 'idle';
        if (e.pos.distanceTo(g.player.pos) < 2.8) g.hurtPlayer(e.def.dmg * g.dmgScale(), { from: e.pos, kinetic: true, src: e });
        g.fx.ring(e.pos, { color: 0x6fe36b, to: 2.8, life: 0.3 });
        g.shake(0.2);
        sfx.heavy();
        e.cd = 2.4;
      }
      return;
    }
    if (e.state !== 'idle') return;
    if (dist > 12) chase(e, dir, dt, e.def.speed * speedMul);
    else if (e.cd <= 0) {
      const target = clampArena(g.player.pos.clone().addScaledVector(g.player.vel, 0.4));
      windup(g, e, 0.9, () => {
        e.state = 'leap';
        e.t = 0;
        e.leapFrom = e.pos.clone();
        e.leapTo = target;
      }, { pos: target, radius: 2.8, color: 0x6fe36b });
    } else chase(e, new THREE.Vector3(-dir.z, 0, dir.x), dt, e.def.speed * 0.5 * speedMul);
  },

  architect(g, e, dt, { dist, dir, speedMul }) {
    faceTo(e, g.player.pos, dt);
    // Programming: sustain up to four allies through links.
    e.links = e.links.filter((l) => l.alive);
    if (e.links.length < 4) {
      for (const o of g.enemies) {
        if (o === e || o.linkedTo || o.def.ai === 'architect' || o.def.boss || e.links.length >= 4) continue;
        o.linkedTo = e;
        e.links.push(o);
      }
    }
    for (const l of e.links) l.hp = Math.min(l.maxHp, l.hp + dt * 3);
    if (e.state !== 'idle') return;
    const want = dist < 13 ? dir.clone().negate() : new THREE.Vector3(-dir.z, 0, dir.x);
    chase(e, want, dt, e.def.speed * speedMul);
    if (e.cd <= 0) {
      windup(g, e, 0.6, () => {
        const d = g.player.pos.clone().sub(e.pos).setY(0).normalize();
        enemyShoot(g, e, { pos: e.pos.clone().setY(1.2), vel: d.multiplyScalar(9), radius: 0.45, dmg: 14 * g.dmgScale(), color: 0xb36bff, kinetic: false, homing: 1.4 });
        e.cd = 2.6;
      });
    }
  },

  kuroda(g, e, dt, { dist, dir, speedMul }) {
    faceTo(e, g.player.pos, dt, 4);
    e.phaseT -= dt;
    if (e.state !== 'idle') return;
    const enraged = e.hp < e.maxHp * 0.5;
    if (e.phaseT <= 0) {
      // Disperse fuel near the player, ignite later. The fuel is the Technique; the flame is not.
      const n = enraged ? 5 : 3;
      windup(g, e, 0.5, () => {
        for (let i = 0; i < n; i++) {
          const off = new THREE.Vector3((Math.random() - 0.5) * 9, 0, (Math.random() - 0.5) * 9);
          g.addHazard('fuel', clampArena(g.player.pos.clone().add(off)), 2.6 + Math.random(), 1.9);
        }
        e.phaseT = enraged ? 3.2 : 4.5;
      });
      return;
    }
    if (dist > 2.6) {
      chase(e, dir, dt, e.def.speed * speedMul * (enraged ? 1.3 : 1));
      if (enraged && Math.random() < dt * 3) g.addHazard('fuel', e.pos.clone(), 1.6, 1.4);
    } else if (e.cd <= 0) {
      windup(g, e, 0.5, () => {
        if (e.pos.distanceTo(g.player.pos) < 3.2) g.hurtPlayer(e.def.dmg * g.dmgScale(), { from: e.pos, kinetic: true, src: e });
        g.slash(e.pos, e.facing, 3.2, 1.1, 0xff6a1a, 0.05);
        e.cd = 1.1;
      }, { pos: e.pos.clone(), radius: 3.2, arc: e.facing, color: 0xff6a1a });
    }
  },

  ancient(g, e, dt, { dist, dir, speedMul }) {
    faceTo(e, g.player.pos, dt, 3);
    e.phaseT -= dt;
    const ratio = e.hp / e.maxHp;
    // Below 65% she expands her aura. Five thousand years of presence.
    if (ratio < 0.65 && !e.auraLearned) {
      e.auraLearned = true;
      g.banner('AURA EXPANSION', 'Her presence fills the roof. Hold F to contest it');
    }
    if (e.auraLearned && !e.aura.collapsed) e.aura.active = true;
    if (e.quiet > 0) e.quiet -= dt;

    if (e.state !== 'idle') return;
    if (e.phaseT <= 0) {
      const roll = Math.random();
      if (roll < 0.45) {
        windup(g, e, 0.7, () => {
          const n = ratio < 0.4 ? 3 : 2;
          for (let i = 0; i < n; i++) setTimeout(() => g.addRing(e.pos.clone(), 0x7dffb2, 11, 22 * g.dmgScale()), i * 650);
          sfx.ring(2);
        }, { pos: e.pos.clone(), radius: 4, color: 0x7dffb2 });
        e.phaseT = 3.4;
      } else if (roll < 0.75) {
        // Cathedral resonance of a pillar: make the structure participate in its own destruction.
        const pl = g.pillars.slice().sort((a, b) => Math.hypot(a.x - g.player.pos.x, a.z - g.player.pos.z) - Math.hypot(b.x - g.player.pos.x, b.z - g.player.pos.z))[0];
        const c = new THREE.Vector3(pl.x, 0, pl.z);
        windup(g, e, 1.1, () => {
          if (c.distanceTo(g.player.pos) < 6) g.hurtPlayer(26 * g.dmgScale(), { from: c, kinetic: true });
          g.fx.ring(c, { color: 0x7dffb2, to: 6, life: 0.4 });
          g.particles.emit(c.clone().setY(2), { count: 80, color: 0x7dffb2, speed: 12, size: 0.5 });
          g.shake(0.4);
          sfx.shatter();
        }, { pos: c, radius: 6, color: 0x7dffb2 });
        e.phaseT = 3;
      } else {
        e.quiet = 4;
        g.banner('FULL CANCELLATION', 'Mechanical attacks are erased. Spatial and close strikes still land');
        e.phaseT = 5;
      }
      return;
    }
    if (dist > 7) chase(e, dir, dt, e.def.speed * speedMul);
    else if (dist < 4 && e.cd <= 0) {
      windup(g, e, 0.45, () => {
        if (e.pos.distanceTo(g.player.pos) < 4) g.hurtPlayer(e.def.dmg * g.dmgScale(), { from: e.pos, kinetic: true, src: e });
        g.fx.ring(e.pos, { color: 0x7dffb2, to: 4, life: 0.25 });
        e.cd = 1.3;
      }, { pos: e.pos.clone(), radius: 4, color: 0x7dffb2 });
    } else {
      chase(e, new THREE.Vector3(-dir.z, 0, dir.x), dt, e.def.speed * 0.6 * speedMul);
      if (e.cd <= 0) {
        windup(g, e, 0.4, () => {
          for (let i = -1; i <= 1; i++) {
            const d = g.player.pos.clone().sub(e.pos).setY(0).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), i * 0.25);
            enemyShoot(g, e, { pos: e.pos.clone().setY(1.4), vel: d.multiplyScalar(15), radius: 0.4, dmg: 12 * g.dmgScale(), color: 0x7dffb2 });
          }
          sfx.ring(1);
          e.cd = 1.4;
        });
      }
    }
  },
};
