import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { useScan, useScanCategories } from '../hooks/useFiles'
import { useAiTarget, useSaveGeneratedNotes } from '../hooks/useAi'
import { aiApi, type NoteDraft } from '../lib/ai'
import { humanSize } from '../lib/format'
import { FileBrowser } from './FileBrowser'
import { TagInput } from './TagInput'

type ScannedFile = { path: string; name: string; size: number; ext: string }
type DraftRow = { key: string; source: ScannedFile; save: boolean; title: string; tag: string; body: string }

/**
 * 「AI 生成便利貼」——便利貼牆自己掌控這個功能，不用再切去檔案索引網頁：
 * ①選資料夾＋類型篩選＋掃描（跟桌面版「匯入資料夾」同一套挑檔模式，只是
 *   這裡挑出來的檔案是要送給 AI 分析，不是要匯入索引）
 * ②勾選要送出的檔案（預設全部不勾選）→ 送出前確認（去向／模型／累計次數）
 *   → 逐檔呼叫 `/ai/generate-note` 生成標題／標籤／內容草稿
 * ③審核／編輯草稿（可改可取消勾選）→ 「儲存」一次呼叫 `/ai/save-notes`
 *   寫進 `.sticky_notes.json`——這一步直接呼叫這個 server 本來就有的
 *   `createNotes()`，不需要 Python；只有②的生成本身需要呼叫 AI，才會經
 *   `server/ai_bridge.py` 去用桌面版的 `StickyNoteService` prompt。
 */
