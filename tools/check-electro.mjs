#!/usr/bin/env node
// Proves Electro's rules in play and saves frame strips (issue #19). The
// right button holds a live line of current from the hand to the aim: it is
// drawn the frame the button goes down, follows the cursor while held, ends
// on the first body or solid thing or at its reach, and is gone the frame
// the button comes up. Bodies on it take it in ticks, without a hit-stop on
// each; it burns Charge by the second, more across open air, and dies with
// a clear "Out of Charge" when it runs dry. Metal by the line carries it on
// harder and forks it; a pot it ends on holds charge for the next body; the
// pond takes everyone in it, the caster too when wading; ice carries
// nothing, meltwater does. Held on a body for twenty seconds it never locks
// it. Charge also comes from blows taken and from running. Impact
// Conversion turns only the blow that lands in its moment into charge, and
// only so much of it. Self-Supply strains the body and stops when it is
// spent. The Kuroda's fuel lights from the line. Closed Circuit plays its
// cutscene and runs through the pond. The last section sweeps the line
// across two bodies with the real button held and the real mouse, top-down,
// over the shoulder and in first person, and saves those strips.
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

// ------------------------------------------------------------------ the held line
// The real right button and the real cursor, top-down: the line is there on
// the frame the button goes down, from the hand to the cursor, follows the
// cursor while it is held, and is gone the frame it comes up.
const cursorTo = async (at, settle = 12) => {
  for (let i = 0; i < 4; i++) {
    const [x, y] = await api((g, p) => { const v = new (g.game.player.position.constructor)(...p).project(g.game.renderer.camera); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; }, at);
    await page.mouse.move(x, y);
    await step(settle);
    if (!settle) break;
  }
};
let s, before, after;
const line = () => api((g) => g.electro().line);
// The live current as the effect pool draws it, and how far its start is from the body's right hand.
const drawn = () => api((g) => {
  const G = g.game, c = G.vfx.liveCurrents, hand = G.avatar.boneWorld('hand_r', G.player.position.clone());
  return c.map((x) => ({ ...x, fromHand: Math.hypot(x.from[0] - hand.x, x.from[1] - hand.y, x.from[2] - hand.z) }));
});
// Holds the line through the debug input (a right button held down), for `frames`.
const held = async (frames, every = 1, read) => {
  await api((g) => g.hold('secondary', true));
  const out = [];
  for (let f = 0; f < frames; f += every) { await step(every); if (read) out.push(await api(read)); }
  return out;
};
const letGo = async (n = 1) => { await api((g) => g.hold('secondary', false)); await step(n); };

console.log('\nthe right button holds a live line from the hand to the cursor');
await fresh([0, 0, 9], 'top');
await body([0, 0, 4]);
await api((g) => { g.game.techniques.resource = 100; });
await cursorTo([0, 0.9, 4]);
const idle = { line: await line(), drawn: (await drawn()).length };
check(idle.line === null && idle.drawn === 0, 'nothing is drawn before the button goes down: no aim preview, no line');
await page.mouse.down({ button: 'right' });
await step(1);
let l = await line(), d = await drawn();
check(!!l && l.frames <= 2 && d.length === 1, `the line is drawn on the first frame the right button is down (frame ${l?.frames}, ${d.length} drawn)`);
check(d[0]?.fromHand < 0.05, `it leaves the right hand (${d[0]?.fromHand.toFixed(3)} m from the hand bone)`);
check(l?.ends === 'body', `it runs to the body under the cursor (${l?.ends}, ${l?.length.toFixed(1)} m)`);
// Ticks, not one blow: health read every frame for a second of holding.
const hits0 = await api((g) => { const G = g.game; window.__stops = 0; const stop = G.clock.hitStop.bind(G.clock); G.clock.hitStop = (s) => { window.__stops++; return stop(s); }; return G.encounters.enemies[0].hp; });
const trace = [];
for (let f = 0; f < 60; f++) { await step(1); trace.push(await api((g) => g.game.encounters.enemies[0].hp)); }
const drops = trace.map((h, i) => (i ? trace[i - 1] : hits0) - h).filter((x) => x > 0);
const stops = await api((g) => window.__stops);
check(drops.length >= 6 && Math.max(...drops) <= 8, `a body on the line takes it in ticks (${drops.length} ticks in a second, ${drops.join(' ')})`);
check(stops <= 1, `the frame does not stop on every tick (${stops} hit-stops in that second)`);
check(await api((g) => g.electro().seizing > 0), 'the body on it convulses');
// Moving the real cursor while the button is held: the end goes where the cursor goes.
const follow = [];
for (const at of [[2.5, 0, 6], [3.5, 0, 3], [-2, 0, 2], [-3.5, 0, 5.5]]) {
  await cursorTo(at, 0);
  await step(1);
  follow.push(await api((g) => { const G = g.game, f = G.cam.floorPoint, l = g.electro().line; return { off: Math.hypot(l.end[0] - f.x, l.end[2] - f.z), ends: l.ends }; }));
}
check(follow.every((f) => f.off < 0.5), `the end follows the cursor the next frame (${follow.map((f) => `${f.off.toFixed(2)} m ${f.ends}`).join(', ')})`);
await page.mouse.up({ button: 'right' });
await step(1);
l = await line(); d = await drawn();
check(l === null && d.length === 0, 'the frame the button comes up the line is gone');

