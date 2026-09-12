import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import fastifyCookie from '@fastify/cookie'
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import {
  imageMimeType,
  listNotes,
  migrateLegacyDataLayout,
  noteImagesDir,
  notesFilePath,
  projectRoot,
  pruneTrash,
  setActiveCollection,
  thesisImagesDir,
} from './store'
import { notesRoutes } from './notes'
import { notificationsRoutes } from './notifications-routes'
import { startDueNotifier } from './due-notify'
import { noteImageRoutes } from './note-image-routes'
import { aiRoutes } from './ai-routes'
import { filesRoutes } from './files-routes'
import { eventsRoutes } from './events'
import { activityRoutes } from './activity-routes'
import { hostRoutes } from './host-routes'
import {
  SHARE_MODE,
  SHARE_WALL_URL,
  WALL_PATH,
  assertShareConfig,
  collectionForRequest,
  lanAddresses,
  shareAuthHook,
  shareGuardHook,
  shareInfoPayload,
  shareSessionRoutes,
} from './share'

const PORT = Number(process.env.API_PORT ?? 8787)
// 綁定位址——預設 0.0.0.0（＝一直以來的行為，Node-RED 等區網呼叫靠這個）。
// 謹慎的單機使用者可設 API_HOST=127.0.0.1。
const HOST = process.env.API_HOST ?? '0.0.0.0'
const isProd = process.env.NODE_ENV === 'production'

assertShareConfig() // SHARE_MODE=lan 但沒 SHARE_TOKEN → 這裡就丟錯，不開沒鎖的門

const app = Fastify({ logger: true })

// 「區網共用模式」——只有 SHARE_MODE=lan 時掛上密碼牆 + 危險端點封鎖。
// loopback（本機 wallpaper-app／瀏覽器）一律豁免，行為與離線版相同。見 server/share.ts。
if (SHARE_MODE === 'lan') {
  await app.register(fastifyCookie)
  app.addHook('onRequest', shareAuthHook)
  app.addHook('onRequest', shareGuardHook)
  await app.register(shareSessionRoutes, { prefix: '/api' })
  // ASCII only：這行會出現在使用者可見的 .bat 主控台（中文在 cp950 主控台會變亂碼）。
  app.log.info('LAN share mode ON - password wall active (loopback exempt)')
}

// 前端靠這支決定要不要顯示密碼牆、隱藏哪些功能。不需驗證。
app.get('/api/share-info', async (req) => shareInfoPayload(req))

// 「研究生模式」——前端在每個 /api 請求帶 `x-note-collection: life|thesis`，
// 這裡在請求一進來就設定好 store 這一輪要動哪一份便利貼（生活 or 論文專案）。
// `setActiveCollection()` 底層是 AsyncLocalStorage（見 store.ts），同一個
// request 的整條 async 呼叫鏈（含圖片上傳那種真的有 await 的路徑）看到的都是
// 自己這裡設定的值，不會被併發的其他 request 互相干擾。
// 沒帶標頭（Node-RED、舊前端）一律當生活便利貼；共用模式下遠端一律鎖生活牆。
app.addHook('onRequest', async (req) => {
  setActiveCollection(collectionForRequest(req))
})

// 一次性資料搬家——研究生資料從論文專案資料夾搬進 indexes/.thesis/、共用牆
// 的看板／身分／訪客紀錄從根目錄搬進 .share/（見 store.ts 開頭的說明）。
// 要在任何路由掛上、任何人存取資料之前跑，只搬「新位置還沒有」的東西，
// 已經搬過或新裝的環境呼叫了也不會做任何事。
try {
  migrateLegacyDataLayout()
} catch (err) {
  app.log.warn({ err }, '資料搬家檢查失敗（不影響啟動，舊資料還在原位置）')
}

// STICKY_NOTES_FILE 有設 = 這一輪是公用牆啟動器（改指到 public-wall-data/，
// 見 scripts/share-serve.mjs／兩個 .bat）——跟桌面版是兩份完全獨立的資料，
// 不要在 log 裡誤導成「共用這一份」。
const usesCustomNotesFile = !!process.env.STICKY_NOTES_FILE
app.log.info(`便利貼資料檔：${notesFilePath}`)
if (existsSync(notesFilePath)) {
  app.log.info(
    usesCustomNotesFile
      ? `目前 ${listNotes().length} 則（這份跟桌面版／wallpaper-app 是分開的，互相看不到）`
      : `目前 ${listNotes().length} 則（跟桌面版共用這一份，改動會互相看到）`,
  )
  try {
    const n = pruneTrash() // 啟動時清一次垃圾桶（過期／超量的最舊那批永久刪）
    if (n > 0) app.log.info(`垃圾桶自動清理：永久刪除 ${n} 則`)
  } catch (err) {
    app.log.warn({ err }, '垃圾桶自動清理失敗（不影響啟動）')
  }
} else {
  app.log.warn('資料檔還不存在——第一次新增便利貼時會建立')
}

