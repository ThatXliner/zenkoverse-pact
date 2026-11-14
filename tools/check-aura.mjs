#!/usr/bin/env node
// Aura Expansion and the Aura Clash (issue #4), played with real keys:
//   F expands and spends the whole pool; F again retracts with nothing
//   refunded; F does nothing until the pool has refilled completely; an
//   open field runs out on its own;
//   inside the field enemies are slowed and the player's hits land harder;
//   the listening stone's drill raises refinement, answered from the cue on
//   screen; potential falls with a broader Technique and with each Pact
//   inscribed, and holds refinement under it;
//   a clash against the Ancient Echo Master that the player loses: the
//   player's field collapses, the guard breaks, F cannot expand again, and
//   nobody loses health; while it plays, the clock runs at full speed and
//   an enemy outside the clash keeps moving;
//   a clash the player wins: her field collapses, she is held for the
//   opening, and again nobody loses health.
// It saves the field from the top-down and over-the-shoulder views and the
// clash at its tell and its reveal.
// Usage: node tools/check-aura.mjs [url] [--out captures/aura] [--port 4173]
// Without a URL it serves dist/ itself (run `npm run build` first).
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveTarget } from './lib/target.mjs';

const { url, args, stop } = await resolveTarget();
const out = args.out ?? 'captures/aura';
mkdirSync(out, { recursive: true });

const failures = [];
const errors = [];
const check = (ok, what) => { if (!ok) failures.push(what); console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); return ok; };
const near = (a, b, eps = 0.02) => Math.abs(a - b) <= eps;

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|GPU stall|Automatic fallback/.test(m.text())) errors.push(`console: ${m.text()}`); });
await page.goto(`${url}?debug`);
await page.waitForFunction(() => window.game?.game?.ready, null, { timeout: 180000 });

const step = (n) => page.evaluate((k) => window.game.step(k), n);
const aura = () => page.evaluate(() => window.game.aura());
// A real key: down for one frame, up the next.
async function press(code) {
  await page.keyboard.down(code);
  await step(1);
  await page.keyboard.up(code);
  await step(1);
}
const shot = (name) => page.screenshot({ path: join(out, `${name}.png`), animations: 'disabled' });
async function stepUntil(test, max) {
  for (let i = 0; i < max; i += 5) {
    if (await page.evaluate(test)) return true;
    await step(5);
  }
  return page.evaluate(test);
}

await page.evaluate(() => {
  const g = window.game, G = g.game;
  g.loop(false);
  localStorage.removeItem('zenko.mastery.v1');
  G.mastery.reset();
  g.technique('recoil');
  G.startRun({ skipTutorial: true });
  g.camera('top');
  g.teleport([-3, 0, 6]);
  g.step(30);
});

console.log('\nF expands and spends everything; F retracts; no refund; no expansion before a full refill');
let a = await aura();
check(a.state === 'ready' && a.pool === 1, `the pool starts full and ready (${a.state}, ${a.pool})`);
await press('KeyF');
await step(40);
a = await aura();
check(a.state === 'open', `F opens the field (${a.state})`);
check(a.pool === 0, `expanding spends the whole pool at once (pool ${a.pool})`);
check(a.radius > 4.2 && near(a.density, 0.3), `an untrained field: ${a.radius.toFixed(2)} m, density ${a.density.toFixed(2)}`);
const left = a.left;
await press('KeyF');
await step(2);
a = await aura();
check(a.state === 'recovering' && a.ended === 'retracted', `F again retracts it (${a.state}, ${a.ended}) with ${left.toFixed(1)} s unused`);
check(a.pool < 0.01, `retracting refunds nothing (pool ${a.pool.toFixed(3)})`);
await press('KeyF');
await step(4);
check((await aura()).state === 'recovering', 'F right after a retract does not expand');
await step(60 * 7);
a = await aura();
check(a.state === 'recovering' && a.pool > 0.4 && a.pool < 0.6, `halfway through the refill (${Math.round(a.pool * 100)}%)`);
await press('KeyF');
await step(4);
check((await aura()).state === 'recovering', 'F at half a pool still does not expand');
check(await stepUntil(() => window.game.aura().state === 'ready', 60 * 9), 'the pool refills completely');
await press('KeyF');
await step(4);
check((await aura()).state === 'open', 'once full, F expands again');
check(await stepUntil(() => window.game.aura().state === 'recovering', 60 * 11), 'left alone, the field runs out');
check((await aura()).ended === 'spent', `and ends as spent, not retracted (${(await aura()).ended})`);

