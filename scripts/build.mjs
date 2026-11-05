/**
 * Build the standalone web app into `dist/`.
 *
 * The UI is bundled from `../src` + `../core`, and the alphaTab runtime assets
 * are copied from `../vendor` so the result is a plain static directory that
 * any server (or, later, Electron) can host.
 */
import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendorDir = path.join(appDir, 'vendor');
const dist = path.join(appDir, 'dist');
const assets = path.join(dist, 'assets');

await rm(dist, { recursive: true, force: true });
await mkdir(assets, { recursive: true });

const started = Date.now();
await build({
  entryPoints: [path.join(appDir, 'src/main.ts')],
  outfile: path.join(dist, 'app.js'),
  bundle: true,
  minify: true,
  sourcemap: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome110', 'edge110', 'firefox115', 'safari16'],
  // The shared components resolve their JSX through the live React binding.
  jsx: 'transform',
  jsxFactory: 'ReactRuntime.createElement',
  jsxFragment: 'ReactRuntime.Fragment',
  define: { 'import.meta.url': 'undefined' },
  legalComments: 'inline',
  charset: 'utf8',
  logLevel: 'info',
});

await cp(path.join(appDir, 'index.html'), path.join(dist, 'index.html'));
await cp(path.join(appDir, 'src/app.css'), path.join(dist, 'app.css'));
// Site branding (favicon, logo). Swapping the logo is a file drop: index.html
// references ./brand/favicon.svg, which resolves under any deploy sub-path.
await cp(path.join(appDir, 'brand'), path.join(dist, 'brand'), { recursive: true });

// alphaTab worker entry, SMuFL fonts and the Sonivox soundfont.
await cp(path.join(vendorDir, 'alphaTab.mjs'), path.join(assets, 'alphaTab.mjs'));
// Classic build used as the audio-export worker: alphaTab creates the worker
// with `importScripts`, which cannot load the ESM entry.
await cp(path.join(vendorDir, 'alphaTab.worker.js'), path.join(assets, 'alphaTab.worker.js'));
await cp(path.join(vendorDir, 'alphaTab.core.mjs'), path.join(assets, 'alphaTab.core.mjs'));
await cp(path.join(vendorDir, 'alphaTab-LICENSE'), path.join(assets, 'alphaTab-LICENSE'));
await cp(path.join(vendorDir, 'font'), path.join(assets, 'font'), { recursive: true });
await cp(path.join(vendorDir, 'soundfont'), path.join(assets, 'soundfont'), { recursive: true });

console.log(`web build ready in ${dist} (${Date.now() - started} ms)`);