export function GenerateNotesDialog({
  knownTags,
  onClose,
  onDone,
}: {
  knownTags: string[]
  onClose: () => void
  onDone: (saved: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const { data: scanCats } = useScanCategories()
  const scan = useScan()
  const { data: aiTarget } = useAiTarget()
  const save = useSaveGeneratedNotes()

  const meta = useMemo(() => {
    const m = new Map<string, { icon: string; color: string }>()
    for (const c of scanCats ?? []) m.set(c.label, { icon: c.icon, color: c.color })
    m.set('其他', { icon: '📁', color: '#94a3b8' })
    return m
  }, [scanCats])
  const colorFor = (label: string) => meta.get(label)?.color ?? '#64748b'
  const iconFor = (label: string) => meta.get(label)?.icon ?? '📄'

  const [phase, setPhase] = useState<'folder' | 'filter' | 'review'>('folder')
  const [dir, setDir] = useState<string | null>(null)
  const [folder, setFolder] = useState('')
  const [recursive, setRecursive] = useState(false)
  const [types, setTypes] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [checked, setChecked] = useState<Set<string>>(new Set())

  const [aiConfirm, setAiConfirm] = useState(false)
  const [aiRunning, setAiRunning] = useState(false)
  const [aiProg, setAiProg] = useState({ done: 0, total: 0 })
  const [aiSummary, setAiSummary] = useState<{ skipped: number; failed: number; err: string } | null>(null)
  const cancelRef = useRef(false)

  const [rows, setRows] = useState<DraftRow[]>([])
  const [reviewQuery, setReviewQuery] = useState('')
  const [saveErr, setSaveErr] = useState('')

  const busy = aiRunning || save.isPending

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

  useEffect(() => () => void (cancelRef.current = true), [])

  const invalidateScan = () => scan.reset()
  const toggleType = (t: string) => {
    setTypes((s) => {
      const n = new Set(s)
      if (n.has(t)) n.delete(t)
      else n.add(t)
      return n
    })
    invalidateScan()
  }

  const result = scan.data
  const runScan = () => {
    if (folder) scan.mutate({ dir: folder, recursive, categories: [...types] })
  }

  const matched = useMemo(() => {
    if (!result) return []
    const q = query.trim().toLowerCase()
    if (!q) return result.files
    return result.files.filter((f) => `${f.name}\n${f.path}`.toLowerCase().includes(q))
  }, [result, query])

  const toggleFile = (path: string) =>
    setChecked((s) => {
      const n = new Set(s)
      if (n.has(path)) n.delete(path)
      else n.add(path)
      return n
    })
  const checkMatched = () => setChecked((s) => new Set([...s, ...matched.map((f) => f.path)]))
  const clearAll = () => setChecked(new Set())

  const n = checked.size

  const runAi = async () => {
    setAiConfirm(false)
    const targets = (result?.files ?? []).filter((f) => checked.has(f.path))
    if (!targets.length) return
    cancelRef.current = false
    setAiRunning(true)
    setAiSummary(null)
    setAiProg({ done: 0, total: targets.length })
    const drafts: DraftRow[] = []
    let skipped = 0
    let failed = 0
    const errs = new Map<string, number>()
    for (let k = 0; k < targets.length; k++) {
      if (cancelRef.current) break
      const f = targets[k]
      try {
        const res = await aiApi.generateNote(f.path, '')
        if (res.skipped) skipped++
        else if (res.error) {
          failed++
          errs.set(res.error, (errs.get(res.error) ?? 0) + 1)
        } else if (res.draft) {
          drafts.push({
            key: f.path, source: f, save: true,
            title: res.draft.title, tag: res.draft.tag, body: res.draft.body,
          })
        }
      } catch (err) {
        failed++
        const m = err instanceof Error ? err.message : String(err)
        errs.set(m, (errs.get(m) ?? 0) + 1)
      }
      setAiProg({ done: k + 1, total: targets.length })
    }
    setAiRunning(false)
    const errLines = [...errs.entries()].slice(0, 3).map(([m, c]) => `・${m}（${c} 筆）`).join('\n')
    setAiSummary({ skipped, failed, err: errLines })
    setRows(drafts)
    setReviewQuery('')
    if (drafts.length) setPhase('review')
  }

  const setRow = (key: string, patch: Partial<DraftRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const checkAllRows = (v: boolean) => setRows((rs) => rs.map((r) => ({ ...r, save: v })))

  const toSave = rows.filter((r) => r.save && r.title.trim())
  const matchedRows = useMemo(() => {
    const q = reviewQuery.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) =>
      `${r.title}\n${r.tag}\n${r.body}\n${r.source.name}\n${r.source.path}`.toLowerCase().includes(q),
    )
  }, [rows, reviewQuery])

  const runSave = () => {
    if (!toSave.length || save.isPending) return
    setSaveErr('')
    const items: NoteDraft[] = toSave.map((r) => ({
      title: r.title.trim(), body: r.body.trim(), tag: r.tag.trim(),
    }))
    save.mutate(items, {
      onSuccess: (created) => {
        setRows((rs) => rs.filter((r) => !toSave.some((s) => s.key === r.key)))
        onDone(created.length)
        if (rows.length === toSave.length) onClose()
      },
      onError: (err) => setSaveErr(err instanceof Error ? err.message : String(err)),
    })
  }

  const t = aiTarget
  const cloudWarn = t?.provider === 'openai'

  return (
    <div className="scrim" onClick={() => !busy && onClose()}>
      <div
        className="sheet plain wide"
        role="dialog"
        aria-modal="true"
        aria-label="AI 生成便利貼"
        tabIndex={-1}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="icon-btn" onClick={onClose} aria-label="關閉" disabled={busy}>
          ×
        </button>
        <h2>
          AI 生成便利貼
          {phase === 'filter' ? ' · 選檔案' : phase === 'review' ? ' · 審核草稿' : ' · 選資料夾'}
        </h2>

        {phase === 'folder' && (
          <>
            <p className="dim">
              先選一個資料夾，接下來可以篩選檔案類型、掃描出候選清單，勾選要送給 AI 分析的檔案。
            </p>
            <FileBrowser mode="dir" onPick={setDir} />
            <div className="sheet-actions">
              <button
                className="btn"
                disabled={!dir}
                onClick={() => {
                  if (dir) {
                    setFolder(dir)
                    setPhase('filter')
                  }
                }}
              >
                下一步
              </button>
              <button className="btn ghost" onClick={onClose}>
                取消
              </button>
            </div>
          </>
        )}

        {phase === 'filter' && (
          <>
            <div className="ae-file">
              <FolderOpen size={16} aria-hidden />
              <div className="ae-fname mono">{folder}</div>
            </div>

            <label className="bi-check">
              <input
                type="checkbox"
                checked={recursive}
                onChange={(e) => {
                  setRecursive(e.target.checked)
                  invalidateScan()
                }}
              />
              包含子資料夾
            </label>

            <div className="field-block">
              <label>
                檔案類型 <span className="dim">點選要收錄的類型；都不選＝收錄全部</span>
              </label>
              <div className="type-grid">
                {(scanCats ?? []).map((c) => (
                  <button
                    key={c.label}
                    type="button"
                    className={`type-btn${types.has(c.label) ? ' on' : ''}`}
                    style={{ '--tc': c.color } as CSSProperties}
                    aria-pressed={types.has(c.label)}
                    onClick={() => toggleType(c.label)}
                  >
                    <span className="type-ico" aria-hidden>
                      {c.icon}
                    </span>
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="bi-scan">
              <button className="btn ghost sm" onClick={runScan} disabled={scan.isPending}>
                {scan.isPending ? '掃描中…' : '掃描'}
              </button>
              {scan.error && <span className="err">{scan.error.message}</span>}
              {result && !scan.isPending && (
                <span className={`bi-result${result.truncated ? ' warn' : ''}`}>
                  {result.truncated ? (
                    '掃到的檔案超過安全上限（1000），結果不完整——請縮小範圍或加類型篩選後重新掃描'
                  ) : (
                    <>
                      找到 <b>{result.files.length}</b> 個檔案
                    </>
                  )}
                </span>
              )}
            </div>

            {result && !result.truncated && (
              <div className="cat-pills">
                {result.categoryCounts.map((c) => (
                  <span
                    key={c.label}
                    className={`cat-pill${c.count === 0 ? ' zero' : ''}`}
                    style={{ '--tc': colorFor(c.label) } as CSSProperties}
                  >
                    <span aria-hidden>{iconFor(c.label)}</span>
                    {c.label}
                    <b>{c.count}</b>
                  </span>
                ))}
              </div>
            )}

            {result && !result.truncated && result.files.length > 0 && (
              <>
                <div className="bd-controls">
                  <input
                    type="search"
                    className="bd-search"
                    value={query}
                    placeholder="搜尋檔名、路徑…"
                    onChange={(e) => setQuery(e.target.value)}
                    disabled={aiRunning}
                  />
                  <span className="dim mono">
                    {query ? `符合 ${matched.length} / ${result.files.length}` : `共 ${result.files.length}`}
                    　·　已勾選 {n}
                  </span>
                  <button type="button" className="btn ghost sm" onClick={checkMatched} disabled={aiRunning}>
                    勾選目前顯示
                  </button>
                  <button type="button" className="btn ghost sm" onClick={clearAll} disabled={aiRunning}>
                    全部取消
                  </button>
                </div>

                {aiRunning && (
                  <div className="ai-progress">
                    <span className="ai-progress-icon" aria-hidden>
                      🤖
                    </span>
                    <span>
                      AI 生成中… {aiProg.done} / {aiProg.total}
                    </span>
                    <span className="ai-bar">
                      <span
                        className="ai-bar-fill"
                        style={{ width: `${aiProg.total ? (aiProg.done / aiProg.total) * 100 : 0}%` }}
                      />
                    </span>
                    <span className="ai-progress-pct">
                      {aiProg.total ? Math.round((aiProg.done / aiProg.total) * 100) : 0}%
                    </span>
                    <button className="btn ghost sm" onClick={() => (cancelRef.current = true)}>
                      停止
                    </button>
                  </div>
                )}
                {aiSummary && !aiRunning && rows.length === 0 && (
                  <p className="ai-summary">
                    沒有成功產生任何便利貼草稿（{aiSummary.skipped} 筆沒有可分析的內容、{aiSummary.failed} 筆失敗）。
                    {aiSummary.err && <span className="ai-summary-err">{'\n' + aiSummary.err}</span>}
                  </p>
                )}

                <div className="gn-file-list">
                  {matched.map((f) => (
                    <label key={f.path} className="gn-file-row">
                      <input
                        type="checkbox"
                        checked={checked.has(f.path)}
                        disabled={aiRunning}
                        onChange={() => toggleFile(f.path)}
                      />
                      <span className="gn-file-name">{f.name}</span>
                      <span className="gn-file-size mono">{humanSize(f.size)}</span>
                      <span className="gn-file-path mono">{f.path}</span>
                    </label>
                  ))}
                </div>
              </>
            )}

            <div className="sheet-actions">
              <button className="btn ghost" onClick={() => setPhase('folder')} disabled={aiRunning}>
                重新選資料夾
              </button>
              <button
                className="btn"
                disabled={aiRunning || n === 0}
                onClick={() => setAiConfirm(true)}
              >
                🤖 生成便利貼（{n}）
              </button>
              <button className="btn ghost" onClick={onClose} disabled={aiRunning}>
                取消
              </button>
            </div>
          </>
        )}

        {phase === 'review' && (
          <>
            <p className="dim">
              共 {rows.length} 則便利貼草稿——請逐則看過／修改，取消勾選的不會儲存。標題／標籤／內容都可以直接改。
            </p>
            {aiSummary && (aiSummary.skipped > 0 || aiSummary.failed > 0) && (
              <p className="ai-summary">
                另有 {aiSummary.skipped} 筆沒有可分析的內容、{aiSummary.failed} 筆失敗，未列入這份草稿清單。
                {aiSummary.err && <span className="ai-summary-err">{'\n' + aiSummary.err}</span>}
              </p>
            )}

            <div className="bd-controls">
              <input
                type="search"
                className="bd-search"
                value={reviewQuery}
                placeholder="搜尋標題、標籤、內容、來源檔名…"
                onChange={(e) => setReviewQuery(e.target.value)}
                disabled={save.isPending}
              />
              <span className="dim mono">
                {reviewQuery ? `符合 ${matchedRows.length} / ${rows.length}` : `共 ${rows.length}`}
                　·　已勾選 {toSave.length}
              </span>
              <button className="btn ghost sm" onClick={() => checkAllRows(true)} disabled={save.isPending}>
                全部儲存
              </button>
              <button className="btn ghost sm" onClick={() => checkAllRows(false)} disabled={save.isPending}>
                全部取消
              </button>
            </div>

            <div className="gn-file-list" style={{ maxHeight: '50vh' }}>
              {rows.length === 0 && <p className="fb-empty mono">// 草稿都已經處理完了</p>}
              {rows.length > 0 && matchedRows.length === 0 && (
                <p className="fb-empty mono">// 沒有符合的項目</p>
              )}
              {matchedRows.map((r) => (
                <div key={r.key} className={`gn-card${r.save ? '' : ' off'}`}>
                  <label className="gn-card-head">
                    <input
                      type="checkbox"
                      checked={r.save}
                      disabled={save.isPending}
                      onChange={(e) => setRow(r.key, { save: e.target.checked })}
                    />
                    <span className="gn-source">來源：{r.source.name}　·　{r.source.path}</span>
                  </label>
                  <div className="gn-fields">
                    <input
                      className="gn-title"
                      value={r.title}
                      disabled={save.isPending}
                      placeholder="標題"
                      maxLength={200}
                      onChange={(e) => setRow(r.key, { title: e.target.value })}
                    />
                    <TagInput
                      className="gn-tag"
                      value={r.tag}
                      onChange={(v) => setRow(r.key, { tag: v })}
                      knownTags={knownTags}
                      disabled={save.isPending}
                      placeholder="標籤（可留空）"
                      maxLength={60}
                    />
                  </div>
                  <textarea
                    className="gn-body"
                    value={r.body}
                    rows={4}
                    disabled={save.isPending}
                    onChange={(e) => setRow(r.key, { body: e.target.value })}
                  />
                </div>
              ))}
            </div>

            {saveErr && <p className="err">{saveErr}</p>}

            <div className="sheet-actions">
              <button className="btn ghost" onClick={() => setPhase('filter')} disabled={save.isPending}>
                回上一步
              </button>
              <button className="btn" disabled={save.isPending || toSave.length === 0} onClick={runSave}>
                {save.isPending ? '儲存中…' : `📌 儲存勾選項目（${toSave.length}）`}
              </button>
              <button className="btn ghost" onClick={onClose} disabled={save.isPending}>
                關閉
              </button>
            </div>
          </>
        )}
      </div>

      {aiConfirm && (
        <div className="scrim" onClick={(e) => e.stopPropagation()}>
          <div
            className="sheet plain"
            role="dialog"
            aria-modal="true"
            aria-label="確認送出給 AI"
            onClick={(e) => e.stopPropagation()}
          >
            <button className="icon-btn" onClick={() => setAiConfirm(false)} aria-label="關閉">
              ×
            </button>
            <h2>{t ? `確認送出到 ${t.label}` : '確認送出給 AI'}</h2>
            {!t ? (
              <p className="dim">讀取 AI 設定中…</p>
            ) : !t.configured ? (
              <p className="err">{t.reason}——請先按工具列的設定圖示設定好再試。</p>
            ) : (
              <>
                <p className="dim">
                  即將把勾選的 <b>{n}</b> 個檔案逐一擷取內容送出，請 AI 生成便利貼草稿。
                </p>
                <ul className="gn-disclose">
                  <li>送往：{t.label}</li>
                  <li>模型：{t.model}</li>
                  <li className="mono">位址：{t.endpoint}</li>
                  <li>
                    {cloudWarn ? (
                      <b className="ai-warn">⚠️ 這是雲端服務，內容會離開這台電腦，且每次呼叫可能計費。</b>
                    ) : t.lan ? (
                      '這是區網內另一台電腦上的 Ollama——內容會透過區網傳過去，但不上網際網路、不計費。'
                    ) : (
                      '這是本機服務，內容不會離開這台電腦。'
                    )}
                  </li>
                  <li className="dim">
                    目前所有 AI 功能累計呼叫 {t.call_count} 次（僅供參考，實際費用以 Provider 帳單為準）。
                  </li>
                </ul>
                <p className="dim">生成的草稿會逐則列出來，可以修改標題／標籤／內容，勾選要存的才會真的寫進便利貼牆。</p>
              </>
            )}
            <div className="sheet-actions">
              <button className="btn" disabled={!t?.configured} onClick={runAi}>
                {cloudWarn ? '送到 OpenAI' : '開始生成'}
              </button>
              <button className="btn ghost" onClick={() => setAiConfirm(false)}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
