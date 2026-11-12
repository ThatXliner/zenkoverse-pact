#!/usr/bin/env node
// Drives the built game with real keys and clicks to check the Ability slots
// and key rebinding (issue #41):
//   Shockline sits on 1 and fires on the keypress;
//   an Ability key is rebound in Settings, and the HUD, the Workshop readback
//   and the key picker show the new key;
//   a new Pact is inscribed onto slot 3 and fires in the dummy room;
//   a mouse button binds, and bindings survive a reload;
//   a key that another action holds is flagged, and swap, unbind, cancel and
//   reset-to-defaults each do what they say;
//   the extra row, the Settings sheet and the key picker fit at 1280x720.
// The ?debug hooks only read state and open the dummy room; every binding,
// Pact and cast goes through the UI.
// Usage: node tools/check-keybinds.mjs [url] [--url http://localhost:4173/] [--out captures/keybinds] [--port 4173]
// Without a URL it serves dist/ itself (run `npm run build` first).
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveTarget } from './lib/target.mjs';

const { url, args, stop } = await resolveTarget();
const out = args.out ?? 'captures/keybinds';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|WebGL|GPU stall|Automatic fallback/.test(m.text())) errors.push(`console: ${m.text()}`); });
const failures = [];
const check = (ok, what) => { if (!ok) failures.push(what); console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const shot = (name) => page.screenshot({ path: join(out, `${name}.png`), animations: 'disabled' });
const state = () => page.evaluate(() => window.game.state());
const waitState = async (kind) => { await page.waitForFunction((k) => window.game.state() === k, kind, { timeout: 8000 }).catch(() => undefined); return state(); };
const book = () => page.evaluate(() => { const b = window.game.game.book; return { inscribed: b.inscribed.value, bindings: b.bindings.value.recoil ?? {} }; });
const text = async (sel) => ((await page.locator(sel).first().textContent()) ?? '').trim();
const texts = (sel) => page.locator(sel).allTextContents().then((t) => t.map((x) => x.trim()));
const hudKey = (slot) => text(`.x[data-slot="${slot}"] kbd`);
const hudName = (slot) => text(`.x[data-slot="${slot}"] .name`);
const dummyHp = () => page.evaluate(() => window.game.game.encounters.enemies.reduce((a, e) => a + e.hp, 0));

// Resolves when the player casts from `slot`, so a press that fires nothing fails.
const castFrom = async (slot, press) => {
  const seen = page.waitForFunction((s) => window.game.game.techniques.current?.slot === s, slot, { polling: 'raf', timeout: 2500 }).then(() => true, () => false);
  await press();
  return seen;
};
const idle = async () => { await page.waitForFunction(() => !window.game.game.techniques.casting, null, { timeout: 4000 }).catch(() => undefined); await page.waitForTimeout(700); };
const holdInscribe = async () => {
  await page.getByRole('button', { name: 'Inscribe', exact: true }).click();
  const hold = page.getByRole('button', { name: 'Hold to inscribe' });
  const bb = await hold.boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1500);
  await page.mouse.up();
};
const ready = async () => { await page.goto(`${url}?debug`); await page.waitForFunction(() => window.game?.game?.ready, null, { timeout: 180000 }); await page.waitForTimeout(500); };
const openControls = async () => {
  await page.keyboard.press('Escape');
  check((await waitState('paused')) === 'paused', 'Esc opens the pause menu');
  await page.locator('.tabs button', { hasText: 'controls' }).click();
  await page.locator('.binds').waitFor();
};
const closeSheet = async () => { await page.keyboard.press('Escape'); await waitState('explore'); await page.waitForTimeout(300); };
const cell = (action, col = 0) => page.locator(`[data-cell="${action}:${col}"]`);
const cellText = async (action, col = 0) => (await cell(action, col).textContent()).trim();
const rebind = async (action, press) => { await cell(action).click(); await page.locator('.kcell.listening').waitFor(); await press(); await page.waitForTimeout(120); };
// Shockline reaches 11 m down a narrow cone and the punch reaches 3 m, so each
// is thrown from where it can land: `stand` is the key held to close in or back off.
const toDummies = async (stand = 'KeyW', ms = 420) => {
  await page.evaluate(() => { window.game.encounter('dummy-room'); window.game.teleport([-26, 0, -63]); window.game.look(Math.PI / 2, 0); });
  await page.waitForTimeout(600);
  await page.keyboard.down(stand);
  await page.waitForTimeout(ms);
  await page.keyboard.up(stand);
  await page.waitForTimeout(250);
};

