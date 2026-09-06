import type { FastifyPluginAsync } from 'fastify'
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { extname, isAbsolute, join } from 'node:path'
import { getNote, noteImagesDir, setNoteImage } from './store'
import { dropThumbs, isThumbWidth, openThumb, resolveThumb } from './note-thumb'

/**
 * 便利貼插圖——挑一張本機圖片「複製」進 `noteImagesDir`，便利貼只記檔名
 * （見 store.ts 的 `Note.image`）。這個 server 本來就能 stat／讀任意路徑
 * （`files-routes.ts` 的瀏覽／掃描、`ai_bridge` 的內容擷取都要），複製一份
 * 進自己的資料夾沒有跨出既有的信任邊界。
 *
 * 目前**不做降尺寸**（不加 sharp 相依），改用大小上限擋——太大的圖請使用者
 * 自己先縮。之後要真的縮圖再把這裡換成 sharp。
 */

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'])
const MAX_BYTES = 8 * 1024 * 1024

export const noteImageRoutes: FastifyPluginAsync = async (app) => {
  // 牆用的縮圖——見 note-thumb.ts。掛在 /api 底下（這個 plugin 的 prefix）而
  // 不是跟原圖一樣的 /note-images/，這樣 Vite dev 的 `/api` proxy 直接涵蓋，
  // 也不會跟 @fastify/static 的 /note-images/ 萬用路由撞。
  app.get<{ Params: { name: string }; Querystring: { w?: string } }>(
    '/note-thumb/:name',
    async (req, reply) => {
      const w = Number(req.query.w)
      if (!isThumbWidth(w)) {
        return reply.code(400).send({ error: 'w 必須是 400 或 800' })
      }
      const path = await resolveThumb(req.params.name, w)
      if (!path) return reply.code(404).send({ error: '找不到圖片或無法縮圖' })
      // 換圖會產生新檔名 → 新 URL，所以同一個 URL 的內容不會變，可以放心長快取。
      reply.header('Cache-Control', 'public, max-age=604800')
      reply.type('image/webp')
      return reply.send(openThumb(path))
    },
  )

  app.post<{ Params: { id: string }; Body: { srcPath?: string } }>(
    '/notes/:id/image',
    {
      schema: {
        body: {
          type: 'object',
          required: ['srcPath'],
          properties: { srcPath: { type: 'string', minLength: 1, maxLength: 4096 } },
        },
      },
    },
    async (req, reply) => {
      const note = getNote(req.params.id)
      if (!note) return reply.code(404).send({ error: '便利貼不存在' })

      const src = req.body.srcPath ?? ''
      if (!isAbsolute(src)) return reply.code(400).send({ error: '請提供絕對路徑' })
      const ext = extname(src).toLowerCase()
      if (!IMAGE_EXT.has(ext)) {
        return reply.code(400).send({ error: `不支援的圖片格式（${ext || '無副檔名'}）` })
      }
      let st
      try {
        st = statSync(src)
      } catch {
        return reply.code(400).send({ error: '找不到這個檔案' })
      }
      if (!st.isFile()) return reply.code(400).send({ error: '這不是一個檔案' })
      if (st.size > MAX_BYTES) {
        return reply
          .code(413)
          .send({ error: `圖片太大（${(st.size / 1048576).toFixed(1)}MB），上限 8MB，請先自行縮小` })
      }

      if (!existsSync(noteImagesDir)) mkdirSync(noteImagesDir, { recursive: true })
      // 檔名帶時間戳：換圖會產生新檔名 → URL 跟著變 → 瀏覽器快取自然失效，
      // 不用另外做 cache-busting。
      const filename = `${note.id}-${Date.now()}${ext}`
      try {
        copyFileSync(src, join(noteImagesDir, filename))
      } catch (err) {
        return reply.code(500).send({ error: `複製圖片失敗：${(err as Error).message}` })
      }

      const oldImage = note.image
      const updated = setNoteImage(note.id, filename)
      if (!updated) {
        rmSync(join(noteImagesDir, filename), { force: true })
        return reply.code(404).send({ error: '便利貼在儲存前被刪除了' })
      }
      if (oldImage && oldImage !== filename) {
        rmSync(join(noteImagesDir, oldImage), { force: true })
        dropThumbs(oldImage)
      }
      return { note: updated }
    },
  )

  app.delete<{ Params: { id: string } }>('/notes/:id/image', async (req, reply) => {
    const note = getNote(req.params.id)
    if (!note) return reply.code(404).send({ error: '便利貼不存在' })
    const oldImage = note.image
    const updated = setNoteImage(note.id, '')
    if (!updated) return reply.code(404).send({ error: '便利貼不存在' })
    if (oldImage) {
      rmSync(join(noteImagesDir, oldImage), { force: true })
      dropThumbs(oldImage)
    }
    return { note: updated }
  })
}
