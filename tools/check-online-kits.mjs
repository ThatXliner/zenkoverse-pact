#!/usr/bin/env node
// What the four newer Techniques leave in the world, seen from the other
// screens in an online room. Three browsers join one room through the join
// form: A casts, B is the one A's Abilities reach (and strings Tension's
// lines), C watches. Each step reads what C's (and B's) own game draws:
//   Heat: a pot A heats glows on C as on A; B burning from A's sear glows on
//   C and on B; A's own flush shows on C; the pond's ice floor A melts goes
//   on B and C too;
//   Tension: the lines B has standing are drawn on A and C, end to end where
//   B's own screen has them; a crate A sets on fire under one of them burns
//   it through on B's screen, and C sees it go;
//   Friction: C sees A crouch into a Slip's glide, play Open Hand's own
//   gesture and let it go when the key comes up, and Railstep's;
//   Electro: the charge A leaves in a pot crackles on C's screen, and a
//   discharge into the pond arcs over the water on C and hurts B wading in it.
// It saves C's view of each for review.
// Usage: node tools/check-online-kits.mjs [url] [--latency 120] [--out captures/online-kits] [--port 4181]
// Without a URL it serves dist/ through server/index.mjs (run `npm run build` first).
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveTarget } from './lib/target.mjs';

const { url, args, stop } = await resolveTarget(process.argv.slice(2), { realtime: true });
const latency = Number(args.latency ?? 0);
const out = args.out ?? `captures/online-kits${latency ? `-${latency}ms` : ''}`;
mkdirSync(out, { recursive: true });
const room = `kits-${Date.now().toString(36)}`;
const slack = 1 + latency / 100;

const failures = [];
const errors = [];
const check = (ok, what) => { if (!ok) failures.push(what); console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); return ok; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms * slack));
const flat = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });

async function player(name, tech) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 600 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|WebGL|GPU stall|Automatic fallback|WebSocket/.test(m.text())) errors.push(`${name} console: ${m.text()}`); });
  await page.goto(`${url}?debug&room=${room}`);
  await page.waitForFunction(() => window.game?.game?.ready, null, { timeout: 180000 });
  await page.locator('.card').filter({ has: page.locator('h3', { hasText: new RegExp(`^${tech}$`, 'i') }) }).click();
  await page.locator('input[name=name]').fill(name);
  await page.locator('[data-join]').click();
  await page.waitForFunction(() => window.game.net()?.status === 'online', null, { timeout: 15000 });
  const api = (fn, ...a) => page.evaluate(([f, ...rest]) => new Function('g', 'a', `return (${f})(g, ...a)`)(window.game, rest), [fn.toString(), ...a]);
  // Every effect call this screen replays from another player, by name.
  await api((g) => { const fx = g.game.net.fx, replay = fx.replay.bind(fx); window.__fx = []; fx.replay = (calls, self) => { for (const c of calls) window.__fx.push({ f: c.f, a: c.a, t: performance.now() }); return replay(calls, self); }; });
  return { name, page, api, id: (await api((g) => g.net().id)) };
}

const A = await player('Akane', 'heat');
const B = await player('Bo', 'tension');
const C = await player('Chie', 'recoil');
console.log(`room ${room} at ${url}${latency ? ` with ${latency} ms added each way` : ''}`);
for (const [p, others] of [[A, [B, C]], [B, [A, C]], [C, [A, B]]]) {
  await p.page.waitForFunction((ids) => ids.every((id) => window.game.game.net.remotes.get(id)?.drawn), others.map((o) => o.id), { timeout: 10000 * slack });
}