console.log('start: Recoil, tutorial skipped');
await ready();
await page.getByRole('button', { name: 'Begin', exact: true }).click();
await page.locator('.card', { hasText: 'Recoil' }).click();
await page.getByRole('button', { name: 'Skip tutorial' }).click();
check((await waitState('explore')) === 'explore', 'Skip tutorial lands in explore');
await page.waitForTimeout(700);

console.log('the HUD: three main cards and a row for the extra slots');
check((await texts('.ab .key')).join('|') === 'Left click|Right click|Q', `main cards name their keys: ${(await texts('.ab .key')).join(', ')}`);
check((await texts('.ab .name')).join('|') === 'Kinetic Release|Absorption|Zero Hour', 'main cards name the catalogue Abilities');
check((await texts('.x kbd')).join('|') === '1|2|3|4', `extra row shows keys 1 to 4: ${(await texts('.x kbd')).join(', ')}`);
check((await hudName('art1')) === 'Shockline', 'Shockline starts on slot 1');
check((await page.locator('.x.empty').count()) === 3, 'the other three extra slots are empty and dim');
{
  const fits = await page.evaluate(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect();
    const row = r('.xs'), mains = r('.mains'), vitals = r('.vitals');
    return { inside: row.left >= 0 && row.right <= innerWidth && mains.bottom <= innerHeight, clear: row.left > vitals.right + 8 && row.bottom <= mains.top, width: Math.round(row.width), height: Math.round(row.height) };
  });
  check(fits.inside && fits.clear, `extra row sits on screen, clear of the vitals and above the cards (${fits.width}x${fits.height})`);
}
await shot('01-hud-default');

console.log('Shockline fires on the keypress');
await toDummies('KeyS', 500);
const hp0 = await dummyHp();
check(await castFrom('art1', () => page.keyboard.press('Digit1')), 'pressing 1 casts from slot 1');
await page.waitForTimeout(900);
check((await dummyHp()) < hp0, `Shockline hurts a dummy: ${hp0} to ${await dummyHp()}`);
await shot('02-shockline-cast');
await idle();

console.log('rebind slot 1 from 1 to Z in Settings');
await openControls();
check((await cellText('art1')) === '1', 'Settings lists slot 1 on 1');
check((await page.locator('.krow[data-action="art1"] .kl small').textContent()).includes('Shockline'), 'the slot 1 row names the Ability on it');
await shot('03-controls-default');
{
  const fit = await page.evaluate(() => { const s = document.querySelector('.sheet').getBoundingClientRect(); const b = document.querySelector('.sheet > .body'); return { inside: s.top >= 0 && s.bottom <= innerHeight && s.left >= 0 && s.right <= innerWidth, scrolls: b.scrollHeight > b.clientHeight + 1, h: Math.round(s.height), body: b.scrollHeight, room: b.clientHeight }; });
  check(fit.inside && !fit.scrolls, `the Settings bindings screen fits 1280x720 without scrolling (sheet ${fit.h} px tall, body ${fit.body} of ${fit.room})`);
}
await rebind('art1', () => page.keyboard.press('KeyZ'));
check((await cellText('art1')) === 'Z', 'slot 1 now reads Z in Settings');
await closeSheet();
check((await hudKey('art1')) === 'Z', 'the HUD shows Z on slot 1');
check((await page.evaluate(() => JSON.parse(localStorage.getItem('zenko.keys.v1')).art1[0])) === 'KeyZ', 'the binding is saved');
await toDummies('KeyS', 500);
check(!(await castFrom('art1', () => page.keyboard.press('Digit1'))), 'the old key 1 no longer casts slot 1');
await idle();
check(await castFrom('art1', () => page.keyboard.press('KeyZ')), 'Z casts Shockline');
await idle();

