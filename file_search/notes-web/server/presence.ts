/**
 * 「誰正在編輯這則」——極簡在場提示，純記憶體。**支援同一則被多人同時編輯**：
 * 每則便利貼底下是一個「編輯者」的集合，不是單一一個值——多人共用時，A、B
 * 兩人同時打開同一則，畫面要同時看到兩個人，不能只顯示其中一個。
 *
 * 編輯者用「名字」當 key（具名、通過 PIN 驗證的人本來就該視為同一個身分，
 * 多開視窗也該合併成一個）；**匿名**（沒填名字）分不出是誰，退而求其次用
 * 來源 IP＋前端隨機產生的 `clientId`（見 `src/lib/identity.ts` 的
 * `getClientId()`，存在 sessionStorage，每個分頁一份）當 key，讓同一 IP
 * 下（同一 Wi-Fi／NAT，區網共用牆很常見）的不同匿名使用者也能分開顯示，
 * 不會全部撞成同一個「有人」——單純用 IP 當 key 撞在一起的話，A、B 兩人的
 * 心跳會互相蓋掉對方，A 關掉編輯視窗甚至會讓 B 瞬間從 presence 消失。
 * `clientId` 是舊版前端可能沒帶的可選欄位，沒帶就退回純 IP 當 key（行為跟
 * 修這個問題之前一樣，只是不再是唯一路徑）。
 *
 * 前端編輯視窗開著時每 5 秒打一次心跳；關掉視窗／或 12 秒沒心跳就自動視為
 * 「編完了」。跟 activity 一樣不寫檔——重開 server 就清空，本來就只是即時提示。
 */
import { emitChange } from './change-bus'

const TTL_MS = 12_000
interface Entry {
  author: string // '' = 匿名，前端顯示「有人」
  expiresAt: number
}
// noteId -> editorKey(author, ip, clientId) -> Entry
const editing = new Map<string, Map<string, Entry>>()

/** 具名就用名字（多開視窗合併成一個）；匿名退而求其次用 IP＋clientId，讓同
 *  IP 下的不同分頁／使用者分開算（見上面模組說明）。 */
function editorKey(author: string, ip: string, clientId?: string): string {
  return author || `anon:${ip}:${clientId || ''}`
}

/** 清掉過期的心跳；整則沒人編了就把那則的 Map 也移除。回傳「有沒有東西被清掉」。 */
function sweep(): boolean {
  const now = Date.now()
  let changed = false
  for (const [noteId, editors] of editing) {
    for (const [key, e] of editors) {
      if (e.expiresAt <= now) {
        editors.delete(key)
        changed = true
      }
    }
    if (editors.size === 0) editing.delete(noteId)
  }
  return changed
}
// 背景清一次，不必等下次有人讀／寫才發現某個人的「正在編輯」該消失了。
setInterval(() => {
  if (sweep()) emitChange('presence')
}, 4_000).unref?.()

export function heartbeat(noteId: string, author: string, ip: string, clientId?: string): void {
  const swept = sweep()
  const key = editorKey(author, ip, clientId)
  let editors = editing.get(noteId)
  const isNew = !editors?.has(key)
  if (!editors) {
    editors = new Map()
    editing.set(noteId, editors)
  }
  editors.set(key, { author, expiresAt: Date.now() + TTL_MS })
  if (swept || isNew) emitChange('presence')
}

export function stopEditing(noteId: string, author: string, ip: string, clientId?: string): void {
  const editors = editing.get(noteId)
  const had = editors?.delete(editorKey(author, ip, clientId)) ?? false
  if (editors && editors.size === 0) editing.delete(noteId)
  const swept = sweep()
  if (had || swept) emitChange('presence')
}

/** noteId → 正在編輯的人名清單（可能有重複的 ''＝好幾個匿名的人）。給 `GET /api/presence` 用。 */
export function currentEditors(): Record<string, string[]> {
  sweep()
  return Object.fromEntries(
    [...editing].map(([noteId, editors]) => [noteId, [...editors.values()].map((e) => e.author)]),
  )
}
