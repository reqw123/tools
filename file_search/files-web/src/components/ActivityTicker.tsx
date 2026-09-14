import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Lock, LogOut, Pencil, Pin } from 'lucide-react'
import { useActivity, useCombinedActivity, usePresence, type CombinedActivityEntry } from '../hooks/useActivity'
import { displayAuthor, readAuthorName, saveAuthorName } from '../lib/identity'
import { timeAgo } from '../lib/format'
import { useShareInfo } from '../hooks/useShareInfo'
import { session, type ActivityEntry } from '../lib/api'
import { WALL_LABEL, isNoTargetActivity, verbOfActivity, iconOfActivity } from '../lib/activityLabels'

/**
 * 牆主標題右側的常駐面板，搬自 notes-web/src/components/ActivityTicker.tsx：
 *   - 你自己目前顯示的名字，點一下就能改
 *   - 現在有誰正在看哪份索引集（脈動小圓點）
 *   - 最近幾筆新增／改／移除動態，SSE 推播即時更新
 * 只在共用模式顯示——單機沒有「別人」，這些資訊沒有意義。
 *
 * **合併動態**（2026-09 加，使用者要求「動態歷史紀錄之外，也要真的顯示在
 * 即時的動態面板上」——一開始只有 `ActivityDialog.tsx` 的完整歷史清單做了
 * 合併，這裡是標題旁邊常駐、隨時看得到的那塊，同一份 `otherWall` 判斷、
 * 同一份 `useCombinedActivity()`，渲染邏輯抽到 `lib/activityLabels.ts`
 * 跟 Dialog 共用，不重複寫一份。 */
export function ActivityTicker() {
  const shareInfo = useShareInfo()
  const isShare = shareInfo.mode === 'lan'
  const otherWall = shareInfo.otherWall
  const qc = useQueryClient()
  const own = useActivity(12)
  const combined = useCombinedActivity(12)
  const { data: entries } = otherWall ? combined : own
  const { data: presence } = usePresence()
  const { data: sessionInfo } = useQuery({ queryKey: ['session'], queryFn: session.check, enabled: isShare })
  const verifiedName = sessionInfo?.name ?? null
  const [name, setName] = useState(readAuthorName)
  const [editingName, setEditingName] = useState(false)
  const [draft, setDraft] = useState('')
  const [loggingOut, setLoggingOut] = useState(false)

  if (!isShare) return null

  const viewers = [...new Set(Object.values(presence ?? {}).flat().map(displayAuthor))]

  const startEdit = () => {
    setDraft(name)
    setEditingName(true)
  }
  const commit = () => {
    saveAuthorName(draft)
    setName(readAuthorName())
    setEditingName(false)
  }
  const logout = async () => {
    setLoggingOut(true)
    await session.logout()
    await qc.invalidateQueries()
    setLoggingOut(false)
  }

  return (
    <aside className="activity-panel">
      <div className="ap-me">
        <span className="ap-me-label mono">你目前顯示為</span>
        {verifiedName ? (
          <span className="ap-name-locked" title="這個名字已通過 PIN 驗證">
            <Lock size={13} strokeWidth={2.4} aria-hidden />
            {verifiedName}
          </span>
        ) : editingName ? (
          <input
            autoFocus
            maxLength={40}
            placeholder="你的名字（留空＝匿名）"
            title="已經設過 PIN 保護的名字不能在這裡借用——要用那個名字得登出重新整理，從密碼牆輸入對的 PIN"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') setEditingName(false)
            }}
          />
        ) : (
          <button type="button" className="ap-name-btn" onClick={startEdit} title="點一下改名字">
            {displayAuthor(name)}
            <Pencil size={14} strokeWidth={2.2} aria-hidden />
          </button>
        )}
        {verifiedName && (
          <button type="button" className="ap-logout-btn" onClick={logout} disabled={loggingOut} title="登出這個身分">
            <LogOut size={13} strokeWidth={2.2} aria-hidden />
            {loggingOut ? '登出中…' : '登出'}
          </button>
        )}
      </div>

      {viewers.length > 0 && (
        <div className="ap-editing">
          <span className="ap-pulse" aria-hidden />
          <b>{viewers.join('、')}</b>　正在看
        </div>
      )}

      <div className="ap-feed-head mono">
        <Pin size={13} strokeWidth={2.4} aria-hidden />
        動態
      </div>
      {entries && entries.length > 0 ? (
        <ul className="ap-feed">
          {entries.map((e, i) => (
            <ActivityRow key={`${e.at}-${i}`} entry={e} />
          ))}
        </ul>
      ) : (
        <p className="ap-empty dim">還沒有任何動態</p>
      )}
    </aside>
  )
}

function ActivityRow({ entry }: { entry: ActivityEntry | CombinedActivityEntry }) {
  const Icon = iconOfActivity(entry)
  if (entry.action === 'switch-wall' && 'toWall' in entry && entry.toWall) {
    return (
      <li className="ap-item ap-switch-wall">
        <span className="ap-icon" aria-hidden>
          <Icon size={15} strokeWidth={2.4} />
        </span>
        <span className="ap-text">
          <b>{displayAuthor(entry.author)}</b> 切去了{WALL_LABEL[entry.toWall]}
        </span>
        <span className="ap-time mono">{timeAgo(entry.at)}</span>
      </li>
    )
  }
  return (
    <li className={`ap-item ap-${entry.action}`}>
      <span className="ap-icon" aria-hidden>
        <Icon size={15} strokeWidth={2.4} />
      </span>
      <span className="ap-text">
        {'wall' in entry && entry.wall === 'notes' && <span className="activity-wall-tag">便利貼牆</span>}
        <b>{displayAuthor(entry.author)}</b> {verbOfActivity(entry)}
        {isNoTargetActivity(entry) ? null : entry.count ? (
          <span className="ap-target">{entry.count} 筆</span>
        ) : (
          <span className="ap-target">「{entry.title || ('indexName' in entry ? entry.indexName : '') || '(無標題)'}」</span>
        )}
        {'target' in entry && entry.target && <span className="ap-target"> 給 {displayAuthor(entry.target)}</span>}
      </span>
      <span className="ap-time mono">{timeAgo(entry.at)}</span>
    </li>
  )
}
