import { useEffect, useRef, useState } from 'react'
import { useBulkCreateNotes } from '../hooks/useNotes'
import { TagInput } from './TagInput'
import { scrimClose } from '../lib/scrimClose'

/**
 * 批次新增：先選分類與數量 → 一次建立 N 張空白便利貼（標題 `<前綴> 1..N`，
 * 內文空的，之後逐張填）。送出成功後把這個分類設成「新增便利貼」的預設。
 */
export function BatchCreateDialog({
  knownTags,
  defaultTag,
  onDone,
  onClose,
}: {
  knownTags: string[]
  defaultTag: string
  onDone: (tag: string, created: number) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const create = useBulkCreateNotes()

  const [tag, setTag] = useState(defaultTag)
  const [count, setCount] = useState(3)
  const [prefix, setPrefix] = useState('')

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

  const n = Math.min(50, Math.max(1, Math.round(count) || 1))
  const effPrefix = prefix.trim() || tag.trim() || '便利貼'

  return (
    <div className="scrim" {...scrimClose(onClose)}>
      <div
        className="sheet plain"
        role="dialog"
        aria-modal="true"
        aria-label="批次新增便利貼"
        tabIndex={-1}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="icon-btn" onClick={onClose} aria-label="關閉">
          ×
        </button>
        <h2>批次新增</h2>
        <p className="dim">
          一次建立多張空白便利貼、統一套一個分類，之後逐張填內容。這個分類也會變成
          「新增便利貼」的預設值（清空分類＝取消預設）。
        </p>

        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault()
            create.mutate(
              { tag: tag.trim(), count: n, titlePrefix: prefix.trim() || undefined },
              { onSuccess: (made) => onDone(tag.trim(), made.length) },
            )
          }}
        >
          <label>
            分類（可留空；跟既有分類同名會套用同一個顏色）
            <TagInput
              value={tag}
              onChange={setTag}
              knownTags={knownTags}
              maxLength={60}
              placeholder="例如：每日、待辦、購物"
              autoFocus
            />
          </label>

          <label>
            數量（1–50）
            <input
              type="number"
              min={1}
              max={50}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            />
          </label>

          <label>
            標題前綴（可留空，預設用分類名或「便利貼」）
            <input
              value={prefix}
              maxLength={100}
              placeholder={effPrefix}
              onChange={(e) => setPrefix(e.target.value)}
            />
          </label>

          <p className="dim mono">
            會建立：{effPrefix} 1 ～ {effPrefix} {n}
            {tag.trim() ? `　·　分類「${tag.trim()}」` : '　·　無分類'}
          </p>

          {create.error && <span className="err">{create.error.message}</span>}

          <div className="sheet-actions">
            <button type="submit" className="btn" disabled={create.isPending}>
              {create.isPending ? '建立中…' : `建立 ${n} 張`}
            </button>
            <button type="button" className="btn ghost" onClick={onClose}>
              取消
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
