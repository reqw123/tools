import { useState } from 'react'
import { useReminderSettings, useSetReminderSettings } from '../hooks/useNotes'
import type { AlarmChannels, ReminderSettings as ReminderSettingsData } from '../lib/api'

/**
 * 「全域設定 → 提醒」——「快到期」門檻 ＋ 四個到期通知管道的開關。
 * （原本是獨立的「⏰ 提醒設定」對話框，併進全域設定分頁，少一顆工具列鈕。）
 *
 * - dueSoonHours：到期前幾小時算「快到期」，卡片標黃 & GET /notes/due-soon 分
 *   「已逾期／快到期」都用這個。
 * - dueAlarmChannels：桌面牆系統通知／系統匣角標／Node-RED 即時鬧鐘／Node-RED
 *   6 小時彙整，各自獨立開關。關掉任何一個都**不影響**便利貼卡片的紅／黃標色
 *   （那是前端直接看 due_at + dueSoonHours 算的）。
 */
export function ReminderSettings({ onClose }: { onClose?: () => void }) {
  const { data: settings, isLoading } = useReminderSettings()

  if (isLoading || !settings) return <p className="dim mono">載入中…</p>
  // key：settings 第一次載入後才掛載一次，直接拿它當初始值就好（同 AiSettingsPanel）。
  return <SettingsForm key="loaded" initial={settings} onClose={onClose} />
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

// 「全開／全關」按鈕要涵蓋的所有 key——從 CHANNEL_GROUPS 衍生，加管道時只改上面那份。
const CHANNEL_KEYS = CHANNEL_GROUPS.flatMap((g) => g.items.map((it) => it.key))

function SettingsForm({
  initial,
  onClose,
}: {
  initial: ReminderSettingsData
  onClose?: () => void
}) {
  const save = useSetReminderSettings()
  const [hours, setHours] = useState(initial.dueSoonHours)
  const [channels, setChannels] = useState<AlarmChannels>(initial.dueAlarmChannels)

  const invalid = !Number.isFinite(hours) || hours < 1 || hours > 720
  const allOff = CHANNEL_KEYS.every((k) => !channels[k])

  const toggle = (key: keyof AlarmChannels) =>
    setChannels((c) => ({ ...c, [key]: !c[key] }))
  const setAll = (on: boolean) =>
    setChannels((c) => {
      const next = { ...c }
      for (const k of CHANNEL_KEYS) next[k] = on
      return next
    })

  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault()
        if (invalid) return
        save.mutate(
          { dueSoonHours: hours, dueAlarmChannels: channels },
          { onSuccess: () => onClose?.() },
        )
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
      </div>
    </form>
  )
}
