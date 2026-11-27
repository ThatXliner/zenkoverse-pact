#!/usr/bin/env node
// Out-of-combat regen, the passive ceiling and the Striking Posts drill:
//   regen: health climbs back only after the quiet spell, at the configured
//   rate; a blow taken stops it; an enemy close by holds it off; it stays off
//   in an encounter and in the rooftop trial's waves; the health bar shows it
//   mending, and the low-health chroma eases as it climbs;
//   the passive ceiling: real casts on the dummies fill Output, Precision and
//   Activation up to the ceiling and no further, and every other stat's
//   passive gain stops there too;
//   the drill: for every Technique, the four tiers are played with real keys
//   and clicks (Alt signs, a click strikes the lit post), each tier raises its
//   stats to its level, and the last leaves every stat the Technique uses at
//   the top; a plain blow on the lit post does not count;
//   the felt gain: a Rime blow on a dummy grows by exactly the potency the
//   drill added.
// Usage: node tools/check-training.mjs [url] [--port 4173] [--techs recoil,rime] [--out captures/training]
// Without a URL it serves dist/ itself (run `npm run build` first).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveTarget } from './lib/target.mjs';

const { url, args, stop } = await resolveTarget();
const out = args.out ?? 'captures/training';
mkdirSync(out, { recursive: true });
const TECHS = (args.techs ?? 'recoil,shift,rime,blink,echo,heat,tension,electro').split(',');
// Every stat a Technique reads (control has no reader yet, so no drill raises it).
const USED = ['output', 'precision', 'efficiency', 'range', 'speed', 'activation', 'tolerance'];

const failures = [];
const errors = [];
const check = (ok, what) => { if (!ok) failures.push(what); console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); return ok; };

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|GPU stall|Automatic fallback/.test(m.text())) errors.push(`console: ${m.text()}`); });
await page.goto(`${url}?debug`);
await page.waitForFunction(() => window.game?.game?.ready, null, { timeout: 180000 });

const api = (fn, arg) => page.evaluate(([src, a]) => new Function('g', 'a', `return (${src})(g, a);`)(window.game, a), [fn.toString(), arg]);
const step = (n) => page.evaluate((k) => window.game.step(k), n);
const hp = () => api((g) => g.game.combat.hp);
const shot = (name) => page.screenshot({ path: join(out, `${name}.png`), animations: 'disabled' });
const stats = (t) => api((g, t) => ({ ...g.game.mastery.stats.value[t ?? g.game.techniqueId] }), t);
const setStats = (t, v) => api((g, [t, v]) => { const m = g.game.mastery; m.stats.value = { ...m.stats.value, [t]: { ...m.stats.value[t], ...v } }; }, [t, v]);
const all = (v) => Object.fromEntries([...USED, 'control'].map((s) => [s, v]));
const { regen, passiveCeiling: CEIL } = await api((g) => g.training());

await api((g) => {
  g.loop(false);
  localStorage.removeItem('zenko.mastery.v1');
  localStorage.removeItem('zenko.drills.v1');
  g.game.mastery.reset();
  g.game.drills.progress = {};
  g.technique('recoil');
  g.game.startRun({ skipTutorial: true });
  g.loop(false);
  g.step(10);
});

// ------------------------------------------------------------------ regen
console.log('regen');
const expected = (t) => { const q = t - regen.quietSeconds; if (q <= 0) return 0; const r = regen.rampSeconds; return q <= r ? regen.perSecond * q * q / (2 * r) : regen.perSecond * (r / 2 + (q - r)); };
await api((g) => { g.teleport([-3, 0, 6]); g.camera('top'); g.step(5); g.game.combat.hurtPlayer(80, { self: true }); });
const h0 = await hp();
const chroma0 = await api((g) => g.game.combat.chromaAmount());
await step(Math.round((regen.quietSeconds - 0.3) * 60));
check(Math.abs((await hp()) - h0) < 1e-6, `no regen inside the quiet spell: ${h0.toFixed(1)} after ${(regen.quietSeconds - 0.3).toFixed(1)} s`);
check(!(await page.locator('.vitals .meter.health.mend').count()), 'the health bar is not mending yet');
await step(Math.round(3.3 * 60));
const h1 = await hp();
const want = expected(regen.quietSeconds + 3);
check(Math.abs(h1 - h0 - want) < 0.6, `regen climbs at the configured rate: +${(h1 - h0).toFixed(1)} in ${regen.quietSeconds + 3} s quiet, expected +${want.toFixed(1)}`);
check((await page.locator('.vitals .meter.health.mend').count()) === 1, 'the health bar shows it mending');
await step(60 * 4);
const chroma1 = await api((g) => g.game.combat.chromaAmount());
check(chroma1 < chroma0, `the low-health chroma eases as health returns: ${chroma0.toFixed(4)} to ${chroma1.toFixed(4)}`);
await shot('regen-mending');
await api((g) => g.game.combat.hurtPlayer(5, { self: true }));
const h2 = await hp();
await step(60 * 3);
check(Math.abs((await hp()) - h2) < 1e-6, 'a blow taken stops regen and restarts the quiet spell');
check(!(await page.locator('.vitals .meter.health.mend').count()), 'the bar stops mending after a blow');

