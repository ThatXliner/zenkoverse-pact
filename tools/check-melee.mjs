#!/usr/bin/env node
// Bare hands (src/combat/melee.ts), driven with real keys and the mouse:
//   R throws a jab, a cross and a hook in that order, for their damage, and
//   the combo comes back to the jab after the hook or a pause;
//   the punch turns to a body near the aim and steps in to reach it, and
//   top-down it goes where the cursor points;
//   X spends its share of the pool and lands harder, throws the body down
//   and breaks its guard; with too little aura it does not fire and the HUD
//   says so; with the body layer open it costs field time instead and lands
//   harder still; after a strike F cannot expand until the pool refills;
//   a Technique cast takes the hands, a press during a cast waits for it, and
//   a dash drops a blow;
//   mashing R on a thug never holds it: it winds up and swings between combos;
//   a boss takes less and does not flinch from a jab;
//   online, B takes A's combo and aura strike once each, by what A sent, and
//   B's screen plays A's blows on A's body.
// It saves frame strips of a combo and an aura strike on a sparring thug,
// top-down and over the shoulder.
// Usage: node tools/check-melee.mjs [url] [--out captures/melee] [--port 4181] [--no-shots] [--offline-only]
// Without a URL it serves dist/ through server/index.mjs (run `npm run build` first).
import { chromium } from 'playwright';
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveTarget } from './lib/target.mjs';

const { url, args, stop } = await resolveTarget(process.argv.slice(2), { realtime: true });
const out = args.out ?? 'captures/melee';
const shots = args['no-shots'] !== 'true';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const errors = [];
const failures = [];
const check = (ok, what) => { if (!ok) failures.push(what); console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); return ok; };
const watch = (page, name) => {
  page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|WebGL|GPU stall|Automatic fallback|WebSocket/.test(m.text())) errors.push(`${name} console: ${m.text()}`); });
};
const apiOf = (page) => (fn, ...a) => page.evaluate(([f, ...rest]) => new Function('g', 'a', `return (${f})(g, ...a)`)(window.game, rest), [fn.toString(), ...a]);

const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
watch(page, 'solo');
const api = apiOf(page);
const step = (n) => api((g, n) => g.step(n, 1 / 60), n);
const melee = () => api((g) => g.melee());
// A key pressed and let go, then the frames after it run: the game reads the press on the next one.
const tap = async (code, frames = 1) => { await page.keyboard.press(code); await step(frames); };

// In by the title with real keys: Begin takes the focus, Enter opens the
// Technique select, and Fuel (no damage of its own) is picked.
await page.goto(`${url}?debug`);
await page.waitForFunction(() => window.game?.game?.ready, null, { timeout: 180000 });
await page.waitForFunction(() => document.activeElement?.textContent === 'Begin', null, { timeout: 20000 });
await page.keyboard.press('Enter');
await page.locator('.card', { hasText: 'Fuel' }).click();
await page.getByRole('button', { name: 'Skip tutorial' }).click();
await page.waitForFunction(() => window.game.state() === 'explore', null, { timeout: 10000 });
await api((g) => g.loop(false));

// A fresh scene in the yard, facing -z.
const fresh = (view = 'third') => api((g, view) => {
  const G = g.game;
  G.startRun({ skipTutorial: true }); g.god(true); g.technique('fuel'); g.step(5);
  G.encounters.reset();
  g.teleport([0, 0, 7]); g.camera(view); g.look(0, -0.12); g.step(20);
}, view);
// A body at `at`; `passive` ones never swing or cast.
const body = (at, key = 'thug', passive = true) => api((g, at, key, passive) => {
  const G = g.game, V = G.player.position.constructor;
  const e = G.encounters.spawn(key, new V(...at));
  e.field = null; e.castCd = 1e9;
  if (passive) e.attackCd = 1e9;
  return G.encounters.enemies.indexOf(e);
}, at, key, passive);
const bodies = async () => (await melee()).bodies;
const steps = async (n, each) => { for (let i = 0; i < n; i++) { await step(1); if (each) await each(i); } };

