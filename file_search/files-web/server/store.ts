import { execFile, execFileSync } from 'node:child_process'
import {
  closeSync,
  createReadStream,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  writeFileSync,
  type Stats,
} from 'node:fs'
import { dirname, extname, isAbsolute, join } from 'node:path'

export const projectRoot = join(import.meta.dirname, '..')

/** 索引集來源目錄——預設是桌面版共用的 ../indexes，測試用 INDEX_DIR 覆寫。 */
export const indexDir = process.env.INDEX_DIR ?? join(projectRoot, '..', 'indexes')

export interface Entry {
  /** 1-based，索引檔案裡的原始列序（只算解析得出的資料列）。 */
  serial: number
  /** 寫在索引檔裡的原始路徑字串，原樣不動（複製出去要能直接用）。 */
  path: string
  category: string
  description: string
  /** basename。 */
  name: string
  /** 完整上層路徑（原始分隔符，末端斜線去掉）——資料夾篩選／分組用這個。 */
  dir: string
  /** 直接父資料夾名——列的次要行顯示用。 */
  parent: string
  /** 副檔名，小寫、含點；沒有就空字串。 */
  ext: string
}

export interface IndexPayload {
  name: string
  entries: Entry[]
  /** 表格以外的 markdown 原文（通常是格式規定說明）。 */
  preamble: string
  /** 整份 .md 檔案原文——「原文檢視」把它整份 render 成一頁。 */
  raw: string
  /** 疑似索引項目、但格式壞掉解析不出來的列數。 */
  skipped: number
}

export interface PathStat {
  exists: boolean
  size?: number
  mtime?: number
}

export interface PreviewResult {
  /** markdown/text = 有內容可看；unsupported = 二進位/影音/Office 之類；missing/toobig 顧名思義。 */
  kind: 'markdown' | 'text' | 'unsupported' | 'missing' | 'toobig'
  text?: string
  /** true 代表檔案比上限大、只回傳前面一段。 */
  truncated?: boolean
  bytes?: number
}

// 能在網頁上直接看內容的純文字副檔名——影音、圖片、Office 一律 unsupported（那些請「開啟檔案」）。
const TEXT_EXTS = new Set([
  '.md', '.markdown', '.txt', '.log', '.ini', '.cfg', '.conf', '.env',
  '.json', '.yaml', '.yml', '.toml', '.csv', '.tsv', '.xml', '.srt', '.vtt',
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.rb', '.go', '.rs',
  '.java', '.kt', '.c', '.h', '.cpp', '.hpp', '.cs', '.php', '.swift',
  '.html', '.htm', '.css', '.scss', '.sh', '.bat', '.ps1', '.sql', '.r', '.lua',
])
const PREVIEW_CAP = 256 * 1024 // 回傳給前端的內容上限
const PREVIEW_MAX_FILE = 8 * 1024 * 1024 // 超過這個大小連讀都不讀

export function previewFile(path: string): PreviewResult {
  if (!isAbsolute(path)) return { kind: 'unsupported' }
  const dot = path.lastIndexOf('.')
  const ext = dot >= 0 ? path.slice(dot).toLowerCase() : ''
  let st
  try {
    st = statSync(path)
  } catch {
    return { kind: 'missing' }
  }
  if (!st.isFile()) return { kind: 'unsupported', bytes: st.size }
  if (!TEXT_EXTS.has(ext)) return { kind: 'unsupported', bytes: st.size }
  if (st.size > PREVIEW_MAX_FILE) return { kind: 'toobig', bytes: st.size }
  // 只讀前面 PREVIEW_CAP+1 bytes——前端本來就只拿得到這麼多，批次補說明更只用
  // 前 1200 字；整份 readFileSync 對大檔（或一次掃很多檔）是白白的 IO／記憶體。
  const want = Math.min(st.size, PREVIEW_CAP + 1)
  const buf = Buffer.alloc(want)
  let read = 0
  const fd = openSync(path, 'r')
  try {
    read = readSync(fd, buf, 0, want, 0)
  } finally {
    closeSync(fd)
  }
  return {
    kind: ext === '.md' || ext === '.markdown' ? 'markdown' : 'text',
    text: buf.subarray(0, Math.min(read, PREVIEW_CAP)).toString('utf8'),
    truncated: read > PREVIEW_CAP,
    bytes: st.size,
  }
}

