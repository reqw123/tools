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
 *   { "notes": [ { id, title, body, tag, image, due_at, created_at }, ... ],
 *     "trash": [ { ...同上欄位, deleted_at }, ... ],
 *     "panel": { "visible": bool } }
 *
 * - `notes` 只認得那 7 個欄位（跟 Python 的 `_parse_note` 一樣），寫檔時也
 *   只寫這 7 個；`trash` 多一個 `deleted_at`（見「垃圾桶」那一節）。
 * - `panel` 及其他頂層鍵原封保留，不動桌面版的面板狀態。
 * - 原子寫入：先寫暫存檔再 rename，寫到一半崩潰不會留下半截檔案（對應
 *   `atomic_io.py`）。
 * - 「編輯視同重新建立」：update 會把 `created_at` 設成現在，跟桌面版一致。
 * - 「刪除」現在是移到 `trash`，不是真的消失——見 deleteNote/deleteNotes
 *   跟垃圾桶那幾個函式。
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
  /** ISO 格式（含時間，見桌面版 sticky_note_service.parse_due_date），
   *  '' = 沒有到期日。純視覺提示用，不觸發任何主動通知。 */
  due_at: string
}

/** 垃圾桶裡的便利貼——刪除（單筆或批次）不是真的消失，先搬到這裡，可以
 *  復原或永久刪除（見「垃圾桶」那一節）。deleted_at 是進垃圾桶的時間。 */
export interface TrashedNote extends Note {
  deleted_at: string
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
  trash: unknown[]
  panel?: unknown
  [k: string]: unknown
}

function readRaw(): RawFile {
  if (!existsSync(FILE)) return { notes: [], trash: [], panel: { visible: true } }
  try {
    const data = JSON.parse(readFileSync(FILE, 'utf-8')) as unknown
    if (data && typeof data === 'object' && Array.isArray((data as RawFile).notes)) {
      const raw = data as RawFile
      if (!Array.isArray(raw.trash)) raw.trash = []
      return raw
    }
  } catch {
    /* 損毀 → 當成空的，跟桌面版 _read_raw 一樣不拋例外 */
  }
  return { notes: [], trash: [], panel: { visible: true } }
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
    due_at: typeof o.due_at === 'string' ? o.due_at : '',
    created_at: typeof o.created_at === 'string' && o.created_at ? o.created_at : localIso(),
  }
}

function serialize(n: Note): Record<string, string> {
  return {
    id: n.id, title: n.title, body: n.body, tag: n.tag, image: n.image,
    due_at: n.due_at, created_at: n.created_at,
  }
}

function parseTrashedNote(x: unknown): TrashedNote | null {
  const n = parseNote(x)
  if (!n) return null
  const o = x as Record<string, unknown>
  return { ...n, deleted_at: typeof o.deleted_at === 'string' && o.deleted_at ? o.deleted_at : localIso() }
}

function serializeTrashed(t: TrashedNote): Record<string, string> {
  return { ...serialize(t), deleted_at: t.deleted_at }
}

/** 刪掉一張插圖檔——檔名可能已經不在了（手動刪過、或從沒存成功），忽略。
 *  只有「垃圾桶永久刪除」才會呼叫這個；一般的 deleteNote/deleteNotes 現在
 *  只是把便利貼搬進垃圾桶，圖片要留著，復原時才用得到。 */
function unlinkImage(image: string): void {
  if (!image) return
  try {
    rmSync(join(noteImagesDir, image), { force: true })
  } catch {
    /* 檔案系統層級的問題不該擋住便利貼本身的刪除 */
  }
  dropThumbs(image) // 一併清掉牆用的快取縮圖（見 note-thumb.ts）
}

// 匯出/匯入內嵌插圖用——常見圖片副檔名 → MIME type，涵蓋範圍跟前端
// FileBrowser/scanFolder 的圖片類別一致，不需要額外套件做完整偵測。
const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
}

/** 讀插圖檔案、編成 `data:<mime>;base64,...`——讀不到（檔案不存在、權限
 *  問題）就回 undefined，呼叫端當作「這筆沒有可內嵌的圖」處理。 */
