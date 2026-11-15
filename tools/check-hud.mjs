#!/usr/bin/env node
// Lays the HUD and the sheets out at the sizes people play at and fails when
// anything overlaps, leaves the window, or is cut off sideways. Each scene
// sets up one moment of play through the `?debug` hooks (the courtyard with
// its opening message, a tutorial step, a drill before and during its run,
// a fight with a boss bar, a Wager's open call, the rooftop trial, the Architect's plaque with its prompt) or opens
// a sheet (each pause tab, the Workshop), then measures the regions the HUD
// keeps apart: the captions column, the compass, the boss bar, the prompt,
// the vitals, the Ability cards and a Wager's open call. In the Workshop's
// Wager panel, tuned, every slider row keeps its parts apart and whole.
// A screenshot of every scene is saved.
// Usage: node tools/check-hud.mjs [url] [--out captures/hud] [--port 4173] [--sizes 1280x720,390x844]
// Without a url it serves dist/ itself (run `npm run build` first).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveTarget } from './lib/target.mjs';

const { url, args, stop } = await resolveTarget();
const out = args.out ?? 'captures/hud';
mkdirSync(out, { recursive: true });
const SIZES = (args.sizes ?? '1280x720,1920x1080,390x844,844x390').split(',').map((s) => s.split('x').map(Number));

const wagerCall = `const G = g.game, s = G.book.inscribed.value.find((p) => p.name === "Shockline");
  G.techniques.wagers.declare({ ...s, id: "hud-wager", name: "Shockline", clauses: [{ kind: "wager", declare: "untouched", at: 20, pays: { charge: 2, refill: 1, aura: 1, mend: 1 }, risks: { seal: 12, blood: 0.4, drain: 0.75, slow: 12, aura: 1, dark: 90 } }] }, {});
  g.step(2);`;
const pause = 'g.hold("pause", true); g.step(1); g.hold("pause", false); g.step(2);';
const press = (a) => `g.hold("${a}", true); g.step(1); g.hold("${a}", false); g.step(2);`;
const fresh = 'g.game.startRun({ skipTutorial: true }); g.camera("top"); g.step(5);';
// Each scene starts from a fresh run in explore. `sheet` scenes are measured as sheets.
const SCENES = [
  { name: 'yard', js: `${fresh} g.teleport("courtyard"); g.step(20);` },
  { name: 'tutorial', js: 'g.game.startRun(); g.step(5); g.tutorialStep("camera"); g.step(20);' },
  { name: 'tutorial-pact', js: 'g.game.startRun(); g.step(5); g.tutorialStep("pact"); g.step(20);' },
  { name: 'tutorial-clash', js: 'g.game.startRun(); g.step(5); g.tutorialStep("clash"); g.teleport([6, 0, 3.2]); g.step(20);' },
  { name: 'drill-wait', js: `${fresh} g.teleport([6, 0, 3.2]); g.step(5); g.game.drills.begin("field-reading", false); g.step(20);` },
  { name: 'drill-run', js: `${fresh} g.teleport([6, 0, 3.2]); g.step(5); g.drill("field-reading"); g.step(120);` },
  { name: 'stone-prompt', js: `${fresh} g.teleport([6, 0, 3.2]); g.step(20);` },
  { name: 'fight', js: `${fresh} g.encounter("ancient"); g.step(30);` },
  // A Wager's open call with every part tuned: the longest slip there is.
  { name: 'wager-call', js: `${fresh} g.encounter("ancient"); g.step(30); ${wagerCall}` },
  { name: 'rooftop', js: `${fresh} g.rooftop.begin(); g.step(90);` },
  { name: 'architect', js: `${fresh} g.teleport([-10, 0.3, -15]); g.step(10); ${press('interact')} g.step(10);` },
  { name: 'pause', sheet: true, js: `${fresh} ${pause}` },
  { name: 'settings', sheet: true, js: `${fresh} ${pause} window.__tab("settings");` },
  { name: 'controls', sheet: true, js: `${fresh} ${pause} window.__tab("controls");` },
  { name: 'codex', sheet: true, js: `${fresh} ${pause} window.__tab("codex");` },
  { name: 'map', sheet: true, js: `${fresh} ${press('map')}` },
  { name: 'workshop', sheet: true, js: `${fresh} g.workshop(true); g.step(2);` },
  // The Wager panel, tuned: every slider row keeps its name, its slider and its reading apart.
  { name: 'workshop-wager', sheet: true, wager: true, js: `${fresh} g.workshop(true); g.step(2);` },
];

// The HUD's regions, which must not touch one another or leave the window.
const REGIONS = ['.captions', '.top-center .compass', '.boss', '.prompt', '.vitals', '.abilities', '.rt-strip', '.wager-call'];

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
await page.goto(`${url}?debug`);
await page.waitForFunction(() => window.game?.game?.ready, null, { timeout: 180000 });
await page.evaluate(() => {
  const g = window.game;
  g.loop(false); g.technique('recoil'); g.god(true);
  // Pause tabs are buttons in the sheet; this presses the one named.
  window.__tab = (t) => [...document.querySelectorAll('.tabs button')].find((b) => b.textContent.trim() === t)?.click();
});

const failures = [];
const check = (ok, what) => { if (!ok) failures.push(what); if (!ok || args.verbose) console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); };

