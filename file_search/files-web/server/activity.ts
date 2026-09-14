/**
 * 「誰動了這份索引」——極簡活動記錄，純記憶體（不寫檔），機制搬自
 * `notes-web/server/activity.ts`。動作字典換成索引牆自己的（新增/編輯/
 * 移除索引項目、批次新增/刪除、索引集匯入/新增/刪除），拿掉便利貼專屬的
 * `restore`／`assigned`。
 */
import { emitChange } from './change-bus'

export type ActivityAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'bulk-add'
  | 'bulk-delete'
  | 'index-import'
  | 'index-create'
  | 'index-delete'
  | 'connect'
  | 'disconnect'

export interface ActivityEntry {
  at: string // ISO
  author: string // '' = 匿名，前端顯示「有人」
  action: ActivityAction
  /** 這個動作發生在哪份索引集——connect/disconnect 沒有，是空字串。 */
  indexName: string
  /** 項目顯示用文字（entry 的 name，或索引集名稱本身）；connect/disconnect 是空字串。 */
  title: string
  /** bulk-add/bulk-delete 時＝影響幾筆；其餘不帶。 */
  count?: number
}

const MAX_ENTRIES = 300
const log: ActivityEntry[] = []

export function logActivity(entry: Omit<ActivityEntry, 'at' | 'indexName' | 'title'> & { indexName?: string; title?: string }): void {
  log.push({ at: new Date().toISOString(), indexName: '', title: '', ...entry })
  if (log.length > MAX_ENTRIES) log.splice(0, log.length - MAX_ENTRIES)
  emitChange('activity')
}

/** 新到舊。`limit` 給前端動態列表用；沒給就全部（最多 MAX_ENTRIES）。 */
export function listActivity(limit?: number): ActivityEntry[] {
  const out = [...log].reverse()
  return typeof limit === 'number' ? out.slice(0, limit) : out
}
