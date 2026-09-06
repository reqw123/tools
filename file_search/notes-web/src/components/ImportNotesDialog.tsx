import { useEffect, useRef, useState } from 'react'
import { useImportNotesJson } from '../hooks/useNotes'

/**
 * 匯入便利貼資料——讀取用「💾 匯出資料」（或桌面版「💾 匯出資料」，格式
 * 互通）匯出的 JSON，合併進目前清單。依 id 判斷是否已存在，已經匯入過的
 * 會自動略過，不會產生重複的便利貼（見 server/store.ts 的 importNotesJson）。
 */
export function ImportNotesDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const importJson = useImportNotesJson()
  const [fileName, setFileName] = useState('')
  const [readErr, setReadErr] = useState('')
  const [result, setResult] = useState<{ added: number; skipped: number } | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !importJson.isPending && onClose()
    document.addEventListener('keydown', onKey)
    ref.current?.focus()
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose, importJson.isPending])

  const pickFile = () => fileRef.current?.click()

  const onFileChosen = async (file: File) => {
    setFileName(file.name)
    setReadErr('')
    setResult(null)
    let content: string
    try {
      content = await file.text()
    } catch (err) {
      setReadErr(err instanceof Error ? err.message : String(err))
      return
    }
    importJson.mutate(content, {
      onSuccess: (r) => setResult(r),
    })
  }

  const busy = importJson.isPending

  return (
    <div className="scrim" onClick={() => !busy && onClose()}>
      <div
        className="sheet plain"
        role="dialog"
        aria-modal="true"
        aria-label="匯入便利貼資料"
        tabIndex={-1}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="icon-btn" onClick={onClose} aria-label="關閉" disabled={busy}>
          ×
        </button>
        <h2>匯入便利貼資料</h2>
        <p className="dim">
          選一份先前用「💾 匯出資料」匯出的 JSON（桌面版匯出的也可以，格式互通），
          內容會合併進目前的便利貼清單。已經匯入過的（相同 id）會自動略過，不會重複。
        </p>

        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = '' // 允許重選同一個檔案也能再次觸發 onChange
            if (file) void onFileChosen(file)
          }}
        />
        <div className="sheet-actions" style={{ justifyContent: 'flex-start' }}>
          <button className="btn" onClick={pickFile} disabled={busy}>
            {busy ? '匯入中…' : '選擇 JSON 檔案...'}
          </button>
          {fileName && <span className="dim mono">{fileName}</span>}
        </div>

        {readErr && <p className="err">讀取檔案失敗：{readErr}</p>}
        {importJson.error && <p className="err">{importJson.error.message}</p>}
        {result && (
          <p className="dim">
            已新增 <b>{result.added}</b> 則便利貼。
            {result.skipped > 0 && <>{result.skipped} 則跟目前清單重複（相同 id），已略過。</>}
          </p>
        )}

        <div className="sheet-actions">
          <button className="btn ghost" onClick={onClose} disabled={busy}>
            {result ? '完成' : '取消'}
          </button>
        </div>
      </div>
    </div>
  )
}
