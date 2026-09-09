import { useEffect, useId, useRef, useState } from 'react'
import { File } from 'lucide-react'
import { useAddEntry } from '../hooks/useIndexes'
import { FileBrowser } from './FileBrowser'
import { scrimClose } from '../lib/scrimClose'

/**
 * 「加入索引」——對應桌面版的「新增檔案…」＋ AddEntryDialog：
 *   1. 選一個本機檔案（FileBrowser）
 *   2. 填分類（可留空／從既有分類挑）＋說明，確認後把一列寫進目前這份索引集
 * 只動索引集 .md，不碰硬碟上的實體檔案。
 */
export function AddEntryDialog({
  indexName,
  categories,
  onClose,
  onAdded,
}: {
  indexName: string
  categories: string[]
  onClose: () => void
  onAdded: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const listId = useId()
  const add = useAddEntry(indexName)

  const [phase, setPhase] = useState<'pick' | 'meta'>('pick')
  const [path, setPath] = useState<string | null>(null)
  const [picked, setPicked] = useState('')
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')

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

  const toMeta = (p: string) => {
    setPicked(p)
    setPhase('meta')
  }

  const submit = () => {
    if (!picked || add.isPending) return
    add.mutate(
      { path: picked, category: category.trim(), description: description.trim() },
      { onSuccess: onAdded },
    )
  }

  const fileName = picked.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || picked

  return (
    <div className="scrim" {...scrimClose(onClose)}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="加入索引"
        tabIndex={-1}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>加入索引{phase === 'meta' ? ' · 分類與說明' : ' · 選擇檔案'}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="關閉">
            ×
          </button>
        </div>

        {phase === 'pick' ? (
          <>
            <div className="modal-body">
              <FileBrowser onPick={setPath} onPickImmediate={toMeta} />
            </div>
            <div className="modal-foot">
              <span className="sub mono">
                只會把索引紀錄寫進「{indexName}」，不會複製或搬動實體檔案。
              </span>
              <span className="spacer" />
              <button className="btn" onClick={onClose}>
                取消
              </button>
              <button
                className="btn primary"
                disabled={!path}
                onClick={() => path && toMeta(path)}
              >
                下一步
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="modal-body">
              <div className="ae-file">
                <File size={16} aria-hidden />
                <div>
                  <div className="ae-fname">{fileName}</div>
                  <div className="ae-fpath mono">{picked}</div>
                </div>
              </div>

              <div className="field-block">
                <label htmlFor={`${listId}-cat`}>
                  分類 <span className="sub">可留空，或從既有分類挑一個</span>
                </label>
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

              <div className="field-block">
                <label htmlFor={`${listId}-desc`}>
                  說明 <span className="sub">可打多個關鍵字，搜尋會比對全文</span>
                </label>
                <input
                  id={`${listId}-desc`}
                  value={description}
                  maxLength={2000}
                  autoFocus
                  onChange={(e) => setDescription(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submit()}
                />
              </div>

              {add.error && <p className="err">{add.error.message}</p>}
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => setPhase('pick')} disabled={add.isPending}>
                重新選檔
              </button>
              <span className="spacer" />
              <button className="btn" onClick={onClose} disabled={add.isPending}>
                取消
              </button>
              <button className="btn primary" onClick={submit} disabled={add.isPending}>
                {add.isPending ? '加入中…' : '加入'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
