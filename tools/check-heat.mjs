#!/usr/bin/env node
// Proves Heat's rules in play (issue #18). Searing Hand burns a body without
// throwing it, and the burn runs out and never stacks; metal glows and cools,
// and hot metal burns what touches it now and then, not every frame; a
// flammable crate catches once hot enough, burns whoever stands in the fire,
// spreads to the crate beside it and falls apart; heat melts Rime's pond
// floor, frozen props, ice spikes and a frozen body, and the body it melts
// cannot be frozen again at once; heat thrown into the pond boils it off and
// cools the user, and standing in the water cools them fast. Impact
// Conversion turns a blow from in front into Draw, lets the part of a blow
// faster than its draw land, and takes nothing in once the body has
// overheated. A cast that lands on nothing leaves more heat in the hands
// than one that lands, and releasing into a body pressed close burns the
// user. Overheated, the user burns, slows, and recovers once cool. White
// Heat hits harder for more Draw and leaves the user overheated. Nothing
// loops: drawing a fire back gives less than lighting it cost, and Searing
// Hand spammed at a body is held back by its Draw. Heat lights the Kuroda's
// fuel while it waits. The Quench drill's first tier is played with real
// keys, and the next tier spoils a piece taken to white heat. It saves frames
// of each interaction.
// Usage: node tools/check-heat.mjs [url] [--out captures/heat]
// Without a URL it serves dist/ itself (run `npm run build` first).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveTarget } from './lib/target.mjs';

const { url, args, stop } = await resolveTarget();
const out = args.out ?? 'captures/heat';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|GPU stall|Automatic fallback/.test(m.text())) errors.push(`console: ${m.text()}`); });
const failures = [];
const check = (ok, what) => { if (!ok) failures.push(what); console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); return ok; };
const api = (fn, ...a) => page.evaluate(([f, ...rest]) => new Function('g', 'a', `return (${f})(g, ...a)`)(window.game, rest), [fn.toString(), ...a]);
const shot = (name) => page.screenshot({ path: join(out, `${name}.png`), animations: 'disabled' });

await page.goto(`${url}?debug`);
await page.waitForFunction(() => window.game?.game?.ready, null, { timeout: 180000 });

// A fresh scene with Heat in hand, the player at `at` facing `yaw`, and a
// few helpers left on window for the steps below.
const scene = (at, yaw = 0, view = 'third') => api((g, at, yaw, view) => {
  const G = g.game;
  g.loop(false);
  localStorage.removeItem('zenko.mastery.v1');
  G.mastery.reset();
  G.startRun({ skipTutorial: true });
  g.loop(false);
  g.technique('heat');
  g.god(false);
  G.combat.hp = G.combat.maxHp;
  g.teleport(at); g.camera(view); g.look(yaw, -0.1);
  G.input.mouse.x = 0; G.input.mouse.y = 0.3;
  g.step(10);
  G.techniques.resource = 100;
  const V = G.player.position.constructor;
  window.__h = {
    V,
    ahead: (d, y = 0) => { const p = G.player.position; return new V(p.x - Math.sin(yaw) * d, p.y + y, p.z - Math.cos(yaw) * d); },
    still: (e) => { e.field = null; e.attackCd = 1e6; e.castCd = 1e6; return e; },
    fresh: () => { G.techniques.resource = 100; for (const k of Object.keys(G.techniques.cooldown)) G.techniques.cooldown[k] = 0; },
  };
}, at, yaw, view);

