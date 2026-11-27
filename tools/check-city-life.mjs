#!/usr/bin/env node
// Plays the ward's fights and its street (`?debug&region=city`) with real
// held keys and the mouse, from the top-down camera and over the shoulder:
//  - walking into the back alley starts a fight there on its own, with no
//    banner; someone comes to the end of the lane to watch it; winning it
//    moves the goal on, and it is not there again until the player has been
//    far away and come back;
//  - walking off a fight ends it: its men walk off and go, and play goes on;
//  - the officer at the koban whistles at a Technique cast he can see, walks
//    over and watches, and breaks up a street fight brought into his sight;
//  - the Kuroda gate: the two men there follow the player into the yard;
//    won, pushing on to the warehouse brings the Enforcer out; a fight won by
//    a Maximum Output's blow hands back to play;
//  - a fight in the ward ends cleanly when the ward streams out behind the player;
//  - the east roofs: a man bolts over the cross alley and away down the main
//    road, and gets away if nobody stops him; a hold stops him and he fights;
//  - no fight starts in the middle of a drill or a cutscene.
// It saves frames of each in captures/city-life (or --out).
// Usage: node tools/check-city-life.mjs [url] [--out dir]
// Without a url it serves dist/ (run `npm run build` first).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveTarget } from './lib/target.mjs';

const { url, args, stop } = await resolveTarget(process.argv.slice(2));
const out = args.out ?? 'captures/city-life';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const errors = [];
const failures = [];
const check = (ok, what) => { if (!ok) failures.push(what); console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); return ok; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|WebGL|GPU stall|Automatic fallback|WebSocket/.test(m.text())) errors.push(`console: ${m.text()}`); });
const api = (fn, arg) => page.evaluate(([src, a]) => (0, eval)(src)(window.game, a), [fn.toString(), arg]);
const ward = () => api((g) => g.ward());
let shotN = 0;
const shot = (name) => page.screenshot({ path: join(out, `${String(++shotN).padStart(2, '0')}-${name}.png`), animations: 'disabled' });

console.log('boot the city, in from the title with real keys');
await page.goto(`${url}?debug&region=city`);
await page.waitForFunction(() => window.game?.game?.ready, null, { timeout: 180000 });
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => window.game?.game?.ready, null, { timeout: 180000 });
await page.waitForFunction(() => document.activeElement?.textContent === 'Begin', null, { timeout: 60000 });
await page.keyboard.press('Enter');
await wait(400);
await page.getByRole('button', { name: 'Skip tutorial' }).click();
await page.waitForFunction(() => window.game.state() === 'explore', null, { timeout: 8000 });
const O = await api((g) => g.world().origins.city);
const W = (x, z) => [x + O[0], z + O[2]];
const teleport = (x, y, z) => api((g, p) => g.teleport(p), [x + O[0], y + O[1], z + O[2]]);
const pos = () => api((g) => { const p = g.game.player.position; return [p.x, p.y, p.z]; }).then(([x, y, z]) => [x - O[0], y - O[1], z - O[2]]);
await api((g) => { g.god(true); g.camera('top'); });
await wait(500);

