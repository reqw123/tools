import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type AddEntryInput, type ScanProgress, type ScanResult } from '../lib/api'

export function useIndexList() {
  return useQuery({ queryKey: ['indexes'], queryFn: api.indexes })
}

export function useImportIndex() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { name: string; content: string }) => api.importIndex(v.name, v.content),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['indexes'] }),
  })
}

/** 新增一份空白索引集——桌面版「🗂 新增索引集」。 */
export function useCreateIndex() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => api.createIndex(name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['indexes'] }),
  })
}

/** 刪除整份索引集——桌面版「🗑️ 刪除索引集」。 */
export function useDeleteIndex() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => api.deleteIndex(name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['indexes'] }),
  })
}

/** 用系統文字編輯器開啟這份 .md——桌面版「編輯索引檔案」。純本機動作，
 *  沒有要 invalidate 的 query（改完存檔後靠使用者自己重新整理／切換索引集）。 */
export function useEditIndex() {
  return useMutation({
    mutationFn: (name: string) => api.editIndex(name),
  })
}

export function useIndex(name: string | null) {
  return useQuery({
    queryKey: ['index', name],
    queryFn: () => api.index(name!),
    enabled: !!name,
  })
}

export const CATEGORY_COLORS_KEY = ['category-colors'] as const

/** 分類→自訂顏色（hex）對照表。categoryColor() 拿不到就退回雜湊配色。 */
export function useCategoryColors() {
  return useQuery({
    queryKey: CATEGORY_COLORS_KEY,
    queryFn: api.categoryColors,
    staleTime: 60_000,
  })
}

/** 樂觀更新：色點/晶片立刻換色，失敗再還原。`color` 傳 null＝清掉自訂、退回雜湊。 */
export function useSetCategoryColor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ category, color }: { category: string; color: string | null }) =>
      color === null ? api.clearCategoryColor(category) : api.setCategoryColor(category, color),
    onMutate: async ({ category, color }) => {
      await qc.cancelQueries({ queryKey: CATEGORY_COLORS_KEY })
      const prev = qc.getQueryData<Record<string, string>>(CATEGORY_COLORS_KEY)
      qc.setQueryData<Record<string, string>>(CATEGORY_COLORS_KEY, (old) => {
        const next = { ...(old ?? {}) }
        if (color === null) delete next[category]
        else next[category] = color
        return next
      })
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(CATEGORY_COLORS_KEY, ctx.prev)
    },
    onSuccess: (colors) => qc.setQueryData(CATEGORY_COLORS_KEY, colors),
  })
}

/** 選檔視窗的目錄內容。dir 空字串 → 磁碟機／根目錄清單。 */
export function useBrowse(dir: string) {
  return useQuery({
    queryKey: ['browse', dir],
    queryFn: () => api.browse(dir),
    staleTime: 2_000,
    gcTime: 30_000,
  })
}

export function useAddEntry(name: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: AddEntryInput) => api.addEntry(name!, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['index', name] }),
  })
}

/** 上傳檔案加進索引集——見 api.ts 的 `uploadEntry()`。跟 `useAddEntry` 平行，
 *  差別只在來源是「挑本機檔案」還是「上傳自己的檔案」。 */
export function useUploadEntry(name: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { file: File; category: string; description: string }) =>
      api.uploadEntry(name!, input.file, input.category, input.description),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['index', name] }),
  })
}

/** 上傳一整個資料夾——見 api.ts 的 `uploadFolder()`。跟 `useBulkAdd`（本機
 *  掃描結果批次匯入）平行，差別只在來源是主機硬碟還是使用者自己上傳的。 */
export function useUploadFolder(name: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      files: File[]
      category: string
      onProgress?: (loaded: number, total: number) => void
    }) => api.uploadFolder(name!, input.files, input.category, input.onProgress),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['index', name] }),
  })
}

export function useUpdateEntry(name: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { serial: number; path: string; category: string; description: string }) =>
      api.updateEntry(name!, v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['index', name] }),
  })
}

export function useDeleteEntry(name: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { serial: number; path: string }) => api.deleteEntry(name!, v.serial, v.path),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['index', name] }),
  })
}

// ── 批次操作 ──────────────────────────────────────────────────────

