#!/usr/bin/env node
// Capture harness for the gauntlet critics. Drives the built game through the
// `?debug` hooks to fixed scenarios and saves screenshots and short frame
// sequences per piece. Usage:
//   node tools/capture.mjs [--out captures] [--only hands,district] [--url http://...] [--port 4173] [--gpu]
// Pieces: ui, hands, variants, poses, third-person, district, vfx, encounters, workshop, tutorial, drill, perf.
// Without --url it serves dist/ itself (run `npm run build` first).
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? 'true' : all[i + 1]] : [])).filter((x) => x.length));
const out = args.out ?? 'captures';
const only = args.only ? new Set(args.only.split(',')) : null;
const TECHS = ['recoil', 'shift', 'rime', 'blink', 'echo'];
const MODAL_SIZES = [[1280, 720], [1920, 1080]];
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

// --gpu runs the installed Chrome on the real GPU (Metal), which is many times
// faster than SwiftShader and matches what a player sees.
const browser = args.gpu === 'true'
  ? await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] })
  : await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|WebGL|GPU stall|Automatic fallback/.test(m.text())) errors.push(`console: ${m.text()}`); });

const report = { url, shots: [], failures: [], errors };
const shot = async (piece, name) => {
  const dir = join(out, piece);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.png`);
  await page.screenshot({ path: file, timeout: 120000, animations: 'disabled' });
  report.shots.push({ piece, name, file });
  process.stdout.write(`  ${piece}/${name}\n`);
};
const api = (fn, ...a) => page.evaluate(([f, ...rest]) => { const g = window.game; return new Function('g', 'a', `return (${f})(g, ...a)`)(g, rest); }, [fn.toString(), ...a]);
const step = (frames, dt = 1 / 60) => api((g, n, d) => g.step(n, d), frames, dt);
const settle = (ms) => page.waitForTimeout(ms);

const ready = async () => { await page.waitForFunction(() => window.game?.game?.ready, null, { timeout: 180000 }); await api((g) => g.loop(false)); await step(4); };
await page.goto(`${url}?debug`);
await ready();
const run = (piece) => !only || only.has(piece);

if (run('ui')) {
  await shot('ui', 'title');
  for (const [w, h] of MODAL_SIZES) {
    await page.setViewportSize({ width: w, height: h });
    await settle(200);
    await page.keyboard.press('Enter');
    await step(3);
    await settle(200);
    await shot('ui', `technique-select-${w}x${h}`);
    await checkFit(`technique-select-${w}x${h}`, '.select');
    await page.reload();
    await ready();
  }
  await page.setViewportSize({ width: 1280, height: 720 });
}

async function checkFit(name, selector) {
  const r = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { missing: true };
    const b = el.getBoundingClientRect();
    const over = [...el.querySelectorAll('*')].some((c) => { const r = c.getBoundingClientRect(); return r.right > innerWidth + 1 || r.bottom > innerHeight + 1 || r.left < -1; });
    return { w: b.width, h: b.height, vw: innerWidth, vh: innerHeight, over, docScroll: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight };
  }, selector);
  if (r.missing || r.over || r.docScroll || r.w > r.vw + 1 || r.h > r.vh + 1) report.failures.push({ check: 'modal-fit', name, detail: r });
}

async function startRun(tech, opts = {}) {
  await api((g, t, o) => { g.technique(t); g.game.startRun({ skipTutorial: !o.tutorial }); g.loop(false); }, tech, opts);
  await step(12);
}

if (run('hands')) {
  for (const t of TECHS) {
    await startRun(t);
    await api((g) => { g.teleport('market'); g.camera('first'); g.look(Math.PI / 2, -0.05); });
    await step(20);
    await shot('hands', `${t}-idle`);
    await api((g) => g.cast('primary'));
    for (const f of [3, 8, 14, 20, 30]) { await step(f === 3 ? 3 : 6); await shot('hands', `${t}-primary-f${f}`); }
    await step(40);
    await api((g) => g.hold('secondary', true));
    await api((g) => g.cast('secondary'));
    for (const f of [6, 16]) { await step(f === 6 ? 6 : 10); await shot('hands', `${t}-secondary-f${f}`); }
    await api((g) => g.hold('secondary', false));
    await step(10);
  }
}

// Trained activation shortens the sign (short), then drops it (none); Alt
// forces the full sign back. Each variant must still read as its gesture.
if (run('variants')) {
  await startRun('recoil');
  await api((g) => { g.teleport('market'); g.camera('first'); g.look(Math.PI / 2, -0.05); });
  const setActivation = (a) => api((g, v) => { const m = g.game.mastery; m.stats.value = { ...m.stats.value, recoil: { ...m.stats.value.recoil, activation: v } }; }, a);
  for (const [name, act, full] of [['short', 0.5, false], ['none', 0.9, false], ['fullsign', 0.9, true]]) {
    await setActivation(act);
    await api((g, f) => g.hold('fullsign', f), full);
    await step(20);
    await api((g) => g.cast('primary'));
    for (const f of [3, 8, 14, 24]) { await step(f === 3 ? 3 : f === 24 ? 10 : 6); await shot('variants', `recoil-${name}-f${f}`); }
    await api((g) => g.hold('fullsign', false));
    await step(40);
  }
  await setActivation(0);
}

// One frame per authored hand pose, held on both hands, for judging the rig.
if (run('poses')) {
  await startRun('rime');
  await api((g) => { g.teleport('market'); g.camera('first'); g.look(Math.PI / 2, -0.05); });
  for (const p of ['rest', 'restLow', 'sprint', 'bracePalm', 'braceWide', 'chamber', 'punch', 'palmDown', 'slamUp', 'slamDown', 'clawReady', 'clawReach', 'point', 'pointFar', 'cupEyes', 'cupFlinch', 'shieldEyes', 'palmSurface', 'palmPress', 'snapReady', 'snapped', 'quietSpread', 'guard', 'raiseHigh', 'crossChest', 'flat', 'landCatch']) {
    await api((g, n) => g.pose(n), p);
    await step(45);
    await shot('poses', p);
  }
  // Side and top views of the poses where finger and palm contact matters.
  for (const p of ['punch', 'chamber', 'clawReady', 'snapped', 'point', 'rest']) {
    await api((g, n) => g.pose(n), p);
    for (const [name, yaw, pitch] of [['side', 1.2, 0.15], ['top', 0, 1.25], ['inner', -1.1, 0.3]]) {
      await api((g, y, pt) => g.handsView(y, pt), yaw, pitch);
      await step(45);
      await shot('poses', `${p}-${name}`);
    }
  }
  await api((g) => { g.handsView(0, 0); g.pose(null); });
}

if (run('third-person')) {
  await startRun('recoil');
  await api((g) => { g.teleport('market'); g.camera('third'); g.look(Math.PI / 2, -0.15); });
  await step(30);
  await shot('third-person', 'idle');
  await api((g) => { g.hold('forward', true); });
  for (const f of [10, 20, 30]) { await step(10); await shot('third-person', `walk-f${f}`); }
  await api((g) => { g.hold('sprint', true); });
  for (const f of [10, 20, 30]) { await step(10); await shot('third-person', `run-f${f}`); }
  await api((g) => { g.hold('forward', false); g.hold('sprint', false); });
  await step(30);
  await api((g) => g.cast('primary'));
  for (const f of [8, 16, 24]) { await step(8); await shot('third-person', `cast-f${f}`); }
}

if (run('district')) {
  await startRun('recoil');
  const vistas = [['market-east', 'market', Math.PI / 2, -0.02], ['market-west', 'market', -Math.PI / 2, -0.02], ['alley', 'alley', 0, -0.05], ['bridge', 'bridge', -Math.PI / 2, -0.05], ['academy', 'academy', -Math.PI / 2, -0.05], ['dojo', 'dojo', Math.PI, -0.05], ['kuroda', 'kuroda', Math.PI, -0.05], ['roof', 'roof', Math.PI / 2, -0.25]];
  for (const [name, where, yaw, pitch] of vistas) {
    await api((g, w, y, p) => { g.teleport(w); g.camera('first'); g.look(y, p); }, where, yaw, pitch);
    await step(24);
    await shot('district', name);
  }
  await api((g) => { g.teleport('market'); g.camera('third'); g.look(Math.PI / 2, -0.3); });
  await step(30);
  await shot('district', 'market-third');
}

if (run('vfx')) {
  for (const t of TECHS) {
    await startRun(t);
    await api((g) => { g.teleport('alley'); g.camera('third'); g.look(0, -0.15); });
    await step(30);
    await api((g) => g.cast('primary'));
    for (const f of [12, 20, 32]) { await step(f === 12 ? 12 : 8); await shot('vfx', `${t}-primary-f${f}`); }
    await step(40);
    await api((g) => g.cast('secondary'));
    await step(18);
    await shot('vfx', `${t}-secondary-f18`);
    await step(40);
    await api((g) => { g.game.techniques.charge = 1; g.game.techniques.beginMax(); });
    for (const f of [15, 45, 70, 95, 120]) { await step(f === 15 ? 15 : 25, 1 / 60); await shot('vfx', `${t}-max-f${f}`); }
    await api((g) => g.game.cutscenes.skip());
    await step(20);
  }
}

if (run('encounters')) {
  for (const id of ['alley-thugs', 'kuroda', 'ancient-bridge', 'dummy-room']) {
    await startRun('recoil');
    await api((g) => g.god(true));
    await api((g, i) => { g.encounter(i); g.camera('third'); }, id);
    await step(60);
    await shot('encounters', `${id}-f60`);
    await step(90);
    await shot('encounters', `${id}-f150`);
    if (id === 'ancient-bridge') {
      await api((g) => { const boss = g.game.encounters.enemies.find((e) => e.isBoss); if (boss) g.game.encounters.bossUltimate(boss); });
      for (const f of [20, 50, 80]) { await step(f === 20 ? 20 : 30); await shot('encounters', `ancient-ultimate-f${f}`); }
      await api((g) => g.game.cutscenes.skip());
    }
    await api((g) => g.god(false));
  }
}

if (run('workshop')) {
  await startRun('recoil');
  for (const [w, h] of MODAL_SIZES) {
    await page.setViewportSize({ width: w, height: h });
    await api((g) => g.workshop(true));
    await settle(300);
    await shot('workshop', `write-${w}x${h}`);
    await checkFit(`workshop-write-${w}x${h}`, '.sheet');
    await page.locator('.tabs button', { hasText: 'Inscribed' }).click();
    await settle(150);
    await shot('workshop', `inscribed-${w}x${h}`);
    await page.locator('.tabs button', { hasText: 'Write' }).click();
    await page.locator('.btn.primary', { hasText: 'Inscribe' }).click();
    await settle(200);
    await shot('workshop', `confirm-${w}x${h}`);
    await checkFit(`workshop-confirm-${w}x${h}`, '.confirm .box');
    await api((g) => g.workshop(false));
    await settle(100);
  }
  for (const [w, h] of MODAL_SIZES) {
    await page.setViewportSize({ width: w, height: h });
    for (const tab of ['menu', 'settings', 'codex', 'map']) {
      await page.evaluate((t) => { const ev = new KeyboardEvent('keydown', { code: 'Escape' }); window.dispatchEvent(ev); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Escape' })); }, tab);
      await step(2);
      await page.evaluate((t) => { const b = [...document.querySelectorAll('.tabs button')].find((x) => x.textContent.trim() === t); b?.click(); }, tab);
      await settle(150);
      await shot('ui', `pause-${tab}-${w}x${h}`);
      await checkFit(`pause-${tab}-${w}x${h}`, '.sheet');
      await page.evaluate(() => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' })); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Escape' })); });
      await step(2);
    }
  }
  await page.setViewportSize({ width: 1280, height: 720 });
}

if (run('tutorial')) {
  await startRun('recoil', { tutorial: true });
  await step(30);
  await shot('tutorial', 'step-move');
  for (const s of ['camera', 'primary', 'pact', 'max']) {
    await api((g, st) => g.tutorialStep(st), s);
    await step(20);
    await shot('tutorial', `step-${s}`);
  }
}

if (run('drill')) {
  await startRun('recoil');
  await api((g) => { g.teleport('academy'); g.camera('third'); g.look(Math.PI / 2, -0.1); g.drill('recoil-crane'); });
  for (const f of [60, 150]) { await step(f === 60 ? 60 : 90); await shot('drill', `recoil-crane-f${f}`); }
}

if (run('perf')) {
  await startRun('recoil');
  await api((g) => { g.teleport('market'); g.camera('first'); g.look(Math.PI / 2, 0); g.loop(true); });
  await settle(1500);
  const fps = await page.evaluate(async () => { const t0 = performance.now(); let n = 0; await new Promise((r) => { const f = () => { n++; if (performance.now() - t0 > 2000) r(); else requestAnimationFrame(f); }; requestAnimationFrame(f); }); return { ...window.game.stats(), fps: Math.round(n / 2) }; });
  report.perf = fps;
  await api((g) => g.loop(false));
}

const pageErrors = await api((g) => g.errors);
report.errors.push(...pageErrors.map((e) => `window: ${e}`));
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(`\n${report.shots.length} screenshots, ${report.failures.length} fit failures, ${report.errors.length} errors -> ${join(out, 'report.json')}`);
for (const e of report.errors.slice(0, 20)) console.log('  ERROR', e);
for (const f of report.failures) console.log('  FAIL', f.check, f.name, JSON.stringify(f.detail));
await browser.close();
server?.kill();
process.exit(report.errors.length || report.failures.length ? 1 : 0);
