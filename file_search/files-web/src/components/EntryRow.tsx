import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Clipboard, Eye, FolderOpen, Pencil, Pin, SquareArrowOutUpRight, Trash2 } from 'lucide-react'
import type { Entry, PathStat } from '../lib/api'
import { categoryColor } from '../lib/catColor'
import { humanSize, kindLabel, kindOf, stampOf } from '../lib/format'
import { FilePreview } from './FilePreview'

export function EntryRow({
  entry,
  stat,
  expanded,
  onToggle,
  onOpen,
  onCopy,
  onEdit,
  editing,
  editError,
  categories,
  categoryColors,
  onSetCategoryColor,
  onDelete,
  deleting,
  onPin,
  register,
}: {
  entry: Entry
  stat: PathStat | undefined
  expanded: boolean
  onToggle: () => void
  onOpen: (select: boolean) => void
  onCopy: () => void
  /** 原地改這一列的分類／說明（只動 .md，不碰實體檔案）。未提供＝不顯示按鈕。 */
  onEdit?: (v: { category: string; description: string }) => void
  editing?: boolean
  editError?: string | null
  /** 分類欄 datalist 的建議值（目前這份索引集已用過的分類）。 */
  categories?: string[]
  /** 分類→自訂顏色（hex）；沒有的分類退回雜湊配色。 */
  categoryColors?: Record<string, string>
  /** 設定/清除分類自訂顏色（null＝清掉退回雜湊）；未提供＝編輯區不顯示挑色。 */
  onSetCategoryColor?: (category: string, color: string | null) => void
  /** 從索引集移除這一列（只動 .md，不碰實體檔案）。未提供＝不顯示按鈕。 */
  onDelete?: () => void
  deleting?: boolean
  /** 把這一列變成獨立懸浮視窗（wallpaper-app 專屬）。rect 是這一列目前的
   *  螢幕位置/大小，給懸浮視窗初始參考值。未提供＝不顯示釘選鈕。 */
  onPin?: (rect: DOMRect) => void
  register: (el: HTMLElement | null, path: string) => (() => void) | void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => register(ref.current, entry.path), [register, entry.path])
  const [preview, setPreview] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [draftCat, setDraftCat] = useState(entry.category)
  const [draftDesc, setDraftDesc] = useState(entry.description)
  const listId = useId()
  // 列的 React key 以路徑為主（見 EntryList.keyOf），刪一列通常不動到別列的
  // 實例。但「同路徑重複收錄」時刪掉其中一筆，另一筆的 key 會變 → 實例可能被
  // 換去代表另一筆資料。這裡在 render 階段偵測「這個實例代表的那一列內容變了」
  // 就把展開／刪除確認這些暫時狀態清掉，避免殘留的「確定移除」按鈕造成誤刪。
  const rowSig = `${entry.serial}\x00${entry.path}\x00${entry.category}\x00${entry.description}`
  const [seenSig, setSeenSig] = useState(rowSig)
  if (seenSig !== rowSig) {
    setSeenSig(rowSig)
    setPreview(false)
    setConfirmDel(false)
    // 這一列的內容變了（含編輯成功後重新載入）——收掉編輯框、草稿對回新值。
    setEditOpen(false)
    setDraftCat(entry.category)
    setDraftDesc(entry.description)
  }

  const openEdit = () => {
    setDraftCat(entry.category)
    setDraftDesc(entry.description)
    setConfirmDel(false)
    setEditOpen(true)
  }
  const dirty = draftCat !== entry.category || draftDesc !== entry.description

  const kind = kindOf(entry.ext)
  const missing = stat && !stat.exists

  // 分類晶片依名稱雜湊配色（跟桌面版清單、便利貼標籤同一套色相）。只丟
  // `--marker`；文字/底/框由 .chip 的 CSS 用 --ink（跟主題走）color-mix 出來。
  const chipStyle = useMemo<CSSProperties | undefined>(() => {
    if (!entry.category) return undefined
    return { '--marker': categoryColor(entry.category, categoryColors) } as CSSProperties
  }, [entry.category, categoryColors])
  const previewable = ['image', 'video', 'audio', 'pdf', 'text', 'code'].includes(kind)

  return (
    <div
      ref={ref}
      className={`row k-${kind}${expanded ? ' open' : ''}${missing ? ' missing' : ''}${
        onPin ? ' has-pin' : ''
      }`}
    >
      <button className="row-head" onClick={onToggle} aria-expanded={expanded}>
        <span className="tick" aria-hidden />
        <span className="serial mono">{entry.serial}</span>
        <span className="name" title={entry.path}>
          {entry.name}
        </span>
        {entry.parent && <span className="parent mono">{entry.parent}</span>}
        {/* 有說明時就靠 .desc 自己撐開（它會吃掉檔名到晶片之間的所有空間，
            容器夠寬就少截幾個字）；沒說明才用一個空的 .grow 把右邊那組
            （晶片／容量）推到最右。 */}
        {entry.description ? (
          <span className="desc">{entry.description}</span>
        ) : (
          <span className="grow" />
        )}
        {missing && <span className="badge miss">檔案已不存在</span>}
        {/* 分類晶片放整列右邊固定一欄——不夾在檔名後面，檔名長短不一就不會
            讓每列的晶片參差不齊。容量固定寬度、永遠在最右（就算沒分類、
            沒容量也佔位），這樣「容量」跟「分類」各自成一欄、右緣都對齊。 */}
        {entry.category && (
          <span className="chip" style={chipStyle}>
            {entry.category}
          </span>
        )}
        <span className="size mono" aria-hidden={!(stat?.exists && stat.size !== undefined)}>
          {stat?.exists && stat.size !== undefined ? humanSize(stat.size) : ''}
        </span>
      </button>

      {/* 不能塞進上面的 <button className="row-head">——巢狀 <button> 是無效
          HTML，鍵盤焦點/點擊在部分瀏覽器下會亂跳。放在 .row-head 旁邊、
          絕對定位疊在右上角，靠 stopPropagation 擋掉冒泡到 onToggle。 */}
      {onPin && (
        <button
          type="button"
          className="row-pin"
          onClick={(e) => {
            e.stopPropagation()
            if (ref.current) onPin(ref.current.getBoundingClientRect())
          }}
          title="按一下變懸浮視窗"
        >
          <Pin size={13} aria-hidden />
        </button>
      )}

      {expanded && (
        <div className="row-detail">
          <div className="path mono">{entry.path}</div>
          <div className="meta mono">
            <span>{kindLabel(kind)}</span>
            {entry.ext && <span>{entry.ext}</span>}
            {stat?.exists && stat.size !== undefined && <span>{humanSize(stat.size)}</span>}
            {stat?.exists && stat.mtime !== undefined && <span>{stampOf(stat.mtime)}</span>}
            {missing && <span className="miss-txt">磁碟上找不到這個檔案</span>}
          </div>
          <div className="row-actions">
            {previewable && (
              <button
                className={`btn sm${preview ? ' on' : ''}`}
                onClick={() => setPreview((v) => !v)}
                disabled={missing}
              >
                <Eye size={13} aria-hidden /> {preview ? '收起預覽' : '預覽內容'}
              </button>
            )}
            <button className="btn sm" onClick={onCopy}>
              <Clipboard size={13} aria-hidden /> 複製路徑
            </button>
            <button className="btn sm" onClick={() => onOpen(true)} disabled={missing}>
              <FolderOpen size={13} aria-hidden /> 開啟所在資料夾
            </button>
            <button className="btn sm" onClick={() => onOpen(false)} disabled={missing}>
              <SquareArrowOutUpRight size={13} aria-hidden /> 開啟檔案
            </button>

            {onEdit && !editOpen && (
              <button
                className="btn sm"
                onClick={openEdit}
                title="改這一列的分類／說明（只動 .md，不碰實體檔案）"
              >
                <Pencil size={13} aria-hidden /> 編輯
              </button>
            )}

            {onDelete && (
              <span className="row-del">
                {confirmDel ? (
                  <>
                    <button
                      className="btn sm danger"
                      disabled={deleting}
                      onClick={() => onDelete()}
                    >
                      {deleting ? '移除中…' : '確定移除'}
                    </button>
                    <button
                      className="btn sm"
                      disabled={deleting}
                      onClick={() => setConfirmDel(false)}
                    >
                      取消
                    </button>
                  </>
                ) : (
                  <button
                    className="btn sm danger"
                    onClick={() => setConfirmDel(true)}
                    title="只移除這一列索引紀錄，不會刪除硬碟上的檔案"
                  >
                    <Trash2 size={13} aria-hidden /> 從索引移除
                  </button>
                )}
              </span>
            )}
          </div>
          {onDelete && confirmDel && (
            <p className="del-note mono">// 只移除索引紀錄，硬碟上的實體檔案會保留</p>
          )}

          {onEdit && editOpen && (
            <form
              className="row-edit"
              onSubmit={(e) => {
                e.preventDefault()
                if (!editing) onEdit({ category: draftCat.trim(), description: draftDesc.trim() })
              }}
            >
              <label className="re-field">
                <span>分類</span>
                <input
                  value={draftCat}
                  list={listId}
                  disabled={editing}
                  placeholder="（留空＝未分類）"
                  onChange={(e) => setDraftCat(e.target.value)}
                  autoFocus
                />
                {categories && categories.length > 0 && (
                  <datalist id={listId}>
                    {categories.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                )}
              </label>
              {onSetCategoryColor && draftCat.trim() && (
                <label className="re-field re-color">
                  <span>分類顏色</span>
                  <span className="re-color-controls">
                    <input
                      type="color"
                      className="cat-color-swatch"
                      disabled={editing}
                      value={categoryColor(draftCat.trim(), categoryColors)}
                      onChange={(e) => onSetCategoryColor(draftCat.trim(), e.target.value)}
                    />
                    {categoryColors?.[draftCat.trim()] && (
                      <button
                        type="button"
                        className="btn sm"
                        disabled={editing}
                        onClick={() => onSetCategoryColor(draftCat.trim(), null)}
                      >
                        重設
                      </button>
                    )}
                    <span className="re-note mono">
                      // 套用到「{draftCat.trim()}」這個分類的所有項目、色點與晶片
                    </span>
                  </span>
                </label>
              )}
              <label className="re-field">
                <span>說明</span>
                <textarea
                  value={draftDesc}
                  rows={3}
                  disabled={editing}
                  placeholder="這一列在索引裡的說明文字"
                  onChange={(e) => setDraftDesc(e.target.value)}
                />
              </label>
              {editError && <p className="err">{editError}</p>}
              <div className="re-foot">
                <span className="re-note mono">// 只改索引表格這一列，路徑與位置不動</span>
                <span className="grow" />
                <button
                  type="button"
                  className="btn sm"
                  disabled={editing}
                  onClick={() => setEditOpen(false)}
                >
                  取消
                </button>
                <button type="submit" className="btn sm primary" disabled={editing || !dirty}>
                  {editing ? '儲存中…' : '儲存變更'}
                </button>
              </div>
            </form>
          )}

          {previewable && preview && !missing && (
            <FilePreview path={entry.path} kind={kind} />
          )}
        </div>
      )}
    </div>
  )
}
