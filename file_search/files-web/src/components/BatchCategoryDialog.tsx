import { useEffect, useMemo, useRef, useState } from 'react'
import { FolderTree, Tag, Tags } from 'lucide-react'
import type { Entry } from '../lib/api'
import { kindLabel, kindOf } from '../lib/format'
import { useBulkRecategorize } from '../hooks/useIndexes'
import { scrimClose } from '../lib/scrimClose'

const MAX_SHOWN = 400
// 「舊分類」欄裡代表「沒有分類」的值——直接用這個人看得懂的字串當哨兵
// （真有分類叫這個名字的機率趨近於零）。
const NO_CAT = '（未分類）'
type Src = 'folder' | 'type'
type Row = { serial: number; path: string; name: string; ext: string; parent: string; on: boolean; cat: string }

/** 這一筆在某個建議來源下的預設分類：上層資料夾名（沒有就退回檔案類型），
 *  或直接用檔案類型（圖片／文件／PDF…）。 */
function suggest(src: Src, e: { parent: string; ext: string }): string {
  const type = kindLabel(kindOf(e.ext))
  return src === 'type' ? type : e.parent.trim() || type
}

/**
 * 批次分類——一顆按鈕、兩種用法：
 *   • **補上空白的**：列出「分類是空的」項目，每筆先帶一個建議分類（上層資料夾名
 *     ／檔案類型），逐筆看過／改／取消勾選。要看到具體項目清單，所以有清單。
 *   • **{舊}→{新}**：把目前是某個分類（或未分類）的項目整批換成另一個分類。
 *     只是換個名字，不需要清單——選舊的、填新的、套用。
 * 兩種都只寫分類欄（路徑／說明不動），走既有的 PATCH `/indexes/:name/entries`。
 */
