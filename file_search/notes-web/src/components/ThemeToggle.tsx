import { useEffect, useState } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'

type Theme = 'system' | 'light' | 'dark'
const NEXT: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' }
const LABEL: Record<Theme, string> = { system: '系統', light: '淺色', dark: '深色' }
const NEXT_LABEL: Record<Theme, string> = { system: '淺色', light: '深色', dark: '跟隨系統' }
const KEY = 'sticky-wall-theme'

function read(): Theme {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    /* private mode etc. */
  }
  return 'system'
}

function prefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

/**
 * 三段主題切換：跟隨系統 → 固定淺色 → 固定深色 → 回到跟隨系統。
 * 「跟隨系統」時按鈕直接標出目前解析成淺／深（`系統（淺）`），因為系統本身
 * 就是淺色時，「跟隨系統」和「固定淺色」畫面一樣，沒標的話看不出差別。
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(read)
  const [sysDark, setSysDark] = useState(prefersDark)

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
    try {
      localStorage.setItem(KEY, theme)
    } catch {
      /* ignore */
    }
  }, [theme])

  useEffect(() => {
    let mq: MediaQueryList
    try {
      mq = window.matchMedia('(prefers-color-scheme: dark)')
    } catch {
      return
    }
    const on = () => setSysDark(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor
  const text = theme === 'system' ? `系統（${sysDark ? '深' : '淺'}）` : LABEL[theme]
  const title =
    theme === 'system'
      ? `外觀：跟隨系統（目前為${sysDark ? '深色' : '淺色'}）· 點一下改用${NEXT_LABEL[theme]}`
      : `外觀：固定${LABEL[theme]} · 點一下改用${NEXT_LABEL[theme]}`

  return (
    <button
      className="toggle"
      onClick={() => setTheme((t) => NEXT[t])}
      aria-label={title}
      title={title}
    >
      <Icon size={15} strokeWidth={2.2} aria-hidden />
      <span>{text}</span>
    </button>
  )
}
