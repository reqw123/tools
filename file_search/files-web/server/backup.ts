/**
 * 「共用牆資料備份／匯出」——2026-09 加，使用者反映
 * `public-index-data/`（區網＋公網共用模式下的資料夾，見 `store.ts` 的
 * `indexDir`）完全在 `.gitignore` 外、沒有任何備份機制，資料損毀時求助
 * 無門。把整個資料夾（`.md` 索引集、`.uploads/`、`.share/`）打包成一個
 * `.zip`，讓 `/host` 的人直接下載。
 *
 * 用 `yazl` 而不是手刻 zip 容器格式或裝 `archiver` 這種依賴樹龐大的套件——
 * `yazl` 只有一個依賴（`buffer-crc32`，本身零依賴），純粹「給一批檔案生一個
 * zip」，剛好符合這裡的需求。
 */
import { createReadStream, type Dirent } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import yazl from 'yazl'

async function* walk(dir: string, base: string): AsyncGenerator<{ full: string; rel: string }> {
  let entries: Dirent<string>[]
  try {
    entries = await readdir(dir, { withFileTypes: true, encoding: 'utf8' })
  } catch {
    return // 資料夾在掃描途中被刪掉之類——這筆備份就少這幾個檔案，不整個炸掉
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walk(full, base)
    } else if (entry.isFile()) {
      // zip 裡的路徑一律用正斜線——USTAR／zip 格式慣例，Windows 上
      // `relative()` 給的是反斜線，這裡轉一下，不然在 macOS/Linux 解壓縮
      // 的人會看到一整串用反斜線接起來的檔名，不會真的建出子資料夾。
      yield { full, rel: relative(base, full).split(sep).join('/') }
    }
  }
}

/** 把 `dir` 整個資料夾（遞迴）打包成 zip，回傳整包 Buffer——資料夾通常不大
 *  （索引集 `.md`＋少量上傳檔案），先整包收進記憶體比較單純，不必為了這種
 *  規模另外做串流下載的複雜度。資料夾不存在／完全是空的都回傳一個空 zip
 *  （合法檔案，不是錯誤），呼叫端不用特別處理這個邊界。 */
export function createBackupZip(dir: string): Promise<Buffer> {
  const zipfile = new yazl.ZipFile()
  ;(async () => {
    for await (const { full, rel } of walk(dir, dir)) {
      zipfile.addReadStream(createReadStream(full), rel)
    }
    zipfile.end()
  })().catch(() => {
    // walk() 本身已經吞掉單一資料夾讀取失敗；這裡是保底，真的出事也讓
    // zipfile 收尾，呼叫端會拿到一包不完整但仍合法的 zip，而不是掛住不回應。
    zipfile.end()
  })

  const chunks: Buffer[] = []
  return new Promise((resolve, reject) => {
    zipfile.outputStream.on('data', (c: Buffer) => chunks.push(c))
    zipfile.outputStream.on('end', () => resolve(Buffer.concat(chunks)))
    zipfile.outputStream.on('error', reject)
  })
}
