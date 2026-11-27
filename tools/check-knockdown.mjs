#!/usr/bin/env node
// Proves a knockdown can't be chained into a lock, as check-freeze proves for
// a freeze: twelve seconds of left click mashed at a thug with Blink's Flinch
// (the cone that throws a body down), chasing it with W, from the top-down
// view, with real keys and the mouse. The thug gets up, and swings back.
// Usage: node tools/check-knockdown.mjs [url] [--port 4173]
// Without a URL it serves dist/ itself (run `npm run build` first).
import { chromium } from 'playwright';
import { resolveTarget } from './lib/target.mjs';

const { url, stop } = await resolveTarget();
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
const failures = [];
const check = (ok, what) => { if (!ok) failures.push(what); console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(`${url}?debug`);
await page.waitForFunction(() => window.game?.game?.ready, null, { timeout: 180000 });
await page.keyboard.press('Enter');
await sleep(400);
await page.getByRole('button', { name: 'Skip tutorial' }).click();
await page.waitForFunction(() => window.game.state() === 'explore');

console.log('\nBlink mashed at a thug for 12 s');
await page.evaluate(() => {
  const g = window.game, G = g.game, V = G.player.position.constructor;
  G.startRun({ skipTutorial: true }); g.technique('blink'); g.god(true); g.camera('top'); g.teleport([0, 0, 7]);
  const e = G.encounters.spawn('thug', new V(0, 0, 4.5)); e.hp = e.maxHp = 1e6; e.castCd = 1e6;
  // Read the body every frame: how long it stays down or staggered at a stretch, and every wind-up it starts.
  const L = window.__down = { frames: 0, down: 0, run: 0, longest: 0, swings: 0, throws: 0, prev: '' };
  const tick = () => {
    if (L.stop) return;
    L.frames++;
    const s = e.state;
    if (s === 'knocked' || s === 'stagger') { L.down++; L.run++; L.longest = Math.max(L.longest, L.run); } else L.run = 0;
    if (s === 'windup' && L.prev !== 'windup') L.swings++;
    if (s === 'knocked' && L.prev !== 'knocked') L.throws++;
    L.prev = s;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  window.__thug = e;
});
const t0 = Date.now();
while (Date.now() - t0 < 12000) {
  const at = await page.evaluate(() => {
    const G = window.game.game, e = window.__thug;
    const d = e.position.distanceTo(G.player.position);
    const v = e.center().project(G.renderer.camera);
    return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight, d];
  });
  await page.mouse.move(at[0], at[1]);
  if (at[2] > 3.5) await page.keyboard.down('KeyW'); else await page.keyboard.up('KeyW');
  await page.mouse.down(); await sleep(40); await page.mouse.up(); await sleep(40);
}
await page.keyboard.up('KeyW');
const r = await page.evaluate(() => { const L = window.__down; L.stop = true; return { ...L, fps: L.frames / 12 }; });
const s = (frames) => (frames / r.fps).toFixed(1);
console.log(`    thrown ${r.throws} times, down or staggered ${Math.round(100 * r.down / r.frames)}% of the time`);
check(r.throws >= 2, `the cone throws it down (${r.throws} times)`);
check(r.longest / r.fps < 2.5, `it is never held down longer than one knockdown (${s(r.longest)} s at most)`);
check(r.swings >= 1, `it gets up and swings back (${r.swings} wind-ups)`);

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await browser.close();
await stop?.();
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
process.exit(failures.length ? 1 : 0);
