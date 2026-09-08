import type { FastifyPluginAsync } from 'fastify'
import {
  appendEntries,
  appendEntry,
  blankSuggestions,
  browseDir,
  clearCategoryColor,
  createIndexFile,
  fileStream,
  getCategoryColors,
  listIndexes,
  mimeOf,
  openInExplorer,
  previewFile,
  readIndex,
  removeEntriesByOccurrences,
  resolveFile,
  scanCategories,
  scanFolder,
  setCategoryColor,
  statPaths,
  updateRowsByOccurrences,
  validateIndexName,
} from './store'

export const routes: FastifyPluginAsync = async (app) => {
  app.get('/indexes', async () => ({ indexes: listIndexes() }))

  app.get<{ Params: { name: string } }>('/indexes/:name', async (req, reply) => {
    const payload = readIndex(decodeURIComponent(req.params.name))
    if (!payload) return reply.code(404).send({ error: '找不到這份索引集' })
    return payload
  })

  // ── 匯入索引集（建立一份新的 .md，見 docs/adr/0003）─────────────────
  // 把外部一份既有 .md 的內容存成一份新的索引集，例如從另一台電腦複製過來、
  // 或用「匯出索引集」（直接下載目前索引的 raw 內容，不需要專屬 API）存出去
  // 的檔案。
  app.post<{ Body: { name?: string; content?: string } }>(
    '/indexes/import',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name', 'content'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 255 },
            content: { type: 'string', maxLength: 50_000_000 },
          },
        },
      },
    },
    async (req, reply) => {
      const { filename, error } = validateIndexName(req.body.name ?? '')
      if (!filename) return reply.code(422).send({ error })
      createIndexFile(filename, req.body.content ?? '')
      return reply.code(201).send({ name: filename })
    },
  )

  // ── 新增／刪除索引項目（項目層級，見 docs/adr/0002）──────────────
  // 只動索引集 .md 的表格列，絕不碰硬碟上的實體檔案。

  app.post<{
    Params: { name: string }
    Body: { path?: string; category?: string; description?: string }
  }>(
    '/indexes/:name/entries',
    {
      schema: {
        body: {
          type: 'object',
          required: ['path'],
          properties: {
            path: { type: 'string', minLength: 1, maxLength: 4096 },
            category: { type: 'string', maxLength: 500 },
            description: { type: 'string', maxLength: 2000 },
          },
        },
      },
    },
    async (req, reply) => {
      const r = appendEntry(
        decodeURIComponent(req.params.name),
        req.body.path ?? '',
        req.body.category ?? '',
        req.body.description ?? '',
      )
      if (!r.ok) return reply.code(r.code).send({ error: r.error })
      return reply.code(201).send({ ok: true })
    },
  )

  app.delete<{ Params: { name: string; serial: string }; Querystring: { expect?: string } }>(
    '/indexes/:name/entries/:serial',
    async (req, reply) => {
      const serial = Number(req.params.serial)
      if (!Number.isInteger(serial) || serial < 1) {
        return reply.code(400).send({ error: 'serial 不正確' })
      }
      const r = removeEntriesByOccurrences(
        decodeURIComponent(req.params.name),
        new Map([[serial - 1, req.query.expect]]),
      )
      if (!r.ok) return reply.code(r.code).send({ error: r.error })
      return { removed: r.count }
    },
  )

  // ── 批次操作（對應桌面版「匯入資料夾」「批次補說明」「批次刪除」）────

  // 批次匯入：把一整批路徑加進索引集（整批共用一個分類、說明留空）。
  app.post<{ Params: { name: string }; Body: { paths?: string[]; category?: string } }>(
    '/indexes/:name/entries/bulk',
    {
      schema: {
        body: {
          type: 'object',
          required: ['paths'],
          properties: {
            paths: { type: 'array', items: { type: 'string' }, maxItems: 1000 },
            category: { type: 'string', maxLength: 500 },
          },
        },
      },
    },
    async (req, reply) => {
      const category = req.body.category ?? ''
      const r = appendEntries(
        decodeURIComponent(req.params.name),
        (req.body.paths ?? []).map((path) => ({ path, category, description: '' })),
      )
      if (!r.ok) return reply.code(r.code).send({ error: r.error })
      return reply.code(201).send({ added: r.count })
    },
  )

  // 批次刪除：一次移除多列（都對原始列序，一次寫入）。
  app.post<{ Params: { name: string }; Body: { items?: { serial: number; path?: string }[] } }>(
    '/indexes/:name/entries/bulk-delete',
    {
      schema: {
        body: {
          type: 'object',
          required: ['items'],
          properties: {
            items: {
              type: 'array',
              maxItems: 5000,
              items: {
                type: 'object',
                required: ['serial'],
                properties: {
                  serial: { type: 'integer', minimum: 1 },
                  path: { type: 'string', maxLength: 4096 },
                },
              },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const targets = new Map<number, string | undefined>()
      for (const it of req.body.items ?? []) targets.set(it.serial - 1, it.path)
      if (!targets.size) return reply.code(422).send({ error: '沒有要刪除的項目' })
      const r = removeEntriesByOccurrences(decodeURIComponent(req.params.name), targets)
      if (!r.ok) return reply.code(r.code).send({ error: r.error })
      return { removed: r.count }
    },
  )

  // 批次補說明——步驟 1：列出「說明是空的、檔案還在」的項目 + 內容擷取建議。
  app.get<{ Params: { name: string } }>('/indexes/:name/blank-suggestions', async (req, reply) => {
    const r = blankSuggestions(decodeURIComponent(req.params.name))
    if (!r) return reply.code(404).send({ error: '找不到這份索引集' })
    return r
  })

  // 既有列的原地編輯：改分類／說明（不動路徑、不動位置）。一次寫入。
  //   • 「批次補說明」步驟 2 送一批 { serial, path, description }（分類省略＝不動）
  //   • 單筆「編輯」送一筆 { serial, path, category, description }
  // 省略的欄位沿用該列原值；預期路徑對不上就整批不動、回 409。
  app.patch<{
    Params: { name: string }
    Body: {
      updates?: { serial: number; path?: string; category?: string; description?: string }[]
    }
  }>(
    '/indexes/:name/entries',
    {
      schema: {
        body: {
          type: 'object',
          required: ['updates'],
          properties: {
            updates: {
              type: 'array',
              maxItems: 2000,
              items: {
                type: 'object',
                required: ['serial'],
                properties: {
                  serial: { type: 'integer', minimum: 1 },
                  path: { type: 'string', maxLength: 4096 },
                  category: { type: 'string', maxLength: 500 },
                  description: { type: 'string', maxLength: 2000 },
                },
              },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const r = updateRowsByOccurrences(
        decodeURIComponent(req.params.name),
        (req.body.updates ?? []).map((u) => ({
          occurrence: u.serial - 1,
          expectPath: u.path,
          category: u.category,
          description: u.description,
        })),
      )
      if (!r.ok) return reply.code(r.code).send({ error: r.error })
      return { updated: r.count }
    },
  )

  // 資料夾掃描（批次匯入用）。`categories` 是要收錄的類型標籤（空 = 全部）。
  app.post<{ Body: { dir?: string; recursive?: boolean; categories?: string[] } }>(
    '/scan',
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

  // 批次匯入的檔案類型篩選按鈕用（跟 scanFolder 同一份 EXT_CATEGORIES）。
  app.get('/scan-categories', async () => ({ categories: scanCategories }))

  // 分類自訂顏色——沒自訂過的分類不會在回應裡，前端 categoryColor() 拿不到
  // 就退回雜湊配色。桌面版 IndexTree 讀同一份檔案。
  app.get('/category-colors', async () => getCategoryColors())

  app.patch<{ Body: { category?: string; color?: string } }>(
    '/category-colors',
    {
      schema: {
        body: {
          type: 'object',
          required: ['category', 'color'],
          properties: {
            category: { type: 'string', minLength: 1, maxLength: 200 },
            color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
          },
        },
      },
    },
    async (req) => setCategoryColor(req.body.category ?? '', req.body.color ?? ''),
  )

  // Fastify 已先解碼路徑參數，這裡不再 decodeURIComponent（含 % 的分類名會雙重解碼壞掉）。
  app.delete<{ Params: { category: string } }>('/category-colors/:category', async (req) =>
    clearCategoryColor(req.params.category),
  )

  // 選檔視窗用的目錄瀏覽（?path 空 → 磁碟機／根目錄清單）。
  app.get<{ Querystring: { path?: string } }>('/browse', async (req) =>
    browseDir(req.query.path ?? ''),
  )

  app.post<{ Body: { paths?: string[] } }>(
    '/exists',
    {
      schema: {
        body: {
          type: 'object',
          required: ['paths'],
          properties: {
            paths: { type: 'array', items: { type: 'string' }, maxItems: 5000 },
          },
        },
      },
    },
    async (req) => ({ stats: statPaths(req.body.paths ?? []) }),
  )

  app.post<{ Body: { path?: string; select?: boolean } }>(
    '/open',
    {
      schema: {
        body: {
          type: 'object',
          required: ['path'],
          properties: {
            path: { type: 'string', minLength: 1, maxLength: 4096 },
            select: { type: 'boolean' },
          },
        },
      },
    },
    async (req, reply) => {
      const ok = openInExplorer(req.body.path ?? '', req.body.select ?? false)
      if (!ok) return reply.code(400).send({ error: '路徑不是絕對路徑，無法開啟' })
      return { ok: true }
    },
  )

  app.post<{ Body: { path?: string } }>(
    '/preview',
    {
      schema: {
        body: {
          type: 'object',
          required: ['path'],
          properties: { path: { type: 'string', minLength: 1, maxLength: 4096 } },
        },
      },
    },
    async (req) => previewFile(req.body.path ?? ''),
  )

  // 串流被索引的檔案本身（圖片／影音／PDF 在網頁上直接看）。支援 Range，
  // 影音才能拖進度。路徑指向全硬碟各處，跟 /open 一樣不限制在某個根目錄下，
  // 靠 server 只綁 127.0.0.1 把關。
  app.get<{ Querystring: { path?: string } }>('/file', async (req, reply) => {
    const path = req.query.path ?? ''
    const r = resolveFile(path)
    if (!r.ok) {
      return reply.code(r.code).send({ error: r.code === 404 ? '找不到檔案' : '路徑無效' })
    }
    const total = r.stat.size
    reply.header('Accept-Ranges', 'bytes')
    reply.header('Content-Type', mimeOf(path))
    reply.header('Cache-Control', 'no-store')

    const range = req.headers.range
    const m = range && /^bytes=(\d*)-(\d*)$/.exec(range)
    if (m) {
      let start = m[1] ? Number(m[1]) : 0
      let end = m[2] ? Number(m[2]) : total - 1
      if (!Number.isFinite(start) || start < 0) start = 0
      if (!Number.isFinite(end) || end >= total) end = total - 1
      if (start > end) {
        reply.header('Content-Range', `bytes */${total}`)
        return reply.code(416).send()
      }
      reply.code(206)
      reply.header('Content-Range', `bytes ${start}-${end}/${total}`)
      reply.header('Content-Length', String(end - start + 1))
      return reply.send(fileStream(path, start, end))
    }

    reply.header('Content-Length', String(total))
    return reply.send(fileStream(path))
  })
}
