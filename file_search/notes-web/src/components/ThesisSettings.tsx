import { useState } from 'react'
import { useAppSettings, usePatchAppSettings } from '../hooks/useNotes'
import { useAiTarget } from '../hooks/useAi'

const DEFAULT_DIR = 'C:\\ai_project'
const DEFAULT_PER_FILE = 9000
const DEFAULT_TOTAL = 30000
const DEFAULT_MAX_FILES = 8

// 「從專案生成」的建議組合。字數單位是字元，中文約 1 字元 ≈ 1 token（保守）。
// 上下文窗要留給 prompt（約 500 token）＋輸出（12–18 則草稿，約 3k token）。
const PRESETS = [
  {
    id: 'small',
    label: '本機小模型 / 保守',
    hint: '8B 以下、或上下文窗只有 8k 的本機模型（塞太多會截斷或很慢）',
    perFile: 6000,
    total: 18000,
    maxFiles: 5,
  },
  {
    id: 'local-big',
    label: '本機大上下文（32k–128k 窗）',
    hint: 'qwen2.5:7b / llama3.1 這種 128k 窗的本機模型',
    perFile: 20000,
    total: 60000,
    maxFiles: 10,
  },
  {
    id: 'cloud',
    label: 'OpenAI GPT-4o / 4o-mini（128k 窗）',
    hint: '雲端大模型；4o-mini 便宜很多、這種讀文件產清單的工作也夠',
    perFile: 40000,
    total: 100000,
    maxFiles: 15,
  },
] as const

type PresetId = (typeof PRESETS)[number]['id']

/**
 * 依目前 AI 目標挑一組建議 preset：
 *  - OpenAI → 雲端那組。
 *  - 本機 Ollama → 只有模型名稱認得出是「大 context 家族」（qwen2.5 / qwen3 /
 *    llama3.1 / llama3.2 / mixtral / mistral-nemo / command-r / gemma2-27b、
 *    或帶 ≥10B 參數量標記）才建議大那組；其餘一律建議保守那組——小模型／
 *    認不出來時塞太多內容會截斷或很慢，寧可少讀，要多讀讓使用者自己點大那組。
 */
function suggestPreset(target: { provider?: string | null; model?: string } | undefined): PresetId {
  if (target?.provider === 'openai') return 'cloud'
  const m = (target?.model || '').toLowerCase()
  if (/qwen2\.5|qwen3|llama-?3\.[12]|llama-?3-?[12]\b|mistral-?nemo|mixtral|command-?r|gemma-?2-?27b|:1[0-9]b|:[2-9][0-9]b/.test(m)) {
    return 'local-big'
  }
  return 'small'
}

/**
 * 「全域設定 → 研究生」——研究生模式（切到論文專案專用便利貼）的設定：
 * 論文專案資料夾、以及「從專案生成」讀檔案內容的字數上限。
 */
