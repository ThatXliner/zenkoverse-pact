#!/usr/bin/env node
// Measures how well the third-person body reads its casts (issue #46). For
// every Technique, from the top-down camera and over the shoulder, it plays
// each Ability's cast at the full and the shortened sign and the full hand
// sign, steps the game frame by frame, and reads the hand bones against the
// body: how far each hand travels from where it was before the cast, how far
// it stands off the torso, both in metres and on screen as a share of the
// body's drawn height, and the pose at the impact frame, so two moves of one
// Technique can be told apart. It saves a strip of frames per move, cropped
// to the body, and fails a move whose hands stay near the torso or barely
// move on screen. It ends with a cast while running, to prove the legs keep
// their stride under the cast.
// Usage: node tools/check-casts.mjs [url] [--out captures/casts] [--only recoil,shift] [--no-shots] [--report-only]
// Without a URL it serves dist/ itself (run `npm run build` first).
import { chromium } from 'playwright';
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveTarget } from './lib/target.mjs';

const { url, args, stop } = await resolveTarget();
const out = args.out ?? 'captures/casts';
const shots = args['no-shots'] !== 'true';
const reportOnly = args['report-only'] === 'true';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|WebGL|GPU stall|Automatic fallback/.test(m.text())) errors.push(`console: ${m.text()}`); });
const failures = [];
const check = (ok, what) => { if (!ok) failures.push(what); console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const api = (fn, ...a) => page.evaluate(([f, ...rest]) => { const g = window.game; return new Function('g', 'a', `return (${f})(g, ...a)`)(g, rest); }, [fn.toString(), ...a]);
const step = (n) => api((g, n) => g.step(n, 1 / 60), n);

await page.goto(`${url}?debug`);
await page.waitForFunction(() => window.game?.game?.ready, null, { timeout: 180000 });
await api((g) => g.loop(false));
const TECHS = (await api((g) => g.cutscenes().ids)).filter((id) => id.startsWith('max-')).map((id) => id.slice(4)).filter((t) => !args.only || args.only.split(',').includes(t));

// The body as the camera sees it: both hands, the torso line from the pelvis
// to the neck, and the head, in world metres and in screen pixels. Screen
// positions are read through the view held before the move, carried along
// with the body: the follow camera every other screen watches this body
// through, whatever shot the player's own camera cuts to.
const holdView = () => api((g) => { const game = g.game; window.__view = { cam: game.renderer.camera.clone(), root: game.avatar.root.position.clone() }; });
const sample = () => api((g) => {
  const game = g.game, av = game.avatar, view = window.__view;
  const cam = view.cam.clone();
  cam.position.add(av.root.position).sub(view.root);
  cam.updateMatrixWorld(true);
  const V = cam.position.constructor;
  const w = (n) => av.boneWorld(n, new V());
  const scr = (p) => { const q = p.clone().project(cam); return [(q.x * 0.5 + 0.5) * innerWidth, (-q.y * 0.5 + 0.5) * innerHeight]; };
  const pts = { hand_l: w('hand_l'), hand_r: w('hand_r'), pelvis: w('pelvis'), neck: w('neck_01'), head: w('Head'), foot_l: w('foot_l'), foot_r: w('foot_r'), root: av.root.position.clone() };
  const feet = pts.root.clone();
  const top = pts.head.clone(); top.y += 0.15;
  const world = Object.fromEntries(Object.entries(pts).map(([k, v]) => [k, [v.x, v.y, v.z]]));
  const screen = Object.fromEntries(Object.entries(pts).map(([k, v]) => [k, scr(v)]));
  const a = scr(feet), b = scr(top);
  // The body's local frame: hands as right, up and forward of the pelvis.
  const yaw = av.root.rotation.y, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  const local = (p) => { const dx = p.x - pts.pelvis.x, dz = p.z - pts.pelvis.z; return [dx * -fz + dz * fx, p.y - pts.pelvis.y, dx * fx + dz * fz]; };
  return { world, screen, bodyPx: Math.hypot(a[0] - b[0], a[1] - b[1]), center: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], local: { l: local(pts.hand_l), r: local(pts.hand_r) } };
});

