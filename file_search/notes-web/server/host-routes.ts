/**
 * `/api/host/*`——host 專用管理端點，給 `/host`（host.html 那個管理頁，見
 * `src/components/HostPanel.tsx`）用。**一律只認 loopback**（不管 `openAccess`
 * 開著沒有、不管有沒有共用密碼 cookie）——這裡能做的事（關掉密碼牆、解除
 * 別人的身分保護）本來就只該留給坐在這台主機前面的人，不該透過共用密碼
 * 這一層就開放，不然任何知道共用密碼的人都能把整道密碼牆永久關掉。
 */
import type { FastifyPluginAsync } from 'fastify'
import {
  isLoginLogo3dEnabled,
  isLoopback,
  isOpenAccess,
  isShareAiEnabled,
  setLoginLogo3dEnabled,
  setOpenAccess,
  setShareAiEnabled,
} from './share'
import { listPeople, releasePerson } from './people'
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
    loginLogo3d: isLoginLogo3dEnabled(),
    people: listPeople(),
  }))

  app.post<{ Body: { open?: boolean } }>(
    '/host/open-access',
    {
      schema: {
        body: {
          type: 'object',
          required: ['open'],
          properties: { open: { type: 'boolean' } },
        },
      },
    },
    async (req) => {
      setOpenAccess(!!req.body.open)
      return { openAccess: isOpenAccess() }
    },
  )

  /** 遠端能不能用 AI（搜尋／生成／語意）——即時切換，牆上會顯示「AI 已停用」。
   *  跟 openAccess 不同：重開 server 不會重置，回到 SHARE_AI 環境變數的預設值。 */
  app.post<{ Body: { enabled?: boolean } }>(
    '/host/ai',
    {
      schema: {
        body: {
          type: 'object',
          required: ['enabled'],
          properties: { enabled: { type: 'boolean' } },
        },
      },
    },
    async (req) => {
      setShareAiEnabled(!!req.body.enabled)
      return { aiEnabled: isShareAiEnabled() }
    },
  )

  /** 登入畫面要不要載入 host 的 3D logo（見 share.ts 的說明）——關掉時前端
   *  完全不 mount `<LoginLogo3D/>`，不是載入了才藏起來。 */
  app.post<{ Body: { enabled?: boolean } }>(
    '/host/login-logo',
    {
      schema: {
        body: {
          type: 'object',
          required: ['enabled'],
          properties: { enabled: { type: 'boolean' } },
        },
      },
    },
    async (req) => {
      setLoginLogo3dEnabled(!!req.body.enabled)
      return { loginLogo3d: isLoginLogo3dEnabled() }
    },
  )

  app.delete<{ Params: { name: string } }>('/host/people/:name', async (req, reply) => {
    const ok = releasePerson(decodeURIComponent(req.params.name))
    if (!ok) return reply.code(404).send({ error: '找不到這個名字' })
    return reply.code(204).send()
  })

  /** 「訪客紀錄」文字視窗——誰、什麼時候造訪過（見 visits.ts）。同一支也給
   *  Node-RED 輪詢轉發 Discord 用：Node-RED 本身就跑在這台機器上，天生
   *  loopback，不用另外開一支不受限制的端點。 */
  app.get<{ Querystring: { limit?: string } }>('/host/visits', async (req) => {
    const limit = Number(req.query.limit)
    return { entries: listVisits(Number.isFinite(limit) && limit > 0 ? limit : undefined) }
  })
}
