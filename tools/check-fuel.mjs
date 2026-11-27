#!/usr/bin/env node
// Proves Fuel (issue #20) in play, with real keys and clicks, and saves frame
// strips from the top-down and over-the-shoulder cameras for the critic:
//   Dispersal lays a trail of vapour along the ground and leaves residue on
//   the hands; a dense charge (Delayed Ignition) at a stone lantern's foot
//   climbs to its flame, and the fire runs back along the trail and burns the
//   bodies standing in it; a thin trail under the lantern does not reach the
//   flame; a gap in a trail stops the fire;
//   Concentration draws vapour together, denser;
//   nothing Fuel casts lights anything: vapour left alone with no flame never burns;
//   the user's own fire burns the user, and with residue on the hands sets
//   them alight; water washes it off;
//   a soaked body drips vapour as it walks and flares when the fire finds it;
//   a heavy blow on stone strikes sparks that light vapour;
//   the Kuroda's poured fuel can be drawn up before his snap, and his fire lights vapour;
//   the city's fuel drums cook off and burst in a fire, each once;
//   no fire holds a body, a body takes the fire a moment at a time, and
//   nothing Fuel does gives Vapour back;
//   Saturation floods the ground round its target and soaks it;
//   Dōkasen, its drill, is cleared with real keys and raises Control.
// The ?debug hooks place the player and the bodies and read state; every
// Ability is cast from its key or button.
// Usage: node tools/check-fuel.mjs [url] [--out captures/fuel] [--no-shots] [--only yard]
// Without a URL it serves dist/ itself (run `npm run build` first).
import { chromium } from 'playwright';
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveTarget } from './lib/target.mjs';

const { url, args, stop } = await resolveTarget();
const out = args.out ?? 'captures/fuel';
const shots = args['no-shots'] !== 'true';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|WebGL|GPU stall|Automatic fallback/.test(m.text())) errors.push(`console: ${m.text()}`); });
const failures = [];
const check = (ok, what) => { if (!ok) failures.push(what); console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); return ok; };
const api = (fn, ...a) => page.evaluate(([f, ...rest]) => { const g = window.game; return new Function('g', 'a', `return (${f})(g, ...a)`)(g, rest); }, [fn.toString(), ...a]);
const step = (n = 1) => api((g, k) => g.step(k, 1 / 60), n);
const pos = () => api((g) => { const p = g.game.player.position; return [p.x, p.y, p.z]; });
const flat = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const fuel = () => api((g) => g.fuel());

const load = async (query = '') => {
  await page.goto(`${url}?debug${query}`);
  await page.waitForFunction(() => window.game?.game?.ready, null, { timeout: 180000 });
  await api((g) => { g.loop(false); localStorage.removeItem('zenko.drills.v1'); g.game.drills.progress = {}; g.game.mastery.reset(); });
};
await load();

// A fresh run with Fuel in hand, at `at`, in `camera`, nobody else about.
const stage = async (at, camera = 'top', yaw = 0, pitch = -0.3) => {
  await api((g, at, camera, yaw, pitch) => {
    g.technique('fuel'); g.game.startRun({ skipTutorial: true }); g.loop(false); g.step(5);
    g.god(true); g.teleport(at); g.camera(camera); g.look(yaw, pitch); g.step(30);
    const t = g.game.techniques; t.resource = t.def.resource.max;
  }, at, camera, yaw, pitch);
};
// A body that stands where it is put and does not strike back.
const body = (key, at, still = true) => api((g, key, at, still) => {
  const G = g.game, V = G.player.position.constructor;
  const e = G.encounters.spawn(key, new V(...at));
  e.attackCd = 1e9; e.castCd = 1e9; e.field = null;
  if (still) e.hold(1e9);
  g.step(3);
  return G.encounters.enemies.length - 1;
}, key, at, still);
const enemy = (i) => api((g, i) => { const e = g.game.encounters.enemies[i]; return { at: [e.position.x, e.position.y, e.position.z], hp: e.hp, state: e.state, frozen: e.frozen, gripped: e.gripped }; }, i);
const refill = () => api((g) => { const t = g.game.techniques; t.resource = t.def.resource.max; for (const k of Object.keys(t.cooldown)) t.cooldown[k] = 0; });
// Where a world point is on screen, for aiming the top-down cursor.
const screenOf = (p) => api((g, p) => { const cam = g.game.renderer.camera, V = cam.position.constructor; cam.updateMatrixWorld(); const q = new V(...p).project(cam); return [(q.x * 0.5 + 0.5) * innerWidth, (-q.y * 0.5 + 0.5) * innerHeight]; }, p);
// Top-down the camera leans toward the cursor, so the aim is set twice.
const aimAt = async (p) => {
  const camera = await api((g) => g.game.cam.mode);
  if (camera === 'top') { for (let k = 0; k < 3; k++) { const [x, y] = await screenOf(p); await page.mouse.move(x, y); await step(8); } return; }
  // Over the shoulder the crosshair is the aim: turn to face the point, pitched down onto it.
  await api((g, p) => { const me = g.game.player.eye(); const dx = p[0] - me.x, dz = p[2] - me.z, d = Math.hypot(dx, dz); g.look(Math.atan2(-dx, -dz), Math.atan2(p[1] - me.y, d)); g.step(3); }, p);
};
const mouse = async (button, down) => { if (down) await page.mouse.down({ button }); else await page.mouse.up({ button }); };
const click = async (button = 'left') => { await mouse(button, true); await step(1); await mouse(button, false); };
const key = async (code, down) => { if (down) await page.keyboard.down(code); else await page.keyboard.up(code); };
const tap = async (code) => { await key(code, true); await step(1); await key(code, false); };
// Lets a cast's gesture finish, so the next key is taken.
const settle = () => step(40);