// ---------------------------------------------------------------- the combo
console.log('\nR: a jab, a cross and a hook, each for its own damage');
await fresh();
await body([0, 0, 5.4]);
for (let i = 0; i < 3; i++) { await tap('KeyR', 16); }
await step(40);
let m = await melee();
const names = m.log.map((l) => l.blow);
check(names.join(',') === 'jab,cross,hook', `three presses throw ${names.join(', ')}`);
check(m.log.map((l) => l.amount).join(',') === '4,5,9', `they deal ${m.log.map((l) => l.amount).join(', ')} (a full combo 18 of a thug's 70)`);
check(m.log.every((l) => l.target === 'thug'), 'every blow lands on the thug');
check(m.next === 'jab', `after the hook the next press is a jab again (${m.next})`);
await fresh();
await body([0, 0, 5.4]);
for (let i = 0; i < 3; i++) { await tap('KeyR', 16); }
for (let i = 0; i < 90 && (await melee()).blow; i++) await step(1);
await tap('KeyR', 1);
check((await melee()).blow === null, 'R the moment the hook ends waits for the hands to come back to the guard');
await step(60);
await tap('KeyR', 12);
await step(60);
await tap('KeyR', 12);
m = await melee();
check(m.log.slice(-2).map((l) => l.blow).join(',') === 'jab,jab', `a pause drops the combo back to the jab (${m.log.slice(-2).map((l) => l.blow).join(', ')})`);

console.log('\nthe punch steps in to a body near the aim');
await fresh();
await body([0.9, 0, 4.4]);
const before = await api((g) => g.game.player.position.z);
await tap('KeyR', 20);
m = await melee();
const after = await api((g) => g.game.player.position.z);
check(m.log.at(-1)?.target === 'thug', `a body 2.7 m out and off the line takes the jab (${m.log.at(-1)?.amount ?? 0})`);
check(before - after > 0.5, `the body stepped in ${(before - after).toFixed(2)} m to reach it`);
await fresh();
await body([0, 0, 3]);
await tap('KeyR', 20);
m = await melee();
check(m.log.at(-1)?.target === null && (await bodies())[0].hp === 70, 'a body 4 m away is out of reach: the jab hits air');

console.log('\ntop-down, the punch goes where the cursor points');
await fresh('top');
await body([1.6, 0, 7]);
await body([-1.6, 0, 7]);
const toScreen = (at) => api((g, at) => { const G = g.game, V = G.player.position.constructor; const q = new V(...at).project(G.renderer.camera); return [(q.x * 0.5 + 0.5) * innerWidth, (-q.y * 0.5 + 0.5) * innerHeight]; }, at);
{
  const [x, y] = await toScreen([3, 0.5, 7]);
  await page.mouse.move(x, y);
  await step(10);
  await tap('KeyR', 20);
  const hp = (await bodies()).map((b) => b.hp);
  check(hp[0] < 70 && hp[1] === 70, `the body on the cursor's side takes it, the one behind does not (${hp.join(', ')})`);
}

// --------------------------------------------------------------- aura strike
console.log('\nX: the aura strike');
await fresh();
await body([0, 0, 5.3]);
await tap('KeyX', 40);
m = await melee();
let s = m.log.at(-1);
check(s?.blow === 'strike' && s.amount === 15, `it lands for ${s?.amount} (a hook is 9)`);
check(Math.abs(m.strike.pool - 0.7) < 0.02 && m.strike.state === 'recovering', `it took 30% of the pool (${(m.strike.pool * 100).toFixed(0)}% left, ${m.strike.state})`);
check(m.bodies[0].state === 'knocked' && m.bodies[0].guardBroken > 0, `the thug is thrown down (${m.bodies[0].state}) with its guard broken (${m.bodies[0].guardBroken.toFixed(1)} s)`);
check(await page.locator('.aura-meter .w').textContent() === 'Aura · Drawn', `the meter reads ${await page.locator('.aura-meter .w').textContent()}`);
await tap('KeyF', 5);
check((await api((g) => g.aura())).state === 'recovering', 'F cannot expand until the pool refills: the strike competes with it');
await shotEl('aura-meter-drawn', '.vitals');

console.log('\nwith too little aura, X does nothing and the HUD shows it');
await step(40);
await api((g) => { g.game.aura.field.pool = 0.2; });
await step(2);
const deniedBefore = (await melee()).denied;
const thrown = (await melee()).thrown;
await page.keyboard.press('KeyX');
await step(1);
m = await melee();
check(m.thrown === thrown && m.blow === null, 'no blow is thrown');
check(m.denied > deniedBefore, 'the refusal is marked');
check(await page.locator('.aura-meter[data-strike=short]').count() === 1, 'the aura meter marks the strike short of its notch');
check(await page.locator('.aura-meter.denied').waitFor({ timeout: 400 }).then(() => true, () => false), 'and shudders');
await shotEl('aura-meter-short', '.vitals');

