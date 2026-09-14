/**
 * 「區網共用模式」——索引牆的多人／公網分享，架構直接搬自
 * `notes-web/server/share.ts`（便利貼牆），只拿掉便利貼專屬的
 * `collectionForRequest`（生活／研究生分流）跟登入畫面 3D Logo，其餘
 * （loopback 豁免、登入限速、openAccess、AI 開關）原封不動。離線版
 * （`SHARE_MODE` 未設＝'off'）完全不會用到這裡任何東西：`index.ts` 只有
 * `SHARE_MODE==='lan'` 時才 import cookie 外掛、掛 hook、註冊 session 路由，
 * 也只有這個模式才把 `host` 從 `127.0.0.1` 放寬。
 *
 * **這裡比便利貼牆多一層要顧慮的地雷**：files-web 平常只綁 loopback是因為
 * 它能 shell 出 Explorer（`/open`）、開系統編輯器（`/indexes/:name/edit`）、
 * 瀏覽整台硬碟（`/browse`、`/scan`）——這幾支即使密碼登入了也不能對遠端
 * 開放，見 `shareGuardHook` 的封鎖清單，跟 notes-web 早就擋掉
 * `/files/browse`／`/files/scan` 是同一個理由，只是這裡碰到的更多。
 *
 * 例外：帶 `x-forwarded-for` 的請求不吃 loopback 豁免（見 isLoopback）——那是
 * 經 ngrok／反向代理進來的，socket 雖是 127.0.0.1 但真正來源在外網。這一條
 * 讓「區網＋公網」同一支 server 成立：啟動器（`share-gateway/serve.mjs`，
 * 這裡沒有自己獨立的啟動器）起 ngrok，隧道進來的流量照樣過密碼牆。
 * `SHARE_PUBLIC`／`SHARE_PUBLIC_URL` 也由該啟動器帶入。
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import { networkInterfaces } from 'node:os'
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import { emitChange } from './change-bus'
import {
  IDENTITY_COOKIE,
  claimOrVerify,
  getPersonRole,
  identityToken,
  verifyIdentityToken,
} from './people'
import { authorFrom } from './identity'
import { startSweeper } from './sweep'

export type ShareMode = 'off' | 'lan'

export const SHARE_MODE: ShareMode = process.env.SHARE_MODE === 'lan' ? 'lan' : 'off'
/** 是否同時開了 ngrok 公網通道（由啟動器 `share-gateway/serve.mjs` 設定）。
 *  影響：共用密碼最低長度拉到 8。登入限速一律都在。 */
export const SHARE_PUBLIC = process.env.SHARE_PUBLIC === 'on'
/** 啟動器抓到的 ngrok 公網網址（`https://xxx.ngrok-free.app`，不含路徑）。 */
export const SHARE_PUBLIC_URL = (process.env.SHARE_PUBLIC_URL ?? '').trim()
/** 主牆固定路徑（見 main.tsx）——根路徑 `/` 什麼都不畫，一定要走這個路徑
 *  才進得去。給「分享」QR／複製連結、啟動器主控台印的網址用。 */
export const WALL_PATH = '/wall'
/** 給「分享」鈕 QR／複製連結用——公網網址 + 固定路徑，沒開公網就是空字串。 */
export const SHARE_WALL_URL = SHARE_PUBLIC_URL ? `${SHARE_PUBLIC_URL}${WALL_PATH}` : ''

const SHARE_TOKEN = (process.env.SHARE_TOKEN ?? '').trim()
const COOKIE_NAME = 'share_session'
/** cookie 存的是 token 的雜湊，不是明文。 */
const SESSION_VALUE = SHARE_TOKEN ? createHash('sha256').update(SHARE_TOKEN).digest('hex') : ''

