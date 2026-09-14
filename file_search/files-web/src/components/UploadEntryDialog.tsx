import { useEffect, useId, useRef, useState } from 'react'
import { File, UploadCloud } from 'lucide-react'
import { useUploadEntry } from '../hooks/useIndexes'
import { scrimClose } from '../lib/scrimClose'

/**
 * 「上傳檔案」——`AddEntryDialog` 的遠端友善版本：那顆挑檔靠 `/browse` 瀏覽
 * 主機硬碟，共用模式下遠端使用者一律 403（見 Toolbar.tsx 的 `isRemoteShare`）。
 * 這裡改用瀏覽器原生的檔案選擇器，選的是「使用者自己這台裝置」上的檔案，
 * 上傳到 server（`server/upload-routes.ts`），不需要瀏覽主機硬碟，所以**不受
 * `isRemoteShare` 限制**，遠端使用者也能用。
 */
export function UploadEntryDialog({
  indexName,
  categories,
  onClose,
  onUploaded,
}: {
  indexName: string
  categories: string[]
  onClose: () => void
  onUploaded: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const upload = useUploadEntry(indexName)

  const [phase, setPhase] = useState<'pick' | 'meta'>('pick')
  const [file, setFile] = useState<File | null>(null)
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !upload.isPending) onClose()
    }
    document.addEventListener('keydown', onKey)
    ref.current?.focus()
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose, upload.isPending])

  const pick = (f: File | undefined | null) => {
    if (!f) return
    setFile(f)
    setPhase('meta')
  }

  const submit = () => {
    if (!file || upload.isPending) return
    upload.mutate(
      { file, category: category.trim(), description: description.trim() },
      { onSuccess: onUploaded },
    )
  }

  const sizeLabel = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`)

  return (
    <div className="scrim" {...scrimClose(() => { if (!upload.isPending) onClose() })}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="上傳檔案"
        tabIndex={-1}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>上傳檔案{phase === 'meta' ? ' · 分類與說明' : ''}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="關閉" disabled={upload.isPending}>
            ×
          </button>
        </div>

        {phase === 'pick' ? (
          <>
            <div className="modal-body">
              <p className="sub">
                從你這台裝置挑一個檔案上傳到「{indexName}」——跟「加入索引」不同，這裡不需要
                瀏覽主機硬碟，適合共用牆上的遠端使用者。
              </p>
              <button
                type="button"
                className="btn primary"
                onClick={() => fileInputRef.current?.click()}
              >
                <UploadCloud size={16} strokeWidth={2.2} aria-hidden /> 選擇檔案…
              </button>
              <input
                ref={fileInputRef}
                type="file"
                hidden
                onChange={(e) => pick(e.target.files?.[0])}
              />
            </div>
            <div className="modal-foot">
              <span className="spacer" />
              <button className="btn" onClick={onClose}>
                取消
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="modal-body">
              <div className="ae-file">
                <File size={16} aria-hidden />
                <div>
                  <div className="ae-fname">{file!.name}</div>
                  <div className="ae-fpath mono">{sizeLabel(file!.size)}</div>
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
                  disabled={upload.isPending}
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
                  disabled={upload.isPending}
                  onChange={(e) => setDescription(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submit()}
                />
              </div>

              {upload.error && <p className="err">{upload.error.message}</p>}
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => setPhase('pick')} disabled={upload.isPending}>
                重新選檔
              </button>
              <span className="spacer" />
              <button className="btn" onClick={onClose} disabled={upload.isPending}>
                取消
              </button>
              <button className="btn primary" onClick={submit} disabled={upload.isPending}>
                {upload.isPending ? '上傳中…' : '上傳'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