// ------------------------------------------------------------------ bodies
console.log('Searing Hand on a body');
{
  await scene([-8, 0, 12], 0);
  const r = await api((g) => {
    const G = g.game, h = window.__h;
    const e = h.still(G.encounters.spawn('thug', h.ahead(1.6)));
    e.hp = 5000;
    g.step(5);
    const start = e.position.clone(), hp0 = e.hp;
    const ticks = [];
    const hurt = e.hurt.bind(e);
    e.hurt = (n, o = {}) => { if (o.stagger === false) ticks.push(n); return hurt(n, o); };
    h.fresh(); g.cast('primary'); g.step(30);
    const blow = hp0 - e.hp - ticks.reduce((a, b) => a + b, 0);
    const burning = g.heat().burning;
    g.step(60 * 4);
    const after = g.heat().burning;
    const one = [...ticks];
    ticks.length = 0;
    // Five casts at once: the burn is refreshed, not stacked.
    for (let i = 0; i < 5; i++) { h.fresh(); g.cast('primary'); g.step(20); }
    const stacked = g.heat().burning;
    g.step(60 * 4);
    return { blow, burning, after, one, many: ticks, stacked, moved: Math.hypot(e.position.x - start.x, e.position.z - start.z) };
  });
  check(r.blow > 5, `the blow lands: ${r.blow.toFixed(0)} damage`);
  check(r.burning === 1 && r.one.length >= 3, `the body keeps burning after it: ${r.one.length} ticks of ${r.one.join(', ')}`);
  check(r.after === 0, 'the burn runs out');
  check(r.stacked === 1 && Math.max(...r.many) <= Math.max(...r.one) + 1, `five casts burn once, not five times: ticks of ${[...new Set(r.many)].join(', ')} against ${[...new Set(r.one)].join(', ')}`);
  check(r.moved < 1, `heat burns, it does not throw: the body moved ${r.moved.toFixed(2)} m`);
  await shot('body-burn');
}

// ------------------------------------------------------------------ metal
console.log('metal glows, cools and burns what touches it');
{
  await scene([-8, 0, 12], 0);
  const r = await api((g) => {
    const G = g.game, h = window.__h;
    const pot = G.props.spawn('pot', h.ahead(1.7));
    g.step(20);
    h.fresh(); g.cast('primary'); g.step(20);
    const hot = pot.heat;
    h.fresh(); g.cast('primary'); g.step(20);
    const hotter = pot.heat;
    g.step(60 * 4);
    const cooled = pot.heat;
    return { hot, hotter, cooled };
  });
  check(r.hot > 0.25 && r.hotter > r.hot, `a cast heats the pot (${r.hot.toFixed(2)}) and another heats it more (${r.hotter.toFixed(2)})`);
  check(r.cooled < r.hotter - 0.15, `it cools by itself: ${r.hotter.toFixed(2)} to ${r.cooled.toFixed(2)} in 4 s`);
  await shot('metal-glow');
  const t = await api((g) => {
    const G = g.game, h = window.__h;
    const d = G.encounters.spawn('dummy', h.ahead(5));
    const pot = G.props.spawn('pot', d.position.clone().add(new h.V(0.55, 0.05, 0)));
    g.step(20);
    G.props.warm(pot, 0.95);
    pot.cools = 0;
    let n = 0;
    const hurt = d.hurt.bind(d);
    d.hurt = (a, o) => { n++; return hurt(a, o); };
    g.step(60 * 3);
    pot.heat = 0.2;
    g.step(60 * 2);
    return n;
  });
  check(t >= 2 && t <= 6, `hot metal against a body burns it now and then, not every frame: ${t} burns in 3 s, none once it cools`);
}

