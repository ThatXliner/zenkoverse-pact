#!/usr/bin/env node
// Frame times in a full online room (issue #44: 60 fps with 8 players). One
// browser joins a room through the title, and seven headless room members
// (tools/lib/bots.mjs) run circles around it in the courtyard, casting with
// effects every couple of seconds. It measures 180 frames in each camera
// view at 1440x900, device pixel ratio 2, first at the 60 Hz cap and then
// with the frame limiter off to show the headroom.
// Usage: node tools/perf-multiplayer.mjs [url] [--latency 120] [--port 4181]
import { chromium } from 'playwright';
import { resolveTarget } from './lib/target.mjs';
import { bot } from './lib/bots.mjs';

const { url, stop } = await resolveTarget(process.argv.slice(2), { realtime: true });
const room = `perf-${Date.now().toString(36)}`;

const measure = (page, label) => page.evaluate(async (label) => {
  await new Promise((r) => setTimeout(r, 1500));
  const times = [];
  let last = performance.now();
  await new Promise((res) => { let n = 0; const f = (t) => { times.push(t - last); last = t; if (++n < 180) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
  times.sort((a, b) => a - b);
  const s = window.game.stats();
  const n = window.game.net();
  const med = times[90];
  return `${label}: median ${med.toFixed(1)}ms p95 ${times[171].toFixed(1)}ms (${(1000 / med).toFixed(0)} fps) calls ${s.drawCalls} tris ${s.triangles} players ${n.remotes.filter((r) => r.visible).length + 1}`;
}, label);

let failed = false;
for (const uncapped of [false, true]) {
  const flags = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', ...(uncapped ? ['--disable-frame-rate-limit', '--disable-gpu-vsync'] : [])];
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: flags });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`${url}?debug&room=${room}`);
  await page.waitForFunction(() => window.game?.game?.ready, null, { timeout: 120000 });
  await page.locator('input[name=name]').fill('Measure');
  await page.locator('[data-join]').click();
  await page.waitForFunction(() => window.game.net()?.status === 'online', null, { timeout: 15000 });
  const bots = Array.from({ length: 7 }, (_, i) => bot(url, room, i));
  await Promise.all(bots.map((b) => b.ready));
  await page.evaluate(() => { const g = window.game; g.game.renderer.setQuality('high'); g.teleport([-3, 0, 4]); g.camera('top'); });
  await page.waitForFunction(() => window.game.net().remotes.filter((r) => r.visible).length === 7, null, { timeout: 10000 });
  console.log(uncapped ? '\nframe limiter off' : 'vsync (60 Hz cap)');
  const top = await measure(page, 'courtyard, top   ');
  console.log(top);
  await page.evaluate(() => { window.game.camera('third'); window.game.look(0, -0.2); });
  console.log(await measure(page, 'courtyard, 3P    '));
  await page.evaluate(() => window.game.camera('first'));
  console.log(await measure(page, 'courtyard, 1P    '));
  if (!uncapped && Number(/median ([\d.]+)ms/.exec(top)[1]) > 17.5) failed = true;
  if (errs.length) { console.log('errors', errs.slice(0, 5)); failed = true; }
  for (const b of bots) b.close();
  await browser.close();
}
stop();
process.exit(failed ? 1 : 0);
