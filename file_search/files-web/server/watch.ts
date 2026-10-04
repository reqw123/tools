import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { atomicWriteFile } from './atomic-write'
import { logActivity } from './activity'
import { appendEntries, categoryLabelForExt, checkScanDir, indexDir, listIndexes, scanFolder } from './store'

/**
 * 監看資料夾——指定的資料夾裡出現新檔案，就自動加進某份索引集。
 *
 * 做法是「定時重新掃描」（POLL_MS 一次），不是 fs.watch：
 *   - 關著程式那段時間新增的檔案，下次啟動第一次掃描就補上，不會漏；
 *   - 不用處理 fs.watch 在 Windows 上重複／漏事件、資料夾被搬走等狀況；
 *   - 直接重用「匯入資料夾」那套 scanFolder（類型篩選、略過 node_modules／.git、1000 筆安全上限）。
 * 每個監看記住「已經看過的檔案」（known）：只有「這次有、之前沒看過」的才加——使用者從索引裡手動移除的
 * 項目，下次掃描不會又被加回來。剛建立時可以選「現有檔案也一起加入」，不選就只把現有檔案記成看過。
 *
 * 跟整個索引牆一樣**只讀資料夾、只寫索引 .md**，不碰原檔案。設定存在 indexes/.watch_folders.json。
 * 這組 API 只認 loopback（見 share.ts 的 shareGuardHook）——遠端的人不能指定主機要監看哪個資料夾。
 */

const POLL_MS = 30_000
const STABLE_MS = 10_000 // 這麼久內還在變動的檔案（下載中、複製中）先不加，下一輪再看
const FILE = join(indexDir, '.watch_folders.json')
// 下載中／暫存／Office 開檔鎖定檔——不是使用者要收的檔案
const TEMP_RE = /(\.(crdownload|part|partial|download|tmp|temp)$)|(^~\$)|(^\.~lock\.)/i

export type CategoryMode = 'none' | 'folder' | 'type' | 'fixed'

export interface Watch {
  id: string
  index: string // 索引集檔名（含 .md）
  dir: string
  recursive: boolean
  categories: string[] // 只收這些類型（空＝全部），跟匯入資料夾的類型按鈕同一套
  categoryMode: CategoryMode
  categoryText: string // categoryMode === 'fixed' 時用
  createdAt: string
  lastCheck: string // ISO，'' ＝還沒掃過
  lastAdded: { path: string; at: string }[] // 最近自動加入的（最多 20 筆），給畫面顯示
  addedTotal: number
  error: string // 最近一次掃描的問題（找不到資料夾、索引集被刪掉、檔案太多…），'' ＝正常
  known: string[] // 已經看過的檔案路徑
}

type PublicWatch = Omit<Watch, 'known'> & { knownCount: number }

let watches: Watch[] = load()
let timer: NodeJS.Timeout | null = null
let running = false

function load(): Watch[] {
  try {
    if (!existsSync(FILE)) return []
    const data = JSON.parse(readFileSync(FILE, 'utf8')) as { watches?: Watch[] }
    return Array.isArray(data.watches) ? data.watches : []
  } catch (err) {
    console.error('[watch] 讀不到 .watch_folders.json，先當作沒有監看：', err)
    return []
  }
}

function save(): void {
  atomicWriteFile(FILE, JSON.stringify({ watches }, null, 1))
}

function toPublic(w: Watch): PublicWatch {
  const { known, ...rest } = w
  return { ...rest, knownCount: known.length }
}

export function listWatches(index?: string): PublicWatch[] {
  return watches.filter((w) => !index || w.index === index).map(toPublic)
}

function categoryFor(w: Watch, path: string): string {
  switch (w.categoryMode) {
    case 'folder':
      return basename(dirname(path))
    case 'type':
      return categoryLabelForExt(extname(path))
    case 'fixed':
      return w.categoryText.trim()
    default:
      return ''
  }
}

/** 掃一次。includeAll＝這次掃到的全部都當新檔案（建立時勾「現有檔案也一起加入」）；
 *  baselineOnly＝只記成看過、不加（建立時不勾）。回傳這次加了幾筆。 */
