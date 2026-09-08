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

/** 研究生模式「從專案生成」——AI 讀論文專案文件產出一批任務便利貼草稿。
 *  一次呼叫可能要跑十幾秒（讀檔 + 生成），前端顯示進度。 */
export function useThesisSeed() {
  return useMutation({ mutationFn: () => aiApi.thesisSeed() })
}

/** 語意搜尋可用性——Ollama 連得上、embedding 模型下載了嗎。輪詢頻率低；
 *  只在「語意」開關打開時才查（enabled）。 */
export function useSemanticStatus(enabled: boolean) {
  return useQuery({
    queryKey: ['ai', 'semantic-status'],
    queryFn: aiApi.semanticStatus,
    enabled,
    staleTime: 30_000,
  })
}

/** 語意搜尋結果——查詢句非空且「語意」開關開著時自動跑（隨 query 去抖動後
 *  重查）。第一次會把所有便利貼 embed（可能幾秒），之後只 embed 查詢句。 */
export function useSemanticSearch(query: string, tag: string | null, enabled: boolean) {
  const q = query.trim()
  return useQuery({
    queryKey: ['ai', 'semantic-search', q, tag ?? ''],
    queryFn: () => aiApi.semanticSearch(q, tag),
    enabled: enabled && q.length > 0,
    staleTime: 60_000,
    // 向量算過就有快取，重試沒意義，失敗直接讓前端退回關鍵字搜尋
    retry: false,
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
