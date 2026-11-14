#!/usr/bin/env node
// Drives the built game the way a player finds a place in the compound
// (issue #33, scaled to the compound): opens the map with M, picks the ring,
// tracks it, follows the marker there, has the visit counted, and confirms
// the map offers no fast travel. Keys and clicks are real. The `?debug`
// hooks only read state and move the player between legs.
// Usage: node tools/check-navigation.mjs [url] [--url http://localhost:4173/] [--out captures/navigation] [--port 4173]
// Without a url it serves dist/ itself (run `npm run build` first).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveTarget } from './lib/target.mjs';

const { url, args, stop } = await resolveTarget();

const out = args.out ?? 'captures/navigation';
mkdirSync(out, { recursive: true });

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

console.log('boot, skip the tutorial with real clicks');
await page.goto(`${url}?debug`);
await page.waitForFunction(() => window.game?.game?.ready, null, { timeout: 180000 });
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => window.game?.game?.ready, null, { timeout: 180000 });
await page.getByRole('button', { name: 'Begin', exact: true }).click();
await page.locator('.card', { hasText: 'Recoil' }).click();
await page.getByRole('button', { name: 'Skip tutorial' }).click();
check((await waitState('explore')) === 'explore', 'lands in explore');
await page.waitForTimeout(1200);

console.log('compass and the automatic goal');
check(await page.locator('.compass').isVisible(), 'compass strip is on screen');
check((await page.locator('.compass .dir.main').count()) >= 1, 'compass shows cardinal letters');
const goal = await page.locator('.tracker .tr-title').textContent();
check(goal === 'Find the Pact Workshop', `the first goal tracks itself: "${goal}"`);
check((await nav()).unlocked.length === 0, 'nothing counts as visited at the start');
await shot('01-compass-goal');

console.log('open the map with M, pick the pond, track it');
await page.keyboard.press('KeyM');
check((await waitState('paused')) === 'paused', 'M opens the map');
await page.locator('.nav-map').waitFor();
check(await page.locator('.nav-map svg').isVisible(), 'the map is drawn');
check((await page.locator('.nav-map .m-building').count()) === 3, 'the map shows the hall, the storehouse and the gatehouse');
await shot('02-map-open');
await page.locator('[data-map-poi="pond"]').click();
await page.locator('.map-detail[data-detail="pond"]').waitFor();
check((await page.getByRole('button', { name: 'Fast travel' }).count()) === 0, 'the map offers no fast travel');
const kicker = await page.locator('.map-detail .kicker').textContent();
check(/Not yet visited/.test(kicker), `the pond reads as not yet visited: "${kicker}"`);
await page.getByRole('button', { name: 'Track', exact: true }).click();
await page.waitForTimeout(150);
check((await nav()).pin?.id === 'pond', 'Track pins the pond');
await shot('03-map-tracking-pond');
await page.keyboard.press('KeyM');
check((await waitState('explore')) === 'explore', 'M closes the map');
await page.waitForTimeout(500);

console.log('follow the marker in the top-down view');
await page.waitForTimeout(500);
check(await page.locator('.tracked-pip .gem').isVisible(), 'compass shows the tracked diamond');
check(await page.locator('.nav-marker .gem').isVisible(), 'a marker shows in the world');
const d0 = await markerDistance();
// Top-down: D walks east on the screen, toward the pond from the spawn.
await page.keyboard.down('ShiftLeft');
await page.keyboard.down('KeyD');
await page.waitForTimeout(800);
await page.keyboard.up('KeyD');
await page.keyboard.up('ShiftLeft');
await page.waitForTimeout(300);
const d1 = await markerDistance();
check(d0 - d1 > 4, `sprinting with D (east on the screen) closes the distance: ${d0} m to ${d1} m`);
await shot('04-marker-and-trail');

console.log('arrive at the pond and have the visit counted');
await teleport(11, 0, 16.2, [11, 11]);
await page.waitForTimeout(900);
const arrived = await nav();
check(arrived.pin === null, 'arriving clears the pin');
check(arrived.unlocked.includes('pond'), 'standing by the pond shrine counts the visit');
check(arrived.target?.poi === 'hall', `the goal list still points at the hall: ${arrived.target?.title}`);
const toasts = await page.locator('.toast').allTextContents();
check(toasts.some((t) => /Visited: Koi pond/.test(t)), 'a toast announces the visit');
await shot('05-visited');

console.log('visit the hall: the next goal comes up');
await teleport(-3.2, 0, 1.2, [0, -9]);
await page.waitForTimeout(900);
const hall = await nav();
check(hall.unlocked.includes('hall') && hall.target?.poi === 'ring', `the hall visit moves the goal on to the ring: ${hall.target?.title}`);
await page.keyboard.press('KeyM');
await waitState('paused');
await page.locator('[data-map-poi="hall"]').click();
await page.locator('.map-detail[data-detail="hall"]').waitFor();
check(/Visited/.test(await page.locator('.map-detail .kicker').textContent()), 'the map lists the hall as visited');
await shot('06-map-after-visits');
await page.keyboard.press('KeyM');
await waitState('explore');

console.log('landmark name labels in the over-the-shoulder view');
await page.evaluate(() => window.game.camera('third'));
await teleport(0, 0, 12, [0, -9]);
await page.waitForTimeout(1500);
const label = await page.locator('.nav-label .en').allTextContents();
check(label.includes('Training hall'), `the hall gets a name label as you approach: ${label.join(', ')}`);
await shot('07-landmark-label');

check(errors.length === 0, `zero page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
await browser.close();
stop();
if (failures.length) { console.error(`\n${failures.length} navigation checks failed`); process.exit(1); }
console.log(`\nnavigation ok, screenshots in ${out}`);
