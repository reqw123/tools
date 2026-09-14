/**
 * `/api/host/*`——host 專用管理端點，給 `/host`（見 `src/components/HostPanel.tsx`）
 * 用。搬自 notes-web/server/host-routes.ts，**一律只認 loopback**，不管
 * `openAccess` 開著沒有、不管有沒有共用密碼 cookie——這裡能做的事（關掉密碼
 * 牆、解除別人的身分保護）本來就只該留給坐在這台主機前面的人。拿掉便利貼
 * 專屬的登入畫面 3D Logo、Discord webhook、到期通知清單，這幾個索引牆沒有
 * 對應概念。
 */
import type { FastifyPluginAsync } from 'fastify'
import { isLoopback, isOpenAccess, isShareAiEnabled, setOpenAccess, setShareAiEnabled } from './share'
import { listPeople, releasePerson, setPersonRole } from './people'
import { listVisits } from './visits'

export const hostRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', async (req, reply) => {
    if (!isLoopback(req)) {
      await reply.code(403).send({ error: '這個頁面只能在主機本機（loopback）開啟' })
    }
  })

  app.get('/host/state', async () => ({
    openAccess: isOpenAccess(),
    aiEnabled: isShareAiEnabled(),
    people: listPeople(),
  }))

  app.post<{ Body: { open?: boolean } }>(
    '/host/open-access',
    {
      schema: {
        body: { type: 'object', required: ['open'], properties: { open: { type: 'boolean' } } },
      },
    },
    async (req) => {
      setOpenAccess(!!req.body.open)
      return { openAccess: isOpenAccess() }
    },
  )

  /** 遠端能不能用 AI（批次補說明的建議）——即時切換，牆上會顯示「AI 已停用」。
   *  跟 openAccess 不同：重開 server 不會重置，回到 SHARE_AI 環境變數的預設值。 */
  app.post<{ Body: { enabled?: boolean } }>(
    '/host/ai',
    {
      schema: {
        body: { type: 'object', required: ['enabled'], properties: { enabled: { type: 'boolean' } } },
      },
    },
    async (req) => {
      setShareAiEnabled(!!req.body.enabled)
      return { aiEnabled: isShareAiEnabled() }
    },
  )

  app.delete<{ Params: { name: string } }>('/host/people/:name', async (req, reply) => {
    let name: string
    try {
      name = decodeURIComponent(req.params.name)
    } catch {
      return reply.code(400).send({ error: '名字格式不正確' })
    }
    const ok = releasePerson(name)
    if (!ok) return reply.code(404).send({ error: '找不到這個名字' })
    return reply.code(204).send()
  })

  app.post<{ Params: { name: string }; Body: { role?: 'editor' | 'viewer' } }>(
    '/host/people/:name/role',
    {
      schema: {
        body: {
          type: 'object',
          required: ['role'],
          properties: { role: { type: 'string', enum: ['editor', 'viewer'] } },
        },
      },
    },
    async (req, reply) => {
      let name: string
      try {
        name = decodeURIComponent(req.params.name)
      } catch {
        return reply.code(400).send({ error: '名字格式不正確' })
      }
      const ok = setPersonRole(name, req.body.role!)
      if (!ok) return reply.code(404).send({ error: '找不到這個名字' })
      return { people: listPeople() }
    },
  )

  /** 「訪客紀錄」文字視窗——誰、什麼時候造訪過（見 visits.ts）。 */
  app.get<{ Querystring: { limit?: string } }>('/host/visits', async (req) => {
    const limit = Number(req.query.limit)
    return { entries: listVisits(Number.isFinite(limit) && limit > 0 ? limit : undefined) }
  })
}
