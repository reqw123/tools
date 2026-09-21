/**
 * 桌面牆（wallpaper-app，Electron 殼）專用能力——只有在 wallpaper-app 的
 * preload（`wall-preload.js`）注入過才會存在。一般瀏覽器開這個網頁時
 * `window.desktopWall` 是 undefined，「拖出去變懸浮視窗」「拖框裁切主視窗」
 * 這兩個手勢都應該整組不啟用（沒有 Electron 視窗可以操作，啟用了也只是
 * 按了沒反應）。
 */
export interface DesktopWallApi {
  /** 把整個牆視窗縮小/搬移到 rect（視窗座標系），連同框到的 ids 一併存檔以便跨重啟還原。 */
  cropTo: (ids: string[], rect: { x: number; y: number; width: number; height: number }) => void
  /** 裁切狀態下，把牆視窗恢復成全螢幕，並清掉存檔的裁切狀態。 */
  restoreCrop: () => void
  /** 把某則便利貼獨立開成一個小懸浮視窗，rect 給初始大小/位置的參考值。 */
  pinNote: (
    note: { id: string },
    rect: { x: number; y: number; width: number; height: number },
  ) => void
  /** 懸浮視窗被關掉（不管是按 ✕ 還是別的方式）時，通知牆把那則放回清單。 */
  onNoteUnpinned: (cb: (id: string) => void) => void
  /** 懸浮視窗自己呼叫：關掉自己、便利貼放回牆上。只有懸浮視窗（FocusedNote）會用到。 */
  unpinSelf: () => void
  /** 懸浮視窗的拖曳把手：按下開始讓視窗跟著游標走、放開結束。見 lib/windowDrag.ts。 */
  dragWindowStart: () => void
  dragWindowEnd: () => void
  /** 裁切檢視中移動牆視窗本身，dx/dy 是這次相對上一次滑鼠事件的位移量。 */
  moveWallBy: (dx: number, dy: number) => void
  /** 拖曳「恢復完整畫面」把手放開時呼叫一次，把移動後的新位置存檔。 */
  moveWallEnd: () => void
  /** 便利貼內文網址 Ctrl+點擊——交給系統預設瀏覽器開，不要用 window.open()
   *  開在這個 BrowserWindow 自己的、沒登入的 session 裡（會導致某些網站
   *  例如需要登入才能播放的影片打不開）。見 lib/linkify.tsx。 */
  openExternal: (url: string) => void
  /** 「顯示/隱藏」快捷鍵目前的顯示字串（例如 "Shift+X"；使用者改過設定、
   *  或那組鍵註冊失敗都會反映在回傳值上）——給工具列畫操作提示用。 */
  getToggleVisibleShortcut: () => Promise<string>
}

declare global {
  interface Window {
    desktopWall?: DesktopWallApi
  }
}

/** 讀一次就好——preload 在頁面自己的程式碼跑之前就注入好了，不會中途出現/消失。 */
export function hasDesktopWall(): boolean {
  return typeof window !== 'undefined' && typeof window.desktopWall?.cropTo === 'function'
}
