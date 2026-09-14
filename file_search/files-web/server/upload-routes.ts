/**
 * 上傳檔案／整個資料夾到索引集——遠端使用者不能瀏覽/挑選主機硬碟上的檔案
 * （`shareGuardHook` 擋掉 `/browse`、`/scan`，見 `share.ts`），但可以把「自己
 * 電腦上的檔案」傳上來：落地到這份索引集所在資料夾底下的 `.uploads/`，再照
 * 一般「加入索引」的流程附加一列（`appendEntry`／`appendEntries`）。跟便利貼
 * 插圖上傳（notes-web 的 note-image-routes.ts）同一種 multipart 處理方式，
 * 但這裡不用 sharp——索引項目本來就什麼檔案類型都收，不是只有圖片。
 *
 * 單檔（`/upload`）的 `category`／`description` 走 query string，不走
 * multipart 欄位：body 只放檔案本身，省掉「文字欄位在檔案前後順序」那個多段
 * 解析的細節（`@fastify/multipart` 的 `req.file()` 只保證回傳「第一個檔案
 * part」，其他欄位有沒有解析完全看它們在原始 multipart body 裡排在檔案前面
 * 還是後面）。整批（`/upload-batch`）同理，`category` 也走 query string，
 * 對整批共用一個分類（跟本機版「匯入資料夾」共用一個分類的行為一致）。
 *
 * 離線版也註冊這支（跟其他項目增刪改一樣一視同仁），不特別鎖
 * `SHARE_MODE==='lan'`——見 index.ts 的低耦合說明，這支本身不寫
 * `.share/` 那類共用狀態，純粹是另一種「加入索引」的來源。
 */
import type { FastifyPluginAsync } from 'fastify'
import multipart from '@fastify/multipart'
import { basename, dirname, join } from 'node:path'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { appendEntries, appendEntry, indexDir } from './store'
import { logActivity } from './activity'
import { displayAuthorFrom } from './share'

/** 文件比便利貼插圖大很多（PDF、簡報常常好幾 MB），但還是要有上限，避免遠端
 *  使用者把主機磁碟塞爆。單檔跟批次裡的每一個檔案都套同一個上限。 */
const MAX_FILE_BYTES = 50 * 1024 * 1024
const MAX_FILE_MB = Math.round(MAX_FILE_BYTES / 1048576)
/** 上傳資料夾一次最多收幾個檔案——避免整個資料夾樹被當成攻擊面（超大量小檔）。 */
const MAX_BATCH_FILES = 500
/** 整批檔案加總大小上限——單檔上限之外再加一層總量閘門，避免 500 個 50MB
 *  的檔案疊起來把主機磁碟塞爆（那樣單檔限制擋不住）。 */
const MAX_BATCH_TOTAL_BYTES = 300 * 1024 * 1024

function uploadsDir(): string {
  return join(indexDir, '.uploads')
}

/** 只取原始檔名（`basename` 擋路徑穿越）、洗掉檔案系統不安全字元、前面加
 *  時間戳＋隨機碼避免碰撞——原始檔名保留在後半段，方便使用者事後在索引集裡
 *  認出這是哪個檔案。單檔上傳、以及批次上傳的「這一批」資料夾名稱都靠這個。 */
function safeStoredFilename(original: string): string {
  const base = basename(original || 'file').slice(0, 150)
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\x00-\x1f<>:"|?*]/g, '_').trim() || 'file'
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  return `${stamp}-${cleaned}`
}

/**
 * 上傳資料夾時，前端把每個檔案的相對路徑（瀏覽器 `File.webkitRelativePath`，
 * 例如 `我的資料夾/子資料夾/檔案.txt`）`encodeURIComponent` 過後塞進
 * multipart 的檔名欄位（見 `UploadFolderDialog.tsx`）——這裡解碼、拆成片段、
 * 逐段清洗，重建出磁碟上的資料夾結構。**不信任這個字串**：解不出來、含
 * `.`／`..`、片段是空的都直接判定整個檔案無效（回 `null`，呼叫端略過這個
 * part，不寫入任何東西）。
 */
