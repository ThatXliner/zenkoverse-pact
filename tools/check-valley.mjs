#!/usr/bin/env node
// Drives the built game out into the valley round the compound with real
// keys, the way a player walks it: out of the gate, a full lap round the
// outside of the walls and back in; then down the road over the red bridge to
// the roadside shrine (the visit counts) and back through the gate. On the
// way it checks the place names, the cutaway behind the north wall, the map's
// valley scale, that the field by the gate is clear and level, and that the
// cliffs hold everyone in (sprinting and jumping at them from every side).
// Last, two players in one online room: one walks out to the field and the
// other sees them there. The `?debug` hooks only read state, move the player
// between legs and set the camera.
// Usage: node tools/check-valley.mjs [url] [--port 4182] [--out captures/valley]
// Without a url it serves dist/ through server/index.mjs (run `npm run build` first).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveTarget } from './lib/target.mjs';

const { url, args, stop } = await resolveTarget(process.argv.slice(2), { realtime: true });
const out = args.out ?? 'captures/valley';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const errors = [];
const failures = [];
const check = (ok, what) => { if (!ok) failures.push(what); console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); return ok; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const watch = (page, name) => {
  page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|WebGL|GPU stall|Automatic fallback|WebSocket/.test(m.text())) errors.push(`${name} console: ${m.text()}`); });
};

const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
watch(page, 'solo');
const api = (fn, arg) => page.evaluate(([src, a]) => (0, eval)(src)(window.game, a), [fn.toString(), arg]);
const pos = () => api((g) => { const p = g.game.player.position; return [p.x, p.y, p.z]; });
const zone = () => api((g) => g.game.world.zoneAt(g.game.player.position)?.id ?? null);
const shot = (name) => page.screenshot({ path: join(out, `${name}.png`), animations: 'disabled' });

// Walks a route of [x, z] points in the top-down view, where W is north
// (up the screen) and D east, sprinting, with real key presses. Returns the
// zones passed through and whether every point was reached.
const KEYS = { n: 'KeyW', s: 'KeyS', e: 'KeyD', w: 'KeyA' };
async function walk(route, { onStep } = {}) {
  const held = new Set();
  const hold = async (want) => {
    for (const k of [...held]) if (!want.has(k)) { await page.keyboard.up(k); held.delete(k); }
    for (const k of want) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
  };
  const zones = new Set();
  let reached = 0, stuck = null;
  for (const [tx, tz] of route) {
    const t0 = Date.now();
    let last = null, still = 0;
    for (;;) {
      const [x, , z] = await pos();
      zones.add(await zone());
      if (onStep) await onStep(x, z);
      const dx = tx - x, dz = tz - z;
      if (Math.hypot(dx, dz) < 1.3) { reached++; break; }
      if (Date.now() - t0 > 40000) { stuck = [tx, tz, x, z, await api((g) => g.state())]; break; }
      if (last && Math.hypot(x - last[0], z - last[1]) < 0.02) { if (++still > 40) { stuck = [tx, tz, x, z, await api((g) => g.state())]; break; } } else still = 0;
      last = [x, z];
      const want = new Set(['ShiftLeft']);
      const len = Math.hypot(dx, dz);
      if (Math.abs(dx) / len > 0.38) want.add(dx > 0 ? KEYS.e : KEYS.w);
      if (Math.abs(dz) / len > 0.38) want.add(dz > 0 ? KEYS.s : KEYS.n);
      await hold(want);
      await wait(50);
    }
    if (stuck) break;
  }
  await hold(new Set());
  return { zones, reached, all: reached === route.length, stuck };
}

console.log('boot, skip the tutorial with real clicks');
await page.goto(`${url}?debug`);
await page.waitForFunction(() => window.game?.game?.ready, null, { timeout: 180000 });
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => window.game?.game?.ready, null, { timeout: 180000 });
await page.getByRole('button', { name: 'Begin', exact: true }).click();
await page.locator('.card', { hasText: 'Recoil' }).click();
await page.getByRole('button', { name: 'Skip tutorial' }).click();
await page.waitForFunction(() => window.game.state() === 'explore', null, { timeout: 8000 });
await api((g) => { g.god(true); g.camera('top'); g.teleport([0, 0, 12]); });
await wait(800);

