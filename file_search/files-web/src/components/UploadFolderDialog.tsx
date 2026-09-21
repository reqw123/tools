import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react'
import { FolderOpen, FolderUp } from 'lucide-react'
import { useScanCategories, useUploadFolder } from '../hooks/useIndexes'
import { categoryOf, OTHER_LABEL } from '../lib/extCategories'
import { scrimClose } from '../lib/scrimClose'
import { ProgressBar } from './ProgressBar'

/** 跟 server/store.ts 的 `SCAN_SKIP_DIRS` 同一份清單——遞迴掃描本機資料夾時
 *  略過的產出物／依賴／版控內部資料夾。上傳資料夾也比照略過，不然選到專案
 *  根目錄，`node_modules` 整包會被塞進索引集。 */
const SKIP_DIRS = new Set([
  '.git', 'node_modules', '__pycache__', '.venv', 'venv', 'env', '.mypy_cache',
  '.pytest_cache', '.ruff_cache', '.idea', '.vscode', 'dist', 'build', '.next',
  '.cache', '.tox', 'site-packages', '.gradle', 'target', '.svn',
])

/** 跟 server/upload-routes.ts 的 `MAX_BATCH_FILES` 對齊——這裡先擋一次，
 *  使用者一眼就知道超過的部分不會被送出，不用等伺服器回報才知道。 */
const MAX_BATCH_FILES = 500

function isSkippedPath(relPath: string): boolean {
  return relPath.split('/').some((seg) => SKIP_DIRS.has(seg))
}

function sizeLabel(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  return `${(n / 1048576).toFixed(1)} MB`
}

/**
 * 「上傳資料夾」——`UploadEntryDialog`（單檔）的批次版本，也是「匯入資料夾」
 * 的遠端友善版本：那顆靠 `/scan` 掃描主機硬碟，共用模式下遠端一律 403。這裡
 * 改用瀏覽器原生的資料夾選擇器（`webkitdirectory`），選的是使用者自己這台
 * 裝置上的一整個資料夾，逐檔上傳（保留子資料夾結構），不需要瀏覽主機硬碟，
 * 所以**不受 `isRemoteShare` 限制**。
 *
 * 類型篩選（2026-09 加，使用者要求「完全參考離線版做法」）跟
 * `BatchImportDialog` 的差別只在**不用打 `/scan` API**——挑好的檔案清單
 * 已經整批在瀏覽器手上，副檔名分類純字串比對（`lib/extCategories.ts`，跟
 * `server/store.ts` 的 `EXT_CATEGORIES` 同一份），可以直接在前端就地算，
 * 沒有「掃描中」這個等待狀態。
 */
