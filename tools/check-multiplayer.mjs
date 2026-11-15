#!/usr/bin/env node
// Two browsers in one online room (issue #44), driven with real keys, clicks
// and the join form:
//   both join through the title's room link and see each other;
//   each sees the other walk and stop within a few centimetres of where the
//   walker's own game put it, and the drawn body never jumps between frames;
//   one Ability from A damages B exactly once, by the amount A sent, and both
//   screens agree on B's health;
//   A downs B; both see the down and the score, then the respawn;
//   A and B open their fields with F and clash, picking with their keys;
//   the server decides it, and A's, B's and a third player C's screens play
//   the same steps and winner; C keeps walking the whole time; the loser's
//   field collapses and nobody loses health; then C leaves mid-clash with A
//   and A wins it by forfeit;
//   the server restarts and both rejoin on their own (local server only);
//   B leaves and disappears from A's screen.
// It saves both screens at the hit, the down and the clash for review.
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

// A tab that can go to the background the way Chrome sends it there: the
// page reads hidden, animation frames stop (so the game loop stops), and
// timers fire at most once a second. Headless Chrome never hides a tab on
// its own, so the page is told before any of its scripts run.
const BACKGROUND_TAB = () => {
  let hidden = false;
  const raf = window.requestAnimationFrame.bind(window);
  const waiting = [];
  window.requestAnimationFrame = (cb) => { if (hidden) { waiting.push(cb); return 0; } return raf(cb); };
  Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
  Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => hidden });
  const st = window.setTimeout.bind(window), si = window.setInterval.bind(window);
  window.setTimeout = (fn, ms = 0, ...a) => {
    const at = performance.now();
    const fire = () => { const left = 1000 - (performance.now() - at); if (hidden && left > 0) st(fire, left); else if (typeof fn === 'function') fn(...a); };
    return st(fire, ms);
  };
  window.setInterval = (fn, ms = 0, ...a) => {
    let last = 0;
    return si(() => { const now = performance.now(); if (hidden && now - last < 1000) return; last = now; if (typeof fn === 'function') fn(...a); }, ms);
  };
  window.__tab = {
    hide() { hidden = true; document.dispatchEvent(new Event('visibilitychange')); },
    show() { hidden = false; document.dispatchEvent(new Event('visibilitychange')); for (const cb of waiting.splice(0)) raf(cb); },
  };
};