console.log('\nit stops at the first body or solid thing, and at its reach');
await fresh([0, 0, 9], 'top');
await body([0, 0, 5.5]);
await body([0.1, 0, 2.5]);
await api((g) => { g.game.techniques.resource = 100; });
await cursorTo([0.1, 0.9, 2.5]);
await held(40);
let hps = await hp();
l = await line();
await letGo();
check(hps[0] < 70 && hps[1] === 70, `the near body takes it and shields the one behind (${hps})`);
await fresh([0, 0, 7], 'third');
await api((g) => { g.game.techniques.resource = 100; g.look(Math.PI, 0.9); });
await step(5);
await held(10);
l = await line();
const reach = await api((g) => { const p = g.game.techniques.pactFor('secondary'); return { pact: p?.name ?? 'raw' }; });
await letGo();
check(l?.ends === 'air' && l.length > 8 && l.length < 19, `aimed at the sky it ends in the air at its reach (${l?.ends}, ${l?.length.toFixed(1)} m with ${reach.pact})`);
await fresh([0, 0, 7], 'third');
await api((g) => { g.game.techniques.resource = 100; });
await face([0, 1, -3], 0);
await held(5);
l = await line();
await letGo();
check(l?.ends === 'solid' || l?.ends === 'body', `over the shoulder it runs to what the crosshair is on (${l?.ends}, ${l?.length.toFixed(1)} m)`);

console.log('\nit burns Charge while held, more across open air, and dies when it runs dry');
const drain = async (at) => {
  await fresh([0, 0, 9], 'top');
  await api((g) => { g.game.techniques.resource = 100; });
  await cursorTo(at);
  await held(60);
  const r = await api((g) => ({ res: g.game.techniques.resource, air: g.electro().line.air }));
  await letGo();
  return { spent: 100 - r.res, air: r.air };
};
const near = await drain([0.5, 0, 7.5]), far = await drain([0, 0, -1]);
check(near.spent > 8 && near.spent < 14, `close in, it burns ${near.spent.toFixed(1)} Charge a second (${near.air.toFixed(1)} m of air)`);
check(far.spent > near.spent + 3, `across open air it burns more (${far.spent.toFixed(1)} a second over ${far.air.toFixed(1)} m)`);
await fresh([0, 0, 9], 'top');
await body([0, 0, 5]);
await api((g) => { g.game.techniques.resource = 12; });
await cursorTo([0, 0.9, 5]);
await page.mouse.down({ button: 'right' });
await step(1);
let ran = 0;
for (; ran < 240 && (await line()); ran += 5) await step(5);
s = await api((g) => ({ res: g.game.techniques.resource, v: g.electro() }));
const toastShown = await page.evaluate(() => /Out of Charge/.test(document.body.innerText));
check(s.res === 0 && s.v.line === null && s.v.dryAt >= s.v.beganAt, `on 12 Charge it runs about a second and dies with the button still down (${(ran / 60).toFixed(2)} s)`);
check(toastShown, 'running dry says so: "Out of Charge"');
await step(10);
check((await line()) === null, 'it stays dead while the button is still held');
await page.mouse.up({ button: 'right' });
await step(1);
await api((g) => { g.game.techniques.resource = 0; for (const k of Object.keys(g.game.techniques.cooldown)) g.game.techniques.cooldown[k] = 0; });
await page.mouse.down({ button: 'right' }); await step(2);
const dry = await api((g) => ({ line: g.electro().line, dryAt: g.electro().dryAt, time: g.electro().time }));
await page.mouse.up({ button: 'right' }); await step(1);
check(dry.line === null && dry.time - dry.dryAt < 0.1, 'with no Charge at all it only sputters');

