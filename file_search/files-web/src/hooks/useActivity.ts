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

/** 合併兩面牆的「動態」——`action` 的型別故意放寬成 `string`：對方
 *  （便利貼牆）的動作種類（`assigned`／`restore`）不在這邊的 `ActivityAction`
 *  裡，`wall` 標明這筆是從哪面牆來的，畫面上要用哪份動詞字典渲染就看這個。
 *  `action==='switch-wall'` 是閘道自己合成的第三種（見
 *  `share-gateway/index.mjs` 的 `collapseWallSwitches()`）——同一個人短時間
 *  內從一面牆斷線、在另一面牆連上，判定成「切牆」而不是兩則獨立的
 *  斷線/連線，`fromWall`／`toWall` 只有這個 action 才會有值。 */
export interface CombinedActivityEntry {
  at: string
  author: string
  action: string
  indexName?: string
  title?: string
  count?: number
  /** 便利貼牆「指派」動作的對象——見 notes-web/server/activity.ts。 */
  target?: string
  wall: 'notes' | 'files'
  fromWall?: 'notes' | 'files'
  toWall?: 'notes' | 'files'
}

/**
 * `GET /combined-activity`——**閘道自己處理的端點**，不是 files-web 或
 * notes-web 任何一支後端的路由，所以不走 `lib/api.ts` 的 `BASE='/api'`
 * 前綴，直接打根路徑（見 `share-gateway/index.mjs` 的
 * `handleCombinedActivity`）。只有透過多人牆閘道（`otherWall` 有值）才存在
 * 這支端點——獨立啟動器打了只會 404，`enabled` 擋住。
 */
export const COMBINED_ACTIVITY_KEY = ['combined-activity'] as const
export function useCombinedActivity(limit = 100) {
  const otherWall = useShareInfo().otherWall
  return useQuery({
    queryKey: [...COMBINED_ACTIVITY_KEY, limit],
    queryFn: async (): Promise<CombinedActivityEntry[]> => {
      const res = await fetch(`/combined-activity?limit=${limit}`, { credentials: 'same-origin' })
      if (!res.ok) throw new Error('讀取合併動態失敗')
      const j = (await res.json()) as { entries: CombinedActivityEntry[] }
      return j.entries
    },
    enabled: !!otherWall,
  })
}

/**
 * `GET /combined-online`——兩面牆合併的「誰在線」，同樣是閘道自己處理的
 * 端點（見 `share-gateway/index.mjs` 的 `handleCombinedOnline`）。**只知道
 * 「誰」，不知道在哪一面牆**——這是刻意的：同一個人可能正在切換牆，把
 * 「線上」跟「目前正在看哪一牆」混在一起顯示反而讓人confuse，這裡單純
 * 回答「這個人現在算不算連著」。SSE 的 `activity` topic 會在自己這面牆的
 * 連線/斷線發生時 invalidate（見 `useLiveSync.ts`）——但只有自己這面牆的
 * 變動會即時推播，對方那面牆的人上線/離線要等下次重抓（開對話框、視窗
 * 重新取得焦點）才會反映，這是「每個人同時間只會連著一支後端」這個既有
 * 架構限制下的合理妥協，不是這裡沒做好。
 */
export const COMBINED_ONLINE_KEY = ['combined-online'] as const
export function useCombinedOnline() {
  const otherWall = useShareInfo().otherWall
  return useQuery({
    queryKey: COMBINED_ONLINE_KEY,
    queryFn: async (): Promise<string[]> => {
      const res = await fetch('/combined-online', { credentials: 'same-origin' })
      if (!res.ok) throw new Error('讀取在線名單失敗')
      const j = (await res.json()) as { names: string[] }
      return j.names
    },
    enabled: !!otherWall,
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
