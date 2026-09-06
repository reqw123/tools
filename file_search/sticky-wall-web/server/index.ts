import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { listNotes, noteImagesDir, notesFilePath, projectRoot } from './store'
import { notesRoutes } from './notes'
import { noteImageRoutes } from './note-image-routes'
import { aiRoutes } from './ai-routes'
import { filesRoutes } from './files-routes'

const PORT = Number(process.env.API_PORT ?? 8787)
const isProd = process.env.NODE_ENV === 'production'

const app = Fastify({ logger: true })

app.log.info(`便利貼資料檔：${notesFilePath}`)
if (existsSync(notesFilePath)) {
  app.log.info(`目前 ${listNotes().length} 則（跟桌面版共用這一份，改動會互相看到）`)
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
  .listen({ port: PORT, host: '0.0.0.0' })
  .then(() => app.log.info(`API listening on http://localhost:${PORT}`))
  .catch((err) => {
    app.log.error(err)
    process.exit(1)
  })
