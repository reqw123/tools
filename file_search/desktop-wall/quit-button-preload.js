'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// 結束按鈕視窗——只需要「通知主行程結束整個程式」這一條管道。
// contextIsolation:true，不 require 任何本地檔案（跟 hint-preload.js 同原則）。
contextBridge.exposeInMainWorld('dwQuit', {
  quit: () => ipcRenderer.send('dw-quit'),
});
