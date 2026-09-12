/**
 * 「指派給你的便利貼快到期／已逾期了」——定期掃描 `dueSummaryAll()`，對有
 * 指派對象的便利貼發站內通知（見 `notifications.ts` 的 'due-soon'／
 * 'due-overdue'）。跟 Node-RED／wallpaper-app 讀的到期角標／鬧鐘是同一份
 * `dueSummaryAll()` 資料，這裡只是多一個「通知指派對象本人」的管道。
 *
 * 同一則便利貼、同一個 `due_at`、同一個階段（快到期／已逾期）**只發一次**——
 * 用 `notifiedKeys` 記已經發過的 `collection:id:due_at:kind`，due_at 改變
 * （編輯到期日、或「這次完成」把重複到期滾到下一次）自然變成新的 key，會
 * 重新判斷、可能再發一次；同一個 due_at 反覆掃描不會重複灌通知。
 *
 * 純記憶體、不持久化——跟 `activity.ts`／`presence.ts` 同一種「重開就重新
 * 開始」取捨：極端情況下重開 server 後同一階段可能再收到一次通知，換來
 * 不用額外維護一份持久化的「已發送」記錄，這種提示性功能不值得為了避免
 * 這種邊界情況增加複雜度。
 */
import { dueSummaryAll } from './store'
import { notify } from './notifications'

const CHECK_INTERVAL_MS = 2 * 60_000 // 到期提醒不需要秒級精確，2 分鐘掃一次夠即時又夠省
/** 超過這麼多筆就整個清空重來——避免長期運作、大量便利貼進進出出時無限累積
 *  （防線用，不是精算過的數字，正常使用量遠遠到不了）。 */
const MAX_TRACKED_KEYS = 5000

const notifiedKeys = new Set<string>()

function checkOnce(): void {
  const { overdue, soon } = dueSummaryAll()
  if (notifiedKeys.size > MAX_TRACKED_KEYS) notifiedKeys.clear()

  for (const [list, kind] of [
    [overdue, 'due-overdue'],
    [soon, 'due-soon'],
  ] as const) {
    for (const n of list) {
      if (!n.assignee) continue
      const key = `${n.collection}:${n.id}:${n.due_at}:${kind}`
      if (notifiedKeys.has(key)) continue
      notifiedKeys.add(key)
      notify(n.assignee, kind, { noteId: n.id, noteTitle: n.title, by: '' })
    }
  }
}

let started = false

export function startDueNotifier(): void {
  if (started) return
  started = true
  const timer = setInterval(checkOnce, CHECK_INTERVAL_MS)
  timer.unref() // 不擋 server 正常關閉
  checkOnce() // 啟動時先掃一次，不用等第一個間隔過去
}
