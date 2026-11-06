/**
 * Minimal static server for `dist/` (no dependencies).
 *
 * The app needs a real http origin: alphaTab fetches its worker script, fonts
 * and soundfont, and WebCodecs/workers/clipboard all prefer a secure context.
 * `http://127.0.0.1` counts as secure in Chromium, so plain http is enough.
 *
 * The request handler is shared with the Electron shell
 * (`desktop/main.cjs` requires `./static-server.cjs` too).
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { createStaticHandler, createStaticServer } = createRequire(import.meta.url)('./static-server.cjs');

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.join(appDir, 'dist');
const port = Number(process.env.PORT ?? process.argv[2] ?? 4173);
const host = process.env.HOST ?? '127.0.0.1';

/**
 * WebCodecs (video export) only runs in a secure context. `http://127.0.0.1`
 * counts as one, a LAN address like `http://192.168.1.9` does not - so a second
 * HTTPS listener with a self-signed certificate is offered for LAN clients.
 */
const tlsPort = Number(process.env.TLS_PORT ?? 0);
const certPath = process.env.TLS_CERT ?? path.join(appDir, 'certs', 'dev-cert.pem');
const keyPath = process.env.TLS_KEY ?? path.join(appDir, 'certs', 'dev-key.pem');
const tlsAvailable = tlsPort > 0 && existsSync(certPath) && existsSync(keyPath);

createStaticServer(root).listen(port, host, () => {
  console.log(`Duck Score Motion: http://${host}:${port}/`);
});

if (tlsAvailable) {
  const tlsServer = https.createServer(
    { cert: readFileSync(certPath), key: readFileSync(keyPath) },
    createStaticHandler(root),
  );
  tlsServer.listen(tlsPort, host, () => {
    console.log(`Duck Score Motion (secure, export works): https://${host}:${tlsPort}/`);
    console.log('The certificate is self-signed: accept the browser warning once.');
  });
} else if (tlsPort > 0) {
  console.log(`TLS port requested but no certificate found at ${certPath} / ${keyPath}.`);
}
console.log('Stop with Ctrl+C.');
