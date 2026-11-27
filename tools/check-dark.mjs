#!/usr/bin/env node
// Proves Dark Dimension (issue #21) in play, with real keys and clicks, and
// saves frame strips of its moves from the top-down and over-the-shoulder
// cameras for the critic:
//   Seal takes a crate out of the world (not drawn, not simulated, not in
//   reach of anything) and the HUD shows it; the gate stays shut a while,
//   longer for a heavier thing; Summon lets it out at the aim; nothing is
//   ever copied or lost: every prop is in the world or in storage, once;
//   a crate sealed in flight keeps its speed and heading through a wait and
//   comes out with them, and strikes the body in its path; what is hot stays
//   hot and what is in ice stays in ice while kept, and a frozen thing hangs
//   where it comes out; living things cannot enter, the seam throws them off;
//   the storage Pact parameter limits how many and what kind (still only);
//   a blow during the Seal's wind-up spoils it; a lethal blow lets
//   everything out at once round the bearer, still moving; the pond gives
//   up water and the Kuroda's pour can be sealed before his snap;
//   Arsenal calls the fastest kept thing from behind a body along its own
//   heading; Open Estate empties the storage at its target;
//   Kaeshi, the drill, is cleared with real input and raises Control;
//   online, a sealed crate leaves the other player's world too, comes back
//   where it is summoned, and comes back where the bearer stood when they leave.
// The ?debug hooks place the player, props and bodies and read state; every
// Ability is cast from its key or button.
// Usage: node tools/check-dark.mjs [url] [--out captures/dark] [--no-shots] [--only seal,momentum,...] [--no-online] [--online]
// Without a URL it serves dist/ through server/index.mjs (run `npm run build` first).
import { chromium } from 'playwright';
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveTarget } from './lib/target.mjs';

