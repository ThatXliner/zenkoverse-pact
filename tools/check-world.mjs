#!/usr/bin/env node
// Walks the open world end to end with real held keys, the way a player goes:
// out of the gate and down the road, through the cutting in the south cliff,
// up the switchbacks, over the rope bridge, past the tea house and up the
// steps to the col, down the far side to the outskirts, round the bend into
// the city's main road and up the arcade to the station plaza, all in the
// default top-down view; then back to the gate over the shoulder. On the way it records every frame's time and when each
// region starts building, stands, hides and goes, and checks that:
// - each region stood before the player reached its land (nothing finished in a hurry), the compound hid
//   behind the col and came back, and the outskirts were taken down once far behind;
// - the place names, footsteps (earth, stone, the bridge's planks) and the bed's water follow the land;
// - the map opens on the pass, the tea house roof fades over the player, the edges hold a sprint and a jump;
// - every spawn point stands on ground, and health comes back out on the pass;
// - online, a player out in the outskirts is not drawn for one still in the compound, is
//   drawn once that one walks out too, a player downed on the pass gets up on the pass, and a
//   canal one player freezes in the city is ice on the other's screen too.
// It reports frame times along the route and in the frames spent building.
// The `?debug` hooks only read state, move a player between legs, set the camera's view and turn it.
// Usage: node tools/check-world.mjs [url] [--port 4183] [--out captures/world] [--skip-online] [--skip-third]
// Without a url it serves dist/ through server/index.mjs (run `npm run build` first).
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveTarget } from './lib/target.mjs';

const { url, args, stop } = await resolveTarget(process.argv.slice(2), { realtime: true });
const out = args.out ?? 'captures/world';
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
// A screenshot stalls the page's frames while it is taken; the frame-time
// figures leave those moments out.
const stalls = [];
const shot = async (name, p = page) => {
  const t0 = p === page ? await page.evaluate(() => performance.now()) : 0;
  await p.screenshot({ path: join(out, `${name}.png`), animations: 'disabled' });
  if (p === page) stalls.push([t0, await page.evaluate(() => performance.now()) + 60]);
};
const live = (list) => list.filter(([t]) => !stalls.some(([a, b]) => t >= a && t <= b));

// Frame times, from requestAnimationFrame in the page, with where the player stood.
const sampler = () => page.evaluate(() => {
  const s = window.__frames = { list: [], last: 0 };
  const loop = (t) => { if (s.last) { const p = window.game.game.player.position; s.list.push([t, t - s.last, p.x, p.z]); } s.last = t; s.raf = requestAnimationFrame(loop); };
  s.raf = requestAnimationFrame(loop);
});
const frames = () => page.evaluate(() => window.__frames.list.splice(0));

