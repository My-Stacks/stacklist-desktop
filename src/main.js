'use strict';

const { app, BrowserWindow, shell, Menu, ipcMain, dialog, nativeImage, clipboard, Tray, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const Store = require('electron-store');
const { startPush, stopPush } = require('./push');

// ---------------------------------------------------------------------------
// Dev-mode detection
// ---------------------------------------------------------------------------
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

app.name = isDev ? 'Stacklist Dev' : 'Stacklist';

// Kept alive across hide/show cycles so the web session is preserved.
let mainWin = null;
let tray = null;
// Set to true when the user explicitly quits (Cmd+Q / menu Quit).
let isQuitting = false;
// File dropped onto the dock icon before the window was ready to receive it.
let pendingFileDrop = null;
// Deep link received before the window existed (cold start via stacklist://).
let pendingDeepLink = null;

// ---------------------------------------------------------------------------
// Hostname allowlisting — exact match or subdomain only. A bare endsWith()
// would let e.g. "evilgoogle.com" pass as "google.com".
// ---------------------------------------------------------------------------
const APP_HOSTS = ['stacklist.com', 'stacklist.app'];
const POPUP_HOSTS = [...APP_HOSTS, 'firebaseapp.com', 'google.com', 'googleapis.com'];

function hostMatches(hostname, domain) {
  return hostname === domain || hostname.endsWith('.' + domain);
}

function isAppHost(hostname) {
  return hostname === 'localhost' || APP_HOSTS.some((d) => hostMatches(hostname, d));
}

// stacklist://stacklist.com/path → https://stacklist.com/path.
// Returns null unless the target resolves to one of our own hosts, so a
// crafted stacklist://evil.com link can't navigate the app window.
function resolveDeepLink(rawUrl) {
  try {
    const target = new URL(rawUrl.replace(/^stacklist:\/\//, 'https://'));
    if (APP_HOSTS.some((d) => hostMatches(target.hostname, d))) {
      return target.toString();
    }
  } catch {
    // malformed URL
  }
  return null;
}

function handleDeepLink(rawUrl) {
  const httpsUrl = resolveDeepLink(rawUrl);
  if (!httpsUrl) return;
  if (mainWin) {
    mainWin.show();
    mainWin.focus();
    mainWin.loadURL(httpsUrl);
  } else {
    // Cold start — load it once the window is created in whenReady.
    pendingDeepLink = httpsUrl;
  }
}

// ---------------------------------------------------------------------------
// Single-instance lock — required so Windows deep-links land in the running
// instance rather than launching a second copy.
// ---------------------------------------------------------------------------
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

app.on('second-instance', (_event, commandLine) => {
  // Bring the existing window to front
  if (mainWin) {
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.show();
    mainWin.focus();
  }
  // Windows: deep-link URL arrives as a command-line argument
  const url = commandLine.find(arg => arg.startsWith('stacklist://'));
  if (url) {
    handleDeepLink(url);
  }
});

// Windows: a deep link that *launches* the app (no instance running yet)
// arrives in this process's own argv, not via second-instance.
const coldStartDeepLink = process.argv.find(arg => arg.startsWith('stacklist://'));
if (coldStartDeepLink) {
  handleDeepLink(coldStartDeepLink);
}

// ---------------------------------------------------------------------------
// Protocol handler — stacklist:// deep links
// macOS fires open-url; Windows/Linux land in second-instance (above).
// ---------------------------------------------------------------------------
if (process.defaultApp && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient('stacklist', process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient('stacklist');
}

app.on('open-url', (event, url) => {
  event.preventDefault();
  // Buffers as pendingDeepLink when fired before the window exists (cold start).
  handleDeepLink(url);
});

// ---------------------------------------------------------------------------
// Dock icon file drop (macOS: drag a PDF/MD/TXT onto the dock icon)
// ---------------------------------------------------------------------------
const SUPPORTED_DROP_EXTS = new Set(['pdf', 'md', 'txt']);

app.on('open-file', (event, filePath) => {
  event.preventDefault();
  const ext = path.extname(filePath).toLowerCase().replace('.', '');
  if (!SUPPORTED_DROP_EXTS.has(ext)) return;

  const encoding = ext === 'pdf' ? null : 'utf8';
  fs.readFile(filePath, encoding, (err, content) => {
    if (err) { console.error('[open-file] read error:', err); return; }
    const payload = {
      name: path.basename(filePath),
      type: ext,
      // PDF bytes → base64 so they survive IPC serialisation; text stays as-is.
      content: ext === 'pdf' ? content.toString('base64') : content,
    };

    if (mainWin) {
      mainWin.show();
      mainWin.webContents.send('electron:file-drop', payload);
    } else {
      // App not open yet — hold the payload until the window is ready.
      pendingFileDrop = payload;
    }
  });
});

// ---------------------------------------------------------------------------
// Persistent window-state store
// ---------------------------------------------------------------------------
const store = new Store({
  defaults: {
    windowBounds: { width: 1280, height: 800, isMaximized: false },
  },
});

// ---------------------------------------------------------------------------
// createWindow
// ---------------------------------------------------------------------------
function createWindow() {
  const savedBounds = store.get('windowBounds');

  const win = new BrowserWindow({
    x: savedBounds.x,
    y: savedBounds.y,
    width: savedBounds.width,
    height: savedBounds.height,
    minWidth: 800,
    minHeight: 600,
    title: isDev ? 'Stacklist Dev' : 'Stacklist',
    show: false, // shown on 'ready-to-show' to avoid blank flash
    titleBarStyle: 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });

  // Restore maximized state after the window is created
  if (savedBounds.isMaximized) {
    win.maximize();
  }

  // Strip "Electron/x.x.x" from user agent so the app looks like plain Chrome
  const ua = win.webContents.getUserAgent().replace(/Electron\/[\d.]+ /, '');
  win.webContents.setUserAgent(ua);

  // In dev, try localhost first so we get unminified React error messages
  const startURL = isDev ? 'http://localhost:3000' : 'https://stacklist.com/login';
  win.loadURL(startURL);

  win.webContents.on('did-fail-load', (_event, code, desc, url) => {
    console.error('[electron] did-fail-load', code, desc, url);
  });

  // Show only once the web content is painted to avoid a white flash
  win.once('ready-to-show', () => {
    win.show();
    if (isDev) win.webContents.openDevTools();
  });

  win.webContents.on('before-input-event', (_event, input) => {
    // Cmd+Shift+I → DevTools
    if (input.meta && input.shift && input.key.toLowerCase() === 'i') {
      win.webContents.toggleDevTools();
    }
  });

  // On macOS: hide instead of close so the session is preserved.
  // Real quit (Cmd+Q) sets isQuitting=true first via before-quit.
  win.on('close', (e) => {
    const isMaximized = win.isMaximized();
    const bounds = isMaximized ? {} : win.getBounds();
    store.set('windowBounds', { ...bounds, isMaximized });

    if (process.platform === 'darwin' && !isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });

  // ---------------------------------------------------------------------------
  // External-link handling: new windows
  // ---------------------------------------------------------------------------
  win.webContents.setWindowOpenHandler(({ url }) => {
    let hostname;
    try {
      hostname = new URL(url).hostname;
    } catch {
      return { action: 'deny' };
    }

    console.log('[electron] window.open:', url);

    // Allow OAuth + app popups to open as native Electron windows.
    // Firebase opens firebaseapp.com first, which then redirects to Google.
    const isAllowedPopup =
      hostname === 'localhost' ||
      POPUP_HOSTS.some((d) => hostMatches(hostname, d));

    if (!isAllowedPopup) {
      shell.openExternal(url);
      return { action: 'deny' };
    }

    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 500,
        height: 650,
        autoHideMenuBar: true,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
        },
      },
    };
  });

  // External-link handling: same-window navigations
  win.webContents.on('will-navigate', (event, url) => {
    try {
      const { hostname } = new URL(url);
      if (!isAppHost(hostname)) {
        event.preventDefault();
        shell.openExternal(url);
      }
    } catch {
      // ignore malformed URLs
    }
  });

  return win;
}

// ---------------------------------------------------------------------------
// Application menu
// ---------------------------------------------------------------------------
function buildMenu() {
  const isMac = process.platform === 'darwin';

  const devToolsItem = {
    label: 'Toggle Developer Tools',
    accelerator: isMac ? 'Alt+Command+I' : 'Ctrl+Shift+I',
    click: (_, focusedWindow) => focusedWindow && focusedWindow.webContents.toggleDevTools(),
  };

  const template = [
    // macOS app menu (first menu = app name)
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),

    // File menu (non-macOS only — macOS quit lives in the app menu)
    ...(!isMac
      ? [
          {
            label: 'File',
            submenu: [{ role: 'quit' }],
          },
        ]
      : []),

    // Edit
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac
          ? [
              { role: 'pasteAndMatchStyle' },
              { role: 'delete' },
              { role: 'selectAll' },
            ]
          : [{ role: 'delete' }, { type: 'separator' }, { role: 'selectAll' }]),
        { type: 'separator' },
        {
          label: 'Copy Page URL',
          accelerator: 'CmdOrCtrl+Shift+C',
          click: () => { if (mainWin) clipboard.writeText(mainWin.webContents.getURL()); },
        },
      ],
    },

    // View
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        // Show DevTools only in development to avoid confusing end-users
        ...(isDev ? [devToolsItem] : []),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },

    // Window
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [
              { type: 'separator' },
              { role: 'front' },
              { type: 'separator' },
              { role: 'window' },
            ]
          : [{ role: 'close' }]),
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}