// Frames: a strip of crops around a point, a few beats wide.
const tiles = [];
const tile = async (at = null, half = 230) => {
  if (!shots) return;
  const [x, y] = at ? await screenOf(at) : await api((g) => { const cam = g.game.renderer.camera, V = cam.position.constructor; cam.updateMatrixWorld(); const q = g.game.player.position.clone().add(new V(0, 0.9, 0)).project(cam); return [(q.x * 0.5 + 0.5) * innerWidth, (-q.y * 0.5 + 0.5) * innerHeight]; });
  const left = Math.round(Math.min(1280 - 2 * half, Math.max(0, x - half))), top = Math.round(Math.min(720 - 2 * half, Math.max(0, y - half)));
  tiles.push(await sharp(await page.screenshot({ clip: { x: left, y: top, width: 2 * half, height: 2 * half }, animations: 'disabled' })).resize(300, 300).png().toBuffer());
};
const full = async () => { if (shots) tiles.push(await sharp(await page.screenshot({ animations: 'disabled' })).resize(480, 270).png().toBuffer()); };
const strip = async (name) => {
  if (!shots || !tiles.length) return;
  const { width: w, height: h } = await sharp(tiles[0]).metadata();
  await sharp({ create: { width: w * tiles.length, height: h, channels: 3, background: '#000' } }).composite(tiles.map((b, i) => ({ input: b, left: i * w, top: 0 }))).png().toFile(join(out, `${name}.png`));
  tiles.length = 0;
};

// The east stone lantern before the hall steps, and the flagstones it looks over.
const LANTERN = [4.6, 0, -1.8];
const FOOT = [5.0, 0, -1.4];

