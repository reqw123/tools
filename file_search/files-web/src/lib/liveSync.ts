import { useSyncExternalStore } from 'react'

/**
 * SSE 即時同步的連線狀態——放一個極簡外部 store，搬自
 * notes-web/src/lib/liveSync.ts（拿掉彈幕相關的部分，索引牆沒有這個功能）。
 */
let connected = false
const listeners = new Set<() => void>()

export function setLiveConnected(v: boolean): void {
  if (connected === v) return
  connected = v
  for (const fn of listeners) fn()
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** SSE 目前是否連著。連著＝資料靠推播即時更新，不必輪詢。 */
export function useLiveConnected(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => connected,
    () => false,
  )
}
