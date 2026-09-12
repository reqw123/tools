/**
 * 「站內通知」——目前只有一種：便利貼指派給你了。**持久存檔**（跟
 * activity.ts／presence.ts 的純記憶體不同，仿 visits.ts 的結構），server 重開
 * 不會不見。`to` 是收件人名字，空字串（匿名）不會收到——匿名沒有地方能
 * 「回來領取」自己的通知。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { notesFilePath } from './store'
import { atomicWriteFile } from './atomic-write'
import { emitChange } from './change-bus'

const NOTIFICATIONS_FILE = join(dirname(notesFilePath), '.share', 'notifications.json')
/** 全域上限（不是每人上限）——避免長期公開運作無限累積，跟 visits.ts 的
 *  MAX_ENTRIES 同一個防線層級。 */
const MAX_ENTRIES = 500

export type NotificationKind = 'assigned'

export interface NotificationEntry {
  id: string
  to: string
  kind: NotificationKind
  noteId: string
  noteTitle: string
  by: string
  at: string
  read: boolean
}

function readAll(): NotificationEntry[] {
  try {
    const data = JSON.parse(readFileSync(NOTIFICATIONS_FILE, 'utf-8')) as unknown
    if (!Array.isArray(data)) return []
    return data.filter(
      (x): x is NotificationEntry =>
        !!x &&
        typeof x === 'object' &&
        typeof (x as NotificationEntry).id === 'string' &&
        typeof (x as NotificationEntry).to === 'string' &&
        typeof (x as NotificationEntry).noteId === 'string' &&
        typeof (x as NotificationEntry).at === 'string',
    )
  } catch {
    return [] // 檔案不存在或壞掉 → 當作還沒有任何通知
  }
}

function writeAll(list: NotificationEntry[]): void {
  atomicWriteFile(NOTIFICATIONS_FILE, JSON.stringify(list, null, 1))
  emitChange('notifications')
}

/** 發一則通知——`to` 是空字串（匿名）就不寫，沒地方領。 */
export function notify(
  to: string,
  kind: NotificationKind,
  payload: { noteId: string; noteTitle: string; by: string },
): void {
  if (!to) return
  const list = readAll()
  list.push({
    id: crypto.randomUUID().replace(/-/g, ''),
    to,
    kind,
    noteId: payload.noteId,
    noteTitle: payload.noteTitle,
    by: payload.by,
    at: new Date().toISOString(),
    read: false,
  })
  if (list.length > MAX_ENTRIES) list.splice(0, list.length - MAX_ENTRIES)
  writeAll(list)
}

/** 新到舊，只回這個人的通知——匿名（''）永遠回空陣列。 */
export function listNotifications(forName: string): NotificationEntry[] {
  if (!forName) return []
  return readAll()
    .filter((n) => n.to === forName)
    .reverse()
}

/** 只能標記自己的通知，避免亂猜 id 標記別人的。回傳這個 id 是不是真的存在
 *  （屬於這個人）——給路由層判斷要不要回 404，不代表「有沒有改到東西」
 *  （本來就已讀也算成功，冪等）。 */
export function markRead(id: string, forName: string): boolean {
  if (!forName) return false
  const list = readAll()
  const entry = list.find((n) => n.id === id && n.to === forName)
  if (!entry) return false
  if (!entry.read) {
    entry.read = true
    writeAll(list)
  }
  return true
}

export function markAllRead(forName: string): number {
  if (!forName) return 0
  const list = readAll()
  let n = 0
  for (const entry of list) {
    if (entry.to === forName && !entry.read) {
      entry.read = true
      n += 1
    }
  }
  if (n > 0) writeAll(list)
  return n
}
