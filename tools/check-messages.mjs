#!/usr/bin/env node
// Proves what the game tells the player holds when they act on it, with real
// keys and the mouse: the Pact Architect's words stay up after a plaque read
// just before them, the toast for trying a draft names a way to stop that
// works when followed, and every single key in the README's controls table
// is bound in the game's own controls sheet.
// Usage: node tools/check-messages.mjs [url] [--port 4173]
// Without a URL it serves dist/ itself (run `npm run build` first).
import { readFileSync } from 'node:fs';
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
const text = (sel) => page.evaluate((sel) => document.querySelector(sel)?.textContent ?? '', sel);
const toasts = () => page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent));

await page.goto(`${url}?debug`);
await page.waitForFunction(() => window.game?.game?.ready, null, { timeout: 180000 });
await page.keyboard.press('Enter');
await sleep(400);
await page.getByRole('button', { name: 'Skip tutorial' }).click();
await page.waitForFunction(() => window.game.state() === 'explore');
const fresh = () => page.evaluate(() => { const g = window.game; g.game.startRun({ skipTutorial: true }); g.technique('recoil'); g.camera('top'); });

console.log('\na plaque, then the Pact Architect');
await fresh();
await page.evaluate(() => window.game.teleport([-13.3, 0.3, -9]));
await sleep(400);
check(/Read plaque/.test(await text('.prompt')), 'the plaque on the hall wall offers itself');
await page.keyboard.press('KeyE');
await sleep(2500);
// A few steps along the hall to the desk.
await page.evaluate(() => window.game.teleport([-10, 0.3, -14.5]));
await sleep(300);
await page.keyboard.press('KeyE');
await sleep(300);
check(/Pact Architect/.test(await text('.plaque')), 'E at the desk: the Architect speaks');
await sleep(4800);
check(/Pact Architect/.test(await text('.plaque')), `five seconds on he is still speaking ("${(await text('.plaque')).slice(0, 40)}")`);
check(/Open the Pact Workshop/.test(await text('.prompt')), `and E is ready to open the Workshop ("${await text('.prompt')}")`);

console.log('\ntrying a draft says how to stop, and that way works');
await fresh();
await sleep(300);
await page.keyboard.press('Tab');
await sleep(400);
await page.getByText('+ New Pact').click();
await sleep(300);
await page.getByRole('button', { name: 'Try it on the dummies' }).click();
await sleep(500);
const said = (await toasts()).find((t) => t.startsWith('Trying')) ?? '';
console.log(`    "${said}"`);
const viaMenu = /choose (.+?) in the Esc menu/.exec(said);
check(!/Esc[^.]*\bstops\b/.test(said), 'it does not claim Esc alone stops the try');
check(!!viaMenu, 'it names the Esc menu choice that does');
await page.keyboard.press('Escape');
await sleep(400);
if (viaMenu) await page.getByRole('button', { name: viaMenu[1] }).click();
await sleep(400);
const after = await page.evaluate(() => ({ st: window.game.state(), preview: window.game.game.book.preview.value?.name ?? null, dummies: window.game.game.encounters.inDummyRoom }));
check(after.preview === null && !after.dummies, `following it, the draft is off its key and the room is closed (${after.preview ?? 'no draft'}, ${after.dummies ? 'in the room' : 'out'})`);

console.log('\nthe README\'s controls are the game\'s');
await page.keyboard.press('Escape');
await sleep(300);
await page.getByRole('tab', { name: 'controls' }).click();
await sleep(300);
const bound = new Set(await page.evaluate(() => [...document.querySelectorAll('.kcell')].map((c) => c.textContent.trim())));
const rows = readFileSync(new URL('../README.md', import.meta.url), 'utf8').split('\n').filter((l) => /^\| [^-]/.test(l) && !/^\| Key \|/.test(l));
const keys = rows.map((l) => l.split('|')[1].trim()).filter((k) => /^[A-Z]$/.test(k));
check(keys.length >= 6, `the table lists its single keys (${keys.join(' ')})`);
for (const k of keys) check(bound.has(k), `${k} is bound in the game's controls sheet`);
await page.keyboard.press('Escape');

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await browser.close();
await stop?.();
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
process.exit(failures.length ? 1 : 0);