// ------------------------------------------------------------------ fire
console.log('fire');
{
  await scene([-8, 0, 12], 0);
  const r = await api((g) => {
    const G = g.game, h = window.__h;
    const a = G.props.spawn('crate', h.ahead(1.8));
    const b = G.props.spawn('crateSmall', h.ahead(1.8).add(new h.V(1.1, 0, -0.2)));
    const d = G.encounters.spawn('dummy', h.ahead(1.8).add(new h.V(-0.9, 0, -0.6)));
    g.step(20);
    let casts = 0;
    while (g.heat().fires === 0 && casts < 6) { h.fresh(); g.cast('primary'); g.step(25); casts++; }
    const lit = g.heat().fires;
    const hp = d.hp;
    g.step(60 * 2.5);
    const spread = g.heat().fires;
    const burned = hp - d.hp;
    g.step(60 * 6);
    return { casts, lit, spread, burned, aGone: !a.alive, bGone: !b.alive };
  });
  check(r.lit === 1 && r.casts >= 2, `a crate catches once it is hot enough: ${r.casts} casts`);
  check(r.burned > 0, `the fire burns a body standing in it: ${r.burned}`);
  check(r.spread >= 2 || r.bGone, 'it spreads to the crate beside it');
  check(r.aGone, 'the crate burns through and falls apart');
}

// ------------------------------------------------------------------ ice
console.log('heat melts Rime\'s ice');
{
  await scene([5.2, 0, 11], -Math.PI / 2);
  const r = await api((g) => {
    const G = g.game, h = window.__h, pond = G.world.pond;
    const floorY = () => G.physics.castRay(new h.V(pond.center.x - 1.2, 2, pond.center.z), new h.V(0, -1, 0), 6)?.point.y ?? -9;
    g.ice(30); g.step(5);
    const iced = floorY();
    g.teleport([7.3, 0.25, 11]); g.look(-Math.PI / 2, -0.25); g.step(10);
    h.fresh(); g.cast('primary'); g.step(20);
    const melted = floorY();
    // A prop held in ice, ice spikes and a frozen body.
    g.teleport([-8, 0, 12]); g.look(-Math.PI / 2, -0.1); g.step(10);
    const p = G.props.spawn('barrel', h.ahead(1.8)); g.step(10);
    G.props.freeze(p, 20);
    G.vfx.iceSpike(h.ahead(2.2).setY(0), 1.4, 20);
    const spikes = () => G.vfx.spikes.filter((s) => s.life > 0.7).length;
    const e = h.still(G.encounters.spawn('thug', h.ahead(1.6).add(new h.V(0.5, 0, 0))));
    g.step(5);
    e.freeze(5);
    const before = { prop: p.frozen, spikes: spikes(), body: e.frozen };
    h.fresh(); g.cast('primary'); g.step(25);
    const after = { prop: p.frozen, spikes: spikes(), body: e.frozen };
    e.freeze(5);
    return { iced, melted, before, after, refrozen: e.frozen };
  });
  check(r.iced > -0.4 && r.melted < -0.6, `the pond's ice floor melts: the floor at ${r.iced.toFixed(2)} m, then the pond bed at ${r.melted.toFixed(2)} m`);
  check(r.before.prop > 0 && r.after.prop === 0, 'a prop held in ice comes free');
  check(r.before.spikes > 0 && r.after.spikes < r.before.spikes, `ice spikes in front melt (${r.before.spikes} to ${r.after.spikes})`);
  check(r.before.body > 0 && r.after.body === 0, 'a frozen body thaws');
  check(r.refrozen === 0, 'a body heat just thawed cannot be frozen again at once');
}

// ------------------------------------------------------------------ water and cooling
console.log('water takes the heat');
{
  await scene([7.4, 0.25, 11], -Math.PI / 2);
  const r = await api((g) => {
    const G = g.game, h = window.__h;
    g.look(-Math.PI / 2, -0.3);
    g.heat(0.9);
    let steam = 0;
    const s = G.vfx.steam.bind(G.vfx);
    G.vfx.steam = (...a) => { steam += a[2]; return s(...a); };
    h.fresh(); g.cast('primary'); g.step(25);
    G.vfx.steam = s;
    const quenched = g.heat().core;
    // Standing in the water.
    g.teleport([11, -0.9, 11]); g.step(5);
    g.heat(1.1); g.step(60);
    const inWater = g.heat().core;
    g.teleport([-8, 0, 12]); g.step(5);
    g.heat(1.1); g.step(60);
    const dry = g.heat().core;
    return { steam, quenched, inWater, dry };
  });
  check(r.steam >= 12 && r.quenched < 0.7, `heat thrown into the pond boils off as steam (${r.steam} puffs) and cools the hands: 0.90 to ${r.quenched.toFixed(2)}`);
  check(1.1 - r.inWater > 2.5 * (1.1 - r.dry), `standing in the water cools far faster: ${(1.1 - r.inWater).toFixed(2)} in a second against ${(1.1 - r.dry).toFixed(2)} on dry ground`);
  await shot('pond-steam');
}

