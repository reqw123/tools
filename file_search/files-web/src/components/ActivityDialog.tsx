import { useEffect, useRef } from 'react'
import { useActivity } from '../hooks/useActivity'
import { displayAuthor } from '../lib/identity'
import { timeAgo } from '../lib/format'
import { scrimClose } from '../lib/scrimClose'
import { ACTIVITY_NO_TARGET, ACTIVITY_VERB } from '../lib/activityLabels'

/**
 * 「誰動了這份索引」——最近的新增／編輯／移除記錄。純記憶體（見
 * server/activity.ts），server 重開就清空；只是提示性資訊，不是稽核紀錄。
 * 搬自 notes-web/src/components/ActivityDialog.tsx，改用 files-web 既有的
 * `.modal` 對話框慣例（不是 notes-web 的 `.sheet`）。
 */
export function ActivityDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const { data: entries, isLoading, isError } = useActivity(100)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    ref.current?.focus()
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  return (
    <div className="scrim" {...scrimClose(onClose)}>
      <div
        className="modal wide"
        role="dialog"
        aria-modal="true"
        aria-label="動態"
        tabIndex={-1}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>動態</h2>
          <button className="icon-btn" onClick={onClose} aria-label="關閉">
            ×
          </button>
        </div>

        <div className="modal-body">
          <p className="sub">
            最近誰新增／改／移除了什麼、誰連線／斷線——只記這台 server 開著這段
            期間的（重開就清空），純提示用，不是完整稽核紀錄。桌面版的改動不會
            出現在這裡。
          </p>

          {isLoading ? (
            <p className="sub">// 讀取中…</p>
          ) : isError ? (
            <p className="err">讀取動態失敗。</p>
          ) : (
            <ul className="activity-list">
              {(entries ?? []).map((e, i) => (
                <li key={`${e.at}-${i}`}>
                  <span className="activity-line">
                    {displayAuthor(e.author)} {ACTIVITY_VERB[e.action] ?? e.action}
                    {ACTIVITY_NO_TARGET.has(e.action)
                      ? ''
                      : e.count
                        ? ` ${e.count} 筆`
                        : `「${e.title || e.indexName || '(無標題)'}」`}
                  </span>
                  <span className="activity-time">{timeAgo(e.at)}</span>
                </li>
              ))}
              {(entries ?? []).length === 0 && <li className="sub">目前沒有任何記錄</li>}
            </ul>
          )}
        </div>

        <div className="modal-foot">
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            關閉
          </button>
        </div>
      </div>
    </div>
  )
}
