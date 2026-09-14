/** `GET /activity`（誰新增／改／移除了什麼）、`GET`/`POST /presence`（誰正在
 *  看哪份索引集）、`GET`/`POST /entry-presence`（誰正在編輯哪一列）。純記憶體、
 *  提示性資訊——搬自 notes-web/server/activity-routes.ts，拿掉便利貼專屬的
 *  `/card`（看板）、`/danmaku`（彈幕）、指派用的 `/people` 名字清單，這幾個
 *  索引牆沒有對應概念；`/entry-presence` 則是索引牆自己多加的（見
 *  entry-presence.ts 開頭說明——項目層級的編輯在場提示，跟 `/presence` 那個
 *  索引集層級的是分開兩件事）。 */
import type { FastifyPluginAsync } from 'fastify'
import { listActivity } from './activity'
import { currentViewers, heartbeat, stopViewing } from './presence'
import { currentEntryEditors, heartbeatEntry, stopEditingEntry } from './entry-presence'
import { listOnline } from './connections'
import { clientIp, displayAuthorFrom } from './share'

export const activityRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { limit?: string } }>('/activity', async (req) => {
    const limit = Number(req.query.limit)
    return { entries: listActivity(Number.isFinite(limit) && limit > 0 ? limit : undefined) }
  })

  /** 目前真的在線的具名使用者——見 connections.ts 的 listOnline()。給多人牆
   *  閘道的「合併在線名單」用（單獨這面牆用不到，前端沒有獨立的「誰在線」
   *  UI，只有閘道模式的合併動態會顯示）。 */
  app.get('/online', async () => ({ names: listOnline() }))

  app.get('/presence', async () => currentViewers())

  app.post<{ Body: { indexName?: string; viewing?: boolean; clientId?: string } }>(
    '/presence',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['indexName'],
          properties: {
            indexName: { type: 'string', minLength: 1, maxLength: 255 },
            viewing: { type: 'boolean' },
            clientId: { type: 'string', maxLength: 100 },
          },
        },
      },
    },
    async (req, reply) => {
      const { indexName, viewing: isViewing, clientId } = req.body
      const author = displayAuthorFrom(req)
      const ip = clientIp(req)
      if (isViewing === false) stopViewing(indexName!, author, ip, clientId)
      else heartbeat(indexName!, author, ip, clientId)
      return reply.code(204).send()
    },
  )

  /** 這份索引集裡目前正在編輯的項目——`EntryRow.tsx` 的 inline 編輯表單開著
   *  時才有意義，跟上面「誰正在看整份索引集」是不同粒度。`index` 沒帶／查
   *  無資料就回空物件，前端不用另外判斷。 */
  app.get<{ Querystring: { index?: string } }>('/entry-presence', async (req) => {
    const indexName = (req.query.index ?? '').trim()
    return indexName ? currentEntryEditors(indexName) : {}
  })

  app.post<{ Body: { indexName?: string; path?: string; editing?: boolean; clientId?: string } }>(
    '/entry-presence',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['indexName', 'path'],
          properties: {
            indexName: { type: 'string', minLength: 1, maxLength: 255 },
            path: { type: 'string', minLength: 1, maxLength: 4000 },
            editing: { type: 'boolean' },
            clientId: { type: 'string', maxLength: 100 },
          },
        },
      },
    },
    async (req, reply) => {
      const { indexName, path, editing: isEditing, clientId } = req.body
      const author = displayAuthorFrom(req)
      const ip = clientIp(req)
      if (isEditing === false) stopEditingEntry(indexName!, path!, author, ip, clientId)
      else heartbeatEntry(indexName!, path!, author, ip, clientId)
      return reply.code(204).send()
    },
  )
}
