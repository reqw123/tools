/**
 * 「誰連線了／誰斷線了」——搬自 notes-web/server/connections.ts，機制完全
 * 相同：SSE（`/api/events`）連線本身就是「這個人現在開著牆」的訊號，用
 * 「這個人目前開著幾條 SSE」計數（0→1 才算連線、1→0 才算斷線），斷線判定
 * 加一段寬限（換頁那種瞬斷瞬連不算真的斷線）。
 */
import { logActivity } from './activity'
import { recordVisit } from './visits'

const DISCONNECT_GRACE_MS = 5_000

interface Entry {
  count: number
  disconnectTimer: ReturnType<typeof setTimeout> | null
}
const online = new Map<string, Entry>()

export function connectionOpened(key: string, author: string): void {
  let e = online.get(key)
  if (!e) {
    e = { count: 0, disconnectTimer: null }
    online.set(key, e)
  }
  const hadPendingDisconnect = e.disconnectTimer !== null
  if (e.disconnectTimer) {
    clearTimeout(e.disconnectTimer)
    e.disconnectTimer = null
  }
  const wasOffline = e.count === 0
  e.count += 1
  if (wasOffline && !hadPendingDisconnect) {
    logActivity({ action: 'connect', author, title: '' })
    recordVisit(author)
  }
}

export function connectionClosed(key: string, author: string): void {
  const e = online.get(key)
  if (!e) return
  e.count = Math.max(0, e.count - 1)
  if (e.count > 0) return
  e.disconnectTimer = setTimeout(() => {
    const cur = online.get(key)
    if (cur && cur.count === 0) {
      online.delete(key)
      logActivity({ action: 'disconnect', author, title: '' })
    }
  }, DISCONNECT_GRACE_MS)
}

/**
 * 目前真的在線的具名使用者名單——給「誰在線」這類即時狀態用（跟
 * `listActivity()` 的「什麼時候連線過」歷史記錄是不同層次的資訊）。
 * `count > 0` 才算「真的在線」，`count===0` 但還在 `disconnectTimer` 寬限期
 * 內的（換頁那幾十毫秒）不算。匿名的人分不出是誰（key 開頭是 `anon:`，見
 * `identity.ts` 的 `identityKey()`），不會出現在這份名單——具名的人
 * `key === author` 本人，直接把 key 當名字回傳即可，不用另外存一份對照表。
 * 2026-09 加，給多人牆閘道的「合併在線名單」用（見
 * `share-gateway/index.mjs` 的 `handleCombinedOnline`）。
 */
export function listOnline(): string[] {
  const names: string[] = []
  for (const [key, e] of online) {
    if (e.count > 0 && !key.startsWith('anon:')) names.push(key)
  }
  return names
}
