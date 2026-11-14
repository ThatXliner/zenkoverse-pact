// Fails when a character's suit colour reads as bare skin, or when an enemy's
// suit sits too close to the player's. Suits are flat fills in the cel look,
// so a warm, low-saturation, mid-light suit makes a character look naked, and
// two suits of one hue make a fight unreadable from the top-down camera.
// Run: npm run check:tints
import { readFileSync } from 'node:fs';

const hsl = (hex) => {
  const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  const s = max === min ? 0 : (max - min) / (l > 0.5 ? 2 - max - min : max + min);
  let h = 0;
  if (max !== min) h = max === r ? ((g - b) / (max - min)) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4;
  return { h: (h * 60 + 360) % 360, s, l };
};
const skinLike = (hex) => { const { h, s, l } = hsl(hex); return h >= 8 && h <= 50 && s >= 0.08 && s <= 0.55 && l >= 0.35; };
const hueGap = (a, b) => { const d = Math.abs(hsl(a).h - hsl(b).h) % 360; return Math.min(d, 360 - d); };

let failed = 0;
const report = (ok, line) => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${line}`); };

const avatar = readFileSync('src/character/avatar.ts', 'utf8');
const player = parseInt(/PLAYER_SUIT = (0x[0-9a-f]{6})/i.exec(avatar)[1], 16);
report(!skinLike(player), `player suit ${player.toString(16)} does not read as skin`);
const skins = [...avatar.matchAll(/(light|warm|dark): (0x[0-9a-f]{6})/gi)].map((m) => parseInt(m[2], 16));
report(skins.length >= 3, `${skins.length} flat skin tones defined`);

const enemies = readFileSync('src/combat/enemies.ts', 'utf8');
const rows = [...enemies.matchAll(/^\s*(\w+): \{[^\n]*tint: (0x[0-9a-f]{6})/gim)].map((m) => ({ key: m[1], tint: parseInt(m[2], 16) }));
report(rows.length >= 7, `${rows.length} enemy suits found`);
for (const { key, tint } of rows) {
  report(!skinLike(tint), `${key} suit ${tint.toString(16)} does not read as skin`);
  const { s, l } = hsl(tint);
  const gap = hueGap(tint, player);
  // Apart from the player by hue, or by being far lighter or darker.
  report(gap > 40 || Math.abs(l - hsl(player).l) > 0.3 || s < 0.12, `${key} suit is told apart from the player's (hue gap ${gap.toFixed(0)}°, lightness ${l.toFixed(2)})`);
}
// Roles that fight side by side differ from each other too.
const pairs = [['thug', 'bruiser'], ['thug', 'runner'], ['runner', 'husk'], ['bruiser', 'kuroda'], ['kuroda', 'ancient']];
for (const [a, b] of pairs) {
  const ta = rows.find((r) => r.key === a)?.tint, tb = rows.find((r) => r.key === b)?.tint;
  if (ta === undefined || tb === undefined) continue;
  const gap = hueGap(ta, tb), dl = Math.abs(hsl(ta).l - hsl(tb).l);
  report(gap > 30 || dl > 0.25, `${a} and ${b} are told apart (hue gap ${gap.toFixed(0)}°, lightness gap ${dl.toFixed(2)})`);
}
if (failed) { console.error(`${failed} tint checks failed`); process.exit(1); }
