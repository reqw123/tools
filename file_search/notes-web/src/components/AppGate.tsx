import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { session } from '../lib/api'
import { useShareInfo } from '../hooks/useShareInfo'
import { PasswordGate } from './PasswordGate'

/**
 * 區網共用模式的入口關卡。`SHARE_MODE=lan` 且這個瀏覽器沒有效 session cookie 時，
 * 只顯示 <PasswordGate>；其餘情況（一般單機、loopback、已登入）直接放行 children。
 *
 * session 狀態放在 query key `['session']`：登入成功會 invalidate 整包重抓 → 變 true；
 * 任何請求 401（cookie 過期）會被 main.tsx 的 QueryCache/MutationCache 攔下、
 * setQueryData(['session'], false) → 這裡自動退回密碼牆。
 */
export function AppGate({ children }: { children: ReactNode }) {
  const share = useShareInfo()
  const lan = share.mode === 'lan'
  const sess = useQuery({
    queryKey: ['session'],
    queryFn: session.check,
    enabled: lan,
    staleTime: Infinity,
    retry: false,
  })

  // share-info 還沒回來——先別畫牆（免得閃一下完整牆再跳密碼牆）。
  if (share.loading) return <div className="pw-gate" />
  if (lan) {
    if (sess.data === undefined) return <div className="pw-gate" />
    if (sess.data === false) return <PasswordGate onPass={() => sess.refetch()} />
  }
  return <>{children}</>
}