// Walks region [x, z] points with real held keys (W north, D east in the
// top-down view, and in third person while facing north), sprinting unless
// `walk`. Stops early when `until` holds.
const KEYS = { n: 'KeyW', s: 'KeyS', e: 'KeyD', w: 'KeyA' };
async function walk(route, { until, walk: slow = false, strip, every = 12, timeout = 25000 } = {}) {
  const held = new Set();
  const hold = async (want) => {
    for (const k of [...held]) if (!want.has(k)) { await page.keyboard.up(k); held.delete(k); }
    for (const k of want) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
  };
  let n = 0, reached = 0, stopped = false;
  outer: for (const [rx, rz] of route) {
    const [tx, tz] = W(rx, rz);
    const t0 = Date.now();
    for (;;) {
      if (until && await until()) { stopped = true; break outer; }
      const [x, , z] = await api((g) => { const p = g.game.player.position; return [p.x, p.y, p.z]; });
      if (strip && n++ % every === 0) await shot(`${strip}-${String(n).padStart(3, '0')}`);
      const dx = tx - x, dz = tz - z, d = Math.hypot(dx, dz);
      if (d < 1.1) { reached++; break; }
      if (Date.now() - t0 > timeout) break outer;
      const want = new Set(slow ? [] : ['ShiftLeft']);
      if (Math.abs(dx) / d > 0.38 || Math.abs(dx) > 0.4) want.add(dx > 0 ? KEYS.e : KEYS.w);
      if (Math.abs(dz) / d > 0.38 || Math.abs(dz) > 0.4) want.add(dz > 0 ? KEYS.s : KEYS.n);
      await hold(want);
      await wait(40);
    }
  }
  await hold(new Set());
  return { reached, all: reached === route.length, stopped };
}
// Moves the real cursor over a world point and clicks: the primary cast in the top-down view.
async function clickAt(x, y, z, button = 'left') {
  for (let i = 0; i < 3; i++) {
    const at = await api((g, p) => { const v = new (g.game.player.position.constructor)(p[0], p[1], p[2]).project(g.game.renderer.camera); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; }, [x, y, z]);
    await page.mouse.move(at[0], at[1]);
    await wait(150);
  }
  await page.mouse.down({ button }); await wait(60); await page.mouse.up({ button });
}
// Ends the fight in hand the quick way, its bodies downed through the debug hook.
const downAll = () => api((g) => { for (const e of g.game.encounters.enemies) if (e.alive) e.hurt(1e6); });
const settle = (ms = 1500) => wait(ms);
const fighting = () => api((g) => g.game.encounters.fighting);
const goal = () => api((g) => g.game.nav.target.value?.title ?? null);
// Far enough away that every fight in the ward is set again, then back.
// A fight just over keeps the next one off for a few seconds (Encounters' cooldown).
async function rearm() {
  await wait(3200);
  await api((g) => g.teleport('courtyard'));
  await wait(400);
  await api((g) => g.teleport('city:plaza'));
  await page.waitForFunction(() => window.game.game.world.isStanding('city'), null, { timeout: 30000 });
  await api((g) => g.camera('top'));
  await wait(400);
}

console.log('\nthe goal thread leads out of the compound, over the pass and into the ward');
{
  await api((g) => { const n = g.game.nav; n.unlocked.value = new Set(['hall', 'ring', 'gate', 'shrine', 'col', 'city-plaza']); });
  await wait(200);
  check(await goal() === 'Walk the back alleys', `with the city reached, the next goal is in the ward ("${await goal()}")`);
}

console.log('\nthe back alley: walk into it and a fight starts there');
{
  await teleport(-16.6, 0.1, 12);
  await wait(500);
  const r = await walk([[-16.6, 5.4], [-34, 5.4]], { until: fighting, strip: 'alley-in-top', every: 10 });
  const w = await ward();
  check(r.stopped && w.current === 'city-alley', `walking down the lane starts the alley fight (${w.current})`);
  check(w.state === 'encounter', `play is in the fight (${w.state})`);
  const banner = await page.evaluate(() => document.querySelector('.banner')?.textContent ?? '');
  check(!banner, `no banner announces it ("${banner}")`);
  check(w.enemies.filter((e) => e.alive).length === 3, `three men close the lane (${w.enemies.map((e) => e.key).join(', ')})`);
  await wait(1800);
  await shot('alley-fight-top');
  // A couple of real casts at the nearest man.
  for (let i = 0; i < 3; i++) {
    const t = await api((g) => { const e = g.game.encounters.enemies.find((x) => x.alive); const c = e.center(); return [c.x, c.y, c.z]; });
    await clickAt(...t);
    await wait(700);
  }
  await shot('alley-cast-top');
  await api((g) => g.camera('third'));
  await wait(900);
  await shot('alley-fight-3p');
  await api((g) => g.camera('top'));
  await downAll();
  await settle(2000);
  const after = await ward();
  check(after.current === null && after.state === 'explore', `the last man down ends it and play goes on (${after.state})`);
  check(after.won.includes('city-alley'), 'the alley fight counts as won');
  check(await goal() !== 'Walk the back alleys', `the goal moves on ("${await goal()}")`);
  await shot('alley-after-top');
  await walk([[-30, 5.4], [-20, 5.4]]);
  check(!(await fighting()), 'walking the lane again starts nothing while the player has not been away');
  await rearm();
  check((await ward()).armed.includes('city-alley'), 'after a trip far off, the alley is set again');
}

