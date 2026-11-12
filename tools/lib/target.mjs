// What every check script needs to know before it opens a browser: which
// build to test and which options it was given. A URL may come as a bare
// argument or as --url. Without one the script serves dist/ itself, so a
// check never silently tests something other than the build it was pointed at.
// Options are --name value, or --name alone for a flag.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function parseArgs(argv) {
  const args = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { positional.push(a); continue; }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) args[a.slice(2)] = 'true';
    else { args[a.slice(2)] = next; i++; }
  }
  return { args, positional };
}

export async function resolveTarget(argv = process.argv.slice(2)) {
  const { args, positional } = parseArgs(argv);
  const bare = positional.find((p) => /^https?:\/\//.test(p));
  const stray = positional.filter((p) => p !== bare);
  if (stray.length) throw new Error(`unexpected argument ${stray[0]}: pass a URL as http(s)://... or use --url`);
  let url = args.url ?? bare;
  let server = null;
  const stop = () => { if (server && !server.killed) server.kill(); server = null; };
  if (!url) {
    if (!existsSync('dist/index.html')) throw new Error('dist/ missing: run npm run build first');
    const port = args.port ?? '4173';
    const vite = resolve('node_modules/vite/bin/vite.js');
    server = spawn(process.execPath, [vite, 'preview', '--port', port, '--strictPort'], { stdio: 'ignore' });
    url = `http://localhost:${port}/`;
    for (let i = 0; i < 100; i++) {
      if (server.exitCode !== null) throw new Error(`vite preview exited: is port ${port} taken?`);
      try { if ((await fetch(url)).ok) break; } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    process.on('exit', stop);
  }
  if (!url.endsWith('/')) url += '/';
  return { url, args, stop };
}