// Puts a player at `at`, over the shoulder, facing `look` (a point), still.
const stand = (p, at, look, pitch = -0.1, view = 'third') => p.api((g, at, look, pitch, view) => {
  const G = g.game;
  g.teleport(at); g.camera(view);
  if (look) g.look(Math.atan2(-(look[0] - at[0]), -(look[2] - at[2])), pitch);
  G.techniques.resource = G.techniques.def.resource.max;
  for (const k of Object.keys(G.techniques.cooldown)) G.techniques.cooldown[k] = 0;
}, at, look, pitch, view);
const ready = (p) => p.api((g) => { const t = g.game.techniques; t.resource = t.def.resource.max; for (const k of Object.keys(t.cooldown)) t.cooldown[k] = 0; t.cast_ = null; });
const cast = (p, slot) => p.api((g, s) => g.game.techniques.cast(s, true), slot);
const remote = (watcher, who, fn) => watcher.api((g, id, f) => new Function('r', 'G', `return (${f})(r, G)`)(g.game.net.remotes.get(id), g.game), who.id, fn.toString());
const propHeat = (p, id) => p.api((g, id) => g.game.props.byId(id)?.heat ?? null, id);
const kits = (p) => p.api((g) => g.game.net.kits.view());
const shot = async (p, label) => { const path = join(out, `${label}.png`); await p.page.screenshot({ path }); return path; };
const shots = [];
// Waits for a condition read from a page, up to `ms`.
async function until(read, test, ms = 3000) {
  const t0 = Date.now();
  for (;;) {
    const v = await read();
    if (test(v) || Date.now() - t0 > ms * slack) return v;
    await new Promise((r) => setTimeout(r, 60));
  }
}
// The props by their place in the compound, the same ids on every screen.
const props = await A.api((g) => g.game.props.instances.map((p) => ({ id: p.id, key: p.key, traits: p.def.traits, at: p.mesh.position.toArray(), half: [p.half.x, p.half.y, p.half.z] })));
// A prop by its key nearest a place, where it stands now (a body walking past may have nudged it).
const near = async (key, x, z) => {
  const p = props.filter((q) => q.key === key).sort((a, b) => flat(a.at, [x, 0, z]) - flat(b.at, [x, 0, z]))[0];
  return { ...p, at: await A.api((g, id) => g.game.props.byId(id).mesh.position.toArray(), p.id) };
};

// Places the players round a prop (`places` from where it stands) and waits
// until it stands still there: a body set down beside a prop can nudge it.
async function settled(key, x, z, places) {
  let p = await near(key, x, z);
  for (let i = 0; i < 4; i++) {
    for (const [who, at, look, pitch] of places(p.at)) await stand(who, at, look, pitch);
    await wait(700);
    const now = await near(key, x, z);
    const still = flat(now.at, p.at) < 0.05;
    p = now;
    if (still) break;
  }
  return p;
}