console.log('the tutorial cards and key hints follow the bindings');
await page.evaluate(() => window.game.tutorialStep('art'));
await page.waitForTimeout(800);
check(/Z fires Shockline/.test(await text('.objective .b')), `the extra-slot card names Z: ${await text('.objective .b')}`);
await page.evaluate(() => window.game.tutorialStep('primary'));
await page.waitForTimeout(500);
check(/^Left click fires Kinetic Release/.test(await text('.objective .b')), 'the primary card names left click');
await page.evaluate(() => window.game.skipTutorial());
await waitState('explore');
await openControls();
await rebind('camera', () => page.keyboard.press('KeyB'));
await closeSheet();
check((await texts('.top-left .keys b')).includes('B'), `the key hint shows B for the camera: ${(await texts('.top-left .keys b')).join(' ')}`);
await page.keyboard.press('KeyB');
await page.waitForTimeout(500);
check((await page.evaluate(() => window.game.game.cam.mode)) === 'third', 'B toggles the camera');
await page.keyboard.press('KeyB');
await page.waitForTimeout(300);

console.log('the Workshop shows the new key');
await page.keyboard.press('Tab');
await page.locator('.ws-sheet').waitFor();
await page.locator('.ws-book .bk', { hasText: 'Shockline' }).click();
check(/ on Z /.test(await text('.ws-sentence')), `the readback says Shockline is on Z: ${(await text('.ws-sentence')).slice(0, 40)}`);
check(/^Z · in use/.test(await text('.ws-book .bk.on .s')), 'the Pact list says Z · in use');
await page.locator('.ws-sentence button.ph').first().click();
await page.locator('.opts.slots').waitFor();
{
  const tiles = await page.locator('.opts.slots .opt').evaluateAll((els) => els.map((e) => ({ slot: e.dataset.slot, label: e.querySelector('.l').textContent.trim(), note: e.querySelector('.w').textContent.trim() })));
  check(['primary', 'secondary', 'max', 'art1', 'art2', 'art3', 'art4'].every((s) => tiles.some((t) => t.slot === s)), `the key picker lists every slot: ${tiles.map((t) => t.slot).join(', ')}`);
  const art1 = tiles.find((t) => t.slot === 'art1');
  check(art1 && art1.label.startsWith('Z') && /Shockline|where it sits/.test(art1.note), `the picker names Z and what is on it: ${art1?.label} / ${art1?.note}`);
  check(tiles.find((t) => t.slot === 'primary')?.note === 'Kinetic Release', 'the picker names what holds left click');
}
await shot('04-workshop-keys-inscribed');
console.log('a new Pact on slot 3, fired in the dummy room');
await page.locator('.ws-book .bk.new').click();
await page.getByLabel('Pact name').fill('Third Fist');
await page.locator('.ws-sentence .ph', { hasText: 'left click' }).click();
{
  const tiles = await page.locator('.opts.slots .opt').evaluateAll((els) => els.map((e) => ({ slot: e.dataset.slot, label: e.querySelector('.l').textContent.trim(), note: e.querySelector('.w').textContent.trim(), disabled: e.disabled })));
  check(tiles.length === 8 && tiles.some((t) => t.slot === 'passive'), 'a draft sees all seven keys and the always-on slot');
  const art3 = tiles.find((t) => t.slot === 'art3');
  check(art3 && art3.label.startsWith('3') && art3.note === 'empty', `slot 3 is on 3 and empty: ${art3?.label} / ${art3?.note}`);
  check(tiles.find((t) => t.slot === 'primary')?.note === 'replaces Kinetic Release', 'a draft warns what an occupied key would replace');
}
await page.locator('.opts.slots .opt[data-slot="art3"]').click();
await shot('05-workshop-key-picker');
{
  const fit = await page.evaluate(() => { const s = document.querySelector('.ws-sheet').getBoundingClientRect(); return { inside: s.top >= 0 && s.bottom <= innerHeight && s.right <= innerWidth, h: Math.round(s.height) }; });
  check(fit.inside, `the Workshop key picker fits 1280x720 (sheet ${fit.h} px tall)`);
}
check(/"Third Fist" on 3 /.test(await text('.ws-sentence')), `the readback says the draft is on 3: ${(await text('.ws-sentence')).slice(0, 40)}`);
await page.getByRole('button', { name: '+ add a term' }).click();
await page.locator('.opt', { hasText: 'Direction' }).click();
await page.locator('.opt', { hasText: 'only from the front' }).click();
await holdInscribe();
{
  const b = await book();
  const p = b.inscribed.find((q) => q.name === 'Third Fist');
  check(!!p && p.slot === 'art3' && b.bindings.art3 === p.id, 'the new Pact is inscribed and bound to slot 3');
  check(b.bindings.art1 && b.bindings.primary === 'recoil.kinetic-release', 'inscribing on slot 3 leaves the other keys alone');
}
await page.keyboard.press('Escape');
await waitState('explore');
await page.waitForTimeout(500);
check((await hudName('art3')) === 'Third Fist', 'the HUD names the new Pact on slot 3');
check((await hudKey('art3')) === '3', 'slot 3 is still on key 3');
await shot('06-hud-two-extras');
await toDummies('KeyW', 150);
const hp1 = await dummyHp();
check(await castFrom('art3', () => page.keyboard.press('Digit3')), 'pressing 3 casts the new Pact');
await page.waitForTimeout(900);
check((await dummyHp()) < hp1, `the new Pact hurts a dummy: ${hp1} to ${await dummyHp()}`);
await idle();

