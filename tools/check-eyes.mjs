#!/usr/bin/env node
// Proves each Eye changes what the bearer sees and what that sight is for:
//   Horizon draws a body's next blow (its mark, a ghost where it would stand)
//   while the body is still walking in, before any wind-up; a blow the
//   bearer saw coming and stood clear of leaves its thrower's guard broken;
//   Thread ties the lighter bodies to the heaviest near them, a blow to that
//   anchor runs down the threads, and what hangs on it takes less while it stands;
//   Empty lands harder through the gap behind a guard than through its front;
//   Vault casts a Technique other than the player's on its own key, with its
//   own cooldown, and leaves the player's own Technique and resource as they were;
//   the installed Eye is kept across a reload, is marked on the player's body,
//   rides the player's online state, frames its side in first person only, and
//   the installation plays and ends on a key.
// Usage: node tools/check-eyes.mjs [url] [--port 4173] [--out captures/eyes-check]
// Without a URL it serves dist/ itself (run `npm run build` first).
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveTarget } from './lib/target.mjs';

const { url, args, stop } = await resolveTarget();
const out = args.out ?? 'captures/eyes-check';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|WebGL|GPU stall|Automatic fallback/.test(m.text())) errors.push(`console: ${m.text()}`); });
const failures = [];
const check = (ok, what) => { if (!ok) failures.push(what); console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const shot = (name) => page.screenshot({ path: join(out, `${name}.png`), animations: 'disabled' });
const ev = (fn, a) => page.evaluate(fn, a);

async function boot() {
  await page.goto(`${url}?debug`);
  await page.waitForFunction(() => window.game?.game?.ready, null, { timeout: 180000 });
  await ev(() => { const g = window.game; g.loop(false); g.technique('recoil'); g.game.startRun({ skipTutorial: true }); g.god(true); g.camera('top'); g.step(5); });
}

// An open stretch of the yard, with `keys` spawned around the player and
// nothing else fighting.
const ARENA = `
  const G = g.game, P = G.player.position.constructor;
  G.encounters.reset();
  g.teleport('courtyard'); g.step(2);
  const me = G.player.position.clone();
  const put = (key, dx, dz) => G.encounters.spawn(key, new P(me.x + dx, me.y, me.z + dz));
`;

await boot();

console.log('Horizon');
{
  const r = await ev((code) => {
    const g = window.game, run = new Function('g', `${code}
      g.eye('horizon');
      const e = put('thug', 0, -4.2);
      e.attackCd = 0.3; e.state = 'chase';
      let seen = null;
      for (let i = 0; i < 90 && e.state !== 'windup'; i++) {
        g.step(1);
        const w = G.combat.eyes.sight.watch.get(e);
        if (!seen && w && w.mark.root.visible && e.state === 'chase') seen = { at: i, ghost: w.ghost.group.visible };
      }
      // Now step clear of it while it winds up.
      const away = G.player.position.clone().addScaledVector(G.player.position.clone().sub(e.position).setY(0).normalize(), 4);
      g.teleport([away.x, away.y, away.z]);
      for (let i = 0; i < 60 && e.state !== 'strike'; i++) g.step(1);
      g.step(1);
      return { seen, windup: true, broken: e.guardBroken };
    `);
    return run(g);
  }, ARENA);
  check(!!r.seen, `the next blow is drawn while the body still walks in, before its wind-up (${r.seen ? `frame ${r.seen.at}` : 'never'})`);
  check(!!r.seen?.ghost, 'a ghost of the body stands where it would throw it');
  check(r.broken > 1, `a blow seen coming and stepped out of leaves its thrower open (guard broken ${r.broken.toFixed(2)} s)`);
  await shot('horizon');
}

console.log('Thread');
{
  const r = await ev((code) => new Function('g', `${code}
    g.eye('thread');
    const husk = put('husk', 0, -5), a = put('thug', 1.5, -6), b = put('runner', -1.5, -6);
    for (const e of [husk, a, b]) { e.frozen = 99; }
    g.step(30);
    const s = G.combat.eyes.sight;
    const tied = [a, b].every((e) => s.anchorOf(e) === husk);
    const ha = a.hp, hb = b.hp;
    G.combat.hitEnemy(husk, 50);
    g.step(20);
    const carried = [ha - a.hp, hb - b.hp];
    const h0 = a.hp; G.combat.hitEnemy(a, 20); const shielded = h0 - a.hp;
    return { tied, carried, shielded };
  `)(window.game), ARENA);
  check(r.tied, 'the thug and the runner hang on the husk, the heaviest body near them');
  check(r.carried.every((d) => d === 20), `a blow of 50 to the husk runs down both threads (${r.carried.join(', ')} each)`);
  check(r.shielded === 16, `a body whose anchor stands takes less (20 lands as ${r.shielded})`);
  await shot('thread');
}

console.log('Empty');
{
  const r = await ev((code) => new Function('g', `${code}
    g.eye('empty');
    const e = put('bruiser', 0, -3);
    e.frozen = 0; e.locked = 0; e.state = 'chase'; e.attackCd = 99;
    e.yaw = Math.atan2(-(G.player.position.x - e.position.x), -(G.player.position.z - e.position.z));
    const h0 = e.hp; G.combat.hitEnemy(e, 20, { stagger: false }); const front = h0 - e.hp;
    e.state = 'chase';
    const behind = e.position.clone().add(e.position.clone().sub(G.player.position).setY(0).normalize().multiplyScalar(1.5));
    g.teleport([behind.x, behind.y, behind.z]);
    const h1 = e.hp; G.combat.hitEnemy(e, 20, { stagger: false }); const back = h1 - e.hp;
    return { front, back, staggered: e.state === 'stagger' };
  `)(window.game), ARENA);
  check(r.front === 20 && r.back === 30, `a blow through the guard's front lands as dealt (${r.front}), through the gap behind it lands harder (${r.back})`);
  check(r.staggered, 'a blow through the gap staggers even when the blow itself would not');
  await shot('empty');
}

console.log('Vault');
{
  const r = await ev((code) => new Function('g', `${code}
    g.camera('third'); g.step(30);
    g.eye('vault', { vault: 'blink' });
    const e = put('bruiser', 0, -3.5);
    e.frozen = 99;
    g.look(Math.atan2(-(e.position.x - G.player.position.x), -(e.position.z - G.player.position.z)), 0);
    g.step(2);
    const res = G.techniques.resource, def = G.techniques.def.id, h0 = e.hp;
    const first = g.castVault();
    g.step(40);
    const again = g.castVault();
    return { first, again, dealt: h0 - e.hp, res0: res, res1: G.techniques.resource, def, def1: G.techniques.def.id};
  `)(window.game), ARENA);
  check(r.first && r.dealt > 0, `the Vault casts Blink for a Recoil player, and it lands (${r.dealt.toFixed(0)})`);
  check(!r.again, 'its own cooldown holds a second cast back');
  check(r.def1 === r.def && r.res1 >= r.res0 - 0.01, `the player's own Technique (${r.def1}) and resource are left as they were`);
  await page.waitForTimeout(100);
  const slot = await page.locator('[data-slot=vault]').textContent().catch(() => '');
  check(/Blink/.test(slot), `the HUD shows the Vault key with the Technique it holds ("${slot}")`);
  await shot('vault');
}

console.log('the bearer and the others');
{
  await ev(() => { const g = window.game; g.eye('thread'); g.camera('first'); g.step(90); });
  const first = await ev(() => window.game.game.renderer.page.u('eyeK').value);
  await shot('first-person-frame');
  await ev(() => { const g = window.game; g.camera('top'); g.step(90); });
  const top = await ev(() => window.game.game.renderer.page.u('eyeK').value);
  check(first > 0.8 && top === 0, `first person frames the Eye's side (${first.toFixed(2)}), the top-down view does not (${top})`);
  const mark = await ev(() => { const G = window.game.game, m = G.combat.eyes.mark; return { id: m.id, shown: m.group.visible, on: m.group.parent?.name }; });
  check(mark.id === 'thread' && mark.shown && mark.on === 'Head', `the player's body carries the mark on its head (${JSON.stringify(mark)})`);
  await page.reload();
  await page.waitForFunction(() => window.game?.game?.ready, null, { timeout: 180000 });
  check(await ev(() => window.game.game.combat.eye) === 'thread', 'the Eye is still installed after a reload');
  await ev(() => { const g = window.game; g.loop(false); g.game.startRun({ skipTutorial: true }); g.step(5); g.eye('empty', { scene: true }); g.step(2); });
  const playing = await page.locator('.eye-install').count();
  await page.waitForTimeout(400);
  await page.keyboard.press('KeyX');
  const after = await page.locator('.eye-install').count();
  check(playing === 1 && after === 0, `the installation plays (${playing}) and a key ends it (${after})`);
}

const pageErrors = await ev(() => window.game.errors);
for (const e of [...errors, ...pageErrors]) { failures.push(e); console.log('ERROR', e); }
writeFileSync(join(out, 'report.json'), JSON.stringify({ failures }, null, 2));
console.log(`\n${failures.length} failures -> ${join(out, 'report.json')}`);
await browser.close();
stop();
process.exit(failures.length ? 1 : 0);
