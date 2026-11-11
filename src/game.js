import * as THREE from 'three';
import { TECHNIQUES, PACTS, WAVES } from './data.js';
import { buildFighter, setFlash, buildAuraShell, setOpacity, animateFighter } from './actors.js';
import { Particles, Effects } from './fx.js';
import { TECH_IMPL, clampArena } from './techniques.js';
import { spawnEnemy, updateEnemy } from './enemies.js';
import { ARENA_RADIUS } from './world.js';
import { sfx } from './audio.js';

const CAM_OFFSET = new THREE.Vector3(0, 18, 12.5);

export class Game {
  constructor(world, input, ui) {
    this.world = world;
    this.scene = world.scene;
    this.camera = world.camera;
    this.pillars = world.pillars;
    this.input = input;
    this.ui = ui;
    this.particles = new Particles(this.scene);
    this.fx = new Effects(this.scene);
    this.state = 'title';
    this.camTarget = new THREE.Vector3();
    this.shakeAmt = 0;
    this.time = 0;
    this.hitStop = 0;
    this.hintT = {};
    this.numbers = [];
    this.playerLight = new THREE.PointLight(0xffffff, 0, 9, 1.5);
    this.scene.add(this.playerLight);
    this.threadLines = makeLines(this.scene, 64, 0xff5fa2, 0.9);
    this.horizonLines = makeLines(this.scene, 96, 0xffb347, 0.55);
    this.linkLines = makeLines(this.scene, 64, 0xb36bff, 0.18);
    this.namedMarker = new THREE.Mesh(new THREE.OctahedronGeometry(0.28), new THREE.MeshBasicMaterial({ color: 0xffd34d }));
    this.namedMarker.visible = false;
    this.scene.add(this.namedMarker);
  }

  // ---------- lifecycle ----------

  start(techKey) {
    this.clearArena();
    const tech = TECHNIQUES[techKey];
    const f = buildFighter(tech.color, { suit: 0x3a4160, kind: 'player' });
    this.scene.add(f.group);
    this.playerLight.color.setHex(tech.color);
    this.playerLight.intensity = 26;
    const shell = buildAuraShell(tech.color);
    this.scene.add(shell);
    this.player = {
      tech: techKey, def: tech, impl: TECH_IMPL[techKey], fighter: f, pos: f.group.position,
      vel: new THREE.Vector3(), facing: Math.PI, hp: 100, maxHp: 100, radius: 0.6,
      atkCd: 0, rmbCd: 0, dashCd: 0, dashT: 0, invuln: 0, sealed: 0, maxCharge: 0,
      stillTime: 0, rooted: 0, blind: 0, stunned: 0, eye: null, vault: null, vaultCd: 0,
      aura: { active: false, energy: 100, radius: 0, shell }, sootSlow: 0, riposteCd: 0,
      wager: { armed: false, cd: 0 }, pressured: false, hurtT: 0,
    };
    this.player.impl.init(this.player);
    this.pacts = [];
    this.flags = {};
    this.resolve = 0;
    this.score = 0;
    this.kills = 0;
    this.wagersWon = 0;
    this.wagersLost = 0;
    this.runTime = 0;
    this.clash = 0;
    this.auraUnlocked = false;
    this.attackId = 0;
    this.named = null;
    this.startWave(0);
    this.state = 'playing';
    this.ui.showHud(this);
    this.ui.showControlsHint(this);
  }

  clearArena() {
    for (const e of this.enemies ?? []) this.removeEnemy(e);
    for (const pr of [...(this.pProj ?? []), ...(this.eProj ?? []), ...(this.rings ?? []), ...(this.hazards ?? [])]) {
      if (pr.mesh) this.scene.remove(pr.mesh);
      if (pr.group) this.scene.remove(pr.group);
    }
    if (this.player) {
      this.scene.remove(this.player.fighter.group);
      this.scene.remove(this.player.aura.shell);
    }
    this.playerLight.intensity = 0;
    this.ui.bossBar(null);
    for (const n of this.numbers) n.el.remove();
    this.enemies = [];
    this.pProj = [];
    this.eProj = [];
    this.rings = [];
    this.hazards = [];
    this.numbers = [];
  }

  startWave(i) {
    this.waveIndex = i;
    const w = WAVES[i];
    this.spawnQueue = [];
    for (const [type, n] of Object.entries(w.spawns)) for (let k = 0; k < n; k++) this.spawnQueue.push(type);
    this.spawnQueue.sort(() => Math.random() - 0.5);
    this.spawnT = 1.2;
    this.waveClearT = 0;
    this.named = null;
    this.ui.banner(`WAVE ${i + 1} / ${WAVES.length}`, w.title);
  }

  // ---------- main update ----------

  update(dt) {
    if (this.hitStop > 0) { this.hitStop -= dt; dt *= 0.12; }
    this.time += dt;
    if (this.state === 'playing') {
      this.runTime += dt;
      this.input.updateAim();
      this.updatePlayer(dt);
      this.updateAura(dt);
      this.updateSpawns(dt);
      for (const e of [...this.enemies]) updateEnemy(this, e, dt);
      this.resolveEnemyCollisions();
      this.updateProjectiles(dt);
      this.updateRings(dt);
      this.updateHazards(dt);
      this.updateOverlays();
      this.checkWave(dt);
    }
    for (const e of this.enemies ?? []) {
      setFlash(e.fighter, e.flash);
      e.bar?.set(e.hp / e.maxHp);
      e.bar?.face(this.camera);
    }
    this.particles.update(dt);
    this.fx.update(dt);
    if (this.player) {
      animateFighter(this.player.fighter, this.time);
      this.playerLight.position.copy(this.player.pos).setY(2.2);
    }
    this.updateCamera(dt);
    this.world.rain.update(dt, this.camTarget);
    this.updateNumbers(dt);
    if (this.player && this.state !== 'title') this.ui.updateHud(this);
    this.input.endFrame();
  }

