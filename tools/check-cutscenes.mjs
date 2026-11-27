#!/usr/bin/env node
// Maximum Output cutscenes (issue #27). Plays every cutscene in the game, the
// five Techniques' and the bosses', frame by frame on a fixed step, and checks:
//   each runs two to four seconds, and its real length matches its data;
//   the blow lands on the resolveHit beat, to the frame: the target's health
//   does not move before it and drops on it;
//   the target is pulled in front of the caster, into the shot;
//   the world holds still, and the player cannot be hurt or act during it;
//   the camera cuts away and eases back to the view the player had: top-down,
//   over the shoulder or first person;
//   Space skips to the player's own view without landing the blow any sooner;
//   "First time" shortens a repeat and "Never" plays the blow from the
//   player's own view, still on the beat.
// Online, in a room of three: A's Output pulls B in and plays on both their
// screens; C's camera is never taken and C keeps walking; nobody else's hits
// reach A or B during it; the blow reaches B; the lock lifts within four
// seconds; and a second Output straight after is refused.
// It saves frames of every cutscene at its beats for review.
// Usage: node tools/check-cutscenes.mjs [url] [--out captures/cutscenes] [--port 4187] [--only sp|online]
// Without a URL it serves dist/ through server/index.mjs (run `npm run build` first).
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveTarget } from './lib/target.mjs';

const argv = process.argv.slice(2);
if (!argv.includes('--port')) argv.push('--port', '4187');
const { url, args, stop } = await resolveTarget(argv, { realtime: true });
const out = args.out ?? 'captures/cutscenes';
mkdirSync(out, { recursive: true });
const only = args.only ?? null;

const failures = [];
const errors = [];
const check = (ok, what) => { if (!ok) failures.push(what); console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); return ok; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const FRAME = 1 / 60;
const shots = [];

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });

async function open(name, viewport = { width: 1280, height: 720 }, query = '') {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|WebGL|GPU stall|Automatic fallback|WebSocket/.test(m.text())) errors.push(`${name} console: ${m.text()}`); });
  await page.goto(`${url}?debug${query}`);
  await page.waitForFunction(() => window.game?.game?.ready, null, { timeout: 180000 });
  const api = (fn, ...a) => page.evaluate(([f, ...rest]) => new Function('g', 'a', `return (${f})(g, ...a)`)(window.game, rest), [fn.toString(), ...a]);
  const shot = async (label) => { const file = join(out, `${label}.png`); await page.screenshot({ path: file }); shots.push(file); };
  return { name, ctx, page, api, shot };
}

