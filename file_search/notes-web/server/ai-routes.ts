import type { FastifyPluginAsync } from 'fastify'
import { BridgeError, runBridge } from './ai'
import { createNotes, getAppSettings, notesFilePath } from './store'

const settingsBody = {
  type: 'object',
  additionalProperties: true,
  properties: {
    provider: { type: 'string', enum: ['openai', 'ollama'] },
    openai: { type: 'object', additionalProperties: true },
    ollama: { type: 'object', additionalProperties: true },
  },
} as const

export const aiRoutes: FastifyPluginAsync = async (app) => {
  // bridge 丟出來的錯 → 乾淨的 JSON（AI 呼叫失敗 502，其餘 500）
  app.setErrorHandler((err: unknown, _req, reply) => {
    if (err instanceof BridgeError) {
      return reply.code(err.code === 1 ? 502 : 500).send({ error: err.message })
    }
    app.log.error(err)
    const msg = err instanceof Error ? err.message : String(err)
    return reply.code(500).send({ error: msg })
  })

  /** 目前 AI 去向摘要 + 累計呼叫次數（給搜尋列的揭露文字用） */
  app.get('/ai/target', async () => runBridge('target'))

  /** 讀設定（API Key 只回 has_key） */
  app.get('/ai/settings', async () => runBridge('settings-get'))

  /** 存設定；沒帶新 api_key 就沿用舊的 */
  app.put('/ai/settings', { schema: { body: settingsBody } }, async (req) =>
    runBridge('settings-set', req.body),
  )

  /** 測連線（可帶未存檔的設定） */
  app.post('/ai/test', async (req) => runBridge('test', req.body ?? null))

  /** 那台 Ollama 已安裝的模型清單（可帶未存檔的設定），給設定視窗的模型下拉用 */
  app.post('/ai/models', async (req) => runBridge('models', req.body ?? null))

  /** AI 搜尋——組 prompt → 呼叫 Provider → 解析，全部走 file_search_app 既有邏輯 */
  app.post<{ Body: { query?: string; tag?: string } }>(
    '/ai/search',
    {
      schema: {
        body: {
          type: 'object',
          required: ['query'],
          properties: {
            query: { type: 'string', minLength: 1, maxLength: 2000 },
            tag: { type: 'string', maxLength: 60 },
          },
        },
      },
    },
    async (req) => {
      const r = await runBridge<{ answer: string; ids: string[]; call_count: number }>(
        'search',
        { query: req.body.query, tag: req.body.tag ?? '' },
        ['--notes-file', notesFilePath],
      )
      return { answer: r.answer, matchedIds: r.ids, callCount: r.call_count }
    },
  )

  /**
   * 語意搜尋——用本機 Ollama 的 embedding 模型算查詢句與每則便利貼的
   * cosine 相似度，回傳依相似度排序的 id 清單（+ 分數）。跟 `/ai/search`
   * 不同：那個要跳確認視窗、會計費/耗 token、回自然語言答案；這個是純
   * 本機向量比對，向量有快取，不經過 record_call。Ollama 連不上／模型
   * 沒下載時回 `{ok:false, error}`（HTTP 200），前端據此退回關鍵字搜尋。
   */
  app.post<{ Body: { query?: string; tag?: string } }>(
    '/ai/semantic-search',
    {
      schema: {
        body: {
          type: 'object',
          required: ['query'],
          properties: {
            query: { type: 'string', minLength: 1, maxLength: 2000 },
            tag: { type: 'string', maxLength: 60 },
          },
        },
      },
    },
    async (req) =>
      runBridge<{
        ok: boolean
        results: { id: string; score: number }[]
        model: string
        error: string | null
        embedded: number
        total: number
      }>(
        'semantic-search',
        { query: req.body.query, tag: req.body.tag ?? '', model: getAppSettings().embedModel },
        ['--notes-file', notesFilePath],
      ),
  )

  /** 語意搜尋可用性：Ollama 連得上嗎、embedding 模型下載了嗎。給前端決定
   *  要不要 disable「語意」開關、或提示 `ollama pull`。 */
  app.get('/ai/semantic-status', async () =>
    runBridge<{ ok: boolean; model: string; installed: boolean | null; error: string | null }>(
      'semantic-status',
      { model: getAppSettings().embedModel },
      ['--notes-file', notesFilePath],
    ),
  )

  /**
   * 「AI 生成便利貼」：單一檔案 → AI 生成一則便利貼草稿（標題／標籤／內容），
   * 不寫入任何東西。前端對每個勾選的項目各呼叫一次、顯示進度，草稿逐則
   * 審核／編輯過，確認要存的一次呼叫下面的 `/ai/save-notes`。
   */
  app.post<{ Body: { path?: string; category?: string } }>(
    '/ai/generate-note',
    {
      schema: {
        body: {
          type: 'object',
          required: ['path'],
          properties: {
            path: { type: 'string', minLength: 1, maxLength: 4096 },
            category: { type: 'string', maxLength: 500 },
          },
        },
      },
    },
    async (req) =>
      runBridge<{
        draft: { title: string; tag: string; body: string } | null
        error: string | null
        skipped: boolean
      }>('generate-note', { path: req.body.path, category: req.body.category ?? '' }),
  )

  /**
   * 把審核過的草稿一次寫進 `.sticky_notes.json`——直接呼叫既有的
   * `createNotes()`（`store.ts`，整份檔案只讀寫一次），不需要另外走 Python：
   * 生成靠 AI（上面那個端點），但「寫檔」這件事這個 server 本來就會做
   * （便利貼 CRUD 本來就是它的本業），沒有理由為了存檔多開一個子行程。
   */
  app.post<{ Body: { items?: { title?: string; body?: string; tag?: string }[] } }>(
    '/ai/save-notes',
    {
      schema: {
        body: {
          type: 'object',
          required: ['items'],
          properties: {
            items: {
              type: 'array',
              minItems: 1,
              maxItems: 200,
              items: {
                type: 'object',
                required: ['title'],
                properties: {
                  title: { type: 'string', minLength: 1, maxLength: 200 },
                  body: { type: 'string', maxLength: 10_000 },
                  tag: { type: 'string', maxLength: 60 },
                },
              },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const items = (req.body.items ?? [])
        .map((it) => ({ title: (it.title ?? '').trim(), body: it.body, tag: it.tag }))
        .filter((it) => it.title)
      if (!items.length) return reply.code(422).send({ error: '沒有標題不是空的項目可以儲存' })
      return { created: createNotes(items) }
    },
  )
}
