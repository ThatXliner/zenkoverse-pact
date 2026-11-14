#!/usr/bin/env node
// Writes public/assets/manifest.json from what is on disk: the byte list the
// loading bar reads. build-assets.mjs calls this at the end; run it alone
// after adding or removing an asset by hand.
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

export function writeManifest(root) {
  const out = join(root, 'public/assets');
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])).filter((f) => !f.endsWith('manifest.json') && !f.endsWith('.DS_Store'));
  const files = walk(out).sort().map((f) => ({ url: 'assets/' + relative(out, f), bytes: statSync(f).size }));
  const manifest = { files, total: files.reduce((a, f) => a + f.bytes, 0) };
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest));
  return manifest;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const m = writeManifest(new URL('..', import.meta.url).pathname);
  console.log(`assets: ${m.files.length} files, ${(m.total / 1e6).toFixed(2)} MB`);
}
