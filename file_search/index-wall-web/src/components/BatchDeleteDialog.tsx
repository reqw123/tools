import { useEffect, useMemo, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { Entry, PathStat } from '../lib/api'
import { api } from '../lib/api'
import { kindOf } from '../lib/format'
import { useBulkDelete } from '../hooks/useIndexes'

const MAX_SHOWN = 500

/**
 * 批次刪除——對應桌面版「批次刪除…」＋ BulkDeleteDialog：
 * 列出這份索引集全部項目，搜尋 + 勾選要移除的（預設全部不勾），可「只看路徑
 * 遺失」，兩段確認。**只把那幾列從 .md 拿掉，硬碟上的實體檔案完全不動。**
 * 依原始列序（serial）定位並帶上預期路徑，一次寫入。
 */
export function BatchDeleteDialog({
  indexName,
  entries,
  onClose,
  onDone,
}: {
  indexName: string
  entries: Entry[]
  onClose: () => void
  onDone: (removed: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const del = useBulkDelete(indexName)
  const [query, setQuery] = useState('')
  const [missingOnly, setMissingOnly] = useState(false)
  const [checked, setChecked] = useState<Set<number>>(new Set()) // serial 集合
  const [confirming, setConfirming] = useState(false)
  const [stats, setStats] = useState<Record<string, PathStat>>({})

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    ref.current?.focus()
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // 開視窗時一次查全部路徑是否還在（給「只看路徑遺失」＋徽章用）。
    api
      .exists(entries.map((e) => e.path))
      .then(setStats)
      .catch(() => {})
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose, entries])

  const isMissing = (e: Entry) => !!stats[e.path] && !stats[e.path].exists

  const matched = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries.filter((e) => {
      const s = stats[e.path]
      if (missingOnly && !(s && !s.exists)) return false
      if (!q) return true
      return `${e.serial}\n${e.name}\n${e.category}\n${e.description}\n${e.path}`
        .toLowerCase()
        .includes(q)
    })
  }, [entries, query, missingOnly, stats])

  const toggle = (serial: number) =>
    setChecked((s) => {
      const n = new Set(s)
      if (n.has(serial)) n.delete(serial)
      else n.add(serial)
      return n
    })
  const checkMatched = () => setChecked((s) => new Set([...s, ...matched.map((e) => e.serial)]))
  const clearAll = () => setChecked(new Set())

  const n = checked.size
  const shown = matched.slice(0, MAX_SHOWN)

  const submit = () => {
    if (!n || del.isPending) return
    const bySerial = new Map(entries.map((e) => [e.serial, e.path]))
    const items = [...checked].map((serial) => ({ serial, path: bySerial.get(serial) ?? '' }))
    del.mutate(items, { onSuccess: (r) => onDone(r.removed) })
  }

  return (
    <div className="scrim" onClick={onClose}>
      <div
        className="modal wide"
        role="dialog"
        aria-modal="true"
        aria-label="批次刪除索引項目"
        tabIndex={-1}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>批次刪除</h2>
          <button className="icon-btn" onClick={onClose} aria-label="關閉">
            ×
          </button>
        </div>

        <div className="modal-body">
          <p className="sub">
            勾選要從索引移除的項目（預設全部不勾，只有勾選的會被移除）。
            <b> 只移除索引裡的這幾列紀錄，不會刪除硬碟上的實體檔案。</b>
          </p>

          <div className="bd-controls">
            <input
              type="search"
              className="bd-search"
              value={query}
              placeholder="搜尋序號、檔名、分類、說明、完整路徑…"
              onChange={(e) => setQuery(e.target.value)}
            />
            <button
              type="button"
              className={`btn sm${missingOnly ? ' on' : ''}`}
              onClick={() => setMissingOnly((v) => !v)}
            >
              {missingOnly ? '顯示全部' : '只看路徑遺失'}
            </button>
            <button type="button" className="btn sm" onClick={checkMatched}>
              勾選目前顯示
            </button>
            <button type="button" className="btn sm" onClick={clearAll}>
              全部取消
            </button>
          </div>
          <p className="sub mono">
            {query || missingOnly ? `符合 ${matched.length} / ${entries.length}` : `共 ${entries.length}`}
            　·　已勾選 {n}
          </p>

          <div className="bd-list">
            {matched.length === 0 && <p className="fb-empty mono">// 沒有符合的項目</p>}
            {shown.map((e) => {
              const miss = isMissing(e)
              return (
                <label key={e.serial} className={`bd-row k-${kindOf(e.ext)}${miss ? ' missing' : ''}`}>
                  <input
                    type="checkbox"
                    checked={checked.has(e.serial)}
                    onChange={() => toggle(e.serial)}
                  />
                  <span className="bd-num mono">{e.serial}</span>
                  <span className="bd-name">{e.name}</span>
                  {e.category && <span className="bd-tag">{e.category}</span>}
                  {miss && <span className="bd-miss">檔案已不存在</span>}
                  <span className="bd-path mono">{e.path}</span>
                </label>
              )
            })}
            {matched.length > MAX_SHOWN && (
              <p className="bd-trunc mono">
                // 符合的共 {matched.length} 筆，只列出前 {MAX_SHOWN} 筆——請用搜尋縮小範圍
                （「勾選目前顯示」仍會勾選全部符合的）
              </p>
            )}
          </div>

          {del.error && <p className="err">{del.error.message}</p>}
        </div>

        <div className="modal-foot">
          <span className="spacer" />
          {confirming ? (
            <>
              <button className="btn danger" onClick={submit} disabled={del.isPending}>
                {del.isPending ? '移除中…' : `確定移除 ${n} 筆`}
              </button>
              <button className="btn" onClick={() => setConfirming(false)} disabled={del.isPending}>
                取消
              </button>
            </>
          ) : (
            <>
              <button className="btn" onClick={onClose}>
                關閉
              </button>
              <button className="btn danger" disabled={n === 0} onClick={() => setConfirming(true)}>
                <Trash2 size={14} aria-hidden /> 移除勾選的 {n} 筆
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