console.log('\nwalking off a fight ends it: its men walk off and go');
{
  await teleport(-30, 0.1, 39);
  await wait(500);
  const r = await walk([[-40, 39], [-44, 39]], { until: fighting });
  check(r.stopped && (await ward()).current === 'city-canal', 'the canal walk starts its fight');
  await wait(1500);
  await shot('canal-fight-top');
  await walk([[10, 39], [40, 39]], { timeout: 30000, until: async () => !(await fighting()) });
  const w = await ward();
  check(w.current === null && w.state === 'explore', `past the leash the fight is off (${w.state})`);
  check(w.enemies.every((e) => e.alive), `nobody fell: they walk off (${w.enemies.map((e) => `${e.key}${e.running ? ' running' : ''}`).join(', ')})`);
  await wait(9000);
  check((await ward()).enemies.length === 0, `and are gone a few seconds later (${(await ward()).enemies.length} left)`);
  check(!(await ward()).won.includes('city-canal'), 'walking off is not a win');
}

console.log('\nthe officer whistles at a Technique cast he can see, walks over and watches');
{
  await api((g) => g.audioClear());
  await teleport(-10, 0.1, -22);
  await wait(4000);
  const before = (await ward()).officer;
  check(before && (before.mode === 'patrol' || before.mode === 'return'), `he walks his beat (${before?.mode})`);
  const [px, , pz] = await pos();
  await clickAt(px + O[0] + 3, O[1] + 1, pz + O[2] - 2);
  await wait(400);
  const seen = await ward();
  check(seen.casts > 0 && ['whistle', 'approach'].includes(seen.officer.mode), `the cast stops him (${seen.officer.mode})`);
  const heard = await api((g) => g.audio().log.some((e) => e.cue === 'city.whistle'));
  check(heard, 'his whistle sounds');
  await shot('officer-whistle-top');
  await page.waitForFunction(() => window.game.ward().officer?.mode === 'watch', null, { timeout: 15000 }).catch(() => {});
  const w = await ward();
  const d = Math.hypot(w.officer.at[0] - (px + O[0]), w.officer.at[2] - (pz + O[2]));
  check(w.officer.mode === 'watch' && d < 5, `he comes over and stands watching (${w.officer.mode}, ${d.toFixed(1)} m off)`);
  await shot('officer-watch-top');
  await api((g) => g.camera('third'));
  await wait(800);
  await shot('officer-watch-3p');
  await api((g) => g.camera('top'));
  await walk([[-30, -16], [-50, -16]], { timeout: 20000 });
  await page.waitForFunction(() => ['return', 'patrol'].includes(window.game.ward().officer?.mode), null, { timeout: 15000 }).catch(() => {});
  check(['return', 'patrol'].includes((await ward()).officer.mode), `once the player walks off his beat he goes back to it (${(await ward()).officer.mode})`);
}

console.log('\na street fight brought into his sight breaks up');
{
  await rearm();
  await teleport(-16.6, 0.1, 8);
  await wait(500);
  await walk([[-16.6, 5.4], [-30, 5.4]], { until: fighting });
  check((await ward()).current === 'city-alley', 'the alley fight starts');
  await wait(800);
  // Up the back street toward the station street, where his beat ends.
  await walk([[-16.6, 5.4], [-16.6, -15.5], [-12, -16]], { timeout: 25000, until: async () => !(await fighting()) });
  await page.waitForFunction(() => !window.game.game.encounters.fighting, null, { timeout: 20000 }).catch(() => {});
  const w = await ward();
  check(w.current === null, `the officer reaches it and it breaks up (${w.current ?? 'over'}, he is ${w.officer.mode})`);
  check(w.enemies.every((e) => e.alive), 'nobody fell: they walked off');
  await shot('officer-breaks-up-top');
}

