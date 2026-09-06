import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import { App } from './App'
import { FocusedEntry } from './components/FocusedEntry'
import { applySurface } from './lib/surface'

applySurface()

// `?focus=<path>&index=<indexName>`——wallpaper-app 把某個索引項目拖出去變
// 懸浮視窗時，開的就是同一個網頁、同一個 server，只是帶這兩個參數（見
// wallpaper-app/main.js 的 pinEntryWindow）。這裡整個換成只畫那一列，不掛
// Toolbar／篩選／批次那些跟完整列表有關的狀態機——不是在 App.tsx 裡面
// 分支，是在最外層就分流，這樣懸浮視窗完全不用背完整列表那一整套邏輯。
const params = new URLSearchParams(location.search)
const focusPath = params.get('focus')
const focusIndex = params.get('index')
if (focusPath && focusIndex) document.documentElement.classList.add('focus-mode')

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, refetchOnWindowFocus: false } },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {focusPath && focusIndex ? (
        <FocusedEntry indexName={focusIndex} path={focusPath} />
      ) : (
        <App />
      )}
    </QueryClientProvider>
  </StrictMode>,
)
