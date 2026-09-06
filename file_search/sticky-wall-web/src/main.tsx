import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import { App } from './App'
import { FocusedNote } from './components/FocusedNote'
import { applySurface } from './lib/surface'

applySurface()

// `?focus=<id>`——desktop-wall 把某則便利貼拖出去變懸浮視窗時，開的就是
// 同一個網頁、同一個 server，只是帶這個參數（見 desktop-wall/main.js 的
// wall-pin-note）。這裡整個換成只畫那一則，不掛 Toolbar／搜尋／批次那些
// 跟完整牆面有關的狀態機——不是在 App.tsx 裡面分支，是在最外層就分流，
// 這樣懸浮視窗完全不用背完整牆面那一整套邏輯。
const focusId = new URLSearchParams(location.search).get('focus')
if (focusId) document.documentElement.classList.add('focus-mode')

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, refetchOnWindowFocus: false } },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {focusId ? <FocusedNote id={focusId} /> : <App />}
    </QueryClientProvider>
  </StrictMode>,
)
