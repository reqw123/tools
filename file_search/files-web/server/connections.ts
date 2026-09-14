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
