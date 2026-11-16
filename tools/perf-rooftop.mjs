#!/usr/bin/env node
// Frame times on the roof with a whole wave on screen (issue #34: 60 fps at
// High). Plays the trial up to wave 7 (twelve enemies, with the player's aura field
// open and pushed out wide) and measures 180 frames
// in all three camera views at 1440x900, device pixel ratio 2. A second pass
// runs with the frame limiter off, so the number shows the headroom and not
// only the 60 fps cap. The courtyard, the hall and the valley are measured the same way, and an Aura Clash
// against the Master in the hall.
// --size 1920x1080 --dpr 1 --quality medium measure another window, density
// or preset (a mid laptop at 1080p is --size 1920x1080 --dpr 1).
// Usage: node tools/perf-rooftop.mjs [url] [--url http://localhost:4173/] [--port 4173] [--size WxH] [--dpr N] [--quality high|medium|low]
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
  return `${label}: median ${med.toFixed(1)}ms p95 ${times[171].toFixed(1)}ms (${(1000 / med).toFixed(0)} fps) calls ${s.drawCalls} tris ${s.triangles} enemies ${g.rooftop.status().alive} field ${g.aura().state}${g.aura().clash.stage ? ` clash ${g.aura().clash.stage}` : ''}`;
}, label);

for (const uncapped of [false, true]) {
  const flags = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', ...(uncapped ? ['--disable-frame-rate-limit', '--disable-gpu-vsync'] : [])];
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: flags });
  const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: dpr });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`${url}?debug`);
  await page.waitForFunction(() => window.game?.game?.ready, null, { timeout: 120000 });
  console.log(uncapped ? '\nframe limiter off' : 'vsync (60 Hz cap)');
  await page.evaluate((q) => { const g = window.game; g.technique('recoil'); g.game.renderer.setQuality(q); g.god(true); g.game.startRun({ skipTutorial: true }); g.teleport('courtyard'); g.camera('top'); }, quality);
  console.log(await measure(page, 'courtyard, top    '));
  await page.evaluate(() => { const g = window.game; g.teleport('hall'); g.camera('top'); });
  console.log(await measure(page, 'hall, top         '));
  await page.evaluate(() => { const g = window.game; g.teleport('courtyard'); g.camera('third'); g.look(0, -0.2); });
  console.log(await measure(page, 'courtyard, 3P     '));
  // Out in the valley: the road past the bridge, and the view back over the meadow to the walls.
  await page.evaluate(() => { const g = window.game; g.teleport('bridge'); g.camera('top'); });
  console.log(await measure(page, 'valley, top       '));
  await page.evaluate(() => { const g = window.game; g.teleport([20, 0, 70]); g.camera('third'); g.look(0.5, -0.1); });
  console.log(await measure(page, 'valley, 3P        '));
  // An Aura Clash in the hall: both fields, the seam and the side shot.
  await page.evaluate(() => { const g = window.game; g.camera('top'); g.auraReady(); g.encounter('ancient'); });
  await page.waitForTimeout(1500);
  await page.evaluate(async () => { const g = window.game; g.hold('aura', true); await new Promise((r) => setTimeout(r, 80)); g.hold('aura', false); });
  console.log(await measure(page, 'hall, aura clash  '));
  await page.evaluate(() => { const g = window.game; g.game.startRun({ skipTutorial: true }); g.god(true); });
  await page.evaluate(() => {
    const g = window.game;
    g.loop(false);
    g.rooftop.begin();
    for (let w = 1; w < 7; w++) {
      for (let i = 0; i < 800 && g.rooftop.status().app !== 'rooftop-offer'; i++) { g.rooftop.clearWave(); g.step(2); }
      const r = g.game.rooftop;
      if (g.rooftop.offers().length) r.choose(0); else { r.chooseEye('horizon'); if (g.rooftop.offers().length) r.choose(0); }
    }
    for (let i = 0; i < 800 && g.rooftop.status().alive < 12; i++) g.step(2);
    // The player's field open over the whole wave, pushed all the way out: the most ground it paints.
    g.auraReady(); g.hold('aura', true); g.step(100); g.hold('aura', false); g.step(20);
    g.loop(true);
  });
  await page.evaluate(() => window.game.camera('top'));
  console.log(await measure(page, 'roof wave 7, top  '));
  await page.evaluate(() => window.game.camera('third'));
  console.log(await measure(page, 'roof wave 7, 3P   '));
  await page.evaluate(() => window.game.camera('first'));
  console.log(await measure(page, 'roof wave 7, 1P   '));
  if (errs.length) console.log('errors', errs.slice(0, 5));
  await browser.close();
}
stop();
