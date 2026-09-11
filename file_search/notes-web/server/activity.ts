/**
 * 「誰動了我的牆」——極簡活動記錄，純記憶體（不寫檔）：
 *   - 不必再管另一份 JSON 的 schema／損毀／跟桌面版共用格式的問題
 *   - server 重開＝重新開始，這對「最近誰做了什麼」這種提示性資訊完全夠用，
 *     也剛好順便避免共用密碼換掉之後，新的人還看得到舊使用者名字的殘留
 *
 * 只記「新增／編輯／刪除／復原」這幾個使用者最關心的動作——勾待辦、釘選、換圖
 * 那些太頻繁，記了也是雜訊，見呼叫端 notes.ts 只在這幾個路由呼叫 logActivity()。
 */
import { emitChange } from './change-bus'

export type ActivityAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'restore'
  | 'bulk-delete'
  | 'connect'
  | 'disconnect'

export interface ActivityEntry {
  at: string // ISO
  author: string // '' = 匿名（沒填名字），前端顯示「有人」
  action: ActivityAction
  noteId?: string
  /** connect/disconnect 沒有對應的便利貼，這個欄位是空字串。 */
  title: string
  /** bulk-delete 時＝刪了幾則；其餘不帶。 */
  count?: number
}

const MAX_ENTRIES = 300
const log: ActivityEntry[] = []

export function logActivity(entry: Omit<ActivityEntry, 'at'>): void {
  log.push({ at: new Date().toISOString(), ...entry })
  if (log.length > MAX_ENTRIES) log.splice(0, log.length - MAX_ENTRIES)
  emitChange('activity')
}

/** 新到舊。`limit` 給前端動態列表用；沒給就全部（最多 MAX_ENTRIES）。 */
export function listActivity(limit?: number): ActivityEntry[] {
  const out = [...log].reverse()
  return typeof limit === 'number' ? out.slice(0, limit) : out
}

/** 某則便利貼最後一筆動態（給卡片／編輯視窗顯示「最後動過：小明」用）；沒有回 undefined。 */
export function lastActivityFor(noteId: string): ActivityEntry | undefined {
  for (let i = log.length - 1; i >= 0; i -= 1) {
    if (log[i]!.noteId === noteId) return log[i]
  }
  return undefined
}
