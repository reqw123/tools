import type { Note } from './api'
import { todoProgress } from './format'

export type NoteSort = 'newest' | 'oldest' | 'title' | 'todo-most' | 'todo-least'

export const NOTE_SORTS: { id: NoteSort; label: string }[] = [
  { id: 'newest', label: '最新建立' },
  { id: 'oldest', label: '最早建立' },
  { id: 'title', label: '標題 A→Z' },
  { id: 'todo-most', label: '未完成待辦最多' },
  { id: 'todo-least', label: '未完成待辦最少' },
]

const KEY = 'sticky-wall-note-sort'

export function readNoteSort(): NoteSort {
  try {
    const v = localStorage.getItem(KEY)
    if (NOTE_SORTS.some((s) => s.id === v)) return v as NoteSort
  } catch {
    /* private mode */
  }
  return 'newest'
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

/**
 * 依所選模式排牆面。**釘選的永遠在最前面**（釘選內部也照同一個 key 排）。
 * `todo` 是 `note.id → 未完成待辦數` 的對照表——呼叫端先算好傳進來，
 * 免得每次比較都重新 parse 內文。
 */
export function sortNotes(notes: Note[], mode: NoteSort, todo: Map<string, number>): Note[] {
  const t = (n: Note) => todo.get(n.id) ?? 0
  // created_at 是 ISO 字串，字典序就是時間序。newest = 由新到舊。
  const newest = (a: Note, b: Note) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0)
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