console.log('\nmetal on the line carries it on harder; water takes everyone in it');
const throughPot = async (pot) => {
  await fresh([0, 0, 9], 'top');
  if (pot) await api((g) => { const G = g.game, V = G.player.position.constructor; window.__spawned.push(G.props.spawn('pot', new V(0, 0.05, 5.6))); });
  await body([0, 0, 2.5]);
  await body([1.4, 0, 5.6]);
  await api((g) => { g.game.techniques.resource = 100; });
  await cursorTo([0, 0.9, 2.5]);
  await held(48);
  const r = { hp: await hp(), line: await line() };
  await letGo();
  return r;
};
const bare = await throughPot(false), potted = await throughPot(true);
check(potted.line.metal === 1 && potted.line.ends === 'body', `a pot by the line is a route on the way (${potted.line.metal} metal, ends on ${potted.line.ends})`);
check(potted.hp[0] < bare.hp[0], `through the pot the body at the end takes more (${70 - bare.hp[0]} through air, ${70 - potted.hp[0]} through metal)`);
check(potted.hp[1] < 70 && bare.hp[1] === 70, `and the pot forks it to the body beside it (${bare.hp[1]} → ${potted.hp[1]})`);
check(potted.line.air < bare.line.air, `the metal stretch costs no air (${bare.line.air.toFixed(1)} → ${potted.line.air.toFixed(1)} m)`);
await fresh([0, 0, 7.5], 'top');
await api((g) => { const G = g.game, V = G.player.position.constructor; window.__spawned.push(G.props.spawn('pot', new V(0, 0, 5.3))); });
await api((g) => { g.game.techniques.resource = 100; });
await cursorTo([0, 0.3, 5.3]);
await held(60);
l = await line();
await letGo();
let pots = await api((g) => g.electro().held);
check(l?.ends === 'metal' && pots.length === 1 && pots[0].charge > 5, `a pot the line ends on fills with charge (${l?.ends}, ${pots.map((h) => h.charge.toFixed(1)).join(', ')})`);
await body([1.0, 0, 5.3]);
await step(10);
check((await hp())[0] < 70 && (await api((g) => g.electro().held)).length === 0, 'and the next body to touch it takes it');
for (const view of ['top', 'third']) {
  await fresh([P.x, 0.25, P.z + 3.4], view);
  await body([P.x + 0.9, -0.9, P.z - 0.7]);
  await body([P.x - 1.3, -0.9, P.z + 0.9]);
  await body([P.x + 4.5, 0, P.z + 3.6]);
  await api((g) => { g.game.techniques.resource = 100; g.god(false); });
  if (view === 'top') await cursorTo([P.x, P.y, P.z + 1.6]); else await face([P.x, P.y, P.z + 1.6], -0.95);
  const hp0 = await api((g) => g.game.combat.hp);
  await strip(`line-pond-${view}`, 8, 4, () => api((g) => g.hold('secondary', true)));
  l = await line();
  await letGo();
  hps = await hp();
  const hp1 = await api((g) => g.game.combat.hp);
  check(l?.ends === 'water' && hps[0] < 70 && hps[1] < 70, `${view}: into the pond, both bodies in the water take it (${l?.ends}; ${hps.slice(0, 2)})`);
  check(hps[2] === 70 && hp1 === hp0, `${view}: the dry body beside it and the caster on the rim do not (${hps[2]}; ${hp0} → ${hp1})`);
}
await fresh([P.x - 1.6, -0.9, P.z - 1.4], 'third');
await body([P.x + 0.9, -0.9, P.z - 0.7]);
await api((g) => { g.god(false); g.game.techniques.resource = 100; });
await face([P.x + 0.9, 0.2, P.z - 0.7]);
let hp0 = await api((g) => g.game.combat.hp);
await strip('line-wading-third', 6, 4, () => api((g) => g.hold('secondary', true)));
await letGo();
let hp1 = await api((g) => g.game.combat.hp);
check(hp1 < hp0 && (await hp())[0] < 70, `standing in the pond, the caster takes their own current (${hp0} → ${hp1.toFixed(1)})`);
await api((g) => { g.game.techniques.resource = 80; });
await step(60);
const wetLeak = 80 - (await api((g) => g.game.techniques.resource));
await api((g) => { g.teleport([0, 0, 7]); g.game.techniques.resource = 80; });
await step(60);
const dryLeak = 80 - (await api((g) => g.game.techniques.resource));
check(wetLeak > dryLeak * 4 && dryLeak > 0, `charge leaks, and far faster in water (${dryLeak.toFixed(1)} vs ${wetLeak.toFixed(1)} a second)`);
await fresh([P.x, 0.25, P.z + 3.4], 'third');
await api((g) => g.ice(20));
await body([P.x + 0.9, -0.9, P.z - 0.7]);
await api((g) => { g.game.techniques.resource = 100; });
await face([P.x, P.y, P.z + 2.1], -0.95);
await step(20);
check(!(await api((g) => g.electro().pondLive)), 'the frozen pond reads as ice');
await held(30);
await letGo();
check((await hp())[0] === 70, 'a body under the ice is not reached through it');
await fresh([0, 0, 8], 'third');
await api((g) => { g.eye('vault', { vault: 'rime' }); });
await face([0, 0, 2]);
await step(5);
await api((g) => g.castVault());
await step(90);
await body([0, 0, 5.2]);
await body([0, 0, 4.0]);
await api((g) => { g.eye(null); g.teleport([0, 0, 6.5]); g.game.techniques.resource = 100; });
await face([0, 1, 5.2]);
await held(20);
await letGo();
hps = await hp();
check(hps[0] < 70 && hps[1] < 70, `two bodies on one frost patch both take it through the meltwater (${hps})`);

