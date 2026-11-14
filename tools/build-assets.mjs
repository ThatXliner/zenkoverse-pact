#!/usr/bin/env node
// Builds public/assets from raw CC0 downloads and writes CREDITS.md and the
// asset manifest. Usage: node tools/build-assets.mjs <raw-download-dir> [--only human,props]
// The raw dir holds: kaykit-city/, kenney/<pack>/, quaternius/.
// With --only, just those sections rebuild and the rest of public/assets stays;
// the manifest is always regenerated from what is on disk.
import { execFileSync } from 'node:child_process';
import { mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
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
const audio = {
  'impact-sounds': ['footstep_concrete_000', 'footstep_concrete_001', 'footstep_concrete_002', 'footstep_concrete_003', 'footstep_wood_000', 'footstep_wood_001', 'footstep_wood_002', 'footstep_snow_000', 'footstep_snow_001', 'impactPunch_heavy_000', 'impactPunch_heavy_001', 'impactPunch_medium_000', 'impactPunch_medium_001', 'impactMetal_heavy_000', 'impactMetal_heavy_001', 'impactMetal_medium_000', 'impactGlass_heavy_000', 'impactGlass_heavy_001', 'impactGlass_light_000', 'impactGlass_medium_000', 'impactWood_heavy_000', 'impactWood_heavy_001', 'impactPlank_medium_000', 'impactSoft_heavy_000', 'impactSoft_heavy_001', 'impactBell_heavy_000', 'impactBell_heavy_002', 'impactTin_medium_000', 'impactMining_000', 'impactPlate_heavy_000'],
  'interface-sounds': ['click_001', 'click_003', 'select_001', 'select_003', 'confirmation_001', 'confirmation_002', 'error_004', 'open_001', 'close_001', 'toggle_001', 'tick_001', 'question_002', 'maximize_006', 'minimize_006', 'glass_002', 'pluck_001', 'bong_001', 'glitch_001'],
  'digital-audio': ['phaseJump1', 'phaseJump3', 'phaserUp3', 'phaserDown1', 'powerUp3', 'powerUp9', 'zap1', 'zapTwoTone', 'lowDown', 'highUp', 'threeTone1', 'spaceTrash1'],
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
      { title: 'Impact Sounds', author: 'Kenney', url: 'https://kenney.nl/assets/impact-sounds', license: 'CC0 1.0', use: 'Footsteps and impact layers.' },
      { title: 'Interface Sounds', author: 'Kenney', url: 'https://kenney.nl/assets/interface-sounds', license: 'CC0 1.0', use: 'UI feedback.' },
      { title: 'Digital Audio', author: 'Kenney', url: 'https://kenney.nl/assets/digital-audio', license: 'CC0 1.0', use: 'Technique layers.' },
    ],
    build() {
      for (const [pack, names] of Object.entries(audio)) for (const n of names) copyFileSync(join(raw, 'kenney', pack, 'Audio', `${n}.ogg`), join(out, 'audio', `${n}.ogg`));
    },
  },
};

for (const [name, s] of Object.entries(sections)) {
  if (only && !only.has(name)) continue;
  console.log(`building ${name}`);
  await s.build();
}

const manifest = writeManifest(root);

export const CREDITS_FOOT = ['Typography is loaded from Google Fonts under the SIL Open Font License: Shippori Mincho B1, Zen Kaku Gothic New, and Inter.', '', 'The compound itself (walls, hall, roofs, stair, bridge, ring, pond, lanterns, trees and hills), the cel-shading materials, the ink line effect, the sky, the ice, aura and shock-ring effects, the generated clothing shells, the hand poses and gestures, the wind bed, and all UI are original to this repository.'];
const lines = ['# Credits', '', 'Every third-party asset in `public/assets/` is listed here with its source and license. `tools/build-assets.mjs` compresses them from the raw downloads (meshopt for geometry) and writes this file.', '', '| Asset | Author | License | Source | Used for |', '| --- | --- | --- | --- | --- |'];
for (const s of Object.values(sections)) for (const c of s.credits) lines.push(`| ${c.title} | ${c.author} | ${c.license} | ${c.url} | ${c.use} |`);
lines.push('', ...CREDITS_FOOT, '');
writeFileSync(join(root, 'CREDITS.md'), lines.join('\n'));
console.log(`assets: ${manifest.files.length} files, ${(manifest.total / 1e6).toFixed(1)} MB`);
