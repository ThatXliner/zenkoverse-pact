#!/usr/bin/env node
// What the game played, read from the mixer's cue log (`game.audio()`), since
// a headless browser cannot be listened to. It checks that nothing is made
// or fetched before the first click, that the click starts the mixer and the
// sound library loads, and then that each thing that should sound did: the
// bed indoors and out, a footstep per surface, every Technique's casts and
// its Maximum Output (charge, title, blow), hit weight by damage, the aura,
// the drill, the interface, other bodies' steps placed in the world, and the
// volume settings surviving a reload. Fails on any page error.
// Usage: node tools/check-audio.mjs [url] [--port 4190]
import { chromium } from 'playwright';
import { resolveTarget } from './lib/target.mjs';

const { url, stop } = await resolveTarget();
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|WebGL|GPU stall|Automatic fallback/.test(m.text())) errors.push(`console: ${m.text()}`); });
const audioRequests = [];
page.on('request', (r) => { if (/\/assets\/audio\//.test(r.url())) audioRequests.push(performance.now()); });
const failures = [];
const check = (ok, what) => { if (!ok) failures.push(what); console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const api = (fn, arg) => page.evaluate(([src, a]) => (0, eval)(src)(window.game, a), [fn.toString(), arg]);
const view = () => api((g) => g.audio());
const cues = async () => (await view()).log.map((e) => e.cue);
const clear = () => api((g) => g.audioClear());
const wait = (ms) => page.waitForTimeout(ms);
const played = (log, name) => log.some((e) => e.cue === name && e.ctx === 'running');

console.log('before the first click');
await page.goto(`${url}?debug`);
await page.waitForFunction(() => window.game?.game?.ready, null, { timeout: 180000 });
await wait(800);
{
  const v = await view();
  check(!v.unlocked && v.state === 'none', `no audio context before a gesture (state ${v.state})`);
  check(v.log.every((e) => e.ctx !== 'running'), `nothing sounded before a gesture (${v.log.length} cues asked for)`);
  check(audioRequests.length === 0, `no sound file fetched before a gesture (${audioRequests.length})`);
}

console.log('the first click');
await page.getByRole('button', { name: 'Begin', exact: true }).click();
await page.waitForFunction(() => { const a = window.game.audio(); return a.library.total > 0 && a.library.loaded + a.library.failed >= a.library.total; }, null, { timeout: 30000 }).catch(() => undefined);
{
  const v = await view();
  check(v.unlocked && v.state === 'running', `the click unlocked the mixer (state ${v.state})`);
  check(v.library.total > 0 && v.library.loaded === v.library.total && v.library.failed === 0, `sound library loaded after the click: ${v.library.loaded}/${v.library.total}, ${v.library.failed} failed`);
  check(played(v.log, 'ui.open') && played(v.log, 'ui.click'), 'Begin sounded (ui.open, ui.click)');
  check(v.ambience?.mode === 'title', `the title score plays (${v.ambience?.mode})`);
}
console.log('every cue, rendered offline');
{
  const rows = await page.evaluate(async () => {
    const out = [];
    for (const n of window.game.audioCues()) out.push([n, await window.game.audioRender(n)]);
    return out;
  });
  const silent = rows.filter(([, r]) => !r || r.peak < 0.01).map(([n]) => n);
  const missing = rows.filter(([, r]) => r?.missing.length).map(([n, r]) => `${n} (${r.missing.join(', ')})`);
  check(rows.length > 100 && !silent.length, `all ${rows.length} cues make sound${silent.length ? `; silent: ${silent.join(', ')}` : ''}`);
  check(!missing.length, `every recording a cue names is in the library${missing.length ? `; missing: ${missing.join('; ')}` : ''}`);
}
await page.locator('.card', { hasText: 'Recoil' }).click();
await page.getByRole('button', { name: 'Skip tutorial' }).click();
await page.waitForFunction(() => window.game.state() === 'explore', null, { timeout: 8000 });
await api((g) => { g.god(true); g.camera('third'); });
await wait(1500);

console.log('the bed, outdoors and in');
{
  await api((g) => g.teleport('courtyard'));
  await wait(1500);
  const out = (await view()).ambience;
  await api((g) => g.teleport([0, 0.6, -12]));
  await wait(2500);
  const hall = (await view()).ambience;
  check(out.mode === 'calm' && out.indoors < 0.1 && out.layers.wind > 0.03, `courtyard: wind ${out.layers.wind.toFixed(3)}, room ${out.layers.room}`);
  check(hall.indoors > 0.8 && hall.layers.room > 0.05 && hall.layers.wind < out.layers.wind * 0.6, `hall: indoors ${hall.indoors.toFixed(2)}, room ${hall.layers.room.toFixed(3)}, wind down to ${hall.layers.wind.toFixed(3)}`);
}

console.log('footsteps per surface');
for (const [where, want] of [[[0, 0.6, -12], 'step.wood'], [[0, 0.6, 4], 'step.stone'], [[-8, 0.6, 8], 'step.gravel'], [[-34, 0.6, 0], 'step.grass'], [[11, -0.6, 11], 'step.water'], [[14.6, 0.6, 11], 'step.wet']]) {
  await api((g, p) => { g.teleport(p); g.look(0, 0); }, where);
  await wait(300);
  await clear();
  await api((g) => g.hold('forward', true));
  await wait(900);
  await api((g) => g.hold('forward', false));
  const log = (await view()).log.filter((e) => e.cue.startsWith('step.'));
  check(log.some((e) => e.cue === want), `${want} at ${where.join(',')}: ${[...new Set(log.map((e) => e.cue))].join(', ') || 'no steps'}`);
}

console.log('every Technique: casts, Maximum Output');
const techs = (await api((g) => g.cutscenes().ids)).filter((id) => id.startsWith('max-')).map((id) => id.slice(4));
for (const t of techs) {
  await api((g, id) => { g.technique(id); g.teleport('courtyard'); g.game.techniques.resource = 100; }, t);
  const audio = await api((g) => ({ ...g.game.techniques.def.audio }));
  for (const slot of ['primary', 'secondary']) {
    await clear();
    await api((g, s) => g.cast(s), slot);
    await wait(700);
    await api((g, s) => g.hold(s, false), slot);
    const log = await cues();
    check(log.includes(audio[slot]), `${t} ${slot}: ${audio[slot]} (${log.filter((c) => c.startsWith(t + '.')).join(', ')})`);
  }
  await clear();
  await api((g, id) => g.cutscene(`max-${id}`), t);
  await page.waitForFunction(() => !window.game.cutscenes().active, null, { timeout: 15000 }).catch(() => undefined);
  await wait(300);
  const log = await cues();
  check([`${t}.max.charge`, 'cutscene.title', `${t}.max.blow`].every((c) => log.includes(c)), `${t} Maximum Output: charge, title, blow (${log.filter((c) => c.startsWith(t + '.max') || c === 'cutscene.title').join(', ')})`);
  check(log.some((c) => c.startsWith(t + '.max.') && c !== `${t}.max.charge` && c !== `${t}.max.blow`), `${t} Maximum Output has its inhale or rush and tail`);
}

console.log('hit weight, the aura, the drill');
{
  await api((g) => { g.technique('recoil'); g.encounter('dummy-room'); });
  await wait(600);
  await clear();
  await api((g) => { const e = g.game.encounters.enemies.find((x) => x.alive); g.game.combat.hitEnemy(e, 8); });
  await wait(80);
  await api((g) => { const e = g.game.encounters.enemies.find((x) => x.alive); g.game.combat.hitEnemy(e, 25); });
  await wait(80);
  await api((g) => { const e = g.game.encounters.enemies.find((x) => x.alive); g.game.combat.hitEnemy(e, 50); });
  await wait(80);
  await api((g) => { const e = g.game.encounters.enemies.find((x) => x.alive); g.game.combat.hitEnemy(e, 120); });
  await wait(200);
  const hits = (await view()).log.filter((e) => e.cue.startsWith('hit.'));
  check(hits.map((e) => e.cue).join(',') === 'hit.light,hit.medium,hit.heavy,hit.crushing', `blows of 8, 25, 50, 120 weigh light to crushing: ${hits.map((e) => e.cue).join(', ')}`);
  check(hits.every((e) => e.at !== null), 'hits are placed at the body struck');
  await api((g) => g.encounter('dummy-room'));
}
{
  await api((g) => { g.game.encounters.reset(); g.teleport('courtyard'); g.auraReady(); });
  await clear();
  await api((g) => g.game.aura.expand());
  await wait(500);
  await api((g) => g.game.aura.retract());
  await wait(200);
  const log = await cues();
  check(log.includes('aura.expand') && log.includes('aura.retract'), `aura expands and retracts audibly: ${log.filter((c) => c.startsWith('aura')).join(', ')}`);
}
{
  await clear();
  await api((g) => { g.technique('recoil'); g.drill('recoil-crane'); });
  await page.waitForFunction(() => window.game.audio().log.some((e) => e.cue === 'drill.cue'), null, { timeout: 8000 }).catch(() => undefined);
  await api((g) => { const d = g.game.drills; d.score(1); d.score(0); const c = d.current; c.score = 999; c.spawned = 999; for (const i of c.live) i.dispose?.(); c.live = []; });
  await wait(400);
  const log = await cues();
  check(['drill.ready', 'drill.cue', 'drill.hit', 'drill.miss', 'drill.tier'].every((c) => log.includes(c)), `drill: ready, cue, hit, miss, tier (${log.filter((c) => c.startsWith('drill')).join(', ')})`);
}

console.log('other bodies, placed in the world');
{
  await api((g) => { g.teleport('ring'); g.encounter('sparring'); });
  await wait(300);
  await clear();
  await wait(2500);
  const log = (await view()).log;
  const theirs = log.filter((e) => e.cue.startsWith('step.') && e.at);
  check(theirs.length > 0, `opponents' footsteps are placed at them (${theirs.length})`);
  check(log.some((e) => e.cue === 'enemy.swing' && e.at), 'an opponent\'s wind-up sounds where they stand');
  await api((g) => g.game.encounters.reset());
}

console.log('interface');
{
  await clear();
  await api((g) => g.workshop(true));
  await wait(300);
  await api((g) => g.workshop(false));
  await wait(200);
  await api((g) => { g.game.audio.play('ui.toast'); });
  const log = await cues();
  check(log.includes('ui.workshop.open') && log.includes('ui.workshop.close'), `the Workshop opens and closes audibly: ${log.filter((c) => c.startsWith('ui.')).join(', ')}`);
}

console.log('volume settings persist');
{
  await page.keyboard.press('Escape');
  await wait(300);
  await api((g) => { g.setting('volume', 0.7); g.setting('music', 0.25); g.setting('effects', 0.45); });
  await page.reload();
  await page.waitForFunction(() => window.game?.game?.ready, null, { timeout: 180000 });
  const v = await view();
  check(v.volumes.master === 0.7 && v.volumes.music === 0.25 && v.volumes.effects === 0.45, `master, music and effects survive a reload: ${JSON.stringify(v.volumes)}`);
  check(!v.unlocked, 'after a reload the mixer waits for a gesture again');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const labels = await page.locator('.row label').allTextContents();
  check(['Master volume', 'Music', 'Effects'].every((l) => labels.includes(l)), `the settings sheet has the three faders: ${labels.filter((l) => /volume|Music|Effects/.test(l)).join(', ')}`);
  await api((g) => { g.setting('volume', 0.8); g.setting('music', 0.6); g.setting('effects', 0.9); });
}

check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''}`);
await browser.close();
stop();
if (failures.length) { console.log(`\n${failures.length} failed`); process.exit(1); }
console.log('\nall audio checks passed');
