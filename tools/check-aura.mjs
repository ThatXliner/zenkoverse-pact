#!/usr/bin/env node
// Aura Expansion and the Aura Clash (issue #4), played with real keys:
//   F expands and spends the whole pool; F again retracts and keeps the
//   unused share of the field as pool; F does nothing until the pool has refilled completely; an
//   open field runs out on its own;
//   a tap opens a compact, dense field and a hold pushes it wider and
//   thinner, reach x density fixed, with the player slowed and unable to
//   cast until it commits on release or at full width; refinement raises
//   both shapes;
//   inside the field enemies are slowed, the player's hits land harder,
//   blows on the player land softer (not while pushing), and an enemy's
//   blow shows its lit mark before its wind-up begins;
//   the listening stone's drill raises refinement, answered from the cue on
//   screen; potential falls with a broader Technique and with each Pact
//   inscribed, and holds refinement under it;
//   equal picks go to the denser field (the shared referee);
//   the Master: her density, her reinforcement while her field is open, and
//   that her open field keeps the player's pressure off her;
//   a clash against her that an untrained player loses on tied picks: the
//   player's field collapses keeping a little pool, the guard breaks, F
//   cannot expand again, and nobody loses health; while it plays, the clock
//   runs at full speed and an enemy outside the clash keeps moving;
//   a refined compact field takes the same tied picks from her: her field
//   collapses, she is held for the opening, and again nobody loses health;
//   an untrained player who answers her tells wins too.
// It saves the field from the top-down and over-the-shoulder views (compact,
// pushed out mid-hold, and wide) and the clash at its tell and its reveal.
// Usage: node tools/check-aura.mjs [url] [--out captures/aura] [--port 4173]
// Without a URL it serves dist/ itself (run `npm run build` first).
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { resolveTarget } from './lib/target.mjs';
import { roundWinner } from '../src/net/clash.js';
import RULES from '../src/net/rules.json' with { type: 'json' };

const { url, args, stop } = await resolveTarget();
const out = args.out ?? 'captures/aura';
mkdirSync(out, { recursive: true });

const failures = [];
const errors = [];
const check = (ok, what) => { if (!ok) failures.push(what); console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); return ok; };
const near = (a, b, eps = 0.02) => Math.abs(a - b) <= eps;

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|GPU stall|Automatic fallback/.test(m.text())) errors.push(`console: ${m.text()}`); });
await page.goto(`${url}?debug`);
await page.waitForFunction(() => window.game?.game?.ready, null, { timeout: 180000 });

const step = (n) => page.evaluate((k) => window.game.step(k), n);
const aura = () => page.evaluate(() => window.game.aura());
// A real key: down for one frame, up the next.
async function press(code) {
  await page.keyboard.down(code);
  await step(1);
  await page.keyboard.up(code);
  await step(1);
}
const shot = (name) => page.screenshot({ path: join(out, `${name}.png`), animations: 'disabled' });
// How much the drawn aura fields change the walls and the two bodies in the
// clash shot: the mean change per channel, of 255, between the frame as drawn
// and the same frame with every field hidden.
async function fieldWash() {
  const frame = async (show) => {
    await page.evaluate((show) => {
      const G = window.game.game;
      G.renderer.scene.traverse((o) => { if (o.userData.auraField) o.userData.shown = show ? o.userData.shown : o.visible; });
      G.renderer.scene.traverse((o) => { if (o.userData.auraField) o.visible = show ? o.userData.shown : false; });
      G.renderer.render(0);
    }, show);
    return sharp(await page.screenshot({ clip: { x: 0, y: 90, width: 1280, height: 300 } })).raw().toBuffer();
  };
  const off = await frame(false), on = await frame(true);
  let sum = 0;
  for (let i = 0; i < on.length; i++) sum += Math.abs(on[i] - off[i]);
  return sum / on.length;
}
async function stepUntil(test, max) {
  for (let i = 0; i < max; i += 5) {
    if (await page.evaluate(test)) return true;
    await step(5);
  }
  return page.evaluate(test);
}

await page.evaluate(() => {
  const g = window.game, G = g.game;
  g.loop(false);
  localStorage.removeItem('zenko.mastery.v1');
  G.mastery.reset();
  g.technique('recoil');
  G.startRun({ skipTutorial: true });
  g.camera('top');
  g.teleport([-3, 0, 6]);
  g.step(30);
});

