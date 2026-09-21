import { authorHeaderValue } from './identity'

export interface Entry {
  serial: number
  path: string
  category: string
  description: string
  name: string
  dir: string
  parent: string
  ext: string
}

export interface IndexPayload {
  name: string
  entries: Entry[]
  preamble: string
  raw: string
  skipped: number
}

export interface PathStat {
  exists: boolean
  size?: number
  mtime?: number
}

export interface PreviewResult {
  kind: 'markdown' | 'text' | 'unsupported' | 'missing' | 'toobig'
  text?: string
  truncated?: boolean
  bytes?: number
}

export interface BrowseEntry {
  name: string
  path: string
  isDir: boolean
  size?: number
  mtime?: number
  ext?: string
}

export interface BrowseListing {
  path: string
  parent: string | null
  dirs: BrowseEntry[]
  files: BrowseEntry[]
  truncated: boolean
  /** 常用資料夾捷徑（下載／桌面／文件／家目錄）——選檔面板頂端一鍵跳。 */
  quick: BrowseEntry[]
}

export interface AddEntryInput {
  path: string
  category: string
  description: string
}

export interface ScanCategory {
  label: string
  icon: string
  color: string
}

export interface ScanResult {
  files: { path: string; name: string; size: number; ext: string }[]
  truncated: boolean
  /** 符合條件的檔案真實總數（超過安全上限也會繼續數，不是只回報 1000）。 */
  matchedCount: number
  /** 撞到走檔絕對上限才停下來——matchedCount 這時只是下限，不是精確值。 */
  hitWalkLimit: boolean
  categoryCounts: { label: string; count: number }[]
  /** 每個副檔名各幾個（多到少）——看含多種副檔名的類別實際是哪些檔案類型。 */
  extCounts: { ext: string; count: number }[]
}

/** 背景掃描的即時進度（見 server/scan-jobs.ts）。`total` 只有「不含子資料夾」才有。 */
export interface ScanProgress {
  walked: number
  matched: number
  dirs: number
  current: string
  total?: number
}

export interface ScanJob {
  state: 'running' | 'done' | 'error' | 'cancelled'
  progress: ScanProgress
  result?: ScanResult
  error?: string
}

export interface BlankItem {
  serial: number
  path: string
  name: string
  category: string
  suggestion: string
}

const BASE = '/api'

/** 區網共用模式：伺服器要密碼、但這個瀏覽器還沒登入（或 cookie 過期）。
 *  AppGate 攔到這個就顯示 <PasswordGate>。搬自 notes-web/src/lib/api.ts。 */
export class AuthError extends Error {
  constructor() {
    super('需要密碼')
    this.name = 'AuthError'
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  // `FormData` body（上傳檔案，見 uploadEntry）不能手動設 content-type——
  // 瀏覽器要自己算 multipart boundary，蓋掉它 fetch 會少了 boundary 直接壞掉。
  const isJsonBody = typeof init?.body === 'string'
  const res = await fetch(BASE + path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      ...(isJsonBody ? { 'content-type': 'application/json' } : {}),
      'x-index-author': authorHeaderValue(),
      ...init?.headers,
    },
  })
  if (res.status === 204) return undefined as T
  const data = (await res.json().catch(() => null)) as unknown
  if (!res.ok) throw errorFromResponse(res.status, data)
  return data as T
}

/** 把非 2xx 回應變成該丟的錯（需要密碼 → AuthError，其餘取 `error` 欄位）。 */
function errorFromResponse(status: number, data: unknown): Error {
  if (
    status === 401 &&
    data &&
    typeof data === 'object' &&
    'needAuth' in data &&
    (data as { needAuth: unknown }).needAuth
  ) {
    return new AuthError()
  }
  const msg =
    data && typeof data === 'object' && 'error' in data
      ? String((data as { error: unknown }).error)
      : `HTTP ${status}`
  return new Error(msg)
}

/**
 * 帶「上傳進度」的 multipart POST。`fetch` 拿不到上傳位元組進度，只有
 * `XMLHttpRequest.upload.onprogress` 有，所以大批檔案上傳走這支。`onProgress`
 * 的 total 是整個請求本體（含 multipart 邊界）的大小，比純檔案大小略大一點。
 */