export function BatchCategoryDialog({
  indexName,
  entries,
  categories,
  onClose,
  onDone,
}: {
  indexName: string
  entries: Entry[]
  categories: string[]
  onClose: () => void
  onDone: (updated: number, verb: '補' | '改') => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const apply = useBulkRecategorize(indexName)
  const [tab, setTab] = useState<'fill' | 'change'>('fill')
  const [confirming, setConfirming] = useState(false)

  // ── 補上空白的 ──
  // blanks / rows 是「開對話框當下」的快照——刻意不隨背景 refetch 重算：對話框
  // 開著時使用者正在逐筆看過／改建議分類，清單在腳下變動反而更糟。送出後外層
  // 會 invalidate、整個對話框關掉重開才拿新資料。
  const [query, setQuery] = useState('')
  const [source, setSource] = useState<Src>('folder')
  const touched = useRef<Set<number>>(new Set())
  const blanks = useMemo(() => entries.filter((e) => !e.category.trim()), [entries])
  const [rows, setRows] = useState<Row[]>(() =>
    blanks.map((e) => ({
      serial: e.serial, path: e.path, name: e.name, ext: e.ext, parent: e.parent,
      on: true, cat: suggest('folder', e),
    })),
  )

  // ── {舊}→{新} ──
  const [oldCat, setOldCat] = useState('') // '' = 尚未選；NO_CAT = 未分類；其餘 = 分類名
  const [newCat, setNewCat] = useState('')
  const [oldFilter, setOldFilter] = useState('')
  const oldChoices = useMemo(() => {
    const f = oldFilter.trim().toLowerCase()
    const all = [NO_CAT, ...categories]
    return f ? all.filter((c) => c.toLowerCase().includes(f)) : all
  }, [categories, oldFilter])
  const changeHits = useMemo(() => {
    if (!oldCat) return []
    const w = oldCat === NO_CAT ? '' : oldCat
    return entries.filter((e) => e.category === w)
  }, [entries, oldCat])

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

  // 換 tab 時把確認狀態收起來，免得「補」的確認鈕殘留到「改」的畫面。
  const switchTab = (t: 'fill' | 'change') => {
    setTab(t)
    setConfirming(false)
  }

  const pickSource = (src: Src) => {
    setSource(src)
    setRows((rs) => rs.map((r) => (touched.current.has(r.serial) ? r : { ...r, cat: suggest(src, r) })))
  }
  const set = (serial: number, patch: Partial<Row>) => {
    if (patch.cat !== undefined) touched.current.add(serial)
    setRows((rs) => rs.map((r) => (r.serial === serial ? { ...r, ...patch } : r)))
  }
  const allOn = (on: boolean) => setRows((rs) => rs.map((r) => ({ ...r, on })))

  const checked = useMemo(() => rows.filter((r) => r.on && r.cat.trim()), [rows])
  const matched = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => `${r.serial}\n${r.name}\n${r.path}`.toLowerCase().includes(q))
  }, [rows, query])
  const shown = matched.slice(0, MAX_SHOWN)

  const catList = useMemo(
    () => [...new Set([...categories, ...rows.map((r) => r.cat.trim()).filter(Boolean)])].sort(),
    [categories, rows],
  )

  const submitFill = () => {
    const updates = checked.map((r) => ({ serial: r.serial, path: r.path, category: r.cat.trim() }))
    if (!updates.length || apply.isPending) return
    apply.mutate(updates, { onSuccess: (r) => onDone(r.updated, '補') })
  }
  const submitChange = () => {
    const updates = changeHits.map((e) => ({ serial: e.serial, path: e.path, category: newCat.trim() }))
    if (!updates.length || apply.isPending) return
    apply.mutate(updates, { onSuccess: (r) => onDone(r.updated, '改') })
  }

  const oldLabel = oldCat === NO_CAT ? '未分類' : oldCat
  const newLabel = newCat.trim() ? `「${newCat.trim()}」` : '未分類'
  const canChange = !!oldCat && changeHits.length > 0

  return (
    <div className="scrim" {...scrimClose(onClose)}>
      <div
        className="modal wide"
        role="dialog"
        aria-modal="true"
        aria-label="批次分類"
        tabIndex={-1}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>批次分類</h2>
          <button className="icon-btn" onClick={onClose} aria-label="關閉">
            ×
          </button>
        </div>

        <div className="modal-body bd-fit">
          <div className="seg bd-tabs" role="group" aria-label="用法">
            <button className={tab === 'fill' ? 'on' : ''} aria-pressed={tab === 'fill'} onClick={() => switchTab('fill')}>
              補上空白的{blanks.length > 0 && `（${blanks.length}）`}
            </button>
            <button className={tab === 'change' ? 'on' : ''} aria-pressed={tab === 'change'} onClick={() => switchTab('change')}>
              舊分類 → 新分類
            </button>
          </div>

          {tab === 'fill' ? (
            rows.length === 0 ? (
              <p className="fb-empty mono">// 這份索引集裡沒有「分類是空的」項目</p>
            ) : (
              <>
                <p className="sub">
                  只列出<b>分類是空的</b>項目，每筆先帶一個建議分類，逐筆看過／可改／可取消勾選。
                  <b> 只寫分類欄，路徑／說明都不動。</b>
                </p>

                <div className="bd-controls">
                  <span className="bd-quick">建議來源：</span>
                  <div className="seg" role="group" aria-label="建議來源">
                    <button className={source === 'folder' ? 'on' : ''} onClick={() => pickSource('folder')} aria-pressed={source === 'folder'}>
                      <FolderTree size={13} aria-hidden /> 上層資料夾
                    </button>
                    <button className={source === 'type' ? 'on' : ''} onClick={() => pickSource('type')} aria-pressed={source === 'type'}>
                      <Tag size={13} aria-hidden /> 檔案類型
                    </button>
                  </div>
                  <button className="btn sm" onClick={() => allOn(true)}>全部勾選</button>
                  <button className="btn sm" onClick={() => allOn(false)}>全部取消</button>
                </div>

                <div className="bd-controls">
                  <input
                    type="search"
                    className="bd-search"
                    value={query}
                    placeholder="搜尋序號、檔名、路徑…"
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                <p className="sub mono">
                  {query ? `符合 ${matched.length} / ${rows.length}` : `共 ${rows.length} 筆分類是空的`}
                  　·　已勾選 {checked.length}
                </p>

                <div className="bd-list">
                  {matched.length === 0 && <p className="fb-empty mono">// 沒有符合的項目</p>}
                  {shown.map((r) => (
                    <div key={r.serial} className={`bd-card${r.on ? '' : ' off'}`}>
                      <label className="bd-card-head">
                        <input type="checkbox" checked={r.on} onChange={(e) => set(r.serial, { on: e.target.checked })} />
                        <span className="bd-num mono">{r.serial}</span>
                        <span className="bd-name">{r.name}</span>
                        <span className="bd-path mono">{r.path}</span>
                      </label>
                      <input
                        className="bd-desc"
                        value={r.cat}
                        list="bfc-cats"
                        maxLength={200}
                        placeholder="（分類——可自己填，或取消勾選）"
                        onChange={(e) => set(r.serial, { cat: e.target.value })}
                      />
                    </div>
                  ))}
                  {matched.length > MAX_SHOWN && (
                    <p className="bd-trunc mono">
                      // 只顯示前 {MAX_SHOWN} 筆可編輯——其餘 {matched.length - MAX_SHOWN}{' '}
                      筆仍會依「勾選」狀態套用它們的建議分類
                    </p>
                  )}
                </div>
                <datalist id="bfc-cats">
                  {catList.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </>
            )
          ) : (
            <div className="bc-change">
              <p className="sub">
                把目前是某個分類（或未分類）的項目<b>整批</b>換成另一個分類——只是換名字，不用逐筆挑。
              </p>
              <div className="field-block">
                <span>目前分類是</span>
                {categories.length > 8 && (
                  <input
                    type="search"
                    className="bd-search"
                    value={oldFilter}
                    placeholder="篩選現有分類…"
                    onChange={(e) => setOldFilter(e.target.value)}
                  />
                )}
                <div className="bt-chips">
                  {oldChoices.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className="bt-chip"
                      aria-pressed={oldCat === c}
                      onClick={() => setOldCat((cur) => (cur === c ? '' : c))}
                    >
                      {c === NO_CAT ? '（未分類）' : c}
                    </button>
                  ))}
                  {oldChoices.length === 0 && <span className="bt-chips-empty">沒有符合的分類</span>}
                </div>
              </div>
              <p className="sub mono">
                {oldCat ? `已選「${oldLabel}」· 符合 ${changeHits.length} 筆` : '　'}
              </p>
              <label className="field-block">
                <span>全部改成 <span className="sub">可留空＝改成未分類</span></span>
                <input
                  value={newCat}
                  list="bc-cats"
                  maxLength={200}
                  placeholder="例如：論文、截圖、教學筆記"
                  onChange={(e) => setNewCat(e.target.value)}
                />
                <datalist id="bc-cats">
                  {categories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </label>
            </div>
          )}

          {apply.error && <p className="err">{apply.error.message}</p>}
        </div>

        <div className="modal-foot">
          <span className="spacer" />
          {tab === 'fill' ? (
            confirming ? (
              <>
                <button className="btn primary" onClick={submitFill} disabled={apply.isPending}>
                  {apply.isPending ? '套用中…' : `確定補上 ${checked.length} 筆`}
                </button>
                <button className="btn" onClick={() => setConfirming(false)} disabled={apply.isPending}>取消</button>
              </>
            ) : (
              <>
                <button className="btn" onClick={onClose}>關閉</button>
                <button
                  className="btn primary"
                  disabled={rows.length === 0 || checked.length === 0}
                  onClick={() => setConfirming(true)}
                >
                  <Tags size={14} aria-hidden /> 套用勾選的 {checked.length} 筆
                </button>
              </>
            )
          ) : confirming ? (
            <>
              <button className="btn primary" onClick={submitChange} disabled={apply.isPending}>
                {apply.isPending ? '更新中…' : `確定把「${oldLabel}」${changeHits.length} 筆改成${newLabel}`}
              </button>
              <button className="btn" onClick={() => setConfirming(false)} disabled={apply.isPending}>取消</button>
            </>
          ) : (
            <>
              <button className="btn" onClick={onClose}>關閉</button>
              <button className="btn primary" disabled={!canChange} onClick={() => setConfirming(true)}>
                <Tags size={14} aria-hidden /> 把「{oldCat ? oldLabel : '…'}」改成新分類
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