const KEYS = { n: 'KeyW', s: 'KeyS', e: 'KeyD', w: 'KeyA' };
// Walks a route of [x, z] points with real key presses, sprinting. In the
// top-down view W is north (up the screen) and D east; over the shoulder the
// camera turns toward the next point and W walks the way it looks.
async function walk(route, { third = false, onStep } = {}) {
  const held = new Set();
  const hold = async (want) => {
    for (const k of [...held]) if (!want.has(k)) { await page.keyboard.up(k); held.delete(k); }
    for (const k of want) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
  };
  const zones = new Set();
  let reached = 0, stuck = null;
  let [fx, , fz] = await pos();
  for (const [tx, tz] of route) {
    const t0 = Date.now();
    let last = null, still = 0;
    // Pure pursuit: aim a few metres ahead of the nearest point on the line
    // from the last waypoint to this one, so the walk keeps to the road.
    const lx = tx - fx, lz = tz - fz, ll = Math.hypot(lx, lz) || 1;
    for (;;) {
      const [x, , z] = await pos();
      zones.add(await zone());
      if (onStep) await onStep(x, z);
      if (Math.hypot(tx - x, tz - z) < 1.4) { reached++; break; }
      const u = Math.min(ll, Math.max(0, ((x - fx) * lx + (z - fz) * lz) / ll) + 2.5);
      const ax = fx + (lx / ll) * u, az = fz + (lz / ll) * u;
      const dx = ax - x, dz = az - z, len = Math.hypot(dx, dz) || 1;
      if (Date.now() - t0 > 45000) { stuck = [tx, tz, x, z]; break; }
      if (last && Math.hypot(x - last[0], z - last[1]) < 0.02) { if (++still > 40) { stuck = [tx, tz, x, z]; break; } } else still = 0;
      last = [x, z];
      const want = new Set(['ShiftLeft']);
      if (third) {
        await api((g, a) => g.look(a, -0.12), Math.atan2(-dx, -dz));
        want.add('KeyW');
      } else {
        if (Math.abs(dx) / len > 0.38) want.add(dx > 0 ? KEYS.e : KEYS.w);
        if (Math.abs(dz) / len > 0.38) want.add(dz > 0 ? KEYS.s : KEYS.n);
      }
      await hold(want);
      await wait(50);
    }
    if (stuck) break;
    [fx, fz] = [tx, tz];
  }
  await hold(new Set());
  return { zones, reached, all: reached === route.length, stuck };
}
const stuckText = (r) => (r.stuck ? `, stuck going to ${r.stuck.slice(0, 2).map((v) => v.toFixed(1))} at ${r.stuck.slice(2, 4).map((v) => v.toFixed(1))}` : '');

// Frame-time figures for a list of [t, dt].
function stats(list) {
  const d = list.map((f) => f[1]).sort((a, b) => a - b);
  if (!d.length) return null;
  const at = (q) => d[Math.min(d.length - 1, Math.floor(q * d.length))];
  return { n: d.length, median: at(0.5), p95: at(0.95), p99: at(0.99), max: d[d.length - 1], over25: d.filter((v) => v > 25).length, over34: d.filter((v) => v > 34).length };
}
const fmt = (s) => (s ? `${s.n} frames: median ${s.median.toFixed(1)} ms, p95 ${s.p95.toFixed(1)}, p99 ${s.p99.toFixed(1)}, max ${s.max.toFixed(1)}; ${s.over25} over 25 ms, ${s.over34} over 34 ms` : 'no frames');
const report = { legs: {} };

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
await api((g) => { g.god(true); g.camera('top'); g.teleport([0, 0, 14]); });
const W = await api((g) => g.world());
const inside = (b, x, z, pad = 0) => x >= b.x0 - pad && x <= b.x1 + pad && z >= b.z0 - pad && z <= b.z1 + pad;
// Wait for the pass to finish streaming in, as it does on the title screen.
await page.waitForFunction(() => window.game.world().regions.find((r) => r.id === 'pass')?.state === 'standing', null, { timeout: 30000 });
await wait(500);
// Past the pass: the outskirts' road round its bend into the city's main road, then the arcade to the plaza (city metres from its origin).
const C = W.origins.city;
const inCity = (pts) => pts.map(([x, z]) => [x + C[0], z + C[2]]);
const routeOut = [[0, 17], [0, 24.5], [0, 34], [2, 41], [2, 55], [3.4, 70], [11, 75.5], [18, 82], ...W.route.map(([x, , z]) => [x, z]), [66, 470], [66, 500], [66, 516], [66.6, 520.5], [68.4, 524.2], [71.2, 526.9], [75, 528], ...inCity([[-66, 23], [-30, 23], [0, 23], [0, 17], [-1.5, 10], [-1.5, -13], [-1.5, -16], [-7, -20]])];