// ---------------------------------------------------------------------------
// Auto-updater setup
// ---------------------------------------------------------------------------
function setupAutoUpdater() {
  autoUpdater.autoDownload = false;

  autoUpdater.on('update-available', (info) => {
    dialog
      .showMessageBox({
        type: 'info',
        title: 'Update Available',
        message: `Version ${info.version} is available. Do you want to download it now?`,
        buttons: ['Download', 'Later'],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) {
          autoUpdater.downloadUpdate();
          // Show a non-blocking progress notification while downloading
          if (mainWin) {
            mainWin.setProgressBar(0.05); // indeterminate-ish start
          }
        }
      });
  });

  autoUpdater.on('download-progress', (progress) => {
    if (mainWin) {
      mainWin.setProgressBar(progress.percent / 100);
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    if (mainWin) mainWin.setProgressBar(-1); // clear progress bar
    dialog
      .showMessageBox({
        type: 'info',
        title: 'Update Ready',
        message: `Version ${info.version} is ready. Restart Stacklist to apply the update.`,
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) {
          // Set isQuitting before calling quitAndInstall so the hide-on-close
          // handler doesn't intercept the quit and hide the window instead.
          isQuitting = true;
          autoUpdater.quitAndInstall();
        }
      });
  });

  autoUpdater.on('error', (err) => {
    if (mainWin) mainWin.setProgressBar(-1);
    console.error('[auto-updater] error:', err);
  });

  // Delay the first check so it doesn't race with app startup
  setTimeout(() => {
    autoUpdater.checkForUpdates();
  }, 3000);
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------
ipcMain.handle('app:get-version', () => app.getVersion());
// Synchronous variant so the renderer can stamp the app version on its very
// first analytics event (including pre-auth login-page events).
ipcMain.on('app:get-version-sync', (e) => {
  e.returnValue = app.getVersion();
});
ipcMain.handle('app:copy-url', () => {
  if (mainWin) clipboard.writeText(mainWin.webContents.getURL());
});

