export interface AiTarget {
  configured: boolean
  reason: string
  provider: 'openai' | 'ollama' | null
  label: string
  model: string
  endpoint: string
  leaves_machine: boolean
  lan: boolean
  call_count: number
}

export interface AiSettings {
  provider: 'openai' | 'ollama' | null
  openai: { model: string; base_url: string; has_key: boolean }
  ollama: { base_url: string; model: string }
}

export interface AiSettingsInput {
  provider: 'openai' | 'ollama'
  openai: { api_key?: string; model: string; base_url: string }
  ollama: { base_url: string; model: string }
}

export interface AiTestResult {
  ok: boolean
  warning: string | null
  error: string | null
}

export interface AiModelsResult {
  models: string[] | null
  error: string | null
}

/** 單一檔案的 AI 建議結果。skipped＝沒有可摘要的內容（圖片沒 Pillow、二進位、音訊影片）。 */
export interface AiSuggestResult {
  suggestion: string | null
  error: string | null
  skipped: boolean
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

export const aiApi = {
  target: () => req<AiTarget>('/ai/target'),
  getSettings: () => req<AiSettings>('/ai/settings'),
  saveSettings: (input: AiSettingsInput) =>
    req<AiSettings>('/ai/settings', { method: 'PUT', body: JSON.stringify(input) }),
  test: (input?: AiSettingsInput) =>
    req<AiTestResult>('/ai/test', {
      method: 'POST',
      body: input ? JSON.stringify(input) : undefined,
    }),
  models: (input?: AiSettingsInput) =>
    req<AiModelsResult>('/ai/models', {
      method: 'POST',
      body: input ? JSON.stringify(input) : undefined,
    }),
  suggest: (path: string, category: string) =>
    req<AiSuggestResult>('/ai/suggest', {
      method: 'POST',
      body: JSON.stringify({ path, category }),
    }),
}