console.log('\nthe Kuroda gate: its men follow the player in; pushed on, the Enforcer comes out');
{
  await wait(3200);
  await teleport(14.5, 0.1, 4.5);
  await wait(500);
  check(!(await ward()).gateEmpty, 'two men stand at the gate');
  await shot('kuroda-gate-top');
  await walk([[24, 4.5]], { until: fighting });
  const w = await ward();
  check(w.current === 'kuroda-yard' && w.gateEmpty, `through the gate, the yard fight starts and the gate stands empty (${w.current}, at ${(await pos()).map((v) => v.toFixed(1))}, ${w.state}, armed ${w.armed}, cam ${await api((g) => g.game.cam.mode)}, ${await api((g) => JSON.stringify({ s: g.game.inScene, c: g.game.cutscenes.active, d: g.game.drills.running, r: g.game.rooftop.active, n: !!g.game.net, cd: g.game.encounters.cooldown, dist: g.game.encounters.def("kuroda-yard").where.distanceTo(g.game.player.position), st: g.state(), log: g.ward().log.slice(-5) }))})`);
  check(w.enemies.filter((e) => e.key === 'hand').length === 3, 'three of the house\'s hands');
  await wait(1500);
  await shot('kuroda-yard-top');
  await downAll();
  await settle(3500);
  check((await ward()).current === null, 'the yard is won');
  await walk([[33, 4]], { until: fighting });
  const h = await ward();
  check(h.current === 'kuroda-house' && h.enemies.some((e) => e.key === 'kuroda'), `pushing on to the warehouse brings the Enforcer out (${h.current})`);
  await wait(2500);
  await shot('kuroda-house-top');
  await api((g) => g.camera('third'));
  await wait(800);
  await shot('kuroda-house-3p');
  await api((g) => g.camera('top'));
  // The last of them falls to a Maximum Output's blow.
  await api((g) => { const G = g.game; for (const e of G.encounters.enemies) if (e.alive && e.key !== 'kuroda') e.hurt(1e6); const k = G.encounters.enemies.find((e) => e.key === 'kuroda'); k.hp = 5; k.castCd = 99; G.techniques.charge = 1; });
  const k = await api((g) => { const c = g.game.encounters.enemies.find((e) => e.key === 'kuroda').center(); return [c.x, c.y, c.z]; });
  for (let i = 0; i < 3; i++) {
    const at = await api((g, p) => { const v = new (g.game.player.position.constructor)(...p).project(g.game.renderer.camera); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; }, k);
    await page.mouse.move(at[0], at[1]);
    await wait(120);
  }
  await page.keyboard.press('KeyQ');
  await wait(300);
  const inCut = await api((g) => g.state());
  await page.waitForFunction(() => !window.game.game.cutscenes.active, null, { timeout: 12000 }).catch(() => {});
  await settle(800);
  const after = await ward();
  check(inCut === 'cinematic' && after.current === null && after.state === 'explore', `a fight won inside the Maximum Output hands back to play (${inCut} -> ${after.state})`);
  check(after.won.includes('kuroda-house'), 'the house counts as won');
}

console.log('\na fight in the ward ends cleanly when the ward streams out');
{
  await rearm();
  await teleport(14.5, 0.1, 4.5);
  await wait(400);
  await walk([[24, 4.5]], { until: fighting });
  check(await fighting(), 'the yard fight is on');
  await api((g) => g.teleport('courtyard'));
  await page.waitForFunction(() => !window.game.game.world.isStanding('city'), null, { timeout: 20000 }).catch(() => {});
  await wait(300);
  const w = await ward();
  check(w.current === null && w.state === 'explore' && w.enemies.length === 0, `with the ward gone the fight is over and nothing of it is left (${w.state}, ${w.enemies.length} bodies)`);
  check(await api((g) => !g.game.world.isStanding('city')), 'the ward has been taken down');
  await api((g) => g.teleport('city:plaza'));
  await page.waitForFunction(() => window.game.game.world.isStanding('city'), null, { timeout: 30000 });
  await wait(3200);
}

