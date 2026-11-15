#!/usr/bin/env node
// Drives the built game the way a player does, with real clicks and keys:
// title, Technique select, the Workshop, inscribing, the dummy room, the
// tutorial's Pact step and its trade panel, hold-to-inscribe by keyboard, the
// whole tutorial from its first step to its last in the default top-down
// view (the clash step passes the field-reading drill by reading its cues),
// and skipping a step. Times the 30-second test from
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

console.log('a Wager is written inside a Pact and tuned: the call, what it pays, what it puts up');
await page.waitForFunction(() => window.game.state() !== 'workshop', null, { timeout: 4000 }).catch(() => undefined);
await page.waitForTimeout(200);
await page.keyboard.press('Tab');
await page.locator('.ws-sheet').waitFor();
await page.locator('.ws-book .bk.new').click();
await page.getByLabel('Pact name').fill('Gamble');
await page.locator('.chip', { hasText: 'a wager, to bet on each cast' }).click();
{
  const panel = page.locator('.ws-panel');
  const slider = (name) => panel.getByRole('slider', { name, exact: true });
  const value = async (name) => (await slider(name).locator('xpath=..').locator('.v').innerText()).trim();
  const stake = async () => Number((/Stake (\d+\.\d)/.exec(await panel.locator('.wg-read').innerText()) ?? [])[1]);
  // Keys move a slider, as a thumb would: Home to its first stop, Right one stop on.
  const setTo = async (name, steps) => { await slider(name).focus(); await page.keyboard.press('Home'); for (let i = 0; i < steps; i++) await page.keyboard.press('ArrowRight'); };
  check(await panel.locator('.chip', { hasText: 'it lands' }).isVisible() && await slider('Harder strike').isVisible() && /sealed 5 s/.test(await value('Seal')), 'the panel offers a call, rewards to pay and forfeits to put up');
  const give = await page.locator('.ws-trade .give').innerText();
  const get = await page.locator('.ws-trade .get').innerText();
  check(/Wager: it lands/.test(give) && /Called wrong, your Technique seals/.test(give), `the cost names the declaration and the forfeit: ${give.replace(/\s+/g, ' ').slice(-110)}`);
  // Shockline already wagers that its cast lands, so the same bet in a second Pact stakes nothing (anti-loophole).
  check(/"Shockline" already wagers on this outcome/.test(give) && /a right call pays nothing/.test(get), 'a second Pact betting the same outcome stakes nothing and pays nothing');
  check(/Wager: each cast declares that it lands/.test(await page.locator('.ws-sentence').innerText()), 'the sentence reads the Wager back');
  await panel.locator('.chip', { hasText: 'it strikes two or more' }).click();
  check(await slider('Harder strike').isDisabled(), 'a harder strike is offered only on "it lands", where the impact settles the call');
  const ring = Number((/Called right: \+(\d+)% ring/.exec(await page.locator('.ws-trade .get').innerText()) ?? [])[1]);
  check(ring >= 10, `a real doubt with a real forfeit pays: +${ring}% Maximum Output`);
  // The call's setting: a harder call moves the odds, read from this player's own record at that setting.
  const at2 = await value('How many');
  await slider('How many').focus();
  await page.keyboard.press('ArrowRight');
  const at3 = await value('How many');
  const odds = (t) => Number((/true (\d+)%/.exec(t) ?? [])[1]);
  check(/3 bodies/.test(at3) && odds(at3) < odds(at2) && await panel.locator('.chip.on', { hasText: 'it strikes three or more' }).count() === 1, `striking three is a harder call than two: ${at2} → ${at3}`);
  const recorded = await page.evaluate(() => { const r = window.game.game.book.telemetry.odds.reach; return Math.round(Math.min(...[0, 1, 2].map((k) => r.yes[k] / r.n[k])) * 100); });
  check(odds(at3) === recorded, `the odds at three are the record at three (${recorded}%)`);
  await page.keyboard.press('ArrowLeft');
  await shot('06b-wager-panel');
  // What it puts up: a heavier forfeit stakes more, and two forfeits add up.
  await setTo('Seal', 0);
  await setTo('Heavy legs', 3);
  const slow = await stake();
  await setTo('Heavy legs', 0);
  await setTo('Seal', 3);
  const seal = await stake();
  check(seal > slow, `a heavier forfeit stakes more: sealed ${seal} against slowed ${slow}`);
  await setTo('Blood', 1);
  const both = await stake();
  check(both > seal && /sealed 5 s and −5% health/.test(await panel.locator('.wg-read').innerText()), `two forfeits add up their loss: ${both}`);
  await setTo('Blood', 0);
  // What it pays: the stake splits between the rewards.
  await setTo('Resource', 1);
  const split = [await value('Output ring'), await value('Resource')];
  check(split.every((v) => /^50% · \+\d+%/.test(v)), `the stake splits between two rewards: ${split.join(' / ')}`);
  check(/\+\d+% ring, \+\d+% resource/.test(await page.locator('.ws-trade .get').innerText()), 'the trade names both rewards');
  await setTo('Resource', 0);
  // Up and Down move between the sliders, Left and Right stay with the one in hand.
  await slider('Seal').focus();
  await page.keyboard.press('ArrowDown');
  check(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')) === 'Blood', 'Down moves from one slider to the next');
  // A call this player nearly always gets right stakes almost nothing, however much is put up.
  await page.evaluate(() => { const r = window.game.game.book.telemetry.odds.reach; window.__reach = structuredClone(r); r.yes[0] = r.n[0]; r.yes[1] = r.n[1] * 0.99; });
  await setTo('Seal', 5);
  await setTo('Blood', 5);
  const read = await panel.locator('.wg-read').innerText();
  check(/Stake 0\.\d/.test(read) && /almost every time/.test(read), `a near-certain call stakes almost nothing: ${read}`);
  await page.evaluate(() => { window.game.game.book.telemetry.odds.reach = window.__reach; });
}
await page.getByRole('button', { name: 'Discard draft' }).click();
await page.keyboard.press('Escape');

console.log('naming a Pact: the field invites a name, keeps its keys, and the name survives inscribing and a reload');
await page.waitForFunction(() => window.game.state() !== 'workshop', null, { timeout: 4000 }).catch(() => undefined);
await page.waitForTimeout(200);
await page.keyboard.press('Tab');
await page.locator('.ws-sheet').waitFor();
await page.locator('.ws-book .bk.new').click();
check(await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Pact name' && document.activeElement.selectionEnd - document.activeElement.selectionStart === document.activeElement.value.length, null, { timeout: 2000 }).then(() => true, () => false), 'a new draft opens with its name focused and selected');
// Typed over the selection with real keys, including Q, E and arrows that the sheet otherwise takes.
await page.keyboard.type('Quiet Edge');
await page.keyboard.press('ArrowLeft');
await page.keyboard.press('End');
await page.keyboard.press('Enter');
check((await state()) === 'workshop' && !(await page.locator('.confirm').count()), 'typing and Enter in the name stay in the field');
check((await book()).drafts.some((p) => p.name === 'Quiet Edge'), 'the draft takes the typed name');
await page.locator('.opt', { hasText: 'Trigger' }).click();
await page.locator('.opt', { hasText: 'only while standing still' }).click();
await page.getByRole('button', { name: 'Inscribe', exact: true }).click();
{
  const hold = page.getByRole('button', { name: 'Hold to inscribe' });
  const bb = await hold.boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.mouse.down(); await page.waitForTimeout(1500); await page.mouse.up();
}
check((await book()).inscribed.some((p) => p.name === 'Quiet Edge'), 'the name survives inscribing');
// An inscribed Pact can still be renamed: the name is a label, not a term.
await page.getByLabel('Pact name').click();
await page.keyboard.press('ControlOrMeta+a');
await page.keyboard.type('Still Water');
await page.keyboard.press('Escape');
check((await state()) === 'workshop', 'Esc in the name leaves the field, not the Workshop');
check((await book()).inscribed.some((p) => p.name === 'Still Water'), 'an inscribed Pact takes a new name');
await page.keyboard.press('Escape');
await ready();
check(await page.evaluate(() => window.game.game.book.inscribed.value.some((p) => p.name === 'Still Water')), 'the new name survives a reload');
await page.getByRole('button', { name: 'Begin', exact: true }).click();
await page.locator('.card', { hasText: 'Recoil' }).click();
await page.getByRole('button', { name: 'Skip tutorial' }).click();
await waitState('explore');
await page.keyboard.press('Tab');
await page.locator('.ws-sheet').waitFor();
check(await page.locator('.ws-book .bk', { hasText: 'Still Water' }).count() === 1, 'the Workshop lists it by its new name after the reload');
await shot('06c-renamed');
await page.keyboard.press('Escape');

console.log('a named Pact is called out when cast, and costs no frames');
await page.waitForFunction(() => window.game.state() === 'explore', null, { timeout: 4000 }).catch(() => undefined);
await page.waitForTimeout(400);
await page.mouse.move(640, 250);
await clickCanvas('left');
const callout = await page.waitForSelector('.declare', { timeout: 1500 }).then((el) => el.textContent(), () => '');
check(callout === '「Still Water」', `casting the renamed Pact letters its name over the caster: ${callout}`);
check(await page.evaluate(() => { const c = window.game.game.clock; return !c.frozen && c.slowMo === 1 && window.game.game.input.enabled; }), 'the callout holds no frames: no hit-stop, no slow motion, input live');
await shot('06d-declared');
await page.waitForTimeout(1700);
check((await page.locator('.declare').count()) === 0, 'the callout fades on its own');
await clickCanvas('left');
await page.waitForTimeout(300);
check((await page.locator('.declare').count()) === 0, 'casting it again straight away stays quiet');
await page.keyboard.press('Digit1');
await page.waitForTimeout(300);
check(!(await page.locator('.declare').allTextContents()).some((t) => /Shockline/.test(t)), 'a catalogue Pact under its own name stays quiet');


console.log('tutorial Pact step, following the card and the in-Workshop guide');
await page.evaluate(() => localStorage.clear());
await ready();
await page.getByRole('button', { name: 'Begin', exact: true }).click();
await page.locator('.card', { hasText: 'Recoil' }).click();
await page.getByRole('button', { name: 'Begin at the Academy' }).click();
check((await waitState('tutorial')) === 'tutorial', 'Begin at the Academy starts the tutorial');
await page.evaluate(() => window.game.tutorialStep('pact'));
await page.waitForTimeout(800);
check(/Write a Pact/.test(await page.locator('.objective .step').textContent()), `the card shows the Pact step: ${await page.locator('.objective .step').textContent()}`);
check(/Give something up/.test(await page.locator('.objective .b').textContent()), `the card says why: ${await page.locator('.objective .b').textContent()}`);
await shot('07-tutorial-pact-card');
await page.keyboard.press('Tab');
await page.locator('.ws-sheet').waitFor();
const guide = () => page.locator('.ws-guide li.now').textContent();
check(/New Pact/.test(await guide()), `guide step 1: ${await guide()}`);
await page.locator('.ws-book .bk.new').click();
check(/[Aa]dd a term/.test(await guide()), `guide step 2: ${await guide()}`);
await shot('08-tutorial-workshop-guide');
await page.locator('.opt', { hasText: 'Trigger' }).click();
await shot('09-trigger-picker');
await page.locator('.opt', { hasText: 'only while standing still' }).click();
check(/Try it/.test(await guide()), `guide step 3: ${await guide()}`);
{
  // The trade reads both ways: the term and what it takes from you, and what the Pact pays back.
  const give = await page.locator('.ws-trade .give').innerText();
  const get = await page.locator('.ws-trade .get').innerText();
  check(/only while standing still/.test(give) && /casting on the move/.test(give), `the cost names the term and what it takes: ${give.replace(/\s+/g, ' ').slice(0, 90)}`);
  const times = Number((/×(\d+\.\d)/.exec(get) ?? [])[1]);
  check(times > 1, `it pays back more than the raw Technique: ×${times}`);
  check(/Raw Recoil/.test(get) && /Kinetic Release \(on that key now\)/.test(get), 'the payback compares the raw Technique and the Pact on that key now');
}
await shot('09b-trade');
await page.getByRole('button', { name: 'Try it on the dummies' }).click();
await page.waitForFunction(() => window.game.game.tutorial.stepId === 'wager', null, { timeout: 8000 }).catch(() => undefined);
check((await state()) === 'tutorial', 'trying the draft keeps the tutorial running');
check((await page.evaluate(() => window.game.game.tutorial.stepId)) === 'wager', 'trying a draft with a term completes the Pact step');
check((await page.evaluate(() => window.game.game.encounters.enemies.length)) > 0, 'the dummies stand ready for the Wager step');
await shot('10-tutorial-after-pact');

console.log('hold to inscribe works from the keyboard');
await page.keyboard.press('Tab');
await page.locator('.ws-sheet').waitFor();
await page.locator('.ws-book .bk', { hasText: 'New Pact' }).first().click();
await page.getByRole('button', { name: 'Inscribe', exact: true }).click();
await page.locator('.confirm .hold').waitFor();
check(await page.waitForFunction(() => document.activeElement?.classList.contains('hold'), null, { timeout: 2000 }).then(() => true, () => false), 'the confirm opens on the hold button');
await page.keyboard.down('Enter');
await page.waitForTimeout(400);
await page.keyboard.up('Enter');
check(!(await book()).inscribed.some((p) => p.name === 'New Pact'), 'letting go early does not inscribe');
await page.keyboard.down('Enter');
await page.waitForTimeout(1500);
await page.keyboard.up('Enter');
check((await book()).inscribed.some((p) => p.name === 'New Pact'), 'holding Enter inscribes');
await page.keyboard.press('Escape');

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
// Walks with the movement keys toward a point in the top-down view, where W is north and D is east.
const walkTo = async (x, z, near = 0.7) => {
  const held = new Set();
  const want = async (key, on) => {
    if (on && !held.has(key)) { held.add(key); await page.keyboard.down(key); }
    if (!on && held.has(key)) { held.delete(key); await page.keyboard.up(key); }
  };
  for (let i = 0; i < 160; i++) {
    const [px, , pz] = await page.evaluate(() => window.game.game.player.position.toArray());
    const dx = x - px, dz = z - pz;
    if (Math.hypot(dx, dz) < near) break;
    await want('KeyD', dx > 0.3); await want('KeyA', dx < -0.3); await want('KeyS', dz > 0.3); await want('KeyW', dz < -0.3);
    await page.waitForTimeout(50);
  }
  for (const k of [...held]) await page.keyboard.up(k);
};
check((await page.evaluate(() => window.game.game.cam.mode)) === 'top', 'a fresh player starts in the top-down view');
check((await stepId()) === 'move', 'step 1 is Move');
await shot('11-tutorial-move');
await page.waitForTimeout(800);
const spot = await page.evaluate(() => window.game.game.nav.target.value?.position.toArray());
check(!!spot, 'the Move step marks a spot on the compass');
await walkTo(spot[0], spot[2]);
await untilStep('camera');
// Camera: V cycles the view; cycle all the way back to the top-down view.
await page.keyboard.press('KeyV');
await untilStep('primary');
check((await page.evaluate(() => window.game.game.cam.mode)) === 'third', 'V moves to the over-the-shoulder view');
await page.keyboard.press('KeyV'); await page.waitForTimeout(200); await page.keyboard.press('KeyV'); await page.waitForTimeout(200);
check((await page.evaluate(() => window.game.game.cam.mode)) === 'top', 'two more presses come back to the top-down view');
await page.mouse.move(640, 300);
await clickCanvas('left');
await untilStep('reserve');
// Reserve: aim just ahead and hold Absorption while the crate drops into it.
await page.mouse.move(640, 250);
await page.waitForTimeout(300);
await page.mouse.down({ button: 'right' });
await page.waitForFunction(() => window.game.game.tutorial.stepId !== 'reserve', null, { timeout: 9000 }).catch(() => undefined);
await page.mouse.up({ button: 'right' });
await untilStep('sign');
await shot('12-tutorial-sign');
// The hand sign: Alt, wait for the prime, then strike.
await page.keyboard.press('AltLeft');
await page.waitForFunction(() => window.game.sign().kind === 'primed', null, { timeout: 4000 }).catch(() => undefined);
await clickCanvas('left');
await untilStep('aura');
await page.keyboard.press('KeyF');
await untilStep('clash');
await shot('13-tutorial-clash');
// The clash step is the field-reading drill, passed by reading the cue and answering it.
const stand = await page.evaluate(() => window.game.game.nav.target.value?.position.toArray());
await walkTo(stand[0], stand[2], 0.8);
await page.keyboard.press('KeyE');
check((await waitState('drill')) === 'drill', 'E at the stone opens the drill');
await page.waitForTimeout(400);
await page.keyboard.press('KeyE');
const ANSWER = { 'It swells toward you!': 'KeyA', 'It draws tight!': 'KeyW', 'Its far side flickers!': 'KeyS' };
let last = '';
for (let i = 0; i < 600 && (await state()) === 'drill'; i++) {
  const cue = await page.evaluate(() => document.querySelector('.drill-hud .cue')?.textContent ?? '');
  if (ANSWER[cue] && cue !== last) await page.keyboard.press(ANSWER[cue]);
  last = cue;
  await page.waitForTimeout(40);
}
await untilStep('pact', 6000);
await page.keyboard.press('Tab');
await page.locator('.ws-sheet').waitFor();
await page.locator('.ws-book .bk.new').click();
await page.locator('.opt', { hasText: 'Trigger' }).click();
await page.locator('.opt', { hasText: 'only with feet on the ground' }).click();
await page.getByRole('button', { name: 'Try it on the dummies' }).click();
await untilStep('wager');
// The Wager step: 1 fires Shockline, whose Pact bets that it lands. Aim at the nearest dummy, cast, and read the call.
check(/1 fires Shockline, whose Pact bets that it lands/.test(await page.locator('.objective .b').textContent()), `the Wager card names the Pact that holds it: ${await page.locator('.objective .b').textContent()}`);
check(await page.locator('.x[data-slot="art1"] .bet').count() === 1, 'the key of a Pact with a Wager wears 賭');
const aimAtDummy = async () => {
  const at = await page.evaluate(() => {
    const G = window.game.game, me = G.player.position;
    const e = G.encounters.enemies.filter((x) => x.alive).sort((a, b) => a.position.distanceTo(me) - b.position.distanceTo(me))[0];
    if (!e) return null;
    const v = e.center().project(G.renderer.camera);
    return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight];
  });
  if (at) await page.mouse.move(at[0], at[1], { steps: 4 });
  await page.waitForTimeout(250);
};
let saw = { declared: false, settled: '' };
for (let i = 0; i < 4 && (await stepId()) === 'wager'; i++) {
  await aimAtDummy();
  await page.keyboard.press('Digit1');
  saw.declared ||= await page.waitForSelector('.wager-call.declared', { timeout: 1500 }).then(() => true, () => false);
  const end = await page.waitForFunction(() => /的中|外れ/.test(document.querySelector('.banner .big')?.textContent ?? '') && document.querySelector('.banner .big').textContent, null, { timeout: 3000 }).then((h) => h.jsonValue(), () => '');
  saw.settled ||= end;
  if (i === 0) await shot('14a-wager-call');
  await page.waitForTimeout(/外れ/.test(end) ? 5600 : 900);
}
check(saw.declared, 'casting the Pact declares its Wager over the player');
check(/的中|外れ/.test(saw.settled), `the call settles visibly: ${saw.settled}`);
check((await page.locator('.wager-call').count()) === 0, 'the open-call slip goes once the call settles');
await untilStep('max', 4000);
await shot('14-tutorial-max');
await page.keyboard.press('KeyQ');
await untilStep('done', 14000);
check((await state()) === 'tutorial' || (await state()) === 'cinematic', `the last card shows (state ${await state()})`);
await shot('15-tutorial-done');
await page.waitForFunction(() => window.game.state() === 'explore', null, { timeout: 14000 }).catch(() => undefined);
check((await state()) === 'explore', 'the tutorial hands over to free play');

console.log('every step can be skipped');
await page.evaluate(() => window.game.game.startRun());
await waitState('tutorial');
await page.waitForTimeout(300);
for (const id of ['move', 'camera', 'primary']) {
  check((await stepId()) === id, `at "${id}"`);
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(250);
}
check((await stepId()) === 'reserve', `Backspace skips one step at a time (at "${await stepId()}")`);
await page.locator('.objective .skip-step').click();
await page.waitForTimeout(250);
check((await stepId()) === 'sign', 'the skip line on the card skips by click too');

const pageErrors = await page.evaluate(() => window.game.errors);
errors.push(...pageErrors.map((e) => `window: ${e}`));
const report = { url, thirtySecondTest: { seconds: +seconds.toFixed(2), clicks }, failures, errors };
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(`\n30-second test: ${seconds.toFixed(1)} s, ${clicks} clicks. ${failures.length} failures, ${errors.length} page errors -> ${join(out, 'report.json')}`);
for (const e of errors.slice(0, 20)) console.log('  ERROR', e);
await browser.close();
stop();
process.exit(failures.length || errors.length ? 1 : 0);