console.log('a mouse button binds');
await openControls();
await rebind('secondary', () => page.mouse.down({ button: 'middle' }).then(() => page.mouse.up({ button: 'middle' })));
check((await cellText('secondary')) === 'Middle click', 'the secondary cell reads Middle click');
await closeSheet();
check((await text('.ab[data-slot="secondary"] .key')) === 'Middle click', 'the HUD card follows: Middle click');
await toDummies();
check(await castFrom('secondary', async () => { await page.mouse.move(640, 360); await page.mouse.down({ button: 'middle' }); }), 'middle click casts the secondary Ability');
await page.mouse.up({ button: 'middle' });
await idle();

console.log('bindings survive a reload');
const before = await page.evaluate(() => localStorage.getItem('zenko.keys.v1'));
await ready();
await page.getByRole('button', { name: 'Begin', exact: true }).click();
await page.locator('.card', { hasText: 'Recoil' }).click();
await page.getByRole('button', { name: 'Skip tutorial' }).click();
await waitState('explore');
await page.waitForTimeout(700);
check((await page.evaluate(() => localStorage.getItem('zenko.keys.v1'))) === before, 'the saved bindings are unchanged after a reload');
check((await hudKey('art1')) === 'Z', 'slot 1 is still on Z');
check((await text('.ab[data-slot="secondary"] .key')) === 'Middle click', 'the secondary is still on Middle click');
check((await hudName('art3')) === 'Third Fist' && (await hudName('art1')) === 'Shockline', 'Shockline and the new Pact are still on their slots');
await shot('07-hud-after-reload');

