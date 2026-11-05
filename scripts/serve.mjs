/**
 * Minimal static server for `dist/` (no dependencies).
 *
 * The app needs a real http origin: alphaTab fetches its worker script, fonts
 * and soundfont, and WebCodecs/workers/clipboard all prefer a secure context.
 * `http://127.0.0.1` counts as secure in Chromium, so this is enough.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.join(appDir, 'dist');
const port = Number(process.env.PORT ?? process.argv[2] ?? 4173);
const host = process.env.HOST ?? '127.0.0.1';

const types = new Map(Object.entries({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
  '.sf2': 'application/octet-stream',
  '.sf3': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
}));

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    // Malformed percent-encoding (e.g. "/%"): reject instead of crashing.
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('Bad request');
    return;
  }
  if (pathname.includes('\0')) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('Bad request');
    return;
  }
  if (pathname.endsWith('/')) pathname += 'index.html';

  const target = path.resolve(root, `.${pathname}`);
  if (target !== root && !target.startsWith(root + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  let info;
  try {
    info = await stat(target);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
    return;
  }
  if (!info.isFile()) {
    res.writeHead(404).end('Not found');
    return;
  }

  res.writeHead(200, {
    'content-type': types.get(path.extname(target).toLowerCase()) ?? 'application/octet-stream',
    'content-length': String(info.size),
    'cache-control': 'no-cache',
    'x-content-type-options': 'nosniff',
  });
  createReadStream(target).on('error', () => res.destroy()).pipe(res);
});

server.listen(port, host, () => {
  console.log(`GP Studio: http://${host}:${port}/`);
  console.log('Stop with Ctrl+C.');
});