// ------------------------------------------------------------------ Heat
console.log('\nHeat: glow, burns, the flush and the melt');
{
  const pot = await settled('pot', 5.4, 8.3, (at) => [[B, [-3, 0, 4], null], [C, [at[0] + 2.5, 0, at[2] + 3.2], at, -0.25], [A, [at[0], 0, at[2] + 1.7], at]]);
  for (let i = 0; i < 2; i++) { await ready(A); await cast(A, 'primary'); await wait(450); }
  const onA = await propHeat(A, pot.id);
  const onC = await until(() => propHeat(C, pot.id), (h) => h > 0.15);
  check(onA > 0.15 && Math.abs(onA - onC) < 0.1, `the pot A heated glows on C as on A (${onA.toFixed(2)} on A, ${onC.toFixed(2)} on C)`);
  shots.push(await shot(C, 'heat-glow-c'));
  const later = await (async () => { await wait(1500); return [await propHeat(A, pot.id), await propHeat(C, pot.id)]; })();
  check(Math.abs(later[0] - later[1]) < 0.1 && later[1] < onC, `and cools on C as it cools on A (${later.map((h) => h.toFixed(2)).join(' and ')})`);

  // A sears B; C watches from the side.
  await stand(C, [2.2, 0, 9.6], null, -0.1, 'top');
  await stand(B, [0, 0, 8.4], [0, 0, 10]);
  await stand(A, [0, 0, 10], [0, 0, 8.4]);
  await wait(500);
  await ready(A); await cast(A, 'primary');
  const burnC = await until(() => remote(C, B, (r) => r.avatar.heat), (h) => h > 0.3);
  const burnB = await B.api((g) => ({ heat: g.game.avatar.heat, view: g.game.net.kits.view().burning }));
  const burning = await A.api((g) => g.heat().burning);
  check(burning === 1, `A's sear sets B burning on A's screen (${burning})`);
  check(burnC > 0.3, `C sees B burn (body heat ${burnC.toFixed(2)})`);
  check(burnB.heat > 0.3 && burnB.view > 0, `B sees its own body burn (${burnB.heat.toFixed(2)}, ${burnB.view.toFixed(1)} s left)`);
  shots.push(await shot(C, 'heat-burn-c'));
  await wait(2500);
  const cooled = await remote(C, B, (r) => r.avatar.heat);
  check(cooled < 0.05, `the burn runs out on C too (${cooled.toFixed(2)})`);
  // A's own flush: body heat high enough to show.
  await A.api((g) => g.heat(0.95));
  const flush = await until(() => remote(C, A, (r) => r.avatar.heat), (h) => h > 0.4);
  check(flush > 0.4, `A's flush shows on C (${flush.toFixed(2)})`);
  shots.push(await shot(C, 'heat-flush-c'));
  await A.api((g) => g.heat(0));

  // Rime's floor on everyone's pond; A's heat into it melts it on every screen.
  const floor = (p) => p.api((g) => { const G = g.game, pond = G.world.pond, V = G.player.position.constructor; return G.physics.castRay(new V(pond.center.x - 1.2, 2, pond.center.z), new V(0, -1, 0), 6)?.point.y ?? -9; });
  for (const p of [A, B, C]) await p.api((g) => g.ice(30));
  await stand(C, [11, 0.25, 16.5], [11, 0, 11], -0.35);
  await wait(300);
  const iced = [await floor(B), await floor(C)];
  await stand(A, [7.3, 0.25, 11], [11, 0, 11], -0.25);
  await wait(300);
  await ready(A); await cast(A, 'primary');
  const melted = [await until(() => floor(B), (y) => y < -0.6), await until(() => floor(C), (y) => y < -0.6)];
  check(iced.every((y) => y > -0.4) && melted.every((y) => y < -0.6), `the ice floor A melts goes on B and C (floor ${iced.map((y) => y.toFixed(2)).join(', ')} to ${melted.map((y) => y.toFixed(2)).join(', ')})`);
  shots.push(await shot(C, 'heat-melt-c'));
}