// Renderer (web app) supplies its Firebase web config + Web Push VAPID key once
// authed; main registers the FCM token and returns it for backend registration.
ipcMain.handle('push:init', (_e, config) =>
  startPush(config, { store, getWindow: () => mainWin }),
);

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png'));
    if (!icon.isEmpty()) app.dock.setIcon(icon);
  }

  Menu.setApplicationMenu(buildMenu());

  mainWin = createWindow();

  // Cold-start deep link: replace the default start URL with the link target.
  if (pendingDeepLink) {
    mainWin.loadURL(pendingDeepLink);
    pendingDeepLink = null;
  }

  // Flush any file dropped onto the dock before the window existed.
  mainWin.webContents.once('did-finish-load', () => {
    if (pendingFileDrop) {
      mainWin.webContents.send('electron:file-drop', pendingFileDrop);
      pendingFileDrop = null;
    }
  });

  // ---------------------------------------------------------------------------
  // Tray icon — keeps the app accessible from the menu bar (Mac) or system
  // tray (Windows) even when the window is hidden.
  // ---------------------------------------------------------------------------
  const trayIconPath = path.join(__dirname, '..', 'build', 'icon.png');
  const trayImg = nativeImage.createFromPath(trayIconPath).resize({ width: 16, height: 16 });
  trayImg.setTemplateImage(true); // macOS: renders as monochrome template, adapts to dark/light bar
  tray = new Tray(trayImg);
  tray.setToolTip('Stacklist');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Stacklist', click: () => { mainWin.show(); mainWin.focus(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
  ]));
  // Left-click: show/focus (macOS shows context menu on both clicks by default;
  // the explicit click handler makes left-click bring the window instead)
  tray.on('click', () => {
    if (mainWin.isVisible()) {
      mainWin.focus();
    } else {
      mainWin.show();
      mainWin.focus();
    }
  });

  // ---------------------------------------------------------------------------
  // Global shortcut — bring Stacklist to front from anywhere in the OS.
  // ---------------------------------------------------------------------------
  const registered = globalShortcut.register('CommandOrControl+Shift+Space', () => {
    if (mainWin) {
      mainWin.show();
      mainWin.focus();
    }
  });
  if (!registered) {
    console.warn('[global-shortcut] CommandOrControl+Shift+Space could not be registered (conflict with another app)');
  }

  if (!isDev) {
    setupAutoUpdater();
  }

  // macOS: show the existing hidden window, or create one if it was never made.
  app.on('activate', () => {
    if (mainWin) {
      mainWin.show();
    } else {
      mainWin = createWindow();
    }
  });
});

app.on('before-quit', () => {
  isQuitting = true;
  stopPush();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

// On non-macOS, quit when all windows are closed.
// On macOS windows are hidden (not closed) so this only fires on explicit quit.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