console.log('\nwhat a field does');
await page.evaluate(() => {
  const g = window.game, G = g.game;
  g.refinement(0.6);
  g.auraReady();
  g.encounter('sparring');
  g.god(true);
  g.step(5);
  for (const [i, e] of G.encounters.enemies.entries()) { e.frozen = 1e6; e.position.set(1 + (i - 1) * 3.2, 0, 2.6 + (i === 1 ? -1.4 : 0)); }
  g.teleport([1, 0, 6.4]);
  g.camera('top');
  g.step(20);
});
await press('KeyF');
await step(50);
const fx = await page.evaluate(() => {
  const G = window.game.game;
  const inside = G.encounters.enemies.filter((e) => G.aura.inField(e.position));
  return { inside: inside.length, hinder: inside.map((e) => G.aura.hinder(e.position)), damage: inside.map((e) => G.aura.damageOn(e.position)), cast: G.aura.castSpeed, density: G.aura.density, far: G.aura.hinder(new G.player.position.constructor(30, 0, 30)) };
});
check(fx.inside === 3, `the sparring partners stand in the field (${fx.inside} of 3)`);
check(fx.hinder.every((h) => near(h, 1 - 0.5 * fx.density, 1e-6)) && fx.far === 1, `bodies inside move ${Math.round((1 - fx.hinder[0]) * 100)}% slower; outside, not at all`);
check(fx.damage.every((d) => d > 1.05 && d < 1.25), `the player's hits on them land ${Math.round((fx.damage[0] - 1) * 100)}% harder`);
check(fx.cast > 1.05 && fx.cast < 1.2, `the player's wind-ups are ${Math.round((fx.cast - 1) * 100)}% faster`);
await page.evaluate(() => { window.game.game.player.yaw = 0; });
await shot('field-top');
await page.evaluate(() => { const g = window.game; g.camera('third'); g.look(0, -0.22); g.step(40); });
await shot('field-shoulder');
await page.evaluate(() => { const g = window.game; g.camera('first'); g.look(0, -0.16); g.step(40); });
await shot('field-first');
await page.evaluate(() => { const g = window.game; g.game.encounters.reset(); g.camera('top'); g.god(false); g.step(5); });

console.log('\nrefinement and potential');
const pot = await page.evaluate(() => {
  const G = window.game.game;
  const ids = ['blink', 'recoil', 'rime', 'shift', 'echo'];
  return Object.fromEntries(ids.map((t) => [t, { potential: G.aura.potential(t), breadth: G.aura.breadth(t), pacts: G.aura.pacts(t) }]));
});
console.log(`    ${Object.entries(pot).map(([t, p]) => `${t} ${Math.round(p.potential * 100)} (breadth ${p.breadth}, ${p.pacts} Pacts)`).join(', ')}`);
const same = Object.entries(pot).filter(([, p]) => p.pacts === pot.rime.pacts).sort((x, y) => x[1].breadth - y[1].breadth);
check(same.length >= 3 && same.every(([, p], i) => i === 0 || p.potential < same[i - 1][1].potential), `with the same Pact count, a broader Technique has lower potential (${same.map(([t]) => t).join(' > ')})`);
const extra = await page.evaluate(() => {
  const G = window.game.game;
  const before = G.aura.potential();
  const src = G.book.inscribed.value.find((p) => p.technique === 'recoil' && p.slot === 'primary');
  const v = G.book.inscribe({ ...structuredClone(src), id: 'check.aura.extra', name: 'Second Strike', slot: 'art3' }, G.techniques.def.shapes);
  const after = G.aura.potential();
  return { ok: v.ok, errors: v.errors, before, after };
});
check(extra.ok && near(extra.before - extra.after, 0.05, 1e-6), `inscribing one more Pact lowers potential by 5 (${Math.round(extra.before * 100)} to ${Math.round(extra.after * 100)})${extra.ok ? '' : `: ${extra.errors}`}`);
await page.evaluate(() => window.game.refinement(1));
a = await aura();
check(near(a.refinement, a.potential, 1e-6) && a.trained === 1, `refinement is held to potential (${Math.round(a.trained * 100)} trained, ${Math.round(a.refinement * 100)} in effect)`);
check(await page.locator('.aura-meter .sub').textContent().then((t) => /Refinement \d+ of potential \d+/.test(t)), 'the HUD shows refinement and potential');

