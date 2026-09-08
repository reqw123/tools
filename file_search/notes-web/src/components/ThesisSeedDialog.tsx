import { useEffect, useMemo, useRef, useState } from 'react'
import { GraduationCap } from 'lucide-react'
import { useAiTarget, useSaveGeneratedNotes, useThesisSeed } from '../hooks/useAi'

type Row = { key: string; save: boolean; title: string; tag: string; body: string }

/**
 * 研究生模式「從專案生成」——AI 讀論文專案（C:\ai_project）的幾份關鍵文件 +
 * 論文草稿，一次呼叫產出一批任務便利貼草稿。使用者逐則勾選／編輯，按「存入」
 * 一次寫進研究生便利貼（走既有的 /api/ai/save-notes，因為請求帶
 * x-note-collection: thesis，createNotes 會寫進研究生那份）。
 */
export function ThesisSeedDialog({ onClose, onDone }: { onClose: () => void; onDone: (n: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const seed = useThesisSeed()
  const save = useSaveGeneratedNotes()
  const { data: aiTarget } = useAiTarget()
  const [rows, setRows] = useState<Row[]>([])
  const started = useRef(false)

  const busy = seed.isPending || save.isPending

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', onKey)
    ref.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  useEffect(() => {
    if (started.current) return
    started.current = true
    seed.mutate(undefined, {
      onSuccess: (r) => {
        setRows(
          (r.drafts ?? []).map((d, i) => ({
            key: `d${i}`,
            save: true,
            title: d.title,
            tag: d.tag,
            body: d.body,
          })),
        )
      },
    })
  }, [seed])

  const chosen = useMemo(() => rows.filter((r) => r.save && r.title.trim()), [rows])
  const patch = (key: string, p: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)))

  const commit = () => {
    if (!chosen.length) return
    save.mutate(
      chosen.map((r) => ({ title: r.title.trim(), tag: r.tag.trim(), body: r.body })),
      { onSuccess: (created) => onDone(created.length) },
    )
  }

  return (
    <div className="scrim" onClick={() => !busy && onClose()}>
      <div
        className="sheet plain wide"
        role="dialog"
        aria-modal="true"
        aria-label="從專案生成便利貼"
        tabIndex={-1}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="icon-btn" onClick={onClose} aria-label="關閉" disabled={busy}>
          ×
        </button>
        <h2>
          <GraduationCap size={18} strokeWidth={2.2} aria-hidden /> 從論文專案生成便利貼
        </h2>

        {seed.isPending ? (
          <p className="dim mono">
            // AI 正在讀專案文件並產出任務便利貼…可能要十幾秒
            {aiTarget?.label ? `（${aiTarget.label} · ${aiTarget.model}）` : ''}
          </p>
        ) : seed.isError ? (
          <p className="err">
            生成失敗：{seed.error?.message}
            <br />
            <span className="dim">
              （需要先設定好 AI；小模型有時不照格式回，可換個模型或用 OpenAI 再試）
            </span>
          </p>
        ) : rows.length === 0 ? (
          <p className="dim">AI 沒有產出可用的便利貼草稿。</p>
        ) : (
          <>
            <p className="dim">
              勾選要留下的，可直接改標題／分類／內容。存入後就是研究生便利貼——
              跟生活便利貼分開，存在 <code>C:\ai_project</code>。
            </p>
            <div className="seed-list">
              {rows.map((r) => (
                <div key={r.key} className={`seed-row${r.save ? '' : ' off'}`}>
                  <label className="seed-check">
                    <input
                      type="checkbox"
                      checked={r.save}
                      onChange={(e) => patch(r.key, { save: e.target.checked })}
                    />
                  </label>
                  <div className="seed-fields">
                    <div className="seed-head">
                      <input
                        className="seed-title"
                        value={r.title}
                        placeholder="標題"
                        onChange={(e) => patch(r.key, { title: e.target.value })}
                      />
                      <input
                        className="seed-tag"
                        value={r.tag}
                        placeholder="分類"
                        onChange={(e) => patch(r.key, { tag: e.target.value })}
                      />
                    </div>
                    <textarea
                      className="seed-body"
                      value={r.body}
                      rows={2}
                      placeholder="內容"
                      onChange={(e) => patch(r.key, { body: e.target.value })}
                    />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="sheet-actions">
          <button className="btn ghost" onClick={onClose} disabled={busy}>
            {rows.length ? '取消' : '關閉'}
          </button>
          {rows.length > 0 && (
            <button className="btn primary" onClick={commit} disabled={busy || chosen.length === 0}>
              {save.isPending ? '存入中…' : `存入 ${chosen.length} 則`}
            </button>
          )}
        </div>
        {save.isError && <p className="err">存入失敗：{save.error?.message}</p>}
      </div>
    </div>
  )
}
