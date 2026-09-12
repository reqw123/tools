import { useEffect } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { emitDanmakuEvent, setLiveConnected, type DanmakuMessage } from '../lib/liveSync'
import { getDeviceId } from '../lib/identity'

/** SSE topic → 要重抓的 query keys。 */
const TOPIC_KEYS: Record<string, string[][]> = {
  notes: [['notes'], ['notes-trash'], ['notes-history']],
  settings: [['app-settings'], ['reminder-settings'], ['share-info']],
  'tag-colors': [['tag-colors']],
  activity: [['activity']],
  presence: [['presence']],
  card: [['card']],
  notifications: [['notifications']],
}
const ALL_KEYS = Object.values(TOPIC_KEYS).flat()

function invalidate(qc: QueryClient, keys: string[][]): void {
  for (const key of keys) qc.invalidateQueries({ queryKey: key })
}

/**
 * 開一條 SSE（`/api/events`）連線，收到「某某檔案變了」就把對應的 query 標記過期
 * → TanStack Query 立刻重抓。這是「多人／跟桌面版即時同步」的快路徑，把最多等
 * 8 秒的輪詢變成 ~100~300ms 的推播。
 *
 * - 只掛一次（`<LiveSync/>` 在最外層，App 和懸浮視窗都涵蓋到）。
 * - EventSource 斷線會自己重連（server 帶 `retry:`）；**重連成功時把所有同步中的
 *   query 重抓一次**，補上斷線期間漏掉的變動。斷線期間 `useNotes` 會退回輪詢。
 * - 登入牆後面才會 render，所以連線一定帶得到 `share_session` cookie。
 */
export function useLiveSync(): void {
  const qc = useQueryClient()

  useEffect(() => {
    let es: EventSource | null = null
    let closed = false
    let everConnected = false

    const open = () => {
      if (closed) return
      // deviceId：EventSource 不能帶自訂標頭，匿名連線統計靠這個 query string
      // 分辨「同一瀏覽器多分頁」跟「同 IP 下的不同人」——見 lib/identity.ts。
      es = new EventSource(`/api/events?deviceId=${encodeURIComponent(getDeviceId())}`)

      es.onopen = () => {
        setLiveConnected(true)
        // 重連（不是第一次連上）→ 補課：斷線期間別人可能改了東西，SSE 只會推
        // 「之後」的事件，這裡主動全部重抓一次。
        if (everConnected) invalidate(qc, ALL_KEYS)
        everConnected = true
      }

      es.onmessage = (e) => {
        setLiveConnected(true)
        try {
          const data = JSON.parse(e.data) as { topics?: unknown }
          const topics = Array.isArray(data.topics) ? data.topics : []
          for (const t of topics) {
            if (typeof t === 'string' && TOPIC_KEYS[t]) invalidate(qc, TOPIC_KEYS[t])
          }
        } catch {
          invalidate(qc, TOPIC_KEYS.notes) // 格式怪 → 至少把便利貼重抓一次
        }
      }

      es.onerror = () => {
        // EventSource 會自己依 retry: 重連；這裡只更新狀態讓輪詢接手。
        setLiveConnected(false)
      }

      // 彈幕：具名 SSE 事件（不是預設的 message），推的是訊息本體，不是
      // 「去重抓」的 topic 名字——見 server/events.ts 的 broadcastDanmaku()。
      // 轉發給 lib/liveSync.ts 的事件 bus，DanmakuLayer 訂閱它來播放。
      es.addEventListener('danmaku', (e) => {
        try {
          const data = JSON.parse((e as MessageEvent).data) as Partial<DanmakuMessage>
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
      })
    }

    open()
    return () => {
      closed = true
      setLiveConnected(false)
      es?.close()
    }
  }, [qc])
}

/** 掛在元件樹最外層（App 與懸浮視窗共用）——本身不畫任何東西。 */
export function LiveSync(): null {
  useLiveSync()
  return null
}