  updatePlayer(dt) {
    const p = this.player;
    const inp = this.input;
    for (const k of ['atkCd', 'rmbCd', 'dashCd', 'invuln', 'sealed', 'rooted', 'blind', 'stunned', 'vaultCd', 'sootSlow', 'riposteCd', 'hurtT']) p[k] = Math.max(0, p[k] - dt);
    p.wager.cd = Math.max(0, p.wager.cd - dt);
    // Under hostile aura pressure, everything takes more effort.
    const effort = p.pressured ? 0.65 : 1;
    p.atkCd = Math.max(0, p.atkCd + dt * (1 - effort));

    const move = new THREE.Vector3(
      (inp.down('d') || inp.down('arrowright') ? 1 : 0) - (inp.down('a') || inp.down('arrowleft') ? 1 : 0),
      0,
      (inp.down('s') || inp.down('arrowdown') ? 1 : 0) - (inp.down('w') || inp.down('arrowup') ? 1 : 0),
    );
    if (move.lengthSq() > 0) move.normalize();
    const locked = p.rooted > 0 || p.stunned > 0;

    if (inp.hit(' ') && !locked && p.dashCd <= 0 && !this.flags.nodash) {
      const d = move.lengthSq() > 0 ? move.clone() : new THREE.Vector3(Math.sin(p.facing), 0, Math.cos(p.facing));
      p.vel.copy(d.multiplyScalar(26));
      p.dashT = 0.17;
      p.invuln = Math.max(p.invuln, 0.24);
      p.dashCd = this.flags.riposte ? 1.8 : 0.9;
      this.particles.emit(p.pos.clone().setY(0.8), { count: 18, color: p.def.color, speed: 3, size: 0.35 });
      sfx.swing();
    } else if (inp.hit(' ') && this.flags.nodash) {
      this.hint('nodash', p.pos, 'GROUNDED SILENCE', '#999');
    }

    if (p.dashT > 0) {
      p.dashT -= dt;
      p.pos.addScaledVector(p.vel, dt);
      if (p.dashT <= 0) p.vel.multiplyScalar(0.25);
    } else {
      let speed = 7.5;
      if (p.impl.guarding?.(this, p) || p.impl.quieting?.(this, p)) speed *= 0.5;
      if (p.sootSlow > 0) speed *= 0.5;
      if (p.pressured) speed *= 0.6;
      if (locked) speed = 0;
      p.pos.addScaledVector(move, speed * dt);
      p.pos.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(Math.exp(-5 * dt));
    }
    this.collidePillars(p);
    clampArena(p.pos);
    p.stillTime = move.lengthSq() === 0 && p.dashT <= 0 && p.vel.lengthSq() < 1 ? p.stillTime + dt : 0;

    const aim = inp.aim;
    p.facing = Math.atan2(aim.x - p.pos.x, aim.z - p.pos.z);
    p.fighter.group.rotation.y = p.facing;
    p.fighter.inner.position.y = p.dashT > 0 ? 0.15 : 0;
    p.fighter.group.visible = !(p.invuln > 0 && p.dashT <= 0 && Math.floor(this.time * 30) % 2 === 0);
    setFlash(p.fighter, p.hurtT * 3);

    p.impl.regen(this, p, dt);
    p.maxCharge = Math.min(100, p.maxCharge + dt * 1.2);

    if (locked) return;
    const canTech = p.sealed <= 0;
    if (inp.lmb && p.atkCd <= 0) {
      if (canTech) {
        const cd = p.impl.primary(this, 1);
        p.atkCd = cd || 0.15;
      } else this.hint('sealed', p.pos, 'SEALED', '#ff6b6b');
    }
    if (inp.rmbPressed && p.rmbCd <= 0 && canTech) {
      const cd = p.impl.secondary(this);
      if (cd) p.rmbCd = cd;
    }
    if (inp.hit('q') && canTech) this.tryMaxOutput();
    if (inp.hit('r')) this.tryWager();
    if (inp.hit('e')) this.tryVault();
  }

  tryMaxOutput() {
    const p = this.player;
    const threshold = this.flags.overext ? 50 : 100;
    if (p.maxCharge < threshold) { this.hint('max', p.pos, 'NOT READY', '#888'); return; }
    if (p.maxCharge < 100) {
      this.hurtPlayer(p.maxHp * 0.25, { kind: 'self', label: 'OVEREXTENSION' });
      if (this.state !== 'playing') return;
    }
    p.maxCharge = 0;
    p.impl.max(this);
  }

  tryWager() {
    const p = this.player;
    if (p.wager.armed || p.wager.cd > 0 || p.sealed > 0) return;
    p.wager.armed = true;
    sfx.wager();
    this.ui.toast(`WAGER DECLARED — your next attack will connect (×${this.flags.blindbet ? 4 : 3} or sealed ${this.flags.blindbet ? 7 : 4}s)`);
  }

  tryVault() {
    const p = this.player;
    if (p.eye !== 'vault' || p.vaultCd > 0 || p.sealed > 0) return;
    const impl = TECH_IMPL[p.vault];
    const saved = p.res;
    const savedStare = p.stare;
    impl.primary(this, 0.9, true);
    p.res = saved;
    p.stare = savedStare;
    p.vaultCd = 0.9;
  }

