import { useEffect, useRef } from 'react'
import { noteThumbUrl, type Note as NoteT } from '../lib/api'
import { paperVars } from '../lib/color'
import { seedOf, stamp, tiltOf } from '../lib/format'
import { Body } from './Body'

const EDGE_MARGIN = 24 // 拖到離視窗邊緣多近算「要彈出去變懸浮視窗」

type DragState = { offsetX: number; offsetY: number; moved: boolean }

export function Note({
  note,
  index,
  onOpen,
  floatable,
  onDragOut,
}: {
  note: NoteT
  index: number
  onOpen: (n: NoteT) => void
  /** 只有桌面牆（Electron）才有這個能力——一般瀏覽器完全不掛這組手勢。 */
  floatable?: boolean
  onDragOut?: (note: NoteT, rect: DOMRect) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<DragState | null>(null)
  const justDragged = useRef(false)

  const seed = seedOf(note.title + note.tag)
  const rot = tiltOf(seed)
  const usePin = seed % 3 === 2
  const style = paperVars(note.tag, rot, index)

  const open = () => {
    // 剛剛在拖（不管有沒有真的拖出去），這次 click 是拖曳動作的副產物，
    // 不該順便把編輯視窗也開起來。
    if (justDragged.current) {
      justDragged.current = false
      return
    }
    onOpen(note)
  }

  // 拖出視窗邊緣＝彈成獨立懸浮視窗——見 sticky-wall-web 專案內
  // desktop-wall/prototype-focus-note 的原型，這裡是同一套手勢的正式版。
  // 拿不到「游標真的離開視窗之後」的座標（Chromium 的 mousemove 一旦游標
  // 出了視窗範圍就不會再送進來），所以拿「拖到離邊緣一小段距離內」當
  // 觸發點，體感上很接近「拖出牆外」。
  useEffect(() => {
    if (!floatable || !onDragOut) return

    const finish = (popOut: boolean) => {
      const el = ref.current
      const d = drag.current
      drag.current = null
      if (!el || !d) return
      justDragged.current = d.moved
      if (popOut) {
        const r = el.getBoundingClientRect()
        onDragOut(note, r)
      }
      // 還原成正常排版位置——不管有沒有彈出去都清掉暫時的內聯樣式；真的
      // 彈出去的那則之後會被父層從清單濾掉，這裡的還原只是保險。
      el.style.position = ''
      el.style.zIndex = ''
      el.style.left = ''
      el.style.top = ''
      el.style.width = ''
      el.classList.remove('dragging-out', 'will-pop')
    }

    const onMove = (e: MouseEvent) => {
      const d = drag.current
      const el = ref.current
      if (!d || !el) return
      if (!d.moved) {
        d.moved = true
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
    }
  }, [floatable, note, onDragOut])

  const onMouseDown = (e: React.MouseEvent) => {
    if (!floatable || !onDragOut) return
    if (e.button !== 0) return // 只認左鍵拖曳
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    drag.current = { offsetX: e.clientX - r.left, offsetY: e.clientY - r.top, moved: false }
  }

  return (
    <div
      ref={ref}
      className="note"
      style={style}
      role="button"
      tabIndex={0}
      data-note-id={note.id}
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
      <Body text={note.body} limit={5} />
      <footer>
        <span className="tag-pill">{note.tag || '未分類'}</span>
        <span className="stamp">{stamp(note.created_at)}</span>
      </footer>
    </div>
  )
}