// 移植自 file_search_app/repositories/index_repository.py 的 _ROW_RE：
// | `路徑` | 分類 | 說明 |——分類/說明可空，路徑一定用反引號包住。
// Python 的 (?P=fence) 反向參照在 JS 寫成 \1。
const ROW_RE = /^\|\s*(`+)(.*?)\1\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|/
// Markdown 表格分隔線 |---|---|---|
const SEP_RE = /^\|[\s|:-]+\|?\s*$/

export function listIndexes(): string[] {
  try {
    return readdirSync(indexDir)
      .filter((f) => f.toLowerCase().endsWith('.md'))
      .sort((a, b) => a.localeCompare(b, 'zh-Hant'))
  } catch {
    return []
  }
}

const INVALID_FILENAME_CHARS = new Set('<>:"/\\|?*')

export interface ValidateNameResult {
  filename: string | null
  error: string | null
}

/**
 * 把使用者輸入的索引集名稱正規化成檔名（沒打 .md 的話自動補上）——跟桌面版
 * `IndexRepository.validate_name()` 對齊：擋 Windows 檔名不能用的符號、
 * 名稱是空的、或跟既有檔案撞名。給「匯入索引集」用（見 0003 ADR：這裡原本
 * 刻意不做索引集層級的建立，匯入等於要建立一份新的 .md，因此需要跟桌面版
 * 一致的檔名檢查）。
 */
export function validateIndexName(raw: string): ValidateNameResult {
  const name = raw.trim()
  if (!name) return { filename: null, error: '請輸入索引集名稱' }
  if (name === '.' || name === '..') return { filename: null, error: '不是合法的檔名' }
  const bad = [...new Set([...name].filter((c) => INVALID_FILENAME_CHARS.has(c)))].sort()
  if (bad.length) return { filename: null, error: `檔名不能包含：${bad.join(' ')}` }
  const filename = name.toLowerCase().endsWith('.md') ? name : `${name}.md`
  if (filename.length <= 3) return { filename: null, error: '請輸入索引集名稱' } // 去掉 .md 後是空的
  if (existsSync(join(indexDir, filename))) {
    return { filename: null, error: `「${filename}」已經存在，換個名稱` }
  }
  return { filename, error: null }
}

/**
 * 把外部帶進來的 .md 內容原封不動存成 indexDir 底下一份新的索引集（例如從
 * 另一台電腦複製過來、或用「匯出索引集」存出去的檔案）。內容本身不另外
 * 驗證表格格式——不合法的列 `readIndex()` 本來就會安靜跳過（計進
 * `skipped`），不會讓匯入整個失敗。呼叫端要先用 `validateIndexName()`
 * 檢查過檔名合法、沒有撞名。對應桌面版
 * `IndexRepository.import_index_file()`。
 */
export function createIndexFile(filename: string, content: string): void {
  mkdirSync(indexDir, { recursive: true })
  writeFileSync(join(indexDir, filename), content, 'utf8')
}

/** 只允許 indexDir 底下的單一 .md 檔名，擋掉 ../ 與絕對路徑。 */
function safeIndexPath(name: string): string | null {
  if (!name.toLowerCase().endsWith('.md')) return null
  if (/[\\/]/.test(name) || name.includes('..')) return null
  return join(indexDir, name)
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i).toLowerCase() : ''
}

function makeEntry(serial: number, path: string, category: string, description: string): Entry {
  const raw = path.replace(/[\\/]+$/, '')
  const norm = raw.replace(/\\/g, '/')
  const slash = norm.lastIndexOf('/')
  const name = slash >= 0 ? norm.slice(slash + 1) : norm
  // 原始分隔符保留（複製/顯示要能直接用）：從 raw 砍掉 name 與一個分隔符。
  const dir = slash >= 0 ? raw.slice(0, raw.length - name.length - 1) : ''
  const dslash = Math.max(dir.lastIndexOf('/'), dir.lastIndexOf('\\'))
  const parent = dslash >= 0 ? dir.slice(dslash + 1) : dir
  return { serial, path, category, description, name, dir, parent, ext: extOf(name) }
}

export function readIndex(name: string): IndexPayload | null {
  const p = safeIndexPath(name)
  if (!p) return null
  let text: string
  try {
    text = readFileSync(p, 'utf8')
  } catch {
    return null
  }

  const entries: Entry[] = []
  const preambleLines: string[] = []
  let serial = 0
  let skipped = 0
  let inTable = false

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    const m = ROW_RE.exec(line)
    if (m) {
      inTable = true
      serial += 1
      entries.push(makeEntry(serial, m[2], m[3].trim(), m[4].trim()))
      continue
    }
    if (line.startsWith('|')) {
      inTable = true
      if (SEP_RE.test(line)) continue
      // 有反引號 = 想寫成索引項目但格式壞了；純表頭那類沒有反引號，靜默忽略。
      if (line.includes('`')) skipped += 1
      continue
    }
    if (!inTable) preambleLines.push(raw)
  }

  return { name, entries, preamble: preambleLines.join('\n').trim(), raw: text, skipped }
}

