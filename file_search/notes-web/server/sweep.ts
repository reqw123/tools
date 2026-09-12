/**
 * 定期清掉「時間窗內沒有動靜」的 Map 項目——`share.ts` 的登入限速
 * （`loginFails`）／寫入限速（`writeCounts`）、`activity-routes.ts` 的彈幕冷卻
 * （`lastDanmakuAt`）都是同一種形狀：key＝來源 IP 或身分、value 帶著「上次
 * 動作時間」，視窗過了就該當作沒發生過。原本這三個 Map 只在同一個 key 剛好
 * 又被打中時才順便判斷「窗口過期了、可以重算」，從來沒有主動刪除——公網分享
 * 模式下長期跑，會不斷累積「打過一次就再也沒出現」的訪客 IP，變成緩慢的
 * 記憶體洩漏。這裡用一個共用的定時掃描取代各自為政。
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