// An enemy close by holds regen off; walking away lets it start.
await api((g) => { g.game.combat.god = true; const p = g.game.player.position.clone(); p.x += 6; g.game.encounters.spawn('thug', p).hold(Infinity); });
const h3 = await hp();
await step(60 * 9);
check(Math.abs((await hp()) - h3) < 1e-6, `no regen with an enemy ${6} m away (clear radius ${regen.clearRadius} m)`);
await api((g) => { const e = g.game.encounters.enemies.at(-1); e.die(); e.dispose(); g.game.combat.god = false; });

// An encounter keeps its stakes.
await api((g) => { g.game.combat.god = true; g.encounter('dummy-room'); g.step(2); });
const h4 = await hp();
await step(60 * 9);
check(Math.abs((await hp()) - h4) < 1e-6 && (await api((g) => g.game.encounters.fighting)), 'no regen in an encounter');
await api((g) => { g.teleport([-3, 0, 6]); g.step(30); g.game.combat.god = false; });
check(!(await api((g) => g.game.encounters.fighting)), 'leaving the dummies ends the encounter');

// The rooftop's waves have their own heal.
await api((g) => { g.game.combat.god = true; g.rooftop.begin(); g.step(30); g.game.combat.hp = 40; });
const roof = await api((g) => g.rooftop.status());
await step(60 * 9);
check(roof.stage === 'fight' && Math.abs((await hp()) - 40) < 1e-6, `no regen in the rooftop waves (stage ${roof.stage}, health ${(await hp()).toFixed(1)})`);
await api((g) => { g.game.startRun({ skipTutorial: true }); g.loop(false); g.step(10); g.game.combat.god = false; });
check((await api((g) => g.rooftop.status())).stage !== 'fight', 'a new run leaves the roof');

// ------------------------------------------------------------------ passive ceiling
console.log('passive ceiling');
await setStats('recoil', all(CEIL - 0.003));
await api((g) => { g.technique('recoil'); g.encounter('dummy-room'); g.teleport([6.4, 0.3, -12]); g.camera('first'); g.look(Math.PI / 2, 0); g.step(10); });
for (let i = 0; i < 30; i++) await api((g) => { g.game.techniques.resource = g.game.techniques.def.resource.max; g.cast('primary'); g.step(40); });
const afterPlay = await stats('recoil');
for (const s of ['output', 'precision', 'activation']) check(Math.abs(afterPlay[s] - CEIL) < 1e-9, `thirty landed casts fill ${s} to the ceiling and stop: ${afterPlay[s].toFixed(4)}`);
await api((g) => { for (const t of ['recoil', 'shift', 'rime', 'blink', 'echo', 'heat', 'tension', 'electro']) for (const s of ['output', 'precision', 'efficiency', 'range', 'speed', 'control', 'activation', 'tolerance']) for (let i = 0; i < 2000; i++) g.game.mastery.gainPassive(t, s, 0.05); });
const capped = await api((g) => g.game.mastery.stats.value);
const over = Object.entries(capped).flatMap(([t, v]) => Object.entries(v).filter(([s, x]) => s !== 'refinement' && Math.abs(x - CEIL) > 1e-9).map(([s, x]) => `${t}.${s}=${x.toFixed(3)}`));
check(!over.length, `every stat's passive gain stops at ${CEIL} for every Technique${over.length ? `: ${over.join(', ')}` : ''}`);
await api((g) => { g.teleport([-3, 0, 6]); g.step(30); g.game.mastery.reset(); });

// ------------------------------------------------------------------ the felt gain, before
// A plain Rime blow on a dummy, at the passive ceiling: a veteran who never drilled.
const rimeHit = async () => api((g) => {
  const G = g.game;
  g.encounter('dummy-room'); g.teleport([8, 0.3, -9]); g.look(0, -0.15); g.step(20);
  const hits = [];
  const orig = G.combat.hitEnemy;
  G.combat.hitEnemy = function (e, amount, opts) { const f = orig.call(this, e, amount, opts); hits.push({ amount, final: f }); return f; };
  G.techniques.resource = G.techniques.def.resource.max;
  g.cast('primary'); g.step(90);
  G.combat.hitEnemy = orig;
  const potency = G.techniques.potency(G.techniques.pactFor('primary'));
  g.teleport([-3, 0, 6]); g.step(30);
  return { hit: hits[0]?.final ?? 0, amount: hits[0]?.amount ?? 0, potency };
});
await api((g) => g.technique('rime'));
await setStats('rime', all(CEIL));
const before = await rimeHit();
check(before.hit > 0, `a plain Rime blow lands on a dummy at the ceiling: ${before.hit}`);

