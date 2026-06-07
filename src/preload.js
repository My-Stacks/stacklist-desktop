'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronApp', {
  isElectron: true,
  platform: process.platform,
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  copyURL: () => ipcRenderer.invoke('app:copy-url'),
});

// ---------------------------------------------------------------------------
// Draggable title bar + copy URL button
// Injected here (preload) rather than via executeJavaScript so it survives
// React hydration and runs reliably on every page load.
// ---------------------------------------------------------------------------
function injectTitleBar() {
  if (document.getElementById('_el-bar')) return;

  const style = document.createElement('style');
  style.textContent = `
    #_el-bar {
      position: fixed;
      top: 0; left: 0; right: 0;
      height: 28px;
      -webkit-app-region: drag;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: flex-end;
    }
    #_el-copy {
      -webkit-app-region: no-drag;
      margin-right: 10px;
      width: 22px; height: 22px;
      display: flex; align-items: center; justify-content: center;
      border: none; background: none; padding: 0;
      cursor: pointer;
      color: rgba(128,128,128,0.5);
      opacity: 0;
      transition: opacity 0.15s, color 0.15s;
      border-radius: 4px;
    }
    #_el-bar:hover #_el-copy { opacity: 1; }
    #_el-copy:hover { color: rgba(128,128,128,1) !important; }
  `;
  document.head.appendChild(style);

  const bar = document.createElement('div');
  bar.id = '_el-bar';

  const btn = document.createElement('button');
  btn.id = '_el-copy';
  btn.title = 'Copy page URL';
  btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
  btn.addEventListener('click', () => ipcRenderer.invoke('app:copy-url'));

  bar.appendChild(btn);
  document.body.appendChild(bar);
}

window.addEventListener('DOMContentLoaded', injectTitleBar);
