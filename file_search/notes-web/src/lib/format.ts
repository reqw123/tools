export interface Line {
  kind: 'task' | 'field'
  text: string
}

/**
 * 便利貼內文分行後判斷型態：
 *  - 只有一行（或整段是一句話）→ 當段落，回傳 { paragraph }
 *  - 以「：」「:」結尾 → 表單欄位（畫虛線填空）
 *  - 其餘 → 待辦項（畫空心方框），數字/符號開頭會去掉前綴
 */
export function parseBody(body: string): { paragraph: string } | { lines: Line[] } {
  const raw = body.split('\n').map((l) => l.trim()).filter(Boolean)
  if (raw.length <= 1) return { paragraph: raw[0] ?? '' }
  const lines: Line[] = raw.map((l) => {
    if (/[:：]$/.test(l)) return { kind: 'field', text: l }
    const m = l.match(/^(?:\d+[.、)]|[-•])\s*(.*)$/)
    return { kind: 'task', text: m ? m[1] : l }
  })
  return { lines }
}

/** created_at（ISO 字串）→ 「2026.09.02 01:10」。 */
export function stamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}  ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 標題字串的穩定雜湊（FNV-1a）——用來決定便利貼的傾斜角與釘法，重新整理不會變。 */
export function seedOf(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function tiltOf(seed: number): number {
  return ((seed % 1000) / 1000) * 5 - 2.5
}

// 到期日提醒——純視覺提示，不主動跳通知，跟桌面版 sticky_note_service.py
// 的 parse_due_date/format_due_date 同一套存檔格式（那邊 docstring 有完整
// 理由）：存成當天 23:59:59（不是 00:00:00），到期日在今天（含）以前算
// 逾期。兩邊寫同一份 .sticky_notes.json，格式要一致，不然同一則便利貼在
// 桌面版/網頁版會顯示不同的到期狀態。
//
// 「幾小時內算快到期」這個門檻在 notes-web 這邊是可調的（見 lib/api.ts 的
// ReminderSettings、「⏰ 提醒設定」對話框），桌面版目前還是固定 2 天——
// 這裡的預設值只在還沒讀到使用者設定值那一瞬間當退回值用。

/** dueStatus() 沒指定 soonHours 時的退回值——跟後端 server/store.ts 的
 *  DEFAULT_DUE_SOON_HOURS 一致（改動門檻邏輯時兩邊要一起改）。 */
export const DEFAULT_DUE_SOON_HOURS = 48

/** `<input type="date">` 給的 `YYYY-MM-DD` → 存檔用的完整 ISO（23:59:59）。
 *  空字串（清除到期日）原樣回傳空字串。 */
export function toStoredDueAt(dateOnly: string): string {
  return dateOnly ? `${dateOnly}T23:59:59` : ''
}

/** 存檔格式的到期日 → `<input type="date">` 要顯示的 `YYYY-MM-DD`。空字串
 *  或格式壞掉都當作沒有到期日。 */
export function fromStoredDueAt(dueAt: string): string {
  return dueAt ? dueAt.slice(0, 10) : ''
}

/** 卡片標色分類：`'overdue'`／`'soon'`／`''`（沒有到期日，或還早）。
 *  `soonHours` 來自 useReminderSettings()，呼叫端沒傳（或還在載入中）就用
 *  DEFAULT_DUE_SOON_HOURS 頂著，不會因為設定值還沒讀回來就整個不標色。 */
export function dueStatus(
  dueAt: string,
  soonHours = DEFAULT_DUE_SOON_HOURS,
  now = new Date(),
): 'overdue' | 'soon' | '' {
  if (!dueAt) return ''
  const due = new Date(dueAt)
  if (Number.isNaN(due.getTime())) return ''
  if (due < now) return 'overdue'
  if (due.getTime() - now.getTime() <= soonHours * 3_600_000) return 'soon'
  return ''
}

/** 位元組數 → 「1.2 MB」這種可讀字串，給「AI 生成便利貼」的選檔面板用。 */
export function humanSize(bytes: number | undefined): string {
  if (bytes === undefined) return ''
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let n = bytes / 1024
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i += 1
  }
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`
}
