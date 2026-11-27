import * as THREE from 'three';
import { toon } from '../../render/materials';

// Every painted board in the district (shop signs, the station's name board,
// placards, the arcade's gate) is lettered into one canvas, so all of them
// share two materials: plain boards, and boards lit from behind. A board's
// face is a plane whose UVs point at its cell. The lettering is redrawn once
// the page's fonts have loaded, since the district may be built before.

export type Lettering = 'mincho' | 'gothic' | 'brush';
export interface SignStyle {
  paper: string;
  ink: string;
  font?: Lettering;
  // A thin rule inside the edge, in the ink colour.
  rule?: boolean;
  // A second, smaller line under the first (horizontal boards only).
  sub?: string;
  // A drawn mark in place of lettering: the Kuroda crest, a drop of vapour
  // with a flame's tongue rising out of it, inside a ring.
  mark?: 'crest';
}

const SIZE = 2048;
const FONTS: Record<Lettering, string> = {
  mincho: '"Shippori Mincho B1", serif',
  gothic: '"Zen Kaku Gothic New", sans-serif',
  brush: '"Yuji Syuku", "Shippori Mincho B1", serif',
};

interface Cell { x: number; y: number; w: number; h: number; text: string; vertical: boolean; style: SignStyle }

export class SignAtlas {
  private canvas = document.createElement('canvas');
  private cells: Cell[] = [];
  // Shelves by height class (in steps of 40 px), so a tall board does not
  // leave a tall gap beside every short one.
  private shelves: { y: number; h: number; x: number }[] = [];
  private top = 0;
  // A board lettered once is reused: the two faces of a blade sign share a cell.
  private byKey = new Map<string, Cell>();
  readonly texture: THREE.CanvasTexture;
  readonly plain: THREE.MeshToonMaterial;
  readonly lit: THREE.MeshToonMaterial;

  constructor() {
    this.canvas.width = this.canvas.height = SIZE;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.plain = toon(0xffffff, { map: this.texture });
    this.lit = toon(0xffffff, { map: this.texture, emissive: 0xffffff, emissiveIntensity: 0.42 });
    this.lit.emissiveMap = this.texture;
    void document.fonts?.ready.then(() => this.redraw());
  }

  // A board's face: `w` by `h` metres, the plane facing +z. Pixels follow
  // the board's proportions at up to 110 px a metre, its long side at most 512.
  face(text: string, w: number, h: number, style: SignStyle): THREE.PlaneGeometry {
    const key = `${text}|${w}|${h}|${JSON.stringify(style)}`;
    const cell = this.byKey.get(key) ?? this.place(key, text, w, h, style);
    const geo = new THREE.PlaneGeometry(w, h);
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      const u = (cell.x + uv.getX(i) * cell.w) / SIZE;
      const v = 1 - (cell.y + (1 - uv.getY(i)) * cell.h) / SIZE;
      uv.setXY(i, u, v);
    }
    return geo;
  }

  private place(key: string, text: string, w: number, h: number, style: SignStyle): Cell {
    const vertical = h > w * 1.4 && !style.sub;
    const k = Math.min(110, 512 / Math.max(w, h));
    const pw = Math.ceil(w * k), ph = Math.ceil(h * k);
    const cls = Math.ceil(ph / 40) * 40;
    let shelf = this.shelves.filter((sh) => sh.h >= ph && sh.h < ph * 2 && sh.x + pw <= SIZE).sort((a, b) => a.h - b.h)[0];
    if (!shelf) {
      if (this.top + cls > SIZE) throw new Error('sign atlas full');
      shelf = { y: this.top, h: cls, x: 0 };
      this.shelves.push(shelf);
      this.top += cls + 2;
    }
    const cell: Cell = { x: shelf.x, y: shelf.y, w: pw, h: ph, text, vertical, style };
    shelf.x += pw + 2;
    this.cells.push(cell);
    this.byKey.set(key, cell);
    this.draw(cell);
    this.texture.needsUpdate = true;
    return cell;
  }

  private redraw(): void {
    for (const c of this.cells) this.draw(c);
    this.texture.needsUpdate = true;
  }

  private draw(c: Cell): void {
    const g = this.canvas.getContext('2d')!;
    const { style: s } = c;
    g.save();
    g.beginPath();
    g.rect(c.x, c.y, c.w, c.h);
    g.clip();
    g.fillStyle = s.paper;
    g.fillRect(c.x, c.y, c.w, c.h);
    if (s.rule) {
      g.strokeStyle = s.ink;
      g.lineWidth = Math.max(2, Math.min(c.w, c.h) * 0.035);
      const m = Math.min(c.w, c.h) * 0.07;
      g.strokeRect(c.x + m, c.y + m, c.w - m * 2, c.h - m * 2);
    }
    g.fillStyle = s.ink;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const family = FONTS[s.font ?? 'mincho'];
    const weight = s.font === 'gothic' ? 700 : s.font === 'brush' ? 400 : 800;
    const chars = [...c.text];
    if (s.mark === 'crest') crest(g, c.x + c.w / 2, c.y + c.h / 2, Math.min(c.w, c.h) * 0.46, s.ink, s.paper);
    else if (c.vertical) {
      const step = c.h / (chars.length + 0.6);
      const size = Math.min(c.w * 0.72, step * 0.92);
      g.font = `${weight} ${size}px ${family}`;
      chars.forEach((ch, i) => g.fillText(ch, c.x + c.w / 2, c.y + step * (i + 0.8)));
    } else {
      const lines = s.sub ? 2 : 1;
      const main = Math.min(c.h * (lines === 2 ? 0.52 : 0.7), (c.w * 0.86) / Math.max(1, chars.length * 0.98));
      g.font = `${weight} ${main}px ${family}`;
      g.fillText(c.text, c.x + c.w / 2, c.y + c.h * (lines === 2 ? 0.38 : 0.53), c.w * 0.9);
      if (s.sub) {
        g.font = `500 ${c.h * 0.17}px ${FONTS.gothic}`;
        g.fillText(s.sub, c.x + c.w / 2, c.y + c.h * 0.78, c.w * 0.9);
      }
    }
    g.restore();
  }
}

// The Kuroda mon: a heavy ring, and inside it a drop with a tongue of flame
// curling up out of its point, in one ink.
function crest(g: CanvasRenderingContext2D, x: number, y: number, r: number, ink: string, paper: string): void {
  g.strokeStyle = ink;
  g.fillStyle = ink;
  g.lineWidth = r * 0.14;
  g.beginPath();
  g.arc(x, y, r * 0.9, 0, Math.PI * 2);
  g.stroke();
  // The drop.
  g.beginPath();
  g.moveTo(x, y - r * 0.55);
  g.bezierCurveTo(x + r * 0.42, y - r * 0.05, x + r * 0.46, y + r * 0.5, x, y + r * 0.56);
  g.bezierCurveTo(x - r * 0.46, y + r * 0.5, x - r * 0.42, y - r * 0.05, x, y - r * 0.55);
  g.fill();
  // The tongue: a hollow curl cut out of the drop's shoulder.
  g.fillStyle = paper;
  g.beginPath();
  g.moveTo(x - r * 0.06, y + r * 0.38);
  g.bezierCurveTo(x - r * 0.3, y + r * 0.1, x + r * 0.05, y - r * 0.05, x - r * 0.02, y - r * 0.3);
  g.bezierCurveTo(x + r * 0.22, y - r * 0.02, x + r * 0.2, y + r * 0.3, x - r * 0.06, y + r * 0.38);
  g.fill();
}
