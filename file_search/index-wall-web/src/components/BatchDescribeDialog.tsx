import { useEffect, useMemo, useRef, useState } from 'react'
import { useBlankSuggestions, useBulkDescribe } from '../hooks/useIndexes'
import { useAiTarget } from '../hooks/useAi'
import { aiApi } from '../lib/ai'

const MAX_SHOWN = 300

type Row = { serial: number; path: string; name: string; category: string; on: boolean; desc: string }

/**
 * 批次補說明——對應桌面版「批次補說明…」＋ DescriptionService。找出「說明是空的、
 * 檔案還在」的項目，先用內容擷取（純文字／markdown 前 1200 字）產生建議；也可以
 * 對勾選的項目改用 **AI 產生建議**（對應桌面版 AISelectDialog + AIDescriptionService，
 * 逐檔送目前設定的 Provider）。兩種都是逐筆看過／修改／取消勾選，確認後只寫說明欄。
 */
export function BatchDescribeDialog({
  indexName,
  onClose,
  onDone,
}: {
  indexName: string
  onClose: () => void
  onDone: (updated: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const { data, isLoading, isError, error } = useBlankSuggestions(indexName, true)
  const apply = useBulkDescribe(indexName)
  const { data: aiTarget } = useAiTarget()
  const [confirming, setConfirming] = useState(false)

  const [rows, setRows] = useState<Row[]>([])
  const [seen, setSeen] = useState<typeof data>(undefined)
  if (data && data !== seen) {
    setSeen(data)
    setRows(
      data.items.map((it) => ({
        serial: it.serial,
        path: it.path,
        name: it.name,
        category: it.category,
        on: true,
        desc: it.suggestion,
      })),
    )
  }

  // ── AI 產生 ──
  const [aiConfirm, setAiConfirm] = useState(false)
  const [aiRunning, setAiRunning] = useState(false)
  const [aiProg, setAiProg] = useState({ done: 0, total: 0 })
  const [aiSummary, setAiSummary] = useState<{ ok: number; skipped: number; failed: number; err: string } | null>(null)
  const cancelRef = useRef(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !aiRunning && onClose()
    document.addEventListener('keydown', onKey)
    ref.current?.focus()
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose, aiRunning])

  // 只在整個對話框卸載時取消進行中的 AI 迴圈——不能跟上面那個 effect 合併，
  // 那個依賴 aiRunning，開始跑時 aiRunning 由 false→true 會觸發它 cleanup，
  // 把 cancelRef 設成 true，迴圈才跑一筆就停。
  useEffect(() => () => void (cancelRef.current = true), [])

  const set = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const allOn = (on: boolean) => setRows((rs) => rs.map((r) => ({ ...r, on })))

  const checked = useMemo(() => rows.filter((r) => r.on), [rows])
  const shown = rows.slice(0, MAX_SHOWN)

  const runAi = async () => {
    setAiConfirm(false)
    const targets = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.on)
    if (!targets.length) return
    cancelRef.current = false
    setAiRunning(true)
    setAiSummary(null)
    setAiProg({ done: 0, total: targets.length })
    let ok = 0
    let skipped = 0
    let failed = 0
    const errs = new Map<string, number>()
    for (let k = 0; k < targets.length; k++) {
      if (cancelRef.current) break
      const { r, i } = targets[k]
      try {
        const res = await aiApi.suggest(r.path, r.category)
        if (res.skipped) skipped++
        else if (res.error) {
          failed++
          errs.set(res.error, (errs.get(res.error) ?? 0) + 1)
        } else if (res.suggestion) {
          ok++
          set(i, { desc: res.suggestion })
        }
      } catch (e) {
        failed++
        const m = e instanceof Error ? e.message : String(e)
        errs.set(m, (errs.get(m) ?? 0) + 1)
      }
      setAiProg({ done: k + 1, total: targets.length })
    }
    setAiRunning(false)
    const errLines = [...errs.entries()]
      .slice(0, 3)
      .map(([m, n]) => `・${m}（${n} 筆）`)
      .join('\n')
    setAiSummary({ ok, skipped, failed, err: errLines })
  }

  const submit = () => {
    const updates = checked
      .map((r) => ({ serial: r.serial, path: r.path, description: r.desc.trim() }))
      .filter((u) => u.description)
    if (!updates.length || apply.isPending) return
    apply.mutate(updates, { onSuccess: (res) => onDone(res.updated) })
  }

  const t = aiTarget
  const cloudWarn = t?.provider === 'openai'

  return (
    <div className="scrim" onClick={() => !aiRunning && onClose()}>
      <div
        className="modal wide"
        role="dialog"
        aria-modal="true"
        aria-label="批次補說明"
        tabIndex={-1}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>批次補說明</h2>
          <button className="icon-btn" onClick={onClose} aria-label="關閉" disabled={aiRunning}>
            ×
          </button>
        </div>

        <div className="modal-body">
          {isLoading ? (
            <p className="fb-empty mono">// 讀取檔案內容、產生建議中…</p>
          ) : isError ? (
            <p className="fb-empty mono err">// 失敗：{error?.message}</p>
          ) : rows.length === 0 ? (
            <p className="fb-empty mono">// 這份索引集裡沒有「說明是空的、而且檔案還在」的項目</p>
          ) : (
            <>
              <div className="bd-bar">
                <span className="sub">
                  共 {rows.length} 筆說明是空的 · 已勾選 {checked.length}
                  {data?.truncated && '（超過上限，只處理前 1000 筆）'}
                </span>
                <span className="spacer" />
                <button className="btn sm" onClick={() => allOn(true)} disabled={aiRunning}>
                  全部套用
                </button>
                <button className="btn sm" onClick={() => allOn(false)} disabled={aiRunning}>
                  全部取消
                </button>
                <button
                  className="btn sm primary"
                  disabled={aiRunning || checked.length === 0}
                  title="把勾選的檔案逐筆送給目前設定的 AI，用回覆填進說明"
                  onClick={() => setAiConfirm(true)}
                >
                  🤖 用 AI 產生（{checked.length}）
                </button>
              </div>

              {aiRunning && (
                <div className="ai-progress">
                  <span>🤖 AI 產生中… {aiProg.done} / {aiProg.total}</span>
                  <span className="ai-bar">
                    <span
                      className="ai-bar-fill"
                      style={{ width: `${aiProg.total ? (aiProg.done / aiProg.total) * 100 : 0}%` }}
                    />
                  </span>
                  <button className="btn sm" onClick={() => (cancelRef.current = true)}>
                    停止
                  </button>
                </div>
              )}
              {aiSummary && !aiRunning && (
                <p className="ai-summary">
                  AI 產生完成：成功 <b>{aiSummary.ok}</b>
                  {aiSummary.skipped > 0 && ` · 沒有可摘要內容 ${aiSummary.skipped}`}
                  {aiSummary.failed > 0 && ` · 失敗 ${aiSummary.failed}`}
                  {aiSummary.err && <span className="ai-summary-err">{'\n' + aiSummary.err}</span>}
                </p>
              )}

              <div className="bd-list">
                {shown.map((r, i) => (
                  <div key={r.serial} className={`bd-card${r.on ? '' : ' off'}`}>
                    <label className="bd-card-head">
                      <input
                        type="checkbox"
                        checked={r.on}
                        disabled={aiRunning}
                        onChange={(e) => set(i, { on: e.target.checked })}
                      />
                      <span className="bd-num mono">{r.serial}</span>
                      <span className="bd-name">{r.name}</span>
                      <span className="bd-path mono">{r.path}</span>
                    </label>
                    <textarea
                      className="bd-desc"
                      value={r.desc}
                      rows={3}
                      disabled={aiRunning}
                      placeholder="（擷取不到內容——可自己填、用 AI 產生，或取消勾選）"
                      onChange={(e) => set(i, { desc: e.target.value })}
                    />
                  </div>
                ))}
                {rows.length > MAX_SHOWN && (
                  <p className="bd-trunc mono">
                    // 只顯示前 {MAX_SHOWN} 筆可編輯——其餘 {rows.length - MAX_SHOWN}{' '}
                    筆仍會依「勾選」狀態套用它們的建議文字
                  </p>
                )}
              </div>

              {apply.error && <p className="err">{apply.error.message}</p>}
            </>
          )}
        </div>

        <div className="modal-foot">
          <span className="spacer" />
          {confirming ? (
            <>
              <button className="btn primary" onClick={submit} disabled={apply.isPending}>
                {apply.isPending
                  ? '套用中…'
                  : `確定套用 ${checked.filter((r) => r.desc.trim()).length} 筆`}
              </button>
              <button className="btn" onClick={() => setConfirming(false)} disabled={apply.isPending}>
                取消
              </button>
            </>
          ) : (
            <>
              <button className="btn" onClick={onClose} disabled={aiRunning}>
                關閉
              </button>
              <button
                className="btn primary"
                disabled={aiRunning || rows.length === 0 || checked.every((r) => !r.desc.trim())}
                onClick={() => setConfirming(true)}
              >
                套用勾選項目
              </button>
            </>
          )}
        </div>
      </div>

      {aiConfirm && (
        <div className="scrim" onClick={(e) => e.stopPropagation()}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="確認送出給 AI" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{t ? `確認送出到 ${t.label}` : '確認送出給 AI'}</h2>
              <button className="icon-btn" onClick={() => setAiConfirm(false)} aria-label="關閉">
                ×
              </button>
            </div>
            <div className="modal-body">
              {!t ? (
                <p className="sub">讀取 AI 設定中…</p>
              ) : !t.configured ? (
                <p className="err">{t.reason}——請先按工具列的「⚙ AI 設定」設定好再試。</p>
              ) : (
                <>
                  <p className="sub">
                    即將把勾選的 <b>{checked.length}</b> 個檔案逐一擷取內容送出，請 AI 產生說明。
                  </p>
                  <ul className="ai-disclose">
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
                    <li className="sub">目前所有 AI 功能累計呼叫 {t.call_count} 次（僅供參考，實際費用以 Provider 帳單為準）。</li>
                  </ul>
                  <p className="sub">AI 產生的建議一樣會回到這個清單，逐筆看過／可修改，「套用」時才寫進索引。</p>
                </>
              )}
            </div>
            <div className="modal-foot">
              <span className="spacer" />
              <button className="btn" onClick={() => setAiConfirm(false)}>
                取消
              </button>
              <button
                className="btn primary"
                disabled={!t?.configured}
                onClick={runAi}
              >
                {cloudWarn ? '送到 OpenAI' : '開始產生'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
