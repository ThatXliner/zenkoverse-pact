// Fails when a character suit tint reads as bare skin. A suit is drawn at half
// the tint's brightness over a skinned body, so a warm, low-saturation, mid-light
// tint makes a clothed character look naked. Run: npm run check:tints
import { readFileSync } from 'node:fs';

const files = ['src/combat/enemies.ts', 'src/world/pedestrians.ts'];
const skinLike = (hex) => {
  const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  const s = max === min ? 0 : (max - min) / (l > 0.5 ? 2 - max - min : max + min);
  let h = 0;
  if (max !== min) h = max === r ? ((g - b) / (max - min)) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4;
  h = (h * 60 + 360) % 360;
  return h >= 8 && h <= 50 && s >= 0.08 && s <= 0.55 && l >= 0.35;
};
let failed = 0;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const tints = [...src.matchAll(/tint:\s*(0x[0-9a-f]{6})/gi)].map((m) => m[1]);
  const lists = [...src.matchAll(/tints\s*=\s*\[([^\]]+)\]/g)].flatMap((m) => m[1].match(/0x[0-9a-f]{6}/gi) ?? []);
  for (const t of [...tints, ...lists]) {
    const bad = skinLike(parseInt(t, 16));
    if (bad) failed++;
    console.log(`${bad ? 'FAIL' : 'ok  '} ${f} ${t}${bad ? ' reads as skin' : ''}`);
  }
}
if (failed) { console.error(`${failed} suit tints read as skin`); process.exit(1); }
