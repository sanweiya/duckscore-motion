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
const { createStaticServer } = require('../scripts/static-server.cjs');

const appDir = path.resolve(__dirname, '..');
const isDev = !app.isPackaged;
// Works both unpacked and inside the asar: dev → <repo>/dist, packaged →
// <resources>/app.asar/dist. In asar builds `resourcesPath + '/dist'` would
// miss the app.asar segment and 404 everything (found the hard way).
const distDir = path.join(__dirname, '..', 'dist');

/** @type {import('electron').BrowserWindow | null} */
let win = null;
/** @type {import('node:http').Server | null} */
let server = null;

if (!app.requestSingleInstanceLock()) {
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
 */
function wireSaveDialog(webContents) {
  webContents.session.on('will-download', (event, item) => {
    event.preventDefault();
    const filePath = dialog.showSaveDialogSync(win, {
      title: '保存导出文件',
      defaultPath: item.getFilename(),
    });
    if (!filePath) {
      item.cancel();
      return;
    }
    item.setSavePath(filePath);
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

  await win.loadURL(`http://127.0.0.1:${port}/`);
}

app.whenReady().then(() => {
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
