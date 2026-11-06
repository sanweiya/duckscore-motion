/**
 * Electron shell for the desktop build.
 *
 * The payload is the same `dist/` the web version deploys - one build, two
 * targets (see docs/desktop.md). The shell only:
 * - serves `dist/` on an ephemeral `http://127.0.0.1` port (secure context, so
 *   WebCodecs / workers / soundfont fetch keep working; no custom protocol),
 * - opens a plain BrowserWindow on it (React owns everything inside),
 * - turns `<a download>` (exported video / audio save) into a native save dialog,
 * - keeps app data (the two layout memories + export settings in localStorage)
 *   inside userData, so desktop and browser remember independently.
 */
'use strict';

const path = require('node:path');
const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const { createStaticServer } = require('../scripts/static-server.cjs');const appDir = path.resolve(__dirname, '..');
const isDev = !app.isPackaged;
// Works both unpacked and inside the asar: dev → <repo>/dist, packaged →
// <resources>/app.asar/dist. In asar builds `resourcesPath + '/dist'` would
// miss the app.asar segment and 404 everything (found the hard way).
const distDir = path.join(__dirname, '..', 'dist');

/** @type {import('electron').BrowserWindow | null} */
let win = null;
/** @type {import('node:http').Server | null} */
let server = null;

const log = (...parts) => console.log(`[desktop ${new Date().toISOString()}]`, ...parts);
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // Another app copy (e.g. the user double-launched, or a leftover instance
  // still runs): quit cleanly without opening a half-broken window. Electron
  // would otherwise still fire whenReady, and a window created in that race
  // "loads" garbage ERR frames - observed in the wild.
  log('another instance is running; quitting');
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
}

async function startServer() {
  server = createStaticServer(distDir);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve); // ephemeral port: no clash with `npm run serve`
  });
  return server.address().port;
}

/**
 * Save exports through the native dialog instead of the browser default
 * (which would dump files into ~/Downloads without asking).
 * `GSP_AUTO_SAVE=/abs/path` skips the dialog (used by automated tests).
 */
function wireSaveDialog(webContents) {
  if (process.env.GSP_NO_WIRE) {
    log('will-download wiring disabled for diagnosis');
    webContents.session.on('will-download', (event, item) => {
      log(`observed download ${item.getURL().slice(0, 64)} (${item.getFilename()})`);
    });
    return;
  }
  webContents.session.on('will-download', (event, item) => {
    // eslint-disable-next-line no-console
    log(`will-download url=${item.getURL().slice(0, 96)} id=${item.id ?? '?'}`);
    // NOTE: no event.preventDefault() here — that would *cancel* the download.
    // Also: do NOT open our own dialog.showSaveDialog from the handler and do
    // not prefill item.setSavePath that we later replace: when the handler
    // returns with an empty save path, Electron's download manager opens its
    // OWN save dialog (title = item URL) → the user saw two dialogs per save.
    // The supported path is setSaveDialogOptions: one dialog Electron itself
    // shows, using our title + default location; cancelling it cancels the
    // download (DOWNLOAD_INTERRUPT_REASON_USER_CANCELED) in one step.
    item.setSaveDialogOptions({
      title: '保存导出文件',
      defaultPath: path.join(app.getPath('downloads'), item.getFilename()),
    });
    item.once('done', (_e, state) => log(`done id=${item.id ?? '?'} state=${state} -> ${item.getSavePath()}`));
  });
}

async function createWindow() {
  let port;
  try {
    port = await startServer();
  } catch (error) {
    dialog.showErrorBox('Duck Score Motion', `内部资源服务启动失败:\n${error?.stack ?? error}`);
    app.quit();
    return;
  }

  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#f3f8fd',
    autoHideMenuBar: true,
    icon: path.join(distDir, 'brand', 'icon-512.png'),
    webPreferences: {
      // Defaults are the safe ones; nothing in the renderer needs Node.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (!isDev) Menu.setApplicationMenu(null); // plain app window; F12 toggle below in dev

  if (isDev) {
    win.webContents.on('before-input-event', (_event, input) => {
      if (input.type === 'keyDown' && (input.key === 'F12' || (input.control && input.key.toLowerCase() === 'i'))) {
        win.webContents.toggleDevTools();
      }
    });
  }

  // Keep the shell centered on app URLs; open external http(s) links (credits,
  // specs) in the system browser instead of spawning windows.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  wireSaveDialog(win.webContents);
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    win = null;
  });

  // Transient net races (e.g. the internal listener settling late) must not
  // kill the app or show a blank frame: retry, then surface a dialog.
  const url = `http://127.0.0.1:${port}/`;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await win.loadURL(url);
      return; // resolved (even with ERR codes if the page still painted)
    } catch (error) {
      if (win.isDestroyed()) return;
      // eslint-disable-next-line no-console
      console.error(`[desktop] load attempt ${attempt} failed:`, error?.message ?? error);
      if (attempt === 3) continue; // leave the retry loop; user sees whatever loaded
      await new Promise((r) => { setTimeout(r, 300 * attempt); });
    }
  }
  // eslint-disable-next-line no-console
  console.error('[desktop] load did not settle cleanly:', url);
}

app.whenReady().then(() => {
  if (!gotLock) return;
  createWindow();
  app.on('activate', () => {
    // macOS convention: clicking the dock icon recreates the window.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (server) server.close();
  app.quit(); // Windows/Linux convention; not status-bar style
});
