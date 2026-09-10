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
  const [tiltDraft, setTiltDraft] = useState<string | null>(null)

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
        <span className="hint">
          關掉就用單純的等寬格線，不做緊貼排版，也<b>不再依分類分行／分段</b>
          （下面「同分類怎麼排」會停用）。
        </span>
      </label>

      <label className="check-inline">
        <input
          type="checkbox"
          checked={settings.wall.tilt}
          onChange={(e) => patch.mutate({ wall: { tilt: e.target.checked } })}
        />
        便利貼歪斜效果
        <span className="hint">打開後每張便利貼會照標題帶一點隨機傾斜（連膠帶也跟著轉）。預設關閉、擺正。</span>
      </label>

      {settings.wall.tilt && (
        <label className="tilt-angle">
          最大傾斜角度（0.5–15°，每張在 ±這個角度之間）
          <span className="tilt-angle-row">
            <input
              type="range"
              min={0.5}
              max={15}
              step={0.5}
              value={tiltDraft ?? String(settings.wall.tiltMax)}
              onChange={(e) => setTiltDraft(e.target.value)}
              onPointerUp={() => {
                const n = Number(tiltDraft)
                setTiltDraft(null)
                if (Number.isFinite(n) && n !== settings.wall.tiltMax) {
                  patch.mutate({ wall: { tiltMax: n } })
                }
              }}
            />
            <input
              type="number"
              min={0.5}
              max={15}
              step={0.5}
              value={tiltDraft ?? String(settings.wall.tiltMax)}
              onChange={(e) => setTiltDraft(e.target.value)}
              onBlur={() => {
                const n = Math.round(Number(tiltDraft) * 10) / 10
                setTiltDraft(null)
                if (Number.isFinite(n) && n >= 0.5 && n <= 15 && n !== settings.wall.tiltMax) {
                  patch.mutate({ wall: { tiltMax: n } })
                }
              }}
            />
            <span className="dim">°</span>
          </span>
        </label>
      )}

      <fieldset className="mode-row" disabled={!settings.wall.masonry}>
        <legend>便利貼往哪個方向排</legend>
        <p className="hint">
          「<b>看全部</b>」（搜尋框空、沒點分類、非 AI／語意、沒開「只看快到期」）時
          會把同分類的便利貼排在一起；<b>有篩選時</b>（例如單選一個分類）不分分類，
          但卡片仍照這裡選的方向排。生活牆與研究生牆都套用。工具列上也有一顆
          直／橫圖示鈕可以快速切換。
        </p>
        {!settings.wall.masonry && (
          <p className="hint mode-row-off">
            ⚠️ 「牆面動態排版」關閉中——現在是等寬格線。要先把上面的動態排版
            打開，這裡才有作用。
          </p>
        )}
        <label className="radio">
          <input
            type="radio"
            name="wall-tag-axis"
            checked={settings.wall.tagAxis !== 'horizontal'}
            onChange={() => patch.mutate({ wall: { tagAxis: 'vertical' } })}
          />
          <span>
            直向
            <span className="hint">
              看全部：一個分類佔一（直）行、分類由左到右。有篩選：整疊在第一欄由上往下，
              多到超過一個畫面才往右擴欄。
            </span>
          </span>
        </label>
        <label className="radio">
          <input
            type="radio"
            name="wall-tag-axis"
            checked={settings.wall.tagAxis === 'horizontal'}
            onChange={() => patch.mutate({ wall: { tagAxis: 'horizontal' } })}
          />
          <span>
            橫向
            <span className="hint">
              卡片一張張補進目前最矮的欄——等高就是整齊的一列列，有高有矮也會補洞、
              不留一塊塊空白。看全部時同分類會相鄰。
            </span>
          </span>
        </label>
      </fieldset>

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
