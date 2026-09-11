import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

/** 「誰動了我的牆」——見 server/activity.ts。SSE 的 `activity` topic 會 invalidate
 *  這個 key（含子 key，TanStack Query 預設用前綴比對），收到就自動重抓。 */
export const ACTIVITY_KEY = ['activity'] as const
export function useActivity(limit?: number) {
  return useQuery({
    queryKey: [...ACTIVITY_KEY, limit ?? 'all'],
    queryFn: () => api.getActivity(limit),
  })
}

/** 「誰正在編輯哪一則」——noteId → 名字（''＝匿名）。見 server/presence.ts。 */
export const PRESENCE_KEY = ['presence'] as const
export function usePresence() {
  return useQuery({
    queryKey: PRESENCE_KEY,
    queryFn: api.getPresence,
    staleTime: Infinity, // SSE 的 presence topic 準確地在「有人開始/停止編輯」時才推，不用自己再輪詢
  })
}

/**
 * 編輯視窗開著時掛這個：進來送一次心跳、之後每 5 秒一次；離開／關閉／卸載時
 * 主動說「編完了」（`editing:false`），不必等 12 秒逾時讓別人一直看到過期提示。
 * `noteId` 是 undefined（新增模式，還沒有 id）時整個不做事。
 */
export function useEditingHeartbeat(noteId: string | undefined): void {
  useEffect(() => {
    if (!noteId) return
    let cancelled = false
    const beat = () => {
      if (!cancelled) api.setEditingPresence(noteId, true).catch(() => {})
    }
    beat()
    const timer = setInterval(beat, 5_000)
    return () => {
      cancelled = true
      clearInterval(timer)
      void api.setEditingPresence(noteId, false).catch(() => {})
    }
  }, [noteId])
}
