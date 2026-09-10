import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import { App } from './App'
import { AuthError } from './lib/api'
import { AppGate } from './components/AppGate'
import { FocusedNote } from './components/FocusedNote'
import { applySurface } from './lib/surface'

applySurface()

// `?focus=<id>`——wallpaper-app 把某則便利貼拖出去變懸浮視窗時，開的就是
// 同一個網頁、同一個 server，只是帶這個參數（見 wallpaper-app/main.js 的
// wall-pin-note）。這裡整個換成只畫那一則，不掛 Toolbar／搜尋／批次那些
// 跟完整牆面有關的狀態機——不是在 App.tsx 裡面分支，是在最外層就分流，
// 這樣懸浮視窗完全不用背完整牆面那一整套邏輯。
const focusId = new URLSearchParams(location.search).get('focus')
if (focusId) document.documentElement.classList.add('focus-mode')

// 區網共用模式：任何 query／mutation 收到 AuthError（cookie 過期）就把 session
// 標成失效，AppGate 會自動退回密碼牆。一般單機模式永遠不會走到這裡。
const onAuthError = (err: unknown) => {
  if (err instanceof AuthError) queryClient.setQueryData(['session'], false)
}

const queryClient: QueryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, refetchOnWindowFocus: false } },
  queryCache: new QueryCache({ onError: onAuthError }),
  mutationCache: new MutationCache({ onError: onAuthError }),
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppGate>{focusId ? <FocusedNote id={focusId} /> : <App />}</AppGate>
    </QueryClientProvider>
  </StrictMode>,
)
