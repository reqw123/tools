/**
 * 定期清掉「時間窗內沒有動靜」的 Map 項目——`share.ts` 的登入限速
 * （`loginFails`）／寫入限速（`writeCounts`）都是同一種形狀：key＝來源 IP、
 * value 帶著「上次動作時間」，視窗過了就該當作沒發生過。原本這種 Map 只在
 * 同一個 key 剛好又被打中時才順便判斷「窗口過期了、可以重算」，從來沒有
 * 主動刪除——公網分享模式下長期跑，會不斷累積「打過一次就再也沒出現」的
 * 訪客 IP，變成緩慢的記憶體洩漏。直接搬自 notes-web/server/sweep.ts。
 */
export function startSweeper<K, V>(
  map: Map<K, V>,
  lastSeenAt: (value: V) => number,
  maxAgeMs: number,
  intervalMs = maxAgeMs,
): void {
  const timer = setInterval(() => {
    const now = Date.now()
    for (const [key, value] of map) {
      if (now - lastSeenAt(value) > maxAgeMs) map.delete(key)
    }
  }, intervalMs)
  timer.unref() // 不擋 server 正常關閉
}
