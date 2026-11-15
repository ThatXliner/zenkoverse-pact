#!/usr/bin/env node
// Builds public/assets from raw CC0 downloads and writes CREDITS.md and the
// asset manifest. Usage: node tools/build-assets.mjs <raw-download-dir> [--only human,props]
// The raw dir holds: kaykit-city/, kenney/<pack>/, quaternius/.
// With --only, just those sections rebuild and the rest of public/assets stays;
// the manifest is always regenerated from what is on disk.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildHuman } from './human.mjs';
import { writeManifest } from './manifest.mjs';

const [raw, ...flags] = process.argv.slice(2);
if (!raw) throw new Error('usage: build-assets.mjs <raw-download-dir> [--only a,b]');
const onlyFlag = flags.indexOf('--only');
const only = onlyFlag >= 0 ? new Set(flags[onlyFlag + 1].split(',')) : null;
const root = new URL('..', import.meta.url).pathname;
const out = join(root, 'public/assets');
if (!only) rmSync(out, { recursive: true, force: true });
for (const d of ['characters', 'props', 'audio']) mkdirSync(join(out, d), { recursive: true });

const gltf = (...args) => execFileSync('npx', ['gltf-transform', ...args], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });

function compressGlb(src, dst, { webp = true } = {}) {
  const tmp = dst + '.tmp.glb';
  gltf('resample', src, tmp);
  gltf('weld', tmp, tmp);
  gltf('dedup', tmp, tmp);
  gltf('prune', tmp, tmp);
  if (webp) gltf('webp', tmp, tmp, '--quality', '85');
  gltf('meshopt', tmp, dst, '--level', 'high');
  rmSync(tmp);
}

// The compound's props: the dojo's furniture, the things the Techniques throw.
const kenney = {
  'city-kit-suburban': ['planter'],
  'food-kit': ['barrel', 'steamer', 'pot-stew'],
};
const furniture = ['bench', 'chair', 'bookcaseOpen', 'lampSquareFloor', 'rugRectangle', 'cardboardBoxClosed', 'cardboardBoxOpen', 'pottedPlant', 'radio', 'coatRackStanding', 'desk', 'stoolBar'];
const cityBits = ['box_A', 'box_B'];
// Sound: Kenney's CC0 packs, each file transcoded to mono Opus. The game
// loads them after the first click (src/audio/library.ts), not at boot.
const range = (stem, n, from = 0) => Array.from({ length: n }, (_, i) => `${stem}${String(from + i).padStart(3, '0')}`);
const audio = {
  'impact-sounds': [
    ...range('footstep_concrete_', 5), ...range('footstep_wood_', 5), ...range('footstep_grass_', 5), ...range('footstep_snow_', 3),
    ...range('impactPunch_heavy_', 3), ...range('impactPunch_medium_', 3), ...range('impactSoft_heavy_', 3), ...range('impactSoft_medium_', 3), ...range('impactGeneric_light_', 3),
    ...range('impactMetal_heavy_', 2), ...range('impactMetal_medium_', 1), ...range('impactMetal_light_', 2), ...range('impactGlass_heavy_', 3), ...range('impactGlass_medium_', 2), ...range('impactGlass_light_', 3),
    ...range('impactWood_heavy_', 2), ...range('impactWood_medium_', 2), ...range('impactWood_light_', 2), ...range('impactPlank_medium_', 2), ...range('impactBell_heavy_', 3), ...range('impactPlate_heavy_', 2), ...range('impactMining_', 3),
  ],
  'rpg-audio': ['footstep00', 'footstep01', 'footstep02', 'footstep03', 'footstep04', 'footstep05', 'cloth1', 'cloth2', 'cloth3', 'cloth4', 'knifeSlice', 'knifeSlice2', 'creak1', 'creak2', 'creak3', 'bookFlip1', 'bookFlip2', 'bookPlace1', 'beltHandle1', 'drawKnife1'],
  'interface-sounds': ['click_002', 'click_003', 'select_001', 'select_002', 'select_003', 'confirmation_001', 'confirmation_002', 'error_004', 'error_006', 'open_001', 'close_001', 'tick_001', 'tick_002', 'question_002', 'glass_002', 'pluck_001', 'bong_001', 'glitch_001', 'switch_002'],
  'digital-audio': ['phaseJump3', 'powerUp9', 'zapTwoTone', 'lowDown', 'spaceTrash1'],
};

