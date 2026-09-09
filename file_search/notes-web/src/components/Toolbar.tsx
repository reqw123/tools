import {
  AlarmClock, ArrowDownUp, Bot, CopyPlus, CornerDownLeft, Download, GraduationCap, HardDriveDownload, History, Home,
  Plus, Recycle, Search, Settings2, Sparkles, Sprout, Tags, Timer, Trash2, Upload,
} from 'lucide-react'
import { NOTE_SORTS, type NoteSort } from '../lib/noteSort'
import type { AiTarget } from '../lib/ai'
import type { NoteCollection } from '../lib/api'
import type { TagCount } from './TagBar'
import { TagBar } from './TagBar'
import { ThemeToggle } from './ThemeToggle'

/** 「語意」開關的即時狀態，給搜尋列底下那行揭露文字用。 */
export type SemanticState =
  | null
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'idle'; model: string }
  | { kind: 'ok'; count: number; model: string; topScore: number }

export function Toolbar({
  query,
  onQuery,
  sort,
  onSort,
  tag,
  onTag,
  tags,
  total,
  collection,
  onSwitchCollection,
  onThesisSeed,
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
  onBatchTag,
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
  sort: NoteSort
  onSort: (v: NoteSort) => void
  tag: string | null
  onTag: (t: string | null) => void
  tags: TagCount[]
  total: number
  /** 便利貼集合切換——null＝不顯示（一般瀏覽器）；有值＝桌面牆，顯示「生活／研究生」。 */
  collection: NoteCollection | null
  onSwitchCollection: (c: NoteCollection) => void
  /** 研究生模式限定——「從專案生成」按鈕。 */
  onThesisSeed: () => void
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
  onBatchTag: () => void
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
        {/* 第一排：便利貼集合分頁（桌面牆才有）＋主題鈕（靠右） */}
        <div className="collection-row">
          {collection && (
            <div className="coll-tabs" role="group" aria-label="便利貼集合">
              <button
                type="button"
                className={`coll-tab${collection === 'life' ? ' on' : ''}`}
                aria-pressed={collection === 'life'}
                onClick={() => onSwitchCollection('life')}
              >
                <Home size={14} strokeWidth={2.2} aria-hidden /> 生活
              </button>
              <button
                type="button"
                className={`coll-tab${collection === 'thesis' ? ' on' : ''}`}
                aria-pressed={collection === 'thesis'}
                onClick={() => onSwitchCollection('thesis')}
              >
                <GraduationCap size={15} strokeWidth={2.2} aria-hidden /> 研究生
              </button>
              {collection === 'thesis' && (
                <span className="coll-note mono">
                  論文專案專用便利貼 · 存在 C:\ai_project · 跟生活便利貼完全分開
                </span>
              )}
            </div>
          )}
          <ThemeToggle />
        </div>

        {/* 第二排：搜尋框（拉長填滿）→ 排序 → 新增便利貼，三者同高。 */}
        <div className="bar-row bar-row-find">
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
          <label className="sort-pick" title="牆面排序（釘選永遠在最前）">
            <ArrowDownUp size={14} strokeWidth={2.2} aria-hidden />
            <select value={sort} onChange={(e) => onSort(e.target.value as NoteSort)}>
              {NOTE_SORTS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <button className="btn add-note" onClick={onAdd}>
            <Plus size={16} strokeWidth={2.6} aria-hidden />
            新增便利貼
          </button>
        </div>

        {/* 第三排：所有工具鈕，統一尺寸的正方形圖示鈕。 */}
        <div className="bar-row bar-row-tools">
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
          <button
            className={`btn ghost icon${dueOnly ? ' on' : ''}`}
            onClick={onToggleDueOnly}
            aria-pressed={dueOnly}
            title="只看快到期／已逾期（依到期日由早到晚排序）"
          >
            <AlarmClock size={15} strokeWidth={2.2} aria-hidden />
          </button>
          <button className="btn ghost icon" onClick={() => onOpenSettings()} title="全域設定">
            <Settings2 size={15} strokeWidth={2.2} aria-hidden />
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
          {collection === 'thesis' && (
            <button
              className="btn ghost icon"
              onClick={onThesisSeed}
              title="從專案生成——AI 讀 C:\ai_project 的文件，產出一批論文任務便利貼草稿"
            >
              <GraduationCap size={16} strokeWidth={2.2} aria-hidden />
            </button>
          )}
          <button
            className="btn ghost icon"
            onClick={onBatchTag}
            title="批次標籤——「補上空白的」（有清單）或「舊標籤→新標籤」（整批換名）"
          >
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
                  ? semanticState.count === 0
                    ? `🌱 沒有語意夠接近的便利貼（最高相似 ${Math.round(semanticState.topScore * 100)}%）· 換個說法或關掉「語意」用關鍵字找`
                    : `🌱 依語意相似度排序 · 命中 ${semanticState.count} 則 · 最相關 ${Math.round(
                        semanticState.topScore * 100,
                      )}% · 本機 ${semanticState.model}，內容不離開這台電腦`
                  : `🌱 語意搜尋已開啟（本機 ${semanticState.model || 'Ollama'}）· 在上面輸入想找的意思，例如「出國要帶的東西」`}
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
