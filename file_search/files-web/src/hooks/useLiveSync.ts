import { useEffect } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { setLiveConnected } from '../lib/liveSync'
import { getDeviceId } from '../lib/identity'

/** SSE topic → 要重抓的 query keys。搬自 notes-web/src/hooks/useLiveSync.ts，
 *  拿掉彈幕相關的部分，topic 名稱換成索引牆自己的（見 server/change-bus.ts）。 */
const TOPIC_KEYS: Record<string, string[][]> = {
  'index-list': [['indexes']],
  index: [['index'], ['category-colors']],
  settings: [['share-info']],
  // combined-activity／combined-online（多人牆閘道的合併動態/在線名單）只有
  // 「自己這面牆」的變動會推到——見 useActivity.ts 的 useCombinedOnline 說明。
  activity: [['activity'], ['combined-activity'], ['combined-online']],
  // entry-presence 的 query key 帶了動態的 indexName 後綴（見
  // useEntryPresence），這裡只給前綴——TanStack Query 的 invalidateQueries
  // 預設就是前綴比對，不用列出每個 indexName 的組合。
  presence: [['presence'], ['entry-presence']],
}
const ALL_KEYS = Object.values(TOPIC_KEYS).flat()

function invalidate(qc: QueryClient, keys: string[][]): void {
  for (const key of keys) qc.invalidateQueries({ queryKey: key })
}

/** 持有 SSE 的視窗轉發給其他視窗的事件（BroadcastChannel 上傳的東西）。 */
type Relay =
  | { type: 'open'; resync: boolean }
  | { type: 'message'; data: string }
  | { type: 'error' }
  | { type: 'hello' } // 新來的跟隨者問「現在連著嗎」

const LOCK_NAME = 'file-wall-live-sync'

/**
 * 開一條 SSE（`/api/events`）連線，收到「某份索引集變了」就把對應的 query
 * 標記過期 → TanStack Query 立刻重抓。搬自 notes-web/src/hooks/useLiveSync.ts，
 * 機制完全相同（少了彈幕）：
 *
 * - 只掛一次（`<LiveSync/>` 在最外層）。
 * - **同一個來源的所有視窗共用一條 SSE**（Web Locks 選一個視窗持有、BroadcastChannel
 *   轉發）——瀏覽器對同一個 host 最多 6 條 HTTP/1.1 連線，懸浮視窗一多會被 SSE
 *   佔滿、其他請求全部卡死。原因與細節見 notes-web 那支的說明。
 * - EventSource 斷線會自己重連（server 帶 `retry:`）；**重連成功時把所有
 *   同步中的 query 重抓一次**，補上斷線期間漏掉的變動。
 * - 登入牆後面才會 render，所以連線一定帶得到 `share_session` cookie。
 */
export function useLiveSync(): void {
  const qc = useQueryClient()

  useEffect(() => {
    let es: EventSource | null = null
    let closed = false
    let connected = false
    let releaseLock: () => void = () => {}
    const abort = new AbortController()
    const channel =
      'locks' in navigator && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(LOCK_NAME) : null

    const handle = (ev: Relay) => {
      switch (ev.type) {
        case 'open':
          setLiveConnected(true)
          if (ev.resync) invalidate(qc, ALL_KEYS)
          break
        case 'message':
          setLiveConnected(true)
          try {
            const data = JSON.parse(ev.data) as { topics?: unknown }
            const topics = Array.isArray(data.topics) ? data.topics : []
            for (const t of topics) {
              if (typeof t === 'string' && TOPIC_KEYS[t]) invalidate(qc, TOPIC_KEYS[t])
            }
          } catch {
            invalidate(qc, TOPIC_KEYS.index) // 格式怪 → 至少把目前的索引集重抓一次
          }
          break
        case 'error':
          setLiveConnected(false)
          break
      }
    }

    // takeover＝從別的視窗接手（之前的事件可能漏了）→ 第一次連上就當重連處理
    const openSource = (takeover: boolean) => {
      let everConnected = takeover
      const relay = (ev: Relay) => {
        handle(ev)
        channel?.postMessage(ev)
      }
      es = new EventSource(`/api/events?deviceId=${encodeURIComponent(getDeviceId())}`)
      es.onopen = () => {
        connected = true
        relay({ type: 'open', resync: everConnected })
        everConnected = true
      }
      es.onmessage = (e) => relay({ type: 'message', data: e.data })
      es.onerror = () => {
        connected = false
        relay({ type: 'error' })
      }
    }

    if (!channel) {
      openSource(false)
    } else {
      const becomeHolder = (takeover: boolean) => {
        openSource(takeover)
        return new Promise<void>((resolve) => {
          releaseLock = resolve // 卸載時 resolve → 放開鎖，排隊的下一個視窗接手
        })
      }
      channel.onmessage = (e: MessageEvent<Relay>) => {
        const ev = e.data
        if (ev.type === 'hello') {
          if (es) channel.postMessage(connected ? { type: 'open', resync: false } : { type: 'error' })
        } else if (!es) {
          handle(ev)
        }
      }
      navigator.locks
        .request(LOCK_NAME, { ifAvailable: true }, (lock) => {
          if (closed) return
          if (lock) return becomeHolder(false)
          channel.postMessage({ type: 'hello' } satisfies Relay)
          navigator.locks
            .request(LOCK_NAME, { signal: abort.signal }, () => (closed ? undefined : becomeHolder(true)))
            .catch(() => {}) // 卸載時 abort → AbortError，忽略
        })
        .catch(() => {})
    }

    return () => {
      closed = true
      setLiveConnected(false)
      es?.close()
      abort.abort()
      releaseLock()
      channel?.close()
    }
  }, [qc])
}

/** 掛在元件樹最外層——本身不畫任何東西。 */
export function LiveSync(): null {
  useLiveSync()
  return null
}
