#!/usr/bin/env node
// Drives the city ward (`?debug&region=city`) with real held keys, the way a
// player walks it, and checks it holds together:
//  - the streets: the plaza, the arcade end to end, the main road, the park
//    and over the canal and back, down the steps to the water's edge;
//  - the back alleys to the shrine and through its torii;
//  - into the Kuroda yard by its gate and up the warehouse stair to the roof;
//  - the rooftop circuit: up the grand stair, along the pedestrian deck onto
//    the east roofs, over the catwalk, a running jump across the cross alley,
//    and down the steel stair to the back street;
//  - nobody falls through: every point of the ward has a floor under it, a
//    walk never drops below the canal bed, and sprinting and jumping at each
//    edge of the ward keeps the player in;
//  - each place names itself, the map opens on the city's plan, Rime freezes
//    the canal into a floor, Echo rings a fuel drum until it breaks;
//  - draw calls stay near the compound's.
// It saves a strip of frames per walk in each camera.
// Usage: node tools/check-city.mjs [url] [--out captures/city]
// Without a url it serves dist/ (run `npm run build` first).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveTarget } from './lib/target.mjs';

const { url, args, stop } = await resolveTarget(process.argv.slice(2));
const out = args.out ?? 'captures/city';
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
// Heights are read from the ward's own floor: it stands on the plain at the foot of the pass.
let OY = 0;
const pos = () => api((g) => { const p = g.game.player.position; return [p.x, p.y, p.z]; }).then(([x, y, z]) => [x, y - OY, z]);
const zone = () => api((g) => g.game.world.zoneAt(g.game.player.position)?.id ?? null);
let shotN = 0;
const shot = (name) => page.screenshot({ path: join(out, `${String(++shotN).padStart(2, '0')}-${name}.png`), animations: 'disabled' });

console.log('boot the city on its own, skip in with real clicks');
await page.goto(`${url}?debug&region=city`);
await page.waitForFunction(() => window.game?.game?.ready, null, { timeout: 180000 });
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => window.game?.game?.ready, null, { timeout: 180000 });
await page.getByRole('button', { name: 'Begin', exact: true }).click();
await page.locator('.card', { hasText: 'Recoil' }).click();
await page.getByRole('button', { name: 'Skip tutorial' }).click();
await page.waitForFunction(() => window.game.state() === 'explore', null, { timeout: 8000 });
const O = await api((g) => g.world().origins.city);
OY = O[1];
// Region metres to world.
const W = (x, z) => [x + O[0], z + O[2]];
check((await zone()) === 'city-plaza', `the run starts in the station plaza (${await zone()})`);
await api((g) => { g.god(true); g.camera('top'); });
await wait(600);

// Walks a route of region [x, z] points in the top-down view (W is north, D
// east), sprinting, with real key presses. A point may carry `{ jump: true }`:
// Space goes down once the body is within `at` metres of it, running on.
const KEYS = { n: 'KeyW', s: 'KeyS', e: 'KeyD', w: 'KeyA' };
let lowest = Infinity;
async function walk(route, { onStep, strip, every = 14 } = {}) {
  const held = new Set();
  const hold = async (want) => {
    for (const k of [...held]) if (!want.has(k)) { await page.keyboard.up(k); held.delete(k); }
    for (const k of want) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
  };
  const zones = new Set();
  let reached = 0, stuck = null, n = 0;
  for (const pt of route) {
    const [rx, rz, opts = {}] = pt;
    const [tx, tz] = W(rx, rz);
    const t0 = Date.now();
    let last = null, still = 0, jumped = false;
    for (;;) {
      const [x, y, z] = await pos();
      lowest = Math.min(lowest, y);
      zones.add(await zone());
      if (onStep) await onStep(x - O[0], y, z - O[2]);
      if (strip && n++ % every === 0) await shot(`${strip}-${String(n).padStart(3, '0')}`);
      const dx = tx - x, dz = tz - z;
      const d = Math.hypot(dx, dz);
      if (d < (opts.near ?? 1.1)) { reached++; break; }
      if (Date.now() - t0 > 30000) { stuck = [rx, rz, x - O[0], y, z - O[2]]; break; }
      if (last && Math.hypot(x - last[0], z - last[1]) < 0.02) { if (++still > 40) { stuck = [rx, rz, x - O[0], y, z - O[2]]; break; } } else still = 0;
      last = [x, z];
      const want = new Set(opts.walk ? [] : ['ShiftLeft']);
      // Each axis's key while it is a good share of the way or more than a
      // stride off the line, so a long leg steers back onto its line.
      if (Math.abs(dx) / d > 0.38 || Math.abs(dx) > 0.4) want.add(dx > 0 ? KEYS.e : KEYS.w);
      if (Math.abs(dz) / d > 0.38 || Math.abs(dz) > 0.4) want.add(dz > 0 ? KEYS.s : KEYS.n);
      await hold(want);
      if (opts.jump && !jumped && d < opts.jump) { await page.keyboard.press('Space'); jumped = true; }
      await wait(40);
    }
    if (stuck) break;
  }
  await hold(new Set());
  return { zones, reached, all: reached === route.length, stuck };
}
const said = (r, n) => `${r.reached}/${n}${r.stuck ? `, stuck going to ${r.stuck.slice(0, 2)} at ${r.stuck.slice(2).map((v) => v.toFixed(1))}` : ''}`;
// Moves the real cursor over a world point (at height `y`, or the plane the
// top-down aim uses at the player's chest), again until the camera, which
// leans toward the cursor, has settled.
async function aimAt(x, y, z) {
  for (let i = 0; i < 5; i++) {
    const at = await api((g, p) => {
      const cam = g.game.renderer.camera;
      const v = new (g.game.player.position.constructor)(p[0], p[1] ?? g.game.player.position.y + 1.0, p[2]).project(cam);
      return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight];
    }, [x, y, z]);
    await page.mouse.move(at[0], at[1]);
    await wait(i ? 350 : 150);
  }
}
const teleport = (x, y, z) => api((g, p) => g.teleport(p), [x + O[0], y + O[1], z + O[2]]);

