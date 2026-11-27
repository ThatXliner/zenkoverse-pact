#!/usr/bin/env node
// Proves Tension's rules in play (issue #22). Lines chain: each throw passes
// the line in hand on to what it strikes and the hand takes up a new one, up
// to the limit. A body that runs into a set line trips; a body tied to one is
// held to its length and strains against it. Holding a body goes through
// Enemy.freeze, so neither spamming snares at one body nor walking it back
// and forth over a line can hold it for long. A draw yanks what the lines
// hold and flings what they carry; held past taut a line gives into the
// caster's hand; from the yard a line to the hall roof hauls the caster onto
// it. Slack spoils a wind-up. A blow swung through a line cuts it, and a boss
// snaps it. Drawn World ties everything in reach together and costs the
// caster a share. A Technique change leaves no line behind. Snare Lanes is
// played through every tier. Frames of each verb are saved, top-down and over
// the shoulder, as strips.
// Usage: node tools/check-tension.mjs [url] [--out captures/tension] [--port 4173] [--no-shots]
// Without a URL it serves dist/ itself (run `npm run build` first).
import { chromium } from 'playwright';
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveTarget } from './lib/target.mjs';

const { url, args, stop } = await resolveTarget();
const out = args.out ?? 'captures/tension';
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

// Frames for a strip, saved together at the end of a verb.
let tiles = [];
const frame = async () => { if (shots) tiles.push(await page.screenshot({ animations: 'disabled' }).then((b) => sharp(b).resize(480, 270).png().toBuffer())); };
const strip = async (name) => {
  if (!shots || !tiles.length) return;
  const cols = Math.min(4, tiles.length), rows = Math.ceil(tiles.length / cols);
  await sharp({ create: { width: 480 * cols, height: 270 * rows, channels: 3, background: '#000' } })
    .composite(tiles.map((b, i) => ({ input: b, left: (i % cols) * 480, top: Math.floor(i / cols) * 270 }))).png().toFile(join(out, `${name}.png`));
  tiles = [];
};

await page.goto(`${url}?debug`);
await page.waitForFunction(() => window.game?.game?.ready, null, { timeout: 180000 });

// A fresh run with Tension at `where`, from `view`, nobody about.
const fresh = (view, where = 'courtyard') => api((g, v, w) => {
  g.loop(false); g.technique('tension'); g.game.startRun({ skipTutorial: true }); g.loop(false); g.god(true); g.step(5);
  g.game.encounters.reset(); g.teleport(w); g.camera(v); g.look(0, -0.2); g.step(30);
}, view, where);
// Faces a point and, top-down, puts the cursor on it.
const face = (p) => api((g, x, y, z) => {
  const G = g.game, V = G.player.position.constructor;
  const at = new V(x, y, z), d = at.clone().sub(G.player.eye());
  G.cam.yaw = Math.atan2(-d.x, -d.z); G.cam.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
  // Top-down the camera leans toward the cursor, so the cursor is set until it settles on the point.
  for (let i = 0; i < 5; i++) { if (G.cam.isTop) { const s = at.clone().project(G.renderer.camera); G.input.mouse.x = s.x; G.input.mouse.y = s.y; } g.step(i < 4 ? 3 : 1); }
}, ...p);
const ready = () => api((g) => { const t = g.game.techniques; t.resource = t.def.resource.max; for (const k of Object.keys(t.cooldown)) t.cooldown[k] = 0; t.cast_ = null; });
// A line thrown at `p`: the cast, run past its beat.
const thread = async (p) => { await ready(); await face(p); await api((g) => g.cast('primary')); await step(36); };
const lines = () => api((g) => g.tension().lines);
// A Pact on the primary key that leaves the lines unlimited by Single Thread.
const web = () => api((g) => { g.game.book.preview.value = { id: 'check.web', technique: 'tension', name: 'Web', slot: 'primary', grant: { shape: 'thread' }, clauses: [{ kind: 'restrict', restriction: { param: 'range', value: 'long' } }] }; });
const unpreview = () => api((g) => { g.game.book.preview.value = null; });
// A body that stands where it is put and swings at nobody.
const body = (key, p) => api((g, key, x, z) => { const G = g.game, V = G.player.position.constructor; const e = G.encounters.spawn(key, new V(x, 0, z)); e.attackCd = 1e6; e.castCd = 1e6; e.field = null; (window.__bodies ??= []).push(e); g.step(2); return window.__bodies.length - 1; }, key, p[0], p[2]);
const at = (i) => api((g, i) => window.__bodies[i].position.toArray(), i);
const P = () => api((g) => g.game.player.position.toArray());

