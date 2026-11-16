// Asserts that characters move like people: in third person the player's chest
// stays square to the body in every movement direction and the body turns so
// the feet point along the line of travel, backward moves included, and the sparring partners face the way they walk.
// Facing is read from the model itself (authored facing +Z, which the idle
// stance's toes confirm), not from any yaw the code stores.
// Then weight: a planted foot does not slide across the ground in a walk,
// a sprint, a start, a stop, a reversal, a turn, a top-down strafe or a run
// up and down a stair, where the foot on the ground is the one on a step
// rather than one swinging through it (the climb once read as walking
// backward: the feet kept to the root's level, so the planted one hung over
// the step below while the swinging one scraped through the step above); a
// sprint leaves nothing drawn on the ground behind it (third-person runs
// once left a trail of white discs); a landing sinks the hips; and a blow
// rocks the struck body away from it.
// Last, the stair as it is played: real held keys in the top-down view, up
// and down the hall stair. A foot in the air keeps clear of the floor the
// body stands on, as it does on the flat. The climb once read as a backward
// shuffle: the foot that had just pushed off was drawn down to the step
// below it and trailed straight-legged down the stair, its toe dragging up
// the treads after the body.
// Usage: npm run check:locomotion -- [url] [--url http://localhost:4173/] [--port 4173]
// Without a URL it serves dist/ itself (run `npm run build` first).
import { chromium } from 'playwright';
import { resolveTarget } from './lib/target.mjs';

const { url, stop } = await resolveTarget();
const CHEST_LIMIT = 25;
const FEET_LIMIT = 35;
// How fast, in m/s, a planted foot may cross the ground. Before the legs
// planted their feet a start slid at 3.3 and a stop at 0.8.
const SLIDE_LIMIT = 0.3;
// The lowest tenth of a foot in the air, in metres above the floor the body
// stands on, may not drop below this. On the flat it is about 0.19; the
// shuffling climb hung its trailing foot at -0.23.
const AIR_CLEARANCE = 0.05;
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
  g.teleport([-3, 0, 6]); g.step(60);
  const out = [{ name: 'model', toesAtIdle: +toes(av).dot(facing(av)).toFixed(2) }];
  for (const [name, keys] of moves) {
    g.teleport([-3, 0, 6]); g.look(0, -0.2); g.step(60);
    for (const k of keys) g.hold(k, true);
    g.step(40);
    // Forty samples five frames apart cover several strides, so the mean does
    // not depend on where in the stride the sampling starts.
    const chest = []; const feetOff = [];
    for (let i = 0; i < 40; i++) {
      g.step(5);
      chest.push(boneYaw(av, 'spine_03'));
      const v = g.game.player.velocity;
      if (Math.hypot(v.x, v.z) < 1) continue;
      const t = toes(av);
      const off = Math.abs(deg(wrap(heading(t) - heading(v))));
      feetOff.push(off);
    }
    for (const k of keys) g.hold(k, false);
    const mean = feetOff.length ? feetOff.reduce((a, b) => a + b, 0) / feetOff.length : 0;
    out.push({ name, chestMin: Math.round(Math.min(...chest)), chestMax: Math.round(Math.max(...chest)), feet: Math.round(mean) });
  }
  return out;
}, moves);