// ------------------------------------------------------------------ Impact Conversion
console.log('Impact Conversion');
{
  await scene([-8, 0, 12], 0);
  const r = await api((g) => {
    const G = g.game, h = window.__h;
    const e = h.still(G.encounters.spawn('thug', h.ahead(2)));
    g.step(5);
    const from = e.center();
    const blow = (n) => { const hp = G.combat.hp; G.combat.invuln = 0; G.combat.hurtPlayer(n, { from, kinetic: true }); return hp - G.combat.hp; };
    const brace = () => { h.fresh(); g.hold('secondary', true); G.techniques.cast('secondary'); g.step(20); };
    brace();
    G.techniques.resource = 50;
    const core0 = g.heat().core;
    const small = blow(10);
    const draw = G.techniques.resource - 50;
    const core1 = g.heat().core;
    g.step(60);
    const big = blow(90);
    g.hold('secondary', false); g.step(30);
    const open = blow(10);
    brace();
    g.heat(1.2); g.step(2);
    const hot = blow(10);
    g.hold('secondary', false); g.step(10);
    return { small, draw, heated: core1 - core0, big, open, hot };
  });
  check(r.small === 0 && r.draw > 10, `a blow from in front is taken in: ${r.small.toFixed(1)} lands, +${r.draw.toFixed(1)} Draw`);
  check(r.heated > 0.05, `what it takes in heats the body: +${r.heated.toFixed(2)}`);
  check(r.big > 20 && r.big < 90, `a blow faster than the draw still lands in part: ${r.big.toFixed(1)} of 90`);
  check(r.open === 10, 'without the brace a blow lands whole');
  check(r.hot === 10, 'overheated, the brace takes nothing in');
}

// ------------------------------------------------------------------ what stays in the hands
console.log('what stays in the hands');
{
  await scene([0, 0, 3], 0);
  const r = await api((g) => {
    const G = g.game, h = window.__h;
    // Nothing in front: the open yard toward the hall.
    g.heat(0); h.fresh(); g.cast('primary'); g.step(20);
    const wasted = g.heat().core;
    g.teleport([-8, 0, 12]); g.look(0, -0.1); g.step(5);
    const d = G.encounters.spawn('dummy', h.ahead(1.8));
    g.step(5);
    g.heat(0); h.fresh(); g.cast('primary'); g.step(20);
    const landed = g.heat().core;
    d.position.copy(h.ahead(0.7));
    g.step(2);
    g.heat(0); G.combat.hp = 100; h.fresh(); g.cast('primary'); g.step(20);
    return { wasted, landed, close: g.heat().core, hurt: 100 - G.combat.hp };
  });
  check(r.wasted > r.landed * 2, `heat that lands on nothing stays in the hands: ${r.wasted.toFixed(3)} against ${r.landed.toFixed(3)} when it lands`);
  check(r.close > r.landed + 0.1 && r.hurt >= 3, `releasing into a body pressed close burns you too: ${r.close.toFixed(2)} body heat, ${r.hurt.toFixed(1)} health`);
}

