#!/usr/bin/env node
// Proves Electro's rules in play and saves frame strips of every Ability
// from the top-down camera and over the shoulder (issue #19). A discharge
// runs as a chain to where it is aimed, as the preview shows it, paying
// charge for each metre of air past a short free gap and stopping short when
// it runs out; bodies on the line are stung, the end takes the blow. Routes
// make it stronger: a touch, a pot, the pond and a frost patch's meltwater
// carry it, and the pond takes everyone in it, the caster too. Charge also
// comes from blows taken and from running. The last section plays the same
// moments with the real cursor, button and keys in the top-down view. A pot the current ends in holds it for the next body.
// Impact Conversion turns only the blow that lands in its moment into
// charge, and only so much of it. Self-Supply strains the body and stops
// when it is spent. Spamming a discharge can't hold a body: its seize runs
// through the same chain as Rime's freeze. Charge leaks, faster in water,
// and nothing round-trips into more than went in. The Kuroda's fuel lights
// from a spark. Closed Circuit plays its cutscene and runs through the pond.
// Usage: node tools/check-electro.mjs [url] [--port 4173] [--out captures/electro] [--no-shots]
// Without a URL it serves dist/ itself (run `npm run build` first).
import { chromium } from 'playwright';
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveTarget } from './lib/target.mjs';

