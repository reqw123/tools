'use strict';
// 懸浮視窗（拖出去的便利貼／索引項目）的「拖曳把手移動視窗」——由網頁自己的
// 滑鼠事件驅動，主行程只負責「跟著游標搬視窗」。
//
// 為什麼不用 CSS 的 `-webkit-app-region: drag`：那種區域是交給作業系統原生處理
// 的，網頁完全收不到滑鼠事件——`:hover` 高亮、`cursor: move` 游標圖案都不會生效
// （實測：游標停在把手上讀到的是一般箭頭，或靠邊緣時的縮放圖案，從來不是
// 「移動」圖案），而且靠近視窗邊緣時會跟原生縮放邊框搶事件，拖起來時有時無。
// 改成一般的網頁元素（`cursor: move`＋hover 高亮正常運作），按下時通知這裡開始，
// 放開時通知結束。
//
// 移動的方式：每個時間片讀一次游標的螢幕座標，把視窗搬到「起始位置＋游標位移」。
// 用游標的絕對座標，不是累加 mousemove 的位移量——視窗自己在動，網頁座標系跟著
// 變，累加會漂移；而且不依賴網頁事件的頻率。每次都帶著原本的 width/height 呼叫
// setBounds，避免跨不同縮放比例的螢幕時 Windows 把視窗尺寸悄悄改掉（已知問題）。

const { BrowserWindow, ipcMain, screen } = require('electron');

const TICK_MS = 8;
// 保險：放開的訊息一直沒到（網頁當掉、事件被吞掉）就別讓視窗永遠黏在游標上。
const MAX_DRAG_MS = 60_000;

/** webContents.id → { timer, cleanup } */
const drags = new Map();

function stop(id) {
  const d = drags.get(id);
  if (!d) return;
  clearInterval(d.timer);
  d.cleanup();
  drags.delete(id);
}

function registerWindowDrag() {
  ipcMain.on('wall-drag-start', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win || win.isDestroyed()) return;
    const wc = e.sender;
    const id = wc.id;
    stop(id); // 上一次沒收尾的話先清掉
    const start = screen.getCursorScreenPoint();
    const b = win.getBounds();
    const t0 = Date.now();
    const timer = setInterval(() => {
      if (win.isDestroyed() || Date.now() - t0 > MAX_DRAG_MS) return stop(id);
      const c = screen.getCursorScreenPoint();
      win.setBounds({
        x: b.x + (c.x - start.x),
        y: b.y + (c.y - start.y),
        width: b.width,
        height: b.height,
      });
    }, TICK_MS);
    // 主行程自己看滑鼠事件來收尾，不只靠網頁送來的 drag-end——放開事件偶爾在作業系統
    // 輸入層就沒送到視窗（實測：快速拖動時偶發，連 before-mouse-event 都沒看到
    // mouseUp），這時網頁也不會知道，視窗就會一直黏在游標上。收到「放開」或「又按下」
    // （前一次的放開一定漏掉了）都停手。這個監聽是在 drag-start 之後才掛的，而
    // before-mouse-event 早於網頁收到 pointerdown，所以不會被「開始拖曳的那一下按下」
    // 自己誤觸。
    const onMouse = (_ev, m) => {
      if (m.type === 'mouseUp' || m.type === 'mouseDown') stop(id);
    };
    wc.on('before-mouse-event', onMouse);
    drags.set(id, {
      timer,
      cleanup: () => {
        if (!wc.isDestroyed()) wc.removeListener('before-mouse-event', onMouse);
      },
    });
    win.once('closed', () => stop(id));
  });

  ipcMain.on('wall-drag-end', (e) => stop(e.sender.id));
}

module.exports = { registerWindowDrag };
