import { authorHeaderValue, getClientId } from './identity'

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

/** note.image → 原圖 URL（點開的編輯視窗 `sheet-img` 用這個）；沒有圖回 null。
 *  **生活／研究生便利貼的圖現在分開存放**（見 server/store.ts 的
 *  `activeImagesDir()`），路徑前綴跟著目前作用中的集合走——這支路由是給
 *  `<img src>` 直接載入的，瀏覽器載圖片不會帶 `x-note-collection` 標頭，
 *  一定要靠 URL 本身（不同前綴）分辨，不能倚賴標頭。 */
export function noteImageUrl(note: Pick<Note, 'image'>): string | null {
  if (!note.image) return null
  const prefix = getApiCollection() === 'thesis' ? '/thesis-note-images' : '/note-images'
  return `${prefix}/${encodeURIComponent(note.image)}`
}

/**
 * 牆上的卡片 / 懸浮視窗用的縮圖 URL——server 現生現快取的 webp（見
 * `server/note-thumb.ts`）。`w` 只有 400 / 800 兩檔，搭 `srcSet` 讓瀏覽器
 * 依實際顯示寬與 DPR 自己挑。牆上一張圖顯示寬 ~220px，800 就夠 2x。
 * 研究生便利貼的圖片額外帶 `&collection=thesis`——同上，`<img src>` 不會帶
 * 標頭，這支路由（`/api/note-thumb/...`）改成看這個查詢參數決定要去哪個
 * 資料夾找原圖。
 */
export function noteThumbUrl(note: Pick<Note, 'image'>, w: 400 | 800): string | null {
  if (!note.image) return null
  const collectionParam = getApiCollection() === 'thesis' ? '&collection=thesis' : ''
  return `/api/note-thumb/${encodeURIComponent(note.image)}?w=${w}${collectionParam}`
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

/** 區網共用模式：伺服器要密碼、但這個瀏覽器還沒登入（或 cookie 過期）。
 *  App 攔到這個就顯示 <PasswordGate>。 */
export class AuthError extends Error {
  constructor() {
    super('需要密碼')
    this.name = 'AuthError'
  }
}

/** 這則便利貼在伺服器上已經不存在了（多半是別人／桌面版剛刪掉）。
 *  多人共用後這變常見，UI 要把它當成一種正常狀態、不是錯誤畫面。 */
export class NotFoundError extends Error {
  constructor() {
    super('這則便利貼已經不在了')
    this.name = 'NotFoundError'
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      'x-note-collection': apiCollection,
      'x-note-author': authorHeaderValue(),
      ...init?.headers,
    },
  })
  if (res.status === 204) return undefined as T
  const data = (await res.json().catch(() => null)) as unknown
  if (!res.ok) {
    if (
      res.status === 401 &&
      data &&
      typeof data === 'object' &&
      'needAuth' in data &&
      (data as { needAuth: unknown }).needAuth
    ) {
      throw new AuthError()
    }
    if (res.status === 404) throw new NotFoundError()
    const msg =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : `HTTP ${res.status}`
    throw new Error(msg)
  }
  return data as T
}

/** GET /session 的回應——`name` 有值＝這個名字通過了 PIN 驗證（見 server/people.ts），
 *  之後的請求不管前端標頭填什麼，activity/presence 一律認這個名字。 */
export interface SessionInfo {
  ok: boolean
  name: string | null
}
const SESSION_OFFLINE: SessionInfo = { ok: false, name: null }

