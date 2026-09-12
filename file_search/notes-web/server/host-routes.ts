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
import {
  getPersonDiscordWebhook,
  listPeople,
  releasePerson,
  setPersonDiscordWebhook,
  setPersonRole,
} from './people'
import { listVisits } from './visits'
import { dueSummaryAll } from './store'

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

  /** 把某個已註冊名字設成 editor（可編輯）或 viewer（唯讀）——見 people.ts
   *  的 setPersonRole()／share.ts 的 shareGuardHook 怎麼用這個角色擋寫入。 */
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

  /** 設定或清除某個已註冊名字自己的 Discord webhook——**host 手動輸入**（使用者
   *  私下把 webhook 網址給 host，這裡沒有開放給一般使用者自己填的端點）。留空
   *  字串＝清除；見 people.ts 的 setPersonDiscordWebhook() 的格式檢查。 */
  app.post<{ Params: { name: string }; Body: { webhook?: string } }>(
    '/host/people/:name/webhook',
    {
      schema: {
        body: {
          type: 'object',
          required: ['webhook'],
          properties: { webhook: { type: 'string', maxLength: 300 } },
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
      const result = setPersonDiscordWebhook(name, req.body.webhook ?? '')
      if (!result.ok) {
        const code = result.error === '找不到這個名字' ? 404 : 400
        return reply.code(code).send({ error: result.error })
      }
      return { people: listPeople() }
    },
  )

  /** 「訪客紀錄」文字視窗——誰、什麼時候造訪過（見 visits.ts）。同一支也給
   *  Node-RED 輪詢轉發 Discord 用：Node-RED 本身就跑在這台機器上，天生
   *  loopback，不用另外開一支不受限制的端點。 */
  app.get<{ Querystring: { limit?: string } }>('/host/visits', async (req) => {
    const limit = Number(req.query.limit)
    return { entries: listVisits(Number.isFinite(limit) && limit > 0 ? limit : undefined) }
  })

  /** Discord embed 一個 field 的 value 上限是 1024 字——留點餘裕給 Node-RED
   *  自己加的「還有更多」提示，這裡先夾住，不要整包塞爆送不出去。 */
  const DISCORD_FIELD_LIMIT = 900

  /**
   * 給 Node-RED 用的「指派給誰的便利貼快到期／已逾期了，且那個人有設自己的
   * Discord webhook」清單——把 `dueSummaryAll()` 的到期資料跟 people.ts 的
   * webhook 設定 join 起來，Node-RED 收到清單後自己決定要不要發、要不要
   * dedupe（跟現有「便利貼到期提醒」分頁同一套 flow-context 記帳模式，這裡
   * 不重複做，保持這支端點單純、無狀態）。沒設 webhook 的人不會出現在這裡。
   * `noteBody` 是完整內文（夾到 `DISCORD_FIELD_LIMIT` 字，Discord embed field
   * 的長度上限），讓 Discord 通知能看到便利貼實際內容，不是只有標題。
   */
  app.get('/host/due-webhooks', async () => {
    const { overdue, soon } = dueSummaryAll()
    const items: {
      kind: 'overdue' | 'soon'
      noteId: string
      noteTitle: string
      noteBody: string
      noteBodyTruncated: boolean
      dueAt: string
      collection: string
      assignee: string
      webhook: string
    }[] = []
    for (const [list, kind] of [
      [overdue, 'overdue'],
      [soon, 'soon'],
    ] as const) {
      for (const n of list) {
        if (!n.assignee) continue
        const webhook = getPersonDiscordWebhook(n.assignee)
        if (!webhook) continue
        const truncated = n.body.length > DISCORD_FIELD_LIMIT
        items.push({
          kind,
          noteId: n.id,
          noteTitle: n.title,
          noteBody: truncated ? n.body.slice(0, DISCORD_FIELD_LIMIT) : n.body,
          noteBodyTruncated: truncated,
          dueAt: n.due_at,
          collection: n.collection,
          assignee: n.assignee,
          webhook,
        })
      }
    }
    return { items }
  })
}
