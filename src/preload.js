'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronApp', {
  isElectron: true,
  platform:   process.platform,
  getVersion: ()   => ipcRenderer.invoke('app:get-version'),
  copyURL:    ()   => ipcRenderer.invoke('app:copy-url'),
  onFileDrop: (cb) => { ipcRenderer.on('electron:file-drop', (_, payload) => cb(payload)); },
});
