import { randomUUID } from 'node:crypto'
import { checkScanDir, scanFolder, type ScanProgress, type ScanResult } from './store'

/**
 * 「匯入資料夾」的背景掃描工作。
 *
 * 掃描大資料夾（遞迴、幾萬個檔案）要花好一陣子，如果只是一個等到底才回應的
 * `POST /scan`，前端只能轉圈圈，使用者分不出是「還在跑」還是「當機了」。改成：
 * 開始掃描 → 立刻回 job id → 前端輪詢 `GET /scan/jobs/:id` 拿即時進度
 * （已檢視幾個項目、符合幾個、正在讀哪個資料夾）→ 完成時同一支回結果。
 * 掃描本身有時間片讓出（見 `store.ts` 的 `SCAN_SLICE_MS`），所以輪詢請求跟其他
 * 請求（含 SSE）在掃描期間照樣回得出去。
 *
 * 全部存記憶體：掃描結果只是匯入前的預覽，server 重開就作廢很合理，前端拿到
 * 404 會顯示訊息請使用者重掃。
 */

export interface ScanJobView {
  state: 'running' | 'done' | 'error' | 'cancelled'
  progress: ScanProgress
  result?: ScanResult
  error?: string
}

interface ScanJob extends ScanJobView {
  cancelled: boolean
  finishedAt?: number
}

const jobs = new Map<string, ScanJob>()

/** 結束後保留多久——前端輪詢到完成就會停手，這只是防它沒來拿（分頁關掉）而留著佔記憶體。 */
const FINISHED_TTL_MS = 10 * 60 * 1000

function sweep(): void {
  const now = Date.now()
  for (const [id, j] of jobs) {
    if (j.finishedAt && now - j.finishedAt > FINISHED_TTL_MS) jobs.delete(id)
  }
}

export function startScanJob(
  dir: string,
  recursive: boolean,
  categories: string[],
): { id: string } | { error: string } {
  const bad = checkScanDir(dir)
  if (bad) return { error: bad }
  sweep()

  const id = randomUUID()
  const job: ScanJob = {
    state: 'running',
    progress: { walked: 0, matched: 0, dirs: 0, current: dir },
    cancelled: false,
  }
  jobs.set(id, job)

  const finish = () => {
    job.finishedAt = Date.now()
  }
  void scanFolder(dir, recursive, categories, {
    onProgress: (p) => {
      job.progress = p
    },
    isCancelled: () => job.cancelled,
  })
    .then((r) => {
      if (job.cancelled) job.state = 'cancelled'
      else if ('error' in r) {
        job.state = 'error'
        job.error = r.error
      } else {
        job.state = 'done'
        job.result = r
      }
      finish()
    })
    .catch((e: unknown) => {
      job.state = 'error'
      job.error = e instanceof Error ? e.message : String(e)
      finish()
    })
  return { id }
}

export function getScanJob(id: string): ScanJobView | null {
  const j = jobs.get(id)
  if (!j) return null
  const { state, progress, result, error } = j
  return { state, progress, result, error }
}

/** 取消進行中的掃描（已結束的忽略）。掃描迴圈下一個時間片就會發現並收手。 */
export function cancelScanJob(id: string): void {
  const j = jobs.get(id)
  if (j) j.cancelled = true
}