// ------------------------------------------------------------------ overheating
console.log('overheating');
{
  await scene([-8, 0, 12], 0);
  const r = await api((g) => {
    const G = g.game;
    g.heat(1.25); g.step(5);
    const on = { ...g.heat(), speed: G.player.speedScale };
    G.combat.hp = 100;
    g.step(120);
    const hurt = 100 - G.combat.hp;
    g.step(60 * 6);
    return { on, hurt, off: { ...g.heat(), speed: G.player.speedScale } };
  });
  check(r.on.overheated && r.on.speed < 1, `past the top the body overheats and slows (${r.on.speed})`);
  check(r.hurt >= 6, `overheated, it burns: ${r.hurt.toFixed(1)} health in 2 s`);
  check(!r.off.overheated && r.off.speed === 1, `it cools out of it: ${r.off.core.toFixed(2)} body heat, speed ${r.off.speed}`);
  await shot('overheated');
}

// ------------------------------------------------------------------ White Heat
console.log('White Heat');
{
  const blow = async (draw) => {
    await scene([-8, 0, 12], 0);
    return api((g, draw) => {
      const G = g.game, h = window.__h;
      const e = h.still(G.encounters.spawn('bruiser', h.ahead(3)));
      g.god(true);
      g.step(5);
      g.setting('cutscenes', 'never');
      G.techniques.charge = 1;
      G.techniques.resource = draw;
      g.step(1);
      const hp = e.hp;
      G.techniques.beginMax();
      for (let i = 0; i < 400 && G.cutscenes.active; i++) g.step(1);
      g.step(10);
      return { dealt: hp - e.hp, after: g.heat() };
    }, draw);
  };
  const full = await blow(100), low = await blow(15);
  check(full.dealt > low.dealt * 1.5, `more Draw, more heat: ${full.dealt.toFixed(0)} from a full Draw, ${low.dealt.toFixed(0)} from 15`);
  check(full.after.overheated, `the heat it cannot place stays in the user: body heat ${full.after.core.toFixed(2)}`);
  await api((g) => g.setting('cutscenes', 'always'));
}

// ------------------------------------------------------------------ no loops
console.log('no loops, no locks');
{
  await scene([-8, 0, 12], 0);
  const r = await api((g) => {
    const G = g.game, h = window.__h, t = G.techniques;
    const crate = G.props.spawn('crate', h.ahead(1.8));
    g.step(20);
    t.resource = 100;
    let casts = 0;
    while (g.heat().fires === 0 && casts < 6) { for (const k of Object.keys(t.cooldown)) t.cooldown[k] = 0; t.cast('primary'); g.step(25); casts++; }
    const spent = 100 - t.resource;
    // Bracing beside the fire, then the same brace with nothing burning: the difference is what the fire gave.
    const brace = () => { t.resource = 50; g.hold('secondary', true); t.cast('secondary', true); g.step(40); const got = t.resource - 50; g.hold('secondary', false); g.step(10); return got; };
    const withFire = brace();
    const without = brace();
    const drawnBack = withFire - without;
    // Ten seconds of the key held down at a body: Draw decides how often it lands.
    const e = h.still(G.encounters.spawn('thug', h.ahead(1.6).add(new h.V(1.5, 0, 0))));
    g.teleport([e.position.x, 0, e.position.z + 1.6]); g.look(0, -0.1); g.step(5);
    t.resource = 100;
    let n = 0;
    const cast = t.cast.bind(t);
    t.cast = (...a) => { const ok = cast(...a); if (ok) n++; return ok; };
    for (let f = 0; f < 600; f++) { t.cast('primary'); g.step(1); }
    t.cast = cast;
    return { casts, spent, drawnBack, spam: n, crateLit: !crate.alive || g.heat().fires >= 0 };
  });
  check(r.drawnBack > 0 && r.drawnBack < r.spent, `drawing a fire back gives less than lighting it cost: ${r.drawnBack.toFixed(1)} Draw back for ${r.spent.toFixed(0)} spent`);
  check(r.spam <= 14, `Searing Hand held down at a body for 10 s lands ${r.spam} times: Draw holds it back`);
}

