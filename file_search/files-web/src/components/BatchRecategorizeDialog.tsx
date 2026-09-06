import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Tags } from 'lucide-react'
import type { Entry } from '../lib/api'
import { kindOf } from '../lib/format'
import { useBulkRecategorize } from '../hooks/useIndexes'

const MAX_SHOWN = 500

/**
 * 批次改分類——對應桌面版「🏷️ 批次改分類...」：列出這份索引集全部項目，
 * 搜尋 + 勾選要改分類的（預設全部不勾），統一改成同一個分類（留空＝未分類），
 * 兩段確認。跟 BatchDeleteDialog 同一套搜尋/勾選骨架，只是動作換成
 * PATCH 分類而不是刪除整列——只改分類欄，路徑／說明都不動。
 */
export function BatchRecategorizeDialog({
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
  onDone: (updated: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const listId = useId()
  const recat = useBulkRecategorize(indexName)
  const [query, setQuery] = useState('')
  const [checked, setChecked] = useState<Set<number>>(new Set()) // serial 集合
  const [category, setCategory] = useState('')
  const [confirming, setConfirming] = useState(false)

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

  const matched = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return entries
    return entries.filter((e) =>
      `${e.serial}\n${e.name}\n${e.category}\n${e.description}\n${e.path}`.toLowerCase().includes(q),
    )
  }, [entries, query])

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
    if (!n || recat.isPending) return
    const bySerial = new Map(entries.map((e) => [e.serial, e.path]))
    const updates = [...checked].map((serial) => ({
      serial, path: bySerial.get(serial) ?? '', category: category.trim(),
    }))
    recat.mutate(updates, { onSuccess: (r) => onDone(r.updated) })
  }

  return (
    <div className="scrim" onClick={onClose}>
      <div
        className="modal wide"
        role="dialog"
        aria-modal="true"
        aria-label="批次改分類"
        tabIndex={-1}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>批次改分類</h2>
          <button className="icon-btn" onClick={onClose} aria-label="關閉">
            ×
          </button>
        </div>

        <div className="modal-body">
          <p className="sub">
            勾選要改分類的項目，統一改成下面填的分類（留空＝改成未分類）。
            <b> 只改分類欄，路徑／說明都不動。</b>
          </p>

          <div className="bd-controls">
            <input
              type="search"
              className="bd-search"
              value={query}
              placeholder="搜尋序號、檔名、分類、說明、完整路徑…"
              onChange={(e) => setQuery(e.target.value)}
            />
            <button type="button" className="btn sm" onClick={checkMatched}>
              勾選目前顯示
            </button>
            <button type="button" className="btn sm" onClick={clearAll}>
              全部取消
            </button>
          </div>
          <p className="sub mono">
            {query ? `符合 ${matched.length} / ${entries.length}` : `共 ${entries.length}`}
            　·　已勾選 {n}
          </p>

          <div className="bd-list">
            {matched.length === 0 && <p className="fb-empty mono">// 沒有符合的項目</p>}
            {shown.map((e) => (
              <label key={e.serial} className={`bd-row k-${kindOf(e.ext)}`}>
                <input type="checkbox" checked={checked.has(e.serial)} onChange={() => toggle(e.serial)} />
                <span className="bd-num mono">{e.serial}</span>
                <span className="bd-name">{e.name}</span>
                <span className="bd-tag">{e.category || '未分類'}</span>
                <span className="bd-path mono">{e.path}</span>
              </label>
            ))}
            {matched.length > MAX_SHOWN && (
              <p className="bd-trunc mono">
                // 符合的共 {matched.length} 筆，只列出前 {MAX_SHOWN} 筆——請用搜尋縮小範圍
                （「勾選目前顯示」仍會勾選全部符合的）
              </p>
            )}
          </div>

          <div className="field-block">
            <label htmlFor={`${listId}-cat`}>改成分類 <span className="sub">可留空，或從既有分類挑一個</span></label>
            <input
              id={`${listId}-cat`}
              value={category}
              list={listId}
              maxLength={200}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="例如：論文、截圖、教學筆記"
            />
            <datalist id={listId}>
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>

          {recat.error && <p className="err">{recat.error.message}</p>}
        </div>

        <div className="modal-foot">
          <span className="spacer" />
          {confirming ? (
            <>
              <button className="btn primary" onClick={submit} disabled={recat.isPending}>
                {recat.isPending ? '更新中…' : `確定改成${category.trim() ? `「${category.trim()}」` : '未分類'}（${n} 筆）`}
              </button>
              <button className="btn" onClick={() => setConfirming(false)} disabled={recat.isPending}>
                取消
              </button>
            </>
          ) : (
            <>
              <button className="btn" onClick={onClose}>
                關閉
              </button>
              <button className="btn primary" disabled={n === 0} onClick={() => setConfirming(true)}>
                <Tags size={14} aria-hidden /> 套用到勾選的 {n} 筆
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