console.log('\nF expands and spends everything; F retracts and keeps the unused share; no expansion before a full refill');
let a = await aura();
check(a.state === 'ready' && a.pool === 1, `the pool starts full and ready (${a.state}, ${a.pool})`);
await press('KeyF');
await step(40);
a = await aura();
check(a.state === 'open', `F opens the field (${a.state})`);
check(a.pool === 0, `expanding spends the whole pool at once (pool ${a.pool})`);
check(near(a.radius, 4, 0.1) && near(a.density, 0.4) && !a.pushing, `a tap opens an untrained compact field: ${a.radius.toFixed(2)} m, density ${a.density.toFixed(2)}`);
const left = a.left;
await press('KeyF');
await step(2);
a = await aura();
check(a.state === 'recovering' && a.ended === 'retracted', `F again retracts it (${a.state}, ${a.ended}) with ${left.toFixed(1)} s unused`);
check(near(a.pool, left / a.holds, 0.03), `retracting keeps the unused share as pool (${Math.round(a.pool * 100)}% of ${Math.round(left / a.holds * 100)}% unused)`);
await press('KeyF');
await step(4);
check((await aura()).state === 'recovering', 'F right after a retract does not expand');
check(await stepUntil(() => window.game.aura().state === 'ready', 60 * 2.5), 'an early retract refills in a second or two, not the full refill');
await press('KeyF');
await step(4);
check((await aura()).state === 'open', 'once full, F expands again');
check(await stepUntil(() => window.game.aura().state === 'recovering', 60 * 11), 'left alone, the field runs out');
check((await aura()).ended === 'spent', `and ends as spent, not retracted (${(await aura()).ended})`);
check((await aura()).pool < 0.01, `a spent field leaves the pool empty (${Math.round((await aura()).pool * 100)}%)`);
await step(60 * 7);
a = await aura();
check(a.state === 'recovering' && a.pool > 0.4 && a.pool < 0.6, `halfway through the refill (${Math.round(a.pool * 100)}%)`);
await press('KeyF');
await step(4);
check((await aura()).state === 'recovering', 'F at half a pool still does not expand');
check(await stepUntil(() => window.game.aura().state === 'ready', 60 * 9), 'the pool refills completely');

console.log('\ntap for a compact field, hold to push it wider and thinner');
// F held down for `frames`, with `during` run before it is let go.
async function holdF(frames, during) {
  await page.keyboard.down('KeyF');
  await step(frames);
  return during?.();
}
const releaseF = async () => { await page.keyboard.up('KeyF'); await step(1); };
const fresh = (r) => page.evaluate((r) => { const g = window.game; if (g.game.aura.field.open) g.game.aura.retract(); g.refinement(r); g.auraReady(); g.step(5); }, r);
const shapeWords = (x) => `${x.reach.toFixed(2)} m at density ${x.density.toFixed(2)}`;
await fresh(0);
const midHold = await holdF(Math.round(60 * (0.18 + 0.4)), async () => {
  const before = await page.evaluate(() => window.game.game.player.position.clone());
  await page.keyboard.down('KeyW');
  await step(20);
  await page.keyboard.up('KeyW');
  const pos = await page.evaluate(() => window.game.game.player.position.clone());
  const cast = await page.evaluate(() => { const g = window.game; g.hold('primary', true); g.step(1); g.hold('primary', false); g.step(1); return !!g.game.techniques.cast_; });
  return { ...(await aura()), moved: Math.hypot(pos.x - before.x, pos.z - before.z), cast, scale: await page.evaluate(() => window.game.game.player.fieldScale) };
});
check(midHold.pushing && midHold.reach > 4.5 && midHold.reach < 8, `held, the field is pushed out: ${shapeWords(midHold)}`);
check(near(midHold.reach * midHold.density, 1.6, 0.01), `wider is thinner: reach x density stays at the budget (${(midHold.reach * midHold.density).toFixed(3)} of 1.6)`);
check(near(midHold.scale, 0.35, 1e-6) && midHold.moved < 0.6, `while pushing, the player is slowed to ${Math.round(midHold.scale * 100)}% (moved ${midHold.moved.toFixed(2)} m in a third of a second)`);
check(!midHold.cast, 'while pushing, the player cannot cast');
check(near(midHold.reinforce, 1, 1e-6), `while pushing, the field does not reinforce (${midHold.reinforce.toFixed(2)})`);
await releaseF();
a = await aura();
check(!a.pushing && a.state === 'open' && near(a.reach, midHold.reach, 0.3), `releasing commits the shape: ${shapeWords(a)}`);
await step(30);
const committed = await aura();
check(near(committed.reach, a.reach, 1e-6) && near(committed.density, a.density, 1e-6), `and it keeps that shape (${shapeWords(committed)})`);
await fresh(0);
await holdF(Math.round(60 * (0.18 + 1.1)) + 6);
a = await aura();
check(!a.pushing && near(a.reach, 8, 0.01) && near(a.density, 0.2, 0.005), `held all the way, it commits at full width: ${shapeWords(a)}`);
await releaseF();
const shapes = {};
for (const r of [0, 1]) {
  await fresh(r);
  await press('KeyF');
  await step(30);
  const tap = await aura();
  await fresh(r);
  await holdF(Math.round(60 * 1.4));
  await releaseF();
  await step(30);
  shapes[r] = { tap, wide: await aura() };
}
// Refinement 1 is held to this Technique's potential.
const rt = shapes[1].tap.refinement, tapReach = 4 + 2 * rt, tapDensity = 0.4 + 0.6 * rt;
check(rt > 0.5 && near(shapes[1].tap.reach, tapReach, 0.01) && near(shapes[1].tap.density, tapDensity, 0.005) && near(shapes[1].wide.reach, 2 * tapReach, 0.01) && near(shapes[1].wide.density, tapDensity / 2, 0.005),
  `refinement raises the budget: at ${Math.round(rt * 100)}, a tap is ${shapeWords(shapes[1].tap)} and a full hold ${shapeWords(shapes[1].wide)} (untrained ${shapeWords(shapes[0].tap)} and ${shapeWords(shapes[0].wide)})`);