async function check(w: Watch, mode: 'normal' | 'includeAll' | 'baselineOnly' = 'normal'): Promise<number> {
  w.lastCheck = new Date().toISOString()
  if (!listIndexes().includes(w.index)) {
    w.error = `索引集「${w.index}」不存在了（被刪除或改名）`
    return 0
  }
  const r = await scanFolder(w.dir, w.recursive, w.categories)
  if ('error' in r) {
    w.error = r.error
    return 0
  }
  if (r.truncated) {
    w.error = `資料夾裡符合的檔案超過 1000 個，為了安全這次沒有處理——請關掉「包含子資料夾」或加類型篩選`
    return 0
  }
  w.error = ''
  const known = new Set(w.known)
  const now = Date.now()
  const fresh: string[] = []
  const settled: string[] = []
  for (const f of r.files) {
    if (TEMP_RE.test(f.name)) continue
    if (mode === 'normal' && known.has(f.path)) {
      settled.push(f.path) // 早就看過的——就算剛被修改也維持「看過」（不然使用者移除的項目改過檔就會被加回來）
      continue
    }
    let mtime = 0
    try {
      mtime = statSync(f.path).mtimeMs
    } catch {
      continue // 剛好被刪掉
    }
    if (mode === 'normal' && now - mtime < STABLE_MS) continue // 還在寫入——不記成看過，下一輪再判斷
    settled.push(f.path)
    if (mode === 'includeAll' || (mode === 'normal' && !known.has(f.path))) fresh.push(f.path)
  }
  // 「看過的」＝這次存在且已穩定的；已經消失的檔案順便從 known 拿掉，免得無限長大
  w.known = settled
  if (!fresh.length) return 0
  const res = appendEntries(
    w.index,
    fresh.map((path) => ({ path, category: categoryFor(w, path), description: '' })),
  )
  if (!res.ok) {
    w.error = res.error
    return 0
  }
  if (res.count > 0) {
    const at = new Date().toISOString()
    w.lastAdded = [...fresh.slice(0, res.count).map((path) => ({ path, at })), ...w.lastAdded].slice(0, 20)
    w.addedTotal += res.count
    logActivity({ action: 'bulk-add', indexName: w.index, count: res.count, author: '自動監看' })
  }
  return res.count
}

async function pollAll(): Promise<void> {
  if (running) return
  running = true
  try {
    for (const w of watches) {
      try {
        await check(w)
      } catch (err) {
        w.error = err instanceof Error ? err.message : String(err)
      }
    }
    if (watches.length) save()
  } finally {
    running = false
  }
}

/** server 啟動時呼叫——先補掃一次（關著程式期間新增的），之後定時掃。 */
export function startWatching(): void {
  if (timer) return
  setTimeout(() => void pollAll(), 5_000)
  timer = setInterval(() => void pollAll(), POLL_MS)
  timer.unref()
}

export async function addWatch(input: {
  index: string
  dir: string
  recursive?: boolean
  categories?: string[]
  categoryMode?: CategoryMode
  categoryText?: string
  includeExisting?: boolean
}): Promise<{ ok: true; watch: PublicWatch; added: number } | { ok: false; code: number; error: string }> {
  if (!listIndexes().includes(input.index)) return { ok: false, code: 404, error: '找不到這份索引集' }
  const bad = checkScanDir(input.dir)
  if (bad) return { ok: false, code: 400, error: bad }
  if (watches.some((w) => w.index === input.index && w.dir.toLowerCase() === input.dir.toLowerCase())) {
    return { ok: false, code: 409, error: '這個資料夾已經在監看了' }
  }
  const mode = input.categoryMode ?? 'none'
  const w: Watch = {
    id: randomUUID(),
    index: input.index,
    dir: input.dir,
    recursive: !!input.recursive,
    categories: input.categories ?? [],
    categoryMode: ['none', 'folder', 'type', 'fixed'].includes(mode) ? mode : 'none',
    categoryText: input.categoryText ?? '',
    createdAt: new Date().toISOString(),
    lastCheck: '',
    lastAdded: [],
    addedTotal: 0,
    error: '',
    known: [],
  }
  const added = await check(w, input.includeExisting ? 'includeAll' : 'baselineOnly')
  if (w.error) return { ok: false, code: 400, error: w.error }
  watches.push(w)
  save()
  return { ok: true, watch: toPublic(w), added }
}

export function removeWatch(id: string): boolean {
  const before = watches.length
  watches = watches.filter((w) => w.id !== id)
  if (watches.length === before) return false
  save()
  return true
}

/** 「立即檢查」——不等下一輪。 */
export async function runWatchNow(id: string): Promise<{ watch: PublicWatch; added: number } | null> {
  const w = watches.find((x) => x.id === id)
  if (!w) return null
  const added = await check(w)
  save()
  return { watch: toPublic(w), added }
}
