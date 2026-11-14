// Serves the built game from dist/. Realtime multiplayer (#44) will attach here.
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: { port: { type: 'string', default: '8095' }, host: { type: 'string', default: '127.0.0.1' } },
});
const root = resolve(import.meta.dirname, '../dist');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.hdr': 'application/octet-stream', '.ktx2': 'image/ktx2', '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

async function file(path) {
  const s = await stat(path).catch(() => null);
  return s?.isFile() ? s : null;
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/healthz') return res.end('ok');
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.writeHead(405).end();

  let path = join(root, normalize(decodeURIComponent(url.pathname)));
  if (path !== root && !path.startsWith(root + '/')) return res.writeHead(400).end();
  let s = await file(path);
  if (!s && !extname(path)) s = await file((path = join(root, 'index.html')));
  if (!s) return res.writeHead(404).end('not found');

  const hashed = path.startsWith(join(root, 'assets')) && /-[\w-]{8,}\.\w+$/.test(path);
  res.writeHead(200, {
    'content-type': TYPES[extname(path)] ?? 'application/octet-stream',
    'content-length': s.size,
    'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(path).pipe(res);
}).listen(Number(values.port), values.host, () => {
  console.log(`zenkoverse serving ${root} on http://${values.host}:${values.port}`);
});
