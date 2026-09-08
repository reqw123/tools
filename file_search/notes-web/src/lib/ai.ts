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

/** 語意搜尋——本機 Ollama embedding 算相似度，向量有快取，不計費/不耗 token。
 *  `ok:false` = Ollama 連不上或模型沒下載（前端據此退回關鍵字搜尋）。 */
export interface SemanticSearchResult {
  ok: boolean
  results: { id: string; score: number }[]
  model: string
  error: string | null
  embedded: number
  total: number
  /** 最高一筆的 cosine 相似度（0–1）——UI 拿來顯示「命中程度」。 */
  top_score: number
}

export interface SemanticStatus {
  ok: boolean
  model: string
  /** true/false = 那台 Ollama 有沒有這個模型；null = 連不上，問不到。 */
  installed: boolean | null
  error: string | null
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

import { getApiCollection } from './api'

const BASE = '/api'

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      // AI 搜尋／生成也要對「目前這個模式」的那份便利貼作用（見 api.ts）
      'x-note-collection': getApiCollection(),
      ...init?.headers,
    },
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
  semanticSearch: (query: string, tag: string | null) =>
    req<SemanticSearchResult>('/ai/semantic-search', {
      method: 'POST',
      body: JSON.stringify({ query, tag: tag ?? '' }),
    }),
  semanticStatus: () => req<SemanticStatus>('/ai/semantic-status'),
  /** 研究生模式「從專案生成」。source＝資料夾或 .zip 的路徑（空＝用設定的
   *  thesisProjectDir）。signal＝按「中斷」時 abort 掉這個 fetch，後端會
   *  連帶殺掉子行程。 */
  thesisSeed: (source: string, signal?: AbortSignal) =>
    req<{ drafts: NoteDraft[]; used_files: string[]; error: string | null; call_count: number }>(
      '/ai/thesis-seed',
      { method: 'POST', body: JSON.stringify({ source }), signal },
    ),
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
