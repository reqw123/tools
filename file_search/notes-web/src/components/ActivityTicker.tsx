import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Lock, LogOut, Pencil, Pin, Plus, RotateCcw, Trash2, Wifi, WifiOff } from 'lucide-react'
import { useActivity, usePresence } from '../hooks/useActivity'
import { displayAuthor, readAuthorName, saveAuthorName } from '../lib/identity'
import { timeAgo } from '../lib/format'
import { useShareInfo } from '../hooks/useShareInfo'
import { session, type ActivityEntry } from '../lib/api'

const VERB: Record<string, string> = {
  create: '新增了',
  update: '編輯了',
  delete: '刪除了',
  restore: '復原了',
  'bulk-delete': '批次刪除了',
  connect: '已連線',
  disconnect: '已斷線',
}
const ICON: Record<string, typeof Plus> = {
  create: Plus,
  update: Pencil,
  delete: Trash2,
  restore: RotateCcw,
  'bulk-delete': Trash2,
  connect: Wifi,
  disconnect: WifiOff,
}
/** 沒有對應便利貼的動作——「小明 已連線」不用再接「「XXX」」。 */
const NO_TARGET = new Set(['connect', 'disconnect'])

/**
 * 牆主標題右側的常駐面板（`.hero` 在寬螢幕右邊本來就空著一大塊）：
 *   - 你自己目前顯示的名字，點一下就能改（不用挖到「全域設定 → 外觀」）
 *   - 現在有誰正在編輯（脈動小圓點）
 *   - 最近幾筆新增／改／刪動態，SSE 推播即時更新，新的一筆會滑入＋高亮閃一下
 * 只在共用模式顯示——單機沒有「別人」，這些資訊沒有意義。
 */
export function ActivityTicker() {
  const isShare = useShareInfo().mode === 'lan'
  const qc = useQueryClient()
  const { data: entries } = useActivity(12)
  const { data: presence } = usePresence()
  // 跟 AppGate 共用同一個 query（key 一樣），不會多打一次 /api/session。
  // name 有值＝這個名字通過了 PIN 驗證（server/people.ts）——鎖住不能用這裡改，
  // 要換人得先登出（清 cookie）重新走一次密碼牆。
  const { data: sessionInfo } = useQuery({ queryKey: ['session'], queryFn: session.check, enabled: isShare })
  const verifiedName = sessionInfo?.name ?? null
  const [name, setName] = useState(readAuthorName)
  const [editingName, setEditingName] = useState(false)
  const [draft, setDraft] = useState('')
  const [loggingOut, setLoggingOut] = useState(false)

  if (!isShare) return null

  const editors = [...new Set(Object.values(presence ?? {}).flat().map(displayAuthor))]

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
          // 已用 PIN 驗證過——名字鎖住，改不了（不然身分認證形同虛設）。
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

      {editors.length > 0 && (
        <div className="ap-editing">
          <span className="ap-pulse" aria-hidden />
          <b>{editors.join('、')}</b>　正在編輯
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

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  const Icon = ICON[entry.action] ?? Pencil
  return (
    <li className={`ap-item ap-${entry.action}`}>
      <span className="ap-icon" aria-hidden>
        <Icon size={15} strokeWidth={2.4} />
      </span>
      <span className="ap-text">
        <b>{displayAuthor(entry.author)}</b> {VERB[entry.action] ?? entry.action}
        {NO_TARGET.has(entry.action) ? null : entry.action === 'bulk-delete' ? (
          <span className="ap-target">{entry.count} 則</span>
        ) : (
          <span className="ap-target">「{entry.title || '(無標題)'}」</span>
        )}
      </span>
      <span className="ap-time mono">{timeAgo(entry.at)}</span>
    </li>
  )
}
