import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import { App } from './App'
import { FocusedEntry } from './components/FocusedEntry'
import { AppGate } from './components/AppGate'
import { LiveSync } from './hooks/useLiveSync'
import { HostPanel } from './components/HostPanel'
import { AuthError } from './lib/api'
import { applySurface } from './lib/surface'

applySurface()

// 公網（ngrok 免費版）：對「瀏覽器 UA」的請求，ngrok 會先回一頁攔截警告頁而
// 不是我們的 API 內容。帶這個標頭就跳過，對區網／本機完全無害。搬自
// notes-web/src/main.tsx。
{
  const nativeFetch = window.fetch.bind(window)
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : ''
    if (url.startsWith('/api')) {
      init = {
        ...init,
        headers: { ...(init?.headers as Record<string, string>), 'ngrok-skip-browser-warning': 'true' },
      }
    }
    return nativeFetch(input, init)
  }
}

// `?focus=<path>&index=<indexName>`——wallpaper-app 把某個索引項目拖出去變
// 懸浮視窗時開的就是同一個網頁、同一個 server，只是帶這兩個參數。
const params = new URLSearchParams(location.search)
const focusPath = params.get('focus')
const focusIndex = params.get('index')
if (focusPath && focusIndex) document.documentElement.classList.add('focus-mode')

// `/host`——host 專用管理頁（見 HostPanel.tsx / server/host-routes.ts）：開放
// 模式開關、身分保護解除。頁面殼誰都載得到，但背後的 /api/host/* 一律只認
// loopback，遠端開這個網址什麼都做不了、什麼都看不到。
const isHostPanel = location.pathname === '/host' || location.pathname === '/host/'

// `/wall`——共用牆（現在只透過 share-gateway 啟動）印的固定網址，跟
// notes-web 同一套慣例，但**跟 notes-web 不同的是這裡根路徑 `/`
// 沒有被停用**：files-web 既有的桌面版／`npm run dev` 工作流程、
// wallpaper-app 內嵌（見 `wallpaper-app/servers.js` 的 `urlFor()`）都是直接
// 開根路徑，改成「根路徑什麼都不畫」會破壞這些既有用法。真正的存取控制靠
// `<AppGate>` 的密碼牆（任何路徑都會經過），所以不需要另外分流——`/wall`
// 就讓它落到下面預設的 `<App/>` 分支，不用特別判斷。

const onAuthError = (err: unknown) => {
  if (err instanceof AuthError) queryClient.setQueryData(['session'], { ok: false, name: null })
}

const queryClient: QueryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, refetchOnWindowFocus: false } },
  queryCache: new QueryCache({ onError: onAuthError }),
  mutationCache: new MutationCache({ onError: onAuthError }),
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppGate>
        <LiveSync />
        {isHostPanel ? (
          <HostPanel />
        ) : focusPath && focusIndex ? (
          <FocusedEntry indexName={focusIndex} path={focusPath} />
        ) : (
          <App />
        )}
      </AppGate>
    </QueryClientProvider>
  </StrictMode>,
)
