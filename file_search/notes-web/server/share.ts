/**
 * 「區網共用模式」——唯一的網路關注點集中地。離線版（SHARE_MODE 未設 = 'off'）
 * 完全不會用到這裡任何東西：index.ts 只有 `SHARE_MODE === 'lan'` 時才 import
 * cookie 外掛、掛 hook、註冊 session 路由。
 *
 * 設計重點：**直連的 loopback（127.0.0.1 / ::1）豁免**。使用者自己的 wallpaper-app
 * 和本機瀏覽器都是 loopback，行為與離線版逐位元組相同；密碼牆與端點限制只作用在
 * 「別台電腦連進來」。
 *
 * 例外：帶 `x-forwarded-for` 的請求不吃豁免（見 isLoopback）——那是經 ngrok／反向
 * 代理進來的，socket 雖是 127.0.0.1 但真正來源在外網。這一條讓「區網＋公網」
 * 同一支 server 成立：啟動器 `scripts/share-serve.mjs` 起 ngrok，隧道進來的流量
 * 照樣過密碼牆。`SHARE_PUBLIC` / `SHARE_PUBLIC_URL` 也由該啟動器帶入。
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
/**
 * 是否同時開了 ngrok 公網通道（由啟動器 `scripts/share-serve.mjs` 設定）。
 * 影響：共用密碼最低長度拉到 8（公網會被暴力破解）。登入限速一律都在。
 */
export const SHARE_PUBLIC = process.env.SHARE_PUBLIC === 'on'
/** 啟動器抓到的 ngrok 公網網址（`https://xxx.ngrok-free.app`，不含路徑）。 */
export const SHARE_PUBLIC_URL = (process.env.SHARE_PUBLIC_URL ?? '').trim()
/** 主牆固定路徑（見 main.tsx）——根路徑 `/` 什麼都不畫，連密碼牆都不顯示，
 *  一定要走這個路徑才進得去。給「分享」QR／複製連結、啟動器主控台印的網址用。 */
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
        '請設定環境變數，或在 share-config.txt 第一行寫密碼後再啟動。',
    )
  }
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

/**
 * loopback 豁免判斷。**帶了 `x-forwarded-for` 的一律不算 loopback**——那是經過
 * ngrok／反向代理進來的請求：ngrok agent 雖然是從本機 `127.0.0.1` 連上這個
 * server，但請求的真正來源在外網。若吃了豁免，整條隧道就繞過密碼牆與端點封鎖，
 * 等於把整面牆（含研究生牆、檔案瀏覽、AI 設定）無密碼攤在網際網路上。
 * 直連的本機 wallpaper-app／瀏覽器不會有這個標頭；區網直連的 IP 本來就非 loopback。
 */
export function isLoopback(req: FastifyRequest): boolean {
  if (req.headers['x-forwarded-for'] != null) return false
  const addr = req.socket.remoteAddress ?? ''
  return LOOPBACK.has(addr)
}

// ── 開放模式：host 手動開關，暫時跳過共用密碼 ───────────────────────────
// 「這面牆本來就給認識的人用，不想每次都要重輸共用密碼」——純記憶體，
// **2026-09 改成預設開**：openAccess 開著時**仍然要求名字＋PIN** 才能進牆
// （見下面 shareAuthHook／`POST /session` 的 openAccess 分支），不是整關直接
// 放行——身分驗證／防冒充沒有一起免掉，只是省了共用密碼那一關，所以預設開
// 的風險比舊版（openAccess 曾經是整關跳過、預設關）低很多。**每次重開 server
// 都會重置回開**——host 想維持要共用密碼，開機後自己到 /host 關掉即可，這個
// 開關只有 host 本人（loopback，見 host-routes.ts）能切換，遠端連 API 都碰不到。
let openAccess = true
export function isOpenAccess(): boolean {
  return openAccess
}
export function setOpenAccess(v: boolean): void {
  openAccess = v
}

// ── 遠端 AI 開關：host 手動控制，可即時切換 ────────────────────────────
// 「遠端能不能用會花錢／連 Ollama 的 AI（搜尋、生成、語意）」——啟動時從
// SHARE_AI 環境變數帶入預設值，之後 host 可在 /host 隨時開關（見
// host-routes.ts）。跟 openAccess 不同的是：**重開 server 會回到環境變數
// 的預設值**，不是固定重置成關——AI 開關通常是「這次分享要不要開」的長期
// 決定，不像「先不要密碼」那種一次性、圖方便的臨時措施。
let shareAiEnabled = process.env.SHARE_AI === 'on'
export function isShareAiEnabled(): boolean {
  return shareAiEnabled
}
export function setShareAiEnabled(v: boolean): void {
  if (shareAiEnabled === v) return
  shareAiEnabled = v
  emitChange('settings') // 牆上要即時顯示「AI 已停用」——推播給所有連著的畫面
}