function postFormWithProgress<T>(
  path: string,
  form: FormData,
  onProgress?: (loaded: number, total: number) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', BASE + path)
    xhr.withCredentials = true
    xhr.responseType = 'json'
    xhr.setRequestHeader('x-index-author', authorHeaderValue())
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded, e.total)
    }
    xhr.onload = () => {
      const data = xhr.response as unknown
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as T)
      else reject(errorFromResponse(xhr.status, data))
    }
    xhr.onerror = () => reject(new Error('網路連線中斷，上傳未完成'))
    xhr.send(form)
  })
}

/** 權限分級——'viewer' 只能讀不能寫（見 server/share.ts 的 shareGuardHook）。
 *  匿名／沒被 host 特別設過的人一律是 'editor'。 */
export type PersonRole = 'editor' | 'viewer'

/** GET /session 的回應——`name` 有值＝這個名字通過了 PIN 驗證。 */
export interface SessionInfo {
  ok: boolean
  name: string | null
  role: PersonRole
}
const SESSION_OFFLINE: SessionInfo = { ok: false, name: null, role: 'editor' }

/** 區網共用模式的密碼 session（cookie 由 server 設，這裡只管觸發／查詢）。
 *  搬自 notes-web/src/lib/api.ts 的 `session`，機制完全相同。 */
export const session = {
  check: (): Promise<SessionInfo> =>
    fetch(BASE + '/session', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : SESSION_OFFLINE))
      .then(
        (j: Partial<SessionInfo>): SessionInfo => ({
          ok: !!j.ok,
          name: j.name ?? null,
          role: j.role === 'viewer' ? 'viewer' : 'editor',
        }),
      )
      .catch(() => SESSION_OFFLINE),
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

/** `/host`（HostPanel.tsx）用的端點——一律只有主機本機（loopback）打得通。
 *  搬自 notes-web/src/lib/api.ts 的 `host`，拿掉登入 3D Logo。 */
