import type { Note } from './api'
import { todoProgress } from './format'

export type NoteSort =
  | 'auto'
  | 'newest'
  | 'oldest'
  | 'title'
  | 'todo-most'
  | 'todo-least'
  | 'tag-band'

export const NOTE_SORTS: { id: NoteSort; label: string }[] = [
  // 「不指定」＝交給牆面自己安排：「看全部」時依分類分區（外觀設定的直向／
  // 橫向），選了分類／搜尋時才退回「最新建立在前」。挑其他任何一個就是一律
  // 攤平、照那個 key 排（不再依分類分區），新建的便利貼就會確實排到最前面。
  { id: 'auto', label: '不指定（依分類分區）' },
  // 同分類集中成一「帶」、帶與帶之間硬換行＋分隔線——強調分類界線（看全部限定）。
  { id: 'tag-band', label: '同分類集中（分類間隔開）' },
  { id: 'newest', label: '最新建立' },
  { id: 'oldest', label: '最早建立' },
  { id: 'title', label: '標題 A→Z' },
  { id: 'todo-most', label: '未完成待辦最多' },
  // 只看「真的有待辦框」的便利貼、未完成最少在前；純文字備忘不列入（見 App shown）。
  { id: 'todo-least', label: '未完成待辦最少（限有待辦的）' },
]

const KEY = 'sticky-wall-note-sort'

export function readNoteSort(): NoteSort {
  try {
    const v = localStorage.getItem(KEY)
    if (NOTE_SORTS.some((s) => s.id === v)) return v as NoteSort
  } catch {
    /* private mode */
  }
  // 沒存過＝從來沒動過這個下拉：維持原本「看全部依分類分區」的樣子。
  return 'auto'
}

export function saveNoteSort(v: NoteSort): void {
  try {
    localStorage.setItem(KEY, v)
  } catch {
    /* private mode */
  }
}

/** 內文裡「還沒打勾的待辦」數量——整段是段落、或每行都是填空欄（結尾「：」）時是 0。 */
export function openTodoCount(body: string): number {
  const p = todoProgress(body)
  return p ? p.total - p.done : 0
}

/** 內文裡「至少有一個待辦框」——純段落／全是填空欄的便利貼回 false。
 *  「未完成待辦最少」排序用：沒有待辦框的便利貼會被 0 排到最前面，沒意義，要排除。 */
export function hasTodoItems(body: string): boolean {
  return todoProgress(body) !== null
}

/**
 * 依所選模式排牆面。**釘選的永遠在最前面**（釘選內部也照同一個 key 排）。
 * `todo` 是 `note.id → 未完成待辦數` 的對照表——呼叫端先算好傳進來，
 * 免得每次比較都重新 parse 內文。
 */
export function sortNotes(notes: Note[], mode: NoteSort, todo: Map<string, number>): Note[] {
  const t = (n: Note) => todo.get(n.id) ?? 0
  // created_at 是 ISO 字串，字典序就是時間序。newest = 由新到舊。
  const newest = (a: Note, b: Note) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0)
  // 'auto' 在攤平排序這一層就等於 'newest'（差別只在 App 那邊 'auto' 才會依分類分區）。
  const cmp: (a: Note, b: Note) => number =
    mode === 'oldest'
      ? (a, b) => -newest(a, b)
      : mode === 'title'
        ? (a, b) => (a.title || a.body).localeCompare(b.title || b.body, 'zh-Hant') || newest(a, b)
        : mode === 'todo-most'
          ? (a, b) => t(b) - t(a) || newest(a, b)
          : mode === 'todo-least'
            ? (a, b) => t(a) - t(b) || newest(a, b)
            : newest
  return [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned) || cmp(a, b))
}
