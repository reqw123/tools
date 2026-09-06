import { useEffect, useRef, useState } from 'react'
import { noteImageUrl, type Note, type NoteInput } from '../lib/api'
import { paperVars } from '../lib/color'
import { dueStatus, fromStoredDueAt, stamp } from '../lib/format'
import {
  useCreateNote,
  useDeleteNote,
  useNotes,
  useRemoveNoteImage,
  useSetNoteImage,
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
}: {
  note: Note | null
  initialMode: Mode
  knownTags: string[]
  defaultTag?: string
  onClose: () => void
}) {
  const ref = useRef<HTMLElement>(null)
  const [mode, setMode] = useState<Mode>(initialMode)
  const [confirmDel, setConfirmDel] = useState(false)
  const [picking, setPicking] = useState(false)
  const [pickPath, setPickPath] = useState<string | null>(null)
  const [imgErr, setImgErr] = useState('')
  // 便利貼容器裡的插圖太小看不清楚——雙擊放大 3 倍，蓋在最上層，可以超出
  // 便利貼視窗本身的範圍。zoomedRef 讓下面 Escape 監聽器不用把 zoomed
  // 放進 deps（不然每次放大/收合都要整個重掛一次監聽器、重設 body overflow）。
  const [zoomed, setZoomed] = useState(false)
  const zoomedRef = useRef(false)
  useEffect(() => {
    zoomedRef.current = zoomed
  }, [zoomed])

  // 用資料庫的最新版本（編輯後 view 模式要顯示新內容），沒有就退回開啟當下傳進來的。
  const { data: notes } = useNotes()
  const note = initialNote
    ? (notes?.find((n) => n.id === initialNote.id) ?? initialNote)
    : null

  const create = useCreateNote()
  const update = useUpdateNote()
  const remove = useDeleteNote()
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
  const style = paperVars(tag)

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
            <h2>{note.title}</h2>
            {noteImageUrl(note) && (
              <img
                className="sheet-img"
                src={noteImageUrl(note)!}
                alt=""
                draggable={false}
                title="雙擊放大"
                onDoubleClick={() => setZoomed(true)}
              />
            )}
            <Body text={note.body} />
            {dueStatus(note.due_at) && (
              <p className={`due-badge ${dueStatus(note.due_at)}`}>
                {dueStatus(note.due_at) === 'overdue' ? '⏰ 已逾期' : '⏳ 即將到期'}　{fromStoredDueAt(note.due_at)}
              </p>
            )}
            <footer>
              <span className="tag-pill">{note.tag || '未分類'}</span>
              <span className="stamp">{stamp(note.created_at)}</span>
            </footer>
            {(err || imgErr) && <p className="err">{err || imgErr}</p>}
            <div className="sheet-actions">
              <button className="btn ghost" onClick={() => setMode('edit')}>
                編輯
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
        <div className="zoom-scrim" onClick={() => setZoomed(false)}>
          <img
            className="zoom-img"
            src={noteImageUrl(note)!}
            alt=""
            draggable={false}
            onDoubleClick={() => setZoomed(false)}
          />
        </div>
      )}
    </div>
  )
}
