#!/usr/bin/env node
// Out-of-combat regen online, where the server owns health: one browser
// player and one protocol bot in a room. The bot hits the player; the
// player's health holds through the quiet spell, then climbs at the shared
// rate, on its own screen (the HUD shows it mending) and in the room's
// snapshot. The bot, which spent health on itself and keeps swinging, does
// not regenerate while it fights, and does once it stops.
// Usage: node tools/check-regen-online.mjs [url] [--port 4181] [--latency 0]
// Without a URL it serves dist/ through server/index.mjs (run `npm run build` first).
import { chromium } from 'playwright';
import { resolveTarget } from './lib/target.mjs';
import { wsUrl } from './lib/bots.mjs';
import rules from '../src/net/rules.json' with { type: 'json' };

const { url, stop } = await resolveTarget(process.argv.slice(2), { realtime: true });
const room = `regen${Math.floor(Math.random() * 1e6)}`;
const R = rules.regen;
const failures = [];
const errors = [];
const check = (ok, what) => { if (!ok) failures.push(what); console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); return ok; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// Health regained after `t` seconds since the last blow.
const regained = (t) => { const q = t - R.quietSeconds; if (q <= 0) return 0; return q <= R.rampSeconds ? R.perSecond * q * q / (2 * R.rampSeconds) : R.perSecond * (R.rampSeconds / 2 + (q - R.rampSeconds)); };

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|WebGL|GPU stall|Automatic fallback|WebSocket/.test(m.text())) errors.push(`console: ${m.text()}`); });
await page.goto(`${url}?debug&room=${room}`);
await page.waitForFunction(() => window.game?.game?.ready, null, { timeout: 180000 });
await page.locator('.card').filter({ has: page.locator('h3', { hasText: /^rime$/i }) }).click();
await page.locator('input[name=name]').fill('Mio');
await page.locator('[data-join]').click();
await page.waitForFunction(() => window.game.net()?.status === 'online', null, { timeout: 15000 });
const me = () => page.evaluate(() => ({ id: window.game.net().id, hp: window.game.game.combat.hp, p: window.game.game.player.position.toArray(), mend: !!document.querySelector('.vitals .meter.health.mend') }));

// The bot: stands by the player, and reads every snapshot.
const ws = new WebSocket(wsUrl(url));
const snaps = new Map();
let botId = null, seq = 0;
const send = (m) => ws.send(JSON.stringify(m));
await new Promise((resolve, reject) => {
  ws.addEventListener('open', () => send({ type: 'hello', room, name: 'Bot', token: `regen-${room}`, tech: 'recoil' }));
  ws.addEventListener('error', () => reject(new Error('bot socket failed')));
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(String(e.data));
    if (m.type === 'welcome') { botId = m.id; resolve(); }
    if (m.type === 'snap') for (const p of m.players) snaps.set(p.id, p.hp);
    if (m.type === 'struck') send({ type: 'resolve', hit: m.hit, taken: m.amount });
  });
});
const start = await me();
const stand = setInterval(() => send({ type: 'state', s: { ct: performance.now(), p: [start.p[0] + 2, start.p[1], start.p[2]], v: [0, 0, 0], yaw: 0, pitch: 0, g: true, sign: 0, cine: false } }), 50);
await wait(1800);
const hit = (amount) => send({ type: 'hit', seq: ++seq, target: start.id, amount, from: [start.p[0] + 2, 1, start.p[2]], knock: 0, lift: 0 });

console.log('the player, hit once');
hit(40);
await page.waitForFunction(() => window.game.game.combat.hp < 100, null, { timeout: 5000 }).catch(() => undefined);
const t0 = Date.now();
const h0 = (await me()).hp;
check(Math.abs(h0 - 60) < 0.01, `the blow lands through the server: ${h0}`);
await wait((R.quietSeconds - 0.6) * 1000);
const quiet = await me();
check(Math.abs(quiet.hp - h0) < 0.01 && !quiet.mend, `no regen inside the quiet spell: ${quiet.hp.toFixed(1)} after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
await wait(4000);
const later = await me();
const dt = (Date.now() - t0) / 1000;
const want = regained(dt);
check(later.hp - h0 > want - 2 && later.hp - h0 < want + 2, `the server regenerates the player at the shared rate: +${(later.hp - h0).toFixed(1)} after ${dt.toFixed(1)} s, expected about +${want.toFixed(1)}`);
check(later.mend, 'the player\'s health bar shows it mending');
check(Math.abs((snaps.get(start.id) ?? 0) - later.hp) < 1.5, `the room's snapshot carries the same health: ${snaps.get(start.id)} vs ${later.hp.toFixed(1)}`);

console.log('the bot, fighting');
send({ type: 'self', amount: 30 });
await wait(400);
const b0 = snaps.get(botId);
check(Math.abs(b0 - 70) < 0.01, `the bot spent 30 on itself: ${b0}`);
// A blow dealt every 2 s keeps it fighting.
for (let i = 0; i < 5; i++) { hit(1); await wait(2000); }
check(Math.abs(snaps.get(botId) - b0) < 0.01, `no regen while it keeps dealing blows: ${snaps.get(botId)} after 10 s`);
await wait((R.quietSeconds + R.rampSeconds + 1) * 1000);
check(snaps.get(botId) > b0 + 3, `it regenerates once it stops: ${snaps.get(botId)}`);

clearInterval(stand);
ws.close();
for (const e of errors) check(false, e);
await browser.close();
stop();
console.log(failures.length ? `\n${failures.length} failure(s)` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);
