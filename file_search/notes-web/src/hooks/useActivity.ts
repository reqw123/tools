import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useShareInfo } from './useShareInfo'

/** 「誰動了我的牆」——見 server/activity.ts。SSE 的 `activity` topic 會 invalidate
 *  這個 key（含子 key，TanStack Query 預設用前綴比對），收到就自動重抓。
 *  **離線版也照樣打**——`activityRoutes` 不管 `SHARE_MODE` 都有註冊（見
 *  `server/index.ts` 的說明：這裡跟 `/card`／`/danmaku` 是同一支路由，離線
 *  的個人展示／多視窗情境也用得到），純記憶體不寫檔，沒有低耦合疑慮。 */
export const ACTIVITY_KEY = ['activity'] as const
export function useActivity(limit?: number) {
  return useQuery({
    queryKey: [...ACTIVITY_KEY, limit ?? 'all'],
    queryFn: () => api.getActivity(limit),
  })
}

/** 合併兩面牆的「動態」——`action` 放寬成 `string`：對方（索引牆）的動作種類
 *  （`bulk-add`／`index-import`／`index-create`／`index-delete`）不在這邊的
 *  型別裡，`wall` 標明這筆是從哪面牆來的。搬自
 *  files-web/src/hooks/useActivity.ts 的 `CombinedActivityEntry`，這裡多了
 *  便利貼牆自己才有的 `target`（指派對象）欄位對方不會用到，兩邊各自加自己
 *  用得到的欄位就好，不用湊出一份「兩邊都要」的共同型別。
 *  `action==='switch-wall'` 是閘道自己合成的第三種（見
 *  `share-gateway/index.mjs` 的 `collapseWallSwitches()`）——同一個人短時間
 *  內從一面牆斷線、在另一面牆連上，判定成「切牆」而不是兩則獨立的
 *  斷線/連線，`fromWall`／`toWall` 只有這個 action 才會有值。 */
export interface CombinedActivityEntry {
  at: string
  author: string
  action: string
  noteId?: string
  indexName?: string
  title?: string
  count?: number
  target?: string
  wall: 'notes' | 'files'
  fromWall?: 'notes' | 'files'
  toWall?: 'notes' | 'files'
}

/**
 * `GET /combined-activity`——**閘道自己處理的端點**，不是任何一支後端的
 * 路由，不走 `lib/api.ts` 的 `BASE`，直接打根路徑（見
 * `share-gateway/index.mjs` 的 `handleCombinedActivity`）。只有透過多人牆
 * 閘道（`otherWall` 有值）才存在這支端點，獨立啟動器打了只會 404，
 * `enabled` 擋住。
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

/** 「誰正在編輯哪一則」——noteId → 名字（''＝匿名）。見 server/presence.ts。
 *  同樣離線也照樣打——`Note.tsx` 卡片上的「正在編輯」提示不分本機/共用，
 *  自己一個人開兩個視窗編同一則時也用得到。 */
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
