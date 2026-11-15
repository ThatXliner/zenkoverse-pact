#!/usr/bin/env node
// Searches the space of Wager settings for a way to buy a large reward with
// a small real risk. It runs the engine's own code (src/pacts/wager.ts,
// odds.ts, resolve.ts, schema.ts, bundled here with esbuild) against an
// independent model of what each forfeit really takes, and against
// simulated players whose true odds are known. No browser.
//
// 1. Odds are measured, at every setting. Simulated players (a brawler, a
//    marksman, one on the dummies, one in a crowd, one who casts as fast as
//    the keys allow) cast thousands of times through the real `OddsProbes`.
//    At every setting the odds the engine reads must match how often the
//    call was really true for those casts.
// 2. A player who fights differently once a call is open: their wagered casts
//    succeed far more often than the rest. The engine's odds for the call
//    must follow the wagered casts, not the others.
// 3. The forfeits' real loss. Every combination of forfeits and sizes (32,400),
//    against Pacts that spend all, half or none of the resource, keys with
//    and without a raw fallback, players who move or stand, use the aura or
//    never do. The model plays the seconds after a lost call (sealed, dark,
//    drained resource refilling) and integrates what the player could not
//    do. The engine's loss must never be much more than that.
// 4. The stake. A random search, then a hill climb from the worst cases,
//    over call odds, forfeits, sizes, contexts and reward splits: on average
//    a right call must never pay much more than a wrong call costs, a sure
//    call or a forfeit that costs nothing must stake almost nothing, and no
//    split of the rewards pays more than the stake.
// 5. Old saves: every Wager shape ever saved loads, validates, and keeps its
//    call, its reward and its forfeit at the size it had.
// Usage: node tools/check-wagers.mjs [--seed 1] [--verbose]
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseArgs } from './lib/target.mjs';

const { args } = parseArgs(process.argv.slice(2));
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundled = await build({
  stdin: {
    contents: [
      "export * from './src/pacts/wager.ts';",
      "export * from './src/pacts/odds.ts';",
      "export { freshTelemetry, upgradeTelemetry, estimateResolve } from './src/pacts/resolve.ts';",
      "export { upgradePact, validatePact } from './src/pacts/schema.ts';",
    ].join('\n'),
    resolveDir: root, loader: 'ts', sourcefile: 'wagers-entry.ts',
  },
  bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent',
});
const E = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };
const verbose = args.verbose === 'true';

// A small seeded generator, so a failure can be replayed.
let seed = Number(args.seed ?? 1) >>> 0 || 1;
const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const expo = (mean) => -Math.log(1 - rnd()) * mean;

// ------------------------------------------------------------------ 1. odds
console.log('odds come from what this player\'s casts did, at each setting');
const PLAYERS = {
  brawler: { gap: [0.6, 2.2], hits: [0.3, 0.3, 0.2, 0.1, 0.06, 0.04], blows: 0.12, fall: { p: 0.3, mean: 1.2 } },
  marksman: { gap: [1.0, 2.6], hits: [0.45, 0.55], blows: 0.05, fall: { p: 0.12, mean: 0.4 } },
  dummies: { gap: [0.8, 1.6], hits: [0.1, 0.9], blows: 0, fall: { p: 0, mean: 1 } },
  crowd: { gap: [0.5, 1.5], hits: [0.15, 0.2, 0.25, 0.2, 0.12, 0.08], blows: 0.4, fall: { p: 0.5, mean: 2 } },
  // As fast as a key's cooldown allows, so the follow list fills.
  spammer: { gap: [0.3, 0.36], hits: [0.4, 0.4, 0.2], blows: 0.03, fall: { p: 0.2, mean: 1.5 } },
};
const ROWS = { reach: E.REACH, finish: E.FINISH, untouched: E.UNTOUCHED };
const DT = 1 / 30;