console.log('\na held line cannot hold a body');
for (const key of ['thug', 'kuroda']) {
  await fresh([0, 0, 7]);
  await body([0, 0, 4.5], key);
  await face([0, 1, 4.5]);
  const r = await api((g) => {
    const G = g.game, e = G.encounters.enemies[0];
    let frozenFor = 0, run = 0, longest = 0, free = 0, longestFree = 0, on = 0;
    g.hold('secondary', true);
    for (let f = 0; f < 60 * 20; f++) {
      e.position.set(0, e.position.y, 4.5); e.hp = e.maxHp;
      G.techniques.resource = 100;
      const t0 = G.clock.time;
      g.step(1);
      const dt = G.clock.time - t0;
      if (g.electro().line?.ends === 'body') on += dt;
      if (e.frozen > 0) { frozenFor += dt; run += dt; longest = Math.max(longest, run); free = 0; } else { run = 0; free += dt; longestFree = Math.max(longestFree, free); }
    }
    g.hold('secondary', false); g.step(1);
    return { frozenFor, longest, longestFree, on };
  });
  check(r.on > 18, `${key}: the line stays on it the whole 20 s (${r.on.toFixed(1)} s)`);
  check(r.longest < 0.5, `${key}: never seized past one hold (${r.longest.toFixed(2)} s at most)`);
  check(r.frozenFor < 20 * 0.15, `${key}: seized ${r.frozenFor.toFixed(1)} of 20 s`);
  check(r.longestFree > 5, `${key}: fights on through it once the chain runs out (${r.longestFree.toFixed(1)} s free at a stretch)`);
}

