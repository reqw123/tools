import { useEffect, useState } from 'react'

/**
 * 每分鐘回傳一個會遞增的數字——用來讓「純粹看目前時間」的畫面（到期徽章、
 * 「只看快到期」篩選）自己隨時間翻新，不用等使用者操作或 react-query 重抓。
 * 把回傳值放進 useMemo／元件的 deps，就會跟著每分鐘重算一次。
 *
 * 對齊到「下一個整分」而不是死板的 setInterval(60_000)，徽章從「即將到期」
 * 翻成「已逾期」的時間點才會貼近真正的分鐘邊界。純視覺提示、不是鬧鐘，
 * 差幾秒無妨。
 */
export function useMinuteTick(): number {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const schedule = () => {
      const msToNextMinute = 60_000 - (Date.now() % 60_000)
      timer = setTimeout(() => {
        setTick((t) => t + 1)
        schedule()
      }, msToNextMinute + 50)
    }
    schedule()
    return () => clearTimeout(timer)
  }, [])
  return tick
}