const { url, args, stop } = await resolveTarget(process.argv.slice(2), { realtime: true });
const out = args.out ?? 'captures/dark';
const shots = args['no-shots'] !== 'true';
const only = args.only ? new Set(args.only.split(',')) : null;
const run = (part) => !only || only.has(part);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
const watch = (p, who = '') => {
  p.on('pageerror', (e) => errors.push(`${who}pageerror: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' && !/favicon|WebGL|GPU stall|Automatic fallback|WebSocket/.test(m.text())) errors.push(`${who}console: ${m.text()}`); });
};
watch(page);
const failures = [];
const check = (ok, what) => { if (!ok) failures.push(what); console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); return ok; };
const apiOf = (p) => (fn, ...a) => p.evaluate(([f, ...rest]) => { const g = window.game; return new Function('g', 'a', `return (${f})(g, ...a)`)(g, rest); }, [fn.toString(), ...a]);
const api = apiOf(page);
const step = (n = 1) => api((g, k) => g.step(k, 1 / 60), n);
const dark = () => api((g) => g.dark());
const len = (v) => Math.hypot(...v);
const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (len(a) * len(b) || 1))));
// Every prop, wherever it is: in the world or sealed away. Each id once.
const census = () => api((g) => { const P = g.game.props; return { world: P.instances.map((p) => p.id), sealed: P.sealed.map((p) => p.id), drawn: P.sealed.filter((p) => p.mesh.parent).length }; });

await page.goto(`${url}?debug`);
await page.waitForFunction(() => window.game?.game?.ready, null, { timeout: 180000 });
await api((g) => { g.loop(false); localStorage.removeItem('zenko.drills.v1'); g.game.drills.progress = {}; g.game.mastery.reset(); });

// A fresh run with Dark Dimension in hand, at `at`, in `camera`, facing `yaw`.
const stage = async (at, camera = 'top', yaw = 0, pitch = -0.1) => {
  await api((g, at, camera, yaw, pitch) => {
    // What the last section threw about goes, so it is not in this one's way.
    for (const id of window.__checkProps ?? []) { const p = g.game.props.byId(id); if (p) g.game.props.remove(p); }
    window.__checkProps = [];
    g.technique('dark'); g.game.startRun({ skipTutorial: true }); g.loop(false); g.step(5);
    g.god(true); g.teleport(at); g.camera(camera); g.look(yaw, pitch); g.step(30);
    g.game.book.preview.value = null;
    const t = g.game.techniques; t.resource = t.def.resource.max;
  }, at, camera, yaw, pitch);
};
const fill = () => api((g) => { const t = g.game.techniques; t.resource = t.def.resource.max; for (const k of Object.keys(t.cooldown)) t.cooldown[k] = 0; });
// A prop of `key` put down (or thrown) at `at`; its id.
const prop = (key, at, vel) => api((g, key, at, vel) => {
  const G = g.game, V = G.player.position.constructor;
  const p = G.props.spawn(key, new V(...at));
  if (vel) G.props.launch(p, new V(...vel));
  (window.__checkProps ??= []).push(p.id);
  return p.id;
}, key, at, vel);
const propAt = (id) => api((g, id) => { const p = g.game.props.byId(id); if (!p) return null; const v = p.body.linvel(); return { at: p.mesh.position.toArray(), vel: [v.x, v.y, v.z], sealed: !!p.sealed, heat: p.heat, frozen: p.frozen, type: p.body.bodyType(), alive: p.alive }; }, id);
const body = (key, at) => api((g, key, at) => {
  const G = g.game, V = G.player.position.constructor;
  const e = G.encounters.spawn(key, new V(...at));
  e.attackCd = 1e9; e.castCd = 1e9; e.field = null;
  g.step(3);
  return G.encounters.enemies.length - 1;
}, key, at);
const enemy = (i) => api((g, i) => { const e = g.game.encounters.enemies[i]; return { at: e.position.toArray(), hp: e.hp, alive: e.alive }; }, i);
const screenOf = (p) => api((g, p) => { const cam = g.game.renderer.camera, V = cam.position.constructor; cam.updateMatrixWorld(); const q = new V(...p).project(cam); return [(q.x * 0.5 + 0.5) * innerWidth, (-q.y * 0.5 + 0.5) * innerHeight]; }, p);
const aimAt = async (p) => { const [x, y] = await screenOf(p); await page.mouse.move(x, y); await step(2); };
const click = async (button = 'left') => { await page.mouse.down({ button }); await step(1); await page.mouse.up({ button }); };
const tap = async (code) => { await page.keyboard.down(code); await step(1); await page.keyboard.up(code); };
// The gate the moment a seal lands: steps until the storage grows.
const gateOnSeal = async () => { const n = (await dark()).stored.length; for (let i = 0; i < 40; i++) { const d = await dark(); if (d.stored.length > n) return d.gate; await step(1); } return 0; };
// Casts sealed with the next press: the gate open, the cooldown spent.
const ready = async () => { for (let i = 0; i < 200 && ((await dark()).gate > 0 || (await api((g) => g.game.techniques.casting))); i++) await step(2); await fill(); };
// Aims at prop `id` where it will be in `lead` seconds and seals it.
const sealProp = async (id, lead = 0.2) => {
  const p = await propAt(id);
  await aimAt([p.at[0] + p.vel[0] * lead, Math.max(0, p.at[1] + p.vel[1] * lead - 4.9 * lead * lead), p.at[2] + p.vel[2] * lead]);
  await click('left');
  await step(28);
};

// Frames: a strip of crops around a point, several beats wide.
const tiles = [];
const tile = async (focus, half = 230) => {
  if (!shots) return;
  const at = focus ?? (await api((g) => { const p = g.game.player.position; return [p.x, p.y + 0.9, p.z]; }));
  const [x, y] = await screenOf(at);
  const left = Math.round(Math.min(1280 - 2 * half, Math.max(0, x - half))), top = Math.round(Math.min(720 - 2 * half, Math.max(0, y - half)));
  tiles.push(await sharp(await page.screenshot({ clip: { x: left, y: top, width: 2 * half, height: 2 * half }, animations: 'disabled' })).resize(300, 300).png().toBuffer());
};
const full = async () => { if (shots) tiles.push(await sharp(await page.screenshot({ animations: 'disabled' })).resize(480, 270).png().toBuffer()); };
const strip = async (name) => {
  if (!shots || !tiles.length) return;
  const m = await sharp(tiles[0]).metadata();
  await sharp({ create: { width: m.width * tiles.length, height: m.height, channels: 3, background: '#000' } }).composite(tiles.map((b, i) => ({ input: b, left: i * m.width, top: 0 }))).png().toFile(join(out, `${name}.png`));
  tiles.length = 0;
};

// ------------------------------------------------------------------ Seal and Summon
if (run('seal')) {
console.log('Seal and Summon');
for (const camera of ['top', 'third']) {
  await stage([12.6, 0, -0.6], camera, Math.PI / 2, -0.25);
  const id = await prop('crate', [9.2, 0.05, -0.6]);
  await step(30);
  const before = await census();
  const at0 = (await propAt(id)).at;
  await aimAt(at0);
  await tile(at0);
  await click('left');
  await step(8); await tile(at0);
  const gateBig = await gateOnSeal();
  await tile(at0);
  await step(12);
  const d = await dark();
  const mid = await census();
  await tile(at0);
  if (camera === 'top') {
    check(d.stored.length === 1 && d.stored[0].id === id, 'Seal takes the crate it is aimed at');
    check(!mid.world.includes(id) && mid.sealed.includes(id) && mid.drawn === 0, 'the sealed crate is out of the world: not simulated, not drawn');
    check(mid.world.length + mid.sealed.length === before.world.length, `nothing is lost or copied: ${before.world.length} props before, ${mid.world.length} + ${mid.sealed.length} after`);
    check(gateBig > 0.5, `the gate stays shut after a crate: ${gateBig.toFixed(2)} s`);
    const tilesShown = await page.locator('.dark-store .kept').count();
    check(tilesShown === 1, `the HUD shows what is kept: ${tilesShown} tile`);
    // Shut: a second seal at once finds the gate closed.
    const can = await prop('crateSmall', [9.6, 0.05, 0.6]);
    await step(10); await fill();
    await aimAt((await propAt(can)).at); await click('left'); await step(28);
    check((await dark()).stored.length === 1, 'with the gate shut, a second seal takes nothing');
    await ready();
    await aimAt((await propAt(can)).at);
    await click('left');
    const gateSmall = await gateOnSeal();
    const d2 = await dark();
    check(d2.stored.length === 2 && gateSmall < gateBig - 0.2, `a small crate shuts the gate for less than a big one: ${gateSmall.toFixed(2)} s against ${gateBig.toFixed(2)} s`);
    await ready();
  }
  const spot = camera === 'top' ? [8, 0, 2.5] : [8.5, 0.3, -0.6];
  await aimAt(spot);
  await click('right');
  await step(10); await tile(spot);
  await step(20); await tile(spot);
  if (camera === 'top') {
    const left = (await dark()).stored.map((k) => k.id);
    check(left.length === 1 && left[0] === id, 'Summon lets out one thing at a time, the last in first');
    await ready(); await aimAt(spot); await click('right'); await step(40);
  }
  const after = await census();
  const p = await propAt(id);
  if (camera === 'top') {
    check((await dark()).stored.length === 0 && after.world.includes(id) && !p.sealed, 'Summon lets the crate back into the world');
    check(Math.hypot(p.at[0] - spot[0], p.at[2] - spot[2]) < 2, `it comes out at the aim: ${Math.hypot(p.at[0] - spot[0], p.at[2] - spot[2]).toFixed(2)} m off`);
    check(after.world.length === before.world.length + 1 && after.sealed.length === 0, 'every prop is back in the world, once');
  }
  await strip(`seal-summon-${camera}`);
}

}

// ------------------------------------------------------------------ momentum
if (run('momentum')) {
console.log('\nWhat goes in moving comes out moving');
await stage([12.6, 0, -0.6], 'top', Math.PI / 2);
const dummyI = await body('dummy', [6.0, 0, 3.0]);
const hp0 = (await enemy(dummyI)).hp;
// Thrown across in front of the bearer, from the north.
const thrown = await prop('crate', [15.6, 1.4, -5.5], [0, 2.5, 9]);
await step(12);
const flying = await propAt(thrown);
await sealProp(thrown, 0.25);
let d = await dark();
check(d.stored.length === 1 && d.stored[0].speed > 6, `a crate sealed in flight keeps its speed: ${d.stored[0]?.speed.toFixed(1)} m/s (it flew at ${len(flying.vel).toFixed(1)})`);
const kept = d.stored[0]?.vel ?? [0, 0, 0];
check(angle(kept, [0, 0, 1]) < 0.6, 'and its heading');
await step(180);
d = await dark();
check(Math.abs(d.stored[0].speed - len(kept)) < 1e-3, `no time passes inside: after three seconds it still moves at ${d.stored[0].speed.toFixed(2)} m/s`);
// Out a couple of metres north of the dummy: its own heading carries it south into it.
const dz = await enemy(dummyI);
await ready();
await aimAt([dz.at[0], 0, dz.at[2] - 1.8]);
await click('right');
for (let i = 0; i < 14 && (await dark()).flying === 0; i++) await step(2);
const outV = (await propAt(thrown)).vel;
check(angle(outV, kept) < 0.3 && Math.abs(len(outV) - len(kept)) < 2, `it comes out moving as it went in: ${len(outV).toFixed(1)} m/s, ${(angle(outV, kept) * 57.3).toFixed(0)} degrees off`);
await tile(dz.at);
for (let i = 0; i < 4; i++) { await step(5); await tile(dz.at); }
const hp1 = (await enemy(dummyI)).hp;
check(hp1 < hp0, `the stored motion strikes the body in its path: ${hp0 - hp1} damage`);
check(!!(await dark()).lastStrike, 'the blow is the summoned crate\'s');
await strip('momentum-top');

}

// ------------------------------------------------------------------ heat and ice
if (run('ice')) {
console.log('\nHeat and ice wait inside');
await stage([12.6, 0, -0.6], 'top', Math.PI / 2);
const hot = await prop('pot', [9.6, 0.05, -0.6]);
const cool = await prop('pot', [9.6, 0.05, 2.6]);
await api((g, a, b) => { g.game.props.warm(g.game.props.byId(a), 0.9); g.game.props.warm(g.game.props.byId(b), 0.9); }, hot, cool);
await step(10);
await aimAt((await propAt(hot)).at); await click('left'); await step(28);
await step(300);
const h1 = await propAt(hot), c1 = await propAt(cool);
check(h1.sealed && h1.heat > 0.85 && c1.heat < h1.heat - 0.2, `kept five seconds, the pot is as hot as it went in (${h1.heat.toFixed(2)}); the one left out cooled to ${c1.heat.toFixed(2)}`);
await ready(); await aimAt([9, 0, 5]); await click('right'); await step(30);
check((await propAt(hot)).heat > 0.8, 'it comes out still glowing');
const ice = await prop('crate', [9.6, 0.05, -2.2]);
await step(10);
await api((g, id) => g.game.props.freeze(g.game.props.byId(id), 5), ice);
await ready(); await aimAt((await propAt(ice)).at); await click('left'); await step(28);
await step(360);
const i1 = await propAt(ice);
check(i1.sealed && i1.frozen > 4.4, `Rime's ice does not melt inside: ${i1.frozen.toFixed(2)} s of it left after six`);
await ready(); await aimAt([7.5, 0, -2.2]); await click('right'); await step(40);
const i2 = await propAt(ice);
await tile(i2.at);
check(!i2.sealed && i2.type === 1 && i2.at[1] > 0.6, `out of storage, the frozen crate hangs where it appeared, ${i2.at[1].toFixed(2)} m up`);
await strip('ice-top');

}

// ------------------------------------------------------------------ people
if (run('people')) {
console.log('\nLiving things cannot enter');
await stage([0, 0, 6], 'top', 0);
const thug = await body('thug', [0, 0, 2.5]);
const t0 = await enemy(thug);
const n0 = (await census()).sealed.length;
await aimAt([0, 1, 2.5]); await click('left');
await step(10); await tile([0, 1, 2.5]); await step(18); await tile([0, 1, 2.5]);
const t1 = await enemy(thug);
check((await census()).sealed.length === n0 && (await dark()).stored.length === 0 && t1.alive, 'Seal on a body takes nothing');
check(t1.hp < t0.hp && Math.hypot(t1.at[0] - t0.at[0], t1.at[2] - t0.at[2]) > 0.4, `the seam throws it off: ${t0.hp - t1.hp} damage, pushed ${Math.hypot(t1.at[0] - t0.at[0], t1.at[2] - t0.at[2]).toFixed(1)} m`);
await strip('refuse-top');

}

// ------------------------------------------------------------------ Pact limits
if (run('pact')) {
console.log('\nThe storage parameter');
const draft = (value) => api((g, value) => { g.game.book.preview.value = { id: `check.${value}`, technique: 'dark', name: 'Check', slot: 'primary', grant: { shape: 'seal' }, clauses: [{ kind: 'restrict', restriction: { param: 'storage', value } }] }; }, value);
await stage([12.6, 0, -0.6], 'top', Math.PI / 2);
await draft('one');
const a1 = await prop('crateSmall', [9.6, 0.05, -1.2]);
const a2 = await prop('crateSmall', [9.6, 0.05, 1.4]);
await step(20);
await aimAt((await propAt(a1)).at); await click('left'); await step(28);
await ready(); await aimAt((await propAt(a2)).at); await click('left'); await step(28);
check((await dark()).stored.length === 1, 'keeping one thing at a time, a second seal takes nothing');
await stage([12.6, 0, -0.6], 'top', Math.PI / 2);
await draft('still');
const mover = await prop('crate', [15.6, 1.4, -5.5], [0, 2.5, 9]);
await step(12);
await sealProp(mover, 0.25);
check((await dark()).stored.length === 0, 'taking only what is at rest, a crate in flight is not taken');
await api((g) => { g.game.book.preview.value = null; });
const params = await api((g) => g.game.techniques.def.parameters);
check(params.includes('storage'), 'the Workshop offers it for Dark Dimension');

}

// ------------------------------------------------------------------ counters
if (run('counters')) {
console.log('\nCounters');
await stage([12.6, 0, -0.6], 'top', Math.PI / 2);
await api((g) => g.god(false));
const c = await prop('crate', [9.6, 0.05, -0.6]);
await step(10);
await aimAt((await propAt(c)).at);
await click('left');
await step(4);
await api((g) => { const G = g.game, V = G.player.position.constructor; G.combat.hurtPlayer(4, { from: G.player.position.clone().add(new V(1, 0, 0)), kinetic: true }); });
await step(30);
check((await dark()).stored.length === 0 && !(await propAt(c)).sealed, 'a blow before the seam closes spoils the Seal');
check((await dark()).gate > 0, 'and shuts the gate');
await ready();
const k1 = await prop('crate', [9.6, 0.05, -2.0]);
const k2 = await prop('pot', [9.6, 0.05, 1.0]);
await step(10);
await aimAt((await propAt(k1)).at); await click('left'); await step(28); await ready();
await aimAt((await propAt(k2)).at); await click('left'); await step(28); await ready();
const k3 = await prop('crate', [15.6, 1.4, -5.5], [0, 2.5, 9]);
await step(12);
await sealProp(k3, 0.25);
const before3 = (await dark()).stored.length;
const me = await api((g) => g.game.player.position.toArray());
await tile(me);
await api((g) => { const G = g.game, V = G.player.position.constructor; G.combat.hurtPlayer(G.combat.hp + 50, { from: G.player.position.clone().add(new V(1, 0, 0)), kinetic: true }); });
await step(3); await tile(me); await step(8); await tile(me);
const after3 = await dark();
const back = await Promise.all([k1, k2, k3].map(propAt));
check(before3 === 3 && after3.stored.length === 0 && back.every((p) => !p.sealed && p.alive), `a lethal blow lets everything kept back out (${before3} things)`);
check(back.every((p) => Math.hypot(p.at[0] - me[0], p.at[2] - me[2]) < 4), 'round the body that fell');
check(len(back[2].vel) > 3, `still moving: the crate kept in flight comes out at ${len(back[2].vel).toFixed(1)} m/s`);
await strip('postmortem-top');

}

// ------------------------------------------------------------------ water and the Kuroda's pour
if (run('water')) {
console.log('\nWater and fuel');
await stage([11, 0, 6.8], 'top', 0);
await aimAt([11, -0.4, 10.8]); await click('left'); await step(28);
check((await dark()).stored[0]?.kind === 'water', 'Seal on the pond takes a body of water');
const wet = await body('thug', [6, 0, 5]);
const w0 = (await enemy(wet)).hp;
await ready(); await aimAt((await enemy(wet)).at); await click('right'); await step(40);
check((await enemy(wet)).hp < w0, 'let out over a body, the water comes down on it');
await stage([0, 0, 8], 'top', 0);
await api((g) => g.god(true));
const kur = await api((g) => { const G = g.game, V = G.player.position.constructor; const e = G.encounters.spawn('kuroda', new V(0, 0, 0)); e.attackCd = 1e9; e.castCd = 0; g.step(3); return G.encounters.enemies.length - 1; });
let pour = [];
for (let i = 0; i < 400 && !pour.length; i++) { await step(2); pour = await api((g, i) => g.game.encounters.enemies[i].pour.map((p) => p.toArray()), kur); }
if (check(pour.length > 0, 'the Enforcer pours his fuel')) {
  await step(25);
  pour = await api((g, i) => g.game.encounters.enemies[i].pour.map((p) => p.toArray()), kur);
  await aimAt(pour[0]); await click('left'); await step(20);
  const left = await api((g, i) => g.game.encounters.enemies[i].pour.length, kur);
  const kinds = (await dark()).stored.map((s) => s.kind);
  check(kinds.includes('fuel') || kinds.includes('fire'), `his pour is sealed away before it burns (kept: ${kinds.join(', ')}; ${left} pool waiting)`);
}

}

// ------------------------------------------------------------------ Arsenal
if (run('arsenal')) {
console.log('\nArsenal');
await stage([12.6, 0, -0.6], 'top', Math.PI / 2);
const ars = await body('dummy', [7.5, 0, 0.5]);
const ar0 = (await enemy(ars)).hp;
const still = await prop('barrel', [9.6, 0.05, -2.4]);
const fast = await prop('crate', [15.6, 1.4, -5.5], [0, 2.5, 9]);
await step(12);
await sealProp(fast, 0.25); await ready();
await aimAt((await propAt(still)).at); await click('left'); await step(28); await ready();
check((await dark()).stored.length === 2, 'two kept: a crate in flight, then a barrel at rest');
await tap('Digit1');
await step(12); await tile([7.5, 1, 0.5]);
for (let i = 0; i < 4; i++) { await step(5); await tile([7.5, 1, 0.5]); }
const kept2 = (await dark()).stored;
check(kept2.length === 1 && kept2[0].id === still, 'Arsenal calls the fastest thing kept, not the last');
await step(30);
if (args.verbose) console.log('   ', JSON.stringify((await dark()).lastExit), JSON.stringify((await dark()).lastStrike), JSON.stringify(await propAt(fast)));
check((await enemy(ars)).hp < ar0, 'opened behind the body, its own heading carries it through');
await strip('arsenal-top');

}

// ------------------------------------------------------------------ Open Estate
if (run('estate')) {
console.log('\nOpen Estate');
await stage([12.6, 0, -0.6], 'top', Math.PI / 2);
await api((g) => g.setting('cutscenes', 'always'));
const e1 = await prop('crate', [9.6, 0.05, -1.4]);
const e2 = await prop('barrel', [9.6, 0.05, 1.4]);
await step(10);
for (const id of [e1, e2]) { await ready(); await aimAt((await propAt(id)).at); await click('left'); await step(28); }
check((await dark()).stored.length === 2, 'two kept for the estate');
const est = await body('thug', [8.6, 0, -0.6]);
const es0 = (await enemy(est)).hp;
await ready();
await api((g) => { g.game.techniques.charge = 1; });
await tap('KeyQ');
const cutOn = await api((g) => g.cutscenes().active);
check(cutOn, 'Q plays the Open Estate cutscene');
for (let i = 0; i < 12; i++) { await step(16); await full(); }
await step(120);
const es1 = await enemy(est);
check((await dark()).stored.length === 0, 'Open Estate lets everything out');
check(es1.hp < es0 - 30, `and it lands on the target: ${es0 - es1.hp} damage`);
await strip('estate');

}

// ------------------------------------------------------------------ Kaeshi
if (run('kaeshi')) {
console.log('\nKaeshi');
const control0 = await api((g) => g.game.mastery.get('dark', 'control'));
await stage([12.6, 0, -0.6], 'top', 0);
// Seals each pitched crate near the top of its arc.
const catchPitch = async () => {
  for (let f = 0; f < 400; f++) {
    const v = await api((g) => g.kaeshi());
    const live = v.crates.length ? await propAt(v.crates[v.crates.length - 1]) : null;
    if (live && !live.sealed && live.vel[1] < 2.5 && len(live.vel) > 3) { await sealProp(v.crates[v.crates.length - 1], 0.22); return v.crates[v.crates.length - 1]; }
    await step(1);
  }
  return null;
};
// Lets kept crate `id` out up its own heading from the figure, so it carries into it.
const sendBack = async (id, shoot) => {
  await ready();
  const v = await api((g) => g.kaeshi());
  const k = (await dark()).stored.find((s) => s.id === id);
  if (!v.figure || !k) return;
  const flat = Math.hypot(k.vel[0], k.vel[2]) || 1;
  await aimAt([v.figure[0] - (k.vel[0] / flat) * 1.8, 0, v.figure[2] - (k.vel[2] / flat) * 1.8]);
  await click('right');
  if (shoot) for (let s = 0; s < 5; s++) { await step(5); await tile(v.figure); }
};
for (const [tier, items, crates] of [['Catch', 4, 1], ['Return', 4, 1], ['Ledger', 3, 2]]) {
  await api((g) => { g.drill('dark-kaeshi'); });
  await step(2); await tap('KeyE'); await step(2);
  for (let item = 0; item < items; item++) {
    await fill();
    const ids = [];
    for (let c = 0; c < crates; c++) { await ready(); const id = await catchPitch(); if (id !== null) ids.push(id); }
    if (tier !== 'Catch') for (const id of [...ids].reverse()) await sendBack(id, item === 0 && tier === 'Return');
    await step(tier === 'Catch' ? 60 : 140);
  }
  for (let f = 0; f < 900 && (await api((g) => g.game.drills.running)); f++) await step(2);
  const reached = await api((g) => g.game.drills.reached('dark-kaeshi'));
  check(reached >= (tier === 'Catch' ? 1 : tier === 'Return' ? 2 : 2) && (tier !== 'Ledger' || (await api((g) => g.game.mastery.get('dark', 'control'))) >= 0.99), `${tier} is cleared with real input (tier reached ${reached})`);
}
await strip('kaeshi-top');
const control1 = await api((g) => g.game.mastery.get('dark', 'control'));
check(control1 >= 0.99 && control1 > control0, `the tiers raise Control: ${control0.toFixed(2)} to ${control1.toFixed(2)}`);
const leftover = await census();
check(leftover.sealed.length === 0 || (await dark()).stored.length === leftover.sealed.length, 'the drill takes its crates away, sealed ones too');

}

// ------------------------------------------------------------------ online
if (run('online')) {
// The rooms need the game server: given a URL (a dev server has none), only with --online.
const servedHere = !args.url && !process.argv.slice(2).some((a) => /^https?:\/\//.test(a));
if (args['no-online'] !== 'true' && (servedHere || args.online === 'true')) {
  console.log('\nOnline: one crate for the room');
  const room = `dark-${Date.now().toString(36)}`;
  const join = async (name, tech) => {
    const ctx = await browser.newContext({ viewport: { width: 960, height: 600 } });
    const p = await ctx.newPage();
    watch(p, `${name} `);
    await p.goto(`${url}?debug&room=${room}`);
    await p.waitForFunction(() => window.game?.game?.ready, null, { timeout: 180000 });
    await p.locator('.card').filter({ has: p.locator('h3', { hasText: new RegExp(`^${tech}$`, 'i') }) }).click();
    await p.locator('input[name=name]').fill(name);
    await p.locator('[data-join]').click();
    await p.waitForFunction(() => window.game.net()?.status === 'online', null, { timeout: 15000 });
    return { ctx, page: p, api: apiOf(p) };
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const A = await join('Akane', 'Dark Dimension');
  const B = await join('Bo', 'Recoil');
  await A.api((g) => { g.camera('top'); g.teleport([12.6, 0, -0.6]); });
  await B.api((g) => { g.camera('top'); g.teleport([6, 0, 4]); });
  await wait(1200);
  const crateId = await A.api((g) => { const me = g.game.player.position; return g.game.props.instances.filter((p) => p.key === 'crate').sort((a, b) => a.mesh.position.distanceTo(me) - b.mesh.position.distanceTo(me))[0].id; });
  const seen = (P, id) => P.api((g, id) => { const p = g.game.props.byId(id); return p ? { sealed: !!p.sealed, drawn: !!p.mesh.parent, inWorld: g.game.props.instances.includes(p), at: p.mesh.position.toArray(), total: g.game.props.instances.length + g.game.props.sealed.length } : null; }, id);
  const total0 = (await seen(B, crateId)).total;
  await A.api((g, id) => { const G = g.game; const p = G.props.byId(id); G.cam.floorPoint = p.mesh.position.clone(); G.cam.yaw = Math.atan2(-(p.mesh.position.x - G.player.position.x), -(p.mesh.position.z - G.player.position.z)); }, crateId);
  await A.page.mouse.move(...(await A.api((g, id) => { const cam = g.game.renderer.camera; const q = g.game.props.byId(id).mesh.position.clone().project(cam); return [(q.x * 0.5 + 0.5) * innerWidth, (-q.y * 0.5 + 0.5) * innerHeight]; }, crateId)));
  await A.page.mouse.down(); await wait(50); await A.page.mouse.up();
  await wait(1200);
  const a1o = await seen(A, crateId), b1o = await seen(B, crateId);
  check(a1o.sealed && !a1o.drawn, 'A seals the crate out of the room\'s world');
  check(b1o.sealed && !b1o.drawn && !b1o.inWorld, 'on B\'s screen it is gone too: not drawn, not in reach');
  check(b1o.total === total0, `and B still counts every prop once: ${b1o.total}`);
  await A.api((g) => { g.game.techniques.resource = 100; });
  await wait(1200);
  const spotO = [8, 0, 2.5];
  await A.page.mouse.move(...(await A.api((g, p) => { const cam = g.game.renderer.camera, V = cam.position.constructor; const q = new V(...p).project(cam); return [(q.x * 0.5 + 0.5) * innerWidth, (-q.y * 0.5 + 0.5) * innerHeight]; }, spotO)));
  await A.page.mouse.down({ button: 'right' }); await wait(50); await A.page.mouse.up({ button: 'right' });
  await wait(2500);
  const a2o = await seen(A, crateId), b2o = await seen(B, crateId);
  check(!a2o.sealed && !b2o.sealed && b2o.drawn, 'summoned, it is back on both screens');
  check(Math.hypot(a2o.at[0] - b2o.at[0], a2o.at[2] - b2o.at[2]) < 0.3, `at the same place: ${Math.hypot(a2o.at[0] - b2o.at[0], a2o.at[2] - b2o.at[2]).toFixed(2)} m apart`);
  // Sealed again, then A leaves: the crate comes back where A stood, on B's screen.
  await wait(1500);
  await A.api((g, id) => { const G = g.game; G.cam.floorPoint = G.props.byId(id).mesh.position.clone(); }, crateId);
  await A.page.mouse.move(...(await A.api((g, id) => { const cam = g.game.renderer.camera; const q = g.game.props.byId(id).mesh.position.clone().project(cam); return [(q.x * 0.5 + 0.5) * innerWidth, (-q.y * 0.5 + 0.5) * innerHeight]; }, crateId)));
  await A.page.mouse.down(); await wait(50); await A.page.mouse.up();
  await wait(1200);
  const whereA = await A.api((g) => g.game.player.position.toArray());
  check((await seen(B, crateId)).sealed, 'sealed again before A leaves');
  await A.ctx.close();
  await wait(4000);
  const b3o = await seen(B, crateId);
  check(!b3o.sealed && b3o.drawn && Math.hypot(b3o.at[0] - whereA[0], b3o.at[2] - whereA[2]) < 3, `A leaves holding it: it comes back where A stood, ${Math.hypot(b3o.at[0] - whereA[0], b3o.at[2] - whereA[2]).toFixed(1)} m off`);
  check(b3o.total === total0, 'still one crate in the room');
  await B.ctx.close();
}

}

console.log(`\nframes in ${out}/`);
if (errors.length) { console.log('\nerrors'); for (const e of errors.slice(0, 20)) console.log(`  ${e}`); }
await browser.close();
stop();
if (failures.length || errors.length) { console.log(`\n${failures.length} failed, ${errors.length} errors`); process.exit(1); }
console.log('\nall passed');