// ---------------------------------------------------------------- chaining
console.log('\nlines chain: each throw passes the line in hand on');
await fresh('top');
await web();
let me = await P();
await thread([me[0] - 4, 0, me[2] - 5]);
let L = await lines();
check(L.length === 1 && L[0].a === 'hand' && L[0].b === 'fixed', `the first throw: one line, from the hand to a pin (${L.map((l) => `${l.a}-${l.b}`).join(', ')})`);
check(L[0] && Math.abs(L[0].at[1][1] - 0.45) < 0.1, `a pin in open ground stands knee high (${L[0]?.at[1][1].toFixed(2)} m)`);
await frame();
await thread([me[0] + 4, 0, me[2] - 5]);
L = await lines();
check(L.length === 2 && L.some((l) => l.a === 'fixed' && l.b === 'fixed') && L.some((l) => l.a === 'hand'), `the second: a line between the two pins and a new one in hand (${L.map((l) => `${l.a}-${l.b}`).join(', ')})`);
await frame();
await thread([me[0] + 1, 0, me[2] - 9]);
await thread([me[0] - 3, 0, me[2] - 9]);
L = await lines();
check(L.length === 3, `three lines stand at most (${L.length})`);
await frame();
await unpreview();
await api((g) => { g.game.techniques.reset(); g.game.book.bind('primary', null); });
await thread([me[0] - 3, 0, me[2] - 4]);
await thread([me[0] + 3, 0, me[2] - 4]);
L = await lines();
check(L.length === 1 && L[0].a === 'fixed' && L[0].b === 'fixed', `the raw Technique holds one line, strung between two throws (${L.map((l) => `${l.a}-${l.b}`).join(', ')})`);
await api((g) => { g.game.book.bind('primary', 'tension.single-thread'); });
await strip('chain-top');

// ---------------------------------------------------------------- trips
console.log('\na body that runs into a set line trips over it');
// On the open training ground, where nothing stands between the two.
await fresh('top', [46, 0, -1.5]);
await web();
me = await P();
await thread([me[0] - 4, 0, me[2] + 4]);
await thread([me[0] + 4, 0, me[2] + 4]);
let i = await body('thug', [me[0] + 0.5, 0, me[2] + 8]);
await api((g, i) => { const e = window.__bodies[i]; e.attackCd = 0; window.__trips = 0; }, i);
await api((g) => { window.__events = []; });
let tripped = false;
for (let f = 0; f < 18 && !tripped; f++) {
  await step(10);
  tripped = await api((g, i) => { const e = window.__bodies[i]; return e.state === 'knocked' || e.frozen > 0; }, i);
  if (f % 3 === 0 || tripped) await frame();
}
check(tripped, 'the thug ran into the line and went down');
L = await lines();
check(L.some((l) => l.load > 0), `the line took the load (${L.map((l) => l.load.toFixed(2)).join(', ')})`);
await step(20); await frame();
await strip('trip-top');

