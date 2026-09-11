import sharp from 'sharp'
import { createReadStream, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { noteImagesDir } from './store'

/**
 * 便利貼牆用的縮圖——牆上的卡片只把圖顯示在 ~220px 寬的範圍（`columns: 4
 * 240px`），卻在下載完整原圖（手機直拍動輒 7MB / 12MP）之後才由瀏覽器即時
 * 縮小。100 張這種圖同時掛在一個全螢幕置頂的桌面牆上，光是解碼後的點陣圖
 * 就吃掉上 GB 的 GPU 記憶體，hover 動畫、點擊回應都跟著掉——實測單張
 * decode 從 4.5ms（小圖）跳到 144ms（12MP 原圖）。
 *
 * 這裡把「縮小」提前到 server 做一次、快取到磁碟：
 *
 * - **on-demand**，不是上傳時就產：桌面 Tkinter 版和既有的 102 張圖都不會
 *   經過上傳流程，只有請求到 `/api/note-thumb/<檔名>?w=...` 時才生。
 * - 快取檔 `.sticky_note_thumbs/<原檔名>.<寬>.webp`，跟原圖所在的插圖資料夾
 *   同層。原圖 mtime 比快取新就重生（涵蓋「同名檔案被手動換掉」）。
 * - 原圖照留、`/note-images/<檔名>` 不動——點開的編輯視窗（`sheet-img`）還是
 *   拿原圖，要放大看細節時才需要那個解析度。
 * - `.rotate()` 套用 EXIF 方向（跟 Chromium 一致，手機直拍不會躺著）。
 *
 * **`imagesDir` 是呼叫端傳進來的**，不是這裡自己猜——2026-09 起生活／研究生
 * 便利貼插圖分開存放兩個資料夾（見 `store.ts` 的 `activeImagesDir()`），縮圖
 * 快取也要對應放在各自資料夾旁邊，不能寫死指向生活牆那份，不然研究生便利
 * 貼的縮圖會被錯放、甚至覆蓋掉生活牆同名檔案的快取。
 */

export const THUMB_WIDTHS = [400, 800] as const
export type ThumbWidth = (typeof THUMB_WIDTHS)[number]

const thumbsDir = (imagesDir: string) => join(dirname(imagesDir), '.sticky_note_thumbs')

export function isThumbWidth(n: number): n is ThumbWidth {
  return (THUMB_WIDTHS as readonly number[]).includes(n)
}

/**
 * 回傳 `name` 這張插圖（在 `imagesDir` 底下）`w` 寬的 webp 縮圖在磁碟上的
 * 路徑，需要的話現生現快取。找不到原圖、原圖不是圖片、或縮圖失敗都回
 * null（呼叫端回 404）。`imagesDir` 省略時退回生活牆那份（`noteImagesDir`），
 * 給舊呼叫端／還沒特別區分集合的地方用。
 */
export async function resolveThumb(name: string, w: ThumbWidth, imagesDir: string = noteImagesDir): Promise<string | null> {
  const safe = basename(name) // 擋掉 ?name=../.. 之類的路徑穿越
  const src = join(imagesDir, safe)
  let srcStat
  try {
    srcStat = statSync(src)
  } catch {
    return null
  }
  if (!srcStat.isFile()) return null

  const dir = thumbsDir(imagesDir)
  const out = join(dir, `${safe}.${w}.webp`)
  try {
    if (statSync(out).mtimeMs >= srcStat.mtimeMs) return out // 快取還新，直接用
  } catch {
    /* 還沒產過 */
  }

  // 先寫暫存檔再 rename——同一張圖被牆跟懸浮視窗同時請求、都還沒快取時，
  // 兩個 sharp 會同時寫 `out`，直接寫會互相截斷；tmp+rename 讓最後一個
  // 完整檔勝出（rename 覆蓋在 Windows/POSIX 都是原子的）。
  const tmp = `${out}.${process.pid}-${Math.random().toString(36).slice(2)}.tmp`
  try {
    mkdirSync(dir, { recursive: true })
    await sharp(src, { failOn: 'none' })
      .rotate()
      .resize(w, null, { withoutEnlargement: true })
      .webp({ quality: 78 })
      .toFile(tmp)
    renameSync(tmp, out)
  } catch {
    try {
      rmSync(tmp, { force: true })
    } catch {
      /* 暫存檔可能根本沒建出來 */
    }
    return null
  }
  return out
}

/** 開一個磁碟縮圖檔的讀取串流（路徑來自 `resolveThumb`，已確定存在）。 */
export function openThumb(path: string) {
  return createReadStream(path)
}

/**
 * 清掉 `name` 這張插圖（在 `imagesDir` 底下）的所有快取縮圖——原圖被刪除或
 * 換掉時呼叫。縮圖夾裡只有小 webp 檔，找不到就算了。`imagesDir` 省略時退回
 * 生活牆那份，同 `resolveThumb()`。
 */
export function dropThumbs(name: string, imagesDir: string = noteImagesDir): void {
  if (!name) return
  const safe = basename(name)
  const dir = thumbsDir(imagesDir)
  for (const w of THUMB_WIDTHS) {
    try {
      rmSync(join(dir, `${safe}.${w}.webp`), { force: true })
    } catch {
      /* 檔案系統層級的問題不該擋住便利貼／插圖本身的刪除 */
    }
  }
}
