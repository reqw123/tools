import { useEffect, useRef, useState } from 'react'
import { noteImageUrl, NotFoundError, REACTION_EMOJIS, REPEAT_LABELS, type Note, type NoteInput } from '../lib/api'
import { paperVars } from '../lib/color'
import { dueLabel, dueStatus, stamp, timeAgo } from '../lib/format'
import {
  useAdvanceRepeat,
  useAppSettings,
  useCreateNote,
  useDeleteNote,
  useNotes,
  useReactToNote,
  useReminderSettings,
  useRemoveNoteImage,
  useSetNoteImage,
  useSetNotePinned,
  useTagColors,
  useToggleNoteLine,
  useUpdateNote,
  useUploadNoteImage,
} from '../hooks/useNotes'
import { useShareInfo } from '../hooks/useShareInfo'
import { useCanWrite } from '../hooks/useSession'
import { useActivity, useEditingHeartbeat, usePresence } from '../hooks/useActivity'
import { useCard, useSetCard } from '../hooks/useCard'
import { displayAuthor, readAuthorName } from '../lib/identity'
import { Body } from './Body'
import { FileBrowser } from './FileBrowser'
import { NoteForm } from './NoteForm'
import { scrimClose } from '../lib/scrimClose'

type Mode = 'view' | 'edit' | 'new'