// ---------------------------------------------------------------- holds can't be chained
console.log('\nholding a body goes through Enemy.freeze');
const spam = (key, how) => api((g, key, how) => {
  const G = g.game, V = G.player.position.constructor;
  G.techniques.reset(); G.encounters.reset(); g.teleport([0, 0, 7]); g.camera('third'); g.step(5);
  const e = G.encounters.spawn(key, new V(0, 0, 1));
  e.field = null; e.attackCd = 1e6; e.castCd = 1e6;
  G.book.preview.value = how === 'snare' ? G.techniques.def.catalogue.find((p) => p.id === 'tension.single-thread') : { id: 'check.web', technique: 'tension', name: 'Web', slot: 'primary', grant: { shape: 'thread' }, clauses: [{ kind: 'restrict', restriction: { param: 'range', value: 'long' } }] };
  // One line across the body's path, which it is walked back and forth
  // over, strung again whenever it snaps.
  const fence = (f) => {
    if (g.tension().lines.some((l) => l.a === 'fixed' && l.b === 'fixed')) return;
    if (f % 40 !== 0 && f % 40 !== 20) return;
    const at = new V(f % 40 === 0 ? -4 : 4, 0, 1), d = at.clone().sub(G.player.eye());
    G.cam.yaw = Math.atan2(-d.x, -d.z); G.cam.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    G.techniques.resource = 100; G.techniques.cast('primary', true);
  };
  let held = 0, run = 0, longest = 0, free = 0, longestFree = 0, holds = 0, was = 0;
  const lengths = [];
  for (let f = 0; f < 60 * 20; f++) {
    if (how === 'snare') {
      e.position.set(0, e.position.y, 1);
      const d = e.center().sub(G.player.eye()); G.cam.yaw = Math.atan2(-d.x, -d.z); G.cam.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
      G.techniques.resource = 100; G.techniques.cast('primary');
    } else if (how === 'slack') {
      const d = e.center().sub(G.player.eye()); G.cam.yaw = Math.atan2(-d.x, -d.z); G.cam.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
      e.state = 'windup'; G.techniques.resource = 100; G.techniques.cast('art1');
    } else {
      fence(f);
      // Over the line and back, twice a second.
      e.position.set(0, e.position.y, f % 30 < 15 ? 0.6 : 1.4);
    }
    g.step(1);
    if (e.frozen > was + 0.01) { holds++; lengths.push(+e.frozen.toFixed(2)); }
    was = e.frozen;
    if (e.frozen > 0) { held += 1 / 60; run += 1 / 60; longest = Math.max(longest, run); free = 0; } else { run = 0; free += 1 / 60; longestFree = Math.max(longestFree, free); }
  }
  G.book.preview.value = null;
  return { held, longest, longestFree, holds, lengths };
}, key, how);
for (const [key, how] of [['thug', 'snare'], ['thug', 'trip'], ['thug', 'slack'], ['kuroda', 'snare']]) {
  const r = await spam(key, how);
  console.log(`    ${how} spammed at a ${key} for 20 s: holds ${r.lengths.join(', ')} s`);
  check(r.holds >= (key === 'kuroda' ? 1 : 2), `${key}, ${how}: it holds at all (${r.holds})`);
  if (r.lengths.length > 1) check(r.lengths[1] < r.lengths[0], `${key}, ${how}: the next hold in a row is shorter`);
  check(r.longest < 3, `${key}, ${how}: never held past one hold (${r.longest.toFixed(1)} s at most)`);
  check(r.longestFree > 5, `${key}, ${how}: once the chain runs out it goes free under the spam (${r.longestFree.toFixed(1)} s)`);
  check(r.held < 20 * 0.35, `${key}, ${how}: held ${r.held.toFixed(1)} of 20 s`);
}

// ---------------------------------------------------------------- leash
console.log('\na snared body tied off to a pin is held to the line');
await fresh('third');
await web();
me = await P();
i = await body('thug', [me[0], 0, me[2] - 5]);
await thread(await api((g, i) => window.__bodies[i].center().toArray(), i));
L = await lines();
check(L.length === 1 && L[0].b === 'body', `the line snares the body (${L.map((l) => `${l.a}-${l.b}`).join(', ')})`);
await thread([me[0] - 5, 0, me[2] - 2]);
L = await lines();
const tie = L.find((l) => (l.a === 'body' || l.b === 'body') && l.a !== 'hand');
check(!!tie, `the next throw ties the body to a pin (${L.map((l) => `${l.a}-${l.b}`).join(', ')})`);
// The body wants the player, who walks off east: it strains at the line.
await api((g, i) => { const e = window.__bodies[i]; e.attackCd = 0; g.teleport([g.game.player.position.x + 9, 0, g.game.player.position.z + 2]); }, i);
let worst = 0;
for (let f = 0; f < 8; f++) {
  await step(10);
  const r = await api((g, i) => { const e = window.__bodies[i]; const l = g.tension().lines.find((l) => l.a === 'body' || l.b === 'body'); if (!l) return null; const pin = l.a === 'body' ? l.at[1] : l.at[0]; return { over: Math.hypot(e.position.x - pin[0], e.position.z - pin[2]) - l.rest, load: l.load }; }, i);
  if (!r) break;
  worst = Math.max(worst, r.over);
  if (f === 7) check(r.load > 0, `the body strains against it and loads it (${r.load.toFixed(2)})`);
}
check(worst < 0.6, `it is held to the line's length (at most ${worst.toFixed(2)} m past it)`);
await unpreview();

