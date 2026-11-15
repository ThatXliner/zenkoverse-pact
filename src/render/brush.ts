import * as THREE from 'three';

// Brush marks for the effects, painted once on a canvas at start: an ensō
// (one open circle of a loaded brush, its bristles splitting dry toward the
// end) for the shock rings, and a dry-brush stroke for the smears. Both are
// white paint with a darker bristle edge, tinted by the effect's colour, so a
// ring reads as a painted stroke on the page and not as a glow.

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

let enso: THREE.CanvasTexture | null = null;
// The ring sits at radius 0.9 of the texture's half-width, about 0.14 thick,
// so a 2x2 quad scaled by r draws a ring of radius about r.
export function ensoTexture(): THREE.CanvasTexture {
  if (enso) return enso;
  const S = 512, c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  const rand = rng(7);
  const R = S * 0.45, T = S * 0.07;
  const bristles = 46;
  ctx.lineCap = 'round';
  for (let b = 0; b < bristles; b++) {
    const across = b / (bristles - 1) - 0.5;
    const r = R + across * T * 2 + (rand() - 0.5) * 3;
    const edge = Math.abs(across) > 0.36;
    const shade = edge ? 40 + rand() * 50 : 215 + rand() * 40;
    const start = -0.35 + rand() * 0.12;
    const sweep = Math.PI * 2 * (0.78 + rand() * 0.14 - Math.abs(across) * 0.25);
    const steps = 140;
    let a0 = start;
    for (let i = 0; i < steps; i++) {
      const u = i / steps;
      const a1 = start + sweep * ((i + 1) / steps);
      // Loaded at the start, splitting dry toward the end.
      const dry = u > 0.55 && rand() < (u - 0.55) * 1.9;
      if (!dry) {
        const w = (1 - Math.abs(across) * 1.2) * (0.55 + 0.45 * Math.sin(Math.min(1, u * 4) * Math.PI * 0.5)) * (1.15 - u * 0.5) * 3.2;
        ctx.strokeStyle = `rgba(${shade},${shade},${shade},${(0.75 + rand() * 0.25) * (1 - u * 0.35)})`;
        ctx.lineWidth = Math.max(0.6, w);
        ctx.beginPath();
        ctx.arc(S / 2, S / 2, r + Math.sin(u * 9 + b) * 1.2, a0, a1);
        ctx.stroke();
      }
      a0 = a1;
    }
  }
  enso = new THREE.CanvasTexture(c);
  enso.colorSpace = THREE.SRGBColorSpace;
  return enso;
}

let stroke: THREE.CanvasTexture | null = null;
// u runs along the stroke, v across it: loaded and dark-edged in the middle,
// bristles splitting at both ends.
export function strokeTexture(): THREE.CanvasTexture {
  if (stroke) return stroke;
  const W = 512, H = 64, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  const rand = rng(11);
  const bristles = 22;
  for (let b = 0; b < bristles; b++) {
    const v = (b + 0.5) / bristles;
    const edge = Math.abs(v - 0.5) > 0.36;
    const shade = edge ? 50 + rand() * 40 : 220 + rand() * 35;
    const from = rand() * 0.12 + Math.abs(v - 0.5) * 0.3, to = 1 - rand() * 0.2 - Math.abs(v - 0.5) * 0.35;
    for (let x = Math.floor(from * W); x < to * W; x += 2) {
      const u = x / W;
      if ((u < 0.18 || u > 0.7) && rand() < 0.35) continue;
      ctx.fillStyle = `rgba(${shade},${shade},${shade},${0.7 + rand() * 0.3})`;
      ctx.fillRect(x, v * H - 1.4, 2, 2.8 * (1 - Math.abs(u - 0.45) * 0.8));
    }
  }
  stroke = new THREE.CanvasTexture(c);
  stroke.colorSpace = THREE.SRGBColorSpace;
  return stroke;
}
