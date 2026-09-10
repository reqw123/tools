import { useQuery } from '@tanstack/react-query'

export interface ShareInfo {
  /** 'off' = 一般單機／離線；'lan' = 區網共用模式（密碼牆、遠端功能收斂）。 */
  mode: 'off' | 'lan'
  /** 遠端能不能用 AI 搜尋／生成／語意。off 模式永遠 true。 */
  ai: boolean
  /** share-info 還沒回來——AppGate 用來避免先閃一下完整牆再跳密碼牆。 */
  loading: boolean
}

const OFFLINE: Omit<ShareInfo, 'loading'> = { mode: 'off', ai: true }

/**
 * 伺服器目前是不是區網共用模式。server/index.ts 的 `/api/share-info` 提供，
 * 不需驗證。整個 session 不會變，所以 staleTime 給 Infinity。
 * 讀不到（舊 server、離線）就當一般單機模式，UI 全照舊。
 */
export function useShareInfo(): ShareInfo {
  const { data, isLoading } = useQuery({
    queryKey: ['share-info'],
    queryFn: async (): Promise<Omit<ShareInfo, 'loading'>> => {
      const res = await fetch('/api/share-info')
      if (!res.ok) return OFFLINE
      const j = (await res.json()) as Partial<ShareInfo>
      return { mode: j.mode === 'lan' ? 'lan' : 'off', ai: j.ai !== false }
    },
    staleTime: Infinity,
    retry: 2,
  })
  return { ...(data ?? OFFLINE), loading: isLoading }
}