// ── 寫入：新增／刪除索引項目 ──────────────────────────────────────────
// files-web 原本純唯讀（docs/adr/0001）；docs/adr/0002 放寬成允許「項目
// 層級」的增刪。下面幾個函式是 file_search_app 寫入路徑的第二份移植：
//   _sanitize_cell / _format_path_code / append_row / remove_rows_by_occurrences
//   （index_repository.py）＋ atomic_write_text（atomic_io.py）。
// 索引表格格式若日後改變，這裡跟 ROW_RE 一樣要一起改（CONTEXT.md 的「索引項目」
// 定義是單一事實來源）。

/** 原子寫入：先寫同層暫存檔再 rename，寫到一半崩潰不會留半截檔案。 */
function atomicWriteText(absPath: string, text: string): void {
  const tmp = `${absPath}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, text, 'utf8')
  renameSync(tmp, absPath)
}

/** 表格欄位不能含 `|` 或換行——轉成安全單行（對應 _sanitize_cell）。 */
function sanitizeCell(text: string): string {
  return text.replace(/\|/g, '／').split(/\s+/).filter(Boolean).join(' ')
}

/** 用比路徑內最長反引號序列更長的 code span 包住路徑（對應 _format_path_code）。 */
function formatPathCode(pathStr: string): string {
  let longest = 0
  for (const m of pathStr.matchAll(/`+/g)) longest = Math.max(longest, m[0].length)
  const fence = '`'.repeat(Math.max(1, longest + 1))
  return `${fence}${pathStr}${fence}`
}

/** splitlines(keepends=True) 的等價：每個元素含自己的行尾（最後一行可能沒有）。 */
function splitKeepEnds(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? []
}

export type MutResult =
  | { ok: true; count: number }
  | { ok: false; code: number; error: string }

const MISMATCH = '索引集內容跟畫面上不一致（可能剛被別處改過），請重新整理後再試'

function readMd(name: string): { p: string; text: string } | { err: MutResult } {
  const p = safeIndexPath(name)
  if (!p) return { err: { ok: false, code: 404, error: '找不到這份索引集' } }
  try {
    return { p, text: readFileSync(p, 'utf8') }
  } catch {
    return { err: { ok: false, code: 404, error: '找不到這份索引集' } }
  }
}

/** 索引集裡目前已收錄的路徑集合（原樣字串比對，同一路徑不同大小寫／分隔符是
 *  罕見邊角，不特別正規化——對應桌面版 normalize_candidates 的 duplicates 判斷）。 */
function indexedPaths(text: string): Set<string> {
  const out = new Set<string>()
  for (const raw of text.split(/\r?\n/)) {
    const m = ROW_RE.exec(raw.trim())
    if (m) out.add(m[2])
  }
  return out
}

function mdRow(path: string, category: string, description: string): string {
  // 路徑寫在反引號裡、原樣保留（複製出去要能直接用），但換行一定會破壞整張表格
  // ——真實檔案路徑不可能有換行，出現代表輸入異常，壓成空白讓表格至少不壞。
  const p = path.replace(/[\r\n]+/g, ' ')
  return `| ${formatPathCode(p)} | ${sanitizeCell(category)} | ${sanitizeCell(description)} |`
}

/** 附加一列（對應 append_row）。路徑已在索引集裡回 409。 */
export function appendEntry(
  name: string,
  path: string,
  category: string,
  description: string,
): MutResult {
  const r = readMd(name)
  if ('err' in r) return r.err
  const cleanPath = path.trim()
  if (!cleanPath) return { ok: false, code: 422, error: '路徑不能是空的' }
  if (indexedPaths(r.text).has(cleanPath)) {
    return { ok: false, code: 409, error: '這個路徑已經在這份索引集裡了' }
  }
  const base = r.text && !r.text.endsWith('\n') ? `${r.text}\n` : r.text
  atomicWriteText(r.p, `${base}${mdRow(cleanPath, category, description)}\n`)
  return { ok: true, count: 1 }
}

