import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  type Stats,
} from 'node:fs'
import { dirname, extname, isAbsolute, join } from 'node:path'
import { dropThumbs } from './note-thumb'

/**
 * 儲存層——**直接讀寫桌面版的 `indexes/.sticky_notes.json`**，網頁和 Tkinter
 * 桌面版共用同一份資料。格式跟 `sticky_note_repository.py` 一致：
 *
 *   { "notes": [ { id, title, body, tag, created_at }, ... ], "panel": { "visible": bool } }
 *
 * - 只認得那 5 個欄位（跟 Python 的 `_parse_note` 一樣），寫檔時也只寫這 5 個。
 * - `panel` 及其他頂層鍵原封保留，不動桌面版的面板狀態。
 * - 原子寫入：先寫暫存檔再 rename，寫到一半崩潰不會留下半截檔案（對應
 *   `atomic_io.py`）。
 * - 「編輯視同重新建立」：update 會把 `created_at` 設成現在，跟桌面版一致。
 */

export interface Note {
  id: string
  title: string
  body: string
  tag: string
  /** 便利貼插圖的檔名（存在 `noteImagesDir` 底下）；'' = 沒有圖。
   *  只存檔名不存整包 base64——共用的 .sticky_notes.json 不能被圖撐大。 */
  image: string
  created_at: string
}

export const projectRoot = join(import.meta.dirname, '..')

const FILE =
  process.env.STICKY_NOTES_FILE ??
  join(projectRoot, '..', 'indexes', '.sticky_notes.json')

/** 便利貼插圖放這裡——跟 `.sticky_notes.json` 同一個資料夾，`STICKY_NOTES_FILE`
 *  覆寫路徑時圖片也跟著走。前端用 `/note-images/<檔名>` 取（見 index.ts）。 */
export const noteImagesDir = join(dirname(FILE), '.sticky_note_images')

interface RawFile {
  notes: unknown[]
  panel?: unknown
  [k: string]: unknown
}

function readRaw(): RawFile {
  if (!existsSync(FILE)) return { notes: [], panel: { visible: true } }
  try {
    const data = JSON.parse(readFileSync(FILE, 'utf-8')) as unknown
    if (data && typeof data === 'object' && Array.isArray((data as RawFile).notes)) {
      return data as RawFile
    }
  } catch {
    /* 損毀 → 當成空的，跟桌面版 _read_raw 一樣不拋例外 */
  }
  return { notes: [], panel: { visible: true } }
}

function writeRaw(raw: RawFile): void {
  const dir = dirname(FILE)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const tmp = `${FILE}.${process.pid}.tmp`
  // indent=1 跟 Python 的 json.dumps(..., indent=1) 對齊，diff 比較乾淨
  writeFileSync(tmp, JSON.stringify(raw, null, 1), 'utf-8')
  renameSync(tmp, FILE)
}

function parseNote(x: unknown): Note | null {
  if (!x || typeof x !== 'object') return null
  const o = x as Record<string, unknown>
  if (typeof o.id !== 'string' || typeof o.title !== 'string') return null
  return {
    id: o.id,
    title: o.title,
    body: typeof o.body === 'string' ? o.body : '',
    tag: typeof o.tag === 'string' ? o.tag : '',
    image: typeof o.image === 'string' ? o.image : '',
    created_at: typeof o.created_at === 'string' && o.created_at ? o.created_at : localIso(),
  }
}

function serialize(n: Note): Record<string, string> {
  return { id: n.id, title: n.title, body: n.body, tag: n.tag, image: n.image, created_at: n.created_at }
}

/** 刪掉一張插圖檔——檔名可能已經不在了（手動刪過、或從沒存成功），忽略。 */
function unlinkImage(image: string): void {
  if (!image) return
  try {
    rmSync(join(noteImagesDir, image), { force: true })
  } catch {
    /* 檔案系統層級的問題不該擋住便利貼本身的刪除 */
  }
  dropThumbs(image) // 一併清掉牆用的快取縮圖（見 note-thumb.ts）
}

/** 本地時間的 ISO 字串（無時區），Python 的 datetime.fromisoformat 讀得懂。 */
function localIso(d = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
  )
}

