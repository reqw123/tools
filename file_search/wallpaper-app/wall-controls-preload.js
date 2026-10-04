'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// 右下角控制列視窗（顯示／隱藏牆、互動／穿透）——只開三條管道：兩個切換
// 動作、收主行程推過來的目前狀態。contextIsolation:true，不 require 任何本地
// 檔案（跟 quit-button-preload.js 同原則）。
contextBridge.exposeInMainWorld('dwControls', {
  toggleVisible: () => ipcRenderer.send('dw-toggle-visible'),
  toggleMode: () => ipcRenderer.send('dw-toggle-mode'),
  // state: { mode: 'interactive'|'background', visible: boolean, keys: { mode, visible } }
  onState: (cb) => ipcRenderer.on('dw-controls-state', (_e, state) => cb(state)),
});