function simulate(profile, casts, wagered = null) {
  const tel = E.freshTelemetry();
  const probes = new E.OddsProbes(() => tel.odds);
  const sumHits = (h) => { let u = rnd(); for (let k = 0; k < h.length; k++) { if ((u -= h[k]) < 0) return k; } return h.length - 1; };
  // The whole stream first, so the truth is counted apart from the probes.
  const list = [];
  let t = 1;
  for (let i = 0; i < casts; i++) { t += profile.gap[0] + rnd() * (profile.gap[1] - profile.gap[0]); list.push({ t, hits: sumHits(profile.hits), fall: rnd() < profile.fall.p ? t + expo(profile.fall.mean) : Infinity }); }
  const end = t + 25;
  const blows = [];
  if (profile.blows > 0) for (let b = expo(1 / profile.blows); b < end; b += expo(1 / profile.blows)) blows.push(b);
  // A wagered cast, when the strategy is on: every twentieth, and the player
  // makes "untouched 8 s" true on it by walking away from every blow.
  if (wagered) for (let i = 0; i < list.length; i += 20) list[i].wagered = true;
  const shielded = (b) => wagered && list.some((c) => c.wagered && b > c.t && b <= c.t + 8);
  const real = blows.filter((b) => !shielded(b));
  let ci = 0, bi = 0;
  const readings = Object.fromEntries(Object.entries(ROWS).map(([row, steps]) => [row, steps.map(() => 0)]));
  let read = 0;
  const half = Math.floor(casts / 2);
  const settle = [];
  for (let now = 0; now < end; now += DT) {
    while (bi < real.length && real[bi] <= now) { probes.struck(real[bi]); bi++; }
    while (ci < list.length && list[ci].t <= now) {
      const c = list[ci];
      probes.impact(c.t, c.hits, c);
      if (c.wagered) settle.push(c);
      if (ci >= half) {
        for (const [row, steps] of Object.entries(ROWS)) steps.forEach((_, i) => { readings[row][i] += E.rateAt(tel.odds, row, i); });
        read++;
      }
      ci++;
    }
    probes.tick(now, (c) => now >= c.fall);
    // A wagered "untouched 8 s" call settles eight seconds on.
    while (settle.length && settle[0].t + 8 <= now) {
      const c = settle.shift();
      E.recordCall(tel.odds, 'untouched:8', !real.some((b) => b > c.t && b <= c.t + 8));
    }
  }
  const late = list.slice(half);
  const truth = {
    reach: E.REACH.map((n) => late.filter((c) => c.hits >= n).length / late.length),
    finish: E.FINISH.map((w) => late.filter((c) => c.fall - c.t <= w + DT).length / late.length),
    untouched: E.UNTOUCHED.map((T) => late.filter((c) => !real.some((b) => b > c.t && b <= c.t + T)).length / late.length),
  };
  const measured = Object.fromEntries(Object.entries(readings).map(([row, v]) => [row, v.map((x) => x / read)]));
  return { tel, truth, measured, list, real };
}

for (const [name, profile] of Object.entries(PLAYERS)) {
  const { truth, measured } = simulate(profile, 6000);
  let worst = { d: 0 };
  for (const row of Object.keys(ROWS)) truth[row].forEach((p, i) => {
    const d = Math.abs(measured[row][i] - p);
    if (d > worst.d) worst = { d, row, i, p, m: measured[row][i] };
  });
  check(worst.d < 0.035, `${name}: every setting reads within ${(worst.d * 100).toFixed(1)} points of how often it was true${worst.row ? ` (worst ${worst.row} ${ROWS[worst.row][worst.i]}: true ${(worst.p * 100).toFixed(1)}%, read ${(worst.m * 100).toFixed(1)}%)` : ''}`);
}