async function player(name, tech) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 600 } });
  const page = await ctx.newPage();
  await page.addInitScript(BACKGROUND_TAB);
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
  const { id, pos: from } = await walker.net();
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
  // Against the walker's own travel, not a fixed distance: a prop in the way
  // shortens the walk without saying anything about the sync.
  const travel = dist(from, truth);
  check(travel > 1.5 && moved > travel * 0.85, `${label}: the watcher saw the walker cover ground (${moved.toFixed(1)} of ${travel.toFixed(1)} m)`);
  check(seen && dist(seen, truth) < 0.1, `${label}: drawn within 10 cm of the true position once stopped (${seen ? (dist(seen, truth) * 100).toFixed(1) : '?'} cm)`);
  check(jump < 0.35, `${label}: no frame-to-frame jump (largest step ${(jump * 100).toFixed(0)} cm at running speed)`);
  return steps;
}
console.log('\nan Eye is seen on its bearer');
{
  await A.api((g) => g.eye('horizon'));
  const markOf = (p, id) => p.api((g, id) => g.game.net.remotes.get(id)?.eyeMark.id ?? null, id);
  let seen = null;
  for (let t0 = Date.now(); Date.now() - t0 < 3000 * slack && seen !== 'horizon'; await wait(100)) seen = await markOf(B, idA);
  check(seen === 'horizon', `B draws the mark of A's Horizon Eye on A (${seen})`);
  check((await markOf(A, idB)) === null, 'A draws no mark on B, who carries no Eye');
  await A.api((g) => g.eye(null));
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
// The cast's sound came over the effects wire and played on B's screen where A stands.
const heardCues = await B.api((g) => g.audio().log.filter((e) => e.cue.startsWith('recoil.') && e.at));
check(heardCues.some((e) => e.cue === 'recoil.cast' && Math.hypot(e.at[0] + 3, e.at[2] - 5.4) < 1.5), `B heard A's cast placed at A (${heardCues.map((e) => `${e.cue} at ${e.at.map((x) => x.toFixed(1)).join(',')}`).join('; ') || 'nothing'})`);

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

console.log('\nprops, breakage and the ice floor are one simulation');
// Both stand by the crates in the east of the courtyard. Each prop's pose is
// read on both screens straight from its physics body.
await A.api((g) => { g.camera('top'); g.teleport([12, 0, 0]); });
await B.api((g) => { g.camera('top'); g.teleport([12, 0, 5]); });
await wait(800 * slack);
const poses = (p) => p.api((g) => Object.fromEntries(g.game.props.instances.map((q) => { const t = q.body.translation(), r = q.body.rotation(); return [q.id, [t.x, t.y, t.z, r.x, r.y, r.z, r.w]]; })));
const propsView = (p) => p.api((g) => g.game.net.props.view());
const propNear = (p, at) => p.api((g, at) => {
  const near = (x) => Math.hypot(x.mesh.position.x - at[0], x.mesh.position.z - at[1]);
  const q = g.game.props.instances.filter((x) => x.def.breakable).sort((x, y) => near(x) - near(y))[0];
  return q ? { id: q.id, hp: q.def.breakable.hp } : null;
}, at);
const apart = (a, b) => (a && b ? Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) : Infinity);
// The angle between the two screens' rotations of a prop, in radians.
const turn = (a, b) => (a && b ? 2 * Math.acos(Math.min(1, Math.abs(a[3] * b[3] + a[4] * b[4] + a[5] * b[5] + a[6] * b[6]))) : Infinity);
{
  const [pa, pb] = await Promise.all([poses(A), poses(B)]);
  const ids = Object.keys(pa);
  const off = ids.filter((id) => apart(pa[id], pb[id]) > 0.05);
  check(ids.length > 10 && ids.length === Object.keys(pb).length && !off.length, `the two screens start with the same ${ids.length} props in the same places${off.length ? ` (${off.length} differ)` : ''}`);
}
// A push through the same call every Technique uses.
const shove = (p, id, impulse) => p.api((g, id, imp) => { const q = g.game.props.byId(id); g.game.props.push(q, new q.mesh.position.constructor(...imp).multiplyScalar(q.def.mass)); }, id, impulse);
// Waits until nobody is moving any prop, then compares one prop on both screens.
async function settled(id, label) {
  const t1 = Date.now();
  let pa, pb;
  for (;;) {
    await wait(300);
    const [va, vb] = await Promise.all([propsView(A), propsView(B)]);
    [pa, pb] = await Promise.all([poses(A), poses(B)]);
    const busy = va.mine.length + va.following.length + vb.mine.length + vb.following.length;
    if ((!busy && apart(pa[id], pb[id]) < 0.03) || Date.now() - t1 > 6000 * slack) break;
  }
  check(apart(pa[id], pb[id]) < 0.05 && turn(pa[id], pb[id]) < 0.05, `${label}: at rest in the same place on both screens (${(apart(pa[id], pb[id]) * 100).toFixed(1)} cm, ${(turn(pa[id], pb[id]) * 57.3).toFixed(1)} degrees apart)`);
  return pa[id];
}
// A shoves a crate east. While it slides, B follows A's simulation of it.
const crate = await propNear(A, [15.2, 1.8]);
const start = (await poses(A))[crate.id];
await shove(A, crate.id, [7, 2.5, 1]);
await wait(250 + latency * 2);
check((await propsView(B)).following.includes(crate.id), "while A's crate slides, B's screen follows A's simulation of it");
const rest1 = await settled(crate.id, 'A shoves a crate');
check(apart(start, rest1) > 1, `and it moved (${apart(start, rest1).toFixed(1)} m)`);
// B shoves the same crate back: it becomes B's to move.
await shove(B, crate.id, [-6, 2, 0.5]);
await wait(250 + latency * 2);
check((await propsView(A)).following.includes(crate.id), "B shoves it back: now A's screen follows B's");
const rest2 = await settled(crate.id, 'B shoves it back');
check(apart(rest1, rest2) > 1, `and it moved again (${apart(rest1, rest2).toFixed(1)} m)`);

// A crate takes blows from both players: the server adds them up, and it
// breaks once, on both screens, when they reach its health.
const box = await propNear(A, [16.4, 2.0]);
const alive = (p, id) => p.api((g, id) => !!g.game.props.byId(id), id);
const blow = (p, id, n) => p.api((g, id, n) => g.game.net.props.hit(g.game.props.byId(id), n), id, n);
await blow(A, box.id, box.hp * 0.6);
await wait(400 + latency * 2);
check(await alive(A, box.id) && await alive(B, box.id), 'a blow for 60% of a crate\'s health leaves it whole on both screens');
await blow(B, box.id, box.hp * 0.6);
const t2 = Date.now();
while (Date.now() - t2 < 3000 * slack && (await alive(A, box.id) || await alive(B, box.id))) await wait(80);
const breaks = await Promise.all([A, B].map((p) => p.api((g, id) => g.game.net.props.broken.filter((x) => x === id).length, box.id)));
check(!(await alive(A, box.id)) && !(await alive(B, box.id)) && breaks[0] === 1 && breaks[1] === 1, `B's blow on top of A's breaks it, once on each screen (${breaks.join(', ')} breaks heard)`);

