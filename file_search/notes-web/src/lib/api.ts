export interface Note {
  id: string
  title: string
  body: string
  tag: string
  /** 插圖檔名（後端 `.sticky_note_images/` 底下）；'' = 沒有圖。用 `noteImageUrl()` 轉成 URL。 */
  image: string
  /** 建立時間；「編輯視同重新建立」，所以其實是「最後動過的時間」。插圖不算「動過」，設圖不會更新它。 */
  created_at: string
  /** 到期日，存檔格式（見 lib/format.ts 的 toStoredDueAt/fromStoredDueAt/dueStatus）；'' = 沒有到期日。 */
  due_at: string
  /** 釘選——永遠排在清單最上面（見 server listNotes）。切換釘選不動 created_at。 */
  pinned: boolean
  /** 重複到期：'' | 'daily' | 'weekly' | 'monthly' | 'weekday'。只在 due_at 有值時
   *  有意義；按「這次完成」→ advanceRepeat 把 due_at 滾到下一次、內文 [x] 清回 [ ]。 */
  repeat: string
}

/** 重複規則 → 顯示字。'' 代表不重複。 */
export const REPEAT_LABELS: Record<string, string> = {
  '': '不重複',
  daily: '每天',
  weekly: '每週',
  monthly: '每月',
  weekday: '平日（週一至五）',
}

/** 垃圾桶裡的便利貼——「刪除」現在是先搬到這裡，不是真的消失，可以復原或
 *  永久刪除（見 TrashDialog）。deleted_at 是進垃圾桶的時間。 */
export interface TrashedNote extends Note {
  deleted_at: string
}

/** note.image → 原圖 URL（點開的編輯視窗 `sheet-img` 用這個）；沒有圖回 null。 */
export function noteImageUrl(note: Pick<Note, 'image'>): string | null {
  return note.image ? `/note-images/${encodeURIComponent(note.image)}` : null
}

/**
 * 牆上的卡片 / 懸浮視窗用的縮圖 URL——server 現生現快取的 webp（見
 * `server/note-thumb.ts`）。`w` 只有 400 / 800 兩檔，搭 `srcSet` 讓瀏覽器
 * 依實際顯示寬與 DPR 自己挑。牆上一張圖顯示寬 ~220px，800 就夠 2x。
 */
export function noteThumbUrl(note: Pick<Note, 'image'>, w: 400 | 800): string | null {
  return note.image ? `/api/note-thumb/${encodeURIComponent(note.image)}?w=${w}` : null
}

export interface NoteInput {
  title: string
  body: string
  tag: string
  due_at: string
  repeat: string
}

const BASE = '/api'

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    ...init,
  })
  if (res.status === 204) return undefined as T
  const data = (await res.json().catch(() => null)) as unknown
  if (!res.ok) {
    const msg =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : `HTTP ${res.status}`
    throw new Error(msg)
  }
  return data as T
}