  // ---------- attacks, wagers, damage ----------

  beginAttack() {
    const p = this.player;
    const atk = { id: ++this.attackId, hits: 0, pending: 1, wager: p.wager.armed };
    if (p.wager.armed) { p.wager.armed = false; p.wager.cd = 5; }
    return atk;
  }

  endAttack(atk) {
    if (!atk || --atk.pending > 0) return;
    if (!atk.wager) return;
    const p = this.player;
    if (atk.hits > 0) {
      this.wagersWon++;
      sfx.win();
      this.ui.toast('WAGER WON — the declared outcome occurred', 'good');
    } else {
      this.wagersLost++;
      p.sealed = this.flags.blindbet ? 7 : 4;
      sfx.lose();
      this.ui.toast(`WAGER LOST — Technique sealed for ${p.sealed}s`, 'bad');
    }
  }

  spend(cost) {
    const p = this.player;
    if (p.res >= cost) { p.res -= cost; return true; }
    if (this.flags.overdraw) {
      p.res = 0;
      this.hurtPlayer(cost * 0.25, { kind: 'self', label: 'BLOOD DRAW' });
      return this.state === 'playing';
    }
    this.hint('res', p.pos, `NO ${p.def.resource.toUpperCase()}`, '#888');
    return false;
  }

  pactActive(pact, e) {
    const p = this.player;
    switch (pact.cond) {
      case 'always': return true;
      case 'still': return p.stillTime > 0.2;
      case 'sunset': return pact.wave === this.waveIndex;
      case 'low': return p.hp < p.maxHp * 0.35;
      case 'close': return e ? e.pos.distanceTo(p.pos) < 7 : this.enemies.some((o) => o.alive && o.pos.distanceTo(p.pos) < 7);
      case 'facing': {
        const test = (o) => Math.abs(angleDiff(Math.atan2(o.pos.x - p.pos.x, o.pos.z - p.pos.z), p.facing)) < 0.44;
        return e ? test(e) : this.enemies.some((o) => o.alive && test(o));
      }
      case 'named': return this.named?.alive && (!e || e === this.named);
      default: return false;
    }
  }

  outputMult(e) {
    let m = 1;
    for (const pact of this.pacts) if (pact.cond !== 'named' && this.pactActive(pact, e)) m += pact.eff;
    const namedPact = this.pacts.find((x) => x.cond === 'named');
    if (namedPact && this.named?.alive) m = e === this.named ? m + namedPact.eff : m * 0.6;
    if (this.player.eye === 'empty' && e.def.veiled) m *= 1.4;
    return m;
  }

  hitEnemy(e, dmg, atk, opts = {}) {
    if (!e.alive || e.spawnT > 0) return false;
    const p = this.player;
    let m = this.outputMult(e);
    if (atk?.wager) m *= this.flags.blindbet ? 4 : 3;
    if (this.playerAuraPressure(e)) m *= 1.15;
    if (e.brokenT > this.time) m *= 1.5;
    let tag = null;
    if (e.def.shell) {
      const toSrc = Math.atan2(p.pos.x - e.pos.x, p.pos.z - e.pos.z);
      if (Math.abs(angleDiff(toSrc, e.facing)) < 1.2 && opts.kind !== 'spatial') {
        m *= p.eye === 'empty' ? 0.5 : 0.22;
        tag = 'SHELL';
        this.particles.emit(e.pos.clone().setY(1.2), { count: 10, color: 0xfff2c0, speed: 8, size: 0.25 });
      }
    }
    if (e.linkedTo?.alive) m *= 0.7;
    const final = dmg * m;
    e.hp -= final;
    e.flash = 1;
    if (atk) atk.hits++;
    const knock = (opts.knock ?? 3) * (e.def.boss ? 0.15 : e.type === 'husk' ? 0.4 : 1);
    if (opts.dir && knock) e.vel.addScaledVector(opts.dir, knock);
    if (opts.freeze) e.frozen = Math.max(e.frozen, opts.freeze);
    if (opts.slow) e.slow = Math.max(e.slow, opts.slow);
    const color = atk?.wager ? '#ffd34d' : m > 1.35 ? '#ffb0ff' : '#ffffff';
    this.number(e.pos, tag ? `${Math.round(final)} ${tag}` : Math.round(final), color, final > 60);
    this.particles.emit(e.pos.clone().setY(1.1), { count: 8 + Math.min(30, final / 3), color: p.def.color, speed: 7, size: 0.3 });
    p.maxCharge = Math.min(100, p.maxCharge + final * 0.2);
    sfx.hit();
    if (final >= 45 || atk?.wager) { this.freeze(final >= 90 ? 0.11 : 0.06); this.shake(0.15); }

    if (opts.resonance) {
      e.res++;
      e.resT = 3;
      sfx.ring(e.res);
      if (e.res >= 5) {
        e.res = 0;
        this.number(e.pos, 'SHATTER', '#7dffb2', true);
        this.fx.ring(e.pos, { color: 0x7dffb2, to: 3.5, life: 0.35 });
        this.particles.emit(e.pos.clone().setY(1), { count: 60, color: 0x7dffb2, speed: 12, size: 0.45 });
        sfx.shatter();
        e.hp -= 70 * m;
        for (const o of this.enemiesNear(e.pos, 3.5)) if (o !== e) { o.res = Math.min(4, o.res + 1); o.resT = 3; }
      }
    }
    if (p.eye === 'thread' && e.def.ai === 'architect') {
      for (const l of e.links) if (l.alive) { l.hp -= final * 0.4; l.flash = 0.6; this.number(l.pos, Math.round(final * 0.4), '#ff8fc0'); if (l.hp <= 0) this.kill(l); }
    }
    if (e.hp <= 0) this.kill(e);
    return true;
  }

