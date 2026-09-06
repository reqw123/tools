'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// 快捷鍵提示視窗——只需要「收一個要顯示的字串」這一條管道。
// contextIsolation:true，不 require 任何本地檔案（跟 settings-preload.js 同原則）。
contextBridge.exposeInMainWorld('dwHint', {
  onHint: (cb) => ipcRenderer.on('hint', (_e, text) => cb(String(text))),
});
