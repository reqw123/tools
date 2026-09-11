import { useEffect, useRef } from 'react'
import { useActivity } from '../hooks/useActivity'
import { displayAuthor } from '../lib/identity'
import { timeAgo } from '../lib/format'
import { scrimClose } from '../lib/scrimClose'

const VERB: Record<string, string> = {
  create: '新增了',
  update: '編輯了',
  delete: '刪除了',
  restore: '復原了',
  'bulk-delete': '批次刪除了',
  connect: '已連線',
  disconnect: '已斷線',
}
const NO_TARGET = new Set(['connect', 'disconnect'])

/**
 * 「誰動了我的牆」——最近的新增／編輯／刪除／復原記錄。純記憶體（見
 * server/activity.ts），server 重開就清空；只是提示性資訊，不是稽核紀錄。
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
        className="sheet plain wide"
        role="dialog"
        aria-modal="true"
        aria-label="動態"
        tabIndex={-1}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="icon-btn" onClick={onClose} aria-label="關閉">
          ×
        </button>
        <h2>動態</h2>
        <p className="dim">
          最近誰新增／改／刪了什麼、誰連線／斷線——只記這台 server 開著這段期間的
          （重開就清空），純提示用，不是完整稽核紀錄。桌面版的改動不會出現在這裡。
        </p>

        {isLoading ? (
          <p className="dim mono">// 讀取中…</p>
        ) : isError ? (
          <p className="err">讀取動態失敗。</p>
        ) : (
          <ul className="bd-list">
            {(entries ?? []).map((e, i) => (
              <li key={`${e.at}-${i}`}>
                <div className="tr-row">
                  <div>
                    <span className="bd-title">
                      {displayAuthor(e.author)} {VERB[e.action] ?? e.action}
                      {NO_TARGET.has(e.action)
                        ? ''
                        : e.action === 'bulk-delete'
                          ? ` ${e.count} 則`
                          : `「${e.title || '(無標題)'}」`}
                    </span>
                    <span className="bd-meta">{timeAgo(e.at)}</span>
                  </div>
                </div>
              </li>
            ))}
            {(entries ?? []).length === 0 && <li className="bd-empty">目前沒有任何記錄</li>}
          </ul>
        )}

        <div className="sheet-actions">
          <button className="btn ghost" onClick={onClose}>
            關閉
          </button>
        </div>
      </div>
    </div>
  )
}
