#!/usr/bin/env node
// Builds public/assets from raw CC0 downloads and writes CREDITS.md and the
// asset manifest. Usage: node tools/build-assets.mjs <raw-download-dir> [--only human,props]
// The raw dir holds: kaykit-city/, kenney/<pack>/, acg/<Mat>.zip, hdri/, quaternius/.
// With --only, just those sections rebuild and the rest of public/assets stays;
// the manifest is always regenerated from what is on disk.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, statSync, copyFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import sharp from 'sharp';
import { buildHuman } from './human.mjs';

const [raw, ...flags] = process.argv.slice(2);
if (!raw) throw new Error('usage: build-assets.mjs <raw-download-dir> [--only a,b]');
const onlyFlag = flags.indexOf('--only');
const only = onlyFlag >= 0 ? new Set(flags[onlyFlag + 1].split(',')) : null;
const root = new URL('..', import.meta.url).pathname;
const out = join(root, 'public/assets');
if (!only) rmSync(out, { recursive: true, force: true });
for (const d of ['characters', 'props', 'textures', 'hdri', 'audio', 'textures/HumanSkinDark']) mkdirSync(join(out, d), { recursive: true });

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

const kenney = {
  'city-kit-commercial': ['building-a', 'building-b', 'building-c', 'building-d', 'building-e', 'building-f', 'building-g', 'building-h', 'building-i', 'building-j', 'building-k', 'building-l', 'building-m', 'building-n', 'building-skyscraper-a', 'building-skyscraper-b', 'building-skyscraper-c', 'building-skyscraper-d', 'building-skyscraper-e', 'detail-awning', 'detail-awning-wide', 'detail-overhang', 'detail-overhang-wide', 'detail-parasol-a'],
  'city-kit-suburban': ['building-type-a', 'building-type-f', 'building-type-m', 'building-type-t', 'fence-1x3', 'fence-low', 'planter', 'tree-large', 'tree-small'],
  'city-kit-roads': ['bridge-pillar', 'bridge-pillar-wide', 'road-bridge', 'construction-barrier', 'construction-cone', 'dumpster', 'electricity-pole', 'electricity-wires', 'light-curved', 'light-curved-double', 'light-square', 'road-sign-street', 'road-sign-stop', 'traffic-light', 'traffic-light-hanging', 'sign-highway'],
  'food-kit': ['barrel', 'bag', 'carton', 'can', 'soda-can', 'soda-can-crushed', 'styrofoam', 'pizza-box', 'bottle-ketchup', 'steamer', 'pot-stew', 'cutting-board-japanese', 'chopstick', 'bowl-broth', 'maki-salmon', 'rice-ball', 'dim-sum', 'cup-tea', 'skewer'],
};
const furniture = ['bench', 'chair', 'table', 'tableCloth', 'bookcaseOpen', 'lampSquareFloor', 'rugRectangle', 'cardboardBoxClosed', 'cardboardBoxOpen', 'pottedPlant', 'plantSmall1', 'radio', 'speaker', 'trashcan', 'coatRackStanding', 'desk', 'stoolBar', 'kitchenBar', 'kitchenFridgeSmall', 'laptop'];
const cityBits = ['bench', 'box_A', 'box_B', 'car_hatchback', 'car_sedan', 'car_taxi', 'car_stationwagon', 'dumpster', 'firehydrant', 'streetlight', 'trafficlight_A', 'trash_A', 'trash_B'];
const materials = {
  Asphalt012: 1024, PavingStones138: 1024, Concrete034: 1024, Bricks059: 1024, Metal032: 512, MetalPlates006: 512,
  WoodFloor051: 1024, Planks012: 1024, Wood051: 512, Fabric030: 512, Ground037: 1024, Tiles074: 512, Rust004: 512,
  Marble012: 512, RoofingTiles003: 1024, CorrugatedSteel005: 512, PaintedPlaster017: 1024,
};
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
      { title: 'Universal Base Characters (Standard)', author: 'Quaternius', url: 'https://quaternius.com/packs/universalbasecharacters.html', license: 'CC0 1.0', use: 'Realistic rigged human with finger bones: the first-person arms and hands, and the third-person player, pedestrians and enemies. The suit, sleeve and cuff are generated from the skin mesh by tools/human.mjs.' },
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
      { title: 'City Kit (Commercial) 2.1', author: 'Kenney', url: 'https://kenney.nl/assets/city-kit-commercial', license: 'CC0 1.0', use: 'Buildings, awnings and overhangs.' },
      { title: 'City Kit (Suburban)', author: 'Kenney', url: 'https://kenney.nl/assets/city-kit-suburban', license: 'CC0 1.0', use: 'Houses, fences, planters, trees.' },
      { title: 'City Kit (Roads)', author: 'Kenney', url: 'https://kenney.nl/assets/city-kit-roads', license: 'CC0 1.0', use: 'Bridge pillars, street lights, poles, wires, signs, traffic lights, dumpsters, construction props.' },
      { title: 'Food Kit', author: 'Kenney', url: 'https://kenney.nl/assets/food-kit', license: 'CC0 1.0', use: 'Market stall goods, cans, barrels, crates.' },
      { title: 'Furniture Kit', author: 'Kenney', url: 'https://kenney.nl/assets/furniture-kit', license: 'CC0 1.0', use: 'Dojo and workshop interior furniture.' },
      { title: 'KayKit City Builder Bits 1.0', author: 'Kay Lousberg', url: 'https://github.com/KayKit-Game-Assets/KayKit-City-Builder-Bits-1.0', license: 'CC0 1.0', use: 'Cars, hydrants, trash, street lights, crates.' },
    ],
    build() {
      for (const [pack, names] of Object.entries(kenney)) for (const n of names) compressGlb(join(raw, 'kenney', pack, 'Models', 'GLB format', `${n}.glb`), join(out, 'props', `${n}.glb`));
      for (const n of furniture) compressGlb(join(raw, 'kenney', 'furniture-kit', 'Models', 'GLTF format', `${n}.glb`), join(out, 'props', `furn-${n}.glb`));
      for (const n of cityBits) compressGlb(join(raw, 'kaykit-city', `${n}.gltf`), join(out, 'props', `kk-${n}.glb`));
    },
  },
  textures: {
    credits: Object.keys(materials).map((mat) => ({ title: `${mat} (1K)`, author: 'ambientCG', url: `https://ambientcg.com/view?id=${mat}`, license: 'CC0 1.0', use: 'PBR material.' })),
    async build() {
      const tmpDir = join(root, 'node_modules/.cache/acg');
      for (const [mat, size] of Object.entries(materials)) {
        const x = join(tmpDir, mat);
        rmSync(x, { recursive: true, force: true });
        mkdirSync(x, { recursive: true });
        execFileSync('unzip', ['-qo', join(raw, 'acg', `${mat}.zip`), '-d', x]);
        const dstDir = join(out, 'textures', mat);
        mkdirSync(dstDir, { recursive: true });
        const maps = { Color: 'color', NormalGL: 'normal', Roughness: 'rough', Displacement: 'height' };
        for (const [suffix, name] of Object.entries(maps)) {
          const src = join(x, `${mat}_1K-JPG_${suffix}.jpg`);
          if (!existsSync(src)) continue;
          const s = name === 'height' ? Math.min(size, 512) : size;
          await sharp(src).resize(s, s).webp({ quality: name === 'normal' ? 90 : 82 }).toFile(join(dstDir, `${name}.webp`));
        }
      }
    },
  },
  hdri: {
    credits: [{ title: 'Night Bridge HDRI (2k)', author: 'Sergej Majboroda, Poly Haven', url: 'https://polyhaven.com/a/night_bridge', license: 'CC0 1.0', use: 'Environment lighting and wet-surface reflections.' }],
    build() { copyFileSync(join(raw, 'hdri', 'night_bridge_2k.hdr'), join(out, 'hdri', 'night_bridge_2k.hdr')); },
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

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])).filter((f) => !f.endsWith('manifest.json') && !f.endsWith('.DS_Store'));
}
const files = walk(out).sort().map((f) => ({ url: 'assets/' + relative(out, f), bytes: statSync(f).size }));
const manifest = { files, total: files.reduce((a, f) => a + f.bytes, 0) };
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest));

const lines = ['# Credits', '', 'Every third-party asset in `public/assets/` is listed here with its source and license. `tools/build-assets.mjs` compresses them from the raw downloads (meshopt for geometry, WebP for textures) and writes this file.', '', '| Asset | Author | License | Source | Used for |', '| --- | --- | --- | --- | --- |'];
for (const s of Object.values(sections)) for (const c of s.credits) lines.push(`| ${c.title} | ${c.author} | ${c.license} | ${c.url} | ${c.use} |`);
lines.push('', 'Typography is loaded from Google Fonts under the SIL Open Font License: Shippori Mincho B1, Zen Kaku Gothic New, and Inter.', '', 'Rain, ice, aura, and shock-ring effects, the generated clothing shells, the hand poses and gestures, and all UI are original to this repository.', '');
writeFileSync(join(root, 'CREDITS.md'), lines.join('\n'));
console.log(`assets: ${manifest.files.length} files, ${(manifest.total / 1e6).toFixed(1)} MB`);
