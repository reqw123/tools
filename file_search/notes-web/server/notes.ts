import type { FastifyPluginAsync } from 'fastify'
import {
  createNote,
  createNotes,
  deleteNote,
  deleteNotes,
  exportNotesJson,
  getNote,
  importNotesJson,
  listNotes,
  tagCounts,
  updateNote,
} from './store'

const noteBody = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string', maxLength: 200 },
    body: { type: 'string', maxLength: 10_000 },
    tag: { type: 'string', maxLength: 60 },
  },
} as const

export const notesRoutes: FastifyPluginAsync = async (app) => {
  app.get('/notes', async () => ({ notes: listNotes() }))

  app.get('/tags', async () => ({ tags: tagCounts() }))

  app.get<{ Params: { id: string } }>('/notes/:id', async (req, reply) => {
    const note = getNote(req.params.id)
    if (!note) return reply.code(404).send({ error: 'not found' })
    return { note }
  })

  app.post<{ Body: { title?: string; body?: string; tag?: string } }>(
    '/notes',
    { schema: { body: { ...noteBody, required: ['title'] } } },
    async (req, reply) => {
      const title = (req.body.title ?? '').trim()
      if (!title) return reply.code(422).send({ error: '標題不能留空' })
      const note = createNote({ title, body: req.body.body, tag: req.body.tag })
      return reply.code(201).send({ note })
    },
  )

  app.patch<{ Params: { id: string }; Body: { title?: string; body?: string; tag?: string } }>(
    '/notes/:id',
    { schema: { body: noteBody } },
    async (req, reply) => {
      if (req.body.title !== undefined && !req.body.title.trim()) {
        return reply.code(422).send({ error: '標題不能留空' })
      }
      const note = updateNote(req.params.id, req.body)
      if (!note) return reply.code(404).send({ error: 'not found' })
      return { note }
    },
  )

  app.delete<{ Params: { id: string } }>('/notes/:id', async (req, reply) => {
    const ok = deleteNote(req.params.id)
    if (!ok) return reply.code(404).send({ error: 'not found' })
    return reply.code(204).send()
  })

  // ── 批次 ──（靜態路徑，Fastify 會排在 /notes/:id 前面比對，不會被吃掉）

  app.post<{ Body: { tag?: string; count?: number; titlePrefix?: string } }>(
    '/notes/bulk',
    {
      schema: {
        body: {
          type: 'object',
          required: ['count'],
          properties: {
            tag: { type: 'string', maxLength: 60 },
            count: { type: 'integer', minimum: 1, maximum: 50 },
            titlePrefix: { type: 'string', maxLength: 100 },
          },
        },
      },
    },
    async (req, reply) => {
      const tag = (req.body.tag ?? '').trim()
      const n = req.body.count ?? 1
      const prefix = (req.body.titlePrefix ?? '').trim() || tag || '便利貼'
      const items = Array.from({ length: n }, (_, i) => ({ title: `${prefix} ${i + 1}`, tag }))
      return reply.code(201).send({ created: createNotes(items) })
    },
  )

  app.post<{ Body: { ids?: string[] } }>(
    '/notes/bulk-delete',
    {
      schema: {
        body: {
          type: 'object',
          required: ['ids'],
          properties: {
            ids: { type: 'array', items: { type: 'string' }, maxItems: 2000 },
          },
        },
      },
    },
    async (req) => ({ deleted: deleteNotes(req.body.ids ?? []) }),
  )

  // ── 匯出／匯入（搬家／備份用，JSON，跟桌面版格式互通）──────────────

  app.get('/notes/export', async () => ({ content: exportNotesJson() }))

  app.post<{ Body: { content?: string } }>(
    '/notes/import',
    {
      schema: {
        body: {
          type: 'object',
          required: ['content'],
          properties: { content: { type: 'string', maxLength: 50_000_000 } },
        },
      },
    },
    async (req, reply) => {
      try {
        return importNotesJson(req.body.content ?? '')
      } catch (err) {
        return reply.code(422).send({ error: err instanceof Error ? err.message : String(err) })
      }
    },
  )
}
