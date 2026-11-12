#!/usr/bin/env node
// Drives the built game the way a player finds the dojo (issue #33): opens the
// map with M, picks the dojo, tracks it, follows the marker there, unlocks its
// waypoint, then fast-travels back to the market from the map. Keys and
// clicks are real. The `?debug` hooks only read state and move the player
// between legs, so the run does not have to walk the whole district.
// Usage: node tools/check-navigation.mjs [url] [--url http://localhost:4173/] [--out captures/navigation] [--port 4173]
// Without a url it serves dist/ itself (run `npm run build` first).
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const positional = process.argv.slice(2).find((a) => /^https?:/.test(a));
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? 'true' : all[i + 1]] : [])).filter((x) => x.length));
const out = args.out ?? 'captures/navigation';
mkdirSync(out, { recursive: true });

let server = null;
let url = args.url ?? positional;
if (!url) {
  if (!existsSync('dist/index.html')) throw new Error('dist/ missing: run npm run build first');
  const port = args.port ?? '4173';
  server = spawn('npx', ['vite', 'preview', '--port', port, '--strictPort'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1800));
  url = `http://localhost:${port}/`;
}

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|WebGL|GPU stall|Automatic fallback/.test(m.text())) errors.push(`console: ${m.text()}`); });
const failures = [];
const check = (ok, what) => { if (!ok) failures.push(what); console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const shot = (name) => page.screenshot({ path: join(out, `${name}.png`), animations: 'disabled' });
const state = () => page.evaluate(() => window.game.state());
const waitState = async (kind) => { await page.waitForFunction((k) => window.game.state() === k, kind, { timeout: 8000 }).catch(() => undefined); return state(); };
const nav = () => page.evaluate(() => {
  const n = window.game.game.nav;
  const p = window.game.game.player.position;
  const t = n.target.value;
  return { unlocked: [...n.unlocked.value], pin: n.pin.value, target: t && { source: t.source, poi: t.poi ?? null, title: t.title }, at: [p.x, p.y, p.z] };
});
const teleport = (x, y, z, face) => page.evaluate(([x, y, z, face]) => {
  const g = window.game;
  g.teleport([x, y, z]);
  const t = g.game.nav.target.value;
  const to = face ?? (t ? [t.position.x, t.position.z] : null);
  if (to) g.look(Math.atan2(-(to[0] - x), -(to[1] - z)), -0.05);
}, [x, y, z, face ?? null]);
const markerDistance = async () => {
  const text = await page.locator('.tracked-pip .d').first().textContent();
  return Number.parseInt(text ?? '', 10);
};
const near = (a, b, r) => Math.hypot(a[0] - b[0], a[2] - b[2]) < r;
const MARKET = [-20, 0, 2];

console.log('boot, skip the tutorial with real clicks');
await page.goto(`${url}?debug`);
await page.waitForFunction(() => window.game?.game?.ready, null, { timeout: 180000 });
await page.getByRole('button', { name: 'Begin', exact: true }).click();
await page.locator('.card', { hasText: 'Recoil' }).click();
await page.getByRole('button', { name: 'Skip tutorial' }).click();
check((await waitState('explore')) === 'explore', 'lands in explore');
await page.waitForTimeout(1200);

console.log('compass and the automatic goal');
await page.evaluate(() => window.game.look(Math.PI / 2 + 0.3, -0.02));
await page.waitForTimeout(500);
check(await page.locator('.compass').isVisible(), 'compass strip is on screen');
check((await page.locator('.compass .dir.main').count()) >= 1, 'compass shows cardinal letters');
const goal = await page.locator('.tracker .tr-title').textContent();
check(goal === 'Find the Pact Workshop', `the first goal tracks itself: "${goal}"`);
check((await nav()).unlocked.includes('market'), 'spawning beside the market shrine unlocks its waypoint');
await shot('01-compass-goal');

console.log('open the map with M, pick the dojo, track it');
await page.keyboard.press('KeyM');
check((await waitState('paused')) === 'paused', 'M opens the map');
await page.locator('.nav-map').waitFor();
check(await page.locator('.nav-map svg').isVisible(), 'the map is drawn');
await shot('02-map-open');
await page.locator('[data-map-poi="dojo"]').click();
await page.locator('.map-detail[data-detail="dojo"]').waitFor();
const reason = await page.locator('.map-detail .why').textContent();
check(await page.getByRole('button', { name: 'Fast travel' }).isDisabled(), `dojo fast travel is locked until visited: "${reason}"`);
await page.getByRole('button', { name: 'Track', exact: true }).click();
await page.waitForTimeout(150);
check((await nav()).pin?.id === 'dojo', 'Track pins the dojo');
await shot('03-map-tracking-dojo');
await page.keyboard.press('KeyM');
check((await waitState('explore')) === 'explore', 'M closes the map');
await page.waitForTimeout(500);

console.log('follow the marker');
await teleport(...MARKET);
await page.waitForTimeout(500);
check(await page.locator('.tracked-pip .gem').isVisible(), 'compass shows the tracked diamond');
check(await page.locator('.nav-marker .gem').isVisible(), 'a marker shows in the world');
const d0 = await markerDistance();
await page.keyboard.down('ShiftLeft');
await page.keyboard.down('KeyW');
await page.waitForTimeout(1300);
await page.keyboard.up('KeyW');
await page.keyboard.up('ShiftLeft');
await page.waitForTimeout(300);
const d1 = await markerDistance();
check(d0 - d1 > 4, `walking with W closes the distance on the compass: ${d0} m to ${d1} m`);
await teleport(-26, 0, -33);
await page.waitForTimeout(1500);
const far = await markerDistance();
check(far > 20 && far < 40, `marker reads ${far} m from the open lot`);
check((await page.locator('.nav-marker .name, .nav-label').count()) >= 1, 'the dojo is named once it is near, by the marker or its label');
await shot('04-marker-and-trail');
await teleport(-26, 0, -50);
await page.waitForTimeout(1300);
await shot('05-marker-close');
check((await nav()).unlocked.includes('dojo') === false, 'the dojo waypoint is still locked before the visit');

console.log('arrive at the dojo and unlock its waypoint');
await teleport(-28, 0, -58.5, [-26, -66]);
await page.waitForTimeout(900);
const arrived = await nav();
check(arrived.pin === null, 'arriving clears the pin');
check(arrived.unlocked.includes('dojo'), 'visiting the shrine unlocks the dojo waypoint');
check(arrived.target?.poi === 'alley', `the next goal tracks itself: ${arrived.target?.title}`);
const toasts = await page.locator('.toast').allTextContents();
check(toasts.some((t) => /Waypoint unlocked: Pact Workshop/.test(t)), 'a toast announces the waypoint');
await shot('06-waypoint-unlocked');

console.log('fast travel back to the market from the map');
await page.keyboard.press('KeyM');
await waitState('paused');
await page.locator('[data-map-poi="market"]').click();
await page.locator('.map-detail[data-detail="market"]').waitFor();
await shot('07-map-select-market');
const travel = page.getByRole('button', { name: 'Fast travel' });
check(await travel.isEnabled(), 'market fast travel is enabled');
await travel.click();
check((await waitState('explore')) === 'explore', 'fast travel closes the map');
await page.waitForTimeout(500);
check(await page.locator('.travel-fade').count() === 1, 'the screen fades through the jump');
const landed = (await nav()).at;
check(near(landed, MARKET, 3), `the player lands at the market: ${landed.map((v) => v.toFixed(1)).join(', ')}`);
await page.waitForTimeout(1500);
await shot('08-after-fast-travel');

console.log('landmark name labels');
await teleport(-26, 0, -36, [-26, -66]);
await page.waitForTimeout(1500);
const label = await page.locator('.nav-label .en').allTextContents();
check(label.includes('Pact Workshop'), `the dojo gets a name label as you approach: ${label.join(', ')}`);
await shot('09-landmark-label');

check(errors.length === 0, `zero page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
await browser.close();
server?.kill();
if (failures.length) { console.error(`\n${failures.length} navigation checks failed`); process.exit(1); }
console.log(`\nnavigation ok, screenshots in ${out}`);