console.log('\nthe line lights the Kuroda\'s waiting fuel');
await fresh([0, 0, 7]);
const lit = await api((g) => {
  const G = g.game;
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
  await api((g, p) => { g.teleport([p[0], 0, p[2] + 2.6]); g.god(true); g.game.techniques.resource = 100; }, pool);
  await face(pool, -0.5);
  const n0 = await api((g) => g.game.encounters.enemies.find((e) => e.def.ai === 'kuroda').pour.length);
  await held(12);
  await letGo(4);
  const n1 = await api((g) => g.game.encounters.enemies.find((e) => e.def.ai === 'kuroda').pour.length);
  check(n1 < n0, `the pool the line touched caught (${n0} waiting → ${n1})`);
} else console.log(`  (skipped: ${lit.why})`);

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

// ------------------------------------------------------------------ conversion and supply
console.log('\nImpact Conversion takes in only the blow in its moment');
for (const view of ['third', 'top', 'first']) {
  await fresh([0, 0, 7], view);
  await body([0, 0, 5.6]);
  await face([0, 1, 5.6]);
  await api((g) => { g.god(false); });
  await step(10);
  const blow = () => api((g) => { const G = g.game, V = G.player.position.constructor; return G.combat.hurtPlayer(20, { from: new V(0, 1, 5.6), kinetic: true }); });
  const open = await api(async (g) => { g.game.techniques.cast('primary', true); for (let i = 0; i < 30 && !g.game.techniques.current?.fired; i++) g.step(1); return g.electro().open; });
  const through = await blow();
  const charged = await api((g) => g.game.techniques.resource);
  check(open > 0.3 && through < 20 && charged > 10, `${view}: a blow in the moment becomes charge (${(20 - through).toFixed(1)} taken in, ${charged.toFixed(1)} Charge, ${through.toFixed(1)} lands)`);
  await strip(`convert-${view}`, 6, 3);
  await step(60);
  const late = await blow();
  check(late >= 20, `${view}: a blow after the moment lands whole (${late.toFixed(1)})`);
  await step(30);
}
await api((g) => { const G = g.game; G.techniques.resource = 0; G.combat.invuln = 0; G.techniques.cast('primary', true); for (let i = 0; i < 30 && !G.techniques.current?.fired; i++) g.step(1); });
const big = await api((g) => { const G = g.game, V = G.player.position.constructor; return G.combat.hurtPlayer(80, { from: new V(0, 1, 5.6), kinetic: true }); });
check(big > 50, `a violent blow is more than the hands take in at once (${big.toFixed(1)} of 80 lands)`);
// Full: the catalogue Pact earths what does not fit; a draft without it takes it through the body.
await step(60);
await api((g) => { const G = g.game; G.techniques.resource = 100; G.combat.invuln = 0; G.techniques.cast('primary', true); for (let i = 0; i < 30 && !G.techniques.current?.fired; i++) g.step(1); });
hp0 = await api((g) => g.game.combat.hp);
await api((g) => { const G = g.game, V = G.player.position.constructor; return G.combat.hurtPlayer(10, { from: new V(0, 1, 5.6) }); });
hp1 = await api((g) => g.game.combat.hp);
check(hp0 - hp1 < 1, `full, Impact Conversion sends the overflow to the ground (${(hp0 - hp1).toFixed(1)} lost)`);
await step(60);
await api((g) => {
  const G = g.game;
  G.book.preview.value = { id: 'draft.convert', technique: 'electro', name: 'Bare Hands', slot: 'primary', grant: { shape: 'convert' }, clauses: [{ kind: 'restrict', restriction: { param: 'direction', value: 'front' } }] };
  G.techniques.resource = 100; G.combat.invuln = 0; G.techniques.cast('primary', true); for (let i = 0; i < 30 && !G.techniques.current?.fired; i++) g.step(1);
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
    if (d !== null && d < 4) { await cast('primary'); await fire(); await step(20); return true; }
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
    await cast('secondary'); await fire();
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
  if (s[1] >= 0) { await reachLit(); await cast('secondary'); await fire(); await waitDone(v.lit); continue; }
  const was = await score();
  await api((g, s) => { g.teleport([s[0] - 1.2, -0.9, s[2]]); }, s);
  await face([s[0], 0.2, s[2]]);
  await cast('secondary'); await fire();
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
// ------------------------------------------------------------------ played
// The line as a player meets it: the real right button held down and the
// real mouse swept across two bodies, top-down (the cursor), over the
// shoulder and in first person (the mouse turning the view). Every frame
// grabbed must have the line drawn from the hand. Each strip is saved whole
// and as a full-size crop round the player.
console.log('\nplayed with the mouse: the line swept across two bodies');
await fresh([0, 0, 7], 'top');
check(JSON.stringify(await page.locator('.ab .name').allTextContents()) === JSON.stringify(['Impact Conversion', 'Discharge', 'Closed Circuit']), `the HUD names left click Impact Conversion, right click Discharge (${(await page.locator('.ab .name').allTextContents()).join(', ')})`);
check(await page.evaluate(() => /a held line to where you aim/.test(document.body.innerText)), 'and says right click is a held line');
const press = async (key) => { const button = { Mouse0: 'left', Mouse2: 'right' }[key]; if (button) { await page.mouse.down({ button }); await step(1); await page.mouse.up({ button }); } else { await page.keyboard.down(key); await step(1); await page.keyboard.up(key); } };
await cursorTo([0, 1, 4]);
await press('Mouse0'); await fire();
check(await api((g) => g.electro().open > 0), 'a left click opens Impact Conversion\'s moment');
const grabbed = async (tiles, crops) => {
  const shot = await page.screenshot({ animations: 'disabled' });
  const [px, py] = await api((g) => { const v = g.game.player.position.clone().setY(g.game.player.position.y + 1).project(g.game.renderer.camera); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; });
  const left = Math.round(Math.min(1280 - 640, Math.max(0, px - 320))), top = Math.round(Math.min(720 - 360, Math.max(0, py - 200)));
  tiles.push(await sharp(shot).resize(640, 360).png().toBuffer());
  crops.push(await sharp(shot).extract({ left, top, width: 640, height: 360 }).png().toBuffer());
};
const save = async (name, tiles, crops) => {
  if (!shots) return;
  for (const [suffix, set] of [['', tiles], ['-close', crops]]) {
    const file = join(out, `${name}${suffix}.png`);
    await sharp({ create: { width: 640 * 4, height: 360 * Math.ceil(set.length / 4), channels: 3, background: '#000' } }).composite(set.map((b, i) => ({ input: b, left: (i % 4) * 640, top: Math.floor(i / 4) * 360 }))).png().toFile(file);
    strips.push(file);
  }
};
for (const view of ['top', 'third', 'first']) {
  await fresh([0, 0, 9], view);
  await body([-2.2, 0, 4]);
  await body([2.2, 0, 4]);
  await api((g) => { g.game.techniques.resource = 100; });
  const tiles = [], crops = [], frames = [];
  let how = 'the cursor';
  if (view === 'top') await cursorTo([-4.4, 0, 4]);
  else await face([-4.4, 1, 4], -0.08);
  await page.mouse.move(640, 360);
  await page.mouse.down({ button: 'right' });
  await step(2);
  const locked = view === 'top' ? false : await api((g) => g.game.input.locked);
  if (view !== 'top') how = locked ? 'the mouse under pointer lock' : 'the view turned by the debug look (no pointer lock here)';
  // From left of the left body to right of the right one, in twelve beats.
  const yaw0 = await api((g) => g.game.cam.yaw);
  const yaw1 = await api((g) => { const p = g.game.player.position; return Math.atan2(-(4.4 - p.x), -(4 - p.z)); });
  // Under pointer lock the view turns by the mouse's motion: how far a pixel turns it, measured.
  let mx = 640, perPx = 1;
  if (locked) { mx += 60; await page.mouse.move(mx, 360); await step(1); perPx = ((await api((g) => g.game.cam.yaw)) - yaw0) / 60 || -0.002; }
  for (let i = 0; i < 12; i++) {
    const u = i / 11;
    if (view === 'top') await cursorTo([-4.4 + 8.8 * u, 0, 4], 0);
    else if (locked) { const want = yaw0 + (yaw1 - yaw0) * u, now = await api((g) => g.game.cam.yaw); mx += (want - now) / perPx; await page.mouse.move(mx, 360); }
    else await api((g, y) => { g.game.cam.yaw = y; }, yaw0 + (yaw1 - yaw0) * u);
    await step(4);
    frames.push(await api((g) => { const l = g.electro().line, c = g.game.vfx.liveCurrents, f = g.game.cam.floorPoint, hand = g.game.avatar.boneWorld('hand_r', g.game.player.position.clone()); return { live: !!l && c.length === 1, ends: l?.ends, fromHand: c[0] ? Math.hypot(c[0].from[0] - hand.x, c[0].from[1] - hand.y, c[0].from[2] - hand.z) : null, toCursor: l && f ? Math.hypot(l.end[0] - f.x, l.end[2] - f.z) : null }; }));
    await grabbed(tiles, crops);
  }
  await page.mouse.up({ button: 'right' });
  await step(2);
  const after = { line: await line(), drawn: (await drawn()).length };
  hps = await hp();
  await save(`line-sweep-${view}`, tiles, crops);
  check(frames.every((f) => f.live), `${view}: the line is drawn in every frame of the sweep (${frames.filter((f) => f.live).length} of ${frames.length}), swept by ${how}`);
  if (view !== 'first') check(frames.every((f) => f.fromHand < 0.05), `${view}: from the right hand in every frame (${Math.max(...frames.map((f) => f.fromHand ?? 9)).toFixed(3)} m at most)`);
  if (view === 'top') check(frames.every((f) => f.ends === 'body' || f.toCursor < 0.5), `top: to the cursor, or the body in the way, in every frame (${frames.map((f) => f.ends === 'body' ? 'body' : f.toCursor.toFixed(2)).join(' ')})`);
  check(frames.some((f) => f.ends === 'body') && hps.every((h) => h < 70), `${view}: both bodies were on it as it swept across (${frames.map((f) => f.ends[0]).join('')}; ${hps})`);
  check(after.line === null && after.drawn === 0, `${view}: let go, it is gone`);
  if (locked) { await api((g) => { g.game.input.releaseLock(); }); await step(2); }
}
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
