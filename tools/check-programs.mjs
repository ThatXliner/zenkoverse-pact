#!/usr/bin/env node
// Proves a programmed Pact does what its readback says, and no more. "Fires
// on its own" goes through the same checks as its key: a Maximum Output
// programmed to fire when struck waits for a full ring, and a Pact keeps its
// own trigger. It fires as its trigger begins to hold, whatever the trigger.
// "Refuses to fire" refuses while its trigger holds. The Pacts are inscribed
// through the book; the play is real keys and the mouse.
// Usage: node tools/check-programs.mjs [url] [--port 4173]
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

await page.goto(`${url}?debug`);
await page.waitForFunction(() => window.game?.game?.ready, null, { timeout: 180000 });
// The title mounts a moment after the game is ready (slower on the live
// site): press Enter once its first choice holds the focus, as a player would.
await page.waitForFunction(() => document.activeElement?.textContent === 'Begin', null, { timeout: 60000 });
await page.keyboard.press('Enter');
await sleep(400);
await page.getByRole('button', { name: 'Skip tutorial' }).click();
await page.waitForFunction(() => window.game.state() === 'explore');

// A fresh run with Recoil, one Pact inscribed on its key from a catalogue
// Pact with `clauses` swapped in, and a count of every cast and Output.
const setup = (slot, clauses) => page.evaluate(({ slot, clauses }) => {
  const g = window.game, G = g.game;
  G.book.resetAll();
  G.startRun({ skipTutorial: true }); g.technique('recoil'); g.camera('top'); g.god(false);
  const base = G.techniques.def.catalogue.find((p) => p.slot === slot);
  const v = G.book.inscribe({ ...structuredClone(base), id: `check.${slot}`, name: `Programmed ${slot}`, clauses }, G.techniques.def.shapes);
  const T = G.techniques, log = window.__log = { slot, casts: 0, grounded: 0, outputs: 0 };
  // Recoil's Reserve fills from absorbed blows; start it full so cost is never the reason.
  T.resource = T.def.resource.max;
  if (!T.__counted) {
    const cast = T.cast.bind(T), max = T.beginMax.bind(T);
    T.cast = (s, f) => { const ok = cast(s, f); if (ok && s === window.__log.slot) { window.__log.casts++; if (G.player.grounded) window.__log.grounded++; } return ok; };
    T.beginMax = () => { const ok = max(); if (ok) window.__log.outputs++; return ok; };
    T.__counted = true;
  }
  return v;
}, { slot, clauses });
const thug = () => page.evaluate(() => {
  const G = window.game.game, V = G.player.position.constructor;
  window.game.teleport([0, 0, 7]);
  const e = G.encounters.spawn('thug', new V(0, 0, 5.6)); e.hp = e.maxHp = 1e6; e.castCd = 1e6;
  return true;
});
// Real seconds of standing still while the thug swings, healed so the run lasts.
const takeBlows = async (seconds) => {
  const t0 = Date.now();
  let blows = 0, was = 100;
  while (Date.now() - t0 < seconds * 1000) {
    const hp = await page.evaluate(() => window.game.game.combat.hp);
    if (hp < was - 0.5) blows++;
    await page.evaluate(() => { const C = window.game.game.combat; C.hp = 100; });
    was = 100;
    await sleep(50);
  }
  return blows;
};
const log = () => page.evaluate(() => window.__log);

console.log('\na Maximum Output programmed to fire when struck');
check((await setup('max', [{ kind: 'restrict', restriction: { param: 'resource', value: 'all' } }, { kind: 'program', when: 'struck', then: 'activate' }])).ok, 'the Workshop accepts the Pact');
await page.evaluate(() => { window.game.game.techniques.charge = 0; });
await thug();
const blows = await takeBlows(10);
const empty = await log();
check(blows >= 2, `the thug lands blows (${blows})`);
check(empty.outputs === 0 && empty.casts === 0, `with an empty ring it fires nothing (${empty.outputs} Outputs, ${empty.casts} casts)`);
await page.evaluate(() => { window.game.game.techniques.charge = 1; window.game.game.encounters.enemies[0].attackCd = 0; });
await page.waitForFunction(() => window.game.game.cutscenes.active || window.__log.outputs > 0, null, { timeout: 15000 }).catch(() => null);
const full = await log();
check(full.outputs === 1, `with a full ring the next blow plays its Maximum Output (${full.outputs})`);
await page.waitForFunction(() => !window.game.game.cutscenes.active, null, { timeout: 10000 });

console.log('\na primary that works only in the air, programmed to fire when struck');
await setup('primary', [{ kind: 'restrict', restriction: { param: 'trigger', value: 'airborne' } }, { kind: 'program', when: 'struck', then: 'activate' }]);
await thug();
await takeBlows(8);
const grounded = await log();
check(grounded.grounded === 0, `struck on the ground, it keeps its own trigger and does not fire there (${grounded.grounded} casts on the ground)`);

console.log('\na primary programmed to fire when airborne');
await setup('primary', [{ kind: 'program', when: 'airborne', then: 'activate' }]);
await sleep(300);
for (let i = 0; i < 3; i++) { await page.keyboard.press('Space'); await sleep(1100); }
const jumps = await log();
check(jumps.casts === 3, `three jumps with Space fire it three times (${jumps.casts})`);

console.log('\na secondary programmed to refuse while standing still');
await setup('secondary', [{ kind: 'program', when: 'still', then: 'suppress' }]);
await sleep(400);
await page.mouse.move(640, 260);
await page.mouse.down({ button: 'right' }); await sleep(60); await page.mouse.up({ button: 'right' });
await sleep(300);
const still = await log();
const said = await page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | '));
check(still.casts === 0, `right click standing still does not cast it (${still.casts})`);
check(/refuses to fire while you stand still/.test(said), `and says why ("${said}")`);
await page.keyboard.down('KeyD');
await sleep(500);
await page.mouse.down({ button: 'right' }); await sleep(60); await page.mouse.up({ button: 'right' });
await sleep(300);
await page.keyboard.up('KeyD');
await sleep(1200);
const moving = await log();
check(moving.casts === 1, `right click on the move casts it (${moving.casts})`);

await page.evaluate(() => window.game.game.book.resetAll());
check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await browser.close();
await stop?.();
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
process.exit(failures.length ? 1 : 0);
