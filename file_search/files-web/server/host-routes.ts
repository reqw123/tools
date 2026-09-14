/**
 * `/api/host/*`——host 專用管理端點，給 `/host`（見 `src/components/HostPanel.tsx`）
 * 用。搬自 notes-web/server/host-routes.ts，**一律只認 loopback**，不管
 * `openAccess` 開著沒有、不管有沒有共用密碼 cookie——這裡能做的事（關掉密碼
 * 牆、解除別人的身分保護）本來就只該留給坐在這台主機前面的人。拿掉便利貼
 * 專屬的登入畫面 3D Logo，這個索引牆沒有對應概念。
 */
import type { FastifyPluginAsync } from 'fastify'
import { isLoopback, isOpenAccess, isShareAiEnabled, setOpenAccess, setShareAiEnabled } from './share'
import { listPeople, releasePerson, setPersonDiscordWebhook, setPersonRole } from './people'
import { listVisits } from './visits'
import { listActivity } from './activity'
import { indexDir } from './store'
import { createBackupZip } from './backup'

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

  /** 「訪客紀錄」文字視窗——誰、什麼時候造訪過（見 visits.ts）。 */
  app.get<{ Querystring: { limit?: string } }>('/host/visits', async (req) => {
    const limit = Number(req.query.limit)
    return { entries: listVisits(Number.isFinite(limit) && limit > 0 ? limit : undefined) }
  })

  /**
   * 給 Node-RED 用的「有人上傳了新檔案，且有人設過自己的 Discord webhook」
   * 清單——搬自便利貼牆的 `/host/due-webhooks`，但索引牆的上傳事件沒有「指派
   * 給誰」這種一對一的對象，所以這裡是**廣播**：每一筆上傳都對每一個設過
   * webhook 的人各出現一次（`to` 是通知對象的名字，純粹給 Node-RED／人類
   * 辨識用，實際送去哪裡看 `webhook` 欄位）。資料來源是 `activity.ts` 的
   * 純記憶體活動記錄（`viaUpload` 篩出「這筆 create/bulk-add 是不是透過
   * 上傳進來的」，見 `upload-routes.ts`），最多留 300 筆、server 重開歸零——
   * 這支端點本身無狀態，要不要發、要不要 dedupe 全部交給 Node-RED 自己的
   * flow-context 記帳（跟便利貼到期提醒同一套模式，不重複做）。沒有任何人
   * 設過 webhook 時直接回空陣列，省一趟活動記錄的整理。
   */
  app.get('/host/upload-notifications', async () => {
    const webhooks = listPeople()
      .filter((p) => p.discordWebhook)
      .map((p) => ({ to: p.name, webhook: p.discordWebhook }))
    if (webhooks.length === 0) return { items: [] }
    const uploads = listActivity().filter((e) => e.viaUpload)
    const items: {
      at: string
      indexName: string
      title: string
      count?: number
      author: string
      to: string
      webhook: string
    }[] = []
    for (const u of uploads) {
      for (const w of webhooks) {
        items.push({ at: u.at, indexName: u.indexName, title: u.title, count: u.count, author: u.author, ...w })
      }
    }
    return { items }
  })

  /**
   * 「備份／匯出」——把 `indexDir`（區網＋公網共用模式下就是
   * `public-index-data/`）整個資料夾打包成一個 zip 給人下載，見
   * `backup.ts`。**只認 loopback**（跟這支檔案其他端點一樣）：備份本來就
   * 是主機本人的事，不開放給共用模式下的任何遠端使用者，即使是 editor。
   */
  app.get('/host/export', async (_req, reply) => {
    const zip = await createBackupZip(indexDir)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    reply
      .header('content-type', 'application/zip')
      .header('content-disposition', `attachment; filename="index-wall-backup-${stamp}.zip"`)
      .send(zip)
  })
}