console.log('out of the gate, round the outside of the walls, back in');
{
  let behindWall = 0;
  const lap = await walk([[0, 17], [0, 24.5], [28.5, 24.5], [28.5, -24.5], [0, -21.5], [-28.5, -24.5], [-28.5, 24.5], [0, 24.5], [0.8, 17], [1.2, 11]], {
    onStep: async (x, z) => {
      if (z < -21 && Math.abs(x) < 10) behindWall = Math.max(behindWall, await api((g) => {
        const m = g.game.world.occluders.filter((o) => o.userData.cutaway === 'wall-n' || o.userData.cutaway === 'hall-back');
        return Math.max(0, ...m.map((o) => 1 - o.material.opacity));
      }));
      if (z < -21 && Math.abs(x) < 1.5 && behindWall > 0.3) await shot('01-behind-the-north-wall');
    },
  });
  check(lap.all, `the lap reaches every corner and comes back in (${lap.reached}/10${lap.stuck ? `, stuck going to ${lap.stuck.slice(0, 2)} at ${lap.stuck.slice(2, 4).map((v) => v.toFixed(1))} in ${lap.stuck[4]}` : ''})`);
  check(lap.zones.has('valley') && lap.zones.has('courtyard') && lap.zones.has('gate'), `the place names change on the way: ${[...lap.zones].join(', ')}`);
  check(behindWall > 0.3, `behind the north wall the wall and the hall's back fade for the top-down camera (faded ${behindWall.toFixed(2)})`);
  check((await zone()) === 'courtyard', 'back in the courtyard');
}

console.log('the field by the gate is clear and level');
{
  const f = await api((g) => {
    const V = g.game.player.position.constructor, s = g.game.world.zoneAt(new V(-12, 0, 32));
    const heights = [];
    for (let x = -16.5; x <= -7.5; x += 1.5) for (let z = 27.5; z <= 36.5; z += 1.5) { const h = g.game.physics.castRay(new V(x, 6, z), new V(0.002, -1, 0.003).normalize(), 12, 1); heights.push(h ? h.point.y : null); }
    return { zone: s?.id, heights };
  });
  const hs = f.heights.filter((h) => h !== null);
  check(f.zone === 'field' && hs.length === f.heights.length && Math.max(...hs) - Math.min(...hs) < 0.05, `the field is one level, open patch (${f.zone}, heights ${Math.min(...hs).toFixed(2)} to ${Math.max(...hs).toFixed(2)} over ${hs.length} probes)`);
}

console.log('down the road, over the bridge, to the shrine and back');
{
  let onBridge = 0;
  const there = await walk([[0, 17], [0, 34], [2, 41], [2, 55], [4.5, 63], [3, 72], [0, 79], [0, 82]], {
    onStep: async (x, z) => { if (z > 45 && z < 51) onBridge = Math.max(onBridge, (await pos())[1]); },
  });
  await wait(900);
  const nav = await api((g) => [...g.game.nav.unlocked.value]);
  check(there.all, `the road leads to the shrine (${there.reached}/8${there.stuck ? `, stuck going to ${there.stuck.slice(0, 2)} at ${there.stuck.slice(2, 4).map((v) => v.toFixed(1))}` : ''})`);
  check(onBridge > 0.6, `the road crosses the stream over the bridge, not through the water (highest ${onBridge.toFixed(2)} m)`);
  check(there.zones.has('bridge') && there.zones.has('shrine'), `the bridge and the shrine name themselves: ${[...there.zones].join(', ')}`);
  check(nav.includes('shrine'), `the shrine counts as visited: ${nav.join(', ')}`);
  await shot('02-at-the-shrine');
  await api((g) => g.camera('third'));
  await api((g) => g.look(0, -0.05));
  await wait(600);
  await shot('03-shrine-looking-back');
  await api((g) => g.camera('top'));
  await wait(300);
  const back = await walk([[0, 79], [3, 72], [4.5, 63], [2, 55], [2, 41], [0, 34], [0, 17], [0, 10]]);
  check(back.all && (await zone()) === 'courtyard', `and back in through the gate (${back.reached}/8)`);
}

console.log('the map at the valley scale');
{
  await api((g) => g.teleport('field'));
  await wait(400);
  await page.keyboard.press('KeyM');
  await page.locator('.nav-map').waitFor();
  check((await page.locator('.nav-map svg').getAttribute('data-scope')) === 'valley', 'outside the walls the map opens on the valley');
  check(await page.locator('[data-map-poi="shrine"] .name').isVisible(), 'the shrine is on it, named');
  await shot('04-map-valley');
  await page.locator('.map-scope [data-scope="compound"]').click();
  check((await page.locator('.nav-map svg').getAttribute('data-scope')) === 'compound' && (await page.locator('.nav-map .m-building').count()) === 3, 'the compound scale is a click away');
  await page.keyboard.press('KeyM');
  await page.waitForFunction(() => window.game.state() === 'explore', null, { timeout: 8000 });
}

