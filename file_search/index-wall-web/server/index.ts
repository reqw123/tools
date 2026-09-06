import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { indexDir, listIndexes, projectRoot } from './store'
import { routes } from './routes'
import { aiRoutes } from './ai-routes'

const PORT = Number(process.env.API_PORT ?? 8788)
const isProd = process.env.NODE_ENV === 'production'

const app = Fastify({ logger: true })

app.log.info(`索引集目錄：${indexDir}`)
if (existsSync(indexDir)) {
  app.log.info(`找到 ${listIndexes().length} 份 .md 索引集`)
} else {
  app.log.warn('索引集目錄不存在——確認 ../indexes 或設定 INDEX_DIR')
}

await app.register(routes, { prefix: '/api' })
await app.register(aiRoutes, { prefix: '/api' })

if (isProd) {
  const dist = join(projectRoot, 'dist')
  await app.register(fastifyStatic, { root: dist, wildcard: false })
  app.setNotFoundHandler((req, reply) => {
    if (req.raw.url?.startsWith('/api/')) return reply.code(404).send({ error: 'not found' })
    return reply.sendFile('index.html')
  })
}

// 這個 app 能 shell 出 explorer 開任意本機路徑，只綁 loopback，不對區網開放。
app
  .listen({ port: PORT, host: '127.0.0.1' })
  .then(() => app.log.info(`API listening on http://localhost:${PORT}`))
  .catch((err) => {
    app.log.error(err)
    process.exit(1)
  })