for (const [w, h] of SIZES) {
  await page.setViewportSize({ width: w, height: h });
  console.log(`${w}x${h}`);
  for (const scene of SCENES) {
    await page.evaluate((code) => {
      const g = window.game;
      g.game.closeWorkshop?.();
      if (g.state() === 'paused') { g.hold('pause', true); g.step(1); g.hold('pause', false); g.step(1); }
      g.game.drills.abandon(); g.game.rooftop.abandon(); g.game.encounters.reset?.(); g.game.techniques.wagers.clear();
      new Function('g', code)(g);
    }, scene.js);
    if (scene.wager) {
      await page.locator('.ws-book .bk.new').click();
      await page.locator('.chip', { hasText: 'a wager, to bet on each cast' }).click();
      await page.locator('.chip', { hasText: 'nothing touches you for' }).click();
      for (const [name, keys] of [['How long', 4], ['Resource', 2], ['Aura', 1], ['Blood', 5], ['Dark', 5]]) {
        await page.locator('.ws-panel').getByRole('slider', { name, exact: true }).first().focus();
        for (let i = 0; i < keys; i++) await page.keyboard.press('ArrowRight');
      }
      await page.locator('.ws-panel .wg-read').scrollIntoViewIfNeeded();
    }
    // Let the entrances finish: captions wipe in over a third of a second.
    await page.waitForTimeout(700);
    const tag = `${w}x${h} ${scene.name}`;
    const report = await page.evaluate(({ regions, sheet, wager }) => {
      const W = innerWidth, H = innerHeight;
      const shown = (el) => { const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0.05 && el.getClientRects().length > 0; };
      const rect = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
      const outside = (r) => r.l < -0.5 || r.t < -0.5 || r.r > W + 0.5 || r.b > H + 0.5;
      const problems = [];
      if (sheet) {
        const s = document.querySelector('.sheet');
        if (!s) return { problems: ['no sheet open'] };
        if (outside(rect(s))) problems.push(`sheet leaves the window (${JSON.stringify(rect(s))})`);
        for (const part of s.querySelectorAll(':scope > header, :scope > .body, :scope > footer, .tabs')) {
          if (part.scrollWidth > part.clientWidth + 1) problems.push(`${part.className || part.tagName.toLowerCase()} is cut off sideways (${part.scrollWidth} > ${part.clientWidth})`);
        }
        if (wager) {
          const rows = [...s.querySelectorAll('.ws-panel .wg-tune')];
          if (rows.length < 12) problems.push(`the Wager panel shows ${rows.length} sliders`);
          for (const row of rows) {
            const parts = [...row.children].map((el) => ({ el, r: rect(el) }));
            const name = row.querySelector('.l')?.textContent;
            for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
              const a = parts[i].r, b = parts[j].r;
              if (Math.min(a.r, b.r) - Math.max(a.l, b.l) > 1 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 1) problems.push(`${name}: ${parts[i].el.className || parts[i].el.tagName} overlaps ${parts[j].el.className || parts[j].el.tagName}`);
            }
            const slider = row.querySelector('input');
            if (slider.getBoundingClientRect().width < 80) problems.push(`${name}: the slider is ${Math.round(slider.getBoundingClientRect().width)} px wide`);
            for (const t of row.querySelectorAll('.l, .v')) if (t.scrollWidth > t.clientWidth + 1) problems.push(`${name}: "${t.textContent}" is cut off`);
            if (rect(row).r > rect(s).r + 0.5) problems.push(`${name}: the row leaves the sheet`);
          }
        }
        return { problems };
      }
      const found = [];
      for (const sel of regions) for (const el of document.querySelectorAll(`#ui ${sel}`)) if (shown(el)) found.push({ sel, r: rect(el) });
      for (const f of found) if (outside(f.r)) problems.push(`${f.sel} leaves the window (${Math.round(f.r.l)},${Math.round(f.r.t)} to ${Math.round(f.r.r)},${Math.round(f.r.b)})`);
      for (let i = 0; i < found.length; i++) for (let j = i + 1; j < found.length; j++) {
        const a = found[i].r, b = found[j].r;
        const ox = Math.min(a.r, b.r) - Math.max(a.l, b.l), oy = Math.min(a.b, b.b) - Math.max(a.t, b.t);
        if (ox > 1 && oy > 1) problems.push(`${found[i].sel} overlaps ${found[j].sel} by ${Math.round(ox)}x${Math.round(oy)}`);
      }
      // Each line of text in the captions and cards stays whole.
      for (const el of document.querySelectorAll('.hud .cap, .hud .toast, .hud .prompt')) {
        if (shown(el) && el.scrollWidth > el.clientWidth + 1) problems.push(`${el.className} is cut off sideways`);
      }
      return { problems, regions: found.map((f) => f.sel) };
    }, { regions: REGIONS, sheet: !!scene.sheet, wager: !!scene.wager });
    check(report.problems.length === 0, `${tag}: ${report.problems.length ? report.problems.join('; ') : `clear (${scene.sheet ? 'sheet' : report.regions.join(', ')})`}`);
    // Animations run: a toast's exit is timed to its life, and disabling it would hide the toast.
    await page.screenshot({ path: join(out, `${w}x${h}-${scene.name}.png`) });
  }
}

check(errors.length === 0, `zero page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
await browser.close();
stop();
if (failures.length) { console.error(`\n${failures.length} HUD layout checks failed`); process.exit(1); }
console.log(`\nHUD layout ok at ${SIZES.map((s) => s.join('x')).join(', ')}; screenshots in ${out}`);