console.log('\nthe drill raises refinement');
await page.evaluate(() => { const g = window.game; g.refinement(0); g.teleport([6, 0, 3.2]); g.step(20); });
check(/Reading the Field/.test(await page.locator('.prompt').textContent().catch(() => '')), 'the listening stone offers its drill');
await press('KeyE');
await step(5);
check(await page.evaluate(() => window.game.state() === 'drill'), 'E begins it');
const COUNTER = { 'It swells toward you': 'KeyA', 'It draws tight': 'KeyW', 'Its far side flickers': 'KeyS' };
let answered = 0, lastCue = '';
for (let i = 0; i < 1200 && await page.evaluate(() => window.game.state() === 'drill'); i++) {
  const cue = await page.locator('.drill-hud .cue').textContent().catch(() => '');
  const tell = Object.keys(COUNTER).find((k) => cue.startsWith(k));
  if (tell && cue !== lastCue) { await press(COUNTER[tell]); answered++; lastCue = cue; await step(4); continue; }
  if (!tell) lastCue = '';
  await step(3);
}
a = await aura();
check(answered >= 4, `answered ${answered} tells from the cue on screen`);
check(a.trained > 0.1 && a.trained <= a.potential + 1e-9, `refinement rose to ${Math.round(a.trained * 100)} (potential ${Math.round(a.potential * 100)})`);
await page.evaluate(() => { const G = window.game.game; G.book.inscribed.value = G.book.inscribed.value.filter((p) => p.id !== 'check.aura.extra'); });