console.log('out of the gate, through the cutting, over the pass to the crossing (top-down, held keys)');
{
  await sampler();
  await api((g) => g.audioClear());
  const t0 = await page.evaluate(() => performance.now());
  const firstIn = {};
  const shots = new Set();
  const marks = [['10-cutting-top', 24.6, 115], ['11-switchbacks-top', 66, 177], ['12-bridge-top', 89, 200.5], ['13-teahouse-top', 104, 205.5], ['14-col-top', 84, 254], ['15-descent-top', 82, 307], ['16-outskirts-top', 66, 500], ['17-bend-top', 75, 528], ['18-city-road-top', C[0] - 30, C[2] + 23], ['19-arcade-top', C[0] - 1.5, C[2]]];
  const leg = await walk(routeOut, {
    onStep: async (x, z) => {
      for (const [id, b] of Object.entries(W.bounds)) if (!firstIn[id] && inside(b, x, z)) firstIn[id] = await page.evaluate(() => performance.now());
      for (const [name, mx, mz] of marks) if (!shots.has(name) && Math.hypot(x - mx, z - mz) < 3) { shots.add(name); await shot(name); }
    },
  });
  const list = live(await frames());
  const w = await api((g) => g.world());
  const sounds = await api((g) => g.audio().log.map((e) => e.cue));
  check(leg.all, `the road leads from the gate to the city's station plaza (${leg.reached}/${routeOut.length}${stuckText(leg)})`);
  for (const id of ['cutting', 'tarn', 'switchbacks', 'ropebridge', 'teahouse', 'col', 'descent', 'busstop', 'outskirts', 'city-road', 'city-arcade', 'city-plaza']) check(leg.zones.has(id), `${id} names itself on the way`);
  const ev = (id, event) => w.log.filter((e) => e.id === id && e.event === event && e.at > t0);
  for (const id of ['pass', 'outskirts', 'city']) {
    const stood = w.log.filter((e) => e.id === id && e.event === 'stand').map((e) => e.at);
    const forced = ev(id, 'force').filter((e) => (e.ms ?? 0) > 1);
    check(firstIn[id] && stood.some((t) => t < firstIn[id]) && !forced.length, `${id} stood before the player reached its land, with nothing left to finish in a hurry (stood ${stood.map((t) => Math.round(t - t0)).join(',')} ms, entered ${firstIn[id] ? Math.round(firstIn[id] - t0) : '-'} ms, forced ${forced.length})`);
  }
  check(ev('home', 'hide').length > 0, `the compound and the valley are hidden once the col is behind (${ev('home', 'hide').length} hides)`);
  const build = w.build.filter((b) => b.at > t0);
  const out = w.regions.find((r) => r.id === 'outskirts');
  report.legs.out = { all: stats(list), building: stats(list.filter(([t]) => build.some((b) => Math.abs(b.at - t) < 20))), slices: { worst: Math.max(...build.map((b) => b.ms)), frames: build.length }, regions: w.regions };
  console.log(`  frames, gate to the plaza: ${fmt(report.legs.out.all)}`);
  report.legs.out.slowest = [...list].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t, dt, x, z]) => ({ at: Math.round(t - t0), ms: Math.round(dt * 10) / 10, x: Math.round(x), z: Math.round(z) }));
  console.log(`  slowest frames: ${report.legs.out.slowest.map((f) => `${f.ms} ms at (${f.x}, ${f.z})`).join('; ')}`);
  console.log(`  frames while a region built: ${fmt(report.legs.out.building)}; worst frame's build ${report.legs.out.slices.worst.toFixed(2)} ms over ${build.length} frames`);
  check(report.legs.out.all.p99 < 34, `frame time holds along the route: p99 ${report.legs.out.all.p99.toFixed(1)} ms`);
  check((report.legs.out.building?.max ?? 0) < 50 && (report.legs.out.building?.over34 ?? 0) <= 2, `streaming in costs no hitch: worst frame while building ${(report.legs.out.building?.max ?? 0).toFixed(1)} ms`);
  check(out?.state === 'standing', `the outskirts stand (${out?.slices} slices, slowest ${out?.worstSlice} ms)`);
  const city = w.regions.find((r) => r.id === 'city');
  check(city?.state === 'standing' && w.regions.find((r) => r.id === 'pass')?.state !== 'building', `the city stands (${city?.slices} slices, slowest ${city?.worstSlice} ms: ${Object.entries(city?.phases ?? {}).map(([k, v]) => `${k} ${v}`).join(', ')})`);
  for (const cue of ['step.gravel', 'step.stone', 'step.wood']) check(sounds.includes(cue), `${cue} underfoot on the way`);
  await shot('20-plaza-top');
  const steps = await api((g) => { const V = g.game.player.position.constructor, o = g.world().origins.city; const at = (x, y, z) => g.game.world.surfaceAt(new V(x + o[0], y + o[1], z + o[2]), 'ground'); return { road: at(0, 0.1, 23), park: at(0, 0.1, 32), shrine: at(-42, 0.1, 2), canal: at(-20, -1.5, 43.5), board: g.game.world.surfaceAt(new V(o[0], o[1], o[2]), 'wood') }; });
  check(steps.road === 'stone' && steps.park === 'grass' && steps.shrine === 'gravel' && steps.canal === 'water' && steps.board === 'wood', `the city's own footsteps: asphalt ${steps.road}, park ${steps.park}, shrine ${steps.shrine}, canal ${steps.canal}, boards ${steps.board}`);
  await api((g) => { g.camera('third'); g.look(Math.PI * 0.85, -0.04); });
  await wait(700);
  await shot('21-plaza-3p');
  await api((g) => g.camera('top'));
}

