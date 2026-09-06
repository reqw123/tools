import { useEffect, useState } from 'react'

type Theme = 'system' | 'light' | 'dark'
const NEXT: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' }
const ICON: Record<Theme, string> = { system: '◐', light: '☀', dark: '☾' }
const KEY = 'index-wall-theme'

function read(): Theme {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    /* private mode etc. */
  }
  return 'system'
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(read)

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

  return (
    <button
      className="toggle"
      onClick={() => setTheme((t) => NEXT[t])}
      aria-label={`主題：${theme}，點擊切換`}
      title={`主題：${theme}`}
    >
      {ICON[theme]}
    </button>
  )
}
