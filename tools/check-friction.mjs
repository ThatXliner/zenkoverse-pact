#!/usr/bin/env node
// Proves Friction (issue #23) in play, with real keys and clicks, and saves
// frame strips of its moves from the top-down and over-the-shoulder cameras
// for the critic:
//   Slip keeps its speed on the hall's boards, loses it in the ring's sand,
//   runs out on its own, and Open Hand stops it dead; a blow taken
//   mid-slide glances; a body in the way is bowled over and takes the speed;
//   Grip takes a body and throws it along the aim, further with a slide's
//   speed behind it; spammed at one body its holds shrink and then stop
//   taking (the freeze's chain, so nothing can be held in place); a body
//   thrown into a wall takes the stop as a blow; a heavy body costs the
//   wrist; a wet hand cannot hold;
//   Open Hand climbs a plaster wall, holds its lip, kicks off it, slides down
//   it wet, and refuses a shove on the floor; out of Skin it peels off;
//   Railstep skates three strides and stamps what it passes;
//   nothing Friction does gives Skin back;
//   Absolute Traction hurls its target down the floor and costs the caster skin;
//   Suriashi, its drill, is cleared with real keys and raises Control.
// The ?debug hooks place the player and the bodies and read state; every
// Ability is cast from its key or button.
// Usage: node tools/check-friction.mjs [url] [--out captures/friction] [--no-shots]
// Without a URL it serves dist/ itself (run `npm run build` first).
import { chromium } from 'playwright';
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveTarget } from './lib/target.mjs';

const { url, args, stop } = await resolveTarget();
const out = args.out ?? 'captures/friction';
const shots = args['no-shots'] !== 'true';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|WebGL|GPU stall|Automatic fallback/.test(m.text())) errors.push(`console: ${m.text()}`); });
const failures = [];
const check = (ok, what) => { if (!ok) failures.push(what); console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); return ok; };
const api = (fn, ...a) => page.evaluate(([f, ...rest]) => { const g = window.game; return new Function('g', 'a', `return (${f})(g, ...a)`)(g, rest); }, [fn.toString(), ...a]);
const step = (n = 1) => api((g, k) => g.step(k, 1 / 60), n);
const pos = () => api((g) => { const p = g.game.player.position; return [p.x, p.y, p.z]; });
const speed = () => api((g) => g.game.player.planarSpeed.value);
const flat = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

await page.goto(`${url}?debug`);
await page.waitForFunction(() => window.game?.game?.ready, null, { timeout: 180000 });
await api((g) => { g.loop(false); localStorage.removeItem('zenko.drills.v1'); g.game.drills.progress = {}; g.game.mastery.reset(); });

// A fresh run with Friction in hand, at `at`, in `camera`, facing `yaw`, nobody else about.
const stage = async (at, camera = 'top', yaw = 0, pitch = -0.1) => {
  await api((g, at, camera, yaw, pitch) => {
    g.technique('friction'); g.game.startRun({ skipTutorial: true }); g.loop(false); g.step(5);
    g.god(true); g.teleport(at); g.camera(camera); g.look(yaw, pitch); g.step(30);
    const t = g.game.techniques; t.resource = t.def.resource.max;
  }, at, camera, yaw, pitch);
};
// A body that stands where it is put and does not strike back.
const body = (key, at) => api((g, key, at) => {
  const G = g.game, V = G.player.position.constructor;
  const e = G.encounters.spawn(key, new V(...at));
  e.attackCd = 1e9; e.castCd = 1e9; e.field = null;
  g.step(3);
  return G.encounters.enemies.length - 1;
}, key, at);
const enemy = (i) => api((g, i) => { const e = g.game.encounters.enemies[i]; return { at: [e.position.x, e.position.y, e.position.z], hp: e.hp, state: e.state, gripped: e.gripped }; }, i);
const fill = () => api((g) => { const t = g.game.techniques; t.resource = t.def.resource.max; for (const k of Object.keys(t.cooldown)) t.cooldown[k] = 0; });
// Where a world point is on screen, for aiming the top-down cursor.
const screenOf = (p) => api((g, p) => { const cam = g.game.renderer.camera, V = cam.position.constructor; cam.updateMatrixWorld(); const q = new V(...p).project(cam); return [(q.x * 0.5 + 0.5) * innerWidth, (-q.y * 0.5 + 0.5) * innerHeight]; }, p);
const aimAt = async (p) => { const [x, y] = await screenOf(p); await page.mouse.move(x, y); await step(2); };
const mouse = async (button, down) => { if (down) await page.mouse.down({ button }); else await page.mouse.up({ button }); };
const click = async (button = 'left') => { await mouse(button, true); await step(1); await mouse(button, false); };
const key = async (code, down) => { if (down) await page.keyboard.down(code); else await page.keyboard.up(code); };
const tap = async (code) => { await key(code, true); await step(1); await key(code, false); };