// ------------------------------------------------------------------ Tension
console.log('\nTension: lines standing, and fire that burns them through');
let lineZ;
{
  // B strings a line across the ground just south of the yard crates.
  const crate = await near('crate', 15.2, 1.8);
  lineZ = crate.at[2] - Math.max(crate.half[0], crate.half[2]) - 0.25;
  await stand(B, [15.6, 0, lineZ - 4.2], null, -0.1, 'top');
  await stand(C, [17.2, 0, lineZ - 5.6], null, -0.1, 'top');
  await stand(A, [crate.at[0] - 6, 0, lineZ - 6], null);
  await B.api((g) => { g.game.book.preview.value = { id: 'check.web', technique: 'tension', name: 'Web', slot: 'primary', grant: { shape: 'thread' }, clauses: [{ kind: 'restrict', restriction: { param: 'range', value: 'long' } }] }; });
  const face = (p, at) => p.api(async (g, at) => {
    const G = g.game, V = G.player.position.constructor, t = new V(...at), d = t.clone().sub(G.player.eye());
    G.cam.yaw = Math.atan2(-d.x, -d.z);
    // Top-down the camera leans toward the cursor, so the cursor is set until it settles on the point.
    for (let i = 0; i < 12; i++) { const s = t.clone().project(G.renderer.camera); G.input.mouse.x = s.x; G.input.mouse.y = s.y; for (let f = 0; f < 4; f++) await new Promise((r) => requestAnimationFrame(r)); }
  }, at);
  await wait(800);
  for (const x of [10.6, 19.0]) { await ready(B); await face(B, [x, 0, lineZ]); await cast(B, 'primary'); await wait(700); }
  const mine = await B.api((g) => g.tension().lines);
  const set = mine.find((l) => l.a === 'fixed' && l.b === 'fixed');
  if (!set) console.log('    lines', JSON.stringify(mine.map((l) => [l.a, l.b, l.at])), lineZ);
  check(!!set && mine.length === 2 && set.at.every((e) => Math.abs(e[2] - lineZ) < 0.8), `B strings a line between two pins and holds another (${mine.map((l) => `${l.a}-${l.b}`).join(', ')})`);
  for (const [w, label] of [[A, 'A'], [C, 'C']]) {
    const v = await until(() => kits(w), (k) => (k.lines[B.id] ?? []).length === mine.length);
    const shown = v.lines[B.id] ?? [];
    const match = set && shown.some((l) => l.visible && l.ends.every((e, i) => e && Math.hypot(e[0] - set.at[i][0], e[1] - set.at[i][1], e[2] - set.at[i][2]) < 0.05));
    const hand = shown.find((l) => l.ends[0] && mine.find((m) => m.a === 'hand'));
    check(shown.length === mine.length && !!match, `${label} draws B's ${shown.length} lines, the set one end to end where B has it`);
    if (label === 'C') check(!!hand && hand.visible, 'C draws the line still in B\'s hand, from B\'s hand');
  }
  shots.push(await shot(C, 'tension-lines-c'));
  shots.push(await shot(B, 'tension-lines-b'));

  // A sets the crate behind the line on fire: on B's screen the line burns through.
  await stand(A, [crate.at[0], 0, lineZ - 1.4], crate.at);
  await wait(300);
  let casts = 0;
  while ((await A.api((g) => g.heat().fires)) === 0 && casts < 8) { await ready(A); await cast(A, 'primary'); await wait(450); casts++; }
  check((await A.api((g) => g.heat().fires)) > 0, `A sets the crate on fire (${casts} casts)`);
  const heardB = await until(() => kits(B), (k) => k.fires > 0);
  check(heardB.fires > 0, `B's screen knows the ground there is burning (${heardB.fires} fires)`);
  const left = await until(() => B.api((g) => g.tension().lines), (l) => !l.some((x) => x.a === 'fixed' && x.b === 'fixed'), 4000);
  check(!left.some((x) => x.a === 'fixed' && x.b === 'fixed'), `the fire burns B's line through on B's screen (${left.map((l) => `${l.a}-${l.b}`).join(', ') || 'none left'})`);
  const seen = await until(() => kits(C), (k) => (k.lines[B.id] ?? []).length === left.length);
  check((seen.lines[B.id] ?? []).length === left.length, `and C sees it go (${(seen.lines[B.id] ?? []).length} of B's lines left on C)`);
  const crateC = await propHeat(C, crate.id);
  check(seen.fires > 0 && crateC > 0.5, `C sees the crate burning (heat ${crateC?.toFixed(2)}, ${seen.fires} fires)`);
  shots.push(await shot(C, 'tension-burnt-c'));
  // B lets the rest go: a Technique change leaves no line on anyone's screen.
  await B.api((g) => { g.game.book.preview.value = null; g.technique('recoil'); });
  const none = await until(() => kits(C), (k) => !k.lines[B.id]);
  check(!none.lines[B.id], 'B changes Technique and C draws none of its lines');
}

