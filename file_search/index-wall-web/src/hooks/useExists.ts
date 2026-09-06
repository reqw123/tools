import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type PathStat } from '../lib/api'

const CHUNK = 800

/**
 * 路徑存在檢查——lazy 批次。元件把目前可見列的路徑丟進 request()，
 * hook 累積、去重、debounce 後打 /exists，結果快取在 stats 裡。
 * recheckAll() 清掉快取重查（給「重新檢查全部」按鈕）。
 */
export function useExists() {
  const [stats, setStats] = useState<Record<string, PathStat>>({})
  const [checking, setChecking] = useState(false)
  const known = useRef<Set<string>>(new Set())
  const pending = useRef<Set<string>>(new Set())
  const inflight = useRef<Set<string>>(new Set())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  const flush = useCallback(async () => {
    const batch = [...pending.current]
    pending.current.clear()
    if (batch.length === 0) return
    batch.forEach((p) => inflight.current.add(p))
    setChecking(true)
    try {
      for (let i = 0; i < batch.length; i += CHUNK) {
        const slice = batch.slice(i, i + CHUNK)
        const got = await api.exists(slice)
        if (!alive.current) return
        setStats((prev) => ({ ...prev, ...got }))
        slice.forEach((p) => {
          known.current.add(p)
          inflight.current.delete(p)
        })
      }
    } catch {
      batch.forEach((p) => inflight.current.delete(p))
    } finally {
      if (alive.current) setChecking(pending.current.size > 0 || inflight.current.size > 0)
    }
  }, [])

  const request = useCallback(
    (paths: string[]) => {
      let added = false
      for (const p of paths) {
        if (known.current.has(p) || inflight.current.has(p) || pending.current.has(p)) continue
        pending.current.add(p)
        added = true
      }
      if (!added) return
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(flush, 120)
    },
    [flush],
  )

  const recheckAll = useCallback(
    (paths: string[]) => {
      known.current = new Set()
      inflight.current = new Set()
      pending.current = new Set(paths)
      setStats({})
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(flush, 0)
    },
    [flush],
  )

  return { stats, checking, request, recheckAll }
}
