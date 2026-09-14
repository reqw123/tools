/**
 * 「誰正在看這份索引集」——極簡在場提示，純記憶體，機制搬自
 * `notes-web/server/presence.ts`。**跟便利貼牆的差異**：notes-web 追蹤的是
 * 「誰正在編輯哪一則便利貼」（有明確的、開著編輯視窗的那段時間）；索引牆
 * 的編輯是即時單次 PATCH（沒有「開著編輯視窗」這段狀態），所以這裡改追蹤
 * 粗一級的「誰目前開著哪一份索引集」——前端在切換/停留在某份索引集時定期
 * 打心跳，一樣支援同一份被多人同時看（Map 是集合不是單一值）。
 *
 * 具名使用者用名字當 key（多開視窗合併成一個）；匿名退而求其次用來源 IP＋
 * 前端隨機產生的 `clientId`（sessionStorage，每個分頁一份），讓同一 IP 下
 * 的不同匿名使用者分開顯示。
 */
import { emitChange } from './change-bus'

const TTL_MS = 15_000
interface Entry {
  author: string // '' = 匿名，前端顯示「有人」
  expiresAt: number
}
// indexName -> editorKey(author, ip, clientId) -> Entry
const viewing = new Map<string, Map<string, Entry>>()

function viewerKey(author: string, ip: string, clientId?: string): string {
  return author || `anon:${ip}:${clientId || ''}`
}

function sweep(): boolean {
  const now = Date.now()
  let changed = false
  for (const [indexName, viewers] of viewing) {
    for (const [key, e] of viewers) {
      if (e.expiresAt <= now) {
        viewers.delete(key)
        changed = true
      }
    }
    if (viewers.size === 0) viewing.delete(indexName)
  }
  return changed
}
setInterval(() => {
  if (sweep()) emitChange('presence')
}, 4_000).unref?.()

export function heartbeat(indexName: string, author: string, ip: string, clientId?: string): void {
  const swept = sweep()
  const key = viewerKey(author, ip, clientId)
  let viewers = viewing.get(indexName)
  const isNew = !viewers?.has(key)
  if (!viewers) {
    viewers = new Map()
    viewing.set(indexName, viewers)
  }
  viewers.set(key, { author, expiresAt: Date.now() + TTL_MS })
  if (swept || isNew) emitChange('presence')
}

export function stopViewing(indexName: string, author: string, ip: string, clientId?: string): void {
  const viewers = viewing.get(indexName)
  const had = viewers?.delete(viewerKey(author, ip, clientId)) ?? false
  if (viewers && viewers.size === 0) viewing.delete(indexName)
  const swept = sweep()
  if (had || swept) emitChange('presence')
}

/** indexName → 正在看的人名清單（可能有重複的 ''＝好幾個匿名的人）。給 `GET /api/presence` 用。 */
export function currentViewers(): Record<string, string[]> {
  sweep()
  return Object.fromEntries(
    [...viewing].map(([indexName, viewers]) => [indexName, [...viewers.values()].map((e) => e.author)]),
  )
}