/** lan 模式但沒給（有效）密碼 → 啟動時就擋下來，不要開一個沒鎖的門。公網再嚴一級。 */
export function assertShareConfig(): void {
  if (SHARE_MODE !== 'lan') return
  const min = SHARE_PUBLIC ? 8 : 4
  if (SHARE_TOKEN.length < min) {
    throw new Error(
      `SHARE_MODE=lan${SHARE_PUBLIC ? '（公網）' : ''} 需要至少 ${min} 個字的 SHARE_TOKEN（共用密碼）。` +
        '請設定環境變數，或在 index-share-config.txt 第一行寫密碼後再啟動。',
    )
  }
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

/** 多人牆閘道（`file_search/share-gateway/`）啟動器產生的一次性密鑰——只有
 *  透過閘道啟動（`啟動-多人牆（區網＋公網）.bat`）才會設。閘道自己算好
 *  「這次連線的真正來源是不是主機本人」，用這把密鑰簽出一個信任標頭直接
 *  告訴這支後端，不用讓後端自己再猜一次（見下面 isLoopback 的說明）。 */
const GATEWAY_SECRET = (process.env.GATEWAY_SECRET ?? '').trim()

/**
 * loopback 豁免判斷。**帶了 `x-forwarded-for` 的一律不算 loopback**——那是經過
 * ngrok／反向代理進來的請求。直連的本機 wallpaper-app／瀏覽器不會有這個
 * 標頭；區網直連的 IP 本來就非 loopback。
 *
 * **經多人牆閘道轉發時走另一條路**：閘道是「所有流量都先經過」的那一關，
 * 這支後端收到的連線來源永遠是閘道自己（同機 127.0.0.1），上面那套
 * 「看 socket 位址＋x-forwarded-for」的判斷在閘道前面就已經失真了。閘道會
 * 自己判斷「這次連線的第一手來源」是不是主機本人，用 `x-gateway-loopback`
 * 標頭（值＝`GATEWAY_SECRET` 表示是、`not:`+密鑰表示否）明講出來——這裡
 * 只認密鑰對得上的標頭，密鑰沒設（獨立啟動器，沒有閘道）或標頭沒帶／
 * 帶錯，一律照舊看 x-forwarded-for／socket 位址，行為完全不變。 */
export function isLoopback(req: FastifyRequest): boolean {
  if (GATEWAY_SECRET) {
    const trusted = req.headers['x-gateway-loopback']
    if (trusted === GATEWAY_SECRET) return true
    if (trusted === `not:${GATEWAY_SECRET}`) return false
  }
  if (req.headers['x-forwarded-for'] != null) return false
  const addr = req.socket.remoteAddress ?? ''
  return LOOPBACK.has(addr)
}

// ── 開放模式：host 手動開關，暫時跳過共用密碼 ───────────────────────────
// 跟 notes-web 一樣：openAccess 開著時**仍然要求名字＋PIN**，不是整關直接
// 放行。預設開，每次重開 server 都會重置回開——只有 host 本人（loopback，
// 見 host-routes.ts）能切換，遠端連 API 都碰不到。
let openAccess = true
export function isOpenAccess(): boolean {
  return openAccess
}
export function setOpenAccess(v: boolean): void {
  openAccess = v
}

// ── 遠端 AI 開關：host 手動控制，可即時切換 ────────────────────────────
// 啟動時從 SHARE_AI 環境變數帶入預設值，之後 host 可在 /host 隨時開關。跟
// openAccess 不同的是：重開 server 會回到環境變數的預設值，不是固定重置。
let shareAiEnabled = process.env.SHARE_AI === 'on'
export function isShareAiEnabled(): boolean {
  return shareAiEnabled
}
export function setShareAiEnabled(v: boolean): void {
  if (shareAiEnabled === v) return
  shareAiEnabled = v
  emitChange('settings') // 牆上要即時顯示「AI 已停用」——推播給所有連著的畫面
}

/** 多人牆閘道啟動器帶入——另一面牆的顯示名稱＋切換用網址（閘道自己的
 *  `/switch-wall?to=...`）。獨立啟動器（沒有閘道）沒設這兩個環境變數，
 *  `otherWall` 就不會出現在 `/api/share-info`，前端也就不會畫切換鈕。 */
const OTHER_WALL_LABEL = (process.env.OTHER_WALL_LABEL ?? '').trim()
const OTHER_WALL_SWITCH_URL = (process.env.OTHER_WALL_SWITCH_URL ?? '').trim()

/**
 * 給前端 `/api/share-info` 的公開資訊（不需驗證就能拿）。**帶 `req` 是刻意
 * 的**——`loopback` 要照這次連線實際判斷，不是看 server 全域設定，這是
 * notes-web 踩過的坑（`isShare` 沒分本機/遠端），這次直接做對。
 */
export function shareInfoPayload(req: FastifyRequest): {
  mode: ShareMode
  ai: boolean
  loopback: boolean
  publicUrl?: string
  openAccess?: boolean
  otherWall?: { label: string; switchUrl: string }
} {
  return {
    mode: SHARE_MODE,
    ai: SHARE_MODE === 'off' ? true : shareAiEnabled,
    loopback: isLoopback(req),
    ...(SHARE_MODE === 'lan' && SHARE_WALL_URL ? { publicUrl: SHARE_WALL_URL } : {}),
    ...(SHARE_MODE === 'lan' ? { openAccess } : {}),
    ...(SHARE_MODE === 'lan' && OTHER_WALL_LABEL && OTHER_WALL_SWITCH_URL
      ? { otherWall: { label: OTHER_WALL_LABEL, switchUrl: OTHER_WALL_SWITCH_URL } }
      : {}),
  }
}

/**
 * 顯示用的「這是誰」——比 `authorFrom()` 多一層：完全匿名（沒有身分 cookie、
 * 也沒有 `x-index-author` 標頭）且是 loopback 連線時，回傳「開發者」而不是
 * 空字串。**只給顯示用的地方用**（活動紀錄、訪客紀錄、在場提示這類 log）
 * ——不能用在權限判斷（`getPersonRole` 那種），「開發者」不是真正註冊過
 * 的名字。之所以需要這一層：loopback 連線完全不用經過密碼牆／名字＋PIN
 * （見 `shareAuthHook`），本機測試/使用時很容易全部顯示成「有人」，跟
 * `openAccess` 關閉時真正選擇匿名進牆的遠端訪客混在一起分不清楚——這是
 * 使用者實際回報的困惑（明明只有一個人登入，訪客紀錄卻多出「有人」）。
 */
export function displayAuthorFrom(req: FastifyRequest): string {
  const a = authorFrom(req)
  if (a) return a
  return isLoopback(req) ? '開發者' : ''
}

// ── 遠端 AI 每日額度 ──────────────────────────────────────────────────
// AI 開關開著才會被打到，限的是 /ai/suggest——真正花 host 錢／額度的那支。
// 純記憶體，server 重開歸零。
const SHARE_AI_DAILY_LIMIT = Number(process.env.SHARE_AI_DAILY_LIMIT ?? 30)
let aiUsageDay = ''
let aiUsageCount = 0

function remoteAiSuggestAllowed(): boolean {
  const today = new Date().toISOString().slice(0, 10)
  if (today !== aiUsageDay) {
    aiUsageDay = today
    aiUsageCount = 0
  }
  if (aiUsageCount >= SHARE_AI_DAILY_LIMIT) return false
  aiUsageCount += 1
  return true
}

// ── 登入限速 ────────────────────────────────────────────────────────
const LOGIN_WINDOW_MS = 15 * 60_000
const LOGIN_MAX_FAILS = 10
const loginFails = new Map<string, { n: number; since: number }>()
startSweeper(loginFails, (v) => v.since, LOGIN_WINDOW_MS)

/** 匿名使用者用來區分「不同人」的 key（presence.ts 需要）。取最後一段，不是
 *  第一段——`X-Forwarded-For` 只有 ngrok 這一層可信代理會附加，前面的段落
 *  任何人都能在自己的請求裡預先塞假的。 */
export function clientIp(req: FastifyRequest): string {
  const raw = req.headers['x-forwarded-for']
  const first = Array.isArray(raw) ? raw[0] : raw
  const parts = (first ?? '').split(',')
  const xff = parts[parts.length - 1]?.trim()
  return xff || req.socket.remoteAddress || 'unknown'
}
function loginBlocked(ip: string): boolean {
  const rec = loginFails.get(ip)
  if (!rec) return false
  if (Date.now() - rec.since > LOGIN_WINDOW_MS) {
    loginFails.delete(ip)
    return false
  }
  return rec.n >= LOGIN_MAX_FAILS
}
function noteLoginFail(ip: string): void {
  const rec = loginFails.get(ip)
  if (!rec || Date.now() - rec.since > LOGIN_WINDOW_MS) {
    loginFails.set(ip, { n: 1, since: Date.now() })
  } else {
    rec.n += 1
  }
}

// ── 寫入限速 ────────────────────────────────────────────────────────
const WRITE_WINDOW_MS = 60_000
const WRITE_MAX = 120
const writeCounts = new Map<string, { n: number; since: number }>()
startSweeper(writeCounts, (v) => v.since, WRITE_WINDOW_MS)

function writeRateLimited(ip: string): boolean {
  const rec = writeCounts.get(ip)
  if (!rec || Date.now() - rec.since > WRITE_WINDOW_MS) {
    writeCounts.set(ip, { n: 1, since: Date.now() })
    return false
  }
  rec.n += 1
  return rec.n > WRITE_MAX
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
 * 驗證 hook——非 loopback 且沒有效 cookie 時擋下。放行清單：`/api/session`、
 * `/api/share-info`、非 `/api/` 的路徑（SPA 殼＋靜態資源，讓沒登入的人也
 * 拿得到登入畫面）。**開放模式（openAccess）只免共用密碼，不免身分驗證**
 * ——道理跟 notes-web 完全一樣，見那邊的說明。
 */
export async function shareAuthHook(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (isLoopback(req)) return
  const path = req.url.split('?')[0]
  if (path === '/api/session' || path === '/api/share-info') return
  if (!path.startsWith('/api/')) return
  if (openAccess) {
    if (verifyIdentityToken(req.cookies?.[IDENTITY_COOKIE])) return
    await reply.code(401).send({ error: '開放模式仍需要輸入名字＋PIN 才能進牆', needAuth: true })
    return
  }
  if (cookieValid(req.cookies?.[COOKIE_NAME])) return
  await reply.code(401).send({ error: '需要密碼', needAuth: true })
}

/**
 * 危險端點封鎖 hook——非 loopback 時關掉「會攤開 host 硬碟／操作 host 桌面／
 * 改 host AI 設定／花 host 的錢」那些。跑在 shareAuthHook 之後。
 *
 * `/open`（開 Explorer）、`/browse`（瀏覽任意路徑）、`/scan`（遞迴掃資料夾）、
 * `/indexes/:name/edit`（開系統編輯器）**永遠只認 loopback，即使密碼登入了
 * 也一樣**——這幾支本質上是「操作主機本身」，不是「看/改共用資料」，跟
 * notes-web 擋掉 `/files/browse`／`/files/scan` 是同一個理由，只是這裡碰到
 * 的更多（files-web 平常只綁 127.0.0.1 就是為了這幾支，見 index.ts）。
 * `/file`、`/preview`（看已收錄項目的實際內容）不在這個清單——那是分享出去
 * 的核心價值，只要密碼牆過了就給看。
 */
export async function shareGuardHook(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (isLoopback(req)) return
  const path = req.url.split('?')[0]
  const method = req.method

  if (method !== 'GET' && path !== '/api/session' && writeRateLimited(clientIp(req))) {
    return void reply.code(429).send({ error: '寫入太頻繁，請稍等一下再試' })
  }
  if (method !== 'GET' && path !== '/api/session' && getPersonRole(authorFrom(req)) === 'viewer') {
    return void reply.code(403).send({ error: '唯讀身分，不能編輯' })
  }
  if (path === '/api/ai/suggest' && shareAiEnabled && !remoteAiSuggestAllowed()) {
    return void reply.code(429).send({ error: '今天的共用 AI 額度用完了，明天再試（host 設定的每日上限）' })
  }

  // 操作 host 主機本身——即使密碼登入了也不行，見上方說明。
  if (
    path === '/api/open' ||
    path === '/api/browse' ||
    path === '/api/scan' ||
    /^\/api\/indexes\/[^/]+\/edit$/.test(path)
  ) {
    return void reply.code(403).send({ error: '共用模式下這個功能只能在主機本機使用' })
  }
  // 改 host 的 AI provider／金鑰、連線測試
  if (path === '/api/ai/settings' || path === '/api/ai/test' || path === '/api/ai/models') {
    return void reply.code(403).send({ error: '共用模式下停用 AI 設定' })
  }
  // 其餘 AI（批次補說明用的建議）——用 host 的額度與金錢
  if (!shareAiEnabled && path.startsWith('/api/ai/')) {
    return void reply.code(403).send({ error: '共用模式下停用 AI 功能' })
  }
}

/** `/api/session` 登入 / 查詢 / 登出。註冊在 `/api` prefix 底下。 */
export const shareSessionRoutes: FastifyPluginAsync = async (app) => {
  app.get('/session', async (req) => {
    if (isLoopback(req)) {
      const name = verifyIdentityToken(req.cookies?.[IDENTITY_COOKIE])
      return { ok: true, name: name || null, role: getPersonRole(name) }
    }
    const name = verifyIdentityToken(req.cookies?.[IDENTITY_COOKIE])
    const ok = openAccess ? !!name : cookieValid(req.cookies?.[COOKIE_NAME])
    return { ok, name: name || null, role: getPersonRole(name) }
  })

  app.post<{ Body: { password?: string; name?: string; pin?: string } }>(
    '/session',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            password: { type: 'string', maxLength: 200 },
            name: { type: 'string', maxLength: 40 },
            pin: { type: 'string', maxLength: 20 },
          },
        },
      },
    },
    async (req, reply) => {
      const ip = clientIp(req)
      if (loginBlocked(ip)) {
        return reply.code(429).send({ error: '嘗試太多次，請等 15 分鐘後再試' })
      }

      if (openAccess) {
        const name = (req.body.name ?? '').trim().slice(0, 40)
        if (!name) {
          noteLoginFail(ip)
          return reply.code(401).send({ error: '開放模式仍需要輸入名字＋PIN，不能留空匿名進牆' })
        }
        const claim = claimOrVerify(name, req.body.pin ?? '')
        if (!claim.ok) {
          noteLoginFail(ip)
          return reply.code(401).send({ error: claim.error ?? 'PIN 不對' })
        }
        loginFails.delete(ip)
        const viaHttps = req.headers['x-forwarded-proto'] === 'https'
        const cookieOpts = { httpOnly: true, sameSite: 'lax' as const, path: '/', secure: viaHttps }
        reply.setCookie(IDENTITY_COOKIE, identityToken(name), cookieOpts)
        return { ok: true, name }
      }

      if (!passwordValid(req.body.password)) {
        noteLoginFail(ip)
        return reply.code(401).send({ error: '密碼不對' })
      }
      const claim = claimOrVerify(req.body.name ?? '', req.body.pin ?? '')
      if (!claim.ok) {
        noteLoginFail(ip)
        return reply.code(401).send({ error: claim.error ?? 'PIN 不對' })
      }
      loginFails.delete(ip)
      const viaHttps = req.headers['x-forwarded-proto'] === 'https'
      const cookieOpts = { httpOnly: true, sameSite: 'lax' as const, path: '/', secure: viaHttps }
      reply.setCookie(COOKIE_NAME, SESSION_VALUE, cookieOpts)
      const name = (req.body.name ?? '').trim().slice(0, 40)
      if (name) reply.setCookie(IDENTITY_COOKIE, identityToken(name), cookieOpts)
      return { ok: true, name: name || null }
    },
  )

  app.delete('/session', async (_req, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: '/' })
    reply.clearCookie(IDENTITY_COOKIE, { path: '/' })
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
