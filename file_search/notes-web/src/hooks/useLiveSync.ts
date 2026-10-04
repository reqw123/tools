import { useEffect } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { emitDanmakuEvent, setLiveConnected, type DanmakuMessage } from '../lib/liveSync'
import { getDeviceId } from '../lib/identity'

/** SSE topic → 要重抓的 query keys。 */
const TOPIC_KEYS: Record<string, string[][]> = {
  notes: [['notes'], ['notes-trash'], ['notes-history']],
  settings: [['app-settings'], ['reminder-settings'], ['share-info']],
  'tag-colors': [['tag-colors']],
  // combined-activity／combined-online（多人牆閘道的合併動態/在線名單）只有
  // 「自己這面牆」的變動會推到——見 useActivity.ts 的 useCombinedOnline 說明。
  activity: [['activity'], ['combined-activity'], ['combined-online']],
  presence: [['presence']],
  card: [['card']],
  notifications: [['notifications']],
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
  | { type: 'danmaku'; data: string }
  | { type: 'hello' } // 新來的跟隨者問「現在連著嗎」

const LOCK_NAME = 'sticky-wall-live-sync'

/**
 * 開一條 SSE（`/api/events`）連線，收到「某某檔案變了」就把對應的 query 標記過期
 * → TanStack Query 立刻重抓。這是「多人／跟桌面版即時同步」的快路徑，把最多等
 * 8 秒的輪詢變成 ~100~300ms 的推播。
 *
 * - 只掛一次（`<LiveSync/>` 在最外層，App 和懸浮視窗都涵蓋到）。
 * - **同一個來源（origin）的所有視窗共用一條 SSE**：用 Web Locks 選一個視窗持有連線，
 *   用 BroadcastChannel 把事件轉給其他視窗；持有的視窗關掉，鎖自動交給下一個，
 *   接手的視窗重連並讓大家全部重抓一次。原因：瀏覽器對同一個 host 最多同時 6 條
 *   HTTP/1.1 連線，SSE 又是永遠不結束的請求——桌面版懸浮便利貼一多（每個懸浮視窗
 *   都是一頁），6 條被 SSE 佔滿，其他請求（連牆本身的 HTML、`/api/notes`）全部
 *   排隊卡死，牆變成一片空白／永遠「載入中…」。
 *   沒有 Web Locks 的環境（例如區網用 http 開、不是 secure context 的手機）退回
 *   每個視窗各開一條。
 * - EventSource 斷線會自己重連（server 帶 `retry:`）；**重連成功時把所有同步中的
 *   query 重抓一次**，補上斷線期間漏掉的變動。斷線期間 `useNotes` 會退回輪詢。
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

    // 不管事件是自己的 SSE 收到的、還是別的視窗轉來的，處理方式都一樣
    const handle = (ev: Relay) => {
      switch (ev.type) {
        case 'open':
          setLiveConnected(true)
          // 重連（不是第一次連上）→ 補課：斷線期間別人可能改了東西，SSE 只會推
          // 「之後」的事件，這裡主動全部重抓一次。
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
            invalidate(qc, TOPIC_KEYS.notes) // 格式怪 → 至少把便利貼重抓一次
          }
          break
        case 'error':
          // EventSource 會自己依 retry: 重連；這裡只更新狀態讓輪詢接手。
          setLiveConnected(false)
          break
        case 'danmaku':
          // 彈幕：具名 SSE 事件（不是預設的 message），推的是訊息本體，不是
          // 「去重抓」的 topic 名字——見 server/events.ts 的 broadcastDanmaku()。
          // 轉發給 lib/liveSync.ts 的事件 bus，DanmakuLayer 訂閱它來播放。
          try {
            const data = JSON.parse(ev.data) as Partial<DanmakuMessage>
            if (data && typeof data.text === 'string' && typeof data.author === 'string') {
              emitDanmakuEvent({
                id: typeof data.id === 'string' ? data.id : '',
                author: data.author,
                text: data.text,
                at: typeof data.at === 'number' ? data.at : Date.now(),
              })
            }
          } catch {
            /* 格式怪就丟掉這一則，不影響其他同步 */
          }
          break
      }
    }

    // 自己持有 SSE：收到的事件自己處理，也轉給其他視窗。
    // takeover＝從別的視窗接手（之前的事件可能漏了）→ 第一次連上就當重連處理。
    const openSource = (takeover: boolean) => {
      let everConnected = takeover
      const relay = (ev: Relay) => {
        handle(ev)
        channel?.postMessage(ev)
      }
      // deviceId：EventSource 不能帶自訂標頭，匿名連線統計靠這個 query string
      // 分辨「同一瀏覽器多分頁」跟「同 IP 下的不同人」——見 lib/identity.ts。
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
      es.addEventListener('danmaku', (e) => relay({ type: 'danmaku', data: (e as MessageEvent).data }))
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
          // 別的視窗已經持有 → 當跟隨者，問一下目前狀態，並排隊等著接手
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

/** 掛在元件樹最外層（App 與懸浮視窗共用）——本身不畫任何東西。 */
export function LiveSync(): null {
  useLiveSync()
  return null
}
