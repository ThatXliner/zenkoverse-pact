#!/usr/bin/env node
// Drives the built game the way a player does, with real clicks and keys:
// title, Technique select, the Workshop, inscribing, the dummy room, the
// tutorial's Pact step, and then the whole tutorial from its first step to
// its last in the default top-down view. Times the 30-second test from
// issue #29 ("Absorption, only from the front, while held") and fails on any
// page error.
// Usage: node tools/check-flow.mjs [url] [--url http://localhost:4173/] [--out captures/flow] [--port 4173]
// Without a URL it serves dist/ itself (run `npm run build` first). The
// `?debug` hooks are used only to read state and to skip walking.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveTarget } from './lib/target.mjs';

const { url, args, stop } = await resolveTarget();

const out = args.out ?? 'captures/flow';
mkdirSync(out, { recursive: true });


const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|WebGL|GPU stall|Automatic fallback/.test(m.text())) errors.push(`console: ${m.text()}`); });
const failures = [];
const check = (ok, what) => { if (!ok) failures.push(what); console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const shot = async (name) => { await page.screenshot({ path: join(out, `${name}.png`), animations: 'disabled' }); };
const state = () => page.evaluate(() => window.game.state());
const book = () => page.evaluate(() => { const b = window.game.game.book; return { inscribed: b.inscribed.value, drafts: b.drafts.value, bindings: b.bindings.value, preview: b.preview.value }; });
const waitState = async (kind) => { await page.waitForFunction((k) => window.game.state() === k, kind, { timeout: 8000 }).catch(() => undefined); return state(); };
const ready = async () => { await page.goto(`${url}?debug`); await page.waitForFunction(() => window.game?.game?.ready, null, { timeout: 180000 }); await page.waitForTimeout(400); };
const clickCanvas = async (button = 'left', holdMs = 0) => {
  await page.mouse.move(640, 360);
  await page.mouse.down({ button });
  if (holdMs) await page.waitForTimeout(holdMs);
  await page.mouse.up({ button });
};

console.log('title and Technique select');
await ready();
await page.getByRole('button', { name: 'Begin', exact: true }).click();
await page.locator('.card', { hasText: 'Recoil' }).click();
await page.getByRole('button', { name: 'Skip tutorial' }).click();
check((await waitState('explore')) === 'explore', 'Skip tutorial lands in explore');
await page.waitForTimeout(600);
const hudNames = await page.locator('.ab .name').allTextContents();
check(hudNames.join('|') === 'Kinetic Release|Absorption|Zero Hour', `HUD names the catalogue Abilities: ${hudNames.join(', ')}`);
const hudWhat = await page.locator('.ab .what').allTextContents();
check(hudWhat.every((w) => w.length > 0), `HUD says what each key does: ${hudWhat.join(' / ')}`);
await shot('01-hud');

console.log('30-second test: draft "Absorption, only from the front, while held"');
await page.keyboard.press('Tab');
await page.locator('.ws-sheet').waitFor();
await shot('02-workshop-open');
let clicks = 0;
const click = async (loc) => { await loc.click(); clicks++; };
const t0 = performance.now();
await click(page.locator('.ws-book .bk.new'));
const nameInput = page.getByLabel('Pact name');
await click(nameInput);
await nameInput.fill('Absorption');
await click(page.locator('.ws-sentence .ph', { hasText: 'releases stored energy as a strike' }));
await click(page.locator('.opt', { hasText: 'takes incoming motion into the Reserve' }));
await click(page.getByRole('button', { name: '+ add a term' }));
await click(page.locator('.opt', { hasText: 'Direction' }));
await click(page.locator('.opt', { hasText: 'only from the front' }));
await click(page.getByRole('button', { name: '+ add a term' }));
await click(page.locator('.opt', { hasText: 'Duration' }));
await click(page.locator('.opt', { hasText: 'while held' }));
const seconds = (performance.now() - t0) / 1000;
await shot('03-draft-absorption');
{
  const b = await book();
  const d = b.drafts.find((p) => p.name === 'Absorption');
  const terms = d ? d.clauses.filter((c) => c.kind === 'restrict').map((c) => `${c.restriction.param}:${c.restriction.value}`) : [];
  check(!!d && d.grant.shape === 'absorb' && d.slot === 'secondary', 'draft takes the absorb shape on right click');
  check(terms.includes('direction:front') && terms.includes('duration:held') && terms.length === 2, `draft terms are front and held: ${terms.join(', ')}`);
  const sentence = await page.locator('.ws-sentence').innerText();
  check(/only from the front/.test(sentence) && /while held/.test(sentence), 'the sentence reads back both terms');
  check(seconds < 30, `drafted in ${seconds.toFixed(1)} s with ${clicks} clicks (limit 30 s)`);
  var absorptionId = d?.id;
}

console.log('inscribe behind hold-to-confirm, then Esc closes');
await page.getByRole('button', { name: 'Inscribe', exact: true }).click();
await page.locator('.confirm .box').waitFor();
await shot('04-confirm');
{
  const hold = page.getByRole('button', { name: 'Hold to inscribe' });
  const bb = await hold.boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1500);
  await page.mouse.up();
  const b = await book();
  check(b.inscribed.some((p) => p.id === absorptionId), 'the draft is inscribed');
  check(b.bindings.recoil?.secondary === absorptionId, 'right click is bound to the new Pact');
  check(b.inscribed.filter((p) => p.technique === 'recoil').length === 5, `five Recoil Pacts inscribed (4 catalogue + 1): ${b.inscribed.length}`);
}
await page.keyboard.press('Escape');
check((await waitState('explore')) === 'explore', 'Esc closes the Workshop');