// B freezes the koi pond with Cold Stitch: the ice is a floor on A's screen too.
const pondFloor = (p) => p.api((g) => {
  const G = g.game, c = G.world.pond.center;
  const hit = G.physics.castRay(new c.constructor(c.x + 0.5, 3, c.z + 0.5), new c.constructor(0, -1, 0), 10);
  return { y: hit ? hit.point.y : null, surface: G.world.pond.surfaceY };
});
const dry = await pondFloor(A);
await B.api((g) => {
  g.teleport('pond'); g.camera('third'); g.step(2);
  const G = g.game, p = G.player.eye(), c = G.world.pond.center;
  g.look(Math.atan2(-(c.x - p.x), -(c.z - p.z)), Math.atan2(G.world.pond.surfaceY - p.y, Math.hypot(c.x - p.x, c.z - p.z)));
  G.techniques.resource = G.techniques.def.resource.max;
  g.cast('secondary');
});
const t3 = Date.now();
let iced = dry;
while (Date.now() - t3 < 3000 * slack) { iced = await pondFloor(A); if (iced.y !== null && iced.y > dry.surface - 0.05) break; await wait(100); }
check(dry.y !== null && dry.y < dry.surface - 0.2 && iced.y > dry.surface - 0.05, `B's Cold Stitch freezes the pond into a floor on A's screen too (floor at ${dry.y?.toFixed(2)} m, then ${iced.y?.toFixed(2)} m; water at ${dry.surface.toFixed(2)} m)`);
await B.api((g) => { g.camera('top'); g.teleport([12, 0, 5]); });

console.log("\nanother player's tab goes to the background");
// B shoves a crate and hides its tab while the crate is still in the air.
// B stops sending; A sees B as away; A's screen takes over the crate and
// brings it down; A hits B, and the hit lands once though B's game loop is
// stopped. Then B comes back and both screens agree again.
await wait(600 * slack);
const flier = await propNear(B, [15.8, 3.1]);
await shove(B, flier.id, [1.5, 7, 0]);
await wait(150 + latency * 2);
await B.page.evaluate(() => window.__tab.hide());
check(await B.page.evaluate(() => document.visibilityState === 'hidden'), "B's tab reads hidden");
// A frame already asked for before the tab hid may still run; none after it.
await wait(100);
const clockHidden = await B.api((g) => g.game.clock.time);
const isAway = () => A.api((g, id) => !!g.game.net.remotes.get(id)?.away, idB);
const tAway = Date.now();
while (Date.now() - tAway < 4000 * slack && !(await isAway())) await wait(100);
check(await isAway(), `A sees B as away ${((Date.now() - tAway) / 1000).toFixed(1)} s after B's tab hid`);
await wait(2500 * slack);
const fallen = await A.api((g, id) => { const q = g.game.props.byId(id); return { y: q.body.translation().y, half: q.half.y, followed: g.game.net.props.view().following.includes(id), dynamic: q.body.bodyType() === 0 }; }, flier.id);
check(!fallen.followed && fallen.dynamic && fallen.y < fallen.half + 0.3, `A's screen takes over the crate B was moving, and it comes down (${fallen.y.toFixed(2)} m, ${fallen.followed ? "still following B's stream" : 'simulated here'})`);
// A steps up to where B stands, frozen in the background, and swings once.
const hpHidden = (await B.net()).hp;
const bAt = remoteOf(await A.net(), idB).drawn;
await A.api((g, at) => { g.camera('third'); g.teleport([at[0], 0, at[2] + 1.4]); g.look(0, -0.05); g.game.techniques.resource = g.game.techniques.def.resource.max; }, bAt);
await wait(900 * slack);
const sentHidden = (await A.net()).sent.length;
await A.page.mouse.move(480, 300);
await A.page.mouse.down(); await A.page.mouse.up();
let bHidden = await until(B, (v) => v.hp < hpHidden, 4000 * slack);
await wait(1000 * slack);
a = await A.net(); bHidden = await B.net();
const sentToB = a.sent.slice(sentHidden).filter((x) => x.target === idB);
check(sentToB.length === 1, `A's blow on the hidden B was sent once (${sentToB.length})`);
check(bHidden.hp < hpHidden && Math.abs(remoteOf(a, idB).hp - bHidden.hp) < 0.11, `it landed while B's game was stopped (${hpHidden} to ${bHidden.hp.toFixed(1)}), and A's screen agrees`);
check(await B.api((g) => g.game.clock.time) === clockHidden, "B's game loop did not run while hidden");
await B.page.evaluate(() => window.__tab.show());
await A.api((g) => g.camera('top'));
const tBack = Date.now();
while (Date.now() - tBack < 4000 * slack && await isAway()) await wait(100);
check(!(await isAway()), "B is back for A once B's tab shows again");
check(await B.api((g) => g.game.clock.time) > clockHidden, "B's game runs again");
await walk(B, A, 'KeyA', 'B walks again after the background, A watches');
await walk(A, B, 'KeyD', 'A walks, B watches after the background');
{
  b = await B.net(); a = await A.net();
  check(Math.abs(b.hp - remoteOf(a, idB).hp) < 0.11, `B's health reads the same on both screens after (${b.hp.toFixed(1)})`);
  const [pa, pb] = await Promise.all([poses(A), poses(B)]);
  const off = Object.keys(pa).filter((id) => apart(pa[id], pb[id]) > 0.05);
  check(!off.length && apart(pa[flier.id], pb[flier.id]) < 0.05, `every prop agrees after B's background, the crate A took over too (${(apart(pa[flier.id], pb[flier.id]) * 100).toFixed(1)} cm)${off.length ? `; ${off.join(', ')} differ` : ''}`);
}