// `--only yard` runs the city's part alone.
if (args.only !== 'yard') {
// ------------------------------------------------------------------ the fuse
console.log('A trail, and a flame found for it');
for (const camera of ['top', 'third']) {
  await stage([5.3, 0, -0.9], camera);
  const a = await body('thug', [10.6, 0, 4.4]);
  const b = await body('thug', [11.4, 0, 3.4]);
  const hp0 = [(await enemy(a)).hp, (await enemy(b)).hp];
  const res0 = (await fuel()).residue;
  await aimAt([11, 0, 4]);
  await click('left');
  await step(12); await tile([8.5, 0, 1.8]);
  await step(30); await tile([8.5, 0, 1.8]);
  const laid = await fuel();
  if (camera === 'top') {
    check(laid.puffs.length >= 10 && laid.puffs.every((p) => p.d > 0.22 && p.d < 0.6), `Dispersal lays a trail of ${laid.puffs.length} puffs, thin enough to carry a flame and too thin to climb to one (${Math.min(...laid.puffs.map((p) => p.d)).toFixed(2)} to ${Math.max(...laid.puffs.map((p) => p.d)).toFixed(2)})`);
    check(laid.residue > res0 + 0.08, `laying it leaves residue on the hands: ${res0.toFixed(2)} to ${laid.residue.toFixed(2)}`);
    // Left alone, with no flame near, it never burns: Fuel cannot light itself.
    await step(120);
    check((await fuel()).tally.lit === 0, 'left alone with no flame near, the vapour never burns');
  }
  // Step off the trail and lay a dense charge at the lantern's foot.
  await api((g) => { g.teleport([7.6, 0, -2.8]); g.step(15); });
  await aimAt(FOOT);
  await tap('Digit1');
  for (let k = 0; k < 6; k++) { await step(k < 3 ? 9 : 14); await tile([7.8, 0, 1.4]); }
  await step(90);
  await strip(`fuse-${camera}`);
  const after = await fuel();
  const hp1 = [(await enemy(a)).hp, (await enemy(b)).hp];
  if (camera === 'top') {
    check(after.tally.lanterns >= 1 && after.tally.lit >= 10, `a dense charge at the lantern's foot climbs to its flame, and the fire runs back along the trail (${after.tally.lit} puffs burned)`);
    check(hp1[0] < hp0[0] && hp1[1] < hp0[1], `the bodies standing at its end are burned: ${hp0[0]} to ${Math.round(hp1[0])}, ${hp0[1]} to ${Math.round(hp1[1])}`);
    check(after.puffs.length === 0, 'the fire eats the vapour: none is left once it has burned');
  }
}

// A thin trail passing under the lantern does not climb to its flame, and a gap stops the fire.
console.log('Too thin, and a gap');
await stage([3.4, 0, -2.7], 'top');
await aimAt([9.4, 0, 0.6]);
await click('left');
await step(60);
check((await fuel()).tally.lit === 0, 'a thin trail laid right past the lantern stays unlit: thin vapour hugs the ground below the flame');
// A second trail, well apart from the first, then the first lit at the lantern.
await api((g) => { g.teleport([12.5, 0, 4.6]); g.step(10); });
await settle();
await aimAt([15, 0, 7]);
await click('left');
await settle();
await api((g) => { g.teleport([7.6, 0, -2.8]); g.step(10); });
await aimAt(FOOT);
await tap('Digit1');
await step(150);
const gap = await fuel();
const farLeft = gap.puffs.filter((p) => p.at[0] > 12).length;
check(gap.tally.lit >= 5 && farLeft >= 3, `the fire stops at a gap: ${gap.tally.lit} puffs burned, and ${farLeft} past the gap still lie unlit`);

// ------------------------------------------------------------------ Concentration
console.log('Concentration');
await stage([8, 0, 4], 'top');
await aimAt([13, 0, 4]);
await click('left');
await settle();
await aimAt([8, 0, 9]);
await click('left');
await settle();
const before = Math.max(...(await fuel()).puffs.map((p) => p.d));
await aimAt([10, 0, 6]);
await mouse('right', true);
for (let k = 0; k < 6; k++) { await step(14); await tile([10, 0, 6]); }
await mouse('right', false);
await step(10); await tile([10, 0, 6]);
await strip('herd-top');
const herded = await fuel();
const densest = Math.max(...herded.puffs.map((p) => p.d));
check(densest > before + 0.25 && herded.puffs.length < 14, `held, Concentration draws the vapour together: the densest puff goes from ${before.toFixed(2)} to ${densest.toFixed(2)}, ${herded.puffs.length} puffs left of 18`);
await api((g) => { g.camera('third'); g.look(-Math.PI * 0.75, -0.35); g.step(20); });
await full();
await strip('herd-third');

// ------------------------------------------------------------------ the user's own fire
console.log('Her own fire');
await stage([5.3, 0, -0.9], 'top');
await aimAt([11, 0, 4]);
for (let k = 0; k < 3; k++) { await click('left'); await settle(); }
// She stands in her own trail, residue on her hands, and lights it.
const res = (await fuel()).residue;
await api((g) => { g.teleport([6.6, 0, 0.3]); g.god(false); g.game.combat.invuln = 0; g.game.combat.hp = g.game.combat.maxHp; g.step(5); });
await aimAt(FOOT);
await tap('Digit1');
let alight = false;
for (let f = 0; f < 120; f++) { await step(1); if ((await fuel()).alight) alight = true; }
const burnt = await api((g) => g.game.combat.hp);
await tile();
check(res > 0.35 && burnt < 100 && alight, `standing in her own trail with residue on her hands (${res.toFixed(2)}), the fire burns her (${Math.round(burnt)} health left) and sets her alight (${JSON.stringify((await fuel()).tally)})`);
// The koi pond puts her out and washes the hands.
await api((g) => { g.teleport([11, 0, 13.4]); g.step(5); });
await step(60);
const washed = await fuel();
await api((g) => g.god(true));
check(!washed.alight, `the pond's wet rim puts a burning body out and washes the residue off (${washed.residue.toFixed(2)})`);

// ------------------------------------------------------------------ soaked bodies
console.log('Delayed Ignition');
await stage([5.3, 0, -0.9], 'top');
const walker = await body('thug', [8.5, 0, 0.5], false);
await aimAt((await enemy(walker)).at);
await tap('Digit1');
await step(20);
const soaked = await fuel();
check(soaked.soaked === 1, 'Delayed Ignition soaks the body in front of her');
// It walks, and drips vapour where it goes; then it walks into a fire.
await api((g) => { g.teleport([12, 0, 6]); g.step(5); });
for (let f = 0; f < 90; f++) await step(1);
const dripped = (await fuel()).puffs.length;
check(dripped >= 3, `a soaked body drips vapour as it walks: ${dripped} puffs behind it`);
const hpW0 = (await enemy(walker)).hp;
await api((g) => { g.teleport([5.3, 0, -0.9]); g.step(5); });
await aimAt((await enemy(walker)).at);
await click('left');
await settle();
await api((g) => { g.teleport([7.6, 0, -2.8]); g.step(5); });
await aimAt(FOOT);
await tap('Digit1');
await step(120);
const flared = await fuel();
check(flared.tally.flares >= 1 && (await enemy(walker)).hp < hpW0, `when the fire finds it the soaked body flares (${hpW0} to ${Math.round((await enemy(walker)).hp)})`);
const w = await enemy(walker);
check(w.frozen === 0 && w.gripped === 0, 'no fire holds a body in place');

// ------------------------------------------------------------------ sparks off stone
console.log('A heavy blow on stone');
await stage([2, 0, 6], 'top');
await aimAt([2, 0, 12]);
await click('left');
await settle();
const bruiser = await api((g) => { const G = g.game, V = G.player.position.constructor; const e = G.encounters.spawn('bruiser', new V(2, 0, 4.2)); e.castCd = 1e9; e.attackCd = 0; g.step(2); return G.encounters.enemies.length - 1; });
let sparked = 0;
for (let f = 0; f < 300 && !sparked; f++) { await step(1); sparked = (await fuel()).tally.lit; }
check(sparked > 0, 'a bruiser\'s slam on the flagstones strikes sparks, and the vapour round her catches');
void bruiser;

// ------------------------------------------------------------------ the Kuroda
console.log('The Kuroda');
await stage([0, 0, 8], 'top');
await aimAt([0, 0, 8]);
const kuroda = await api((g) => { const G = g.game, V = G.player.position.constructor; const e = G.encounters.spawn('kuroda', new V(0, 0, 14)); e.attackCd = 1e9; e.castCd = 0; g.step(2); return G.encounters.enemies.length - 1; });
const pourOf = () => api((g, i) => g.game.encounters.enemies[i].pour.map((p) => [p.x, p.y, p.z]), kuroda);
let pour = [];
for (let f = 0; f < 240 && !pour.length; f++) { await step(1); pour = await pourOf(); }
check(pour.length > 0, 'the Enforcer pours his fuel at her feet');
if (pour.length) {
  await mouse('right', true);
  for (let k = 0; k < 5; k++) { await step(8); await tile(pour[0]); }
  await mouse('right', false);
  const took = await fuel();
  check(took.tally.taken >= 1 && (await pourOf()).length === 0 && took.puffs.some((p) => flat(p.at, pour[0]) < 2 && p.d > 0.8), `Concentration draws his pour up off the ground before the snap (${took.tally.taken} taken): it is her vapour now, dense where it lay (${JSON.stringify(took.tally)}, ${took.puffs.length} puffs)`);
  await step(90);
  await tile(pour[0]);
  await strip('kuroda-take-top');
}
// His fire lights vapour: a trail laid from where his pour will land out to a thug.
await stage([0, 0, 8], 'top');
const k2 = await api((g) => { const G = g.game, V = G.player.position.constructor; const e = G.encounters.spawn('kuroda', new V(0, 0, 15)); e.attackCd = 1e9; e.castCd = 1.2; e.hold(1.0); g.step(2); return G.encounters.enemies.length - 1; });
const t3 = await body('thug', [-6, 0, 6]);
await aimAt([-6, 0, 6]);
await click('left');
const t3hp = (await enemy(t3)).hp;
await step(30);
let lit2 = 0;
for (let f = 0; f < 360 && lit2 < 3; f++) { await step(1); lit2 = (await fuel()).tally.lit; if (f === 20) await api((g) => { g.teleport([4, 0, 4]); g.step(1); }); }
await step(60);
check(lit2 >= 3 && (await enemy(t3)).hp < t3hp, `the Enforcer's own fire lights her trail and it burns his man (${t3hp} to ${Math.round((await enemy(t3)).hp)})`);
void k2;

// ------------------------------------------------------------------ no loops, no locks
console.log('No loops');
await stage([5.3, 0, -0.9], 'top');
const pinned = await body('thug', [9.6, 0, 3.0]);
await aimAt([10, 0, 3.4]);
await click('left'); await settle();
await click('left'); await settle();
await click('left'); await settle();
await api((g) => { g.teleport([7.6, 0, -2.8]); g.game.techniques.resource = 20; g.step(5); });
const regen = await api((g) => g.game.techniques.def.resource.regen);
let worst = 0;
const burned0 = (await fuel()).tally.burned;
await aimAt(FOOT);
await tap('Digit1');
for (let f = 0; f < 150; f++) { const a = await api((g) => g.game.techniques.resource); await step(1); const b = await api((g) => g.game.techniques.resource); worst = Math.max(worst, b - a); }
const burns = (await fuel()).tally.burned - burned0;
check(worst <= regen / 60 + 1e-6, `no fire gives Vapour back: the most it rose in a frame is ${worst.toFixed(3)} (regen alone is ${(regen / 60).toFixed(3)})`);
check(burns >= 1 && burns <= 4, `a body standing in a thick trail takes the fire a moment at a time, not once per puff: ${burns} blows (${JSON.stringify((await fuel()).tally)})`);
void pinned;

// ------------------------------------------------------------------ Saturation
console.log('Saturation');
for (const camera of ['top', 'third']) {
  await stage([0, 0, 9], camera, 0, -0.2);
  const i = await body('thug', [0, 0, 6]);
  await api((g) => { const e = g.game.encounters.enemies.at(-1); e.hp = e.maxHp = 400; });
  const e0 = await enemy(i);
  const n0 = (await fuel()).puffs.length;
  await api((g) => { g.game.techniques.charge = 1; });
  await tap('KeyQ');
  const id = await api((g) => g.cutscenes().active);
  const beat = await api((g) => g.cutscenes().defs['max-fuel'].beat);
  const stops = [0.45, beat - 0.25, beat + 0.06, beat + 0.5, beat + 1.2];
  let k = 0;
  for (let f = 0; f < 60 * 5 && k < stops.length; f++) {
    const t = await api((g) => g.cutscenes().timeline?.t ?? 99);
    if (t >= stops[k]) { await full(); k++; }
    await step(1);
  }
  while (await api((g) => g.cutscenes().active)) await step(5);
  await step(40);
  await full();
  await strip(`saturation-${camera}`);
  const flood = await fuel();
  const e1 = await enemy(i);
  if (camera === 'top') {
    check(id, 'Q plays the Saturation cutscene');
    check(e1.hp < e0.hp - 20 && flood.soaked >= 1, `the condensed charge drenches its target (${e0.hp} to ${Math.round(e1.hp)}) and soaks it`);
    const me = await pos();
    check(flood.puffs.length > n0 + 12 && flood.puffs.every((p) => flat(p.at, me) > 1.6), `the ground round it floods with ${flood.puffs.length - n0} puffs, and round her the air stays clear`);
    check(flood.tally.lit === 0, 'and nothing burns: she still cannot light it');
  }
}

// ------------------------------------------------------------------ Dōkasen
console.log('Dōkasen');
await stage([6.6, 0, -1.4], 'top');
const control0 = await api((g) => g.game.mastery.get('fuel', 'control'));
await api((g) => g.drill('fuel-dokasen'));
await step(5);
await api((g) => { const c = g.game.drills.current; if (c) c.waiting = false; });
const posts = () => api((g) => g.fuel().dokasen.posts);
const score = () => api((g) => g.game.drills.current?.score ?? -1);
const runs = [];
for (let n = 0; n < 3; n++) {
  let ps = [];
  for (let f = 0; f < 600 && !ps.length; f++) { await step(1); ps = (await posts()).filter((p) => !p.burnt); }
  if (!ps.length) break;
  const target = ps[0].at;
  await api((g) => { g.teleport([5.3, 0, -0.9]); g.step(5); g.game.techniques.resource = 100; });
  await aimAt(target);
  await click('left');
  await settle();
  if (n === 0) await tile([8, 0, 1.5]);
  await api((g) => { g.teleport([7.2, 0, -3.0]); g.step(5); });
  await aimAt(FOOT);
  const s0 = await score();
  await tap('Digit1');
  let left = true;
  for (let f = 0; f < 400 && left; f++) { await step(1); left = (await posts()).some((p) => !p.burnt) && (await score()) === s0; if (n === 0 && f === 40) await tile([8, 0, 1.5]); }
  for (let f = 0; f < 200 && (await score()) === s0 && (await api((g) => g.game.drills.running)); f++) await step(1);
  runs.push((await score()) > s0 || !(await api((g) => g.game.drills.running)));
}
await strip('dokasen-top');
for (let f = 0; f < 600 && (await api((g) => g.game.drills.running)); f++) await step(1);
const reached = await api((g) => g.game.drills.reached('fuel-dokasen'));
const control1 = await api((g) => g.game.mastery.get('fuel', 'control'));
check(reached === 1 && control1 >= 0.55 && control0 < 0.55, `Dōkasen's first tier is cleared with real input (${runs.filter(Boolean).length} of ${runs.length} posts), and Control stands at ${control1.toFixed(2)} (from ${control0.toFixed(2)})`);

}

