'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// contextIsolation:true + sandbox 預設——只曝露這個視窗需要的 IPC 管道，
// 不 require 任何本地檔案（control-center/preload.js 記過這個坑）。
contextBridge.exposeInMainWorld('dw', {
  getState: () => ipcRenderer.invoke('dw-get-state'),
  setWall: (w) => ipcRenderer.invoke('dw-set-wall', w),
  setMode: (m) => ipcRenderer.invoke('dw-set-mode', m),
  setOpacity: (v) => ipcRenderer.invoke('dw-set-opacity', v),
  setStartMode: (m) => ipcRenderer.invoke('dw-set-start-mode', m),
  setAutostart: (on) => ipcRenderer.invoke('dw-set-autostart', on),
  setDisplay: (id) => ipcRenderer.invoke('dw-set-display', id),
  setShortcut: (action, accel) => ipcRenderer.invoke('dw-set-shortcut', action, accel),
  resetShortcuts: () => ipcRenderer.invoke('dw-reset-shortcuts'),
  openUserData: () => ipcRenderer.send('dw-open-userdata'),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
});