// ------------------------------------------------------------------ the drill
console.log('striking posts');
await api((g) => g.loop(true));
const posts = () => api((g) => g.posts());
const fill = () => api((g) => { g.game.techniques.resource = g.game.techniques.def.resource.max; });
const click = async () => { await page.mouse.move(640, 360); await page.mouse.down(); await page.mouse.up(); };
const waitFor = (fn, arg, timeout = 8000) => page.waitForFunction(new Function('a', `return (${fn.toString()})(window.game, a);`), arg, { polling: 'raf', timeout }).then(() => true, () => false);
// Stands 1.6 m from the lit post on the line from the mark (inside the
// shortest reach, Kinetic Release's) and faces its chest. Walking there is
// the player's part; the check is about what the drill scores.
const faceLit = async () => api((g) => {
  const v = g.posts(); const s = v.spots[v.lit]; const m = v.station;
  const dx = m[0] - s[0], dz = m[2] - s[2], d = Math.hypot(dx, dz);
  const at = [s[0] + dx / d * 1.6, 0, s[2] + dz / d * 1.6];
  g.teleport(at);
  g.look(Math.atan2(-(s[0] - at[0]), -(s[2] - at[2])), -0.2);
});
const strikeLit = async ({ signed = true } = {}) => {
  if (!(await waitFor((g) => g.posts().lit >= 0))) return false;
  await faceLit();
  await fill();
  if (signed) {
    await page.keyboard.press('Alt');
    if (!(await waitFor((g) => g.sign().kind === 'primed', null, 3000))) return false;
  }
  const close = (await posts()).close;
  if (close > 0) await waitFor((g, c) => g.posts().t >= c + 0.05, close);
  await faceLit();
  await click();
  return true;
};
const runTier = async (expectTier) => {
  const tier = await api((g) => { g.drill('striking-posts'); return g.game.drills.reached('striking-posts'); });
  check(tier === expectTier, `the drill opens on tier ${expectTier + 1}`);
  let guard = 0;
  while ((await api((g) => g.game.drills.running)) && guard++ < 12) {
    await strikeLit();
    await waitFor((g) => g.posts().lit < 0 || !g.game.drills.running, null, 6000);
  }
  const r = await api((g) => g.game.drills.reached('striking-posts'));
  return r;
};
const LEVELS = [
  { name: 'Weight', level: 0.55, stats: ['output', 'activation'] },
  { name: 'Footwork', level: 0.7, stats: ['output', 'activation', 'range', 'precision'] },
  { name: 'Timing', level: 0.85, stats: ['output', 'activation', 'range', 'precision', 'speed'] },
  { name: 'One Breath', level: 1, stats: USED },
];

for (const tech of TECHS) {
  console.log(`  ${tech}`);
  await api((g, t) => { g.technique(t); g.camera('first'); g.teleport(g.posts().station); }, tech);
  await setStats(tech, all(0));
  // A plain blow on the lit post does not count.
  await api((g) => g.drill('striking-posts'));
  await strikeLit({ signed: false });
  await page.waitForTimeout(500);
  check(((await page.locator('.drill-hud .big').textContent()) ?? '').trim().startsWith('0'), `${tech}: a plain blow on the lit post scores nothing`);
  await api((g) => { g.quitDrill(); g.teleport(g.posts().station); });
  for (let i = 0; i < LEVELS.length; i++) {
    const L = LEVELS[i];
    let reached = i, tries = 0;
    for (let attempt = 0; attempt < 3 && reached === i; attempt++) {
      tries++;
      // The last tier never advances the index; it is cleared when its stats reach the top.
      reached = await runTier(i);
      const s = await stats(tech);
      if (L.stats.every((k) => Math.abs(s[k] - L.level) < 1e-9)) { reached = i + 1; break; }
    }
    const s = await stats(tech);
    check(L.stats.every((k) => Math.abs(s[k] - L.level) < 1e-9), `${tech}: ${L.name} cleared raises ${L.stats.join(', ')} to ${L.level} (${L.stats.map((k) => s[k].toFixed(2)).join(' ')}; ${tries} ${tries === 1 ? 'try' : 'tries'})`);
    if (i === 0 && tech === TECHS[0]) await shot(`posts-${tech}`);
  }
  const s = await stats(tech);
  check(USED.every((k) => s[k] === 1), `${tech}: every stat it uses is at the top after the drill`);
  // Clearing a tier again adds nothing.
  check((await api((g, t) => g.game.mastery.raiseTo(t, 'output', 0.55), tech)) === 0, `${tech}: clearing a tier again adds nothing`);
}

// ------------------------------------------------------------------ the felt gain, after
await api((g) => { g.loop(false); g.technique('rime'); g.camera('first'); });
const after = await rimeHit();
const ratio = after.potency / before.potency;
const want2 = before.amount * ratio;
check(Math.abs(after.amount - want2) < 1e-6 && after.hit === Math.round(want2), `after the drill the same Rime blow on a dummy hits ${after.hit}, from ${before.hit}: expected ${Math.round(want2)} (${before.amount.toFixed(2)} x ${ratio.toFixed(3)}; potency ${before.potency.toFixed(3)} to ${after.potency.toFixed(3)})`);

for (const e of [...errors, ...(await api((g) => g.errors))]) check(false, e);
await browser.close();
stop();
console.log(failures.length ? `\n${failures.length} failure(s)` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);
