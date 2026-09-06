import { useMutation, useQuery } from '@tanstack/react-query'
import { filesApi } from '../lib/files'

/** 選檔視窗的目錄內容。dir 空字串 → 磁碟機／根目錄清單。 */
export function useBrowse(dir: string) {
  return useQuery({
    queryKey: ['files', 'browse', dir],
    queryFn: () => filesApi.browse(dir),
    staleTime: 2_000,
    gcTime: 30_000,
  })
}

export function useScanCategories() {
  return useQuery({
    queryKey: ['files', 'scan-categories'],
    queryFn: filesApi.scanCategories,
    staleTime: Infinity,
  })
}

export function useScan() {
  return useMutation({
    mutationFn: (v: { dir: string; recursive: boolean; categories: string[] }) =>
      filesApi.scan(v.dir, v.recursive, v.categories),
  })
}
