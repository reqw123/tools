'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// 這個 preload 同時掛在牆視窗（主行程 createWall() 建立時設定一次，之後
// loadURL 在便利貼牆／索引牆之間切換都沿用同一份，不用分開做）跟每個
// 懸浮視窗上，兩邊網頁各自只會用到自己那組方法（例如索引牆網頁不會呼叫
// pinNote，便利貼牆網頁不會呼叫 pinEntry）。「拖框裁切主視窗」「把卡片
// 拖出去變懸浮視窗」這些手勢需要網頁內容主動要求主行程動視窗本身
// （縮放/搬移/開新視窗），光靠網頁自己的 CSS/JS 辦不到，contextIsolation
// 仍然開著，只開這幾個洞。
contextBridge.exposeInMainWorld('desktopWall', {
  // ids 一併送過去給主行程存檔——重開 wallpaper-app 時才知道要把哪幾則帶回
  // 裁切視窗（見 main.js 的 createWall() / currentUrl()）。目前只有便利貼
  // 牆有裁切功能。
  cropTo: (ids, rect) => ipcRenderer.invoke('wall-crop-to', ids, rect),
  restoreCrop: () => ipcRenderer.invoke('wall-restore-crop'),
  pinNote: (note, rect) => ipcRenderer.invoke('wall-pin-note', note, rect),
  onNoteUnpinned: (cb) => ipcRenderer.on('note-unpinned', (_e, id) => cb(id)),
  // 索引牆版——entry 沒有穩定 id，用 { indexName, path } 一起認。
  pinEntry: (entry, rect) => ipcRenderer.invoke('wall-pin-entry', entry, rect),
  onEntryUnpinned: (cb) => ipcRenderer.on('entry-unpinned', (_e, entry) => cb(entry)),
  // 懸浮視窗自己按「收回」用——這個 preload 同時掛在主牆視窗跟每個懸浮
  // 視窗上，主牆那邊不會用到這個方法。
  unpinSelf: () => ipcRenderer.send('wall-unpin-self'),
  // 裁切檢視中，「恢復完整畫面」按鈕兼職拖曳把手——dx/dy 是這次 mousemove
  // 相對上一次的位移量（MouseEvent.movementX/Y），累加送過來就好，視窗座標
  // 怎麼疊加是主行程的事。只有主牆視窗會用到。
  moveWallBy: (dx, dy) => ipcRenderer.send('wall-move-by', dx, dy),
  // 拖曳放開時送一次，讓主行程把移動後的新位置存檔——不要每個 mousemove
  // 都存，見 main.js 的 wall-move-end。
  moveWallEnd: () => ipcRenderer.send('wall-move-end'),
});