// ------------------------------------------------------- 2. a wagered strategy
console.log('a player who fights differently once a call is open');
{
  const { tel, list, real } = simulate(PLAYERS.crowd, 4000, true);
  const wagered = list.filter((c) => c.wagered).slice(-40);
  const trueW = wagered.filter((c) => !real.some((b) => b > c.t && b <= c.t + 8)).length / wagered.length;
  const every = E.rateAt(tel.odds, 'untouched', E.UNTOUCHED.indexOf(8));
  const odds = E.oddsOf({ declare: 'untouched', at: 8 }, tel);
  check(Math.abs(odds - trueW) < 0.05, `the call's odds follow the wagered casts: every cast ${(every * 100).toFixed(0)}%, wagered casts ${(trueW * 100).toFixed(0)}%, odds read ${(odds * 100).toFixed(0)}%`);
}

// ---------------------------------------------------- 3. what forfeits take
console.log('what each forfeit really takes, against a model of the seconds after a lost call');
// The model's units are seconds of the whole Technique: a second sealed is
// one. The engine's unit of weight was set so that five seconds sealed is
// 2.4; the model uses that one rate to convert. Every other number below
// describes the game: how fast a resource refills, how much of a fight
// needs it, what share of a fight one key carries, what slowed legs cost.
const MODEL = {
  perUnit: 5 / 2.4,
  // Losing all of one's health is worth this many sealed seconds. Before
  // out-of-combat regen it was 20.83 (a fifth = 2 units): the loss weighed
  // on the rest of the fight and on the fights after it. Health now returns
  // once a fight ends, so it weighs on the rest of one fight only, about
  // half a fight against the fight and a half it used to: a third.
  health: 20.83 / 3,
  // The resource refills a tenth a second; below `enough` of it a fighter
  // casts less, in proportion; `needs` of a fight runs on it.
  resource: { regen: 0.1, enough: 0.6, needs: 0.67, at: { none: 0.6, half: 0.3, all: 0.05 } },
  // A full Maximum Output ring, half full on average when it is lost.
  ring: 2.66, ringAt: 0.5,
  // One key's share of a fight, after the others take up what they can.
  key: 0.15,
  // Heavy legs move at 0.6; what that costs follows how much the player moves while casting.
  slow: (mwc) => 0.4 * Math.min(1.2, 0.35 + 0.87 * mwc),
  // The aura pool, for a player who casts with a field open `rel` of the time.
  aura: (rel) => 8.3 * rel,
  // A cast's strength, as techniques.ts computes it (output mastery 0).
  strength: (p) => 0.25 + 0.75 * Math.max(0.22, p),
};
const timeline = new Map();
// Sealed, dark and drained play out together: sealed you can do nothing, so
// a dark key or an empty resource costs nothing until the seal lifts, and the
// resource refills meanwhile.
function sealDarkDrain(seal, dark, drain, spend, keep) {
  const key = `${seal}|${dark}|${drain}|${spend}|${keep.toFixed(3)}`;
  if (timeline.has(key)) return timeline.get(key);
  const R = MODEL.resource, r0 = R.at[spend];
  let base = r0, mine = r0 * (1 - drain), lost = 0;
  for (let t = 0; t < 100; t += 0.05) {
    const gate = (r) => (1 - R.needs) + R.needs * Math.min(1, r / R.enough);
    const can = gate(base);
    const have = t < seal ? 0 : gate(mine) * (t < dark ? 1 - MODEL.key * (1 - keep) : 1);
    lost += (can - have) * 0.05;
    base = Math.min(1, base + R.regen * 0.05);
    mine = Math.min(1, mine + R.regen * 0.05);
  }
  timeline.set(key, lost);
  return lost;
}
function realLoss(risks, ctx) {
  const keep = ctx.raw ? MODEL.strength(0.22) / MODEL.strength(ctx.potency) : 0;
  let s = sealDarkDrain(risks.seal ?? 0, risks.dark ?? 0, risks.drain ?? 0, ctx.spend, keep);
  s += (risks.drain ?? 0) * MODEL.ring * MODEL.ringAt;
  s += (risks.blood ?? 0) * MODEL.health;
  s += (risks.slow ?? 0) * MODEL.slow(ctx.mwc);
  s += (risks.aura ?? 0) * MODEL.aura(ctx.rel);
  return s / MODEL.perUnit;
}
const CONTEXTS = [];
for (const spend of ['none', 'half', 'all']) for (const raw of [true, false]) for (const potency of [0.15, 0.6, 0.9]) for (const mwc of [0, 0.6, 1]) for (const rel of [0, 0.2, 0.8]) CONTEXTS.push({ spend, raw, potency, mwc, rel });
// A tally row read as `rate(setting, i)` at every setting, as if from 25 casts.
const row = (steps, rate) => { const r = steps.map(rate); return { yes: r.map((x) => x * 25), n: r.map(() => 25) }; };
function engineCtx(ctx, odds = 0.5, declare = 'untouched', at = 8) {
  const telemetry = E.freshTelemetry();
  telemetry.movingWhileCasting = ctx.mwc;
  telemetry.auraReliance = ctx.rel;
  const d = E.DECLARE[declare];
  telemetry.odds[d.row] = row(ROWS[d.row], (_, i) => (i === d.index(at) ? odds : d.row === 'finish' ? (i < d.index(at) ? 0 : 1) : (i < d.index(at) ? 1 : 0)));
  // Every setting before this one easier, every one after harder, so the monotone read leaves this one as set.
  return { telemetry, restrictions: ctx.spend === 'none' ? [] : [{ param: 'resource', value: ctx.spend }], potency: ctx.potency, raw: ctx.raw };
}
const ALL_RISKS = [{}];
for (const f of E.FORFEITS) {
  const grown = [];
  for (const r of ALL_RISKS) { grown.push(r); for (const n of E.FORFEIT[f].steps) grown.push({ ...r, [f]: n }); }
  ALL_RISKS.splice(0, ALL_RISKS.length, ...grown);
}
check(ALL_RISKS.length === 32400, `every combination of forfeits and sizes: ${ALL_RISKS.length}`);
{
  // The default context: each forfeit at its old size costs what it always did.
  const def = { spend: 'none', raw: true, potency: 0.6, mwc: 0.6, rel: 0.2 };
  for (const f of E.FORFEITS) {
    const risks = { [f]: E.FORFEIT[f].at };
    const eng = E.stakeOf({ declare: 'untouched', at: 8, pays: {}, risks }, engineCtx(def)).loss;
    if (verbose) console.log(`     ${f} ${E.FORFEIT[f].at}: engine ${eng.toFixed(2)}, model ${realLoss(risks, def).toFixed(2)}`);
  }
  let over = [], under = 0, n = 0, worstRatio = 0;
  const started = Date.now();
  for (const ctx of CONTEXTS) {
    const c = engineCtx(ctx);
    for (const risks of ALL_RISKS) {
      const eng = E.stakeOf({ declare: 'untouched', at: 8, pays: {}, risks }, c).loss;
      const real = realLoss(risks, ctx);
      n++;
      // The engine may charge less than the loss (the player is paid less than the risk), never much more.
      if (eng > 1.25 * real + 0.25) over.push({ ctx, risks, eng, real });
      if (eng < real) under++;
      if (real > 0.5) worstRatio = Math.max(worstRatio, eng / real);
    }
  }
  over.sort((a, b) => (b.eng - b.real) - (a.eng - a.real));
  for (const o of over.slice(0, 5)) console.log(`     engine ${o.eng.toFixed(2)} against a real ${o.real.toFixed(2)}: ${JSON.stringify(o.risks)} ${JSON.stringify(o.ctx)}`);
  check(over.length === 0, `no forfeit set weighs much more than it takes: ${n.toLocaleString()} cases in ${((Date.now() - started) / 1000).toFixed(1)} s, ${over.length} over, highest engine/real ${worstRatio.toFixed(2)}; ${((under / n) * 100).toFixed(0)}% weigh less than the model (the player is paid less than the risk)`);
}