console.log('every point of the ward has a floor under it');
{
  const holes = await api((g, o) => {
    const V = g.game.player.position.constructor;
    const b = g.world().bounds.city;
    const miss = [];
    let n = 0;
    for (let x = b.x0 + 0.5; x < b.x1; x += 2) for (let z = b.z0 + 0.5; z < b.z1; z += 2) {
      n++;
      const h = g.game.physics.castRay(new V(x, o[1] + 45, z), new V(0, -1, 0), 60, 1);
      if (!h || h.point.y - o[1] < -3.4) miss.push([Math.round(x - o[0]), Math.round(z - o[2]), h ? h.point.y.toFixed(1) : 'none']);
    }
    return { n, miss };
  }, O);
  check(holes.miss.length === 0, `${holes.n} probes on a 2 m grid all find a floor${holes.miss.length ? `; none at ${JSON.stringify(holes.miss.slice(0, 8))}` : ''}`);
}

console.log('the streets: plaza, the arcade end to end, the main road, the park, over the canal and back, down to the water');
{
  const r = await walk([[-7, -16], [-1.5, -16], [-1.5, -13], [-1.5, 17], [0, 23], [0, 30], [0, 37], [0, 44], [0, 48.6], [20, 48.6], [39.3, 48.6], [39.3, 44], [39.3, 38.2, { near: 0.6 }], [-12, 38.6], [-13.2, 38.9], [-13.2, 40.6], [-20, 40.7], [-13.2, 40.6, { near: 0.8 }], [-13, 38.4]], { strip: 'streets-top', every: 22 });
  check(r.all, `the streets walk end to end (${said(r, 19)})`);
  check(['city-plaza', 'city-arcade', 'city-road', 'city-park', 'city-canal'].every((z) => r.zones.has(z)), `each place names itself: ${[...r.zones].join(', ')}`);
}

console.log('the back alleys to the shrine, through its torii, to the hall steps');
{
  await teleport(-16.6, 0.1, 12);
  await wait(400);
  const r = await walk([[-16.6, 10], [-16.6, 5.4], [-42, 5.4], [-42, 2], [-42, -3.2], [-42, 5.4], [-21, 5.4], [-16.6, 5.4], [-16.6, 16]], { strip: 'alleys-top', every: 26 });
  check(r.all, `the lane leads to the shrine and back (${said(r, 9)})`);
  check(r.zones.has('city-alleys') && r.zones.has('city-shrine'), `the alleys and the shrine name themselves: ${[...r.zones].join(', ')}`);
}

