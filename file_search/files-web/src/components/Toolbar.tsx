import {
  Download,
  FilePenLine,
  FilePlus2,
  FileX2,
  FolderPlus,
  FolderTree,
  PencilLine,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Tag,
  Tags,
  Trash2,
  Upload,
} from 'lucide-react'
import { ThemeToggle } from './ThemeToggle'

export type Group = 'none' | 'category' | 'folder'
export type Sort = 'serial' | 'name'
export type View = 'list' | 'doc'

export function Toolbar({
  indexes,
  index,
  onIndex,
  view,
  onView,
  query,
  onQuery,
  categories,
  category,
  onCategory,
  folders,
  folder,
  onFolder,
  group,
  groupBlocked,
  onGroup,
  sort,
  onSort,
  total,
  shown,
  categoryCount,
  onRecheck,
  checking,
  onAdd,
  onBatchImport,
  onBatchDescribe,
  onBatchCategory,
  onBatchDelete,
  onOpenAiSettings,
  onImportIndex,
  onExportIndex,
  onCreateIndex,
  onEditIndex,
  onDeleteIndex,
}: {
  indexes: string[]
  index: string | null
  onIndex: (v: string) => void
  view: View
  onView: (v: View) => void
  query: string
  onQuery: (v: string) => void
  categories: string[]
  category: string
  onCategory: (v: string) => void
  folders: string[]
  folder: string
  onFolder: (v: string) => void
  group: Group
  /** 因為跟目前的篩選衝突而該停用的分組選項 → 停用原因（滑鼠提示）。 */
  groupBlocked?: Partial<Record<Group, string>>
  onGroup: (v: Group) => void
  sort: Sort
  onSort: (v: Sort) => void
  total: number
  shown: number
  categoryCount: number
  onRecheck: () => void
  checking: boolean
  /** 寫入動作——都需要選定一份索引集，否則停用。 */
  onAdd: () => void
  onBatchImport: () => void
  onBatchDescribe: () => void
  onBatchCategory: () => void
  onBatchDelete: () => void
  onOpenAiSettings: () => void
  onImportIndex: () => void
  onExportIndex: () => void
  /** 索引集層級：新增空白 / 用系統編輯器開啟 / 刪除整份——都需選定一份，否則停用。 */
  onCreateIndex: () => void
  onEditIndex: () => void
  onDeleteIndex: () => void
}) {
  return (
    <div className="bar">
      <div className="bar-inner">
        <div className="bar-row top">
          <label className="index-pick">
            <span className="mono lbl">索引集</span>
            <select value={index ?? ''} onChange={(e) => onIndex(e.target.value)}>
              {indexes.length === 0 && <option value="">（找不到索引集）</option>}
              {indexes.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn ghost icon"
            onClick={onImportIndex}
            title="匯入索引集（選一份既有的 .md，建立成新的索引集）"
          >
            <Upload size={15} strokeWidth={2.2} aria-hidden />
          </button>
          <button
            className="btn ghost icon"
            onClick={onExportIndex}
            disabled={!index}
            title="匯出索引集（把目前這份 .md 的原始內容存到你指定的位置）"
          >
            <Download size={15} strokeWidth={2.2} aria-hidden />
          </button>
          <button
            className="btn ghost icon"
            onClick={onEditIndex}
            disabled={!index}
            title="編輯索引集（用系統文字編輯器開啟這份 .md，改前言／路徑／格式）"
          >
            <FilePenLine size={15} strokeWidth={2.2} aria-hidden />
          </button>
          <button
            className="btn ghost icon"
            onClick={onCreateIndex}
            title="新增索引集（在 indexes/ 底下建立一份新的空白 .md）"
          >
            <FilePlus2 size={15} strokeWidth={2.2} aria-hidden />
          </button>
          <button
            className="btn ghost icon danger"
            onClick={onDeleteIndex}
            disabled={!index}
            title="刪除索引集（刪掉整份 .md 索引紀錄，不碰硬碟上的實體檔案）"
          >
            <FileX2 size={15} strokeWidth={2.2} aria-hidden />
          </button>
          <div className="counts mono">
            <span>
              <b>{view === 'doc' ? total : shown}</b>
              {view === 'list' && shown !== total && <span className="of"> / {total}</span>} 項
            </span>
            <span className="dot">·</span>
            <span>
              <b>{categoryCount}</b> 種分類
            </span>
          </div>
          <div className="spacer" />
          <div className="seg" role="group" aria-label="檢視方式">
            <button
              className={view === 'list' ? 'on' : ''}
              onClick={() => onView('list')}
              aria-pressed={view === 'list'}
              title="清單：把索引項目一張張列出來，可搜尋、依分類／資料夾篩選、逐列開檔或編輯"
            >
              清單
            </button>
            <button
              className={view === 'doc' ? 'on' : ''}
              onClick={() => onView('doc')}
              aria-pressed={view === 'doc'}
              title="文件：把整份索引集的 .md（前言＋表格）當一份文件排版呈現，唯讀"
            >
              文件
            </button>
          </div>
          <ThemeToggle />
        </div>

        <div className="bar-row acts">
          <button className="btn sm" onClick={onAdd} disabled={!index} title="從本機挑一個檔案加進索引">
            <Plus size={14} strokeWidth={2.4} aria-hidden /> 加入索引
          </button>
          <button
            className="btn sm"
            onClick={onBatchImport}
            disabled={!index}
            title="掃描一整個資料夾，整批加進索引"
          >
            <FolderPlus size={14} strokeWidth={2.2} aria-hidden /> 匯入資料夾
          </button>
          <button
            className="btn sm"
            onClick={onBatchDescribe}
            disabled={!index}
            title="對說明是空的項目擷取內容（或用 AI）逐筆補上說明"
          >
            <PencilLine size={14} strokeWidth={2.2} aria-hidden /> 批次補說明
          </button>
          <button
            className="btn sm"
            onClick={onBatchCategory}
            disabled={!index}
            title="批次分類——「補上空白的」（逐筆帶建議、有清單）或「舊分類→新分類」（整批換名）"
          >
            <Tags size={14} strokeWidth={2.2} aria-hidden /> 批次分類
          </button>
          <button
            className="btn sm"
            onClick={onOpenAiSettings}
            title="設定「批次補說明」要用的 AI（OpenAI / Ollama）"
          >
            <Settings2 size={13} strokeWidth={2.2} aria-hidden /> AI 設定
          </button>
          <button
            className="btn sm danger"
            onClick={onBatchDelete}
            disabled={!index}
            title="搜尋、勾選、一次從索引移除多筆（不碰實體檔案）"
          >
            <Trash2 size={14} strokeWidth={2.2} aria-hidden /> 批次刪除
          </button>
          <span className="acts-note mono">寫入只動 .md · 不碰實體檔案</span>
        </div>

        {view === 'doc' && (
        <div className="bar-row">
          <label className="field">
            <Search size={15} strokeWidth={2.4} aria-hidden />
            <input
              type="search"
              value={query}
              placeholder="在整份文件裡尋找…"
              onChange={(e) => onQuery(e.target.value)}
            />
          </label>
          <span className="acts-note mono">只留下符合的表格列，其餘（含前言）收起來；清空即恢復整份</span>
        </div>
        )}

        {view === 'list' && (
        <div className="bar-row">
          <label className="field">
            <Search size={15} strokeWidth={2.4} aria-hidden />
            <input
              type="search"
              value={query}
              placeholder="搜尋檔名、分類、說明、完整路徑…"
              onChange={(e) => onQuery(e.target.value)}
            />
          </label>

          <label className="select-field" title="依分類篩選">
            <Tag size={14} strokeWidth={2.2} aria-hidden />
            <select value={category} onChange={(e) => onCategory(e.target.value)}>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c === '' ? '全部分類' : c}
                </option>
              ))}
            </select>
          </label>

          <label className="select-field" title="依所在資料夾篩選">
            <FolderTree size={14} strokeWidth={2.2} aria-hidden />
            <select value={folder} onChange={(e) => onFolder(e.target.value)}>
              {folders.map((f) => (
                <option key={f} value={f}>
                  {f === '' ? '全部資料夾' : f}
                </option>
              ))}
            </select>
          </label>

          <div className="seg" role="group" aria-label="分組">
            {(['none', 'category', 'folder'] as const).map((g) => {
              const blocked = groupBlocked?.[g]
              return (
                <button
                  key={g}
                  className={group === g ? 'on' : ''}
                  onClick={() => onGroup(g)}
                  aria-pressed={group === g}
                  disabled={!!blocked}
                  title={blocked}
                >
                  {g === 'none' ? '不分組' : g === 'category' ? '分類' : '資料夾'}
                </button>
              )
            })}
          </div>

          <div className="seg" role="group" aria-label="排序">
            {(['serial', 'name'] as const).map((s) => (
              <button
                key={s}
                className={sort === s ? 'on' : ''}
                onClick={() => onSort(s)}
                aria-pressed={sort === s}
              >
                {s === 'serial' ? '原順序' : '檔名'}
              </button>
            ))}
          </div>

          <button
            className={`btn ghost icon${checking ? ' spin' : ''}`}
            onClick={onRecheck}
            title="重新檢查所有檔案是否還在"
          >
            <RefreshCw size={15} strokeWidth={2.2} aria-hidden />
          </button>
        </div>
        )}
      </div>
    </div>
  )
}