check(near(shapes[1].wide.radius, 2 * tapReach, 0.3) && near(shapes[1].tap.radius, tapReach, 0.2), `the drawn field matches (${shapes[1].tap.radius.toFixed(1)} m and ${shapes[1].wide.radius.toFixed(1)} m)`);

console.log('\nthe shapes on screen');
for (const view of ['top', 'shoulder']) {
  const cam = () => page.evaluate((v) => { const g = window.game; g.teleport([-1, 0, 8]); g.game.player.yaw = 0; if (v === 'top') g.camera('top'); else { g.camera('third'); g.look(0, -0.3); } g.step(40); }, view);
  await fresh(0.7);
  await cam();
  await press('KeyF');
  await step(50);
  await shot(`shape-compact-${view}`);
  await fresh(0.7);
  await cam();
  await holdF(Math.round(60 * (0.18 + 0.5)));
  await shot(`shape-hold-${view}`);
  await step(60);
  await releaseF();
  await step(50);
  await shot(`shape-wide-${view}`);
}
await page.evaluate(() => { const g = window.game; g.camera('top'); g.step(5); });

console.log('\nreinforcement');
await fresh(0);
const blow = () => page.evaluate(() => { const G = window.game.game; G.combat.invuln = 0; G.combat.setHp(100); return G.combat.hurtPlayer(20, {}); });
const bare = await blow();
await press('KeyF');
await step(30);
const tapped = await blow();
await fresh(1);
await press('KeyF');
await step(30);
const refined = await blow();
const refinedDensity = (await aura()).density;
await fresh(1);
const pushingBlow = await holdF(30, blow);
await releaseF();
await step(20);
const wideBlow = await blow();
check(near(bare, 20, 1e-6), `with no field a blow of 20 lands as ${bare}`);
check(near(tapped, 20 * (1 - 0.3 * 0.4), 1e-6) && near(refined, 20 * (1 - 0.3 * refinedDensity), 1e-6), `inside a compact field it lands softer: ${tapped.toFixed(1)} untrained, ${refined.toFixed(1)} refined (density ${refinedDensity.toFixed(2)})`);
check(near(pushingBlow, 20, 1e-6), `while the field is being pushed out it lands in full (${pushingBlow.toFixed(1)})`);
check(wideBlow > refined && wideBlow < 20, `a wider field reinforces less than a compact one (${wideBlow.toFixed(1)})`);
await page.evaluate(() => { const G = window.game.game; G.combat.setHp(100); if (G.aura.field.open) G.aura.retract(); window.game.auraReady(); });

