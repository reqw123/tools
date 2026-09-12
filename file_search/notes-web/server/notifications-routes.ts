/** 「站內通知」端點——見 notifications.ts 開頭的說明。只回/只能標記「這次
 *  請求算誰」（authorFrom）自己的通知，匿名一律看到空清單。 */
import type { FastifyPluginAsync } from 'fastify'
import { authorFrom } from './identity'
import { listNotifications, markAllRead, markRead } from './notifications'

export const notificationsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/notifications', async (req) => ({
    notifications: listNotifications(authorFrom(req)),
  }))

  app.post<{ Params: { id: string } }>('/notifications/:id/read', async (req, reply) => {
    const ok = markRead(req.params.id, authorFrom(req))
    if (!ok) return reply.code(404).send({ error: 'not found' })
    return reply.code(204).send()
  })

  app.post('/notifications/read-all', async (req) => ({
    updated: markAllRead(authorFrom(req)),
  }))
}
