import { useQuery } from '@tanstack/react-query'

export interface ShareInfo {
  /** 'off' = 一般單機；'lan' = 區網共用模式（密碼牆、host-only 功能收斂）。 */
  mode: 'off' | 'lan'
  /** 遠端能不能用 AI（批次補說明的建議）。off 模式永遠 true。 */
  ai: boolean
  /** 這個連線是不是從主機本機（loopback）進來的——跟 server 端 `isLoopback()`
   *  同一個判斷。**loopback 不吃任何「遠端」限制**，不管全域是不是共用
   *  模式：host 自己用 wallpaper-app 或本機瀏覽器開，永遠拿完整功能。 */
  loopback: boolean
  /** 有開 ngrok 公網通道時的對外網址（`https://…`）；沒開就是 undefined。 */
  publicUrl?: string
  /** host 在 /host 開的「開放模式」——免共用密碼，但仍要求名字＋PIN。 */
  openAccess: boolean
  /** 多人牆閘道啟動時才有值——另一面牆的顯示名稱＋切換用網址。工具列的
   *  「切換到 XX」鈕靠這個決定要不要顯示、顯示什麼字、連去哪裡。獨立啟動器
   *  （沒有閘道）沒有這個欄位，鈕不會出現。 */
  otherWall?: { label: string; switchUrl: string }
  /** share-info 還沒回來——AppGate 用來避免先閃一下完整牆再跳密碼牆。 */
  loading: boolean
}

const OFFLINE: Omit<ShareInfo, 'loading'> = {
  mode: 'off',
  ai: true,
  loopback: true,
  openAccess: false,
}

/**
 * 伺服器目前是不是區網共用模式。搬自 notes-web/src/hooks/useShareInfo.ts，
 * 拿掉登入畫面 3D Logo 欄位（索引牆沒有這個功能）。整個 session 不會變，
 * staleTime 給 Infinity。讀不到（舊 server、離線）就當一般單機模式。
 */
export function useShareInfo(): ShareInfo {
  const { data, isLoading } = useQuery({
    queryKey: ['share-info'],
    queryFn: async (): Promise<Omit<ShareInfo, 'loading'>> => {
      const res = await fetch('/api/share-info')
      if (!res.ok) return OFFLINE
      const j = (await res.json()) as Partial<ShareInfo>
      const ow = j.otherWall
      const otherWall =
        ow && typeof ow.label === 'string' && typeof ow.switchUrl === 'string'
          ? { label: ow.label, switchUrl: ow.switchUrl }
          : undefined
      return {
        mode: j.mode === 'lan' ? 'lan' : 'off',
        ai: j.ai !== false,
        loopback: j.loopback !== false,
        publicUrl: typeof j.publicUrl === 'string' ? j.publicUrl : undefined,
        openAccess: j.openAccess === true,
        otherWall,
      }
    },
    staleTime: Infinity,
    retry: 2,
  })
  return { ...(data ?? OFFLINE), loading: isLoading }
}