// ---------------------------------------------------------------- single player
if (!only || only === 'sp') {
  const P = await open('solo');
  const { page, api, shot } = P;
  await page.getByRole('button', { name: 'Begin', exact: true }).click();
  await page.locator('.card', { hasText: 'Recoil' }).click();
  await page.getByRole('button', { name: 'Skip tutorial' }).click();
  await page.waitForFunction(() => window.game.state() === 'explore', null, { timeout: 8000 });
  await page.waitForTimeout(500);
  await api((g) => g.loop(false));
  const step = (n = 1) => api((g, k) => g.step(k, 1 / 60), n);
  const view = () => api((g) => g.cutscenes());
  const defs = (await view()).defs;

  console.log('every cutscene is two to four seconds and has a beat');
  for (const [id, d] of Object.entries(defs)) check(d.total >= 2 && d.total <= 4 && d.beat !== null && d.beat < d.total && d.pull !== null, `${id}: ${d.total.toFixed(2)} s, blow at ${d.beat?.toFixed(2)} s, ${d.shots} shots, pulls to ${d.pull} m`);

  // A training dummy 8 m ahead in the yard: it never moves on its own, so
  // its health and place change only through the cutscene.
  const stage = (mode) => api((g, m) => {
    const game = g.game, V = game.player.position.constructor;
    game.cutscenes.cancel();
    game.endScene();
    g.god(false);
    game.combat.setHp(game.combat.maxHp);
    g.teleport([-8, 0, 12]);
    g.camera(m);
    g.look(0, 0);
    const e = game.encounters.spawn('dummy', new V(-8, 0, 4));
    e.yaw = 0;
  }, mode);

  // Runs the cutscene `start` begins, one fixed frame at a time, taking frames
  // at the named moments of its timeline. Returns what each frame saw.
  async function play(label, start, frames, opts = {}) {
    const before = await api((g) => ({ mode: g.game.cam.mode }));
    await api(start, opts.arg);
    const trace = [];
    const want = [...frames];
    let n = 0, hurtTried = false;
    for (; n < 600; n++) {
      const v = await api((g) => {
        const game = g.game, c = game.cutscenes;
        const tl = c.timeline;
        const dummy = game.encounters.enemies.find((e) => e.def.ai === 'dummy') ?? game.encounters.enemies.find((e) => e.isBoss);
        return { t: tl?.t ?? null, active: c.active, presenting: c.presenting, inShot: game.cam.inShot, mode: game.cam.mode, slowMo: game.clock.slowMo, input: game.input.enabled,
          targetHp: dummy ? dummy.hp : null, playerHp: game.combat.hp, title: !!document.querySelector('.cut-title'), letterbox: !!document.querySelector('.hud.letterbox') };
      });
      trace.push(v);
      if (!v.active) break;
      if (!hurtTried && v.t > 0.3 && opts.hurt !== false) { hurtTried = true; trace.hurt = await api((g) => g.game.combat.hurtPlayer(10, {})); }
      if (opts.skipAt !== undefined && v.t >= opts.skipAt && !trace.skipped) { trace.skipped = true; await page.keyboard.press('Space'); }
      while (want.length && v.t >= want[0][1]) {
        const [name] = want.shift();
        // The card animates on the page's own clock: give it time to land.
        if (name === 'title') await page.waitForTimeout(300);
        await shot(`${label}-${name}`);
      }
      await step(1);
    }
    for (let i = 0; i < 40; i++) await step(1);
    const after = await api((g) => ({ mode: g.game.cam.mode, inShot: g.game.cam.inShot, input: g.game.input.enabled, slowMo: g.game.clock.slowMo, state: g.state() }));
    if (want.some(([n]) => n === 'back')) await shot(`${label}-back`);
    return { trace, log: (await view()).log.at(-1), before, after, frames: n };
  }

  const MODES = { recoil: 'top', shift: 'third', rime: 'first', blink: 'top', echo: 'third', heat: 'first', tension: 'top' };
  for (const [tech, mode] of Object.entries(MODES)) {
    const id = `max-${tech}`;
    const d = defs[id];
    console.log(`\n${id} from the ${mode} view`);
    await stage(mode);
    await api((g, t) => g.technique(t), tech);
    await step(30);
    const casterAt = await api((g) => { const p = g.game.player.position; return [p.x, p.y, p.z]; });
    const beat = d.beat;
    const r = await play(id, (g, i) => g.cutscene(i), [['sign', 0.45], ['title', 0.7], ['wind', beat - 0.15], ['impact-frame', beat], ['impact', beat + 0.05], ['bloom', beat + 0.4], ['after', d.total - 0.3], ['back', 99]], { arg: id });
    const L = r.log;
    const resolve = L.events.find((e) => e.kind === 'resolveHit');
    check(L.id === id && L.role === 'caster' && L.presented && !L.short, `${id} played in full for the caster`);
    check(resolve && Math.abs(resolve.t - beat) <= FRAME + 1e-6, `the blow resolves on the beat: ${resolve?.t.toFixed(3)} s against ${beat.toFixed(3)} s`);
    check(L.end !== null && Math.abs(L.end - d.total) <= 2 * FRAME, `it ends on time: ${L.end?.toFixed(3)} s of ${d.total.toFixed(2)} s`);
    const real = r.frames * FRAME;
    check(real >= 2 && real <= 4.25, `${r.frames} frames, ${real.toFixed(2)} s of real time with the hit-stop`);
    const hpBefore = r.trace.filter((f) => f.t !== null && f.t < beat - 1e-6).map((f) => f.targetHp);
    const hpAfter = r.trace.filter((f) => f.t !== null && f.t >= beat + FRAME).map((f) => f.targetHp);
    check(hpBefore.length > 0 && hpBefore.every((h) => h === hpBefore[0]), `the target is untouched until the beat (${hpBefore.length} frames at ${hpBefore[0]})`);
    check(hpAfter.length > 0 && hpAfter[0] < hpBefore[0], `the target takes the blow on the beat: ${hpBefore[0]} to ${hpAfter[0]}`);
    const pulled = L.pulled;
    check(pulled && Math.abs(dist(pulled, casterAt) - d.pull) < 0.7, `the target is pulled ${pulled ? dist(pulled, casterAt).toFixed(2) : '?'} m in front of the caster (wants ${d.pull})`);
    // The HUD draws a frame after the cutscene starts; from then on it must hold.
    const during = r.trace.filter((f) => f.active && f.t > 0.05);
    const bad = during.find((f) => !(f.inShot && f.letterbox && !f.input));
    check(!bad, `the camera is in the cutscene, the letterbox is up and the controls are held throughout${bad ? ` (not at ${bad.t.toFixed(2)} s: ${JSON.stringify(bad)})` : ''}`);
    check(during.filter((f) => f.t < beat - 0.05).every((f) => f.slowMo <= 0.05), 'the world holds still until the blow');
    check(r.trace.hurt === 0, `the player cannot be hurt during it (a blow of 10 took ${r.trace.hurt})`);
    check(r.trace.some((f) => f.title), 'the title card shows');
    check(r.after.mode === mode && !r.after.inShot && r.after.input && r.after.slowMo === 1, `the camera eases back to ${mode} and play resumes (${r.after.mode}, state ${r.after.state})`);
  }

  console.log('\nboss ultimates');
  for (const [enc, id] of [['ancient', 'boss-ancient'], ['kuroda', 'boss-kuroda']]) {
    const d = defs[id];
    await stage('top');
    await api((g, e) => { g.encounter(e); }, enc);
    await step(20);
    const hp0 = await api((g) => g.game.combat.hp);
    const bossAt = await api((g) => { const b = g.game.encounters.enemies.find((e) => e.isBoss); g.game.combat.invuln = 0; return [b.position.x, b.position.y, b.position.z]; });
    const r = await play(id, (g) => { const b = g.game.encounters.enemies.find((e) => e.isBoss); g.game.encounters.bossUltimate(b); }, [['sign', 0.45], ['title', 0.7], ['wind', d.beat - 0.15], ['impact-frame', d.beat], ['impact', d.beat + 0.05], ['after', d.total - 0.3], ['back', 99]], { hurt: false });
    const L = r.log;
    const resolve = L.events.find((e) => e.kind === 'resolveHit');
    check(L.id === id && L.role === 'target', `${id} plays with the player as its target`);
    check(resolve && Math.abs(resolve.t - d.beat) <= FRAME + 1e-6, `its blow resolves on the beat: ${resolve?.t.toFixed(3)} s against ${d.beat.toFixed(3)} s`);
    const before = r.trace.filter((f) => f.t !== null && f.t < d.beat - 1e-6).map((f) => f.playerHp);
    const after = r.trace.filter((f) => f.t !== null && f.t >= d.beat + FRAME).map((f) => f.playerHp);
    check(before.every((h) => h === hp0) && after.length && after[0] < hp0, `the player is hurt on the beat and not before: ${hp0} to ${after[0]}`);
    check(L.pulled && Math.abs(dist(L.pulled, bossAt) - d.pull) < 0.7, `the player is pulled ${L.pulled ? dist(L.pulled, bossAt).toFixed(2) : '?'} m in front of the boss (wants ${d.pull})`);
    check(r.after.mode === 'top' && !r.after.inShot && r.after.input, 'the camera returns to the top-down view');
  }

  console.log('\nskip, "First time" and "Never"');
  const d = defs['max-recoil'];
  await stage('third');
  let r = await play('skip', (g) => g.cutscene('max-recoil'), [['skipped', 0.6]], { skipAt: 0.4 });
  let res = r.log.events.find((e) => e.kind === 'resolveHit');
  check(r.log.skipped && Math.abs(res.t - d.beat) <= FRAME + 1e-6, `Space hands the camera back but the blow still lands on the beat (${res?.t.toFixed(3)} s)`);
  check(r.trace.filter((f) => f.t > 0.45).every((f) => !f.inShot && !f.letterbox), 'after Space the player\'s own view shows, without the letterbox');
  check(Math.abs(r.log.end - d.beat) <= 2 * FRAME, `a skipped cutscene ends on the blow (${r.log.end.toFixed(3)} s)`);

  const setPlay = (v) => api((g, x) => g.setting('cutscenes', x), v);
  await setPlay('first');
  await stage('first');
  r = await play('repeat', (g) => g.cutscene('max-recoil'), [], {});
  res = r.log.events.find((e) => e.kind === 'resolveHit');
  check(r.log.short && Math.abs(r.log.end - (d.beat + 0.6)) <= 2 * FRAME && Math.abs(res.t - d.beat) <= FRAME + 1e-6, `"First time": a repeat is shortened to ${r.log.end.toFixed(2)} s, blow still on the beat`);
  check(r.after.mode === 'first', 'and returns to first person');
  await setPlay('never');
  await stage('top');
  r = await play('never', (g) => g.cutscene('max-recoil'), [['own-view', d.beat + 0.05]], {});
  res = r.log.events.find((e) => e.kind === 'resolveHit');
  check(!r.log.presented && r.trace.every((f) => !f.inShot && !f.letterbox), '"Never": the camera never leaves the player\'s view');
  check(Math.abs(res.t - d.beat) <= FRAME + 1e-6 && r.trace.filter((f) => f.t >= d.beat + FRAME)[0]?.targetHp < r.trace[0].targetHp, '"Never": the blow still lands on the beat');
  await setPlay('always');
  await P.ctx.close();
}