export interface HostState {
  openAccess: boolean
  aiEnabled: boolean
  people: { name: string; createdAt: string; role: PersonRole; discordWebhook: string }[]
}
/** 一筆造訪紀錄——見 server/visits.ts。author=''＝匿名。 */
export interface VisitEntry {
  author: string
  at: string
}
export const host = {
  getState: () => req<HostState>('/host/state'),
  setOpenAccess: (open: boolean) =>
    req<{ openAccess: boolean }>('/host/open-access', { method: 'POST', body: JSON.stringify({ open }) }),
  setAiEnabled: (enabled: boolean) =>
    req<{ aiEnabled: boolean }>('/host/ai', { method: 'POST', body: JSON.stringify({ enabled }) }),
  releasePerson: (name: string) =>
    req<void>(`/host/people/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  setPersonRole: (name: string, role: PersonRole) =>
    req<{ people: HostState['people'] }>(`/host/people/${encodeURIComponent(name)}/role`, {
      method: 'POST',
      body: JSON.stringify({ role }),
    }),
  /** 設定或清除某個名字自己的 Discord webhook——留空字串＝清除。 */
  setPersonWebhook: (name: string, webhook: string) =>
    req<{ people: HostState['people'] }>(`/host/people/${encodeURIComponent(name)}/webhook`, {
      method: 'POST',
      body: JSON.stringify({ webhook }),
    }),
  /** 訪客紀錄（持久化）——`/host` 的「訪客紀錄」文字視窗用。新到舊。 */
  getVisits: (limit?: number) =>
    req<{ entries: VisitEntry[] }>(`/host/visits${limit ? `?limit=${limit}` : ''}`).then((r) => r.entries),
}

/** 「誰動了這份索引」的一筆記錄——純記憶體，server 重開就清空
 *  （見 server/activity.ts）。搬自 notes-web/src/lib/api.ts 的
 *  `ActivityEntry`，動作字典換成索引牆自己的。 */
export type ActivityAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'bulk-add'
  | 'bulk-delete'
  | 'index-import'
  | 'index-create'
  | 'index-delete'
  | 'connect'
  | 'disconnect'

export interface ActivityEntry {
  at: string
  author: string
  action: ActivityAction
  indexName: string
  title: string
  count?: number
}

export const activity = {
  list: (limit?: number) =>
    req<{ entries: ActivityEntry[] }>(`/activity${limit ? `?limit=${limit}` : ''}`).then((r) => r.entries),
  /** indexName → 正在看的人名清單（''＝匿名）。 */
  presence: () => req<Record<string, string[]>>('/presence'),
  /** 開著某份索引集時定期打心跳；離開時送 `viewing:false`。見 server/presence.ts。 */
  setViewing: (indexName: string, viewing: boolean, clientId?: string) =>
    req<void>('/presence', { method: 'POST', body: JSON.stringify({ indexName, viewing, clientId }) }),
  /** 這份索引集裡目前正在編輯的項目——path → 編輯者名字清單。見
   *  server/entry-presence.ts。 */
  entryPresence: (indexName: string) =>
    req<Record<string, string[]>>(`/entry-presence?index=${encodeURIComponent(indexName)}`),
  /** 某一列的 inline 編輯表單開著時定期打心跳；收起表單時送 `editing:false`。 */
  setEntryEditing: (indexName: string, path: string, editing: boolean, clientId?: string) =>
    req<void>('/entry-presence', {
      method: 'POST',
      body: JSON.stringify({ indexName, path, editing, clientId }),
    }),
}

export const api = {
  indexes: () => req<{ indexes: string[] }>('/indexes').then((r) => r.indexes),
  index: (name: string) => req<IndexPayload>(`/indexes/${encodeURIComponent(name)}`),
  importIndex: (name: string, content: string) =>
    req<{ name: string }>('/indexes/import', {
      method: 'POST',
      body: JSON.stringify({ name, content }),
    }),
  /** 新增一份空白索引集（帶格式規定前言、空表格）——桌面版「🗂 新增索引集」。 */
  createIndex: (name: string) =>
    req<{ name: string }>('/indexes', { method: 'POST', body: JSON.stringify({ name }) }),
  /** 刪除整份索引集（只刪 .md 索引紀錄，不碰實體檔案）——桌面版「🗑️ 刪除索引集」。 */
  deleteIndex: (name: string) =>
    req<{ ok: true }>(`/indexes/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  /** 在跑 server 的那台電腦用系統文字編輯器開啟這份 .md——桌面版「編輯索引檔案」。 */
  editIndex: (name: string) =>
    req<{ ok: true }>(`/indexes/${encodeURIComponent(name)}/edit`, { method: 'POST' }),
  exists: (paths: string[]) =>
    req<{ stats: Record<string, PathStat> }>('/exists', {
      method: 'POST',
      body: JSON.stringify({ paths }),
    }).then((r) => r.stats),
  open: (path: string, select: boolean) =>
    req<{ ok: true }>('/open', { method: 'POST', body: JSON.stringify({ path, select }) }),
  preview: (path: string) =>
    req<PreviewResult>('/preview', { method: 'POST', body: JSON.stringify({ path }) }),
  /** 直接串流被索引檔案本身的 URL（圖片／影音／PDF 用）。 */
  fileUrl: (path: string) => `${BASE}/file?path=${encodeURIComponent(path)}`,

  /** 選檔視窗用的目錄瀏覽。path 空字串 → 磁碟機／根目錄清單。 */
  browse: (path: string) => req<BrowseListing>(`/browse?path=${encodeURIComponent(path)}`),
  /** 新增一列索引項目到指定索引集（只動 .md，不碰實體檔案）。 */
  addEntry: (name: string, input: AddEntryInput) =>
    req<{ ok: true }>(`/indexes/${encodeURIComponent(name)}/entries`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  /**
   * 上傳自己的檔案加進索引集——遠端使用者不能瀏覽主機硬碟（`addEntry` 挑檔
   * 靠 `/browse`，遠端一律 403），但可以把自己電腦上的檔案傳上來，落地到
   * 這份索引集所在資料夾的 `.uploads/`，回傳新項目的（伺服器端）路徑。
   * `category`／`description` 走 query string，body 只放檔案本身，見
   * server/upload-routes.ts 開頭的說明。
   */
  uploadEntry: (name: string, file: File, category: string, description: string) => {
    const qs = new URLSearchParams()
    if (category) qs.set('category', category)
    if (description) qs.set('description', description)
    const suffix = qs.toString() ? `?${qs}` : ''
    const form = new FormData()
    form.append('file', file)
    return req<{ ok: true; path: string }>(
      `/indexes/${encodeURIComponent(name)}/upload${suffix}`,
      { method: 'POST', body: form },
    )
  },
  /**
   * 上傳一整個資料夾（`webkitdirectory` 選出來的一批 `File`，各自帶
   * `webkitRelativePath`）——每個檔案的相對路徑 `encodeURIComponent` 過後當
   * multipart 的檔名送出去，server（`upload-routes.ts` 的 `sanitizeRelPath`）
   * 解碼、拆段、重建資料夾結構，整批共用一個分類、一次寫入 `.md`。
   * 回傳 `{ added, skipped }`——`skipped` 是路徑不合法／超過單檔或整批大小
   * 上限被跳過的檔案數，不會讓整個上傳失敗。
   */
  uploadFolder: (
    name: string,
    files: File[],
    category: string,
    onProgress?: (loaded: number, total: number) => void,
  ) => {
    const qs = new URLSearchParams()
    if (category) qs.set('category', category)
    const suffix = qs.toString() ? `?${qs}` : ''
    const form = new FormData()
    for (const f of files) {
      const relPath = f.webkitRelativePath || f.name
      form.append('file', f, encodeURIComponent(relPath))
    }
    return postFormWithProgress<{ added: number; skipped: number }>(
      `/indexes/${encodeURIComponent(name)}/upload-batch${suffix}`,
      form,
      onProgress,
    )
  },
  /**
   * 原地編輯既有的一列：改分類／說明（路徑、在表格裡的位置都不動）。
   * serial＝1-based 原始列序，path＝該列預期路徑（對不上就擋下）。
   */
  updateEntry: (
    name: string,
    v: { serial: number; path: string; category: string; description: string },
  ) =>
    req<{ updated: number }>(`/indexes/${encodeURIComponent(name)}/entries`, {
      method: 'PATCH',
      body: JSON.stringify({
        updates: [
          { serial: v.serial, path: v.path, category: v.category, description: v.description },
        ],
      }),
    }),
  /** 移除第 serial（1-based 原始列序）列。expect＝該列預期的路徑，不符就擋下。 */
  deleteEntry: (name: string, serial: number, expect: string) =>
    req<{ removed: number }>(
      `/indexes/${encodeURIComponent(name)}/entries/${serial}?expect=${encodeURIComponent(expect)}`,
      { method: 'DELETE' },
    ),

  // ── 分類自訂顏色 ────────────────────────────────────────────────
  categoryColors: () => req<Record<string, string>>('/category-colors'),
  setCategoryColor: (category: string, color: string) =>
    req<Record<string, string>>('/category-colors', {
      method: 'PATCH',
      body: JSON.stringify({ category, color }),
    }),
  clearCategoryColor: (category: string) =>
    req<Record<string, string>>(`/category-colors/${encodeURIComponent(category)}`, {
      method: 'DELETE',
    }),

  // ── 批次 ────────────────────────────────────────────────────────
  scanCategories: () =>
    req<{ categories: ScanCategory[] }>('/scan-categories').then((r) => r.categories),
  /** 開始背景掃描，立刻回 job id；進度／結果用 scanStatus 輪詢。 */
  scanStart: (dir: string, recursive: boolean, categories: string[]) =>
    req<{ id: string }>('/scan/jobs', {
      method: 'POST',
      body: JSON.stringify({ dir, recursive, categories }),
    }),
  scanStatus: (id: string) => req<ScanJob>(`/scan/jobs/${encodeURIComponent(id)}`),
  scanCancel: (id: string) =>
    req<void>(`/scan/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  /** 批次匯入：整批共用一個分類，說明留空。回實際新增筆數（已收錄的會略過）。 */
  bulkAdd: (name: string, paths: string[], category: string) =>
    req<{ added: number }>(`/indexes/${encodeURIComponent(name)}/entries/bulk`, {
      method: 'POST',
      body: JSON.stringify({ paths, category }),
    }),
  bulkDelete: (name: string, items: { serial: number; path: string }[]) =>
    req<{ removed: number }>(`/indexes/${encodeURIComponent(name)}/entries/bulk-delete`, {
      method: 'POST',
      body: JSON.stringify({ items }),
    }),
  blankSuggestions: (name: string) =>
    req<{ items: BlankItem[]; truncated: boolean }>(
      `/indexes/${encodeURIComponent(name)}/blank-suggestions`,
    ),
  bulkDescribe: (name: string, updates: { serial: number; path: string; description: string }[]) =>
    req<{ updated: number }>(`/indexes/${encodeURIComponent(name)}/entries`, {
      method: 'PATCH',
      body: JSON.stringify({ updates }),
    }),
  // 跟 bulkDescribe 是同一支後端端點（PATCH .../entries 本來就吃 category，
  // 只是「批次補說明」從沒送過這個欄位）——這裡只送 category，省略的
  // description 沿用原值，見 server/store.ts updateRowsByOccurrences()。
  bulkRecategorize: (name: string, updates: { serial: number; path: string; category: string }[]) =>
    req<{ updated: number }>(`/indexes/${encodeURIComponent(name)}/entries`, {
      method: 'PATCH',
      body: JSON.stringify({ updates }),
    }),
}