// Frames: a strip of crops around the player, three or four beats wide.
const tiles = [];
const tile = async (half = 230) => {
  if (!shots) return;
  const [x, y] = await api((g) => { const cam = g.game.renderer.camera, V = cam.position.constructor; cam.updateMatrixWorld(); const q = g.game.player.position.clone().add(new V(0, 0.9, 0)).project(cam); return [(q.x * 0.5 + 0.5) * innerWidth, (-q.y * 0.5 + 0.5) * innerHeight]; });
  const left = Math.round(Math.min(1280 - 2 * half, Math.max(0, x - half))), top = Math.round(Math.min(720 - 2 * half, Math.max(0, y - half)));
  tiles.push(await sharp(await page.screenshot({ clip: { x: left, y: top, width: 2 * half, height: 2 * half }, animations: 'disabled' })).resize(300, 300).png().toBuffer());
};
const full = async () => { if (shots) tiles.push(await sharp(await page.screenshot({ animations: 'disabled' })).resize(480, 270).png().toBuffer()); };
const strip = async (name) => {
  if (!shots || !tiles.length) return;
  const w = tiles.length === 0 ? 0 : (await sharp(tiles[0]).metadata()).width, h = (await sharp(tiles[0]).metadata()).height;
  await sharp({ create: { width: w * tiles.length, height: h, channels: 3, background: '#000' } }).composite(tiles.map((b, i) => ({ input: b, left: i * w, top: 0 }))).png().toFile(join(out, `${name}.png`));
  tiles.length = 0;
};

// ------------------------------------------------------------------ Slip
console.log('Slip');
for (const camera of ['top', 'third']) {
  await stage([10, 0.3, -11], camera, Math.PI / 2, -0.15);
  if (camera === 'top') await aimAt([0, 0.3, -11]);
  const start = await pos();
  await click('right');
  await step(3); await tile();
  const v0 = (await step(8), await speed());
  await tile();
  await step(52);
  const v1 = await speed();
  await tile();
  if (camera === 'top') {
    check(v0 > 8, `a push off on the boards starts the slide fast: ${v0.toFixed(1)} m/s`);
    check(v1 > v0 * 0.85, `on polished boards it keeps its speed: ${v0.toFixed(1)} to ${v1.toFixed(1)} m/s over a second`);
    check(await api((g) => g.game.avatar.glide), 'the body crouches into the glide');
  }
  // Open Hand: fingertips and soles catch, and the slide stops dead.
  await tap('Digit1');
  let at = null;
  for (let f = 0; f < 40; f++) { await step(1); if (!at && (await api((g) => g.game.player.footing.kind)) === 'plant') at = await pos(); }
  await tile();
  const rest = await pos();
  if (camera === 'top') {
    check(!!at && (await speed()) < 0.3 && flat(at, rest) < 0.6, `Open Hand stops the slide dead: at rest ${at ? flat(at, rest).toFixed(2) : '?'} m after the palms land`);
    check(flat(start, rest) > 8, `the slide covered ${flat(start, rest).toFixed(1)} m`);
  }
  await strip(`slip-${camera}`);
}
// Left alone on the boards, it runs out on its own: no brakes, but not forever.
await stage([12, 0.3, -11], 'top', Math.PI / 2);
await aimAt([4, 0.3, -11]);
await click('right');
for (let f = 0; f < 30 && (await api((g) => g.game.player.footing.kind)) !== 'slide'; f++) await step(1);
let ran = 0;
while (ran < 60 * 4 && (await api((g) => g.game.player.footing.kind)) === 'slide') { await step(1); ran++; }
check(ran / 60 > 2 && ran / 60 < 2.8, `untouched, a slide runs ${(ran / 60).toFixed(2)} s before the soles catch`);
// The sparring ring's raked sand drags the slide to a stop.
await stage([-8, 0, 13.4], 'top', 0, -0.1);
await aimAt([-8, 0, 2]);
await click('right');
await step(10);
const sand0 = await speed();
await step(30);
const sand1 = await speed();
await step(40);
check(sand1 < sand0 * 0.5, `the ring's sand drags it down: ${sand0.toFixed(1)} to ${sand1.toFixed(1)} m/s in half a second`);

