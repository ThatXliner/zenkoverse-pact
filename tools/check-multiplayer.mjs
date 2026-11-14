#!/usr/bin/env node
// Two browsers in one online room (issue #44), driven with real keys, clicks
// and the join form:
//   both join through the title's room link and see each other;
//   each sees the other walk and stop within a few centimetres of where the
//   walker's own game put it, and the drawn body never jumps between frames;
//   one Ability from A damages B exactly once, by the amount A sent, and both
//   screens agree on B's health;
//   A downs B; both see the down and the score, then the respawn;
//   the server restarts and both rejoin on their own (local server only);
//   B leaves and disappears from A's screen.
// It saves both screens at the hit and at the down for review.
// Usage: node tools/check-multiplayer.mjs [url] [--latency 120] [--out captures/multiplayer] [--port 4181]
// Without a URL it serves dist/ through server/index.mjs (run `npm run build`
// first); --latency delays every realtime message in each direction.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveTarget } from './lib/target.mjs';

const { url, args, stop, restart } = await resolveTarget(process.argv.slice(2), { realtime: true });
const latency = Number(args.latency ?? 0);
const out = args.out ?? `captures/multiplayer${latency ? `-${latency}ms` : ''}`;
mkdirSync(out, { recursive: true });
const room = `check-${Date.now().toString(36)}`;
const slack = 1 + latency / 100;

const failures = [];
const errors = [];
const check = (ok, what) => { if (!ok) failures.push(what); console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); return ok; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });

async function player(name, tech) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 600 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|WebGL|GPU stall|Automatic fallback|WebSocket/.test(m.text())) errors.push(`${name} console: ${m.text()}`); });
  await page.goto(`${url}?debug&room=${room}`);
  await page.waitForFunction(() => window.game?.game?.ready, null, { timeout: 180000 });
  // The room link opens the Technique screen with the join form.
  await page.locator('.card').filter({ has: page.locator('h3', { hasText: new RegExp(`^${tech}$`, 'i') }) }).click();
  await page.locator('input[name=name]').fill(name);
  await page.locator('[data-join]').click();
  await page.waitForFunction(() => window.game.net()?.status === 'online', null, { timeout: 15000 });
  const api = (fn, ...a) => page.evaluate(([f, ...rest]) => new Function('g', 'a', `return (${f})(g, ...a)`)(window.game, rest), [fn.toString(), ...a]);
  return { name, ctx, page, api, net: () => api((g) => g.net()) };
}

const remoteOf = (view, id) => view.remotes.find((r) => r.id === id);
// Waits on a condition over the room as one page sees it.
async function until(p, test, ms = 4000 * slack) {
  const t0 = Date.now();
  for (;;) {
    const v = await p.net();
    if (test(v)) return v;
    if (Date.now() - t0 > ms) return v;
    await wait(50);
  }
}
const shot = (p, label) => p.page.screenshot({ path: join(out, `${label}-${p.name.toLowerCase()}.png`) });

console.log(`room ${room} at ${url}${latency ? ` with ${latency} ms added each way` : ''}`);
const A = await player('Akane', 'recoil');
const B = await player('Bo', 'rime');
const idA = (await A.net()).id, idB = (await B.net()).id;

console.log('\njoin');
let a = await until(A, (v) => remoteOf(v, idB)?.drawn);
let b = await until(B, (v) => remoteOf(v, idA)?.drawn);
check(remoteOf(a, idB)?.name === 'Bo' && remoteOf(a, idB)?.visible, 'A sees B by name');
check(remoteOf(b, idA)?.name === 'Akane' && remoteOf(b, idA)?.visible, 'B sees A by name');
check(new URL(A.page.url()).searchParams.get('room') === room, 'the address bar carries the room code to share');

// Side by side in the courtyard, both in the top-down view.
await A.api((g) => { g.camera('top'); g.teleport([-4, 0, 6]); });
await B.api((g) => { g.camera('top'); g.teleport([-1, 0, 6]); });
await wait(800 * slack);