const sub = (a, b) => a.map((x, i) => x - b[i]);
const len = (a) => Math.hypot(...a);
// Distance from p to the segment a-b, in any dimension.
const offSegment = (p, a, b) => {
  const ab = sub(b, a), ap = sub(p, a);
  const t = Math.max(0, Math.min(1, ap.reduce((s, x, i) => s + x * ab[i], 0) / ab.reduce((s, x) => s + x * x, 0)));
  return len(sub(p, a.map((x, i) => x + ab[i] * t)));
};
// How one frame reads against the rest frame before the cast.
const measure = (s, rest) => {
  const r = {};
  for (const h of ['hand_l', 'hand_r']) {
    r[h] = {
      travel: len(sub(s.world[h], rest.world[h])),
      torso: offSegment(s.world[h], s.world.pelvis, s.world.neck),
      travelPx: len(sub(s.screen[h], rest.screen[h])) / s.bodyPx,
      torsoPx: offSegment(s.screen[h], s.screen.pelvis, s.screen.neck) / s.bodyPx,
    };
  }
  const best = (k) => Math.max(r.hand_l[k], r.hand_r[k]);
  return { travel: best('travel'), torso: best('torso'), travelPx: best('travelPx'), torsoPx: best('torsoPx') };
};

const setActivation = (v) => api((g, v) => { const m = g.game.mastery, t = g.game.techniqueId; m.stats.value = { ...m.stats.value, [t]: { ...m.stats.value[t], activation: v } }; }, v);
const crop = async (file, center, bodyPx) => {
  const size = Math.round(Math.min(700, Math.max(260, bodyPx * 1.9)));
  const left = Math.round(Math.min(1280 - size, Math.max(0, center[0] - size / 2)));
  const top = Math.round(Math.min(720 - size, Math.max(0, center[1] - size / 2)));
  const buf = await page.screenshot({ clip: { x: left, y: top, width: size, height: size }, animations: 'disabled' });
  return sharp(buf).resize(300, 300).png().toBuffer().then((b) => { if (file) writeFileSync(file, b); return b; });
};
const strip = async (file, tiles) => {
  const composite = tiles.map((b, i) => ({ input: b, left: i * 300, top: 0 }));
  await sharp({ create: { width: 300 * tiles.length, height: 300, channels: 3, background: '#000' } }).composite(composite).png().toFile(file);
};

// One move: the frames it runs, the beats to keep, and how to start it.
const MOVES = [
  { id: 'primary-full', activation: 0, start: (g) => g.cast('primary') },
  { id: 'primary-short', activation: 0.5, start: (g) => g.cast('primary') },
  { id: 'secondary-full', activation: 0, start: (g) => g.cast('secondary') },
  { id: 'secondary-short', activation: 0.5, start: (g) => g.cast('secondary') },
  // The sign as the room sees it, from the follow camera, and as the player
  // sees their own: the front close-up the sign cuts to (no bar on that one).
  { id: 'sign', activation: 0, start: (g) => { const ok = g.game.techniques.beginSign(); g.game.cam.shot = null; return ok; } },
  { id: 'sign-shot', activation: 0, own: true, start: (g) => g.game.techniques.beginSign() },
];
const CAMERAS = [['top', 0], ['third', -0.12]];
const report = { url, techniques: {}, failures, errors };
// A cast reads when, at its peak, a hand stands well off the torso and has
// travelled a clear distance on screen from where it was: a share of the
// body's drawn height, so the bar is the same at any zoom.
const BAR = { travel: 0.3, travelPx: 0.16, torsoPx: 0.14 };