// ── 對外 API（跟原本 SQLite 版同名，notes.ts 不用改）────────────────

export function listNotes(): Note[] {
  const notes = readRaw().notes.map(parseNote).filter((n): n is Note => n !== null)
  return notes.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
}

export function getNote(id: string): Note | undefined {
  return listNotes().find((n) => n.id === id)
}

export function createNote(input: { title: string; body?: string; tag?: string }): Note {
  const note: Note = {
    id: crypto.randomUUID().replace(/-/g, ''),
    title: input.title.trim(),
    body: (input.body ?? '').trim(),
    tag: (input.tag ?? '').trim(),
    image: '',
    created_at: localIso(),
  }
  const raw = readRaw()
  raw.notes = [...raw.notes, serialize(note)]
  writeRaw(raw)
  return note
}

/**
 * 設定／清除一則便利貼的插圖檔名。**不動 `created_at`**——插圖是附加內容，
 * 不像改標題/內文那樣算「重新建立」，不該把便利貼推回牆頂。回傳更新後的
 * 便利貼，找不到 id 回 undefined（跟 updateNote 一致）。
 */
export function setNoteImage(id: string, image: string): Note | undefined {
  const raw = readRaw()
  let updated: Note | undefined
  raw.notes = raw.notes.map((x) => {
    const n = parseNote(x)
    if (!n || n.id !== id) return x
    updated = { ...n, image }
    return serialize(updated)
  })
  if (!updated) return undefined
  writeRaw(raw)
  return updated
}

export function updateNote(
  id: string,
  patch: { title?: string; body?: string; tag?: string },
): Note | undefined {
  const raw = readRaw()
  let updated: Note | undefined
  raw.notes = raw.notes.map((x) => {
    const n = parseNote(x)
    if (!n || n.id !== id) return x
    updated = {
      ...n,
      title: patch.title !== undefined ? patch.title.trim() : n.title,
      body: patch.body !== undefined ? patch.body.trim() : n.body,
      tag: patch.tag !== undefined ? patch.tag.trim() : n.tag,
      created_at: localIso(), // 編輯視同重新建立
    }
    return serialize(updated)
  })
  if (!updated) return undefined
  writeRaw(raw)
  return updated
}

export function deleteNote(id: string): boolean {
  const raw = readRaw()
  const before = raw.notes.length
  const dropped = raw.notes.map(parseNote).find((n) => n?.id === id)
  raw.notes = raw.notes.filter((x) => (parseNote(x)?.id ?? null) !== id)
  if (raw.notes.length === before) return false
  writeRaw(raw)
  if (dropped?.image) unlinkImage(dropped.image)
  return true
}

/** 批次新增——整份檔案只讀一次、寫一次。時間戳給每筆錯開 1ms，讓第 1 筆在最上面。 */
export function createNotes(
  items: { title: string; body?: string; tag?: string }[],
): Note[] {
  if (items.length === 0) return []
  const base = Date.now()
  const made: Note[] = items.map((it, i) => ({
    id: crypto.randomUUID().replace(/-/g, ''),
    title: it.title.trim(),
    body: (it.body ?? '').trim(),
    tag: (it.tag ?? '').trim(),
    image: '',
    created_at: localIso(new Date(base - i)),
  }))
  const raw = readRaw()
  raw.notes = [...raw.notes, ...made.map(serialize)]
  writeRaw(raw)
  return made
}

/** 批次刪除——回傳實際刪掉幾筆。整份檔案只讀一次、寫一次。 */
export function deleteNotes(ids: string[]): number {
  const want = new Set(ids)
  if (want.size === 0) return 0
  const raw = readRaw()
  const before = raw.notes.length
  const droppedImages = raw.notes
    .map(parseNote)
    .filter((n): n is Note => n !== null && want.has(n.id) && !!n.image)
    .map((n) => n.image)
  raw.notes = raw.notes.filter((x) => !want.has(parseNote(x)?.id ?? ''))
  const removed = before - raw.notes.length
  if (removed) {
    writeRaw(raw)
    for (const img of droppedImages) unlinkImage(img)
  }
  return removed
}

