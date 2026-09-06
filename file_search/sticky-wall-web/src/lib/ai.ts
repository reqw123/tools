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
  /** null = 讀不到（連不上／舊版 Ollama 沒 /api/tags）；仍可手動輸入模型名稱。 */
  models: string[] | null
  error: string | null
}

export interface AiSearchResult {
  answer: string
  matchedIds: string[]
  callCount: number
}

/** 單一檔案的「AI 生成便利貼」草稿——還沒寫入，先讓使用者審核／編輯。 */
export interface NoteDraft {
  title: string
  tag: string
  body: string
}

export interface AiGenerateNoteResult {
  draft: NoteDraft | null
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
  search: (query: string, tag: string | null) =>
    req<AiSearchResult>('/ai/search', {
      method: 'POST',
      body: JSON.stringify({ query, tag: tag ?? '' }),
    }),
  generateNote: (path: string, category: string) =>
    req<AiGenerateNoteResult>('/ai/generate-note', {
      method: 'POST',
      body: JSON.stringify({ path, category }),
    }),
  saveNotes: (items: NoteDraft[]) =>
    req<{ created: { id: string; title: string; body: string; tag: string; created_at: string }[] }>(
      '/ai/save-notes',
      { method: 'POST', body: JSON.stringify({ items }) },
    ).then((r) => r.created),
}
