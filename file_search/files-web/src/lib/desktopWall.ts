/**
 * 桌面牆（wallpaper-app，Electron 殼）專用能力——只有在 wallpaper-app 的
 * preload（`wall-preload.js`，跟便利貼牆共用同一份）注入過才會存在。一般
 * 瀏覽器開這個網頁時 `window.desktopWall` 是 undefined，「拖出去變懸浮
 * 視窗」這個手勢應該整組不啟用（沒有 Electron 視窗可以操作，啟用了也只是
 * 按了沒反應）。
 *
 * 跟 notes-web 的 lib/desktopWall.ts 是同一套設計，只是這裡只需要
 * pin/unpin 這一組（索引牆目前沒有拉框裁切功能）。entry 沒有穩定 id，用
 * { indexName, path } 一起認。
 */
export interface DesktopWallApi {
  /** 把某個索引項目獨立開成一個小懸浮視窗，rect 給初始大小/位置的參考值。 */
  pinEntry: (
    entry: { indexName: string; path: string },
    rect: { x: number; y: number; width: number; height: number },
  ) => void
  /** 懸浮視窗被關掉（不管是按 ✕ 還是別的方式）時，通知牆把那筆放回清單。 */
  onEntryUnpinned: (cb: (entry: { indexName: string; path: string }) => void) => void
  /** 懸浮視窗自己呼叫：關掉自己、項目放回列表。只有懸浮視窗（FocusedEntry）會用到。 */
  unpinSelf: () => void
}

declare global {
  interface Window {
    desktopWall?: DesktopWallApi
  }
}

/** 讀一次就好——preload 在頁面自己的程式碼跑之前就注入好了，不會中途出現/消失。 */
export function hasDesktopWall(): boolean {
  return typeof window !== 'undefined' && typeof window.desktopWall?.pinEntry === 'function'
}
