import { useEffect, useState } from 'react'

/** 路徑太長就留尾巴——正在讀哪個子資料夾，資訊都在最後面。 */
function tail(p: string, max = 64): string {
  return p.length <= max ? p : `…${p.slice(-(max - 1))}`
}

/**
 * 進度條。`value` 是 0–1 就畫實際比例；不給（`undefined`）就畫來回滑動的「不定長」
 * 條——遞迴掃描事先不可能知道總共有幾個檔案，硬湊一個百分比只會騙人，
 * 所以靠下面即時跳動的計數讓使用者知道「真的還在動」。
 *
 * 另外顯示已經花了幾秒：計數一直在跳＝沒當機，這個秒數是給「計數跳得很快、
 * 但整體要好幾十秒」的情況一個時間感。
 */
export function ProgressBar({
  label,
  value,
  detail,
  current,
  onCancel,
}: {
  label: string
  value?: number
  /** 進度條下面那行即時計數（例如「已檢視 12,345 個項目・符合 812 個」）。 */
  detail?: string
  /** 正在處理的資料夾（等寬字、超長從頭截掉）。 */
  current?: string
  onCancel?: () => void
}) {
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    const t0 = Date.now()
    const id = setInterval(() => setSecs(Math.floor((Date.now() - t0) / 1000)), 1000)
    return () => clearInterval(id)
  }, [])

  const determinate = value !== undefined
  const pct = determinate ? Math.round(Math.min(1, Math.max(0, value)) * 100) : undefined

  return (
    <div className="progress" aria-busy="true">
      <div className="progress-head">
        <span className="progress-label">{label}</span>
        <span className="progress-meta">
          {pct !== undefined && <b>{pct}%</b>}
          {secs >= 2 && <span>已 {secs} 秒</span>}
        </span>
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel}>
            取消
          </button>
        )}
      </div>
      <div
        className={`progress-track${determinate ? '' : ' indeterminate'}`}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div className="progress-fill" style={determinate ? { width: `${pct}%` } : undefined} />
      </div>
      {detail && <div className="progress-detail">{detail}</div>}
      {current && <div className="progress-current mono">{tail(current)}</div>}
    </div>
  )
}