export function UploadFolderDialog({
  indexName,
  categories,
  onClose,
  onUploaded,
}: {
  indexName: string
  categories: string[]
  onClose: () => void
  onUploaded: (added: number, skipped: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const dirInputRef = useRef<HTMLInputElement>(null)
  const upload = useUploadFolder(indexName)
  const { data: scanCats } = useScanCategories()

  const meta = useMemo(() => {
    const m = new Map<string, { icon: string; color: string }>()
    for (const c of scanCats ?? []) m.set(c.label, { icon: c.icon, color: c.color })
    if (!m.has(OTHER_LABEL)) m.set(OTHER_LABEL, { icon: '📦', color: '#64748b' })
    return m
  }, [scanCats])
  const iconFor = (label: string) => meta.get(label)?.icon ?? '📄'
  const colorFor = (label: string) => meta.get(label)?.color ?? '#64748b'

  const [phase, setPhase] = useState<'pick' | 'config'>('pick')
  const [folderName, setFolderName] = useState('')
  const [allFiles, setAllFiles] = useState<File[]>([])
  const [types, setTypes] = useState<Set<string>>(new Set())
  const [category, setCategory] = useState('')
  // 上傳位元組進度（XHR upload.onprogress）；null＝還沒收到第一筆回報。
  const [sent, setSent] = useState<{ loaded: number; total: number } | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !upload.isPending) onClose()
    }
    document.addEventListener('keydown', onKey)
    ref.current?.focus()
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose, upload.isPending])

  const pick = (list: FileList | null) => {
    if (!list || list.length === 0) return
    const all = Array.from(list)
    const kept = all.filter((f) => !isSkippedPath(f.webkitRelativePath))
    setFolderName(all[0]?.webkitRelativePath.split('/')[0] ?? '')
    setAllFiles(kept)
    setTypes(new Set())
    setPhase('config')
  }

  const toggleType = (t: string) => {
    setTypes((s) => {
      const n = new Set(s)
      if (n.has(t)) n.delete(t)
      else n.add(t)
      return n
    })
  }

  // 都不選＝收錄全部，跟 BatchImportDialog 的「都不選＝收錄全部」一致。
  const files = useMemo(() => {
    if (types.size === 0) return allFiles
    return allFiles.filter((f) => types.has(categoryOf(f.name)))
  }, [allFiles, types])

  // 所有類別都列出（0 筆淡化，見 .cat-pill.zero），跟本機版「匯入資料夾」
  // 的 categoryCounts 行為一致——不是只列出「這批檔案裡真的有的類別」。
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const f of files) {
      const label = categoryOf(f.name)
      counts.set(label, (counts.get(label) ?? 0) + 1)
    }
    return [...meta.keys()].map((label) => ({ label, count: counts.get(label) ?? 0 }))
  }, [files, meta])

  const totalBytes = useMemo(() => files.reduce((n, f) => n + f.size, 0), [files])
  const truncated = files.length > MAX_BATCH_FILES
  const willSend = truncated ? files.slice(0, MAX_BATCH_FILES) : files

  // 各檔案累計到第幾個位元組——把「已送出 N 位元組」換算成「約第幾個檔案」。
  const cumulative = useMemo(() => {
    const out: number[] = []
    let acc = 0
    for (const f of willSend) {
      acc += f.size
      out.push(acc)
    }
    return out
  }, [willSend])
  const sendBytes = cumulative[cumulative.length - 1] ?? 0

  const submit = () => {
    if (willSend.length === 0 || upload.isPending) return
    setSent(null)
    upload.mutate(
      {
        files: willSend,
        category: category.trim(),
        onProgress: (loaded, total) => setSent({ loaded, total }),
      },
      { onSuccess: (r) => onUploaded(r.added, r.skipped) },
    )
  }

  // 位元組全部送完後，server 還要收尾（寫入索引、回應），這段沒有位元組可報，
  // 改畫不定長進度條，不要讓 100% 卡著像當機。
  const allSent = !!sent && sent.total > 0 && sent.loaded >= sent.total
  const sentFraction = sent && sent.total > 0 ? sent.loaded / sent.total : 0
  const filesDone = cumulative.filter((end) => end <= sentFraction * sendBytes).length

  return (
    <div className="scrim" {...scrimClose(() => { if (!upload.isPending) onClose() })}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="上傳資料夾"
        tabIndex={-1}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>上傳資料夾{phase === 'config' ? ' · 篩選與分類' : ''}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="關閉" disabled={upload.isPending}>
            ×
          </button>
        </div>

        {phase === 'pick' ? (
          <>
            <div className="modal-body">
              <p className="sub">
                從你這台裝置挑一整個資料夾上傳到「{indexName}」——會保留子資料夾結構，
                但 <code>node_modules</code>／<code>.git</code> 這類產出物資料夾會自動略過。
                跟「匯入資料夾」不同，這裡不需要瀏覽主機硬碟，適合共用牆上的遠端使用者。
              </p>
              <p className="sub">
                資料夾裡的檔案很多時，瀏覽器讀取需要一點時間（選好後可能停一下才進下一步），請稍候，不是當機。
              </p>
              <button
                type="button"
                className="btn primary"
                onClick={() => dirInputRef.current?.click()}
              >
                <FolderUp size={16} strokeWidth={2.2} aria-hidden /> 選擇資料夾…
              </button>
              <input
                ref={(el) => {
                  dirInputRef.current = el
                  if (el) {
                    el.setAttribute('webkitdirectory', '')
                    el.setAttribute('directory', '')
                  }
                }}
                type="file"
                multiple
                hidden
                onChange={(e) => pick(e.target.files)}
              />
            </div>
            <div className="modal-foot">
              <span className="spacer" />
              <button className="btn" onClick={onClose}>
                取消
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="modal-body">
              <div className="ae-file">
                <FolderOpen size={16} aria-hidden />
                <div>
                  <div className="ae-fname">{folderName || '（資料夾）'}</div>
                  <div className="ae-fpath mono">{allFiles.length} 個檔案（略過產出物資料夾後）</div>
                </div>
              </div>

              <div className="field-block">
                <label>
                  檔案類型 <span className="sub">點選要收錄的類型；都不選＝收錄全部</span>
                </label>
                <div className="type-grid">
                  {(scanCats ?? []).map((c) => (
                    <button
                      key={c.label}
                      type="button"
                      className={`type-btn${types.has(c.label) ? ' on' : ''}`}
                      style={{ '--tc': c.color } as CSSProperties}
                      aria-pressed={types.has(c.label)}
                      disabled={upload.isPending}
                      onClick={() => toggleType(c.label)}
                    >
                      <span className="type-ico" aria-hidden>
                        {c.icon}
                      </span>
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="bi-scan">
                <span className={`bi-result${truncated ? ' warn' : ''}`}>
                  {truncated ? (
                    <>
                      符合條件的有 <b>{files.length}</b> 個檔案，超過單次上限（{MAX_BATCH_FILES}）——
                      只會上傳前 {MAX_BATCH_FILES} 個，其餘請分批上傳
                    </>
                  ) : (
                    <>
                      符合條件 <b>{files.length}</b> 個檔案 · 共 {sizeLabel(totalBytes)}
                    </>
                  )}
                </span>
              </div>

              {files.length > 0 && (
                <div className="cat-pills">
                  {categoryCounts.map((c) => (
                    <span
                      key={c.label}
                      className={`cat-pill${c.count === 0 ? ' zero' : ''}`}
                      style={{ '--tc': colorFor(c.label) } as CSSProperties}
                    >
                      <span aria-hidden>{iconFor(c.label)}</span>
                      {c.label}
                      <b>{c.count}</b>
                    </span>
                  ))}
                </div>
              )}

              {files.length === 0 && (
                <p className="err">沒有符合目前篩選條件的檔案。</p>
              )}

              <div className="field-block">
                <label htmlFor="uf-cat">
                  分類 <span className="sub">整批套用同一個，可留空</span>
                </label>
                <input
                  id="uf-cat"
                  value={category}
                  list="uf-cat-list"
                  maxLength={200}
                  disabled={upload.isPending}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="例如：專案文件、掃描檔"
                />
                <datalist id="uf-cat-list">
                  {categories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>

              {upload.isPending && (
                <ProgressBar
                  label={
                    allSent
                      ? '檔案已傳完，伺服器正在寫入索引…'
                      : `正在上傳 ${willSend.length.toLocaleString()} 個檔案…`
                  }
                  value={sent && !allSent ? sentFraction : allSent ? undefined : 0}
                  detail={
                    sent && !allSent
                      ? `已傳 ${sizeLabel(sentFraction * sendBytes)} / ${sizeLabel(sendBytes)} · 約第 ${Math.min(filesDone + 1, willSend.length).toLocaleString()} / ${willSend.length.toLocaleString()} 個檔案`
                      : allSent
                        ? undefined
                        : '準備上傳…'
                  }
                />
              )}
              {upload.isPending && (
                <p className="sub">請保持視窗開啟，上傳完成前無法關閉；檔案很多或很大時需要一些時間。</p>
              )}
              {upload.error && <p className="err">{upload.error.message}</p>}
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => setPhase('pick')} disabled={upload.isPending}>
                重新選資料夾
              </button>
              <span className="spacer" />
              <button className="btn" onClick={onClose} disabled={upload.isPending}>
                取消
              </button>
              <button
                className="btn primary"
                onClick={submit}
                disabled={willSend.length === 0 || upload.isPending}
              >
                {upload.isPending ? '上傳中…' : `上傳 ${willSend.length} 個檔案`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
