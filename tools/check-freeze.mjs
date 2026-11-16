#!/usr/bin/env node
// Proves a freeze can't be chained into a lock: spamming Rime's Cold Stitch
// at a body freezes it for less each time, leaves a moment after each thaw,
// and stops taking after a few, on a boss sooner. And that in the top-down
// view Cold Stitch lands on the floor under the cursor.
// Usage: node tools/check-freeze.mjs [url] [--port 4173]
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

await page.goto(`${url}?debug`);
await page.waitForFunction(() => window.game?.game?.ready, null, { timeout: 180000 });
await page.evaluate(() => window.game.loop(false));

// Twenty seconds of right click mashed at one body with Cold Stitch bound:
// a cast whenever the slot and Warmth allow, the body's ice read every frame.
const spam = (key) => page.evaluate((key) => {
  const g = window.game, G = g.game, V = G.player.position.constructor;
  G.startRun({ skipTutorial: true }); g.god(true); g.technique('rime'); g.step(5);
  g.teleport([0, 0, 7]);
  const e = G.encounters.spawn(key, new V(0, 0, 1));
  e.field = null; e.attackCd = 1e6; e.castCd = 1e6;
  G.book.preview.value = G.techniques.def.catalogue.find((p) => p.id === 'rime.cold-stitch');
  g.camera('third'); g.look(0, -0.15); g.step(5);
  let frozenFor = 0, run = 0, longest = 0, free = 0, longestFree = 0, freezes = 0, was = 0;
  const lengths = [];
  for (let f = 0; f < 60 * 20; f++) {
    e.position.set(0, e.position.y, 1);
    G.techniques.cast('secondary');
    g.step(1);
    if (e.frozen > was + 0.01) { freezes++; lengths.push(+e.frozen.toFixed(2)); }
    was = e.frozen;
    if (e.frozen > 0) { frozenFor += 1 / 60; run += 1 / 60; longest = Math.max(longest, run); free = 0; } else { run = 0; free += 1 / 60; longestFree = Math.max(longestFree, free); }
  }
  return { frozenFor, longest, longestFree, freezes, lengths };
}, key);

for (const key of ['thug', 'kuroda']) {
  console.log(`\nspamming Cold Stitch at a ${key}`);
  const r = await spam(key);
  console.log(`    freezes ${r.lengths.join(', ')} s`);
  check(r.freezes >= 2, `it freezes at all (${r.freezes} freezes)`);
  check(r.lengths[1] < r.lengths[0], 'the second freeze in a row holds for less than the first');
  check(r.longestFree > 5, `once the chain runs out it walks free under the spam (${r.longestFree.toFixed(1)} s)`);
  check(r.longest < 3, `it never stays frozen past one freeze (${r.longest.toFixed(1)} s at most)`);
  check(r.frozenFor < 20 * 0.4, `frozen ${r.frozenFor.toFixed(1)} of 20 s`);
}

// Top-down, the cursor over spots at several distances and headings: the
// frost lands under it, not past it.
console.log('\ntop-down, Cold Stitch lands under the cursor');
const landings = await page.evaluate(() => {
  const g = window.game, G = g.game, V = G.player.position.constructor;
  G.startRun({ skipTutorial: true }); g.god(true); g.technique('rime'); g.step(5);
  G.book.preview.value = G.techniques.def.catalogue.find((p) => p.id === 'rime.cold-stitch');
  g.teleport([0, 0, 7]); g.camera('top'); g.step(30);
  const out = [];
  for (const [dx, dz] of [[0, -4], [5, -3], [-7, 2], [3, 9], [0, -12]]) {
    const want = new V(G.player.position.x + dx, 0, G.player.position.z + dz);
    const ndc = want.clone().project(G.renderer.camera);
    G.input.mouse.x = ndc.x; G.input.mouse.y = ndc.y;
    g.step(2);
    G.techniques.resource = 100;
    let landed = null;
    const patch = G.vfx.patch.bind(G.vfx);
    G.vfx.patch = (at, ...rest) => { landed ??= at.clone(); return patch(at, ...rest); };
    G.techniques.cast('secondary');
    g.step(60);
    G.vfx.patch = patch;
    out.push({ want: [want.x, want.z], landed: landed && [landed.x, landed.z], off: landed ? Math.hypot(landed.x - want.x, landed.z - want.z) : Infinity });
  }
  return out;
});
for (const l of landings) check(l.off < 1, `cursor ${l.want.map((v) => v.toFixed(1)).join(', ')}: landed ${l.landed ? l.landed.map((v) => v.toFixed(1)).join(', ') : 'nowhere'} (${l.off.toFixed(2)} m off)`);

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await browser.close();
await stop?.();
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
process.exit(failures.length ? 1 : 0);