console.log('\nsensing');
// A thug a step outside its reach, about to be ready to swing.
const omen = async (open) => {
  await fresh(0);
  await page.evaluate(() => { const g = window.game; g.teleport([1, 0, 6.4]); g.encounter('sparring'); g.god(true); g.step(5); });
  if (open) { await press('KeyF'); await step(30); }
  return page.evaluate(() => {
    const g = window.game, G = g.game;
    const [e, ...rest] = G.encounters.enemies;
    for (const o of rest) { o.frozen = 1e6; o.position.set(20, 0, 20); }
    const me = G.player.position;
    e.position.set(me.x, me.y, me.z - 2.9);
    e.state = 'chase';
    e.attackCd = 0.4;
    g.step(2);
    const early = { state: e.state, omen: !!e.omen, fill: e.omen?.mat.uniforms.fill.value ?? 0 };
    const seen = e.omen;
    let windup = null;
    for (let i = 0; i < 90 && !windup; i++) { g.step(1); if (e.state === 'windup') windup = { same: !!seen && e.mark === seen, fill: e.mark?.mat.uniforms.fill.value ?? 0 }; }
    G.encounters.reset();
    g.god(false);
    return { early, windup };
  });
};
const sensed = await omen(true), unsensed = await omen(false);
check(sensed.early.state === 'chase' && sensed.early.omen && near(sensed.early.fill, 0.35, 1e-6), `inside the field a blow's mark lies on the ground, lit, before its wind-up (${JSON.stringify(sensed.early)})`);
check(sensed.windup?.same && near(sensed.windup.fill, 0.35, 1e-6), `the wind-up takes over that mark and it stays lit (${JSON.stringify(sensed.windup)})`);
check(!unsensed.early.omen && unsensed.windup && !unsensed.windup.same && unsensed.windup.fill === 0, `without a field the mark appears only with the wind-up, unlit (${JSON.stringify(unsensed)})`);

console.log('\nequal picks go to the denser field');
const R = RULES.clash;
check(roundWinner('push', 'push', 0.4, 0.2, R) === 0 && roundWinner('hold', 'hold', 0.5, 1, R) === 1, 'compact beats wide on an equal pick, untrained and refined');
check(roundWinner('feint', 'feint', 0.4, 0.7, R) === 1 && roundWinner('feint', 'feint', 1, 0.7, R) === 0 && roundWinner('feint', 'feint', 0.5, 0.7, R) === 1, 'against the Master (0.7) an untrained compact field and a refined wide one lose equal picks; a refined compact one wins them');
check(roundWinner('push', 'push', 0.75, 0.7, R) === null && roundWinner('push', 'hold', 0.2, 1, R) === 0, 'within the margin nobody takes it, and a beaten pick loses whatever the density');

console.log('\nwhat a field does');
await page.evaluate(() => {
  const g = window.game, G = g.game;
  g.refinement(0.6);
  g.auraReady();
  g.encounter('sparring');
  g.god(true);
  g.step(5);
  for (const [i, e] of G.encounters.enemies.entries()) { e.frozen = 1e6; e.position.set(1 + (i - 1) * 3.2, 0, 3.6 + (i === 1 ? -1 : 0)); }
  g.teleport([1, 0, 6.4]);
  g.camera('top');
  g.step(20);
});
await press('KeyF');
await step(50);
const fx = await page.evaluate(() => {
  const G = window.game.game;
  const inside = G.encounters.enemies.filter((e) => G.aura.inField(e.position));
  const far = { position: new G.player.position.constructor(30, 0, 30), field: null };
  return { inside: inside.length, hinder: inside.map((e) => G.aura.hinder(e)), damage: inside.map((e) => G.aura.damageOn(e)), cast: G.aura.castSpeed, density: G.aura.density, far: G.aura.hinder(far) };
});
check(fx.inside === 3, `the sparring partners stand in the field (${fx.inside} of 3)`);
check(fx.hinder.every((h) => near(h, 1 - 0.15 - 0.3 * fx.density, 1e-6)) && fx.far === 1, `bodies inside move ${Math.round((1 - fx.hinder[0]) * 100)}% slower; outside, not at all`);
check(fx.damage.every((d) => near(d, 1 + 0.35 * fx.density, 1e-6)), `the player's hits on them land ${Math.round((fx.damage[0] - 1) * 100)}% harder (density ${fx.density.toFixed(2)})`);
check(near(fx.cast, 1 + 0.25 * fx.density, 1e-6), `the player's wind-ups are ${Math.round((fx.cast - 1) * 100)}% faster`);
await page.evaluate(() => { window.game.game.player.yaw = 0; });
await shot('field-top');
await page.evaluate(() => { const g = window.game; g.camera('third'); g.look(0, -0.22); g.step(40); });
await shot('field-shoulder');
await page.evaluate(() => { const g = window.game; g.camera('first'); g.look(0, -0.16); g.step(40); });
await shot('field-first');
await page.evaluate(() => { const g = window.game; g.game.encounters.reset(); g.camera('top'); g.god(false); g.step(5); });

