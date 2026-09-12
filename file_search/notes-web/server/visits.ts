/**
 * 「訪客紀錄」——誰、什麼時候造訪過這面共用牆，**持久存檔**（跟 activity.ts／
 * presence.ts 的純記憶體不同）：給 `/host` 的「訪客紀錄」文字視窗、跟
 * Node-RED 輪詢轉發 Discord 用，重開 server 不會不見。只記「連線」這個時間
 * 點（見 connections.ts 的 `connectionOpened()`，用同一套「換頁／重整不算
 * 新訪客」判斷），不記斷線——host 想看的是「誰來過、什麼時候」，不是精確
 * 線上時長，跟 activity.ts 的 connect/disconnect 一對分開記是兩回事。
 *
 * 跟 people.ts／card.ts 同一套原子寫入 pattern（tmp + rename）。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { notesFilePath } from './store'
import { atomicWriteFile } from './atomic-write'

// 2026-09 搬進 .share/（純 notes-web 概念、桌面版不讀——見 store.ts 的
// migrateLegacyDataLayout() 負責把舊位置的檔案一次性搬過來）。
const VISITS_FILE = join(dirname(notesFilePath), '.share', 'visits.json')
/** 留最新這麼多筆——給 host 回顧用的提示性紀錄，不需要無限成長。 */
const MAX_ENTRIES = 1000

export interface VisitEntry {
  author: string // '' = 匿名，前端顯示「有人」
  at: string // ISO，跟 activity.ts 的 at 同格式
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
    return [] // 檔案不存在或壞掉 → 當作還沒有任何紀錄
  }
}

function writeVisits(list: VisitEntry[]): void {
  atomicWriteFile(VISITS_FILE, JSON.stringify(list, null, 1))
}

/** 記一筆造訪——connections.ts 判定「真的是新連線」（不是換頁／重整那種瞬斷
 *  瞬連）才會呼叫這個。回傳這筆記錄本身，方便呼叫端不用另外組一次。 */
export function recordVisit(author: string): VisitEntry {
  const entry: VisitEntry = { author, at: new Date().toISOString() }
  const list = readVisits()
  list.push(entry)
  if (list.length > MAX_ENTRIES) list.splice(0, list.length - MAX_ENTRIES)
  writeVisits(list)
  return entry
}

/** 新到舊。給 `/host` 的文字視窗、跟 Node-RED 輪詢用；limit 省略＝全部
 *  （最多就是 MAX_ENTRIES 筆，不會真的很大）。 */
export function listVisits(limit?: number): VisitEntry[] {
  const out = [...readVisits()].reverse()
  return typeof limit === 'number' && limit > 0 ? out.slice(0, limit) : out
}
