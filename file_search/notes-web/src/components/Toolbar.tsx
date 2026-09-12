import { useEffect, useState } from 'react'
import {
  Activity, AlarmClock, ArrowDownUp, Bell, Bot, ChevronDown, ChevronUp, Columns3, CopyPlus,
  CornerDownLeft, FileCode2, GraduationCap, HardDriveDownload, HardDriveUpload, History, Home,
  Plus, Recycle, Rows3, Search, Settings2, Sparkles, Sprout, Tags, Trash2,
} from 'lucide-react'
import { NOTE_SORTS, type NoteSort } from '../lib/noteSort'
import type { SettingsTab } from './GlobalSettingsDialog'
import type { AiTarget } from '../lib/ai'
import type { NoteCollection } from '../lib/api'
import type { TagCount } from './TagBar'
import { TagBar } from './TagBar'
import { ThemeToggle } from './ThemeToggle'
import { ShareLinkButton } from './ShareLinkButton'

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
  onActivity,
  onNotifications,
  unreadNotifications = 0,
  dueOnly,
  onToggleDueOnly,
  sortLocked,
  tagAxis,
  masonryOn,
  onToggleTagAxis,
  shareMode = false,
  aiEnabled = true,
  canWrite = true,
  collapsed,
  onToggleCollapsed,
}: {
  query: string
  onQuery: (v: string) => void
  sort: NoteSort
  onSort: (v: NoteSort) => void
  /** 目前的排序被別的東西覆蓋掉了（只看快到期／AI／語意）→ 覆蓋原因（滑鼠提示）。
   *  有值時排序下拉停用。 */
  sortLocked?: string
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
  onOpenSettings: (tab?: SettingsTab) => void
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
  /** 「誰動了我的牆」動態列表——只有共用模式才顯示這顆鈕（見呼叫端）。 */
  onActivity?: () => void
  /** 站內通知——只有共用模式才顯示這顆鈕（見呼叫端）。 */
  onNotifications?: () => void
  /** 未讀通知數——>0 時鈴鐺疊一個紅點數字。 */
  unreadNotifications?: number
  dueOnly: boolean
  onToggleDueOnly: () => void
  /** 「同分類排列方向」——快捷切換，跟「全域設定 → 外觀」是同一個設定。 */
  tagAxis: 'vertical' | 'horizontal'
  /** 「牆面動態排版」是否開著——關著時 tagAxis 沒有效果，切換時給提醒。 */
  masonryOn: boolean
  onToggleTagAxis: () => void
  /** 區網共用模式——隱藏會攤開 host 硬碟的「AI 生成便利貼」（選資料夾）。 */
  shareMode?: boolean
  /** AI 搜尋／語意搜尋能不能用（共用模式且 host 在 /host 關掉 AI 時為 false）。 */
  aiEnabled?: boolean
  /** 這個人能不能寫（唯讀身分＝false）——見 hooks/useSession.ts 的 useCanWrite()。
   *  只是 UI 提示，真正的防線在後端 403。 */
  canWrite?: boolean
  /** 上方面板（標題／簡介、集合分頁、搜尋排序新增、小按鈕列）收合中——手機
   *  用，跟 App.tsx 的主標題共用同一個開關，見那邊的說明。 */
  collapsed: boolean
  onToggleCollapsed: () => void
}) {
  // 動態排版關著時按了快捷切換 → 顯示一條提醒（幾秒後自己消失）。
  const [axisHint, setAxisHint] = useState(false)
  useEffect(() => {
    if (!axisHint) return
    const t = setTimeout(() => setAxisHint(false), 6000)
    return () => clearTimeout(t)
  }, [axisHint])
  const toggleTagAxis = () => {
    onToggleTagAxis()
    setAxisHint(!masonryOn)
  }
  // 「同分類集中」排序時每個分類自成一段，橫／直排完全不影響 → 快捷鈕停用。
  const tagAxisLocked =
    sort === 'tag-band'
      ? '「同分類集中」排序時每個分類自成一段、彼此隔開，橫／直排不影響——換其他排序方式才有作用'
      : undefined

  return (
    <div className="bar">
      <div className="bar-inner">
        {/* 整個上方面板（集合分頁／搜尋排序新增／小按鈕列）收合成一顆分界列
            ——手機上這塊佔太多高度，捲動便利貼時容易不小心捲回這裡。CSS
            grid-rows 0fr/1fr 收合，收合狀態由 App.tsx 提供，跟主標題/簡介
            共用同一個開關，一起收合。 */}
        <div className={`panel-collapse${collapsed ? ' collapsed' : ''}`}>
          <div className="panel-collapse-inner">
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
          <div className="tb-right">
            <ShareLinkButton />
            <ThemeToggle />
          </div>
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
          <label
            className={`sort-pick${sortLocked ? ' locked' : ''}`}
            title={
              sortLocked ??
              '牆面排序（釘選永遠在最前）。「不指定」「同分類集中」＝看全部時依分類分組；其餘（最新／標題／待辦…）一律攤平照它排。「未完成待辦最少」只列有待辦框的便利貼'
            }
          >
            <ArrowDownUp size={14} strokeWidth={2.2} aria-hidden />
            <select
              value={sort}
              disabled={!!sortLocked}
              onChange={(e) => onSort(e.target.value as NoteSort)}
            >
              {NOTE_SORTS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          {canWrite && (
            <button className="btn add-note" onClick={onAdd}>
              <Plus size={16} strokeWidth={2.6} aria-hidden />
              新增便利貼
            </button>
          )}
        </div>

        {/* 第三排：所有工具鈕，統一尺寸的正方形圖示鈕。 */}
        <div className="bar-row bar-row-tools">
          {aiEnabled ? (
            <>
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
            </>
          ) : (
            // 不只是把按鈕藏起來——host 在 /host 關掉遠端 AI 時，明講一句，別讓人
            // 以為「怎麼搜尋不到答案」，見 host-routes.ts / share.ts 的 aiEnabled 開關。
            <span className="ai-disabled-badge" title="host 在 /host 關掉了遠端 AI——AI 搜尋、AI 生成、語意搜尋都暫時用不了">
              <Bot size={14} strokeWidth={2.2} aria-hidden />
              AI 已停用
            </span>
          )}
          <button
            className={`btn ghost icon${dueOnly ? ' on' : ''}`}
            onClick={onToggleDueOnly}
            aria-pressed={dueOnly}
            title="只看快到期／已逾期（依到期日由早到晚排序）。門檻與到期通知在「全域設定 → 提醒」"
          >
            <AlarmClock size={15} strokeWidth={2.2} aria-hidden />
          </button>
          <button
            className={`btn ghost icon${!tagAxisLocked && !masonryOn ? ' dim' : ''}`}
            onClick={toggleTagAxis}
            disabled={!!tagAxisLocked}
            title={
              tagAxisLocked ??
              `${
                tagAxis === 'horizontal'
                  ? '同分類排列：橫向（點一下改直向）'
                  : '同分類排列：直向（點一下改橫向）'
              }。跟「全域設定 → 外觀」同一個設定${
                masonryOn ? '' : '——目前「牆面動態排版」關閉，切了看不出差別'
              }`
            }
          >
            {tagAxis === 'horizontal' ? (
              <Rows3 size={15} strokeWidth={2.2} aria-hidden />
            ) : (
              <Columns3 size={15} strokeWidth={2.2} aria-hidden />
            )}
          </button>
          <button
            className="btn ghost icon"
            onClick={() => onOpenSettings()}
            title="全域設定（AI、標籤、外觀、提醒、垃圾桶、研究生）"
          >
            <Settings2 size={15} strokeWidth={2.2} aria-hidden />
          </button>
          <button
            className="btn ghost icon"
            onClick={onExport}
            disabled={exportCount === 0}
            title={`匯出成 HTML 網頁（目前顯示的 ${exportCount} 則，給人看／分享用）`}
          >
            <FileCode2 size={15} strokeWidth={2.2} aria-hidden />
          </button>
          {/* 資料備份／還原是一組——框在一起、跟旁邊鬆散的圖示鈕區隔，
              下載／上傳箭頭方向相反，一眼看得出誰是匯出誰是匯入。 */}
          <span className="io-group" role="group" aria-label="便利貼資料備份／還原">
            <button
              className="btn ghost icon"
              onClick={onExportJson}
              title="備份便利貼資料成 JSON 檔（可搬到另一台電腦，或用桌面版／此頁匯入）"
            >
              <HardDriveDownload size={15} strokeWidth={2.2} aria-hidden />
            </button>
            <button
              className="btn ghost icon"
              onClick={onImportJson}
              title="從先前備份的 JSON 檔還原（合併進目前清單，不會覆蓋現有便利貼）"
            >
              <HardDriveUpload size={15} strokeWidth={2.2} aria-hidden />
            </button>
          </span>
          <button className="btn ghost icon" onClick={onBatchCreate} title="批次新增">
            <CopyPlus size={15} strokeWidth={2.2} aria-hidden />
          </button>
          {!shareMode && (
            <button
              className="btn ghost icon"
              onClick={onGenerateNotes}
              title="AI 生成便利貼——選檔案讓 AI 分析、生成草稿"
            >
              <Sparkles size={15} strokeWidth={2.2} aria-hidden />
            </button>
          )}
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
          {onActivity && (
            <button
              className="btn ghost icon"
              onClick={onActivity}
              title="動態——誰新增／改／刪了什麼（共用模式）"
            >
              <Activity size={15} strokeWidth={2.2} aria-hidden />
            </button>
          )}
          {onNotifications && (
            <button
              className="btn ghost icon notif-btn"
              onClick={onNotifications}
              title="通知——例如便利貼指派給你了"
            >
              <Bell size={15} strokeWidth={2.2} aria-hidden />
              {unreadNotifications > 0 && (
                <span className="notif-badge">{unreadNotifications > 99 ? '99+' : unreadNotifications}</span>
              )}
            </button>
          )}
          </div>
          </div>
        </div>

        {/* 分界列——手機上這塊面板太高，捲動便利貼時容易不小心捲回這裡。這顆
            負責收合/展開上面整塊（標題/簡介/統計、集合分頁、搜尋排序新增、
            小按鈕列）。標籤列（下面）跟便利貼牆本身不受影響，永遠看得到。 */}
        <button
          type="button"
          className="panel-collapse-handle"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
        >
          {collapsed ? (
            <>
              <ChevronDown size={15} strokeWidth={2.4} aria-hidden />
              展開
            </>
          ) : (
            <>
              <ChevronUp size={15} strokeWidth={2.4} aria-hidden />
              收合
            </>
          )}
        </button>

        <TagBar tags={tags} active={tag} total={total} onPick={onTag} />

        {axisHint && (
          <p className="ai-disclose mono">
            ⚠️ 已切換「同分類排列方向」——但「牆面動態排版」關閉中，目前是等寬格線、
            看不出橫／直差別。（設定有記住，打開動態排版就會套用）
            <button className="link" onClick={() => onOpenSettings('appearance')}>
              去打開
            </button>
          </p>
        )}

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