export function useScanCategories() {
  return useQuery({
    queryKey: ['scan-categories'],
    queryFn: api.scanCategories,
    staleTime: Infinity,
  })
}

/** 輪詢背景掃描的間隔——夠頻繁讓計數看起來在動，又不至於洗請求。 */
const SCAN_POLL_MS = 250

type ScanState =
  | { status: 'idle' }
  | { status: 'running'; progress?: ScanProgress }
  | { status: 'done'; data: ScanResult }
  | { status: 'error'; error: Error }

/**
 * 資料夾掃描——對外介面刻意維持跟 `useMutation` 一樣（`mutate`／`reset`／
 * `isPending`／`data`／`error`），另外多給 `progress`（即時進度）和 `cancel`。
 * 底層是 `POST /scan/jobs` 開工＋輪詢 `GET /scan/jobs/:id`，見 server/scan-jobs.ts。
 *
 * 換一輪（再次 mutate／reset／cancel／元件卸載）就把舊的那輪作廢並通知後端中止，
 * 避免使用者關掉視窗後 server 還在替一個沒人要看的結果走完整個硬碟。
 */
export function useScan() {
  const [state, setState] = useState<ScanState>({ status: 'idle' })
  const runRef = useRef(0) // 第幾輪；輪詢迴圈發現自己不是最新一輪就收手
  const jobRef = useRef<string | null>(null)

  const abort = useCallback(() => {
    runRef.current += 1
    const id = jobRef.current
    jobRef.current = null
    if (id) api.scanCancel(id).catch(() => {})
  }, [])

  // 使用者主動取消／重設：中止進行中的掃描，並回到閒置（不然畫面會一直停在「掃描中」）。
  const reset = useCallback(() => {
    abort()
    setState({ status: 'idle' })
  }, [abort])

  const mutate = useCallback(
    async (v: { dir: string; recursive: boolean; categories: string[] }) => {
      abort()
      const run = runRef.current
      setState({ status: 'running' })
      try {
        const { id } = await api.scanStart(v.dir, v.recursive, v.categories)
        if (runRef.current !== run) {
          api.scanCancel(id).catch(() => {}) // 等開工回應的空檔被取消了
          return
        }
        jobRef.current = id
        for (;;) {
          await new Promise((r) => setTimeout(r, SCAN_POLL_MS))
          if (runRef.current !== run) return
          const job = await api.scanStatus(id)
          if (runRef.current !== run) return
          if (job.state === 'running') {
            setState({ status: 'running', progress: job.progress })
            continue
          }
          jobRef.current = null
          if (job.state === 'done' && job.result) setState({ status: 'done', data: job.result })
          else if (job.state === 'error') setState({ status: 'error', error: new Error(job.error || '掃描失敗') })
          else setState({ status: 'idle' })
          return
        }
      } catch (e) {
        if (runRef.current !== run) return
        jobRef.current = null
        setState({ status: 'error', error: e instanceof Error ? e : new Error(String(e)) })
      }
    },
    [abort],
  )

  useEffect(() => abort, [abort]) // 卸載＝中止進行中的掃描

  return {
    mutate,
    reset,
    cancel: reset,
    isPending: state.status === 'running',
    progress: state.status === 'running' ? state.progress : undefined,
    data: state.status === 'done' ? state.data : undefined,
    error: state.status === 'error' ? state.error : null,
  }
}

export function useBulkAdd(name: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { paths: string[]; category: string }) => api.bulkAdd(name!, v.paths, v.category),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['index', name] }),
  })
}

export function useBlankSuggestions(name: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['blank-suggestions', name],
    queryFn: () => api.blankSuggestions(name!),
    enabled: enabled && !!name,
    staleTime: 0,
    gcTime: 0,
  })
}

export function useBulkDescribe(name: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (updates: { serial: number; path: string; description: string }[]) =>
      api.bulkDescribe(name!, updates),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['index', name] }),
  })
}

export function useBulkRecategorize(name: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (updates: { serial: number; path: string; category: string }[]) =>
      api.bulkRecategorize(name!, updates),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['index', name] }),
  })
}

export function useBulkDelete(name: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (items: { serial: number; path: string }[]) => api.bulkDelete(name!, items),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['index', name] }),
  })
}