/** 區網共用模式的密碼 session（cookie 由 server 設，這裡只管觸發／查詢）。 */
export const session = {
  check: (): Promise<SessionInfo> =>
    fetch(BASE + '/session', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : SESSION_OFFLINE))
      .then((j: Partial<SessionInfo>) => ({ ok: !!j.ok, name: j.name ?? null }))
      .catch(() => SESSION_OFFLINE),
  /** name 留空＝匿名。name 是已被 PIN 保護的名字時，pin 要對，不然整個登入失敗
   *  （密碼雖然對，也不會放行）——回傳伺服器確認過的名字（沒設身分就是 null）。 */
  login: async (password: string, name?: string, pin?: string): Promise<{ name: string | null }> => {
    const res = await fetch(BASE + '/session', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password, name, pin }),
    })
    const j = (await res.json().catch(() => null)) as { error?: string; name?: string | null } | null
    if (!res.ok) throw new Error(j?.error ?? '登入失敗')
    return { name: j?.name ?? null }
  },
  logout: () =>
    fetch(BASE + '/session', { method: 'DELETE', credentials: 'same-origin' }).catch(() => {}),
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
  /** 從瀏覽器上傳圖片檔（區網共用模式用；FormData → 瀏覽器自帶 multipart boundary）。 */
  uploadImage: async (id: string, file: File): Promise<Note> => {
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch(`${BASE}/notes/${id}/image`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'x-note-collection': apiCollection, 'x-note-author': authorHeaderValue() },
      body: fd,
    })
    const data = (await res.json().catch(() => null)) as { note?: Note; error?: string } | null
    if (!res.ok || !data?.note) throw new Error(data?.error ?? `HTTP ${res.status}`)
    return data.note
  },
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
  getActivity: (limit?: number) =>
    req<{ entries: ActivityEntry[] }>(`/activity${limit ? `?limit=${limit}` : ''}`).then(
      (r) => r.entries,
    ),
  /** noteId → 正在編輯的人名清單（可能不只一個；''＝匿名，可能重複）。 */
  getPresence: () => req<Record<string, string[]>>('/presence'),
  /** 編輯視窗開著時的心跳；`editing:false`＝關掉視窗，主動說「編完了」。帶上
   *  `clientId`（見 lib/identity.ts）讓匿名使用者在同一來源 IP 下也能分開算。 */
  setEditingPresence: (noteId: string, editing: boolean) =>
    req<void>('/presence', {
      method: 'POST',
      body: JSON.stringify({ noteId, editing, clientId: getClientId() }),
    }),
  /** 「看板」（固定網址 `/card`）目前指定哪一則。 */
  getCard: () => req<CardState>('/card'),
  /** noteId＝null 清空看板。 */
  setCard: (noteId: string | null) =>
    req<CardState>('/card', { method: 'POST', body: JSON.stringify({ noteId }) }),
  /** 發一則彈幕——不寫檔，靠 SSE 的具名事件即時推給所有人（見 lib/liveSync.ts）。 */
  sendDanmaku: (text: string) => req<void>('/danmaku', { method: 'POST', body: JSON.stringify({ text }) }),
}

/** `/host`（host.html 管理面板，見 HostPanel.tsx）用的端點——一律只有主機本機
 *  （loopback）打得通，遠端一律 403，不管有沒有共用密碼、開放模式開著沒有。 */
export interface HostState {
  openAccess: boolean
  aiEnabled: boolean
  /** 登入畫面要不要載入 host 的 3D logo（見 server/share.ts、LoginLogo3D.tsx）。 */
  loginLogo3d: boolean
  people: { name: string; createdAt: string }[]
}
/** 一筆造訪紀錄——見 server/visits.ts。author=''＝匿名。 */
export interface VisitEntry {
  author: string
  at: string
}
export const host = {
  getState: () => req<HostState>('/host/state'),
  setOpenAccess: (open: boolean) =>
    req<{ openAccess: boolean }>('/host/open-access', {
      method: 'POST',
      body: JSON.stringify({ open }),
    }),
  setAiEnabled: (enabled: boolean) =>
    req<{ aiEnabled: boolean }>('/host/ai', {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }),
  setLoginLogo3d: (enabled: boolean) =>
    req<{ loginLogo3d: boolean }>('/host/login-logo', {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }),
  releasePerson: (name: string) =>
    req<void>(`/host/people/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  /** 訪客紀錄（持久化）——`/host` 的「訪客紀錄」文字視窗用。新到舊。 */
  getVisits: (limit?: number) =>
    req<{ entries: VisitEntry[] }>(`/host/visits${limit ? `?limit=${limit}` : ''}`).then(
      (r) => r.entries,
    ),
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

/** 牆面排序方式。放在共用設定（AppSettings.wall）裡——多人共用時會跟著同步。
 *  UI 標籤在 `lib/noteSort.ts` 的 NOTE_SORTS。 */
export type NoteSort =
  | 'auto'
  | 'tag-band'
  | 'newest'
  | 'oldest'
  | 'title'
  | 'todo-most'
  | 'todo-least'

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
    /** 牆面排序下拉目前選的值（多人共用時會同步）。 */
    noteSort: NoteSort
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

/** PATCH /api/settings 的部分更新。到期相關（dueSoonHours / dueAlarmChannels）
 *  不在這裡——那兩個一律走 /reminder-settings。 */
export type AppSettingsPatch = {
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

/** 「誰動了我的牆」的一筆記錄——純記憶體，server 重開就清空（見 server/activity.ts）。 */
export interface ActivityEntry {
  at: string
  /** ''＝匿名（沒填名字），畫面上用 identity.ts 的 displayAuthor() 轉成「有人」。 */
  author: string
  action: 'create' | 'update' | 'delete' | 'restore' | 'bulk-delete' | 'connect' | 'disconnect'
  noteId?: string
  title: string
  count?: number
}

/** 「看板」（固定網址 `/card`，見 CardScreen.tsx）目前指定的內容——後端持久存檔，
 *  不是純記憶體，展示螢幕重開一次 server 也不會變空的。 */
export interface CardState {
  noteId: string | null
  setAt: string
}