console.log('use the Ability in the dummy room, in the top-down view');
await page.evaluate(() => window.game.encounter('dummy-room'));
await page.waitForTimeout(600);
check((await page.evaluate(() => window.game.game.cam.mode)) === 'top', 'the fight is in the top-down view');
// The nearest dummy stands west: aim the cursor left of the player and walk A.
await page.mouse.move(380, 330);
await page.waitForTimeout(200);
await page.keyboard.down('KeyA');
await page.waitForTimeout(420);
await page.keyboard.up('KeyA');
await page.waitForTimeout(200);
await page.mouse.down(); await page.mouse.up();
await page.waitForTimeout(900);
const hurt = await page.evaluate(() => window.game.game.encounters.enemies.some((e) => e.hp < e.def.hp));
check(hurt, 'left click lands Kinetic Release on the dummy under the cursor');
await page.mouse.down({ button: 'right' }); await page.waitForTimeout(700); await page.mouse.up({ button: 'right' });
await page.waitForTimeout(400);
await shot('05-dummy-room');

console.log('try a draft on the dummies before inscribing');
await page.keyboard.press('Tab');
await page.locator('.ws-sheet').waitFor();
await page.locator('.ws-book .bk.new').click();
await page.getByLabel('Pact name').fill('Trial');
await page.locator('.opt', { hasText: 'Trigger' }).click();
await page.locator('.opt', { hasText: 'only with feet on the ground' }).click();
await page.getByRole('button', { name: 'Try it on the dummies' }).click();
check((await waitState('encounter')) === 'encounter', 'Try it returns to the dummy room');
await page.waitForTimeout(500);
check((await book()).preview?.name === 'Trial', 'the draft is the preview');
check((await page.locator('.ab.preview .name').textContent()) === 'Trial', 'HUD marks the key as trying a draft');
await shot('06-trying-draft');
await clickCanvas('left');
await page.waitForTimeout(600);
await page.keyboard.press('Tab');
await page.locator('.ws-sheet').waitFor();
check((await book()).preview === null, 'reopening the Workshop ends the trial');
await page.getByRole('button', { name: 'Discard draft' }).click();
await page.keyboard.press('Escape');

console.log('tutorial Pact step, following the card and the in-Workshop guide');
await page.evaluate(() => localStorage.clear());
await ready();
await page.getByRole('button', { name: 'Begin', exact: true }).click();
await page.locator('.card', { hasText: 'Recoil' }).click();
await page.getByRole('button', { name: 'Begin at the Academy' }).click();
check((await waitState('tutorial')) === 'tutorial', 'Begin at the Academy starts the tutorial');
await page.evaluate(() => window.game.tutorialStep('pact'));
await page.waitForTimeout(800);
check((await page.locator('.objective .t').textContent()) === 'Your Pacts', `the card shows the Pact step: ${await page.locator('.objective .t').textContent()}`);
await shot('07-tutorial-pact-card');
await page.keyboard.press('Tab');
await page.locator('.ws-sheet').waitFor();
const guide = () => page.locator('.ws-guide li.now').textContent();
check(/New Pact/.test(await guide()), `guide step 1: ${await guide()}`);
await page.locator('.ws-book .bk.new').click();
check(/[Aa]dd a term/.test(await guide()), `guide step 2: ${await guide()}`);
await shot('08-tutorial-workshop-guide');
await page.locator('.opt', { hasText: 'Body' }).click();
await shot('09-body-picker');
await page.locator('.opt', { hasText: 'with both hands' }).click();
check(/Inscribe/.test(await guide()), `guide step 3: ${await guide()}`);
await page.getByRole('button', { name: 'Inscribe', exact: true }).click();
{
  const hold = page.getByRole('button', { name: 'Hold to inscribe' });
  const bb = await hold.boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1500);
  await page.mouse.up();
}
await page.keyboard.press('Escape');
await page.waitForFunction(() => window.game.game.tutorial.stepId === 'wager', null, { timeout: 8000 }).catch(() => undefined);
check((await state()) === 'tutorial', 'closing the Workshop keeps the tutorial running');
check((await page.evaluate(() => window.game.game.tutorial.stepId)) === 'wager', 'the Pact step completes and the tutorial moves to Wager');
await shot('10-tutorial-after-pact');