function readImageDataUri(filename: string): string | undefined {
  try {
    const buf = readFileSync(join(noteImagesDir, filename))
    const mime = IMAGE_MIME[extname(filename).toLowerCase()] ?? 'application/octet-stream'
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch {
    return undefined
  }
}

/** `readImageDataUri()` 的反向操作——解出 base64 內容寫回插圖資料夾。目標
 *  檔名已經存在，或 data URI 格式不對／解碼失敗，都安靜跳過（筆記本身照常
 *  匯入，只是插圖沿用本機既有的，或維持沒有圖）。 */
function writeImageDataUri(filename: string, dataUri: string): void {
  const target = join(noteImagesDir, filename)
  if (existsSync(target)) return
  const comma = dataUri.indexOf(',')
  if (comma < 0) return
  try {
    const buf = Buffer.from(dataUri.slice(comma + 1), 'base64')
    if (!existsSync(noteImagesDir)) mkdirSync(noteImagesDir, { recursive: true })
    writeFileSync(target, buf)
  } catch {
    /* 壞掉的 base64 就不寫，筆記本身照常匯入 */
  }
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

export function createNote(input: { title: string; body?: string; tag?: string; due_at?: string }): Note {
  const note: Note = {
    id: crypto.randomUUID().replace(/-/g, ''),
    title: input.title.trim(),
    body: (input.body ?? '').trim(),
    tag: (input.tag ?? '').trim(),
    image: '',
    due_at: input.due_at ?? '',
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
  patch: { title?: string; body?: string; tag?: string; due_at?: string },
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
      due_at: patch.due_at !== undefined ? patch.due_at : n.due_at,
      created_at: localIso(), // 編輯視同重新建立
    }
    return serialize(updated)
  })
  if (!updated) return undefined
  writeRaw(raw)
  return updated
}

/** 「刪除」現在是「移到垃圾桶」，不是真的消失——復原見 restoreNote()，
 *  永久刪除見 purgeNote()/emptyTrash()。 */
export function deleteNote(id: string): boolean {
  const raw = readRaw()
  const target = raw.notes.map(parseNote).find((n) => n?.id === id)
  if (!target) return false
  raw.notes = raw.notes.filter((x) => (parseNote(x)?.id ?? null) !== id)
  raw.trash = [...raw.trash, serializeTrashed({ ...target, deleted_at: localIso() })]
  writeRaw(raw)
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
    due_at: '',
    created_at: localIso(new Date(base - i)),
  }))
  const raw = readRaw()
  raw.notes = [...raw.notes, ...made.map(serialize)]
  writeRaw(raw)
  return made
}

/**
 * 批次改標籤——統一改成同一個標籤（空字串＝清空標籤），只動標籤欄，
 * 標題／內容／到期日都不變，也不當成「重新建立」（不更新 created_at，
 * 跟桌面版 update_tags() 同一個理由：這是分類整理，不是內容變動）。
 * 整份檔案只讀一次、寫一次。回傳實際改到幾筆。
 */
export function updateNotesTag(ids: string[], tag: string): number {
  const want = new Set(ids)
  if (want.size === 0) return 0
  const newTag = tag.trim()
  const raw = readRaw()
  let changed = 0
  raw.notes = raw.notes.map((x) => {
    const n = parseNote(x)
    if (!n || !want.has(n.id)) return x
    changed += 1
    return serialize({ ...n, tag: newTag })
  })
  if (changed === 0) return 0
  writeRaw(raw)
  return changed
}

/** 批次「刪除」——同上，移到垃圾桶而不是永久刪除。回傳實際移進垃圾桶幾筆。
 *  整份檔案只讀一次、寫一次。 */
export function deleteNotes(ids: string[]): number {
  const want = new Set(ids)
  if (want.size === 0) return 0
  const raw = readRaw()
  const toTrash = raw.notes
    .map(parseNote)
    .filter((n): n is Note => n !== null && want.has(n.id))
  if (toTrash.length === 0) return 0
  raw.notes = raw.notes.filter((x) => !want.has(parseNote(x)?.id ?? ''))
  const now = localIso()
  raw.trash = [...raw.trash, ...toTrash.map((n) => serializeTrashed({ ...n, deleted_at: now }))]
  writeRaw(raw)
  return toTrash.length
}

// ── 垃圾桶 ───────────────────────────────────────────────────────

export function listTrash(): TrashedNote[] {
  const trash = readRaw().trash.map(parseTrashedNote).filter((t): t is TrashedNote => t !== null)
  return trash.sort((a, b) => (a.deleted_at < b.deleted_at ? 1 : a.deleted_at > b.deleted_at ? -1 : 0))
}

/** 從垃圾桶救回便利貼清單——保留原本的 created_at，不當成「重新建立」
 *  （那是編輯的語意；復原只是回到原本該在的時間順序位置）。找不到回
 *  undefined。 */
export function restoreNote(id: string): Note | undefined {
  const raw = readRaw()
  const target = raw.trash.map(parseTrashedNote).find((t) => t?.id === id)
  if (!target) return undefined
  raw.trash = raw.trash.filter((x) => (parseTrashedNote(x)?.id ?? null) !== id)
  const restored: Note = {
    id: target.id, title: target.title, body: target.body,
    tag: target.tag, image: target.image, due_at: target.due_at, created_at: target.created_at,
  }
  raw.notes = [...raw.notes, serialize(restored)]
  writeRaw(raw)
  return restored
}

/** 從垃圾桶永久刪除單一筆——這裡才是真的沒得救，連帶清掉對應的插圖檔案。
 *  回傳有沒有真的刪到。 */
export function purgeNote(id: string): boolean {
  const raw = readRaw()
  const target = raw.trash.map(parseTrashedNote).find((t) => t?.id === id)
  if (!target) return false
  raw.trash = raw.trash.filter((x) => (parseTrashedNote(x)?.id ?? null) !== id)
  writeRaw(raw)
  if (target.image) unlinkImage(target.image)
  return true
}