export function ThesisSettings() {
  const { data: settings } = useAppSettings()
  const { data: aiTarget } = useAiTarget()
  const patch = usePatchAppSettings()
  const [dirDraft, setDirDraft] = useState<string | null>(null)
  const [perDraft, setPerDraft] = useState<string | null>(null)
  const [totDraft, setTotDraft] = useState<string | null>(null)
  const [filesDraft, setFilesDraft] = useState<string | null>(null)

  if (!settings) return <p className="dim mono">載入中…</p>

  const dir = settings.thesisProjectDir
  const per = settings.thesisSeedPerFileChars
  const tot = settings.thesisSeedTotalChars
  const maxFiles = settings.thesisSeedMaxFiles
  const suggested = suggestPreset(aiTarget)
  const suggestedLabel = PRESETS.find((p) => p.id === suggested)?.label ?? ''

  const applyPreset = (p: (typeof PRESETS)[number]) => {
    setPerDraft(null)
    setTotDraft(null)
    setFilesDraft(null)
    patch.mutate({
      thesisSeedPerFileChars: p.perFile,
      thesisSeedTotalChars: p.total,
      thesisSeedMaxFiles: p.maxFiles,
    })
  }

  const commitNum = (
    draft: string | null,
    cur: number,
    lo: number,
    hi: number,
    key: 'thesisSeedPerFileChars' | 'thesisSeedTotalChars' | 'thesisSeedMaxFiles',
    reset: () => void,
  ) => {
    reset()
    if (draft === null) return
    const n = Math.round(Number(draft.trim()))
    if (Number.isFinite(n)) {
      const v = Math.min(hi, Math.max(lo, n))
      if (v !== cur) patch.mutate({ [key]: v })
    }
  }

  return (
    <div className="form thesis-settings">
      <p className="hint">
        「研究生模式」是桌面牆上「🎓 研究生」那個分頁——切過去整面牆換成論文專案
        專用的另一份便利貼，跟生活便利貼完全分開。
      </p>

      <label>
        論文專案資料夾
        <span className="hint">
          研究生便利貼存在 <code>{(dirDraft ?? dir) || DEFAULT_DIR}\.thesis_notes.json</code>；
          「從專案生成」預設也讀這個資料夾（生成時可另外選）。
        </span>
        <input
          type="text"
          value={dirDraft ?? dir}
          placeholder={DEFAULT_DIR}
          onChange={(e) => setDirDraft(e.target.value)}
          onBlur={() => {
            const next = (dirDraft ?? '').trim()
            setDirDraft(null)
            if (dirDraft !== null && next !== dir) patch.mutate({ thesisProjectDir: next })
          }}
        />
      </label>

      <div className="seed-presets">
        <span className="hint">
          「從專案生成」讀多少檔案內容 —— 依你用的模型上下文窗選一組（字數單位是
          字元，中文約 1 字元 ≈ 1 token）。
          {aiTarget?.configured && (
            <>
              　目前 AI：<b>{aiTarget.label}</b>
              （{aiTarget.model}）→ 建議「{suggestedLabel}」那組。
            </>
          )}
        </span>
        <div className="seed-preset-btns">
          {PRESETS.map((p) => {
            const active = per === p.perFile && tot === p.total && maxFiles === p.maxFiles
            return (
              <button
                key={p.id}
                type="button"
                className={`btn sm${active ? ' primary' : ' ghost'}${p.id === suggested ? ' suggested' : ''}`}
                title={`${p.hint}｜每檔 ${p.perFile.toLocaleString()}、合計 ${p.total.toLocaleString()}、最多 ${p.maxFiles} 檔`}
                onClick={() => applyPreset(p)}
              >
                {p.label}
                {p.id === suggested && ' ⭐'}
              </button>
            )
          })}
        </div>
      </div>

      <label>
        「從專案生成」每個檔案最多讀
        <span className="hint">
          單位是字元數（約略對應 token）。越大＝內容越完整但越吃 token／越慢，
          小模型可能塞爆。預設 {DEFAULT_PER_FILE.toLocaleString()}。
        </span>
        <input
          type="number"
          min={1000}
          max={60000}
          step={1000}
          value={perDraft ?? String(per)}
          onChange={(e) => setPerDraft(e.target.value)}
          onBlur={() =>
            commitNum(perDraft, per, 1000, 60000, 'thesisSeedPerFileChars', () => setPerDraft(null))
          }
        />
      </label>

      <label>
        「從專案生成」全部檔案合計最多讀
        <span className="hint">
          所有挑到的檔案內容加起來的上限。預設 {DEFAULT_TOTAL.toLocaleString()}。
        </span>
        <input
          type="number"
          min={2000}
          max={300000}
          step={5000}
          value={totDraft ?? String(tot)}
          onChange={(e) => setTotDraft(e.target.value)}
          onBlur={() =>
            commitNum(totDraft, tot, 2000, 300000, 'thesisSeedTotalChars', () => setTotDraft(null))
          }
        />
      </label>

      <label>
        「從專案生成」最多挑幾個檔案
        <span className="hint">
          依「像不像文件」的評分排序取前 N 個（1–40）。專案文件多、又用大模型
          （GPT-4o、qwen2.5 128k）時可以調高。預設 {DEFAULT_MAX_FILES}。
        </span>
        <input
          type="number"
          min={1}
          max={40}
          step={1}
          value={filesDraft ?? String(maxFiles)}
          onChange={(e) => setFilesDraft(e.target.value)}
          onBlur={() =>
            commitNum(filesDraft, maxFiles, 1, 40, 'thesisSeedMaxFiles', () => setFilesDraft(null))
          }
        />
      </label>

      {(per !== DEFAULT_PER_FILE || tot !== DEFAULT_TOTAL || maxFiles !== DEFAULT_MAX_FILES) && (
        <button
          type="button"
          className="btn sm ghost"
          onClick={() => {
            setPerDraft(null)
            setTotDraft(null)
            setFilesDraft(null)
            patch.mutate({
              thesisSeedPerFileChars: DEFAULT_PER_FILE,
              thesisSeedTotalChars: DEFAULT_TOTAL,
              thesisSeedMaxFiles: DEFAULT_MAX_FILES,
            })
          }}
        >
          從專案生成的上限恢復預設
        </button>
      )}

      {patch.error && <span className="err">{patch.error.message}</span>}
    </div>
  )
}
