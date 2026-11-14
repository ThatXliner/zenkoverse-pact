#!/usr/bin/env node
// Quick look: boots the built game on the real GPU, runs a list of debug
// steps and saves one screenshot per step. For iterating on the look.
//   node tools/peek.mjs [url] --out captures/peek --shots "name:js|name:js" [--w 1280 --h 720]
// Each `js` runs with `g` (the debug api) in scope after the run starts.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveTarget } from './lib/target.mjs';

const { url, args, stop } = await resolveTarget();
const out = args.out ?? 'captures/peek';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(args.w ?? 1280), height: Number(args.h ?? 720) }, deviceScaleFactor: Number(args.dpr ?? 1) });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/favicon|GPU stall|Automatic fallback/.test(m.text())) errors.push(`console: ${m.text()}`); });
await page.goto(`${url}?debug`);
await page.waitForFunction(() => window.game?.game?.ready, null, { timeout: 180000 });
await page.evaluate(() => { const g = window.game; g.loop(false); g.technique(new URLSearchParams(location.search).get('tech') ?? 'recoil'); g.game.startRun({ skipTutorial: true }); g.loop(false); g.step(10); });
const shots = (args.shots ?? 'yard:g.teleport("courtyard")').split('|').filter(Boolean);
for (const s of shots) {
  const i = s.indexOf(':');
  const name = s.slice(0, i), js = s.slice(i + 1);
  await page.evaluate((code) => { const g = window.game; new Function('g', code)(g); g.step(30); }, js);
  await page.waitForTimeout(100);
  await page.screenshot({ path: join(out, `${name}.png`), animations: 'disabled' });
  console.log(`  ${name}`);
}
const perf = await page.evaluate(() => window.game.stats());
console.log('stats', JSON.stringify(perf));
const pageErrors = await page.evaluate(() => window.game.errors);
for (const e of [...errors, ...pageErrors]) console.log('ERROR', e);
await browser.close();
stop();