  kill(e) {
    if (!e.alive) return;
    e.alive = false;
    this.kills++;
    this.score += e.def.score;
    this.particles.emit(e.pos.clone().setY(1), { count: e.def.boss ? 400 : 70, color: e.def.color, speed: e.def.boss ? 22 : 11, size: 0.45, life: 1 });
    this.fx.ring(e.pos, { color: e.def.color, to: e.def.boss ? 14 : 3, life: 0.5 });
    if (e.def.ai === 'architect') {
      for (const l of e.links) {
        l.linkedTo = null;
        if (this.player.eye === 'thread' && l.alive) { l.stun = 2; this.number(l.pos, 'THREAD CUT', '#ff5fa2'); }
      }
    }
    if (e === this.named) this.ui.toast('Named Target has fallen. Your Technique answers to everyone again', 'good');
    if (e.def.boss) { this.shake(1); sfx.max(); this.ui.bossBar(null); this.freeze(0.35); } else this.freeze(0.04);
    this.removeEnemy(e);
    // The body comes apart: a short rise, a spin, a fade.
    const f = e.fighter;
    if (e.bar) f.group.remove(e.bar.root);
    f.ring.visible = false;
    const base = f.group.position.y;
    const dir = e.vel.lengthSq() > 0.01 ? e.vel.clone().normalize() : new THREE.Vector3();
    this.fx.mesh(f.group, e.def.boss ? 1.1 : 0.45, (k) => {
      setOpacity(f, 1 - k);
      f.inner.rotation.z = dir.x * k * 1.4;
      f.inner.rotation.x = -dir.z * k * 1.4;
      f.group.position.y = base + k * (e.def.boss ? 0.5 : 1.2);
      if (e.def.boss && Math.random() < 0.5) this.particles.emit(e.pos.clone().setY(1 + Math.random() * 2), { count: 6, color: e.def.color, speed: 8, size: 0.4 });
    });
  }

  removeEnemy(e) {
    this.scene.remove(e.fighter.group);
    if (e.aura) this.scene.remove(e.aura.shell);
    const i = this.enemies.indexOf(e);
    if (i >= 0) this.enemies.splice(i, 1);
  }

  hurtPlayer(dmg, src = {}) {
    const p = this.player;
    if (this.state !== 'playing') return;
    const self = src.kind === 'self';
    if (!self && p.invuln > 0) return;
    if (this.debug?.god) return;
    if (!self && src.from && p.impl.guarding?.(this, p) && src.kinetic) {
      const toSrc = Math.atan2(src.from.x - p.pos.x, src.from.z - p.pos.z);
      if (Math.abs(angleDiff(toSrc, p.facing)) < 1.25) {
        if (p.res < p.resMax) {
          p.res = Math.min(p.resMax, p.res + dmg * 2.4);
          this.number(p.pos, 'ABSORBED', '#ffb27a');
          this.fx.ring(p.pos, { color: 0xff7a2f, from: 2.2, to: 0.8, life: 0.2, y: 1 });
          sfx.absorb();
          return;
        }
        this.number(p.pos, 'OVERCAPACITY — HEAT', '#ff7a2f');
        this.particles.emit(p.pos.clone().setY(1.2), { count: 30, color: 0xff3d00, speed: 4, size: 0.4 });
      }
    }
    if (!self && p.impl.quieting?.(this, p)) dmg *= 0.35;
    p.hp -= dmg;
    p.hurtT = 0.25;
    this.number(p.pos, src.label ? `${src.label} −${Math.round(dmg)}` : `−${Math.round(dmg)}`, '#ff6b6b');
    this.ui.hurtFlash();
    this.shake(0.25 + dmg / 60);
    sfx.hurt();
    if (!self && this.flags.riposte && p.riposteCd <= 0) {
      p.riposteCd = 1;
      const atk = { id: ++this.attackId, hits: 0, pending: 1, wager: false };
      for (const e of this.enemiesNear(p.pos, 3.8)) this.hitEnemy(e, 22, atk, { knock: 10, dir: e.pos.clone().sub(p.pos).normalize() });
      this.fx.ring(p.pos, { color: p.def.color, to: 3.8, life: 0.25 });
      this.number(p.pos, 'RIPOSTE', '#9ff');
    }
    if (p.hp <= 0) {
      p.hp = 0;
      this.state = 'dead';
      this.particles.emit(p.pos.clone().setY(1), { count: 200, color: p.def.color, speed: 10, size: 0.5, life: 1.2 });
      this.scene.remove(p.fighter.group);
      p.aura.shell.visible = false;
      setTimeout(() => this.ui.showEnd(false, this.stats()), 1200);
    }
  }

  dmgScale() { return 1 + this.waveIndex * 0.065; }

  // ---------- debug (enabled with ?debug in the URL) ----------

  enableDebug() {
    window.game = this;
    this.debug = {
      clearWave: () => { for (const e of [...this.enemies]) this.kill(e); this.spawnQueue = []; },
      skipTo: (n) => { this.debug.clearWave(); this.waveClearT = 99; this.waveIndex = n - 2; },
      god: false,
    };
    window.addEventListener('keydown', (e) => {
      if (this.state !== 'playing') return;
      if (e.key === 'k') this.debug.clearWave();
      if (e.key === 'g') { this.debug.god = !this.debug.god; this.ui.toast(`god mode ${this.debug.god ? 'on' : 'off'}`); }
    });
    this.ui.toast('debug: K clears wave, G toggles god mode, window.game exposed');
  }