// 指派給你的便利貼快到期／已逾期了——定期掃描、發站內通知（見 due-notify.ts）。
startDueNotifier()

await app.register(eventsRoutes, { prefix: '/api' })
await app.register(activityRoutes, { prefix: '/api' })
await app.register(hostRoutes, { prefix: '/api' })
await app.register(notesRoutes, { prefix: '/api' })
await app.register(notificationsRoutes, { prefix: '/api' })
await app.register(noteImageRoutes, { prefix: '/api' })
await app.register(aiRoutes, { prefix: '/api' })
await app.register(filesRoutes, { prefix: '/api' })

// 便利貼插圖的靜態目錄——note.image 存的是檔名，前端用 /note-images/<檔名> 取。
// decorateReply:false：下面 prod 的 dist 靜態要用 reply.sendFile，裝飾器只能加一次。
// 這是**生活便利貼**的圖，@fastify/static 的 root 在這裡就固定死了——生活牆
// 的圖片資料夾（indexes/ 或 public-wall-data/ 底下）本來就不會在執行期改變，
// 綁死沒問題。
if (!existsSync(noteImagesDir)) mkdirSync(noteImagesDir, { recursive: true })
await app.register(fastifyStatic, {
  root: noteImagesDir,
  prefix: '/note-images/',
  decorateReply: false,
})

// **研究生便利貼**的圖——不能比照上面用 @fastify/static：論文專案資料夾
// （`thesisImagesDir()` 依賴的 `thesisProjectDir` 設定）可以在全域設定裡
// 隨時改，但 @fastify/static 的 root 是註冊當下就固定的，改了設定也不會
// 跟著換路徑。改用一般路由、每次請求當場重新算 `thesisImagesDir()`，才會
// 跟著最新設定走。前端 `noteImageUrl()` 依目前作用中的集合決定要打
// `/note-images/` 還是這裡。
app.get<{ Params: { filename: string } }>('/thesis-note-images/:filename', async (req, reply) => {
  const safe = basename(req.params.filename) // 擋掉 ../ 之類的路徑穿越
  const path = join(thesisImagesDir(), safe)
  let st
  try {
    st = statSync(path)
  } catch {
    return reply.code(404).send({ error: '找不到圖片' })
  }
  if (!st.isFile()) return reply.code(404).send({ error: '找不到圖片' })
  reply.type(imageMimeType(safe))
  return reply.send(createReadStream(path))
})

// 正式環境：同一個 server 也負責吐 vite build 出來的前端。
if (isProd) {
  const dist = join(projectRoot, 'dist')
  await app.register(fastifyStatic, { root: dist, wildcard: false })
  app.setNotFoundHandler((req, reply) => {
    if (req.raw.url?.startsWith('/api/')) return reply.code(404).send({ error: 'not found' })
    return reply.sendFile('index.html')
  })
}

app
  .listen({ port: PORT, host: HOST })
  .then(() => {
    app.log.info(`API listening on http://localhost:${PORT}`)
    if (SHARE_MODE === 'lan') {
      // ASCII only：這段是使用者要照著唸給別人的網址，會出現在 .bat 主控台。
      // 根路徑 `/` 什麼都不畫（見 main.tsx）——一定要帶 WALL_PATH 才進得去牆。
      const urls = lanAddresses().map((ip) => `    http://${ip}:${PORT}${WALL_PATH}`)
      app.log.info(
        `\n  LAN share URL (give this to other people on your Wi-Fi/LAN):\n` +
          `${urls.join('\n') || '    (no LAN address found)'}\n` +
          `  If Windows Firewall asks, choose "Allow access".`,
      )
      if (SHARE_WALL_URL) {
        // ASCII only: this prints to the user-visible .bat console.
        app.log.info(
          `\n  PUBLIC share URL (ngrok - works from anywhere on the internet):\n` +
            `    ${SHARE_WALL_URL}\n` +
            `  First visit on each device shows an ngrok page - click "Visit Site".`,
        )
      }
    }
  })
  .catch((err) => {
    app.log.error(err)
    process.exit(1)
  })