// After a while Chrome freezes a background tab outright: no scripts at
// all, not even the socket. A blow on a frozen B still lands, at A's
// amount, when B does not answer in time.
const cdpB = await B.ctx.newCDPSession(B.page);
const bAt2 = remoteOf(await A.net(), idB).drawn;
await A.api((g, at) => { g.camera('third'); g.teleport([at[0], 0, at[2] + 1.4]); g.look(0, -0.05); g.game.techniques.resource = g.game.techniques.def.resource.max; }, bAt2);
await wait(900 * slack);
await cdpB.send('Page.setWebLifecycleState', { state: 'frozen' });
const hpFrozen = remoteOf(await A.net(), idB).hp;
const sentFrozen = (await A.net()).sent.length;
await A.page.mouse.down(); await A.page.mouse.up();
await wait(2600 * slack);
a = await A.net();
const frozenHit = a.sent.slice(sentFrozen).filter((x) => x.target === idB);
check(frozenHit.length === 1 && remoteOf(a, idB).hp < hpFrozen, `a blow on a frozen B lands once without B's answer (${hpFrozen} to ${remoteOf(a, idB).hp.toFixed(1)})`);
await cdpB.send('Page.setWebLifecycleState', { state: 'active' });
b = await until(B, (v) => Math.abs(v.hp - remoteOf(a, idB).hp) < 0.11, 3000 * slack);
check(Math.abs(b.hp - remoteOf(a, idB).hp) < 0.11, `B wakes with the health the room gave it (${b.hp.toFixed(1)})`);
await A.api((g) => g.camera('top'));
await until(B, (v) => !v.downed, 7000 * slack);

