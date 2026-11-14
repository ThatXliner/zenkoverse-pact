#!/usr/bin/env node
// Frame times on the roof with a whole wave on screen (issue #34: 60 fps at
// High). Plays the trial up to wave 7 (twelve enemies) and measures 180 frames
// in all three camera views at 1440x900, device pixel ratio 2. A second pass
// runs with the frame limiter off, so the number shows the headroom and not
// only the 60 fps cap. The courtyard and the hall are measured the same way.
// Usage: node tools/perf-rooftop.mjs [url] [--url http://localhost:4173/] [--port 4173]
import { chromium } from 'playwright';
import { resolveTarget } from './lib/target.mjs';

const { url, args, stop } = await resolveTarget();


const measure = (page, label) => page.evaluate(async (label) => {
  const g = window.game;
  await new Promise((r) => setTimeout(r, 1500));
  const times = [];
  let last = performance.now();
  await new Promise((res) => { let n = 0; const f = (t) => { times.push(t - last); last = t; if (++n < 180) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
  times.sort((a, b) => a - b);
  const s = g.stats();
  const med = times[90];
  return `${label}: median ${med.toFixed(1)}ms p95 ${times[171].toFixed(1)}ms (${(1000 / med).toFixed(0)} fps) calls ${s.drawCalls} tris ${s.triangles} enemies ${g.rooftop.status().alive}`;
}, label);

for (const uncapped of [false, true]) {
  const flags = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', ...(uncapped ? ['--disable-frame-rate-limit', '--disable-gpu-vsync'] : [])];
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: flags });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`${url}?debug`);
  await page.waitForFunction(() => window.game?.game?.ready, null, { timeout: 120000 });
  console.log(uncapped ? '\nframe limiter off' : 'vsync (60 Hz cap)');
  await page.evaluate(() => { const g = window.game; g.technique('recoil'); g.game.renderer.setQuality('high'); g.god(true); g.game.startRun({ skipTutorial: true }); g.teleport('courtyard'); g.camera('top'); });
  console.log(await measure(page, 'courtyard, top    '));
  await page.evaluate(() => { const g = window.game; g.teleport('hall'); g.camera('top'); });
  console.log(await measure(page, 'hall, top         '));
  await page.evaluate(() => { const g = window.game; g.teleport('courtyard'); g.camera('third'); g.look(0, -0.2); });
  console.log(await measure(page, 'courtyard, 3P     '));
  await page.evaluate(() => {
    const g = window.game;
    g.loop(false);
    g.rooftop.begin();
    for (let w = 1; w < 7; w++) {
      for (let i = 0; i < 800 && g.rooftop.status().app !== 'rooftop-offer'; i++) { g.rooftop.clearWave(); g.step(2); }
      const r = g.game.rooftop;
      if (g.rooftop.offers().length) r.choose(0); else { r.chooseEye('horizon'); r.acceptAura(); if (g.rooftop.offers().length) r.choose(0); }
    }
    for (let i = 0; i < 800 && g.rooftop.status().alive < 12; i++) g.step(2);
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
