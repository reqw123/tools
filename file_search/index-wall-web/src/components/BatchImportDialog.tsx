import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { useBulkAdd, useScan, useScanCategories } from '../hooks/useIndexes'
import { FileBrowser } from './FileBrowser'

/** 「是不是同一個檔案」的比對 key——對齊桌面版 path_key（Windows：大小寫、`/`↔`\` 統一）。 */
const norm = (p: string) => p.replace(/\//g, '\\').toLowerCase()

/**
 * 批次匯入一整個資料夾——對應桌面版「匯入資料夾…」＋ ImportFolderDialog：
 *   1. 選資料夾
 *   2. 選「包含子資料夾」＋檔案類型 → 掃描看筆數／類別分佈 → 填一個共用分類 → 匯入
 * 已在這份索引集裡的路徑自動略過。說明欄一律留空（之後可用「批次補說明」補）。
 */
export function BatchImportDialog({
  indexName,
  existingPaths,
  categories,
  onClose,
  onDone,
}: {
  indexName: string
  existingPaths: string[]
  categories: string[]
  onClose: () => void
  onDone: (added: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const { data: scanCats } = useScanCategories()
  const scan = useScan()
  const add = useBulkAdd(indexName)

  // label -> { icon, color }；「其他」（掃描結果會出現、但不是可篩選類型）用中性灰。
  const meta = useMemo(() => {
    const m = new Map<string, { icon: string; color: string }>()
    for (const c of scanCats ?? []) m.set(c.label, { icon: c.icon, color: c.color })
    m.set('其他', { icon: '📁', color: '#94a3b8' })
    return m
  }, [scanCats])
  const iconFor = (label: string) => meta.get(label)?.icon ?? '📄'
  const colorFor = (label: string) => meta.get(label)?.color ?? '#64748b'

  const [phase, setPhase] = useState<'pick' | 'config'>('pick')
  const [dir, setDir] = useState<string | null>(null)
  const [folder, setFolder] = useState('')
  const [recursive, setRecursive] = useState(false)
  const [types, setTypes] = useState<Set<string>>(new Set())
  const [category, setCategory] = useState('')

  const existing = useMemo(() => new Set(existingPaths.map(norm)), [existingPaths])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    ref.current?.focus()
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  // 篩選條件一改，掃描結果就作廢（避免看舊數字、匯入新條件的結果）。
  const invalidate = () => scan.reset()
  const toggleType = (t: string) => {
    setTypes((s) => {
      const n = new Set(s)
      if (n.has(t)) n.delete(t)
      else n.add(t)
      return n
    })
    invalidate()
  }

  const result = scan.data
  const fresh = useMemo(
    () => (result ? result.files.filter((f) => !existing.has(norm(f.path))) : []),
    [result, existing],
  )
  const skipped = result ? result.files.length - fresh.length : 0
  const canImport = !!result && !result.truncated && fresh.length > 0

  const runScan = () => {
    if (folder) scan.mutate({ dir: folder, recursive, categories: [...types] })
  }
  const runImport = () => {
    if (!canImport || add.isPending) return
    add.mutate(
      { paths: fresh.map((f) => f.path), category: category.trim() },
      { onSuccess: (r) => onDone(r.added) },
    )
  }

  return (
    <div className="scrim" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="匯入資料夾"
        tabIndex={-1}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>匯入資料夾{phase === 'config' ? ' · 篩選與掃描' : ' · 選擇資料夾'}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="關閉">
            ×
          </button>
        </div>

        {phase === 'pick' ? (
          <>
            <div className="modal-body">
              <FileBrowser mode="dir" onPick={setDir} />
            </div>
            <div className="modal-foot">
              <span className="sub mono">整個資料夾的檔案會加進「{indexName}」（只寫索引，不搬檔案）。</span>
              <span className="spacer" />
              <button className="btn" onClick={onClose}>
                取消
              </button>
              <button
                className="btn primary"
                disabled={!dir}
                onClick={() => {
                  if (dir) {
                    setFolder(dir)
                    setPhase('config')
                  }
                }}
              >
                下一步
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="modal-body">
              <div className="ae-file">
                <FolderOpen size={16} aria-hidden />
                <div className="ae-fname mono">{folder}</div>
              </div>

              <label className="bi-check">
                <input
                  type="checkbox"
                  checked={recursive}
                  onChange={(e) => {
                    setRecursive(e.target.checked)
                    invalidate()
                  }}
                />
                包含子資料夾
              </label>

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
                <button className="btn" onClick={runScan} disabled={scan.isPending}>
                  {scan.isPending ? '掃描中…' : '掃描'}
                </button>
                {scan.error && <span className="err">{scan.error.message}</span>}
                {result && !scan.isPending && (
                  <span className={`bi-result${result.truncated ? ' warn' : ''}`}>
                    {result.truncated ? (
                      '掃到的檔案超過安全上限（1000），結果不完整——請縮小範圍或加類型篩選後重新掃描'
                    ) : (
                      <>
                        找到 <b>{result.files.length}</b> 個檔案
                        {skipped > 0 && (
                          <>
                            {' '}
                            · <b>{skipped}</b> 個已在索引中略過
                          </>
                        )}{' '}
                        · 將新增 <b>{fresh.length}</b> 筆
                      </>
                    )}
                  </span>
                )}
              </div>

              {result && !result.truncated && (
                <div className="cat-pills">
                  {result.categoryCounts.map((c) => (
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

              <div className="field-block">
                <label htmlFor="bi-cat">
                  分類 <span className="sub">整批套用同一個，可留空</span>
                </label>
                <input
                  id="bi-cat"
                  value={category}
                  list="bi-cat-list"
                  maxLength={200}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="例如：專案文件、掃描檔"
                />
                <datalist id="bi-cat-list">
                  {categories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>

              {add.error && <p className="err">{add.error.message}</p>}
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => setPhase('pick')} disabled={add.isPending}>
                重新選資料夾
              </button>
              <span className="spacer" />
              <button className="btn" onClick={onClose} disabled={add.isPending}>
                取消
              </button>
              <button className="btn primary" onClick={runImport} disabled={!canImport || add.isPending}>
                {add.isPending ? '匯入中…' : `匯入 ${fresh.length} 筆`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
