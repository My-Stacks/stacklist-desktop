'use strict';

const { app, BrowserWindow, shell, Menu, ipcMain, dialog, nativeImage } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');
const Store = require('electron-store');

// ---------------------------------------------------------------------------
// Dev-mode detection
// ---------------------------------------------------------------------------
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

app.name = isDev ? 'Stacklist Dev' : 'Stacklist';

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
  const startURL = isDev ? 'http://localhost:3000' : 'https://stacklist.app';
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

  // Persist window bounds on close
  win.on('close', () => {
    const isMaximized = win.isMaximized();
    // Only capture bounds when not maximized so we have a sane restored size
    const bounds = isMaximized ? {} : win.getBounds();
    store.set('windowBounds', { ...bounds, isMaximized });
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
      if (!hostname.endsWith('stacklist.app') && hostname !== 'localhost') {
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
        }
      });
  });

  autoUpdater.on('update-downloaded', () => {
    dialog
      .showMessageBox({
        type: 'info',
        title: 'Update Ready',
        message: 'A new version has been downloaded. Restart Stacklist to apply the update.',
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
    // Log but don't surface a dialog — update failures are non-critical
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

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png'));
    if (!icon.isEmpty()) app.dock.setIcon(icon);
  }

  Menu.setApplicationMenu(buildMenu());

  createWindow();

  if (!isDev) {
    setupAutoUpdater();
  }

  // macOS: re-create the window when the dock icon is clicked and no windows exist
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit on all windows closed, except on macOS where the app stays active
// until the user explicitly quits (Cmd+Q / app menu Quit).
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