// One player walks for a second and stops; the other's drawing of them is
// sampled every frame meanwhile.
async function walk(walker, watcher, key, label) {
  const id = (await walker.net()).id;
  const sampling = watcher.page.evaluate(async (id) => {
    const steps = [];
    let last = null;
    const t0 = performance.now();
    while (performance.now() - t0 < 2600) {
      await new Promise((r) => requestAnimationFrame(r));
      const r = window.game.game.net.remotes.get(id);
      const p = r?.drawn ? [r.drawn.x, r.drawn.y, r.drawn.z] : null;
      if (p && last) steps.push(Math.hypot(p[0] - last[0], p[2] - last[2]));
      last = p;
    }
    return steps;
  }, id);
  await walker.page.keyboard.down(key);
  await wait(1100);
  await walker.page.keyboard.up(key);
  const steps = await sampling;
  await wait(500 * slack);
  const truth = (await walker.net()).pos;
  const seen = remoteOf(await watcher.net(), id)?.drawn;
  const moved = steps.reduce((s, x) => s + x, 0);
  const jump = Math.max(...steps);
  check(moved > 3, `${label}: the watcher saw the walker cover ground (${moved.toFixed(1)} m)`);
  check(seen && dist(seen, truth) < 0.1, `${label}: drawn within 10 cm of the true position once stopped (${seen ? (dist(seen, truth) * 100).toFixed(1) : '?'} cm)`);
  check(jump < 0.35, `${label}: no frame-to-frame jump (largest step ${(jump * 100).toFixed(0)} cm at running speed)`);
  return steps;
}
console.log('\nmovement');
await walk(A, B, 'KeyS', 'A walks, B watches');
await walk(B, A, 'KeyW', 'B walks, A watches');

console.log('\nan Ability from A hits B exactly once');
// A faces B from 1.4 m away (Kinetic Release's reach) over the shoulder, Reserve full, and clicks once.
await B.api((g) => g.teleport([-3, 0, 4]));
await A.api((g) => { g.teleport([-3, 0, 5.4]); g.camera('third'); g.look(0, -0.05); g.game.techniques.resource = g.game.techniques.def.resource.max; });
await wait(1600 * slack);
const sentBefore = (await A.net()).sent.length;
const hpLogBefore = (await B.net()).hpLog.length;
const hpBefore = (await B.net()).hp;
await A.page.mouse.move(480, 300);
await A.page.mouse.down(); await A.page.mouse.up();
await wait(260);
await shot(A, 'hit');
await wait(150 + latency);
await shot(B, 'hit');
b = await until(B, (v) => v.hpLog.length > hpLogBefore, 3000 * slack);
await wait(1200 * slack);
a = await A.net(); b = await B.net();
const sent = a.sent.slice(sentBefore).filter((s) => s.target === idB);
const heard = b.hpLog.slice(hpLogBefore).filter((h) => h.id === idB);
check(sent.length === 1, `A's client sent one hit on B (${sent.length})`);
check(heard.length === 1, `the server applied one health change to B (${heard.length})`);
check(heard[0] && sent[0] && Math.abs(heard[0].amount - Math.round(sent[0].amount * 10) / 10) < 0.11, `B lost what A dealt (${sent[0]?.amount.toFixed(1)} sent, ${heard[0]?.amount} applied)`);
check(heard[0]?.by === idA, 'the server credits A');
check(Math.abs(b.hp - (hpBefore - (heard[0]?.amount ?? 0))) < 0.11, `B's own health reads ${b.hp.toFixed(1)}`);
check(Math.abs(remoteOf(a, idB).hp - b.hp) < 0.11, `A's screen agrees on B's health (${remoteOf(a, idB).hp.toFixed(1)})`);

