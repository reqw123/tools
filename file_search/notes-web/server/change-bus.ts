/**
 * 極簡行程內事件匯流排——`store.ts` 每寫完一份共用檔案就 `emitChange(topic)`，
 * `events.ts` 訂閱後推給 SSE 客戶端。讓「這個 web server 自己寫的改動」不必等
 * `fs.watch`（Windows 上有幾百 ms 延遲），直接 ~1ms 廣播。桌面版寫的改動仍靠
 * `events.ts` 裡的 `fs.watch` 捕捉。
 */
export type ChangeTopic = 'notes' | 'settings' | 'tag-colors' | 'activity' | 'presence' | 'card'

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

/** 檔案完整路徑 → topic；不是共用檔案（歷史快照等）回 null。 */
export function topicForFile(path: string): ChangeTopic | null {
  const name = path.replace(/\\/g, '/').split('/').pop() ?? ''
  if (name === '.sticky_notes.json' || name === '.thesis_notes.json') return 'notes'
  if (name === '.notes_settings.json') return 'settings'
  if (name === '.sticky_tag_colors.json' || name === '.thesis_tag_colors.json') return 'tag-colors'
  return null
}
