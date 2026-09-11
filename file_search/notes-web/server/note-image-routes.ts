import type { FastifyPluginAsync } from 'fastify'
import multipart from '@fastify/multipart'
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { extname, isAbsolute, join } from 'node:path'
import sharp from 'sharp'
import { activeImagesDir, getNote, noteImagesDir, setNoteImage, thesisImagesDir, type Note } from './store'
import { dropThumbs, isThumbWidth, openThumb, resolveThumb } from './note-thumb'

/**
 * 便利貼插圖。兩條進來的路：
 *
 * 1. **本機路徑**（離線版／loopback）——`POST /notes/:id/image` 帶 JSON `{ srcPath }`，
 *    `copyFileSync` 原樣複製進 `noteImagesDir`。server 本來就能讀任意路徑
 *    （`files-routes.ts` 的瀏覽／掃描、`ai_bridge` 的內容擷取都要），沒跨出既有信任邊界。
 * 2. **上傳**（區網共用模式）——同一個端點收 `multipart/form-data`，檔案 bytes 進 buffer，
 *    過 `sharp`（吃 EXIF 方位、長邊上限、去中繼資料、重新編碼）再落地。共用模式的
 *    guard（`server/share.ts`）會把非 loopback 的 srcPath 分支擋掉，只留上傳。
 *
 * 便利貼只記檔名（見 store.ts 的 `Note.image`）。
 */

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'])
const MAX_BYTES = 8 * 1024 * 1024
/** 上傳圖片重新編碼時的長邊上限。 */
const MAX_DIM = 2400
/** sharp 能吃輸入、也值得重新編碼的格式；其餘（gif 動畫／bmp）原樣落地。 */
const SHARP_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp'])

/** 換圖的共用尾段：落地新檔、更新便利貼、清掉舊圖與其縮圖。 */
type CommitResult = { ok: true; note: Note } | { ok: false; code: number; error: string }

function commitNoteImage(noteId: string, ext: string, write: (dest: string) => void): CommitResult {
  // activeImagesDir()——生活/研究生各自的資料夾，不是寫死的 noteImagesDir。
  const dir = activeImagesDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  // 檔名帶時間戳：換圖 → 新檔名 → URL 跟著變 → 瀏覽器快取自然失效。
  const filename = `${noteId}-${Date.now()}${ext}`
  const dest = join(dir, filename)
  try {
    write(dest)
  } catch (err) {
    return { ok: false, code: 500, error: `寫入圖片失敗：${(err as Error).message}` }
  }
  const note = getNote(noteId)
  const oldImage = note?.image
  const updated = setNoteImage(noteId, filename)
  if (!updated) {
    rmSync(dest, { force: true })
    return { ok: false, code: 404, error: '便利貼在儲存前被刪除了' }
  }
  if (oldImage && oldImage !== filename) {
    rmSync(join(dir, oldImage), { force: true })
    dropThumbs(oldImage, dir)
  }
  return { ok: true, note: updated }
}

/** 上傳來的 buffer → 過 sharp（可以的話）→ 落地。 */
async function finalizeUploadedImage(
  noteId: string,
  buf: Buffer,
  ext: string,
): Promise<CommitResult> {
  if (buf.length > MAX_BYTES) {
    return {
      ok: false,
      code: 413,
      error: `圖片太大（${(buf.length / 1048576).toFixed(1)}MB），上限 8MB`,
    }
  }
  let outBuf = buf
  if (SHARP_EXT.has(ext)) {
    try {
      let img = sharp(buf, { failOn: 'none' }).rotate() // rotate() 依 EXIF 轉正、順帶去掉 EXIF
      const meta = await img.metadata()
      if ((meta.width ?? 0) > MAX_DIM || (meta.height ?? 0) > MAX_DIM) {
        img = img.resize({ width: MAX_DIM, height: MAX_DIM, fit: 'inside', withoutEnlargement: true })
      }
      if (ext === '.png') img = img.png({ compressionLevel: 9 })
      else if (ext === '.webp') img = img.webp({ quality: 85 })
      else img = img.jpeg({ quality: 85 })
      outBuf = await img.toBuffer()
    } catch {
      return { ok: false, code: 400, error: '圖片檔壞掉或不是有效影像' }
    }
  }
  return commitNoteImage(noteId, ext, (dest) => writeFileSync(dest, outBuf))
}

