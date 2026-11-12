#!/usr/bin/env node
// Plays the rooftop trial (issues #34 and #5) the way a player does and fails
// on any page error. It checks:
//   entry: the title's Rooftop button, and the lift plus the board on the roof;
//   eight waves to victory in both camera modes and to defeat in both, with
//   the 35% heal, the Eye offer after wave 3, the Aura unlock after wave 4,
//   scaling wave sizes, and the end screen's score, waves, Pacts and Wagers;
//   every Pact offer: valid in the schema, shown as a readback sentence, and
//   never two with the same sacrifice;
//   the rule that Pacts taken on the roof do not stay in the real book;
//   the sheets fit the viewport at 1280x720 and 1920x1080.
// Offers, the Eye and the Aura are taken with real clicks and keys. The
// ?debug hooks only teleport, switch the camera, give god mode, clear a wave
// and read state. Wave 1 is fought by a pilot that aims and punches.
// Usage: node tools/check-rooftop.mjs [--url http://localhost:4173/] [--out captures/rooftop] [--port 4173]
// Without --url it serves dist/ itself (run `npm run build` first).
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? 'true' : all[i + 1]] : [])).filter((x) => x.length));
const out = args.out ?? 'captures/rooftop';
mkdirSync(out, { recursive: true });

let server = null;
let url = args.url;
if (!url) {
  if (!existsSync('dist/index.html')) throw new Error('dist/ missing: run npm run build first');
  const port = args.port ?? '4173';
  server = spawn('npx', ['vite', 'preview', '--port', port, '--strictPort'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1800));
  url = `http://localhost:${port}/`;
}

