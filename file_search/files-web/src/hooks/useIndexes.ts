import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type AddEntryInput } from '../lib/api'

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

export function useScan() {
  return useMutation({
    mutationFn: (v: { dir: string; recursive: boolean; categories: string[] }) =>
      api.scan(v.dir, v.recursive, v.categories),
  })
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
