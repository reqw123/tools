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
}

export interface BlankItem {
  serial: number
  path: string
  name: string
  category: string
  suggestion: string
}

const BASE = '/api'

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    ...init,
  })
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
  indexes: () => req<{ indexes: string[] }>('/indexes').then((r) => r.indexes),
  index: (name: string) => req<IndexPayload>(`/indexes/${encodeURIComponent(name)}`),
  importIndex: (name: string, content: string) =>
    req<{ name: string }>('/indexes/import', {
      method: 'POST',
      body: JSON.stringify({ name, content }),
    }),
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

  // ── 批次 ────────────────────────────────────────────────────────
  scanCategories: () =>
    req<{ categories: ScanCategory[] }>('/scan-categories').then((r) => r.categories),
  scan: (dir: string, recursive: boolean, categories: string[]) =>
    req<ScanResult>('/scan', {
      method: 'POST',
      body: JSON.stringify({ dir, recursive, categories }),
    }),
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
}