console.log('the pass streams in again while the player stands in the valley');
{
  await api((g) => { g.camera('top'); g.teleport([12, 0, 74]); });
  await wait(800);
  await sampler();
  const t0 = await page.evaluate(() => performance.now());
  await api((g) => g.restream('pass'));
  await page.waitForFunction(() => window.game.world().regions.find((r) => r.id === 'pass')?.state === 'standing', null, { timeout: 30000 });
  await wait(300);
  const list = live(await frames());
  const w = await api((g) => g.world());
  const build = w.build.filter((b) => b.at > t0);
  const stood = w.log.filter((e) => e.id === 'pass' && e.event === 'stand' && e.at > t0)[0];
  const pass = w.regions.find((r) => r.id === 'pass');
  report.restream = { frames: stats(list), buildFrames: build.length, worstBuild: Math.max(...build.map((b) => b.ms)), meanBuild: build.reduce((a, b) => a + b.ms, 0) / build.length, totalMs: stood?.ms, slices: pass.slices, worstSlice: pass.worstSlice, phases: pass.phases };
  console.log(`  the pass stood in ${Math.round(stood?.ms ?? 0)} ms over ${build.length} frames (${pass.slices} slices, slowest ${pass.worstSlice} ms; build per frame mean ${report.restream.meanBuild.toFixed(2)} ms, worst ${report.restream.worstBuild.toFixed(2)} ms)`);
  console.log(`  slowest slice by phase: ${Object.entries(pass.phases).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(`  frames meanwhile: ${fmt(report.restream.frames)}`);
  check(report.restream.frames.p99 < 25 && report.restream.frames.max < 50, `streaming the pass in costs no hitch while playing (p99 ${report.restream.frames.p99.toFixed(1)} ms, worst ${report.restream.frames.max.toFixed(1)} ms)`);
}

console.log('the map, the cutaway and the edges, out on the pass');
{
  await api((g) => { g.camera('top'); g.teleport('col'); });
  await wait(600);
  await page.keyboard.press('KeyM');
  await page.locator('.nav-map').waitFor();
  check((await page.locator('.nav-map svg').getAttribute('data-scope')) === 'pass', 'on the pass the map opens on the pass');
  check(await page.locator('[data-map-poi="teahouse"] .name').isVisible() && await page.locator('[data-map-poi="col"] .name').isVisible(), 'the tea house and the col are on it, named');
  await shot('22-map-pass');
  await page.locator('.map-scope [data-scope="valley"]').click();
  check((await page.locator('.nav-map svg').getAttribute('data-scope')) === 'valley', 'the valley is a click away');
  await page.keyboard.press('KeyM');
  await page.waitForFunction(() => window.game.state() === 'explore', null, { timeout: 8000 });

  // Under the tea house's roof the roof fades for the top-down camera.
  await api((g) => { const r = g.game.world.occluders.find((m) => m.userData.cutaway === 'teahouse'); const c = new r.position.constructor(); r.geometry.computeBoundingBox(); r.geometry.boundingBox.getCenter(c); g.teleport([c.x, c.y - 2.5, c.z]); });
  await wait(1200);
  const faded = await api((g) => g.game.world.occluders.filter((m) => m.userData.cutaway === 'teahouse').map((m) => m.material.opacity));
  check(faded.length && Math.max(...faded) < 0.5, `standing under the tea house's roof, it fades (${faded.map((v) => v.toFixed(2))})`);
  await shot('23-teahouse-cutaway');

  // Sprint and jump at the edges: the strip holds.
  const legs = [['switchback, downhill side', [66, 177], 'KeyW'], ['switchback, uphill side', [66, 177], 'KeyS'], ['cutting wall', [24.6, 115], 'KeyD'], ['bridge rail', [89, 200.5, 28.6], 'KeyS'], ['lookout edge', [80, 258.5], 'KeyS'], ['descent, uphill side', [64, 302], 'KeyW'], ['far bend', [98, 331], 'KeyD']];
  for (const [name, [x, z, y], key] of legs) {
    await api((g, p) => { g.teleport([p[0], p[2] ?? g.game.world.groundAt(p[0], p[1]) + 0.1, p[1]]); }, [x, z, y]);
    await wait(400);
    for (const k of ['ShiftLeft', key]) await page.keyboard.down(k);
    for (let i = 0; i < 10; i++) { if (i % 3 === 0) await page.keyboard.press('Space'); await page.keyboard.press('KeyC'); await wait(180); }
    for (const k of ['ShiftLeft', key]) await page.keyboard.up(k);
    await wait(300);
    const [px, py, pz] = await pos();
    const d = await api((g, p) => g.passRoad(p[0], p[1]), [px, pz]);
    const ground = y ?? await api((g, p) => g.game.world.groundAt(p[0], p[1]), [px, pz]);
    check(d < 0.3 && py > ground - 1, `${name}: held inside the road's edge (${d.toFixed(2)} m, y ${py.toFixed(1)} over ground ${ground.toFixed(1)})`);
  }
}

console.log('every spawn point stands on ground; health comes back on the pass');
{
  const names = Object.keys(W.spawns).filter((n) => Object.values(W.bounds).some((b) => inside(b, W.spawns[n][0], W.spawns[n][2])));
  for (const n of names) {
    await api((g, name) => g.teleport(name), n);
    await wait(500);
    const [x, y, z] = await pos();
    const [sx, sy, sz] = W.spawns[n];
    const grounded = await api((g) => g.game.player.grounded);
    check(grounded && Math.abs(y - sy) < 0.7 && Math.hypot(x - sx, z - sz) < 1, `${n}: standing at ${[x, y, z].map((v) => v.toFixed(1))}`);
  }
  const regionSpawns = JSON.parse(readFileSync(new URL('../src/net/rules.json', import.meta.url), 'utf8')).regions;
  for (const r of regionSpawns) for (const sp of r.spawns) {
    await api((g, p) => g.teleport(p), sp);
    await wait(400);
    const [x, y, z] = await pos();
    const grounded = await api((g) => g.game.player.grounded);
    const b = r.bounds;
    check(grounded && Math.abs(y - sp[1]) < 0.7 && x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3], `the server's ${r.id} spawn ${sp.join(', ')} stands on ground inside the ${r.id}`);
  }
  await api((g) => { g.god(false); g.teleport('teahouse'); });
  await wait(500);
  const h0 = await api((g) => { g.game.combat.hurtPlayer(60, { self: true }); return g.game.combat.hp; });
  const quiet = await api((g) => g.training().regen.quietSeconds);
  await wait((quiet + 3) * 1000);
  const h1 = await api((g) => g.game.combat.hp);
  check(h1 > h0 + 3, `out on the pass, health comes back after a quiet spell (${h0.toFixed(0)} to ${h1.toFixed(0)})`);
  await api((g) => g.god(true));
}

