import { useQuery } from '@tanstack/react-query'
import { session, type SessionInfo } from '../lib/api'
import { useShareInfo } from './useShareInfo'

/**
 * 「我現在是誰／什麼角色」——跟 `AppGate.tsx` 用同一個 query key `['session']`，
 * react-query 自動共用快取，不會多打一次請求。只在共用模式（`SHARE_MODE=lan`）
 * enabled——一般單機模式沒有多人身分概念，角色永遠是 'editor'（見
 * `useCanWrite()`）。
 */
export function useMySession() {
  const share = useShareInfo()
  return useQuery({
    queryKey: ['session'],
    queryFn: session.check,
    enabled: share.mode === 'lan',
    staleTime: Infinity,
    retry: false,
  })
}

/** 這個人現在能不能寫（新增／編輯／刪除／反應…）——唯讀身分（viewer）回
 *  false。真正的防線在後端 `shareGuardHook`（403），這裡只是讓 UI 不要顯示
 *  點了也會失敗的按鈕。一般單機模式、loopback 主機一律 true。 */
export function useCanWrite(): boolean {
  const share = useShareInfo()
  const { data } = useMySession()
  if (share.mode !== 'lan' || share.loopback) return true
  const role: SessionInfo['role'] = data?.role ?? 'editor'
  return role !== 'viewer'
}
