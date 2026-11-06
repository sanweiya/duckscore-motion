/**
 * Minimal static file handler for the app's static directory (no dependencies).
 *
 * Shared by two hosts so web and desktop never diverge in serving behaviour:
 * - `scripts/serve.mjs` (CLI: `npm start` / `npm run serve`, plus optional TLS)
 * - `desktop/main.cjs` (Electron window, ephemeral 127.0.0.1 port)
 *
 * The app needs a real http origin: alphaTab fetches its worker script, fonts
 * and soundfont, and WebCodecs/workers/clipboard all prefer a secure context.
 * `http://127.0.0.1` counts as secure in Chromium, so plain http is enough.
 */
'use strict';

const { createReadStream } = require('node:fs');
const { stat } = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');

const MIME_TYPES = new Map(Object.entries({
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

/** Build an http request handler that serves `root` (never above it). */
function createStaticHandler(rootArg) {
  const root = path.resolve(rootArg);
  return async (req, res) => {
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
      'content-type': MIME_TYPES.get(path.extname(target).toLowerCase()) ?? 'application/octet-stream',
      'content-length': String(info.size),
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    createReadStream(target).on('error', () => res.destroy()).pipe(res);
  };
}

/** Create an http.Server serving `root` (start listening yourself). */
function createStaticServer(rootArg) {
  return http.createServer(createStaticHandler(rootArg));
}

module.exports = { MIME_TYPES, createStaticHandler, createStaticServer };
