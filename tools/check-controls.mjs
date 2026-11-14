// Asserts that the movement keys move the player along the camera's axes in
// every camera view: W along the camera's forward on the ground, S against
// it, A and D along its left and right. In the top-down view the camera
// looks north whatever the player faces, so W is up the screen even while
// the body aims elsewhere; in the other views the axes turn with the mouse.
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
  const KEYS = [['forward', 'fwd', 1], ['back', 'fwd', -1], ['right', 'right', 1], ['left', 'right', -1]];
  for (const mode of ['top', 'third', 'first']) {
    for (const yaw of [0, Math.PI / 2, 2.4]) {
      for (const [key, axis, sign] of KEYS) {
        g.teleport('courtyard'); g.camera(mode); g.look(yaw, 0); g.step(8);
        const p0 = g.game.player.position.clone();
        g.hold(key, true); g.step(30); g.hold(key, false); g.step(2);
        const d = g.game.player.position.clone().sub(p0);
        const cam = g.game.renderer.camera;
        const V = cam.position.constructor;
        const right = new V(1, 0, 0).applyQuaternion(cam.quaternion).setY(0).normalize();
        const fwd = new V(0, 0, -1).applyQuaternion(cam.quaternion).setY(0).normalize();
        const a = axis === 'fwd' ? fwd : right;
        const along = d.x * a.x + d.z * a.z;
        const across = Math.hypot(d.x, d.z) - Math.abs(along);
        out.push({ mode, yaw: +yaw.toFixed(2), key, axis, along: +along.toFixed(2), across: +across.toFixed(2), ok: along * sign > 1 && across < 0.4 });
      }
    }
    // The body faces the cursor in the top-down view, and the camera stays north-up while it does.
    if (mode === 'top') {
      g.teleport('courtyard'); g.step(5);
      const camYawBefore = Math.atan2(-g.game.renderer.camera.getWorldDirection(new g.game.player.position.constructor()).x, -g.game.renderer.camera.getWorldDirection(new g.game.player.position.constructor()).z);
      g.game.input.mouse.x = 0.6; g.game.input.mouse.y = -0.1; g.step(20);
      const bodyYaw = g.game.cam.yaw;
      const camYawAfter = Math.atan2(-g.game.renderer.camera.getWorldDirection(new g.game.player.position.constructor()).x, -g.game.renderer.camera.getWorldDirection(new g.game.player.position.constructor()).z);
      g.game.input.mouse.x = 0; g.game.input.mouse.y = 0;
      // Cursor right of the player: the body turns toward +x, which is yaw near -pi/2.
      out.push({ mode, yaw: 0, key: 'cursor', axis: 'aim', along: +bodyYaw.toFixed(2), across: +Math.abs(camYawAfter - camYawBefore).toFixed(3), ok: Math.sin(-bodyYaw) > 0.7 && Math.abs(camYawAfter - camYawBefore) < 0.01 });
    }
  }
  // A Technique fires at the cursor in the top-down view: Shift's translate
  // lands the player toward the point under the cursor, east of the start.
  g.technique('shift'); g.teleport('courtyard'); g.camera('top'); g.step(10);
  const s0 = g.game.player.position.clone();
  g.game.input.mouse.x = 0.55; g.game.input.mouse.y = -0.05; g.step(10);
  const aim = g.game.cam.aimPoint ? g.game.cam.aimPoint.clone() : null;
  g.cast('secondary'); g.step(60);
  const moved = g.game.player.position.clone().sub(s0);
  g.game.input.mouse.x = 0; g.game.input.mouse.y = 0;
  const towardAim = aim ? (moved.x * (aim.x - s0.x) + moved.z * (aim.z - s0.z)) / Math.max(0.01, Math.hypot(aim.x - s0.x, aim.z - s0.z)) : 0;
  out.push({ mode: 'top', yaw: 0, key: 'shift', axis: 'cursor', along: +towardAim.toFixed(2), across: +(Math.hypot(moved.x, moved.z) - Math.abs(towardAim)).toFixed(2), ok: towardAim > 3 && moved.x > 2 });
  g.technique('recoil');
  return out;
});
await browser.close();
stop();
const bad = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.mode.padEnd(5)} yaw=${r.yaw} ${r.key.padEnd(7)}: ${r.along} m along ${r.key === 'shift' ? 'the line to the cursor (Shift translate)' : `camera ${r.axis}`}${r.key === 'cursor' ? ` (body yaw), camera turned ${r.across}` : `, ${r.across} m across`}`);
if (bad.length) { console.error(`${bad.length} movement checks failed`); process.exit(1); }
