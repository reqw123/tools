import { useEffect, useRef } from 'react'
import { Trash2 } from 'lucide-react'
import { useDeleteIndex } from '../hooks/useIndexes'
import { scrimClose } from '../lib/scrimClose'

/**
 * 刪除整份索引集——對應桌面版「🗑️ 刪除索引集」（見 docs/adr/0004）。比照桌面版
 * 的二次確認：顯示索引集名稱＋項目筆數，要按下「確定刪除」才真的送出。
 * **只刪 indexes/ 底下這份 .md 索引紀錄，硬碟上被索引的實體檔案完全不動。**
 */
export function DeleteIndexDialog({
  indexName,
  entryCount,
  onClose,
  onDone,
}: {
  indexName: string
  entryCount: number
  onClose: () => void
  onDone: (name: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const del = useDeleteIndex()
  const busy = del.isPending

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

  const submit = () => {
    if (busy) return
    del.mutate(indexName, { onSuccess: () => onDone(indexName) })
  }

  return (
    <div className="scrim" {...scrimClose(() => { if (!busy) onClose() })}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="刪除索引集"
        tabIndex={-1}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>刪除索引集</h2>
          <button className="icon-btn" onClick={onClose} aria-label="關閉" disabled={busy}>
            ×
          </button>
        </div>

        <div className="modal-body">
          <p>
            確定要刪除索引集「<b>{indexName}</b>」嗎？
          </p>
          <p className="sub">
            索引項目：{entryCount} 筆　·　只會刪除索引紀錄，不會刪除硬碟上的實體檔案。
            <br />
            此動作無法復原。
          </p>
          {del.error && <p className="err">{del.error.message}</p>}
        </div>

        <div className="modal-foot">
          <span className="spacer" />
          <button className="btn" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button className="btn danger" onClick={submit} disabled={busy}>
            <Trash2 size={14} aria-hidden /> {busy ? '刪除中…' : '確定刪除'}
          </button>
        </div>
      </div>
    </div>
  )
}