// A blow taken mid-slide glances.
await stage([10, 0.3, -11], 'top', Math.PI / 2);
await aimAt([0, 0.3, -11]);
const plainBlow = await api((g) => { g.game.combat.invuln = 0; g.god(false); const V = g.game.player.position.constructor; const d = g.game.combat.hurtPlayer(20, { from: g.game.player.position.clone().add(new V(0, 1, -1)), kinetic: true }); g.god(true); return d; });
await step(30);
await click('right');
await step(12);
const slidBlow = await api((g) => { g.game.combat.invuln = 0; g.god(false); const V = g.game.player.position.constructor; const d = g.game.combat.hurtPlayer(20, { from: g.game.player.position.clone().add(new V(0, 1, -1)), kinetic: true }); g.god(true); return d; });
await step(90);
check(plainBlow === 20 && slidBlow < 12, `a blow glances off a slide: ${slidBlow.toFixed(1)} of 20 (standing: ${plainBlow})`);

// A body in the way is bowled over and takes the speed.
await stage([10, 0.3, -11], 'top', Math.PI / 2);
const thugI = await body('thug', [4, 0.3, -11]);
const t0 = await enemy(thugI);
await aimAt([0, 0.3, -11]);
await click('right');
let bowled = null;
for (let f = 0; f < 70 && !bowled; f++) { await step(1); const e = await enemy(thugI); if (e.hp < t0.hp) { await step(1); bowled = { e, v: await speed() }; } }
await step(90);
check(!!bowled && bowled.e.state === 'knocked' && bowled.v < 6, `sliding into a thug knocks it down (${bowled ? `${t0.hp} to ${bowled.e.hp}, ${bowled.e.state}` : 'no hit'}) and the slide gives up its speed (${bowled?.v.toFixed(1)} m/s after)`);

// ------------------------------------------------------------------ Grip
console.log('Grip');
// Grip, standing or out of a slide: in a slide the grab is led, thrown
// while the body is still a few metres off, since the hand lands a moment later.
// Down the length of the hall's boards, west, where nothing stops a throw short.
const throwOnce = async (camera, slideFirst, save) => {
  await stage([12, 0.3, -11], camera, Math.PI / 2, -0.1);
  const i = await body('thug', slideFirst ? [4, 0.3, -11] : [10.6, 0.3, -11]);
  if (camera === 'top') await aimAt([6, 0.3, -11]);
  if (slideFirst) {
    await click('right');
    await step(24);
    for (let f = 0; f < 60 && flat(await pos(), (await enemy(i)).at) > 4.2; f++) await step(1);
  }
  const before = await enemy(i);
  await click('left');
  let held = 0;
  const beats = new Set([8, 13, 22, 40]);
  for (let f = 1; f <= 75; f++) { await step(1); const e = await enemy(i); held = Math.max(held, e.gripped); if (save && beats.has(f)) await tile(); }
  const after = await enemy(i);
  return { held, moved: after.at[0] - before.at[0], hp: before.hp - after.hp };
};
const plain = await throwOnce('top', false, true);
await strip('grip-top');
const plainThird = await throwOnce('third', false, true);
await strip('grip-third');
check(plain.held > 0.2 && plain.moved < -2, `Grip takes the thug (held ${plain.held.toFixed(2)} s) and throws it along the aim: ${(-plain.moved).toFixed(1)} m`);
check(plainThird.held > 0.2 && plainThird.moved < -2, `and over the shoulder: ${(-plainThird.moved).toFixed(1)} m`);
const carried = await throwOnce('third', true, false);
check(carried.moved < plainThird.moved - 1.5, `a slide's speed goes into the throw: ${(-carried.moved).toFixed(1)} m against ${(-plainThird.moved).toFixed(1)} m standing`);