console.log('the whole tutorial, start to finish, in the top-down view');
await page.evaluate(() => localStorage.clear());
await ready();
await page.getByRole('button', { name: 'Begin', exact: true }).click();
await page.locator('.card', { hasText: 'Recoil' }).click();
await page.getByRole('button', { name: 'Begin at the Academy' }).click();
check((await waitState('tutorial')) === 'tutorial', 'the tutorial starts');
const stepId = () => page.evaluate(() => window.game.game.tutorial.stepId);
// A step turns over 0.6 s after its objective is met, while the cast that met it may still be in flight; the pause before the next input is a player reading the card.
const untilStep = async (id, ms = 9000) => { const ok = await page.waitForFunction((s) => window.game.game.tutorial.stepId === s, id, { timeout: ms }).then(() => true, () => false); check(ok, `the tutorial reaches "${id}" (at "${await stepId()}")`); await page.waitForTimeout(700); return ok; };
check((await page.evaluate(() => window.game.game.cam.mode)) === 'top', 'a fresh player starts in the top-down view');
check((await stepId()) === 'move', 'step 1 is Move');
await page.waitForTimeout(800);
// Move: W is up the screen in the top-down view.
await page.keyboard.down('KeyW');
await page.waitForTimeout(1800);
await page.keyboard.up('KeyW');
await untilStep('look');
// Aim: the cursor turns the body.
await page.mouse.move(640, 360);
await page.waitForTimeout(400);
await page.mouse.move(1180, 420, { steps: 12 });
await page.waitForTimeout(400);
await page.mouse.move(120, 300, { steps: 12 });
await page.waitForTimeout(400);
await untilStep('camera');
await shot('11-tutorial-aim-done');
// Camera: V cycles the view; cycle all the way back to the top-down view.
await page.keyboard.press('KeyV');
await untilStep('primary');
check((await page.evaluate(() => window.game.game.cam.mode)) === 'third', 'V moves to the over-the-shoulder view');
await page.keyboard.press('KeyV'); await page.waitForTimeout(200); await page.keyboard.press('KeyV'); await page.waitForTimeout(200);
check((await page.evaluate(() => window.game.game.cam.mode)) === 'top', 'two more presses come back to the top-down view');
await page.mouse.move(640, 300);
await clickCanvas('left');
await untilStep('secondary');
await clickCanvas('right', 500);
await untilStep('art');
await page.keyboard.press('Digit1');
await untilStep('pact');
await page.keyboard.press('Tab');
await page.locator('.ws-sheet').waitFor();
await page.keyboard.press('Escape');
await untilStep('wager');
await page.keyboard.press('KeyR');
await untilStep('max');
await shot('12-tutorial-max');
await page.keyboard.press('KeyQ');
await untilStep('done', 14000);
check((await state()) === 'tutorial' || (await state()) === 'cinematic', `the last card shows (state ${await state()})`);
await shot('13-tutorial-done');
await page.waitForFunction(() => window.game.state() === 'explore', null, { timeout: 14000 }).catch(() => undefined);
check((await state()) === 'explore', 'the tutorial hands over to free play');

const pageErrors = await page.evaluate(() => window.game.errors);
errors.push(...pageErrors.map((e) => `window: ${e}`));
const report = { url, thirtySecondTest: { seconds: +seconds.toFixed(2), clicks }, failures, errors };
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(`\n30-second test: ${seconds.toFixed(1)} s, ${clicks} clicks. ${failures.length} failures, ${errors.length} page errors -> ${join(out, 'report.json')}`);
for (const e of errors.slice(0, 20)) console.log('  ERROR', e);
await browser.close();
stop();
process.exit(failures.length || errors.length ? 1 : 0);