if (!args['skip-third']) {
  console.log('back from the plaza to the gate over the shoulder (held W, the camera turned to the road)');
  await api((g, p) => { g.camera('third'); g.teleport([p[0], p[1] + 0.1, p[2]]); }, [C[0] - 7, C[1], C[2] - 20]);
  await wait(600);
  await sampler();
  const t0 = await page.evaluate(() => performance.now());
  const marks = [['29-arcade-3p', C[0] - 1.5, C[2] + 5], ['29-bend-3p', 75, 528], ['30-outskirts-3p', 66, 500], ['31-descent-3p', 56, 300], ['32-col-3p', 84, 254], ['33-steps-3p', 98, 228], ['34-bridge-3p', 89, 200.5], ['35-switchbacks-3p', 66, 177], ['36-cutting-3p', 24.6, 115]];
  const shots = new Set();
  const back = [...routeOut].reverse().slice(1).concat([[0, 10]]);
  let homeSeen = null;
  const leg = await walk(back, {
    third: true,
    onStep: async (x, z) => {
      for (const [name, mx, mz] of marks) if (!shots.has(name) && Math.hypot(x - mx, z - mz) < 3) { shots.add(name); await shot(name); }
      if (homeSeen === null && z < 290) homeSeen = (await api((g) => g.world().regions.find((r) => r.id === 'home')?.state)) === 'standing';
    },
  });
  const list = live(await frames());
  const w = await api((g) => g.world());
  check(leg.all, `over the shoulder, back from the plaza to the yard (${leg.reached}/${back.length}${stuckText(leg)})`);
  check(homeSeen === true, 'the compound and the valley are back before the col shows them');
  check((await zone()) === 'courtyard', 'back in the courtyard');
  const drops = w.log.filter((e) => e.event === 'drop' && e.at > t0).map((e) => e.id);
  check(drops.includes('outskirts') && drops.includes('city'), `the outskirts and the city are taken down once far behind (${drops.join(', ') || 'nothing dropped'})`);
  const build = w.build.filter((b) => b.at > t0);
  report.legs.back = { all: stats(list), building: stats(list.filter(([t]) => build.some((b) => Math.abs(b.at - t) < 20))) };
  console.log(`  frames, plaza to the yard: ${fmt(report.legs.back.all)}`);
  report.legs.back.slowest = [...list].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t, dt, x, z]) => ({ at: Math.round(t - t0), ms: Math.round(dt * 10) / 10, x: Math.round(x), z: Math.round(z) }));
  console.log(`  slowest frames: ${report.legs.back.slowest.map((f) => `${f.ms} ms at (${f.x}, ${f.z})`).join('; ')}`);
  check(report.legs.back.all.p99 < 34, `frame time holds on the way back: p99 ${report.legs.back.all.p99.toFixed(1)} ms`);
}