console.log('\na clash against the Master, lost');
await page.evaluate(() => {
  const g = window.game, G = g.game;
  g.refinement(0);
  g.auraReady();
  g.encounter('ancient');
  g.camera('top');
  g.step(120);
  // Someone outside the clash, far down the hall, to show the world keeps going.
  const thug = G.encounters.spawn('thug', new G.player.position.constructor(11, 0.3, -6));
  thug.state = 'chase';
});
const master0 = (await aura()).master;
check(master0?.field === 'open' && master0.radius > 6, `her field is open (${master0?.radius.toFixed(1)} m)`);
const hp0 = (await aura()).hp;
await press('KeyF');
check(await stepUntil(() => window.game.aura().clash.stage !== null, 60), 'opening a field against hers starts a clash');
const run0 = await page.evaluate(() => { const G = window.game.game; const t = G.encounters.enemies.find((e) => e.def.ai === 'thug'); return { thug: t.position.clone(), time: G.clock.time }; });
const BEATS = { push: 'hold', hold: 'feint', feint: 'push' };
const KEY = { push: 'KeyW', hold: 'KeyS', feint: 'KeyA' };
const COUNTER_PICK = { push: 'feint', hold: 'push', feint: 'hold' };
let shotTell = false, shotReveal = false, speeds = [];
async function fight(answer) {
  for (let i = 0; i < 400; i++) {
    const s = await page.evaluate(() => { const G = window.game.game; return { stage: G.aura.clash.stage, pick: G.aura.clash.masterPick, mine: window.game.aura().clash.view?.mine ?? null, ratio: G.clock.dt / G.clock.raw }; });
    if (s.stage === null) return;
    speeds.push(s.ratio);
    if (s.stage === 'choose' && s.pick && !s.mine) {
      await step(3);
      if (!shotTell) { await shot('clash-tell'); shotTell = true; }
      await press(KEY[answer(s.pick)]);
      continue;
    }
    if (s.stage === 'reveal' && !shotReveal) { await step(8); await shot('clash-reveal'); shotReveal = true; continue; }
    await step(2);
  }
}
await fight((her) => BEATS[her]);
a = await aura();
const lost = a.clash.log.filter((l) => l.ev.kind === 'end').at(-1)?.ev;
const run1 = await page.evaluate(() => { const G = window.game.game; const t = G.encounters.enemies.find((e) => e.def.ai === 'thug'); return { thug: t.position.clone(), time: G.clock.time, alive: t.alive }; });
check(lost?.winner === 1, `the Master takes it (${JSON.stringify(lost)})`);
check(a.clash.log.filter((l) => l.ev.kind === 'reveal').length >= 2 && a.clash.log.filter((l) => l.ev.kind === 'reveal').length <= 3, `in ${a.clash.log.filter((l) => l.ev.kind === 'reveal').length} exchanges`);
check(a.state === 'recovering' && a.ended === 'collapsed', `the player's field collapsed (${a.state}, ${a.ended}), a different end from a retract`);
check(a.guardBroken > 0, `the player's guard is broken for ${a.guardBroken.toFixed(1)} s`);
check(a.hp === hp0, `the player lost no health (${hp0} to ${a.hp})`);
check(a.master.hp === master0.hp, `the Master lost no health (${master0.hp} to ${a.master.hp})`);
check(Math.hypot(run1.thug.x - run0.thug.x, run1.thug.z - run0.thug.z) > 2, `a thug outside the clash kept moving (${Math.hypot(run1.thug.x - run0.thug.x, run1.thug.z - run0.thug.z).toFixed(1)} m)`);
check(speeds.every((r) => r > 0.99), `the clock ran at full speed through the clash (slowest ${Math.min(...speeds).toFixed(2)})`);
await press('KeyF');
await step(4);
check((await aura()).state === 'recovering', 'F cannot expand again until the pool refills');
await page.evaluate(() => { const G = window.game.game; for (const e of G.encounters.enemies) if (e.def.ai === 'thug') e.die(); });

console.log('\na clash against the Master, won');
await page.evaluate(() => { const g = window.game; g.auraReady(); g.game.combat.invuln = 0; g.step(30); });
const hp1 = (await aura()).hp, master1 = (await aura()).master;
const logLen = (await aura()).clash.log.length;
await press('KeyF');
check(await stepUntil(() => window.game.aura().clash.stage !== null, 60), 'a second clash starts');
await fight((her) => COUNTER_PICK[her]);
a = await aura();
const won = a.clash.log.slice(logLen).filter((l) => l.ev.kind === 'end').at(-1)?.ev;
check(won?.winner === 0 && won.reason === 'rounds', `the player takes it two exchanges to none (${JSON.stringify(won)})`);
check(a.master.field === 'recovering' && a.master.ended === 'collapsed', `her field collapsed (${a.master.field}, ${a.master.ended})`);
check(a.master.locked > 0 && a.master.guardBroken > 0, `the opening: she is held ${a.master.locked.toFixed(1)} s and her guard is broken ${a.master.guardBroken.toFixed(1)} s`);
check(a.state === 'open', `the player's field stays open (${a.state})`);
check(a.hp === hp1 && a.master.hp === master1.hp, `nobody lost health (player ${hp1} to ${a.hp}, Master ${master1.hp} to ${a.master.hp})`);
await page.evaluate(() => { window.game.step(20); });
await shot('clash-after');

const pageErrors = await page.evaluate(() => window.game.errors);
errors.push(...pageErrors.map((e) => `window: ${e}`));
check(!errors.length, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
writeFileSync(join(out, 'report.json'), JSON.stringify({ url, failures, errors }, null, 2));
await browser.close();
stop();
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
process.exit(failures.length ? 1 : 0);