// ── 登入畫面 3D Logo：host 個人品牌，純裝飾、預設關 ──────────────────────
// 素材（glTF＋貼圖，見 `src/components/LoginLogo3D.tsx`）放在
// `public/branding/`，`.gitignore` 排除、不進版控——是這台機器 host 自己的
// 東西，不是牆本身的功能。**純記憶體、預設關、重開 server 重置回關**：跟
// `openAccess` 一樣的「一次性、圖方便」定位，但關掉的理由不是安全，是體積
// ——這組素材原始檔案 ~30MB，離線用 three.js 的簡化器＋壓縮貼圖處理過後降到
// ~5.6MB（見 LoginLogo3D.tsx 開頭的說明），但仍然不該每個訪客預設都要下載，
// 讓 host 自己決定要不要開。前端只在這個開關為 true 時才 mount
// `<LoginLogo3D/>`，關掉＝完全不會發出任何下載請求、不會佔用 GPU 資源，
// 不是「載入了但藏起來」。
let loginLogo3d = false
export function isLoginLogo3dEnabled(): boolean {
  return loginLogo3d
}
export function setLoginLogo3dEnabled(v: boolean): void {
  loginLogo3d = v
}

/**
 * 給前端 `/api/share-info` 的公開資訊（不需驗證就能拿）。**帶 `req` 是刻意
 * 的**——`loopback` 要照這次連線實際判斷，不是看 server 全域設定：本機
 * wallpaper-app／瀏覽器（loopback）不該吃到任何「遠端」限制（研究生模式、
 * AI 生成便利貼選資料夾…），這些後端本來就只擋非 loopback（見
 * `collectionForRequest`／`shareGuardHook`），前端也要用同一個判斷，不然
 * host 自己在本機都會被誤當成「遠端」而看不到這些功能——這正是曾經發生過
 * 的 bug：`isShare` 原本只看 `mode==='lan'`，沒分本機/遠端，開了共用模式後
 * host 自己用 wallpaper-app 也被連帶鎖住研究生模式。 */
export function shareInfoPayload(req: FastifyRequest): {
  mode: ShareMode
  ai: boolean
  loopback: boolean
  publicUrl?: string
  openAccess?: boolean
  loginLogo3d?: boolean
} {
  return {
    mode: SHARE_MODE,
    ai: SHARE_MODE === 'off' ? true : shareAiEnabled,
    loopback: isLoopback(req),
    ...(SHARE_MODE === 'lan' && SHARE_WALL_URL ? { publicUrl: SHARE_WALL_URL } : {}),
    ...(SHARE_MODE === 'lan' ? { openAccess, loginLogo3d } : {}),
  }
}

// ── 遠端 AI 每日額度 ──────────────────────────────────────────────────
// AI 開關開著才會被打到（見 shareGuardHook 尾端），限的是 /ai/search——真正
// 花 host 錢／額度的那支（語意搜尋是本機 Ollama、不計費，不限）。純記憶體，
// server 重開歸零；預設值刻意保守，開放給不熟的人用時先擋住失控用量。
const SHARE_AI_DAILY_LIMIT = Number(process.env.SHARE_AI_DAILY_LIMIT ?? 30)
let aiUsageDay = ''
let aiUsageCount = 0