/** 批次附加多列（對應 append_rows）——整份檔案只讀一次、寫一次。已在索引集裡
 *  或批次內重複的路徑安靜略過（對應資料夾匯入的行為）。回傳實際新增筆數。 */
export function appendEntries(
  name: string,
  rows: { path: string; category: string; description: string }[],
): MutResult {
  const r = readMd(name)
  if ('err' in r) return r.err
  const present = indexedPaths(r.text)
  const seen = new Set<string>()
  const lines: string[] = []
  for (const row of rows) {
    const cp = row.path.trim()
    if (!cp || present.has(cp) || seen.has(cp)) continue
    seen.add(cp)
    lines.push(`${mdRow(cp, row.category, row.description)}\n`)
  }
  if (!lines.length) return { ok: true, count: 0 }
  const base = r.text && !r.text.endsWith('\n') ? `${r.text}\n` : r.text
  atomicWriteText(r.p, base + lines.join(''))
  return { ok: true, count: lines.length }
}

/**
 * 精確移除指定的「原始列序」（0-based，只算可解析資料列；對應
 * remove_rows_by_occurrences）。`targets` 是 occurrence → 該列預期路徑
 * （`undefined` = 不檢查）；任何一列預期路徑對不上就整批不刪，回 409。
 * 一次掃描、一次寫入——所有 occurrence 都對原始檔案編號，不受彼此影響。
 */
export function removeEntriesByOccurrences(
  name: string,
  targets: Map<number, string | undefined>,
): MutResult {
  const r = readMd(name)
  if ('err' in r) return r.err

  const out: string[] = []
  let occ = 0
  let removed = 0
  for (const part of splitKeepEnds(r.text)) {
    const m = ROW_RE.exec(part.trim())
    if (m) {
      if (targets.has(occ)) {
        const expect = targets.get(occ)
        if (expect !== undefined && m[2] !== expect) {
          return { ok: false, code: 409, error: MISMATCH }
        }
        removed += 1
        occ += 1
        continue
      }
      occ += 1
    }
    out.push(part)
  }
  if (!removed) {
    return { ok: false, code: 404, error: '在索引集裡找不到要移除的列了，請重新整理後再試' }
  }
  atomicWriteText(r.p, out.join(''))
  return { ok: true, count: removed }
}

/**
 * 精確更新指定列的分類／說明（對應 update_row_by_occurrence，批次版）。路徑本身
 * 不變。`updates` 每筆給 occurrence + 選擇性的 expectPath / category / description；
 * 沒給的欄位沿用原值。任何一列預期路徑對不上就整批不動，回 409。
 */
export function updateRowsByOccurrences(
  name: string,
  updates: {
    occurrence: number
    expectPath?: string
    category?: string
    description?: string
  }[],
): MutResult {
  const r = readMd(name)
  if ('err' in r) return r.err
  const byOcc = new Map(updates.map((u) => [u.occurrence, u]))

  const out: string[] = []
  let occ = 0
  let updated = 0
  for (const part of splitKeepEnds(r.text)) {
    const m = ROW_RE.exec(part.trim())
    if (m) {
      const u = byOcc.get(occ)
      if (u) {
        if (u.expectPath !== undefined && m[2] !== u.expectPath) {
          return { ok: false, code: 409, error: MISMATCH }
        }
        const cat = u.category !== undefined ? u.category : m[3].trim()
        const desc = u.description !== undefined ? u.description : m[4].trim()
        const eol = part.slice(part.trimEnd().length) || '\n'
        out.push(`${mdRow(m[2], cat, desc)}${eol}`)
        updated += 1
        occ += 1
        continue
      }
      occ += 1
    }
    out.push(part)
  }
  if (!updated) {
    return { ok: false, code: 404, error: '在索引集裡找不到要更新的列了，請重新整理後再試' }
  }
  atomicWriteText(r.p, out.join(''))
  return { ok: true, count: updated }
}

// ── 批次匯入：資料夾掃描（對應 scan_service.py + import_dialogs 的類別統計）──

const SCAN_SOFT_LIMIT = 1000 // 可直接匯入的安全筆數（對應桌面版 SCAN_SOFT_LIMIT）
const SCAN_WALK_HARD_LIMIT = 200_000 // 走檔迴圈的絕對上限，避免選到磁碟機根目錄卡死

