import { useEffect, useRef } from 'react'
import { noteThumbUrl, REPEAT_LABELS, type Note as NoteT } from '../lib/api'
import { paperVars } from '../lib/color'
import { dueLabel, dueStatus, seedOf, stamp, tiltOf } from '../lib/format'
import {
  useAppSettings, useReminderSettings, useSetNotePinned, useTagColors, useToggleNoteLine,
} from '../hooks/useNotes'
import { Body } from './Body'

const EDGE_MARGIN = 24 // 拖到離視窗邊緣多近算「要彈出去變懸浮視窗」
const DRAG_THRESHOLD = 6 // 游標從按下點移動超過這麼多 px 才算「開始拖」，不然單純點一下的微小抖動會被誤判成拖曳

type DragState = {
  offsetX: number
  offsetY: number
  moved: boolean
  /** 按下當下的游標位置——用來跟 DRAG_THRESHOLD 比對。 */
  startX: number
  startY: number
}

export function Note({
  note,
  index,
  onOpen,
  floatable,
  onDragOut,
  onGeometryChange,
}: {
  note: NoteT
  index: number
  onOpen: (n: NoteT) => void
  /** 只有桌面牆（Electron）才有這個能力——一般瀏覽器完全不掛這組手勢。 */
  floatable?: boolean
  onDragOut?: (note: NoteT, rect: DOMRect) => void
  /** 拖曳結束後把 inline 定位樣式清掉了，通知牆重排（列 masonry 重新定位這張）。 */
  onGeometryChange?: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<DragState | null>(null)
  const justDragged = useRef(false)

  const seed = seedOf(note.title + note.tag)
  const rot = tiltOf(seed)
  const usePin = seed % 3 === 2
  const { data: tagColors } = useTagColors()
  const { data: appSettings } = useAppSettings()
  const style = paperVars(note.tag, rot, index, tagColors, appSettings?.defaultNoteColor)
  const { data: reminderSettings } = useReminderSettings()
  const due = dueStatus(note.due_at, reminderSettings?.dueSoonHours)
  const toggleLine = useToggleNoteLine()
  const setPinned = useSetNotePinned()

  const open = () => {
    // 剛剛在拖（不管有沒有真的拖出去），這次 click 是拖曳動作的副產物，
    // 不該順便把編輯視窗也開起來。
    if (justDragged.current) {
      justDragged.current = false
      return
    }
    onOpen(note)
  }

  // 拖出視窗邊緣＝彈成獨立懸浮視窗——見 notes-web 專案內
  // wallpaper-app/prototype-focus-note 的原型，這裡是同一套手勢的正式版。
  // 拿不到「游標真的離開視窗之後」的座標（Chromium 的 mousemove 一旦游標
  // 出了視窗範圍就不會再送進來），所以拿「拖到離邊緣一小段距離內」當
  // 觸發點，體感上很接近「拖出牆外」。
  useEffect(() => {
    if (!floatable || !onDragOut) return

    // 拖曳中擋掉整頁文字選取——不然游標劃過標題／其他便利貼會反白一整片
    // （回報的「錯誤反白」）。
    const setNoSelect = (on: boolean) => {
      const s = document.body.style as CSSStyleDeclaration & { webkitUserSelect?: string }
      s.userSelect = on ? 'none' : ''
      s.webkitUserSelect = on ? 'none' : ''
    }

    const finish = (popOut: boolean) => {
      const el = ref.current
      const d = drag.current
      drag.current = null
      setNoSelect(false)
      if (!el || !d) return
      justDragged.current = d.moved

      if (popOut) {
        const r = el.getBoundingClientRect()
        // 這則要離開牆了——先直接隱形，再交給 onDragOut（會讓父層把它移出
        // 清單、React 隨後卸載這個節點）。**不要**還原 inline 樣式＋叫牆重排：
        // 那會讓卡片先「彈回牆上的原位」閃一下才消失（回報的邊界閃爍）。
        el.style.visibility = 'hidden'
        onDragOut(note, r)
        return
      }

      // 沒彈出去、收回牆上：清掉拖曳時的 inline 樣式 → 立刻（同步）叫牆重排把
      // 位置補回去 → 最後才移除 .dragging-out（它壓著 transition:none）。這三步
      // 之間不讓瀏覽器 paint，卡片就不會先閃到 .wall 左上角、也不會開著 0.3s
      // 過場從那邊滑回來。
      el.style.position = ''
      el.style.zIndex = ''
      el.style.left = ''
      el.style.top = ''
      el.style.width = ''
      onGeometryChange?.()
      el.classList.remove('dragging-out', 'will-pop')
    }

    const onMove = (e: MouseEvent) => {
      const d = drag.current
      const el = ref.current
      if (!d || !el) return
      if (!d.moved) {
        // 還沒離開按下點超過門檻 → 當成「只是按著、可能只是點一下」，先不動它。
        // 少了這道門檻，單純點一下時游標的一兩 px 抖動就會把卡片瞬間切成
        // position:fixed 跳到游標處再彈回（看起來像「空白處閃過一張便利貼」），
        // 而且 justDragged 被設成 true，這一下 click 就不會開啟便利貼。
        if (
          Math.abs(e.clientX - d.startX) < DRAG_THRESHOLD &&
          Math.abs(e.clientY - d.startY) < DRAG_THRESHOLD
        ) {
          return
        }
        d.moved = true
        setNoSelect(true)
        window.getSelection?.()?.removeAllRanges() // 按下到現在可能已經起頭選了一點
        const r = el.getBoundingClientRect()
        el.style.position = 'fixed'
        el.style.zIndex = '999'
        el.style.width = r.width + 'px' // 脫離欄寬限制後鎖住寬度，不要跳動
        el.classList.add('dragging-out')
      }
      el.style.left = e.clientX - d.offsetX + 'px'
      el.style.top = e.clientY - d.offsetY + 'px'
      const near =
        e.clientX < EDGE_MARGIN ||
        e.clientY < EDGE_MARGIN ||
        e.clientX > window.innerWidth - EDGE_MARGIN ||
        e.clientY > window.innerHeight - EDGE_MARGIN
      el.classList.toggle('will-pop', near)
      if (near) finish(true)
    }

    const onUp = () => {
      if (drag.current) finish(false)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      setNoSelect(false) // 拖到一半元件重掛/卸載也要還原
    }
  }, [floatable, note, onDragOut, onGeometryChange])

  const onMouseDown = (e: React.MouseEvent) => {
    if (!floatable || !onDragOut) return
    if (e.button !== 0) return // 只認左鍵拖曳
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    drag.current = {
      offsetX: e.clientX - r.left,
      offsetY: e.clientY - r.top,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
    }
  }

  return (
    <div
      ref={ref}
      className="note"
      style={style}
      role="button"
      tabIndex={0}
      data-note-id={note.id}
      data-tag={note.tag}
      onMouseDown={onMouseDown}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          open()
        }
      }}
      aria-label={`便利貼：${note.title}，分類 ${note.tag || '未分類'}`}
    >
      {usePin ? <span className="pin" aria-hidden /> : <span className="tape" aria-hidden />}
      <span className="curl" aria-hidden />
      <button
        type="button"
        className={`pin-toggle${note.pinned ? ' on' : ''}`}
        aria-pressed={note.pinned}
        aria-label={note.pinned ? '取消釘選' : '釘選到最上面'}
        title={note.pinned ? '取消釘選' : '釘選到最上面'}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          setPinned.mutate({ id: note.id, pinned: !note.pinned })
        }}
      >
        {note.pinned ? '★' : '☆'}
      </button>
      <h3>{note.title}</h3>
      {note.image && (
        <img
          className="note-img"
          src={noteThumbUrl(note, 800)!}
          srcSet={`${noteThumbUrl(note, 400)} 400w, ${noteThumbUrl(note, 800)} 800w`}
          sizes="240px"
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
        />
      )}
      <Body
        text={note.body}
        limit={5}
        onToggleLine={(srcIndex) => toggleLine.mutate({ id: note.id, srcIndex })}
      />
      {due && (
        <p className={`due-badge ${due}`}>
          {due === 'overdue' ? '⏰ 已逾期' : '⏳ 即將到期'}　{dueLabel(note.due_at)}
        </p>
      )}
      {note.repeat && note.due_at && (
        <p className="repeat-badge" title={`重複到期：${REPEAT_LABELS[note.repeat] ?? note.repeat}`}>
          🔁 {REPEAT_LABELS[note.repeat] ?? note.repeat}
          {!due && `　·　下次 ${dueLabel(note.due_at)}`}
        </p>
      )}
      <footer>
        <span className="tag-pill">{note.tag || '未分類'}</span>
        <span className="stamp">{stamp(note.created_at)}</span>
      </footer>
    </div>
  )
}