// ---------------------------------------------------------------- draw and release
console.log('\na draw yanks what the lines hold and flings what they carry');
await fresh('third');
await web();
me = await P();
i = await body('thug', [me[0] + 1, 0, me[2] - 7]);
const crate = await api((g, x, z) => { const G = g.game, V = G.player.position.constructor; window.__crate = G.props.spawn('crate', new V(x, 0, z)); g.step(20); return window.__crate.mesh.position.toArray(); }, me[0] - 4, me[2] - 4);
await thread(await api((g, i) => window.__bodies[i].center().toArray(), i));
await thread([me[0] + 5, 0, me[2] - 8]);
await thread(crate);
await frame();
const before = await api((g, i) => ({ hp: window.__bodies[i].hp, pos: window.__bodies[i].position.toArray() }), i);
await step(30); await ready();
await api((g) => g.hold('secondary', true));
for (let f = 0; f < 5; f++) { await step(10); if (f % 2 === 1) await frame(); }
const charge = await api((g) => g.tension().charge);
check(charge >= 0.99, `holding the draw brings the lines taut (${charge.toFixed(2)})`);
await api((g) => g.hold('secondary', false));
await step(2); await frame();
const flung = await api((g) => { const v = window.__crate.body.linvel(); return Math.hypot(v.x, v.y, v.z); });
await step(6); await frame();
await step(30); await frame();
const after = await api((g, i) => ({ hp: window.__bodies[i].hp, pos: window.__bodies[i].position.toArray() }), i);
check(after.hp < before.hp, `the tied body is hurt (${before.hp} to ${after.hp})`);
check(Math.hypot(after.pos[0] - before.pos[0], after.pos[2] - before.pos[2]) > 1, 'and yanked off where it stood');
check(flung > 8, `the crate is flung (${flung.toFixed(1)} m/s)`);
await strip('draw-release-third');

// ---------------------------------------------------------------- overdraw
console.log('\nheld past taut, a line gives into the caster\'s hand');
await fresh('third');
await web();
me = await P();
await thread([me[0] - 3, 0, me[2] - 5]);
await step(10);
await api((g) => { g.god(false); window.__hp = g.game.combat.hp; });
await ready(); await api((g) => g.hold('secondary', true));
await step(150);
await api((g) => g.hold('secondary', false));
const back = await api((g) => ({ lost: window.__hp - g.game.combat.hp, lines: g.tension().lines.length }));
await api((g) => g.god(true));
check(back.lost > 0, `the caster takes the backlash (${back.lost.toFixed(1)} health)`);
check(back.lines === 0, 'and the line is gone');
await unpreview();

// ---------------------------------------------------------------- haul
console.log('\na line to the hall roof hauls the caster onto it');
for (const view of ['third', 'top']) {
  await fresh(view, [0, 0, -1]);
  const roof = await api((g) => { const G = g.game, V = G.player.position.constructor; const h = G.physics.castRay(new V(0, 12, -6.5), new V(0, -1, 0), 20, 1); return h.point.toArray(); });
  await thread(roof);
  L = await lines();
  check(L.length === 1 && L[0].at[1][1] > 4.9, `${view}: the line catches on the roof deck (${L[0]?.at[1].map((n) => n.toFixed(1)).join(', ')})`);
  await frame();
  await ready(); await api((g) => g.cast('secondary'));
  for (let f = 0; f < 6; f++) { await step(7); await frame(); }
  await step(60);
  const end = await P();
  check(end[1] > 4.5, `${view}: the caster ends on the roof (${end.map((n) => n.toFixed(1)).join(', ')})`);
  await frame();
  await strip(`haul-${view}`);
}