/** 清空整個垃圾桶、連帶清掉所有插圖檔案。回傳清掉幾筆。 */
export function emptyTrash(): number {
  const raw = readRaw()
  const parsed = raw.trash.map(parseTrashedNote).filter((t): t is TrashedNote => t !== null)
  if (parsed.length === 0) return 0
  raw.trash = []
  writeRaw(raw)
  for (const t of parsed) if (t.image) unlinkImage(t.image)
  return parsed.length
}

export function tagCounts(): { tag: string; count: number }[] {
  const m = new Map<string, number>()
  for (const n of listNotes()) if (n.tag) m.set(n.tag, (m.get(n.tag) ?? 0) + 1)
  return [...m.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh-Hant'))
}

export const notesFilePath = FILE

// ── 匯出／匯入（搬家／備份用）──────────────────────────────────────
// 格式跟桌面版 `StickyNoteRepository.serialize_notes()`／`parse_notes()`
// 完全一致（`{"notes":[{id,title,body,tag,image,created_at}]}`），兩邊互通：
// 桌面版匯出的檔案可以在這裡匯入，這裡匯出的也能拿去桌面版匯入。*不含*
// `panel` 狀態——那是這台機器/這個視窗自己的顯示設定，不該跟著搬到別的地方。

/**
 * 有插圖的筆記會把圖片內容一併用 base64 內嵌成 `image_data`（見
 * `readImageDataUri()`）——只存檔名的話，搬到別台電腦「檔名對得上但圖片
 * 根本沒過去」，插圖連結會整個斷掉；內嵌之後 `importNotesJson()` 才有
 * 東西可以寫回本機的插圖資料夾。
 */
export function exportNotesJson(): string {
  const items = listNotes().map((n) => {
    const item: Record<string, unknown> = serialize(n)
    if (n.image) {
      const dataUri = readImageDataUri(n.image)
      if (dataUri) item.image_data = dataUri
    }
    return item
  })
  return JSON.stringify({ notes: items }, null, 2)
}

export interface ImportNotesResult {
  added: number
  skipped: number
}

/**
 * `exportNotesJson()` 的反向操作——依 id 判斷是否已存在，已經存在的跳過，
 * 只新增真的沒有的（同一份備份重複匯入、或兩邊資料剛好有重疊都不會產生
 * 重複筆）。`text` 不是合法 JSON、或格式對不上（不是 `{"notes":[...]}`）
 * 會拋錯，交給呼叫端顯示錯誤訊息；單筆格式不符的項目安靜跳過（跟
 * `readRaw()` 對主檔案的容錯一致），不會讓整批匯入失敗。筆記帶
 * `image_data`（內嵌的 base64 圖片）時，順便把圖片寫回本機的插圖資料夾——
 * 目標檔名已經存在就跳過寫入，筆記本身還是照常匯入。
 */
export function importNotesJson(text: string): ImportNotesResult {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (err) {
    throw new Error(`不是合法的 JSON：${err instanceof Error ? err.message : String(err)}`)
  }
  if (!data || typeof data !== 'object' || !Array.isArray((data as RawFile).notes)) {
    throw new Error('格式不對——找不到 notes 陣列')
  }
  const incoming: Note[] = []
  for (const item of (data as RawFile).notes) {
    const n = parseNote(item)
    if (!n) continue
    if (n.image && item && typeof item === 'object') {
      const dataUri = (item as Record<string, unknown>).image_data
      if (typeof dataUri === 'string') writeImageDataUri(n.image, dataUri)
    }
    incoming.push(n)
  }
  const raw = readRaw()
  const existingIds = new Set(
    raw.notes.map((x) => parseNote(x)?.id).filter((id): id is string => !!id),
  )
  const fresh = incoming.filter((n) => !existingIds.has(n.id))
  if (fresh.length) {
    raw.notes = [...raw.notes, ...fresh.map(serialize)]
    writeRaw(raw)
  }
  return { added: fresh.length, skipped: incoming.length - fresh.length }
}

// ── 「AI 生成便利貼」的檔案挑選：資料夾掃描＋目錄瀏覽 ──────────────────
// 移植自 files-web/server/store.ts 的 scanFolder / browseDir——純檔案系統
// 操作，跟索引解析無關，這裡不需要依賴 files-web，直接照原樣搬過來。
// 這個 server 本來就能對全硬碟 stat／讀任意路徑（PreviewService 分析檔案內容
// 本來就要能讀到），只綁 127.0.0.1 把關，列目錄／掃描不是新的安全邊界。

const SCAN_SOFT_LIMIT = 1000 // 可直接送給 AI 挑選的安全筆數
const SCAN_WALK_HARD_LIMIT = 200_000 // 走檔迴圈的絕對上限，避免選到磁碟機根目錄卡死

// label / icon / color 跟桌面版 config.EXT_CATEGORIES、files-web 對齊。
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
