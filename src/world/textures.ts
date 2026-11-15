import * as THREE from 'three';

// The compound's painted surfaces: small canvases of flat colour with a thin
// dark line, tiled in world metres (boxUV) so a 48 m wall and a 1 m post
// carry the same pattern at the same size. They stay quiet; the ink pass and
// the tone do the drawing.

const hex = (c: number | THREE.Color): string => '#' + new THREE.Color(c).getHexString();

function canvasTexture(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// Flagstones: flat cells of two close tones with a thin dark joint.
export function flagstones(a: number, b: number, line: number, cells = 4): THREE.CanvasTexture {
  return canvasTexture(256, (g, s) => {
    const ca = new THREE.Color(a), cb = new THREE.Color(b);
    const size = s / cells;
    for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++) {
      g.fillStyle = hex(ca.clone().lerp(cb, ((x * 7 + y * 13) % 5) / 5));
      g.fillRect(x * size, y * size, size, size);
    }
    g.strokeStyle = hex(line);
    g.lineWidth = 3;
    for (let i = 0; i <= cells; i++) { g.beginPath(); g.moveTo(i * size, 0); g.lineTo(i * size, s); g.stroke(); g.beginPath(); g.moveTo(0, i * size); g.lineTo(s, i * size); g.stroke(); }
  });
}

// Planks: long boards with a dark seam, for floors, decks and wall boarding.
export function planks(a: number, b: number, line: number, boards = 6): THREE.CanvasTexture {
  return canvasTexture(256, (g, s) => {
    const ca = new THREE.Color(a), cb = new THREE.Color(b);
    const w = s / boards;
    for (let i = 0; i < boards; i++) {
      g.fillStyle = hex(ca.clone().lerp(cb, ((i * 5) % 4) / 4));
      g.fillRect(i * w, 0, w, s);
      g.fillStyle = hex(line);
      g.fillRect(i * w, 0, 2, s);
      g.fillRect(i * w, (i * 97) % s, w, 2);
    }
  });
}

// Roof tile (kawara) from above: rounded channels running down the slope
// (along v), a lit edge and a shaded edge on each, and the lap line where
// one row of tiles sits on the next. Four channels and four rows a repeat.
export function kawara(base: number, light: number, dark: number): THREE.CanvasTexture {
  return canvasTexture(128, (g, s) => {
    const n = 4, w = s / n;
    g.fillStyle = hex(base);
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < n; i++) {
      const x = i * w;
      // The round cover tile over the joint, lit on one side.
      g.fillStyle = hex(light);
      g.fillRect(x + w * 0.72, 0, w * 0.14, s);
      g.fillStyle = hex(dark);
      g.fillRect(x + w * 0.86, 0, w * 0.14, s);
    }
    g.fillStyle = hex(dark);
    for (let r = 0; r < n; r++) {
      const y = r * w + ((r % 2) * 3);
      g.fillRect(0, y, s, 2);
    }
  });
}

// Tatami: straw mats a metre by two with a dark cloth border on the long
// sides, laid in the usual staggered pattern. One repeat is 4 by 4 metres.
export function tatami(straw: number, strawShade: number, border: number): THREE.CanvasTexture {
  return canvasTexture(256, (g, s) => {
    const m = s / 4; // pixels per metre
    g.fillStyle = hex(straw);
    g.fillRect(0, 0, s, s);
    // Mats as [x, y, w, h] in metres.
    const mats: [number, number, number, number][] = [
      [0, 0, 1, 2], [1, 0, 2, 1], [1, 1, 2, 1], [3, 0, 1, 2],
      [0, 2, 2, 1], [0, 3, 2, 1], [2, 2, 1, 2], [3, 2, 1, 2],
    ];
    mats.forEach(([x, y, w, h], i) => {
      // Neighbouring mats catch the light a shade apart: the weave runs a different way.
      g.fillStyle = hex(i % 3 === 1 ? strawShade : straw);
      g.fillRect(x * m + 1, y * m + 1, w * m - 2, h * m - 2);
      g.fillStyle = hex(border);
      const b = 5;
      if (w > h) { g.fillRect(x * m, y * m, w * m, b); g.fillRect(x * m, (y + h) * m - b, w * m, b); }
      else { g.fillRect(x * m, y * m, b, h * m); g.fillRect((x + w) * m - b, y * m, b, h * m); }
    });
    g.strokeStyle = hex(new THREE.Color(border).lerp(new THREE.Color(straw), 0.4));
    g.lineWidth = 1;
    mats.forEach(([x, y, w, h]) => g.strokeRect(x * m + 0.5, y * m + 0.5, w * m - 1, h * m - 1));
  });
}

// Box UVs in world metres: each face's UVs scaled to its size over `metres`
// per repeat, so a texture tiles at one size on every box. `swap` turns the
// top and bottom faces a quarter, for tile channels that must run along x.
export function boxUV(geo: THREE.BoxGeometry, metres: number, swap = false): THREE.BoxGeometry {
  const { width: w, height: h, depth: d } = geo.parameters;
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  // Face order: +x, -x, +y, -y, +z, -z; four corners each (one segment).
  const sizes: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const [su, sv] = sizes[f]!;
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      const u = uv.getX(i) * su / metres, v = uv.getY(i) * sv / metres;
      if (swap && (f === 2 || f === 3)) uv.setXY(i, v, u); else uv.setXY(i, u, v);
    }
  }
  uv.needsUpdate = true;
  return geo;
}

// Dressed stone in courses: long blocks of two or three close greys, each
// course's joints offset from the last. One repeat is 2 by 2 metres.
export function ashlar(a: number, b: number, line: number): THREE.CanvasTexture {
  return canvasTexture(256, (g, s) => {
    const rows = 5, h = s / rows;
    const ca = new THREE.Color(a), cb = new THREE.Color(b);
    for (let r = 0; r < rows; r++) {
      let x = -((r * 37) % 60);
      let i = 0;
      while (x < s) {
        const w = 70 + ((r * 31 + i * 53) % 4) * 22;
        g.fillStyle = hex(ca.clone().lerp(cb, ((r * 3 + i * 5) % 4) / 4));
        g.fillRect(x, r * h, w, h);
        g.fillStyle = hex(line);
        g.fillRect(x, r * h, 3, h);
        x += w; i++;
      }
      g.fillStyle = hex(line);
      g.fillRect(0, r * h, s, 3);
    }
  });
}
