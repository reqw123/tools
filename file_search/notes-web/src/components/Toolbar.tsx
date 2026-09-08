import {
  AlarmClock, Bot, CopyPlus, CornerDownLeft, Download, HardDriveDownload, History, Plus, Recycle, Search, Settings2,
  Sparkles, Sprout, Tags, Timer, Trash2, Upload,
} from 'lucide-react'
import type { AiTarget } from '../lib/ai'
import type { TagCount } from './TagBar'
import { TagBar } from './TagBar'

/** 「語意」開關的即時狀態，給搜尋列底下那行揭露文字用。 */
export type SemanticState =
  | null
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'idle'; model: string }
  | { kind: 'ok'; count: number; model: string }

export function Toolbar({
  query,
  onQuery,
  tag,
  onTag,
  tags,
  total,
  onAdd,
  aiMode,
  onToggleAiMode,
  onAiSearch,
  semanticOn,
  onToggleSemantic,
  semanticState,
  aiTarget,
  aiSearching,
  aiError,
  sendCount,
  onOpenSettings,
  onExport,
  exportCount,
  onExportJson,
  onImportJson,
  onBatchCreate,
  onBatchRecategorize,
  onBatchDelete,
  onGenerateNotes,
  onTrash,
  onHistory,
  dueOnly,
  onToggleDueOnly,
  onOpenReminderSettings,
}: {
  query: string
  onQuery: (v: string) => void
  tag: string | null
  onTag: (t: string | null) => void
  tags: TagCount[]
  total: number
  onAdd: () => void
  aiMode: boolean
  onToggleAiMode: () => void
  onAiSearch: (q: string) => void
  semanticOn: boolean
  onToggleSemantic: () => void
  semanticState: SemanticState
  aiTarget: AiTarget | undefined
  aiSearching: boolean
  aiError: string | null
  sendCount: number
  onOpenSettings: (tab?: 'ai' | 'tags' | 'appearance') => void
  onExport: () => void
  exportCount: number
  onExportJson: () => void
  onImportJson: () => void
  onBatchCreate: () => void
  onBatchRecategorize: () => void
  onBatchDelete: () => void
  onGenerateNotes: () => void
  onTrash: () => void
  onHistory: () => void
  dueOnly: boolean
  onToggleDueOnly: () => void
  onOpenReminderSettings: () => void
}) {
  return (
    <div className="bar">
      <div className="bar-inner">
        <div className="bar-row">
          <label className={`field${aiMode ? ' ai' : ''}${semanticOn ? ' semantic' : ''}`}>
            {aiMode ? (
              <Bot size={16} strokeWidth={2.2} aria-hidden />
            ) : semanticOn ? (
              <Sprout size={15} strokeWidth={2.4} aria-hidden />
            ) : (
              <Search size={15} strokeWidth={2.4} aria-hidden />
            )}
            <input
              type={aiMode ? 'text' : 'search'}
              value={query}
              placeholder={
                aiMode
                  ? '問問題：有哪些跟○○有關、○○有幾個、目前有哪些分類…'
                  : semanticOn
                    ? '用意思找：出國要帶的東西、想放鬆的活動…（自動依相似度排序）'
                    : '搜尋標題、內容、分類…'
              }
              onChange={(e) => onQuery(e.target.value)}
              onKeyDown={(e) => {
                if (aiMode && e.key === 'Enter') {
                  e.preventDefault()
                  onAiSearch(query)
                }
              }}
            />
            {aiMode && (
              // AI 模式下打完問題要「送出」才會呼叫模型——光按 Enter 不夠明顯，
              // 補一顆看得到的送出鈕（Enter 仍然可用）。
              <button
                type="button"
                className="ai-send"
                disabled={!query.trim() || aiSearching}
                onClick={() => onAiSearch(query)}
                title="送出問題給 AI（也可以按 Enter）"
              >
                <CornerDownLeft size={14} strokeWidth={2.6} aria-hidden />
                {aiSearching ? '詢問中…' : '送出'}
              </button>
            )}
          </label>
          <button
            className={`btn ghost icon${aiMode ? ' on' : ''}`}
            onClick={onToggleAiMode}
            aria-pressed={aiMode}
            title={aiMode ? '切回一般搜尋' : 'AI 搜尋（用一般語句問問題）'}
          >
            <Bot size={16} strokeWidth={2.2} aria-hidden />
          </button>
          <button
            className={`btn ghost icon${semanticOn ? ' on' : ''}`}
            onClick={onToggleSemantic}
            aria-pressed={semanticOn}
            title={semanticOn ? '切回一般搜尋' : '語意搜尋（本機 Ollama，依意思相近排序）'}
          >
            <Sprout size={16} strokeWidth={2.2} aria-hidden />
          </button>
          <button className="btn ghost icon" onClick={() => onOpenSettings()} title="全域設定">
            <Settings2 size={15} strokeWidth={2.2} aria-hidden />
          </button>
          <button
            className={`btn ghost icon${dueOnly ? ' on' : ''}`}
            onClick={onToggleDueOnly}
            aria-pressed={dueOnly}
            title="只看快到期／已逾期（依到期日由早到晚排序）"
          >
            <AlarmClock size={15} strokeWidth={2.2} aria-hidden />
          </button>
          <button
            className="btn ghost icon"
            onClick={onOpenReminderSettings}
            title="提醒設定（幾小時內算快到期）"
          >
            <Timer size={15} strokeWidth={2.2} aria-hidden />
          </button>
          <button
            className="btn ghost icon"
            onClick={onExport}
            disabled={exportCount === 0}
            title={`匯出目前顯示的 ${exportCount} 則為 HTML（給人看）`}
          >
            <Download size={15} strokeWidth={2.2} aria-hidden />
          </button>
          <button
            className="btn ghost icon"
            onClick={onExportJson}
            title="匯出便利貼資料（JSON，可搬到另一台電腦或桌面版匯入）"
          >
            <HardDriveDownload size={15} strokeWidth={2.2} aria-hidden />
          </button>
          <button
            className="btn ghost icon"
            onClick={onImportJson}
            title="匯入便利貼資料（讀取先前匯出的 JSON，合併進目前清單）"
          >
            <Upload size={15} strokeWidth={2.2} aria-hidden />
          </button>
          <button className="btn ghost icon" onClick={onBatchCreate} title="批次新增">
            <CopyPlus size={15} strokeWidth={2.2} aria-hidden />
          </button>
          <button
            className="btn ghost icon"
            onClick={onGenerateNotes}
            title="AI 生成便利貼——選檔案讓 AI 分析、生成草稿"
          >
            <Sparkles size={15} strokeWidth={2.2} aria-hidden />
          </button>
          <button className="btn ghost icon" onClick={onBatchRecategorize} title="批次改標籤">
            <Tags size={15} strokeWidth={2.2} aria-hidden />
          </button>
          <button className="btn ghost icon" onClick={onBatchDelete} title="批次刪除">
            <Trash2 size={15} strokeWidth={2.2} aria-hidden />
          </button>
          <button className="btn ghost icon" onClick={onTrash} title="垃圾桶（刪除的便利貼可以在這裡復原）">
            <Recycle size={15} strokeWidth={2.2} aria-hidden />
          </button>
          <button
            className="btn ghost icon"
            onClick={onHistory}
            title="版本記錄（自動備份；批次操作出錯、內容被覆蓋時整份還原到某個時間點）"
          >
            <History size={15} strokeWidth={2.2} aria-hidden />
          </button>
          <button className="btn" onClick={onAdd}>
            <Plus size={16} strokeWidth={2.6} aria-hidden />
            新增便利貼
          </button>
        </div>

        <TagBar tags={tags} active={tag} total={total} onPick={onTag} />

        {aiMode && (
          <p className="ai-disclose mono">
            {aiSearching
              ? '🤖 詢問中…'
              : aiError
                ? `❌ ${aiError}`
                : !aiTarget || !aiTarget.configured
                  ? '⚠️ 尚未設定 AI '
                  : `會把 ${sendCount} 則送到 ${aiTarget.label}（${aiTarget.model}）· ${
                      aiTarget.leaves_machine ? '內容會離開這台電腦' : '內容不離開這台電腦'
                    } · 累計第 ${aiTarget.call_count + 1} 次 · 按右側「送出」或 Enter 才會呼叫`}
            {!aiSearching && (
              <button className="link" onClick={() => onOpenSettings('ai')}>
                設定
              </button>
            )}
          </p>
        )}

        {semanticState && (
          <p className="ai-disclose mono">
            {semanticState.kind === 'loading'
              ? '🌱 正在計算語意相似度…（第一次會把所有便利貼轉成向量，可能要幾秒）'
              : semanticState.kind === 'error'
                ? `❌ ${semanticState.message}——已暫時退回一般關鍵字搜尋`
                : semanticState.kind === 'ok'
                  ? `🌱 依語意相似度排序 · 命中 ${semanticState.count} 則 · 本機 ${semanticState.model}，內容不離開這台電腦`
                  : `🌱 語意搜尋已開啟（本機 ${semanticState.model || 'Ollama'}）· 在上面輸入想找的意思`}
            {semanticState.kind === 'error' && (
              <button className="link" onClick={() => onOpenSettings('ai')}>
                設定
              </button>
            )}
          </p>
        )}
      </div>
    </div>
  )
}
