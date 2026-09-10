import { useEffect, useMemo, useRef, useState } from 'react'
import { useCreateIndex } from '../hooks/useIndexes'
import { validateIndexName } from '../lib/indexName'
import { scrimClose } from '../lib/scrimClose'

/**
 * 新增一份**空白**索引集——在 indexes/ 底下建立一份帶格式規定前言、空表格的
 * 新 .md，建立後自動切換過去。對應桌面版「🗂 新增索引集」（見 docs/adr/0004）。
 * 跟「匯入索引集」的差別只在內容來源：這裡是內建範本，匯入是使用者挑的既有檔。
 */
export function CreateIndexDialog({
  existingNames,
  onClose,
  onDone,
}: {
  existingNames: string[]
  onClose: () => void
  onDone: (name: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const createIndex = useCreateIndex()
  const [name, setName] = useState('')

  const { filename, error } = useMemo(
    () => validateIndexName(name, existingNames),
    [name, existingNames],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !createIndex.isPending && onClose()
    document.addEventListener('keydown', onKey)
    ref.current?.focus()
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose, createIndex.isPending])

  const submit = () => {
    if (!filename || createIndex.isPending) return
    createIndex.mutate(filename, { onSuccess: (r) => onDone(r.name) })
  }

  const busy = createIndex.isPending

  return (
    <div className="scrim" {...scrimClose(() => { if (!busy) onClose() })}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="新增索引集"
        tabIndex={-1}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>新增索引集</h2>
          <button className="icon-btn" onClick={onClose} aria-label="關閉" disabled={busy}>
            ×
          </button>
        </div>

        <div className="modal-body">
          <p className="sub">
            會在 indexes/ 底下建立一份新的空白 .md 索引集（開頭附一段格式規定說明），
            建立後自動切換過去。
          </p>

          <div className="field-block">
            <label htmlFor="create-index-name">
              名稱 <span className="sub">不用打 .md，會自動補上</span>
            </label>
            <input
              id="create-index-name"
              value={name}
              maxLength={200}
              autoFocus
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && filename && submit()}
            />
            <p className={name.trim() && error ? 'err' : 'sub'}>
              {name.trim() && error ? error : `將建立：${filename ?? '…'}`}
            </p>
          </div>

          {createIndex.error && <p className="err">{createIndex.error.message}</p>}
        </div>

        <div className="modal-foot">
          <span className="spacer" />
          <button className="btn" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button className="btn primary" onClick={submit} disabled={busy || !filename}>
            {busy ? '建立中…' : '建立'}
          </button>
        </div>
      </div>
    </div>
  )
}
