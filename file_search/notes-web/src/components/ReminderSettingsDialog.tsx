import { useEffect, useRef, useState } from 'react'
import { useReminderSettings, useSetReminderSettings } from '../hooks/useNotes'
import type { ReminderSettings } from '../lib/api'

/**
 * 「快到期」門檻設定——這個數字同時決定卡片什麼時候標黃色，也是
 * GET /notes/due-soon 拿去分「已逾期／快到期」的依據（見 server/store.ts
 * 的 dueSummary()）。Node-RED（或其他排程系統）只讀 due-soon 算好的結果，
 * 完全不需要知道這個設定存在——改這裡不用去動任何 Node-RED flow，
 * 那邊也不會因為這個設定壞掉、存不進去而跟著壞掉，各自獨立。
 */
export function ReminderSettingsDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const { data: settings, isLoading } = useReminderSettings()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    ref.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="scrim" onClick={onClose}>
      <div
        className="sheet plain"
        role="dialog"
        aria-modal="true"
        aria-label="提醒設定"
        tabIndex={-1}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="icon-btn" onClick={onClose} aria-label="關閉">
          ×
        </button>
        <h2>⏰ 提醒設定</h2>
        <p className="dim">
          到期前幾小時內的便利貼算「快到期」（卡片標黃色提醒）。這個門檻也是
          Node-RED 之類的排程系統拿去判斷要不要發通知的依據——改這裡不用去動
          Node-RED 那邊的流程，它下次拉資料時就會照新的門檻算。
        </p>
        {isLoading || !settings ? (
          <p className="dim mono">載入中…</p>
        ) : (
          <SettingsForm key="loaded" initial={settings} onClose={onClose} />
        )}
      </div>
    </div>
  )
}

function SettingsForm({ initial, onClose }: { initial: ReminderSettings; onClose: () => void }) {
  const save = useSetReminderSettings()
  // key="loaded" 上面保證這個元件只在 settings 真的載入後才掛載一次，
  // 直接拿 initial 當初始值就好，不需要另外用 effect 去同步——避免「setState
  // 寫在 effect 裡」這個常見的多餘重渲染陷阱（跟 AiSettingsDialog 同一招）。
  const [hours, setHours] = useState(initial.dueSoonHours)
  const [muted, setMuted] = useState(initial.dueAlarmsMuted)

  const invalid = !Number.isFinite(hours) || hours < 1 || hours > 720

  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault()
        if (invalid) return
        save.mutate({ dueSoonHours: hours, dueAlarmsMuted: muted }, { onSuccess: onClose })
      }}
    >
      <label>
        提前提醒時數（1～720 小時，約 30 天）
        <input
          type="number"
          min={1}
          max={720}
          value={hours}
          autoFocus
          onChange={(e) => setHours(Number(e.target.value))}
        />
        {invalid && <span className="err">請輸入 1～720 之間的數字</span>}
      </label>

      <label className="check-row">
        <input type="checkbox" checked={muted} onChange={(e) => setMuted(e.target.checked)} />
        <span>
          靜音所有到期通知
          <span className="dim">
            關掉後：桌面牆的系統通知＋系統匣角標、Node-RED 的 LINE／Discord 鬧鐘與
            6 小時彙整全部不發。便利貼卡片本身的紅／黃到期標色<b>仍然有效</b>。
          </span>
        </span>
      </label>

      {save.error && <span className="err">{save.error.message}</span>}

      <div className="sheet-actions">
        <button type="submit" className="btn" disabled={invalid || save.isPending}>
          {save.isPending ? '儲存中…' : '儲存'}
        </button>
        <button type="button" className="btn ghost" onClick={onClose} disabled={save.isPending}>
          取消
        </button>
      </div>
    </form>
  )
}