for (const tech of TECHS) {
  report.techniques[tech] = {};
  for (const [camera, pitch] of CAMERAS) {
    console.log(`${tech}, ${camera}`);
    await api((g, t) => { g.technique(t); g.game.startRun({ skipTutorial: true }); g.loop(false); }, tech);
    await step(12);
    await api((g, c, p) => { g.teleport('courtyard'); g.camera(c); g.look(0, p); g.god(true); }, camera, pitch);
    await step(40);
    for (const move of MOVES) {
      await setActivation(move.activation);
      await api((g) => { const t = g.game.techniques; t.resource = t.def.resource.max; t.charge = 0; for (const k of Object.keys(t.cooldown)) t.cooldown[k] = 0; });
      await step(50);
      await holdView();
      const rest = await sample();
      const info = await api((g, src) => {
        const ok = new Function('g', `return (${src})(g)`)(g);
        const t = g.game.techniques, c = t.cast_;
        return { ok: ok !== false, duration: c ? c.duration : t.def.sign.duration, impactAt: c ? c.impactAt : t.def.sign.impactAt, variant: c?.ctx.variant ?? 'sign' };
      }, move.start.toString());
      const frames = Math.ceil((info.duration + 0.35) * 60);
      const impact = Math.round(info.impactAt * 60);
      const keep = new Set([Math.max(1, Math.round(impact * 0.45)), impact, Math.min(frames - 1, impact + Math.round(0.25 * 60))]);
      if (move.id.startsWith('sign')) { keep.clear(); for (const t of [0.2, 0.55, 0.9, 1.25, 1.5]) keep.add(Math.round(t * 60)); }
      let peak = { travel: 0, torso: 0, travelPx: 0, torsoPx: 0 }, atImpact = null;
      const tiles = [];
      for (let f = 1; f <= frames; f++) {
        await step(1);
        const s = await sample();
        const m = measure(s, rest);
        for (const k of Object.keys(peak)) peak[k] = Math.max(peak[k], m[k]);
        if (f === impact || (move.id === 'sign' && f === Math.round(0.55 * 60))) atImpact = s.local;
        if (keep.has(f) && shots && !reportOnly) tiles.push(move.own ? await crop(null, [640, 360], 720) : await crop(null, s.center, s.bodyPx));
      }
      if (tiles.length) await strip(join(out, `${tech}-${camera}-${move.id}.png`), tiles);
      // Let a held cast go and a primed sign lapse before the next move.
      await api((g) => { g.game.hands.stop(); g.game.avatar.release(); const t = g.game.techniques; t.cast_ = null; t.sign = { kind: 'idle' }; });
      await step(40);
      report.techniques[tech][`${camera}/${move.id}`] = { variant: info.variant, peak, impactPose: atImpact };
      const p = peak;
      const line = `${camera} ${move.id} (${info.variant}): hand travel ${p.travel.toFixed(2)} m, off torso ${p.torso.toFixed(2)} m, on screen travel ${(p.travelPx * 100).toFixed(0)}% and off torso ${(p.torsoPx * 100).toFixed(0)}% of body height`;
      if (reportOnly || move.own) console.log(`  ${line}`);
      else check(info.ok && p.travel >= BAR.travel && p.travelPx >= BAR.travelPx && p.torsoPx >= BAR.torsoPx, line);
    }
  }
  // Moves of one Technique must not share a pose: the hands at each impact,
  // in the body's own frame, stand apart from every other move's.
  const poses = Object.entries(report.techniques[tech]).filter(([k]) => k.startsWith('third/') && !k.endsWith('-short') && !k.endsWith('-shot')).map(([k, v]) => [k.slice(6), v.impactPose]);
  for (let i = 0; i < poses.length; i++) for (let j = i + 1; j < poses.length; j++) {
    const [a, pa] = poses[i], [b, pb] = poses[j];
    if (!pa || !pb) continue;
    const d = Math.max(len(sub(pa.l, pb.l)), len(sub(pa.r, pb.r)));
    const line = `${tech}: ${a} and ${b} differ by ${d.toFixed(2)} m at impact`;
    if (reportOnly) console.log(`  ${line}`); else check(d > 0.12, line);
  }
}