console.log('\nrefinement and potential');
const pot = await page.evaluate(() => {
  const G = window.game.game;
  const ids = ['blink', 'recoil', 'rime', 'shift', 'echo'];
  return Object.fromEntries(ids.map((t) => [t, { potential: G.aura.potential(t), breadth: G.aura.breadth(t), pacts: G.aura.pacts(t) }]));
});
console.log(`    ${Object.entries(pot).map(([t, p]) => `${t} ${Math.round(p.potential * 100)} (breadth ${p.breadth}, ${p.pacts} Pacts)`).join(', ')}`);
const same = Object.entries(pot).filter(([, p]) => p.pacts === pot.rime.pacts).sort((x, y) => x[1].breadth - y[1].breadth);
check(same.length >= 3 && same.every(([, p], i) => i === 0 || p.potential < same[i - 1][1].potential), `with the same Pact count, a broader Technique has lower potential (${same.map(([t]) => t).join(' > ')})`);
const extra = await page.evaluate(() => {
  const G = window.game.game;
  const before = G.aura.potential();
  const src = G.book.inscribed.value.find((p) => p.technique === 'recoil' && p.slot === 'primary');
  const v = G.book.inscribe({ ...structuredClone(src), id: 'check.aura.extra', name: 'Second Strike', slot: 'art3' }, G.techniques.def.shapes);
  const after = G.aura.potential();
  return { ok: v.ok, errors: v.errors, before, after };
});
check(extra.ok && near(extra.before - extra.after, 0.05, 1e-6), `inscribing one more Pact lowers potential by 5 (${Math.round(extra.before * 100)} to ${Math.round(extra.after * 100)})${extra.ok ? '' : `: ${extra.errors}`}`);
await page.evaluate(() => window.game.refinement(1));
a = await aura();
check(near(a.refinement, a.potential, 1e-6) && a.trained === 1, `refinement is held to potential (${Math.round(a.trained * 100)} trained, ${Math.round(a.refinement * 100)} in effect)`);
check(await page.locator('.aura-meter .sub').textContent().then((t) => /Refinement \d+ of potential \d+/.test(t)), 'the HUD shows refinement and potential');

