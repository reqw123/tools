'use strict';
// PROTOTYPE — throwaway.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('proto', {
  cropTo: (rect) => ipcRenderer.invoke('crop-to', rect),
  restoreCrop: () => ipcRenderer.invoke('restore-crop'),
  spawnFloat: (note, rect) => ipcRenderer.invoke('spawn-float', note, rect),
  onFloatClosed: (cb) => ipcRenderer.on('float-closed', (_e, id) => cb(id)),
});
