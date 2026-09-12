/**
 * 「看板」——固定網址 `/card`（不帶 id），畫面內容＝**後端目前指定**的那一則
 * 便利貼；換內容是打 `POST /api/card { noteId }`，不是改網址。給投影機／展示
 * 螢幕這種「網址設一次、之後只換內容」的場景用：那台裝置永遠開著 `/card`，
 * 別人在自己的電腦上換看板，那台螢幕自己就會透過 SSE 立刻換掉，不用碰它。
 *
 * 跟 activity／presence 不同：這個**要持久**（不然展示螢幕重開一次 server
 * 就變空的），用跟 people.ts 一樣的原子寫入存一個小檔案。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { notesFilePath, getNote, getActiveCollection, setActiveCollection } from './store'
import { emitChange } from './change-bus'
import { atomicWriteFile } from './atomic-write'

// 2026-09 搬進 .share/（純 notes-web 概念、桌面版不讀，跟身分／訪客紀錄
// 放在一起——見 store.ts 的 migrateLegacyDataLayout() 負責把舊位置的檔案
// 一次性搬過來）。
const CARD_FILE = join(dirname(notesFilePath), '.share', 'card.json')

export interface CardState {
  /** 目前指定的便利貼 id；null＝看板是空的（顯示「尚未指定」）。 */
  noteId: string | null
  /** 最後一次換內容的時間，ISO；還沒設過是 ''。 */
  setAt: string
}

const EMPTY: CardState = { noteId: null, setAt: '' }

function readCard(): CardState {
  try {
    const d = JSON.parse(readFileSync(CARD_FILE, 'utf-8')) as unknown
    if (d && typeof d === 'object') {
      const o = d as Record<string, unknown>
      return {
        noteId: typeof o.noteId === 'string' ? o.noteId : null,
        setAt: typeof o.setAt === 'string' ? o.setAt : '',
      }
    }
  } catch {
    /* 檔案不存在或壞掉 → 當作還沒設過 */
  }
  return EMPTY
}

function writeCard(state: CardState): void {
  atomicWriteFile(CARD_FILE, JSON.stringify(state, null, 1))
}

export function getCard(): CardState {
  return readCard()
}

export interface SetCardResult {
  ok: boolean
  error?: string
  state?: CardState
}

/** noteId＝null 就是清空看板（顯示「尚未指定」）；不是 null 的話要真的存在
 *  （生活便利貼——看板固定給遠端也看得到的生活牆用，跟研究生牆隔開）。
 *
 *  存在性檢查**固定查生活牆**，不跟著這個 request 當下的
 *  `x-note-collection` 標頭走——牆主若在本機用研究生模式（thesis
 *  collection）點「設為看板」，`getNote()` 不鎖定 collection 的話會在論文
 *  便利貼裡找到、把它存成看板內容，但遠端訪客固定被導去生活牆，`/card`
 *  永遠找不到這個 id，會一直顯示「尚未指定」——鎖定生活牆才能一致。 */
export function setCard(noteId: string | null): SetCardResult {
  if (noteId !== null) {
    const prev = getActiveCollection()
    setActiveCollection('life')
    const exists = !!getNote(noteId)
    setActiveCollection(prev)
    if (!exists) {
      return { ok: false, error: '這則便利貼不存在（可能剛被刪除）' }
    }
  }
  const state: CardState = { noteId, setAt: new Date().toISOString() }
  writeCard(state)
  emitChange('card')
  return { ok: true, state }
}