console.log('the cliffs hold: sprint and jump at the edge from every side');
for (const [name, at, keys] of [['north', [10, -42], ['KeyW']], ['west', [-58, 10], ['KeyA']], ['east', [61, -10], ['KeyD']], ['south', [30, 84], ['KeyS']], ['north-west corner', [-55, -36], ['KeyW', 'KeyA']], ['south-east corner', [58, 80], ['KeyS', 'KeyD']]]) {
  await api((g, p) => g.teleport([p[0], g.game.world.groundAt(p[0], p[1]) + 0.05, p[1]]), at);
  await wait(300);
  for (const k of ['ShiftLeft', ...keys]) await page.keyboard.down(k);
  let top = -Infinity;
  for (let i = 0; i < 16; i++) { if (i % 3 === 0) await page.keyboard.press('Space'); await page.keyboard.press('KeyC'); await wait(200); top = Math.max(top, (await pos())[1]); }
  for (const k of ['ShiftLeft', ...keys]) await page.keyboard.up(k);
  const [x, y, z] = await pos();
  const moved = Math.hypot(x - at[0], z - at[1]);
  check(top < 5 && y < 4 && moved < 22 && (await zone()) !== null, `${name}: stopped at the cliff (${moved.toFixed(1)} m, highest ${top.toFixed(1)} m)`);
}
await api((g) => { g.teleport('road'); g.camera('third'); g.look(0, -0.12); });
await wait(600);
await shot('05-gate-from-the-road');

console.log('online: one player walks out to the field, the other sees them there');
{
  const room = `valley-${Date.now().toString(36)}`;
  const enter = async (name) => {
    const ctx = await browser.newContext({ viewport: { width: 960, height: 600 } });
    const p = await ctx.newPage();
    watch(p, name);
    await p.goto(`${url}?debug&room=${room}`);
    await p.waitForFunction(() => window.game?.game?.ready, null, { timeout: 180000 });
    await p.locator('.card').filter({ has: p.locator('h3', { hasText: /^recoil$/i }) }).click();
    await p.locator('input[name=name]').fill(name);
    await p.locator('[data-join]').click();
    await p.waitForFunction(() => window.game.net()?.status === 'online', null, { timeout: 15000 });
    return p;
  };
  const a = await enter("Walker"), b = await enter("Watcher");
  await a.evaluate(() => { window.game.camera('top'); window.game.teleport([0, 0, 14]); });
  await wait(500);
  for (const k of ['ShiftLeft', 'KeyS']) await a.keyboard.down(k);
  await wait(2600);
  for (const k of ['ShiftLeft', 'KeyS']) await a.keyboard.up(k);
  await wait(400);
  for (const k of ['ShiftLeft', 'KeyA']) await a.keyboard.down(k);
  await a.waitForFunction(() => window.game.game.player.position.x < -9, null, { timeout: 8000 }).catch(() => undefined);
  for (const k of ['ShiftLeft', 'KeyA']) await a.keyboard.up(k);
  await wait(900);
  const mine = await a.evaluate(() => { const p = window.game.game.player.position; return [p.x, p.y, p.z]; });
  const seen = await b.evaluate(() => window.game.net().remotes.find((r) => r.name === 'Walker')?.drawn ?? null);
  const where = await a.evaluate(() => window.game.game.world.zoneAt(window.game.game.player.position)?.id ?? null);
  check(where === 'field' || where === 'valley', `the walker is out of the walls (${where} at ${mine.map((v) => v.toFixed(1))})`);
  check(seen && Math.hypot(seen[0] - mine[0], seen[2] - mine[2]) < 1.5, `the watcher sees them there (${seen?.map((v) => v.toFixed(1)) ?? 'not at all'})`);
  await b.evaluate(() => { window.game.teleport([-6, 0, 24]); window.game.camera('top'); });
  await wait(700);
  await b.screenshot({ path: join(out, '06-online-field.png') });
  await a.context().close();
  await b.context().close();
}

check(errors.length === 0, `zero page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
await browser.close();
stop();
if (failures.length) { console.error(`\n${failures.length} valley checks failed`); process.exit(1); }
console.log(`\nvalley ok, screenshots in ${out}`);