// Mashed at one body, the holds shrink and then stop taking: nothing can be
// held in place by spamming the grip (the freeze's chain, src/combat/enemies.ts).
await stage([0, 0, 9], 'top', 0);
const dummyI = await body('dummy', [0, 0, 7.7]);
await aimAt([0, 0, 4]);
const holds = [];
let heldFor = 0;
for (let n = 0; n < 14; n++) {
  await fill();
  await click('left');
  let peak = 0;
  for (let f = 0; f < 26; f++) { await step(1); const g = (await enemy(dummyI)).gripped; peak = Math.max(peak, g); if (g > 0) heldFor += 1 / 60; }
  holds.push(+peak.toFixed(3));
}
const took = holds.filter((h) => h > 0);
check(took.length === 3 && took[1] < took[0] && took[2] < took[1], `fourteen grips mashed at one body over six seconds: holds ${holds.join(', ')} (three that halve, then none)`);
check(heldFor < 0.6, `in all of it the body was held for ${heldFor.toFixed(2)} s`);
await step(60 * 7);
await fill();
await mouse('left', true); await step(1); await mouse('left', false);
let fresh = 0;
for (let f = 0; f < 26; f++) { await step(1); fresh = Math.max(fresh, (await enemy(dummyI)).gripped); }
check(fresh > 0.25, `after six seconds without a hold it takes in full again: ${fresh.toFixed(2)} s`);

// Thrown into a wall, the stop is a blow of its own.
await stage([-20.2, 0, 2], 'top', Math.PI / 2);
const wallI = await body('thug', [-21.4, 0, 2]);
await aimAt([-30, 0, 2]);
const hits = await api((g) => { const G = g.game; window.__hits = []; const orig = G.combat.hitEnemy; G.combat.__orig = orig; G.combat.hitEnemy = function (e, a, o) { window.__hits.push(Math.round(a)); return orig.call(this, e, a, o); }; return 0; });
await click('left');
await step(70);
const wallHits = await api((g) => { g.game.combat.hitEnemy = g.game.combat.__orig; return window.__hits; });
check(wallHits.length >= 3, `a thug thrown into the west wall takes the seize, the throw and the wall: ${wallHits.join(', ')}`);

// A heavy body costs the wrist; a light one does not.
const wristFor = async (k) => {
  await stage([0, 0, 9], 'top', 0);
  await api((g) => g.god(false));
  await body(k, [0, 0, 7.6]);
  await aimAt([0, 0, 4]);
  const hp = await api((g) => g.game.combat.hp);
  await click('left'); await step(30);
  const after = await api((g) => g.game.combat.hp);
  await api((g) => g.god(true));
  return hp - after;
};
const lightCost = await wristFor('thug'), heavyCost = await wristFor('husk');
check(lightCost === 0 && heavyCost > 0, `holding a husk costs the wrist ${heavyCost.toFixed(1)} health; a thug costs ${lightCost}`);

// Wet hands slip: from the pond's rim a grip does not hold.
await stage([11, 0, 14.6], 'top', Math.PI);
await step(10);
const wetI = await body('thug', [11, 0, 16]);
await aimAt([11, 0, 20]);
await click('left');
let wetHeld = 0;
for (let f = 0; f < 30; f++) { await step(1); wetHeld = Math.max(wetHeld, (await enemy(wetI)).gripped); }
check(wetHeld === 0, `with wet hands (standing on the pond's rim) Grip does not hold`);

