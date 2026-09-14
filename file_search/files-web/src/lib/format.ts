/** 檔案類型分組——決定每列左緣的色點與詳情圖示。副檔名不在表列的歸 'other'。 */
export type Kind = 'image' | 'video' | 'audio' | 'doc' | 'sheet' | 'slide' | 'pdf' | 'text' | 'code' | 'archive' | 'other'

const BY_EXT: Record<string, Kind> = {}
const add = (kind: Kind, exts: string) => exts.split(' ').forEach((e) => (BY_EXT[e] = kind))
add('image', 'jpg jpeg png gif webp bmp tiff svg heic avif ico')
add('video', 'mp4 mkv mov avi wmv webm flv m4v mpg mpeg')
add('audio', 'mp3 wav flac aac ogg m4a wma opus aiff')
add('doc', 'doc docx odt rtf pages')
add('sheet', 'xls xlsx ods csv tsv numbers')
add('slide', 'ppt pptx odp key')
add('pdf', 'pdf')
add('text', 'txt md markdown mdx log ini cfg conf env rst srt vtt properties')
// 純文字型的程式碼／設定——盡量涵蓋 server previewFile 的 TEXT_EXTS，兩邊要對得上。
add(
  'code',
  'js mjs cjs ts tsx jsx py rb go rs java kt swift c h cpp hpp cs php ino pde ' +
    'html htm css scss sass less json jsonc yaml yml toml xml sh bat ps1 sql r lua ' +
    'vue svelte astro gradle',
)
add('archive', 'zip 7z rar tar gz bz2 xz')

export function kindOf(ext: string): Kind {
  return BY_EXT[ext.replace(/^\./, '')] ?? 'other'
}

const KIND_LABEL: Record<Kind, string> = {
  image: '圖片',
  video: '影片',
  audio: '音訊',
  doc: '文件',
  sheet: '表格',
  slide: '簡報',
  pdf: 'PDF',
  text: '文字',
  code: '程式',
  archive: '壓縮檔',
  other: '檔案',
}
export function kindLabel(kind: Kind): string {
  return KIND_LABEL[kind]
}

export function humanSize(bytes: number | undefined): string {
  if (bytes === undefined) return ''
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let n = bytes / 1024
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i += 1
  }
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`
}

/** ISO 字串 → 「2026.09.02 01:10」——給共用模式的動態記錄／訪客紀錄用
 *  （跟上面 `stampOf()` 吃 mtime 數字不同，這個吃 activity/visits 存的 ISO
 *  字串），搬自 notes-web/src/lib/format.ts 的 `stamp()`。 */
export function stamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}  ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 相對時間，給活動記錄這種「剛剛發生的事」用；超過一天退回絕對日期
 *  （`stamp()`）。搬自 notes-web/src/lib/format.ts 的 `timeAgo()`。 */
export function timeAgo(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const sec = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000))
  if (sec < 10) return '剛剛'
  if (sec < 60) return `${sec} 秒前`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min} 分鐘前`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr} 小時前`
  return stamp(iso)
}

export function stampOf(mtimeMs: number | undefined): string {
  if (mtimeMs === undefined) return ''
  const d = new Date(mtimeMs)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}  ${p(d.getHours())}:${p(d.getMinutes())}`
}
