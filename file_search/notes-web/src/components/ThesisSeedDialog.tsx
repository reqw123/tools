import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FolderOpen, GraduationCap, Package, X } from 'lucide-react'
import { useAiTarget, useSaveGeneratedNotes, useThesisSeed } from '../hooks/useAi'
import { useAppSettings } from '../hooks/useNotes'
import { FileBrowser } from './FileBrowser'
import { scrimClose } from '../lib/scrimClose'

type Row = { key: string; save: boolean; title: string; tag: string; body: string }
type Phase = 'pick' | 'browseDir' | 'browseZip' | 'running' | 'review'

/**
 * 研究生模式「從專案生成」——AI 讀一個資料夾或一個 .zip 裡最像文件的幾個檔案
 * （純文字類／.docx／.tex／.ipynb／.py／.json，見 ai_bridge._SEED_EXTS），一次呼叫產出一批任務便利貼草稿。使用者逐則勾選／
 * 編輯，按「存入」一次寫進研究生便利貼（走既有的 /api/ai/save-notes）。
 * 生成過程可按「中斷」——後端會連帶殺掉那個十幾秒的子行程。
 */
export function ThesisSeedDialog({ onClose, onDone }: { onClose: () => void; onDone: (n: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const { data: settings } = useAppSettings()
  const seed = useThesisSeed()
  const save = useSaveGeneratedNotes()
  const { data: aiTarget } = useAiTarget()

  const [phase, setPhase] = useState<Phase>('pick')
  const [source, setSource] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [usedFiles, setUsedFiles] = useState<string[]>([])
  const [aborted, setAborted] = useState(false)
  const [runErr, setRunErr] = useState('')
  const ctrl = useRef<AbortController | null>(null)

  const defaultDir = settings?.thesisProjectDir ?? ''
  const effectiveSource = source || defaultDir
  const busy = seed.isPending || save.isPending

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', onKey)
    ref.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  const run = useCallback(
    (src: string) => {
      setAborted(false)
      setRunErr('')
      setPhase('running')
      ctrl.current = new AbortController()
      seed.mutate(
        { source: src, signal: ctrl.current.signal },
        {
          onSuccess: (r) => {
            const drafts = r.drafts ?? []
            if (!drafts.length) {
              // 後端回 200 但沒產出草稿（來源沒有可讀文件、.zip 讀不了、AI 沒照格式…）
              // ——把 error 攤在選來源畫面上，讓使用者改來源／設定後直接重試。
              setRunErr(r.error || 'AI 沒有產出可用的草稿，請換個來源或稍後再試。')
              setPhase('pick')
              return
            }
            setUsedFiles(r.used_files ?? [])
            setRows(
              drafts.map((d, i) => ({
                key: `d${i}`,
                save: true,
                title: d.title,
                tag: d.tag,
                body: d.body,
              })),
            )
            setPhase('review')
          },
          onError: (e) => {
            // AbortError → 回到來源選擇，標「已中斷」，不當成錯誤
            if (e instanceof DOMException && e.name === 'AbortError') {
              setAborted(true)
            } else {
              setRunErr(e instanceof Error ? e.message : String(e))
            }
            setPhase('pick')
          },
        },
      )
    },
    [seed],
  )

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
    <div className="scrim" {...scrimClose(() => { if (!busy) onClose() })}>
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
          <GraduationCap size={18} strokeWidth={2.2} aria-hidden /> 從專案生成便利貼
        </h2>

        {/* ── 選來源 ── */}
        {phase === 'pick' && (
          <>
            <p className="dim">
              選一個資料夾或一個 <code>.zip</code>，AI 會挑出裡面最像文件的幾個檔案
              （<code>.md</code>／<code>.markdown</code>／<code>.txt</code>／<code>.rst</code>／
              <code>.docx</code>／<code>.tex</code>／<code>.ipynb</code>／<code>.org</code>／
              <code>.py</code>／<code>.json</code>）產出任務便利貼草稿。
            </p>
            {aborted && <p className="err">已中斷上一次生成。</p>}
            {runErr && <p className="err">生成失敗：{runErr}</p>}
            <label className="seed-source">
              <span>來源</span>
              <input
                value={effectiveSource}
                placeholder="資料夾或 .zip 的完整路徑"
                onChange={(e) => {
                  setSource(e.target.value)
                  setRunErr('')
                }}
              />
            </label>
            <div className="sheet-actions">
              <button className="btn ghost" onClick={() => setPhase('browseDir')}>
                <FolderOpen size={14} aria-hidden /> 換資料夾…
              </button>
              <button className="btn ghost" onClick={() => setPhase('browseZip')}>
                <Package size={14} aria-hidden /> 選 .zip…
              </button>
              <span className="grow" />
              <button className="btn ghost" onClick={onClose}>
                取消
              </button>
              <button
                className="btn primary"
                onClick={() => run(effectiveSource)}
                disabled={!effectiveSource.trim()}
              >
                開始生成
              </button>
            </div>
          </>
        )}

        {/* ── 瀏覽資料夾 / .zip ── */}
        {(phase === 'browseDir' || phase === 'browseZip') && (
          <>
            <p className="dim">
              {phase === 'browseDir' ? '進到要當來源的資料夾，按「用這個資料夾」。' : '選一個 .zip 檔（雙擊直接用）。'}
            </p>
            <FileBrowser
              mode={phase === 'browseDir' ? 'dir' : 'file'}
              fileExts={phase === 'browseZip' ? ['.zip'] : undefined}
              onPick={(p) => {
                if (phase === 'browseDir' && p) {
                  setSource(p)
                  setRunErr('')
                } else if (phase === 'browseZip' && p && p.toLowerCase().endsWith('.zip')) {
                  setSource(p)
                  setRunErr('')
                }
              }}
              onPickImmediate={(p) => {
                if (p.toLowerCase().endsWith('.zip')) {
                  setSource(p)
                  setRunErr('')
                  setPhase('pick')
                }
              }}
            />
            <div className="sheet-actions">
              <span className="grow" />
              <button className="btn ghost" onClick={() => setPhase('pick')}>
                返回
              </button>
              <button
                className="btn primary"
                onClick={() => setPhase('pick')}
                disabled={
                  phase === 'browseDir'
                    ? !source.trim()
                    : !source.toLowerCase().endsWith('.zip')
                }
              >
                {phase === 'browseDir' ? '用這個資料夾' : '用這個 .zip'}
              </button>
            </div>
          </>
        )}

        {/* ── 生成中 ── */}
        {phase === 'running' && (
          <>
            <p className="dim mono">
              // AI 正在讀 {effectiveSource} 的文件並產出任務便利貼…可能要十幾秒
              {aiTarget?.label ? `（${aiTarget.label} · ${aiTarget.model}）` : ''}
            </p>
            <div className="sheet-actions">
              <span className="grow" />
              <button
                className="btn ghost"
                onClick={() => ctrl.current?.abort()}
              >
                <X size={14} aria-hidden /> 中斷
              </button>
            </div>
          </>
        )}

        {/* ── 審核草稿 ── */}
        {phase === 'review' && (
          <>
            {seed.data?.error ? (
              <p className="err">
                {seed.data.error}
                <br />
                <span className="dim">
                  （小模型有時不照 JSON 格式回，可換文字模型或用 OpenAI 再試）
                </span>
              </p>
            ) : rows.length === 0 ? (
              <p className="dim">AI 沒有產出可用的草稿。</p>
            ) : (
              <>
                <p className="dim">
                  讀了 {usedFiles.length} 個檔案（{usedFiles.slice(0, 4).join('、')}
                  {usedFiles.length > 4 ? ' …' : ''}）。勾選要留下的，可直接改，存入後就是研究生便利貼。
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
              <button className="btn ghost" onClick={() => setPhase('pick')} disabled={busy}>
                重新選來源
              </button>
              <span className="grow" />
              <button className="btn ghost" onClick={onClose} disabled={busy}>
                關閉
              </button>
              {rows.length > 0 && (
                <button className="btn primary" onClick={commit} disabled={busy || chosen.length === 0}>
                  {save.isPending ? '存入中…' : `存入 ${chosen.length} 則`}
                </button>
              )}
            </div>
            {save.isError && <p className="err">存入失敗：{save.error?.message}</p>}
          </>
        )}
      </div>
    </div>
  )
}