  stats() {
    return {
      wave: this.waveIndex + 1, kills: this.kills, score: this.score, resolve: this.resolve,
      pacts: this.pacts.map((p) => p.name), eye: this.player.eye, time: this.runTime,
      wagers: `${this.wagersWon} won / ${this.wagersLost} lost`, tech: this.player.def.name,
    };
  }

  // ---------- queries ----------

  enemiesNear(pos, r) {
    return this.enemies.filter((e) => e.alive && e.spawnT <= 0 && Math.hypot(e.pos.x - pos.x, e.pos.z - pos.z) < r + e.radius);
  }

  enemiesInArc(pos, dir, range, half) {
    const f = Math.atan2(dir.x, dir.z);
    return this.enemiesNear(pos, range).filter((e) => {
      const d = Math.hypot(e.pos.x - pos.x, e.pos.z - pos.z);
      return d < e.radius + 0.6 || Math.abs(angleDiff(Math.atan2(e.pos.x - pos.x, e.pos.z - pos.z), f)) < half;
    });
  }

  playerAuraPressure(e) {
    const a = this.player.aura;
    return a.active && Math.hypot(e.pos.x - this.player.pos.x, e.pos.z - this.player.pos.z) < a.radius;
  }

  // ---------- Aura Expansion and Aura Clash ----------

  updateAura(dt) {
    const p = this.player;
    const a = p.aura;
    const wants = this.auraUnlocked && this.input.down('f') && a.energy > 0 && p.stunned <= 0;
    if (wants && !a.active) sfx.aura();
    a.active = wants;
    const boss = this.enemies.find((e) => e.aura?.active);
    let clashing = false;
    if (boss && a.active) {
      const d = boss.pos.distanceTo(p.pos);
      clashing = d < a.radius + boss.aura.radius;
    }
    if (clashing) {
      // Maintaining a field while acting is hard: attacking weakens your push.
      const push = 0.34 - (this.input.lmb ? 0.22 : 0) + (p.stillTime > 0.2 ? 0.08 : 0);
      this.clash += (push - 0.24) * dt;
      if (this.clash >= 1) {
        this.clash = 0;
        boss.aura.active = false;
        boss.aura.collapsed = true;
        boss.stun = 3;
        boss.brokenT = this.time + 4;
        setTimeout(() => { if (boss.alive) boss.aura.collapsed = false; }, 9000);
        this.ui.banner('AURA COLLAPSE', 'Her field is crushed back into her. Guard broken');
        this.shake(1);
        sfx.max();
      } else if (this.clash <= -1) {
        this.clash = 0;
        p.stunned = 1.4;
        a.energy = 0;
        this.ui.banner('YOUR FIELD COLLAPSED', 'Disorganized aura. Recover');
        this.shake(0.8);
      }
    } else this.clash *= Math.exp(-dt);
    this.clashing = clashing;

    const baseR = 9;
    const targetR = a.active ? baseR * (1 + this.clash * 0.5) : 0;
    a.radius += (targetR - a.radius) * Math.min(1, dt * 6);
    a.energy = a.active ? Math.max(0, a.energy - dt * 14) : Math.min(100, a.energy + dt * 9);
    a.shell.visible = a.radius > 0.2;
    a.shell.position.copy(p.pos);
    a.shell.scale.setScalar(Math.max(0.01, a.radius));
    a.shell.material.uniforms.time.value = this.time;

    p.pressured = false;
    for (const e of this.enemies) {
      if (!e.aura) continue;
      const tr = e.aura.active ? 13 * (1 - (clashing ? this.clash : 0) * 0.5) : 0;
      e.aura.radius += (tr - e.aura.radius) * Math.min(1, dt * 3);
      e.aura.shell.visible = e.aura.radius > 0.2;
      e.aura.shell.position.copy(e.pos).setY(0);
      e.aura.shell.scale.setScalar(Math.max(0.01, e.aura.radius));
      e.aura.shell.material.uniforms.time.value = this.time;
      if (e.aura.active && !a.active && e.pos.distanceTo(p.pos) < e.aura.radius) p.pressured = true;
    }
  }

  // ---------- spawning and waves ----------

