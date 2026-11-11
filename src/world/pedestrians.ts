import * as THREE from 'three';
import type { Game } from '../app/game';
import { Avatar, type CharacterModel } from '../character/avatar';

interface Walker { avatar: Avatar; path: THREE.Vector3[]; i: number; speed: number; flee: number; pos: THREE.Vector3; yaw: number; paused: number }

const PATHS: [number, number][][] = [
  [[-60, -6.3], [50, -6.3]],
  [[50, 6.3], [-60, 6.3]],
  [[-5.4, -40], [-5.4, -9], [-30, -6.3]],
  [[5.4, 12], [5.4, 56], [20, 56]],
  [[-58, -45], [-45, -60], [-40, -72], [-58, -75]],
  [[40, 6.3], [58, 6.3], [58, -6.3], [40, -6.3]],
];

// Ambient pedestrians walking sidewalk loops. They scatter from fights.
export class Pedestrians {
  private walkers: Walker[] = [];

  constructor(private game: Game) {
    const models: CharacterModel[] = ['Mage', 'Barbarian', 'Rogue', 'Knight', 'Rogue_Hooded'];
    const tints = [0x7a8290, 0x5a6a80, 0x4e6a58, 0x66707a, 0x4a5560];
    PATHS.forEach((p, i) => {
      for (let k = 0; k < 2; k++) {
        const path = p.map(([x, z]) => new THREE.Vector3(x, 0.14, z));
        if (k === 1) path.reverse();
        const av = new Avatar(game.assets, models[(i + k) % models.length]!, { targetHeight: 1.72 + Math.random() * 0.12, tint: tints[(i * 2 + k) % tints.length], hideParts: ['Helmet', 'Cape'] });
        const start = path[0]!.clone().lerp(path[1]!, Math.random());
        av.root.position.copy(start);
        game.renderer.scene.add(av.root);
        this.walkers.push({ avatar: av, path, i: 1, speed: 1.1 + Math.random() * 0.5, flee: 0, pos: start, yaw: 0, paused: 0 });
      }
    });
  }

  update(dt: number): void {
    const g = this.game;
    const fight = g.encounters.enemies.some((e) => e.alive && e.def.ai !== 'dummy');
    for (const w of this.walkers) {
      const target = w.path[w.i]!;
      const to = target.clone().sub(w.pos).setY(0);
      const d = to.length();
      if (d < 0.4) { w.i = (w.i + 1) % w.path.length; if (Math.random() < 0.15) w.paused = 1 + Math.random() * 2; continue; }
      const nearFight = fight && g.encounters.enemies.some((e) => e.alive && e.position.distanceTo(w.pos) < 18);
      if (nearFight) w.flee = 3;
      w.flee = Math.max(0, w.flee - dt);
      w.paused = Math.max(0, w.paused - dt);
      let dir = to.normalize();
      let speed = w.paused > 0 ? 0 : w.speed;
      if (w.flee > 0) { const away = w.pos.clone().sub(g.player.position).setY(0).normalize(); dir = dir.lerp(away, 0.7).normalize(); speed = 4.2; }
      const stopDist = g.player.position.distanceTo(w.pos);
      if (stopDist < 1.2 && w.flee <= 0) speed = 0;
      w.pos.addScaledVector(dir, speed * dt);
      const want = Math.atan2(-dir.x, -dir.z);
      let diff = want - w.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      w.yaw += diff * (1 - Math.exp(-6 * dt));
      w.avatar.root.position.copy(w.pos);
      w.avatar.root.rotation.y = w.yaw;
      w.avatar.setLocomotion(speed, 0, 1, true, dt);
      if (w.avatar.root.position.distanceTo(g.renderer.camera.position) < 60) w.avatar.update(dt);
    }
  }
}
