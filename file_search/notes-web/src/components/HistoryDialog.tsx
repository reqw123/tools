import { useEffect, useRef, useState } from 'react'
import { useHistory, useRestoreSnapshot } from '../hooks/useNotes'
import { scrimClose } from '../lib/scrimClose'

/**
 * 版本記錄（時光機）——每次便利貼有實質變動，`.sticky_notes.json` 就會自動
 * 存一份時間戳快照（見 server/store.ts 的 snapshotHistory）。挑一個版本可以
 * 整份還原（連垃圾桶一起），給「垃圾桶救不回來」的情況用：批次改標籤改錯
 * 一批、內容被覆蓋、匯入蓋掉一堆……。還原前會先自動存一份「現在」，所以
 * 還原本身也可以再還原回去。
 */
export function HistoryDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const { data: snapshots, isLoading, isError } = useHistory()
  const restore = useRestoreSnapshot()
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const busy = restore.isPending

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

  const list = snapshots ?? []
  const fmt = (iso: string) => iso.replace('T', ' ').slice(0, 19)

  return (
    <div className="scrim" {...scrimClose(() => { if (!busy) onClose() })}>
      <div
        className="sheet plain wide"
        role="dialog"
        aria-modal="true"
        aria-label="版本記錄"
        tabIndex={-1}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="icon-btn" onClick={onClose} aria-label="關閉" disabled={busy}>
          ×
        </button>
        <h2>版本記錄</h2>
        <p className="dim">
          每次便利貼有變動都會自動存一份版本。挑一個版本可以整份還原（連垃圾桶一起）
          ——給批次操作出錯、內容被覆蓋這種垃圾桶救不回來的情況用。還原前會先存一份
          「現在」，所以還原也能再還原。
        </p>

        {isLoading ? (
          <p className="dim mono">// 讀取中…</p>
        ) : isError ? (
          <p className="err">讀取版本記錄失敗。</p>
        ) : (
          <>
            <span className="dim mono">
              {list.length ? `共 ${list.length} 個版本（最新的在最上面）` : '還沒有任何版本'}
            </span>
            <ul className="bd-list">
              {list.map((s, i) => (
                <li key={s.id}>
                  <div className="tr-row">
                    <div>
                      <span className="bd-title">
                        {fmt(s.taken_at)}
                        {i === 0 ? '　（最新）' : ''}
                      </span>
                      <span className="bd-meta">
                        {s.note_count} 則便利貼
                        {s.trash_count ? `　·　垃圾桶 ${s.trash_count} 則` : ''}
                      </span>
                    </div>
                    <div className="tr-actions">
                      {confirmId === s.id ? (
                        <>
                          <button
                            type="button"
                            className="btn sm"
                            disabled={busy}
                            onClick={() => {
                              restore.mutate(s.id, { onSuccess: () => setConfirmId(null) })
                            }}
                          >
                            {busy ? '還原中…' : '確定還原'}
                          </button>
                          <button
                            type="button"
                            className="btn ghost sm"
                            disabled={busy}
                            onClick={() => setConfirmId(null)}
                          >
                            取消
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="btn ghost sm"
                          disabled={busy}
                          onClick={() => setConfirmId(s.id)}
                        >
                          還原到這個版本
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
              {list.length === 0 && (
                <li className="bd-empty">新增／編輯／刪除便利貼之後就會開始記錄。</li>
              )}
            </ul>
            {restore.error && <span className="err">{restore.error.message}</span>}
          </>
        )}

        <div className="sheet-actions">
          <button className="btn ghost" onClick={onClose} disabled={busy}>
            關閉
          </button>
        </div>
      </div>
    </div>
  )
}