console.log('\nA downs B, then B respawns');
let casts = 0;
for (; casts < 20; casts++) {
  b = await B.net();
  if (b.downed) break;
  // Each blow knocks B back out of reach, so B steps in again first.
  await B.api((g) => g.teleport([-3, 0, 4]));
  await A.api((g) => { g.teleport([-3, 0, 5.4]); g.look(0, -0.05); g.game.techniques.resource = g.game.techniques.def.resource.max; });
  await wait(400 + latency * 2);
  await A.page.mouse.down(); await A.page.mouse.up();
  await wait(900 + latency * 2);
}
b = await until(B, (v) => v.downed, 2000 * slack);
check(b.downed, `B is down after ${casts + 1} casts`);
a = await until(A, (v) => remoteOf(v, idB) && !remoteOf(v, idB).alive, 2000 * slack);
check(!remoteOf(a, idB)?.alive, "A's screen shows B down");
check(await B.page.locator('[data-downed]').isVisible(), 'B sees the downed card');
a = await until(A, (v) => v.me?.kills === 1);
b = await until(B, (v) => v.me?.downs === 1);
check(a.me?.kills === 1 && b.me?.downs === 1, `scoreboard: A 1 down dealt, B downed once (${a.me?.kills}, ${b.me?.downs})`);
check(remoteOf(b, idA)?.kills === 1 && remoteOf(a, idB)?.downs === 1, 'each screen shows the other the same score');
await shot(A, 'down');
await shot(B, 'down');
b = await until(B, (v) => !v.downed, 7000 * slack);
check(!b.downed && b.hp === 100, `B respawns with full health (${b.hp})`);
await wait(900 * slack);
a = await A.net(); b = await B.net();
check(remoteOf(a, idB)?.alive && remoteOf(a, idB)?.hp === 100, "A's screen shows B back up at full health");
check(remoteOf(a, idB)?.drawn && dist(remoteOf(a, idB).drawn, b.pos) < 0.1, `A draws B at the spawn point (${remoteOf(a, idB)?.drawn ? (dist(remoteOf(a, idB).drawn, b.pos) * 100).toFixed(1) : '?'} cm off)`);
check(!(await B.page.locator('[data-downed]').isVisible()), 'the downed card is gone');

console.log('\nhow an Ability reads on the other screen');
// B watches from 6 m south, so A stands clear of B's HUD; A aims at B with the
// cursor and throws Shockline from key 1.
await B.api((g) => { g.teleport([-3, 0, 8]); g.camera('top'); });
await A.api((g) => { g.teleport([-3, 0, 2]); g.camera('top'); g.game.techniques.resource = g.game.techniques.def.resource.max; });
await wait(1500 * slack);
await A.page.mouse.move(480, 560);
await wait(200);
const before = (await B.net()).hp;
await A.page.keyboard.press('Digit1');
// A frame every 120 ms on both screens through the cast; B's run a network delay behind.
for (let i = 1; i <= 6; i++) {
  await wait(120);
  await Promise.all([shot(A, `shockline-${i}`), shot(B, `shockline-${i}`)]);
}
b = await until(B, (v) => v.hp < before, 3000 * slack);
check(b.hp < before, `Shockline from 6 m lands on B (${before} to ${b.hp.toFixed(1)})`);

if (restart) {
  console.log('\nthe server restarts');
  await restart();
  a = await until(A, (v) => v.status === 'online' && remoteOf(v, idB) === undefined && v.remotes.length === 1 && v.remotes[0].drawn, 12000);
  b = await until(B, (v) => v.status === 'online' && v.remotes.length === 1 && v.remotes[0].drawn, 12000);
  check(a.status === 'online' && b.status === 'online', 'both clients reconnect on their own');
  check(a.remotes.length === 1 && b.remotes.length === 1 && a.remotes[0].visible && b.remotes[0].visible, 'and see each other again');
  check(!errors.length, 'no page errors through the restart');
}

console.log('\nB leaves');
const bId = (await B.net()).id;
await B.ctx.close();
a = await until(A, (v) => !remoteOf(v, bId), 3000 * slack);
check(!remoteOf(a, bId), "B is gone from A's screen");

check(!errors.length, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
writeFileSync(join(out, 'report.json'), JSON.stringify({ url, room, latency, failures, errors }, null, 2));
await browser.close();
stop();
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
process.exit(failures.length ? 1 : 0);
