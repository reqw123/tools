import { useState } from 'react'
import { useAppSettings, usePatchAppSettings } from '../hooks/useNotes'

const DEFAULT_DIR = 'C:\\ai_project'
const DEFAULT_PER_FILE = 9000
const DEFAULT_TOTAL = 30000

/**
 * 「全域設定 → 研究生」——研究生模式（切到論文專案專用便利貼）的設定：
 * 論文專案資料夾、以及「從專案生成」讀檔案內容的字數上限。
 */
export function ThesisSettings() {
  const { data: settings } = useAppSettings()
  const patch = usePatchAppSettings()
  const [dirDraft, setDirDraft] = useState<string | null>(null)
  const [perDraft, setPerDraft] = useState<string | null>(null)
  const [totDraft, setTotDraft] = useState<string | null>(null)

  if (!settings) return <p className="dim mono">載入中…</p>

  const dir = settings.thesisProjectDir
  const per = settings.thesisSeedPerFileChars
  const tot = settings.thesisSeedTotalChars

  const commitNum = (
    draft: string | null,
    cur: number,
    lo: number,
    hi: number,
    key: 'thesisSeedPerFileChars' | 'thesisSeedTotalChars',
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
          所有挑到的檔案（最多 8 個）內容加起來的上限。預設 {DEFAULT_TOTAL.toLocaleString()}。
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

      {(per !== DEFAULT_PER_FILE || tot !== DEFAULT_TOTAL) && (
        <button
          type="button"
          className="btn sm ghost"
          onClick={() => {
            setPerDraft(null)
            setTotDraft(null)
            patch.mutate({
              thesisSeedPerFileChars: DEFAULT_PER_FILE,
              thesisSeedTotalChars: DEFAULT_TOTAL,
            })
          }}
        >
          字數上限恢復預設
        </button>
      )}

      {patch.error && <span className="err">{patch.error.message}</span>}
    </div>
  )
}