// label / icon / color 跟桌面版 config.EXT_CATEGORIES 對齊——前端的類型按鈕與
// 掃描結果統計靠 icon+color 一眼分辨。
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
  truncated: boolean // 超過軟上限，files 只是前面一段、不完整（不該拿去匯入）
  /** 符合條件的檔案「真實總數」——即使超過軟上限，掃描仍會繼續數（只計數，
   *  不再收集細節），讓使用者至少知道這個資料夾裡究竟有多少筆，而不是只看到
   *  一個「超過 1000」。沒有 truncated 時就等於 files.length。 */
  matchedCount: number
  /** 撞到走檔絕對上限（`SCAN_WALK_HARD_LIMIT`）才停下來——這種情況
   *  matchedCount 只是「掃到這裡為止」的下限，不是資料夾裡的精確總數
   *  （對應桌面版 ScanService 的硬上限）。 */
  hitWalkLimit: boolean
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
  const counts = EXT_CATEGORIES.map((c) => ({ label: c.label, count: 0 }))
  let other = 0
  let walked = 0
  let matchedCount = 0
  let hitWalkLimit = false
  const stack = [dir]
  // 走檔迴圈本身不因為超過軟上限而提前結束——超過之後不再把細節塞進 files
  // （前端只需要前一段可以看/勾選），但繼續數 matchedCount，直到真的掃完，
  // 或撞到 SCAN_WALK_HARD_LIMIT（防止選到磁碟機根目錄卡死）才停手。
  while (stack.length && !hitWalkLimit) {
    const cur = stack.pop() as string
    let ents
    try {
      ents = readdirSync(cur, { withFileTypes: true })
    } catch {
      continue
    }
    for (const de of ents) {
      if (walked >= SCAN_WALK_HARD_LIMIT) {
        hitWalkLimit = true
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
      matchedCount += 1
      const i = EXT_CATEGORIES.findIndex((c) => c.exts.has(ext))
      if (i >= 0) counts[i].count += 1
      else other += 1
      if (files.length < SCAN_SOFT_LIMIT) {
        files.push({ path: full, name: de.name, size: st.size, ext })
      }
    }
  }
  counts.push({ label: '其他', count: other })

  files.sort((a, b) => a.path.localeCompare(b.path, 'zh-Hant', { numeric: true }))
  return { files, truncated: matchedCount > SCAN_SOFT_LIMIT || hitWalkLimit, matchedCount, hitWalkLimit, categoryCounts: counts }
}

// ── 批次補說明：對「說明是空的」項目擷取內容當建議（對應 description_service.py）──

const SUGGESTION_CHARS = 1200

/** 對應 build_suggestion：純文字／markdown 取前 1200 字、非空白行 strip 後接起來；
 *  圖片／二進位／找不到 → 空字串（留給使用者自己填）。 */