if (!args['skip-online']) {
  console.log('online across regions');
  const room = `world-${Date.now().toString(36)}`;
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
  const a = await enter('Traveller'), b = await enter('Homebody');
  await a.evaluate(() => { window.game.camera('top'); window.game.teleport('busstop'); });
  await b.evaluate(() => { window.game.camera('top'); window.game.teleport([0, 0, 12]); });
  await wait(2500);
  const seenFromHome = await b.evaluate(() => { const r = window.game.net().remotes.find((x) => x.name === 'Traveller'); return { r, targeted: window.game.game.targets().some((t) => t.info?.name === 'Traveller'), plates: document.querySelectorAll('.plates .plate').length }; });
  check(seenFromHome.r && !seenFromHome.r.visible && !seenFromHome.targeted && seenFromHome.plates === 0, `from the compound, a player out in the outskirts is not drawn, not a target and has no plate (visible ${seenFromHome.r?.visible}, plates ${seenFromHome.plates})`);
  check(await b.locator('.scoreboard li', { hasText: 'Traveller' }).count() === 1, 'they are still on the scoreboard');
  await b.evaluate(() => window.game.teleport('bend'));
  await wait(2500);
  const mine = await a.evaluate(() => { const p = window.game.game.player.position; return [p.x, p.y, p.z]; });
  const seenThere = await b.evaluate(() => window.game.net().remotes.find((x) => x.name === 'Traveller'));
  check(seenThere?.visible && Math.hypot(seenThere.drawn[0] - mine[0], seenThere.drawn[2] - mine[2]) < 1.5, `walking out there too, they are drawn where they stand (${seenThere?.drawn?.map((v) => v.toFixed(1))})`);
  await b.evaluate(() => { window.game.camera('third'); window.game.look(0, -0.05); });
  await wait(600);
  await b.screenshot({ path: join(out, '40-online-outskirts.png') });
  // A canal frozen in the city is ice on both screens.
  await a.evaluate(() => { window.game.technique('rime'); window.game.teleport('city:canal'); window.game.camera('third'); window.game.look(Math.PI, -0.55); });
  await b.evaluate(() => { window.game.teleport('city:park'); });
  await wait(2500);
  await a.evaluate(() => window.game.cast('secondary'));
  await wait(1500);
  const iceAt = await a.evaluate(() => { const o = window.game.world().origins.city, V = window.game.game.player.position.constructor; const hits = []; for (let x = -40; x <= 10; x += 1) { const h = window.game.game.physics.castRay(new V(x + o[0], o[1] + 4, 43.5 + o[2]), new V(0, -1, 0), 8, 1); if (h && h.point.y - o[1] > -1.3) hits.push(x); } return hits; });
  const iceThere = await b.evaluate((xs) => { const o = window.game.world().origins.city, V = window.game.game.player.position.constructor; return xs.filter((x) => { const h = window.game.game.physics.castRay(new V(x + o[0], o[1] + 4, 43.5 + o[2]), new V(0, -1, 0), 8, 1); return h && h.point.y - o[1] > -1.3; }).length; }, iceAt);
  check(iceAt.length > 2 && iceThere === iceAt.length, `Rime's ice over the city canal is on both screens (${iceAt.length} m of it here, ${iceThere} m there)`);
  await b.screenshot({ path: join(out, '41-online-city-canal.png') });
  // Downed on the pass, up again on the pass.
  await a.evaluate(() => window.game.teleport('col'));
  await wait(800);
  await a.evaluate(() => window.game.game.combat.hurtPlayer(500, { self: true }));
  await a.waitForFunction(() => window.game.net().downed, null, { timeout: 5000 }).catch(() => undefined);
  await a.waitForFunction(() => !window.game.net().downed, null, { timeout: 9000 }).catch(() => undefined);
  await wait(500);
  const up = await a.evaluate(() => { const p = window.game.game.player.position; return [p.x, p.y, p.z, window.game.game.player.grounded]; });
  const passB = W.bounds.pass;
  check(inside(passB, up[0], up[2]) && up[3], `downed on the pass, they get up on the pass, on their feet (${up.slice(0, 3).map((v) => v.toFixed(1))})`);
  await a.context().close();
  await b.context().close();
}

writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
check(errors.length === 0, `zero page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
await browser.close();
stop();
if (failures.length) { console.error(`\n${failures.length} world checks failed`); process.exit(1); }
console.log(`\nworld ok, screenshots in ${out}`);