function sanitizeRelPath(raw: string): string[] | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return null
  }
  const parts = decoded.split(/[\\/]+/).filter(Boolean)
  if (parts.length === 0 || parts.length > 15) return null
  const cleaned: string[] = []
  for (const seg of parts) {
    if (seg === '.' || seg === '..') return null
    // eslint-disable-next-line no-control-regex
    const safe = seg.replace(/[\x00-\x1f<>:"|?*]/g, '_').trim().slice(0, 150)
    if (!safe) return null
    cleaned.push(safe)
  }
  return cleaned
}

export const uploadRoutes: FastifyPluginAsync = async (app) => {
  // 註冊時的 limits 是這個 plugin 底下所有路由的預設值；批次端點在自己的
  // `req.files({...})` 呼叫另外帶 `files` 上限覆蓋掉這裡的 1。
  await app.register(multipart, { limits: { fileSize: MAX_FILE_BYTES, files: 1 } })

  app.post<{ Params: { name: string }; Querystring: { category?: string; description?: string } }>(
    '/indexes/:name/upload',
    async (req, reply) => {
      const indexName = decodeURIComponent(req.params.name)

      let part
      try {
        part = await req.file()
      } catch {
        return reply.code(413).send({ error: `檔案太大，上限 ${MAX_FILE_MB}MB` })
      }
      if (!part) return reply.code(400).send({ error: '沒有收到檔案' })

      let buf: Buffer
      try {
        buf = await part.toBuffer()
      } catch {
        return reply.code(413).send({ error: `檔案太大，上限 ${MAX_FILE_MB}MB` })
      }

      const dir = uploadsDir()
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      const filename = safeStoredFilename(part.filename)
      const dest = join(dir, filename)
      try {
        writeFileSync(dest, buf)
      } catch (err) {
        return reply.code(500).send({ error: `寫入檔案失敗：${(err as Error).message}` })
      }

      const category = (req.query.category ?? '').toString()
      const description = (req.query.description ?? '').toString()
      const r = appendEntry(indexName, dest, category, description)
      if (!r.ok) {
        rmSync(dest, { force: true }) // 索引集不存在／這個路徑已經在裡面了——別留下孤兒檔案
        return reply.code(r.code).send({ error: r.error })
      }
      logActivity({
        action: 'create',
        indexName,
        title: part.filename || filename,
        author: displayAuthorFrom(req),
        viaUpload: true,
      })
      return reply.code(201).send({ ok: true, path: dest })
    },
  )

  /**
   * 上傳整個資料夾——前端用瀏覽器原生的資料夾選擇器（`webkitdirectory`）
   * 收集一批 `File`，逐一用 `multipart` 的 `file` 欄位送上來（檔名欄位帶著
   * `encodeURIComponent` 過的相對路徑，見上面 `sanitizeRelPath`）。這批檔案
   * 落地到 `.uploads/` 底下**這一批專屬的資料夾**（`safeStoredFilename('batch')`
   * 算出來的名字），保留原本的子資料夾結構——不像單檔上傳整批塞同一層，這樣
   * 「分組：依資料夾」對上傳進來的一批項目才有意義。整批只寫一次 `.md`
   * （`appendEntries`），不是逐檔案各寫一次。
   */
  app.post<{ Params: { name: string }; Querystring: { category?: string } }>(
    '/indexes/:name/upload-batch',
    async (req, reply) => {
      const indexName = decodeURIComponent(req.params.name)
      const category = (req.query.category ?? '').toString()

      const batchDir = join(uploadsDir(), safeStoredFilename('batch'))
      const rows: { path: string; category: string; description: string }[] = []
      let skipped = 0
      let totalBytes = 0

      try {
        for await (const part of req.files({ limits: { fileSize: MAX_FILE_BYTES, files: MAX_BATCH_FILES } })) {
          if (rows.length >= MAX_BATCH_FILES || totalBytes >= MAX_BATCH_TOTAL_BYTES) {
            await part.toBuffer().catch(() => {}) // 還是要把這個 part 的 stream 排掉，parser 才能繼續往下走
            skipped++
            continue
          }
          const segments = sanitizeRelPath(part.filename)
          if (!segments) {
            await part.toBuffer().catch(() => {})
            skipped++
            continue
          }
          let buf: Buffer
          try {
            buf = await part.toBuffer()
          } catch {
            skipped++ // 這個檔案超過單檔大小上限
            continue
          }
          if (totalBytes + buf.length > MAX_BATCH_TOTAL_BYTES) {
            skipped++
            continue
          }
          const dest = join(batchDir, ...segments)
          try {
            mkdirSync(dirname(dest), { recursive: true })
            writeFileSync(dest, buf)
          } catch {
            skipped++
            continue
          }
          totalBytes += buf.length
          rows.push({ path: dest, category, description: '' })
        }
      } catch {
        // 超過 files 上限（FilesLimitError）之類——用已經收到的這些繼續，不整包當失敗。
      }

      if (rows.length === 0) {
        rmSync(batchDir, { recursive: true, force: true })
        return reply.code(400).send({ error: '沒有收到任何有效的檔案' })
      }

      const r = appendEntries(indexName, rows)
      if (!r.ok) {
        rmSync(batchDir, { recursive: true, force: true }) // 索引集不存在——別留下孤兒資料夾
        return reply.code(r.code).send({ error: r.error })
      }
      logActivity({ action: 'bulk-add', indexName, count: r.count, author: displayAuthorFrom(req), viaUpload: true })
      return reply.code(201).send({ added: r.count, skipped })
    },
  )
}