// ------------------------------------------------------------- 4. the stake
console.log('searching odds, settings, forfeits and reward splits for a large reward at a small risk');
const CALLS = E.DECLARATIONS.flatMap((d) => (E.DECLARE[d].steps ?? [E.DECLARE[d].at]).map((at) => ({ declare: d, at: E.DECLARE[d].steps ? at : undefined })));
// What a right call's rewards are worth, in the same units: each reward's
// rate per unit of stake where it is not full, and the harder strike on
// every body the cast strikes.
function rewardValue(payouts, spreadTrue) {
  let v = 0;
  for (const p of payouts) {
    if (p.reward === 'output') v += ((p.amount - 1) / 0.8) * spreadTrue;
    if (p.reward === 'charge') v += p.amount / 0.22;
    if (p.reward === 'refill') v += p.amount / 0.3;
    if (p.reward === 'aura') v += p.amount / 0.25;
    if (p.reward === 'mend') v += p.amount / 0.1;
  }
  return v;
}
function randomPays(declare) {
  const pays = {};
  for (const r of E.REWARDS) if (E.rewardFits(declare, r) && rnd() < 0.5) pays[r] = 1 + Math.floor(rnd() * E.MAX_PARTS);
  if (!Object.keys(pays).length) pays[E.rewardFits(declare, 'output') && rnd() < 0.5 ? 'output' : 'charge'] = 1;
  return pays;
}
// One case: a call at its setting with true odds `p`, forfeits, a context
// and a split. Its score is how far the average reward exceeds what the
// average loss allows; above zero is an exploit.
function score(k) {
  const c = engineCtx(k.ctx, k.p, k.call.declare, k.call.at ?? E.DECLARE[k.call.declare].at);
  // A cast that lands strikes more bodies for some players: the harder strike rides on each.
  if (k.call.declare === 'hit') c.telemetry.odds.reach = row(E.REACH, (_, i) => k.p * k.q ** i);
  const s = E.stakeOf({ ...k.call, pays: k.pays, risks: k.risks }, c);
  const real = realLoss(k.risks, k.ctx);
  const value = rewardValue(s.payouts, E.spreadOf(c.telemetry));
  const risk = (1 - k.p) * real;
  return { s, real, value, risk, excess: k.p * value - (2.0 * risk + 0.3), splitOver: value - s.stake - 0.05, sure: (k.p >= 0.99 || k.p <= 0.01) && s.stake > 0.5, cheap: real < 0.3 && s.stake > 0.35 };
}
const randomCase = () => ({ q: pick([0, 0.5, 0.8]), call: pick(CALLS), p: pick([0.01, 0.03, 0.1, 0.25, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.97, 0.99]), risks: pick(ALL_RISKS), ctx: pick(CONTEXTS), pays: null });
function mutate(k) {
  const m = { ...k, risks: { ...k.risks }, pays: { ...k.pays } };
  const r = rnd();
  if (r < 0.2) m.p = Math.min(0.99, Math.max(0.01, m.p + (rnd() - 0.5) * 0.1));
  else if (r < 0.55) { const f = pick(E.FORFEITS), st = E.FORFEIT[f].steps; const i = st.indexOf(m.risks[f] ?? -1); const j = Math.max(-1, Math.min(st.length - 1, i + (rnd() < 0.5 ? -1 : 1))); if (j < 0) delete m.risks[f]; else m.risks[f] = st[j]; }
  else if (r < 0.62) m.ctx = pick(CONTEXTS);
  else if (r < 0.7) m.q = pick([0, 0.5, 0.8]);
  else if (r < 0.85) m.call = pick(CALLS);
  else m.pays = randomPays(m.call.declare);
  if (!E.rewardFits(m.call.declare, 'output')) delete m.pays.output;
  if (!Object.keys(m.pays).length) m.pays = randomPays(m.call.declare);
  return m;
}
{
  const started = Date.now();
  const bad = { excess: [], split: [], sure: [], cheap: [] };
  const pool = [];
  for (let i = 0; i < 150000; i++) {
    const k = randomCase();
    k.pays = randomPays(k.call.declare);
    const r = score(k);
    if (r.excess > 0) bad.excess.push({ k, r });
    if (r.splitOver > 0) bad.split.push({ k, r });
    if (r.sure) bad.sure.push({ k, r });
    if (r.cheap) bad.cheap.push({ k, r });
    pool.push({ k, e: r.excess });
    if (pool.length > 400) { pool.sort((a, b) => b.e - a.e); pool.length = 200; }
  }
  // Climb from the worst cases the random search found.
  let best = pool.sort((a, b) => b.e - a.e)[0];
  for (const start of pool.slice(0, 40)) {
    let cur = start;
    for (let step = 0; step < 400; step++) {
      const k = mutate(cur.k);
      const r = score(k);
      if (r.excess > 0) bad.excess.push({ k, r });
      if (r.sure) bad.sure.push({ k, r });
      if (r.cheap) bad.cheap.push({ k, r });
      if (r.excess > cur.e) cur = { k, e: r.excess };
    }
    if (cur.e > best.e) best = cur;
  }
  const show = (list) => list.slice(0, 3).forEach(({ k, r }) => console.log(`     ${k.call.declare}${k.call.at !== undefined ? ` ${k.call.at}` : ''} at ${(k.p * 100).toFixed(0)}%, ${JSON.stringify(k.risks)}, pays ${JSON.stringify(k.pays)}, ${JSON.stringify(k.ctx)}: stake ${r.s.stake}, reward worth ${r.value.toFixed(2)}, real loss ${r.real.toFixed(2)}`));
  show(bad.excess);
  check(bad.excess.length === 0, `no case pays on average more than twice what it risks on average (${(Date.now() - started) / 1000} s; the worst found is ${best.e.toFixed(2)} from the line, at ${best.k.call.declare} ${(best.k.p * 100).toFixed(0)}% with ${JSON.stringify(best.k.risks)})`);
  show(bad.sure);
  check(bad.sure.length === 0, 'a call true 99% or 1% of the time stakes at most 0.5, however much is put up');
  show(bad.cheap);
  check(bad.cheap.length === 0, 'forfeits that really cost less than 0.3 stake at most 0.35, however they are tuned');
  show(bad.split);
  check(bad.split.length === 0, 'no split of the rewards pays more than the stake');
}
{
  // A harder setting is never read as likelier, whatever the tallies.
  let wrong = 0;
  for (let i = 0; i < 20000; i++) {
    const t = { reach: row(E.REACH, () => rnd()), finish: row(E.FINISH, () => rnd()), untouched: row(E.UNTOUCHED, () => rnd()), called: {} };
    for (let j = 1; j < 5; j++) {
      if (E.rateAt(t, 'reach', j) > E.rateAt(t, 'reach', j - 1) || E.rateAt(t, 'untouched', j) > E.rateAt(t, 'untouched', j - 1) || E.rateAt(t, 'finish', j) < E.rateAt(t, 'finish', j - 1)) wrong++;
    }
  }
  check(wrong === 0, 'a harder setting never reads as likelier than an easier one');
}
{
  // The harder strike rides only on a call the impact settles.
  const errs = E.DECLARATIONS.filter((d) => d !== 'hit').map((d) => E.wagerError({ declare: d, at: E.DECLARE[d].at, pays: { output: 1 }, risks: { seal: 5 } }));
  check(errs.every((e) => /harder strike/.test(e ?? '')), 'a harder strike is refused on every call but "it lands"');
}
{
  // A second Pact betting the same kind of outcome, at another setting, stakes nothing.
  const base = { technique: 'recoil', slot: 'art1', grant: { shape: 'x' } };
  const a = { ...base, id: 'a', name: 'A', clauses: [{ kind: 'wager', declare: 'multi', at: 2, pays: { charge: 1 }, risks: { seal: 5 } }] };
  const b = { ...base, id: 'b', name: 'B', slot: 'art2', clauses: [{ kind: 'wager', declare: 'multi', at: 4, pays: { charge: 1 }, risks: { seal: 12, blood: 0.4 } }] };
  const est = E.estimateResolve(b, [a, b], E.freshTelemetry());
  check(est.wager.stake === 0 && /"A" already wagers/.test(est.wager.reason), `a second Pact on the same outcome at a harder setting stakes nothing: ${est.wager.reason}`);
}