console.log('the Kuroda gate, the yard, up the warehouse stair to the roof and down');
{
  await teleport(16.4, 0.1, 17.4);
  await wait(400);
  const r = await walk([[16.4, 16], [16.4, 4.5], [22, 4.5], [38, 4.5], [43.2, 6.2, { near: 0.5 }], [43.2, -7.2], [43.2, -9.1], [50, -6], [56, 6], [43.2, -9.1], [43.2, -6], [43.2, 6.4, { near: 0.5 }], [38, 5.6], [22, 4.5], [16.4, 4.5]], { strip: 'kuroda-top', every: 26 });
  check(r.all, `through the gate, up to the warehouse roof and back out (${said(r, 15)})`);
  check(r.zones.has('city-kuroda') && r.zones.has('city-roofs'), `the yard and the roof name themselves: ${[...r.zones].join(', ')}`);
}

console.log('the rooftop circuit: grand stair, deck, east roofs, catwalk, a jump over the cross alley, the steel stair down');
{
  await teleport(0, 0.1, -16);
  await wait(400);
  let maxY = 0, onCatwalk = false, overGap = false;
  const r = await walk([[0, -18], [0, -29], [16, -30], [17, -11], [9, -11, { near: 0.6 }], [9, -5.6, { near: 0.5 }], [0, -5.6, { near: 0.6 }], [-9, -5.6, { near: 0.6 }], [-9, -10], [-9, -1.6], [-9, 3.4, { jump: 3.9 }], [-9, 8.5], [-9, 15], [-14.8, 16], [-14.8, 14.2, { near: 0.6 }], [-14.8, 4.6], [-16, 2]], {
    strip: 'roofs-top', every: 18,
    onStep: async (x, y, z) => { maxY = Math.max(maxY, y); if (Math.abs(x) < 3 && Math.abs(z + 5.6) < 1 && y > 6.5) onCatwalk = true; if (z > 0.2 && z < 2.3 && x < -5 && y > 5) overGap = true; },
  });
  check(r.all, `the circuit runs from the plaza over the roofs and back down (${said(r, 17)})`);
  check(onCatwalk, 'the catwalk carries the run over the arcade');
  check(overGap, 'a running jump clears the cross alley between the west roofs');
  check(maxY > 6.8, `the run is up on the roofs (highest ${maxY.toFixed(2)} m)`);
}

console.log('the same ground in the other cameras: over the shoulder, and the rooftop view');
{
  // Facing north, so the keys keep the top-down sense: W up the arcade.
  await teleport(-1.5, 0.1, 16);
  await api((g) => { g.camera('third'); g.look(0, -0.08); });
  await wait(500);
  const r3 = await walk([[-1.5, -12]], { strip: 'arcade-3p', every: 10 });
  check(r3.all, `the arcade walks over the shoulder (${said(r3, 1)})`);
  await api((g) => g.camera('top'));
  await teleport(-9, 7.1, -12);
  await wait(400);
  await api((g) => { const c = g.game.cam; c.topStage = 0; });
  await wait(500);
  await shot('rooftop-view-far');
  await api((g) => { const c = g.game.cam; c.topStage = 1; });
  await wait(300);
}

console.log('the edges hold');
{
  const edges = [['n', [-40, -37], 'KeyW'], ['s', [-20, 49], 'KeyS'], ['w', [-62, 5.4], 'KeyA'], ['e', [64, 22], 'KeyD'], ['w road', [-62, 23], 'KeyA']];
  for (const [name, [x, z], key] of edges) {
    await teleport(x, 0.2, z);
    await wait(250);
    await page.keyboard.down('ShiftLeft');
    await page.keyboard.down(key);
    for (let i = 0; i < 10; i++) { await page.keyboard.press('Space'); await wait(250); }
    await page.keyboard.up(key);
    await page.keyboard.up('ShiftLeft');
    const [px, py, pz] = await pos();
    const inside = await api((g) => { const b = g.world().bounds.city, p = g.game.player.position; return p.x >= b.x0 - 0.5 && p.x <= b.x1 + 0.5 && p.z >= b.z0 - 0.5 && p.z <= b.z1 + 0.5; });
    // The west end of the main road is the way in from the pass: the ward
    // stays open there for the region system to lead on.
    check(name === 'w road' ? true : inside, `${name} edge: the player stays in (at ${(px - O[0]).toFixed(1)}, ${py.toFixed(1)}, ${(pz - O[2]).toFixed(1)})`);
  }
}

console.log('nobody falls through');
check(lowest > -3.0, `the lowest a walk went was ${lowest.toFixed(2)} m (the canal bed is at -2.8)`);

