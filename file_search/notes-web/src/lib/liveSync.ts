import { useSyncExternalStore } from 'react'

/**
 * SSE 即時同步的連線狀態——放一個極簡外部 store，讓 `useLiveSync`（維護連線）
 * 和 `useNotes`（連線正常時就不用輪詢）共用。
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

/**
 * 彈幕——走跟上面「連線狀態」一樣的極簡外部 store 模式，但這裡不是狀態、是
 * 事件流：彈幕不寫檔、沒有對應的 query 可以 invalidate，`useLiveSync` 收到
 * SSE 的具名事件 `danmaku` 就直接呼叫 `emitDanmakuEvent()` 轉發，`DanmakuLayer`
 * 訂閱它來播放。只有一條 SSE 連線（`useLiveSync` 開的那條），這裡只是讓
 * 「連線本身」跟「彈幕訂閱者」不用耦合在同一個 hook 裡。
 */
export interface DanmakuMessage {
  id: string
  author: string
  text: string
  at: number
}
const danmakuListeners = new Set<(msg: DanmakuMessage) => void>()

export function emitDanmakuEvent(msg: DanmakuMessage): void {
  for (const fn of danmakuListeners) fn(msg)
}

/** 回傳取消訂閱函式。 */
export function subscribeDanmaku(fn: (msg: DanmakuMessage) => void): () => void {
  danmakuListeners.add(fn)
  return () => danmakuListeners.delete(fn)
}
