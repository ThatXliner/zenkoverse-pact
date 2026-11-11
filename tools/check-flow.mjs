#!/usr/bin/env node
// Drives the built game the way a player does, with real clicks and keys:
// title, Technique select, the Workshop, inscribing, the dummy room, and the
// tutorial's Pact step. Times the 30-second test from issue #29 ("Absorption,
// only from the front, while held") and fails on any page error.
// Usage: node tools/check-flow.mjs [--url http://localhost:4173/] [--out captures/flow] [--port 4173]
// Without --url it serves dist/ itself (run `npm run build` first). The
// `?debug` hooks are used only to read state and to skip walking.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? 'true' : all[i + 1]] : [])).filter((x) => x.length));
const out = args.out ?? 'captures/flow';
mkdirSync(out, { recursive: true });

let server = null;
let url = args.url;
if (!url) {
  if (!existsSync('dist/index.html')) throw new Error('dist/ missing: run npm run build first');
  const port = args.port ?? '4173';
  server = spawn('npx', ['vite', 'preview', '--port', port, '--strictPort'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1800));
  url = `http://localhost:${port}/`;
}

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

console.log('use the Ability in the dummy room');
await page.evaluate(() => window.game.encounter('dummy-room'));
await page.waitForTimeout(600);
await page.keyboard.down('KeyW');
await page.waitForTimeout(420);
await page.keyboard.up('KeyW');
await page.waitForTimeout(200);
await clickCanvas('left');
await page.waitForTimeout(900);
const hurt = await page.evaluate(() => window.game.game.encounters.enemies.some((e) => e.hp < e.def.hp));
check(hurt, 'left click lands Kinetic Release on a dummy');
await clickCanvas('right', 700);
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
check((await page.locator('.objective .t').textContent()) === 'Write a Pact', `the card shows the Pact step: ${await page.locator('.objective .t').textContent()}`);
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

const pageErrors = await page.evaluate(() => window.game.errors);
errors.push(...pageErrors.map((e) => `window: ${e}`));
const report = { url, thirtySecondTest: { seconds: +seconds.toFixed(2), clicks }, failures, errors };
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(`\n30-second test: ${seconds.toFixed(1)} s, ${clicks} clicks. ${failures.length} failures, ${errors.length} page errors -> ${join(out, 'report.json')}`);
for (const e of errors.slice(0, 20)) console.log('  ERROR', e);
await browser.close();
server?.kill();
process.exit(failures.length || errors.length ? 1 : 0);