// Each section names its credits and the build that fills public/assets.
// Credits are always written; builds run when selected.
const sections = {
  human: {
    credits: [
      { title: 'Universal Base Characters (Standard)', author: 'Quaternius', url: 'https://quaternius.com/packs/universalbasecharacters.html', license: 'CC0 1.0', use: 'The rigged human with finger bones behind every character: the first-person arms and hands, the player and the enemies. Drawn cel-shaded at runtime with flat fills and an ink hull; its skin textures are not used. The suit, sleeve and cuff are generated from the skin mesh by tools/human.mjs.' },
      { title: 'Universal Animation Library (Standard)', author: 'Quaternius', url: 'https://quaternius.com/packs/universalanimationlibrary.html', license: 'CC0 1.0', use: 'Locomotion, jump, hit, death and casting clips, retargeted onto the base character by bone name.' },
    ],
    async build() {
      rmSync(join(out, 'characters', 'human.glb'), { force: true });
      const speeds = await buildHuman(raw, out);
      const rawGlb = join(out, 'characters', 'human.raw.glb');
      compressGlb(rawGlb, join(out, 'characters', 'human.glb'), { webp: false });
      rmSync(rawGlb);
      console.log('human.glb clip speeds (m/s):', speeds);
    },
  },
  props: {
    credits: [
      { title: 'City Kit (Suburban)', author: 'Kenney', url: 'https://kenney.nl/assets/city-kit-suburban', license: 'CC0 1.0', use: 'Planters in the courtyard.' },
      { title: 'Food Kit', author: 'Kenney', url: 'https://kenney.nl/assets/food-kit', license: 'CC0 1.0', use: 'Barrels, a steamer and a pot: things for the Techniques to throw.' },
      { title: 'Furniture Kit', author: 'Kenney', url: 'https://kenney.nl/assets/furniture-kit', license: 'CC0 1.0', use: 'The training hall\'s furniture, benches, cardboard boxes, stools, chairs and the coat-rack training dummies.' },
      { title: 'KayKit City Builder Bits 1.0', author: 'Kay Lousberg', url: 'https://github.com/KayKit-Game-Assets/KayKit-City-Builder-Bits-1.0', license: 'CC0 1.0', use: 'Crates.' },
    ],
    build() {
      for (const [pack, names] of Object.entries(kenney)) for (const n of names) compressGlb(join(raw, 'kenney', pack, 'Models', 'GLB format', `${n}.glb`), join(out, 'props', `${n}.glb`));
      for (const n of furniture) compressGlb(join(raw, 'kenney', 'furniture-kit', 'Models', 'GLTF format', `${n}.glb`), join(out, 'props', `furn-${n}.glb`));
      for (const n of cityBits) compressGlb(join(raw, 'kaykit-city', `${n}.gltf`), join(out, 'props', `kk-${n}.glb`));
    },
  },
  audio: {
    credits: [
      { title: 'Impact Sounds', author: 'Kenney', url: 'https://kenney.nl/assets/impact-sounds', license: 'CC0 1.0', use: 'Footsteps on stone, wood and grass, and the physical layer of every hit, catch and landing.' },
      { title: 'Interface Sounds', author: 'Kenney', url: 'https://kenney.nl/assets/interface-sounds', license: 'CC0 1.0', use: 'Menu, Workshop, toast and drill feedback.' },
      { title: 'Digital Audio', author: 'Kenney', url: 'https://kenney.nl/assets/digital-audio', license: 'CC0 1.0', use: 'Technique layers.' },
      { title: 'RPG Audio', author: 'Kenney', url: 'https://kenney.nl/assets/rpg-audio', license: 'CC0 1.0', use: 'Gravel and sand footsteps, cloth swishes under the hand signs and swings, the hall\'s creaking boards, the Workshop\'s pages, Shift\'s cut.' },
    ],
    build() {
      rmSync(join(out, 'audio'), { recursive: true, force: true });
      mkdirSync(join(out, 'audio'), { recursive: true });
      const tmp = mkdtempSync(join(tmpdir(), 'zenko-audio-'));
      // Mono (the game places every sound itself), Opus at 40 kb/s, any
      // leading silence trimmed so a hit lands on its frame.
      const files = [];
      for (const [pack, names] of Object.entries(audio)) for (const n of names) {
        const f = join(tmp, `${n}.ogg`);
        execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', join(raw, 'kenney', pack, 'Audio', `${n}.ogg`), '-ac', '1', '-af', 'silenceremove=start_periods=1:start_threshold=-60dB', '-c:a', 'libopus', '-b:a', '40k', '-vbr', 'on', f]);
        files.push({ name: n, bytes: readFileSync(f) });
      }
      // One file, one request: a little-endian header length, a JSON index
      // of [name, offset, length], then the Ogg files back to back.
      let offset = 0;
      const index = files.map((f) => { const e = [f.name, offset, f.bytes.length]; offset += f.bytes.length; return e; });
      const head = Buffer.from(JSON.stringify(index));
      const len = Buffer.alloc(4);
      len.writeUInt32LE(head.length);
      writeFileSync(join(out, 'audio', 'sounds.pack'), Buffer.concat([len, head, ...files.map((f) => f.bytes)]));
      rmSync(tmp, { recursive: true, force: true });
    },
  },
};