const WAVE_SIZES = [4, 6, 7, 4, 9, 10, 12, 1];
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|WebGL|GPU stall|Automatic fallback/.test(m.text())) errors.push(`console: ${m.text()}`); });
const failures = [];
const check = (ok, what) => { if (!ok) failures.push(what); console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const shot = (name) => page.screenshot({ path: join(out, `${name}.png`), animations: 'disabled' });
const status = () => page.evaluate(() => window.game.rooftop.status());
const offered = [];

async function boot() {
  await page.goto(`${url}?debug`);
  await page.waitForFunction(() => window.game?.game?.ready, null, { timeout: 180000 });
  await page.evaluate(() => window.game.loop(false));
  await page.waitForTimeout(300);
}

// Steps the game until the expression is true in the page, or the frames run out.
const stepUntil = (expr, maxFrames, chunk = 6) => page.evaluate(({ expr, maxFrames, chunk }) => {
  const g = window.game;
  const test = new Function('g', `return (${expr});`);
  for (let f = 0; f < maxFrames; f += chunk) { if (test(g)) return true; g.step(chunk); }
  return test(g);
}, { expr, maxFrames, chunk });

const bookState = () => page.evaluate(() => { const b = window.game.game.book; return JSON.stringify({ inscribed: b.inscribed.value.map((p) => p.id).sort(), bindings: b.bindings.value }); });

// Standing still is one sacrifice however it is written.
const family = (tag) => (tag === 'body:noMove' ? 'trigger:still' : tag);

async function readOffers(label) {
  const cards = await page.locator('.rt-offer').evaluateAll((els) => els.map((e) => ({ id: e.dataset.pact, slot: e.dataset.slot, tags: e.dataset.tags.split(',').filter(Boolean), text: e.querySelector('.rt-read').textContent, name: e.querySelector('h3').textContent })));
  const valid = await page.evaluate(() => window.game.rooftop.offers());
  check(cards.length === 3, `${label}: three Pacts are offered`);
  check(valid.length === cards.length && valid.every((v) => v.valid), `${label}: every offer is valid in the Pact schema`);
  const raw = cards.flatMap((c) => c.tags);
  check(new Set(raw).size === raw.length, `${label}: no two offers share a sacrifice tag (${cards.map((c) => c.tags.join('+')).join(' | ')})`);
  const fam = cards.map((c) => new Set(c.tags.map(family)));
  const famAll = fam.flatMap((s) => [...s]);
  check(new Set(famAll).size === famAll.length, `${label}: no two offers spell the same sacrifice differently (standing still as a trigger and as a vow never to move)`);
  check(cards.every((c) => /^"[^"]+" on /.test(c.text) && /unwritten\.$/.test(c.text) && !/%|\+\d/.test(c.text)), `${label}: each shows its readback sentence, not a percentage`);
  check(new Set(cards.map((c) => c.id)).size === 3 && cards.every((c) => c.tags.length > 0), `${label}: offers are distinct and each pays a sacrifice`);
  offered.push(...cards.map((c) => ({ label, ...c })));
  return cards;
}

async function fits(label) {
  const r = await page.evaluate(() => {
    const sheet = document.querySelector('.rt-sheet');
    if (!sheet) return null;
    const b = sheet.getBoundingClientRect();
    const scroller = [...sheet.querySelectorAll('.rt-cards, .rt-stats')][0];
    return { top: b.top, left: b.left, right: window.innerWidth - b.right, bottom: window.innerHeight - b.bottom, clipped: scroller ? scroller.scrollHeight > scroller.clientHeight + 1 : false };
  });
  const vp = page.viewportSize();
  check(!!r && r.top >= 0 && r.left >= 0 && r.right >= 0 && r.bottom >= 0 && !r.clipped, `${label}: the sheet fits ${vp.width}x${vp.height} with nothing clipped`);
}

// The pilot: face the nearest enemy, walk up and punch. Returns true if the wave was cleared by hand.
function pilot(maxFrames) {
  return page.evaluate((maxFrames) => {
    const g = window.game, G = g.game;
    const V = G.player.position.constructor;
    let wagered = false;
    for (let f = 0; f < maxFrames; f += 4) {
      if (g.rooftop.status().app !== 'rooftop') break;
      const live = G.encounters.enemies.filter((e) => e.alive);
      const p = G.player.position;
      const near = live.sort((a, b) => a.position.distanceTo(p) - b.position.distanceTo(p))[0];
      if (near) {
        const d = new V().subVectors(near.position, p);
        const flat = Math.hypot(d.x, d.z);
        g.look(Math.atan2(-d.x, -d.z), Math.atan2(near.position.y + 1.1 - (p.y + 1.64), flat));
        g.hold('forward', flat > 1.3);
        if (flat < 3.2) { if (!wagered && f > 40) { g.hold('wager', true); g.step(1); g.hold('wager', false); wagered = true; } g.hold('primary', true); g.step(1); g.hold('primary', false); }
      } else g.hold('forward', false);
      g.step(4);
    }
    g.hold('forward', false);
    return g.rooftop.status().stage === 'offer';
  }, maxFrames);
}

// Stands the player in the open eight metres from the boss, facing it.
async function frameBoss() {
  await page.evaluate(() => {
    const g = window.game, G = g.game;
    const boss = G.encounters.enemies.find((e) => e.alive && e.isBoss);
    if (!boss) return;
    const a = G.rooftop.arena;
    const P = boss.position.constructor;
    const world = 1;
    let at = null;
    for (let i = 0; i < 16 && !at; i++) {
      const ang = (i / 16) * Math.PI * 2;
      const c = new P(boss.position.x + Math.cos(ang) * 8, a.deckY, boss.position.z + Math.sin(ang) * 8);
      if (Math.abs(c.x - a.center.x) > a.half.x - 1 || Math.abs(c.z - a.center.z) > a.half.z - 1) continue;
      const eye = new P(c.x, a.deckY + 1.64, c.z);
      const to = new P(boss.position.x - c.x, 1.0 - 1.64, boss.position.z - c.z);
      const len = to.length();
      const hit = G.physics.castRay(eye, to.normalize(), len, world);
      if (!hit || hit.toi > len - 0.5) at = c;
    }
    at ??= a.start;
    g.teleport([at.x, a.deckY, at.z]);
    g.step(2);
    const p = G.player.position;
    g.look(Math.atan2(-(boss.position.x - p.x), -(boss.position.z - p.z)), 0.05);
    g.step(10);
  });
}

// Faces the middle of the roof from the lift side, where the whole wave shows.
async function frameWave() {
  await page.evaluate(() => {
    const g = window.game, G = g.game;
    const a = G.rooftop.arena;
    g.teleport([a.center.x - 9, a.deckY, a.center.z - 4]);
    g.step(2);
    g.look(-Math.PI / 2, 0.14);
    g.step(10);
  });
}

// One whole run to victory: eight waves, offers taken by clicking.
async function victoryRun(camera, viewport) {
  const tag = `victory/${camera}`;
  console.log(`\n${tag} at ${viewport.width}x${viewport.height}`);
  await page.setViewportSize(viewport);
  await page.evaluate(() => window.game.loop(false));
  const before = await bookState();
  await page.evaluate((c) => { const g = window.game; g.technique('recoil'); g.rooftop.begin(); g.camera(c); }, camera);
  await page.evaluate(() => window.game.step(10));
  check((await status()).app === 'rooftop' && (await status()).wave === 1, `${tag}: the run opens at wave 1`);
  const auraProbe = () => page.evaluate(() => { const g = window.game; g.hold('aura', true); g.step(20); const on = g.game.aura.active; g.hold('aura', false); g.step(4); return on; });

  for (let w = 1; w <= 8; w++) {
    const size = WAVE_SIZES[w - 1];
    if (w === 1) {
      await page.evaluate(() => window.game.god(true));
      const handCleared = await pilot(60 * 45);
      check(handCleared, `${tag}: wave 1 is cleared by aiming and punching alone, with no clear helper`);
      if (!handCleared) await page.evaluate(() => window.game.rooftop.clearWave());
    } else {
      await page.evaluate(() => window.game.god(true));
      check(await stepUntil(`g.rooftop.status().alive === ${size}`, 60 * 14), `${tag}: wave ${w} puts ${size} on the roof at once`);
      if (w === 5 && camera === 'first') { await frameWave(); await shot('wave-in-progress'); }
      if (w === 4 || w === 8) { await page.evaluate((n) => window.game.step(n), w === 8 ? 200 : 20); await frameBoss(); if (camera === 'first') await shot(w === 4 ? 'boss-kuroda' : 'boss-ancient'); }
      if (w === 4 && camera === 'first') {
        await page.evaluate(() => { const g = window.game; g.camera('third'); g.step(30); });
        await shot('boss-kuroda-third');
        await page.evaluate((c) => { window.game.camera(c); window.game.step(10); }, camera);
      }
      await page.evaluate(() => { const G = window.game.game; G.combat.hp = 30; });
      await page.evaluate(() => window.game.rooftop.clearWave());
    }
    if (w < 8) {
      const reached = await stepUntil("g.rooftop.status().app === 'rooftop-offer'", 60 * 6);
      check(reached, `${tag}: clearing wave ${w} opens the offer`);
      const hp = (await status()).hp;
      if (w > 1) check(Math.abs(hp - 65) < 0.01, `${tag}: wave ${w} heals 35% of maximum health (${hp.toFixed(0)}/100 from 30)`);
      if (w === 3) {
        const eyes = await page.locator('.rt-offer.eye').count();
        const locked = await page.locator('.rt-offer.eye.locked').count();
        check(eyes === 4 && locked === 1, `${tag}: the Eye offer comes after wave 3 (${eyes} Eyes, ${locked} locked)`);
        await fits(`${tag} Eye offer`);
        if (camera === 'first') await shot('eye-offer');
        await page.locator('.rt-offer.eye[data-eye="horizon"]').click();
        check((await status()).eye === 'horizon', `${tag}: the Horizon Eye is installed`);
      }
      if (w === 4) {
        check((await status()).auraAllowed === false, `${tag}: Aura Expansion is still locked while wave 4's offer is open`);
        await fits(`${tag} Aura unlock`);
        if (camera === 'first') await shot('aura-unlock');
        await page.getByRole('button', { name: 'Continue' }).click();
        check((await status()).auraAllowed === true, `${tag}: Aura Expansion unlocks after wave 4`);
      }
      const cards = await readOffers(`${tag} wave ${w} offer`);
      if (w === 1) { await fits(`${tag} Pact offer`); if (camera === 'first') await shot('pact-offer'); }
      const pickIdx = (w + (camera === 'third' ? 1 : 0)) % 3;
      if (w % 2 === 0) await page.keyboard.press(String(pickIdx + 1));
      else await page.locator('.rt-offer').nth(pickIdx).click();
      const taken = cards[pickIdx];
      const bound = await page.evaluate(({ slot, id }) => { const b = window.game.game.book; return { id: b.binding(slot), inscribed: !!b.inscribed.value.find((p) => p.id === id && p.inscribed) }; }, taken);
      check(bound.id === taken.id && bound.inscribed, `${tag}: "${taken.name}" is inscribed and bound to its key`);
      const st = await status();
      check(st.app === 'rooftop' && st.wave === w + 1, `${tag}: wave ${w + 1} begins after the Pact`);
    } else {
      check(await stepUntil("g.rooftop.status().app === 'rooftop-end'", 60 * 6), `${tag}: clearing wave 8 ends the run in victory`);
    }
    if (w === 4) {
      check(await auraProbe(), `${tag}: holding F opens the Aura field once it is unlocked`);
      await page.evaluate(() => { const g = window.game; g.hold('aura', false); g.step(10); });
    }
  }

  const end = await page.evaluate(() => ({
    victory: !!document.querySelector('.rt-sheet.end.win'), score: Number(document.querySelector('[data-stat=score]').textContent), best: document.querySelector('[data-stat=best]').textContent,
    waves: document.querySelector('[data-stat=waves]').textContent, pacts: Number(document.querySelector('[data-stat=pacts]').textContent),
    won: document.querySelector('[data-stat=wagers-won]').textContent, lost: document.querySelector('[data-stat=wagers-lost]').textContent,
    stored: JSON.parse(localStorage.getItem('zenko.rooftop.best.v1') ?? '{}'),
  }));
  check(end.victory && end.waves === '8 / 8', `${tag}: the end screen reads victory, ${end.waves} waves`);
  check(end.score > 1000 && end.stored.score >= end.score, `${tag}: score ${end.score}, best score kept in localStorage (${end.stored.score})`);
  check(end.pacts === 7, `${tag}: the end screen counts ${end.pacts} Pacts taken`);
  check(/^\d+$/.test(end.won) && /^\d+$/.test(end.lost), `${tag}: Wagers won ${end.won}, lost ${end.lost}`);
  await fits(`${tag} end screen`);
  if (camera === 'first') await shot('end-victory');
  check((await bookState()) === before, `${tag}: Pacts taken on the roof are gone from the real book afterwards`);
}

async function defeatRun(camera, viewport) {
  const tag = `defeat/${camera}`;
  console.log(`\n${tag}`);
  await page.setViewportSize(viewport);
  await page.evaluate(() => window.game.loop(false));
  await page.evaluate((c) => { const g = window.game; g.god(false); g.rooftop.begin(); g.camera(c); g.step(6); }, camera);
  const reached = await stepUntil("g.rooftop.status().app === 'rooftop-end'", 60 * 70, 10);
  check(reached, `${tag}: standing still loses the run`);
  const end = await page.evaluate(() => ({ lose: !!document.querySelector('.rt-sheet.end.lose'), waves: document.querySelector('[data-stat=waves]').textContent, pacts: document.querySelector('[data-stat=pacts]').textContent, text: document.querySelector('.rt-sheet.end').textContent }));
  check(end.lose && /敗北/.test(end.text), `${tag}: the end screen reads defeat`);
  check(end.waves === '0 / 8' && end.pacts === '0', `${tag}: no waves cleared (${end.waves}), no Pacts (${end.pacts})`);
  await fits(`${tag} end screen`);
  if (camera === 'third') await shot('end-defeat');
  await page.getByRole('button', { name: 'Climb again' }).click();
  const st = await status();
  check(st.app === 'rooftop' && st.wave === 1 && st.hp === 100, `${tag}: "Climb again" starts a fresh run at full health`);
  await page.getByRole('button', { name: 'Climb again' }).waitFor({ state: 'detached', timeout: 2000 }).catch(() => undefined);
}

// ---------------------------------------------------------------- the checks

console.log('title entry');
await boot();
const titleButtons = await page.locator('.menu button').allTextContents();
check(titleButtons.includes('Rooftop') && !titleButtons.some((t) => /arena/i.test(t)), `the title offers Rooftop and no Arena (classic): ${titleButtons.join(', ')}`);
await shot('title');
check(!existsSync('public/arena') && !existsSync('dist/arena'), 'the classic arena build is gone from public/ and dist/');
await page.getByRole('button', { name: 'Rooftop', exact: true }).click();
await page.locator('.card', { hasText: 'Recoil' }).click();
await page.getByRole('button', { name: 'Climb to the rooftop' }).click();
await page.evaluate(() => window.game.step(30));
{
  const s = await status();
  const onDeck = await page.evaluate(() => window.game.game.player.position.y);
  check(s.app === 'rooftop' && s.stage === 'fight' && onDeck > 14, `Rooftop from the title lands on the deck (y ${onDeck.toFixed(1)}) in wave 1`);
}
await page.evaluate(() => window.game.rooftop.begin());

console.log('\nentry by the lift and the board');
await boot();
await page.evaluate(() => { const g = window.game; g.game.startRun({ skipTutorial: true }); g.step(5); });
{
  const base = await page.evaluate(() => window.game.game.rooftop.arena.liftBase.toArray());
  await page.evaluate((b) => { const g = window.game; g.teleport(b); g.step(10); }, base);
  const prompt = await page.locator('.prompt').textContent().catch(() => '');
  check(/lift to the rooftop/.test(prompt), `the street shows the prompt "${prompt}"`);
  await page.keyboard.down('KeyE'); await page.evaluate(() => window.game.step(2)); await page.keyboard.up('KeyE');
  const y = await page.evaluate(() => window.game.game.player.position.y);
  check(y > 14, `E rides the lift to the rooftop (y ${y.toFixed(1)})`);
  await page.evaluate(() => window.game.step(10));
  const board = await page.evaluate(() => window.game.game.rooftop.arena.consoleAt.toArray());
  await page.evaluate((b) => { const g = window.game; g.teleport(b); g.step(10); }, board);
  const prompt2 = await page.locator('.prompt').textContent().catch(() => '');
  check(/Begin the Rooftop trial/.test(prompt2), `the roof shows the prompt "${prompt2}"`);
  await page.keyboard.down('KeyE'); await page.evaluate(() => window.game.step(2)); await page.keyboard.up('KeyE');
  const s = await status();
  check(s.app === 'rooftop' && s.wave === 1, 'E at the board starts the trial');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.game.step(3));
  check((await status()).app === 'paused', 'Esc pauses the run');
  await page.getByRole('button', { name: 'Leave the rooftop' }).click();
  const after = await page.evaluate(() => ({ app: window.game.state(), y: window.game.game.player.position.y, stage: window.game.rooftop.status().stage }));
  check(after.app === 'explore' && after.y < 2 && after.stage === 'idle', 'Leave the rooftop returns to the street');
}

await boot();
await victoryRun('first', { width: 1280, height: 720 });
await boot();
await victoryRun('third', { width: 1920, height: 1080 });
await boot();
await defeatRun('first', { width: 1280, height: 720 });
await defeatRun('third', { width: 1280, height: 720 });

console.log('\noffer rules over many rolls');
await boot();
for (const t of ['recoil', 'shift', 'rime', 'blink', 'echo']) {
  const bad = await page.evaluate((t) => window.game.rooftop.audit(t, 300), t);
  check(bad.length === 0, `${t}: 300 rolls, each three valid Pacts with no shared sacrifice${bad.length ? ` (${bad.slice(0, 2).join('; ')})` : ''}`);
}

console.log('\noffers across every run');
const tagsSeen = new Set(offered.flatMap((o) => o.tags));
check(offered.length >= 3 * 7 * 2, `${offered.length} offers were inspected`);
check(tagsSeen.size >= 8, `the offers drew on ${tagsSeen.size} different sacrifices`);

const pageErrors = await page.evaluate(() => window.game.errors);
errors.push(...pageErrors.map((e) => `window: ${e}`));
writeFileSync(join(out, 'report.json'), JSON.stringify({ url, failures, errors, offers: offered }, null, 2));
console.log(`\n${failures.length} failures, ${errors.length} page errors -> ${join(out, 'report.json')}`);
for (const e of errors.slice(0, 20)) console.log('  ERROR', e);
await browser.close();
server?.kill();
process.exit(failures.length || errors.length ? 1 : 0);
