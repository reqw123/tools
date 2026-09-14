import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { indexDir, listIndexes, projectRoot } from './store'
import { routes } from './routes'
import { aiRoutes } from './ai-routes'
import {
  SHARE_MODE,
  SHARE_PUBLIC_URL,
  WALL_PATH,
  assertShareConfig,
  lanAddresses,
  shareAuthHook,
  shareGuardHook,
  shareInfoPayload,
  shareSessionRoutes,
} from './share'
import { eventsRoutes } from './events'
import { activityRoutes } from './activity-routes'
import { hostRoutes } from './host-routes'
import { uploadRoutes } from './upload-routes'

// lan 模式但沒給（有效）SHARE_TOKEN → 啟動時就擋下來，不要開一個沒鎖的門。
assertShareConfig()

const PORT = Number(process.env.API_PORT ?? 8788)
const isProd = process.env.NODE_ENV === 'production'

const app = Fastify({ logger: true })

app.log.info(`索引集目錄：${indexDir}`)
if (existsSync(indexDir)) {
  app.log.info(`找到 ${listIndexes().length} 份 .md 索引集`)
} else {
  app.log.warn('索引集目錄不存在——確認 ../indexes 或設定 INDEX_DIR')
}

// ── 區網／公網共用模式（見 server/share.ts）───────────────────────────
// 離線版（SHARE_MODE 未設）完全不會走到這裡任何一行——app 物件不會被碰。
if (SHARE_MODE === 'lan') {
  const { default: fastifyCookie } = await import('@fastify/cookie')
  await app.register(fastifyCookie)
  app.addHook('onRequest', shareAuthHook)
  app.addHook('onRequest', shareGuardHook)
  await app.register(shareSessionRoutes, { prefix: '/api' })
  // 活動記錄／在場提示／後台管理——只有共用模式才有意義，離線版完全用不到，
  // 也不該讓離線的人不小心連到 /host 就寫進 `.share/people.json`（見
  // 「低耦合」的教訓：以前這三支不管模式都會註冊，連線追蹤 recordVisit()
  // 就這樣把 `.share/visits.json` 寫進了離線版真正在用的 indexes/ 資料夾）。
  await app.register(activityRoutes, { prefix: '/api' })
  await app.register(hostRoutes, { prefix: '/api' })
}

// 給前端 `/api/share-info` 的公開資訊——off/lan 模式都要有，不需驗證。
app.get('/api/share-info', async (req) => shareInfoPayload(req))

// SSE 本身離線也要有——桌面版寫的檔案變動要能推給同時開著的網頁（見
// events.ts 開頭說明）。但「這條連線算誰連上了」的追蹤（connections.ts /
// visits.ts）只在 SHARE_MODE==='lan' 時才會做，見 events.ts 裡的判斷。
await app.register(eventsRoutes, { prefix: '/api' })
await app.register(routes, { prefix: '/api' })
await app.register(aiRoutes, { prefix: '/api' })
// 上傳檔案加進索引——遠端使用者的「加入索引」替代路徑，見 upload-routes.ts
// 開頭說明。跟其他項目增刪改端點一樣一視同仁註冊，不特別鎖共用模式。
await app.register(uploadRoutes, { prefix: '/api' })

if (isProd) {
  const dist = join(projectRoot, 'dist')
  await app.register(fastifyStatic, { root: dist, wildcard: false })
  app.setNotFoundHandler((req, reply) => {
    if (req.raw.url?.startsWith('/api/')) return reply.code(404).send({ error: 'not found' })
    return reply.sendFile('index.html')
  })
}

// 離線／單機模式下這個 app 能 shell 出 explorer、開任意本機路徑，只綁
// loopback，不對區網開放（見 store.ts 的 /open、/browse、/scan 等）。
// 共用模式下放寬到所有介面——`shareGuardHook` 把這幾支危險端點另外擋掉
// （即使密碼登入了也只認 loopback，見 share.ts 開頭說明），其餘端點才交給
// 密碼牆／身分驗證把關。**多人牆閘道啟動時例外**——`SHARE_BEHIND_GATEWAY`
// 會強制綁回 127.0.0.1：這種情況下對外開放的是閘道，不是這支後端本身，
// 閘道會把所有流量轉進來，這裡直接對區網開放反而多開一個沒有閘道那層
// loopback 判斷保護的後門。
const host =
  SHARE_MODE === 'lan' && process.env.SHARE_BEHIND_GATEWAY !== '1' ? '0.0.0.0' : '127.0.0.1'
app
  .listen({ port: PORT, host })
  .then(() => {
    if (process.env.SHARE_BEHIND_GATEWAY === '1') {
      // 多人牆閘道會印自己的、唯一正確的網址（見 share-gateway/serve.mjs）。
      // 這裡如果照下面那段印「區網：http://<ip>:PORT/wall」會誤導——這支
      // 後端已經改綁 127.0.0.1，那個網址其實連不進來，只會讓使用者混淆該用
      // 哪一個。
      app.log.info(`共用模式（lan，閘道模式）：只接受來自閘道的連線`)
    } else if (SHARE_MODE === 'lan') {
      app.log.info(`共用模式（lan）：密碼牆已啟用`)
      for (const ip of lanAddresses()) app.log.info(`  區網：http://${ip}:${PORT}${WALL_PATH}`)
      if (SHARE_PUBLIC_URL) app.log.info(`  公網：${SHARE_PUBLIC_URL}${WALL_PATH}`)
    } else {
      app.log.info(`API listening on http://localhost:${PORT}`)
    }
  })
  .catch((err) => {
    app.log.error(err)
    process.exit(1)
  })
