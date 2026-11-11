import * as THREE from 'three';

export interface NeonDef { text: string; color: number; position: [number, number, number]; rotationY: number; width?: number; vertical?: boolean; flicker?: number; light?: boolean }

export class NeonSign {
  readonly group = new THREE.Group();
  private mat: THREE.MeshStandardMaterial;
  private light: THREE.PointLight | null = null;
  private seed = Math.random() * 100;
  private flicker: number;
  private color: THREE.Color;

  constructor(def: NeonDef) {
    const vertical = def.vertical ?? false;
    const canvas = document.createElement('canvas');
    canvas.width = vertical ? 256 : 1024;
    canvas.height = vertical ? 1024 : 256;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const col = '#' + new THREE.Color(def.color).getHexString();
    ctx.font = `700 ${vertical ? 150 : 170}px "Shippori Mincho B1", "Zen Kaku Gothic New", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = col;
    ctx.shadowBlur = 38;
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = col;
    ctx.lineWidth = 10;
    if (vertical) {
      const chars = [...def.text];
      const step = canvas.height / (chars.length + 0.5);
      chars.forEach((c, i) => { ctx.strokeText(c, 128, step * (i + 0.75)); ctx.fillText(c, 128, step * (i + 0.75)); });
    } else {
      ctx.strokeText(def.text, 512, 128);
      ctx.fillText(def.text, 512, 128);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    this.color = new THREE.Color(def.color);
    this.mat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: def.color, emissiveMap: tex, emissiveIntensity: 5, alphaMap: tex, transparent: true, roughness: 0.6, side: THREE.DoubleSide });
    const w = def.width ?? (vertical ? 0.9 : 3.6);
    const h = vertical ? w * 4 : w / 4;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.mat);
    const backing = new THREE.Mesh(new THREE.BoxGeometry(w + 0.16, h + 0.16, 0.08), new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.55, metalness: 0.6 }));
    backing.position.z = -0.05;
    backing.castShadow = true;
    this.group.add(backing, plane);
    this.group.position.set(...def.position);
    this.group.rotation.y = def.rotationY;
    this.flicker = def.flicker ?? 0;
    if (def.light !== false) {
      this.light = new THREE.PointLight(def.color, 28, 14, 2);
      this.light.position.set(0, -h * 0.3, 0.6);
      this.group.add(this.light);
    }
  }

  update(time: number): void {
    let f = 1;
    if (this.flicker > 0) {
      const s = Math.sin(time * 17 + this.seed) * Math.sin(time * 5.3 + this.seed * 2) * Math.sin(time * 0.7 + this.seed);
      f = s > 0.84 - this.flicker ? 0.15 : 1;
      f *= 0.94 + 0.06 * Math.sin(time * 90 + this.seed);
    }
    this.mat.emissiveIntensity = 5 * f;
    if (this.light) this.light.intensity = 28 * f;
  }
}