// ---------------------------------------------------------------- slack
console.log('\nSlack spoils a wind-up');
await fresh('third');
me = await P();
i = await body('thug', [me[0], 0, me[2] - 2.2]);
await api((g, i) => { window.__bodies[i].attackCd = 0; }, i);
let wound = false;
for (let f = 0; f < 120 && !wound; f++) { await step(2); wound = await api((g, i) => window.__bodies[i].state === 'windup', i); }
check(wound, 'the thug winds up');
await face(await api((g, i) => window.__bodies[i].center().toArray(), i));
await frame();
await ready(); await api((g) => g.game.techniques.cast('art1'));
for (let f = 0; f < 3; f++) { await step(7); await frame(); }
const spoiled = await api((g, i) => ({ state: window.__bodies[i].state, guard: window.__bodies[i].guardBroken }), i);
check(spoiled.state !== 'strike' && spoiled.guard > 0, `its blow is spoiled and its guard left open (${spoiled.state}, ${spoiled.guard.toFixed(2)} s)`);
await strip('slack-third');

// ---------------------------------------------------------------- counters
console.log('\na blow swung through a line cuts it, and a boss snaps it');
await fresh('third');
await web();
me = await P();
i = await body('thug', [me[0], 0, me[2] - 3]);
await thread([me[0] - 3, 0, me[2] - 0.8]);
await thread([me[0] + 3, 0, me[2] - 0.8]);
await api((g, i) => { const e = window.__bodies[i]; e.attackCd = 0; }, i);
let cut = false;
for (let f = 0; f < 200 && !cut; f++) { await step(2); cut = await api((g) => !g.tension().lines.some((l) => l.a === 'fixed' && l.b === 'fixed')); }
check(cut, 'the thug swinging at the player cuts the line it stands over');
await fresh('third');
await web();
me = await P();
i = await body('kuroda', [me[0], 0, me[2] - 6]);
await thread(await api((g, i) => window.__bodies[i].center().toArray(), i));
await thread([me[0] - 6, 0, me[2] - 2]);
await api((g, i) => { window.__bodies[i].attackCd = 1e6; window.__bodies[i].castCd = 1e6; g.teleport([g.game.player.position.x + 10, 0, g.game.player.position.z]); }, i);
let snapped = -1;
for (let f = 0; f < 600; f += 10) { await step(10); if (!(await lines()).some((l) => l.a === 'body' || l.b === 'body')) { snapped = f / 60; break; } }
check(snapped >= 0 && snapped < 5, `the Kuroda pulls free of a tied line within seconds (${snapped.toFixed(1)} s)`);
await unpreview();

// ---------------------------------------------------------------- Drawn World
console.log('\nDrawn World ties everything in reach and costs the caster a share');
for (const view of ['top', 'third']) {
  await fresh(view);
  me = await P();
  const ids = [];
  for (const [dx, dz] of [[1, -6], [-3, -5], [3, -4]]) ids.push(await body('thug', [me[0] + dx, 0, me[2] + dz]));
  await api((g, x, z) => { const G = g.game, V = G.player.position.constructor; G.props.spawn('crate', new V(x, 0, z)); }, me[0] - 4, me[2] - 2);
  await api((g) => { g.god(false); window.__hp = g.game.combat.hp; window.__hps = window.__bodies.map((e) => e.hp); g.game.techniques.charge = 1; g.game.techniques.beginMax(); });
  let t = 0;
  for (const f of [30, 60, 75, 95, 110, 150]) { await step(f - t); t = f; await frame(); }
  await step(120);
  const r = await api((g) => ({ log: g.cutscenes().log.at(-1), lost: window.__hp - g.game.combat.hp, hurt: window.__bodies.filter((e, i) => e.hp < window.__hps[i]).length, lines: g.tension().lines.length, max: g.game.combat.maxHp }));
  await api((g) => g.god(true));
  check(r.log?.id === 'max-tension' && r.log.events.some((e) => e.kind === 'resolveHit'), `${view}: the cutscene plays to its blow`);
  check(r.hurt === 3, `${view}: every body in reach is drawn in and hurt (${r.hurt} of 3)`);
  check(r.lost > 0 && r.lost <= r.max * 0.25 + 0.01, `${view}: the caster pays a share (${r.lost.toFixed(1)} health)`);
  check(r.lines === 0, `${view}: no line is left standing`);
  await strip(`drawn-world-${view}`);
}