console.log('\nthe east roofs: a man bolts, and gets away if nobody stops him');
{
  await teleport(17, 7.2, -14);
  await wait(500);
  let maxGap = false;
  await walk([[17, -11], [12, -11]], { until: fighting });
  check((await ward()).current === 'city-roofs', 'coming onto the roofs sets him running');
  await wait(600);
  await shot('roofs-bolt-top');
  const t0 = Date.now();
  while (Date.now() - t0 > -1 && Date.now() - t0 < 30000) {
    const w = await ward();
    const r = w.enemies.find((e) => e.key === 'runner');
    if (r && r.at[1] - O[1] > 5.5 && r.at[2] - O[2] > 2.6 && r.at[0] - O[0] < 14) maxGap = true;
    if (!w.current) break;
    await wait(80);
  }
  const w = await ward();
  check(maxGap, 'he jumps the cross alley on the roofs');
  check(w.current === null && !w.won.includes('city-roofs'), `he gets away down the main road, and nothing is won (${w.current})`);
  check(w.enemies.length === 0, 'and is gone');
  await rearm();
  await teleport(17, 7.2, -14);
  await wait(500);
  await walk([[17, -11], [12, -11]], { until: fighting });
  await wait(700);
  // A hold stops him: Rime's freeze as the Technique's own rule applies it.
  await api((g) => { const r = g.game.encounters.enemies.find((e) => e.key === 'runner'); r.freeze(1.5); });
  await wait(300);
  const held = await ward();
  check(held.enemies.some((e) => e.key === 'runner' && !e.running), 'held, he stops running');
  await wait(2500);
  const fought = await ward();
  check(fought.current === 'city-roofs', 'and turns to fight');
  await shot('roofs-caught-top');
  await downAll();
  await settle(1500);
  check((await ward()).won.includes('city-roofs'), 'downed, the roofs count as won');
}

console.log('\nno fight starts in the middle of a cutscene or another scene');
{
  await rearm();
  await teleport(-16.6, 0.1, 5.4);
  await wait(300);
  await api((g) => { g.technique('recoil'); g.cutscene('max-recoil'); });
  await wait(100);
  await teleport(-27, 0.1, 5.4);
  await wait(800);
  check(!(await fighting()), 'walking into the alley during a cutscene starts nothing');
  await page.waitForFunction(() => !window.game.game.cutscenes.active, null, { timeout: 12000 }).catch(() => {});
  // The lane may have started its fight once the cutscene was over: win it, and set the lane again.
  await downAll();
  await rearm();
  await teleport(-16.6, 0.1, 5.4);
  await api((g) => g.drill('striking-posts'));
  await wait(300);
  const drill = await api((g) => g.state());
  // Frame by frame: the frame the player stands in the lane with the drill still running starts nothing.
  // (Walking off a drill's ground ends the drill; the lane may start its fight after that.)
  const during = await api((g) => { const o = g.world().origins.city; g.loop(false); g.teleport([o[0] - 27, o[1] + 0.1, o[2] + 5.4]); g.step(1); const r = { drill: g.game.drills.running, fighting: g.game.encounters.fighting }; g.loop(true); return r; });
  check(drill === 'drill' && !during.fighting, `no fight starts in the middle of a drill (${drill}, drill ${during.drill}, fighting ${during.fighting})`);
  await api((g) => g.quitDrill());
}

const pageErrors = await api((g) => g.errors);
check(errors.length + pageErrors.length === 0, `no errors${errors.length + pageErrors.length ? `: ${[...errors, ...pageErrors].slice(0, 4).join(' | ')}` : ''}`);
await browser.close();
stop();
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
process.exit(failures.length ? 1 : 0);
