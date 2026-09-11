import { useQuery } from '@tanstack/react-query'

export interface ShareInfo {
  /** 'off' = 一般單機／離線；'lan' = 區網共用模式（密碼牆、遠端功能收斂）。 */
  mode: 'off' | 'lan'
  /** 遠端能不能用 AI 搜尋／生成／語意。off 模式永遠 true。 */
  ai: boolean
  /** 這個連線是不是從主機本機（loopback）進來的——跟 server 端 `isLoopback()`
   *  同一個判斷。**loopback 不吃任何「遠端」限制**（研究生模式、AI 生成便利貼
   *  選資料夾…），不管全域是不是共用模式：host 自己用 wallpaper-app 或本機
   *  瀏覽器開，永遠拿完整功能。off 模式下這個欄位沒有實際意義（沒有任何限制
   *  要看它），固定給 true。 */
  loopback: boolean
  /** 有開 ngrok 公網通道時的對外網址（`https://…`）；沒開就是 undefined。 */
  publicUrl?: string
  /** host 在 /host 開的「開放模式」——免共用密碼，但仍要求名字＋PIN（見
   *  server/share.ts 的 shareAuthHook）。`<PasswordGate>` 靠這個決定要不要
   *  顯示密碼欄位、要不要強制名字＋PIN 必填。mode='off' 時沒有意義，固定 false。 */
  openAccess: boolean
  /** host 在 /host 開的「登入畫面 3D Logo」（見 LoginLogo3D.tsx）——純裝飾、
   *  預設關（素材約 5.6MB，host 自己決定要不要讓訪客下載）。`<PasswordGate>`
   *  只在這個為 true 時才 mount 那個元件，關掉＝完全不發任何請求。 */
  loginLogo3d: boolean
  /** share-info 還沒回來——AppGate 用來避免先閃一下完整牆再跳密碼牆。 */
  loading: boolean
}

const OFFLINE: Omit<ShareInfo, 'loading'> = {
  mode: 'off',
  ai: true,
  loopback: true,
  openAccess: false,
  loginLogo3d: false,
}

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
      return {
        mode: j.mode === 'lan' ? 'lan' : 'off',
        ai: j.ai !== false,
        loopback: j.loopback !== false,
        publicUrl: typeof j.publicUrl === 'string' ? j.publicUrl : undefined,
        openAccess: j.openAccess === true,
        loginLogo3d: j.loginLogo3d === true,
      }
    },
    staleTime: Infinity,
    retry: 2,
  })
  return { ...(data ?? OFFLINE), loading: isLoading }
}
