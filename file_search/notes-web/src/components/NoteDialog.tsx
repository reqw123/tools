import { useEffect, useRef, useState } from 'react'
import { noteImageUrl, REPEAT_LABELS, type Note, type NoteInput } from '../lib/api'
import { paperVars } from '../lib/color'
import { dueLabel, dueStatus, stamp } from '../lib/format'
import {
  useAdvanceRepeat,
  useAppSettings,
  useCreateNote,
  useDeleteNote,
  useNotes,
  useReminderSettings,
  useRemoveNoteImage,
  useSetNoteImage,
  useSetNotePinned,
  useTagColors,
  useToggleNoteLine,
  useUpdateNote,
} from '../hooks/useNotes'
import { Body } from './Body'
import { FileBrowser } from './FileBrowser'
import { NoteForm } from './NoteForm'

type Mode = 'view' | 'edit' | 'new'

export function NoteDialog({
  note: initialNote,
  initialMode,
  knownTags,
  defaultTag,
  onClose,
  onPrev,
  onNext,
}: {
  note: Note | null
  initialMode: Mode
  knownTags: string[]
  defaultTag?: string
  onClose: () => void
  /** 上一則／下一則——在呼叫端目前篩選出的清單裡移動；undefined＝已經是頭/尾，不顯示按鈕。 */
  onPrev?: () => void
  onNext?: () => void
}) {
  const ref = useRef<HTMLElement>(null)
  const [mode, setMode] = useState<Mode>(initialMode)
  const [confirmDel, setConfirmDel] = useState(false)
  const [picking, setPicking] = useState(false)
  const [pickPath, setPickPath] = useState<string | null>(null)
  const [imgErr, setImgErr] = useState('')
  // 便利貼容器裡的插圖太小看不清楚——點一下放大（跟匯出的 HTML 同一套規則），
  // 蓋在最上層，可以超出便利貼視窗本身的範圍。zoomedRef 讓下面 Escape 監聽器
  // 不用把 zoomed 放進 deps（不然每次放大/收合都要整個重掛一次監聽器、重設
  // body overflow）。
  const [zoomed, setZoomed] = useState(false)
  const zoomedRef = useRef(false)
  useEffect(() => {
    zoomedRef.current = zoomed
  }, [zoomed])

  // 同樣道理：上一則/下一則的鍵盤快捷鍵（←/→）要讀最新的 onPrev/onNext/mode，
  // 但不想讓下面掛 Escape/方向鍵監聽器的 effect 因為這幾個每次 render 都變
  // 的東西（onPrev/onNext 是呼叫端傳進來的內聯函式）而重新掛載一次。
  const navRef = useRef({ onPrev, onNext, mode })
  useEffect(() => {
    navRef.current = { onPrev, onNext, mode }
  }, [onPrev, onNext, mode])

  // 上一則／下一則是換 note prop、不是整個對話框重新掛載（同一個 NoteDialog
  // 實例留著），上面這些「這一則專屬」的暫存 UI 狀態不會自動歸零——不重置
  // 的話，例如在 A 便利貼按了「刪除」還沒確認就切到 B，B 一開就會顯示
  // 「確定要刪除」的提示，或 A 放大看的圖片疊在 B 上面，都是很奇怪的殘留。
  useEffect(() => {
    setMode(initialMode)
    setConfirmDel(false)
    setPicking(false)
    setPickPath(null)
    setImgErr('')
    setZoomed(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialNote?.id])

  // 用資料庫的最新版本（編輯後 view 模式要顯示新內容），沒有就退回開啟當下傳進來的。
  const { data: notes } = useNotes()
  const note = initialNote
    ? (notes?.find((n) => n.id === initialNote.id) ?? initialNote)
    : null
  const { data: reminderSettings } = useReminderSettings()
  const due = note ? dueStatus(note.due_at, reminderSettings?.dueSoonHours) : ''

  const create = useCreateNote()
  const update = useUpdateNote()
  const remove = useDeleteNote()
  const toggleLine = useToggleNoteLine()
  const setPinned = useSetNotePinned()
  const advanceRepeat = useAdvanceRepeat()
  const setImage = useSetNoteImage()
  const removeImage = useRemoveNoteImage()

  const applyImage = (path: string) => {
    if (!note) return
    setImgErr('')
    setImage.mutate(
      { id: note.id, srcPath: path },
      {
        onSuccess: () => {
          setPicking(false)
          setPickPath(null)
        },
        onError: (e) => setImgErr(e instanceof Error ? e.message : String(e)),
      },
    )
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        // 只在檢視模式（不是編輯/新增，也沒開著放大檢視）才讓方向鍵切便利貼
        // ——編輯中的文字內容本來就需要方向鍵移動游標，不能搶走。
        const { onPrev, onNext, mode: m } = navRef.current
        if (m !== 'view' || zoomedRef.current) return
        if (e.key === 'ArrowLeft') onPrev?.()
        else onNext?.()
        return
      }
      if (e.key !== 'Escape') return
      // Esc 先關放大檢視就好，不要連便利貼視窗一起關掉。
      if (zoomedRef.current) {
        setZoomed(false)
        return
      }
      onClose()
    }
    document.addEventListener('keydown', onKey)
    ref.current?.focus()
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  const tag = mode === 'new' ? '' : (note?.tag ?? '')
  const { data: tagColors } = useTagColors()
  const { data: appSettings } = useAppSettings()
  const style = paperVars(tag, 0, undefined, tagColors, appSettings?.defaultNoteColor)

  const submit = (input: NoteInput) => {
    if (mode === 'new') {
      create.mutate(input, { onSuccess: onClose })
    } else if (note) {
      update.mutate({ id: note.id, patch: input }, { onSuccess: () => setMode('view') })
    }
  }

  const busy =
    create.isPending ||
    update.isPending ||
    remove.isPending ||
    advanceRepeat.isPending ||
    setImage.isPending ||
    removeImage.isPending
  const err = (create.error || update.error || remove.error || removeImage.error)?.message

  return (
    <div className="scrim" onClick={onClose}>
      <article
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'new' ? '新增便利貼' : note?.title}
        tabIndex={-1}
        ref={ref}
        style={style}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="icon-btn" onClick={onClose} aria-label="關閉">
          ×
        </button>
        <span className="curl" aria-hidden />

        {mode === 'view' && note ? (
          <>
            <div className="note-nav-row">
              <button
                type="button"
                className="note-nav-btn"
                onClick={onPrev}
                disabled={!onPrev}
                aria-label="上一則"
                title="上一則（←）"
              >
                ‹
              </button>
              <h2>{note.title}</h2>
              <button
                type="button"
                className="note-nav-btn"
                onClick={onNext}
                disabled={!onNext}
                aria-label="下一則"
                title="下一則（→）"
              >
                ›
              </button>
            </div>
            {noteImageUrl(note) && (
              <img
                className="sheet-img"
                src={noteImageUrl(note)!}
                alt=""
                draggable={false}
                title="點一下放大"
                onClick={() => setZoomed(true)}
              />
            )}
            <Body
              text={note.body}
              onToggleLine={(srcIndex) => toggleLine.mutate({ id: note.id, srcIndex })}
            />
            {due && (
              <p className={`due-badge ${due}`}>
                {due === 'overdue' ? '⏰ 已逾期' : '⏳ 即將到期'}　{dueLabel(note.due_at)}
              </p>
            )}
            {note.repeat && note.due_at && (
              <p className="repeat-badge">
                🔁 {REPEAT_LABELS[note.repeat] ?? note.repeat}
                　·　{due ? '這次' : '下次'} {dueLabel(note.due_at)}
              </p>
            )}
            <footer>
              <span className="tag-pill">{note.tag || '未分類'}</span>
              <span className="stamp">{stamp(note.created_at)}</span>
            </footer>
            {(err || imgErr) && <p className="err">{err || imgErr}</p>}
            <div className="sheet-actions">
              {note.repeat && note.due_at && (
                <button
                  className="btn"
                  disabled={busy}
                  title="把到期日排到下一次、清單重新開始"
                  onClick={() => advanceRepeat.mutate(note.id)}
                >
                  ✅ 這次完成
                </button>
              )}
              <button className="btn ghost" onClick={() => setMode('edit')}>
                編輯
              </button>
              <button
                className="btn ghost"
                aria-pressed={note.pinned}
                onClick={() => setPinned.mutate({ id: note.id, pinned: !note.pinned })}
              >
                {note.pinned ? '★ 取消釘選' : '☆ 釘選'}
              </button>
              <button
                className="btn ghost"
                disabled={busy}
                onClick={() => {
                  setImgErr('')
                  setPickPath(null)
                  setPicking(true)
                }}
              >
                {note.image ? '更換圖片' : '插入圖片'}
              </button>
              {note.image && (
                <button
                  className="btn ghost"
                  disabled={busy}
                  onClick={() => {
                    setImgErr('')
                    removeImage.mutate(note.id)
                  }}
                >
                  移除圖片
                </button>
              )}
              {confirmDel ? (
                <>
                  <button
                    className="btn danger"
                    disabled={busy}
                    onClick={() => remove.mutate(note.id, { onSuccess: onClose })}
                  >
                    確定刪除
                  </button>
                  <button className="btn ghost" onClick={() => setConfirmDel(false)}>
                    取消
                  </button>
                </>
              ) : (
                <button className="btn danger" onClick={() => setConfirmDel(true)}>
                  刪除
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <h2>{mode === 'new' ? '新增便利貼' : '編輯便利貼'}</h2>
            <NoteForm
              initial={mode === 'new' ? undefined : (note ?? undefined)}
              defaultTag={mode === 'new' ? defaultTag : undefined}
              knownTags={knownTags}
              submitLabel={mode === 'new' ? '新增' : '儲存'}
              submitting={busy}
              serverError={err}
              onSubmit={submit}
              onCancel={() => (mode === 'new' ? onClose() : setMode('view'))}
            />
          </>
        )}
      </article>

      {picking && note && (
        <div className="scrim" onClick={(e) => e.stopPropagation()}>
          <div
            className="sheet plain wide"
            role="dialog"
            aria-modal="true"
            aria-label="選擇圖片"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="icon-btn"
              onClick={() => setPicking(false)}
              aria-label="關閉"
              disabled={setImage.isPending}
            >
              ×
            </button>
            <h2>選擇圖片</h2>
            <p className="dim">
              挑一張本機圖片（JPG / PNG / GIF / WebP / BMP，上限 8MB）插入這則便利貼。
              雙擊檔案＝直接插入。
            </p>
            <FileBrowser mode="file" onPick={setPickPath} onPickImmediate={applyImage} />
            {imgErr && <p className="err">{imgErr}</p>}
            <div className="sheet-actions">
              <button
                className="btn"
                disabled={!pickPath || setImage.isPending}
                onClick={() => pickPath && applyImage(pickPath)}
              >
                {setImage.isPending ? '插入中…' : '插入這張'}
              </button>
              <button
                className="btn ghost"
                onClick={() => setPicking(false)}
                disabled={setImage.isPending}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {zoomed && note && noteImageUrl(note) && (
        // stopPropagation：這層是 .scrim 的子節點，不擋掉點擊會冒泡到 .scrim
        // 的 onClose，收放大圖時把整個便利貼視窗也一起關掉。
        <div
          className="zoom-scrim"
          onClick={(e) => {
            e.stopPropagation()
            setZoomed(false)
          }}
        >
          <img className="zoom-img" src={noteImageUrl(note)!} alt="" draggable={false} />
        </div>
      )}
    </div>
  )
}
