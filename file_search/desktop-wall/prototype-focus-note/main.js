'use strict';
// PROTOTYPE — throwaway. See README.md for the question this answers.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let wallWin = null;
let wallOriginalBounds = null; // 記住裁切前的視窗大小/位置，恢復時用
const floatWindows = new Map(); // noteId -> BrowserWindow

function createWall() {
  wallWin = new BrowserWindow({
    x: 100,
    y: 100,
    width: 1000,
    height: 700,
    frame: false,
    resizable: true,
    backgroundColor: '#efe8dc',
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'wall-preload.js'),
    },
  });
  wallWin.loadFile(path.join(__dirname, 'wall.html'));
  wallWin.on('closed', () => {
    wallWin = null;
    app.quit();
  });
}

// ── 🅰 牆本身視窗裁切 ──────────────────────────────────────────────
ipcMain.handle('crop-to', (_e, rect) => {
  if (!wallWin) return;
  if (!wallOriginalBounds) wallOriginalBounds = wallWin.getBounds();
  const b = wallWin.getBounds();
  wallWin.setBounds({
    x: Math.round(b.x + rect.x),
    y: Math.round(b.y + rect.y),
    width: Math.max(120, Math.round(rect.width)),
    height: Math.max(80, Math.round(rect.height)),
  });
});

ipcMain.handle('restore-crop', () => {
  if (wallWin && wallOriginalBounds) {
    wallWin.setBounds(wallOriginalBounds);
    wallOriginalBounds = null;
  }
});

// ── 🅱 獨立懸浮視窗 ────────────────────────────────────────────────
ipcMain.handle('spawn-float', (_e, note, rect) => {
  if (!wallWin) return;
  const b = wallWin.getBounds();
  const w = new BrowserWindow({
    x: Math.round(b.x + rect.x),
    y: Math.round(b.y + rect.y),
    width: Math.max(160, Math.round(rect.width)),
    height: Math.max(100, Math.round(rect.height)),
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    webPreferences: { contextIsolation: true },
  });
  w.setAlwaysOnTop(true, 'floating');
  const q = new URLSearchParams({ title: note.title, body: note.body, color: note.color });
  w.loadFile(path.join(__dirname, 'float-note.html'), { search: q.toString() });
  floatWindows.set(note.id, w);
  w.on('closed', () => {
    floatWindows.delete(note.id);
    if (wallWin && !wallWin.isDestroyed()) wallWin.webContents.send('float-closed', note.id);
  });
});

app.whenReady().then(createWall);
app.on('window-all-closed', () => app.quit());
