#!/usr/bin/env node
// Drives the built game with real keys and clicks to check the full hand
// sign (issue #42):
//   Alt roots the player for the sign's length, then lets go;
//   casts, dash, jump, Wager and Tab during the sign do nothing, and work again after;
//   a hit taken mid-sign lands and does not cancel the sign;
//   the primed cast within the window skips its wind-up and deals the boosted
//   damage the config promises, and a cast after the window does not;
//   the boost grows with Activation;
//   the HUD shows the ring while signing and "Primed" with the time left.
// It ends with first- and third-person frames of the sign at its beats, for
// the hands critic. The ?debug hooks read state, set Activation and the
// Reserve, open the dummy room and land the mid-sign hit; every sign and cast
// goes through the keyboard and mouse.
// Usage: node tools/check-sign.mjs [url] [--url http://localhost:4173/] [--out captures/sign-check] [--port 4173]
// Without a URL it serves dist/ itself (run `npm run build` first).
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveTarget } from './lib/target.mjs';

const { url, args, stop } = await resolveTarget();
const out = args.out ?? 'captures/sign-check';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|WebGL|GPU stall|Automatic fallback/.test(m.text())) errors.push(`console: ${m.text()}`); });
const failures = [];
const check = (ok, what) => { if (!ok) failures.push(what); console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const shot = (name) => page.screenshot({ path: join(out, `${name}.png`), animations: 'disabled' });
const api = (fn, ...a) => page.evaluate(([f, ...rest]) => { const g = window.game; return new Function('g', 'a', `return (${f})(g, ...a)`)(g, rest); }, [fn.toString(), ...a]);
const state = () => api((g) => g.state());
const waitState = async (kind) => { await page.waitForFunction((k) => window.game.state() === k, kind, { timeout: 8000 }).catch(() => undefined); return state(); };
const sign = () => api((g) => g.sign());
const waitSign = async (kind, timeout = 6000) => { const ok = await page.waitForFunction((k) => window.game.sign().kind === k, kind, { polling: 'raf', timeout }).then(() => true, () => false); return ok; };
const now = () => page.evaluate(() => performance.now());
const pos = () => api((g) => { const p = g.game.player.position; return [p.x, p.y, p.z]; });
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const dummyHp = () => api((g) => g.game.encounters.enemies.reduce((a, e) => a + e.hp, 0));
const playerHp = () => api((g) => g.game.combat.hp);
const text = async (sel) => ((await page.locator(sel).first().textContent()) ?? '').trim();
const setActivation = (a) => api((g, v) => { const m = g.game.mastery; m.stats.value = { ...m.stats.value, recoil: { ...m.stats.value.recoil, activation: v, output: 1 } }; }, a);
// A full Reserve makes Kinetic Release deal the same base damage every time, so two casts differ only by the sign's boost.
const fillReserve = () => api((g) => { g.game.techniques.resource = g.game.techniques.def.resource.max; });
const click = async () => { await page.mouse.move(640, 360); await page.mouse.down(); await page.mouse.up(); };
const pressAlt = () => page.keyboard.press('Alt');
const ready = async () => { await page.goto(`${url}?debug`); await page.waitForFunction(() => window.game?.game?.ready, null, { timeout: 180000 }); await page.waitForTimeout(500); };
// The hall's dummies, standing 1.4 m from one, facing it: inside Kinetic Release's reach.
const toDummies = async () => {
  await api((g) => { g.encounter('dummy-room'); g.teleport([6.4, 0.3, -12]); g.look(Math.PI / 2, 0); });
  await page.waitForTimeout(500);
};
const idle = async () => { await page.waitForFunction(() => !window.game.game.techniques.casting, null, { timeout: 4000 }).catch(() => undefined); await page.waitForTimeout(600); };

// One click on the dummy: the damage it dealt and how long the hit took to land after the click.
const punch = async () => {
  await fillReserve();
  const hp0 = await dummyHp();
  const t0 = await now();
  await click();
  const landed = await page.waitForFunction((h) => window.game.game.encounters.enemies.reduce((a, e) => a + e.hp, 0) < h, hp0, { polling: 'raf', timeout: 2500 }).then(() => true, () => false);
  const t1 = await now();
  const dmg = hp0 - (await dummyHp());
  await idle();
  return { landed, dmg, ms: Math.round(t1 - t0) };
};
// Performs the sign with Alt and waits for it to prime.
const doSign = async () => { await pressAlt(); check(await waitSign('signing', 2000), 'Alt starts the sign'); const primed = await waitSign('primed'); check(primed, 'the sign completes and primes the Technique'); return primed; };
// A primed cast and the plain cast it is measured against, at one Activation level.
const boosted = async (activation) => {
  await setActivation(activation);
  check((await sign()).kind === 'idle', `no prime is pending before the plain cast at Activation ${activation}`);
  const plain = await punch();
  await doSign();
  const { boost } = await sign();
  const primed = await punch();
  check(plain.landed && primed.landed, `both casts land at Activation ${activation}`);
  const expected = plain.dmg * (1 + boost);
  check(Math.abs(primed.dmg - expected) <= 1.6, `the primed cast deals the configured boost at Activation ${activation}: ${plain.dmg} plain, ${primed.dmg} primed, expected ${expected.toFixed(1)} (boost ${(boost * 100).toFixed(0)}%)`);
  check((await sign()).kind === 'idle', 'the primed cast consumes the prime');
  return { plain, primed, boost };
};

console.log('start: Recoil, tutorial skipped, first person');
await ready();
await page.getByRole('button', { name: 'Begin', exact: true }).click();
await page.locator('.card', { hasText: 'Recoil' }).click();
await page.getByRole('button', { name: 'Skip tutorial' }).click();
check((await waitState('explore')) === 'explore', 'Skip tutorial lands in explore');
await api((g) => g.camera('first'));
await setActivation(0);
await page.waitForTimeout(600);
check((await sign()).kind === 'idle', 'the sign starts idle');

console.log('Alt roots the player for the length of the sign');
await toDummies();
await page.keyboard.down('KeyS');
await page.waitForTimeout(600);
const walking = await pos();
await page.waitForTimeout(300);
const walked = dist(walking, await pos());
check(walked > 0.7, `S walks the player before Alt: ${walked.toFixed(2)} m in 0.3 s`);
await pressAlt();
check(await waitSign('signing', 2000), 'Alt starts the sign while walking');
const tSign = await now();
// The root stops the stride within a few frames; from then on the player must not move at all.
await page.waitForTimeout(300);
const p0 = await pos();
await page.waitForTimeout(800);
const p1 = await pos();
check(dist(p0, p1) < 0.02, `the player stands still mid-sign with S held: moved ${dist(p0, p1).toFixed(3)} m in 0.8 s`);
check(await waitSign('primed'), 'the sign primes');
const took = ((await now()) - tSign) / 1000;
const { duration, window: windowS } = await sign();
check(Math.abs(took - duration) < 0.3, `the sign took ${took.toFixed(2)} s against its ${duration} s length`);
await page.waitForTimeout(500);
const p2 = await pos();
await page.keyboard.up('KeyS');
check(dist(p1, p2) > 0.4, `the root lifts with the sign: moved ${dist(p1, p2).toFixed(2)} m in the half second after`);
await shot('01-primed-hud');
{
  const t = await text('.sign.primed .k');
  const left = await text('.sign.primed .v');
  check(t === 'Primed' && /^\d\.\d s$/.test(left), `the card reads Primed with the time left: "${t}" "${left}"`);
}
await page.waitForTimeout((windowS + 0.3) * 1000);
check((await sign()).kind === 'idle', `the prime lapses after its ${windowS} s window when nothing is cast`);
check((await page.locator('.sign').count()) === 0, 'the card leaves the HUD when the prime lapses');

console.log('casts, dash, jump, Wager and Tab do nothing during the sign');
await toDummies();
const hpBefore = await dummyHp();
await pressAlt();
check(await waitSign('signing', 2000), 'Alt starts the sign');
await page.waitForTimeout(80);
check(await page.locator('.sign.signing').isVisible() && (await text('.sign.signing .k')) === 'Full sign', 'the HUD shows the sign in progress');
await shot('02-signing-hud');
const still = await pos();
await click();
await page.keyboard.press('Digit1');
await page.keyboard.press('KeyC');
await page.keyboard.press('Space');
await page.keyboard.press('KeyR');
await page.keyboard.press('Tab');
await page.waitForTimeout(400);
check((await api((g) => g.game.techniques.casting)) === false && (await dummyHp()) === hpBefore, 'left click and 1 cast nothing');
check(dist(still, await pos()) < 0.05 && (await api((g) => g.game.player.dashTimer)) === 0, 'C does not dash');
check((await api((g) => g.game.player.grounded)) === true && (await api((g) => g.game.player.velocity.y)) <= 0.01, 'Space does not jump');
check((await api((g) => g.game.combat.wagerArmed)) === false && (await page.locator('.wager-arm').count()) === 0, 'R does not declare a Wager');
check((await state()) === 'encounter', `Tab does not open the Workshop: state ${await state()}`);
check((await sign()).kind === 'signing', 'the sign is still running after all that input');
check(await waitSign('primed'), 'and it primes');
await page.keyboard.press('Tab');
check((await waitState('workshop')) === 'workshop', 'once primed, Tab opens the Workshop again');
await page.keyboard.press('Escape');
await waitState('encounter');
await page.waitForTimeout(300);
await page.keyboard.press('KeyC');
await page.waitForTimeout(350);
check(dist(still, await pos()) > 0.6, `once primed, C dashes again: moved ${dist(still, await pos()).toFixed(2)} m`);
await page.waitForTimeout(4500);
check((await sign()).kind === 'idle', 'the prime lapses in the Workshop pause plus the window');

console.log('a hit taken mid-sign lands and does not cancel the sign');
await toDummies();
const hp0 = await playerHp();
await pressAlt();
check(await waitSign('signing', 2000), 'Alt starts the sign');
await page.waitForTimeout(500);
await api((g) => { const e = g.game.encounters.enemies[0]; g.game.combat.hurtPlayer(10, { from: e.position.clone() }); });
await page.waitForTimeout(100);
check((await playerHp()) === hp0 - 10, `the hit lands: ${hp0} to ${await playerHp()}`);
check((await sign()).kind === 'signing' && (await api((g) => g.game.hands.playing)), 'the sign keeps running through the hit');
check(await waitSign('primed'), 'and it primes');
await api((g) => { g.game.combat.hp = g.game.combat.maxHp; });
await click();
await idle();
check((await sign()).kind === 'idle', 'the click after spends that prime');

console.log('the primed cast skips its wind-up and deals the configured boost; a cast after the window does not');
await toDummies();
const base = await boosted(0);
check(base.primed.ms < base.plain.ms && base.primed.ms < 220, `the primed cast lands faster than the full-sign cast: ${base.primed.ms} ms against ${base.plain.ms} ms`);
await doSign();
await page.waitForTimeout((windowS + 0.4) * 1000);
check((await sign()).kind === 'idle', 'the window has closed');
const late = await punch();
check(late.landed && Math.abs(late.dmg - base.plain.dmg) <= 1, `a cast after the window deals plain damage: ${late.dmg} against ${base.plain.dmg}`);

console.log('the boost grows with Activation');
const mid = await boosted(0.5);
const top = await boosted(1);
check(base.boost < mid.boost && mid.boost < top.boost, `the configured boost rises: ${(base.boost * 100).toFixed(0)}% at 0, ${(mid.boost * 100).toFixed(0)}% at 0.5, ${(top.boost * 100).toFixed(0)}% at 1`);
check(base.primed.dmg < mid.primed.dmg && mid.primed.dmg < top.primed.dmg, `and so does the primed damage: ${base.primed.dmg}, ${mid.primed.dmg}, ${top.primed.dmg}`);
await setActivation(0);

console.log('frames of the sign at its beats, first then third person');
await api((g) => { g.loop(false); g.game.encounters.finish?.(false); g.teleport('courtyard'); g.look(0, -0.05); });
const step = (n) => api((g, n) => g.step(n, 1 / 60), n);
const BEATS = [['anticipation', 18], ['seal', 36], ['hold', 60], ['release', 74], ['stance', 100]];
const frames = async (prefix) => {
  await step(20);
  await page.keyboard.down('Alt');
  await step(1);
  await page.keyboard.up('Alt');
  let at = 1;
  for (const [name, f] of BEATS) { await step(f - at); at = f; await shot(`${prefix}-${name}`); }
  check((await sign()).kind === 'primed', `${prefix}: the stepped sign primes`);
  await step(Math.ceil(windowS * 60) + 20);
};
await api((g) => g.camera('first'));
await frames('fp');
await api((g) => { g.camera('third'); g.look(0, -0.15); });
await frames('tp');
await api((g) => { g.camera('top'); });
await frames('top');
await api((g) => g.loop(true));

const pageErrors = await api((g) => g.errors);
errors.push(...pageErrors.map((e) => `window: ${e}`));
writeFileSync(join(out, 'report.json'), JSON.stringify({ url, failures, errors, boost: { 0: base, 0.5: mid, 1: top } }, null, 2));
console.log(`\n${failures.length} failures, ${errors.length} page errors -> ${join(out, 'report.json')}`);
for (const e of errors.slice(0, 20)) console.log('  ERROR', e);
await browser.close();
stop();
process.exit(failures.length || errors.length ? 1 : 0);
