/**
 * 「區網共用模式」——唯一的網路關注點集中地。離線版（SHARE_MODE 未設 = 'off'）
 * 完全不會用到這裡任何東西：index.ts 只有 `SHARE_MODE === 'lan'` 時才 import
 * cookie 外掛、掛 hook、註冊 session 路由。
 *
 * 設計重點：**loopback（127.0.0.1 / ::1）一律豁免**。使用者自己的 wallpaper-app
 * 和本機瀏覽器都是 loopback，行為與離線版逐位元組相同；密碼牆與端點限制只作用在
 * 「別台電腦連進來」。
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import { networkInterfaces } from 'node:os'
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'

export type ShareMode = 'off' | 'lan'

export const SHARE_MODE: ShareMode = process.env.SHARE_MODE === 'lan' ? 'lan' : 'off'
/** 遠端能不能用會花錢／連 Ollama 的 AI（搜尋、生成、語意）。預設不行。 */
export const SHARE_AI = process.env.SHARE_AI === 'on'

const SHARE_TOKEN = (process.env.SHARE_TOKEN ?? '').trim()
const COOKIE_NAME = 'share_session'
/** cookie 存的是 token 的雜湊，不是明文。 */
const SESSION_VALUE = SHARE_TOKEN ? createHash('sha256').update(SHARE_TOKEN).digest('hex') : ''

/** lan 模式但沒給（有效）密碼 → 啟動時就擋下來，不要開一個沒鎖的門。 */
export function assertShareConfig(): void {
  if (SHARE_MODE === 'lan' && SHARE_TOKEN.length < 4) {
    throw new Error(
      'SHARE_MODE=lan 需要至少 4 個字的 SHARE_TOKEN（共用密碼）。' +
        '請設定環境變數，或在 share-config.txt 第一行寫密碼後再啟動。',
    )
  }
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

export function isLoopback(req: FastifyRequest): boolean {
  const addr = req.socket.remoteAddress ?? ''
  return LOOPBACK.has(addr)
}

/** 給前端 `/api/share-info` 的公開資訊（不需驗證就能拿）。 */
export function shareInfoPayload(): { mode: ShareMode; ai: boolean } {
  return { mode: SHARE_MODE, ai: SHARE_MODE === 'off' ? true : SHARE_AI }
}

/** 這次請求該動哪一份便利貼——遠端一律鎖在生活牆（研究生牆是 host 私人的）。 */
export function collectionForRequest(req: FastifyRequest): 'life' | 'thesis' {
  if (SHARE_MODE === 'lan' && !isLoopback(req)) return 'life'
  return req.headers['x-note-collection'] === 'thesis' ? 'thesis' : 'life'
}

function cookieValid(raw: string | undefined): boolean {
  if (!raw || !SESSION_VALUE) return false
  const a = Buffer.from(raw)
  const b = Buffer.from(SESSION_VALUE)
  return a.length === b.length && timingSafeEqual(a, b)
}

function passwordValid(input: unknown): boolean {
  if (typeof input !== 'string' || !input || !SHARE_TOKEN) return false
  const a = Buffer.from(input)
  const b = Buffer.from(SHARE_TOKEN)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * 驗證 hook——非 loopback 且沒有效 cookie 時擋下。放行清單：
 * `/api/session`（登入本身）、非 `/api` 且非 `/note-images` 的路徑（SPA 殼 + 靜態資源，
 * 這樣沒登入的人也拿得到登入畫面）、`/api/share-info`（前端要靠它決定 UI）。
 */
export async function shareAuthHook(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (isLoopback(req)) return
  const path = req.url.split('?')[0]
  if (path === '/api/session' || path === '/api/share-info') return
  if (!path.startsWith('/api/') && !path.startsWith('/note-images/')) return
  if (cookieValid(req.cookies?.[COOKIE_NAME])) return
  await reply.code(401).send({ error: '需要密碼', needAuth: true })
}

/**
 * 危險端點封鎖 hook——非 loopback 時，把「會攤開 host 硬碟 / 改 host AI 設定 /
 * 花 host 的錢」那些關掉。跑在 shareAuthHook 之後。
 */
export async function shareGuardHook(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (isLoopback(req)) return
  const path = req.url.split('?')[0]
  const method = req.method

  // host 檔案系統瀏覽／掃描
  if (path === '/api/files/browse' || path === '/api/files/scan') {
    return void reply.code(403).send({ error: '共用模式下停用檔案瀏覽' })
  }
  // 舊的 srcPath 換圖分支（＝任意檔案讀取）；遠端只能走 multipart 上傳
  if (
    method === 'POST' &&
    /^\/api\/notes\/[^/]+\/image$/.test(path) &&
    !(req.headers['content-type'] ?? '').startsWith('multipart/')
  ) {
    return void reply.code(403).send({ error: '共用模式下請用上傳' })
  }
  // 改 host 的 AI provider／金鑰、連線測試
  if (
    path === '/api/ai/settings' ||
    path === '/api/ai/test' ||
    path === '/api/ai/models'
  ) {
    return void reply.code(403).send({ error: '共用模式下停用 AI 設定' })
  }
  // 其餘 AI（搜尋／生成／語意）——用 host 的額度與金錢
  if (!SHARE_AI && path.startsWith('/api/ai/')) {
    return void reply.code(403).send({ error: '共用模式下停用 AI 功能' })
  }
}

/** `/api/session` 登入 / 查詢 / 登出。註冊在 `/api` prefix 底下。 */
export const shareSessionRoutes: FastifyPluginAsync = async (app) => {
  // loopback（本機 wallpaper-app／瀏覽器）永遠有權限——不然 AppGate 會把它擋在密碼牆外。
  app.get('/session', async (req) => ({
    ok: isLoopback(req) || cookieValid(req.cookies?.[COOKIE_NAME]),
  }))

  app.post<{ Body: { password?: string } }>(
    '/session',
    {
      schema: {
        body: {
          type: 'object',
          required: ['password'],
          properties: { password: { type: 'string', minLength: 1, maxLength: 200 } },
        },
      },
    },
    async (req, reply) => {
      if (!passwordValid(req.body.password)) {
        return reply.code(401).send({ error: '密碼不對' })
      }
      reply.setCookie(COOKIE_NAME, SESSION_VALUE, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 30,
      })
      return { ok: true }
    },
  )

  app.delete('/session', async (_req, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: '/' })
    return { ok: true }
  })
}

/** 啟動 log 用——列出這台機器的區網 IPv4。 */
export function lanAddresses(): string[] {
  const out: string[] = []
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address)
    }
  }
  return out
}