console.log('conflicts are flagged');
await openControls();
await shot('08-controls-rebound');
await rebind('art2', () => page.keyboard.press('KeyZ'));
check(await page.locator('.binds-clash').isVisible(), 'binding Z to slot 2 is flagged');
check(/Z/.test(await text('.binds-clash')) && /Slot 1/.test(await text('.binds-clash')), `the flag names the key and who holds it: ${await text('.binds-clash')}`);
check((await page.locator('.kcell.conflict').count()) === 2, 'both cells in the clash are marked');
check((await cellText('art2')) === '2', 'nothing changes until the player chooses');
await shot('09-controls-conflict');
await page.getByRole('button', { name: 'Cancel' }).click();
check(!(await page.locator('.binds-clash').count()) && (await cellText('art1')) === 'Z' && (await cellText('art2')) === '2', 'Cancel keeps both keys as they were');
await rebind('art2', () => page.keyboard.press('KeyZ'));
await page.getByRole('button', { name: 'Swap', exact: true }).click();
check((await cellText('art2')) === 'Z' && (await cellText('art1')) === '2', 'Swap trades the two keys');
await rebind('art4', () => page.keyboard.press('KeyZ'));
await page.getByRole('button', { name: /^Unbind/ }).click();
check((await cellText('art4')) === 'Z' && (await cellText('art2')) === 'Unbound', 'Unbind takes the key and leaves the old holder without one');
await rebind('art3', () => page.keyboard.press('Escape'));
check((await cellText('art3')) === '3' && (await state()) === 'paused', 'Esc cancels a capture and does not close the sheet');
await closeSheet();
check((await hudKey('art2')) === 'Unbound' && (await hudKey('art4')) === 'Z', 'the HUD shows an unbound slot and the new key');

console.log('reset to defaults');
await openControls();
await page.getByRole('button', { name: 'Reset to defaults' }).click();
check((await cellText('art1')) === '1' && (await cellText('secondary')) === 'Right click' && (await cellText('art4')) === '4', 'Reset to defaults restores every key');
await closeSheet();
check((await texts('.x kbd')).join('|') === '1|2|3|4' && (await text('.ab[data-slot="secondary"] .key')) === 'Right click', 'the HUD returns to the default keys');

console.log('an older save keeps its bindings and gains Shockline on a free slot');
await page.evaluate(() => {
  const catalogue = ['recoil.kinetic-release', 'recoil.absorption', 'recoil.zero-hour', 'recoil.shockline'];
  const s = JSON.parse(window.game.game.book.export());
  delete s.claimed;
  s.drafts = [];
  s.inscribed = s.inscribed.filter((p) => catalogue.includes(p.id)).map((p) => ({ ...p, slot: { 'recoil.shockline': 'primary', 'recoil.absorption': 'secondary', 'recoil.zero-hour': 'max', 'recoil.kinetic-release': 'primary' }[p.id] }));
  s.bindings = { recoil: { primary: 'recoil.kinetic-release', secondary: null, max: 'recoil.zero-hour' } };
  localStorage.setItem('zenko.pacts.v3', JSON.stringify(s));
});
await ready();
{
  const b = await book();
  check(b.bindings.primary === 'recoil.kinetic-release' && b.bindings.max === 'recoil.zero-hour', 'the old save keeps the keys it had');
  check(b.bindings.secondary === null && !Object.values(b.bindings).includes('recoil.absorption'), 'a key the player had unbound stays unbound');
  check(b.bindings.art1 === 'recoil.shockline' && b.inscribed.find((p) => p.id === 'recoil.shockline')?.slot === 'art1', 'Shockline, inscribed but unused, moves to slot 1');
  await ready();
  const again = await book();
  check(JSON.stringify(again.bindings) === JSON.stringify(b.bindings), 'a second load changes nothing');
}

const pageErrors = await page.evaluate(() => window.game.errors);
errors.push(...pageErrors.map((e) => `window: ${e}`));
writeFileSync(join(out, 'report.json'), JSON.stringify({ url, failures, errors }, null, 2));
console.log(`\n${failures.length} failures, ${errors.length} page errors -> ${join(out, 'report.json')}`);
for (const e of errors.slice(0, 20)) console.log('  ERROR', e);
await browser.close();
stop();
process.exit(failures.length || errors.length ? 1 : 0);
