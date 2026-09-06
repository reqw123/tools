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

export function useIndex(name: string | null) {
  return useQuery({
    queryKey: ['index', name],
    queryFn: () => api.index(name!),
    enabled: !!name,
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
