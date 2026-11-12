// Asserts that characters move like people: in third person the player's chest
// stays square to the body in every movement direction and the feet point
// along the line of travel, and pedestrians and thugs face the way they walk.
// Facing is read from the model itself (authored facing +Z, which the idle
// stance's toes confirm), not from any yaw the code stores.
// Usage: npm run check:locomotion -- [url] [--url http://localhost:4173/] [--port 4173]
// Without a URL it serves dist/ itself (run `npm run build` first).
import { chromium } from 'playwright';
import { resolveTarget } from './lib/target.mjs';

const { url, stop } = await resolveTarget();
const CHEST_LIMIT = 25;
const FEET_LIMIT = 35;
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
await page.goto(`${url}?debug`);
await page.waitForFunction(() => window.game?.game?.ready, null, { timeout: 120000 });

await page.evaluate(() => {
  const g = window.game;
  const THREE = { Q: g.game.avatar.root.quaternion.constructor, V: g.game.avatar.root.position.constructor };
  const deg = (r) => (r * 180) / Math.PI;
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const heading = (v) => Math.atan2(v.x, v.z);
  const bindCache = new WeakMap();
  // Rest orientation of every bone in model space, from the skin's inverse bind matrices.
  const bind = (av) => {
    if (bindCache.has(av)) return bindCache.get(av);
    let skel = null;
    av.model.traverse((o) => { if (o.isSkinnedMesh && !skel) skel = o.skeleton; });
    const m = new Map();
    skel.bones.forEach((b, i) => { const q = new THREE.Q(); skel.boneInverses[i].clone().invert().decompose(new THREE.V(), q, new THREE.V()); m.set(b.name, q); });
    bindCache.set(av, m);
    return m;
  };
  // Yaw of a bone away from its rest pose, about the vertical, relative to the whole model.
  const boneYaw = (av, name) => {
    const body = av.model.getWorldQuaternion(new THREE.Q()).invert();
    const q = body.multiply(av.bones.get(name).getWorldQuaternion(new THREE.Q())).multiply(bind(av).get(name).clone().invert());
    return deg(wrap(2 * Math.atan2(q.y, q.w)));
  };
  const toes = (av) => {
    const d = new THREE.V();
    for (const s of ['l', 'r']) d.add(av.boneWorld(`ball_${s}`, new THREE.V())).sub(av.boneWorld(`foot_${s}`, new THREE.V()));
    return d.setY(0).normalize();
  };
  const facing = (av) => new THREE.V(0, 0, 1).applyQuaternion(av.model.getWorldQuaternion(new THREE.Q())).setY(0).normalize();
  window.loco = { deg, wrap, heading, boneYaw, toes, facing };
});

const moves = [
  ['idle', []], ['forward', ['forward']], ['back', ['back']], ['right', ['right']], ['left', ['left']],
  ['forward-right', ['forward', 'right']], ['forward-left', ['forward', 'left']], ['back-right', ['back', 'right']], ['back-left', ['back', 'left']],
];
const torso = await page.evaluate((moves) => {
  const g = window.game; const { deg, wrap, heading, boneYaw, toes, facing } = window.loco;
  g.technique('recoil'); g.game.startRun({ skipTutorial: true }); g.loop(false); g.camera('third');
  const av = g.game.avatar;
  g.teleport('academy'); g.step(60);
  const out = [{ name: 'model', toesAtIdle: +toes(av).dot(facing(av)).toFixed(2) }];
  for (const [name, keys] of moves) {
    g.teleport('academy'); g.look(0, -0.2); g.step(60);
    for (const k of keys) g.hold(k, true);
    g.step(40);
    const chest = []; const feetOff = [];
    for (let i = 0; i < 20; i++) {
      g.step(7);
      chest.push(boneYaw(av, 'spine_03'));
      const v = g.game.player.velocity;
      if (Math.hypot(v.x, v.z) < 1) continue;
      const t = toes(av);
      const off = Math.abs(deg(wrap(heading(t) - heading(v))));
      feetOff.push(name.startsWith('back') ? 180 - off : off);
    }
    for (const k of keys) g.hold(k, false);
    const mean = feetOff.length ? feetOff.reduce((a, b) => a + b, 0) / feetOff.length : 0;
    out.push({ name, chestMin: Math.round(Math.min(...chest)), chestMax: Math.round(Math.max(...chest)), feet: Math.round(mean) });
  }
  return out;
}, moves);

const walkers = await page.evaluate(() => {
  const g = window.game; const { deg, wrap, heading, facing } = window.loco;
  g.teleport([0, 0.2, 0]); g.camera('third'); g.step(30);
  // Velocity comes from the entity when it has one (an enemy can be pushed by
  // others while it runs), else from its motion over the window.
  const sample = (entries, frames) => {
    const res = [];
    const hist = entries.map((e) => ({ last: e.av.root.position.clone(), vels: [] }));
    for (let f = 0; f < frames; f += 6) {
      g.step(6);
      entries.forEach((e, i) => {
        const h = hist[i]; const p = e.av.root.position.clone();
        const v = e.velocity ? e.velocity.clone() : p.clone().sub(h.last).multiplyScalar(10);
        h.last = p; v.setY(0); h.vels.push(v);
        const old = h.vels[h.vels.length - 6];
        if (!old || v.length() < 0.5 || old.length() < 0.5) return;
        if (Math.abs(deg(wrap(heading(v) - heading(old)))) > 10) return;
        res.push({ kind: e.kind, dot: +facing(e.av).dot(v.normalize()).toFixed(2) });
      });
    }
    return res;
  };
  const peds = sample(g.game.pedestrians.walkers.map((w) => ({ kind: 'pedestrian', av: w.avatar })), 600);
  g.god(true); g.encounter('alley-thugs'); g.step(10);
  const thugs = sample(g.game.encounters.enemies.map((e) => ({ kind: `enemy:${e.def.ai}`, av: e.avatar, velocity: e.velocity })), 150);
  return [...peds, ...thugs];
});
const debugErrors = await page.evaluate(() => window.game.errors);
await browser.close();
stop();

let failed = 0;
const report = (ok, line) => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${line}`); };
const [model, ...moved] = torso;
report(model.toesAtIdle > 0.8, `model faces +Z: idle toes along it (dot ${model.toesAtIdle})`);
for (const r of moved) {
  report(Math.max(-r.chestMin, r.chestMax) <= CHEST_LIMIT, `${r.name}: chest yaw relative to the body within ±${CHEST_LIMIT}° (saw ${r.chestMin}..${r.chestMax}°)`);
  if (r.name !== 'idle') report(r.feet <= FEET_LIMIT, `${r.name}: feet point along the line of travel within ${FEET_LIMIT}° (mean ${r.feet}°)`);
}
for (const kind of [...new Set(walkers.map((w) => w.kind))]) {
  const s = walkers.filter((w) => w.kind === kind);
  const backward = s.filter((w) => w.dot <= 0).length;
  report(backward === 0, `${kind}: faces its direction of travel in ${s.length - backward}/${s.length} samples (min facing·velocity ${Math.min(...s.map((w) => w.dot))})`);
}
report(walkers.some((w) => w.kind === 'pedestrian') && walkers.some((w) => w.kind.startsWith('enemy')), 'sampled both pedestrians and enemies while they walked');
report(pageErrors.length === 0 && debugErrors.length === 0, `no page errors (${[...pageErrors, ...debugErrors].join('; ') || 'none'})`);
if (failed) { console.error(`${failed} locomotion checks failed`); process.exit(1); }
