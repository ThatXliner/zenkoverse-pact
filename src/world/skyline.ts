import * as THREE from 'three';

// The city on the horizon, as a painted backdrop: far mountains in haze,
// then the city's blocks and towers in two flat tones, a broadcast tower,
// an old pagoda and a castle keep standing among them, warm windows coming
// on at dusk, and a band of haze at their foot. It is a strip of painted
// canvas on the inside of a wide arc round the col, so it faces the lookout
// wherever the eye turns, and it is the first sight of the city from the
// pass. When a city region stands (`hidesSkyline`), the real one takes over.

const CENTRE = new THREE.Vector3(80, 0, 258);
const RADIUS = 520;
// The arc spans this much either side of due south from the centre.
const SPAN = 0.62;
const BASE = 8, HEIGHT = 150;

export function buildSkyline(): THREE.Mesh {
  const W = 4096, H = 512;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  let seed = 11;
  const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  // y in canvas pixels from the bottom (0 is the strip's foot).
  const Y = (h: number) => H - h;

  // Far mountains: two hazy ridges.
  for (const [col, base, amp, f] of [['#b9c4cf', 150, 110, 0.0021], ['#a8b6c4', 110, 70, 0.0047]] as const) {
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= W; x += 16) g.lineTo(x, Y(base + amp * (0.55 + 0.45 * Math.sin(x * f + base) * Math.sin(x * f * 2.3 + 1.7))));
    g.lineTo(W, H);
    g.closePath();
    g.fill();
  }

  // The city: a crowd of blocks in the middle third, densest at the centre.
  const city = (x0: number, x1: number): void => {
    // Back rank, paler.
    const blocks: { x: number; w: number; h: number; tone: string }[] = [];
    for (let x = x0; x < x1;) {
      const centre = 1 - Math.abs((x - (x0 + x1) / 2) / ((x1 - x0) / 2));
      const w = 14 + r() * 34, h = 40 + centre * 170 * (0.4 + r() * 0.7) + (r() < 0.08 ? 90 : 0);
      blocks.push({ x, w, h, tone: r() < 0.5 ? '#8e98b4' : '#97a0bb' });
      x += w * (0.7 + r() * 0.4);
    }
    for (const b of blocks) {
      g.fillStyle = b.tone;
      g.fillRect(b.x, Y(b.h), b.w, b.h);
      // Stepped tops and rooftop boxes.
      if (r() < 0.4) g.fillRect(b.x + b.w * 0.2, Y(b.h + 8 + r() * 14), b.w * 0.5, 22);
    }
    // Front rank, deeper, with an ink edge and lit windows.
    const front: { x: number; w: number; h: number }[] = [];
    for (let x = x0 + 30; x < x1 - 30;) {
      const centre = 1 - Math.abs((x - (x0 + x1) / 2) / ((x1 - x0) / 2));
      const w = 18 + r() * 40, h = 24 + centre * 120 * (0.3 + r() * 0.8);
      front.push({ x, w, h });
      x += w * (0.85 + r() * 0.5);
    }
    g.fillStyle = '#6d7594';
    for (const b of front) g.fillRect(b.x, Y(b.h), b.w, b.h);
    g.strokeStyle = 'rgba(30,26,40,0.55)';
    g.lineWidth = 2.4;
    g.beginPath();
    for (const b of front) { g.moveTo(b.x, H); g.lineTo(b.x, Y(b.h)); g.lineTo(b.x + b.w, Y(b.h)); g.lineTo(b.x + b.w, H); }
    g.stroke();
    // Windows: a few warm, most dark, in loose rows.
    for (const b of front) for (let wy = 14; wy < b.h - 8; wy += 11) for (let wx = b.x + 4; wx < b.x + b.w - 5; wx += 8) {
      const k = r();
      if (k > 0.82) { g.fillStyle = k > 0.95 ? '#ffe7b0' : '#f2b968'; g.fillRect(wx, Y(wy), 3.4, 4.6); }
    }
  };
  const cx = W / 2;
  city(cx - 760, cx + 820);

  // Landmarks: a broadcast tower right of centre, a pagoda and a castle keep to the left.
  const ink = '#3a3648';
  g.fillStyle = '#5f6788';
  g.strokeStyle = ink;
  g.lineWidth = 3;
  {
    const x = cx + 210, h = 420;
    g.beginPath(); g.moveTo(x - 26, H); g.lineTo(x - 5, Y(h * 0.62)); g.lineTo(x + 5, Y(h * 0.62)); g.lineTo(x + 26, H); g.closePath(); g.fill(); g.stroke();
    g.fillRect(x - 3, Y(h), 6, h * 0.4); g.strokeRect(x - 3, Y(h), 6, h * 0.4);
    g.beginPath(); g.ellipse(x, Y(h * 0.64), 22, 9, 0, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = '#ff5a3c'; g.fillRect(x - 2, Y(h) - 6, 4, 6);
  }
  g.fillStyle = '#5f6788';
  {
    // Five roofs stepping in.
    const x = cx - 430;
    for (let i = 0; i < 5; i++) {
      const w = 64 - i * 9, y = 70 + i * 30;
      g.beginPath(); g.moveTo(x - w, Y(y)); g.quadraticCurveTo(x - w * 0.4, Y(y + 4), x - w * 0.55, Y(y + 12)); g.lineTo(x + w * 0.55, Y(y + 12)); g.quadraticCurveTo(x + w * 0.4, Y(y + 4), x + w, Y(y)); g.closePath(); g.fill(); g.stroke();
      g.fillRect(x - w * 0.42, Y(y + 30), w * 0.84, 18);
    }
    g.fillRect(x - 2, Y(250), 4, 40);
  }
  {
    // The keep on its stone base.
    const x = cx - 640;
    g.beginPath(); g.moveTo(x - 70, H); g.lineTo(x - 56, Y(60)); g.lineTo(x + 56, Y(60)); g.lineTo(x + 70, H); g.closePath(); g.fill(); g.stroke();
    for (let i = 0; i < 3; i++) {
      const w = 54 - i * 12, y = 60 + i * 34;
      g.fillRect(x - w * 0.8, Y(y + 26), w * 1.6, 26);
      g.beginPath(); g.moveTo(x - w * 1.15, Y(y + 26)); g.lineTo(x, Y(y + 44)); g.lineTo(x + w * 1.15, Y(y + 26)); g.closePath(); g.fill(); g.stroke();
    }
  }

  // Haze over the city's foot, warm like the evening air, so it rises out of the distance.
  const haze = g.createLinearGradient(0, H, 0, Y(110));
  haze.addColorStop(0, 'rgba(233,194,160,1)');
  haze.addColorStop(0.45, 'rgba(233,194,160,0.75)');
  haze.addColorStop(1, 'rgba(233,194,160,0)');
  g.fillStyle = haze;
  g.globalCompositeOperation = 'source-atop';
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: false, alphaTest: 0.5, fog: false, side: THREE.BackSide, toneMapped: false });
  // An arc of a cylinder round the col: the inside faces the lookout.
  const geo = new THREE.CylinderGeometry(RADIUS, RADIUS, HEIGHT, 48, 1, true, -SPAN, SPAN * 2);
  // three.js wraps the cylinder's u the other way round from inside; flip it so the city reads left to right.
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
  const m = new THREE.Mesh(geo, mat);
  m.position.set(CENTRE.x, BASE + HEIGHT / 2, CENTRE.z);
  m.name = 'skyline';
  m.frustumCulled = false;
  m.renderOrder = -5;
  return m;
}