function remoteAiSearchAllowed(): boolean {
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
// 公網把 /api/session 攤在外面，4~8 位密碼撐不住不限次數的猜。以來源 IP 記
// 失敗次數：同一 IP 在 15 分鐘內連錯 LOGIN_MAX_FAILS 次就擋 15 分鐘。純記憶體
// （重開 server 歸零）、無相依；本機／區網正常使用撞不到。
const LOGIN_WINDOW_MS = 15 * 60_000
const LOGIN_MAX_FAILS = 10
const loginFails = new Map<string, { n: number; since: number }>()
startSweeper(loginFails, (v) => v.since, LOGIN_WINDOW_MS)

/** 匿名使用者用來區分「不同人」的 key（presence.ts 需要——具名使用者直接用
 *  名字當 key 就夠了，匿名的話光憑空字串分不出是誰，退而求其次用來源 IP）。 */
export function clientIp(req: FastifyRequest): string {
  const xff = String(req.headers['x-forwarded-for'] ?? '')
    .split(',')[0]
    ?.trim()
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
// 遠端每個非 GET 請求都算一次；同一 IP 一分鐘超過 WRITE_MAX 次就擋。這道很
// 寬鬆——正常手動操作（含批次新增 50 則那種「一次請求」）完全撞不到，抓的是
// 跑腳本／失控迴圈狂打 API 把 .sticky_notes.json 洗爆、版本快照灌爆的情況。
// /api/session 有自己更嚴的限速（見上面），不重複算在這裡。
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
 * `/api/session`（登入本身）、非 `/api`、非 `/note-images`、非
 * `/thesis-note-images` 的路徑（SPA 殼 + 靜態資源，這樣沒登入的人也拿得到
 * 登入畫面）、`/api/share-info`（前端要靠它決定 UI）。**`/thesis-note-images`
 * 要跟 `/note-images` 吃同一層保護**——2026-09 研究生插圖搬到自己的資料夾、
 * 自己的路由（見 index.ts）之後才新增的路徑，忘了補進這個判斷式的話，遠端
 * 不用密碼就能直接猜檔名撈研究生便利貼的圖，等於悄悄開了一個繞過密碼牆的洞。
 *
 * **開放模式（openAccess）只免共用密碼，不免身分驗證**——使用者仍要用名字＋
 * PIN 登入過（見 `POST /session` 的 openAccess 分支），才會有這裡認的
 * `identity_session` cookie。不這樣的話，開放模式等於任何人都能完全匿名、
 * 甚至連 `x-note-author` 標頭都亂填就進牆發文，開放模式的用意是「省掉共用
 * 密碼這一關給信任的人臨時用」，不是連身分認證、防冒充都一起省掉。
 */
export async function shareAuthHook(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (isLoopback(req)) return
  const path = req.url.split('?')[0]
  if (path === '/api/session' || path === '/api/share-info') return
  if (
    !path.startsWith('/api/') &&
    !path.startsWith('/note-images/') &&
    !path.startsWith('/thesis-note-images/')
  ) {
    return
  }
  if (openAccess) {
    if (verifyIdentityToken(req.cookies?.[IDENTITY_COOKIE])) return
    await reply.code(401).send({ error: '開放模式仍需要輸入名字＋PIN 才能進牆', needAuth: true })
    return
  }
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

  // 寫入限速——/api/session 自己有更嚴的，不重複算。
  if (method !== 'GET' && path !== '/api/session' && writeRateLimited(clientIp(req))) {
    return void reply.code(429).send({ error: '寫入太頻繁，請稍等一下再試' })
  }
  // 權限分級——host 在 /host 把某個已註冊名字設成唯讀（viewer）就擋掉所有
  // 非 GET 請求；匿名／沒被特別設過的人一律當 editor（見 people.ts 的
  // getPersonRole）。/api/session 要放行，不然連自己的角色/登入狀態都查不到。
  if (method !== 'GET' && path !== '/api/session' && getPersonRole(authorFrom(req)) === 'viewer') {
    return void reply.code(403).send({ error: '唯讀身分，不能編輯' })
  }
  // 遠端 AI 每日額度——只限真的花 host 錢／額度的 /ai/search。
  if (path === '/api/ai/search' && shareAiEnabled && !remoteAiSearchAllowed()) {
    return void reply.code(429).send({ error: '今天的共用 AI 額度用完了，明天再試（host 設定的每日上限）' })
  }

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
  if (!shareAiEnabled && path.startsWith('/api/ai/')) {
    return void reply.code(403).send({ error: '共用模式下停用 AI 功能' })
  }
}

/** `/api/session` 登入 / 查詢 / 登出。註冊在 `/api` prefix 底下。 */
export const shareSessionRoutes: FastifyPluginAsync = async (app) => {
  // loopback——永遠有權限，不然 AppGate 會把它擋在密碼牆外。開放模式不再自動
  // 給權限：要看有沒有效的 identity_session（見下面 POST 的 openAccess 分支、
  // shareAuthHook 同一條規則）——身分驗證跟「要不要共用密碼」分開判斷。
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
            // 開放模式不用密碼，一般模式才要求非空——required 拿掉，改在下面
            // 依 openAccess 分別驗證，schema 這層只管型別/長度。
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
        // 開放模式：免共用密碼，但名字＋PIN 是必填，不能留空匿名進牆——這正是
        // 這個模式存在的重點，省掉密碼這一關，身分驗證／防冒充不能一起省掉。
        // claimOrVerify() 本來就會要求非空名字一定要給對 PIN（新名字順便註冊、
        // 舊名字要對得上），這裡只是額外擋掉「名字留空」這條路。
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
        // 開放模式下沒有「共用密碼」這回事，不用發 share_session——identity
        // cookie 本身就是進牆憑證，shareAuthHook 的 openAccess 分支只看這個。
        reply.setCookie(IDENTITY_COOKIE, identityToken(name), cookieOpts)
        return { ok: true, name }
      }

      if (!passwordValid(req.body.password)) {
        noteLoginFail(ip)
        return reply.code(401).send({ error: '密碼不對' })
      }
      // 密碼對了，才看身分——名字被 PIN 保護時要對得上，錯了也算一次失敗
      // （不然有共用密碼的人可以無限次試別人的 PIN）。
      const claim = claimOrVerify(req.body.name ?? '', req.body.pin ?? '')
      if (!claim.ok) {
        noteLoginFail(ip)
        return reply.code(401).send({ error: claim.error ?? 'PIN 不對' })
      }
      loginFails.delete(ip)
      // 經 ngrok（HTTPS）進來的才發 secure cookie；區網 HTTP 發了會被瀏覽器丟掉。
      const viaHttps = req.headers['x-forwarded-proto'] === 'https'
      const cookieOpts = { httpOnly: true, sameSite: 'lax' as const, path: '/', secure: viaHttps }
      // 不給 maxAge/expires＝session cookie，瀏覽器關掉就失效——「每次連線都要
      // 重新驗證密碼」靠的就是這個，不是額外的伺服器端邏輯。
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