const { url, args, stop } = await resolveTarget();
const out = args.out ?? 'captures/electro';
const shots = args['no-shots'] !== 'true';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|WebGL|GPU stall|Automatic fallback/.test(m.text())) errors.push(`console: ${m.text()}`); });
const failures = [];
const check = (ok, what) => { if (!ok) failures.push(what); console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const api = (fn, ...a) => page.evaluate(([f, ...rest]) => { const g = window.game; return new Function('g', 'a', `return (${f})(g, ...a)`)(g, rest); }, [fn.toString(), ...a]);
const step = (n) => api((g, n) => g.step(n, 1 / 60), n);

// In by the title with real keys: Begin takes the focus, Enter opens the
// Technique select, Electro is picked and the tutorial skipped by clicks.
await page.goto(`${url}?debug`);
await page.waitForFunction(() => window.game?.game?.ready, null, { timeout: 180000 });
await page.waitForFunction(() => document.activeElement?.textContent === 'Begin', null, { timeout: 20000 });
await page.keyboard.press('Enter');
await page.locator('.card', { hasText: 'Electro' }).click();
await page.getByRole('button', { name: 'Skip tutorial' }).click();
await page.waitForFunction(() => window.game.state() === 'explore', null, { timeout: 10000 });
await api((g) => g.loop(false));

// A fresh scene: Electro in hand, god mode, the catalogue Pacts bound.
const fresh = (at = [0, 0, 7], view = 'third') => api((g, at, view) => {
  const G = g.game;
  G.startRun({ skipTutorial: true }); g.god(true); g.technique('electro'); g.step(5);
  G.encounters.reset(); G.mastery.reset?.();
  for (const p of window.__spawned ?? []) G.props.remove(p);
  window.__spawned = [];
  g.teleport(at); g.camera(view); g.step(10);
  G.techniques.resource = 0; G.techniques.strain = 0;
}, at, view);
// A body that stands where it is put and never attacks.
const body = (at, key = 'thug') => api((g, at, key) => {
  const G = g.game, V = G.player.position.constructor;
  const e = G.encounters.spawn(key, new V(...at));
  e.attackCd = 1e9; e.castCd = 1e9; e.field = null; e.locked = 1e9;
  return G.encounters.enemies.indexOf(e);
}, at, key);
const hp = () => api((g) => g.game.encounters.enemies.map((e) => Math.round(e.hp)));
// Faces a point: over the shoulder by turning, top-down by the cursor.
const face = (at, pitch = -0.12) => api((g, at, pitch) => {
  const G = g.game, V = G.player.position.constructor, p = G.player.position;
  g.look(Math.atan2(-(at[0] - p.x), -(at[2] - p.z)), pitch);
  // Twice, so the cursor is placed through the camera as it settles, not as it was.
  for (let i = 0; i < 2; i++) {
    const ndc = new V(...at).project(G.renderer.camera);
    G.input.mouse.x = ndc.x; G.input.mouse.y = ndc.y;
    g.step(30);
  }
}, at, pitch);
const cast = (slot) => api((g, s) => { g.game.techniques.cast(s, true); }, slot);
// Steps until the cast in flight has fired.
const fire = async () => { for (let i = 0; i < 60; i++) { if (await api((g) => !g.game.techniques.current || g.game.techniques.current.fired)) return; await step(1); } };

const strips = [];
async function strip(name, frames, every = 3, start) {
  if (!shots) { if (start) await start(); await step(frames * every); return; }
  const tiles = [];
  if (start) await start();
  for (let i = 0; i < frames; i++) {
    await step(every);
    tiles.push(await sharp(await page.screenshot({ animations: 'disabled' })).resize(480, 270).png().toBuffer());
  }
  const file = join(out, `${name}.png`);
  const cols = Math.min(tiles.length, 4), rows = Math.ceil(tiles.length / cols);
  await sharp({ create: { width: 480 * cols, height: 270 * rows, channels: 3, background: '#000' } }).composite(tiles.map((b, i) => ({ input: b, left: (i % cols) * 480, top: Math.floor(i / cols) * 270 }))).png().toFile(file);
  strips.push(file);
}

const P = await api((g) => { const p = g.game.world.pond; return { x: p.center.x, z: p.center.z, r: p.radius, y: p.surfaceY }; });

// ------------------------------------------------------------------ the chain
console.log('\na discharge runs to where it is aimed, as far as the charge carries it');
await fresh();
await body([0, 0, 2.5]);
await api((g) => { g.game.techniques.resource = 60; });
await face([0, 1, 2.5]);
await cast('primary'); await fire(); await step(20);
let s = await api((g) => ({ res: g.game.techniques.resource, hp: g.game.encounters.enemies[0].hp, last: g.electro().last }));
check(s.hp < 50 && s.last.ended === 'body', `the body 4.5 m off at the crosshair takes it (${s.hp.toFixed(0)} left, ended on ${s.last.ended})`);
check(s.last.cost > 0 && 60 - s.res > 30, `past the free gap the air costs charge (${s.last.cost.toFixed(1)} for the air, ${(60 - s.res).toFixed(1)} spent)`);
await fresh([0, 0, 9], 'top');
for (const at of [[0.3, 0, 5.2], [-0.4, 0, 1.4], [0.2, 0, -2.2], [3.2, 0, 1.5]]) await body(at);
await api((g) => { g.game.techniques.resource = 100; });
await face([0.2, 0, -2.2]);
await step(4);
const shown = await api((g) => g.electro().aim);
await cast('primary'); await fire(); await step(20);
let hps = await hp();
s = await api((g) => g.electro().last);
check(!!shown && shown.ends === 'body' && shown.routes.filter((r) => r === 'body').length === 3, `top-down, the preview shows the chain through three bodies to the one at the cursor (${shown?.routes.join(', ')} → ${shown?.ends})`);
check(shown && Math.abs(shown.length - s.length) < 0.6, `the cast runs where the preview showed (${shown?.length.toFixed(1)} vs ${s.length.toFixed(1)} m)`);
check(hps[0] < 70 && hps[1] < 70 && hps[2] < hps[0] && hps[3] === 70, `the bodies on the line are stung, the end takes the blow, the one off the line is spared (${hps})`);
check(await api((g) => g.electro().seizing > 0 && g.electro().scorches > 0), 'the bodies it ran through lock up, and it scorches the floor under them');
await fresh([0, 0, 9], 'top');
await body([0, 0, -6]);
await api((g) => { g.game.techniques.resource = 14; });
await face([0, 0, -6]);
await step(4);
const short = await api((g) => g.electro().aim);
await cast('primary'); await fire(); await step(20);
s = await api((g) => g.electro().last);
check(short && short.length < short.wanted - 2 && s.ended === 'floor' && (await hp())[0] === 70, `short of charge, the preview and the chain stop short of the cursor (${short?.length.toFixed(1)} of ${short?.wanted.toFixed(1)} m) and the body there is untouched`);
await fresh([0, 0, 7], 'top');
await api((g) => { g.game.techniques.resource = 60; });
await face([1, 0, 1]);
await cast('primary'); await fire(); await step(10);
s = await api((g) => g.electro().last);
check(s.ended === 'floor' && Math.abs(s.length - s.wanted) < 0.3, `with nothing at the cursor it strikes the floor there (${s.length.toFixed(1)} m)`);
// Routes make it stronger: the same blow through two pots lands harder than through air.
const throughPots = async (pots) => {
  await fresh([0, 0, 9], 'top');
  if (pots) await api((g) => { const G = g.game, V = G.player.position.constructor; window.__spawned.push(G.props.spawn('pot', new V(0, 0.05, 5.0)), G.props.spawn('pot', new V(0.2, 0.05, 1.6))); });
  await body([0, 0, -1.6]);
  await api((g) => { g.game.techniques.resource = 100; });
  await face([0, 0, -1.6]);
  await cast('primary'); await fire(); await step(20);
  return { hp: (await hp())[0], last: await api((g) => g.electro().last) };
};
const bare = await throughPots(false), potted = await throughPots(true);
check(potted.hp < bare.hp && potted.last.cost < bare.last.cost, `through two pots it costs less and lands harder (${70 - bare.hp} through air for ${bare.last.cost.toFixed(1)}, ${70 - potted.hp} through metal for ${potted.last.cost.toFixed(1)})`);

console.log('\ncharge comes in more ways than the two Abilities');
await fresh([0, 0, 7]);
await api((g) => { g.god(false); g.game.combat.invuln = 0; });
const struck = await api((g) => { const G = g.game, V = G.player.position.constructor; const r0 = G.techniques.resource; G.combat.hurtPlayer(16, { from: new V(0, 1, 5.6), kinetic: true }); return G.techniques.resource - r0; });
check(struck >= 7, `a blow taken unready still leaves charge in the body (${struck.toFixed(1)})`);
await fresh([0, 0, 7], 'top');
await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft');
await step(150);
await page.keyboard.up('ShiftLeft'); await page.keyboard.up('KeyW');
const stat = await api((g) => g.game.techniques.resource);
check(stat > 6 && stat <= 30.5, `running builds static, as far as static goes (${stat.toFixed(1)} after two and a half seconds)`);

for (const view of ['third', 'top', 'first']) {
  await fresh([0, 0, 7], view);
  await body([0.45, 0, 5.85]);
  await api((g) => { g.game.techniques.resource = 100; });
  await face([0.45, 1, 5.85]);
  await step(20);
  const before = await hp();
  await strip(`discharge-touch-${view}`, 8, 3, () => cast('primary'));
  const after = await hp();
  s = await api((g) => ({ res: g.game.techniques.resource }));
  check(after[0] < before[0] - 15, `${view}: a touch discharge lands (${before[0]} → ${after[0]})`);
  check(s.res <= 71 && s.res >= 68, `${view}: it draws at most 30 Charge (left ${s.res.toFixed(1)})`);
}

console.log('\nmetal carries it on, and holds what it ends in');
await fresh([0, 0, 7]);
await api((g) => { const G = g.game, V = G.player.position.constructor; window.__spawned.push(G.props.spawn('pot', new V(0, 0, 5.8))); });
await body([0, 0, 4.2]);
await api((g) => { g.game.techniques.resource = 100; });
await face([0, 0.4, 5.8], -0.25);
await step(20);
let before = await hp();
await strip('discharge-pot-third', 8, 3, () => cast('primary'));
let after = await hp();
check(after[0] < before[0], `through a pot to a body 1.6 m past it (${before[0]} → ${after[0]})`);
await fresh([0, 0, 7], 'top');
await api((g) => { const G = g.game, V = G.player.position.constructor; window.__spawned.push(G.props.spawn('pot', new V(0, 0, 5.3))); });
await api((g) => { g.game.techniques.resource = 100; });
await face([0, 0.2, 5.3]);
await step(20);
await strip('pot-holds-top', 4, 4, () => cast('primary'));
let held = await api((g) => g.electro().held);
check(held.length === 1 && held[0].charge > 5, `a pot the current ends in holds it (${held.map((h) => h.charge.toFixed(1)).join(', ')})`);
await body([1.0, 0, 5.3]);
await step(10);
after = await hp();
held = await api((g) => g.electro().held);
check(after[0] < 70 && held.length === 0, `the next body to touch it takes it (${after[0]})`);
// No loop: what a pot gives back is less than what went in.
await api((g) => { g.game.encounters.reset(); g.game.techniques.resource = 30; });
await cast('primary'); await fire(); await step(10);
const put = 30 - (await api((g) => g.game.techniques.resource));
const kept = (await api((g) => g.electro().held)).reduce((a, h) => a + h.charge, 0);
await api((g) => { g.game.techniques.resource = 0; });
await api((g) => { g.teleport([0, 0, 6.9]); });
await cast('art1'); await fire(); await step(10);
const back = await api((g) => g.game.techniques.resource);
check(put > 0 && kept > 0 && back < put, `a pot gives back less than went into it (${put.toFixed(1)} in, ${kept.toFixed(1)} held, ${back.toFixed(1)} back)`);

console.log('\nthe pond takes everyone in it, the caster too');
for (const view of ['third', 'top']) {
  await fresh([P.x, 0.25, P.z + 3.4], view);
  await body([P.x + 0.9, -0.9, P.z - 0.7]);
  await body([P.x - 1.3, -0.9, P.z + 0.9]);
  await body([P.x + 4.5, 0, P.z + 3.6]);
  await api((g) => { g.game.techniques.resource = 100; });
  await face([P.x, P.y, P.z + 2.1], -0.95);
  await step(20);
  before = await hp();
  const hpBefore = await api((g) => g.game.combat.hp);
  await api((g) => { g.god(false); });
  await strip(`discharge-pond-${view}`, 8, 3, () => cast('primary'));
  after = await hp();
  const hpAfter = await api((g) => g.game.combat.hp);
  check(after[0] < before[0] && after[1] < before[1], `${view}: both bodies in the water take it (${before.slice(0, 2)} → ${after.slice(0, 2)})`);
  check(after[2] === before[2], `${view}: the dry body beside the pond does not`);
  check(hpAfter === hpBefore, `${view}: the caster on the dry rim is not hurt (${hpBefore} → ${hpAfter})`);
}
// Wading in: the current goes down through the caster too.
await fresh([P.x - 1.6, -0.9, P.z - 1.4], 'third');
await body([P.x + 0.9, -0.9, P.z - 0.7]);
await api((g) => { g.god(false); g.game.techniques.resource = 100; });
await face([P.x + 0.9, 0.2, P.z - 0.7]);
await step(5);
let hp0 = await api((g) => g.game.combat.hp);
await strip('discharge-wading-third', 8, 3, () => cast('primary'));
let hp1 = await api((g) => g.game.combat.hp);
check(hp1 < hp0, `standing in the pond, the caster takes their own current (${hp0} → ${hp1.toFixed(1)})`);
// And charge runs out into water you stand in.
await api((g) => { g.game.techniques.resource = 80; });
await step(60);
const wetLeak = 80 - (await api((g) => g.game.techniques.resource));
await api((g) => { g.teleport([0, 0, 7]); g.game.techniques.resource = 80; });
await step(60);
const dryLeak = 80 - (await api((g) => g.game.techniques.resource));
check(wetLeak > dryLeak * 4 && dryLeak > 0, `charge leaks, and far faster in water (${dryLeak.toFixed(1)} vs ${wetLeak.toFixed(1)} a second)`);

console.log('\nRime ice carries nothing; meltwater does');
await fresh([P.x, 0.25, P.z + 3.4], 'third');
await api((g) => g.ice(20));
{
  await body([P.x + 0.9, -0.9, P.z - 0.7]);
  await api((g) => { g.game.techniques.resource = 100; });
  await face([P.x, P.y, P.z + 2.1], -0.95);
  await step(20);
  check(!(await api((g) => g.electro().pondLive)), 'the frozen pond reads as ice');
  before = await hp();
  await cast('primary'); await fire(); await step(20);
  after = await hp();
  check(after[0] === before[0], `a body under the ice is not reached through it (${before[0]} → ${after[0]})`);
}
await fresh([0, 0, 8], 'third');
await api((g) => { g.eye('vault', { vault: 'rime' }); });
await face([0, 0, 2]);
await step(5);
await api((g) => g.castVault());
await step(90);
const frost = await api((g) => g.game.vfx.patchesUnder(new g.game.player.position.constructor(0, 0, 5), 'frost', 0.4).length);
check(frost > 0, `the Vault's Rime leaves frost on the paving (${frost} patches)`);
await body([0, 0, 5.2]);
await body([0, 0, 4.0]);
await api((g) => { g.eye(null); g.teleport([0, 0, 6.5]); g.game.techniques.resource = 100; });
await face([0, 1, 5.2]);
await step(5);
before = await hp();
await strip('discharge-melt-third', 6, 3, () => cast('primary'));
after = await hp();
check(after[0] < before[0] && after[1] < before[1], `two bodies on one frost patch, 1.2 m apart, both take it (${before} → ${after})`);

// ------------------------------------------------------------------ conversion and supply
console.log('\nImpact Conversion takes in only the blow in its moment');
for (const view of ['third', 'top', 'first']) {
  await fresh([0, 0, 7], view);
  await body([0, 0, 5.6]);
  await face([0, 1, 5.6]);
  await api((g) => { g.god(false); });
  await step(10);
  const blow = () => api((g) => { const G = g.game, V = G.player.position.constructor; return G.combat.hurtPlayer(20, { from: new V(0, 1, 5.6), kinetic: true }); });
  const open = await api(async (g) => { g.game.techniques.cast('secondary', true); for (let i = 0; i < 30 && !g.game.techniques.current?.fired; i++) g.step(1); return g.electro().open; });
  const through = await blow();
  const charged = await api((g) => g.game.techniques.resource);
  check(open > 0.3 && through < 20 && charged > 10, `${view}: a blow in the moment becomes charge (${(20 - through).toFixed(1)} taken in, ${charged.toFixed(1)} Charge, ${through.toFixed(1)} lands)`);
  await strip(`convert-${view}`, 6, 3);
  await step(60);
  const late = await blow();
  check(late >= 20, `${view}: a blow after the moment lands whole (${late.toFixed(1)})`);
  await step(30);
}
await api((g) => { const G = g.game; G.techniques.resource = 0; G.combat.invuln = 0; G.techniques.cast('secondary', true); for (let i = 0; i < 30 && !G.techniques.current?.fired; i++) g.step(1); });
const big = await api((g) => { const G = g.game, V = G.player.position.constructor; return G.combat.hurtPlayer(80, { from: new V(0, 1, 5.6), kinetic: true }); });
check(big > 50, `a violent blow is more than the hands take in at once (${big.toFixed(1)} of 80 lands)`);
// Full: the catalogue Pact earths what does not fit; a draft without it takes it through the body.
await step(60);
await api((g) => { const G = g.game; G.techniques.resource = 100; G.combat.invuln = 0; G.techniques.cast('secondary', true); for (let i = 0; i < 30 && !G.techniques.current?.fired; i++) g.step(1); });
hp0 = await api((g) => g.game.combat.hp);
await api((g) => { const G = g.game, V = G.player.position.constructor; return G.combat.hurtPlayer(10, { from: new V(0, 1, 5.6) }); });
hp1 = await api((g) => g.game.combat.hp);
check(hp0 - hp1 < 1, `full, Impact Conversion sends the overflow to the ground (${(hp0 - hp1).toFixed(1)} lost)`);
await step(60);
await api((g) => {
  const G = g.game;
  G.book.preview.value = { id: 'draft.convert', technique: 'electro', name: 'Bare Hands', slot: 'secondary', grant: { shape: 'convert' }, clauses: [{ kind: 'restrict', restriction: { param: 'direction', value: 'front' } }] };
  G.techniques.resource = 100; G.combat.invuln = 0; G.techniques.cast('secondary', true); for (let i = 0; i < 30 && !G.techniques.current?.fired; i++) g.step(1);
});
hp0 = await api((g) => g.game.combat.hp);
await api((g) => { const G = g.game, V = G.player.position.constructor; return G.combat.hurtPlayer(10, { from: new V(0, 1, 5.6) }); });
hp1 = await api((g) => g.game.combat.hp);
check(hp0 - hp1 >= 2, `without a hand to the ground the overflow goes through the body (${(hp0 - hp1).toFixed(1)} lost)`);
await api((g) => { g.game.book.preview.value = null; });

console.log('\nSelf-Supply burns the body, and stops when it is spent');
for (const view of ['third', 'top', 'first']) {
  await fresh([0, 0, 7], view);
  await face([0, 1, 3]);
  await step(10);
  await strip(`supply-${view}`, 8, 4, () => cast('art1'));
  s = await api((g) => ({ res: g.game.techniques.resource, strain: g.game.techniques.strain }));
  check(s.res > 20 && s.strain > 0.15, `${view}: Charge from the body, paid in strain (${s.res.toFixed(1)} Charge, strain ${s.strain.toFixed(2)})`);
}
const gains = [];
for (let i = 0; i < 8; i++) {
  const r0 = await api((g) => { g.game.techniques.resource = 0; return g.game.techniques.strain; });
  await cast('art1'); await fire(); await step(30);
  gains.push([+(await api((g) => g.game.techniques.resource)).toFixed(1), +r0.toFixed(2)]);
}
console.log(`    gains by strain: ${gains.map(([c, st]) => `${c} at ${st}`).join(', ')}`);
check(gains[1][0] < gains[0][0], 'each draw in a row yields less');
check(gains.at(-1)[0] < 1, 'a spent body gives nothing more');

// ------------------------------------------------------------------ no lock
console.log('\nspamming a seizing discharge cannot hold a body');
for (const key of ['thug', 'kuroda']) {
  await fresh([0, 0, 7]);
  await body([0, 0, 5.7], key);
  await face([0, 1, 5.7]);
  const r = await api((g) => {
    const G = g.game, e = G.encounters.enemies[0];
    let frozenFor = 0, run = 0, longest = 0, free = 0, longestFree = 0;
    for (let f = 0; f < 60 * 20; f++) {
      e.position.set(0, e.position.y, 5.7); e.hp = e.maxHp;
      G.techniques.resource = 100;
      G.techniques.cast('primary');
      // Measured in game time: a hit-stop holds the body and its hold together.
      const t0 = G.clock.time;
      g.step(1);
      const dt = G.clock.time - t0;
      if (e.frozen > 0) { frozenFor += dt; run += dt; longest = Math.max(longest, run); free = 0; } else { run = 0; free += dt; longestFree = Math.max(longestFree, free); }
    }
    return { frozenFor, longest, longestFree };
  });
  check(r.longest < 1, `${key}: never seized past one hold (${r.longest.toFixed(2)} s at most)`);
  check(r.frozenFor < 20 * 0.25, `${key}: seized ${r.frozenFor.toFixed(1)} of 20 s`);
  check(r.longestFree > 5, `${key}: walks free once the chain runs out (${r.longestFree.toFixed(1)} s)`);
}

// ------------------------------------------------------------------ fire
console.log('\na spark lights the Kuroda\'s waiting fuel');
await fresh([0, 0, 7]);
const lit = await api((g) => {
  const G = g.game, V = G.player.position.constructor;
  g.encounter('kuroda');
  const k = G.encounters.enemies.find((e) => e.def.ai === 'kuroda');
  if (!k) return { ok: false, why: 'no Kuroda' };
  k.position.set(0, 0, 0); k.castCd = 0; k.attackCd = 1e9;
  g.teleport([0, 0, 7]);
  for (let i = 0; i < 240 && !k.pour.length; i++) g.step(1);
  // Hold him before the snap, so only a spark from outside can light it.
  const pools = k.pour.map((p) => p.clone());
  if (!pools.length) return { ok: false, why: 'no pour' };
  k.locked = 1e6;
  return { ok: true, pools: pools.map((p) => [p.x, p.y, p.z]) };
});
if (lit.ok) {
  const pool = lit.pools[0];
  await api((g, p) => { g.teleport([p[0], 0, p[2] + 1.6]); g.god(true); g.game.techniques.resource = 100; }, pool);
  await face(pool, -0.95);
  const n0 = await api((g) => g.game.encounters.enemies.find((e) => e.def.ai === 'kuroda').pour.length);
  await cast('primary'); await fire(); await step(4);
  const n1 = await api((g) => g.game.encounters.enemies.find((e) => e.def.ai === 'kuroda').pour.length);
  check(n1 < n0, `the pool the discharge touched caught (${n0} waiting → ${n1})`);
} else console.log(`  (skipped: ${lit.why})`);

// Caught Blow: the crate drops in front; open Impact Conversion as it reaches the hands.
const catchCrate = async () => {
  // Turned to it at once: there is no time to settle the camera before it lands.
  await api((g) => {
    const G = g.game, c = G.props.instances.find((p) => p.key === 'crate'), p = G.player.position;
    if (!c) return;
    g.look(Math.atan2(-(c.mesh.position.x - p.x), -(c.mesh.position.z - p.z)), 0.1);
    const ndc = c.mesh.position.clone().setY(1).project(G.renderer.camera);
    G.input.mouse.x = ndc.x; G.input.mouse.y = ndc.y;
  });
  for (let i = 0; i < 240; i++) {
    const d = await api((g) => { const G = g.game, c = G.props.instances.find((p) => p.key === 'crate' && p.body.linvel().y < -2); return c ? c.mesh.position.distanceTo(G.player.eye()) : null; });
    if (d !== null && d < 4) { await cast('secondary'); await fire(); await step(20); return true; }
    await step(1);
  }
  return false;
};

// ------------------------------------------------------------------ the tutorial
console.log('\nthe tutorial\'s Reserve step, with Electro');
await api((g) => { const G = g.game; G.techniques.resource = 0; g.technique('electro'); G.startRun(); g.teleport('courtyard'); g.camera('third'); g.god(true); g.tutorialStep('reserve'); g.step(10); });
check(await page.evaluate(() => /as the crate reaches you/.test(document.body.innerText) && !/Hold right click as the crate/i.test(document.body.innerText)), 'the card asks to meet the crate, not to hold the key');
let caught = false;
for (let i = 0; i < 4 && !caught; i++) {
  await catchCrate();
  await step(30);
  caught = await api((g) => g.game.tutorial.stepId !== 'reserve');
}
check(caught, `Impact Conversion on a falling crate clears the step (now at "${await api((g) => g.game.tutorial.stepId)}")`);
await api((g) => g.game.tutorial.skip());

// ------------------------------------------------------------------ the drill
console.log('\nWet Stone, tier by tier');
await fresh([P.x, 0, P.z - 5.4]);
await api((g) => { const m = g.game.mastery; m.stats.value = { ...m.stats.value, electro: Object.fromEntries(Object.keys(m.stats.value.electro).map((k) => [k, 0])) }; });
const stone = () => api((g) => g.wetStone());
const running = () => api((g) => g.game.drills.running);
// Gets the lit figure into a discharge's reach by the route the tier allows:
// a dry one up close, a figure in the water through the water from the dry
// rim (never wading in, which the clean tiers spoil).
const reachLit = async () => {
  const v = await stone();
  if (v.lit < 0) return false;
  const s = v.spots[v.lit];
  if (s[1] < 0) {
    await api((g, P) => { g.teleport([P.x + 0.2, 0.25, P.z + 3.4]); }, P);
    await face([P.x + 0.2, P.y, P.z + 2.2], -0.95);
  } else {
    // From the side away from the pond, clear of the pot that stands between it and the station.
    const away = Math.sign(s[2] - P.z) || 1;
    await api((g, at) => g.teleport(at), [s[0], 0, s[2] + away * 1.3]);
    await face([s[0], 1, s[2]]);
  }
  return true;
};
const waitLit = async () => { for (let i = 0; i < 600; i++) { if ((await stone()).lit >= 0 || !(await running())) return; await step(2); } };
const waitDone = async (lit) => { for (let i = 0; i < 600; i++) { if ((await stone()).lit !== lit || !(await running())) return; await step(2); } };
const tierStats = [['output', 'activation', 'range'], ['precision', 'control'], ['speed', 'tolerance', 'efficiency']];
for (let tier = 0; tier < 3; tier++) {
  const opened = await api((g) => { g.drill('electro-wet-stone'); return g.game.drills.reached('electro-wet-stone'); });
  check(opened === tier, `the drill opens on tier ${tier + 1}`);
  let guard = 0;
  while ((await running()) && guard++ < 10) {
    await waitLit();
    const v = await stone();
    if (v.lit < 0) break;
    if (tier === 2) {
      const met = await catchCrate();
      const got = await api((g) => g.game.techniques.resource);
      check(met && got > 10, `Caught Blow: the crate is met as it falls and becomes Charge (${got.toFixed(1)})`);
    }
    await reachLit();
    await cast('primary'); await fire();
    await waitDone(v.lit);
    // Back to the mark before the next item, so the next crate falls on open paving, not on a pot.
    await api((g, at) => { g.teleport(at); g.look(0, 0); }, v.station);
  }
  const st = await api((g) => g.game.mastery.stats.value.electro);
  const reached = await api((g) => g.game.drills.reached('electro-wet-stone'));
  check(tierStats[tier].every((k) => st[k] > 0.5), `tier ${tier + 1} cleared raises ${tierStats[tier].join(', ')} (${tierStats[tier].map((k) => st[k].toFixed(2)).join(' ')}; reached ${reached})`);
  if (tier === 0 && shots) {
    await api((g) => { g.drill('electro-wet-stone'); });
    await step(80);
    await api((g, P) => { g.teleport([P.x, 0, P.z - 6.6]); g.camera('top'); }, P);
    await step(40);
    await strip('drill-wet-stone-top', 1, 1);
    await api((g, P) => { g.camera('third'); g.teleport([P.x, 0, P.z - 8]); g.look(Math.PI, -0.25); }, P);
    await step(40);
    await strip('drill-wet-stone-third', 1, 1);
    await api((g) => g.quitDrill());
  }
}
// In Clean Line, wading in to reach a figure in the water spoils it: the current runs through you.
// The score the drill panel shows: its first number.
const score = () => page.evaluate(() => (document.querySelector('.drill-hud .big')?.textContent ?? '').trim().split(/\s/)[0]);
let spoiled = null;
for (let n = 0; n < 16 && spoiled === null; n++) {
  if (!(await running())) await api((g) => { g.game.drills.progress['electro-wet-stone'] = 1; g.drill('electro-wet-stone'); });
  await waitLit();
  const v = await stone();
  if (v.lit < 0) break;
  const s = v.spots[v.lit];
  if (s[1] >= 0) { await reachLit(); await cast('primary'); await fire(); await waitDone(v.lit); continue; }
  const was = await score();
  await api((g, s) => { g.teleport([s[0] - 1.2, -0.9, s[2]]); }, s);
  await face([s[0], 0.2, s[2]]);
  await cast('primary'); await fire();
  await waitDone(v.lit);
  const now = await score();
  console.log(`    waded in: score ${was} → ${now}`);
  spoiled = now === was;
}
check(spoiled === true, 'in Clean Line, a figure in the water reached by wading in does not count');
await api((g) => g.quitDrill());

// ------------------------------------------------------------------ sign and Maximum Output
console.log('\nthe sign and Closed Circuit');
for (const view of ['third', 'top', 'first']) {
  await fresh([0, 0, 7], view);
  await face([0, 1, 3]);
  await step(10);
  await strip(`sign-${view}`, 8, 12, () => api((g) => g.game.techniques.beginSign()));
}
for (const view of ['third', 'top']) {
  await fresh([P.x, 0.25, P.z + 3.6], view);
  await body([P.x + 0.3, -0.9, P.z + 1.9]);
  await body([P.x - 1.3, -0.9, P.z - 0.9]);
  await body([P.x + 1.2, -0.9, P.z - 1.6]);
  await api((g) => { g.game.techniques.resource = 100; });
  await face([P.x, 1, P.z]);
  before = await hp();
  const d = (await api((g) => g.cutscenes())).defs['max-electro'];
  await api((g) => g.cutscene('max-electro'));
  const want = [0.45, 0.8, d.beat - 0.12, d.beat + 0.02, d.beat + 0.12, d.beat + 0.4, d.total - 0.3];
  const tiles = [];
  for (let n = 0; n < 900 && want.length; n++) {
    const v = await api((g) => ({ t: g.game.cutscenes.timeline?.t ?? null, active: g.game.cutscenes.active }));
    if (!v.active) break;
    if (v.t >= want[0]) { want.shift(); if (shots) tiles.push(await sharp(await page.screenshot({ animations: 'disabled' })).resize(480, 270).png().toBuffer()); }
    await step(1);
  }
  await step(50);
  if (shots) {
    tiles.push(await sharp(await page.screenshot({ animations: 'disabled' })).resize(480, 270).png().toBuffer());
    const file = join(out, `max-${view}.png`);
    await sharp({ create: { width: 480 * 4, height: 270 * 2, channels: 3, background: '#000' } }).composite(tiles.map((b, i) => ({ input: b, left: (i % 4) * 480, top: Math.floor(i / 4) * 270 }))).png().toFile(file);
    strips.push(file);
  }
  after = await hp();
  check(after.every((h, i) => h < before[i]), `${view}: Closed Circuit runs through the target and on through the pond (${before} → ${after})`);
  s = await api((g) => ({ res: g.game.techniques.resource, active: g.game.cutscenes.active }));
  check(s.res === 0 && !s.active, `${view}: it spends every bit of Charge and hands the camera back`);
}

// ------------------------------------------------------------------ played
// The same moments as a player meets them: top-down, the real cursor moved
// over the target, the real left button and keys. Each strip starts on the
// aim preview, then runs from the frame the cast lands. Each is saved whole
// and as a full-size crop round the player.
console.log('\nplayed with the mouse, top-down');
const cursorTo = async (at) => {
  for (let i = 0; i < 4; i++) {
    const [x, y] = await api((g, p) => { const v = new (g.game.player.position.constructor)(...p).project(g.game.renderer.camera); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; }, at);
    await page.mouse.move(x, y);
    await step(12);
  }
};
const press = async (key) => { if (key === 'Mouse0') { await page.mouse.down(); await step(1); await page.mouse.up(); } else { await page.keyboard.down(key); await step(1); await page.keyboard.up(key); } };
async function played(name, frames, every, start, { fired = true, pre = 1 } = {}) {
  if (!shots) { if (start) await start(); await step(frames * every); return; }
  const tiles = [], crops = [];
  const grab = async () => {
    const shot = await page.screenshot({ animations: 'disabled' });
    const [px, py] = await api((g) => { const v = g.game.player.position.clone().setY(g.game.player.position.y + 1).project(g.game.renderer.camera); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; });
    const left = Math.round(Math.min(1280 - 640, Math.max(0, px - 320))), top = Math.round(Math.min(720 - 360, Math.max(0, py - 200)));
    tiles.push(await sharp(shot).resize(640, 360).png().toBuffer());
    crops.push(await sharp(shot).extract({ left, top, width: 640, height: 360 }).png().toBuffer());
  };
  for (let i = 0; i < pre; i++) { await grab(); await step(4); }
  if (start) await start();
  if (fired) await fire();
  for (let i = 0; i < frames; i++) { await grab(); await step(every); }
  for (const [suffix, set] of [['', tiles], ['-close', crops]]) {
    const file = join(out, `${name}${suffix}.png`);
    await sharp({ create: { width: 640 * 4, height: 360 * Math.ceil(set.length / 4), channels: 3, background: '#000' } }).composite(set.map((b, i) => ({ input: b, left: (i % 4) * 640, top: Math.floor(i / 4) * 360 }))).png().toFile(file);
    strips.push(file);
  }
}
await fresh([0, 0, 9], 'top');
for (const at of [[0.3, 0, 5.2], [-0.4, 0, 1.4], [0.2, 0, -2.2], [3.2, 0, 1.5]]) await body(at);
await api((g) => { g.game.techniques.resource = 100; });
await cursorTo([0.2, 1, -2.2]);
await played('played-chain', 11, 3, () => press('Mouse0'));
hps = await hp();
check(hps[2] < 40 && hps[3] === 70, `a click at the far body runs the chain to it (${hps})`);
await fresh([0, 0, 7], 'top');
await body([0, 0, 5.2]);
await api((g) => { g.game.techniques.resource = 60; });
await cursorTo([0, 1, 5.2]);
await played('played-close', 11, 3, () => press('Mouse0'));
check((await hp())[0] < 40, 'a click on a body a pace off lands the whole blow');
await fresh([0, 0, 9], 'top');
await api((g) => { const G = g.game, V = G.player.position.constructor; window.__spawned.push(G.props.spawn('pot', new V(0, 0.05, 5.0)), G.props.spawn('pot', new V(0.2, 0.05, 1.6))); });
await body([0, 0, -1.6]);
await body([1.3, 0, -1.0]);
await api((g) => { g.game.techniques.resource = 100; });
await cursorTo([0, 1, -1.6]);
await played('played-metal', 11, 3, () => press('Mouse0'));
hps = await hp();
check(hps.every((h) => h < 70), `through the pots to the body beyond, and on from it to its neighbour (${hps})`);
await fresh([P.x, 0.25, P.z + 4.2], 'top');
for (const at of [[P.x + 0.9, -0.9, P.z - 0.7], [P.x - 1.3, -0.9, P.z + 0.9], [P.x + 0.2, -0.9, P.z + 1.6], [P.x - 0.4, -0.9, P.z - 1.8], [P.x + 0.3, 0, P.z - 4.4]]) await body(at);
await api((g) => { g.game.techniques.resource = 100; });
await cursorTo([P.x + 0.3, 1, P.z - 4.4]);
await played('played-water', 11, 3, () => press('Mouse0'));
hps = await hp();
check(hps.every((h) => h < 70), `across the pond: everyone in the water and the body beyond (${hps})`);
await fresh([0, 0, 7], 'top');
await cursorTo([0, 1, 4]);
await played('played-charging', 8, 14, () => press('Digit1'), { fired: false, pre: 0 });
for (let i = 0; i < 2; i++) { await press('Digit1'); await step(70); }
await played('played-charged', 4, 6, null, { fired: false, pre: 0 });
check(await api((g) => g.game.techniques.resource > 60), 'three draws on the body hold over sixty Charge');
await fresh([P.x, 0.25, P.z + 3.6], 'top');
for (const at of [[P.x + 0.3, -0.9, P.z + 1.9], [P.x - 1.3, -0.9, P.z - 0.9], [P.x + 1.2, -0.9, P.z - 1.6], [P.x + 2.4, 0, P.z + 3.6]]) await body(at);
await api((g) => { g.game.techniques.resource = 100; g.game.techniques.charge = 1; });
await cursorTo([P.x, 1, P.z]);
await played('played-circuit', 16, 10, () => press('KeyQ'), { fired: false, pre: 0 });
await step(60);
await played('played-circuit-after', 4, 15, null, { fired: false, pre: 0 });
hps = await hp();
check(hps.slice(0, 3).every((h) => h < 20), `Closed Circuit, played: the bodies in the pond are spent (${hps})`);

console.log(`\nstrips:\n${strips.map((f) => `  ${f}`).join('\n')}`);
if (errors.length) { console.log(`\nerrors:\n  ${errors.slice(0, 10).join('\n  ')}`); failures.push(`${errors.length} page errors`); }
console.log(failures.length ? `\n${failures.length} FAILED` : '\nall passed');
await browser.close();
stop();
process.exit(failures.length ? 1 : 0);
