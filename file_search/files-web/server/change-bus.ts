/**
 * 極簡行程內事件匯流排——搬自 notes-web/server/change-bus.ts，機制相同。
 * `events.ts` 訂閱後推給 SSE 客戶端，讓「這個 web server 自己寫的改動」不必
 * 等 `fs.watch`（Windows 上有幾百 ms 延遲），直接 ~1ms 廣播。桌面版
 * （Tkinter）或別的行程寫的改動仍靠 `events.ts` 裡的 `fs.watch` 捕捉。
 *
 * 跟便利貼牆不同：這裡的 topic 不對應固定的 4 個檔名，而是「索引集清單變了」
 * （`index-list`：有 `.md` 被新增/刪除/改名）跟「某份索引集內容變了」
 * （`index`：一般編輯/批次操作）——前端粗粒度整包 invalidate 目前開著的
 * 那份即可，不用逐檔區分是哪一份。
 */
export type ChangeTopic = 'index-list' | 'index' | 'settings' | 'activity' | 'presence'

const subscribers = new Set<(topic: ChangeTopic) => void>()

export function onChange(fn: (topic: ChangeTopic) => void): () => void {
  subscribers.add(fn)
  return () => subscribers.delete(fn)
}

export function emitChange(topic: ChangeTopic): void {
  for (const fn of subscribers) {
    try {
      fn(topic)
    } catch {
      /* 一個訂閱者爆掉不影響其他人，也不擋寫入 */
    }
  }
}
