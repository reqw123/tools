import { useEffect, useRef } from 'react'
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from '../hooks/useNotifications'
import { displayAuthor } from '../lib/identity'
import { timeAgo } from '../lib/format'
import { scrimClose } from '../lib/scrimClose'
import type { Notification } from '../lib/api'

/** 通知內容——依 kind 組不同的句子；'due-*' 沒有「誰做的」，不顯示 by。 */
function notificationText(n: Notification): string {
  const title = n.noteTitle || '(無標題)'
  if (n.kind === 'due-soon') return `「${title}」快到期了`
  if (n.kind === 'due-overdue') return `「${title}」已經逾期了`
  return `${displayAuthor(n.by)} 把「${title}」指派給你了`
}

/**
 * 「站內通知」——便利貼指派給你了／指派給你的便利貼快到期或已逾期了（見
 * server/notifications.ts）。持久化，server 重開不會不見；跟 ActivityDialog
 * 同一套版面。
 */
export function NotificationsDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const { data: entries, isLoading, isError } = useNotifications()
  const markRead = useMarkNotificationRead()
  const markAllRead = useMarkAllNotificationsRead()
  const unreadCount = entries?.filter((n) => !n.read).length ?? 0

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
        aria-label="通知"
        tabIndex={-1}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="icon-btn" onClick={onClose} aria-label="關閉">
          ×
        </button>
        <h2>通知</h2>
        <p className="dim">
          「指派給你」跟「指派給你的便利貼快到期／已逾期」——持久存檔，重開 server 不會不見。
        </p>

        {isLoading ? (
          <p className="dim mono">// 讀取中…</p>
        ) : isError ? (
          <p className="err">讀取通知失敗。</p>
        ) : (
          <ul className="bd-list">
            {(entries ?? []).map((n) => (
              <li key={n.id}>
                <div
                  className="tr-row"
                  style={{ cursor: n.read ? undefined : 'pointer' }}
                  onClick={() => !n.read && markRead.mutate(n.id)}
                >
                  <div>
                    <span className="bd-title">
                      {!n.read && '🔵 '}
                      {n.kind === 'due-overdue' ? '⏰ ' : n.kind === 'due-soon' ? '⏳ ' : ''}
                      {notificationText(n)}
                    </span>
                    <span className="bd-meta">{timeAgo(n.at)}</span>
                  </div>
                </div>
              </li>
            ))}
            {(entries ?? []).length === 0 && <li className="bd-empty">目前沒有任何通知</li>}
          </ul>
        )}

        <div className="sheet-actions">
          {unreadCount > 0 && (
            <button className="btn ghost" onClick={() => markAllRead.mutate()}>
              全部標成已讀
            </button>
          )}
          <button className="btn ghost" onClick={onClose}>
            關閉
          </button>
        </div>
      </div>
    </div>
  )
}
