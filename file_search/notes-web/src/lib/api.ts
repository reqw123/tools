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

// ── 便利貼集合（生活 / 研究生模式）─────────────────────────────────
// 「研究生模式」把整面牆換成論文專案專用的另一份便利貼——每個 /api 請求帶
// `x-note-collection` 標頭，後端據此決定這一輪動哪一份檔（見 server/index.ts）。
export type NoteCollection = 'life' | 'thesis'
const COLLECTION_KEY = 'note-collection'

let apiCollection: NoteCollection = (() => {
  try {
    return localStorage.getItem(COLLECTION_KEY) === 'thesis' ? 'thesis' : 'life'
  } catch {
    return 'life'
  }
})()

export function getApiCollection(): NoteCollection {
  return apiCollection
}
/** 切換集合——之後所有 API 請求都帶新的標頭。呼叫端（App）負責清 query 快取重抓。 */
export function setApiCollection(c: NoteCollection): void {
  apiCollection = c
  try {
    localStorage.setItem(COLLECTION_KEY, c)
  } catch {
    /* 私密視窗之類的存不進去——這次 session 還是能用，只是重開會回到生活模式 */
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      'x-note-collection': apiCollection,
      ...init?.headers,
    },
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
  setReminderSettings: (patch: {
    dueSoonHours?: number
    dueAlarmChannels?: Partial<AlarmChannels>
  }) =>
    req<ReminderSettings>('/reminder-settings', {
      method: 'PATCH',
      body: JSON.stringify(patch),
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
/** 四個到期通知管道的獨立開關（true＝開著會發）。便利貼卡片的紅／黃標色
 *  跟這四個開關全都無關。 */
export interface AlarmChannels {
  /** 桌面牆右下角彈出的 Windows 系統通知。 */
  wallpaperToast: boolean
  /** 系統匣圖示上的到期數字角標。 */
  wallpaperBadge: boolean
  /** Node-RED 每分鐘輪詢、到期即時發的 LINE／Discord 鬧鐘。 */
  nodeRedAlarm: boolean
  /** Node-RED 每 6 小時發一次的 LINE／Discord 彙整。 */
  nodeRedDigest: boolean
}

export interface ReminderSettings {
  dueSoonHours: number
  dueAlarmChannels: AlarmChannels
}

export type TagSortMode = 'count' | 'manual' | 'recent'

/** 「全域設定」——存在跟 dueSoonHours 同一份 .notes_settings.json。 */
export interface AppSettings {
  dueSoonHours: number
  /** 四個到期通知管道的開關；卡片標色不受影響。在「⏰ 提醒設定」對話框切換。 */
  dueAlarmChannels: AlarmChannels
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
    /** 「看全部」時同分類的便利貼排法：'vertical'＝一分類一直行（預設）；
     *  'horizontal'＝一分類一橫段、卡片左到右換行、分類上到下。 */
    tagAxis: 'vertical' | 'horizontal'
    /** 便利貼卡片是否帶一點隨機歪斜。預設 false＝擺正。 */
    tilt: boolean
    /** 歪斜開啟時的最大傾斜角（度）；每張在 ±tiltMax 間取值。預設 2.5。 */
    tiltMax: number
  }
  /** 「語意搜尋」用的本機 Ollama embedding 模型名稱（位址沿用 AI 設定的
   *  ollama.base_url）。空字串＝用預設 bge-m3。 */
  embedModel: string
  /** 垃圾桶自動清理：刪掉超過這麼多天的自動永久刪。0＝不依時間清。 */
  trashRetentionDays: number
  /** 垃圾桶最多留幾則，超過從最舊的清起。0＝不限筆數。 */
  trashMaxCount: number
  /** 「研究生模式」的論文專案資料夾。 */
  thesisProjectDir: string
  /** 「從專案生成」每個檔案／全部檔案最多讀多少字餵給 AI，以及最多挑幾個檔案。 */
  thesisSeedPerFileChars: number
  thesisSeedTotalChars: number
  thesisSeedMaxFiles: number
}

/** PATCH /api/settings 的部分更新（dueSoonHours 走 /reminder-settings 舊路由）。 */
export type AppSettingsPatch = {
  dueAlarmChannels?: Partial<AlarmChannels>
  tagSort?: Partial<AppSettings['tagSort']>
  defaultNoteColor?: string
  wall?: Partial<AppSettings['wall']>
  embedModel?: string
  trashRetentionDays?: number
  trashMaxCount?: number
  thesisProjectDir?: string
  thesisSeedPerFileChars?: number
  thesisSeedTotalChars?: number
  thesisSeedMaxFiles?: number
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
