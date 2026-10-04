import { type CSSProperties, useEffect, useRef, useState } from 'react'
import { FolderSync, RefreshCw } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type WatchCategoryMode, type WatchFolder } from '../lib/api'
import { useScanCategories } from '../hooks/useIndexes'
import { FileBrowser } from './FileBrowser'
import { scrimClose } from '../lib/scrimClose'

/**
 * 監看資料夾：指定的資料夾裡出現新檔案，就自動加進這份索引集（後端每 30 秒檢查一次，見 server/watch.ts）。
 * 上面列出目前的監看（狀態、最近自動加入的檔案、立即檢查、停止），下面「新增監看」用跟「匯入資料夾」
 * 一樣的檔案瀏覽器與類型按鈕。只讀資料夾、只寫索引檔，不碰原檔案。
 */
const MODE_LABEL: Record<WatchCategoryMode, string> = {
  none: '分類留空',
  folder: '依上層資料夾',
  type: '依檔案類型',
  fixed: '固定分類',
}

function timeOf(iso: string): string {
  if (!iso) return '還沒檢查'
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`
}
const fileName = (p: string) => p.split(/[\\/]/).pop() || p

export function WatchFoldersDialog({ indexName, onClose }: { indexName: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const qc = useQueryClient()
  const key = ['watch', indexName]
  // 對話框開著時定時重抓，背景自動加入的狀態會跟著更新
  const { data: watches = [], isLoading } = useQuery({
    queryKey: key,
    queryFn: () => api.listWatches(indexName),
    refetchInterval: 5000,
  })
  const { data: scanCats } = useScanCategories()
  const [adding, setAdding] = useState(false)
  const [msg, setMsg] = useState('')
  const [confirmStop, setConfirmStop] = useState<string | null>(null)

  // 新增監看的表單
  const [dir, setDir] = useState<string | null>(null)
  const [recursive, setRecursive] = useState(false)
  const [types, setTypes] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState<WatchCategoryMode>('type')
  const [fixed, setFixed] = useState('')
  const [includeExisting, setIncludeExisting] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    ref.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const refresh = () => {
    qc.invalidateQueries({ queryKey: key })
    qc.invalidateQueries({ queryKey: ['index', indexName] })
  }
  const add = useMutation({
    mutationFn: () =>
      api.addWatch({
        index: indexName,
        dir: dir ?? '',
        recursive,
        categories: [...types],
        categoryMode: mode,
        categoryText: fixed,
        includeExisting,
      }),
    onSuccess: (r) => {
      setAdding(false)
      setDir(null)
      setMsg(`已開始監看${r.added ? `，先加入現有的 ${r.added} 個檔案` : '——之後新增的檔案會自動加進來'}`)
      refresh()
    },
  })
  const run = useMutation({
    mutationFn: (id: string) => api.runWatch(id),
    onSuccess: (r) => {
      setMsg(r.added ? `加入了 ${r.added} 個新檔案` : r.watch.error ? `檢查失敗：${r.watch.error}` : '沒有新檔案')
      refresh()
    },
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.removeWatch(id),
    onSuccess: () => {
      setConfirmStop(null)
      setMsg('已停止監看（已加入索引的項目不會被移除）')
      refresh()
    },
  })

  const toggleType = (label: string) =>
    setTypes((s) => {
      const n = new Set(s)
      if (n.has(label)) n.delete(label)
      else n.add(label)
      return n
    })

  const describe = (w: WatchFolder) =>
    [
      w.recursive ? '含子資料夾' : '只看這一層',
      w.categories.length ? `只收：${w.categories.join('、')}` : '全部類型',
      w.categoryMode === 'fixed' ? `分類：${w.categoryText || '（空）'}` : MODE_LABEL[w.categoryMode],
    ].join(' · ')

  return (
    <div className="scrim" {...scrimClose(onClose)}>
      <div
        className="modal wf-modal"
        role="dialog"
        aria-modal="true"
        aria-label="監看資料夾"
        tabIndex={-1}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>
            監看資料夾{adding ? ' · 新增' : ''}
            <span className="wf-index"> · {indexName.replace(/\.md$/i, '')}</span>
          </h2>
          <button className="icon-btn" onClick={onClose} aria-label="關閉">
            ×
          </button>
        </div>

        {!adding ? (
          <>
            <div className="modal-body">
              <p className="sub">
                資料夾裡出現新檔案，就自動加進這份索引集。每 30 秒檢查一次；程式關著時新增的檔案，下次開啟會補上。
                只讀資料夾、只寫索引檔，原檔案完全不動。從索引移除的項目不會再被加回來。
              </p>
              {msg && <p className="wf-msg">{msg}</p>}
              {isLoading ? (
                <p className="sub">讀取中…</p>
              ) : watches.length === 0 ? (
                <div className="wf-empty">
                  <FolderSync size={28} strokeWidth={1.6} aria-hidden />
                  <p>這份索引集還沒有監看任何資料夾</p>
                </div>
              ) : (
                <ul className="wf-list">
                  {watches.map((w) => (
                    <li key={w.id} className={w.error ? 'has-error' : ''}>
                      <div className="wf-dir mono" title={w.dir}>
                        {w.dir}
                      </div>
                      <div className="wf-opts">{describe(w)}</div>
                      <div className="wf-status">
                        上次檢查 {timeOf(w.lastCheck)} · 自動加入共 <b>{w.addedTotal}</b> 筆
                        {w.error && <span className="wf-err"> · ⚠ {w.error}</span>}
                      </div>
                      {w.lastAdded.length > 0 && (
                        <div className="wf-recent">
                          最近加入：
                          {w.lastAdded.slice(0, 5).map((a) => (
                            <span key={a.path + a.at} className="wf-chip mono" title={a.path}>
                              {fileName(a.path)}
                            </span>
                          ))}
                          {w.lastAdded.length > 5 && <span className="sub"> 等 {w.lastAdded.length} 筆</span>}
                        </div>
                      )}
                      <div className="wf-actions">
                        <button className="btn sm" onClick={() => run.mutate(w.id)} disabled={run.isPending}>
                          <RefreshCw size={13} aria-hidden /> 立即檢查
                        </button>
                        {confirmStop === w.id ? (
                          <>
                            <button className="btn sm danger" onClick={() => remove.mutate(w.id)} disabled={remove.isPending}>
                              確定停止
                            </button>
                            <button className="btn sm" onClick={() => setConfirmStop(null)}>
                              取消
                            </button>
                          </>
                        ) : (
                          <button className="btn sm danger" onClick={() => setConfirmStop(w.id)}>
                            停止監看
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="modal-foot">
              <span className="sub">停止監看不會移除已經加入的項目。</span>
              <span className="spacer" />
              <button className="btn" onClick={onClose}>
                關閉
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  setMsg('')
                  add.reset()
                  setAdding(true)
                }}
              >
                <FolderSync size={14} aria-hidden /> 新增監看
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="modal-body">
              <FileBrowser mode="dir" onPick={setDir} />
              <div className="wf-form">
                <label className="bi-check">
                  <input type="checkbox" checked={recursive} onChange={(e) => setRecursive(e.target.checked)} />
                  包含子資料夾
                </label>
                <div className="field-block">
                  <label>
                    只收這些類型 <span className="sub">都不選＝全部類型</span>
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
                <div className="field-block">
                  <label>新檔案的分類</label>
                  <div className="wf-modes" role="radiogroup">
                    {(Object.keys(MODE_LABEL) as WatchCategoryMode[]).map((m) => (
                      <label key={m} className="bi-check">
                        <input type="radio" name="wf-mode" checked={mode === m} onChange={() => setMode(m)} />
                        {MODE_LABEL[m]}
                      </label>
                    ))}
                  </div>
                  {mode === 'fixed' && (
                    <input value={fixed} onChange={(e) => setFixed(e.target.value)} placeholder="例如：下載、專題資料" />
                  )}
                </div>
                <label className="bi-check">
                  <input type="checkbox" checked={includeExisting} onChange={(e) => setIncludeExisting(e.target.checked)} />
                  資料夾裡「現有的」檔案也一起加入（不勾＝只收之後新增的）
                </label>
                {add.error && <p className="err">{add.error.message}</p>}
              </div>
            </div>
            <div className="modal-foot">
              <span className="sub mono">{dir ?? '在上面選一個資料夾'}</span>
              <span className="spacer" />
              <button className="btn" onClick={() => setAdding(false)} disabled={add.isPending}>
                返回
              </button>
              <button className="btn primary" onClick={() => add.mutate()} disabled={!dir || add.isPending}>
                {add.isPending ? '建立中…' : '開始監看'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
