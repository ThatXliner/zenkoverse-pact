import * as THREE from 'three';
import type { Game } from '../app/game';
import { opening, blow, type CutsceneDef } from '../cutscene/cutscene';
import type { Enemy, EnemyAi } from './enemies';

// The bosses' Maximum Outputs (issue #27). They play through the same
// cutscene player as the player's: the boss is the caster, the player is the
// target pulled into the shot, and the blow lands on the beat.
export interface BossUltimate {
  cutscene: CutsceneDef;
  // Whether the boss reaches for it on this cast.
  ready(e: Enemy): boolean;
  // The blow, from the boss onto the player and the props around.
  resolve(g: Game, e: Enemy): void;
}

const MASTER = 0x7dffb2;
const KURODA = 0xff5a1a;

// Five Thousand Years: the Master's sign close, the player small over her
// shoulder, the cut from behind the player as the rings come, and a crane.
const fiveThousandYears: CutsceneDef = {
  id: 'boss-ancient', title: { jp: '五千年', en: 'Five Thousand Years' }, color: MASTER, pull: 5, reach: 22,
  shots: [
    { duration: 1.05, timeScale: 0.03, from: { pos: [-0.95, 1.4, 1.9], look: [0, 1.32, 0], fov: 36 }, to: { pos: [-0.66, 1.4, 1.45], fov: 30, roll: -0.04 }, events: opening('phaserUp3', 0.35) },
    { duration: 0.5, timeScale: 0.03, from: { pos: [-0.65, 1.75, -1.3], look: [0, 1.2, 0], lookRel: 'target', fov: 48 }, to: { pos: [-0.55, 1.7, -1.0], fov: 42 }, ease: 'in', events: [{ at: 0.05, kind: 'sfx', id: 'impactBell_heavy_002', pitch: 0.4 }] },
    { duration: 0.95, timeScale: 0.3, from: { rel: 'target', pos: [0.9, 1.4, 2.4], look: [0, 1.3, 0], lookRel: 'caster', fov: 60, roll: -0.08 }, to: { pos: [1.2, 1.6, 3.4], fov: 74 }, events: [...blow(0, 'impactBell_heavy_000', 0.35, 1)] },
    { duration: 0.75, timeScale: 0.5, from: { rel: 'mid', pos: [-5, 5.5, -2], look: [0, 0.6, 0], fov: 58 }, to: { pos: [-6, 7, -2.5], fov: 62 }, ease: 'inOut' },
  ],
};

// Flashpoint: the Enforcer's sign, the sheen spreading under the player's
// feet, the cut low and wide as it lights, and a wide of the burning ground.
const flashpoint: CutsceneDef = {
  id: 'boss-kuroda', title: { jp: '引火', en: 'Flashpoint' }, color: KURODA, pull: 4, reach: 20,
  shots: [
    { duration: 1.05, timeScale: 0.03, from: { pos: [-1.0, 1.62, 2.05], look: [0, 1.5, 0], fov: 36 }, to: { pos: [-0.7, 1.6, 1.55], fov: 30, roll: -0.04 }, events: opening('spaceTrash1', 0.6) },
    { duration: 0.5, timeScale: 0.03, from: { rel: 'target', pos: [1.3, 0.22, -1.3], look: [0, 0.3, 0], fov: 50, roll: 0.08 }, to: { pos: [1.5, 0.25, -1.6], fov: 46 }, ease: 'in', events: [{ at: 0.05, kind: 'sfx', id: 'spaceTrash1', pitch: 0.4 }] },
    { duration: 0.95, timeScale: 0.3, from: { rel: 'mid', pos: [4.6, 0.7, 0.5], look: [0, 1.0, 0], fov: 64, roll: 0.1 }, to: { pos: [5.6, 0.9, 0.8], fov: 76, roll: 0.03 }, events: [...blow(0, 'impactMining_000', 0.7), { at: 0.03, kind: 'sfx', id: 'impactMetal_heavy_000', pitch: 0.6 }] },
    { duration: 0.75, timeScale: 0.5, from: { rel: 'mid', pos: [-4.5, 2.2, -1], look: [0, 0.8, 0], fov: 56 }, to: { pos: [-5.2, 2.8, -1.4], fov: 60 }, ease: 'inOut' },
  ],
};

const used = new WeakSet<Enemy>();

export const BOSS_ULTIMATES: Partial<Record<EnemyAi, BossUltimate>> = {
  // Below seven tenths of her health, half her casts become the ultimate.
  ancient: {
    cutscene: fiveThousandYears,
    ready: (e) => e.hp < e.maxHp * 0.7 && Math.random() < 0.5,
    resolve(g, e) {
      const c = e.position.clone();
      e.avatar.playUpper('Spell_Simple_Shoot', 1.1);
      for (let i = 1; i <= 4; i++) g.vfx.after(i * 0.06, () => g.vfx.ring(c.clone().add(new THREE.Vector3(0, 0.1 + i * 0.2, 0)), MASTER, 0.5, 6 * i, 0.7));
      g.vfx.flash(e.center(), MASTER, 120, 0.7, 30);
      const d = g.player.position.distanceTo(c);
      if (d < 22) g.combat.hurtPlayer(e.dmg * 1.6 * (1 - d / 30), { from: c, kinetic: true, cutscene: true });
      for (const p of g.props.instances) if (p.mesh.position.distanceTo(c) < 22) { p.body.wakeUp(); p.body.applyImpulse(p.mesh.position.clone().sub(c).setY(0.8).normalize().multiplyScalar(p.def.mass * 9), true); }
    },
  },
  // Once a fight, the first cast after he falls below half.
  kuroda: {
    cutscene: flashpoint,
    ready: (e) => e.hp < e.maxHp * 0.5 && !used.has(e),
    resolve(g, e) {
      used.add(e);
      const at = g.player.position.clone();
      e.avatar.playUpper('Punch_Cross', 1.2);
      g.vfx.patch(at, 3.2, 'burn', 8);
      g.vfx.flash(at.clone().add(new THREE.Vector3(0, 1.2, 0)), KURODA, 140, 0.6, 26);
      g.vfx.burst(at.clone().add(new THREE.Vector3(0, 0.4, 0)), 40, 'spark', 9, 0xff8a2a);
      for (let i = 1; i <= 3; i++) g.vfx.after(i * 0.05, () => g.vfx.ring(at.clone().add(new THREE.Vector3(0, 0.1, 0)), KURODA, 0.4, 2 + i * 1.6, 0.6));
      g.combat.hurtPlayer(e.dmg * 2.2, { from: e.center(), kinetic: false, cutscene: true });
      for (const o of g.encounters.enemies) if (o !== e && o.alive && o.position.distanceTo(at) < 3.2) o.hurt(20, { from: at, knock: 3 });
    },
  },
};
