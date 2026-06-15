'use strict';

const { Notification } = require('electron');
const PushReceiver = require('@eneris/push-receiver').default;

// electron-store keys — credentials let us keep the same FCM token across
// restarts; persistentIds suppress replay of messages already delivered.
const STORE_CREDENTIALS = 'push.credentials';
const STORE_PERSISTENT_IDS = 'push.persistentIds';
const MAX_PERSISTENT_IDS = 100;

let receiver = null;
let startPromise = null;

/**
 * Start the FCM push receiver (or return the already-running instance's token).
 *
 * Config — Firebase web config + Web Push VAPID key — is supplied by the
 * renderer via the 'push:init' IPC. The web app already holds these values, so
 * the desktop shell stays free of project secrets and tracks dev/prod
 * automatically.
 *
 * @param {{ projectId: string, appId: string, apiKey: string, messagingSenderId: string, vapidKey?: string }} config
 * @param {{ store: import('electron-store'), getWindow: () => Electron.BrowserWindow | null }} deps
 * @returns {Promise<string|null>} FCM token to register with the backend, or null on failure
 */
function startPush(config, { store, getWindow }) {
  if (startPromise) return startPromise;

  const { vapidKey, ...firebase } = config;

  receiver = new PushReceiver({
    firebase,
    ...(vapidKey ? { vapidKey } : {}),
    credentials: store.get(STORE_CREDENTIALS),
    persistentIds: store.get(STORE_PERSISTENT_IDS, []),
  });

  receiver.onCredentialsChanged(({ newCredentials }) => {
    store.set(STORE_CREDENTIALS, newCredentials);
  });

  receiver.onNotification(({ message, persistentId }) => {
    rememberPersistentId(store, persistentId);
    showNotification(message, getWindow);
  });

  startPromise = receiver
    .connect()
    .then(() => receiver.fcmToken || null)
    .catch((err) => {
      console.error('[push] connect failed:', err);
      receiver = null;
      startPromise = null;
      return null;
    });

  return startPromise;
}

function rememberPersistentId(store, id) {
  if (!id) return;
  const ids = store.get(STORE_PERSISTENT_IDS, []);
  ids.push(id);
  store.set(STORE_PERSISTENT_IDS, ids.slice(-MAX_PERSISTENT_IDS));
}

function showNotification(message, getWindow) {
  if (!Notification.isSupported()) return;

  const data = message?.data ?? {};
  const title = message?.notification?.title || data.title || 'Stacklist';
  const body = message?.notification?.body || data.body || '';

  const notification = new Notification({ title, body });
  notification.on('click', () => {
    const win = getWindow();
    if (!win) return;
    win.show();
    // data.url mirrors the deep-link contract the mobile app already uses.
    if (data.url) win.webContents.send('electron:push-navigate', String(data.url));
  });
  notification.show();
}

function stopPush() {
  receiver?.destroy();
  receiver = null;
  startPromise = null;
}

module.exports = { startPush, stopPush };