console.log('\nan Aura Clash between A and B, while C walks past');
// C joins for this part only. A and B open their fields with F six metres
// apart, so the fields touch and the server starts a clash. A pushes and B
// holds every exchange: A should take it two to none on every screen.
const C = await player('Chiyo', 'echo');
const idC = (await C.net()).id;
await until(A, (v) => remoteOf(v, idC)?.drawn);
await A.api((g) => { g.camera('top'); g.teleport([-3, 0, 6]); });
await B.api((g) => { g.camera('top'); g.teleport([3, 0, 6]); });
await C.api((g) => { g.camera('top'); g.teleport([-1, 0, 11.5]); });
await wait(1200 * slack);
const auraOf = (p) => p.api((g) => g.aura());
const hpA0 = (await A.net()).hp, hpB0 = (await B.net()).hp;
await A.page.keyboard.press('KeyF');
await B.page.keyboard.press('KeyF');
const inClash = async (p) => { const t0 = Date.now(); while (Date.now() - t0 < 4000 * slack) { if ((await auraOf(p)).clash.stage !== null) return true; await wait(40); } return false; };
check(await inClash(A) && await inClash(B), 'two open fields that touch start a clash on both screens');
check((await auraOf(C)).clash.stage === null, 'C is not in it');
// C walks east for as long as the two are locked.
const c0 = (await C.net()).pos;
await C.page.keyboard.down('KeyD');
const picked = { A: 0, B: 0 };
const t0 = Date.now();
let cDown = true, shotC = false, shotAB = false, walked = 0;
while (Date.now() - t0 < 12000 * slack) {
  const [va, vb] = await Promise.all([auraOf(A), auraOf(B)]);
  if (va.clash.stage === null && vb.clash.stage === null) break;
  if (cDown && (va.clash.stage === null || va.clash.stage === 'over')) { await C.page.keyboard.up('KeyD'); cDown = false; walked = Date.now() - t0; }
  if (!shotAB && va.clash.view?.stage === 'choose' && vb.clash.view?.stage === 'choose') { await Promise.all([shot(A, 'clash'), shot(B, 'clash')]); shotAB = true; }
  if (va.clash.view?.stage === 'choose' && !va.clash.view.mine) { await A.page.keyboard.press('KeyW'); picked.A++; }
  if (vb.clash.view?.stage === 'choose' && !vb.clash.view.mine) { await B.page.keyboard.press('KeyS'); picked.B++; }
  if (!shotC && va.clash.view?.stage === 'reveal') { await shot(C, 'clash-watched'); shotC = true; }
  await wait(30);
}
if (cDown) await C.page.keyboard.up('KeyD');
const c1 = (await C.net()).pos;
check(dist(c0, c1) > 2 && (await C.api((g) => g.game.input.enabled)), `C kept walking through the clash, ${dist(c0, c1).toFixed(1)} m in ${(walked / 1000).toFixed(1)} s, not frozen`);
await wait(400 * slack);
const logs = await Promise.all([A, B, C].map((p) => auraOf(p).then((v) => v.clash.log)));
const ends = logs.map((l) => l.filter((x) => x.ev.kind === 'end'));
const end = ends[0][0];
const winnerId = end ? (end.ev.winner === 0 ? end.a : end.ev.winner === 1 ? end.b : null) : undefined;
check(picked.A >= 2 && picked.B >= 2, `both picked with their keys (${picked.A} and ${picked.B} picks)`);
check(winnerId === idA && end.ev.reason === 'rounds', `A takes it (${JSON.stringify(end?.ev)})`);
check(JSON.stringify(logs[0]) === JSON.stringify(logs[1]), `A's and B's screens played the same ${logs[0].length} clash steps`);
check(JSON.stringify(logs[2]) === JSON.stringify(logs[0]), "C's screen heard the same clash");
const [fa, fb] = await Promise.all([auraOf(A), auraOf(B)]);
check(fa.state === 'open' && fb.state === 'recovering' && fb.ended === 'collapsed', `A's field holds, B's collapsed (${fa.state}; ${fb.state}, ${fb.ended})`);
check(fb.guardBroken > 0, "B's guard is broken");
a = await A.net(); b = await B.net();
check(a.hp === hpA0 && b.hp === hpB0, `nobody lost health in the clash (A ${hpA0} to ${a.hp}, B ${hpB0} to ${b.hp})`);
check(Math.abs(remoteOf(a, idB).hp - b.hp) < 0.11, "A's screen agrees on B's health");

console.log('\na player who leaves mid-clash loses it');
await A.api((g) => { if (g.game.aura.field.open) g.game.aura.retract(); g.auraReady(); g.teleport([-3, 0, 6]); });
await C.api((g) => { g.auraReady(); g.teleport([2, 0, 6]); });
await B.api((g) => g.teleport([-3, 0, 14]));
await wait(1000 * slack);
await A.page.keyboard.press('KeyF');
await C.page.keyboard.press('KeyF');
check(await inClash(A), 'A and C clash');
await C.ctx.close();
const forfeit = async () => { const t1 = Date.now(); while (Date.now() - t1 < 4000 * slack) { const l = (await auraOf(A)).clash.log; const e = l.filter((x) => x.ev.kind === 'end' && (x.a === idC || x.b === idC)).at(-1); if (e) return e; await wait(50); } return null; };
const left = await forfeit();
check(left && left.ev.reason === 'forfeit' && (left.ev.winner === 0 ? left.a : left.b) === idA, `C's leaving hands A the clash (${JSON.stringify(left?.ev)})`);
const lb = (await auraOf(B)).clash.log.filter((x) => x.ev.kind === 'end').at(-1);
check(lb && lb.ev.reason === 'forfeit', 'B, watching, hears the forfeit');
await wait(1200);
check((await auraOf(A)).clash.stage === null && (await auraOf(A)).state === 'open', "A is released, field still open");

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
