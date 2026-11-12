// Asserts that A/D strafe along the camera's left/right in both camera modes.
// Usage: npm run check:controls -- [url] [--url http://localhost:4173/] [--port 4173]
// Without a URL it serves dist/ itself (run `npm run build` first).
import { chromium } from 'playwright';
import { resolveTarget } from './lib/target.mjs';

const { url, stop } = await resolveTarget();
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
await page.goto(`${url}?debug`);
await page.waitForFunction(() => window.game?.game?.ready, null, { timeout: 120000 });
const results = await page.evaluate(() => {
  const g = window.game;
  g.technique('recoil'); g.game.startRun({ skipTutorial: true }); g.loop(false); g.step(10);
  const out = [];
  for (const mode of ['first', 'third']) {
    for (const yaw of [0, Math.PI / 2, 2.4]) {
      for (const [key, sign] of [['left', -1], ['right', 1]]) {
        g.teleport('market'); g.camera(mode); g.look(yaw, 0); g.step(5);
        const p0 = g.game.player.position.clone();
        g.hold(key, true); g.step(30); g.hold(key, false); g.step(2);
        const d = g.game.player.position.clone().sub(p0);
        const cam = g.game.renderer.camera;
        const right = new cam.position.constructor(1, 0, 0).applyQuaternion(cam.quaternion).setY(0).normalize();
        const along = d.x * right.x + d.z * right.z;
        out.push({ mode, yaw: +yaw.toFixed(2), key, along: +along.toFixed(2), ok: along * sign > 1 });
      }
    }
  }
  return out;
});
await browser.close();
stop();
const bad = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.mode} yaw=${r.yaw} ${r.key}: ${r.along} m along camera-right`);
if (bad.length) { console.error(`${bad.length} strafe checks failed`); process.exit(1); }
