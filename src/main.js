'use strict';

const { app, BrowserWindow, shell, Menu, ipcMain, dialog, nativeImage, clipboard } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');
const Store = require('electron-store');

// ---------------------------------------------------------------------------
// Dev-mode detection
// ---------------------------------------------------------------------------
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

app.name = isDev ? 'Stacklist Dev' : 'Stacklist';

// Kept alive across hide/show cycles so the web session is preserved.
let mainWin = null;
// Set to true when the user explicitly quits (Cmd+Q / menu Quit).
let isQuitting = false;

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
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
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

  win.webContents.on('dom-ready', () => {
    console.log('[electron] dom-ready:', win.webContents.getURL());
    if (isDev) {
      // After 3s check whether Firebase auth ever resolved
      setTimeout(() => {
        win.webContents.executeJavaScript(`
          (() => {
            const store = window.__zustand_stores__;
            console.log('[electron] 3s check — title:', document.title, 'url:', location.href);
          })();
        `).catch(() => {});
      }, 3000);
    }
  });

  win.webContents.on('did-fail-load', (event, code, desc, url) => {
    console.error('[electron] did-fail-load', code, desc, url);
  });


  // Show only once the web content is painted to avoid a white flash
  win.once('ready-to-show', () => {
    win.show();
    if (isDev) win.webContents.openDevTools();
  });

  // Cmd+Shift+I opens DevTools in any build (useful for diagnosing prod issues)
  win.webContents.on('before-input-event', (event, input) => {
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
      hostname.endsWith('stacklist.app') ||
      hostname.endsWith('stacklist.com') ||
      hostname.endsWith('firebaseapp.com') ||
      hostname.endsWith('google.com') ||
      hostname.endsWith('googleapis.com');

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
      if (!hostname.endsWith('stacklist.app') && !hostname.endsWith('stacklist.com') && hostname !== 'localhost') {
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
ipcMain.handle('app:copy-url', () => {
  if (mainWin) clipboard.writeText(mainWin.webContents.getURL());
});

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
});

// On non-macOS, quit when all windows are closed.
// On macOS windows are hidden (not closed) so this only fires on explicit quit.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