const walkers = await page.evaluate(() => {
  const g = window.game; const { deg, wrap, heading, facing } = window.loco;
  g.teleport('courtyard'); g.camera('third'); g.step(30);
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
  g.god(true); g.encounter('sparring'); g.step(10);
  // Stand across the ring so the partners have ground to cover.
  g.teleport([-8, 0, 13]); g.step(4);
  return sample(g.game.encounters.enemies.map((e) => ({ kind: `enemy:${e.def.ai}`, av: e.avatar, velocity: e.velocity })), 150);
});
// Weight: planted feet stay planted, a run leaves nothing on the ground, a
// landing sinks the hips, and a blow rocks a body away from it.
const weight = await page.evaluate((SLIDE_MOVES) => {
  const g = window.game; const game = g.game;
  const V = game.player.position.constructor;
  const av = game.avatar;
  const KEYS = ['forward', 'back', 'left', 'right', 'sprint'];
  const keysOff = () => { for (const k of KEYS) g.hold(k, false); };
  g.god(true); game.encounters.reset();
  keysOff(); g.teleport([-4, 0, 9]); g.camera('third'); g.step(90);
  const ground0 = game.player.position.y;
  const stand = {};
  for (const s of ['l', 'r']) stand[s] = { heel: av.boneWorld(`foot_${s}`, new V()).y - ground0, ball: av.boneWorld(`ball_${s}`, new V()).y - ground0 };
  // For each foot, the part on the ground (heel or ball, whichever is lower
  // against its standing height over the floor under it, within 3 cm) and
  // how fast it crosses the ground.
  const slide = (mode, keysAt, frames, from, at = [-4, 0, 9], yaw = -Math.PI / 2) => {
    keysOff(); g.teleport(at); g.camera(mode); g.look(yaw, -0.2); g.step(40);
    const prev = { l: null, r: null };
    let sum = 0, n = 0;
    for (let f = 0; f < frames; f++) {
      const keys = keysAt(f); for (const k of KEYS) g.hold(k, keys.includes(k));
      g.step(1);
      // The floor under a point, against the one under the body, read from
      // the root: on level ground exactly the root's height.
      const pos = game.player.position, root = pos.y;
      const base = Math.max(root, game.physics.standingY(pos.x, pos.z, root) ?? root);
      const floor = (p) => root + (game.physics.standingY(p.x, p.z, root) ?? base) - base;
      for (const s of ['l', 'r']) {
        const heel = av.boneWorld(`foot_${s}`, new V()), ball = av.boneWorld(`ball_${s}`, new V());
        const hh = heel.y - floor(heel) - stand[s].heel, hb = ball.y - floor(ball) - stand[s].ball;
        const kind = hb < hh ? 'ball' : 'heel', p = kind === 'ball' ? ball : heel;
        const down = Math.min(hh, hb) < 0.03 && game.player.grounded;
        if (down && prev[s] && prev[s].kind === kind && f >= from) { sum += Math.hypot(p.x - prev[s].p.x, p.z - prev[s].p.z) * 60; n++; }
        prev[s] = down ? { kind, p } : null;
      }
    }
    keysOff();
    return { mean: sum / Math.max(1, n), n };
  };
  const script = {
    walk: ['third', () => ['forward'], 150, 60],
    sprint: ['third', () => ['forward', 'sprint'], 120, 60],
    start: ['third', () => ['forward'], 30, 0],
    stop: ['third', (f) => (f < 60 ? ['forward', 'sprint'] : []), 100, 60],
    reverse: ['top', (f) => (f < 50 ? ['right'] : ['left']), 90, 50],
    'quarter turn': ['top', (f) => (f < 50 ? ['right'] : ['forward']), 130, 50],
    'top-down diagonal': ['top', () => ['forward', 'right'], 120, 50],
    'top-down backing': ['top', () => ['back'], 120, 50],
    // The hall's stair, eighteen 0.28 m steps up its west side to the deck.
    'up the stair': ['third', () => ['forward'], 100, 20, [-17, 0, -2.4], 0],
    'down the stair': ['third', () => ['forward'], 100, 20, [-17, 4.95, -12.2], Math.PI],
  };
  const slides = SLIDE_MOVES.map((name) => ({ name, ...slide(...script[name]) }));

  // Everything drawn near the ground after a sprint has settled is what was
  // there before it: footsteps leave no marks behind.
  const nearGround = () => { let c = 0; game.renderer.scene.traverse((o) => { if (o.isMesh && o.visible) { const p = o.getWorldPosition(new V()); if (p.y < 0.4) c++; } }); return c; };
  keysOff(); g.teleport([-4, 0, 9]); g.camera('third'); g.look(-Math.PI / 2, -0.3); g.step(60);
  const before = nearGround();
  g.hold('forward', true); g.hold('sprint', true); g.step(150); keysOff(); g.step(200);
  const after = nearGround();

  // A jump from standing: the hips' lowest point in the half second after touchdown, against standing.
  g.teleport([-4, 0, 9]); g.step(60);
  const pelvisAt = () => av.boneWorld('pelvis', new V()).y - game.player.position.y;
  const standing = pelvisAt();
  g.hold('jump', true); g.step(1); g.hold('jump', false);
  let landed = -1, lowest = Infinity;
  for (let i = 0; i < 90; i++) { g.step(1); if (landed < 0 && i > 5 && game.player.grounded) landed = i; if (landed >= 0 && i - landed < 30) lowest = Math.min(lowest, pelvisAt()); }

  // A blow from the player: the struck thug's chest moves away from it.
  g.teleport([4, 0, 8]); g.step(10);
  const e = game.encounters.spawn('thug', new V(4, 0, 6.5));
  e.hold(1e9); e.yaw = Math.PI; g.step(30);
  const chest = () => e.avatar.boneWorld('neck_01', new V()).sub(e.position);
  const rest = chest();
  e.locked = 0; e.hurt(10, { from: game.player.position.clone(), knock: 0 });
  let rock = 0;
  for (let i = 0; i < 20; i++) { g.step(1); rock = Math.max(rock, rest.z - chest().z); }
  game.encounters.reset(); g.god(false);
  return { slides, before, after, sink: standing - lowest, rock };
}, ['walk', 'sprint', 'start', 'stop', 'reverse', 'quarter turn', 'top-down diagonal', 'top-down backing', 'up the stair', 'down the stair']);
// The stair as played: the top-down view, W and S held on the keyboard.
await page.evaluate(() => { const g = window.game; g.god(true); g.game.encounters.reset(); for (const k of ['forward', 'back', 'left', 'right', 'sprint']) g.hold(k, false); g.camera('top'); });
const airborne = [];
for (const [name, at, key] of [['on the flat', [-4, 0, 9], 'KeyW'], ['up the stair', [-17, 0, -1.2], 'KeyW'], ['down the stair', [-17, 4.95, -12.4], 'KeyS']]) {
  await page.evaluate((at) => { window.game.teleport(at); window.game.step(60); }, at);
  await page.keyboard.down(key);
  const low = await page.evaluate(() => {
    const g = window.game, game = g.game, av = game.avatar, V = game.player.position.constructor;
    g.step(30);
    const lows = [];
    for (let f = 0; f < 80; f++) {
      g.step(1);
      const pos = game.player.position, root = pos.y;
      const base = Math.max(root, game.physics.standingY(pos.x, pos.z, root) ?? root);
      av.legs.forEach((leg, i) => {
        if (leg.planted) return;
        const s = i ? 'r' : 'l';
        lows.push(Math.min(av.boneWorld(`foot_${s}`, new V()).y, av.boneWorld(`ball_${s}`, new V()).y) - base);
      });
    }
    lows.sort((a, b) => a - b);
    return lows[Math.floor(lows.length * 0.1)];
  });
  await page.keyboard.up(key);
  airborne.push({ name, low });
}
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
report(walkers.some((w) => w.kind.startsWith('enemy')), 'sampled enemies while they walked');
for (const s of weight.slides) report(s.n >= 5 && s.mean <= SLIDE_LIMIT, `${s.name}: a planted foot stays put (slides ${s.mean.toFixed(2)} m/s over ${s.n} planted frames, limit ${SLIDE_LIMIT})`);
report(weight.after <= weight.before, `a sprint leaves nothing on the ground (${weight.before} meshes near the ground before, ${weight.after} after)`);
report(weight.sink >= 0.05, `a landing sinks the hips (${(weight.sink * 100).toFixed(1)} cm)`);
for (const a of airborne) report(a.low >= AIR_CLEARANCE, `${a.name} (held keys, top-down): a foot in the air keeps clear of the body's floor (lowest tenth ${(a.low * 100).toFixed(0)} cm, at least ${AIR_CLEARANCE * 100})`);
report(weight.rock >= 0.09, `a blow rocks the struck chest away from it, measured at the neck (${(weight.rock * 100).toFixed(1)} cm)`);
report(pageErrors.length === 0 && debugErrors.length === 0, `no page errors (${[...pageErrors, ...debugErrors].join('; ') || 'none'})`);
if (failed) { console.error(`${failed} locomotion checks failed`); process.exit(1); }
