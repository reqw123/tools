/** 「AI 生成便利貼」的選檔 API——瀏覽本機目錄、掃描資料夾。跟便利貼 CRUD
 * （`lib/api.ts`）分開，理由跟後端 `files-routes.ts` 分開一樣：不同關注點。 */

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

export interface ScanCategory {
  label: string
  icon: string
  color: string
}

export interface ScanResult {
  files: { path: string; name: string; size: number; ext: string }[]
  truncated: boolean
  categoryCounts: { label: string; count: number }[]
  /** 每個副檔名各幾個（多到少）——看含多種副檔名的類別實際有哪些檔案類型。 */
  extCounts: { ext: string; count: number }[]
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

export const filesApi = {
  /** 選檔視窗用的目錄瀏覽。path 空字串 → 磁碟機／根目錄清單。 */
  browse: (path: string) => req<BrowseListing>(`/files/browse?path=${encodeURIComponent(path)}`),
  scanCategories: () =>
    req<{ categories: ScanCategory[] }>('/files/scan-categories').then((r) => r.categories),
  scan: (dir: string, recursive: boolean, categories: string[]) =>
    req<ScanResult>('/files/scan', {
      method: 'POST',
      body: JSON.stringify({ dir, recursive, categories }),
    }),
}
