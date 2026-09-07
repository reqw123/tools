export interface Line {
  kind: 'task' | 'field'
  text: string
  /** task 專用：內文那一行開頭有 `[x]` 就是已勾選。field 一律 undefined。 */
  checked?: boolean
  /** 這一項對應到 `body.split('\n')` 的第幾行——勾選切換時要改的就是那行
   *  （parseBody 會濾掉空行、trim，所以顯示順序 ≠ 原始行號，得另外帶）。 */
  srcIndex: number
}

/**
 * 一行待辦的結構：`<前綴（項目符號/編號，可無）><勾選標記 [x]/[ ]（可無）><內容>`。
 * 三個群組都可選、整條一定 match。桌面版沒有對應實作（桌面不渲染清單），
 * 但 server/store.ts 的 toggleNoteLine 有一份一樣的——改這裡記得兩邊一起改。
 */
export const TASK_LINE_RE = /^(\s*(?:\d+[.、)]|[-•])?\s*)(\[[ xX]\]\s*)?(.*)$/

/**
 * 便利貼內文分行後判斷型態：
 *  - 只有一行（或整段是一句話）→ 當段落，回傳 { paragraph }
 *  - 以「：」「:」結尾 → 表單欄位（畫虛線填空）
 *  - 其餘 → 待辦項（畫方框；開頭 `[x]`/`[ ]` 及項目符號/編號會被吃掉，
 *    `[x]` 記成 checked）
 */
export function parseBody(body: string): { paragraph: string } | { lines: Line[] } {
  const nonBlank: { text: string; srcIndex: number }[] = []
  body.split('\n').forEach((l, i) => {
    const t = l.trim()
    if (t) nonBlank.push({ text: t, srcIndex: i })
  })
  if (nonBlank.length <= 1) return { paragraph: nonBlank[0]?.text ?? '' }
  const lines: Line[] = nonBlank.map(({ text: l, srcIndex }) => {
    if (/[:：]$/.test(l)) return { kind: 'field', text: l, srcIndex }
    const m = l.match(TASK_LINE_RE)!
    return { kind: 'task', text: m[3], checked: /x/i.test(m[2] ?? ''), srcIndex }
  })
  return { lines }
}

/**
 * 切換 `body` 裡第 `srcIndex` 行（`body.split('\n')` 的索引）的待辦勾選——
 * 在該行前綴後面加上 `[x] `，或（已勾選時）直接拿掉標記回到「沒有框」。
 * 回傳新的 body 字串；索引超界、或那行是填空欄（結尾「：」）就原樣回傳。
 * 前端樂觀更新用；真正的存檔走 server 端同一套規則（toggleNoteLine）。
 */
export function toggleBodyLine(body: string, srcIndex: number): string {
  const lines = body.split('\n')
  if (srcIndex < 0 || srcIndex >= lines.length) return body
  if (/[:：]\s*$/.test(lines[srcIndex])) return body
  const m = lines[srcIndex].match(TASK_LINE_RE)!
  const checked = /x/i.test(m[2] ?? '')
  lines[srcIndex] = checked ? `${m[1]}${m[3]}` : `${m[1]}[x] ${m[3]}`
  return lines.join('\n')
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
// 的 parse_due_date/format_due_date/format_due_time 同一套存檔格式（那邊
// docstring 有完整理由）：存成完整的 ISO datetime。使用者只填日期沒填時間
// 時，存當天 23:59:59（END_OF_DAY 哨兵）——語意是「當天內到期」，也是所有
// 舊資料的值，顯示時視為「沒有具體時間」不秀 23:59。填了時間就存成當天
// HH:MM:00，提醒精確到分。兩邊寫同一份 .sticky_notes.json，格式要一致。
//
// 「幾小時內算快到期」這個門檻在 notes-web 這邊是可調的（見 lib/api.ts 的
// ReminderSettings、「⏰ 提醒設定」對話框），桌面版目前還是固定 2 天——
// 這裡的預設值只在還沒讀到使用者設定值那一瞬間當退回值用。

/** dueStatus() 沒指定 soonHours 時的退回值——跟後端 server/store.ts 的
 *  DEFAULT_DUE_SOON_HOURS 一致（改動門檻邏輯時兩邊要一起改）。 */
export const DEFAULT_DUE_SOON_HOURS = 48

/** 只填日期沒指定時間時存的時刻（見上面說明）。 */
const DUE_END_OF_DAY = '23:59:59'

/** `<input type="date">`＋`<input type="time">` 的值 → 存檔用的完整 ISO。
 *  沒有日期 → ''。有日期沒時間 → 當天 23:59:59。有時間（HH:MM）→ 當天
 *  HH:MM:00。 */
export function toStoredDueAt(dateOnly: string, timeOnly = ''): string {
  if (!dateOnly) return ''
  const hhmm = /^\d{2}:\d{2}$/.test(timeOnly) ? timeOnly : ''
  return hhmm ? `${dateOnly}T${hhmm}:00` : `${dateOnly}T${DUE_END_OF_DAY}`
}

/** 存檔格式的到期日 → `<input type="date">` 要顯示的 `YYYY-MM-DD`。空字串
 *  或格式壞掉都當作沒有到期日。 */
export function fromStoredDueAt(dueAt: string): string {
  return dueAt ? dueAt.slice(0, 10) : ''
}

/** 存檔格式的到期日 → `<input type="time">` 要顯示的 `HH:MM`；沒有到期日、
 *  格式壞掉、或時間正好是 END_OF_DAY 哨兵（沒指定具體時間）都回 ''。 */
export function timeFromStoredDueAt(dueAt: string): string {
  if (!dueAt || dueAt.length < 19 || dueAt.slice(11, 19) === DUE_END_OF_DAY) return ''
  const hhmm = dueAt.slice(11, 16)
  return /^\d{2}:\d{2}$/.test(hhmm) ? hhmm : ''
}

/** 到期徽章上顯示的字串——只有日期，或「日期 HH:MM」（有指定時間時）。
 *  沒有到期日回 ''。 */
export function dueLabel(dueAt: string): string {
  const date = fromStoredDueAt(dueAt)
  if (!date) return ''
  const time = timeFromStoredDueAt(dueAt)
  return time ? `${date} ${time}` : date
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
