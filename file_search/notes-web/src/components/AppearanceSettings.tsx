import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  APP_SETTINGS_KEY,
  mergeAppSettings,
  useAppSettings,
  usePatchAppSettings,
} from '../hooks/useNotes'
import type { AppSettings } from '../lib/api'

const DEFAULT_NOTE_COLOR = '#e5e7eb'
const MIN = 160
const MAX = 520

export function AppearanceSettings() {
  const { data: settings } = useAppSettings()
  const patch = usePatchAppSettings()
  const qc = useQueryClient()

  // 顏色：拖曳中只更新本地快取做即時預覽（牆面同步變），真正送出等失焦／關閉
  // ——同 NoteForm 的標籤色票，避免對後端狂送 PATCH、狂重寫設定檔。
  const pendingColor = useRef<string | null>(null)
  const previewColor = (color: string) => {
    pendingColor.current = color
    qc.setQueryData<AppSettings>(APP_SETTINGS_KEY, (old) =>
      mergeAppSettings(old, { defaultNoteColor: color }),
    )
  }
  const commitColor = () => {
    const color = pendingColor.current
    pendingColor.current = null
    if (color) patch.mutate({ defaultNoteColor: color })
  }
  // 離開對話框（按 Esc / ×）時元件卸載，也要把還沒送出的顏色補送——不然
  // 牆面看起來變了、其實沒存到，重新整理就打回原形。commitRef 保持指向最新
  // 的 commitColor（每次 render 後更新），卸載時的 cleanup 才拿得到當下的 patch。
  const commitRef = useRef(commitColor)
  useEffect(() => {
    commitRef.current = commitColor
  })
  useEffect(() => () => commitRef.current(), [])

  const [widthDraft, setWidthDraft] = useState<string | null>(null)

  if (!settings) return <p className="dim mono">載入中…</p>

  const color = settings.defaultNoteColor
  const width = settings.wall.minColWidth

  return (
    <div className="form appearance">
      <label className="swatch-row">
        <span>
          預設便利貼顏色
          <span className="hint">無分類、或分類還沒自訂顏色時的紙色。</span>
        </span>
        <span className="swatch-controls">
          <input
            type="color"
            className="tag-color-swatch"
            value={color}
            onChange={(e) => previewColor(e.target.value)}
            onBlur={commitColor}
          />
          {color.toLowerCase() !== DEFAULT_NOTE_COLOR && (
            <button
              type="button"
              className="btn sm ghost"
              onClick={() => patch.mutate({ defaultNoteColor: DEFAULT_NOTE_COLOR })}
            >
              重設
            </button>
          )}
        </span>
      </label>

      <label>
        牆面欄寬（{MIN}–{MAX}px，越大欄數越少、每張越寬）
        <input
          type="number"
          min={MIN}
          max={MAX}
          step={10}
          value={widthDraft ?? String(width)}
          onChange={(e) => setWidthDraft(e.target.value)}
          onBlur={() => {
            setWidthDraft(null)
            const n = Math.round(Number(widthDraft))
            if (Number.isFinite(n) && n >= MIN && n <= MAX && n !== width) {
              patch.mutate({ wall: { minColWidth: n } })
            }
          }}
        />
      </label>

      <label className="check-inline">
        <input
          type="checkbox"
          checked={settings.wall.masonry}
          onChange={(e) => patch.mutate({ wall: { masonry: e.target.checked } })}
        />
        牆面動態排版（大致等高、上下緊貼）
        <span className="hint">關掉就用單純的等寬格線，不做緊貼排版。</span>
      </label>

      {patch.error && <span className="err">{patch.error.message}</span>}
    </div>
  )
}