export const noteImageRoutes: FastifyPluginAsync = async (app) => {
  // 只有這個 plugin 底下的路由需要吃 multipart（換圖上傳）。
  await app.register(multipart, { limits: { fileSize: MAX_BYTES, files: 1 } })

  // 牆用的縮圖——見 note-thumb.ts。掛在 /api 底下（這個 plugin 的 prefix）而
  // 不是跟原圖一樣的 /note-images/，這樣 Vite dev 的 `/api` proxy 直接涵蓋，
  // 也不會跟 @fastify/static 的 /note-images/ 萬用路由撞。
  //
  // `collection` 查詢參數（不是走 `x-note-collection` 標頭那套）：這支路由
  // 是給 `<img src>` 直接載入的，瀏覽器載圖片不會帶自訂標頭，`activeCollection`
  // 在這種請求裡永遠只會是 header 不存在時的預設值（生活）——研究生便利貼
  // 的縮圖一定要靠 URL 本身（query string）帶出「這張是研究生的」，不能倚賴
  // 標頭，前端 `noteThumbUrl()` 組 URL 時會補上這個參數。
  app.get<{ Params: { name: string }; Querystring: { w?: string; collection?: string } }>(
    '/note-thumb/:name',
    async (req, reply) => {
      const w = Number(req.query.w)
      if (!isThumbWidth(w)) {
        return reply.code(400).send({ error: 'w 必須是 400 或 800' })
      }
      const dir = req.query.collection === 'thesis' ? thesisImagesDir() : noteImagesDir
      const path = await resolveThumb(req.params.name, w, dir)
      if (!path) return reply.code(404).send({ error: '找不到圖片或無法縮圖' })
      // 換圖會產生新檔名 → 新 URL，所以同一個 URL 的內容不會變，可以放心長快取。
      reply.header('Cache-Control', 'public, max-age=604800')
      reply.type('image/webp')
      return reply.send(openThumb(path))
    },
  )

  // 換圖——multipart（上傳）走 sharp；JSON `{ srcPath }`（本機路徑）走 copyFileSync。
  // 沒有 body schema：兩種 content-type 都要收，改在 handler 內各自驗。
  app.post<{ Params: { id: string }; Body: { srcPath?: string } }>(
    '/notes/:id/image',
    async (req, reply) => {
      const note = getNote(req.params.id)
      if (!note) return reply.code(404).send({ error: '便利貼不存在' })

      if (req.isMultipart()) {
        let part
        try {
          part = await req.file()
        } catch {
          return reply.code(413).send({ error: `圖片太大，上限 8MB` })
        }
        if (!part) return reply.code(400).send({ error: '沒有收到檔案' })
        const ext = extname(part.filename || '').toLowerCase()
        if (!IMAGE_EXT.has(ext)) {
          return reply.code(400).send({ error: `不支援的圖片格式（${ext || '無副檔名'}）` })
        }
        let buf: Buffer
        try {
          buf = await part.toBuffer()
        } catch {
          return reply.code(413).send({ error: `圖片太大，上限 8MB` })
        }
        const r = await finalizeUploadedImage(note.id, buf, ext)
        if (!r.ok) return reply.code(r.code).send({ error: r.error })
        return { note: r.note }
      }

      // ── 本機路徑（離線版／loopback）───────────────────────────────
      const src = req.body?.srcPath ?? ''
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
      // TODO: 本機路徑目前原樣複製、不過 sharp；要縮圖／去 EXIF 再改走 finalizeUploadedImage。
      const r = commitNoteImage(note.id, ext, (dest) => copyFileSync(src, dest))
      if (!r.ok) return reply.code(r.code).send({ error: r.error })
      return { note: r.note }
    },
  )

  app.delete<{ Params: { id: string } }>('/notes/:id/image', async (req, reply) => {
    const note = getNote(req.params.id)
    if (!note) return reply.code(404).send({ error: '便利貼不存在' })
    const oldImage = note.image
    const updated = setNoteImage(note.id, '')
    if (!updated) return reply.code(404).send({ error: '便利貼不存在' })
    if (oldImage) {
      const dir = activeImagesDir()
      rmSync(join(dir, oldImage), { force: true })
      dropThumbs(oldImage, dir)
    }
    return { note: updated }
  })
}