for (const [name, s] of Object.entries(sections)) {
  if (only && !only.has(name)) continue;
  console.log(`building ${name}`);
  await s.build();
}

const manifest = writeManifest(root);

export const CREDITS_FOOT = ['Typography is loaded from Google Fonts under the SIL Open Font License: Shippori Mincho B1, Zen Kaku Gothic New, and Inter.', '', 'The compound itself (walls, hall, roofs, stair, bridge, ring, pond, lanterns, trees and hills), the cel-shading materials, the ink line effect, the sky, the ice, aura and shock-ring effects, the generated clothing shells, the hand poses and gestures, all UI, and every synthesized sound (the ambience beds, the music, and the whooshes, risers, booms and shimmers layered into the Techniques, src/audio) are original to this repository.'];
const lines = ['# Credits', '', 'Every third-party asset in `public/assets/` is listed here with its source and license. `tools/build-assets.mjs` compresses them from the raw downloads (meshopt for geometry) and writes this file.', '', '| Asset | Author | License | Source | Used for |', '| --- | --- | --- | --- | --- |'];
for (const s of Object.values(sections)) for (const c of s.credits) lines.push(`| ${c.title} | ${c.author} | ${c.license} | ${c.url} | ${c.use} |`);
const packTitle = { 'impact-sounds': 'Impact Sounds', 'interface-sounds': 'Interface Sounds', 'digital-audio': 'Digital Audio', 'rpg-audio': 'RPG Audio' };
lines.push('', 'Every recording in `public/assets/audio/sounds.pack`, by the Kenney pack (CC0 1.0) it comes from. Each is transcoded to mono Opus and kept under its original name:', '');
for (const [pack, names] of Object.entries(audio)) lines.push(`- ${packTitle[pack]} (https://kenney.nl/assets/${pack}): ${names.join(', ')}.`);
lines.push('', ...CREDITS_FOOT, '');
writeFileSync(join(root, 'CREDITS.md'), lines.join('\n'));
console.log(`assets: ${manifest.files.length} files, ${(manifest.total / 1e6).toFixed(1)} MB at boot; ${(manifest.audioTotal / 1e6).toFixed(2)} MB of sound after the first click`);
