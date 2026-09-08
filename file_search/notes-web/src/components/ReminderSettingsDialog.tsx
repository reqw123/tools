import { useEffect, useRef, useState } from 'react'
import { useReminderSettings, useSetReminderSettings } from '../hooks/useNotes'
import type { AlarmChannels, ReminderSettings } from '../lib/api'

/**
 * 「快到期」門檻 ＋ 四個到期通知管道的開關。
 *
 * - dueSoonHours：到期前幾小時算「快到期」，卡片標黃 & GET /notes/due-soon 分
 *   「已逾期／快到期」都用這個。
 * - dueAlarmChannels：桌面牆系統通知／系統匣角標／Node-RED 即時鬧鐘／Node-RED
 *   6 小時彙整，各自獨立開關。關掉任何一個都**不影響**便利貼卡片的紅／黃標色
 *   （那是前端直接看 due_at + dueSoonHours 算的）。
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
        {isLoading || !settings ? (
          <p className="dim mono">載入中…</p>
        ) : (
          <SettingsForm key="loaded" initial={settings} onClose={onClose} />
        )}
      </div>
    </div>
  )
}

const CHANNEL_GROUPS: {
  group: string
  items: { key: keyof AlarmChannels; label: string; desc: string }[]
}[] = [
  {
    group: '桌面牆',
    items: [
      { key: 'wallpaperToast', label: '系統通知', desc: '到期時右下角彈出 Windows 通知（可點開牆）' },
      { key: 'wallpaperBadge', label: '系統匣角標', desc: '工作列圖示上顯示到期數量的紅色數字' },
    ],
  },
  {
    group: 'Node-RED（LINE／Discord）',
    items: [
      { key: 'nodeRedAlarm', label: '即時鬧鐘', desc: '每分鐘檢查，某則一到期就馬上推一次' },
      { key: 'nodeRedDigest', label: '6 小時彙整', desc: '每 6 小時把當下所有到期／快到期彙整推一次' },
    ],
  },
]

function SettingsForm({ initial, onClose }: { initial: ReminderSettings; onClose: () => void }) {
  const save = useSetReminderSettings()
  // key="loaded" 上面保證這個元件只在 settings 真的載入後才掛載一次，
  // 直接拿 initial 當初始值就好，不需要另外用 effect 去同步——避免「setState
  // 寫在 effect 裡」這個常見的多餘重渲染陷阱（跟 AiSettingsDialog 同一招）。
  const [hours, setHours] = useState(initial.dueSoonHours)
  const [channels, setChannels] = useState<AlarmChannels>(initial.dueAlarmChannels)

  const invalid = !Number.isFinite(hours) || hours < 1 || hours > 720
  const allOff = CHANNEL_GROUPS.every((g) => g.items.every((it) => !channels[it.key]))

  const toggle = (key: keyof AlarmChannels) =>
    setChannels((c) => ({ ...c, [key]: !c[key] }))
  const setAll = (on: boolean) =>
    setChannels({
      wallpaperToast: on,
      wallpaperBadge: on,
      nodeRedAlarm: on,
      nodeRedDigest: on,
    })

  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault()
        if (invalid) return
        save.mutate({ dueSoonHours: hours, dueAlarmChannels: channels }, { onSuccess: onClose })
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

      <div className="chan-block">
        <div className="chan-head">
          <span>🔔 到期通知管道</span>
          <span className="chan-bulk">
            <button type="button" onClick={() => setAll(true)}>
              全開
            </button>
            <button type="button" onClick={() => setAll(false)}>
              全關
            </button>
          </span>
        </div>
        <p className="dim">
          各管道獨立開關。全部關掉也<b>不影響</b>便利貼卡片本身的紅（已逾期）／黃
          （快到期）標色。
        </p>

        {CHANNEL_GROUPS.map((g) => (
          <fieldset className="chan-group" key={g.group}>
            <legend>{g.group}</legend>
            {g.items.map((it) => (
              <label className="chan-row" key={it.key}>
                <span className="chan-text">
                  <span className="chan-label">{it.label}</span>
                  <span className="dim">{it.desc}</span>
                </span>
                <span className={`chan-sw${channels[it.key] ? ' on' : ''}`}>
                  <input
                    type="checkbox"
                    checked={channels[it.key]}
                    onChange={() => toggle(it.key)}
                  />
                  <span className="chan-knob" aria-hidden />
                </span>
              </label>
            ))}
          </fieldset>
        ))}

        {allOff && (
          <p className="dim chan-warn">所有到期通知都關了——只剩卡片標色會提醒你。</p>
        )}
      </div>

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
