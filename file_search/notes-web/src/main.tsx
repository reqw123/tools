import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import { App } from './App'
import { AuthError, getApiCollection, setApiCollection } from './lib/api'
import { AppGate } from './components/AppGate'
import { LiveSync } from './hooks/useLiveSync'
import { FocusedNote } from './components/FocusedNote'
import { CardScreen } from './components/CardScreen'
import { HostPanel } from './components/HostPanel'
import { applySurface } from './lib/surface'

applySurface()

// 公網（ngrok 免費版）：對「瀏覽器 UA」的請求，ngrok 會先回一頁攔截警告頁，
// 而不是我們的 API 內容——XHR/fetch 收到那頁 HTML 會 JSON 解析失敗。帶這個
// 標頭就跳過。對區網／本機（沒經過 ngrok）完全無害。只加在同源的 /api、
// /note-images、/thesis-note-images 請求上；本專案所有 fetch 第一參數都是
// 字串，這個包裝法是安全的。
{
  const nativeFetch = window.fetch.bind(window)
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : ''
    if (url.startsWith('/api') || url.startsWith('/note-images') || url.startsWith('/thesis-note-images')) {
      init = {
        ...init,
        headers: { ...(init?.headers as Record<string, string>), 'ngrok-skip-browser-warning': 'true' },
      }
    }
    return nativeFetch(input, init)
  }
}

// `?focus=<id>`——wallpaper-app 把某則便利貼拖出去變懸浮視窗時，開的就是
// 同一個網頁、同一個 server，只是帶這個參數（見 wallpaper-app/main.js 的
// wall-pin-note）。這裡整個換成只畫那一則，不掛 Toolbar／搜尋／批次那些
// 跟完整牆面有關的狀態機——不是在 App.tsx 裡面分支，是在最外層就分流，
// 這樣懸浮視窗完全不用背完整牆面那一整套邏輯。
const focusId = new URLSearchParams(location.search).get('focus')
if (focusId) document.documentElement.classList.add('focus-mode')

// `/card`——固定網址的「看板」（見 CardScreen.tsx / server/card.ts）：畫面內容
// 是後端目前指定的那一則，換內容靠別處打 POST /api/card，不是改這個網址。
// 用路徑（不是 query string）是刻意的——這支網址是要貼在投影機／展示螢幕上
// 長期開著的，路徑比 `?focus=id` 更適合當一個「固定地址」記。
const isCardScreen = location.pathname === '/card' || location.pathname === '/card/'
// 看板固定給生活牆用（`server/card.ts` 的 setCard() 存在性檢查也是固定查生活
// 牆），不受這個瀏覽器之前切過的「研究生模式」影響——`apiCollection` 存在
// localStorage、跨路徑持久，`/card` 不像 `<App>` 有自己的 isRemoteShare effect
// 會把它撥回生活牆，所以在這裡、React 還沒開始 render 之前就先強制設好，
// 確保 CardScreen 的 useNotes() 一開始查詢就是對的那份資料，不會因為主牆
// 之前切過研究生模式，讓看板誤查到研究生便利貼、永遠顯示「尚未指定」。
if (isCardScreen && getApiCollection() !== 'life') setApiCollection('life')

// `/host`——host 專用管理頁（見 HostPanel.tsx / server/host-routes.ts）：開放模式
// 開關、身分保護解除。頁面殼誰都載得到，但背後的 /api/host/* 一律只認 loopback，
// 遠端開這個網址什麼都做不了、什麼都看不到。
const isHostPanel = location.pathname === '/host' || location.pathname === '/host/'

// `/wall`——主牆固定路徑。**根路徑 `/` 故意什麼都不畫**：連密碼牆的表單都不
// 顯示，讓隨便逛到根網址的人看起來像什麼都沒有（不是密碼錯，是根本查無此
// 頁）。`?focus=id` 不受這個限制——那是 wallpaper-app 自己組的網址，一定會
// 帶著正確路徑（見 wallpaper-app/servers.js 的 urlFor()）。認不得的路徑／沒
// 有 focus 參數 → 連 <AppGate> 都不掛，不會讓沒登入的人看到「這裡有密碼牆」。
const isWallScreen = location.pathname === '/wall' || location.pathname === '/wall/'
const knownRoute = isWallScreen || isCardScreen || isHostPanel || !!focusId

// 區網共用模式：任何 query／mutation 收到 AuthError（cookie 過期）就把 session
// 標成失效，AppGate 會自動退回密碼牆。一般單機模式永遠不會走到這裡。
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
      {knownRoute && (
        <AppGate>
          <LiveSync />
          {isHostPanel ? (
            <HostPanel />
          ) : isCardScreen ? (
            <CardScreen />
          ) : focusId ? (
            <FocusedNote id={focusId} />
          ) : (
            <App />
          )}
        </AppGate>
      )}
    </QueryClientProvider>
  </StrictMode>,
)
