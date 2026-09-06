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
add('text', 'txt md markdown log ini cfg')
add('code', 'js ts jsx tsx py rb go rs java c cpp h hpp cs php html css json yaml yml toml sh sql')
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

export function stampOf(mtimeMs: number | undefined): string {
  if (mtimeMs === undefined) return ''
  const d = new Date(mtimeMs)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}  ${p(d.getHours())}:${p(d.getMinutes())}`
}
