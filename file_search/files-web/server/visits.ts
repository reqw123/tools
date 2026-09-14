/**
 * 「訪客紀錄」——誰、什麼時候造訪過這面共用索引牆，**持久存檔**（跟
 * activity.ts／presence.ts 的純記憶體不同）。搬自 notes-web/server/visits.ts，
 * 邏輯完全相同，只換了存放路徑（`.share/` 底下，跟索引集本身分開）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { indexDir } from './store'
import { atomicWriteFile } from './atomic-write'

const VISITS_FILE = join(indexDir, '.share', 'visits.json')
const MAX_ENTRIES = 1000

export interface VisitEntry {
  author: string // '' = 匿名，前端顯示「有人」
  at: string
}

function readVisits(): VisitEntry[] {
  try {
    const data = JSON.parse(readFileSync(VISITS_FILE, 'utf-8')) as unknown
    if (!Array.isArray(data)) return []
    return data.filter(
      (x): x is VisitEntry =>
        !!x &&
        typeof x === 'object' &&
        typeof (x as VisitEntry).author === 'string' &&
        typeof (x as VisitEntry).at === 'string',
    )
  } catch {
    return []
  }
}

function writeVisits(list: VisitEntry[]): void {
  atomicWriteFile(VISITS_FILE, JSON.stringify(list, null, 1))
}

/** 記一筆造訪——connections.ts 判定「真的是新連線」才會呼叫這個。 */
export function recordVisit(author: string): VisitEntry {
  const entry: VisitEntry = { author, at: new Date().toISOString() }
  const list = readVisits()
  list.push(entry)
  if (list.length > MAX_ENTRIES) list.splice(0, list.length - MAX_ENTRIES)
  writeVisits(list)
  return entry
}

/** 新到舊。給 `/host` 的文字視窗用；limit 省略＝全部。 */
export function listVisits(limit?: number): VisitEntry[] {
  const out = [...readVisits()].reverse()
  return typeof limit === 'number' && limit > 0 ? out.slice(0, limit) : out
}