// ------------------------------------------------------------------ Open Hand
console.log('Open Hand');
await stage([-22.6, 0, 2], 'third', Math.PI / 2, 0.15);
const skin0 = await api((g) => g.game.techniques.resource);
await key('Digit1', true); await key('KeyW', true);
let top = 0;
for (let f = 0; f < 150; f++) { await step(1); top = Math.max(top, (await pos())[1]); if (f === 30 || f === 70 || f === 120) await tile(); }
const onWall = await api((g) => g.game.player.footing.kind);
check(top > 1.8 && onWall === 'cling', `holding 1 and walking into the west wall climbs it to ${top.toFixed(2)} m and holds the lip`);
const skin1 = await api((g) => g.game.techniques.resource);
check(skin1 < skin0 - 15, `the hold costs Skin: ${skin0.toFixed(0)} to ${skin1.toFixed(0)}`);
const lip = await pos();
await key('KeyW', false);
await tap('Space');
for (let f = 0; f < 14; f++) await step(1);
await tile();
const kicked = await pos();
await step(40);
await key('Digit1', false);
await strip('open-hand-third');
check(kicked[0] - lip[0] > 0.8 && kicked[1] > lip[1], `Space kicks off the wall: ${(kicked[0] - lip[0]).toFixed(2)} m out and ${(kicked[1] - lip[1]).toFixed(2)} m up`);

// Out of Skin on the wall, the palms come away and leave some behind.
await stage([-22.6, 0, 2], 'third', Math.PI / 2, 0.15);
await api((g) => g.god(false));
await key('Digit1', true); await key('KeyW', true);
await step(50);
const hp0 = await api((g) => g.game.combat.hp);
await api((g) => { g.game.techniques.resource = 0.5; });
await step(30);
const peeled = await api((g) => ({ hp: g.game.combat.hp, footing: g.game.player.footing.kind }));
await key('Digit1', false); await key('KeyW', false);
await api((g) => g.god(true));
check(peeled.footing !== 'cling' && peeled.hp < hp0, `out of Skin the palms peel off the wall (${peeled.footing}) and tear: ${hp0} to ${peeled.hp}`);

// Wet palms will not hold a wall.
await stage([-22.6, 0, 2], 'third', Math.PI / 2, 0.15);
// Wet the hands the way the pond does: stand on its rim, then come straight here.
await api((g) => { g.teleport([11, 0, 14.6]); g.step(5); g.teleport([-22.6, 0, 2]); g.step(2); });
await key('Digit1', true); await key('KeyW', true);
let wetTop = 0;
for (let f = 0; f < 120; f++) { await step(1); wetTop = Math.max(wetTop, (await pos())[1]); }
await key('Digit1', false); await key('KeyW', false);
check(wetTop < 0.6, `with wet palms the wall cannot be climbed (highest ${wetTop.toFixed(2)} m)`);

// Planted, a shove does not move the body.
await stage([-3, 0, 6], 'top', 0);
await api((g) => g.god(false));
await key('Digit1', true);
await step(20);
const planted0 = await pos();
await api((g) => { g.game.combat.invuln = 0; const V = g.game.player.position.constructor; g.game.combat.hurtPlayer(15, { from: g.game.player.position.clone().add(new V(0, 1, -1.2)), kinetic: true }); });
await step(30);
const planted1 = await pos();
await key('Digit1', false);
await step(40);
await api((g) => { g.game.combat.invuln = 0; const V = g.game.player.position.constructor; g.game.combat.hurtPlayer(15, { from: g.game.player.position.clone().add(new V(0, 1, -1.2)), kinetic: true }); });
await step(30);
const loose = await pos();
await api((g) => g.god(true));
check(flat(planted0, planted1) < 0.05 && flat(planted1, loose) > 0.3, `with Open Hand held a blow's shove does not move the body (${flat(planted0, planted1).toFixed(2)} m; without it, ${flat(planted1, loose).toFixed(2)} m)`);

// ------------------------------------------------------------------ Railstep
console.log('Railstep');
for (const camera of ['top', 'third']) {
  await stage([2, 0, 2], camera, Math.PI / 2, -0.15);
  const k = camera === 'top' ? await body('thug', [-1.6, 0, 2.6]) : null;
  if (camera === 'top') await aimAt([-12, 0, 2]);
  const r0 = await pos();
  await tap('Digit2');
  const beats = new Set([12, 20, 28, 44]);
  for (let f = 1; f <= 60; f++) { await step(1); if (beats.has(f)) await tile(); }
  const r1 = await pos();
  await strip(`railstep-${camera}`);
  if (camera === 'top') {
    const e = await enemy(k);
    check(flat(r0, r1) > 6, `three strides skate ${flat(r0, r1).toFixed(1)} m in under a second`);
    check(e.hp < 70, `a catch stamps the thug it passes: 70 to ${e.hp}`);
  }
}

