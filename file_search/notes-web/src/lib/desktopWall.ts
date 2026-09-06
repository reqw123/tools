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
  /** 裁切檢視中移動牆視窗本身，dx/dy 是這次相對上一次滑鼠事件的位移量。 */
  moveWallBy: (dx: number, dy: number) => void
  /** 拖曳「恢復完整畫面」把手放開時呼叫一次，把移動後的新位置存檔。 */
  moveWallEnd: () => void
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
