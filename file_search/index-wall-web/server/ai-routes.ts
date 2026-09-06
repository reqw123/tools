import type { FastifyPluginAsync } from 'fastify'
import { BridgeError, runBridge } from './ai'

const settingsBody = {
  type: 'object',
  additionalProperties: true,
  properties: {
    provider: { type: 'string', enum: ['openai', 'ollama'] },
    openai: { type: 'object', additionalProperties: true },
    ollama: { type: 'object', additionalProperties: true },
  },
} as const

/**
 * 「AI 批次補說明」用的端點——全部透過 server/ai_bridge.py 子行程呼叫
 * file_search_app 既有的 AIDescriptionService / PreviewService，不重寫 AI 邏輯。
 */
export const aiRoutes: FastifyPluginAsync = async (app) => {
  app.setErrorHandler((err: unknown, _req, reply) => {
    if (err instanceof BridgeError) {
      return reply.code(err.code === 1 ? 502 : 500).send({ error: err.message })
    }
    app.log.error(err)
    return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) })
  })

  /** 目前 AI 去向摘要 + 累計呼叫次數（送出前確認視窗用） */
  app.get('/ai/target', async () => runBridge('target'))

  /** 讀設定（API Key 只回 has_key） */
  app.get('/ai/settings', async () => runBridge('settings-get'))

  /** 存設定；沒帶新 api_key 就沿用舊的 */
  app.put('/ai/settings', { schema: { body: settingsBody } }, async (req) =>
    runBridge('settings-set', req.body),
  )

  /** 測連線（可帶未存檔的設定）→ { ok, warning, error } */
  app.post('/ai/test', async (req) => runBridge('test', req.body ?? null))

  /** 那台 Ollama 已安裝的模型清單（可帶未存檔的設定）→ { models: string[]|null, error } */
  app.post('/ai/models', async (req) => runBridge('models', req.body ?? null))

  /** 單一檔案 → AI 產生一段說明。前端對每個勾選的項目各呼叫一次、顯示進度。 */
  app.post<{ Body: { path?: string; category?: string } }>(
    '/ai/suggest',
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
      runBridge<{ suggestion: string | null; error: string | null; skipped: boolean }>(
        'suggest-one',
        { path: req.body.path, category: req.body.category ?? '' },
      ),
  )
}
