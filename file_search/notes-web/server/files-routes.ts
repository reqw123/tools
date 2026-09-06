import type { FastifyPluginAsync } from 'fastify'
import { browseDir, scanCategories, scanFolder } from './store'

/**
 * 「AI 生成便利貼」的選檔端點——挑本機檔案送給 AI，不是索引相關功能，不依賴
 * `indexes/*.md`。跟 `notesRoutes` / `aiRoutes` 分開一個檔案，理由跟
 * files-web 的 `/browse` `/scan` 一樣：純檔案系統操作，跟便利貼 CRUD、
 * AI Provider 呼叫是不同關注點。
 */
export const filesRoutes: FastifyPluginAsync = async (app) => {
  /** 選檔／選資料夾視窗用（?path 空 → 磁碟機／根目錄清單）。 */
  app.get<{ Querystring: { path?: string } }>('/files/browse', async (req) =>
    browseDir(req.query.path ?? ''),
  )

  /** 批次挑選檔案的類型篩選按鈕用（跟 scanFolder 同一份分類）。 */
  app.get('/files/scan-categories', async () => ({ categories: scanCategories }))

  /** 掃描一個資料夾，`categories` 是要收錄的類型標籤（空 = 全部）。 */
  app.post<{ Body: { dir?: string; recursive?: boolean; categories?: string[] } }>(
    '/files/scan',
    {
      schema: {
        body: {
          type: 'object',
          required: ['dir'],
          properties: {
            dir: { type: 'string', minLength: 1, maxLength: 4096 },
            recursive: { type: 'boolean' },
            categories: { type: 'array', items: { type: 'string' }, maxItems: 20 },
          },
        },
      },
    },
    async (req, reply) => {
      const r = scanFolder(req.body.dir ?? '', req.body.recursive ?? false, req.body.categories ?? [])
      if ('error' in r) return reply.code(400).send({ error: r.error })
      return r
    },
  )
}
