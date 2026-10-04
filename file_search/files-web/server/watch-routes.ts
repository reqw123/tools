import type { FastifyPluginAsync } from 'fastify'
import { addWatch, listWatches, removeWatch, runWatchNow, type CategoryMode } from './watch'

/** 監看資料夾的 API（見 watch.ts）。只認 loopback——shareGuardHook 擋掉遠端的 /api/watch*。 */
export const watchRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { index?: string } }>('/watch', async (req) => ({ watches: listWatches(req.query.index) }))

  app.post<{
    Body: {
      index: string
      dir: string
      recursive?: boolean
      categories?: string[]
      categoryMode?: CategoryMode
      categoryText?: string
      includeExisting?: boolean
    }
  }>(
    '/watch',
    {
      schema: {
        body: {
          type: 'object',
          required: ['index', 'dir'],
          properties: {
            index: { type: 'string', maxLength: 300 },
            dir: { type: 'string', maxLength: 1000 },
            recursive: { type: 'boolean' },
            categories: { type: 'array', items: { type: 'string' }, maxItems: 30 },
            categoryMode: { type: 'string', enum: ['none', 'folder', 'type', 'fixed'] },
            categoryText: { type: 'string', maxLength: 200 },
            includeExisting: { type: 'boolean' },
          },
        },
      },
    },
    async (req, reply) => {
      const r = await addWatch(req.body)
      if (!r.ok) return reply.code(r.code).send({ error: r.error })
      return reply.code(201).send({ watch: r.watch, added: r.added })
    },
  )

  app.delete<{ Params: { id: string } }>('/watch/:id', async (req, reply) => {
    if (!removeWatch(req.params.id)) return reply.code(404).send({ error: '找不到這個監看' })
    return { ok: true }
  })

  app.post<{ Params: { id: string } }>('/watch/:id/run', async (req, reply) => {
    const r = await runWatchNow(req.params.id)
    if (!r) return reply.code(404).send({ error: '找不到這個監看' })
    return r
  })
}
