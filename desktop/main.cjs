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
const fs = require('node:fs');
const { app, BrowserWindow, Menu, dialog, shell, screen } = require('electron');
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

/**
 * Local storage (the three 'memory' keys: player layout / studio layout /
 * export settings) is scoped per origin (protocol + host + port) in Chromium.
 * With an ephemeral port every launch is a brand-new origin and NOTHING would
 * be remembered across desktop launches - so listen on a stable port. The app
 * enforces a single instance, and `npm run serve` uses 4173, so clashes are
 * rare; if the port is taken we fall back to an ephemeral one (settings just
 * won't persist during that session) and log it.
 */
const INTERNAL_PORT = 45837;

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(port, '127.0.0.1', resolve);
  });
}

async function startServer() {
  // macOS keeps the process alive after the last window closes; re-creating the
  // window must reuse the running listener. Binding the same port a second time
  // would fail and silently drop the session to an ephemeral origin (i.e. lose
  // the remembered settings), so reuse before creating a new server.
  if (server && server.listening) return server.address().port;

  server = createStaticServer(distDir);
  let port;
  let persistent = true;
  try {
    await listen(server, INTERNAL_PORT);
    port = INTERNAL_PORT;
  } catch (error) {
    log(`port ${INTERNAL_PORT} busy (${error?.code ?? error}), using fallback: persistence off this session`);
    persistent = false;
    await new Promise((resolve) => {
      server.close(() => resolve());
    });
    await listen(server, 0);
    port = server.address().port;
  }
  // Keep in mind for diagnostics: an ephemeral port erases the app's settings
  // memory for this run only; nothing else keys off the port.
  if (persistent) log(`internal origin: http://127.0.0.1:${port}/`);
  else log(`internal origin: http://127.0.0.1:${port}/ (ephemeral)`);
  return port;
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

/**
 * Window geometry memory (userData/window-state.json).
 *
 * Fixed pixel sizes are dangerous on HiDPI: the user's 2880x1800 panel runs a
 * 2x scale, so an 860-tall window fills the whole vertical screen. Defaults are
 * derived from the logical work area instead, and the last bounds are reused.
 */
const STATE_FILE = () => path.join(app.getPath('userData'), 'window-state.json');

function defaultBounds() {
  const { workAreaSize } = screen.getPrimaryDisplay();
  return {
    width: Math.min(1200, Math.round(workAreaSize.width * 0.82)),
    height: Math.min(780, Math.round(workAreaSize.height * 0.8)),
  };
}

function loadBounds() {
  try {
    const saved = JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8'));
    const { workArea } = screen.getPrimaryDisplay();
    const width = Math.min(saved.width ?? defaultBounds().width, workArea.width);
    const height = Math.min(saved.height ?? defaultBounds().height, workArea.height);
    return {
      width,
      height,
      x: Math.min(Math.max(saved.x ?? 0, workArea.x), Math.max(workArea.x, workArea.x + workArea.width - width)),
      y: Math.min(Math.max(saved.y ?? 0, workArea.y), Math.max(workArea.y, workArea.y + workArea.height - height)),
      maximized: !!saved.maximized,
    };
  } catch {
    const fallback = defaultBounds();
    return { ...fallback, x: undefined, y: undefined, maximized: false };
  }
}

function persistState() {
  if (!win || win.isDestroyed()) return;
  try {
    fs.writeFileSync(STATE_FILE(), JSON.stringify({
      ...win.getNormalBounds(),
      maximized: win.isMaximized(),
    }, null, 1));
  } catch (error) {
log(`persist window state failed: ${error?.message ?? error}`);
  }
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

  const bounds = loadBounds();
  win = new BrowserWindow({
    ...bounds,
    minWidth: 720,
    minHeight: 560,
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
  if (bounds.maximized && !isDev) win.maximize();

  if (!isDev) {
    // macOS resolves Cmd+Q / Cmd+W and the Edit roles (Cmd+C / Cmd+V) through
    // the application menu: with no menu those shortcuts silently stop working.
    // Windows/Linux keep the plain menu-less window (F12 toggle below in dev).
    Menu.setApplicationMenu(
      process.platform === 'darwin'
        ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }])
        : null,
    );
  }

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
  win.on('close', () => persistState());
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
  // macOS convention: the app (and its internal server) stays alive, and the
  // activate handler above re-creates the window from the dock icon.
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  if (server) server.close();
});