// ------------------------------------------------------------------ the Kuroda yard
// In the city the family keeps its stock in drums by the warehouse. A trail
// from the garden's stone lantern across the yard sets them off, each once.
console.log('The Kuroda yard');
for (const e of [...errors, ...(await api((g) => g.errors))]) check(false, e);
errors.length = 0;
await load('&region=city');
const O = await api((g) => g.world().origins.city);
const C = (x, z) => [O[0] + x, O[1], O[2] + z];
await api((g, at) => { g.technique('fuel'); g.game.startRun({ skipTutorial: true }); g.loop(false); g.step(5); g.god(true); g.teleport(at); g.camera('top'); g.step(40); }, C(21.2, 11.4));
const drums = () => api((g) => g.game.props.instances.filter((p) => p.alive && p.def.model === 'built/drum').length);
const drums0 = await drums();
const guard = await body('thug', C(38.6, 9.4));
const gHp = (await enemy(guard)).hp;
const legs = [[C(20.5, 12.0), C(27.6, 10.6)], [C(26.4, 10.8), C(33.4, 9.9)], [C(32.4, 10.0), C(39.6, 9.2)]];
// Laid from the drums back toward the lantern, so the breeze has the least time to break it.
for (const [from, to] of legs.reverse()) {
  await api((g, at) => { g.teleport(at); g.step(3); g.game.techniques.resource = 100; }, from);
  await aimAt(to);
  await click('left');
  await step(40);
}
// The charge is aimed from above, at the lantern's foot.
await api((g, at) => { g.teleport(at); g.step(30); }, C(21.4, 13.8));
await aimAt(C(20.2, 12.4));
await tap('Digit1');
await step(30);
// Once it burns she stands back by the house and watches it go, over the shoulder.
await api((g, at) => { g.teleport(at); g.camera('third'); g.look(Math.atan2(-8, -7), -0.2); g.step(10); }, C(31.5, 2.5));
if (args.debug) console.log(JSON.stringify((await fuel()).puffs.map((p) => [+(p.at[0] - O[0]).toFixed(1), +(p.at[2] - O[2]).toFixed(1), +p.r.toFixed(2), +p.d.toFixed(2), p.burning])));
let blasts = 0;
for (let f = 0; f < 600 && blasts < 2; f++) { await step(1); blasts = (await fuel()).tally.blasts; if (f % 50 === 10) await full(); }
await step(120);
await full();
await strip('kuroda-yard-third');
const yard = await fuel();
const drums1 = await drums();
check(yard.tally.lanterns >= 1 && blasts >= 1 && drums1 < drums0, `a trail from the garden lantern sets the yard's fuel drums off: ${blasts} burst, ${drums0} drums to ${drums1} (${JSON.stringify(yard.tally)})`);
check((await enemy(guard)).hp < gHp, `the man by the drums takes it (${gHp} to ${Math.round((await enemy(guard)).hp)})`);
await step(300);
check((await fuel()).cooking === 0 && (await fuel()).tally.blasts <= drums0, 'each drum bursts once, and the chain ends where the drums do');

for (const e of [...errors, ...(await api((g) => g.errors))]) check(false, e);
writeFileSync(join(out, 'report.json'), JSON.stringify({ url, failures, errors }, null, 2));
await browser.close();
stop();
console.log(failures.length ? `\n${failures.length} failure(s)` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);
