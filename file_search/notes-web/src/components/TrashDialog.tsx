import { useEffect, useMemo, useRef, useState } from 'react'
import { colorForTag } from '../lib/color'
import { stamp } from '../lib/format'
import { useEmptyTrash, usePurgeNote, useRestoreNote, useTagColors, useTrash } from '../hooks/useNotes'

/**
 * 垃圾桶——「刪除」（單筆或批次）現在只是把便利貼搬到這裡，不是真的消失。
 * 逐筆「復原」或「永久刪除」，或「清空垃圾桶」一次清光。畫面結構比照
 * BatchDeleteDialog（搜尋＋清單），只是每一列的操作換成復原/永久刪除，
 * 不是勾選＋整批刪除——垃圾桶本來就是救火用的，逐筆決定救不救更直覺。
 */
export function TrashDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const { data: trash, isLoading, isError } = useTrash()
  const { data: tagColors } = useTagColors()
  const restore = useRestoreNote()
  const purge = usePurgeNote()
  const empty = useEmptyTrash()
  const [query, setQuery] = useState('')
  const [confirmEmpty, setConfirmEmpty] = useState(false)
  const [confirmPurgeId, setConfirmPurgeId] = useState<string | null>(null)

  const busy = restore.isPending || purge.isPending || empty.isPending

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose()
    document.addEventListener('keydown', onKey)
    ref.current?.focus()
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose, busy])

  const shown = useMemo(() => {
    const list = trash ?? []
    const q = query.trim().toLowerCase()
    if (!q) return list
    return list.filter(
      (n) =>
        n.title.toLowerCase().includes(q) ||
        n.body.toLowerCase().includes(q) ||
        n.tag.toLowerCase().includes(q),
    )
  }, [trash, query])
  const list = trash ?? []

  return (
    <div className="scrim" onClick={() => !busy && onClose()}>
      <div
        className="sheet plain wide"
        role="dialog"
        aria-modal="true"
        aria-label="垃圾桶"
        tabIndex={-1}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="icon-btn" onClick={onClose} aria-label="關閉" disabled={busy}>
          ×
        </button>
        <h2>垃圾桶</h2>
        <p className="dim">
          被刪除的便利貼會先放在這裡，可以復原或永久刪除。超過保留天數或筆數上限的
          最舊那批會自動永久刪除（在「全域設定 → 垃圾桶」調整）。
        </p>

        {isLoading ? (
          <p className="dim mono">// 讀取中…</p>
        ) : isError ? (
          <p className="err">讀取垃圾桶失敗。</p>
        ) : (
          <>
            <div className="bd-controls">
              <input
                className="bd-search"
                type="search"
                value={query}
                placeholder="搜尋標題、內容、分類…"
                onChange={(e) => setQuery(e.target.value)}
                disabled={busy}
              />
              <span className="dim mono">
                {query ? `符合 ${shown.length} / ${list.length}` : `垃圾桶共 ${list.length} 則`}
              </span>
            </div>

            <ul className="bd-list">
              {shown.map((note) => (
                <li key={note.id} style={{ background: colorForTag(note.tag, tagColors) }}>
                  <div className="tr-row">
                    <div>
                      <span className="bd-title">{note.title || '(無標題)'}</span>
                      <span className="bd-meta">
                        {note.tag ? `# ${note.tag}　·　` : ''}刪除於 {stamp(note.deleted_at)}
                      </span>
                    </div>
                    <div className="tr-actions">
                      <button
                        type="button"
                        className="btn ghost sm"
                        disabled={busy}
                        onClick={() => restore.mutate(note.id)}
                      >
                        復原
                      </button>
                      {confirmPurgeId === note.id ? (
                        <>
                          <button
                            type="button"
                            className="btn danger sm"
                            disabled={busy}
                            onClick={() => {
                              purge.mutate(note.id)
                              setConfirmPurgeId(null)
                            }}
                          >
                            確定永久刪除
                          </button>
                          <button
                            type="button"
                            className="btn ghost sm"
                            disabled={busy}
                            onClick={() => setConfirmPurgeId(null)}
                          >
                            取消
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="btn danger sm"
                          disabled={busy}
                          onClick={() => setConfirmPurgeId(note.id)}
                        >
                          永久刪除
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
              {shown.length === 0 && <li className="bd-empty">{query ? '沒有符合的便利貼' : '垃圾桶是空的'}</li>}
            </ul>

            {(restore.error || purge.error || empty.error) && (
              <span className="err">
                {(restore.error ?? purge.error ?? empty.error)?.message}
              </span>
            )}
          </>
        )}

        <div className="sheet-actions">
          {confirmEmpty ? (
            <>
              <button
                className="btn danger"
                disabled={busy}
                onClick={() => {
                  empty.mutate(undefined, { onSuccess: () => setConfirmEmpty(false) })
                }}
              >
                {empty.isPending ? '清空中…' : `確定永久刪除全部 ${list.length} 則`}
              </button>
              <button className="btn ghost" onClick={() => setConfirmEmpty(false)} disabled={busy}>
                取消
              </button>
            </>
          ) : (
            <>
              <button
                className="btn danger"
                disabled={busy || list.length === 0}
                onClick={() => setConfirmEmpty(true)}
              >
                清空垃圾桶
              </button>
              <button className="btn ghost" onClick={onClose} disabled={busy}>
                關閉
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
