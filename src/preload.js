'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Collect find-result listeners registered by the injected find bar
const findResultListeners = [];
ipcRenderer.on('find-result', (_, result) => {
  findResultListeners.forEach(cb => cb(result));
});

contextBridge.exposeInMainWorld('electronApp', {
  isElectron: true,
  platform: process.platform,
  getVersion:     ()           => ipcRenderer.invoke('app:get-version'),
  copyURL:        ()           => ipcRenderer.invoke('app:copy-url'),
  findInPage:     (text, opts) => ipcRenderer.invoke('app:find-in-page', text, opts),
  stopFindInPage: ()           => ipcRenderer.invoke('app:stop-find-in-page'),
  onFindResult:   (cb)         => { findResultListeners.push(cb); },
  onFileDrop:     (cb)         => { ipcRenderer.on('electron:file-drop', (_, payload) => cb(payload)); },
});
