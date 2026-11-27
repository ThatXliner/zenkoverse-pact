#!/usr/bin/env node
// Proves the pause menu holds the single-player world: a seal (what a lost
// Wager can cost) and the Ability cooldowns wait under it, and an Aura Clash
// with the Master is not decided while the player is in the menu. Played
// with real keys and the mouse.
// Usage: node tools/check-pause.mjs [url] [--port 4173]
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
const state = () => page.evaluate(() => window.game.state());

await page.goto(`${url}?debug`);
await page.waitForFunction(() => window.game?.game?.ready, null, { timeout: 180000 });
// The title mounts a moment after the game is ready (slower on the live
// site): press Enter once its first choice holds the focus, as a player would.
await page.waitForFunction(() => document.activeElement?.textContent === 'Begin', null, { timeout: 60000 });
await page.keyboard.press('Enter');
await sleep(400);
await page.getByRole('button', { name: 'Skip tutorial' }).click();
await page.waitForFunction(() => window.game.state() === 'explore');
const fresh = (tech) => page.evaluate((tech) => { const g = window.game, G = g.game; G.startRun({ skipTutorial: true }); g.technique(tech); g.camera('top'); G.techniques.sealed = 0; }, tech);

console.log('\na seal waits out the pause');
await fresh('recoil');
await page.evaluate(() => window.game.game.techniques.seal(4));
await page.keyboard.press('Escape');
await sleep(300);
check(await state() === 'paused', 'Esc pauses');
await sleep(4500);
await page.keyboard.press('Escape');
await sleep(100);
const sealed = await page.evaluate(() => window.game.game.techniques.sealed);
check(sealed > 3.4, `the seal is still on after 4.5 s in the menu (${sealed.toFixed(2)} s left of 4)`);

console.log('\na cooldown waits out the pause');
await fresh('rime');
await sleep(300);
await page.mouse.move(640, 250);
await page.mouse.down({ button: 'right' }); await sleep(60); await page.mouse.up({ button: 'right' });
await sleep(50);
await page.keyboard.press('Escape');
const cdBefore = await page.evaluate(() => window.game.game.techniques.cooldown?.secondary ?? null);
await sleep(1500);
const cdAfter = await page.evaluate(() => window.game.game.techniques.cooldown?.secondary ?? null);
await page.keyboard.press('Escape');
await sleep(200);
check(cdBefore > 0.5, `right click starts the secondary's cooldown (${cdBefore?.toFixed(2)} s)`);
check(Math.abs(cdAfter - cdBefore) < 0.05, `1.5 s in the menu leaves it where it was (${cdAfter?.toFixed(2)} s)`);

console.log('\nan Aura Clash waits out the pause');
await fresh('echo');
await page.evaluate(() => window.game.teleport([-4, 0.3, -9]));
await sleep(400);
await page.keyboard.press('KeyE');
await sleep(2500);
check(await state() === 'encounter', 'E on the mat challenges the Master');
await page.keyboard.down('KeyF'); await sleep(1500); await page.keyboard.up('KeyF');
await page.waitForFunction(() => window.game.aura().clash.stage === 'choose', null, { timeout: 8000 });
const at = await page.evaluate(() => window.game.aura().clash.view.round);
await page.keyboard.press('Escape');
await sleep(300);
check(await state() === 'paused', 'Esc pauses in the middle of an exchange');
await sleep(6000);
const held = await page.evaluate(() => { const a = window.game.aura(); return { stage: a.clash.stage, round: a.clash.view?.round ?? null }; });
check(held.stage === 'choose' && held.round === at, `six seconds later the exchange still waits for a pick (${held.stage}, round ${held.round} of ${at})`);
await page.keyboard.press('Escape');
await sleep(200);
await page.keyboard.press('KeyW');
await sleep(200);
const picked = await page.evaluate(() => window.game.aura().clash.view?.mine ?? null);
check(picked === 'push', `back in play, W pushes (${picked})`);

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await browser.close();
await stop?.();
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
process.exit(failures.length ? 1 : 0);