console.log('\nthe drill raises refinement');
await page.evaluate(() => { const g = window.game; g.refinement(0); g.teleport([6, 0, 3.2]); g.step(20); });
check(/Reading the Field/.test(await page.locator('.prompt').textContent().catch(() => '')), 'the listening stone offers its drill');
// The interact prompt clears both bottom corners, at the 1280 by 720 the
// extra Ability row reaches past the middle at, on a phone held sideways,
// and on a wide screen.
for (const [w, h] of [[1280, 720], [844, 390], [960, 540], [2560, 1080]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(450);
  await step(2);
  const hit = await page.evaluate(() => {
    const box = (s) => document.querySelector(s)?.getBoundingClientRect();
    const p = box('.prompt');
    if (!p) return 'no prompt';
    if (p.left < 0 || p.top < 0 || p.right > innerWidth || p.bottom > innerHeight) return 'off screen';
    const over = ['.abilities', '.vitals'].filter((s) => { const b = box(s); return b && p.left < b.right && b.left < p.right && p.top < b.bottom && b.top < p.bottom; });
    return over.length ? `overlaps ${over.join(' and ')}` : null;
  });
  check(hit === null, `at ${w}x${h} the interact prompt sits clear of the HUD corners${hit ? ` (${hit})` : ''}`);
  if (w === 1280 || w === 844) await shot(`prompt-${w}x${h}`);
}
await page.setViewportSize({ width: 1280, height: 720 });
await step(2);
await press('KeyE');
await step(5);
check(await page.evaluate(() => window.game.state() === 'drill'), 'E begins it');
check(/when ready/.test(await page.locator('.drill-hud .cue').textContent().catch(() => '')), 'it waits on its rules until E');
await step(60);
await press('KeyE');
await step(5);
const COUNTER = { 'It swells toward you': 'KeyA', 'It draws tight': 'KeyW', 'Its far side flickers': 'KeyS' };
let answered = 0, lastCue = '';
for (let i = 0; i < 1200 && await page.evaluate(() => window.game.state() === 'drill'); i++) {
  const cue = await page.locator('.drill-hud .cue').textContent().catch(() => '');
  const tell = Object.keys(COUNTER).find((k) => cue.startsWith(k));
  if (tell && cue !== lastCue) { await press(COUNTER[tell]); answered++; lastCue = cue; await step(4); continue; }
  if (!tell) lastCue = '';
  await step(3);
}
a = await aura();
check(answered >= 4, `answered ${answered} tells from the cue on screen`);
check(a.trained > 0.1 && a.trained <= a.potential + 1e-9, `refinement rose to ${Math.round(a.trained * 100)} (potential ${Math.round(a.potential * 100)})`);
await page.evaluate(() => { const G = window.game.game; G.book.inscribed.value = G.book.inscribed.value.filter((p) => p.id !== 'check.aura.extra'); });

console.log('\na clash against the Master, lost');
await page.evaluate(() => {
  const g = window.game, G = g.game;
  g.refinement(0);
  g.auraReady();
  g.encounter('ancient');
  g.camera('top');
  g.step(120);
  // Someone outside the clash, far down the hall, to show the world keeps going.
  const thug = G.encounters.spawn('thug', new G.player.position.constructor(11, 0.3, -6));
  thug.state = 'chase';
});
const master0 = (await aura()).master;
check(master0?.field === 'open' && master0.radius > 6 && near(master0.density, 0.7, 1e-6), `her field is open (${master0?.radius.toFixed(1)} m, density ${master0?.density})`);
check(near(master0.taken, 1 - 0.3 * 0.7, 1e-6), `her field reinforces her: blows land ${Math.round(master0.taken * 100)}%`);
const hp0 = (await aura()).hp;
await press('KeyF');
check(await stepUntil(() => window.game.aura().clash.stage !== null, 60), 'opening a field against hers starts a clash');
const run0 = await page.evaluate(() => { const G = window.game.game; const t = G.encounters.enemies.find((e) => e.def.ai === 'thug'); return { thug: t.position.clone(), time: G.clock.time }; });
const BEATS = { push: 'hold', hold: 'feint', feint: 'push' };
const KEY = { push: 'KeyW', hold: 'KeyS', feint: 'KeyA' };
const COUNTER_PICK = { push: 'feint', hold: 'push', feint: 'hold' };
let shotTell = false, shotReveal = false, speeds = [];
// Her body as the clash shot sees it: each hand in her own frame from the
// ground point she stands on, x to her right, y up, z toward the player.
const posed = {};
const masterPose = () => page.evaluate(() => {
  const G = window.game.game;
  const m = G.encounters.enemies.find((e) => e.def.ai === 'ancient');
  const V = G.player.position.constructor;
  const fwd = new V(-Math.sin(m.yaw), 0, -Math.cos(m.yaw)), right = new V(-fwd.z, 0, fwd.x);
  const at = (n) => { const p = m.avatar.boneWorld(n, new V()).sub(m.position); return { x: p.dot(right), y: p.y, z: p.dot(fwd) }; };
  return { stance: m.avatar.stance, l: at('hand_l'), r: at('hand_r') };
});
// What each pick must look like: a push drives both hands out at the
// opponent, a hold crosses them together before the chest, a feint throws
// the lead hand high and the rear one low and back.
const POSE_TEST = {
  push: (p) => Math.min(p.l.z, p.r.z) > 0.45,
  hold: (p) => Math.abs(p.l.x - p.r.x) < 0.2 && Math.max(p.l.z, p.r.z) < 0.35,
  feint: (p) => p.r.y - p.l.y > 0.25 && p.r.z - p.l.z > 0.2,
};
const poseWords = (p) => `hands at ${['l', 'r'].map((h) => `${h} ${p[h].x.toFixed(2)},${p[h].y.toFixed(2)},${p[h].z.toFixed(2)}`).join('; ')}`;
async function fight(answer) {
  for (let i = 0; i < 400; i++) {
    const s = await page.evaluate(() => { const G = window.game.game; return { stage: G.aura.clash.stage, pick: G.aura.clash.masterPick, mine: window.game.aura().clash.view?.mine ?? null, ratio: G.clock.dt / G.clock.raw }; });
    if (s.stage === null) return;
    speeds.push(s.ratio);
    if (s.stage === 'choose' && s.pick && !s.mine) {
      await step(15);
      const pose = await masterPose();
      if (!posed[s.pick]) { posed[s.pick] = pose; await shot(`clash-tell-${s.pick}`); }
      if (!shotTell) {
        const wash = await fieldWash();
        check(wash < 4, `in the hall the clash shot is not washed by the fields (mean change ${wash.toFixed(2)} of 255 above the floor)`);
        await shot('clash-tell');
        shotTell = true;
      }
      await press(KEY[answer(s.pick)]);
      continue;
    }
    if (s.stage === 'reveal' && !shotReveal) { await step(8); await shot('clash-reveal'); shotReveal = true; continue; }
    await step(2);
  }
}
// Untrained, answering her with her own pick: she is denser and takes the ties.
await fight((her) => her);
a = await aura();
const lost = a.clash.log.filter((l) => l.ev.kind === 'end').at(-1)?.ev;
const lostReveals = a.clash.log.filter((l) => l.ev.kind === 'reveal');
check(lostReveals.every((l) => l.ev.picks[0] === l.ev.picks[1] && l.ev.winner === 1), `she takes every tied pick from an untrained compact field (${lostReveals.map((l) => `${l.ev.picks[0]}: ${l.ev.winner}`).join(', ')})`);
const run1 = await page.evaluate(() => { const G = window.game.game; const t = G.encounters.enemies.find((e) => e.def.ai === 'thug'); return { thug: t.position.clone(), time: G.clock.time, alive: t.alive }; });
check(lost?.winner === 1, `the Master takes it (${JSON.stringify(lost)})`);
check(a.clash.log.filter((l) => l.ev.kind === 'reveal').length >= 2 && a.clash.log.filter((l) => l.ev.kind === 'reveal').length <= 3, `in ${a.clash.log.filter((l) => l.ev.kind === 'reveal').length} exchanges`);
check(a.state === 'recovering' && a.ended === 'collapsed', `the player's field collapsed (${a.state}, ${a.ended}), a different end from a retract`);
check(a.pool >= 0.2 - 1e-6 && a.pool < 0.4, `a collapsed field keeps half its density as pool (${Math.round(a.pool * 100)}%, from 20% and refilling)`);
check(a.guardBroken > 0, `the player's guard is broken for ${a.guardBroken.toFixed(1)} s`);
check(a.hp === hp0, `the player lost no health (${hp0} to ${a.hp})`);
check(a.master.hp === master0.hp, `the Master lost no health (${master0.hp} to ${a.master.hp})`);
check(Math.hypot(run1.thug.x - run0.thug.x, run1.thug.z - run0.thug.z) > 2, `a thug outside the clash kept moving (${Math.hypot(run1.thug.x - run0.thug.x, run1.thug.z - run0.thug.z).toFixed(1)} m)`);
check(speeds.every((r) => r > 0.99), `the clock ran at full speed through the clash (slowest ${Math.min(...speeds).toFixed(2)})`);
await press('KeyF');
await step(4);
check((await aura()).state === 'recovering', 'F cannot expand again until the pool refills');
await page.evaluate(() => { const G = window.game.game; for (const e of G.encounters.enemies) if (e.def.ai === 'thug') e.die(); });

console.log('\na clash against the Master, won by a refined compact field on tied picks');
await page.evaluate(() => { const g = window.game; g.refinement(1); g.auraReady(); g.game.combat.invuln = 0; g.step(30); });
const hp1 = (await aura()).hp, master1 = (await aura()).master;
const logLen = (await aura()).clash.log.length;
await press('KeyF');
check(await stepUntil(() => window.game.aura().clash.stage !== null, 60), 'a second clash starts');
await fight((her) => her);
a = await aura();
const won = a.clash.log.slice(logLen).filter((l) => l.ev.kind === 'end').at(-1)?.ev;
check(won?.winner === 0 && won.reason === 'rounds', `the refined player takes it two tied exchanges to none (${JSON.stringify(won)})`);
check(a.master.field === 'recovering' && a.master.ended === 'collapsed', `her field collapsed (${a.master.field}, ${a.master.ended})`);
check(near(a.master.pool, 0.35, 0.06), `her collapsed field keeps ${Math.round(a.master.pool * 100)}% of her pool: about ${((1 - a.master.pool) * a.master.recovers).toFixed(1)} s until it opens again`);
// The player closes in on her while she is held.
const opening = await page.evaluate(() => { const g = window.game, G = g.game; const m = G.encounters.enemies.find((e) => e.def.ai === 'ancient'); g.teleport([m.position.x, m.position.y, m.position.z + 3]); g.step(2); return { hinder: G.aura.hinder(m), inside: G.aura.inField(m.position), taken: G.aura.damageOn(m) }; });
check(opening.inside && opening.hinder < 1 && opening.taken > 1.25, `with her field down, the player's field presses her and its blows land ${Math.round(opening.taken * 100)}% (inside: ${opening.inside}, her speed ${Math.round(opening.hinder * 100)}%)`);
check(a.master.locked > 0 && a.master.guardBroken > 0, `the opening: she is held ${a.master.locked.toFixed(1)} s and her guard is broken ${a.master.guardBroken.toFixed(1)} s`);
check(a.state === 'open', `the player's field stays open (${a.state})`);
check(a.hp === hp1 && a.master.hp === master1.hp, `nobody lost health (player ${hp1} to ${a.hp}, Master ${master1.hp} to ${a.master.hp})`);
await page.evaluate(() => { window.game.step(20); });
await shot('clash-after');

console.log('\nan untrained player who reads her tells wins');
await page.evaluate(() => {
  const g = window.game, G = g.game, m = G.encounters.enemies.find((e) => e.def.ai === 'ancient');
  if (G.aura.field.open) G.aura.retract();
  g.refinement(0);
  g.auraReady();
  m.hold(0); m.guardBroken = 0; m.field.reset();
  G.combat.invuln = 0;
  g.step(30);
});
const pre = await page.evaluate(() => { const G = window.game.game, m = G.encounters.enemies.find((e) => e.def.ai === 'ancient'); return { hinder: G.aura.hinder(m), open: m.field.open }; });
check(pre.open && pre.hinder === 1, `while her field is open nothing presses her (her speed ${Math.round(pre.hinder * 100)}%)`);
const logLen2 = (await aura()).clash.log.length;
await press('KeyF');
check(await stepUntil(() => window.game.aura().clash.stage !== null, 60), 'a third clash starts');
await fight((her) => COUNTER_PICK[her]);
a = await aura();
const read = a.clash.log.slice(logLen2).filter((l) => l.ev.kind === 'end').at(-1)?.ev;
check(read?.winner === 0 && read.reason === 'rounds', `answering every tell wins it untrained (${JSON.stringify(read)})`);

console.log("\nthe Master's tells read from her body");
for (const [pick, p] of Object.entries(posed)) check(p.stance === pick && POSE_TEST[pick](p), `in the clash her ${pick} shows in her pose (${p.stance}, ${poseWords(p)})`);
// Every pick, whichever she happened to choose above, with her held still.
await page.evaluate(() => { const G = window.game.game; const m = G.encounters.enemies.find((e) => e.def.ai === 'ancient'); m.hold(1e6); m.velocity.set(0, 0, 0); window.game.step(90); });
const neutral = await masterPose();
for (const pick of ['push', 'hold', 'feint']) {
  await page.evaluate((k) => { const G = window.game.game; G.encounters.enemies.find((e) => e.def.ai === 'ancient').avatar.stance = k; window.game.step(30); }, pick);
  const p = await masterPose();
  check(POSE_TEST[pick](p) && !POSE_TEST[pick](neutral), `her ${pick} stance reads apart from her rest pose (${poseWords(p)}; at rest ${poseWords(neutral)})`);
}
await page.evaluate(() => { const G = window.game.game; G.encounters.enemies.find((e) => e.def.ai === 'ancient').avatar.stance = null; G.encounters.enemies.find((e) => e.def.ai === 'ancient').hold(0); window.game.step(30); });

const pageErrors = await page.evaluate(() => window.game.errors);
errors.push(...pageErrors.map((e) => `window: ${e}`));
check(!errors.length, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
writeFileSync(join(out, 'report.json'), JSON.stringify({ url, failures, errors }, null, 2));
await browser.close();
stop();
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
process.exit(failures.length ? 1 : 0);