// ------------------------------------------------------------------ Friction
console.log('\nFriction: the glide and its own gestures');
{
  await A.api((g) => g.technique('friction'));
  await stand(A, [-6, 0, 3], [6, 0, 3]);
  await stand(C, [0, 0, 8], [0, 0, 3], -0.2);
  await stand(B, [-3, 0, -4], null);
  await wait(400);
  await ready(A); await cast(A, 'secondary');
  const glide = await until(() => remote(C, A, (r) => ({ glide: r.avatar.glide, speed: Math.hypot(r.velocity.x, r.velocity.z) })), (v) => v.glide && v.speed > 4);
  check(glide.glide && glide.speed > 4, `C sees A crouch into the glide (${glide.speed.toFixed(1)} m/s)`);
  shots.push(await shot(C, 'friction-glide-c'));
  // Open Hand, held on its key, stops the slide dead; C sees its own gesture.
  await A.page.keyboard.down('Digit1');
  const open = await until(() => remote(C, A, (r) => ({ key: r.gestureKey, playing: r.avatar.performing, pose: r.avatar.gesture.clock.gesture?.keys?.map((k) => k.right) ?? [] })), (v) => v.key === 'openHand');
  check(open.key === 'openHand' && open.pose.includes('wallPress'), `C sees Open Hand's own gesture, the palms pressed out (${open.key}: ${open.pose.join(', ')})`);
  await wait(500);
  check(await remote(C, A, (r) => r.avatar.performing && !r.avatar.glide), 'C sees A hold it while the key is down, out of the glide');
  shots.push(await shot(C, 'friction-open-hand-c'));
  await A.page.keyboard.up('Digit1');
  const let_ = await until(() => remote(C, A, (r) => r.avatar.performing), (p) => !p, 2000);
  check(!let_, 'and let it go when the key comes up');
  await wait(400);
  await ready(A);
  await A.page.keyboard.down('Digit2'); await wait(60); await A.page.keyboard.up('Digit2');
  const rail = await until(() => remote(C, A, (r) => ({ key: r.gestureKey, pose: r.avatar.gesture.clock.gesture?.keys?.map((k) => k.right) ?? [] })), (v) => v.key === 'railstep');
  check(rail.key === 'railstep' && rail.pose.includes('skateFwd'), `C sees Railstep's own gesture, the arms swinging to the strides (${rail.key}: ${rail.pose.join(', ')})`);
  await wait(250);
  shots.push(await shot(C, 'friction-railstep-c'));
}

// ------------------------------------------------------------------ Electro
console.log('\nElectro: charge held in metal, the pond current');
{
  await A.api((g) => g.technique('electro'));
  await settled('pot', 5.4, 8.3, (at) => [[B, [-3, 0, 4], null], [C, [at[0] + 2.5, 0, at[2] + 3.2], at, -0.25], [A, [at[0], 0, at[2] + 1.7], at, -0.3]]);
  await C.api(() => { window.__fx.length = 0; });
  await ready(A); await cast(A, 'primary');
  await wait(1600);
  const held = await A.api((g) => g.electro().held);
  const charged = props.find((p) => p.id === held[0]?.id);
  const arcs = charged ? await C.api((g, at) => window.__fx.filter((c) => c.f === 'arc' && c.a[0]?.v && Math.hypot(c.a[0].v[0] - at[0], c.a[0].v[2] - at[2]) < 1).length, charged.at) : 0;
  check(!!charged?.traits.includes('metal'), `A's discharge leaves charge in a pot (${held.map((h) => h.charge.toFixed(1)).join(', ')})`);
  check(arcs >= 3, `the charge held in it crackles on C's screen (${arcs} arcs at the pot in 1.6 s)`);
  shots.push(await shot(C, 'electro-pot-c'));
  // B wades into the pond; A discharges into the water from the rim.
  const P = await A.api((g) => { const p = g.game.world.pond; return [p.center.x, p.surfaceY, p.center.z]; });
  await stand(B, [P[0] + 0.9, -0.9, P[2] - 0.7], null);
  await stand(C, [P[0] + 4.5, 0.25, P[2] + 4.5], P, -0.35);
  await stand(A, [P[0], 0.25, P[2] + 3.4], [P[0], P[1], P[2] + 2.1], -0.95);
  await wait(1700);
  await C.api(() => { window.__fx.length = 0; });
  const hp0 = await B.api((g) => g.game.combat.hp);
  await ready(A); await cast(A, 'primary');
  const hp1 = await until(() => B.api((g) => g.game.combat.hp), (h) => h < hp0);
  await wait(300);
  const water = await C.api((g, P) => window.__fx.filter((c) => c.f === 'arc' && c.a[0]?.v && Math.abs(c.a[0].v[1] - P[1]) < 0.2 && Math.hypot(c.a[0].v[0] - P[0], c.a[0].v[2] - P[2]) < 4).length, P);
  check(water >= 3, `the current arcs over the pond on C's screen (${water} arcs on the water)`);
  check(hp1 < hp0, `and B, wading in it, takes it (${hp0} to ${hp1})`);
  shots.push(await shot(C, 'electro-pond-c'));
}

check(!errors.length, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
writeFileSync(join(out, 'shots.json'), JSON.stringify(shots, null, 2));
await browser.close();
stop();
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
process.exit(failures.length ? 1 : 0);
