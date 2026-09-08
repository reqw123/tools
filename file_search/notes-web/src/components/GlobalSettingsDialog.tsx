import { useEffect, useRef, useState } from 'react'
import { AiSettingsPanel } from './AiSettingsDialog'
import { TagSortSettings } from './TagSortSettings'
import { AppearanceSettings } from './AppearanceSettings'
import { TrashSettings } from './TrashSettings'

export type SettingsTab = 'ai' | 'tags' | 'appearance' | 'trash'

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'ai', label: 'AI 請求' },
  { id: 'tags', label: '標籤排序' },
  { id: 'appearance', label: '外觀' },
  { id: 'trash', label: '垃圾桶' },
]

/**
 * 「全域設定」——原本的「AI 設定」擴充成分頁對話框：AI 請求設定、標籤橫向列
 * 的排序、牆面外觀（預設便利貼顏色、欄寬、動態排版開關）、垃圾桶自動清理
 * 門檻。全部存在跟桌面版共用的檔案裡（AI 設定 → .ai_settings.json；其餘 →
 * .notes_settings.json）。
 */
export function GlobalSettingsDialog({
  onClose,
  initialTab = 'ai',
}: {
  onClose: () => void
  initialTab?: SettingsTab
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [tab, setTab] = useState<SettingsTab>(initialTab)

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
        className="sheet plain settings-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="全域設定"
        tabIndex={-1}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="icon-btn" onClick={onClose} aria-label="關閉">
          ×
        </button>
        <h2>全域設定</h2>

        <div className="tab-row" role="tablist" aria-label="設定分類">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={tab === t.id}
              className={`tab${tab === t.id ? ' on' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* 三個分頁都保持掛載、只切換顯示——切分頁不會弄丟 AI 表單裡還沒按
            「儲存」的編輯，也不會每次切回來就重抓 Ollama 模型清單。 */}
        <div hidden={tab !== 'ai'}>
          <AiSettingsPanel onClose={onClose} />
        </div>
        <div hidden={tab !== 'tags'}>
          <TagSortSettings />
        </div>
        <div hidden={tab !== 'appearance'}>
          <AppearanceSettings />
        </div>
        <div hidden={tab !== 'trash'}>
          <TrashSettings />
        </div>
      </div>
    </div>
  )
}