console.log('\nwith the body layer on, the strike costs field time and lands harder');
await fresh();
await body([0, 0, 5.3]);
await tap('KeyF', 30);
let a = await api((g) => g.aura());
check(a.state === 'open' && a.radius < 1, `F taps the layer on (${a.state}, ${a.radius.toFixed(2)} m)`);
const left0 = a.left;
await tap('KeyX', 40);
a = await api((g) => g.aura());
m = await melee();
s = m.log.at(-1);
check(a.state === 'open' && left0 - a.left > a.holds * 0.11, `it took ${(left0 - a.left).toFixed(1)} s of the layer's ${a.holds.toFixed(0)} s (12%), not the pool`);
check(s?.amount > 15, `wrapped in the layer it lands harder (${s?.amount} against 15)`);

// --------------------------------------------------------------- the hands
console.log('\nhow the hands share with a cast and a dash');
await fresh();
await body([0, 0, 5.4]);
await api((g) => { g.game.techniques.resource = 100; g.cast('primary'); });
await page.keyboard.press('KeyR');
await step(2);
check((await melee()).blow === null, 'R during a cast does not cut it');
{
  const thrown0 = (await melee()).thrown;
  let during = 0, threw = false;
  for (let i = 0; i < 120; i++) {
    await step(1);
    const now = await api((g) => ({ casting: g.game.techniques.casting, thrown: g.melee().thrown }));
    if (now.thrown > thrown0) { threw = true; if (now.casting) during++; }
  }
  check(during === 0, `no blow is thrown on top of the cast (${threw ? 'thrown after it' : 'dropped: the cast outlasted the wait'})`);
}
await step(40);
await tap('KeyR', 2);
check((await melee()).blow?.name === 'jab', 'a jab is out');
await api((g) => { g.game.techniques.resource = 100; g.cast('primary'); });
await step(1);
check((await melee()).blow === null, 'a cast takes the hands: the blow is dropped');
await step(90);
await tap('KeyR', 2);
await tap('KeyC', 1);
check((await melee()).blow === null, 'a dash drops the blow');

// ------------------------------------------------------------ no stun-lock
console.log('\nmashing R never holds a thug');
await fresh();
await body([0, 0, 5.4], 'thug', false);
await api((g) => { g.game.encounters.enemies[0].hp = 1e5; });
const mash = await (async () => {
  let held = 0, longest = 0, windups = 0, was = '', hits = 0;
  for (let f = 0; f < 60 * 20; f++) {
    if (f % 5 === 0) await page.keyboard.press('KeyR');
    const st = await api((g) => { g.step(1, 1 / 60); const e = g.game.encounters.enemies[0]; e.position.set(0, e.position.y, 5.4); return e.state; });
    if (st === 'windup' && was !== 'windup') windups++;
    if (st === 'stagger' || st === 'knocked') { held += 1 / 60; longest = Math.max(longest, held); } else held = 0;
    was = st;
  }
  hits = (await melee()).log.length;
  return { longest, windups, hits };
})();
check(mash.windups >= 4, `the thug winds up ${mash.windups} times in 20 s of mashing`);
check(mash.longest < 1.6, `it is never held longer than ${mash.longest.toFixed(2)} s at a time`);

console.log('\na boss takes less, and a jab does not stop its blow once committed');
await fresh();
await body([0, 0, 5.4], 'kuroda');
await tap('KeyR', 20);
m = await melee();
check(m.log.at(-1)?.amount === 2, `the Enforcer takes ${m.log.at(-1)?.amount} from a jab (a thug 4)`);
check(m.bodies[0].state !== 'stagger', `and does not flinch (${m.bodies[0].state})`);
await fresh();
await body([0, 0, 5.4], 'thug', false);
const committed = await api((g) => { const e = g.game.encounters.enemies[0]; e.attackCd = 0; for (let i = 0; i < 40 && !(e.state === 'windup' && e.stateTime > 0.3); i++) g.step(1, 1 / 60); return e.state; });
await tap('KeyR', 8);
const st = (await bodies())[0].state;
check(committed === 'windup' && (st === 'windup' || st === 'strike' || st === 'recover'), `a jab into a committed wind-up does not stop it (${committed} then ${st})`);