  updateSpawns(dt) {
    if (!this.spawnQueue.length) return;
    this.spawnT -= dt;
    if (this.spawnT > 0) return;
    const type = this.spawnQueue.shift();
    let pos;
    for (let tries = 0; tries < 20; tries++) {
      const a = Math.random() * Math.PI * 2;
      const d = 14 + Math.random() * (ARENA_RADIUS - 16);
      pos = new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d);
      if (pos.distanceTo(this.player.pos) > 11 && !this.pillars.some((pl) => Math.hypot(pl.x - pos.x, pl.z - pos.z) < pl.r + 1.5)) break;
    }
    const e = spawnEnemy(this, type, pos);
    if (e.def.boss) {
      this.ui.bossBar(e);
      this.ui.banner(e.def.title, type === 'ancient' ? 'Ancient. Not assumed to know expansion. She does.' : 'The Kuroda do not control fire. They control what burns.');
    }
    this.spawnT = 0.45;
    if (!this.spawnQueue.length && this.pacts.some((p) => p.cond === 'named')) {
      const pool = this.enemies.filter((x) => x.alive);
      this.named = pool.find((x) => x.def.boss) ?? pool[(Math.random() * pool.length) | 0];
      this.ui.toast(`NAMED TARGET: ${this.named.def.name}`, 'gold');
    }
  }

  checkWave(dt) {
    if (this.spawnQueue.length || this.enemies.length) return;
    this.waveClearT += dt;
    if (this.waveClearT < 1.4) return;
    this.state = 'intermission';
    const done = this.waveIndex + 1;
    const p = this.player;
    p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.45);
    p.sealed = 0;
    p.wager.armed = false;
    if (done >= WAVES.length) {
      sfx.win();
      this.ui.showEnd(true, this.stats());
      return;
    }
    const next = () => { this.startWave(done); this.state = 'playing'; };
    const pactStep = () => this.ui.showPactOffer(this.pactOffers(), (pact) => { if (pact) this.takePact(pact); next(); });
    if (done === 3) this.ui.showEyeOffer(p.tech, (eye, vault) => { this.installEye(eye, vault); pactStep(); });
    else if (done === 4) this.ui.showDiscovery(() => { this.auraUnlocked = true; pactStep(); });
    else pactStep();
  }

  pactOffers() {
    const owned = new Set(this.pacts.map((p) => p.id));
    const tags = new Set(this.pacts.map((p) => p.tag));
    const pool = PACTS.filter((p) => !owned.has(p.id) && !(p.tag === 'mobility' && this.flags.nodash));
    pool.sort(() => Math.random() - 0.5);
    return pool.slice(0, 3).map((p) => ({ ...p, shared: tags.has(p.tag) && p.mult > 0 }));
  }

  takePact(pact) {
    const eff = pact.shared ? pact.mult * 0.15 : pact.mult;
    const resolve = pact.shared ? 0 : pact.resolve;
    const entry = { ...pact, eff, wave: this.waveIndex + 1 };
    this.pacts.push(entry);
    this.resolve += resolve;
    if (pact.apply === 'glass') { this.player.maxHp *= 0.65; this.player.hp = Math.min(this.player.hp, this.player.maxHp); }
    if (pact.apply) this.flags[pact.apply] = true;
    sfx.pact();
    if (pact.shared) this.ui.toast('ANTI-LOOPHOLE: that sacrifice was already counted. Resolve +0', 'bad');
  }

  installEye(eye, vault) {
    const p = this.player;
    p.eye = eye;
    p.vault = vault;
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshBasicMaterial({ color: { horizon: 0xffb347, empty: 0xdde6f5, thread: 0xff5fa2, vault: 0x8affd6 }[eye] }));
    m.position.set(0.12, 1.9, 0.27);
    p.fighter.inner.add(m);
    sfx.pact();
  }

  // ---------- projectiles, rings, hazards ----------

  updateProjectiles(dt) {
    const p = this.player;
    for (let i = this.pProj.length - 1; i >= 0; i--) {
      const pr = this.pProj[i];
      pr.life -= dt;
      pr.pos.addScaledVector(pr.vel, dt);
      pr.update?.(pr, dt);
      pr.mesh.position.copy(pr.pos);
      if (pr.trail) this.particles.emit(pr.pos, { count: 2, color: pr.trail, speed: 1, size: 0.5, life: 0.25, gravity: 0 });
      for (const e of [...this.enemies]) {
        if (!e.alive || pr.hitSet.has(e) || e.spawnT > 0) continue;
        if (Math.hypot(e.pos.x - pr.pos.x, e.pos.z - pr.pos.z) < e.radius + pr.radius) {
          pr.hitSet.add(e);
          if (e.quiet > 0) {
            this.number(e.pos, 'CANCELLED', '#7dffb2');
            this.fx.ring(pr.pos, { color: 0x7dffb2, from: 0.3, to: 2, life: 0.2, y: 1 });
            pr.life = 0;
            break;
          }
          this.hitEnemy(e, pr.dmg, pr.atk, { knock: pr.knock ?? 4, dir: pr.vel.clone().normalize(), resonance: pr.resonance, freeze: pr.freeze, slow: pr.slow });
          if (!pr.pierce) { pr.life = 0; break; }
        }
      }
      if (pr.resonance) {
        for (const ep of this.eProj) if (ep.life > 0 && ep.kinetic && ep.pos.distanceTo(pr.pos) < pr.radius + 0.4) { ep.life = 0; this.particles.emit(ep.pos, { count: 8, color: 0x7dffb2, speed: 4, size: 0.3 }); }
      }
      if (!pr.pierce && this.hitsPillar(pr.pos, pr.radius)) pr.life = 0;
      if (pr.life <= 0) {
        if (!pr.pierce) this.particles.emit(pr.pos, { count: 16, color: pr.color, speed: 6, size: 0.4 });
        this.scene.remove(pr.mesh);
        this.pProj.splice(i, 1);
        this.endAttack(pr.atk);
      }
    }

    const quiet = p.impl.quieting?.(this, p);
    for (let i = this.eProj.length - 1; i >= 0; i--) {
      const pr = this.eProj[i];
      pr.life -= dt;
      if (pr.homing) {
        const want = p.pos.clone().setY(pr.pos.y).sub(pr.pos).normalize().multiplyScalar(pr.vel.length());
        pr.vel.lerp(want, Math.min(1, pr.homing * dt));
      }
      if (p.aura.active && pr.pos.distanceTo(p.pos) < p.aura.radius) pr.vel.multiplyScalar(Math.exp(-1.6 * dt));
      pr.pos.addScaledVector(pr.vel, dt);
      pr.mesh.position.copy(pr.pos);
      const d = Math.hypot(pr.pos.x - p.pos.x, pr.pos.z - p.pos.z);
      if (quiet && pr.kinetic && d < 4.5) {
        pr.life = 0;
        this.fx.ring(pr.pos, { color: 0x7dffb2, from: 0.2, to: 1.6, life: 0.2, y: pr.pos.y });
        sfx.ring(3);
      } else if (d < p.radius + pr.radius) {
        this.hurtPlayer(pr.dmg, { from: pr.pos.clone().addScaledVector(pr.vel, -0.1), kinetic: pr.kinetic });
        pr.life = 0;
      } else if (this.hitsPillar(pr.pos, pr.radius) || pr.pos.length() > ARENA_RADIUS + 6) pr.life = 0;
      if (pr.life <= 0) {
        this.scene.remove(pr.mesh);
        this.eProj.splice(i, 1);
      }
    }
  }

  addRing(center, color, speed, dmg) {
    const mesh = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.08, 6, 96),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(center.x, 0.6, center.z);
    this.scene.add(mesh);
    this.rings.push({ center, r: 1, speed, dmg, hit: false, mesh, life: 3.2 });
  }

  updateRings(dt) {
    const p = this.player;
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.r += r.speed * dt;
      r.life -= dt;
      r.mesh.scale.set(r.r, r.r, 1 + r.r * 0.2);
      r.mesh.material.opacity = Math.min(1, r.life);
      const d = Math.hypot(p.pos.x - r.center.x, p.pos.z - r.center.z);
      if (!r.hit && Math.abs(d - r.r) < 0.7) {
        r.hit = true;
        if (p.invuln <= 0 && !(p.aura.active && this.clashing)) this.hurtPlayer(r.dmg, { from: r.center, kinetic: true });
      }
      if (r.life <= 0) { this.scene.remove(r.mesh); this.rings.splice(i, 1); }
    }
  }

  addHazard(kind, pos, radius, time) {
    const colors = { fuel: 0xc8ff6a, soot: 0x15151c, fire: 0xff6a1a };
    const mesh = new THREE.Mesh(
      new THREE.CircleGeometry(radius, 40),
      new THREE.MeshBasicMaterial({ color: colors[kind], transparent: true, opacity: kind === 'soot' ? 0.75 : 0.12, depthWrite: false, blending: kind === 'soot' ? THREE.NormalBlending : THREE.AdditiveBlending }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(pos.x, 0.05, pos.z);
    this.scene.add(mesh);
    this.hazards.push({ kind, pos: pos.clone(), radius, t: time, life: kind === 'soot' ? time : time + 2.2, mesh });
  }

  updateHazards(dt) {
    const p = this.player;
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      h.life -= dt;
      const inside = Math.hypot(p.pos.x - h.pos.x, p.pos.z - h.pos.z) < h.radius;
      if (h.kind === 'fuel') {
        h.t -= dt;
        h.mesh.material.opacity = 0.1 + 0.08 * Math.sin(this.time * 12);
        if (Math.random() < dt * 14) this.particles.emit(h.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * h.radius, 0.2, (Math.random() - 0.5) * h.radius)), { count: 1, color: 0x9ccf4a, speed: 0.6, size: 0.6, life: 0.8, gravity: -1 });
        if (h.t <= 0) {
          h.kind = 'fire';
          h.mesh.material.color.setHex(0xff5a14);
          h.mesh.material.opacity = 0.55;
          this.fx.ring(h.pos, { color: 0xff8a2a, to: h.radius * 1.3, life: 0.35 });
          this.particles.emit(h.pos.clone().setY(0.5), { count: 70, color: 0xff6a1a, speed: 9, size: 0.6, up: 2.5 });
          if (inside) this.hurtPlayer(20 * this.dmgScale(), { from: h.pos, label: 'IGNITION' });
          this.shake(0.2);
          sfx.fire();
        }
      } else if (h.kind === 'fire') {
        h.mesh.material.opacity = Math.max(0, Math.min(0.55, h.life));
        this.particles.emit(h.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * h.radius * 1.4, 0.1, (Math.random() - 0.5) * h.radius * 1.4)), { count: 2, color: Math.random() < 0.5 ? 0xff6a1a : 0xffc14a, speed: 2, size: 0.55, life: 0.6, gravity: -5 });
        if (inside && p.invuln <= 0 && Math.random() < dt * 4) this.hurtPlayer(4, { label: 'BURN' });
      } else if (h.kind === 'soot') {
        h.mesh.material.opacity = Math.min(0.75, h.life * 0.5);
        if (inside) { p.sootSlow = 0.3; if (Math.random() < dt * 3) this.hurtPlayer(3, { label: 'SOOT' }); }
      }
      if (h.life <= 0) { this.scene.remove(h.mesh); this.hazards.splice(i, 1); }
    }
  }

  // ---------- visuals and helpers ----------

  telegraph(pos, radius, time, color, arc) {
    const horizon = this.player.eye === 'horizon';
    const geo = arc === undefined ? new THREE.CircleGeometry(radius, 40) : new THREE.CircleGeometry(radius, 24, arc - Math.PI / 2 - 0.9, 1.8);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(pos.x, 0.06, pos.z);
    const window = 0.3;
    this.fx.mesh(m, time, (k) => {
      const remaining = time * (1 - k);
      if (horizon) mat.opacity = 0.12 + 0.3 * k;
      else mat.opacity = remaining < window ? 0.22 : 0;
    });
  }

  slash(pos, facing, range, half, color, y = 0.9) {
    const m = new THREE.Mesh(
      new THREE.CircleGeometry(range, 24, facing - Math.PI / 2 - half, half * 2),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(pos.x, y, pos.z);
    this.fx.mesh(m, 0.16, (k) => { m.material.opacity = 0.5 * (1 - k); });
  }

  hitsPillar(pos, r) {
    return this.pillars.some((pl) => Math.hypot(pl.x - pos.x, pl.z - pos.z) < pl.r + r && pos.y < 6);
  }

  collidePillars(a) {
    for (const pl of this.pillars) {
      const dx = a.pos.x - pl.x, dz = a.pos.z - pl.z;
      const d = Math.hypot(dx, dz);
      const min = pl.r + a.radius;
      if (d < min && d > 0) { a.pos.x = pl.x + (dx / d) * min; a.pos.z = pl.z + (dz / d) * min; }
    }
  }

  resolveEnemyCollisions() {
    const list = this.enemies;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.state !== 'leap') { this.collidePillars(a); clampArena(a.pos); }
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz);
        const min = a.radius + b.radius;
        if (d < min && d > 0.001) {
          const push = (min - d) / 2;
          a.pos.x -= (dx / d) * push; a.pos.z -= (dz / d) * push;
          b.pos.x += (dx / d) * push; b.pos.z += (dz / d) * push;
        }
      }
    }
  }

  updateOverlays() {
    const p = this.player;
    // Thread Eye: dependencies made visible. Without it, links are a faint suspicion.
    const segs = [];
    for (const e of this.enemies) if (e.def.ai === 'architect') for (const l of e.links) if (l.alive) segs.push(e.pos, l.pos);
    setLines(p.eye === 'thread' ? this.threadLines : this.linkLines, segs, 1.3);
    setLines(p.eye === 'thread' ? this.linkLines : this.threadLines, [], 0);

    // Horizon Eye: reachable futures of every projectile in flight.
    const fut = [];
    if (p.eye === 'horizon') {
      for (const pr of this.eProj) fut.push(pr.pos, pr.pos.clone().addScaledVector(pr.vel, 0.9));
      for (const e of this.enemies) if (e.state === 'leap') fut.push(e.pos, e.leapTo);
    }
    setLines(this.horizonLines, fut, 1.1);

    if (this.named?.alive) {
      this.namedMarker.visible = true;
      this.namedMarker.position.copy(this.named.pos).setY(3.2 * (this.named.def.boss ? 1.6 : 1) + Math.sin(this.time * 4) * 0.15);
      this.namedMarker.rotation.y = this.time * 3;
    } else this.namedMarker.visible = false;
  }

  updateCamera(dt) {
    const p = this.player;
    const want = new THREE.Vector3();
    if (p && this.state !== 'title') {
      want.copy(p.pos).lerp(this.input.aim.clone().setY(0), 0.14);
    } else {
      want.set(Math.sin(this.time * 0.1) * 6, 0, Math.cos(this.time * 0.1) * 6);
    }
    this.camTarget.lerp(want, Math.min(1, dt * 5));
    const off = this.state === 'title' ? new THREE.Vector3(Math.sin(this.time * 0.08) * 26, 14, Math.cos(this.time * 0.08) * 26) : CAM_OFFSET;
    this.camera.position.copy(this.camTarget).add(off);
    if (this.shakeAmt > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeAmt;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeAmt;
      this.camera.position.z += (Math.random() - 0.5) * this.shakeAmt;
      this.shakeAmt *= Math.exp(-dt * 7);
    }
    this.camera.lookAt(this.camTarget.x, 1, this.camTarget.z);
  }

  shake(a) { this.shakeAmt = Math.min(2, this.shakeAmt + a); }

  number(pos, text, color = '#fff', big = false) {
    const el = document.createElement('div');
    el.className = 'dmg' + (big ? ' big' : '');
    el.textContent = text;
    el.style.color = color;
    this.ui.numberLayer.appendChild(el);
    this.numbers.push({ el, pos: pos.clone().setY(2.4 + Math.random() * 0.4), dx: (Math.random() - 0.5) * 30, t: 0 });
  }

  banner(title, sub) { this.ui.banner(title, sub); }

  // Floating text that repeats at most every 0.6s per key, so held buttons do not spam.
  hint(key, pos, text, color) {
    if ((this.hintT[key] ?? -1) > this.time - 0.6) return;
    this.hintT[key] = this.time;
    this.number(pos, text, color);
  }

  freeze(t) { this.hitStop = Math.max(this.hitStop, t); }

  updateNumbers(dt) {
    const v = new THREE.Vector3();
    for (let i = this.numbers.length - 1; i >= 0; i--) {
      const n = this.numbers[i];
      n.t += dt;
      v.copy(n.pos).project(this.camera);
      const x = (v.x * 0.5 + 0.5) * window.innerWidth + n.dx * n.t;
      const y = (-v.y * 0.5 + 0.5) * window.innerHeight - n.t * 70;
      n.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${1 + Math.max(0, 0.3 - n.t) * 2})`;
      n.el.style.opacity = String(Math.max(0, 1 - n.t / 0.9));
      if (n.t > 0.9) { n.el.remove(); this.numbers.splice(i, 1); }
    }
  }
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function makeLines(scene, max, color, opacity) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 6), 3));
  geo.setDrawRange(0, 0);
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
  lines.frustumCulled = false;
  lines.userData.max = max;
  scene.add(lines);
  return lines;
}

function setLines(lines, pts, y) {
  const arr = lines.geometry.attributes.position.array;
  const n = Math.min(pts.length, lines.userData.max * 2);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = pts[i].x;
    arr[i * 3 + 1] = Math.max(pts[i].y, y);
    arr[i * 3 + 2] = pts[i].z;
  }
  lines.geometry.setDrawRange(0, n);
  lines.geometry.attributes.position.needsUpdate = true;
}

