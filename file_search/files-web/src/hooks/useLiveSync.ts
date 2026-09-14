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
  activity: [['activity']],
  // entry-presence 的 query key 帶了動態的 indexName 後綴（見
  // useEntryPresence），這裡只給前綴——TanStack Query 的 invalidateQueries
  // 預設就是前綴比對，不用列出每個 indexName 的組合。
  presence: [['presence'], ['entry-presence']],
}
const ALL_KEYS = Object.values(TOPIC_KEYS).flat()

function invalidate(qc: QueryClient, keys: string[][]): void {
  for (const key of keys) qc.invalidateQueries({ queryKey: key })
}

/**
 * 開一條 SSE（`/api/events`）連線，收到「某份索引集變了」就把對應的 query
 * 標記過期 → TanStack Query 立刻重抓。搬自 notes-web/src/hooks/useLiveSync.ts，
 * 機制完全相同：
 *
 * - 只掛一次（`<LiveSync/>` 在最外層）。
 * - EventSource 斷線會自己重連（server 帶 `retry:`）；**重連成功時把所有
 *   同步中的 query 重抓一次**，補上斷線期間漏掉的變動。
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
      es = new EventSource(`/api/events?deviceId=${encodeURIComponent(getDeviceId())}`)

      es.onopen = () => {
        setLiveConnected(true)
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
          invalidate(qc, TOPIC_KEYS.index) // 格式怪 → 至少把目前的索引集重抓一次
        }
      }

      es.onerror = () => {
        setLiveConnected(false)
      }
    }

    open()
    return () => {
      closed = true
      setLiveConnected(false)
      es?.close()
    }
  }, [qc])
}

/** 掛在元件樹最外層——本身不畫任何東西。 */
export function LiveSync(): null {
  useLiveSync()
  return null
}