// ---------------------------------------------------------------- strips
const strips = [];
// Each frame is cut to the two bodies: a box round the player and the
// first enemy as the camera sees them at the start.
async function strip(name, frames, every, start, onFrame) {
  const tiles = [];
  const box = await api(() => {
    const G = window.game.game, V = G.player.position.constructor, cam = G.renderer.camera;
    cam.updateMatrixWorld(true);
    const scr = (p) => { const q = p.clone().add(new V(0, 1, 0)).project(cam); return [(q.x * 0.5 + 0.5) * innerWidth, (-q.y * 0.5 + 0.5) * innerHeight]; };
    const a = scr(G.player.position), b = scr(G.encounters.enemies[0].position);
    const w = Math.min(innerWidth, Math.max(G.cam.isTop ? 300 : 440, Math.abs(a[0] - b[0]) * 3, Math.abs(a[1] - b[1]) * 4)), h = Math.round(w * 0.75);
    const x = Math.round(Math.max(0, Math.min(innerWidth - w, (a[0] + b[0]) / 2 - w / 2))), y = Math.round(Math.max(0, Math.min(innerHeight - h, (a[1] + b[1]) / 2 - h * 0.55)));
    return { left: x, top: y, width: Math.round(w), height: Math.min(h, innerHeight - y) };
  });
  await start();
  for (let i = 0; i < frames; i++) {
    if (onFrame) await onFrame(i);
    await step(every);
    if (shots) tiles.push(await sharp(await page.screenshot({ animations: 'disabled' })).extract(box).resize(400, 300).png().toBuffer());
  }
  if (!shots) return;
  const cols = 5, rows = Math.ceil(tiles.length / cols);
  const file = join(out, `${name}.png`);
  await sharp({ create: { width: 400 * cols, height: 300 * rows, channels: 3, background: '#000' } }).composite(tiles.map((b, i) => ({ input: b, left: (i % cols) * 400, top: Math.floor(i / cols) * 300 }))).png().toFile(file);
  strips.push(file);
}
async function shotEl(name, sel) { if (shots) await page.locator(sel).screenshot({ path: join(out, `${name}.png`) }); }

console.log('\nframe strips');
for (const view of ['top', 'third']) {
  await fresh(view);
  await body([0.3, 0, 5.2], 'thug', false);
  await api((g) => { const e = g.game.encounters.enemies[0]; e.attackCd = 3.5; });
  // The cursor past the thug, so its ring is not drawn over the body.
  if (view === 'top') { const [x, y] = await toScreen([0.6, 1, 3.6]); await page.mouse.move(x, y); }
  await step(10);
  // R pressed three times as a player mashing it would, 15 frames apart.
  await strip(`combo-${view}`, 40, 2, () => page.keyboard.press('KeyR'), async (i) => { if (i === 7 || i === 15) await page.keyboard.press('KeyR'); });
  console.log(`  ${view}: ${(await melee()).log.slice(-3).map((l) => `${l.blow} ${l.amount}`).join(', ')}`);
  await fresh(view);
  await body([0.3, 0, 5.2], 'thug', false);
  await api((g) => { const e = g.game.encounters.enemies[0]; e.attackCd = 4; });
  if (view === 'top') { const [x, y] = await toScreen([0.6, 1, 3.6]); await page.mouse.move(x, y); }
  await step(10);
  await strip(`strike-${view}`, 20, 2, async () => { await page.keyboard.press('KeyX'); });
}
for (const f of strips) console.log(`  ${f}`);