export const api = {
  list: () => req<{ notes: Note[] }>('/notes').then((r) => r.notes),
  create: (input: NoteInput) =>
    req<{ note: Note }>('/notes', { method: 'POST', body: JSON.stringify(input) }).then(
      (r) => r.note,
    ),
  update: (id: string, patch: Partial<NoteInput>) =>
    req<{ note: Note }>(`/notes/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }).then(
      (r) => r.note,
    ),
  remove: (id: string) => req<void>(`/notes/${id}`, { method: 'DELETE' }),
  setImage: (id: string, srcPath: string) =>
    req<{ note: Note }>(`/notes/${id}/image`, {
      method: 'POST',
      body: JSON.stringify({ srcPath }),
    }).then((r) => r.note),
  removeImage: (id: string) =>
    req<{ note: Note }>(`/notes/${id}/image`, { method: 'DELETE' }).then((r) => r.note),
  toggleLine: (id: string, srcIndex: number) =>
    req<{ note: Note }>(`/notes/${id}/toggle-line`, {
      method: 'POST',
      body: JSON.stringify({ srcIndex }),
    }).then((r) => r.note),
  setPinned: (id: string, pinned: boolean) =>
    req<{ note: Note }>(`/notes/${id}/pin`, {
      method: 'POST',
      body: JSON.stringify({ pinned }),
    }).then((r) => r.note),
  advanceRepeat: (id: string) =>
    req<{ note: Note }>(`/notes/${id}/advance-repeat`, { method: 'POST' }).then((r) => r.note),
  bulkCreate: (input: { tag: string; count: number; titlePrefix?: string }) =>
    req<{ created: Note[] }>('/notes/bulk', {
      method: 'POST',
      body: JSON.stringify(input),
    }).then((r) => r.created),
  bulkDelete: (ids: string[]) =>
    req<{ deleted: number }>('/notes/bulk-delete', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }).then((r) => r.deleted),
  bulkRecategorize: (ids: string[], tag: string) =>
    req<{ updated: number }>('/notes/bulk-recategorize', {
      method: 'POST',
      body: JSON.stringify({ ids, tag }),
    }).then((r) => r.updated),
  exportJson: () => req<{ content: string }>('/notes/export').then((r) => r.content),
  importJson: (content: string) =>
    req<{ added: number; skipped: number }>('/notes/import', {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),
  trash: () => req<{ notes: TrashedNote[] }>('/notes/trash').then((r) => r.notes),
  history: () => req<{ snapshots: Snapshot[] }>('/notes/history').then((r) => r.snapshots),
  restoreHistory: (id: string) =>
    req<{ ok: boolean }>(`/notes/history/${id}/restore`, { method: 'POST' }),
  restore: (id: string) =>
    req<{ note: Note }>(`/notes/trash/${id}/restore`, { method: 'POST' }).then((r) => r.note),
  purge: (id: string) => req<void>(`/notes/trash/${id}`, { method: 'DELETE' }),
  emptyTrash: () => req<{ removed: number }>('/notes/trash', { method: 'DELETE' }).then((r) => r.removed),
  getReminderSettings: () => req<ReminderSettings>('/reminder-settings'),
  setReminderSettings: (dueSoonHours: number) =>
    req<ReminderSettings>('/reminder-settings', {
      method: 'PATCH',
      body: JSON.stringify({ dueSoonHours }),
    }),
  getTagColors: () => req<TagColors>('/tag-colors'),
  setTagColor: (tag: string, color: string) =>
    req<TagColors>('/tag-colors', { method: 'PATCH', body: JSON.stringify({ tag, color }) }),
  clearTagColor: (tag: string) =>
    req<TagColors>(`/tag-colors/${encodeURIComponent(tag)}`, { method: 'DELETE' }),
  getSettings: () => req<AppSettings>('/settings'),
  patchSettings: (patch: AppSettingsPatch) =>
    req<AppSettings>('/settings', { method: 'PATCH', body: JSON.stringify(patch) }),
}

/** 「快到期」門檻——卡片標色跟 /notes/due-soon（給 Node-RED 用）共用同一份，
 *  在「⏰ 提醒設定」對話框調整。 */
export interface ReminderSettings {
  dueSoonHours: number
}

export type TagSortMode = 'count' | 'manual' | 'recent'

/** 「全域設定」——存在跟 dueSoonHours 同一份 .notes_settings.json。 */
export interface AppSettings {
  dueSoonHours: number
  tagSort: {
    mode: TagSortMode
    /** 手動排定的標籤順序；還存在且列到的排最前，其餘依 mode 遞補在後。 */
    order: string[]
  }
  /** 無分類 / 分類沒有自訂顏色時的便利貼紙色（#rrggbb）。 */
  defaultNoteColor: string
  wall: {
    /** 一欄至少多寬（px）才多開一欄。 */
    minColWidth: number
    /** false＝關掉 JS 動態排版，用單純等寬格線。 */
    masonry: boolean
  }
  /** 「語意搜尋」用的本機 Ollama embedding 模型名稱（位址沿用 AI 設定的
   *  ollama.base_url）。空字串＝用預設 bge-m3。 */
  embedModel: string
  /** 垃圾桶自動清理：刪掉超過這麼多天的自動永久刪。0＝不依時間清。 */
  trashRetentionDays: number
  /** 垃圾桶最多留幾則，超過從最舊的清起。0＝不限筆數。 */
  trashMaxCount: number
}

/** PATCH /api/settings 的部分更新（dueSoonHours 走 /reminder-settings 舊路由）。 */
export type AppSettingsPatch = {
  tagSort?: Partial<AppSettings['tagSort']>
  defaultNoteColor?: string
  wall?: Partial<AppSettings['wall']>
  embedModel?: string
  trashRetentionDays?: number
  trashMaxCount?: number
}

/** 標籤→自訂顏色（hex）。沒自訂過的標籤不會出現在這裡，colorForTag() 拿不
 *  到就照舊退回雜湊配色。 */
export type TagColors = Record<string, string>

/** 便利貼檔案的一個版本快照（時光機）。每次有實質變動就自動存一份。 */
export interface Snapshot {
  id: string
  /** 拍下時間，ISO（本地時間，無時區）。 */
  taken_at: string
  note_count: number
  trash_count: number
}
