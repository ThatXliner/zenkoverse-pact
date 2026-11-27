#!/usr/bin/env node
// Frame times in the city ward (`?debug&region=city`), measured the way
// tools/perf-rooftop.mjs measures the compound: 180 frames at each spot in
// the top-down view and over the shoulder, at 1440x900 and device pixel
// ratio 2 on the High preset, then again with the frame limiter off so the
// number shows the headroom and not only the 60 fps cap. The compound's
// courtyard is measured the same way first, for comparison.
// Usage: node tools/perf-city.mjs [url] [--size WxH] [--dpr N] [--quality high|medium|low]
import { chromium } from 'playwright';
import { resolveTarget } from './lib/target.mjs';

const { url, args, stop } = await resolveTarget();
const [vw, vh] = (args.size ?? '1440x900').split('x').map(Number);
const dpr = Number(args.dpr ?? 2);
const quality = args.quality ?? 'high';
console.log(`${vw}x${vh} at DPR ${dpr}, ${quality} preset`);

const measure = (page, label) => page.evaluate(async (label) => {
  const g = window.game;
  await new Promise((r) => setTimeout(r, 1500));
  const times = [];
  let last = performance.now();
  await new Promise((res) => { let n = 0; const f = (t) => { times.push(t - last); last = t; if (++n < 180) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
  times.sort((a, b) => a - b);
  const s = g.stats();
  const med = times[90];
  return `${label}: median ${med.toFixed(1)}ms p95 ${times[171].toFixed(1)}ms (${(1000 / med).toFixed(0)} fps) calls ${s.drawCalls} tris ${s.triangles}`;
}, label);

// Region metres; the city stands at its origin.
const SPOTS = [
  ['plaza', [-7, 0.1, -20.6], 0],
  ['arcade', [0, 0.1, 4], 0],
  ['roofs', [-9, 7.1, -5.6], 0],
  ['platform', [-6, 7.2, -37.6], -1.4],
  ['kuroda yard', [36, 0.1, 3], 1.2],
  ['canal', [-16.5, 0.1, 38.4], 0],
];

for (const uncapped of [false, true]) {
  const flags = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', ...(uncapped ? ['--disable-frame-rate-limit', '--disable-gpu-vsync'] : [])];
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: flags });
  const errs = [];
  console.log(uncapped ? '\nframe limiter off' : 'vsync (60 Hz cap)');
  {
    const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: dpr });
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(`${url}?debug`);
    await page.waitForFunction(() => window.game?.game?.ready, null, { timeout: 120000 });
    await page.evaluate((q) => { const g = window.game; g.game.renderer.setQuality(q); g.god(true); g.game.startRun({ skipTutorial: true }); g.teleport('courtyard'); g.camera('top'); }, quality);
    console.log(await measure(page, 'compound courtyard, top'.padEnd(26)));
    await page.close();
  }
  const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: dpr });
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`${url}?debug&region=city`);
  await page.waitForFunction(() => window.game?.game?.ready, null, { timeout: 120000 });
  await page.evaluate((q) => { const g = window.game; g.game.renderer.setQuality(q); g.god(true); g.game.startRun({ skipTutorial: true }); }, quality);
  for (const [name, [x, y, z], yaw] of SPOTS) {
    for (const view of ['top', 'third']) {
      await page.evaluate(([p, view, yaw]) => { const g = window.game, o = g.world().origins.city; g.teleport([p[0] + o[0], p[1] + o[1], p[2] + o[2]]); g.camera(view); if (view === 'third') g.look(yaw, -0.12); }, [[x, y, z], view, yaw]);
      console.log(await measure(page, `city ${name}, ${view === 'top' ? 'top' : '3P'}`.padEnd(26)));
    }
  }
  if (errs.length) console.log('errors', errs.slice(0, 5));
  await browser.close();
}
stop();