// ------------------------------------------------------------- 5. old saves
console.log('old saves keep what their Wagers meant');
{
  // A saved forfeit keeps its size; its weight follows the game. Blood's is a
  // third of its old 2.0 now that health returns out of a fight (see MODEL.health).
  const OLD_WEIGHT = { seal: 2.4, blood: 2.0 / 3, drain: 1.6, slow: 1.0 };
  const OLD_AT = { multi: 2, kill: 0.9, untouched: 8 };
  let bad = [];
  for (const declare of ['hit', 'multi', 'kill', 'untouched']) for (const reward of ['output', 'charge', 'mend']) for (const forfeit of ['seal', 'blood', 'drain', 'slow']) {
    if (reward === 'output' && declare !== 'hit') continue;
    const old = { id: 'p', technique: 'recoil', name: 'Old', slot: 'art1', grant: { shape: 'thrust' }, clauses: [{ kind: 'wager', declare, reward, forfeit }] };
    const up = E.upgradePact(structuredClone(old));
    const w = up.clauses[0];
    const v = E.validatePact(up);
    const loss = E.stakeOf(w, { telemetry: E.freshTelemetry(), restrictions: [], potency: 0.6, raw: true }).loss;
    const same = w.declare === declare && (OLD_AT[declare] ?? undefined) === w.at && JSON.stringify(w.pays) === JSON.stringify({ [reward]: 1 }) && Object.keys(w.risks).join() === forfeit && Math.abs(loss - OLD_WEIGHT[forfeit]) < 0.05;
    if (!v.ok || !same) bad.push(`${declare}/${reward}/${forfeit}: ${v.errors.join('; ')} ${JSON.stringify(w)} loss ${loss}`);
  }
  bad.forEach((b) => console.log(`     ${b}`));
  check(bad.length === 0, 'every Wager saved before tuning loads, validates, and puts up what it did at the weight it had');
  const older = E.upgradePact({ id: 'q', technique: 'recoil', name: 'Older', slot: 'art1', grant: { shape: 'thrust' }, clauses: [{ kind: 'wager', predict: 'kill' }] });
  check(E.validatePact(older).ok && older.clauses[0].declare === 'kill' && older.clauses[0].risks.seal === 5 && older.clauses[0].pays.charge === 1, 'a Wager from before terms (a prediction alone) still loads as a sealed bet on the ring');
  const tel = E.upgradeTelemetry({ hitRate: 0.8, multiTargetFraction: 0.3, killRate: 0.4, untouchedRate: 0.25 });
  check(Math.abs(E.oddsOf({ declare: 'hit' }, tel) - 0.8) < 1e-9 && Math.abs(E.oddsOf({ declare: 'multi', at: 2 }, tel) - 0.3) < 1e-9 && Math.abs(E.oddsOf({ declare: 'kill', at: 0.9 }, tel) - 0.4) < 1e-9 && Math.abs(E.oddsOf({ declare: 'untouched', at: 8 }, tel) - 0.25) < 1e-9, 'an old record of odds carries over at the setting it was measured');
}

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