// ------------------------------------------------------------------ online
if (args['offline-only'] !== 'true') {
  console.log('\nonline: A punches B');
  const room = `melee-${Date.now().toString(36)}`;
  async function player(name, tech) {
    const ctx = await browser.newContext({ viewport: { width: 960, height: 600 } });
    const p = await ctx.newPage();
    watch(p, name);
    await p.goto(`${url}?debug&room=${room}`);
    await p.waitForFunction(() => window.game?.game?.ready, null, { timeout: 180000 });
    await p.locator('.card').filter({ has: p.locator('h3', { hasText: new RegExp(`^${tech}$`, 'i') }) }).click();
    await p.locator('input[name=name]').fill(name);
    await p.locator('[data-join]').click();
    await p.waitForFunction(() => window.game.net()?.status === 'online', null, { timeout: 15000 });
    return { page: p, api: apiOf(p) };
  }
  const A = await player('Ada', 'fuel');
  const B = await player('Bo', 'tension');
  await A.page.waitForFunction(() => window.game.net().remotes.length === 1, null, { timeout: 10000 });
  await B.page.waitForFunction(() => window.game.net().remotes.length === 1, null, { timeout: 10000 });
  const idOf = async (P) => (await P.api((g) => g.net())).id;
  const aId = await idOf(A), bId = await idOf(B);
  // B stands still 1.6 m in front of A, A faces B.
  await B.api((g) => { g.teleport([0, 0, 5.4]); g.camera('third'); });
  await A.api((g) => { g.teleport([0, 0, 7]); g.camera('third'); g.look(0, -0.1); });
  await A.page.waitForFunction((b) => { const r = window.game.net().remotes.find((x) => x.id === b); return r?.drawn && Math.abs(r.drawn[2] - 5.4) < 0.2; }, bId, { timeout: 10000 });
  // Past the spawn protection a fresh join has.
  await A.page.waitForTimeout(2000);
  const hpB0 = (await B.api((g) => g.net())).hp;
  const seen = [];
  const sawOnB = B.page.evaluate((a) => new Promise((done) => {
    const keys = [];
    const t0 = performance.now();
    const tick = () => {
      const r = window.game.game.net.remotes.get(a);
      if (r?.gestureKey && keys.at(-1) !== r.gestureKey) keys.push(r.gestureKey);
      if (r?.gestureKey) r.gestureKey = null;
      if (performance.now() - t0 > 4000) done(keys); else requestAnimationFrame(tick);
    };
    tick();
  }), aId);
  for (let i = 0; i < 3; i++) { await A.page.keyboard.press('KeyR'); await A.page.waitForTimeout(300); }
  seen.push(...await sawOnB);
  await A.page.waitForTimeout(1000);
  const sentA = (await A.api((g) => g.net())).sent.filter((h) => h.target === bId).map((h) => h.amount);
  const hpB1 = (await B.api((g) => g.net())).hp;
  check(sentA.join(',') === '4,5,9', `A's screen sent the combo to B: ${sentA.join(', ')}`);
  check(Math.abs(hpB0 - hpB1 - 18) < 0.01, `B took it once each: ${hpB0} to ${hpB1}`);
  check(seen.join(',') === 'blow0,blow1,blow2', `B's screen played A's jab, cross and hook on A's body (${seen.join(', ')})`);
  const hpOnA = (await A.api((g) => g.net())).remotes.find((r) => r.id === bId).hp;
  check(Math.abs(hpOnA - hpB1) < 0.01, `both screens agree on B's health (${hpOnA})`);

  console.log('\nonline: A\'s aura strike goes through B\'s body layer');
  await B.page.keyboard.press('KeyF');
  await B.page.waitForFunction(() => window.game.aura().state === 'open', null, { timeout: 3000 });
  await A.page.waitForFunction((b) => { const r = window.game.game.net.remotes.get(b); return r && r.fieldRadius > 0.3; }, bId, { timeout: 5000 });
  await A.page.waitForTimeout(600);
  const strikeSeen = B.page.waitForFunction((a) => window.game.game.net.remotes.get(a)?.gestureKey === 'blow3', aId, { timeout: 4000, polling: 'raf' }).then(() => true, () => false);
  await A.page.keyboard.press('KeyX');
  const sawStrike = await strikeSeen;
  await A.page.waitForTimeout(1200);
  const hpB2 = (await B.api((g) => g.net())).hp;
  const bAura = await B.api((g) => g.aura());
  check(sawStrike, 'B\'s screen played A\'s aura strike on A\'s body');
  // Softened by the layer it would be 15 x (1 - 0.3 x density) at most, 12.75 untrained.
  check(hpB1 - hpB2 > 14 && hpB1 - hpB2 <= 15.01, `B took about the whole 15 through the layer, not the softened 12.75 (${hpB1} to ${hpB2.toFixed(1)})`);
  check(bAura.guardBroken > 0, `and B's guard is broken (${bAura.guardBroken.toFixed(1)} s)`);
  if (shots) { await A.page.screenshot({ path: join(out, 'online-a.png') }); await B.page.screenshot({ path: join(out, 'online-b.png') }); }
  const errsA = await A.api((g) => g.errors), errsB = await B.api((g) => g.errors);
  for (const e of [...errsA, ...errsB]) errors.push(e);
  await A.page.context().close();
  await B.page.context().close();
}

for (const e of [...errors, ...(await api((g) => g.errors))]) { failures.push(e); console.log('ERROR', e); }
writeFileSync(join(out, 'report.json'), JSON.stringify({ failures, strips }, null, 2));
await browser.close();
stop?.();
console.log(failures.length ? `\n${failures.length} failed -> ${join(out, 'report.json')}` : '\nall passed');
process.exit(failures.length ? 1 : 0);
