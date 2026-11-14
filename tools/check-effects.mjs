#!/usr/bin/env node
// Proves that what a run, a Technique or a scene leaves behind ends with it
// (issue #53), and fails on any page error. It checks:
//   a rooftop run restarted with "Climb again", and a rooftop run left for
//   the yard, leave no Technique effect: no ice spike, frost patch, ring or
//   pending beat of an ability still on its way, and no scene object or
//   physics body the run added;
//   the pond Rime freezes into a floor thaws, floor and all, when the scene ends;
//   a run restarted inside a toast's few seconds shows its welcome once;
//   the Master's aura field tints the frame only while the player stands in
//   it: indoors, with the camera inside her field and the player outside it,
//   the frame is the same with the field as without.
// Usage: node tools/check-effects.mjs [url] [--url http://localhost:4173/] [--out captures/effects] [--port 4173]
// Without a URL it serves dist/ itself (run `npm run build` first).
import { chromium } from 'playwright';
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveTarget } from './lib/target.mjs';

const { url, args, stop } = await resolveTarget();
const out = args.out ?? 'captures/effects';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|WebGL|GPU stall|Automatic fallback/.test(m.text())) errors.push(`console: ${m.text()}`); });
const failures = [];
const check = (ok, what) => { if (!ok) failures.push(what); console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const shot = (name) => page.screenshot({ path: join(out, `${name}.png`), animations: 'disabled' });

await page.goto(`${url}?debug`);
await page.waitForFunction(() => window.game?.game?.ready, null, { timeout: 180000 });
await page.evaluate(() => window.game.loop(false));

// What the world holds: live effects, scene objects, physics bodies, frozen props.
const world = () => page.evaluate(() => {
  const G = window.game.game;
  let objects = 0;
  G.renderer.scene.traverse(() => { objects++; });
  return { effects: G.vfx.live, spikes: G.vfx.spikes.length, objects, bodies: G.physics.world.bodies.len(), frozen: G.props.instances.filter((p) => p.frozen > 0).length };
});

// Rime on the roof: Cold Stitch freezes a patch and raises spikes, then
// Icebreak drives a ridge of spikes out one by one. The restart comes
// mid-ridge, with some spikes up and the rest still on their way.
const castRime = () => page.evaluate(() => {
  const g = window.game;
  g.god(true);
  g.camera('third');
  g.look(-Math.PI / 2, -0.35);
  g.cast('secondary'); g.step(30);
  g.cast('primary'); g.step(26);
});

console.log('a rooftop restart leaves no effects');
await page.evaluate(() => { const g = window.game; g.technique('rime'); g.game.startRun({ skipTutorial: true }); g.step(10); });
await page.evaluate(() => { window.game.rooftop.begin(); window.game.step(4); });
const fresh = await world();
await castRime();
{
  const w = await world();
  check(w.effects > 20 && w.spikes > 0, `Rime's casts are in the world before the restart (${w.effects} effects, ${w.spikes} ice spikes)`);
  await shot('01-roof-before-restart');
}
// "Climb again": the run restarts on the roof.
await page.evaluate(() => { window.game.rooftop.begin(); window.game.step(1); });
{
  const w = await world();
  check(w.effects === 0 && w.spikes === 0, `"Climb again" leaves no effect from the last run (${w.effects} effects, ${w.spikes} ice spikes)`);
  check(w.objects === fresh.objects && w.bodies === fresh.bodies, `the scene is as a fresh run left it (${w.objects}/${fresh.objects} objects, ${w.bodies}/${fresh.bodies} bodies)`);
  await page.evaluate(() => window.game.step(90));
  const later = await world();
  check(later.spikes === 0, `no spike from the last run's ridge grows in afterwards (${later.spikes})`);
  await shot('02-roof-after-restart');
}
// Leaving the roof for the yard mid-run is a restart too.
await castRime();
await page.evaluate(() => { window.game.game.startRun({ skipTutorial: true }); window.game.step(1); });
{
  const w = await world();
  check(w.effects === 0 && w.spikes === 0, `a new run in the yard leaves no effect from the roof (${w.effects} effects, ${w.spikes} ice spikes)`);
  await page.evaluate(() => window.game.step(90));
  check((await world()).spikes === 0, 'and none grows in afterwards');
}

console.log('\nthe frozen pond thaws with its scene');
await page.evaluate(() => { const g = window.game; g.game.startRun({ skipTutorial: true }); g.step(4); });
const yard = await world();
await page.evaluate(() => {
  const g = window.game;
  g.teleport('pond'); g.camera('third'); g.step(10);
  // Aim Cold Stitch down at the middle of the pond.
  const G = g.game, p = G.player.eye(), c = G.world.pond.center;
  g.look(Math.atan2(-(c.x - p.x), -(c.z - p.z)), Math.atan2(G.world.pond.surfaceY - p.y, Math.hypot(c.x - p.x, c.z - p.z)));
  g.cast('secondary'); g.step(30);
});
{
  const w = await world();
  check(w.bodies > yard.bodies, `Cold Stitch freezes the pond into a floor (${w.bodies - yard.bodies} body added)`);
  await shot('03-pond-frozen');
}
await page.evaluate(() => { window.game.rooftop.begin(); window.game.step(1); window.game.game.startRun({ skipTutorial: true }); window.game.step(1); });
{
  const w = await world();
  check(w.bodies === yard.bodies && w.effects === 0 && w.frozen === 0, `the floor, its frost and every frozen prop are gone after the scene ends (${w.bodies}/${yard.bodies} bodies, ${w.frozen} frozen props)`);
}

console.log('\nthe welcome toast shows once per run');
await page.evaluate(() => { const g = window.game.game; g.startRun({ skipTutorial: true }); window.game.step(2); g.startRun({ skipTutorial: true }); window.game.step(2); });
{
  const texts = await page.locator('.toast').allTextContents();
  const welcome = texts.filter((t) => /The compound is yours/.test(t));
  check(welcome.length === 1 && new Set(texts).size === texts.length, `a run restarted at once shows "The compound is yours" once (${texts.length} toasts: ${texts.join(' | ')})`);
}

console.log("\nthe Master's field indoors");
// Indoors, a third of the way across the hall from the Master, with the
// camera turned away from her: the camera sits in her field, the player
// does not. The frame must not change when her field comes up.
const hallFrame = async (name) => {
  const buf = await page.screenshot({ animations: 'disabled', clip: { x: 0, y: 300, width: 540, height: 260 } });
  writeFileSync(join(out, `04-hall-field-${name}.png`), buf);
  return sharp(buf).raw().toBuffer();
};
await page.evaluate(() => {
  const g = window.game, G = g.game;
  G.startRun({ skipTutorial: true }); g.god(true); g.encounter('ancient'); g.step(5);
  const boss = G.encounters.enemies.find((e) => e.def.ai === 'ancient');
  boss.frozen = 1e6;
  g.teleport([boss.position.x + 8.6, 0.3, boss.position.z + 1.5]);
  g.camera('third');
  g.look(-Math.PI / 2, -0.12);
  // Long enough for her field to open fully and the camera to settle.
  g.step(150);
});
{
  const on = await hallFrame('on');
  // The same frame two steps later with her field dropped.
  await page.evaluate(() => { const g = window.game; const boss = g.game.encounters.enemies.find((e) => e.def.ai === 'ancient'); boss.aura.active = false; boss.aura.radius = 0; g.step(2); });
  const off = await hallFrame('off');
  await page.evaluate(() => { const g = window.game; const boss = g.game.encounters.enemies.find((e) => e.def.ai === 'ancient'); boss.aura.active = true; g.step(150); });
  const s = await page.evaluate(() => {
    const G = window.game.game;
    const boss = G.encounters.enemies.find((e) => e.def.ai === 'ancient');
    return { r: boss.aura.radius, player: boss.position.distanceTo(G.player.position), camera: boss.center().distanceTo(G.renderer.camera.position) };
  });
  check(s.r > 6 && s.r < 9, `her field closes in to fit the hall (radius ${s.r.toFixed(1)} m)`);
  check(s.camera < s.r && s.player > s.r, `the camera is inside her field (${s.camera.toFixed(1)} m) and the player is not (${s.player.toFixed(1)} m)`);
  let sum = 0;
  for (let i = 0; i < on.length; i++) sum += Math.abs(on[i] - off[i]);
  const mean = sum / on.length;
  check(mean < 1.5, `her field does not tint the frame of a player outside it (mean change ${mean.toFixed(2)} of 255)`);
  await shot('04-hall-field-outside');
  // Step into her field: now it tints.
  await page.evaluate(() => { const g = window.game, G = g.game; const boss = G.encounters.enemies.find((e) => e.def.ai === 'ancient'); g.teleport([boss.position.x + 3.5, 0.3, boss.position.z + 1.5]); g.step(30); });
  const side = await page.evaluate(() => window.game.game.aura.bossShell.material.side);
  check(side === 2, 'inside her field, its far wall draws and tints the frame');
  await shot('05-hall-field-inside');
}

const pageErrors = await page.evaluate(() => window.game.errors);
errors.push(...pageErrors.map((e) => `window: ${e}`));
writeFileSync(join(out, 'report.json'), JSON.stringify({ url, failures, errors }, null, 2));
console.log(`\n${failures.length} failures, ${errors.length} page errors -> ${join(out, 'report.json')}`);
for (const e of errors.slice(0, 20)) console.log('  ERROR', e);
await browser.close();
stop();
process.exit(failures.length || errors.length ? 1 : 0);