// ------------------------------------------------------------------ the Kuroda's fuel
console.log('the Kuroda\'s fuel');
{
  await scene([0, 0, 6], 0, 'top');
  const r = await api((g) => {
    const G = g.game;
    g.god(true);
    g.encounter('kuroda');
    let k = null, pools = [];
    for (let i = 0; i < 60 * 20 && !pools.length; i++) { g.step(1); k = G.encounters.enemies.find((e) => e.def.ai === 'kuroda'); pools = k ? k.pour : []; if (pools.length) g.step(20); pools = k ? k.pour : []; }
    if (!pools.length) return { poured: false };
    // Metabolic Heating (on 1) aimed at the first pool with the cursor.
    const before = k.pour.length;
    const ndc = pools[0].clone().project(G.renderer.camera);
    G.input.mouse.x = ndc.x; G.input.mouse.y = ndc.y;
    g.step(2);
    G.techniques.resource = 100;
    g.cast('art1');
    g.step(25);
    return { poured: true, before, after: k.pour.length };
  });
  if (check(r.poured, 'the Kuroda pours')) check(r.after < r.before, `heat aimed at his fuel lights it before his snap: ${r.before - r.after} pool lit`);
}

// ------------------------------------------------------------------ the drill
console.log('Quench');
{
  await scene([5.6, 0, 11], -Math.PI / 2, 'top');
  await api((g) => { localStorage.removeItem('zenko.drills.v1'); g.game.drills.progress = {}; g.loop(true); g.drill('heat-quench'); });
  const keyAt = async () => {
    const p = await api((g) => {
      const q = g.heat().quench;
      if (!q.piece) return null;
      const G = g.game, v = new G.player.position.constructor(...q.piece).project(G.renderer.camera);
      return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight, heat: q.heat };
    });
    return p;
  };
  let guard = 0;
  while ((await api((g) => g.game.drills.running)) && guard++ < 200) {
    const p = await keyAt();
    if (p && p.heat < 0.55) {
      await page.mouse.move(p.x, p.y);
      await api((g) => { g.game.techniques.resource = 100; });
      await page.keyboard.press('Digit1');
    }
    await page.waitForTimeout(450);
  }
  const reached = await api((g) => ({ tier: g.game.drills.reached('heat-quench'), stats: { ...g.game.mastery.stats.value.heat } }));
  check(reached.tier === 1, `Dull Red is cleared with real keys and the cursor (tier ${reached.tier + 1} next)`);
  check(reached.stats.precision >= 0.55 && reached.stats.control >= 0.55, `it raises precision and control: ${reached.stats.precision.toFixed(2)}, ${reached.stats.control.toFixed(2)}`);
  // Cherry: a piece taken to white heat is spoiled.
  await api((g) => { g.loop(false); g.drill('heat-quench'); });
  const spoiled = await api((g) => {
    const G = g.game;
    let q = null;
    for (let i = 0; i < 400 && !q; i++) { g.step(1); q = g.heat().quench.piece; }
    const piece = G.props.instances.find((p) => p.mesh.position.distanceTo(new G.player.position.constructor(...q)) < 0.5);
    G.props.warm(piece, 1.1);
    g.step(10);
    return { lit: g.heat().quench.piece };
  });
  await page.waitForTimeout(100);
  const hud = (await page.locator('.drill-hud').textContent()) ?? '';
  check(spoiled.lit === null && /Cherry/.test(hud) && /^\D*0 \//.test((await page.locator('.drill-hud .big').textContent()) ?? ''), `Cherry: a piece taken to white heat is spoiled (${hud.replace(/\s+/g, ' ').slice(0, 60)})`);
  await api((g) => g.quitDrill());
  await api((g) => g.loop(false));
}

for (const e of [...errors, ...(await api((g) => g.errors))]) check(false, e);
await browser.close();
stop();
console.log(failures.length ? `\n${failures.length} failure(s)` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);
