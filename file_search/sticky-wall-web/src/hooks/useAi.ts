import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { aiApi, type AiSettingsInput, type NoteDraft } from '../lib/ai'

/** 目前 AI 去向 + 累計呼叫次數。輪詢頻率低，設定改了會主動 invalidate。 */
export function useAiTarget() {
  return useQuery({ queryKey: ['ai', 'target'], queryFn: aiApi.target, staleTime: 10_000 })
}

export function useAiSettings() {
  return useQuery({ queryKey: ['ai', 'settings'], queryFn: aiApi.getSettings })
}

export function useSaveAiSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: AiSettingsInput) => aiApi.saveSettings(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai'] })
    },
  })
}

export function useTestConnection() {
  return useMutation({ mutationFn: (input?: AiSettingsInput) => aiApi.test(input) })
}

export function useOllamaModels() {
  return useMutation({ mutationFn: (input?: AiSettingsInput) => aiApi.models(input) })
}

/** 把「AI 生成便利貼」審核過的草稿一次寫入——成功後讓便利貼清單重抓，
 *  牆面自動跟著出現新卡片（跟 useCreateNote／useBulkCreateNotes 同一個模式）。 */
export function useSaveGeneratedNotes() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (items: NoteDraft[]) => aiApi.saveNotes(items),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes'] }),
  })
}

export function useAiSearch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ query, tag }: { query: string; tag: string | null }) =>
      aiApi.search(query, tag),
    onSuccess: () => {
      // 每次搜尋都可能動到累計次數 → 讓 target 重抓
      qc.invalidateQueries({ queryKey: ['ai', 'target'] })
    },
  })
}
