/**
 * 「誰連線了／誰斷線了」——SSE（`/api/events`）連線本身就是「這個人現在開著
 * 牆」的訊號，借用它記連線／斷線，寫進跟其他動態同一份活動記錄（`activity.ts`），
 * 牆上的「📋 動態」自然就看得到「小明 已連線」「小明 已斷線」。
 *
 * 一個人常常同時開好幾個分頁／視窗（主牆＋`/card`＋懸浮便利貼…），每個都各自
 * 一條 SSE——不能一個分頁關掉就算「斷線」，也不能同一個人開兩個分頁就記兩次
 * 「已連線」。用「這個人目前開著幾條 SSE」計數：0→1 才算連線、1→0 才算斷線。
 *
 * 斷線判定還加一段寬限（`DISCONNECT_GRACE_MS`）：換頁（例如從主牆點去
 * `/card`）會先斷舊連線、幾十毫秒後才建立新的，中間那一瞬間計數會降到 0——
 * 沒有寬限的話，正常換頁也會被誤記成「斷線」又「連線」，很吵。
 *
 * 同一個「真的是新連線」判斷順便也拿來記 `visits.ts` 的持久化訪客紀錄——
 * 跟 `logActivity('connect')` 同一個時間點觸發，不是另外重算一次。
 */
import { logActivity } from './activity'
import { recordVisit } from './visits'

const DISCONNECT_GRACE_MS = 5_000

interface Entry {
  count: number
  disconnectTimer: ReturnType<typeof setTimeout> | null
}
const online = new Map<string, Entry>() // key -> Entry；key 見 events.ts 的 connectionKey()

export function connectionOpened(key: string, author: string): void {
  let e = online.get(key)
  if (!e) {
    e = { count: 0, disconnectTimer: null }
    online.set(key, e)
  }
  // 寬限期內重連（換頁／重整）：count 已經是 0，但從沒真的送出過 disconnect
  // log（正是這個 timer 存在的目的——壓下那則 log）。這種情況不能補一筆
  // 「已連線」，不然變成只有 connect、沒有配對的 disconnect，一樣吵。
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
