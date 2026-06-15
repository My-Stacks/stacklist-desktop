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
let startedProjectId = null;

/**
 * Start the FCM push receiver (or return the already-running instance's token).
 *
 * Config — Firebase web config + Web Push VAPID key — is supplied by the
 * renderer via the 'push:init' IPC. The web app already holds these values, so
 * the desktop shell stays free of project secrets and tracks dev/prod
 * automatically.
 *
 * @param {{ projectId: string, appId: string, apiKey: string, messagingSenderId: string, vapidKey?: string }} config
 * @param {{ store: import('electron-store'), getWindow: () => Electron.BrowserWindow | null, isAppHost: (hostname: string) => boolean }} deps
 * @returns {Promise<string|null>} FCM token to register with the backend, or null on failure
 */
function startPush(config, { store, getWindow, isAppHost }) {
  // A re-init for a different Firebase project (logout→login, dev↔prod switch)
  // must rebuild the receiver — otherwise the stale promise returns the prior
  // project's token and the backend registers the wrong device.
  if (startPromise && config.projectId !== startedProjectId) stopPush();
  if (startPromise) return startPromise;
  startedProjectId = config.projectId;

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
    showNotification(message, getWindow, isAppHost);
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

function showNotification(message, getWindow, isAppHost) {
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
    // It's attacker-controllable (any sender can craft the payload), so forward
    // only same-app targets — the renderer routes this client-side, bypassing
    // the will-navigate guard.
    const target = safeNavTarget(data.url, isAppHost);
    if (target) win.webContents.send('electron:push-navigate', target);
  });
  notification.show();
}

// Returns a forwardable nav target, or null. Relative app paths ('/cards/1')
// pass; absolute URLs only when their host is one of ours. '//' is rejected —
// it's a protocol-relative URL to an arbitrary host, not a path.
function safeNavTarget(url, isAppHost) {
  if (typeof url !== 'string' || !url) return null;
  if (url.startsWith('/') && !url.startsWith('//')) return url;
  try {
    return isAppHost(new URL(url).hostname) ? url : null;
  } catch {
    return null;
  }
}

function stopPush() {
  receiver?.destroy();
  receiver = null;
  startPromise = null;
  startedProjectId = null;
}

module.exports = { startPush, stopPush };
