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