// ---------------------------------------------------------------- online
if (!only || only === 'online') {
  console.log('\nonline: A casts on B while C plays on');
  const room = `cut-${Date.now().toString(36)}`;
  async function join(name, tech) {
    const p = await open(name, { width: 960, height: 600 }, `&room=${room}`);
    await p.page.locator('.card').filter({ has: p.page.locator('h3', { hasText: new RegExp(`^${tech}$`, 'i') }) }).click();
    await p.page.locator('input[name=name]').fill(name);
    await p.page.locator('[data-join]').click();
    await p.page.waitForFunction(() => window.game.net()?.status === 'online', null, { timeout: 15000 });
    return p;
  }
  const A = await join('Akane', 'recoil'), B = await join('Bo', 'rime'), C = await join('Chie', 'echo');
  const id = async (p) => (await p.api((g) => g.net().id));
  const idA = await id(A), idB = await id(B), idC = await id(C);
  await A.api((g) => { g.camera('third'); g.teleport([-8, 0, 12]); g.look(0, 0); });
  await B.api((g) => { g.camera('top'); g.teleport([-8, 0, 3]); });
  // C stands out of the Output's reach, so B is the nearest body to pull in.
  await C.api((g) => { g.camera('top'); g.teleport([8, 0, 12]); });
  await wait(1500);
  const hpOf = (p, who) => p.api((g, w) => (w === g.net().id ? g.net().hp : g.net().remotes.find((r) => r.id === w)?.hp), who);
  const cut = (p) => p.api((g) => { const c = g.cutscenes(); const n = g.net(); return { active: c.active, role: c.role, inShot: c.cam.inShot, pos: n.pos, remotes: g.game.net ? [...g.game.net.remotes.values()].map((r) => ({ id: r.id, cine: r.cine })) : [] }; });
  const hpB0 = await hpOf(A, idB), hpA0 = await hpOf(C, idA);
  const cPos0 = (await cut(C)).pos;
  await C.page.keyboard.down('KeyD');
  const t0 = Date.now();
  await A.api((g) => g.cutscene('max-recoil'));
  await wait(450);
  const a1 = await cut(A), b1 = await cut(B), c1 = await cut(C);
  if (args.verbose) console.log(JSON.stringify({ a1, b1, c1, logB: await B.api((g) => g.cutscenes().log), feedB: await B.api(() => document.querySelector('.feed, .online-feed')?.textContent) }));
  check(a1.active && a1.role === 'caster' && a1.inShot, 'A plays the cutscene as the caster');
  check(b1.active && b1.role === 'target' && b1.inShot, 'B is pulled into it and plays it as the target');
  check(dist(b1.pos, a1.pos) < 4.2, `B stands in front of A: ${dist(b1.pos, a1.pos).toFixed(2)} m apart`);
  check(!c1.active && !c1.inShot, 'C\'s camera is not taken');
  await B.shot('online-target-b');
  await C.shot('online-watcher-c');
  // C swings at both of them while they are locked: the server drops it.
  await C.api((g, ids) => { const n = g.game.net; for (const i of ids) { const r = n.remotes.get(i); if (r) n.hit(r, 25, {}); } }, [idA, idB]);
  await wait(400);
  await B.shot('online-target-b-late');
  const c2 = await cut(C);
  check(c2.remotes.find((r) => r.id === idA)?.cine && c2.remotes.find((r) => r.id === idB)?.cine, 'C sees A and B held in the cutscene');
  check(dist(c2.pos, cPos0) > 1, `C keeps walking: ${dist(c2.pos, cPos0).toFixed(2)} m so far`);
  await A.page.waitForFunction(() => !window.game.cutscenes().active, null, { timeout: 6000 }).catch(() => undefined);
  await B.page.waitForFunction(() => !window.game.cutscenes().active, null, { timeout: 6000 }).catch(() => undefined);
  const held = (Date.now() - t0) / 1000;
  await C.page.keyboard.up('KeyD');
  await wait(600);
  const hpA1 = await hpOf(C, idA), hpB1 = await hpOf(A, idB);
  check(hpA1 === hpA0, `C's swing at A during the lock did nothing (A at ${hpA1})`);
  check(hpB1 < hpB0 && hpB0 - hpB1 !== 25, `A's blow reached B and C's did not (B ${hpB0} to ${hpB1})`);
  check(held <= 4.6, `the lock lifted after ${held.toFixed(2)} s`);
  const b2 = await cut(B);
  check(!b2.inShot, 'B\'s camera came back');
  // After the lock, C's blow on A lands.
  await C.api((g, i) => { const n = g.game.net; n.hit(n.remotes.get(i), 12, {}); }, idA);
  await wait(800);
  check((await hpOf(C, idA)) < hpA1, 'after the lock, A can be hit again');
  // A second Output straight away is refused by the server, and the charge comes back.
  await A.api((g) => { g.game.techniques.maxAt = -Infinity; g.cutscene('max-recoil'); });
  await wait(700);
  const a3 = await A.api((g) => ({ active: g.cutscenes().active, charge: g.game.techniques.charge, last: g.cutscenes().log.at(-1) }));
  check(!a3.active && a3.last.cancelled && a3.charge >= 1, 'a second Output inside the cooldown is refused and the charge returned');
  void idC;
  for (const p of [A, B, C]) await p.ctx.close();
}

await browser.close();
stop();
writeFileSync(join(out, 'report.json'), JSON.stringify({ failures, errors, shots }, null, 2));
if (errors.length) { console.log('\npage errors:'); for (const e of errors) console.log(`  ${e}`); }
console.log(`\n${failures.length ? `${failures.length} failed` : 'all passed'}; ${shots.length} frames in ${out}`);
process.exit(failures.length || errors.length ? 1 : 0);
