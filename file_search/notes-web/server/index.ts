import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import fastifyCookie from '@fastify/cookie'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  listNotes,
  noteImagesDir,
  notesFilePath,
  projectRoot,
  pruneTrash,
  setActiveCollection,
} from './store'
import { notesRoutes } from './notes'
import { noteImageRoutes } from './note-image-routes'
import { aiRoutes } from './ai-routes'
import { filesRoutes } from './files-routes'
import {
  SHARE_MODE,
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
app.get('/api/share-info', async () => shareInfoPayload())

// 「研究生模式」——前端在每個 /api 請求帶 `x-note-collection: life|thesis`，
// 這裡在請求一進來就設定好 store 這一輪要動哪一份便利貼（生活 or 論文專案）。
// store 全是同步 IO，同一個 handler 內不會被別的請求插隊，所以 module 變數安全。
// 沒帶標頭（Node-RED、舊前端）一律當生活便利貼；共用模式下遠端一律鎖生活牆。
app.addHook('onRequest', async (req) => {
  setActiveCollection(collectionForRequest(req))
})

app.log.info(`便利貼資料檔：${notesFilePath}`)
if (existsSync(notesFilePath)) {
  app.log.info(`目前 ${listNotes().length} 則（跟桌面版共用這一份，改動會互相看到）`)
  try {
    const n = pruneTrash() // 啟動時清一次垃圾桶（過期／超量的最舊那批永久刪）
    if (n > 0) app.log.info(`垃圾桶自動清理：永久刪除 ${n} 則`)
  } catch (err) {
    app.log.warn({ err }, '垃圾桶自動清理失敗（不影響啟動）')
  }
} else {
  app.log.warn('資料檔還不存在——第一次新增便利貼時會建立')
}

await app.register(notesRoutes, { prefix: '/api' })
await app.register(noteImageRoutes, { prefix: '/api' })
await app.register(aiRoutes, { prefix: '/api' })
await app.register(filesRoutes, { prefix: '/api' })

// 便利貼插圖的靜態目錄——note.image 存的是檔名，前端用 /note-images/<檔名> 取。
// decorateReply:false：下面 prod 的 dist 靜態要用 reply.sendFile，裝飾器只能加一次。
if (!existsSync(noteImagesDir)) mkdirSync(noteImagesDir, { recursive: true })
await app.register(fastifyStatic, {
  root: noteImagesDir,
  prefix: '/note-images/',
  decorateReply: false,
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
      const urls = lanAddresses().map((ip) => `    http://${ip}:${PORT}`)
      app.log.info(
        `\n  LAN share URL (give this to other people on your Wi-Fi/LAN):\n` +
          `${urls.join('\n') || '    (no LAN address found)'}\n` +
          `  If Windows Firewall asks, choose "Allow access".`,
      )
    }
  })
  .catch((err) => {
    app.log.error(err)
    process.exit(1)
  })