export function suggestDescription(path: string): string {
  const r = previewFile(path)
  if ((r.kind === 'text' || r.kind === 'markdown') && r.text) {
    return r.text
      .slice(0, SUGGESTION_CHARS)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

export interface BlankItem {
  serial: number
  path: string
  name: string
  category: string
  suggestion: string
}

/** 對應 find_blank_entries + generate_suggestions：說明是空的、且檔案還在的項目，
 *  各配一段建議說明。回 { items, truncated }（超過上限只處理前面一段）。 */
export function blankSuggestions(name: string): { items: BlankItem[]; truncated: boolean } | null {
  const payload = readIndex(name)
  if (!payload) return null
  const blanks = payload.entries.filter((e) => !e.description.trim())
  const truncated = blanks.length > SCAN_SOFT_LIMIT
  const items: BlankItem[] = []
  for (const e of blanks.slice(0, SCAN_SOFT_LIMIT)) {
    let exists = false
    try {
      exists = statSync(e.path).isFile()
    } catch {
      exists = false
    }
    if (!exists) continue // 找不到檔案的沒有內容可擷取，列出來也沒意義
    items.push({
      serial: e.serial,
      path: e.path,
      name: e.name,
      category: e.category,
      suggestion: suggestDescription(e.path),
    })
  }
  return { items, truncated }
}

// ── 檔案總管（給「加入索引」的選檔視窗用）───────────────────────────────
// 這個 server 本來就能對全硬碟 stat／open／串流任意路徑（見模組結尾的
// openInExplorer / resolveFile），只綁 127.0.0.1。列目錄不是新的安全邊界。

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

export function statPaths(paths: string[]): Record<string, PathStat> {
  const out: Record<string, PathStat> = {}
  for (const path of paths.slice(0, 5000)) {
    if (out[path]) continue
    try {
      const s = statSync(path)
      out[path] = { exists: true, size: s.size, mtime: s.mtimeMs }
    } catch {
      out[path] = { exists: false }
    }
  }
  return out
}

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.avif': 'image/avif',
  '.ico': 'image/x-icon', '.tif': 'image/tiff', '.tiff': 'image/tiff', '.heic': 'image/heic',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo', '.mpg': 'video/mpeg', '.mpeg': 'video/mpeg',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac', '.aac': 'audio/aac',
  '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.m4a': 'audio/mp4', '.opus': 'audio/opus',
  '.aiff': 'audio/aiff', '.wma': 'audio/x-ms-wma',
  '.pdf': 'application/pdf',
}

export function mimeOf(path: string): string {
  const dot = path.lastIndexOf('.')
  return (dot >= 0 && MIME[path.slice(dot).toLowerCase()]) || 'application/octet-stream'
}

/** 檔案 serve 前的檢查——路徑合法、存在、是檔案。 */
export function resolveFile(path: string): { ok: true; stat: Stats } | { ok: false; code: number } {
  if (!isAbsolute(path)) return { ok: false, code: 400 }
  let stat: Stats
  try {
    stat = statSync(path)
  } catch {
    return { ok: false, code: 404 }
  }
  if (!stat.isFile()) return { ok: false, code: 400 }
  return { ok: true, stat }
}

export function fileStream(path: string, start?: number, end?: number) {
  return createReadStream(path, start === undefined ? undefined : { start, end })
}

/**
 * 用系統檔案總管開啟一個路徑（select=true → 開資料夾並選中該檔）。
 * execFile 不經過 shell，路徑當單一參數傳，沒有注入問題。
 * explorer 常常回非 0 結束碼即使成功了，忽略 callback 的 error。
 */
export function openInExplorer(target: string, select: boolean): boolean {
  if (!isAbsolute(target)) return false
  if (process.platform === 'win32') {
    execFile('explorer.exe', [select ? `/select,${target}` : target], () => {})
  } else if (process.platform === 'darwin') {
    execFile('open', select ? ['-R', target] : [target], () => {})
  } else {
    execFile('xdg-open', [target], () => {})
  }
  return true
}

// ── 分類自訂顏色 ─────────────────────────────────────────────────────
// 獨立小檔案 `indexes/.index_category_colors.json`，格式 {"<分類>": "#rrggbb"}
// ——顯示偏好，不是索引資料本身，壞掉不影響索引。跟桌面版
// `IndexCategoryColorRepository`、便利貼的 `.sticky_tag_colors.json` 同一套
// 想法：沒自訂過的分類不會在檔案裡，前端 categoryColor() 拿不到就退回雜湊配色。
const CATEGORY_COLORS_FILE = join(indexDir, '.index_category_colors.json')
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/

export type CategoryColors = Record<string, string>

export function getCategoryColors(): CategoryColors {
  try {
    const data = JSON.parse(readFileSync(CATEGORY_COLORS_FILE, 'utf8')) as unknown
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const out: CategoryColors = {}
      for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
        if (typeof v === 'string' && HEX_COLOR_RE.test(v)) out[k] = v
      }
      return out
    }
  } catch {
    /* 不存在或壞掉 → 空物件，不擋索引本身 */
  }
  return {}
}

function writeCategoryColors(colors: CategoryColors): void {
  mkdirSync(dirname(CATEGORY_COLORS_FILE), { recursive: true })
  atomicWriteText(CATEGORY_COLORS_FILE, JSON.stringify(colors, null, 1))
}

/** 指定某個分類固定用這個顏色。格式不對（color 必須 #rrggbb）就原樣回傳目前的表。 */
export function setCategoryColor(category: string, color: string): CategoryColors {
  const trimmed = category.trim()
  if (!trimmed || !HEX_COLOR_RE.test(color)) return getCategoryColors()
  const colors = getCategoryColors()
  colors[trimmed] = color.toLowerCase()
  writeCategoryColors(colors)
  return colors
}

/** 拿掉某分類的自訂顏色，改回雜湊配色。 */
export function clearCategoryColor(category: string): CategoryColors {
  const trimmed = category.trim()
  const colors = getCategoryColors()
  if (trimmed in colors) {
    delete colors[trimmed]
    writeCategoryColors(colors)
  }
  return colors
}