// ------------------------------------------------------------------ no Skin loop
console.log('Skin');
await stage([10, 0.3, -11], 'top', Math.PI / 2);
await body('thug', [4, 0.3, -11]);
await body('dummy', [6, 0.3, -9]);
await api((g) => { g.game.techniques.resource = 10; });
const regen = await api((g) => g.game.techniques.def.resource.regen);
let worst = 0;
const watch = async (n) => { for (let f = 0; f < n; f++) { const a = await api((g) => g.game.techniques.resource); await step(1); const b = await api((g) => g.game.techniques.resource); worst = Math.max(worst, b - a); } };
await aimAt([0, 0.3, -11]);
await click('right'); await watch(60);
await click('left'); await watch(40);
await tap('Digit2'); await watch(60);
await key('Digit1', true); await watch(30); await key('Digit1', false); await watch(10);
check(worst <= regen / 60 + 1e-6, `no Friction move gives Skin back: the most it rose in a frame is ${worst.toFixed(3)} (regen alone is ${(regen / 60).toFixed(3)})`);

// ------------------------------------------------------------------ Absolute Traction
console.log('Absolute Traction');
for (const camera of ['top', 'third']) {
  await stage([0, 0, 9], camera, 0, -0.1);
  await api((g) => g.god(false));
  const i = await body('thug', [0, 0, 6]);
  await api((g) => { const e = g.game.encounters.enemies.at(-1); e.hp = e.maxHp = 400; });
  const hp0 = await api((g) => g.game.combat.hp);
  const e0 = await enemy(i);
  await api((g) => { g.game.techniques.charge = 1; });
  await tap('KeyQ');
  const id = await api((g) => g.cutscenes().active);
  const beat = await api((g) => g.cutscenes().defs['max-friction'].beat);
  const stops = [0.45, beat - 0.25, beat + 0.06, beat + 0.5, beat + 1.2];
  let t = 0, k = 0;
  for (let f = 0; f < 60 * 5 && k < stops.length; f++) {
    t = await api((g) => g.cutscenes().timeline?.t ?? 99);
    if (t >= stops[k]) { if (shots) await full(); k++; }
    await step(1);
  }
  while (await api((g) => g.cutscenes().active)) await step(5);
  await step(40);
  await full();
  await strip(`absolute-traction-${camera}`);
  const e1 = await enemy(i);
  const hp1 = await api((g) => g.game.combat.hp);
  await api((g) => g.god(true));
  if (camera === 'top') {
    check(id, 'Q plays the Absolute Traction cutscene');
    check(e1.hp < e0.hp - 40 && flat(e0.at, e1.at) > 4, `its target takes ${e0.hp - e1.hp} and is hurled ${flat(e0.at, e1.at).toFixed(1)} m down the floor`);
    check(hp1 < hp0, `the grip leaves skin behind: ${hp0} to ${hp1.toFixed(1)} health`);
  }
}

