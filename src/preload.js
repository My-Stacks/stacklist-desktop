'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronApp', {
  isElectron: true,
  platform: process.platform,
  getVersion: () => ipcRenderer.invoke('app:get-version'),
});
