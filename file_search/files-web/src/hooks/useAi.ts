import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { aiApi, type AiSettingsInput } from '../lib/ai'

/** 目前 AI 去向摘要 + 累計呼叫次數。設定改了會主動 invalidate。 */
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai'] }),
  })
}

export function useTestConnection() {
  return useMutation({ mutationFn: (input?: AiSettingsInput) => aiApi.test(input) })
}

export function useOllamaModels() {
  return useMutation({ mutationFn: (input?: AiSettingsInput) => aiApi.models(input) })
}