// ---------------------------------------------------------------- nothing left behind
console.log('\na Technique change leaves no line behind');
await fresh('top');
await web();
me = await P();
await thread([me[0] - 3, 0, me[2] - 4]);
await thread([me[0] + 3, 0, me[2] - 4]);
const leftover = await api((g) => { g.technique('recoil'); g.step(5); let n = 0; g.game.renderer.scene.traverse((o) => { if (o.userData.tensionLine && o.visible) n++; }); return { n, lines: g.tension().lines.length }; });
check(leftover.lines === 0 && leftover.n === 0, `no lines and no line meshes remain (${leftover.lines}, ${leftover.n})`);
await unpreview();

// ---------------------------------------------------------------- the drill
console.log('\nSnare Lanes, every tier');
await fresh('top');
await api((g) => { g.game.drills.progress = {}; g.game.book.preview.value = { id: 'check.web', technique: 'tension', name: 'Web', slot: 'primary', grant: { shape: 'thread' }, clauses: [{ kind: 'restrict', restriction: { param: 'range', value: 'long' } }] }; });
const stats0 = await api((g) => ({ ...g.game.mastery.stats.value.tension }));
// The first two tiers are played with lines strung across each lane ahead
// of its runner; from Snap on, only a line let go counts, so each runner is
// snared as it comes and the draw let go; in Web the second snare ties the
// two runners to each other and one release takes both.
for (let tier = 0; tier < 4; tier++) {
  await api((g) => { const s = g.lanes().station; g.teleport([s[0], s[1], s[2]]); g.camera('top'); g.drill('tension-lanes'); g.step(2); });
  const name = await api(() => document.querySelector('.drill-hud .s')?.textContent ?? null);
  let done = false;
  const handled = new Set();
  for (let f = 0; f < 60 * 60 && !done; f += 4) {
    const v = await api((g) => g.lanes());
    if (tier < 2) {
      for (const r of v.runners) {
        const key = r.lane.flat().join();
        if (handled.has(key)) continue;
        const [a, b] = r.lane, m = [a[0] + (b[0] - a[0]) * 0.45, 0, a[2] + (b[2] - a[2]) * 0.45];
        const d = [b[0] - a[0], b[2] - a[2]], n = Math.hypot(...d), side = [-d[1] / n * 2.2, d[0] / n * 2.2];
        await thread([m[0] + side[0], 0, m[2] + side[1]]);
        await thread([m[0] - side[0], 0, m[2] - side[1]]);
        handled.add(key);
      }
    } else {
      const want = tier === 3 ? 2 : 1;
      const live = v.runners.filter((r) => r.at && !r.caught);
      if (live.length >= want) {
        for (const r of live) { const key = r.lane.flat().join(); if (handled.has(key)) continue; const [a, b] = r.lane, n = Math.hypot(b[0] - a[0], b[2] - a[2]); const now = (await api((g, key) => g.lanes().runners.find((x) => x.lane.flat().join() === key)?.at, key)) ?? r.at; /* where it will be when the line lands */ await thread([now[0] + (b[0] - a[0]) / n * 1.4, now[1] + 1, now[2] + (b[2] - a[2]) / n * 1.4]); handled.add(key); }
        if (live.every((r) => handled.has(r.lane.flat().join()))) { await ready(); await api((g) => { g.game.techniques.cast('secondary'); g.step(14); }); }
      }
    }
    await step(4);
    done = !(await api((g) => !!g.game.drills.running));
    if (!v.runners.length) handled.clear();
  }
  const reached = await api((g) => g.game.drills.reached('tension-lanes'));
  // The last tier has no next one: its stats below say whether it was cleared.
  if (tier < 3) check(reached === tier + 1, `tier ${tier + 1} (${name ?? '?'}) cleared: the next one opens (${reached})`);
  if (tier === 0) await frame();
  await step(30);
}
const stats1 = await api((g) => ({ ...g.game.mastery.stats.value.tension }));
check(['output', 'precision', 'control', 'range', 'speed', 'efficiency', 'activation', 'tolerance'].every((s) => stats1[s] >= 0.999), `the Web tier takes the eight stats to the top (${Object.entries(stats1).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', ')})`);
check(stats0.output < 0.5, 'they started below it');
await unpreview();

writeFileSync(join(out, 'report.json'), JSON.stringify({ url, failures, errors }, null, 2));
check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
console.log(failures.length ? `\n${failures.length} FAILED` : '\nall passed');
await browser.close();
stop();
process.exit(failures.length ? 1 : 0);