export function tagCounts(): { tag: string; count: number }[] {
  const m = new Map<string, number>()
  for (const n of listNotes()) if (n.tag) m.set(n.tag, (m.get(n.tag) ?? 0) + 1)
  return [...m.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh-Hant'))
}

export const notesFilePath = FILE

// ── 「AI 生成便利貼」的檔案挑選：資料夾掃描＋目錄瀏覽 ──────────────────
// 移植自 index-wall-web/server/store.ts 的 scanFolder / browseDir——純檔案系統
// 操作，跟索引解析無關，這裡不需要依賴 index-wall-web，直接照原樣搬過來。
// 這個 server 本來就能對全硬碟 stat／讀任意路徑（PreviewService 分析檔案內容
// 本來就要能讀到），只綁 127.0.0.1 把關，列目錄／掃描不是新的安全邊界。

const SCAN_SOFT_LIMIT = 1000 // 可直接送給 AI 挑選的安全筆數
const SCAN_WALK_HARD_LIMIT = 200_000 // 走檔迴圈的絕對上限，避免選到磁碟機根目錄卡死

// label / icon / color 跟桌面版 config.EXT_CATEGORIES、index-wall-web 對齊。
const EXT_CATEGORIES: { label: string; icon: string; color: string; exts: Set<string> }[] = [
  { label: '文件', icon: '📄', color: '#2874a6', exts: new Set(['.doc', '.docx', '.rtf']) },
  { label: '簡報', icon: '📊', color: '#ca6f1e', exts: new Set(['.ppt', '.pptx']) },
  { label: '試算表', icon: '📈', color: '#1e8449', exts: new Set(['.xls', '.xlsx', '.csv']) },
  { label: 'PDF', icon: '📕', color: '#c0392b', exts: new Set(['.pdf']) },
  { label: '文字', icon: '📃', color: '#64748b', exts: new Set(['.txt', '.md']) },
  { label: '圖片', icon: '🖼️', color: '#7d3c98', exts: new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']) },
  { label: '音樂', icon: '🎵', color: '#0e9488', exts: new Set(['.mp3', '.wav', '.flac', '.m4a']) },
  { label: '影片', icon: '🎬', color: '#4f46b5', exts: new Set(['.mp4', '.mov', '.avi', '.mkv', '.wmv']) },
  { label: '壓縮檔', icon: '🗜️', color: '#8b5a2b', exts: new Set(['.zip', '.rar', '.7z']) },
]

export const scanCategories = EXT_CATEGORIES.map(({ label, icon, color }) => ({ label, icon, color }))

export interface ScanResult {
  files: { path: string; name: string; size: number; ext: string }[]
  truncated: boolean // 超過軟上限、結果不完整（不該拿去送給 AI）
  categoryCounts: { label: string; count: number }[]
}

export function scanFolder(
  dir: string,
  recursive: boolean,
  categories: string[],
): ScanResult | { error: string } {
  if (!isAbsolute(dir)) return { error: '請提供絕對路徑' }
  try {
    if (!statSync(dir).isDirectory()) return { error: '這不是資料夾' }
  } catch {
    return { error: '找不到這個資料夾' }
  }

  const want = new Set<string>()
  for (const c of EXT_CATEGORIES) if (categories.includes(c.label)) for (const e of c.exts) want.add(e)

  const files: ScanResult['files'] = []
  let walked = 0
  let truncated = false
  const stack = [dir]
  while (stack.length && !truncated) {
    const cur = stack.pop() as string
    let ents
    try {
      ents = readdirSync(cur, { withFileTypes: true })
    } catch {
      continue
    }
    for (const de of ents) {
      if (walked >= SCAN_WALK_HARD_LIMIT) {
        truncated = true
        break
      }
      walked += 1
      const full = join(cur, de.name)
      let isDir = de.isDirectory()
      if (de.isSymbolicLink()) {
        try {
          isDir = statSync(full).isDirectory()
        } catch {
          continue
        }
      }
      if (isDir) {
        if (recursive) stack.push(full)
        continue
      }
      const ext = extname(de.name).toLowerCase()
      if (want.size && !want.has(ext)) continue
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (!st.isFile()) continue
      if (files.length >= SCAN_SOFT_LIMIT) {
        truncated = true
        break
      }
      files.push({ path: full, name: de.name, size: st.size, ext })
    }
  }

  const counts = EXT_CATEGORIES.map((c) => ({ label: c.label, count: 0 }))
  let other = 0
  for (const f of files) {
    const i = EXT_CATEGORIES.findIndex((c) => c.exts.has(f.ext))
    if (i >= 0) counts[i].count += 1
    else other += 1
  }
  counts.push({ label: '其他', count: other })

  files.sort((a, b) => a.path.localeCompare(b.path, 'zh-Hant', { numeric: true }))
  return { files, truncated, categoryCounts: counts }
}

// ── 檔案總管（給「AI 生成便利貼」的選檔／選資料夾視窗用）───────────────

export interface BrowseEntry {
  name: string
  path: string
  isDir: boolean
  size?: number
  mtime?: number
  ext?: string
}

export interface BrowseListing {
  /** 目前所在目錄；'' 代表「磁碟機／根目錄」清單。 */
  path: string
  /** 上一層目錄；'' = 回磁碟機清單；null = 已在最上層。 */
  parent: string | null
  dirs: BrowseEntry[]
  files: BrowseEntry[]
  /** 目錄項目太多、只回傳前面一段。 */
  truncated: boolean
}

const BROWSE_CAP = 4000

function windowsDrives(): BrowseEntry[] {
  // 先用 `fsutil fsinfo drives`——它只列掛載點，不會去碰媒體，所以不會在空的
  // 讀卡機／光碟機上跳出系統的「請插入磁片」對話框（直接 statSync 每個磁碟機
  // 根目錄有這個風險）。fsutil 不在／失敗才退回逐一 statSync（跳過 A:/B:）。
  try {
    const out = execFileSync('fsutil', ['fsinfo', 'drives'], { timeout: 3000 })
      .toString('utf8')
      .match(/[A-Za-z]:\\/g)
    if (out && out.length) {
      return out.map((d) => ({ name: d.toUpperCase(), path: d.toUpperCase(), isDir: true }))
    }
  } catch {
    /* fsutil 不可用 → 退回下面的逐一探測 */
  }
  const drives: BrowseEntry[] = []
  for (let c = 67; c <= 90; c += 1) {
    const root = `${String.fromCharCode(c)}:\\`
    try {
      statSync(root)
      drives.push({ name: root, path: root, isDir: true })
    } catch {
      /* 沒這個磁碟機 */
    }
  }
  return drives
}

function roots(): BrowseListing {
  return {
    path: '',
    parent: null,
    dirs: process.platform === 'win32' ? windowsDrives() : [{ name: '/', path: '/', isDir: true }],
    files: [],
    truncated: false,
  }
}

export function browseDir(reqPath: string): BrowseListing {
  if (!reqPath) return roots()
  if (!isAbsolute(reqPath)) return roots()

  let dirents
  try {
    dirents = readdirSync(reqPath, { withFileTypes: true })
  } catch {
    return roots()
  }

  const dirs: BrowseEntry[] = []
  const files: BrowseEntry[] = []
  let truncated = false
  for (const de of dirents) {
    if (dirs.length + files.length >= BROWSE_CAP) {
      truncated = true
      break
    }
    const full = join(reqPath, de.name)
    let isDir = de.isDirectory()
    let st: Stats | undefined
    if (de.isSymbolicLink()) {
      try {
        st = statSync(full)
        isDir = st.isDirectory()
      } catch {
        continue
      }
    }
    if (isDir) {
      dirs.push({ name: de.name, path: full, isDir: true })
    } else if (de.isFile() || st?.isFile()) {
      try {
        st = st ?? statSync(full)
        files.push({
          name: de.name,
          path: full,
          isDir: false,
          size: st.size,
          mtime: st.mtimeMs,
          ext: extname(de.name).toLowerCase(),
        })
      } catch {
        continue
      }
    }
  }
  const coll = (a: BrowseEntry, b: BrowseEntry) =>
    a.name.localeCompare(b.name, 'zh-Hant', { numeric: true, sensitivity: 'base' })
  dirs.sort(coll)
  files.sort(coll)

  const up = dirname(reqPath)
  const parent = up === reqPath ? (process.platform === 'win32' ? '' : null) : up
  return { path: reqPath, parent, dirs, files, truncated }
}
