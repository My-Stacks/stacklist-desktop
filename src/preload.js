'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronApp', {
  isElectron: true,
  platform: process.platform,
  // Synchronously resolved at preload so analytics can read it without await.
  version: ipcRenderer.sendSync('app:get-version-sync'),
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  copyURL: () => ipcRenderer.invoke('app:copy-url'),
  onFileDrop: (cb) => ipcRenderer.on('electron:file-drop', (_event, payload) => cb(payload)),
});