// ------------------------------------------------------------------ Suriashi
console.log('Suriashi');
await stage([-11.4, 0.3, -7.4], 'top', 0);
await api((g) => g.drill('friction-suriashi'));
await step(5);
const drillMark = () => api((g) => { const c = g.game.drills.current; const it = c?.live[0]; return it?.mark ? { at: [it.mark.at.x, it.mark.at.y, it.mark.at.z], r: it.mark.radius } : null; });
const control0 = await api((g) => g.game.mastery.get('friction', 'control'));
// One mark: aim at it, push off, steer nothing, and press Open Hand when
// the stop will land on it: its palms land about a fifth of a second later.
const slideTo = async (overshoot = false) => {
  let m = null;
  for (let f = 0; f < 600 && !m; f++) { await step(1); m = await drillMark(); }
  if (!m) return false;
  await aimAt(m.at);
  await click('right');
  for (let f = 0; f < 300; f++) {
    await step(1);
    const p = await pos(), v = await speed();
    if (!overshoot && f > 24 && flat(p, m.at) < v * 0.2 + 0.25) break;
    if (overshoot && f > 70) break;
  }
  await tap('Digit1');
  const score = () => api((g) => g.game.drills.current?.score ?? -1);
  const s0 = await score();
  let at = await pos();
  for (let f = 0; f < 200 && (await drillMark()); f++) { await step(1); at = await pos(); }
  // The tier's last mark ends the drill, and its score with it; the tier's pass is checked below.
  const s1 = await score();
  return { scored: s1 >= 0 ? s1 > s0 : flat(at, m.at) <= m.r, miss: flat(at, m.at), r: m.r };
};
await step(2);
await api((g) => { const c = g.game.drills.current; if (c) c.waiting = false; });
const tierRuns = [];
for (let n = 0; n < 4; n++) tierRuns.push(await slideTo());
const scoredFirst = tierRuns.filter((r) => r.scored).length;
for (let f = 0; f < 600 && (await api((g) => g.game.drills.running)); f++) await step(1);
const reached = await api((g) => g.game.drills.reached('friction-suriashi'));
console.log(`    marks: ${tierRuns.map((r) => `${r.scored ? 'in' : 'out'} ${r.miss.toFixed(2)}/${r.r} m`).join(', ')}`);
// The next tier opens; a slide let run past its mark scores nothing.
await api((g) => g.drill('friction-suriashi'));
const over = await slideTo(true);
await api((g) => g.quitDrill());
check(!over.scored && over.miss > over.r, `a slide stopped ${over.miss.toFixed(2)} m from the mark scores nothing`);
if (shots) {
  await api((g) => g.drill('friction-suriashi'));
  await api((g) => { const c = g.game.drills.current; if (c) c.waiting = false; });
  for (let f = 0; f < 60; f++) await step(1);
  await page.screenshot({ path: join(out, 'suriashi-top.png'), animations: 'disabled' });
  await api((g) => g.quitDrill());
}
const control1 = await api((g) => g.game.mastery.get('friction', 'control'));
check(scoredFirst >= 3 && reached === 1 && control1 >= 0.55 && control0 < 0.55, `Suriashi's first tier is cleared with real input (${scoredFirst} of 4 marks), and Control stands at ${control1.toFixed(2)} (from ${control0.toFixed(2)})`);

// ------------------------------------------------------------------ the city's edge
// The ward is closed by walls nobody can see, colliders with nothing drawn on
// them: a palm finds nothing there to hold, so Open Hand can't climb out.
console.log('The city');
for (const e of [...errors, ...(await api((g) => g.errors))]) check(false, e);
errors.length = 0;
await page.goto(`${url}?debug&region=city`);
await page.waitForFunction(() => window.game?.game?.ready, null, { timeout: 180000 });
await api((g) => { g.loop(false); g.technique('friction'); g.game.startRun({ skipTutorial: true }); g.loop(false); g.step(5); g.god(true); });
const edge = await api((g) => { const o = g.game.city.origin; return [o.x + 65.2, o.y, o.z + 23]; });
await api((g, at) => { g.teleport(at); g.camera('third'); g.look(-Math.PI / 2, 0.15); g.step(30); g.game.techniques.resource = 100; }, edge);
await key('Digit1', true); await key('KeyW', true);
let edgeTop = 0;
for (let f = 0; f < 120; f++) { await step(1); edgeTop = Math.max(edgeTop, (await pos())[1] - edge[1]); }
// The wall is there, and tagged as stone, within the palms' reach.
const wall = await api((g) => { const G = g.game, p = G.player.position, V = p.constructor; const h = G.physics.castRay(p.clone().add(new V(0, 1.15, 0)), new V(1, 0, 0), 0.75, 0x0001, G.player.body); return h ? { toi: h.toi, tag: h.collider.surfaceTag } : null; });
await key('Digit1', false); await key('KeyW', false);
check(wall?.tag === 'stone' && edgeTop < 0.6, `at the ward's east edge Open Hand finds nothing drawn to hold on the invisible wall ${wall ? `${wall.toi.toFixed(2)} m off, tagged ${wall.tag}` : '(not found)'}: rose ${edgeTop.toFixed(2)} m`);

for (const e of [...errors, ...(await api((g) => g.errors))]) check(false, e);
writeFileSync(join(out, 'report.json'), JSON.stringify({ url, failures, errors }, null, 2));
await browser.close();
stop();
console.log(failures.length ? `\n${failures.length} failure(s)` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);
