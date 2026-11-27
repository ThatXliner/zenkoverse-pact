#!/usr/bin/env node
// Proves the scenes hand back control as a player expects, played with real
// keys and the mouse: a fight won by a Maximum Output's blow ends the fight,
// a drill is not offered in the middle of one, Tab from the pause menu opens
// the Workshop its footer names, and a draft is never tried in a real fight,
// even during the tutorial.
// Usage: node tools/check-scenes.mjs [url] [--port 4173]
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
const prompt = () => page.evaluate(() => document.querySelector('.prompt')?.textContent ?? '');

await page.goto(`${url}?debug`);
await page.waitForFunction(() => window.game?.game?.ready, null, { timeout: 180000 });

// Into the compound from the title, as a player does.
await page.keyboard.press('Enter');
await sleep(400);
await page.getByRole('button', { name: 'Skip tutorial' }).click();
await page.waitForFunction(() => window.game.state() === 'explore');
const fresh = (tutorial = false) => page.evaluate((tutorial) => {
  const g = window.game, G = g.game;
  G.startRun({ skipTutorial: !tutorial }); g.god(true); g.technique('recoil'); g.camera('top');
}, tutorial);

console.log('\nthe last partner falls to a Maximum Output');
await fresh();
await page.evaluate(() => window.game.teleport('ring'));
await sleep(300);
await page.keyboard.press('KeyE');
await sleep(600);
check(await state() === 'encounter', 'E at the ring starts the sparring fight');
await page.evaluate(() => { const G = window.game.game; const [a, b, c] = G.encounters.enemies; a.hurt(1e6); b.hurt(1e6); c.hp = 5; G.techniques.charge = 1; });
const at = await page.evaluate(() => { const G = window.game.game; const v = G.encounters.enemies[2].center().project(G.renderer.camera); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; });
await page.mouse.move(at[0], at[1]);
await sleep(100);
await page.keyboard.press('KeyQ');
await sleep(300);
check(await state() === 'cinematic', 'Q plays the Maximum Output');
await page.waitForFunction(() => !window.game.game.cutscenes.active, null, { timeout: 10000 });
await sleep(300);
const won = await page.evaluate(() => ({ st: window.game.state(), fighting: window.game.game.encounters.fighting }));
check(!won.fighting, 'the blow ends the fight');
check(won.st === 'explore', `and the game is back to exploring (${won.st})`);

console.log('\nno drill in the middle of a fight');
await fresh();
await page.evaluate(() => window.game.teleport('ring'));
await sleep(300);
await page.keyboard.press('KeyE');
await sleep(600);
await page.evaluate(() => window.game.teleport([-18.5, 0, 10]));
await sleep(300);
const offered = await prompt();
check(!/drill/i.test(offered), `the crane drill is not offered while the partners fight (${offered || 'no prompt'})`);
await page.keyboard.press('KeyE');
await sleep(400);
check(await state() === 'encounter' && await page.evaluate(() => window.game.game.drills.running) === null, 'E there starts no drill');

console.log('\nno fight in the middle of a drill');
await fresh();
await page.evaluate(() => window.game.teleport([-18.5, 0, 10]));
await sleep(300);
await page.keyboard.press('KeyE');
await sleep(400);
check(await state() === 'drill', 'E at the crane starts its drill');
await page.evaluate(() => window.game.teleport('ring'));
await sleep(300);
const ring = await prompt();
check(!/sparring/i.test(ring), `the sparring partners are not offered during the drill (${ring || 'no prompt'})`);
await page.keyboard.press('KeyE');
await sleep(400);
check(await page.evaluate(() => !window.game.game.encounters.fighting), 'E there starts no fight');
// Replaying the tutorial from the pause menu is a new scene: the drill goes with the old one.
await page.keyboard.press('Escape');
await sleep(300);
await page.getByRole('button', { name: 'Replay tutorial' }).click();
await sleep(500);
const replay = await page.evaluate(() => ({ st: window.game.state(), drill: window.game.game.drills.running, hud: !!document.querySelector('.drill') }));
check(replay.st === 'tutorial' && replay.drill === null, `Replay tutorial from the menu ends the drill (${replay.st}, drill ${replay.drill ?? 'none'})`);

console.log('\nTab from the pause menu');
await fresh();
await sleep(300);
await page.keyboard.press('Escape');
await sleep(300);
check(await state() === 'paused', 'Esc pauses');
const footer = await page.evaluate(() => document.querySelector('.pause-sheet footer')?.textContent ?? '');
check(/Tab\s*workshop/i.test(footer), 'the pause footer names Tab for the Workshop');
await page.keyboard.press('Tab');
await sleep(300);
check(await state() === 'workshop', 'Tab there opens the Workshop');
await page.keyboard.press('Tab');
await sleep(300);
check(await state() === 'explore', 'and Tab closes it back into play');

console.log('\na draft in the tutorial stays off a real fight');
await fresh(true);
await sleep(300);
check(await state() === 'tutorial', 'the tutorial is running');
await page.evaluate(() => window.game.teleport('ring'));
await sleep(300);
await page.keyboard.press('KeyE');
await sleep(600);
check(await page.evaluate(() => window.game.game.encounters.fighting), 'E at the ring starts the sparring fight in the tutorial');
await page.keyboard.press('Tab');
await sleep(400);
await page.getByText('+ New Pact').click();
await sleep(300);
const tryBtn = page.locator('.actions button', { hasText: /try it/i });
check(await tryBtn.isDisabled(), `the Workshop will not try it here, and says why ("${(await tryBtn.textContent())?.trim()}")`);
// The rule holds below the button too.
await page.evaluate(() => { const G = window.game.game; G.tryDraft(G.book.drafts.value.at(-1)); });
await sleep(300);
const draft = await page.evaluate(() => ({ preview: window.game.game.book.preview.value?.name ?? null, dummies: window.game.game.encounters.inDummyRoom }));
check(draft.preview === null, `no draft is on a key in the sparring fight (${draft.preview ?? 'none'})`);

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await browser.close();
await stop?.();
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
process.exit(failures.length ? 1 : 0);
