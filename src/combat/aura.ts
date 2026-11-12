import * as THREE from 'three';
import { signal } from '@preact/signals';
import type { Game } from '../app/game';
import { banner } from '../app/game';

export const auraUi = { active: signal(false), energy: signal(1), clash: signal<number | null>(null) };

const shellVert = /* glsl */ `varying vec3 vN; varying vec3 vV; void main(){ vN = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`;
const shellFrag = /* glsl */ `uniform vec3 color; uniform float time; uniform float strength; varying vec3 vN; varying vec3 vV;
void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 2.6); float band = 0.5 + 0.5*sin(time*5.0 + vN.y*14.0); gl_FragColor = vec4(color*(0.9+band*0.3), (f*0.9 + 0.03) * strength); }`;

// Aura Expansion on F and Aura Clash against a boss field. Issue #4 defers
// the full design; this keeps the arena rules inside one module.
export class Aura {
  active = false;
  energy = 1;
  radius = 0;
  clash = 0;
  clashing = false;
  private shell: THREE.Mesh;
  private bossShell: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private bossMat: THREE.ShaderMaterial;

  constructor(private game: Game) {
    const mk = (color: number) => new THREE.ShaderMaterial({ uniforms: { color: { value: new THREE.Color(color) }, time: { value: 0 }, strength: { value: 1 } }, vertexShader: shellVert, fragmentShader: shellFrag, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    this.mat = mk(0xffffff);
    this.bossMat = mk(0x7dffb2);
    this.shell = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), this.mat);
    this.bossShell = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), this.bossMat);
    this.shell.visible = this.bossShell.visible = false;
    game.renderer.scene.add(this.shell, this.bossShell);
  }

  pressureOn(p: THREE.Vector3): boolean { return this.active && p.distanceTo(this.game.player.position) < this.radius; }

  update(dt: number): void {
    const g = this.game;
    const wants = g.input.isDown('aura') && this.energy > 0.02 && g.rooftop.auraAllowed;
    if (wants && !this.active) { g.audio.play('phaserUp3', 0.5, 0.4); g.tutorial.notify('aura'); }
    this.active = wants;
    this.energy = THREE.MathUtils.clamp(this.energy + (this.active ? -0.14 : 0.07) * dt, 0, 1);
    const boss = g.encounters.enemies.find((e) => e.aura.active && e.alive);
    let clashing = false;
    if (boss && this.active) {
      const d = boss.position.distanceTo(g.player.position);
      clashing = d < this.radius + boss.aura.radius;
    }
    if (clashing && boss) {
      const push = 0.55 + (g.combat.hp / g.combat.maxHp) * 0.35;
      this.clash += (push - 0.42) * dt;
      if (this.clash >= 1) {
        this.clash = 0;
        boss.aura.active = false;
        boss.aura.collapsed = true;
        boss.hurt(60, { knock: 3 });
        banner('崩壊', 'Her field collapsed. Press the opening.');
        g.renderer.impactFrame(2, new THREE.Color(0xffffff));
        g.clock.hitStop(0.1);
        setTimeout(() => { if (boss.alive) boss.aura.active = true; }, 9000);
      } else if (this.clash <= -1) {
        this.clash = 0;
        this.energy = 0;
        banner('乱れ', 'Your field collapsed. Recover.');
        g.combat.hurtPlayer(12, { from: boss.center(), kinetic: true });
      }
    } else this.clash *= Math.exp(-dt);
    this.clashing = clashing;

    const target = this.active ? 7 * (1 + this.clash * 0.5) : 0;
    this.radius += (target - this.radius) * (1 - Math.exp(-4 * dt));
    this.mat.uniforms.color!.value = new THREE.Color(g.techniques.def.color).lerp(new THREE.Color(0xffffff), 0.5);
    this.mat.uniforms.time!.value = g.clock.time;
    this.mat.uniforms.strength!.value = g.cam.isFirst ? 0.35 : 0.8;
    this.shell.visible = this.radius > 0.2;
    this.shell.position.copy(g.player.position).add(new THREE.Vector3(0, 0.9, 0));
    this.shell.scale.setScalar(Math.max(0.01, this.radius));
    if (boss) {
      this.bossShell.visible = boss.aura.radius > 0.2;
      this.bossShell.position.copy(boss.center());
      this.bossShell.scale.setScalar(Math.max(0.01, boss.aura.radius));
      this.bossMat.uniforms.time!.value = g.clock.time;
      if (boss.aura.active && !this.active && boss.position.distanceTo(g.player.position) < boss.aura.radius) g.player.speedScale = 0.6;
      else if (g.player.speedScale < 1 && !clashing) g.player.speedScale = Math.min(1, g.player.speedScale + dt);
    } else this.bossShell.visible = false;
    auraUi.active.value = this.active;
    auraUi.energy.value = this.energy;
    auraUi.clash.value = clashing ? this.clash : null;
  }
}
