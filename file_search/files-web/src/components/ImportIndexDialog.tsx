import { useEffect, useMemo, useRef, useState } from 'react'
import { FileText } from 'lucide-react'
import { useImportIndex } from '../hooks/useIndexes'

const INVALID_CHARS = new Set('<>:"/\\|?*')

/** 跟後端 `validateIndexName()` 對齊的即時檢查——後端仍是最後一道防線
 *  （撞名這件事光看前端手上的清單，跟另一個分頁/行程同時新增時還是可能
 *  過期），但打字當下就能即時回饋，不用等送出才知道不合法。 */
function validate(raw: string, existing: string[]): { filename: string | null; error: string | null } {
  const name = raw.trim()
  if (!name) return { filename: null, error: '請輸入索引集名稱' }
  if (name === '.' || name === '..') return { filename: null, error: '不是合法的檔名' }
  const bad = [...new Set([...name].filter((c) => INVALID_CHARS.has(c)))].sort()
  if (bad.length) return { filename: null, error: `檔名不能包含：${bad.join(' ')}` }
  const filename = name.toLowerCase().endsWith('.md') ? name : `${name}.md`
  if (filename.length <= 3) return { filename: null, error: '請輸入索引集名稱' }
  if (existing.some((n) => n.toLowerCase() === filename.toLowerCase())) {
    return { filename: null, error: `「${filename}」已經存在，換個名稱` }
  }
  return { filename, error: null }
}

/**
 * 匯入索引集——把一份外部既有的 .md（例如從另一台電腦複製過來、或用「匯出
 * 索引集」存出去的檔案）帶進來，變成一份新的索引集。填補這個 app 原本刻意
 * 不做「索引集層級建立」的缺口（見 docs/adr/0003），跟桌面版「📥 匯入索引
 * 集...」對應。
 */
export function ImportIndexDialog({
  existingNames,
  onClose,
  onDone,
}: {
  existingNames: string[]
  onClose: () => void
  onDone: (name: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const importIndex = useImportIndex()

  const [fileName, setFileName] = useState('')
  const [content, setContent] = useState<string | null>(null)
  const [readErr, setReadErr] = useState('')
  const [name, setName] = useState('')

  const { filename, error } = useMemo(() => validate(name, existingNames), [name, existingNames])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !importIndex.isPending && onClose()
    document.addEventListener('keydown', onKey)
    ref.current?.focus()
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose, importIndex.isPending])

  const pickFile = () => fileRef.current?.click()

  const onFileChosen = async (file: File) => {
    setReadErr('')
    setContent(null)
    try {
      const text = await file.text()
      setContent(text)
      setFileName(file.name)
      setName(file.name.replace(/\.md$/i, ''))
    } catch (err) {
      setReadErr(err instanceof Error ? err.message : String(err))
    }
  }

  const submit = () => {
    if (!filename || content === null || importIndex.isPending) return
    importIndex.mutate(
      { name: filename, content },
      { onSuccess: (r) => onDone(r.name) },
    )
  }

  const busy = importIndex.isPending

  return (
    <div className="scrim" onClick={() => !busy && onClose()}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="匯入索引集"
        tabIndex={-1}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>匯入索引集</h2>
          <button className="icon-btn" onClick={onClose} aria-label="關閉" disabled={busy}>
            ×
          </button>
        </div>

        <div className="modal-body">
          <p className="sub">
            選一份既有的 .md 檔案（例如從另一台電腦複製過來、或用「匯出索引集」存出去的檔案），
            內容會原封不動存成一份新的索引集。
          </p>

          <input
            ref={fileRef}
            type="file"
            accept=".md,text/markdown"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) void onFileChosen(file)
            }}
          />
          <button className="btn" onClick={pickFile} disabled={busy}>
            選擇 .md 檔案...
          </button>
          {readErr && <p className="err">讀取檔案失敗：{readErr}</p>}

          {content !== null && (
            <>
              <div className="ae-file">
                <FileText size={16} aria-hidden />
                <div className="ae-fname">{fileName}</div>
              </div>

              <div className="field-block">
                <label htmlFor="import-index-name">
                  名稱 <span className="sub">不用打 .md，會自動補上</span>
                </label>
                <input
                  id="import-index-name"
                  value={name}
                  maxLength={200}
                  autoFocus
                  disabled={busy}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && filename && submit()}
                />
                <p className={error ? 'err' : 'sub'}>{error ?? `將建立：${filename}`}</p>
              </div>
            </>
          )}

          {importIndex.error && <p className="err">{importIndex.error.message}</p>}
        </div>

        <div className="modal-foot">
          <span className="spacer" />
          <button className="btn" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button className="btn primary" onClick={submit} disabled={busy || !filename || content === null}>
            {busy ? '匯入中…' : '匯入'}
          </button>
        </div>
      </div>
    </div>
  )
}