/** ActivityEntry.action → footer 顯示用的動詞。 */
const ACTIVITY_VERB: Record<string, string> = {
  create: '新增',
  update: '編輯',
  delete: '刪除',
  restore: '復原',
  'bulk-delete': '批次刪除',
}

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
  // 區網共用模式：不用能瀏覽 host 硬碟的 FileBrowser，改成瀏覽器原生 <input type=file> 上傳。
  const isShare = useShareInfo().mode === 'lan'
  const canWrite = useCanWrite()
  const uploadFileRef = useRef<HTMLInputElement>(null)
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
  // 清單已抓回來、裡面卻沒有這則 → 被別人（或桌面版）刪掉了。多人共用後這會發生。
  const noteGone =
    !!initialNote && notes !== undefined && !notes.some((n) => n.id === initialNote.id)

  // 進入編輯模式當下的快照——編輯途中若 SSE 推來這則被別人改了，跟這個比對就
  // 知道要不要提醒。只在「進出編輯／換便利貼／按重填」時重抓，note 本身之後
  // 變動（＝別人改的）不動它。
  const [editBase, setEditBase] = useState<Note | null>(null)
  const [formSeq, setFormSeq] = useState(0) // 「用最新版本重填」= 把 <NoteForm> 重新掛載
  useEffect(() => {
    setEditBase(mode === 'edit' && note ? { ...note } : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, initialNote?.id, formSeq])
  const staleEdit =
    mode === 'edit' &&
    !!editBase &&
    !!note &&
    (note.title !== editBase.title ||
      note.body !== editBase.body ||
      note.tag !== editBase.tag ||
      note.due_at !== editBase.due_at ||
      note.repeat !== editBase.repeat)
  const { data: reminderSettings } = useReminderSettings()
  const due = note ? dueStatus(note.due_at, reminderSettings?.dueSoonHours) : ''

  // 「誰動了我的牆」——最後一筆跟這則有關的活動；「誰正在編輯」——presence 用
  // noteId 當 key，支援同時好幾個人編輯同一則，不是只顯示一個。編輯視窗自己
  // 開著時送心跳。
  const { data: activity } = useActivity()
  const lastActivity = note ? activity?.find((a) => a.noteId === note.id) : undefined
  const { data: presence } = usePresence()
  const editingBy = [...new Set((note ? (presence?.[note.id] ?? []) : []).map(displayAuthor))]
  // noteGone 才確定「已經被刪了」——note 在那之前會退回顯示 initialNote 的
  // 舊快照（見上面 note 的算法），id 還在、mode 還是 'edit'，heartbeat 若沒
  // 擋掉 noteGone 會一直對一個不存在的 noteId 送心跳，presence.ts 裡那則幽靈
  // 記錄就靠這個心跳續命，直到使用者自己關掉編輯視窗才會消失。
  useEditingHeartbeat(mode === 'edit' && note && !noteGone ? note.id : undefined)

  const create = useCreateNote()
  const update = useUpdateNote()
  const remove = useDeleteNote()
  const toggleLine = useToggleNoteLine()
  const setPinned = useSetNotePinned()
  const advanceRepeat = useAdvanceRepeat()
  const react = useReactToNote()
  const setImage = useSetNoteImage()
  const uploadImage = useUploadNoteImage()
  const removeImage = useRemoveNoteImage()
  // 「看板」（固定網址 /card）——這則是不是目前指定的內容，跟切換它。
  const { data: card } = useCard()
  const setCard = useSetCard()
  const isCard = !!note && card?.noteId === note.id

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

  const recreateFrom = (n: Note, patch: Partial<NoteInput> = {}) =>
    create.mutate(
      {
        title: patch.title ?? n.title,
        body: patch.body ?? n.body,
        tag: patch.tag ?? n.tag,
        due_at: patch.due_at ?? n.due_at,
        repeat: patch.repeat ?? n.repeat,
        assignee: patch.assignee ?? n.assignee,
      },
      { onSuccess: onClose },
    )

  const submit = (input: Partial<NoteInput>) => {
    if (mode === 'new') {
      create.mutate(input as NoteInput, { onSuccess: onClose })
    } else if (note && noteGone) {
      // 編輯途中這則被刪了 → 把使用者打的東西另存成一則新的，不丟。
      recreateFrom(note, input)
    } else if (note) {
      if (Object.keys(input).length === 0) {
        setMode('view') // 沒有任何改動：不打 API、不 bump 排序、不通知別人
        return
      }
      update.mutate({ id: note.id, patch: input }, { onSuccess: () => setMode('view') })
    }
  }

  const busy =
    create.isPending ||
    update.isPending ||
    remove.isPending ||
    advanceRepeat.isPending ||
    setImage.isPending ||
    uploadImage.isPending ||
    removeImage.isPending
  const rawErr = create.error || update.error || remove.error || removeImage.error
  const err =
    rawErr instanceof NotFoundError
      ? '這則便利貼已經不在了（可能剛被別人或桌面版刪除）。'
      : rawErr?.message

  return (
    <div className="scrim" {...scrimClose(onClose)}>
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

        {noteGone && mode !== 'edit' && note ? (
          <>
            <h2>{note.title}</h2>
            <p className="dim">
              這則便利貼已經被刪除了（可能是別人，或桌面版）。可以到工具列「🗑 垃圾桶」
              把它復原，或直接重新建立一則一樣的。
            </p>
            {err && <p className="err">{err}</p>}
            <div className="sheet-actions">
              <button className="btn" disabled={busy} onClick={() => recreateFrom(note)}>
                重新建立一則
              </button>
              <button className="btn ghost" onClick={onClose}>
                關閉
              </button>
            </div>
          </>
        ) : mode === 'view' && note ? (
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
            {note.assignee && (
              <p className="assignee-badge" title={`指派給：${note.assignee}`}>
                👤 指派給 {note.assignee}
              </p>
            )}
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
              {lastActivity && (
                <span className="stamp" title={stamp(lastActivity.at)}>
                  ·　{ACTIVITY_VERB[lastActivity.action]}：{displayAuthor(lastActivity.author)}
                  　{timeAgo(lastActivity.at)}
                </span>
              )}
            </footer>
            {canWrite && (
              <div className="reaction-row">
                {REACTION_EMOJIS.map((emoji) => {
                  const reactors = note.reactions[emoji] ?? []
                  const mine = reactors.includes(readAuthorName())
                  return (
                    <button
                      key={emoji}
                      type="button"
                      className="reaction-btn"
                      aria-pressed={mine}
                      disabled={react.isPending}
                      title={reactors.length ? reactors.join('、') : undefined}
                      onClick={() => react.mutate({ id: note.id, emoji })}
                    >
                      {emoji} {reactors.length > 0 && reactors.length}
                    </button>
                  )
                })}
              </div>
            )}
            {editingBy.length > 0 && (
              <p className="edit-warn">
                ✏️ {editingBy.join('、')} 正在編輯這則——建議晚點再改，避免蓋掉對方的內容。
              </p>
            )}
            {(err || imgErr) && <p className="err">{err || imgErr}</p>}
            {!canWrite && <p className="hint">👁 唯讀身分，不能編輯</p>}
            {canWrite && (
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
                aria-pressed={isCard}
                disabled={setCard.isPending}
                title="固定網址 /card 顯示的內容——換一則會讓所有開著 /card 的展示螢幕跟著換"
                onClick={() => setCard.mutate(isCard ? null : note.id)}
              >
                {isCard ? '📺 移除看板' : '📺 設為看板'}
              </button>
              <button
                className="btn ghost"
                disabled={busy}
                onClick={() => {
                  setImgErr('')
                  if (isShare) {
                    uploadFileRef.current?.click()
                  } else {
                    setPickPath(null)
                    setPicking(true)
                  }
                }}
              >
                {note.image ? '更換圖片' : '插入圖片'}
              </button>
              {isShare && (
                <input
                  ref={uploadFileRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    e.target.value = '' // 讓重選同一個檔也能再觸發
                    if (!f || !note) return
                    uploadImage.mutate(
                      { id: note.id, file: f },
                      { onError: (er) => setImgErr(er instanceof Error ? er.message : String(er)) },
                    )
                  }}
                />
              )}
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
            )}
          </>
        ) : (
          <>
            <h2>{mode === 'new' ? '新增便利貼' : '編輯便利貼'}</h2>
            {mode === 'edit' && noteGone && (
              <p className="edit-warn">
                這則便利貼剛被刪除了——按「儲存」會另存成一則新的便利貼，你打的內容不會不見。
              </p>
            )}
            {mode === 'edit' && !noteGone && staleEdit && (
              <p className="edit-warn">
                這則剛被別人（或桌面版）改過。你只會送出自己動到的欄位，但若改到同一欄會蓋掉對方的。
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => setFormSeq((n) => n + 1)}
                >
                  用最新版本重填
                </button>
              </p>
            )}
            <NoteForm
              key={`${initialNote?.id ?? 'new'}-${formSeq}`}
              initial={mode === 'new' ? undefined : (note ?? undefined)}
              defaultTag={mode === 'new' ? defaultTag : undefined}
              knownTags={knownTags}
              submitLabel={mode === 'new' ? '新增' : noteGone ? '另存為新便利貼' : '儲存'}
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