// The legs keep their stride under a cast: the feet swing as high while a
// cast plays on the arms as they do at the same run without one.
{
  console.log('casting at a run');
  await api((g) => { g.technique('recoil'); g.game.startRun({ skipTutorial: true }); g.loop(false); });
  await step(12);
  await api((g) => { g.teleport('courtyard'); g.camera('third'); g.look(Math.PI, -0.12); g.hold('forward', true); });
  await step(60);
  await holdView();
  // Over a full second each: the feet's height apart, which swings once a
  // stride, with the cast landing twice in the second window.
  const feet = async (n, castAt = []) => { const gaps = []; for (let i = 0; i < n; i++) { if (castAt.includes(i)) await api((g) => { g.game.techniques.resource = g.game.techniques.def.resource.max; g.cast('primary'); }); await step(1); const s = await sample(); gaps.push(s.world.foot_l[1] - s.world.foot_r[1]); } return gaps; };
  const swing = (g) => Math.max(...g) - Math.min(...g);
  const plain = swing(await feet(60));
  await setActivation(0);
  const cast = swing(await feet(60, [0, 36]));
  const s = await sample();
  await api((g) => { g.hold('forward', false); });
  const line = `the feet keep their stride under a cast at a run: height swing ${cast.toFixed(2)} m against ${plain.toFixed(2)} m without`;
  if (reportOnly) console.log(`  ${line}`); else check(cast > plain * 0.8, line);
  if (shots && !reportOnly) await crop(join(out, 'run-cast.png'), s.center, s.bodyPx);
}

// Enemies and bosses: each wind-up and cast moves the hands as far as the
// player's casts must, read against the body just before it starts.
for (const [encounter, at, moves] of [['kuroda', [0, 0.3, 9], ['kuroda:windup', 'kuroda:cast', 'thug:windup']], ['ancient', [-4, 0.3, -9], ['ancient:windup', 'ancient:cast']]]) {
  console.log(`enemies: ${encounter}`);
  await api((g) => { g.technique('recoil'); g.game.startRun({ skipTutorial: true }); g.loop(false); });
  await step(12);
  await api((g, id, p) => { g.teleport(p); g.camera('top'); g.look(0, 0); g.god(true); g.encounter(id); }, encounter, at);
  const seen = {};
  for (let f = 0; f < 1500 && !moves.every((m) => m in seen); f++) {
    const shoot = await api((g) => {
      const G = g.game, V = G.player.position.constructor;
      const rel = (e) => { const p = e.avatar.boneWorld('pelvis', new V()); return ['hand_l', 'hand_r'].map((n) => e.avatar.boneWorld(n, new V()).sub(p)); };
      const done = [];
      let shoot = null;
      for (const e of G.encounters.enemies) {
        if (!e.alive) continue;
        const t = e.__track;
        if (t) {
          t.peak = Math.max(t.peak, ...rel(e).map((v, i) => v.distanceTo(t.rest[i])));
          if (--t.left === 52) shoot = { key: t.key, at: e.position.toArray() };
          if (t.left <= 0) { done.push([t.key, t.peak]); e.__track = null; e.__rest = rel(e); }
        } else if (e.state === 'windup' || e.state === 'cast') e.__track = { key: `${e.def.ai}:${e.state}`, rest: e.__rest ?? rel(e), peak: 0, left: 70 };
        else e.__rest = rel(e);
      }
      g.step(1);
      window.__done = done;
      return shoot;
    });
    for (const [k, v] of await api(() => window.__done)) seen[k] = Math.max(seen[k] ?? 0, v);
    if (shoot && shots && !reportOnly && !shoot.shot) {
      const c = await api((g, p) => { const cam = g.game.renderer.camera, V = cam.position.constructor; const q = new V(p[0], p[1] + 0.9, p[2]).project(cam); return [(q.x * 0.5 + 0.5) * innerWidth, (-q.y * 0.5 + 0.5) * innerHeight]; }, shoot.at);
      await crop(join(out, `enemy-${shoot.key.replace(':', '-')}.png`), c, 160);
    }
  }
  for (const m of moves) {
    const line = `${m}: the hands travel ${(seen[m] ?? 0).toFixed(2)} m`;
    if (reportOnly) console.log(`  ${line}`); else check((seen[m] ?? 0) >= BAR.travel, line);
  }
  await api((g) => g.game.encounters.finish?.(false));
}

const pageErrors = await api((g) => g.errors);
errors.push(...pageErrors.map((e) => `window: ${e}`));
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(`\n${failures.length} failures, ${errors.length} page errors -> ${join(out, 'report.json')}`);
for (const e of errors.slice(0, 20)) console.log('  ERROR', e);
await browser.close();
stop();
process.exit(failures.length || errors.length ? 1 : 0);
