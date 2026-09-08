import { useState } from 'react'
import { useAppSettings, usePatchAppSettings } from '../hooks/useNotes'

const DEFAULT_DAYS = 30
const DEFAULT_MAX = 200

/**
 * 「全域設定 → 垃圾桶」——刪掉的便利貼進垃圾桶不會自己消失，一直累積會拖慢
 * 每次讀寫（垃圾桶跟便利貼在同一個檔案裡，每次操作都會 parse／序列化整份）。
 * 兩道門檻，任一超過就把最舊的永久刪（連插圖）：保留天數、最多筆數。
 * 桌面版讀同一份設定（唯讀）。
 */
export function TrashSettings() {
  const { data: settings } = useAppSettings()
  const patch = usePatchAppSettings()
  const [daysDraft, setDaysDraft] = useState<string | null>(null)
  const [maxDraft, setMaxDraft] = useState<string | null>(null)

  if (!settings) return <p className="dim mono">載入中…</p>

  const days = settings.trashRetentionDays
  const max = settings.trashMaxCount

  const commit = (
    draft: string | null,
    current: number,
    clamp: (n: number) => number,
    key: 'trashRetentionDays' | 'trashMaxCount',
    reset: () => void,
  ) => {
    reset()
    if (draft === null) return
    const n = Math.round(Number(draft.trim()))
    if (Number.isFinite(n) && n >= 0) {
      const v = clamp(n)
      if (v !== current) patch.mutate({ [key]: v })
    }
  }

  return (
    <div className="form trash-settings">
      <p className="hint">
        刪掉的便利貼會先進垃圾桶（可復原）。垃圾桶跟便利貼存在同一個檔案，堆太多
        會拖慢每次開牆／搜尋／編輯。下面兩道門檻任一超過，就把<b>最舊的</b>那批
        連同插圖一起<b>永久刪除</b>（在刪東西時、以及打開垃圾桶時各清一次）。
      </p>

      <label>
        保留天數
        <span className="hint">刪掉超過這麼多天的自動永久刪。填 0＝不依時間清。</span>
        <input
          type="number"
          min={0}
          max={3650}
          step={1}
          value={daysDraft ?? String(days)}
          onChange={(e) => setDaysDraft(e.target.value)}
          onBlur={() =>
            commit(daysDraft, days, (n) => Math.min(3650, n), 'trashRetentionDays', () =>
              setDaysDraft(null),
            )
          }
        />
      </label>

      <label>
        最多保留筆數
        <span className="hint">超過就從最舊的清起。填 0＝不限筆數。</span>
        <input
          type="number"
          min={0}
          max={100000}
          step={10}
          value={maxDraft ?? String(max)}
          onChange={(e) => setMaxDraft(e.target.value)}
          onBlur={() =>
            commit(maxDraft, max, (n) => Math.min(100000, n), 'trashMaxCount', () =>
              setMaxDraft(null),
            )
          }
        />
      </label>

      {(days !== DEFAULT_DAYS || max !== DEFAULT_MAX) && (
        <button
          type="button"
          className="btn sm ghost"
          onClick={() => {
            setDaysDraft(null)
            setMaxDraft(null)
            patch.mutate({ trashRetentionDays: DEFAULT_DAYS, trashMaxCount: DEFAULT_MAX })
          }}
        >
          恢復預設（{DEFAULT_DAYS} 天 / {DEFAULT_MAX} 則）
        </button>
      )}

      {days === 0 && max === 0 && (
        <p className="err">
          兩道門檻都關掉了——垃圾桶不會自動清理，只能自己在垃圾桶視窗手動「永久刪除」或「清空」。
        </p>
      )}

      {patch.error && <span className="err">{patch.error.message}</span>}
    </div>
  )
}
