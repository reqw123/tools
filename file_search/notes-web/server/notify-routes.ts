import type { FastifyPluginAsync } from 'fastify'
import { isLoopback } from './share'
import { discordStatus, getDiscordWebhook, sendDiscordTest, setDiscordWebhook } from './notify-settings'

/**
 * Discord 通知設定的 API（見 notify-settings.ts）。不放在 host-routes：那組只在 SHARE_MODE=lan 才註冊，
 * 桌面牆（8787）平常不是共用模式也要能設定。這裡**不論模式都註冊、一律只認 loopback**——webhook 等同密碼，
 * 遠端使用者看不到也改不了；Node-RED 跟牆在同一台電腦，打 127.0.0.1 讀得到。
 */
export const notifyRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', async (req, reply) => {
    if (!isLoopback(req)) await reply.code(403).send({ error: '這個設定只能在主機本機使用' })
  })

  // 設定畫面用：只回遮罩後的樣子，完整網址不離開這台電腦的 server
  app.get('/host/discord', async () => discordStatus())

  app.put<{ Body: { webhook?: string } }>(
    '/host/discord',
    { schema: { body: { type: 'object', required: ['webhook'], properties: { webhook: { type: 'string', maxLength: 300 } } } } },
    async (req, reply) => {
      const err = setDiscordWebhook(req.body.webhook ?? '')
      if (err) return reply.code(400).send({ error: err })
      return discordStatus()
    },
  )

  app.post('/host/discord/test', async (_req, reply) => {
    const r = await sendDiscordTest()
    if (!r.ok) return reply.code(400).send({ error: r.error })
    return { ok: true }
  })

  /** 給同一台電腦上的 Node-RED 讀：完整 webhook 網址（它放進 global `discordWebhookUrl`）。 */
  app.get('/host/notify-config', async () => ({ discordWebhookUrl: getDiscordWebhook() }))
}
