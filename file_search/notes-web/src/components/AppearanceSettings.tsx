import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  APP_SETTINGS_KEY,
  mergeAppSettings,
  useAppSettings,
  usePatchAppSettings,
} from '../hooks/useNotes'
import { useOllamaModels } from '../hooks/useAi'
import type { AppSettings } from '../lib/api'

const DEFAULT_NOTE_COLOR = '#e5e7eb'
const DEFAULT_EMBED_MODEL = 'bge-m3'
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

  // 語意搜尋的 embedding 模型——文字輸入 + datalist（讀那台 Ollama 已安裝的
  // 清單），失焦才送出。位址沿用「AI 請求」分頁設定的 ollama.base_url。
  const [modelDraft, setModelDraft] = useState<string | null>(null)
  const ollamaModels = useOllamaModels()
  const modelOptions = ollamaModels.data?.models ?? []

  if (!settings) return <p className="dim mono">載入中…</p>

  const color = settings.defaultNoteColor
  const width = settings.wall.minColWidth
  const embedModel = settings.embedModel

  const commitEmbedModel = () => {
    const next = (modelDraft ?? '').trim()
    setModelDraft(null)
    if (modelDraft !== null && next !== embedModel) patch.mutate({ embedModel: next })
  }

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

      <label>
        語意搜尋的嵌入模型
        <span className="hint">
          搜尋列的「🌱 語意」開關用這個本機 Ollama 模型算相似度（要純 embedding
          模型，不是聊天模型）。位址沿用「AI 請求」分頁的 Ollama 設定。留空＝
          預設 <code>{DEFAULT_EMBED_MODEL}</code>（多語言、中文效果好，約 1.2GB）；
          純英文環境想省空間可換 <code>nomic-embed-text</code>（約 274MB，中文較弱）。
          那台電腦要先 <code>ollama pull {modelDraft?.trim() || embedModel || DEFAULT_EMBED_MODEL}</code>。
        </span>
        <span className="swatch-controls">
          <input
            type="text"
            list="embed-model-options"
            placeholder={DEFAULT_EMBED_MODEL}
            value={modelDraft ?? embedModel}
            onChange={(e) => setModelDraft(e.target.value)}
            onBlur={commitEmbedModel}
          />
          <datalist id="embed-model-options">
            {modelOptions.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <button
            type="button"
            className="btn sm ghost"
            disabled={ollamaModels.isPending}
            onClick={() => ollamaModels.mutate(undefined)}
          >
            {ollamaModels.isPending ? '讀取中…' : '讀取清單'}
          </button>
          {embedModel && embedModel !== DEFAULT_EMBED_MODEL && (
            <button
              type="button"
              className="btn sm ghost"
              onClick={() => {
                setModelDraft(null)
                patch.mutate({ embedModel: '' })
              }}
            >
              重設
            </button>
          )}
        </span>
        {ollamaModels.data?.models === null && (
          <span className="hint">讀不到清單（那台 Ollama 沒在跑？）——仍可直接輸入模型名稱。</span>
        )}
      </label>

      {patch.error && <span className="err">{patch.error.message}</span>}
    </div>
  )
}
