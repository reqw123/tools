/** `GET /activity`（誰新增／改／刪了什麼）、`POST`/`GET /presence`（誰正在編輯哪一則）、
 *  `GET`/`POST /card`（「看板」目前指定哪一則，見 card.ts）、`POST /danmaku`（發一則彈幕，
 *  見 events.ts 的 `broadcastDanmaku()`）。前三個純記憶體、提示性資訊，彈幕連記憶體
 *  都不留（飄過去就沒了）；`/card` 會持久存檔——見各自 module 開頭的說明。 */
import type { FastifyPluginAsync } from 'fastify'
import { authorFrom, identityKey } from './identity'
import { listActivity } from './activity'
import { currentEditors, heartbeat, stopEditing } from './presence'
import { getCard, setCard } from './card'
import { broadcastDanmaku } from './events'
import { clientIp } from './share'

const DANMAKU_MAX_CHARS = 60
// 彈幕會即時推給「所有」開著牆的人，比一般寫入更容易造成干擾——除了共用的
// 120次/分鐘/IP 寫入限速（share.ts），額外加一個很短的個人冷卻，擋掉「按著
// Enter 不放」這種洗畫面的狀況，不是防惡意（惡意腳本繞得過，但那本來就歸
// 上面那層全域限速管）。
const DANMAKU_COOLDOWN_MS = 800
const lastDanmakuAt = new Map<string, number>()

export const activityRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { limit?: string } }>('/activity', async (req) => {
    const limit = Number(req.query.limit)
    return { entries: listActivity(Number.isFinite(limit) && limit > 0 ? limit : undefined) }
  })

  app.get('/presence', async () => currentEditors())

  app.post<{ Body: { noteId?: string; editing?: boolean; clientId?: string } }>(
    '/presence',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['noteId'],
          properties: {
            noteId: { type: 'string', minLength: 1, maxLength: 200 },
            editing: { type: 'boolean' },
            // 匿名使用者退而求其次用來源 IP 分人——同一 IP 下的不同匿名分頁靠這個
            // 分開，不然會全部撞成同一個 presence key（見 presence.ts 開頭說明）。
            clientId: { type: 'string', maxLength: 100 },
          },
        },
      },
    },
    async (req, reply) => {
      const { noteId, editing: isEditing, clientId } = req.body
      const author = authorFrom(req)
      const ip = clientIp(req)
      if (isEditing === false) stopEditing(noteId!, author, ip, clientId)
      else heartbeat(noteId!, author, ip, clientId)
      return reply.code(204).send()
    },
  )

  app.get('/card', async () => getCard())

  app.post<{ Body: { noteId?: string | null } }>(
    '/card',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            noteId: { type: ['string', 'null'], maxLength: 200 },
          },
        },
      },
    },
    async (req, reply) => {
      const result = setCard(req.body.noteId ?? null)
      if (!result.ok) return reply.code(404).send({ error: result.error })
      return result.state
    },
  )

  app.post<{ Body: { text?: string } }>(
    '/danmaku',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['text'],
          properties: { text: { type: 'string', minLength: 1, maxLength: 200 } },
        },
      },
    },
    async (req, reply) => {
      const text = req.body.text!.trim().slice(0, DANMAKU_MAX_CHARS)
      if (!text) return reply.code(400).send({ error: '訊息不能是空的' })
      const author = authorFrom(req)
      const key = identityKey(author, clientIp(req))
      const now = Date.now()
      if (now - (lastDanmakuAt.get(key) ?? 0) < DANMAKU_COOLDOWN_MS) {
        return reply.code(429).send({ error: '發太快了，等一下再試' })
      }
      lastDanmakuAt.set(key, now)
      broadcastDanmaku({ id: crypto.randomUUID(), author, text, at: now })
      return reply.code(204).send()
    },
  )
}
