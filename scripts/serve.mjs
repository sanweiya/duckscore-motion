/**
 * Minimal static server for `dist/` (no dependencies).
 *
 * The app needs a real http origin: alphaTab fetches its worker script, fonts
 * and soundfont, and WebCodecs/workers/clipboard all prefer a secure context.
 * `http://127.0.0.1` counts as secure in Chromium, so this is enough.
 */
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
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

/**
 * WebCodecs (video export) only runs in a secure context. `http://127.0.0.1`
 * counts as one, a LAN address like `http://192.168.1.9` does not - so a second
 * HTTPS listener with a self-signed certificate is offered for LAN clients.
 */
const tlsPort = Number(process.env.TLS_PORT ?? 0);
const certPath = process.env.TLS_CERT ?? path.join(appDir, 'certs', 'dev-cert.pem');
const keyPath = process.env.TLS_KEY ?? path.join(appDir, 'certs', 'dev-key.pem');
const tlsAvailable = tlsPort > 0 && existsSync(certPath) && existsSync(keyPath);

const handler = async (req, res) => {
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
};

const server = http.createServer(handler);
server.listen(port, host, () => {
  console.log(`Duck Score Motion: http://${host}:${port}/`);
});

if (tlsAvailable) {
  const tlsServer = https.createServer(
    { cert: readFileSync(certPath), key: readFileSync(keyPath) },
    handler,
  );
  tlsServer.listen(tlsPort, host, () => {
    console.log(`Duck Score Motion (secure, export works): https://${host}:${tlsPort}/`);
    console.log('The certificate is self-signed: accept the browser warning once.');
  });
} else if (tlsPort > 0) {
  console.log(`TLS port requested but no certificate found at ${certPath} / ${keyPath}.`);
}
console.log('Stop with Ctrl+C.');