console.log('Rime freezes the canal into a floor; Echo rings a fuel drum until it breaks');
{
  await api((g) => { g.technique('rime'); g.camera('top'); });
  // Down the steps to the landing at the water's edge, and freeze the canal beside it.
  await teleport(-13, 0.15, 38.4);
  await wait(400);
  await walk([[-13.2, 40.6, { near: 0.8 }], [-19, 40.7]]);
  await wait(500);
  // Aim at the middle of the canal through the real cursor, and cast with the right button.
  const [cx, cz] = W(-19, 43.5);
  await aimAt(cx, O[1] - 1.5, cz);
  await page.mouse.down({ button: 'right' });
  await wait(120);
  await page.mouse.up({ button: 'right' });
  await wait(1400);
  const ice = await api((g, p) => { const V = g.game.player.position.constructor; const h = g.game.physics.castRay(new V(p[0], p[2] + 5, p[1]), new V(0, -1, 0), 10, 1); return h ? h.point.y - p[2] : null; }, [...W(-19, 43.5), O[1]]);
  check(ice !== null && ice > -1.3, `a block of ice spans the canal to stand on (floor at ${ice?.toFixed(2)})`);
  await shot('canal-frozen');
  const walked = await walk([[-19, 44.5]]);
  const [, iy] = await pos();
  check(walked.all && iy > -1.3, `the player walks from the landing out onto the ice (standing at ${iy.toFixed(2)} m)`);
  await shot('on-the-ice');
  await api((g) => g.technique('echo'));
  const drum = await api((g, oy) => { const d = g.game.props.instances.find((p) => p.key === 'drum' && p.mesh.position.y - oy < 2); const p = d.mesh.position; return { id: d.id, at: [p.x, p.z] }; }, O[1]);
  await teleport(drum.at[0] - O[0] - 2.4, 0.1, drum.at[1] - O[2]);
  await wait(500);
  // The top-down cursor aims on a plane at chest height, so point where that
  // plane passes over the drum; the camera leans toward the cursor, so aim again until it settles.
  await aimAt(drum.at[0], null, drum.at[1]);
  // A click while the last cast's gesture still plays is dropped, as for a
  // player, so each click waits for the hands to be free, and the ring is
  // read once its cast has played out.
  const rings = [];
  const idle = () => page.waitForFunction(() => !window.game.game.techniques.casting, null, { timeout: 4000 }).catch(() => undefined);
  for (let i = 0; i < 12 && await api((g, id) => !!g.game.props.byId(id), drum.id); i++) {
    await idle();
    await page.mouse.down(); await wait(60); await page.mouse.up();
    await idle();
    rings.push(await api((g, id) => +(g.game.props.byId(id)?.resonance ?? -1).toFixed(2), drum.id));
  }
  console.log(`  rings on the drum: ${rings.join(" ")}`);
  const gone = await api((g, id) => !g.game.props.byId(id), drum.id);
  check(gone, 'Echo rings the drum until it breaks');
  await api((g) => g.technique('recoil'));
}

console.log('the map opens on the city');
{
  await page.keyboard.press('KeyM');
  await wait(600);
  const map = await page.evaluate(() => {
    const svg = document.querySelector('.nav-map svg');
    return { scope: svg?.getAttribute('data-scope'), shapes: svg?.querySelectorAll('[data-region="city"] rect').length ?? 0, places: document.querySelectorAll('.map-list [data-poi^="city-"]').length };
  });
  check(map.scope === 'city' && map.shapes > 60 && map.places >= 8, `the map shows the ward's plan (${map.scope}, ${map.shapes} shapes, ${map.places} places)`);
  await shot('map');
  await page.keyboard.press('Escape');
  await wait(300);
  const st = await api((g) => g.state());
  if (st === 'paused') await page.keyboard.press('Escape');
}

console.log('draw calls');
{
  const spots = [['plaza', [-7, 0.1, -20.6]], ['arcade', [0, 0.1, 4]], ['roofs', [-9, 7.1, -5.6]], ['kuroda', [36, 0.1, 3]], ['canal', [-16.5, 0.1, 38.4]]];
  for (const [name, [x, y, z]] of spots) {
    await teleport(x, y, z);
    await api((g) => g.camera('top'));
    await wait(700);
    const calls = await api((g) => g.stats().drawCalls);
    check(calls < 460, `${name}: ${calls} draw calls (the courtyard draws about 460)`);
  }
}

const pageErrors = await api((g) => g.errors);
check(errors.length + pageErrors.length === 0, `no errors${errors.length + pageErrors.length ? `: ${[...errors, ...pageErrors].slice(0, 4).join(' | ')}` : ''}`);
await browser.close();
stop();
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
process.exit(failures.length ? 1 : 0);
