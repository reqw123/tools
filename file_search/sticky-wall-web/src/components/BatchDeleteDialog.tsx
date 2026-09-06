import { useEffect, useMemo, useRef, useState } from 'react'
import type { Note } from '../lib/api'
import { colorForTag } from '../lib/color'
import { stamp } from '../lib/format'
import { useBulkDeleteNotes } from '../hooks/useNotes'

/** 批次刪除：列出全部便利貼、勾選要刪的（預設全不勾）、可搜尋、兩段確認。 */
export function BatchDeleteDialog({
  notes,
  onClose,
}: {
  notes: Note[]
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const del = useBulkDeleteNotes()
  const [query, setQuery] = useState('')
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    ref.current?.focus()
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return notes
    return notes.filter(
      (n) =>
        n.title.toLowerCase().includes(q) ||
        n.body.toLowerCase().includes(q) ||
        n.tag.toLowerCase().includes(q),
    )
  }, [notes, query])

  const toggle = (id: string) =>
    setChecked((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const checkShown = () => setChecked((s) => new Set([...s, ...shown.map((n) => n.id)]))
  const clearAll = () => setChecked(new Set())

  const n = checked.size

  return (
    <div className="scrim" onClick={onClose}>
      <div
        className="sheet plain wide"
        role="dialog"
        aria-modal="true"
        aria-label="批次刪除便利貼"
        tabIndex={-1}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="icon-btn" onClick={onClose} aria-label="關閉">
          ×
        </button>
        <h2>批次刪除</h2>
        <p className="dim">勾選要刪除的便利貼（預設全部不勾選，只有勾選的會被刪除；此動作無法復原）。</p>

        <div className="bd-controls">
          <input
            className="bd-search"
            type="search"
            value={query}
            placeholder="搜尋標題、內容、分類…"
            onChange={(e) => setQuery(e.target.value)}
          />
          <span className="dim mono">
            {query ? `符合 ${shown.length} / ${notes.length}` : `共 ${notes.length}`}　·　已勾選 {n}
          </span>
          <button type="button" className="btn ghost sm" onClick={checkShown}>
            勾選目前顯示
          </button>
          <button type="button" className="btn ghost sm" onClick={clearAll}>
            全部取消
          </button>
        </div>

        <ul className="bd-list">
          {shown.map((note) => (
            <li key={note.id} style={{ background: colorForTag(note.tag) }}>
              <label>
                <input
                  type="checkbox"
                  checked={checked.has(note.id)}
                  onChange={() => toggle(note.id)}
                />
                <span className="bd-title">{note.title || '(無標題)'}</span>
                <span className="bd-meta">
                  {note.tag ? `# ${note.tag}　·　` : ''}
                  {stamp(note.created_at)}
                </span>
              </label>
            </li>
          ))}
          {shown.length === 0 && <li className="bd-empty">沒有符合的便利貼</li>}
        </ul>

        {del.error && <span className="err">{del.error.message}</span>}

        <div className="sheet-actions">
          {confirming ? (
            <>
              <button
                className="btn danger"
                disabled={del.isPending}
                onClick={() =>
                  del.mutate([...checked], {
                    onSuccess: onClose,
                  })
                }
              >
                {del.isPending ? '刪除中…' : `確定刪除 ${n} 則`}
              </button>
              <button className="btn ghost" onClick={() => setConfirming(false)}>
                取消
              </button>
            </>
          ) : (
            <>
              <button
                className="btn danger"
                disabled={n === 0}
                onClick={() => setConfirming(true)}
              >
                刪除勾選的 {n} 則
              </button>
              <button className="btn ghost" onClick={onClose}>
                關閉
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
