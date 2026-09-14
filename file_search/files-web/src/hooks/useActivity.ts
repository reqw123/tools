import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { activity } from '../lib/api'
import { getClientId } from '../lib/identity'
import { useShareInfo } from './useShareInfo'

/** 「誰動了這份索引」——見 server/activity.ts。SSE 的 `activity` topic 會
 *  invalidate 這個 key，收到就自動重抓。搬自 notes-web/src/hooks/useActivity.ts。
 *  **只在共用模式才打**——離線版 `server/index.ts` 根本沒註冊 `/api/activity`
 *  （見那邊「低耦合」的說明），`enabled:false` 讓離線版不會白打一支 404。 */
export const ACTIVITY_KEY = ['activity'] as const
export function useActivity(limit?: number) {
  const isShare = useShareInfo().mode === 'lan'
  return useQuery({
    queryKey: [...ACTIVITY_KEY, limit ?? 'all'],
    queryFn: () => activity.list(limit),
    enabled: isShare,
  })
}

/** 「誰正在看哪份索引集」——indexName → 名字（''＝匿名）。見 server/presence.ts。
 *  同樣只在共用模式才有對應的後端路由。 */
export const PRESENCE_KEY = ['presence'] as const
export function usePresence() {
  const isShare = useShareInfo().mode === 'lan'
  return useQuery({
    queryKey: PRESENCE_KEY,
    queryFn: activity.presence,
    staleTime: Infinity, // SSE 的 presence topic 準確地在「有人開始/停止看」時才推
    enabled: isShare,
  })
}

/**
 * 開著某份索引集時掛這個：進來送一次心跳、之後每 5 秒一次；離開／切換／
 * 卸載時主動說「不看了」，不必等 15 秒逾時。`indexName` 是 null（清單還沒
 * 載入完成）時整個不做事；**離線版也整個不做事**——`/api/presence` 離線沒
 * 註冊，打了只會白白 404，見 `server/index.ts` 的「低耦合」說明。
 */
export function useViewingHeartbeat(indexName: string | null): void {
  const isShare = useShareInfo().mode === 'lan'
  useEffect(() => {
    if (!indexName || !isShare) return
    let cancelled = false
    const clientId = getClientId()
    const beat = () => {
      if (!cancelled) activity.setViewing(indexName, true, clientId).catch(() => {})
    }
    beat()
    const timer = setInterval(beat, 5_000)
    return () => {
      cancelled = true
      clearInterval(timer)
      void activity.setViewing(indexName, false, clientId).catch(() => {})
    }
  }, [indexName, isShare])
}

/** 「誰正在編輯哪一列」——path → 編輯者名字清單。見 server/entry-presence.ts；
 *  跟 `usePresence`（整份索引集層級）是不同粒度，只在共用模式才打。 */
export const ENTRY_PRESENCE_KEY = ['entry-presence'] as const
export function useEntryPresence(indexName: string | null) {
  const isShare = useShareInfo().mode === 'lan'
  return useQuery({
    queryKey: [...ENTRY_PRESENCE_KEY, indexName],
    queryFn: () => activity.entryPresence(indexName!),
    staleTime: Infinity, // SSE 的 presence topic 準確地在「有人開始/停止編輯」時才推
    enabled: isShare && !!indexName,
  })
}

/**
 * `EntryRow.tsx` 的 inline 編輯表單開著時掛這個：進來送一次心跳、之後每 5
 * 秒一次；收起表單／卸載時主動說「編完了」，不必等 12 秒逾時。`active` 是
 * false（表單沒開）或缺 `indexName`/`path` 時整個不做事；離線版也整個不做
 * 事（同 `useViewingHeartbeat` 的理由）。
 */
export function useEntryEditingHeartbeat(
  indexName: string | null,
  path: string | null,
  active: boolean,
): void {
  const isShare = useShareInfo().mode === 'lan'
  useEffect(() => {
    if (!indexName || !path || !active || !isShare) return
    let cancelled = false
    const clientId = getClientId()
    const beat = () => {
      if (!cancelled) activity.setEntryEditing(indexName, path, true, clientId).catch(() => {})
    }
    beat()
    const timer = setInterval(beat, 5_000)
    return () => {
      cancelled = true
      clearInterval(timer)
      void activity.setEntryEditing(indexName, path, false, clientId).catch(() => {})
    }
  }, [indexName, path, active, isShare])
}
